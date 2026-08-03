// cibilReconciliation.js — cross-references CIBIL-reported obligations against
// bank-statement-detected EMI debits, and runs the small-loan-stacking / debt-
// stress pipeline. Pure functions, no API calls. Consumes the output shapes
// already produced by CibilParser.js (accounts[], each account object shaped
// like { bankName, loanType, loanAmount, outstanding, emi, openDate, closedDate,
// dpds, overdue, settlement, writtenOff, status }) and bankBehaviour.js
// (emi_obligations[], summary.statement_period, credit_assessment.estimated_monthly_income).

const num = v => Number(v) || 0;
const round2 = n => Math.round(n * 100) / 100;

// CIBIL dates are always DD/MM/YYYY. Kept narrower and self-contained here
// (rather than importing bankBehaviour.js's multi-format parser) since this
// file's only date input is CIBIL's own fixed format.
function parseCibilDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1]);
}

// bankBehaviour.js's summary.statement_period is a display string built via
// toLocaleDateString('en-GB'), e.g. "01/11/2025 - 30/05/2026" - same DD/MM/YYYY
// shape as CIBIL dates, so the same parser applies to both sides.
function parseStatementPeriod(periodStr) {
  if (!periodStr) return null;
  const [startStr, endStr] = String(periodStr).split(' - ');
  const start = parseCibilDate(startStr);
  const end = parseCibilDate(endStr);
  return (start && end) ? { start, end } : null;
}

// Mirrors CibilParser.js's monthlyObligation() exactly (5% of outstanding for
// credit cards, 1% for gold loans, EMI amount otherwise) so totals stay
// consistent between the two tools rather than silently drifting apart.
export function cibilMonthlyObligation(acc) {
  const out = parseInt(String(acc.outstanding || '0').replace(/[^0-9]/g, '')) || 0;
  const emi = parseInt(String(acc.emi || '0').replace(/[^0-9]/g, '')) || 0;
  const type = (acc.loanType || '').toLowerCase();
  if (type.includes('credit card')) return Math.round(out * 0.05);
  if (type.includes('gold')) return Math.round(out * 0.01);
  return emi;
}

// Small/short-tenure unsecured lender name fragments - kept in sync with
// bankBehaviour.js's DICT.lenders list (fintech/NBFC app-loan providers), since
// CIBIL's bankName field for these lenders is usually close to the same name.
const SMALL_LOAN_LENDER_HINTS = ['KREDITBEE', 'KRAZYBEE', 'NAVI', 'LAZYPAY', 'MONEYTAP', 'CASHE', 'EARLYSALARY', 'FIBE', 'KISSHT', 'PAYSENSE', 'SMARTCOIN', 'STASHFIN', 'MPOKKET', 'SLICE', 'BRANCH', 'DHANI', 'TRUEBALANCE', 'AVAIL FINANCE', 'LOANTAP', 'POCKETCASH', 'KREDITONE', 'ZESTMONEY', 'KISETSU', 'SAISON', 'RESPO', 'INCRED', 'AMAZON PAY LATER', 'POONAWALLA'];
// ₹1L ceiling for "small loan" classification by amount - a configurable
// working threshold, not a fixed regulatory or bureau definition.
const SMALL_LOAN_AMOUNT_CEILING = 100000;

export function isSmallLoanAccount(acc) {
  const isPersonalOrConsumer = /personal loan|consumer loan|unsecured/i.test(acc.loanType || '');
  const lenderHint = SMALL_LOAN_LENDER_HINTS.some(l => (acc.bankName || '').toUpperCase().includes(l));
  const smallAmount = num(acc.loanAmount) > 0 && num(acc.loanAmount) <= SMALL_LOAN_AMOUNT_CEILING;
  return lenderHint || (isPersonalOrConsumer && smallAmount);
}

// ── 1. Reconciliation: CIBIL obligations vs bank-statement EMI debits ──────────
// Matches by approximate MONTHLY AMOUNT within a tolerance, not by lender name -
// CIBIL's bankName and the bank statement's narration text rarely match exactly
// (e.g. CIBIL says "IDFC FIRST BANK LTD", the bank narration says
// "RAZORPAYSOFTWAREPRIV"). Every unmatched item on either side becomes a
// reconciliation flag carrying POSSIBLE causes only - this can never assert
// which cause actually applies from a bank statement + credit report alone.
export function reconcileCibilVsBank(cibilAccounts, emiObligations, statementPeriodStr) {
  const statementPeriod = parseStatementPeriod(statementPeriodStr);
  const relevant = (cibilAccounts || [])
    .filter(acc => {
      if (acc.status === 'Active') return true;
      // A closed account that closed DURING or AFTER the statement window was
      // still live for at least part of it - keep it in scope. One that closed
      // before the statement even started is correctly out of scope (no
      // payment could show up in this statement either way).
      const cd = parseCibilDate(acc.closedDate);
      if (cd && statementPeriod && cd >= statementPeriod.start) return true;
      return false;
    })
    .map(acc => ({ ...acc, monthlyObl: cibilMonthlyObligation(acc) }))
    .filter(acc => acc.monthlyObl > 0);

  const usedBank = new Set();
  const matched = [];
  const unmatchedCibil = [];
  relevant.forEach(acc => {
    const tol = Math.max(500, acc.monthlyObl * 0.15);
    const idx = (emiObligations || []).findIndex((e, i) => !usedBank.has(i) && Math.abs(num(e.amount) - acc.monthlyObl) <= tol);
    if (idx >= 0) { usedBank.add(idx); matched.push({ cibil: acc, bank: emiObligations[idx] }); }
    else unmatchedCibil.push(acc);
  });
  const unmatchedBank = (emiObligations || []).filter((e, i) => !usedBank.has(i));

  const reconciliation_flags = [
    ...unmatchedCibil.map(acc => ({
      type: 'CIBIL_OBLIGATION_NOT_IN_BANK',
      severity: 'HIGH',
      lender: acc.bankName, loan_type: acc.loanType, monthly_obligation: acc.monthlyObl,
      description: `CIBIL shows a ${acc.loanType} obligation with ${acc.bankName} (~Rs.${acc.monthlyObl.toLocaleString('en-IN')}/mo) but no matching recurring debit was found in this bank statement.`,
      possible_causes: ['Paid from another account not included in this statement', 'Recently closed (check CIBIL closed date)', 'Payment missed this cycle', 'Statement period does not cover a full billing cycle'],
    })),
    ...unmatchedBank.map(e => ({
      type: 'BANK_EMI_NOT_IN_CIBIL',
      severity: 'MEDIUM',
      lender: e.party, monthly_obligation: num(e.amount),
      description: `A recurring EMI-like debit to "${e.party}" (~Rs.${num(e.amount).toLocaleString('en-IN')}/mo) appears in the bank statement but has no matching obligation in the CIBIL report.`,
      possible_causes: ['New loan not yet reported to the bureau', 'Reported under a co-borrower or different applicant', 'Loan misreported/miscategorized by the lender', 'Informal or non-bureau-reported obligation (family loan, chit fund, etc.)'],
    })),
  ];

  return { matched, unmatched_cibil: unmatchedCibil, unmatched_bank: unmatchedBank, reconciliation_flags };
}

// ── 2. Debt-stress pipeline ─────────────────────────────────────────────────────
// Each stage is a genuinely separate, inspectable output - not folded into one
// opaque score - so an underwriter can see WHY the final flag fired.
export function computeDebtStressPipeline(cibilAccounts, reconciliation, estimatedMonthlyIncome, reportDateStr) {
  const accounts = cibilAccounts || [];

  // Stage 1: Multiple Small Loan Detection
  const smallLoans = accounts.filter(acc => acc.status === 'Active' && isSmallLoanAccount(acc));

  // Stage 2: Loan Stacking Analysis - count of ALL active obligations, with the
  // small-loan subset flagged separately since that's the higher-risk category.
  const activeAccounts = accounts.filter(acc => acc.status === 'Active');
  const loan_stacking = {
    total_active_obligations: activeAccounts.length,
    small_loan_count: smallLoans.length,
    // >=3 simultaneous small/unsecured loans is a commonly-used underwriting
    // rule of thumb, not a fixed regulatory threshold - treat as configurable.
    flagged: smallLoans.length >= 3,
  };

  // Stage 3: Short-Term Borrowing Frequency - gap between consecutive small-loan
  // open dates, sorted chronologically.
  const openDates = smallLoans.map(a => parseCibilDate(a.openDate)).filter(Boolean).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < openDates.length; i++) gaps.push(Math.round((openDates[i] - openDates[i - 1]) / 86400000));
  const avgGapDays = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null;
  const borrowing_frequency = {
    small_loan_open_dates: smallLoans.map(a => a.openDate),
    avg_days_between_new_loans: avgGapDays,
    // Under ~45 days average between new small loans, repeated across 3+ loans,
    // reads as a borrowing HABIT rather than isolated need - again a working
    // heuristic threshold, not a fixed rule.
    flagged: avgGapDays !== null && avgGapDays < 45 && smallLoans.length >= 3,
  };

  // Stage 4: Debt Cycle Detection - a NEW loan opened within 30 days of an OLD
  // one closing, suggesting rollover/refinance rather than a clean payoff.
  const closedAccounts = accounts.filter(acc => acc.closedDate);
  const debt_cycle_events = [];
  closedAccounts.forEach(closedAcc => {
    const cd = parseCibilDate(closedAcc.closedDate);
    if (!cd) return;
    accounts.forEach(openAcc => {
      if (openAcc === closedAcc) return;
      const od = parseCibilDate(openAcc.openDate);
      if (!od) return;
      const gapDays = Math.round((od - cd) / 86400000);
      if (gapDays >= 0 && gapDays <= 30) {
        debt_cycle_events.push({ closed_lender: closedAcc.bankName, closed_date: closedAcc.closedDate, new_lender: openAcc.bankName, new_open_date: openAcc.openDate, gap_days: gapDays });
      }
    });
  });

  // Stage 5: Total Obligation Calculation - every active CIBIL obligation plus
  // any bank-statement EMI the reconciliation step couldn't match to a CIBIL
  // record (still a real monthly outflow even if unreported to the bureau).
  const cibilTotal = activeAccounts.reduce((s, a) => s + cibilMonthlyObligation(a), 0);
  const bankOnlyTotal = ((reconciliation && reconciliation.unmatched_bank) || []).reduce((s, e) => s + num(e.amount), 0);
  const total_monthly_obligation = round2(cibilTotal + bankOnlyTotal);

  // Stage 6: Liquidity Stress Score - a PROPOSED composite (0-100, higher = more
  // stressed), NOT an industry-standard formula. Weights: FOIR 50%, loan
  // stacking 25%, borrowing frequency 15%, debt-cycle events 10%. This is the
  // one place in this pipeline that's a judgment call rather than a direct read
  // of the data, and it's kept as separately-inspectable inputs for that reason
  // - adjust the weights freely rather than treating this number as gospel.
  const foir = estimatedMonthlyIncome > 0 ? (total_monthly_obligation / estimatedMonthlyIncome) : 1;
  const foirScore = Math.min(100, foir * 100);
  const stackingScore = Math.min(100, (loan_stacking.small_loan_count / 3) * 100);
  const frequencyScore = borrowing_frequency.flagged ? 100 : 0;
  const cycleScore = Math.min(100, debt_cycle_events.length * 34);
  const liquidity_stress_score = Math.round(foirScore * 0.5 + stackingScore * 0.25 + frequencyScore * 0.15 + cycleScore * 0.1);

  // Stage 7: Underwriting Risk Flag
  let underwriting_risk = 'LOW', recommendation = 'PROCEED';
  if (liquidity_stress_score >= 70) { underwriting_risk = 'CRITICAL'; recommendation = 'DECLINE'; }
  else if (liquidity_stress_score >= 50) { underwriting_risk = 'HIGH'; recommendation = 'REFER'; }
  else if (liquidity_stress_score >= 30) { underwriting_risk = 'MEDIUM'; recommendation = 'CAUTION'; }

  return {
    small_loan_detection: { count: smallLoans.length, accounts: smallLoans.map(a => ({ lender: a.bankName, amount: a.loanAmount, open_date: a.openDate })) },
    loan_stacking,
    borrowing_frequency,
    debt_cycle_events,
    total_monthly_obligation,
    foir_including_unreported: round2(foir * 100),
    liquidity_stress_score,
    underwriting_risk,
    recommendation,
  };
}
