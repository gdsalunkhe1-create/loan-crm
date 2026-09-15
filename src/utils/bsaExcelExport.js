// bsaExcelExport.js — builds the multi-sheet Bank Statement Analysis workbook
// (Executive Summary / EMI Tracker & Bounces / Rotation & Risk Flags /
// Monthly Cash Flow / Stock Market Activity / Investment Activity /
// Cash-Out Pattern Findings / Banking Behaviour / Transaction Details) from
// the object returned by analyzeBankStatement() in bankBehaviour.js. No
// API — pure client-side.
// Uses exceljs (not xlsx/SheetJS) so real cell colors, fonts and borders
// can be written, not just number formats.
import ExcelJS from 'exceljs';

const inr = n => Number(n) || 0;
const round2 = n => Math.round(n * 100) / 100;
const CUR = '₹#,##0.00';
const PCT = '0.0%';
const FONT = 'Arial';

const TITLE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC00000' } };
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E5597' } };
const THIN = { style: 'thin' };
const THIN_BORDER = { top: THIN, bottom: THIN, left: THIN, right: THIN };

// Per-confidence-tier row fill for the Cash-Out Pattern Findings sheet - no
// conditional formatting exists elsewhere in this file to reuse, so this
// follows the same flat "pick a fill color" approach the title/header rows
// already use above, just applied per-row instead of per-sheet-band.
const CONFIDENCE_FILL = {
  HIGH: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8CBCB' } },
  MEDIUM: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE8B2' } },
  LOW: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } },
};

// Wraps a worksheet with row-adding helpers so every sheet applies the same
// title / section-header / column-header / data styling consistently.
function sheetHelpers(ws, numCols) {
  const bandRow = (values, { size, color, fill }) => {
    const row = ws.addRow(values);
    for (let c = 1; c <= numCols; c++) {
      const cell = row.getCell(c);
      cell.font = { name: FONT, size, bold: true, color: { argb: color } };
      cell.fill = fill;
      cell.border = THIN_BORDER;
    }
    return row;
  };
  return {
    title: (text) => bandRow([text], { size: 13, color: 'FFFFFFFF', fill: TITLE_FILL }),
    header: (values) => bandRow(Array.isArray(values) ? values : [values], { size: 10, color: 'FFFFFFFF', fill: HEADER_FILL }),
    data: (values, { fmts = {}, bold = [], fill } = {}) => {
      const row = ws.addRow(values);
      values.forEach((_, i) => {
        const c = i + 1;
        const cell = row.getCell(c);
        cell.font = { name: FONT, size: 9, bold: bold.includes(c) };
        if (fmts[c]) cell.numFmt = fmts[c];
        if (fill) cell.fill = fill;
      });
      return row;
    },
    blank: () => ws.addRow([]),
  };
}

export function buildBsaWorkbook(result, cibilData) {
  const sm = result.summary || {};
  const ca = result.credit_assessment || {};
  const wb = new ExcelJS.Workbook();

  // ── Sheet 1: Executive Summary ──────────────────────────────────────────
  const salaryRows = (result.positive_signals || []).filter(p => p.type === 'REGULAR_SALARY');
  const avgSalary = salaryRows.length ? Math.round(salaryRows.reduce((s, r) => s + inr(r.amount), 0) / salaryRows.length) : ca.estimated_monthly_income || 0;

  const colWidths1 = [26, 18, 26, 18];
  const ws1 = wb.addWorksheet('Executive Summary');
  ws1.columns = colWidths1.map(w => ({ width: w }));
  const s1 = sheetHelpers(ws1, colWidths1.length);
  s1.title(`BANK STATEMENT ANALYSIS — ${sm.account_holder || 'UNKNOWN'}`);
  s1.data([`${sm.bank_name || ''} | A/c ${sm.account_number || ''} | Period: ${sm.statement_period || ''}`]);
  s1.blank();
  s1.header('KEY ACCOUNT METRICS');
  s1.header(['Metric', 'Value', 'Metric', 'Value']);
  s1.data(['Opening Balance', sm.opening_balance || 0, 'Closing Balance', sm.closing_balance || 0], { fmts: { 2: CUR, 4: CUR }, bold: [2, 4] });
  s1.data(['Total Deposits', sm.total_credits || 0, 'Total Withdrawals', sm.total_debits || 0], { fmts: { 2: CUR, 4: CUR }, bold: [2, 4] });
  const cws = result.cash_withdrawal_summary || {};
  s1.data(['Cash Withdrawals (Count / Total)', `${cws.total_count || 0} / Rs.${inr(cws.total_amount).toLocaleString('en-IN')}`, 'Avg Withdrawal Amount', inr(cws.average_amount)], { fmts: { 4: CUR }, bold: [2, 4] });
  s1.data(['Net Cash Flow', (sm.total_credits || 0) - (sm.total_debits || 0), 'Avg Monthly Balance', sm.average_monthly_balance || 0], { fmts: { 2: CUR, 4: CUR }, bold: [2, 4] });
  s1.data(['No. of Salary Credits', salaryRows.length, 'Avg Monthly Salary', avgSalary], { fmts: { 4: CUR }, bold: [2, 4] });
  s1.data(['Employer / Income Source', ca.employer_name || 'Not clearly identified', 'Salary Date (Modal)', ca.salary_date || 'N/A'], { bold: [2, 4] });
  s1.data(['Total Known EMI Obligation', ca.total_emi_burden || 0, 'FOIR (EMI/Income)', (ca.foir_estimate || 0) / 100], { fmts: { 2: CUR, 4: PCT }, bold: [2, 4] });
  s1.data(['Overall Risk', ca.overall_risk || '', 'Recommendation', ca.recommendation || ''], { bold: [2, 4] });
  s1.blank();
  s1.header('ANALYST NOTES');
  s1.data([ca.summary_notes || '']);
  s1.blank();
  s1.header('MONTHLY SALARY CREDITS');
  s1.header(['Date', 'Amount', 'Description']);
  salaryRows.forEach(r => s1.data([r.date, inr(r.amount), r.description], { fmts: { 2: CUR } }));
  s1.blank();

  const secondaryIncome = result.secondary_income || [];
  if (secondaryIncome.length) {
    s1.header('SECONDARY INCOME SOURCES');
    s1.header(['Source', 'Occurrences', 'Avg Amount', 'Consistency (CV)', 'First Seen', 'Last Seen']);
    secondaryIncome.forEach(s => s1.data([s.source, s.count, inr(s.mean), s.cv, s.first_seen, s.last_seen], { fmts: { 3: CUR } }));
    s1.blank();
  }

  // Irregular credits - everything left over once salary, secondary
  // income, broker/MF activity, wallet top-ups and lender disbursals have
  // all claimed their own credits. Informational only - listed, never
  // summed into any income figure, since nothing here has been
  // established as recurring.
  const irregularCredits = result.irregular_credits || [];
  if (irregularCredits.length) {
    s1.header('IRREGULAR / UNCLASSIFIED CREDITS (INFORMATIONAL - NOT INCLUDED IN INCOME)');
    s1.header(['Date', 'Amount', 'Description']);
    irregularCredits.forEach(c => s1.data([c.date, inr(c.amount), c.description], { fmts: { 2: CUR } }));
  }

  // ── Sheet 2: EMI Tracker & Bounces ──────────────────────────────────────
  const emis = result.emi_obligations || [];
  const ecs = result.ecs_returns || [];
  const ccObligations = result.credit_card_obligations || [];
  const colWidths2 = [22, 22, 12, 14, 14, 14, 14, 14, 30, 20];
  const ws2 = wb.addWorksheet('EMI Tracker & Bounces');
  ws2.columns = colWidths2.map(w => ({ width: w }));
  const s2 = sheetHelpers(ws2, colWidths2.length);
  s2.title(`EMI TRACKER & BOUNCE ANALYSIS — ${sm.account_holder || ''}`);
  s2.blank();

  const loanTypeSubtotals = {};
  emis.forEach(e => {
    const lt = e.loan_type || 'PERSONAL';
    if (!loanTypeSubtotals[lt]) loanTypeSubtotals[lt] = { loan_type: lt, count: 0, total_monthly: 0 };
    loanTypeSubtotals[lt].count += 1;
    loanTypeSubtotals[lt].total_monthly += inr(e.amount);
  });
  if (Object.keys(loanTypeSubtotals).length) {
    s2.header('OBLIGATION SUBTOTAL BY LOAN TYPE');
    s2.header(['Loan Type', 'Obligation Count', 'Total Monthly Amount', '', '', '', '', '', '']);
    Object.values(loanTypeSubtotals).forEach(r => s2.data([r.loan_type, r.count, round2(r.total_monthly)], { fmts: { 3: CUR } }));
    s2.blank();
  }

  s2.header('EMI / LOAN OBLIGATIONS OBSERVED');
  s2.header(['#', 'Party / Lender', 'Type', 'Loan Type', 'Monthly EMI', 'Count', 'First Seen', 'Last Seen']);
  emis.forEach((e, i) => s2.data([i + 1, e.party, e.type, e.loan_type, inr(e.amount), e.count, e.first_seen, e.last_seen], { fmts: { 5: CUR } }));
  s2.blank();

  const grid = result.emi_payment_grid || [];
  if (grid.length) {
    s2.header('MONTHLY PAYMENT GRID — PAID / MISSED');
    s2.header(['Lender / Party', 'Monthly Amt', 'Paid', 'Missed', 'Month-by-Month']);
    grid.forEach(ob => {
      const gridStr = (ob.monthly_grid || []).map(g => `${g.month}:${g.status === 'PAID' ? '✓' : '✗'}`).join('  ');
      s2.data([ob.party, inr(ob.amount), ob.paid_count, ob.missed_count, gridStr], { fmts: { 2: CUR } });
    });
    s2.blank();
  }

  // Recurring credit-card bill payments (via CRED/PayZapp/etc. or a
  // PAVC/"credit card" narration) - a distinct obligation type from EMI,
  // kept in its own section here rather than folded into the EMI list
  // above so it can't double-count against a debit that already appears
  // there (see detectCreditCardObligations' own comment for why the two
  // lists don't naturally overlap in the first place).
  if (ccObligations.length) {
    s2.header('CREDIT CARD OBLIGATIONS (RECURRING BILL PAYMENTS)');
    s2.header(['Party / App', 'Avg Monthly Amount', 'Count', 'First Seen', 'Last Seen']);
    ccObligations.forEach(c => s2.data([c.party, inr(c.average_monthly_amount), c.count, c.first_seen, c.last_seen], { fmts: { 2: CUR } }));
    s2.blank();
  }

  s2.header('BOUNCE DETAIL — ECS / NACH / CHEQUE RETURNS');
  s2.header(['Party', 'Type', 'Return Date', 'Return Amount', 'Balance Before', 'Balance After', 'Charge Date', 'Charge Amount', 'Charge Description', 'Bounce Type']);
  // INFERRED_DATE_DRIFT rows (detectEmiDateDrift() in bankBehaviour.js) are
  // NOT explicit, bank-reported returns - only a same-obligation debit
  // landing later than its usual day, with no RETURN/BOUNCE/charge text
  // anywhere in the statement. Shaded the same MEDIUM-confidence amber as
  // the Cash-Out Pattern Findings sheet uses, so this reads as "worth
  // review" rather than "confirmed", consistent everywhere in this
  // workbook, not just in the Bounce Type column text.
  ecs.forEach(r => s2.data(
    [r.party, r.return_type, r.return_date, inr(r.return_amount), r.balance_before ?? '', r.balance_after ?? '', r.charge_date, inr(r.charge_amount), r.charge_description, r.bounce_type || 'CONFIRMED'],
    { fmts: { 4: CUR, 5: CUR, 6: CUR, 8: CUR }, fill: r.bounce_type === 'INFERRED_DATE_DRIFT' ? CONFIDENCE_FILL.MEDIUM : undefined }
  ));
  s2.blank();
  s2.data([`TOTAL BOUNCES: ${ecs.filter(r => r.return_date).length}`]);

  // ── Sheet 3: Rotation & Risk Flags ──────────────────────────────────────
  const rot = (result.cc_card_rotation && result.cc_card_rotation.transactions) || [];
  const selfXfer = (result.frequent_transfers || []);
  const flags = result.risk_flags || [];
  const colWidths3 = [24, 8, 22, 16, 40, 14];
  const ws3 = wb.addWorksheet('Rotation & Risk Flags');
  ws3.columns = colWidths3.map(w => ({ width: w }));
  const s3 = sheetHelpers(ws3, colWidths3.length);
  s3.title(`CREDIT CARD ROTATION & RISK ANALYSIS — ${sm.account_holder || ''}`);
  s3.blank();
  s3.header('POS / AGGREGATOR SETTLEMENT CREDITS (CARD-TO-CASH INDICATOR)');
  s3.header(['Vendor', 'Date', 'Amount', 'Description']);
  rot.forEach(t => s3.data([t.vendor, t.date, inr(t.amount), t.description], { fmts: { 3: CUR } }));
  s3.blank();
  s3.header('SELF / FREQUENT TRANSFER PATTERN');
  s3.header(['Beneficiary', 'Self?', 'Transfer Count', 'Total Amount', 'First Date', 'Last Date']);
  selfXfer.forEach(t => s3.data([t.beneficiary, t.is_self ? 'YES' : 'NO', t.transfer_count, inr(t.total_amount), t.first_date, t.last_date], { fmts: { 4: CUR } }));
  s3.blank();

  const cashDep = result.cash_deposits || {};
  if (cashDep.detected) {
    s3.header('UNEXPLAINED CASH DEPOSITS');
    s3.header(['Date', 'Amount', 'Description']);
    (cashDep.transactions || []).forEach(t => s3.data([t.date, inr(t.amount), t.description], { fmts: { 2: CUR } }));
    s3.blank();
  }

  const circular = result.circular_transactions || [];
  if (circular.length) {
    s3.header('CIRCULAR / ROUND-TRIP TRANSACTIONS (POSSIBLE TURNOVER INFLATION)');
    s3.header(['Party', 'Round-Trips', 'Total Out', 'Total In', 'Out Date', 'In Date']);
    circular.forEach(c => {
      const firstPair = c.pairs[0] || {};
      s3.data([c.party, c.round_trip_count, inr(c.total_debit), inr(c.total_credit), firstPair.out_date, firstPair.in_date], { fmts: { 3: CUR, 4: CUR } });
    });
    s3.blank();
  }

  s3.header('CONSOLIDATED RISK FLAGS');
  s3.header(['#', 'Type', 'Severity', 'Date', 'Description', 'Amount']);
  flags.forEach((f, i) => s3.data([i + 1, f.type, f.severity, f.date, f.description, inr(f.amount)], { fmts: { 6: CUR } }));

  // ── Sheet 4: Monthly Cash Flow ───────────────────────────────────────────
  const mc = result.monthly_cashflow || [];
  const colWidths4 = [12, 16, 16, 18, 16, 14];
  const ws4 = wb.addWorksheet('Monthly Cash Flow');
  ws4.columns = colWidths4.map(w => ({ width: w }));
  const s4 = sheetHelpers(ws4, colWidths4.length);
  s4.title(`MONTHLY CASH FLOW SUMMARY — ${sm.account_holder || ''}`);
  s4.blank();
  s4.header(['Month', 'Total Credit', 'Total Debit', 'Closing Balance', 'Minimum Balance', 'Bounce Count']);
  mc.forEach(m => s4.data([m.month, inr(m.total_credit), inr(m.total_debit), inr(m.closing_balance), inr(m.minimum_balance), m.bounce_count], { fmts: { 2: CUR, 3: CUR, 4: CUR, 5: CUR } }));

  // ── Sheet 5: Stock Market Activity ──────────────────────────────────────
  const stk = result.stock_market_activity || {};
  const colWidths5 = [18, 14, 14, 14, 12, 40];
  const ws5 = wb.addWorksheet('Stock Market Activity');
  ws5.columns = colWidths5.map(w => ({ width: w }));
  const s5 = sheetHelpers(ws5, colWidths5.length);
  s5.title(`STOCK MARKET / BROKER ACTIVITY — ${sm.account_holder || ''}`);
  s5.blank();
  s5.data(['Detected', stk.detected ? 'YES' : 'NO']);
  s5.data(['Transaction Count', stk.transaction_count || 0]);
  s5.data(['Total Invested', inr(stk.total_invested)], { fmts: { 2: CUR } });
  s5.data(['Total Withdrawn', inr(stk.total_withdrawn)], { fmts: { 2: CUR } });
  s5.data(['Brokers Seen', (stk.brokers_seen || []).join(', ')]);
  s5.blank();

  const subTypeSummary = stk.sub_type_summary || [];
  if (subTypeSummary.length) {
    s5.header('ACTIVITY BREAKDOWN BY TYPE');
    s5.header(['Type', 'Transaction Count', 'Total Amount', '', '', '']);
    subTypeSummary.forEach(r => s5.data([r.sub_type, r.transaction_count, inr(r.total_amount)], { fmts: { 3: CUR } }));
    s5.blank();
  }

  s5.header('TRANSACTIONS');
  s5.header(['Broker', 'Type', 'Date', 'Amount', 'Direction', 'Description']);
  (stk.transactions || []).forEach(t => s5.data([t.broker, t.sub_type, t.date, inr(t.amount), t.direction, t.description], { fmts: { 4: CUR } }));

  // ── Sheet 6: Investment Activity ─────────────────────────────────────────
  // Reuses stock_market_activity (same source as Sheet 5) but adds a
  // running cash-flow column. Deliberately labeled "net cash flow to/from
  // trading accounts" everywhere, never "profit/loss" - a bank statement
  // only shows money crossing the account boundary, never what the broker
  // did with it, so it cannot prove P&L.
  const colWidths6b = [18, 14, 14, 14, 12, 40, 20];
  const ws6b = wb.addWorksheet('Investment Activity');
  ws6b.columns = colWidths6b.map(w => ({ width: w }));
  const s6b = sheetHelpers(ws6b, colWidths6b.length);
  s6b.title(`INVESTMENT ACTIVITY — ${sm.account_holder || ''}`);
  s6b.blank();
  s6b.data(['Note: "Net Cash Flow" below is money moved to/from trading accounts as seen on this bank statement - NOT trading profit or loss, which a bank statement cannot prove.']);
  s6b.blank();
  s6b.header('BROKER / SUB-TYPE SUMMARY');
  s6b.header(['Type', 'Transaction Count', 'Total Amount', '', '', '', '']);
  (stk.sub_type_summary || []).forEach(r => s6b.data([r.sub_type, r.transaction_count, inr(r.total_amount)], { fmts: { 3: CUR } }));
  s6b.blank();
  s6b.header('TRANSACTIONS — NET CASH FLOW TO/FROM TRADING ACCOUNTS');
  s6b.header(['Broker', 'Type', 'Date', 'Amount', 'Direction', 'Description', 'Running Net Cash Flow']);
  let investmentRunningNet = 0;
  (stk.transactions || []).forEach(t => {
    const amt = inr(t.amount);
    investmentRunningNet += t.direction === 'DEBIT' ? amt : -amt;
    s6b.data([t.broker, t.sub_type, t.date, amt, t.direction, t.description, round2(investmentRunningNet)], { fmts: { 4: CUR, 7: CUR } });
  });

  // Mutual fund / SIP activity - same "net cash flow, not P&L" framing as
  // the trading section above.
  const mf = result.mutual_fund_activity || {};
  if (mf.detected) {
    s6b.blank();
    s6b.header('MUTUAL FUND / SIP ACTIVITY');
    s6b.data(['Total Invested', inr(mf.total_invested), 'Total Redeemed', inr(mf.total_redeemed)], { fmts: { 2: CUR, 4: CUR }, bold: [2, 4] });
    s6b.data(['Platforms Seen', (mf.platforms_seen || []).join(', ')]);
    s6b.blank();
    if ((mf.sip_obligations || []).length) {
      s6b.header('RECURRING SIP OBLIGATIONS');
      s6b.header(['Platform', 'Monthly Amount', 'Count', 'First Seen', 'Last Seen', '', '']);
      mf.sip_obligations.forEach(s => s6b.data([s.platform, inr(s.amount), s.count, s.first_seen, s.last_seen], { fmts: { 2: CUR } }));
      s6b.blank();
    }
    s6b.header('MUTUAL FUND TRANSACTIONS');
    s6b.header(['Platform', 'Type', 'Date', 'Amount', 'Direction', 'Description', '']);
    let mfRunningNet = 0;
    (mf.transactions || []).forEach(t => {
      const amt = inr(t.amount);
      mfRunningNet += t.direction === 'DEBIT' ? amt : -amt;
      s6b.data([t.platform, t.sub_type, t.date, amt, t.direction, t.description, round2(mfRunningNet)], { fmts: { 4: CUR, 7: CUR } });
    });
  }

  // ── Sheet 7: Cash-Out Pattern Findings ───────────────────────────────────
  const cashoutFindings = result.cashout_patterns || [];
  const colWidths7 = [26, 12, 40, 12, 60];
  const ws7 = wb.addWorksheet('Cash-Out Pattern Findings');
  ws7.columns = colWidths7.map(w => ({ width: w }));
  const s7 = sheetHelpers(ws7, colWidths7.length);
  s7.title(`CARD-TO-BANK CASH-OUT PATTERN FINDINGS — ${sm.account_holder || ''}`);
  s7.blank();
  s7.data(['HIGH = strong signal (shaded red). MEDIUM = worth review (shaded amber). LOW/INFORMATIONAL = plausible normal liquidity rotation, not a risk signal on its own (shaded grey) - excluded from risk_flags/overall_risk.']);
  s7.blank();
  s7.header('FINDINGS');
  s7.header(['Pattern Type', 'Confidence', 'Transaction(s)', 'Gap (Days)', 'Notes']);
  cashoutFindings.forEach(f => {
    const txnSummary = (f.transactions || []).map(t => `${t.date}: Rs.${inr(t.amount).toLocaleString('en-IN')} — ${t.description}`).join(' | ');
    s7.data([f.pattern_type, f.confidence, txnSummary, f.gap_days, f.notes], { fill: CONFIDENCE_FILL[f.confidence] });
  });
  if (!cashoutFindings.length) s7.data(['No card-to-bank cash-out patterns detected in this statement.']);

  // ── Sheet 8: Banking Behaviour ───────────────────────────────────────────
  // Kept as its own sheet rather than folded into Rotation & Risk Flags
  // (already 4 sections deep) - low-balance-day tracking and withdrawal
  // frequency are a distinct "thin buffer" underwriting signal, not a
  // rotation/fraud pattern.
  const bb = result.banking_behaviour || {};
  const colWidths8 = [16, 16, 30, 16, 16, 16];
  const ws8 = wb.addWorksheet('Banking Behaviour');
  ws8.columns = colWidths8.map(w => ({ width: w }));
  const s8 = sheetHelpers(ws8, colWidths8.length);
  s8.title(`BANKING BEHAVIOUR — ${sm.account_holder || ''}`);
  s8.blank();

  s8.header('LOW-BALANCE DAYS BY THRESHOLD');
  s8.header(['Threshold', 'Day Count', 'Longest Consecutive Streak', '', '', '']);
  (bb.low_balance_days || []).forEach(t => s8.data([inr(t.threshold), t.count, t.longest_streak], { fmts: { 1: CUR } }));
  s8.blank();

  (bb.low_balance_days || []).forEach(t => {
    if (!t.days.length) return;
    s8.header(`DAYS BELOW Rs.${t.threshold.toLocaleString('en-IN')}`);
    s8.header(['Date', 'Balance', '', '', '', '']);
    t.days.forEach(d => s8.data([d.date, inr(d.balance)], { fmts: { 2: CUR } }));
    s8.blank();
  });

  s8.header('MONTHLY ATM / CASH WITHDRAWALS');
  s8.header(['Month', 'Withdrawal Count', 'Total Amount', 'Frequent Withdrawal Month?', '', '']);
  (bb.frequent_withdrawals || []).forEach(m => s8.data(
    [m.label, m.count, inr(m.total), m.frequent_withdrawal_month ? 'YES' : 'NO'],
    { fmts: { 3: CUR }, fill: m.frequent_withdrawal_month ? CONFIDENCE_FILL.MEDIUM : undefined }
  ));

  // ── Sheet 9: Transaction Details ─────────────────────────────────────────
  // The raw, un-summarized transaction list (all_transactions), one row per
  // transaction - every other sheet is a rolled-up view of a subset; this
  // is the mechanical full listing that was always implied but never
  // actually built as its own tab. Includes the entity column (partyKey())
  // alongside the category/flag every transaction already carries.
  const allTxns = result.all_transactions || [];
  const colWidths9 = [12, 40, 22, 14, 14, 14, 14, 10];
  const ws9 = wb.addWorksheet('Transaction Details');
  ws9.columns = colWidths9.map(w => ({ width: w }));
  const s9 = sheetHelpers(ws9, colWidths9.length);
  s9.title(`TRANSACTION DETAILS — ${sm.account_holder || ''}`);
  s9.blank();
  s9.header(['Date', 'Description', 'Entity', 'Debit', 'Credit', 'Balance', 'Category', 'Flag']);
  allTxns.forEach(t => s9.data(
    [t.date, t.description, t.entity, inr(t.debit), inr(t.credit), inr(t.balance), t.category, t.flag],
    { fmts: { 4: CUR, 5: CUR, 6: CUR } }
  ));

  // ── Sheet 10: CIBIL Reconciliation (optional — only if CIBIL data was passed in) ──
  if (cibilData && (cibilData.reconciliation || cibilData.pipeline)) {
    const recon = cibilData.reconciliation || {};
    const pipe = cibilData.pipeline || {};
    const colWidths6 = [26, 16, 26, 16, 44, 40];
    const ws6 = wb.addWorksheet('CIBIL Reconciliation');
    ws6.columns = colWidths6.map(w => ({ width: w }));
    const s6 = sheetHelpers(ws6, colWidths6.length);
    s6.title(`CIBIL vs BANK STATEMENT RECONCILIATION — ${sm.account_holder || ''}`);
    s6.blank();

    s6.header('RECONCILIATION SUMMARY');
    s6.header(['Metric', 'Value', 'Metric', 'Value']);
    s6.data(['Obligations Matched', (recon.matched || []).length, 'CIBIL Obligations Unmatched', (recon.unmatched_cibil || []).length], { bold: [2, 4] });
    s6.data(['Bank EMIs Unmatched to CIBIL', (recon.unmatched_bank || []).length, '', ''], { bold: [2] });
    s6.blank();

    if ((recon.reconciliation_flags || []).length) {
      s6.header('RECONCILIATION RISK FLAGS');
      s6.header(['Type', 'Severity', 'Lender / Party', 'Monthly Obligation', 'Description', 'Possible Causes']);
      recon.reconciliation_flags.forEach(f => s6.data(
        [f.type, f.severity, f.lender, inr(f.monthly_obligation), f.description, (f.possible_causes || []).join(' / ')],
        { fmts: { 4: CUR } }
      ));
      s6.blank();
    }

    if ((recon.matched || []).length) {
      s6.header('MATCHED OBLIGATIONS (CIBIL ↔ BANK STATEMENT)');
      s6.header(['CIBIL Lender', 'CIBIL Monthly Obl.', 'Bank Party', 'Bank Monthly Amt', 'Bank Occurrences', '']);
      recon.matched.forEach(m => s6.data([m.cibil.bankName, inr(m.cibil.monthlyObl), m.bank.party, inr(m.bank.amount), m.bank.count, ''], { fmts: { 2: CUR, 4: CUR } }));
      s6.blank();
    }

    if (pipe && Object.keys(pipe).length) {
      s6.header('DEBT-STRESS PIPELINE');
      s6.header(['Stage', 'Result', '', '', '', '']);
      s6.data(['1. Multiple Small Loan Detection', `${pipe.small_loan_detection?.count || 0} small/short-tenure loan(s) active`]);
      s6.data(['2. Loan Stacking Analysis', `${pipe.loan_stacking?.total_active_obligations || 0} active obligation(s) total (${pipe.loan_stacking?.small_loan_count || 0} small loans) — ${pipe.loan_stacking?.flagged ? 'FLAGGED' : 'not flagged'}`]);
      s6.data(['3. Short-Term Borrowing Frequency', pipe.borrowing_frequency?.avg_days_between_new_loans != null ? `Avg ${pipe.borrowing_frequency.avg_days_between_new_loans} days between new small loans — ${pipe.borrowing_frequency.flagged ? 'FLAGGED' : 'not flagged'}` : 'Not enough data']);
      s6.data(['4. Debt Cycle Detection', `${(pipe.debt_cycle_events || []).length} rollover/refinance event(s) detected`]);
      s6.data(['5. Total Obligation Calculation', inr(pipe.total_monthly_obligation)], { fmts: { 2: CUR } });
      s6.data(['   FOIR incl. unreported obligations', `${pipe.foir_including_unreported || 0}%`]);
      s6.data(['6. Liquidity Stress Score (0-100)', pipe.liquidity_stress_score ?? '']);
      s6.data(['7. Underwriting Risk / Recommendation', `${pipe.underwriting_risk || ''} — ${pipe.recommendation || ''}`], { bold: [1, 2] });
      s6.blank();

      if ((pipe.debt_cycle_events || []).length) {
        s6.header('DEBT CYCLE EVENTS (POSSIBLE ROLLOVER / REFINANCE)');
        s6.header(['Closed Lender', 'Closed Date', 'New Lender', 'New Open Date', 'Gap (Days)', '']);
        pipe.debt_cycle_events.forEach(e => s6.data([e.closed_lender, e.closed_date, e.new_lender, e.new_open_date, e.gap_days, '']));
      }
    }
  }

  return wb;
}

export async function downloadBsaWorkbook(result, cibilData) {
  const wb = buildBsaWorkbook(result, cibilData);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const name = (result.summary?.account_holder || 'statement').replace(/\s+/g, '_');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `BSA_${name}_${Date.now()}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
