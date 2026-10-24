// Underwriting Desk — policy-driven eligibility engine (pure logic, no React / Supabase).
// One call per bank: evaluateBank(policy, profile). Policy = the JSON stored in underwriting_policies.policy.
//
// PROFILE SHAPE (built by adapters from CIBIL parser + BSA + payslip + Company Category Checker):
// {
//   netSalary: 100000,
//   salaryAccountBank: 'HDFC Bank' | 'ICICI Bank' | ...,
//   company: { name, category: 'CAT A', categoryConfirmed: true, incorporationYear: 2007 },
//   riskOverride: null | 'better' | 'lower',          // agent override of the indicated band
//   loans: [{ id, lender, lenderType: 'bank'|'nbfc'|null, productType: 'PL'|'BL'|'CONSUMER'|'HL'|'GOLD'|'OD'|'KCC'|'AUTO'|'OTHER',
//             outstanding, emi, emisPaid, emisRemaining, isJoint, coApplicantIncomeOk, closedBeforeLoginWithProof,
//             treatment: 'auto'|'bt'|'obligate', hlEmiPaidBy: 'applicant'|'co_applicant'|null }],
//   company.categoriesByBank: { hdfc_bank: 'CAT A', icici: 'Preferred' }, company.confirmedByBank: { ... }
//   cards: [{ id, issuer, outstanding, paidBeforeLoginWithProof: 0 }],
//   cibilScore: 768,
//   credit: { settledLenders: [], dpdLenders: [], enquiries90d: 4,       // lender names, matched per bank
//             hdfcSettlementOrWO, hdfcBadHistory, dpdAcrossAllTrades, settlementsOrWO: 0,   // hdfc* kept for back-compat
//             freshLoanAfterSettlement: { exists: false, emisPaid: 0 },
//             bouncesLast12m: 0, overdueLast12m: false, bouncesOnlyCardOrGold: false }
// }

const UNSECURED_BT_TYPES = ['PL', 'BL', 'CONSUMER', 'OTHER'];
const ONE_PCT_TYPES = ['GOLD', 'OD', 'KCC'];

export const fmtINR = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const inBand = (x, min, maxExcl) => x >= (min ?? 0) && (maxExcl == null || x < maxExcl);

// Present value of an EMI stream = loan amount that EMI can service.
export function loanFromEmi(emi, roiPct, months) {
  if (emi <= 0) return 0;
  const r = roiPct / 1200;
  return emi * (Math.pow(1 + r, months) - 1) / (r * Math.pow(1 + r, months));
}

function pickSlab(slabs, x, minKey = 'salary_min_incl', maxKey = 'salary_max_excl') {
  return (slabs || []).find((s) => inBand(x, s[minKey], s[maxKey]));
}

// ROI slabs may also depend on CIBIL score (cibil_min_incl / cibil_max_excl). Missing score = lowest score band.
// Slabs may also be limited by CIBIL score, company category (categories) and salary (salary_min_incl).
function roiSlabsFor(policy, score, category, salary, ownHouse) {
  const all = policy.eligibility.roi_slabs_by_loan_amount || [];
  const sc = Math.max(score ?? 0, 0);   // CIBIL -1 (no history) is priced like the lowest score band
  return all.filter((s) => ((s.cibil_min_incl == null && s.cibil_max_excl == null) || inBand(sc, s.cibil_min_incl, s.cibil_max_excl))
    && (!s.categories || (category && s.categories.map(norm).includes(norm(category))))
    && (s.salary_min_incl == null || (salary ?? 0) >= s.salary_min_incl)
    && (!s.own_house || ownHouse));
}

// FOIR slab: salary band, optionally limited by CIBIL score (cibil_min_incl / cibil_max_excl).
function pickFoirSlab(slabs, salary, score) {
  const sc = Math.max(score ?? 0, 0);
  return (slabs || []).find((s) => inBand(salary, s.salary_min_incl, s.salary_max_excl)
    && ((s.cibil_min_incl == null && s.cibil_max_excl == null) || inBand(sc, s.cibil_min_incl, s.cibil_max_excl)));
}

// Other income added to net salary for eligibility (bonus, incentives, rent, pension, consulting).
// profile.otherIncome: { bonusAnnualNet, quarterlyIncentiveNet, monthlyIncentiveAvg6m, rentMonthly, rentVerified, pensionMonthly, consultingMonthly }
function otherIncomeFor(policy, profile) {
  const rules = policy.other_income;
  const oi = profile.otherIncome || {};
  const base = profile.netSalary || 0;
  const lines = [];
  if (!rules) return { total: 0, lines };
  const add = (key, label, raw, pct, capPct) => {
    if (!(raw > 0) || pct == null) return;
    let amt = raw * pct / 100;
    if (capPct != null) amt = Math.min(amt, base * capPct / 100);
    lines.push({ key, label, raw: Math.round(raw), pct, amount: Math.round(amt) });
  };
  const seg = (r) => (r?.high_salary_min != null && base >= r.high_salary_min ? r.pct_high : r?.pct);
  if (rules.bonus) add('bonus', 'Bonus & quarterly incentives', (oi.bonusAnnualNet || 0) / 12 + (oi.quarterlyIncentiveNet || 0) / 3, seg(rules.bonus), rules.bonus.cap_pct_of_salary);
  if (rules.monthly_incentive) add('incentive', 'Monthly incentives (6-month avg)', oi.monthlyIncentiveAvg6m, rules.monthly_incentive.pct, rules.monthly_incentive.cap_pct_of_salary);
  if (rules.rental && oi.rentVerified) add('rent', 'Rental income', oi.rentMonthly, seg(rules.rental), rules.rental.cap_pct_of_salary);
  if (rules.pension) add('pension', 'Pension', oi.pensionMonthly, rules.pension.pct, rules.pension.cap_pct_of_salary);
  if (rules.consulting) add('consulting', 'Consulting income', oi.consultingMonthly, rules.consulting.pct, rules.consulting.cap_pct_of_salary);
  return { total: lines.reduce((a, l) => a + l.amount, 0), lines };
}

// ROI depends on the loan amount, which depends on ROI: start at the best rate, step down.
function foirLoanWithRoi(emi, months, roiSlabs, cap) {
  const ordered = [...roiSlabs].sort((a, b) => a.roi_pct - b.roi_pct);
  const capped = (amt) => (cap != null && amt > cap ? cap : amt);
  for (const s of ordered) {
    const amt = loanFromEmi(emi, s.roi_pct, months);
    if (inBand(amt, s.loan_min_incl, s.loan_max_excl)) return { amount: capped(amt), roi: s.roi_pct, capped: cap != null && amt > cap };
  }
  const last = ordered[ordered.length - 1];
  const amt = loanFromEmi(emi, last.roi_pct, months);
  return { amount: capped(amt), roi: last.roi_pct, roiAssumed: true, capped: cap != null && amt > cap };
}

function minSalaryFor(policy, category, salaryAccountBank, city) {
  const byCity = policy.min_net_salary_by_city;   // { cities: [{ match: ['MUMBAI'], min: 35000 }], default: 25000 }
  if (byCity) {
    const hit = (byCity.cities || []).find((c) => wordStartMatch(city || '', c.match));
    return hit ? hit.min : byCity.default;
  }
  const rule = policy.min_net_salary?.[category] ?? policy.min_net_salary?._all;
  if (rule == null) return null;
  if (typeof rule === 'number') return rule;
  const isOwn = norm(salaryAccountBank).includes(norm(policy.bank).split(' ')[0]);
  return isOwn ? (rule.own_salary_account ?? rule.hdfc_salary_account) : rule.other_salary_account;
}

function matchWhitelist(policy, lender) {
  const n = norm(lender);
  // Match at the start of a word, so 'TCL' matches 'TCL LTD' but not 'HOTCLUB', and 'BAJAJ FIN' matches 'BAJAJ FINANCE'.
  return (policy.balance_transfer?.nbfc_whitelist || []).find((w) => w.match.some((m) => (' ' + n).includes(' ' + norm(m))));
}

function wordStartMatch(name, list) {
  const n = ' ' + norm(name);
  return (list || []).some((m) => n.includes(' ' + norm(m)));
}
const isOwnBank = (policy, name) => wordStartMatch(name, policy.own_bank_match || [norm(policy.bank).split(' ')[0]]);

function lenderKind(policy, loan) {
  if (loan.lenderType) return loan.lenderType;
  if (matchWhitelist(policy, loan.lender)) return 'nbfc';
  return /\bBANK\b/.test(norm(loan.lender)) ? 'bank' : 'nbfc';
}

const CARD_TYPES = ['CARD', 'CC', 'CREDIT_CARD'];
// credit.dpdAccounts: [{ lender, productType, inLast12m }] — one entry per account with DPD > 0.
function recentDpd(policy, profile) {
  const c = profile.credit || {};
  if (!Array.isArray(c.dpdAccounts)) return { counted: c.overdueLast12m ? ['CIBIL overdue'] : [], ignoredCards: [] };
  const recent = c.dpdAccounts.filter((a) => a.inLast12m);
  const ignoreCards = !!policy.risk?.ignore_card_dpd;
  return {
    counted: recent.filter((a) => !(ignoreCards && CARD_TYPES.includes(a.productType))).map((a) => a.lender),
    ignoredCards: ignoreCards ? recent.filter((a) => CARD_TYPES.includes(a.productType)).map((a) => a.lender) : [],
  };
}

function riskIndication(policy, profile) {
  const c = profile.credit || {};
  const dpd = recentDpd(policy, profile);
  const notes = dpd.ignoredCards.length
    ? [`Late payment on credit card (${[...new Set(dpd.ignoredCards)].join(', ')}) — ${policy.bank} still does the case`]
    : [];
  if (profile.riskOverride) return { band: profile.riskOverride, reason: 'Agent override', notes };
  if ((c.bouncesLast12m || 0) > 0 || dpd.counted.length) {
    const what = [(c.bouncesLast12m || 0) > 0 ? `${c.bouncesLast12m} bounce(s)` : null, dpd.counted.length ? `late payment on ${[...new Set(dpd.counted)].join(', ')}` : null].filter(Boolean).join(' and ');
    return { band: 'lower', reason: `${what} in last 12 months — chance`, notes };
  }
  return { band: 'better', reason: 'No bounces or late payments in last 12 months', notes };
}

const BETTER_BANDS = ['A1-B3', 'A1-B9'];

// Returns { better, lower } grid bands for this category + salary (identical when the grid has no risk split).
function gridBands(policy, category, salary) {
  const grid = policy.multiplier_grids?.[category];
  if (!grid) return null;
  const rows = grid.filter((b) => inBand(salary, b.salary_min_incl, b.salary_max_excl));
  if (!rows.length) return null;
  if (rows.length === 1) return { better: rows[0], lower: rows[0] };
  return {
    better: rows.find((b) => BETTER_BANDS.includes(b.risk_band)) || rows[0],
    lower: rows.find((b) => !BETTER_BANDS.includes(b.risk_band)) || rows[rows.length - 1],
  };
}

// Longest tenure <= cap that has a multiplier (NA tenures are treated as not offered).
function bestTenure(band, capMonths) {
  const ts = Object.keys(band.multipliers).map(Number).filter((t) => t <= capMonths && band.multipliers[t] != null);
  return ts.length ? Math.max(...ts) : null;
}

function hardChecks(policy, profile) {
  const reasons = [];
  const deviations = [];
  const waits = [];   // temporary blocks: figures are still worked out so the agent sees what's possible later
  const c = profile.credit || {};
  const cat = profile.company?.category;
  const rules = new Set((policy.hard_rejects || []).map((r) => r.rule));
  const has = (...names) => names.some((n) => rules.has(n));
  const excluded = (policy.company?.excluded_categories || []).map(norm);
  const ownSettled = (c.settledLenders || []).some((l) => isOwnBank(policy, l)) || (policy.bank_id === 'hdfc_bank' && c.hdfcSettlementOrWO);
  const badTypes = policy.own_bank_bad_history_types;   // e.g. ['PL'] — only these products count
  const ownBad = Array.isArray(c.dpdAccounts)
    ? c.dpdAccounts.some((a) => isOwnBank(policy, a.lender) && (!badTypes || badTypes.includes(a.productType)))
    : ((c.dpdLenders || []).some((l) => isOwnBank(policy, l)) || (policy.bank_id === 'hdfc_bank' && c.hdfcBadHistory));

  if (!cat) reasons.push(policy.company?.manual_category
    ? `Enter the ${policy.bank} company category (checked with the banker)`
    : `Company not in ${policy.bank} category list (unlisted not allowed)`);
  else if (excluded.includes(norm(cat))) reasons.push(`${cat} not considered by ${policy.bank}`);
  if (has('own_bank_settlement_or_writeoff', 'hdfc_own_settlement_or_writeoff') && ownSettled) reasons.push(`Settlement / write-off with ${policy.bank}`);
  if (has('own_bank_bad_history', 'bad_hdfc_internal_repayment_history') && ownBad) reasons.push(`Late payment on earlier ${policy.bank} ${badTypes ? badTypes.join('/') : 'loan/card'}`);
  if (has('heavy_dpd_late_payments_across_all_trades') && c.dpdAcrossAllTrades) reasons.push('DPD / late payments reported across all accounts');
  if (has('recent_dpd_loans_12m') && Array.isArray(c.dpdAccounts)) {
    const late = c.dpdAccounts.filter((a) => a.inLast12m && !CARD_TYPES.includes(a.productType)).map((a) => a.lender);
    if (late.length) reasons.push(`Late payment in last 12 months on ${[...new Set(late)].join(', ')}`);
  }
  const minScore = policy.eligibility?.min_cibil;
  const score = profile.cibilScore;
  if (minScore != null && score != null && score !== -1 && score < minScore) reasons.push(`CIBIL score ${score} below ${policy.bank} minimum ${minScore}`);
  const cr = policy.credit_rules || {};
  if (cr.loan_dpd && Array.isArray(c.dpdAccounts)) {
    const loans = c.dpdAccounts.filter((a) => !CARD_TYPES.includes(a.productType) && a.monthsAgo != null);
    const recent = loans.filter((a) => a.monthsAgo <= cr.loan_dpd.reject_within_months);
    const mid = loans.filter((a) => a.monthsAgo > cr.loan_dpd.reject_within_months && a.monthsAgo <= cr.loan_dpd.deviation_within_months);
    const count12 = loans.reduce((n, a) => n + (a.count12m || (a.monthsAgo <= 12 ? 1 : 0)), 0);
    if (recent.length) reasons.push(`Late payment in last ${cr.loan_dpd.reject_within_months} months on ${[...new Set(recent.map((a) => a.lender))].join(', ')}`);
    else if (mid.length) deviations.push(`Late payment ${cr.loan_dpd.reject_within_months}–${cr.loan_dpd.deviation_within_months} months ago on ${[...new Set(mid.map((a) => a.lender))].join(', ')} — check with banker`);
    if (!recent.length && count12 > cr.loan_dpd.max_count_12m) {
      const msg = `${count12} late payments on loans in last 12 months (allowed ${cr.loan_dpd.max_count_12m})`;
      if (cr.loan_dpd.over_count === 'reject') reasons.push(msg); else deviations.push(msg);
    }
  }
  if (cr.card_dpd_12m === 'deviation' && Array.isArray(c.dpdAccounts)) {
    const cards = c.dpdAccounts.filter((a) => CARD_TYPES.includes(a.productType) && a.inLast12m);
    if (cards.length) deviations.push(`Late payment on credit card (${[...new Set(cards.map((a) => a.lender))].join(', ')}) in last 12 months — call to be taken by ${policy.bank}`);
  }
  // Unlisted companies (allowed by some banks with extra conditions).
  const unl = policy.company?.unlisted_rules;
  if (cat === 'UNLISTED' && unl) {
    const yr = profile.company?.incorporationYear;
    if (!yr) reasons.push('Unlisted company: enter the year of incorporation (from CIN / MCA)');
    else if (new Date().getFullYear() - yr < unl.min_company_age_years) reasons.push(`Unlisted company is ${new Date().getFullYear() - yr} year(s) old — ${policy.bank} needs ${unl.min_company_age_years}+`);
  }
  const sc = policy.scorecard;
  if (sc) {
    const val = profile.scorecardByBank?.[policy.bank_id];
    if (val && (sc.reject || []).map(norm).includes(norm(val))) reasons.push(`${sc.name}: ${val} — ${policy.bank} doesn't do the case`);
  }
  if ((c.settlementsOrWO || 0) > 0) {
    const f = c.freshLoanAfterSettlement || {};
    if (has('settlement_or_writeoff_without_fresh_loan_after') && !f.exists) reasons.push('Settlement / write-off with no fresh loan sanctioned after it');
    else if (has('settlement_or_writeoff_with_fresh_loan_after') && f.exists && (f.emisPaid || 0) < 12) reasons.push(`Post-settlement loan has ${f.emisPaid || 0} EMIs paid — eligible after ${12 - (f.emisPaid || 0)} more`);
  }
  if (cat) {
    const min = minSalaryFor(policy, cat, profile.salaryAccountBank, profile.city);
    if (min != null && profile.netSalary < min) reasons.push(`Net salary ${fmtINR(profile.netSalary)} below ${cat} minimum ${fmtINR(min)}`);
  }
  // Own-bank enquiry in the last N days: this bank won't take the case yet.
  // credit.enquiryList: [{ lender, product, date, daysAgo }] from the CIBIL enquiry table.
  const blk = policy.own_bank_enquiry_block;
  if (blk && Array.isArray(c.enquiryList)) {
    const hit = c.enquiryList.filter((e) => e.daysAgo != null && e.daysAgo <= blk.days && isOwnBank(policy, e.lender)
      && (!blk.products || blk.products.some((pr) => norm(e.product).includes(norm(pr)))));
    if (hit.length) {
      const d = Math.min(...hit.map((e) => e.daysAgo));
      waits.push({ days: blk.days - d, text: `${policy.bank} enquiry ${d} day(s) ago — can't be done with ${policy.bank} until ${blk.days} days have passed (${blk.days - d} more)` });
    }
  }
  const enq = policy.enquiries || {};
  if (enq.max_30d != null && Array.isArray(c.enquiryList) && c.enquiryList.length) {
    const types = enq.count_types;
    const n30 = c.enquiryList.filter((e) => e.daysAgo != null && e.daysAgo <= 30 && (!types || types.some((t) => norm(e.product).includes(norm(t))))).length;
    if (n30 > enq.max_30d) {
      const msg = `${n30} ${types ? types.join('/') + ' ' : ''}enquiries in 30 days (max ${enq.max_30d})`;
      if (enq.deviation_possible) deviations.push(`${msg} — deviation needed`); else reasons.push(msg);
    }
  }
  if (enq.max_90d != null) {
    // Count from the full enquiry list when we have it, so only this bank's counted types are included.
    let count = c.enquiries90d;
    let label = 'enquiries';
    if (Array.isArray(c.enquiryList) && c.enquiryList.length) {
      const types = enq.count_types;
      count = c.enquiryList.filter((e) => e.daysAgo != null && e.daysAgo <= 90
        && (!types || types.some((t) => norm(e.product).includes(norm(t))))).length;
      if (types) label = `${types.join('/')} enquiries`;
    }
    if (count == null) deviations.push('Enquiry count (90 days) not available — check manually');
    else if (count > enq.max_90d) {
      const msg = `${count} ${label} in 90 days (max ${enq.max_90d})`;
      if (enq.deviation_possible) deviations.push(`${msg} — deviation needed`); else reasons.push(msg);
    }
  }
  return { reasons, deviations, waits };
}

function obligationOf(policy, loan) {
  if (loan.closedBeforeLoginWithProof) return { amount: 0, rule: 'Closed before login (proof)' };
  if (loan.emisRemaining != null && loan.emisRemaining <= (policy.obligations?.loan_with_emis_remaining_lte ?? -1)) {
    return { amount: 0, rule: `Only ${loan.emisRemaining} EMI(s) left — not obligated` };
  }
  const byType = policy.obligations?.pct_by_type;   // e.g. { GOLD: 1, OD: 2, KCC: 1 }
  if (byType && byType[loan.productType] != null) {
    const pct = byType[loan.productType];
    return { amount: pct / 100 * (loan.outstanding || 0), rule: `${pct}% of outstanding` };
  }
  if (!byType && (policy.obligations?.one_pct_types || ONE_PCT_TYPES).includes(loan.productType)) {
    return { amount: 0.01 * (loan.outstanding || 0), rule: '1% of outstanding' };
  }
  if (loan.productType === 'HL' && loan.isJoint) {
    const j = policy.obligations?.home_loan_joint || {};
    if (j.paid_by_co_applicant_pct != null && loan.hlEmiPaidBy === 'co_applicant') {
      return { amount: j.paid_by_co_applicant_pct / 100 * (loan.emi || 0), rule: `Joint HL paid by co-applicant — ${j.paid_by_co_applicant_pct}% of EMI` };
    }
    if (j.pct_of_emi != null && loan.coApplicantIncomeOk) {
      return { amount: j.pct_of_emi / 100 * (loan.emi || 0), rule: `Joint HL — ${j.pct_of_emi}% of EMI` };
    }
  }
  return { amount: loan.emi || 0, rule: 'Full EMI' };
}

function cardObligation(policy, profile) {
  const rule = policy.obligations?.credit_card || {};
  const mode = rule.prelogin_paydown || 'all';   // 'all' | 'own_bank_cards_only' | 'none'
  const accepted = (c) => mode === 'all' || (mode === 'own_bank_cards_only' && isOwnBank(policy, c.issuer));
  const ignoredPaydown = (profile.cards || []).filter((c) => (c.paidBeforeLoginWithProof || 0) > 0 && !accepted(c)).map((c) => c.issuer || 'card');
  const total = (profile.cards || []).reduce((s, c) => s + Math.max(0, (c.outstanding || 0) - (accepted(c) ? (c.paidBeforeLoginWithProof || 0) : 0)), 0);
  const lines = (profile.cards || []).map((c, i) => ({
    id: c.id ?? `card${i}`, issuer: c.issuer, outstanding: c.outstanding || 0,
    paid: accepted(c) ? Math.min(c.paidBeforeLoginWithProof || 0, c.outstanding || 0) : 0,
    paydownAccepted: accepted(c),
    remaining: Math.max(0, (c.outstanding || 0) - (accepted(c) ? (c.paidBeforeLoginWithProof || 0) : 0)),
  }));
  if (rule.exempt_if_total_outstanding_lte_net_salary && total <= profile.netSalary) {
    return { total, amount: 0, rule: 'Total CC outstanding ≤ net salary — not obligated', paydownToExempt: 0, ignoredPaydown, lines };
  }
  return {
    total,
    amount: (rule.pct_of_outstanding || 5) / 100 * total,
    rule: `${rule.pct_of_outstanding || 5}% of total CC outstanding`,
    paydownToExempt: rule.exempt_if_total_outstanding_lte_net_salary ? total - profile.netSalary : null,
    ignoredPaydown,
    lines,
  };
}

// Lenders whose PL may really be an OD / flexi line (all NBFCs + any bank in od_check.extra_match, e.g. Kotak).
function needsOdCheck(policy, loan) {
  const od = policy.balance_transfer?.od_check;
  if (!od || loan.productType !== 'PL') return false;
  return (od.all_nbfc && lenderKind(policy, loan) === 'nbfc') || wordStartMatch(loan.lender, od.extra_match);
}

// loan.odStatus: null (not confirmed) | 'term' | 'od_emi' (OD, EMI started) | 'od_no_emi'
// loan.foreclosureLetter: true when the lender has issued a foreclosure letter
function btCandidate(policy, loan) {
  const bt = policy.balance_transfer || {};
  if (!(bt.product_types || UNSECURED_BT_TYPES).includes(loan.productType)) return { ok: false, why: `${loan.productType} not taken in BT` };
  if (loan.closedBeforeLoginWithProof) return { ok: false, why: 'Already closed' };
  if (!(loan.outstanding > 0)) return { ok: false, why: 'No outstanding to transfer' };
  if (loan.emisRemaining != null && loan.emisRemaining <= (policy.obligations?.loan_with_emis_remaining_lte ?? -1)) {
    return { ok: false, why: 'Already not obligated (≤2 EMIs left)' };
  }
  // Own-bank loan: the bank closes it through a top-up instead of a BT (same effect on eligibility, own label).
  if (bt.own_bank_loans === 'top_up' && isOwnBank(policy, loan.lender)) {
    const needOwn = bt.top_up_min_emis ?? bt.min_emis_paid?.bank ?? 6;
    if ((loan.emisPaid || 0) < needOwn) return { ok: false, why: `Own-bank loan — top-up needs ${needOwn} EMIs paid (${loan.emisPaid || 0} so far)` };
    return { ok: true, topUp: true, why: `Own-bank loan — closed through top-up, ${loan.emisPaid} EMIs paid` };
  }
  const lock = (bt.lender_lock_in || []).find((x) => wordStartMatch(loan.lender, x.match));
  if (lock && (loan.emisPaid || 0) < lock.months) return { ok: false, why: `${lock.name} lock-in: BT only after ${lock.months} months (${loan.emisPaid || 0} paid)` };
  const letterLender = (bt.foreclosure_letter_lenders || []).find((f) => wordStartMatch(loan.lender, f.match));
  if (letterLender && !loan.foreclosureLetter) return { ok: false, why: `Needs foreclosure letter from ${letterLender.name}`, needsLetter: true };
  if (!letterLender && wordStartMatch(loan.lender, (bt.lender_blacklist || []).flatMap((b) => b.match))) return { ok: false, why: 'Lender not taken in BT (microfinance / small fintech)' };
  if (loan.odStatus === 'od_no_emi') return { ok: false, why: 'OD / flexi with no EMI started — not taken in BT' };
  const kind = lenderKind(policy, loan);
  if (!letterLender && kind === 'nbfc' && (bt.nbfc_mode || 'whitelist') === 'whitelist' && !matchWhitelist(policy, loan.lender)) return { ok: false, why: 'NBFC not in BT list' };
  const need = bt.min_emis_paid?.[kind] ?? 6;
  if ((loan.emisPaid || 0) < need) return { ok: false, why: `${loan.emisPaid || 0}/${need} EMIs paid` };
  const odUnconfirmed = needsOdCheck(policy, loan) && !loan.odStatus;
  return {
    ok: true,
    why: `${kind === 'bank' ? 'Bank' : 'NBFC'}, ${loan.emisPaid} EMIs paid${letterLender ? ', foreclosure letter received' : ''}`,
    odUnconfirmed,
  };
}

export function evaluateBank(policy, profile) {
  const out = { bank: policy.bank, policyVersion: policy.policy_version, status: 'ELIGIBLE', reasons: [], warnings: [] };
  const rawCat = profile.company?.categoriesByBank?.[policy.bank_id] ?? profile.company?.category;
  const category = rawCat ? norm(rawCat) : null;
  let cat = (category && Object.keys(policy.multiplier_grids || {}).find((k) => norm(k) === category))
    || rawCat;
  if (!cat && policy.company?.unlisted_rules) cat = 'UNLISTED';
  const groups = policy.eligibility?.groups || {};
  const groupKey = cat && Object.keys(groups).find((g) => (groups[g].categories || []).some((x) => norm(x) === norm(cat)));
  const group = groupKey ? groups[groupKey] : null;
  const confirmed = profile.company?.confirmedByBank?.[policy.bank_id] ?? profile.company?.categoryConfirmed;

  if (profile.company && confirmed === false) {
    out.status = 'NEEDS_INPUT';
    out.reasons.push('Company listed with two categories — select the banker-confirmed one');
    return out;
  }
  const hc = hardChecks(policy, { ...profile, company: { ...profile.company, category: cat } });
  out.reasons = hc.reasons;
  out.deviations = hc.deviations;
  if (out.reasons.length) {
    out.reasons.push(...hc.waits.map((w) => w.text));
    out.status = 'NOT_ELIGIBLE'; return out;
  }

  const salary = profile.netSalary;                 // slabs, segments and minimums use net salary alone
  const oiRes = otherIncomeFor(policy, profile);
  const income = salary + oiRes.total;              // amounts use net salary + allowed other income
  out.otherIncome = oiRes;
  const oiNotes = [];
  if (oiRes.total > 0) oiNotes.push(`Other income added: ${oiRes.lines.map((l) => `${l.label} ${fmtINR(l.amount)} (${l.pct}%)`).join(', ')} — eligibility on ${fmtINR(income)}/month`);
  if (policy.other_income?.rental && profile.otherIncome?.rentMonthly > 0 && !profile.otherIncome?.rentVerified) out.warnings.push('Rental income not counted — tick "agreement + 6 months credits verified"');
  const risk = riskIndication(policy, profile);
  out.risk = risk;
  out.notes = risk.notes;   // informational, e.g. card late payment that this bank accepts
  out.notes.push(...oiNotes);

  // Obligations
  const loanLines = (profile.loans || []).map((l) => ({ ...l, obligation: obligationOf(policy, l), bt: btCandidate(policy, l) }));
  const card = cardObligation(policy, profile);
  out.obligations = { loans: loanLines, cards: card };
  if (card.paydownToExempt > 0) out.warnings.push(`Paying ${fmtINR(Math.ceil(card.paydownToExempt))} on cards before login removes the CC obligation (${fmtINR(card.amount)}/month)`);
  if (card.ignoredPaydown?.length) out.warnings.push(`${policy.bank} accepts pre-login card payments only when they reflect in CIBIL (except its own cards) — ignored for: ${card.ignoredPaydown.join(', ')}`);
  if ((profile.loans || []).some((l) => l.productType === 'HL' && l.isJoint && l.coApplicantIncomeOk == null && l.hlEmiPaidBy == null)) {
    out.warnings.push('Joint home loan: confirm who pays the EMI and the co-applicant income');
  }
  const score = profile.cibilScore ?? null;
  const usesScore = (policy.eligibility.roi_slabs_by_loan_amount || []).some((x) => x.cibil_min_incl != null || x.cibil_max_excl != null);
  if (usesScore && score == null) out.warnings.push('CIBIL score missing — lowest score band rates used');
  let roiSlabs = roiSlabsFor(policy, score, cat, salary, profile.ownHouse);
  if (!roiSlabs.length) {
    // No rate defined for this category / salary: use the bank's highest known rate and flag it.
    const hi = Math.max(...(policy.eligibility.roi_slabs_by_loan_amount || []).map((x) => x.roi_pct));
    roiSlabs = [{ loan_min_incl: 1e15, loan_max_excl: null, roi_pct: hi }];
    out.warnings.push(`${policy.bank} has no rate for ${cat || 'this category'} at this salary — ${hi}% used`);
  }
  let cap = policy.eligibility.max_loan ?? null;
  if (group?.max_loan != null) cap = cap != null ? Math.min(cap, group.max_loan) : group.max_loan;
  if (cat === 'UNLISTED' && policy.company?.unlisted_rules?.note) out.notes.push(policy.company.unlisted_rules.note);
  const capBySal = pickSlab(policy.eligibility.max_loan_by_salary, salary)?.max_loan;
  if (capBySal != null) cap = cap != null ? Math.min(cap, capBySal) : capBySal;
  for (const pc of policy.profile_caps || []) {          // e.g. { flag: 'govtClass3', cap: 700000, label: 'Government class 3' }
    if (profile[pc.flag]) { cap = cap != null ? Math.min(cap, pc.cap) : pc.cap; out.notes.push(`${pc.label}: max ${fmtINR(pc.cap)}`); }
  }
  const ftb = policy.first_time_borrower;
  const isFtb = ftb && (profile.cibilScore === -1 || (ftb.trigger !== 'ntc_only' && (profile.credit || {}).loanAccountsEver === 0));
  if (isFtb) {
    const catCap = Object.entries(ftb.cap_by_category || {}).find(([k]) => norm(k) === norm(cat || ''))?.[1];
    const ftbCap = catCap ?? ftb.cap;
    cap = cap != null ? Math.min(cap, ftbCap) : ftbCap;
    out.notes.push(`First-time borrower${profile.cibilScore === -1 ? ' (CIBIL -1)' : ''} — ${policy.bank} gives ${ftb.range && catCap == null ? ftb.range : fmtINR(ftbCap)} max`);
  }
  if (policy.checklist?.length) out.checklist = policy.checklist;

  // Policy parameters
  const foirSlab = pickFoirSlab(group?.foir_slabs || policy.eligibility.foir_slabs, salary, profile.cibilScore);
  const liveHlAny = loanLines.some((l) => l.productType === 'HL' && !l.closedBeforeLoginWithProof && ((l.outstanding || 0) > 0 || (l.emi || 0) > 0));
  let foirPct = foirSlab?.foir_pct;
  if (profile.ownHouse && liveHlAny && foirSlab?.foir_pct_own_house_hl != null) {
    foirPct = foirSlab.foir_pct_own_house_hl;
    out.notes.push(`Own house with live home loan — FOIR ${foirPct}%`);
  } else if (profile.ownHouse && foirSlab?.foir_pct_own_house != null) {
    foirPct = foirSlab.foir_pct_own_house;
    out.notes.push(`Own house — FOIR ${foirPct}%`);
  }
  const hlBonus = policy.eligibility.foir_hl_bonus;   // e.g. { salary_min_incl: 75000, foir_pct: 75 }
  if (hlBonus && salary >= hlBonus.salary_min_incl
      && loanLines.some((l) => l.productType === 'HL' && l.obligation.amount > 0)) {
    foirPct = Math.max(foirPct, hlBonus.foir_pct);
    out.notes.push(`Home loan counted as obligation — FOIR ${hlBonus.foir_pct}% applied`);
  }
  if (policy.eligibility.roi_unconfirmed) out.warnings.push(`${policy.bank} ROI not confirmed yet — rates used are placeholders`);
  if (policy.scorecard && !profile.scorecardByBank?.[policy.bank_id]) {
    out.notes.push(`${policy.scorecard.name} (${policy.scorecard.values.join(' / ')}) is decided by the bank — ${policy.scorecard.reject.join('/')} is declined`);
  }
  const tSlabs = group?.tenure_slabs || policy.eligibility.tenure_slabs;
  let tenures = tSlabs
    ? (pickSlab(tSlabs, salary)?.months || [60])
    : (salary >= 75000 ? policy.eligibility.tenures_months.salary_75000_and_above : policy.eligibility.tenures_months.salary_below_75000);
  const usesGrid = !!policy.multiplier_grids;
  const bands = usesGrid ? gridBands(policy, cat, salary) : null;
  if (usesGrid && !bands) out.warnings.push(`No multiplier grid for ${cat} at ${fmtINR(salary)}`);
  const gridMax = bands ? bestTenure(bands[risk.band], 60) : null;
  // Scorecard-specific FOIR / tenure / max loan (e.g. Kotak Yellow 60%, 65% with a live home loan, 5 years).
  const scChosen = profile.scorecardByBank?.[policy.bank_id];
  const scRules = policy.scorecard_rules || {};
  const scKey = scChosen && Object.keys(scRules).find((k) => norm(k) === norm(scChosen));
  if (scKey) {
    const rule = scRules[scKey];
    const liveHl = loanLines.some((l) => l.productType === 'HL' && !l.closedBeforeLoginWithProof && ((l.outstanding || 0) > 0 || (l.emi || 0) > 0));
    const v = liveHl ? (rule.with_hl || rule.any) : (rule.no_hl || rule.any);
    if (v) {
      if (v.foir_pct != null) foirPct = v.foir_pct;
      if (v.tenures) tenures = v.tenures;
      if (v.max_loan != null) cap = cap != null ? Math.min(cap, v.max_loan) : v.max_loan;
      out.notes.push(`${policy.scorecard?.name || 'Scorecard'} ${scKey}${liveHl ? ' with live home loan' : ''}: FOIR ${foirPct}%, ${tenures.map((t) => t / 12).join('/')} years${v.max_loan != null ? `, max ${fmtINR(v.max_loan)}` : ''}`);
    }
  }
  const foirTenures = gridMax && gridMax < 60 ? [gridMax] : tenures;
  if (gridMax && gridMax < 60) out.warnings.push(`${cat} grid stops at ${gridMax} months — FOIR also calculated at ${gridMax} months`);

  // BT scenarios: every subset of BT-able loans (n is small in practice; capped at 10).
  // Agent treatment per loan: 'auto' (engine decides) | 'bt' (always BT) | 'obligate' (never BT).
  for (const l of loanLines) {
    if (l.treatment === 'bt' && !l.bt.ok) out.warnings.push(`${l.lender}: marked BT but not BT-able for ${policy.bank} (${l.bt.why}) — kept as obligation`);
  }
  const cands = loanLines.filter((l) => l.bt.ok && l.treatment !== 'obligate').slice(0, 10);
  const forcedMask = cands.reduce((m, l, i) => (l.treatment === 'bt' ? m | (1 << i) : m), 0);
  const baseObl = loanLines.reduce((s, l) => s + l.obligation.amount, 0) + card.amount;
  const scenarios = [];
  for (let mask = 0; mask < 1 << cands.length; mask++) {
    if ((mask & forcedMask) !== forcedMask) continue;
    const picked = cands.filter((_, i) => mask & (1 << i));
    const obl = baseObl - picked.reduce((s, l) => s + l.obligation.amount, 0);
    const btOutstanding = picked.reduce((s, l) => s + (l.outstanding || 0), 0);
    const emiRoom = income * foirPct / 100 - obl;
    const foir = {};
    for (const t of foirTenures) foir[t] = emiRoom > 0 ? foirLoanWithRoi(emiRoom, t, roiSlabs, cap) : { amount: 0, roi: null };
    const mult = {};
    if (bands) {
      for (const which of ['better', 'lower']) {
        const b = bands[which]; const t = bestTenure(b, 60);
        const raw = Math.max(0, (income - obl) * b.multipliers[t]);
        mult[which] = t ? { tenure: t, multiplier: b.multipliers[t], band: b.risk_band || b.label || null, amount: cap != null ? Math.min(raw, cap) : raw } : null;
      }
    }
    const m = mult[risk.band]?.amount ?? 0;
    const f60 = foir[foirTenures[0]].amount;
    const conservative = Math.min(f60, m || f60);
    const roiSlab = roiSlabs.find((x) => inBand(conservative, x.loan_min_incl, x.loan_max_excl));
    // Every method is shown side by side — the bank may sanction on FOIR or on multiplier.
    const rateFor = (amt) => (roiSlabs.find((x) => inBand(amt, x.loan_min_incl, x.loan_max_excl)) || {}).roi_pct ?? Math.max(...roiSlabs.map((x) => x.roi_pct));
    const methods = foirTenures.map((t) => ({
      key: `foir_${t}`, label: `FOIR ${t / 12} years`, tenure: t, amount: foir[t].amount, roi: foir[t].roi,
      netInHand: foir[t].amount - btOutstanding,
    }));
    if (mult[risk.band]) {
      const mm = mult[risk.band];
      methods.push({ key: 'multiplier', label: 'Multiplier', tenure: mm.tenure, amount: mm.amount, roi: rateFor(mm.amount),
        netInHand: mm.amount - btOutstanding, multiplier: mm.multiplier, band: mm.band });
    }
    // Scorecard-based multiplier (e.g. Kotak: Super green / Green / Yellow / Amber × salary band).
    const msc = policy.multiplier_by_scorecard;
    if (msc) {
      const chosen = profile.scorecardByBank?.[policy.bank_id];
      const col = (msc.salary_bands || []).findIndex((b) => inBand(salary, b.salary_min_incl, b.salary_max_excl));
      const names = chosen ? [chosen] : Object.keys(msc.values);
      for (const name of names) {
        const key = Object.keys(msc.values).find((k) => norm(k) === norm(name));
        const mx = key && col >= 0 ? msc.values[key][col] : null;
        if (mx == null) continue;
        // apply_on: 'salary' = gross multiple of net salary (Kotak); default = (salary - obligations) x M
        const raw = Math.max(0, (msc.apply_on === 'salary' ? income : income - obl) * mx);
        const amt = cap != null ? Math.min(raw, cap) : raw;
        methods.push({ key: `multiplier_${norm(key).replace(/ /g, '_').toLowerCase()}`, label: `Multiplier — ${key}`, tenure: msc.tenure_months || 60,
          amount: amt, roi: rateFor(amt), netInHand: amt - btOutstanding, multiplier: mx, band: key, indicative: !chosen });
      }
    }
    const mbs = policy.multiplier_by_salary;   // { slabs: [{salary_min_incl, salary_max_excl, multiplier}], bonus: [{salary_min_incl, own_house, live_hl, multiplier}] }
    if (mbs) {
      let mx = pickSlab(group?.multiplier_slabs || mbs.slabs, salary)?.multiplier ?? null;
      const liveHl = loanLines.some((l) => l.productType === 'HL' && !l.closedBeforeLoginWithProof && ((l.outstanding || 0) > 0 || (l.emi || 0) > 0));
      const bonus = (mbs.bonus || []).find((b) => salary >= b.salary_min_incl && (!b.own_house || profile.ownHouse) && (!b.live_hl || liveHl));
      if (bonus) mx = Math.max(mx ?? 0, bonus.multiplier);
      if (mx != null && (!group?.no_multiplier)) {
        const raw = Math.max(0, (mbs.apply_on === 'salary' ? income : income - obl) * mx);
        const amt = cap != null ? Math.min(raw, cap) : raw;
        methods.push({ key: 'multiplier', label: 'Multiplier', tenure: foirTenures[foirTenures.length - 1], amount: amt, roi: rateFor(amt),
          netInHand: amt - btOutstanding, multiplier: mx, band: bonus ? 'own house + home loan' : null });
      }
    }
    const firm = methods.filter((x) => !x.indicative);
    let top = firm.reduce((a, b) => (b.amount > a.amount ? b : a), firm[0]);
    if (policy.eligibility.combine === 'lower') {
      // Bank gives the LOWER of its best FOIR figure and the multiplier figure.
      const bestFoir = firm.filter((x) => x.key.startsWith('foir')).reduce((a, b) => (!a || b.amount > a.amount ? b : a), null);
      const mlt = firm.find((x) => x.key.startsWith('multiplier'));
      if (bestFoir && mlt) top = mlt.amount < bestFoir.amount ? mlt : bestFoir;
    }
    scenarios.push({
      limitedBy: m && m < f60 ? 'multiplier' : 'foir',
      conservativeRoi: roiSlab ? roiSlab.roi_pct : Math.max(...roiSlabs.map((x) => x.roi_pct)),
      roiAssumed: !roiSlab,   // rate for the lower (conservative) amount
      bt: picked.map((l) => l.id), btOutstanding, obligations: obl, emiRoom, foir, multiplier: mult,
      topUp: picked.filter((l) => l.bt.topUp).map((l) => l.id),   // subset of bt closed via own-bank top-up
      methods,                                  // [{ key, label, tenure, amount, roi, netInHand }]
      eligibleAmount: top.amount,               // highest of the methods (or the lower of FOIR / multiplier when combine = 'lower')
      eligibleRule: policy.eligibility.combine === 'lower' ? 'lower' : 'highest',
      eligibleBy: top.key,
      conservativeAmount: conservative,         // lower of FOIR 5y and multiplier (for reference)
      netInHand: top.amount - btOutstanding,    // in hand on the highest method
      netInHandConservative: conservative - btOutstanding,
    });
  }
  scenarios.sort((a, b) => b.netInHand - a.netInHand);
  out.foirPct = foirPct;
  out.scenarios = scenarios;
  out.best = scenarios[0];
  if (out.best.eligibleAmount <= 0) { out.status = 'NOT_ELIGIBLE'; out.reasons.push('No EMI room after obligations'); }
  else if (out.best.netInHand < 0) { out.status = 'NOT_ELIGIBLE'; out.reasons.push(`BT outstanding ${fmtINR(out.best.btOutstanding)} is more than the highest eligibility ${fmtINR(out.best.eligibleAmount)}`); }
  else if (out.deviations.length) out.status = 'DEVIATION';
  if (hc.waits.length && out.status !== 'NOT_ELIGIBLE') {
    // Only a temporary block: keep the figures, mark the bank as not yet possible.
    out.waitDays = Math.max(...hc.waits.map((w) => w.days));
    out.reasons.unshift(...hc.waits.map((w) => w.text));
    out.status = 'NOT_ELIGIBLE';
    out.eligibleAfterWait = true;
  }
  if (out.best.roiAssumed && out.best.eligibleAmount > 0) out.warnings.push(`${policy.bank} has no rate for this loan amount — highest known rate used`);
  if (cap != null && out.best.eligibleAmount >= cap) out.warnings.push(`Capped at ${policy.bank} maximum loan ${fmtINR(cap)}`);

  // BT loans from OD-giving lenders: confirm it's a term loan, not an OD / flexi line.
  const odAsk = loanLines.filter((l) => out.best.bt.includes(l.id) && l.bt.odUnconfirmed);
  out.odConfirm = odAsk.map((l) => l.id);
  if (odAsk.length) out.warnings.unshift(`Confirm ${odAsk.map((l) => l.lender).join(', ')} ${odAsk.length > 1 ? 'are term loans' : 'is a term loan'}, not OD / flexi — an OD is taken in BT only after its EMIs have started`);
  const letters = loanLines.filter((l) => l.bt.needsLetter);
  if (letters.length) out.notes.push(`${letters.map((l) => l.lender).join(', ')}: can be taken in BT once the foreclosure letter is received`);

  // Loans with a balance but no EMI would silently count as 0 — make the agent fill them.
  const oneTypes = policy.obligations?.pct_by_type ? Object.keys(policy.obligations.pct_by_type) : (policy.obligations?.one_pct_types || ONE_PCT_TYPES);
  const missing = loanLines.filter((l) => (l.outstanding || 0) > 0 && !(l.emi > 0) && !l.closedBeforeLoginWithProof && !oneTypes.includes(l.productType));
  out.missingEmi = missing.map((l) => l.id);
  if (missing.length && out.status !== 'NOT_ELIGIBLE') {
    out.status = 'NEEDS_INPUT';
    out.reasons.push(`EMI missing for ${missing.map((l) => l.lender).join(', ')} — enter EMI (amounts below count it as 0)`);
  }

  // Card plan: which cards to close before login and what it adds to eligibility.
  if (card.amount > 0 && !profile._noCardPlan) {
    const open = card.lines.filter((c) => c.remaining > 0 && c.paydownAccepted).sort((a, b) => b.remaining - a.remaining);
    let pick = open;
    let need = null;
    if (card.paydownToExempt != null) {
      need = Math.ceil(card.paydownToExempt);
      pick = []; let sum = 0;
      for (const c of open) { if (sum >= need) break; pick.push(c); sum += c.remaining; }
      if (sum < need) pick = [];   // even closing every accepted card isn't enough
    }
    if (pick.length) {
      const ids = new Set(pick.map((c) => c.id));
      const sim = evaluateBank(policy, {
        ...profile, _noCardPlan: true,
        cards: (profile.cards || []).map((c, i) => (ids.has(c.id ?? `card${i}`) ? { ...c, paidBeforeLoginWithProof: c.outstanding } : c)),
      });
      const closeAmount = pick.reduce((sm, c) => sm + c.remaining, 0);
      out.cardPlan = {
        minPaydown: need, closeCards: pick.map((c) => c.id), closeAmount,
        newEligible: sim.best?.eligibleAmount ?? null, newNetInHand: sim.best?.netInHand ?? null,
        gain: (sim.best?.eligibleAmount ?? 0) - out.best.eligibleAmount,
        mustReflectInCibil: (policy.obligations?.credit_card?.prelogin_paydown || 'all') !== 'all',
      };
      if (!(out.cardPlan.gain > 0)) delete out.cardPlan;   // closing cards wouldn't help — don't suggest it
      else out.warnings.unshift(`Close ${pick.map((c) => c.issuer).join(', ')} before login (${fmtINR(closeAmount)}) → eligible ${fmtINR(out.cardPlan.newEligible)} (+${fmtINR(out.cardPlan.gain)})`);
    }
    out.warnings = out.warnings.filter((w) => !w.startsWith('Paying '));   // replaced by the card plan
    if (need && !pick.length) out.warnings.unshift(`Card outstanding must come down by ${fmtINR(need)} to remove the CC obligation`);
  }
  // Subject-to-closure: which non-BT loans are worth closing (before login, or from the disbursal where allowed).
  if (policy.subject_to_closure_allowed && !profile._noCardPlan && out.status !== 'NOT_ELIGIBLE' && out.best) {
    const base = out.best.eligibleAmount;
    const cands = loanLines.filter((l) => l.obligation.amount > 0 && (l.outstanding || 0) > 0
      && !out.best.bt.includes(l.id) && !CARD_TYPES.includes(l.productType)).slice(0, 8);
    const plan = [];
    for (const l of cands) {
      const sim = evaluateBank(policy, { ...profile, _noCardPlan: true,
        loans: (profile.loans || []).map((x) => (x.id === l.id ? { ...x, closedBeforeLoginWithProof: true } : x)) });
      const gain = (sim.best?.eligibleAmount ?? 0) - base;
      if (gain > (l.outstanding || 0)) {
        plan.push({ id: l.id, lender: l.lender, outstanding: l.outstanding, emi: l.emi, newEligible: sim.best.eligibleAmount, gain,
          netInHandAfterClosing: sim.best.netInHand - l.outstanding });
      }
    }
    plan.sort((a, b) => (b.gain - b.outstanding) - (a.gain - a.outstanding));
    out.closurePlan = plan.slice(0, 3);
    for (const c of out.closurePlan) {
      out.notes.push(`Subject to closure of ${c.lender} (${fmtINR(c.outstanding)}): eligible ${fmtINR(c.newEligible)} (+${fmtINR(c.gain)})`);
    }
  }
  return out;
}
