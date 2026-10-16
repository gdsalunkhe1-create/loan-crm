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
function roiSlabsFor(policy, score) {
  const all = policy.eligibility.roi_slabs_by_loan_amount || [];
  return all.filter((s) => (s.cibil_min_incl == null && s.cibil_max_excl == null) || inBand(score ?? 0, s.cibil_min_incl, s.cibil_max_excl));
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

function minSalaryFor(policy, category, salaryAccountBank) {
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

  if (!cat) reasons.push(`Company not in ${policy.bank} category list (unlisted not allowed)`);
  else if (excluded.includes(norm(cat))) reasons.push(`${cat} not considered by ${policy.bank}`);
  if (has('own_bank_settlement_or_writeoff', 'hdfc_own_settlement_or_writeoff') && ownSettled) reasons.push(`Settlement / write-off with ${policy.bank}`);
  if (has('own_bank_bad_history', 'bad_hdfc_internal_repayment_history') && ownBad) reasons.push(`Late payment on earlier ${policy.bank} ${badTypes ? badTypes.join('/') : 'loan/card'}`);
  if (has('heavy_dpd_late_payments_across_all_trades') && c.dpdAcrossAllTrades) reasons.push('DPD / late payments reported across all accounts');
  if ((c.settlementsOrWO || 0) > 0) {
    const f = c.freshLoanAfterSettlement || {};
    if (has('settlement_or_writeoff_without_fresh_loan_after') && !f.exists) reasons.push('Settlement / write-off with no fresh loan sanctioned after it');
    else if (has('settlement_or_writeoff_with_fresh_loan_after') && f.exists && (f.emisPaid || 0) < 12) reasons.push(`Post-settlement loan has ${f.emisPaid || 0} EMIs paid — eligible after ${12 - (f.emisPaid || 0)} more`);
  }
  if (cat) {
    const min = minSalaryFor(policy, cat, profile.salaryAccountBank);
    if (min != null && profile.netSalary < min) reasons.push(`Net salary ${fmtINR(profile.netSalary)} below ${cat} minimum ${fmtINR(min)}`);
  }
  const enq = policy.enquiries || {};
  if (enq.max_90d != null) {
    if (c.enquiries90d == null) deviations.push('Enquiry count (90 days) not available — check manually');
    else if (c.enquiries90d > enq.max_90d) {
      const msg = `${c.enquiries90d} enquiries in 90 days (max ${enq.max_90d})`;
      if (enq.deviation_possible) deviations.push(`${msg} — deviation needed`); else reasons.push(msg);
    }
  }
  return { reasons, deviations };
}

function obligationOf(policy, loan) {
  if (loan.closedBeforeLoginWithProof) return { amount: 0, rule: 'Closed before login (proof)' };
  if (loan.emisRemaining != null && loan.emisRemaining <= (policy.obligations?.loan_with_emis_remaining_lte ?? -1)) {
    return { amount: 0, rule: `Only ${loan.emisRemaining} EMI(s) left — not obligated` };
  }
  if ((policy.obligations?.one_pct_types || ONE_PCT_TYPES).includes(loan.productType)) {
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

function btCandidate(policy, loan) {
  const bt = policy.balance_transfer || {};
  if (!(bt.product_types || UNSECURED_BT_TYPES).includes(loan.productType)) return { ok: false, why: `${loan.productType} not taken in BT` };
  if (wordStartMatch(loan.lender, (bt.lender_blacklist || []).flatMap((b) => b.match))) return { ok: false, why: 'Lender not taken in BT (small fintech / microfinance)' };
  if (loan.closedBeforeLoginWithProof) return { ok: false, why: 'Already closed' };
  if (!(loan.outstanding > 0)) return { ok: false, why: 'No outstanding to transfer' };
  if (loan.emisRemaining != null && loan.emisRemaining <= (policy.obligations?.loan_with_emis_remaining_lte ?? -1)) {
    return { ok: false, why: 'Already not obligated (≤2 EMIs left)' };
  }
  const kind = lenderKind(policy, loan);
  if (kind === 'nbfc' && (bt.nbfc_mode || 'whitelist') === 'whitelist' && !matchWhitelist(policy, loan.lender)) return { ok: false, why: 'NBFC not in BT list' };
  const need = bt.min_emis_paid?.[kind] ?? 6;
  if ((loan.emisPaid || 0) < need) return { ok: false, why: `${loan.emisPaid || 0}/${need} EMIs paid` };
  return { ok: true, why: `${kind === 'bank' ? 'Bank' : 'NBFC'}, ${loan.emisPaid} EMIs paid` };
}

export function evaluateBank(policy, profile) {
  const out = { bank: policy.bank, policyVersion: policy.policy_version, status: 'ELIGIBLE', reasons: [], warnings: [] };
  const rawCat = profile.company?.categoriesByBank?.[policy.bank_id] ?? profile.company?.category;
  const category = rawCat ? norm(rawCat) : null;
  const cat = (category && Object.keys(policy.multiplier_grids || {}).find((k) => norm(k) === category))
    || rawCat;
  const confirmed = profile.company?.confirmedByBank?.[policy.bank_id] ?? profile.company?.categoryConfirmed;

  if (profile.company && confirmed === false) {
    out.status = 'NEEDS_INPUT';
    out.reasons.push('Company listed with two categories — select the banker-confirmed one');
    return out;
  }
  const hc = hardChecks(policy, { ...profile, company: { ...profile.company, category: cat } });
  out.reasons = hc.reasons;
  out.deviations = hc.deviations;
  if (out.reasons.length) { out.status = 'NOT_ELIGIBLE'; return out; }

  const salary = profile.netSalary;
  const risk = riskIndication(policy, profile);
  out.risk = risk;
  out.notes = risk.notes;   // informational, e.g. card late payment that this bank accepts

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
  const roiSlabs = roiSlabsFor(policy, score);
  const cap = policy.eligibility.max_loan ?? null;

  // Policy parameters
  const foirPct = pickSlab(policy.eligibility.foir_slabs, salary)?.foir_pct;
  const tenures = policy.eligibility.tenure_slabs
    ? (pickSlab(policy.eligibility.tenure_slabs, salary)?.months || [60])
    : (salary >= 75000 ? policy.eligibility.tenures_months.salary_75000_and_above : policy.eligibility.tenures_months.salary_below_75000);
  const usesGrid = !!policy.multiplier_grids;
  const bands = usesGrid ? gridBands(policy, cat, salary) : null;
  if (usesGrid && !bands) out.warnings.push(`No multiplier grid for ${cat} at ${fmtINR(salary)}`);
  const gridMax = bands ? bestTenure(bands[risk.band], 60) : null;
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
    const emiRoom = salary * foirPct / 100 - obl;
    const foir = {};
    for (const t of foirTenures) foir[t] = emiRoom > 0 ? foirLoanWithRoi(emiRoom, t, roiSlabs, cap) : { amount: 0, roi: null };
    const mult = {};
    if (bands) {
      for (const which of ['better', 'lower']) {
        const b = bands[which]; const t = bestTenure(b, 60);
        const raw = Math.max(0, (salary - obl) * b.multipliers[t]);
        mult[which] = t ? { tenure: t, multiplier: b.multipliers[t], band: b.risk_band || b.label || null, amount: cap != null ? Math.min(raw, cap) : raw } : null;
      }
    }
    const m = mult[risk.band]?.amount ?? 0;
    const f60 = foir[foirTenures[0]].amount;
    const conservative = Math.min(f60, m || f60);
    const roiSlab = roiSlabs.find((x) => inBand(conservative, x.loan_min_incl, x.loan_max_excl));
    scenarios.push({
      limitedBy: m && m < f60 ? 'multiplier' : 'foir',
      conservativeRoi: roiSlab ? roiSlab.roi_pct : Math.max(...roiSlabs.map((x) => x.roi_pct)),
      roiAssumed: !roiSlab,   // rate for the final (conservative) amount, whichever method set it
      bt: picked.map((l) => l.id), btOutstanding, obligations: obl, emiRoom, foir, multiplier: mult,
      conservativeAmount: conservative,
      netInHand: conservative - btOutstanding,
    });
  }
  scenarios.sort((a, b) => b.netInHand - a.netInHand);
  out.foirPct = foirPct;
  out.scenarios = scenarios;
  out.best = scenarios[0];
  if (out.best.conservativeAmount <= 0) { out.status = 'NOT_ELIGIBLE'; out.reasons.push('No EMI room after obligations'); }
  else if (out.deviations.length) out.status = 'DEVIATION';
  if (out.best.roiAssumed) out.warnings.push(`${policy.bank} has no rate for this loan amount — highest known rate used`);
  if (cap != null && out.best.conservativeAmount >= cap) out.warnings.push(`Capped at ${policy.bank} maximum loan ${fmtINR(cap)}`);

  // Loans with a balance but no EMI would silently count as 0 — make the agent fill them.
  const oneTypes = policy.obligations?.one_pct_types || ONE_PCT_TYPES;
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
        newEligible: sim.best?.conservativeAmount ?? null, newNetInHand: sim.best?.netInHand ?? null,
        gain: (sim.best?.conservativeAmount ?? 0) - out.best.conservativeAmount,
        mustReflectInCibil: (policy.obligations?.credit_card?.prelogin_paydown || 'all') !== 'all',
      };
      out.warnings.unshift(`Close ${pick.map((c) => c.issuer).join(', ')} before login (${fmtINR(closeAmount)}) → eligible ${fmtINR(out.cardPlan.newEligible)} (+${fmtINR(out.cardPlan.gain)})`);
    }
    out.warnings = out.warnings.filter((w) => !w.startsWith('Paying '));   // replaced by the card plan
    if (need && !pick.length) out.warnings.unshift(`Card outstanding must come down by ${fmtINR(need)} to remove the CC obligation`);
  }
  return out;
}
