// Underwriting Desk adapters — turn saved CIBIL / bank-statement rows into the
// PROFILE shape documented at the top of underwritingEngine.js. Pure functions,
// no React / Supabase. Everything returned here is only a pre-fill: the
// Underwriting Desk screen keeps every value editable before it runs the engine.
//
// Inputs (as saved today):
//   customer_cibil_data row  — { report_date: 'YYYY-MM-DD' (upload date; the parsed
//     report date itself isn't stored), accounts: [{ bankName, loanType, status,
//     openDate, closedDate, tenure, emi, outstanding, overdue, dpds, lateMonths,
//     settlement, writtenOff, ownership (CIBIL.com: 'Individual' | 'Joint' | …), ... }] } — all values are strings. Dates arrive as
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

// Installments since disbursal, counted to today (not the report date). A first
// interest-only installment counts as one — IndusInd accepts it for BT after 3.
function emiProgress(acc, today) {
  const tenure = toNum(acc.tenure) || null;
  let paid = wholeMonthsBetween(parseDate(acc.openDate), today);
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

// Word-start match, same as the engine's isOwnBank: ' ' + name contains ' ' + one of the match words.
const words = (s) => ' ' + String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const ownMatch = (policy) => policy.own_bank_match || [String(policy.bank || '').split(' ')[0]];
const isOwnLender = (policy, lender) => ownMatch(policy).some((m) => words(lender).includes(words(m)));

// Short bank name for chips: "Axis Bank" -> "Axis", "L&T Finance" -> "L&T", "Yes Bank" stays "Yes Bank".
export function shortBankName(bank) {
  const parts = String(bank || '').trim().split(/\s+/);
  const first = parts[0] || '';
  return first.length <= 3 && first !== first.toUpperCase() && parts[1] ? `${first} ${parts[1]}` : first;
}

// Own-bank enquiries per active policy, for the Credit flags summary chips:
// [{ bankId, short: 'Axis', daysAgo }]. Mirrors the engine's
// own_bank_enquiry_block test (word-start match on own_bank_match, product
// filter, within the block's days); the engine stays the one that rejects.
export function ownBankEnquiries(enquiryList, policies) {
  const out = [];
  for (const { bank_id: bankId, policy } of policies || []) {
    const blk = policy && policy.own_bank_enquiry_block;
    if (!blk) continue;
    const hits = (enquiryList || []).filter((e) => e.daysAgo != null && e.daysAgo <= blk.days
      && isOwnLender(policy, e.lender)
      && (!blk.products || blk.products.some((p) => words(e.product).includes(words(p)))));
    if (hits.length) out.push({ bankId, short: shortBankName(policy.bank) || ownMatch(policy)[0], daysAgo: Math.min(...hits.map((e) => e.daysAgo)) });
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
      // limit / openDate: display only (the parser's loanAmount is the card's credit limit).
      cards.push({
        id: `C${i}`, issuer: acc.bankName || '', limit: toNum(acc.loanAmount), openDate: acc.openDate || '',
        outstanding: toNum(acc.outstanding), paidBeforeLoginWithProof: 0, action: 'keep',
      });
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
      ...emiProgress(acc, today),
      // CIBIL Ownership "Joint"; who pays the EMI / co-applicant income stay for the agent.
      isJoint: /\bjoint\b/i.test(acc.ownership || ''),
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
        const paid = emiProgress(a, today).emisPaid || 0;
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
  // Bureau depth (Yes Bank): sanctioned amounts of non-card loans, open or closed, that
  // ran 6+ months (open date -> closed date, or -> today while open). A closed loan
  // with no closed date can't be timed and is left out.
  const servedLoanAmount = accounts.reduce((sum, a) => {
    if (mapProductType(a.loanType) === 'CARD') return sum;
    const opened = parseDate(a.openDate);
    const end = isOpen(a) ? today : parseDate(a.closedDate);
    if (!opened || !end || wholeMonthsBetween(opened, end) < 6) return sum;
    return sum + toNum(a.loanAmount);
  }, 0);

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
    servedLoanAmount,
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
  // -1 = no credit history (NTC): kept, the engine prices and caps it.
  return { loans, cards, credit, cibilScore: score > 0 || score === -1 ? score : null, reportDate, latestSettlement };
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

// HL row controls. "Joint (in CIBIL)" sets isJoint only — co-applicant income stays
// for the agent to confirm. Unticking it clears the co-applicant income and who pays
// the EMI back to not set, as both only apply to a joint loan.
export function hlJointPatch(checked) {
  return checked
    ? { isJoint: true }
    : { isJoint: false, coApplicantIncomeOk: null, hlEmiPaidBy: null };
}

// "Co-applicant income OK" (enabled only on joint loans): ticked = true, unticked = false.
export function hlIncomeOkPatch(checked) {
  return { coApplicantIncomeOk: !!checked };
}

// "EMI paid by" never changes isJoint (the select is only enabled on joint loans).
const HL_PAYERS = ['applicant', 'co_applicant', 'both'];
export function hlPayerPatch(value) {
  return { hlEmiPaidBy: HL_PAYERS.includes(value) ? value : null };
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

// Banks whose company list isn't uploaded yet (policy has unlisted rules, no rows in
// company_categories, e.g. Chola): every company is Unlisted there until the agent picks
// the bank's category. Options from the policy's eligibility groups: CAT A–D, one
// Government option for the government names, then Unlisted (value '' = no category).
// counts: { bankId: number of company rows }; a bank not counted yet is left out.
const GOVT_RE = /GOVERNMENT|GOVT|PSU|MAHARATNA|NAVRATNA/i;
export function categoryPickOptions(policy) {
  const seen = new Set(); const cats = []; const govt = [];
  for (const g of Object.values(policy?.eligibility?.groups || {})) {
    for (const c of g.categories || []) {
      const key = words(c).trim().replace(/^CATEGORY /, 'CAT ');
      if (seen.has(key) || key === 'UNLISTED') continue;
      seen.add(key);
      (GOVT_RE.test(c) ? govt : cats).push(c);
    }
  }
  const out = [...cats].sort().map((c) => ({ value: c, label: c }));
  if (govt.length) {
    const rest = govt.slice(1).map((g) => g.replace(/\s+Government$/i, ''));
    out.push({ value: govt[0], label: rest.length ? `Government (${rest.join(' / ')})` : 'Government' });
  }
  if (policy?.company?.unlisted_rules) out.push({ value: '', label: 'Unlisted' });
  return out;
}
export function noCompanyListBanks(policies, counts) {
  const out = {};
  (policies || []).forEach((p) => {
    const c = p.policy?.company;
    if (c?.unlisted_rules && !c.manual_category && counts && counts[p.bank_id] === 0) out[p.bank_id] = categoryPickOptions(p.policy);
  });
  return out;
}

// Own house: Yes / No / Not asked -> profile.ownHouse true / false / undefined.
export const ownHouseChoice = (v) => (v === true ? 'yes' : v === false ? 'no' : '');
export const ownHousePatch = (choice) => ({ ownHouse: choice === 'yes' ? true : choice === 'no' ? false : undefined });

// Engine company object for a manual-category bank. Needs no company search: the
// engine only uses the category, and the agent's pick counts as confirmed.
export function manualCompany(byBank, value) {
  return { name: (byBank && byBank.query) || null, category: String(value || '').trim() || null, categoryConfirmed: true, incorporationYear: null };
}

// ---- Bank scorecard (e.g. Kotak Super green / Green / Yellow / Red) ----

// Draft patch for the result-card select; '' (—) clears that bank's value.
// Bureau depth tiers (policy.bureau_tier, e.g. Yes Bank). '' / null = Auto (engine computes it).
export const BUREAU_TIERS = [['super_thick', 'Super thick'], ['thick', 'Thick'], ['thin', 'Thin'], ['ntc', 'NTC']];
export const bureauTierLabel = (tier) => (BUREAU_TIERS.find(([k]) => k === tier) || [null, tier || '—'])[1];
export function bureauTierPatch(bureauTierByBank, bankId, value) {
  const v = BUREAU_TIERS.some(([k]) => k === value) ? value : null;
  return { bureauTierByBank: { ...(bureauTierByBank || {}), [bankId]: v } };
}

export function scorecardPatch(scorecardByBank, bankId, value) {
  return { scorecardByBank: { ...(scorecardByBank || {}), [bankId]: value || null } };
}

// Risk segment (policy.risk_segment, e.g. Poonawalla VL/L / Medium / High). The select shows
// the policy default until the agent picks; a value outside the list is stored as null (= default).
export function riskSegmentPatch(riskSegmentByBank, bankId, value, values) {
  const v = (values || []).includes(value) ? value : null;
  return { riskSegmentByBank: { ...(riskSegmentByBank || {}), [bankId]: v } };
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

// Closure items to show: none when the bank declines for a permanent reason.
// A wait (eligibleAfterWait) or a soft fail (no EMI room / BT more than
// eligibility — out.softFail) keeps them: closing a loan can fix those.
// ---- Result card summary, own-amount EMI, income reminders ----

// The method the card's summary strip shows: the one the engine picked (eligibleBy) — at every
// bank the lower of the best FOIR figure and the multiplier figure (best.eligibleAmount).
export function summaryMethod(best) {
  const methods = (best && best.methods) || [];
  if (!methods.length) return null;
  const method = methods.find((m) => m.key === best.eligibleBy) || methods[0];
  return { method };
}

// Card subtitle: "Lower of FOIR & multiplier" when the bank has a multiplier row, otherwise "FOIR".
export const hasMultiplierRow = (best) => !!(best && (best.methods || []).some((m) => m.key === 'multiplier' || m.key.startsWith('multiplier_')));
export const eligibilityRuleLabel = (best) => (hasMultiplierRow(best) ? 'Lower of FOIR & multiplier' : 'FOIR');

// HDFC good profile (best.upside = the FOIR figure when the multiplier is lower):
// "Good profile: up to ₹X (EMI ₹Y, 6 years) — confirm with HDFC"
export function upsideLine(best, bankLabel, fmt) {
  const u = best && best.upside;
  if (!u || !(u.amount > 0)) return null;
  const yrs = u.tenure ? `, ${Number((u.tenure / 12).toFixed(1))} years` : '';
  return `Good profile: up to ${fmt(u.amount)} (EMI ${fmt(u.emi)}${yrs}) — confirm with ${shortBankName(bankLabel)}`;
}

// Kotak: "… scorecard not picked — lowest band (Amber) used; pick the scorecard band" (shown amber, with the selector).
export const isLowBandNote = (n) => /scorecard not picked — lowest band/.test(n || '');

// "Customer wants ₹… for [tenure]": the bank's method tenures plus 1–4 years, shortest first.
export function emiTenureOptions(methods) {
  const set = new Set([12, 24, 36, 48, ...(methods || []).map((m) => m.tenure).filter((t) => t > 0)]);
  return [...set].sort((a, b) => a - b);
}

// Grey text after the "Customer wants" rate: "incl. +0.50% for 7 years / card / app-loan BT".
// rate = rateForAmount(…, result.rateAdjust, months); scenario = the best plan (its card / app-loan BT).
export function rateAddOnText(rate, adj, months, scenario, cibilScore) {
  if (!rate || !(rate.addOn > 0)) return null;
  const parts = [];
  if (adj && adj.tenureAdd && adj.tenureAdd[months] > 0) parts.push(months % 12 === 0 ? `${months / 12} years` : `${months} months`);
  if (scenario && ((scenario.btCards || []).length || (scenario.btApps || []).length)) parts.push('card / app-loan BT');
  if (cibilScore === 0 || cibilScore === -1) parts.push('no CIBIL score');
  return `incl. +${rate.addOn.toFixed(2)}%${parts.length ? ` for ${parts.join(' / ')}` : ''}`;
}

// What a loan's Treatment does at the bank in "Counted for" (line = that bank's obligations line).
export function treatmentNote(loan, line, bankLabel) {
  const t = treatmentChoice(loan);
  if (t === 'closed') return { tone: 'grey', text: 'Closed — EMI not counted' };
  if (t === 'obligate') return { tone: 'grey', text: 'Kept as obligation' };
  if (t === 'bt' && line && line.bt) {
    if (line.bt.ok && line.bt.topUp) return null;   // the row's "Top-up" chip says it (topUpLoanNote)
    return line.bt.ok ? { tone: 'green', text: 'BT' } : { tone: 'red', text: `Not taken in BT by ${bankLabel}: ${line.bt.why}` };
  }
  return null;
}

// Extra income a bank counts (out.incomeHints.accepts) that the agent has not entered yet.
const HINT_FIELDS = { rental: 'rentMonthly', bonus: 'bonusAnnualNet', quarterly: 'quarterlyIncentiveNet', monthly_incentive: 'monthlyIncentiveAvg6m', pension: 'pensionMonthly', consulting: 'consultingMonthly' };
export function openIncomeHints(hints, draft) {
  const oi = (draft && draft.otherIncome) || {};
  return ((hints && hints.accepts) || []).filter((a) => (a.key === 'co_applicant'
    ? !((draft && draft.coApplicantNetSalary) > 0)
    : !(oi[HINT_FIELDS[a.key]] > 0)));
}
const acceptText = (a) => (a.key === 'co_applicant' ? a.label : `${a.label} ${a.pct}%${a.capPct != null ? ` (up to ${a.capPct}% of salary)` : ''}`);

// Light-blue "can raise eligibility" box: { kind: 'needed' | 'gain', text } or null.
export function incomeHintText(result, bankLabel, draft, fmtAmount) {
  const h = result && result.incomeHints;
  const open = openIncomeHints(h, draft);
  if (!open.length) return null;
  const counts = `${bankLabel} counts: ${open.map(acceptText).join(' · ')}`;
  if (result.status === 'NOT_ELIGIBLE' && result.softFail && h.neededExtra > 0) {
    return { kind: 'needed', text: `About ${fmtAmount(h.neededExtra)}/month more counted income would make ${bankLabel} eligible. ${counts}.` };
  }
  if (result.status !== 'NOT_ELIGIBLE' && h.gainPer10k > 0) {
    return { kind: 'gain', text: `${counts}. Each ₹10,000/month of counted income adds about ${fmtAmount(h.gainPer10k)}.` };
  }
  return null;
}

// One line above the bank results: "… it can raise eligibility at N banks (and make M more banks eligible)."
export function incomeReminderText(hintKinds) {
  const raise = hintKinds.filter((k) => k === 'gain').length;
  const more = hintKinds.filter((k) => k === 'needed').length;
  if (!raise && !more) return null;
  const banks = (n) => `${n} bank${n === 1 ? '' : 's'}`;
  const moreBanks = (n) => `${n} more bank${n === 1 ? '' : 's'} eligible`;
  const tail = raise
    ? `it can raise eligibility at ${banks(raise)}${more ? ` (and make ${moreBanks(more)})` : ''}`
    : `it can make ${moreBanks(more)}`;
  return `Ask the customer about rent, bonus / incentives and co-applicant income — ${tail}.`;
}

// Bank results order: Eligible, Deviation, Can't log yet (recent own-bank enquiry),
// Needs input, Not eligible (errors last); inside a group the highest eligible amount
// first, then the highest in hand.
const STATUS_RANK = { ELIGIBLE: 0, DEVIATION: 1, NEEDS_INPUT: 3, NOT_ELIGIBLE: 4 };
export function rankResults(results) {
  const key = (r) => {
    const res = r.result;
    const best = res && res.best;
    return [
      r.error || !res ? 5 : res.eligibleAfterWait ? 2 : (STATUS_RANK[res.status] ?? 5),
      best && best.eligibleAmount != null ? best.eligibleAmount : -Infinity,
      best && best.netInHand != null ? best.netInHand : -Infinity,
    ];
  };
  const cmp = (x, y) => (x === y ? 0 : x > y ? 1 : -1);
  return (results || []).map((r, i) => ({ r, i, k: key(r) }))
    .sort((a, b) => cmp(a.k[0], b.k[0]) || cmp(b.k[1], a.k[1]) || cmp(b.k[2], a.k[2]) || a.i - b.i)
    .map((x) => x.r);
}

// Cards in display order: the agent's "Counted for" bank first, the rest by rank.
export function pickedFirst(ranked, bankId) {
  const picked = bankId && ranked.find((r) => r.bankId === bankId);
  return picked ? [picked, ...ranked.filter((r) => r !== picked)] : ranked;
}

// ---- Own-bank enquiry wait (engine: status NOT_ELIGIBLE + eligibleAfterWait + waitDays) ----
export const isWaitResult = (entry) => !!(entry && entry.result && entry.result.eligibleAfterWait);

// "Counted for: Auto (best bank)": the top-ranked bank that can be logged now —
// never one blocked by a recent own-bank enquiry. null when there is none.
export function autoBankEntry(ranked) {
  return (ranked || []).find((r) => r && r.result && !r.error && !isWaitResult(r)) || null;
}

// Date the bank can be logged: today + waitDays, as "dd Mon" (e.g. "03 Dec").
export function canLogFromDate(waitDays, today = new Date()) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + (Number(waitDays) || 0));
  return `${String(d.getDate()).padStart(2, '0')} ${MONTH_NAMES[d.getMonth()]}`;
}

// ---- "Ask the customer before logging" panel ----
// One row per question, only those that apply: some bank counts it and it isn't entered yet.
// entries: bank results ({ bankId, label, result }); dismissed: row ids the agent marked "Asked — no".
const ASK_GROUPS = [
  { id: 'bonus', keys: ['bonus', 'quarterly', 'monthly_incentive'], question: 'Bonus / incentives (monthly, quarterly, annual)?' },
  { id: 'rent', keys: ['rental'], question: 'Rent income (registered / notarised agreement)?' },
  { id: 'co_applicant', keys: ['co_applicant'], question: 'Co-applicant (spouse / parent) with income?', hint: 'Higher earner should be the applicant' },
];
const pctRange = (ps) => {
  const u = [...new Set(ps)].sort((a, b) => a - b);
  return u.length === 1 ? `${u[0]}%` : `${u[0]}–${u[u.length - 1]}%`;
};
const nBanks = (n) => `${n} bank${n === 1 ? '' : 's'}`;

export function askCustomerRows(entries, draft, fmtAmount, dismissed = []) {
  const skip = new Set(dismissed || []);
  const list = (entries || []).filter((e) => e && e.result && e.result.incomeHints);
  const rows = [];
  for (const g of ASK_GROUPS) {
    const banks = [];
    let gain = null; let needed = null; let field = null;
    for (const e of list) {
      const h = e.result.incomeHints;
      const open = openIncomeHints(h, draft).filter((a) => g.keys.includes(a.key));
      if (!open.length) continue;
      if (!field) field = g.id === 'co_applicant' ? 'coApplicantNetSalary' : HINT_FIELDS[open[0].key];
      banks.push({ bankId: e.bankId, label: e.label, pct: g.id === 'co_applicant' ? null : pctRange(open.map((a) => a.pct)) });
      const st = e.result.status;
      if (st !== 'NOT_ELIGIBLE' && h.gainPer10k > 0 && (!gain || h.gainPer10k > gain.amount)) gain = { amount: h.gainPer10k, label: e.label };
      if (st === 'NOT_ELIGIBLE' && e.result.softFail && h.neededExtra > 0 && (!needed || h.neededExtra < needed.amount)) needed = { amount: h.neededExtra, label: e.label };
    }
    if (!banks.length || skip.has(g.id)) continue;
    const impact = [
      gain && `each ₹10,000/month adds about ${fmtAmount(gain.amount)} at ${gain.label}`,
      needed && `${fmtAmount(needed.amount)}/month more makes ${needed.label} eligible`,
    ].filter(Boolean).join(' · ');
    rows.push({ id: g.id, question: g.question, hint: g.hint || null, banks, impact: impact || null, field });
  }
  // Home loan in the applicant's name only: is a co-applicant on it, paying the EMI?
  const hl = list.filter((e) => e.result.incomeHints.hlCoApplicant);
  if (hl.length && !skip.has('hl_co_applicant')) {
    const lenders = [...new Set(hl.flatMap((e) => e.result.incomeHints.hlCoApplicant.lenders || []))];
    const raised = hl.filter((e) => e.result.incomeHints.hlCoApplicant.gain > 0);
    const made = hl.filter((e) => e.result.incomeHints.hlCoApplicant.makesEligible);
    const impact = [
      raised.length && `Raises eligibility at ${nBanks(raised.length)} (up to ${fmtAmount(Math.max(...raised.map((e) => e.result.incomeHints.hlCoApplicant.gain)))})`,
      made.length && `makes ${nBanks(made.length)} eligible`,
    ].filter(Boolean).join(' · ');
    rows.push({
      id: 'hl_co_applicant',
      question: `Is there a co-applicant on the ${lenders.join(' / ') || 'home'} home loan who pays the EMI?`,
      hint: null,
      banks: hl.map((e) => ({ bankId: e.bankId, label: e.label, pct: null })),
      impact: impact || null,
      field: null,
    });
  }
  return rows;
}

// "Yes — co-applicant pays": the home loans the engine treats as applicant-only
// (same filter as its hlCoApplicant hint) become joint, EMI paid by the co-applicant,
// co-applicant income OK.
const isSoloHl = (l) => l.productType === 'HL' && !l.isJoint && !l.hlEmiPaidBy && !l.closedBeforeLoginWithProof && (l.emi || 0) > 0;
export function hlCoApplicantPaysPatch(loans) {
  return { loans: (loans || []).map((l) => (isSoloHl(l) ? { ...l, isJoint: true, hlEmiPaidBy: 'co_applicant', coApplicantIncomeOk: true } : l)) };
}

// Small chips under a bank card's summary strip.
export function bankAskChips(result, fmtAmount) {
  const h = result && result.incomeHints;
  if (!h) return [];
  const out = [];
  if ((h.accepts || []).some((a) => a.key === 'co_applicant')) out.push('Co-applicant income allowed');
  const hl = h.hlCoApplicant;
  if (hl && hl.gain > 0) out.push(`Joint HL: +${fmtAmount(hl.gain)}`);
  else if (hl && hl.makesEligible) out.push('Joint HL: makes eligible');
  return out;
}

// ---- Own-bank top-up ----
// Loan row: "Top-up" chip when the selected bank's best plan closes it through a top-up;
// otherwise the reason when it's an own-bank loan that can't be topped up yet (or at all).
// Treatment "BT" already shows its red reason line, Obligate / Closed need nothing.
export function topUpLoanNote(loan, line, best) {
  const t = treatmentChoice(loan);
  if (!line || !line.bt || t === 'closed' || t === 'obligate') return null;
  if (isTopUp(best, loan.id)) return { chip: 'Top-up' };
  if (t !== 'bt' && !line.bt.ok && /top.?up/i.test(line.bt.why || '')) return { text: line.bt.why };
  return null;
}

// Bank card grey note (balance_transfer.top_up_note, e.g. Kotak: rate same as the existing loan)
// when the customer has an open loan with that bank. The "(Gauri, 23 Nov 2026)" source tag is dropped.
export function ownBankTopUpNote(policy, loans) {
  const note = policy && policy.balance_transfer && policy.balance_transfer.top_up_note;
  if (!note) return null;
  const has = (loans || []).some((l) => !l.closedBeforeLoginWithProof && (l.outstanding || 0) > 0 && isOwnLender(policy, l.lender));
  return has ? note.replace(/\s*\([^()]*\d{4}\)/g, '').replace(/\s+/g, ' ').trim() : null;
}

// Loans in the selected bank's closure plan get Treatment "Closed before login (proof)" —
// the flag the engine itself uses to work out the plan, in both closure modes.
export function closeLoansPatch(loans, ids) {
  const set = new Set(ids || []);
  return { loans: (loans || []).map((l) => (set.has(l.id) ? { ...l, ...treatmentPatch('closed') } : l)) };
}

// "Apply suggestion — close N loan(s)": simBest is the bank's best scenario with every
// suggested loan closed. In hand = its net in hand less what paying those loans off costs.
// null (no button) when nothing would be left in hand.
export function closeAllSuggestion(plan, simBest) {
  if (!plan || !plan.length || !simBest) return null;
  const amount = plan.reduce((t, c) => t + (c.outstanding || 0), 0);
  const inHand = (simBest.netInHand || 0) - amount;
  if (!(inHand > 0)) return null;
  return { ids: plan.map((c) => c.id), amount, newEligible: simBest.eligibleAmount ?? null, inHand };
}

export function visibleClosurePlan(result) {
  if (!result || !Array.isArray(result.closurePlan)) return [];
  if (result.status === 'NOT_ELIGIBLE' && !result.eligibleAfterWait && !result.softFail) return [];
  return result.closurePlan;
}

// "Subject to closure of KRAZYBEE (₹40,000) → eligible ₹22.5L (+₹1.2L), in hand ₹7.1L after paying it"
// HDFC (mode 'before_login'): "Close before login (own funds): KRAZYBEE (₹40,000) → eligible …"
export function closureLineText(c, { fmtAmount, fmtLakh }) {
  const head = c.mode === 'before_login'
    ? `Close before login (own funds): ${c.lender} (${fmtAmount(c.outstanding)})`
    : `Subject to closure of ${c.lender} (${fmtAmount(c.outstanding)})`;
  return `${head} → eligible ${fmtLakh(c.newEligible)} (+${fmtLakh(c.gain)}), in hand ${fmtLakh(c.netInHandAfterClosing)} after paying it`;
}

// ---- Credit card actions ----

// Action dropdown -> card patch. 'paid' starts at the full outstanding (the agent
// can lower it); 'close' is a plan to clear the whole card before login.
export function cardActionPatch(card, action) {
  if (action === 'paid') return { action: 'paid', paidBeforeLoginWithProof: card.outstanding || 0 };
  if (action === 'close') return { action: 'close', paidBeforeLoginWithProof: card.outstanding || 0 };
  return { action: 'keep', paidBeforeLoginWithProof: 0 };
}

// Card Treatment dropdown: Auto / BT / Keep as obligation (profile.cards[i].treatment) plus the
// paid / close actions. Saved "Keep open" (action 'keep', no treatment) shows as Auto.
export const CARD_TREATMENTS = [
  ['auto', 'Auto (bank decides)'], ['bt', 'BT'], ['obligate', 'Keep as obligation (no BT)'],
  ['paid', 'Paid before login (proof)'], ['close', 'Close before login (suggested)'],
];
export function cardTreatmentChoice(card) {
  const action = card.action || ((card.paidBeforeLoginWithProof || 0) > 0 ? 'paid' : 'keep');
  if (action === 'paid' || action === 'close') return action;
  return card.treatment === 'bt' || card.treatment === 'obligate' ? card.treatment : 'auto';
}
export function cardTreatmentPatch(card, choice) {
  if (choice === 'paid' || choice === 'close') return { ...cardActionPatch(card, choice), treatment: 'auto' };
  return { ...cardActionPatch(card, 'keep'), treatment: choice === 'bt' || choice === 'obligate' ? choice : 'auto' };
}

// What a card's Treatment does at the bank in "Counted for" (same tones as treatmentNote for loans).
export function cardTreatmentNote(card, result, bankLabel) {
  const t = cardTreatmentChoice(card);
  if (t === 'obligate') return { tone: 'grey', text: 'Kept as obligation' };
  if (t !== 'bt' || !result || !result.best) return null;
  if (isBtCard(result.best, card.id)) return { tone: 'green', text: 'BT' };
  const ws = result.warnings || [];
  const own = card.issuer && ws.find((w) => w.startsWith(`${card.issuer}: marked BT but`));
  const why = own || ws.find((w) => /cards marked BT can't all be taken together/.test(w));
  return { tone: 'red', text: `Not taken in BT by ${bankLabel}${why ? ` — ${why}` : ''}` };
}

// The bank's own card rule for the table footer (policy obligations.credit_card.rule, first clause),
// falling back to the engine's line for this case.
export function cardRuleText(policy, cardCalc) {
  const r = policy && policy.obligations && policy.obligations.credit_card && policy.obligations.credit_card.rule;
  if (r) return String(r).split(';')[0].trim();
  return (cardCalc && cardCalc.rule) || '';
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

// Grey reason line under a card's Counted share, for the selected bank.
export function cardReason(cardCalc, card) {
  if (!cardCalc) return '';
  const line = (cardCalc.lines || []).find((l) => l.id === card.id);
  if (line && !line.paydownAccepted && (card.paidBeforeLoginWithProof || 0) > 0) return 'Must reflect in CIBIL';
  if (!(cardCalc.amount > 0)) return /salary/i.test(cardCalc.rule || '') ? 'Not counted — total below salary' : 'Not counted';
  if (line && !(line.remaining > 0)) return 'Not counted — paid before login';
  const pct = String(cardCalc.rule || '').match(/^([\d.]+)%/);
  return pct ? `${pct[1]}% of outstanding` : cardCalc.rule;
}

// Loans with no balance and no EMI (closed / zero-balance CIBIL accounts) are
// tucked into a collapsed group; rows the agent added stay in the main list.
export const isZeroBalanceLoan = (l) => !l.manual && !(l.outstanding > 0) && !(l.emi > 0);
// Same for cards: CIBIL cards with nothing outstanding.
export const isZeroBalanceCard = (c) => !c.manual && !(c.outstanding > 0);

// GOLD / OD / KCC are bullet / revolving: the bank counts a % of outstanding, not the EMI.
const BULLET_TYPES = ['GOLD', 'OD', 'KCC'];
export const isBulletLoan = (l) => BULLET_TYPES.includes(l.productType);

// EMI-cell hint on bullet rows, following the selected bank's obligation rule:
// "bullet — 1% of outstanding counted", "bullet — Total gold loans ₹2,89,401 below ₹5,00,000 — not counted",
// "bullet — not counted" (bank counts 0%). No bank calculation yet: just "bullet".
export function bulletNote(line) {
  const ob = line && line.obligation;
  if (!ob) return 'bullet';
  const rule = String(ob.rule || '');
  if (ob.amount === 0) return /^0% of outstanding/.test(rule) || !rule ? 'bullet — not counted' : `bullet — ${rule}`;
  return `bullet — ${/% of outstanding/.test(rule) ? rule.replace('% of outstanding', '% of outstanding counted') : rule}`;
}

// Gold-loan suggestion across banks: live gold loans counted at some banks while another bank's policy
// counts gold at 0% (obligations.pct_by_type.GOLD === 0, e.g. Chola, Axis). Built from policies + results.
//   head:  "Gold loans ₹7,25,131 (2 loans) are counted at Bandhan ₹7,251/month."
//   banks: per no-gold bank — a category prompt (no company list, nothing picked) or its result line.
const isLiveGold = (l) => l.productType === 'GOLD' && !l.closedBeforeLoginWithProof && (l.outstanding || 0) > 0;
const goldPct = (policy) => {
  const g = policy && policy.obligations && policy.obligations.pct_by_type && policy.obligations.pct_by_type.GOLD;
  return g == null ? null : typeof g === 'object' ? g.pct : g;
};
export function goldLoanSuggestion(policies, results, loans, fmt) {
  const gold = (loans || []).filter(isLiveGold);
  if (!gold.length) return null;
  const total = gold.reduce((s, l) => s + (l.outstanding || 0), 0);
  const byId = new Map((results || []).map((r) => [r.bankId, r]));
  const counting = (results || []).map((r) => {
    const lines = (r.result && r.result.obligations && r.result.obligations.loans) || [];
    const monthly = lines.filter((l) => l.productType === 'GOLD').reduce((s, l) => s + ((l.obligation && l.obligation.amount) || 0), 0);
    return { bankId: r.bankId, short: shortBankName(r.label), monthly };
  }).filter((x) => x.monthly > 0);
  const noGold = (policies || []).filter((p) => goldPct(p.policy) === 0 && byId.has(p.bank_id));
  if (!counting.length || !noGold.length) return null;
  const head = `Gold loans ${fmt(total)} (${gold.length} loan${gold.length === 1 ? '' : 's'}) are counted at ${counting.map((c) => `${c.short} ${fmt(c.monthly)}/month`).join(', ')}.`;
  const banks = noGold.map((p) => {
    const entry = byId.get(p.bank_id);
    const short = shortBankName(entry.label);
    const pick = entry.categoryPick;
    if (pick && !pick.value) {
      return { bankId: p.bank_id, prompt: true, text: `${short} doesn't count gold loans — check the customer's ${short} category.`, button: `Pick ${short} category` };
    }
    const cat = pick && pick.value ? ` (${pick.value})` : '';
    const res = entry.result;
    const ok = res && (res.status === 'ELIGIBLE' || res.status === 'DEVIATION') && res.best;
    const status = entry.error || !res ? "couldn't evaluate"
      : ok ? `eligible ${fmt(res.best.eligibleAmount)}`
        : res.eligibleAfterWait ? "can't log yet — recent enquiry"
          : res.status === 'NEEDS_INPUT' ? 'needs input' : 'not eligible';
    return { bankId: p.bank_id, prompt: false, text: `${short}${cat}: ${status} — gold loans not counted` };
  });
  return { head, banks, total, count: gold.length };
}

// EMI total of the obligations table: term loans only (bullet loans have no real EMI).
export const termEmiTotal = (loans) => (loans || []).reduce((s, l) => s + (isBulletLoan(l) ? 0 : Number(l.emi) || 0), 0);

// Counted total for the selected bank: counted loan obligations + counted CC obligation.
export function countedObligationsTotal(obligations) {
  if (!obligations) return null;
  return (obligations.loans || []).reduce((s, l) => s + l.obligation.amount, 0) + ((obligations.cards && obligations.cards.amount) || 0);
}

// PL / BL EMI under 1% of the loan amount is almost always a misread or a typo
// (e.g. 100 on ₹14,70,000) — the screen shows a warning, nothing is changed.
export const emiLooksTooLow = (l) => (l.productType === 'PL' || l.productType === 'BL')
  && l.emi > 0 && l.loanAmount > 0 && l.emi < l.loanAmount * 0.01;

// Same test the engine uses for out.missingEmi.
export const loanNeedsEmi = (l) => (l.outstanding || 0) > 0 && !(l.emi > 0) && !l.closedBeforeLoginWithProof
  && !['GOLD', 'OD', 'KCC'].includes(l.productType);

// Reason column for one loan in the selected bank's best scenario: 'BT' when the
// best scenario transfers it, otherwise the engine's obligation rule
// ("Full EMI", "Only 2 EMIs left — not obligated", …). '' when that bank has no calculation.
// True when a scenario closes this loan through the bank's own top-up
// (scenario.topUp is the subset of scenario.bt done that way).
export const isTopUp = (scenario, loanId) => !!(scenario && Array.isArray(scenario.topUp) && scenario.topUp.includes(loanId));

// Card BT (policy.balance_transfer.card_bt, e.g. Poonawalla): the scenario pays this card off.
export const isBtCard = (scenario, cardId) => !!(scenario && Array.isArray(scenario.btCards) && scenario.btCards.includes(cardId));

// BT plan chip: "HDFC BANK · ₹3.20L", "SBI CARD · ₹2.00L (card)", "KRAZYBEE · ₹0.40L (app)", "(top-up)".
// A card's amount is what is left after any proven pre-login payment (same as the engine).
export function btChipText(scenario, id, loans, cards, fmtLakh) {
  if (isBtCard(scenario, id)) {
    const c = (cards || []).find((x) => x.id === id);
    const left = c ? Math.max(0, (c.outstanding || 0) - (c.paidBeforeLoginWithProof || 0)) : 0;
    return `${(c && c.issuer) || id} · ${fmtLakh(left)} (card)`;
  }
  const l = (loans || []).find((x) => x.id === id);
  const tag = isTopUp(scenario, id) ? ' (top-up)' : (scenario && Array.isArray(scenario.btApps) && scenario.btApps.includes(id)) ? ' (app)' : '';
  return `${(l && l.lender) || id} · ${fmtLakh(l ? l.outstanding : 0)}${tag}`;
}

// Grey line under the BT chips. rateAddOn covers card / app-loan BT and, for CIBIL 0 / -1, the NTC add-on.
export function rateAddOnLine(scenario, cibilScore) {
  if (!scenario || !(scenario.rateAddOn > 0)) return null;
  const parts = [];
  if ((scenario.btCards || []).length || (scenario.btApps || []).length) parts.push('card / app-loan BT');
  if (cibilScore === 0 || cibilScore === -1) parts.push('no CIBIL score');
  return `Rate includes +${Number(scenario.rateAddOn.toFixed(2))}%${parts.length ? ` for ${parts.join(' and ')}` : ''}`;
}

// Bank card "BT & obligations" table, built only from that bank's engine result (best.bt /
// best.btCards / obligations) — the row's own Treatment is never read here.
//   bt:        taken in BT — lender, POS, EMI freed
//   closed:    closed / paid before login — amount to pay, EMI removed
//   obligated: still counted — EMI counted + rule; not BT-able loans carry the bank's reason
//   notCounted: obligation 0 and not BT / closed — why
export function btSummary(result, loans, cards, eligible) {
  const best = result && result.best;
  const ob = result && result.obligations;
  if (!best || !ob) return null;
  const loanLines = ob.loans || [];
  const cardCalc = ob.cards || null;
  const btSet = new Set(best.bt || []);
  const btCardSet = new Set(best.btCards || []);
  const rows = { bt: [], closed: [], obligated: [], notCounted: [] };
  const live = (l) => (l.outstanding || 0) > 0 || (l.emi || 0) > 0;

  loanLines.forEach((l) => {
    if (l.closedBeforeLoginWithProof) {
      rows.closed.push({ id: l.id, name: l.lender, amount: l.outstanding || 0, emi: l.emi || 0 });
    } else if (btSet.has(l.id)) {
      rows.bt.push({ id: l.id, name: l.lender, pos: l.outstanding || 0, emi: l.obligation.amount || 0, topUp: isTopUp(best, l.id) });
    } else if (l.obligation.amount > 0) {
      const why = l.bt && !l.bt.ok && l.bt.why ? `${l.bt.why} — not taken in BT` : null;
      rows.obligated.push({ id: l.id, name: l.lender, emi: l.obligation.amount, rule: l.obligation.rule, why });
    } else if (live(l)) {
      rows.notCounted.push({ id: l.id, name: l.lender, why: l.obligation.rule });
    }
  });

  const perRupee = cardCalc && cardCalc.amount > 0 && cardCalc.total > 0 ? cardCalc.amount / cardCalc.total : 0;
  (cards || []).forEach((c) => {
    const line = cardCalc && (cardCalc.lines || []).find((x) => x.id === c.id);
    const paid = line ? line.paid : 0;
    const left = line ? line.remaining : Math.max(0, (c.outstanding || 0) - (c.paidBeforeLoginWithProof || 0));
    const name = c.issuer || 'Card';
    if (paid > 0) rows.closed.push({ id: c.id, name: `${name} (card)`, amount: paid, emi: paid * perRupee, card: true });
    if (!(left > 0)) return;
    const share = left * perRupee;
    if (btCardSet.has(c.id)) rows.bt.push({ id: c.id, name: `${name} (card)`, pos: left, emi: share, card: true });
    else if (share > 0) rows.obligated.push({ id: c.id, name: `${name} (card)`, emi: share, rule: cardReason(cardCalc, c), card: true });
    else rows.notCounted.push({ id: c.id, name: `${name} (card)`, why: cardReason(cardCalc, c), card: true });
  });

  const nCards = rows.bt.filter((r) => r.card).length;
  const totals = {
    btPos: best.btOutstanding || 0,
    btLoans: rows.bt.length - nCards,
    btCards: nCards,
    emiFreed: rows.bt.reduce((s, r) => s + r.emi, 0),
    obligations: best.obligations || 0,
    closureMoney: rows.closed.reduce((s, r) => s + r.amount, 0),
    eligible: eligible || 0,
  };
  totals.inHand = totals.eligible - totals.btPos;
  return { rows, totals };
}

// Own-bank loans the scenario closes through a top-up read 'Top-up' instead of 'BT'.
// A closed row never reads 'BT' (grey "Closed — EMI not counted"), whatever its old Treatment was.
export function loanReason(loan, line, best) {
  if (loan.closedBeforeLoginWithProof || (line && line.closedBeforeLoginWithProof)) return 'Closed — EMI not counted';
  if (!line) return '';
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

// Table headers such as "Employee Details Payment & Leave Details Location Details":
// a line where most words are payslip field words is never the employer.
const HEADER_WORDS = new Set(['EMPLOYEE', 'EMPLOYER', 'DETAILS', 'PAYMENT', 'LEAVE', 'LOCATION', 'EARNINGS', 'DEDUCTIONS',
  'PAYSLIP', 'SALARY', 'SLIP', 'STATEMENT', 'MONTH', 'PERIOD', 'BANK', 'NAME', 'PAN', 'UAN', 'GRADE', 'DESIGNATION',
  'DEPARTMENT', 'ATTENDANCE', 'SUMMARY', 'AMOUNT', 'TOTAL', 'NET', 'PAY', 'INFORMATION', 'ASSOCIATE']);
function isHeaderLine(l) {
  const words = normalizeName(l).split(' ').filter((w) => /[A-Z]/.test(w));
  return words.length > 0 && words.filter((w) => HEADER_WORDS.has(w)).length > words.length / 2;
}
// A "<field> <value>" row ("Base Br. TCS - HYDERABAD", "Bank Name ICICI Bank"), not a heading.
const FIELD_ROW_RE = /^(?:Base\s*Br(?:anch)?\b|Br\.)/i;
const isFieldRow = (l) => FIELD_ROW_RE.test(l) || (NEXT_FIELD_RE.exec(` ${l}`) || {}).index === 0;
// The salary bank's row: "Bank Name ICICI Bank", "Bank A/c No: …" (removed before alias search).
const BANK_ROW_RE = /\bBank[ \t]*(?:Name|A\/?c(?:count)?|Account)(?:[ \t]*(?:No\.?|Number))?[ \t]*[:\-–]?[ \t]*(?:(?:[A-Za-z&.]+[ \t]+){0,3}?Bank\b|[A-Za-z&.]+)/gi;

// Short forms printed on payslips whose company name is only in the logo
// (e.g. TCS "Base Br. TCS - HYDERABAD") -> the full name to search. Used only
// when no company line is found.
const EMPLOYER_ALIASES = [
  [/\bTCS\b/i, 'Tata Consultancy Services Limited'],
  [/\bINFOSYS\b/i, 'Infosys Limited'],
  [/\bWIPRO\b/i, 'Wipro Limited'],
  [/\bHCL(?:TECH)?\b/i, 'HCL Technologies Limited'],
  [/\b(?:CTS|COGNIZANT)\b/i, 'Cognizant Technology Solutions India Private Limited'],
  [/\bACCENTURE\b/i, 'Accenture Solutions Private Limited'],
  [/\bCAPGEMINI\b/i, 'Capgemini Technology Services India Limited'],
  [/\bTECH\s*MAHINDRA\b|\bTECHM\b/i, 'Tech Mahindra Limited'],
  [/\bIBM\b/i, 'IBM India Private Limited'],
  [/\bLTI\s*MINDTREE\b|\bLTIM\b/i, 'LTIMindtree Limited'],
  [/\bDELOITTE\b/i, 'Deloitte Shared Services India LLP'],
  [/\bGENPACT\b/i, 'Genpact India Private Limited'],
  [/\bAMAZON\b/i, 'Amazon Development Centre (India) Private Limited'],
  [/\bHDFC\s*BANK\b/i, 'HDFC Bank Limited'],
  [/\bICICI\s*BANK\b/i, 'ICICI Bank Limited'],
];
// name@tcs.com -> the domain's alias (email domain without dots/hyphens, e.g. hcltech, techmahindra).
const EMAIL_DOMAIN_ALIASES = {
  tcs: 'TCS', infosys: 'INFOSYS', wipro: 'WIPRO', hcl: 'HCL', hcltech: 'HCLTECH', cognizant: 'COGNIZANT',
  accenture: 'ACCENTURE', capgemini: 'CAPGEMINI', techmahindra: 'TECH MAHINDRA', ibm: 'IBM', ltimindtree: 'LTIMINDTREE',
  deloitte: 'DELOITTE', genpact: 'GENPACT', amazon: 'AMAZON', hdfcbank: 'HDFC BANK', icicibank: 'ICICI BANK',
};

// Earliest known short form in the text (bank rows ignored), then an email domain.
function employerFromAliases(source) {
  const s = String(source || '').replace(BANK_ROW_RE, ' ');
  let best = null;
  for (const [re, name] of EMPLOYER_ALIASES) {
    const m = s.match(re);
    if (m && (!best || m.index < best.index)) best = { index: m.index, name };
  }
  if (best) return best.name;
  for (const m of s.matchAll(/[\w.+-]+@([A-Za-z0-9-]+)(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) {
    const alias = EMAIL_DOMAIN_ALIASES[m[1].toLowerCase().replace(/-/g, '')];
    if (alias) return EMPLOYER_ALIASES.find(([re]) => re.test(alias))[1];
  }
  return null;
}

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
    if (isEmployee(l) || isHeaderLine(l) || /\bBank\s*(?:Name|A\/?c|Account)\b/i.test(l) || !l.match(COMPANY_WORD_RE)) continue;
    const s = tidy(trimAfterCompanyWord(l));
    if (s.length >= 3 && !NOT_COMPANY_LINE_RE.test(s)) return s;
  }
  // Otherwise the first heading-like line that isn't a title, table header,
  // field row, address, number or label.
  for (const l of top) {
    if (NOT_COMPANY_LINE_RE.test(l) || isHeaderLine(l) || isFieldRow(l) || ADDRESS_RE.test(l) || isEmployee(l) || /[:]/.test(l)) continue;
    if ((l.match(/\d/g) || []).length > 3 || !/[A-Za-z]{3,}/.test(l)) continue;
    return l;
  }
  // Logo-only header: a known short form (TCS, CTS, HCL …) or the email domain.
  return employerFromAliases([...lines, text].join('\n'));
}

const normalizeName = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// Canonical company name — the same rule search_company_category uses in the
// database: PVT = PRIVATE, LTD = LIMITED, & = AND, punctuation and extra spaces
// ignored. A leading "M/s" is dropped too, so "M/s ABC Pvt. Ltd." = "ABC PRIVATE LIMITED".
export function normCompany(s) {
  return String(s || '').toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/^\s*M S\s+/, ' ')
    .replace(/\bPVTLTD\b/g, 'PRIVATE LIMITED')
    .replace(/\bPVT\b/g, 'PRIVATE')
    .replace(/\bLTD\b/g, 'LIMITED')
    .replace(/\s+/g, ' ')
    .trim();
}

// normCompany without the legal suffix, so the payslip logo "TATA CONSULTANCY
// SERVICES" = "Tata Consultancy Services Limited".
const LEGAL_SUFFIX_RE = / (PRIVATE LIMITED|LIMITED|PRIVATE|LLP|INC|CORPORATION|CORP)$/;
export const normCompanyCore = (s) => normCompany(s).replace(LEGAL_SUFFIX_RE, '').trim();

export const sameCompany = (a, b) => (!!normCompany(a) && normCompany(a) === normCompany(b))
  || (!!normCompanyCore(a) && normCompanyCore(a) === normCompanyCore(b));

// Any match_type starting with 'exact': 'exact', 'exact (PVT/LTD form)',
// 'exact (without Ltd / Pvt Ltd)' (canonical matches in the database).
export const isExactMatch = (row) => /^exact/i.test(String((row && row.match_type) || ''));

// Company names de-duplicated by normCompany, first spelling kept.
export function uniqueCompanyNames(names) {
  const seen = new Set();
  return (names || []).filter((n) => {
    const k = normCompany(n);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

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

// [{ grossPay }] -> average monthly gross of the payslips that have one (null if none).
export function averageGrossPay(payslips) {
  const vals = (payslips || []).map((p) => p.grossPay).filter((v) => v > 0);
  return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
}

// [{ netPay, variablePay }] -> variable pay inside the averaged net pay: averaged
// over the same payslips (a month without it counts as 0). null if none.
export function averageVariablePay(payslips) {
  const counted = (payslips || []).filter((p) => p.netPay > 0);
  const total = counted.reduce((s, p) => s + (p.variablePay > 0 ? p.variablePay : 0), 0);
  return total > 0 ? Math.round(total / counted.length) : null;
}

// Combined pre-fill for the screen. Either row may be null. A payslip net pay,
// when given, takes priority over the bank-statement salary estimate.
export function buildProfileDraft(cibilRow, bsaRow, { payslipNetPay = null, payslipVariablePay = null, payslipGrossPay = null, today = new Date() } = {}) {
  const c = cibilToProfile(cibilRow, { today });
  const b = bankStatementToProfile(bsaRow);
  const fromPayslip = payslipNetPay > 0;
  return {
    netSalary: fromPayslip ? payslipNetPay : b.salaryFromStatement,
    netSalarySource: fromPayslip ? 'payslip' : b.salaryFromStatement ? 'bank_statement' : null,
    // Left out by banks that count fixed salary only (policy.exclude_variable_pay).
    variablePayMonthly: fromPayslip && payslipVariablePay > 0 ? payslipVariablePay : null,
    variablePaySource: fromPayslip && payslipVariablePay > 0 ? 'payslip' : null,
    // Gross monthly salary (total earnings) from the payslip — banks with a gross minimum (Bandhan).
    grossSalary: payslipGrossPay > 0 ? payslipGrossPay : null,
    grossSalarySource: payslipGrossPay > 0 ? 'payslip' : null,
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
      servedLoanAmount: c.credit.servedLoanAmount,
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
