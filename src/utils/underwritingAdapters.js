// Underwriting Desk adapters — turn saved CIBIL / bank-statement rows into the
// PROFILE shape documented at the top of underwritingEngine.js. Pure functions,
// no React / Supabase. Everything returned here is only a pre-fill: the
// Underwriting Desk screen keeps every value editable before it runs the engine.
//
// Inputs (as saved today):
//   customer_cibil_data row  — { report_date: 'YYYY-MM-DD' (upload date; the parsed
//     report date itself isn't stored), accounts: [{ bankName, loanType, status,
//     openDate, closedDate, tenure, emi, outstanding, overdue, dpds, lateMonths,
//     settlement, writtenOff, ... }] } — all values are strings. Dates arrive as
//     'DD/MM/YYYY' or 'DD Mon YYYY'; dpds as '30' or '90+ days (×4)'; lateMonths as
//     'Feb 2025 (30d)' or '2025 OCT (90+)'.
//   customer_bank_statement_data row — { bank_name, result } where result is the
//     analyzeBankStatement() output (summary, credit_assessment, ecs_returns, ...).

const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

const toNum = (v) => Number(String(v ?? '').replace(/[^0-9.]/g, '')) || 0;
const hasAmount = (v) => toNum(v) > 0;

export function parseDate(s) {
  const str = String(s || '').trim();
  if (!str) return null;
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = str.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return new Date(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2] - 1, +m[1]);
  m = str.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s,-]+(\d{2,4})$/);
  if (m && MONTHS[m[2].toUpperCase()] != null) {
    return new Date(m[3].length === 2 ? 2000 + +m[3] : +m[3], MONTHS[m[2].toUpperCase()], +m[1]);
  }
  return null;
}

// 'Feb 2025 (30d)' | '2025 OCT (90+)' -> first of that month
function parseLateMonth(s) {
  const str = String(s || '').toUpperCase();
  let m = str.match(/\b([A-Z]{3})[A-Z]*\s+(\d{4})\b/);
  if (m && MONTHS[m[1]] != null) return new Date(+m[2], MONTHS[m[1]], 1);
  m = str.match(/\b(\d{4})\s+([A-Z]{3})/);
  if (m && MONTHS[m[2]] != null) return new Date(+m[1], MONTHS[m[2]], 1);
  return null;
}

export function wholeMonthsBetween(from, to) {
  if (!from || !to) return null;
  let n = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) n -= 1;
  return Math.max(0, n);
}

const monthsAgo = (date, months) => new Date(date.getFullYear(), date.getMonth() - months, date.getDate());

export function mapProductType(loanType) {
  const t = String(loanType || '').toLowerCase();
  if (t.includes('kisan')) return 'KCC';
  if (t.includes('loan on credit card')) return 'CARD_LOAN';
  if (t.includes('credit card')) return 'CARD';
  if (t.includes('gold')) return 'GOLD';
  if (t.includes('overdraft')) return 'OD';
  if (t.includes('housing') || t.includes('home') || t.includes('property')) return 'HL';
  if (t.includes('auto') || t.includes('car') || t.includes('two-wheeler') || t.includes('two wheeler')) return 'AUTO';
  if (t.includes('consumer')) return 'CONSUMER';
  if (t.includes('education')) return 'EDU';
  if (t.includes('business') && /\bsecured\b/.test(t)) return 'BL_SECURED';
  if (t.includes('business')) return 'BL';
  if (t.includes('personal')) return 'PL';
  return 'OTHER';
}

const SETTLED_RE = /settled|written|\bw\/?o\b|\(wo\)/i;

function isSettledOrWO(acc) {
  return SETTLED_RE.test(acc.status || '') || hasAmount(acc.settlement) || hasAmount(acc.writtenOff);
}

function isOpen(acc) {
  if (String(acc.closedDate || '').trim()) return false;
  return !/closed/i.test(acc.status || '') && !isSettledOrWO(acc);
}

function hasDpd(acc) {
  const d = String(acc.dpds || '').trim();
  return (parseInt(d, 10) || 0) > 0 || /days|\+/.test(d) || (acc.lateMonths || []).length > 0;
}

// An account "has payment history" when the parser produced any DPD reading for it.
const hasPaymentHistory = (acc) => String(acc.dpds ?? '').trim() !== '' || (acc.lateMonths || []).length > 0;

function emiProgress(acc, reportDate) {
  const tenure = toNum(acc.tenure) || null;
  let paid = wholeMonthsBetween(parseDate(acc.openDate), reportDate);
  if (paid != null && tenure) paid = Math.min(paid, tenure);
  return { emisPaid: paid, emisRemaining: tenure && paid != null ? Math.max(0, tenure - paid) : null };
}

// Calendar day of an enquiry date. Freshly parsed reports carry Date objects;
// saved rows carry them JSON-serialised (an IST midnight becomes the previous
// day in UTC), so timestamps are read back as local dates, never by slicing
// the ISO string. Plain 'DD/MM/YYYY' / 'DD Mon YYYY' go through parseDate.
function enquiryDay(value) {
  if (value instanceof Date) return isNaN(value) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const s = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  return parseDate(s);
}

const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Every enquiry in the CIBIL enquiry table (CIBIL.com and PaisaBazaar both save
// them as enquiries.details: { institution, product, date }), all product
// types — the engine filters by its own bank and product. Older saved rows
// without `details` fall back to the 90-day list. Undated entries are skipped.
// daysAgo counts to `today`, not the report date: the own-bank 30-day wait is
// about when the case is logged in.
export function buildEnquiryList(enquiries, today = new Date()) {
  if (!enquiries) return [];
  const source = Array.isArray(enquiries.details) ? enquiries.details : (enquiries.items90 || []);
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const out = [];
  for (const e of source) {
    const day = enquiryDay(e && e.date);
    if (!day) continue;
    out.push({
      lender: String(e.institution || e.lender || '').trim(),
      product: String(e.product || '').trim(),
      date: isoDay(day),
      daysAgo: Math.max(0, Math.round((base - day) / 86400000)),
    });
  }
  return out;
}

// Personal-loan enquiries in the last 90 days, from the enquiry list (same filter
// the engine applies for ICICI's count_types). null when there's no list, in
// which case the engine falls back to credit.enquiries90d.
export function plEnquiries90d(enquiryList) {
  if (!Array.isArray(enquiryList) || enquiryList.length === 0) return null;
  return enquiryList.filter((e) => e.daysAgo != null && e.daysAgo <= 90 && /PERSONAL\s*LOAN/i.test(e.product || '')).length;
}

// Own-bank enquiries per active policy, for the Credit flags summary chips:
// [{ bankId, short: 'HDFC', daysAgo }]. Mirrors the engine's
// own_bank_enquiry_block test (word-start match on own_bank_match, product
// filter, within the block's days); the engine stays the one that rejects.
export function ownBankEnquiries(enquiryList, policies) {
  const words = (s) => ' ' + String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const out = [];
  for (const { bank_id: bankId, policy } of policies || []) {
    const blk = policy && policy.own_bank_enquiry_block;
    if (!blk) continue;
    const own = policy.own_bank_match || [String(policy.bank || '').split(' ')[0]];
    const hits = (enquiryList || []).filter((e) => e.daysAgo != null && e.daysAgo <= blk.days
      && own.some((m) => words(e.lender).includes(words(m)))
      && (!blk.products || blk.products.some((p) => words(e.product).includes(words(p)))));
    if (hits.length) out.push({ bankId, short: own[0], daysAgo: Math.min(...hits.map((e) => e.daysAgo)) });
  }
  return out;
}

// CIBIL row -> { loans, cards, credit (CIBIL-derived flags only), reportDate }
export function cibilToProfile(cibilRow, { today = new Date() } = {}) {
  const accounts = (cibilRow && cibilRow.accounts) || [];
  const reportDate = parseDate(cibilRow && cibilRow.report_date) || new Date();
  const loans = [];
  const cards = [];

  accounts.forEach((acc, i) => {
    if (!isOpen(acc)) return;
    const type = mapProductType(acc.loanType);
    if (type === 'CARD') {
      // Stable id per card: the engine's card plan and per-card lines refer to it.
      cards.push({ id: `C${i}`, issuer: acc.bankName || '', outstanding: toNum(acc.outstanding), paidBeforeLoginWithProof: 0, action: 'keep' });
      return;
    }
    loans.push({
      id: `L${i}`,
      lender: acc.bankName || '',
      lenderType: null,
      productType: type,
      sourceType: acc.loanType || '',
      openDate: acc.openDate || '',     // display only (Open date column)
      loanAmount: toNum(acc.loanAmount), // display only (credit-team sheet column); the engine doesn't use it
      outstanding: toNum(acc.outstanding),
      emi: toNum(acc.emi),
      ...emiProgress(acc, reportDate),
      isJoint: false,
      coApplicantIncomeOk: null,
      // 'auto' (engine decides) | 'bt' (always BT if the bank allows) | 'obligate' (never BT)
      treatment: 'auto',
      hlEmiPaidBy: null, // HL only: 'applicant' | 'co_applicant'
      closedBeforeLoginWithProof: false,
      odStatus: null, // NBFC / Kotak PL: null (not confirmed) | 'term' | 'od_emi' | 'od_no_emi'
      foreclosureLetter: false,
    });
  });

  const settled = accounts.filter(isSettledOrWO);
  const settleDates = settled.map((a) => parseDate(a.closedDate)).filter(Boolean);
  const latestSettlement = settleDates.length ? new Date(Math.max(...settleDates)) : null;
  let fresh = { exists: false, emisPaid: 0 };
  if (latestSettlement) {
    accounts
      .filter((a) => !isSettledOrWO(a) && mapProductType(a.loanType) !== 'CARD')
      .forEach((a) => {
        const opened = parseDate(a.openDate);
        if (!opened || opened <= latestSettlement) return;
        const paid = emiProgress(a, reportDate).emisPaid || 0;
        if (!fresh.exists || paid > fresh.emisPaid) fresh = { exists: true, emisPaid: paid };
      });
  }

  const withHistory = accounts.filter(hasPaymentHistory);
  const yearAgo = monthsAgo(reportDate, 12);
  // Late in the 12 months before the report date: a dated late month in that
  // window, or an amount overdue right now on an open account. A late payment
  // with no month attached counts when the account is open or closed within
  // the window (the DPD can't be older than the account's last activity).
  const lateInLast12m = (a) => {
    if ((a.lateMonths || []).some((lm) => { const d = parseLateMonth(lm); return d && d >= yearAgo; })) return true;
    if (isOpen(a) && hasAmount(a.overdue)) return true;
    if (!hasDpd(a) || (a.lateMonths || []).some((lm) => parseLateMonth(lm))) return false;
    const closed = parseDate(a.closedDate);
    return !closed || closed >= yearAgo;
  };
  const overdueLast12m = accounts.some(lateInLast12m);
  // One entry per account with any DPD (or a current overdue amount). Product
  // types match the obligations table; credit cards are 'CC'.
  // monthsAgo: whole months from the most recent dated late month to today
  // (0 when an amount is overdue right now; null when no late month is dated).
  // count12m: distinct dated late months in the 12 months before today.
  const todayYearAgo = monthsAgo(today, 12);
  const dpdAccounts = accounts
    .filter((a) => hasDpd(a) || (isOpen(a) && hasAmount(a.overdue)))
    .map((a) => {
      const type = mapProductType(a.loanType);
      const dates = (a.lateMonths || []).map(parseLateMonth).filter(Boolean);
      const latest = dates.length ? new Date(Math.max(...dates)) : null;
      const overdueNow = isOpen(a) && hasAmount(a.overdue);
      const count12m = new Set(dates.filter((d) => d >= todayYearAgo).map((d) => d.getTime())).size;
      return {
        lender: String(a.bankName || '').trim(),
        productType: type === 'CARD' ? 'CC' : type,
        inLast12m: lateInLast12m(a),
        monthsAgo: overdueNow ? 0 : latest ? wholeMonthsBetween(latest, today) : null,
        count12m,
      };
    });
  // Non-card accounts ever reported (open or closed) — 0 marks a first-time borrower.
  const loanAccountsEver = accounts.filter((a) => mapProductType(a.loanType) !== 'CARD').length;

  const enquiryList = buildEnquiryList(cibilRow && cibilRow.enquiries, today);

  // Member names, de-duplicated; the engine matches each bank's own name against these.
  const lenderNames = (list) => [...new Set(list.map((a) => String(a.bankName || '').trim()).filter(Boolean))];
  const enquiries90 = cibilRow && cibilRow.enquiries && cibilRow.enquiries.last90;

  const credit = {
    settlementsOrWO: settled.length,
    settledLenders: lenderNames(settled),
    dpdLenders: lenderNames(accounts.filter(hasDpd)),
    dpdAccounts,
    loanAccountsEver,
    enquiryList,
    enquiries90d: enquiries90 == null || enquiries90 === '' || !Number.isFinite(Number(enquiries90)) ? null : Number(enquiries90),
    // hdfc* kept for back-compat: the engine still reads them for HDFC.
    hdfcSettlementOrWO: settled.some((a) => /HDFC/i.test(a.bankName || '')),
    freshLoanAfterSettlement: fresh,
    hdfcBadHistory: accounts.some((a) => /HDFC/i.test(a.bankName || '') && hasDpd(a)),
    dpdAcrossAllTrades: withHistory.length > 0 && withHistory.every(hasDpd),
    overdueLast12m,
  };

  const score = cibilRow ? Number(cibilRow.cibil_score) : NaN;
  return { loans, cards, credit, cibilScore: score > 0 ? score : null, reportDate, latestSettlement };
}

const CARD_OR_GOLD_RE = /CARD|\bCC\b|GOLD|MUTHOOT|MANAPPURAM/i;

// Bank-statement row -> { bouncesLast12m, bouncesOnlyCardOrGold, salaryAccountBank, salaryFromStatement }
export function bankStatementToProfile(bsaRow, today = new Date()) {
  const result = (bsaRow && bsaRow.result) || {};
  const yearAgo = monthsAgo(today, 12);
  // Only real returns: an entry with no return_date is an unmatched bounce-charge
  // line, and INFERRED_DATE_DRIFT entries are unverified guesses that
  // bankBehaviour.js itself keeps out of its bounce count.
  const bounces = (result.ecs_returns || []).filter((r) => {
    if (!r.return_date || r.bounce_type === 'INFERRED_DATE_DRIFT') return false;
    const d = parseDate(r.return_date);
    return !d || d >= yearAgo; // unparseable date: count it rather than silently drop it
  });

  const salaryDetected = (result.positive_signals || []).some((s) => s.type === 'REGULAR_SALARY');
  const income = result.credit_assessment && result.credit_assessment.estimated_monthly_income;

  return {
    bouncesLast12m: bounces.length,
    bouncesOnlyCardOrGold: bounces.length > 0 && bounces.every((r) => CARD_OR_GOLD_RE.test(`${r.party || ''} ${r.charge_description || ''}`)),
    salaryAccountBank: (result.summary && result.summary.bank_name) || (bsaRow && bsaRow.bank_name) || '',
    salaryFromStatement: salaryDetected && income > 0 ? Math.round(income) : null,
  };
}

// ---- Obligations table: Treatment dropdown + per-loan status ----

// Dropdown value for a loan: 'auto' | 'bt' | 'obligate' | 'closed'.
export function treatmentChoice(loan) {
  if (loan.closedBeforeLoginWithProof) return 'closed';
  return ['bt', 'obligate'].includes(loan.treatment) ? loan.treatment : 'auto';
}

// Loan patch for a dropdown choice. "Closed before login (proof)" is its own
// engine flag and leaves treatment on 'auto'.
export function treatmentPatch(choice) {
  if (choice === 'closed') return { closedBeforeLoginWithProof: true, treatment: 'auto' };
  return { closedBeforeLoginWithProof: false, treatment: ['bt', 'obligate'].includes(choice) ? choice : 'auto' };
}

// HL row controls. "Joint · co-applicant income OK" sets both flags; unticking
// it also clears who pays the EMI, which only applies to a joint loan.
export function hlJointPatch(checked) {
  return checked
    ? { isJoint: true, coApplicantIncomeOk: true }
    : { isJoint: false, coApplicantIncomeOk: false, hlEmiPaidBy: null };
}

// "EMI paid by" never changes isJoint (the select is only enabled on joint loans).
export function hlPayerPatch(value) {
  return { hlEmiPaidBy: value === 'applicant' || value === 'co_applicant' ? value : null };
}

// ---- Company category per bank ----
// byBank: { query, banks: { bankId: { candidates, pick, category, variantIdx } } }

// Engine company object for one bank, or null when no company search has run yet.
// A category the agent typed counts as confirmed; blank / spaces counts as missing.
export function companyForBank(byBank, bankId) {
  if (!byBank) return null;
  const c = byBank.banks[bankId];
  if (!c || !c.pick) return { name: byBank.query, category: null, categoryConfirmed: true, incorporationYear: null };
  const variants = Array.isArray(c.pick.variants) && c.pick.variants.length ? c.pick.variants : null;
  if (variants && c.variantIdx == null) {
    return { name: c.pick.company_name, category: c.category, categoryConfirmed: false, incorporationYear: c.pick.incorporation_year };
  }
  const v = variants ? variants[c.variantIdx] : null;
  return {
    name: c.pick.company_name,
    category: String(c.category || '').trim() || null,
    categoryConfirmed: true,
    incorporationYear: (v ? v.incorporation_year : c.pick.incorporation_year) ?? null,
  };
}

// The engine treats a company as 'UNLISTED' for a bank whose policy has
// company.unlisted_rules when no category was found (or typed) for that bank.
export const isUnlistedFor = (policy, company) => !!(policy?.company?.unlisted_rules && company && !company.category);

// First incorporation year any bank's company search returned (pick or its variants), else null.
export function searchedIncorporationYear(byBank) {
  for (const c of Object.values((byBank && byBank.banks) || {})) {
    const p = c && c.pick;
    if (!p) continue;
    const yr = p.incorporation_year ?? (p.variants || []).map((v) => v.incorporation_year).find((y) => y != null);
    if (yr != null && Number.isFinite(Number(yr))) return Number(yr);
  }
  return null;
}

// Bank row patch for a typed category. With no match, the searched name stands in
// as the company so the typed category is used (e.g. CAT A for Kotak).
export function typedCategoryPatch(bank, query, value) {
  return { category: value, pick: (bank && bank.pick) || { company_name: query, category: value } };
}

// Banks with no company list (policy.company.manual_category, e.g. Kotak): the agent
// picks the banker-confirmed category from policy.company.categories.
// -> { bankId: ['CAT A', 'CAT B', ...] }
export function manualCategoryBanks(policies) {
  const out = {};
  (policies || []).forEach((p) => {
    const c = p.policy?.company;
    if (c?.manual_category) out[p.bank_id] = Array.isArray(c.categories) ? c.categories : [];
  });
  return out;
}

// Engine company object for a manual-category bank. Needs no company search: the
// engine only uses the category, and the agent's pick counts as confirmed.
export function manualCompany(byBank, value) {
  return { name: (byBank && byBank.query) || null, category: String(value || '').trim() || null, categoryConfirmed: true, incorporationYear: null };
}

// ---- Bank scorecard (e.g. Kotak Super green / Green / Yellow / Red) ----

// Draft patch for the result-card select; '' (—) clears that bank's value.
export function scorecardPatch(scorecardByBank, bankId, value) {
  return { scorecardByBank: { ...(scorecardByBank || {}), [bankId]: value || null } };
}

// Colour for a scorecard value: a rejected value is always red.
export function scorecardTone(scorecard, value) {
  if (!value) return null;
  const v = String(value).toLowerCase();
  if ((scorecard?.reject || []).some((r) => String(r).toLowerCase() === v) || /red/.test(v)) return 'red';
  if (/green/.test(v)) return 'green';
  if (/yellow|amber/.test(v)) return 'amber';
  return null;
}

// ---- Subject-to-closure plan ----

// The engine also words each closure item as a note; the card shows its own line instead.
export const isClosureNote = (note) => /^Subject to closure/.test(note);

// Closure items to show: none when the bank declines for a permanent reason
// (only a wait, eligibleAfterWait, keeps the figures).
export function visibleClosurePlan(result) {
  if (!result || !Array.isArray(result.closurePlan)) return [];
  if (result.status === 'NOT_ELIGIBLE' && !result.eligibleAfterWait) return [];
  return result.closurePlan;
}

// "Subject to closure of KRAZYBEE (₹40,000) → eligible ₹22.5L (+₹1.2L), in hand ₹7.1L after paying it"
export function closureLineText(c, { fmtAmount, fmtLakh }) {
  return `Subject to closure of ${c.lender} (${fmtAmount(c.outstanding)}) → eligible ${fmtLakh(c.newEligible)} (+${fmtLakh(c.gain)}), in hand ${fmtLakh(c.netInHandAfterClosing)} after paying it`;
}

// ---- Credit card actions ----

// Action dropdown -> card patch. 'paid' starts at the full outstanding (the agent
// can lower it); 'close' is a plan to clear the whole card before login.
export function cardActionPatch(card, action) {
  if (action === 'paid') return { action: 'paid', paidBeforeLoginWithProof: card.outstanding || 0 };
  if (action === 'close') return { action: 'close', paidBeforeLoginWithProof: card.outstanding || 0 };
  return { action: 'keep', paidBeforeLoginWithProof: 0 };
}

// Outstanding edit that keeps a 'close' plan covering the whole card.
export function cardOutstandingPatch(card, outstanding) {
  return card.action === 'close' ? { outstanding, paidBeforeLoginWithProof: outstanding } : { outstanding };
}

// This card's share of the bank's counted CC obligation (null when cards aren't counted).
export function cardCountedShare(cardCalc, cardId) {
  if (!cardCalc || !(cardCalc.amount > 0) || !(cardCalc.total > 0)) return null;
  const line = (cardCalc.lines || []).find((l) => l.id === cardId);
  return line ? cardCalc.amount * (line.remaining / cardCalc.total) : null;
}

// Loans with no balance and no EMI (closed / zero-balance CIBIL accounts) are
// tucked into a collapsed group; rows the agent added stay in the main list.
export const isZeroBalanceLoan = (l) => !l.manual && !(l.outstanding > 0) && !(l.emi > 0);

// Same test the engine uses for out.missingEmi.
export const loanNeedsEmi = (l) => (l.outstanding || 0) > 0 && !(l.emi > 0) && !l.closedBeforeLoginWithProof
  && !['GOLD', 'OD', 'KCC'].includes(l.productType);

// Reason column for one loan in the selected bank's best scenario: 'BT' when the
// best scenario transfers it, otherwise the engine's obligation rule
// ("Full EMI", "Only 2 EMIs left — not obligated", …). '' when that bank has no calculation.
// True when a scenario closes this loan through the bank's own top-up
// (scenario.topUp is the subset of scenario.bt done that way).
export const isTopUp = (scenario, loanId) => !!(scenario && Array.isArray(scenario.topUp) && scenario.topUp.includes(loanId));

// Own-bank loans the scenario closes through a top-up read 'Top-up' instead of 'BT'.
export function loanReason(loan, line, best) {
  if (!line) return loan.closedBeforeLoginWithProof ? 'Closed before login (proof)' : '';
  if (best && best.bt.includes(loan.id)) return isTopUp(best, loan.id) ? 'Top-up' : 'BT';
  return line.obligation.rule;
}

// ---- Direct uploads (Underwriting Desk "New customer" / override) ----

// customer_cibil_data row in exactly the shape CibilParser.js save() writes.
// `parsed` is parseCibil()/parsePaisaBazaar() output plus `format`.
export function buildCibilRow(parsed, { leadId = null, fallbackName = '', userId = null, now = new Date() } = {}) {
  return {
    lead_id: leadId,
    customer_name: parsed.customerName || fallbackName,
    cibil_score: parsed.score,
    report_source: parsed.format,
    report_date: now.toISOString().split('T')[0],
    accounts: parsed.accounts,
    enquiries: parsed.enquiries,
    uploaded_by: userId,
    uploaded_at: now.toISOString(),
  };
}

// customer_bank_statement_data row in exactly the shape SaveBsaToLead.js writes.
export function buildBsaRow(result, { leadId = null, fallbackName = '', userId = null, now = new Date() } = {}) {
  return {
    lead_id: leadId,
    account_holder: result.summary?.account_holder || fallbackName,
    bank_name: result.summary?.bank_name || '',
    statement_period: result.summary?.statement_period || '',
    result,
    uploaded_by: userId,
    uploaded_at: now.toISOString(),
  };
}

// pdf.js PasswordException (code 1 = needs password, 2 = wrong password), or
// CibilParser's own NEEDS_PASSWORD / WRONG_PASSWORD errors -> 'needs' | 'wrong' | null.
export function passwordErrorKind(err) {
  if (!err) return null;
  if (err.message === 'WRONG_PASSWORD' || (err.name === 'PasswordException' && err.code === 2)) return 'wrong';
  if (err.message === 'NEEDS_PASSWORD' || err.name === 'PasswordException') return 'needs';
  return null;
}

export const normalizeMobile = (m) => String(m || '').replace(/\D/g, '').slice(-10);

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "Payslip for the month of March 2026" / "Pay Period: Mar-26" -> 'Mar 2026'.
// A month next to "month / period / payslip for" wins over the first month-year
// in the text (which is often a date of joining); then the file name; then null.
const MONTH_YEAR = String.raw`\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,'.-]*((?:19|20)\d{2}|\d{2})\b`;
export function detectPayslipMonth(text, fileName = '') {
  const anchored = new RegExp(String.raw`(?:month|period|pay\s*slip\s*for|salary\s*slip\s*for)[^A-Za-z0-9]{0,30}(?:of\s+)?` + MONTH_YEAR, 'i');
  const plain = new RegExp(MONTH_YEAR, 'i');
  // File names use '_' as a separator, which \b treats as part of a word.
  const attempts = [[text, anchored], [text, plain], [String(fileName || '').replace(/_+/g, ' '), plain]];
  for (const [src, re] of attempts) {
    const m = String(src || '').match(re);
    if (m) {
      const mon = MONTH_NAMES.find((x) => x.toLowerCase() === m[1].toLowerCase());
      const year = m[2].length === 2 ? `20${m[2]}` : m[2];
      return `${mon} ${year}`;
    }
  }
  return null;
}

// ---- Employer name from a payslip ----

// Field labels that usually sit next to the employer name on the same printed
// row ("Company Name: X  Employee Name: Y") — the value is cut where one starts.
const NEXT_FIELD_RE = /\s+(?:Employee|Emp(?:\.|loyee)?\s*(?:Name|Code|No|ID)\b|Name\b|Designation|Department|Dept\b|Address|Month|Pay\s*Period|Period|Date|PAN\b|UAN\b|PF\s*No|ESI|Location|Branch|Bank|A\/c|Account|Grade|DOJ|Days|Pay\s*slip|Salary\s*slip)/i;
// Labels with two or more words may be followed by the value directly; the bare
// "Employer" / "Organisation" need a ':' or '-' so "Employer PF 1,800" in a
// deductions table is never read as a company.
const EMPLOYER_LABELS = [
  [String.raw`Name\s+of\s+(?:the\s+)?Employer`, false],
  [String.raw`Employer(?:'s)?\s+Name`, false],
  [String.raw`Company\s*Name`, false],
  [String.raw`Organi[sz]ation\s+Name`, false],
  [String.raw`Employer`, true],
  [String.raw`Organi[sz]ation`, true],
];
const COMPANY_WORD_RE = /\b(?:PVT|PRIVATE|LTD|LIMITED|LLP|INC|CORPORATION|CORP|TECHNOLOGIES|SOLUTIONS|SERVICES)\b\.?/gi;
const NOT_COMPANY_LINE_RE = /pay\s*slip|salary\s*slip|pay\s*statement|for\s+the\s+month|month\s+of|^page\b|earnings|deductions|confidential/i;
const ADDRESS_RE = /\b\d{6}\b|\b(?:road|rd|street|floor|nagar|sector|plot|building|bldg|tower|lane|marg|phase|block|near|opp|colony|layout|cross|district|taluk|village|pincode)\b/i;

const tidy = (s) => String(s || '').replace(/\s+/g, ' ').replace(/^[\s:,.\-–]+|[\s:,\-–]+$/g, '').trim();

// Cut a run-on value after its last company word ("ACME PVT LTD Payslip for …" -> "ACME PVT LTD").
function trimAfterCompanyWord(s) {
  const matches = [...s.matchAll(COMPANY_WORD_RE)];
  if (!matches.length) return s;
  const last = matches[matches.length - 1];
  return s.slice(0, last.index + last[0].length);
}

function cleanEmployerValue(v) {
  let s = tidy(v);
  const next = s.match(NEXT_FIELD_RE);
  if (next) s = s.slice(0, next.index);
  s = tidy(trimAfterCompanyWord(s));
  if (s.length < 3 || /^\d/.test(s) || !/[A-Za-z]{2,}/.test(s)) return null;
  if (/^(?:PF|NPS|ESI|ESIC|Contribution|Share)\b/i.test(s)) return null;
  return s;
}

function labelledValue(source, label, needsSeparator) {
  const sep = needsSeparator ? String.raw`\s*[:\-–]\s*` : String.raw`\s*[:\-–]?\s*`;
  const m = String(source || '').match(new RegExp(String.raw`\b${label}${sep}([A-Za-z][^\n]{2,150})`, 'i'));
  return m ? cleanEmployerValue(m[1]) : null;
}

function employeeNameOf(text) {
  const m = String(text || '').match(/\b(?:Employee\s*Name|Emp\.?\s*Name|Name\s+of\s+(?:the\s+)?Employee)\s*[:\-–]?\s*([A-Za-z][A-Za-z .]{2,60})/i);
  if (!m) return null;
  let s = tidy(m[1]);
  const next = s.match(NEXT_FIELD_RE);
  if (next) s = tidy(s.slice(0, next.index));
  return s.length >= 3 ? s : null;
}

// `text` = whole payslip text; `headerLines` = page-1 text lines, top first.
// Returns the employer name as printed (tidied), or null (e.g. logo-only header).
// Person name for comparison: uppercase, relation part ("S/O RAMESH") and
// titles (MR / MS / DR / SHRI …) dropped.
const PERSON_TITLES = new Set(['MR', 'MRS', 'MS', 'MISS', 'DR', 'SHRI', 'SMT', 'SRI']);
export function normalizePersonName(s) {
  const noRelation = String(s || '').toUpperCase().replace(/\b[SDWC]\s*\/\s*O\b.*$/, '');
  return normalizeName(noRelation).split(' ').filter((t) => t && !PERSON_TITLES.has(t)).join(' ');
}

// True when a header line is a person's name rather than the employer: every
// word of the line belongs to the name ("RAVI KUMAR" vs "RAVI KUMAR SHARMA"),
// or the line contains the full name and carries no company word.
function lineIsPerson(line, names) {
  const lineNorm = normalizePersonName(line);
  if (!lineNorm) return false;
  const lineTokens = lineNorm.split(' ');
  const hasCompanyWord = new RegExp(COMPANY_WORD_RE.source, 'i').test(line);
  return names.some((name) => {
    const nameTokens = new Set(name.split(' '));
    if (lineTokens.every((t) => nameTokens.has(t))) return true;
    return !hasCompanyWord && ` ${lineNorm} `.includes(` ${name} `);
  });
}

// knownNames: the lead's name / CIBIL customer name, also skipped as header lines.
export function extractEmployerName(text, headerLines = [], { knownNames = [] } = {}) {
  const lines = (headerLines || []).map(tidy).filter(Boolean);
  for (const [label, needsSep] of EMPLOYER_LABELS) {
    for (const src of [...lines, text]) {
      const v = labelledValue(src, label, needsSep);
      if (v) return v;
    }
  }

  const personNames = [employeeNameOf(text), ...knownNames].map(normalizePersonName).filter((n) => n.length >= 3);
  const isEmployee = (l) => lineIsPerson(l, personNames);
  const top = lines.slice(0, 5);

  // A top line carrying a company word (PVT / LTD / LLP / …).
  for (const l of top) {
    if (isEmployee(l) || !l.match(COMPANY_WORD_RE)) continue;
    const s = tidy(trimAfterCompanyWord(l));
    if (s.length >= 3 && !NOT_COMPANY_LINE_RE.test(s)) return s;
  }
  // Otherwise the first heading-like line that isn't a title, address, number or label.
  for (const l of top) {
    if (NOT_COMPANY_LINE_RE.test(l) || ADDRESS_RE.test(l) || isEmployee(l) || /[:]/.test(l)) continue;
    if ((l.match(/\d/g) || []).length > 3 || !/[A-Za-z]{3,}/.test(l)) continue;
    return l;
  }
  return null;
}

const normalizeName = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// Search variants for the company list: as printed, abbreviations expanded,
// and the short PVT LTD / LTD form.
export function companyNameVariants(raw) {
  const upper = String(raw || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const stripEnd = (s) => s.replace(/[.,;:\-–]+$/, '').trim();
  const base = stripEnd(upper);
  if (!base) return [];
  // Expanded from `upper`, before the trailing dot is stripped, so a final "Co." still expands.
  const expanded = stripEnd(upper
    .replace(/\(\s*INDIA\s*\)/g, ' INDIA ')
    .replace(/&/g, ' AND ')
    .replace(/\bPVT\b\.?/g, 'PRIVATE')
    .replace(/\bLTD\b\.?/g, 'LIMITED')
    .replace(/\bCO\./g, 'COMPANY')
    .replace(/\s+/g, ' ')
    .trim());
  const short = expanded
    .replace(/\bPRIVATE LIMITED\b/g, 'PVT LTD')
    .replace(/\bLIMITED\b/g, 'LTD')
    .replace(/\bPRIVATE\b/g, 'PVT');
  return [...new Set([base, expanded, short])];
}

const monthKey = (label) => {
  const m = String(label || '').match(/^([A-Za-z]{3}) (\d{4})$/);
  const idx = m ? MONTH_NAMES.indexOf(m[1]) : -1;
  return idx >= 0 ? +m[2] * 12 + idx : -1;
};

// Employer to use across several payslips: the latest month's (upload order
// breaks ties / missing months). `differs` = more than one distinct employer.
export function summarizeEmployer(payslips) {
  const named = (payslips || []).filter((p) => p.employerName);
  if (!named.length) return { employerName: null, differs: false };
  const latest = named.reduce((best, p) => (monthKey(p.month) >= monthKey(best.month) ? p : best));
  const distinct = new Set(named.map((p) => companyNameVariants(p.employerName).pop()));
  return { employerName: latest.employerName, differs: distinct.size > 1 };
}

// [{ netPay }] -> average of the payslips that have a net pay figure (null if none).
export function averageNetPay(payslips) {
  const vals = (payslips || []).map((p) => p.netPay).filter((v) => v > 0);
  return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
}

// Combined pre-fill for the screen. Either row may be null. A payslip net pay,
// when given, takes priority over the bank-statement salary estimate.
export function buildProfileDraft(cibilRow, bsaRow, { payslipNetPay = null, today = new Date() } = {}) {
  const c = cibilToProfile(cibilRow, { today });
  const b = bankStatementToProfile(bsaRow);
  const fromPayslip = payslipNetPay > 0;
  return {
    netSalary: fromPayslip ? payslipNetPay : b.salaryFromStatement,
    netSalarySource: fromPayslip ? 'payslip' : b.salaryFromStatement ? 'bank_statement' : null,
    salaryAccountBank: b.salaryAccountBank,
    cibilScore: c.cibilScore,
    riskOverride: null,
    loans: c.loans,
    cards: c.cards,
    credit: {
      settledLenders: c.credit.settledLenders,
      dpdLenders: c.credit.dpdLenders,
      dpdAccounts: c.credit.dpdAccounts,
      loanAccountsEver: c.credit.loanAccountsEver,
      enquiryList: c.credit.enquiryList,
      enquiries90d: c.credit.enquiries90d,
      hdfcSettlementOrWO: c.credit.hdfcSettlementOrWO,
      hdfcBadHistory: c.credit.hdfcBadHistory,
      dpdAcrossAllTrades: c.credit.dpdAcrossAllTrades,
      settlementsOrWO: c.credit.settlementsOrWO,
      freshLoanAfterSettlement: c.credit.freshLoanAfterSettlement,
      bouncesLast12m: b.bouncesLast12m,
      overdueLast12m: c.credit.overdueLast12m,
      bouncesOnlyCardOrGold: b.bouncesOnlyCardOrGold,
    },
  };
}
