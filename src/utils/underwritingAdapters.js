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

// CIBIL row -> { loans, cards, credit (CIBIL-derived flags only), reportDate }
export function cibilToProfile(cibilRow) {
  const accounts = (cibilRow && cibilRow.accounts) || [];
  const reportDate = parseDate(cibilRow && cibilRow.report_date) || new Date();
  const loans = [];
  const cards = [];

  accounts.forEach((acc, i) => {
    if (!isOpen(acc)) return;
    const type = mapProductType(acc.loanType);
    if (type === 'CARD') {
      cards.push({ id: `C${i}`, issuer: acc.bankName || '', outstanding: toNum(acc.outstanding), paidBeforeLoginWithProof: 0 });
      return;
    }
    loans.push({
      id: `L${i}`,
      lender: acc.bankName || '',
      lenderType: null,
      productType: type,
      sourceType: acc.loanType || '',
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
  const overdueLast12m = accounts.some((a) =>
    (a.lateMonths || []).some((lm) => { const d = parseLateMonth(lm); return d && d >= yearAgo; })
    || (isOpen(a) && hasAmount(a.overdue)));

  // Member names, de-duplicated; the engine matches each bank's own name against these.
  const lenderNames = (list) => [...new Set(list.map((a) => String(a.bankName || '').trim()).filter(Boolean))];
  const enquiries90 = cibilRow && cibilRow.enquiries && cibilRow.enquiries.last90;

  const credit = {
    settlementsOrWO: settled.length,
    settledLenders: lenderNames(settled),
    dpdLenders: lenderNames(accounts.filter(hasDpd)),
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

// Status pill for one loan in the selected bank's best scenario:
// 'closed' | 'bt' | 'obligated' | 'not_counted' (null when that bank has no calculation).
export function loanStatus(loan, line, best) {
  if (loan.closedBeforeLoginWithProof) return 'closed';
  if (!line || !best) return null;
  if (best.bt.includes(loan.id)) return 'bt';
  return line.obligation.amount > 0 ? 'obligated' : 'not_counted';
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
export function buildProfileDraft(cibilRow, bsaRow, { payslipNetPay = null } = {}) {
  const c = cibilToProfile(cibilRow);
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
