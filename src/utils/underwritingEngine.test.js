import policy from './hdfc_pl_policy.json';
import { evaluateBank } from './underwritingEngine';

const base = {
  netSalary: 100000, salaryAccountBank: 'ICICI Bank',
  company: { category: 'CAT A', categoryConfirmed: true },
  loans: [
    { id: 'icici', lender: 'ICICI BANK', productType: 'PL', outstanding: 150000, emi: 32000, emisPaid: 5, emisRemaining: 40 },
    { id: 'hl', lender: 'SBI', productType: 'HL', emi: 25000, emisPaid: 50, emisRemaining: 150 },
  ],
  cards: [], credit: {},
};

test("Gauri example 1: ICICI BT, HL obligated, CAT A, 1L salary", () => {
  const r = evaluateBank(policy, base);
  expect(r.status).toBe('ELIGIBLE');
  expect(r.foirPct).toBe(70);
  const s = r.scenarios.find((x) => x.bt.join() === 'icici');
  expect(s.obligations).toBe(25000);
  expect(Math.round(s.foir[60].amount)).toBe(2105730);   // HDFC CAT A 15L+ now 10.25% (Diwali offer)
  expect(s.foir[60].roi).toBe(10.25);   // HDFC Diwali offer, CAT A 15L+
  expect(Math.round(s.foir[72].amount)).toBe(2412590);
  expect(s.multiplier.better.amount).toBe(2025000);
});

test('CC: total under salary not obligated, over salary 5% of total', () => {
  const a = evaluateBank(policy, { ...base, netSalary: 60000, cards: [{ outstanding: 35000 }, { outstanding: 20000 }] });
  expect(a.obligations.cards.amount).toBe(0);
  const b = evaluateBank(policy, { ...base, netSalary: 60000, cards: [{ outstanding: 45000 }, { outstanding: 30000 }] });
  expect(b.obligations.cards.amount).toBe(3750);
  expect(b.obligations.cards.paydownToExempt).toBe(15000);
});

test('Hard rejects', () => {
  expect(evaluateBank(policy, { ...base, company: { category: 'CAT E' } }).status).toBe('NOT_ELIGIBLE');
  expect(evaluateBank(policy, { ...base, company: { category: null } }).status).toBe('NOT_ELIGIBLE');
  expect(evaluateBank(policy, { ...base, company: { category: 'CAT C' }, netSalary: 40000 }).status).toBe('NOT_ELIGIBLE');
  expect(evaluateBank(policy, { ...base, credit: { hdfcSettlementOrWO: true } }).status).toBe('NOT_ELIGIBLE');
  expect(evaluateBank(policy, { ...base, credit: { settlementsOrWO: 1, freshLoanAfterSettlement: { exists: true, emisPaid: 7 } } }).status).toBe('NOT_ELIGIBLE');
  expect(evaluateBank(policy, { ...base, credit: { settlementsOrWO: 1, freshLoanAfterSettlement: { exists: true, emisPaid: 12 } } }).status).toBe('ELIGIBLE');
});

test('Two categories needs banker confirmation', () => {
  expect(evaluateBank(policy, { ...base, company: { category: 'CAT A', categoryConfirmed: false } }).status).toBe('NEEDS_INPUT');
});

test('BT: non-listed NBFC stays obligated, listed NBFC needs 6 EMIs', () => {
  const r = evaluateBank(policy, { ...base, loans: [
    { id: 'kb', lender: 'KREDITBEE', productType: 'PL', outstanding: 30000, emi: 5000, emisPaid: 8, emisRemaining: 4 },
    { id: 'navi5', lender: 'NAVI FINSERV', productType: 'PL', outstanding: 200000, emi: 9000, emisPaid: 5, emisRemaining: 30 },
  ] });
  const byId = Object.fromEntries(r.obligations.loans.map((l) => [l.id, l.bt.ok]));
  expect(byId).toEqual({ kb: false, navi5: false });
});

test('Loan with 2 EMIs left is not obligated', () => {
  const r = evaluateBank(policy, { ...base, loans: [{ id: 'x', lender: 'AXIS BANK', productType: 'PL', emi: 8000, emisPaid: 34, emisRemaining: 2 }] });
  expect(r.obligations.loans[0].obligation.amount).toBe(0);
});

test('Bounces in last 12 months -> lower band indicated', () => {
  expect(evaluateBank(policy, { ...base, credit: { bouncesLast12m: 2 } }).risk.band).toBe('lower');
});

test('Tata Capital as TCL is BT-able; word-start matching', () => {
  const r = evaluateBank(policy, { ...base, loans: [
    { id: 'tcl', lender: 'TCL', productType: 'PL', outstanding: 300000, emi: 12000, emisPaid: 8, emisRemaining: 30 },
    { id: 'tcap', lender: 'TATA CAPITAL LTD', productType: 'PL', outstanding: 300000, emi: 12000, emisPaid: 8, emisRemaining: 30 },
    { id: 'hot', lender: 'HOTCLUB FINANCE', productType: 'PL', outstanding: 300000, emi: 12000, emisPaid: 8, emisRemaining: 30 },
  ] });
  const ok = Object.fromEntries(r.obligations.loans.map((l) => [l.id, l.bt.ok]));
  expect(ok).toEqual({ tcl: true, tcap: true, hot: false });
});

test('Agent treatment: obligate excludes from BT, bt forces it into every scenario', () => {
  const loans = [
    { id: 'icici', lender: 'ICICI BANK', productType: 'PL', outstanding: 150000, emi: 32000, emisPaid: 5, emisRemaining: 40, treatment: 'bt' },
    { id: 'axis', lender: 'AXIS BANK', productType: 'PL', outstanding: 500000, emi: 15000, emisPaid: 10, emisRemaining: 30, treatment: 'obligate' },
    { id: 'hdb', lender: 'BAJAJ FINANCE', productType: 'PL', outstanding: 100000, emi: 5000, emisPaid: 12, emisRemaining: 20 },
  ];
  const r = evaluateBank(policy, { ...base, loans });
  expect(r.scenarios.length).toBe(2);
  r.scenarios.forEach((s) => { expect(s.bt).toContain('icici'); expect(s.bt).not.toContain('axis'); });
  const w = evaluateBank(policy, { ...base, loans: [{ id: 'kb', lender: 'KREDITBEE', productType: 'PL', outstanding: 30000, emi: 5000, emisPaid: 8, emisRemaining: 4, treatment: 'bt' }] });
  expect(w.warnings.join()).toMatch(/not BT-able/);
});

test('Final amount carries its own ROI and what limited it', () => {
  const r = evaluateBank(policy, base);
  const s = r.scenarios.find((x) => x.bt.join() === 'icici');
  expect(s.limitedBy).toBe('multiplier');          // 20.25L multiplier < 21.18L FOIR
  expect(s.conservativeAmount).toBe(2025000);
  expect(s.conservativeRoi).toBe(10.25);   // HDFC Diwali offer
});

import icici from './icici_pl_policy.json';

const iBase = {
  netSalary: 100000, salaryAccountBank: 'HDFC Bank', cibilScore: 780,
  company: { categoriesByBank: { icici: 'Preferred', hdfc_bank: 'CAT A' }, categoryConfirmed: true },
  loans: [
    { id: 'bajaj', lender: 'BAJAJ FIN LTD', productType: 'PL', outstanding: 200000, emi: 10000, emisPaid: 7, emisRemaining: 30 },
    { id: 'kb', lender: 'KRAZYBEE SERVICES', productType: 'PL', outstanding: 30000, emi: 5000, emisPaid: 9, emisRemaining: 3 },
    { id: 'hl', lender: 'SBI', productType: 'HL', emi: 20000, isJoint: true, hlEmiPaidBy: 'co_applicant' },
  ],
  cards: [{ issuer: 'AXIS BANK', outstanding: 50000, paidBeforeLoginWithProof: 50000 }, { issuer: 'ICICI BANK', outstanding: 20000, paidBeforeLoginWithProof: 20000 }],
  credit: { enquiries90d: 4 },
};

test('ICICI: FOIR only, score-based ROI, BT all NBFC except fintech, CC 8%, joint HL paid by co-applicant = 0', () => {
  const r = evaluateBank(icici, iBase);
  expect(r.status).toBe('ELIGIBLE');
  expect(r.foirPct).toBe(70);
  const bt = Object.fromEntries(r.obligations.loans.map((l) => [l.id, l.bt.ok]));
  expect(bt).toEqual({ bajaj: true, kb: false, hl: false });
  expect(r.obligations.loans.find((l) => l.id === 'hl').obligation.amount).toBe(0);
  // Axis paydown ignored (must reflect in CIBIL), ICICI card paydown accepted: 8% of 50,000
  expect(r.obligations.cards.amount).toBe(4000);
  const s = r.scenarios.find((x) => x.bt.join() === 'bajaj');
  // obligations = KreditBee 5000 + CC 4000 ; EMI room = 70000 - 9000 = 61000
  expect(s.obligations).toBe(9000);
  expect(s.foir[60].roi).toBe(10.35);   // ICICI Nov offer, CIBIL 775+, 15L+
  expect(Object.keys(s.foir)).toEqual(['60']);
  expect(s.multiplier).toEqual({});
});

test('ICICI: score band changes ROI, enquiries over 6 is a deviation, 3L salary adds 6 and 7 years, cap 1.25 Cr', () => {
  const low = evaluateBank(icici, { ...iBase, cibilScore: 740 });
  expect(low.best.foir[60].roi).toBe(11.29);
  const dev = evaluateBank(icici, { ...iBase, credit: { enquiries90d: 8 } });
  expect(dev.status).toBe('DEVIATION');
  const rich = evaluateBank(icici, { ...iBase, netSalary: 400000, loans: [], cards: [] });
  expect(Object.keys(rich.best.foir)).toEqual(['60', '72', '84']);
  expect(rich.best.conservativeAmount).toBe(12500000);
  expect(evaluateBank(icici, { ...iBase, netSalary: 39000 }).status).toBe('NOT_ELIGIBLE');
});

test('HDFC: card late payment does not lower band; late payment on HDFC PL rejects; only PL with outstanding is BT', () => {
  const card = evaluateBank(policy, { ...base, credit: { dpdAccounts: [{ lender: 'AXIS BANK', productType: 'CC', inLast12m: true }] } });
  expect(card.risk.band).toBe('better');
  expect(card.notes.join()).toMatch(/still does the case/);
  // 27 Oct: a single late payment on any HDFC account is the banker's call; multiple ones decline
  const ownCard = evaluateBank(policy, { ...base, credit: { dpdAccounts: [{ lender: 'HDFC BANK', productType: 'CC', inLast12m: true }] } });
  expect(ownCard.status).toBe('DEVIATION');
  const ownPl = evaluateBank(policy, { ...base, credit: { dpdAccounts: [{ lender: 'HDFC BANK LTD', productType: 'PL', inLast12m: false, count12m: 3 }] } });
  expect(ownPl.status).toBe('NOT_ELIGIBLE');
  const plLate = evaluateBank(policy, { ...base, credit: { dpdAccounts: [{ lender: 'SBI', productType: 'PL', inLast12m: true }] } });
  expect(plLate.risk.band).toBe('lower');
  const bt = evaluateBank(policy, { ...base, loans: [
    { id: 'cd', lender: 'BAJAJ FIN LTD', productType: 'CONSUMER', outstanding: 20000, emi: 2000, emisPaid: 8, emisRemaining: 5 },
    { id: 'zero', lender: 'BAJAJ FIN LTD', productType: 'PL', outstanding: 0, emi: 3000, emisPaid: 20, emisRemaining: 5 },
    { id: 'pl', lender: 'TCL', productType: 'PL', outstanding: 384000, emi: 12000, emisPaid: 10, emisRemaining: 30 },
  ] });
  expect(Object.fromEntries(bt.obligations.loans.map((l) => [l.id, l.bt.ok]))).toEqual({ cd: false, zero: false, pl: true });
});

test('Card plan: closes fewest cards to get under salary and shows the gain; missing EMI needs input', () => {
  const r = evaluateBank(policy, { ...base, cards: [
    { id: 'c1', issuer: 'SBI CARD', outstanding: 150000 }, { id: 'c2', issuer: 'YES BANK', outstanding: 250000 }, { id: 'c3', issuer: 'KOTAK BANK', outstanding: 9000 },
  ] });
  // total 4.09L vs salary 1L -> need 3.09L -> close YES (2.5L) + SBI (1.5L)
  expect(r.cardPlan.minPaydown).toBe(309000);
  expect(r.cardPlan.closeCards).toEqual(['c2', 'c1']);
  expect(r.cardPlan.gain).toBeGreaterThan(0);
  expect(r.warnings[0]).toMatch(/^Close YES BANK, SBI CARD/);
  const m = evaluateBank(policy, { ...base, loans: [...base.loans, { id: 'vivi', lender: 'VIVIFIN', productType: 'PL', outstanding: 48202, emi: 0, emisPaid: 9 }] });
  expect(m.status).toBe('NEEDS_INPUT');
  expect(m.missingEmi).toEqual(['vivi']);
  const ab = evaluateBank(policy, { ...base, loans: [{ id: 'ab', lender: 'ADBIRLACAP', productType: 'PL', outstanding: 144000, emi: 7757, emisPaid: 7, emisRemaining: 20 }] });
  expect(ab.obligations.loans[0].bt.ok).toBe(true);
});

test('Own-bank PL enquiry within 30 days blocks only that bank', () => {
  const credit = { enquiries90d: 3, enquiryList: [
    { lender: 'HDFC BANK', product: 'Personal Loan', daysAgo: 12 },
    { lender: 'ICICI BANK', product: 'Credit Card', daysAgo: 5 },
    { lender: 'ICICI BANK', product: 'Personal Loan', daysAgo: 45 },
  ] };
  const h = evaluateBank(policy, { ...base, credit });
  expect(h.status).toBe('NOT_ELIGIBLE');
  expect(h.reasons[0]).toMatch(/HDFC Bank enquiry 12 day\(s\) ago.*18 more/);
  expect(h.eligibleAfterWait).toBe(true);
  expect(h.waitDays).toBe(18);
  expect(h.best.conservativeAmount).toBeGreaterThan(0);   // figures still shown for after the wait
  const i = evaluateBank(icici, { ...iBase, credit });
  expect(i.reasons.join()).not.toMatch(/enquiry .* day/);
});

test('ICICI enquiry limit counts personal loan enquiries only (auto loan / card ignored)', () => {
  const list = [
    ...Array.from({ length: 4 }, (_, i) => ({ lender: 'BAJAJ FIN', product: 'Personal Loan', daysAgo: 10 + i })),
    { lender: 'TATA MOTORS FIN', product: 'Auto Loan (Personal)', daysAgo: 20 },
    { lender: 'SBI CARD', product: 'Credit Card', daysAgo: 25 },
    { lender: 'AXIS BANK', product: 'Credit Card', daysAgo: 40 },
  ];
  const r = evaluateBank(icici, { ...iBase, credit: { enquiries90d: 7, enquiryList: list } });
  expect(r.status).toBe('ELIGIBLE');   // 4 PL enquiries, not 7
  const many = [...list, ...Array.from({ length: 3 }, () => ({ lender: 'NAVI', product: 'Personal Loan', daysAgo: 50 }))];
  const d = evaluateBank(icici, { ...iBase, credit: { enquiries90d: 10, enquiryList: many } });
  expect(d.status).toBe('DEVIATION');
  expect(d.deviations[0]).toMatch(/^7 Personal Loan enquiries in 90 days/);
});

test('BT lists: Vivifin never, Hero FinCorp only with foreclosure letter, ICICI takes Poonawalla, OD confirmation', () => {
  const loans = [
    { id: 'vivi', lender: 'VIVIFIN', productType: 'PL', outstanding: 48000, emi: 4000, emisPaid: 9, emisRemaining: 10 },
    { id: 'hero', lender: 'HERO FINCORP', productType: 'PL', outstanding: 288000, emi: 15149, emisPaid: 26, emisRemaining: 22 },
    { id: 'pfl', lender: 'POONAWALLA FINCORP', productType: 'PL', outstanding: 200000, emi: 8000, emisPaid: 10, emisRemaining: 20 },
    { id: 'tcl', lender: 'TCL', productType: 'PL', outstanding: 384000, emi: 10561, emisPaid: 28, emisRemaining: 22 },
  ];
  const ok = (r) => Object.fromEntries(r.obligations.loans.map((l) => [l.id, l.bt.ok]));
  const i = evaluateBank(icici, { ...iBase, loans });
  expect(ok(i)).toEqual({ vivi: false, hero: false, pfl: true, tcl: true });
  expect(i.notes.join()).toMatch(/HERO FINCORP: can be taken in BT once the foreclosure letter/);
  expect(i.warnings[0]).toMatch(/^Confirm .*TCL.* not OD/);
  const h = evaluateBank(policy, { ...base, loans });
  expect(ok(h)).toEqual({ vivi: false, hero: false, pfl: false, tcl: true });
  const withLetter = evaluateBank(policy, { ...base, loans: loans.map((l) => (l.id === 'hero' ? { ...l, foreclosureLetter: true } : l)) });
  expect(ok(withLetter).hero).toBe(true);
  const odNoEmi = evaluateBank(icici, { ...iBase, loans: loans.map((l) => (l.id === 'tcl' ? { ...l, odStatus: 'od_no_emi' } : l)) });
  expect(ok(odNoEmi).tcl).toBe(false);
  const confirmed = evaluateBank(icici, { ...iBase, loans: loans.map((l) => (l.id === 'tcl' ? { ...l, odStatus: 'term' } : l)) });
  expect(confirmed.odConfirm).not.toContain('tcl');
});

import kotak from './kotak_pl_policy.json';

test('Kotak: HL obligated gives FOIR 75%, scorecard Red declines, 30-day enquiry cap, recent loan DPD rejects', () => {
  const kBase = { ...base, company: { categoriesByBank: { kotak: 'CAT A' } }, credit: { enquiryList: [] } };
  const r = evaluateBank(kotak, kBase);           // HL 25,000 counted in full, salary 1L
  expect(r.foirPct).toBe(75);
  const coPays = evaluateBank(kotak, { ...kBase, loans: kBase.loans.map((l) => (l.id === 'hl' ? { ...l, isJoint: true, hlEmiPaidBy: 'co_applicant' } : l)) });
  expect(coPays.foirPct).toBe(70);
  expect(evaluateBank(kotak, { ...kBase, scorecardByBank: { kotak: 'Red' } }).status).toBe('NOT_ELIGIBLE');
  const enq = Array.from({ length: 7 }, (_, i) => ({ lender: 'X', product: 'Personal Loan', daysAgo: 3 + i }));
  expect(evaluateBank(kotak, { ...kBase, credit: { enquiryList: enq } }).reasons[0]).toMatch(/7 Personal Loan enquiries in 30 days/);
  expect(evaluateBank(kotak, { ...kBase, credit: { enquiryList: [], dpdAccounts: [{ lender: 'SBI', productType: 'PL', inLast12m: true }] } }).status).toBe('NOT_ELIGIBLE');
});

test('Subject-to-closure plan suggests closing a small high-EMI loan', () => {
  const kBase = { ...base, company: { categoriesByBank: { kotak: 'CAT A' } }, credit: { enquiryList: [] },
    loans: [...base.loans, { id: 'kb', lender: 'KRAZYBEE', productType: 'PL', outstanding: 40000, emi: 9582, emisPaid: 4, emisRemaining: 8 }] };
  const r = evaluateBank(kotak, kBase);
  expect(r.closurePlan.map((c) => c.id)).toContain('kb');
  expect(r.notes.join()).toMatch(/Subject to closure of KRAZYBEE/);
});

test('Lower of FOIR and multiplier (25 Nov 2026): a multiplier below BT POS cannot be carried by FOIR', () => {
  // salary 1L, CAT A; BT loans large enough that multiplier < BT POS but FOIR > BT POS
  const loans = [
    { id: 'tcl', lender: 'TCL', productType: 'PL', outstanding: 1400000, emi: 15000, emisPaid: 28, emisRemaining: 40, odStatus: 'term' },
    { id: 'icici', lender: 'ICICI BANK', productType: 'PL', outstanding: 1477160, emi: 20000, emisPaid: 20, emisRemaining: 40 },
  ];
  const r = evaluateBank(policy, { ...base, loans });
  const s = r.scenarios.find((x) => x.bt.length === 2);
  const by = Object.fromEntries(s.methods.map((m) => [m.key, m]));
  expect(Object.keys(by)).toEqual(['foir_60', 'foir_72', 'multiplier']);
  expect(by.multiplier.netInHand).toBeLessThan(0);
  expect(by.foir_60.netInHand).toBeGreaterThan(0);
  expect(s.eligibleBy).toBe('multiplier');   // lower of FOIR and multiplier
  expect(s.netInHand).toBeLessThan(0);
  expect(r.best.eligibleRule).toBe('lower');
  expect(r.best.bt).toEqual([]);   // so the best plan is without BT
  expect(r.status).toBe('ELIGIBLE');
});

test('Kotak: category/salary ROI, scorecard multiplier for all cards until one is chosen, manual category', () => {
  const kBase = { ...base, loans: [{ id: 'hl', lender: 'SBI', productType: 'HL', emi: 25000, emisPaid: 50, emisRemaining: 150 }],
    company: { categoriesByBank: { kotak: 'CAT A' } }, credit: { enquiryList: [] } };
  const r = evaluateBank(kotak, kBase);   // salary 1L, obligations 25k
  const ms = r.best.methods.filter((m) => m.key.startsWith('multiplier_'));
  expect(ms.map((m) => m.multiplier)).toEqual([19, 17, 15, 12]);    // 50K-1L column, all scorecards
  expect(ms.every((m) => m.indicative)).toBe(true);
  expect(r.best.eligibleBy).toBe('multiplier_amber');               // no scorecard picked: lowest band, lower of FOIR & multiplier (25 Nov)
  expect(r.notes.join()).toMatch(/scorecard not picked — lowest band/);
  expect(r.best.methods.find((m) => m.key === 'foir_60').roi).toBe(10.04);   // Kotak Nov offer
  const g = evaluateBank(kotak, { ...kBase, scorecardByBank: { kotak: 'Green' } });
  const gm = g.best.methods.filter((m) => m.key.startsWith('multiplier_'));
  expect(gm.length).toBe(1);
  expect(gm[0].amount).toBe(100000 * 17);   // Kotak: salary x M, obligations not deducted
  const c = evaluateBank(kotak, { ...kBase, company: { categoriesByBank: { kotak: 'CAT C' } } });
  expect(c.best.methods.find((m) => m.key === 'foir_60').roi).toBe(11);
  const none = evaluateBank(kotak, { ...kBase, company: { categoriesByBank: {} } });
  expect(none.reasons[0]).toMatch(/Enter the Kotak Mahindra Bank company category/);
});

test('Kotak: 2L salary, Super green -> 2,00,000 x 21 = 42,00,000; CAT D rate 13%', () => {
  const r = evaluateBank(kotak, { ...base, netSalary: 200000, loans: [], company: { categoriesByBank: { kotak: 'CAT D' } },
    scorecardByBank: { kotak: 'Super green' }, credit: { enquiryList: [] } });
  const m = r.best.methods.find((x) => x.key.startsWith('multiplier_'));
  expect(m.amount).toBe(4200000);
  expect(r.best.methods.find((x) => x.key === 'foir_60').roi).toBe(13);
});

test('Kotak below 10L rates by category', () => {
  const run = (cat, salary) => evaluateBank(kotak, { ...base, netSalary: salary, loans: [], cards: [],
    company: { categoriesByBank: { kotak: cat } }, credit: { enquiryList: [] } })
    .best.methods.find((x) => x.key === 'foir_60');
  expect(run('CAT A', 36000).roi).toBe(11.5);    // 36K salary -> loan 5–10L, Kotak Nov offer
  expect(run('CAT C', 36000).roi).toBe(12.5);
  expect(run('CAT D', 36000).roi).toBe(14);
  expect(run('CAT A', 60000).roi).toBe(10.04);   // 60K salary -> 15L+ at 10.04 (Nov offer)
});

test('Kotak scorecard FOIR: Yellow 60% / 65% with HL, Green no HL 70% 5y, Amber 50% capped 7.5L', () => {
  const run = (sc, loans, salary = 100000) => evaluateBank(kotak, { ...base, netSalary: salary, loans, cards: [],
    company: { categoriesByBank: { kotak: 'CAT A' } }, scorecardByBank: { kotak: sc }, credit: { enquiryList: [] } });
  const hl = [{ id: 'hl', lender: 'SBI', productType: 'HL', outstanding: 2000000, emi: 25000, emisPaid: 50, emisRemaining: 150 }];
  expect(run('Yellow', []).foirPct).toBe(60);
  expect(run('Yellow', hl).foirPct).toBe(65);
  const g = run('Green', []);
  expect(g.foirPct).toBe(70);
  expect(g.best.methods.filter((m) => m.key.startsWith('foir')).map((m) => m.key)).toEqual(['foir_60']);
  const a = run('Amber', [], 300000);
  expect(a.foirPct).toBe(50);
  expect(Math.max(...a.best.methods.map((m) => m.amount))).toBe(750000);
});

test('Own-bank loan is closed through top-up, not BT (Vijay case: HDFC PL at HDFC)', () => {
  const loans = [
    { id: 'hdfc', lender: 'HDFC BANK', productType: 'PL', outstanding: 306093, emi: 12000, emisPaid: 29 },
    { id: 'axis', lender: 'AXIS BANK', productType: 'PL', outstanding: 1831135, emi: 43004, emisPaid: 30, emisRemaining: 54 },
  ];
  const r = evaluateBank(policy, { ...base, netSalary: 104534, loans });
  const own = r.obligations.loans.find((l) => l.id === 'hdfc');
  expect(own.bt.topUp).toBe(true);
  expect(own.bt.why).toMatch(/top-up/);
  expect(r.best.topUp).toEqual(['hdfc']);
  expect(r.obligations.loans.find((l) => l.id === 'axis').bt.ok).toBe(true);
  expect(r.scenarios.some((s) => s.bt.includes('axis') && s.bt.includes('hdfc'))).toBe(true);
  const i = evaluateBank(icici, { ...iBase, loans });
  expect(i.obligations.loans.find((l) => l.id === 'hdfc').bt.topUp).toBeUndefined();   // HDFC loan at ICICI is a normal BT
});

import indusind from './indusind_pl_policy.json';

test('IndusInd: lower of FOIR and multiplier, salary-based multiplier with own house + HL bonus, groups', () => {
  const p = (extra) => ({ ...base, netSalary: 120000, loans: [], cards: [], cibilScore: 760,
    company: { categoriesByBank: { indusind: 'Cat B' } }, credit: { enquiryList: [] }, ...extra });
  const r = evaluateBank(indusind, p());
  const m = r.best.methods.find((x) => x.key === 'multiplier');
  expect(m.multiplier).toBe(25);
  expect(m.amount).toBe(120000 * 25);
  expect(r.best.eligibleRule).toBe('lower');
  expect(r.best.eligibleAmount).toBe(Math.min(m.amount, Math.max(...r.best.methods.filter((x) => x.key.startsWith('foir')).map((x) => x.amount))));
  expect(r.foirPct).toBe(65);
  const own = evaluateBank(indusind, p({ ownHouse: true, loans: [{ id: 'hl', lender: 'SBI', productType: 'HL', outstanding: 3000000, emi: 30000, emisPaid: 40 }] }));
  expect(own.foirPct).toBe(75);   // own house + live home loan
  expect(own.best.methods.find((x) => x.key === 'multiplier').multiplier).toBe(28);
  const c = evaluateBank(indusind, p({ company: { categoriesByBank: { indusind: 'CAT C1000' } } }));
  expect(c.best.methods.filter((x) => x.key.startsWith('foir')).map((x) => x.tenure)).toEqual([48]);
  expect(evaluateBank(indusind, p({ cibilScore: 690 })).status).toBe('NOT_ELIGIBLE');
});

test('IndusInd: unlisted company, first-time borrower cap, DPD window, OD 2%, lock-in, conflict lenders', () => {
  const p = (extra) => ({ ...base, netSalary: 60000, loans: [], cards: [], cibilScore: 760,
    company: { categoriesByBank: {} }, credit: { enquiryList: [] }, ...extra });
  expect(evaluateBank(indusind, p()).reasons[0]).toMatch(/year of incorporation/);
  expect(evaluateBank(indusind, p({ company: { categoriesByBank: {}, incorporationYear: new Date().getFullYear() - 1 } })).status).toBe('NOT_ELIGIBLE');
  const u = evaluateBank(indusind, p({ company: { categoriesByBank: {}, incorporationYear: 2015 } }));
  expect(u.status).not.toBe('NOT_ELIGIBLE');
  expect(u.best.eligibleAmount).toBeLessThanOrEqual(1000000);
  expect(u.best.methods.find((x) => x.key.startsWith('foir')).tenure).toBe(36);
  const ftb = evaluateBank(indusind, p({ company: { categoriesByBank: { indusind: 'CAT A' } }, cibilScore: -1, netSalary: 150000 }));
  expect(ftb.best.eligibleAmount).toBeLessThanOrEqual(500000);
  const dpd = (monthsAgo) => evaluateBank(indusind, p({ company: { categoriesByBank: { indusind: 'CAT A' } },
    credit: { enquiryList: [], dpdAccounts: [{ lender: 'SBI', productType: 'PL', monthsAgo, inLast12m: true }] } }));
  expect(dpd(2).status).toBe('NOT_ELIGIBLE');
  expect(dpd(5).status).toBe('DEVIATION');
  expect(dpd(9).status).toBe('ELIGIBLE');
  const ob = evaluateBank(indusind, p({ company: { categoriesByBank: { indusind: 'CAT A' } }, loans: [
    { id: 'od', lender: 'AXIS BANK', productType: 'OD', outstanding: 100000 },
    { id: 'tcl', lender: 'TCL', productType: 'PL', outstanding: 200000, emi: 8000, emisPaid: 20 },
    { id: 'hdb', lender: 'HDB FINANCIAL', productType: 'PL', outstanding: 200000, emi: 8000, emisPaid: 4 },
  ] }));
  expect(ob.obligations.loans.find((l) => l.id === 'od').obligation.amount).toBe(2000);
  expect(ob.obligations.loans.find((l) => l.id === 'tcl').bt.ok).toBe(true);   // confirmed 27 Oct
  expect(ob.obligations.loans.find((l) => l.id === 'hdb').bt.ok).toBe(true);
  const lock = evaluateBank(policy, { ...base, loans: [{ id: 'ib', lender: 'INDUSIND BANK', productType: 'PL', outstanding: 300000, emi: 10000, emisPaid: 8 }] });
  expect(lock.obligations.loans[0].bt.why).toMatch(/IndusInd Bank lock-in/);
});

import lt from './lt_pl_policy.json';

test('L&T: FOIR by NTH x CIBIL x category, lower of FOIR & multiplier, city minimum, other income, caps', () => {
  const p = (extra) => ({ ...base, loans: [], cards: [], cibilScore: 760, city: 'Pune', company: { categoriesByBank: { lt: 'CAT C' } },
    credit: { enquiryList: [] }, ...extra });
  const c = evaluateBank(lt, p({ netSalary: 120000 }));
  expect(c.foirPct).toBe(70);                                   // CAT C, 1L-2L, CIBIL >720
  const m = c.best.methods.find((x) => x.key === 'multiplier');
  expect(m.multiplier).toBe(20);
  expect(c.best.eligibleRule).toBe('lower');
  expect(evaluateBank(lt, p({ netSalary: 120000, cibilScore: 705 })).status).toBe('NOT_ELIGIBLE');   // min CIBIL 720
  const top = evaluateBank(lt, p({ netSalary: 120000, company: { categoriesByBank: { lt: 'Super CAT A' } } }));
  expect(top.best.methods.some((x) => x.key === 'multiplier')).toBe(false);   // NA above 50K
  expect(top.best.methods.filter((x) => x.key.startsWith('foir')).map((x) => x.tenure)).toEqual([60, 72]);
  expect(evaluateBank(lt, p({ netSalary: 30000, city: 'Mumbai' })).status).toBe('NOT_ELIGIBLE');   // Mumbai min 35K
  expect(evaluateBank(lt, p({ netSalary: 30000, city: 'Nagpur' })).status).not.toBe('NOT_ELIGIBLE');
  // rental: 50% below 1L, 100% at 1L+, capped at salary; only when verified
  const r1 = evaluateBank(lt, p({ netSalary: 80000, otherIncome: { rentMonthly: 30000, rentVerified: true } }));
  expect(r1.otherIncome.total).toBe(15000);
  const r2 = evaluateBank(lt, p({ netSalary: 120000, otherIncome: { rentMonthly: 30000, rentVerified: true, bonusAnnualNet: 240000 } }));
  expect(r2.otherIncome.lines.map((l) => [l.key, l.amount])).toEqual([['bonus', 10000], ['rent', 30000]]);
  expect(evaluateBank(lt, p({ netSalary: 80000, otherIncome: { rentMonthly: 30000 } })).otherIncome.total).toBe(0);
  // NTC -1: CAT A capped at 10L, CAT C at 5L; govt class 3 capped at 7L
  expect(evaluateBank(lt, p({ netSalary: 150000, cibilScore: -1, company: { categoriesByBank: { lt: 'CAT A' } } })).best.eligibleAmount).toBeLessThanOrEqual(1000000);
  expect(evaluateBank(lt, p({ netSalary: 150000, cibilScore: -1 })).best.eligibleAmount).toBeLessThanOrEqual(500000);
  expect(evaluateBank(lt, p({ netSalary: 150000, govtClass3: true, company: { categoriesByBank: { lt: 'Govt' } } })).best.eligibleAmount).toBeLessThanOrEqual(700000);
  // max loan by salary: 25-50K capped at 10L
  expect(evaluateBank(lt, p({ netSalary: 45000, company: { categoriesByBank: { lt: 'CAT A' } } })).best.eligibleAmount).toBeLessThanOrEqual(1000000);
  // loan late payment within 6 months rejects
  expect(evaluateBank(lt, p({ netSalary: 120000, credit: { enquiryList: [], dpdAccounts: [{ lender: 'SBI', productType: 'PL', monthsAgo: 4 }] } })).status).toBe('NOT_ELIGIBLE');
  // own L&T loan: no top-up (23 Nov 2026) — stays as obligation
  const own = evaluateBank(lt, p({ netSalary: 120000, loans: [{ id: 'lt', lender: 'L&T FINANCE LTD', productType: 'PL', outstanding: 200000, emi: 9000, emisPaid: 10 }] }));
  expect(own.obligations.loans[0].bt.ok).toBe(false);
});

test('IndusInd: own house + live home loan at 75K+ gives FOIR 75%; Navi taken in BT; Navi needs no OD confirmation at HDFC', () => {
  const hl = { id: 'hl', lender: 'HDFC BANK', productType: 'HL', outstanding: 7263752, emi: 59610, emisPaid: 8, emisRemaining: 232 };
  const navi = { id: 'navi', lender: 'NAVI', productType: 'PL', outstanding: 1314664, emi: 46500, emisPaid: 8, emisRemaining: 42 };
  const p = { ...base, netSalary: 250000, ownHouse: true, loans: [hl, navi], cards: [], cibilScore: 780,
    company: { categoriesByBank: { indusind: 'CAT A', hdfc_bank: 'CAT A' } }, credit: { enquiryList: [] } };
  const r = evaluateBank(indusind, p);
  expect(r.foirPct).toBe(75);
  expect(r.obligations.loans.find((l) => l.id === 'navi').bt.ok).toBe(true);
  expect(evaluateBank(indusind, { ...p, loans: [navi] }).foirPct).toBe(70);   // own house, no home loan
  const h = evaluateBank(policy, p);
  expect(h.obligations.loans.find((l) => l.id === 'navi').bt.odUnconfirmed).toBe(false);
});

test('No card-closing suggestion when it would not raise eligibility; Kisetsu (Credit Saison) not BT at L&T', () => {
  const r = evaluateBank(icici, { ...iBase, netSalary: 50000,
    loans: [{ id: 'big', lender: 'SBI', productType: 'HL', emi: 60000, emisPaid: 20, emisRemaining: 200 }],
    cards: [{ id: 'c1', issuer: 'ICICI BANK', outstanding: 11425 }] });
  expect(r.cardPlan).toBeUndefined();
  expect(r.warnings.join()).not.toMatch(/^Close /);
  const l = evaluateBank(indusind, { ...base, netSalary: 87867, cibilScore: 777, company: { categoriesByBank: { indusind: 'CAT A' } }, credit: { enquiryList: [] },
    loans: [{ id: 'k', lender: 'KISETSU', productType: 'PL', outstanding: 104693, emi: 9617, emisPaid: 13, emisRemaining: 11 }] });
  expect(l.obligations.loans[0].bt.ok).toBe(false);
});

test('27 Oct updates: HDFC both, multiple HDFC lates, HDFC BL, co-applicant, closure before login; ICICI <10L 13%; Kotak other income; IndusInd lenders & C1000; L&T 720', () => {
  const h = evaluateBank(policy, { ...base, credit: { dpdAccounts: [{ lender: 'HDFC BANK', productType: 'CC', inLast12m: false, count12m: 0 }] } });
  expect(h.status).toBe('DEVIATION');                                           // single HDFC late -> banker's call
  const h2 = evaluateBank(policy, { ...base, credit: { dpdAccounts: [{ lender: 'HDFC BANK', productType: 'CC', count12m: 1 }, { lender: 'HDFC BANK LTD', productType: 'PL', count12m: 2 }] } });
  expect(h2.status).toBe('NOT_ELIGIBLE');
  expect(evaluateBank(policy, { ...base, loans: [...base.loans, { id: 'bl', lender: 'HDFC BANK', productType: 'BL', outstanding: 500000, emi: 15000, emisPaid: 10 }] }).reasons.join()).toMatch(/business loan/);
  expect(evaluateBank(policy, base).best.eligibleRule).toBe('lower');   // was 'both' until 25 Nov 2026
  const co = evaluateBank(policy, { ...base, coApplicantNetSalary: 50000 });
  expect(co.foirPct).toBe(70);
  expect(co.notes.join()).toMatch(/Co-applicant income/);
  // closure before login suggested at HDFC for a small non-BT loan
  const cl = evaluateBank(policy, { ...base, loans: [...base.loans, { id: 'kb', lender: 'KREDITBEE', productType: 'PL', outstanding: 30000, emi: 8000, emisPaid: 8, emisRemaining: 5 }] });
  expect(cl.closurePlan.map((x) => x.id)).toContain('kb');
  expect(cl.closurePlan[0].mode).toBe('before_login');
  // ICICI below 10L at 13%
  const ic = evaluateBank(icici, { ...iBase, netSalary: 42000, cards: [], loans: [{ id: 'hl', lender: 'SBI', productType: 'HL', emi: 10000, emisPaid: 20, emisRemaining: 200 }] });
  expect(ic.best.methods[0].roi).toBe(13);
  // Kotak other income: bonus 50%, quarterly 70%, incentive 70%, rent 70%
  const k = evaluateBank(kotak, { ...base, loans: [], company: { categoriesByBank: { kotak: 'CAT A' } }, credit: { enquiryList: [] },
    otherIncome: { bonusAnnualNet: 120000, quarterlyIncentiveNet: 30000, monthlyIncentiveAvg6m: 10000, rentMonthly: 20000, rentVerified: true } });
  expect(k.otherIncome.lines.map((x) => [x.key, x.amount])).toEqual([['bonus', 5000], ['quarterly', 7000], ['incentive', 7000], ['rent', 14000]]);
  // IndusInd: Tata Capital now BT; C1000 75K+ 65% / own house 70%
  const ind = evaluateBank(indusind, { ...base, netSalary: 90000, cibilScore: 760, company: { categoriesByBank: { indusind: 'CAT C1000' } }, credit: { enquiryList: [] },
    loans: [{ id: 'tcl', lender: 'TCL', productType: 'PL', outstanding: 200000, emi: 8000, emisPaid: 10 }] });
  expect(ind.obligations.loans[0].bt.ok).toBe(true);
  expect(ind.foirPct).toBe(65);
  // L&T min CIBIL 720
  expect(evaluateBank(lt, { ...base, cibilScore: 705, company: { categoriesByBank: { lt: 'CAT A' } }, credit: { enquiryList: [] } }).status).toBe('NOT_ELIGIBLE');
});

test('Abhilash case at IndusInd: POONAFIN = Poonawalla (BT after 3 installments), variable pay left out, no closure suggestion that leaves money negative', () => {
  const prof = { netSalary: 221702, variablePayMonthly: 30000, cibilScore: 780, company: { categoriesByBank: { indusind: 'A+' } }, cards: [], credit: { enquiryList: [] },
    loans: [
      { id: 'pfl', lender: 'POONAFIN', productType: 'PL', outstanding: 1389377, emi: 28000, emisPaid: 3 },
      { id: 'bajaj', lender: 'BAJAJ FIN LTD', productType: 'PL', outstanding: 795962, emi: 25457, emisPaid: 6, emisRemaining: 42 },
      { id: 'axis', lender: 'AXIS BANK', productType: 'PL', outstanding: 3397596, emi: 67422, emisPaid: 17, emisRemaining: 67 }] };
  const r = evaluateBank(indusind, prof);
  expect(r.status).toBe('ELIGIBLE');
  expect(r.obligations.loans.find((l) => l.id === 'pfl').bt.ok).toBe(true);
  expect(r.notes.join()).toMatch(/variable pay ₹30,000 left out/);
  expect(r.best.netInHand).toBeGreaterThan(0);
  (r.closurePlan || []).forEach((c) => expect(c.netInHandAfterClosing).toBeGreaterThan(0));
});

import bandhan from './bandhan_pl_policy.json';

test('Bandhan (one-pager Nov 2026): FOIR 50/60/65/70, 75% at 1L+ with own house or home loan, min 30K all categories, 40L max, BT after 12, enquiries', () => {
  const p = (x) => ({ ...base, loans: [], cards: [], cibilScore: 760, company: { categoriesByBank: { bandhan: 'CAT B' } }, credit: { enquiryList: [] }, ...x });
  expect(evaluateBank(bandhan, p({ netSalary: 45000 })).foirPct).toBe(60);
  expect(evaluateBank(bandhan, p({ netSalary: 60000 })).foirPct).toBe(65);
  expect(evaluateBank(bandhan, p({ netSalary: 90000 })).foirPct).toBe(70);
  expect(evaluateBank(bandhan, p({ netSalary: 120000, ownHouse: true })).foirPct).toBe(75);
  expect(evaluateBank(bandhan, p({ netSalary: 120000, loans: [{ id: 'hl', lender: 'SBI', productType: 'HL', outstanding: 2000000, emi: 20000 }] })).foirPct).toBe(75);
  expect(evaluateBank(bandhan, p({ netSalary: 28000 })).status).toBe('NOT_ELIGIBLE');                    // min 30K
  expect(evaluateBank(bandhan, p({ netSalary: 54000, company: { categoriesByBank: { bandhan: 'CAT C' } } })).status).not.toBe('NOT_ELIGIBLE');   // CAT C 30K, not 75K
  expect(evaluateBank(bandhan, p({ netSalary: 60000, cibilScore: 720 })).status).toBe('NOT_ELIGIBLE');    // min CIBIL 730
  // max 3 unsecured loans (new loan counted), waiver up to 5
  const pls = (n) => Array.from({ length: n }, (_, i) => ({ id: 'u' + i, lender: 'SBI', productType: 'PL', outstanding: 100000, emi: 3000, emisPaid: 5, emisRemaining: 30 }));
  expect(evaluateBank(bandhan, p({ netSalary: 150000, loans: pls(2) })).status).toBe('ELIGIBLE');
  expect(evaluateBank(bandhan, p({ netSalary: 150000, loans: pls(3) })).status).toBe('DEVIATION');
  expect(evaluateBank(bandhan, p({ netSalary: 150000, loans: pls(5) })).status).toBe('NOT_ELIGIBLE');
  // rent capped so salary stays above 75% of total income (rent <= salary / 3)
  expect(evaluateBank(bandhan, p({ netSalary: 60000, otherIncome: { rentMonthly: 40000, rentVerified: true } })).otherIncome.total).toBe(19998);
  expect(evaluateBank(bandhan, p({ netSalary: 500000 })).best.eligibleAmount).toBeLessThanOrEqual(4000000);
  const bt = evaluateBank(bandhan, p({ netSalary: 120000, loans: [
    { id: 'a', lender: 'AXIS BANK', productType: 'PL', outstanding: 300000, emi: 10000, emisPaid: 11 },
    { id: 'b', lender: 'AXIS BANK', productType: 'PL', outstanding: 300000, emi: 10000, emisPaid: 12 },
    { id: 'k', lender: 'KRAZYBEE', productType: 'PL', outstanding: 50000, emi: 5000, emisPaid: 20 },
    { id: 'own', lender: 'BANDHAN BANK', productType: 'PL', outstanding: 200000, emi: 8000, emisPaid: 9 },
    { id: 'g', lender: 'MUTHOOT', productType: 'GOLD', outstanding: 300000 }] }));
  expect(Object.fromEntries(bt.obligations.loans.map((l) => [l.id, l.bt.ok]))).toEqual({ a: false, b: true, k: false, own: true, g: false });
  expect(bt.obligations.loans.find((l) => l.id === 'g').obligation.amount).toBe(0);
  const enq = (n) => evaluateBank(bandhan, p({ netSalary: 90000, credit: { enquiryList: Array.from({ length: n }, (_, i) => ({ lender: 'X', product: 'Personal Loan', daysAgo: i + 1 })) } })).status;
  expect([enq(3), enq(5), enq(7)]).toEqual(['ELIGIBLE', 'DEVIATION', 'NOT_ELIGIBLE']);   // 6+ declined unless duplicates
  const oi = evaluateBank(bandhan, p({ netSalary: 90000, otherIncome: { quarterlyIncentiveNet: 30000, rentMonthly: 20000, rentVerified: true, bonusAnnualNet: 120000 } }));
  expect(oi.otherIncome.lines.map((l) => [l.key, l.amount])).toEqual([['quarterly', 5000], ['rent', 20000]]);
});
test('Bandhan NTC: score 1-18 counts as NTC (not a low score); Govt class I/II gets 5L', () => {
  const b = { ...bandhan, eligibility: { ...bandhan.eligibility, foir_slabs: [{ salary_min_incl: 0, salary_max_excl: null, foir_pct: 60 }] } };
  const p = (x) => ({ ...base, loans: [], cards: [], city: 'Pune', netSalary: 150000, company: { categoriesByBank: { bandhan: 'CAT B' } }, credit: { enquiryList: [] }, ...x });
  const r = evaluateBank(b, p({ cibilScore: 5 }));
  expect(r.status).toBe('ELIGIBLE');
  expect(r.best.eligibleAmount).toBeLessThanOrEqual(300000);
  expect(evaluateBank(b, p({ cibilScore: 5, govtClass12: true })).best.eligibleAmount).toBeLessThanOrEqual(500000);
  expect(evaluateBank(b, p({ cibilScore: 5, govtClass12: true })).best.eligibleAmount).toBeGreaterThan(300000);
  expect(evaluateBank(b, p({ cibilScore: 690 })).status).toBe('NOT_ELIGIBLE');
});

test('Bandhan pricing grid below 10L by category x salary x CIBIL', () => {
  const run = (cat, salary, score, emi) => evaluateBank(bandhan, { ...base, netSalary: salary, cibilScore: score, loans: [{ id: 'hl', lender: 'SBI', productType: 'HL', emi, emisPaid: 20, emisRemaining: 200 }], cards: [],
    company: { categoriesByBank: { bandhan: cat } }, credit: { enquiryList: [] } }).best.methods[0].roi;
  expect(run('CAT A', 60000, 780, 25000)).toBe(12.15);
  expect(run('CAT B', 45000, 740, 12000)).toBe(14.49);
  expect(run('CAT D', 45000, 760, 12000)).toBe(15.49);
  expect(run('CAT B', 60000, -1, 25000)).toBe(14.49);   // NTC priced in the 650-699 / 0 / -1 column
});

import yes from './yes_pl_policy.json';

test('Yes Bank: bureau tier FOIR/multiplier grids, HL-only multiplier base, rack rate by tier city, BT max 3 (5 deviation), enquiries', () => {
  const p = (x) => ({ ...base, loans: [], cards: [], cibilScore: 760, city: 'Pune', company: { categoriesByBank: { yes: 'Gold' } },
    credit: { enquiryList: [], servedLoanAmount: 1200000 }, ...x });
  const st = evaluateBank(yes, p({ netSalary: 120000 }));
  expect(st.bureauTier).toBe('super_thick');
  expect(st.foirPct).toBe(75);
  expect(st.best.methods.find((m) => m.key === 'multiplier').multiplier).toBe(30);
  expect(st.best.eligibleRule).toBe('lower');   // was 'both' until 25 Nov 2026
  const thin = evaluateBank(yes, p({ netSalary: 120000, credit: { enquiryList: [], servedLoanAmount: 300000 } }));
  expect(thin.bureauTier).toBe('thin');
  expect(thin.best.methods.find((m) => m.key === 'multiplier').multiplier).toBe(28);
  expect(evaluateBank(yes, p({ netSalary: 120000, cibilScore: -1 })).foirPct).toBe(50);
  const s = evaluateBank(yes, p({ netSalary: 50000, company: { categoriesByBank: { yes: 'Silver Neo' } }, credit: { enquiryList: [], servedLoanAmount: 600000 } }));
  expect(s.foirPct).toBe(60);
  // multiplier base (25 Nov 2026): salary minus ALL obligations (HL 50% joint = 10,000 + PL 10,000)
  const hl = evaluateBank(yes, p({ netSalary: 120000, loans: [{ id: 'hl', lender: 'SBI', productType: 'HL', emi: 20000, emisPaid: 30, emisRemaining: 200, isJoint: true }, { id: 'pl', lender: 'XYZ', productType: 'PL', outstanding: 100000, emi: 10000, emisPaid: 2, emisRemaining: 20 }] }));
  expect(hl.best.methods.find((m) => m.key === 'multiplier').amount).toBe((120000 - 10000 - 10000) * 30);
  // rates: Pune tier 1, loan under 10L, CIBIL 730+
  const r = evaluateBank(yes, p({ netSalary: 40000, loans: [{ id: 'x', lender: 'SBI', productType: 'HL', emi: 12000, emisPaid: 30, emisRemaining: 200 }] }));
  expect(r.best.methods[0].roi).toBe(14.0);
  expect(evaluateBank(yes, p({ netSalary: 40000, city: 'Nashik', loans: [{ id: 'x', lender: 'SBI', productType: 'HL', emi: 12000, emisPaid: 30, emisRemaining: 200 }] })).best.methods[0].roi).toBe(14.5);
  // BT count
  const loans = Array.from({ length: 6 }, (_, i) => ({ id: 'b' + i, lender: 'AXIS BANK', productType: 'PL', outstanding: 100000, emi: 5000, emisPaid: 10, emisRemaining: 20 }));
  const bt = evaluateBank(yes, p({ netSalary: 150000, loans }));
  expect(bt.scenarios.every((sc) => sc.bt.length <= 5)).toBe(true);
  if (bt.best.bt.length > 3) expect(bt.status).toBe('DEVIATION');
  const enq = (n) => evaluateBank(yes, p({ netSalary: 120000, credit: { servedLoanAmount: 1200000, enquiryList: Array.from({ length: n }, (_, i) => ({ lender: 'X', product: 'Personal Loan', daysAgo: i + 1 })) } })).status;
  expect([enq(3), enq(4)]).toEqual(['ELIGIBLE', 'NOT_ELIGIBLE']);
  expect(evaluateBank(yes, p({ company: { categoriesByBank: { yes: 'Delisted' } } })).status).toBe('NOT_ELIGIBLE');
});

test('Joint home loan paid by both: 50% (IndusInd 100%, Yes 50% whoever pays)', () => {
  const hl = { id: 'hl', lender: 'AXIS BANK', productType: 'HL', outstanding: 13142198, emi: 118041, emisPaid: 18, emisRemaining: 196, isJoint: true, hlEmiPaidBy: 'both' };
  const o = (pol, cat) => evaluateBank(pol, { ...base, netSalary: 300000, loans: [hl], cards: [], cibilScore: 780,
    company: { categoriesByBank: { [pol.bank_id || 'hdfc_bank']: cat } }, credit: { enquiryList: [] } }).obligations.loans[0].obligation.amount;
  expect(o(policy, 'CAT A')).toBeCloseTo(59020.5);
  expect(o(icici, 'Elite')).toBeCloseTo(59020.5);
  expect(o(indusind, 'CAT A')).toBeCloseTo(59020.5);   // 7 Nov: 50% when paid by both
  expect(o(yes, 'Gold')).toBeCloseTo(59020.5);
});

test('Obligations are still returned when a bank declines (counted column never blank)', () => {
  const r = evaluateBank(lt, { ...base, cibilScore: 700, company: { categoriesByBank: { lt: 'CAT A' } }, credit: { enquiryList: [] } });
  expect(r.status).toBe('NOT_ELIGIBLE');
  expect(r.obligations.loans.find((l) => l.id === 'hl').obligation.amount).toBe(25000);
  expect(r.obligations.cards).toBeDefined();
});

import pfl from './poonawalla_pl_policy.json';

test('Poonawalla: FOIR by income segment x category x risk, 7-year with +0.50%, card & app-loan BT with rate add-on, city cap', () => {
  const p = (x) => ({ ...base, loans: [], cards: [], cibilScore: 760, city: 'Pune', company: { categoriesByBank: { poonawalla_fincorp: 'CAT A' } }, credit: { enquiryList: [] }, ...x });
  const a = evaluateBank(pfl, p({ netSalary: 120000 }));
  expect(a.foirPct).toBe(75);                                         // Affluent, CAT A, VL/L
  expect(a.best.methods.map((m) => m.tenure)).toEqual([60, 72, 84]);
  const r60 = a.best.methods[0].roi, r84 = a.best.methods[2].roi;
  expect(+(r84 - r60).toFixed(2)).toBe(0.5);
  expect(evaluateBank(pfl, p({ netSalary: 120000, riskSegmentByBank: { poonawalla_fincorp: 'High' } })).foirPct).toBe(70);
  expect(evaluateBank(pfl, p({ netSalary: 60000, company: { categoriesByBank: { poonawalla_fincorp: 'GOVERNMENT' } } })).foirPct).toBe(65);
  expect(evaluateBank(pfl, p({ netSalary: 300000, company: { categoriesByBank: { poonawalla_fincorp: 'CAT D' } } })).best.eligibleAmount).toBeLessThanOrEqual(1000000);
  // card + app loan BT
  const bt = evaluateBank(pfl, p({ netSalary: 150000,
    loans: [{ id: 'kb', lender: 'KRAZYBEE', productType: 'PL', outstanding: 40000, emi: 6000, emisPaid: 1, emisRemaining: 6 },
            { id: 'pl', lender: 'AXIS BANK', productType: 'PL', outstanding: 500000, emi: 15000, emisPaid: 3, emisRemaining: 40 }],
    cards: [{ id: 'c1', issuer: 'SBI CARD', outstanding: 200000 }] }));
  const ok = Object.fromEntries(bt.obligations.loans.map((l) => [l.id, l.bt.ok]));
  expect(ok).toEqual({ kb: true, pl: true });                         // app loan after 1 EMI; one loan with 3 EMIs allowed
  const all = bt.scenarios.find((s) => s.bt.length === 3);
  expect(all.btCards).toEqual(['c1']);
  expect(all.rateAddOn).toBe(1.25);                                   // 2 card/app loans
  expect(evaluateBank(pfl, p({ netSalary: 300000, city: 'Nashik' })).best.eligibleAmount).toBeLessThanOrEqual(4000000);
});

import axis from './axis_pl_policy.json';

test('Axis: FOIR 55/65/70/75, CAT D 40/65/70, 7-year at 70% by CIBIL / salary account, card BT up to 6x salary, card 4%, gold 0', () => {
  const p = (x) => ({ ...base, loans: [], cards: [], cibilScore: 760, company: { categoriesByBank: { axis_bank: 'CATGA' } }, credit: { enquiryList: [] }, ...x });
  expect(evaluateBank(axis, p({ netSalary: 45000 })).foirPct).toBe(65);
  const hi = evaluateBank(axis, p({ netSalary: 120000 }));
  expect(hi.foirPct).toBe(75);
  expect(hi.best.methods.map((m) => m.key)).toEqual(['foir_60', 'foir_84']);              // 1L+ & 740+
  expect(evaluateBank(axis, p({ netSalary: 80000 })).best.methods.map((m) => m.key)).toEqual(['foir_60']);   // needs 780
  expect(evaluateBank(axis, p({ netSalary: 40000, salaryAccountBank: 'AXIS BANK', cibilScore: 745 })).best.methods.map((m) => m.key)).toEqual(['foir_60', 'foir_84']);
  expect(evaluateBank(axis, p({ netSalary: 60000, company: { categoriesByBank: { axis_bank: 'CATGD' } } })).foirPct).toBe(40);
  expect(evaluateBank(axis, p({ netSalary: 30000, company: { categoriesByBank: { axis_bank: 'CATGD' } } })).status).toBe('NOT_ELIGIBLE');
  expect(evaluateBank(axis, p({ netSalary: 20000, salaryAccountBank: 'AXIS BANK' })).status).not.toBe('NOT_ELIGIBLE');
  const c = evaluateBank(axis, p({ netSalary: 50000, cards: [{ id: 'c1', issuer: 'SBI CARD', outstanding: 400000 }],
    loans: [{ id: 'g', lender: 'MUTHOOT', productType: 'GOLD', outstanding: 200000 }] }));
  expect(c.obligations.loans[0].obligation.amount).toBe(0);
  expect(c.scenarios.some((s) => s.btCards.includes('c1'))).toBe(false);                 // 4L > 6 x 50K? no: 3L cap -> excluded
  expect(c.obligations.cards.amount).toBe(16000);                                       // 4%
});

test('Axis festive rates: CAT A 15L+ 10.24%, CAT D / DU 14%', () => {
  const p = (x) => ({ ...base, loans: [], cards: [], cibilScore: 780, company: { categoriesByBank: { axis_bank: 'CATGA' } }, credit: { enquiryList: [] }, ...x });
  expect(evaluateBank(axis, p({ netSalary: 150000 })).best.methods[0].roi).toBe(10.24);
  expect(evaluateBank(axis, p({ netSalary: 150000, company: { categoriesByBank: { axis_bank: 'CATDU' } } })).best.methods[0].roi).toBe(14);
});

test('OD BT: confirmed term / EMI-started OD treated as PL; HDFC takes any OD after 6 months even interest-only', () => {
  const od = (x) => ({ id: 'od', lender: 'BAJAJ FIN LTD', productType: 'OD', outstanding: 300000, emi: 3000, emisPaid: 7, emisRemaining: null, ...x });
  const ok = (pol, loan, cat) => evaluateBank(pol, { ...base, netSalary: 120000, loans: [loan], cards: [], cibilScore: 780,
    company: { categoriesByBank: { [pol.bank_id]: cat } }, credit: { enquiryList: [] } }).obligations.loans[0].bt.ok;
  expect(ok(policy, od({}), 'CAT A')).toBe(true);                                   // HDFC: OD after 6 months
  expect(ok(policy, od({ odStatus: 'od_no_emi' }), 'CAT A')).toBe(true);
  expect(ok(policy, od({ emisPaid: 4 }), 'CAT A')).toBe(false);
  expect(ok(icici, od({ odStatus: 'term' }), 'Elite')).toBe(true);                  // ICICI: OD confirmed as term loan
  expect(ok(icici, od({}), 'Elite')).toBe(false);
  expect(ok(icici, od({ productType: 'PL', odStatus: 'od_no_emi' }), 'Elite')).toBe(false);
});

test('Nov 2026 offers: Bandhan and IndusInd CAT C 10.50% (15–20L) / 10.25% (20L+); Kotak 9.99% at 25L+ with NTH 75K+', () => {
  const roi = (pol, cat, sal) => evaluateBank(pol, { ...base, netSalary: sal, loans: [], cards: [], cibilScore: 780, city: 'Pune',
    company: { categoriesByBank: { [pol.bank_id]: cat } }, credit: { enquiryList: [] } }).best.methods[0];
  const b = roi(bandhan, 'CAT C', 150000);
  expect(b.amount).toBeGreaterThanOrEqual(2000000);
  expect(b.roi).toBe(10.25);
  const c = roi(indusind, 'CAT C1000', 400000);
  expect(c.amount).toBeGreaterThanOrEqual(2000000);
  expect(c.roi).toBe(10.25);
  expect(roi(kotak, 'CAT A', 200000).roi).toBe(9.99);
});

test('18 Nov: EMI on every amount, Poonawalla card BT only from 50K, forced BT kept within limits, extra-income hints', () => {
  // EMI shown for each method and matches the standard formula
  const r = evaluateBank(policy, base);
  for (const m of r.best.methods) {
    const i = m.roi / 1200, n = m.tenure;
    expect(m.emi).toBe(Math.round(m.amount * i * (1 + i) ** n / ((1 + i) ** n - 1)));
  }
  // Poonawalla: card under 50K is not a BT candidate, 60K is
  const p = (cards) => evaluateBank(pfl, { ...base, netSalary: 150000, loans: [], cards, cibilScore: 760, city: 'Pune',
    company: { categoriesByBank: { poonawalla_fincorp: 'CAT A' } }, credit: { enquiryList: [] } });
  const small = p([{ id: 's', issuer: 'SBI CARD', outstanding: 40000 }]);
  expect(small.scenarios.some((sc) => sc.btCards.includes('s'))).toBe(false);
  expect(small.notes.join()).toMatch(/under ₹50,000/);
  expect(p([{ id: 'b', issuer: 'SBI CARD', outstanding: 60000 }]).scenarios.some((sc) => sc.btCards.includes('b'))).toBe(true);
  // Yes Bank allows 5 loans in BT: 6 loans all marked BT -> best plan instead of no plan
  const six = Array.from({ length: 6 }, (_, i) => ({ id: 'f' + i, lender: 'AXIS BANK', productType: 'PL', outstanding: 100000, emi: 5000, emisPaid: 10, emisRemaining: 20, treatment: 'bt' }));
  const y = evaluateBank(yes, { ...base, netSalary: 150000, loans: six, cards: [], cibilScore: 760, city: 'Pune',
    company: { categoriesByBank: { yes: 'Gold' } }, credit: { enquiryList: [], servedLoanAmount: 1200000 } });
  expect(y.best).toBeDefined();
  expect(y.warnings.join()).toMatch(/can't all be taken together/);
  // a loan marked BT is never dropped by the 12-candidate cap
  const many = Array.from({ length: 14 }, (_, i) => ({ id: 'm' + i, lender: 'AXIS BANK', productType: 'PL', outstanding: 50000, emi: 2000, emisPaid: 10, emisRemaining: 20, treatment: i === 13 ? 'bt' : 'auto' }));
  const h = evaluateBank(policy, { ...base, netSalary: 400000, loans: many });
  expect(h.best.bt).toContain('m13');
  // hints: L&T counts rent / incentives; a no-EMI-room case says how much extra income would make it eligible
  const lp = (x) => evaluateBank(lt, { ...base, netSalary: 60000, cibilScore: 760, city: 'Pune', cards: [], company: { categoriesByBank: { lt: 'CAT A' } }, credit: { enquiryList: [] }, ...x });
  const ok = lp({ loans: [] });
  expect(ok.incomeHints.accepts.map((a) => a.key)).toEqual(expect.arrayContaining(['rental', 'monthly_incentive']));
  expect(ok.incomeHints.gainPer10k).toBeGreaterThan(0);
  const tight = lp({ loans: [{ id: 'x', lender: 'SBI', productType: 'HL', emi: 44000, emisPaid: 20, emisRemaining: 200 }] });
  expect(tight.status).toBe('NOT_ELIGIBLE');
  expect(tight.incomeHints.neededExtra).toBeGreaterThan(0);
  const withExtra = lp({ loans: [{ id: 'x', lender: 'SBI', productType: 'HL', emi: 44000, emisPaid: 20, emisRemaining: 200 }], _extraIncome: tight.incomeHints.neededExtra });
  expect(withExtra.status).not.toBe('NOT_ELIGIBLE');
});

import { rateForAmount, emiFor } from './underwritingEngine';

test('Own-amount EMI box: rate for a typed amount comes from the bank bands', () => {
  const r = evaluateBank(policy, base);               // HDFC CAT A
  expect(rateForAmount(r.roiSlabs, 1600000).roi).toBe(10.25);
  expect(rateForAmount(r.roiSlabs, 1200000).roi).toBe(10.75);
  expect(rateForAmount(r.roiSlabs, 500000).roi).toBe(11);
  expect(Math.round(emiFor(500000, 11, 60))).toBe(10871);
});

test('Own-amount EMI box uses the same add-ons as the summary (Poonawalla 7-year +0.50%, card BT add-on)', () => {
  const r = evaluateBank(pfl, { ...base, netSalary: 150000, loans: [], cibilScore: 760, city: 'Pune',
    cards: [{ id: 'c1', issuer: 'SBI CARD', outstanding: 200000 }],
    company: { categoriesByBank: { poonawalla_fincorp: 'CAT A' } }, credit: { enquiryList: [] } });
  for (const m of r.best.methods) {
    const own = rateForAmount(r.roiSlabs, m.amount, r.rateAdjust, m.tenure);
    expect(own.roi).toBe(m.roi);                      // default amount -> same rate as the summary row
  }
  expect(rateForAmount(r.roiSlabs, 1000000, r.rateAdjust, 84).addOn).toBeGreaterThanOrEqual(0.5);
});

import tata from './tata_pl_policy.json';

test('Tata Capital: FOIR 50/60/65 (60/65/75 with a secured loan), CAT A/B 5+6 years, CAT C lower of FOIR & multiplier, CIBIL caps', () => {
  const p = (x) => ({ ...base, loans: [], cards: [], cibilScore: 760, city: 'Pune', company: { categoriesByBank: { tata_capital: 'CAT A' } }, credit: { enquiryList: [] }, ...x });
  const a = evaluateBank(tata, p({ netSalary: 90000 }));
  expect(a.foirPct).toBe(65);
  expect(a.best.methods.map((m) => m.tenure)).toEqual([60, 72]);
  expect(evaluateBank(tata, p({ netSalary: 90000, loans: [{ id: 'hl', lender: 'SBI', productType: 'HL', outstanding: 3000000, emi: 25000, emisPaid: 20, emisRemaining: 200 }] })).foirPct).toBe(75);
  expect(evaluateBank(tata, p({ netSalary: 40000 })).foirPct).toBe(50);
  const c = evaluateBank(tata, p({ netSalary: 60000, company: { categoriesByBank: { tata_capital: 'Category C' } } }));
  expect(c.best.methods.find((m) => m.key === 'multiplier').multiplier).toBe(18);
  expect(c.best.eligibleRule).toBe('lower');
  expect(evaluateBank(tata, p({ netSalary: 28000, company: { categoriesByBank: { tata_capital: 'CAT C' } } })).status).toBe('NOT_ELIGIBLE');   // CAT C 30K
  expect(evaluateBank(tata, p({ netSalary: 150000, cibilScore: 690 })).best.eligibleAmount).toBeLessThanOrEqual(500000);
  expect(evaluateBank(tata, p({ netSalary: 150000, cibilScore: 660 })).status).toBe('NOT_ELIGIBLE');
  expect(evaluateBank(tata, p({ company: { categoriesByBank: { tata_capital: 'DELIST' } } })).status).toBe('NOT_ELIGIBLE');
});

test('Tata Capital enquiries: 4 fine, 5th deviation, 6+ declined', () => {
  const enq = (n) => evaluateBank(tata, { ...base, netSalary: 90000, loans: [], cards: [], cibilScore: 760, city: 'Pune',
    company: { categoriesByBank: { tata_capital: 'CAT A' } },
    credit: { enquiryList: Array.from({ length: n }, (_, i) => ({ lender: 'X', product: 'Personal Loan', daysAgo: i + 1 })) } });
  expect([enq(4).status, enq(5).status, enq(8).status]).toEqual(['ELIGIBLE', 'DEVIATION', 'NOT_ELIGIBLE']);
  expect(enq(5).deviations.join()).toMatch(/5 Personal Loan enquiries in 30 days \(max 4\) — deviation needed \(allowed up to 5\)/);
  expect(enq(8).reasons.join()).toMatch(/8 Personal Loan enquiries in 30 days \(max 4, deviation up to 5\)/);
});

test('Poonawalla: Central Govt above ₹75K net is treated as CAT A', () => {
  const run = (sal) => evaluateBank(pfl, { ...base, netSalary: sal, loans: [], cards: [], cibilScore: 760, city: 'Pune',
    company: { categoriesByBank: { poonawalla_fincorp: 'Central Government' } } });
  const hi = run(90000), lo = run(70000);
  expect(hi.notes.join()).toMatch(/Central Government with net salary above ₹75,000 treated as CAT A/);
  expect(lo.notes.join()).not.toMatch(/treated as CAT A/);
  const a = evaluateBank(pfl, { ...base, netSalary: 90000, loans: [], cards: [], cibilScore: 760, city: 'Pune', company: { categoriesByBank: { poonawalla_fincorp: 'CAT A' } } });
  expect(hi.best.eligibleAmount).toBe(a.best.eligibleAmount);
});

test('Own-bank PL enquiry in last 30 days blocks login at every bank (Axis 10 days ago)', () => {
  const pr = { ...base, netSalary: 120000, loans: [], cards: [], cibilScore: 770, city: 'Pune',
    company: { categoriesByBank: { axis_bank: 'CAT A', bandhan: 'CAT A', indusind: 'CAT A', yes: 'CAT A', tata_capital: 'CAT A', poonawalla_fincorp: 'CAT A', lt: 'CAT A' } },
    credit: { enquiryList: [{ lender: 'AXIS BANK', product: 'Personal Loan', daysAgo: 10 }, { lender: 'LNTFIN', product: 'Personal Loan', daysAgo: 5 }] } };
  const ax = evaluateBank(axis, pr);
  expect(ax.status).toBe('NOT_ELIGIBLE');
  expect(ax.eligibleAfterWait).toBe(true);
  expect(ax.reasons[0]).toMatch(/Axis Bank enquiry 10 day\(s\) ago — can't be done with Axis Bank until 30 days have passed \(20 more\)/);
  expect(evaluateBank(lt, pr).eligibleAfterWait).toBe(true);   // CIBIL shows L&T as LNTFIN
  for (const pol of [bandhan, indusind, yes, tata, pfl]) expect(pol.own_bank_enquiry_block.days).toBe(30);
  const old = evaluateBank(axis, { ...pr, credit: { enquiryList: [{ lender: 'AXIS BANK', product: 'Personal Loan', daysAgo: 31 }] } });
  expect(old.eligibleAfterWait).toBeFalsy();
});

test('Own-bank top-up timing per bank (23 Nov 2026)', () => {
  const t = { hdfc: policy, axis, indusind, yes, bandhan, icici, pfl, kotak };
  expect(Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.balance_transfer.top_up_min_emis])))
    .toEqual({ hdfc: 3, axis: 4, indusind: 3, yes: 3, bandhan: 9, icici: 6, pfl: 6, kotak: 6 });
  const run = (paid) => evaluateBank(axis, { ...base, netSalary: 120000, cards: [], cibilScore: 770, city: 'Pune', company: { categoriesByBank: { axis_bank: 'CAT A' } },
    loans: [{ id: 'own', lender: 'AXIS BANK', productType: 'PL', outstanding: 300000, emi: 10000, emisPaid: paid, emisRemaining: 40 }] })
    .obligations.loans[0].bt.ok;
  expect([run(3), run(4)]).toEqual([false, true]);
});

test('Hint: co-applicant on a solo home loan lowers the counted EMI', () => {
  const pr = { ...base, netSalary: 100000, cards: [], cibilScore: 770, city: 'Pune', company: { categoriesByBank: { bandhan: 'CAT A' }, category: 'CAT A', categoryConfirmed: true },
    loans: [{ id: 'hl', lender: 'SBI', productType: 'HL', emi: 30000, emisPaid: 40, emisRemaining: 200 }] };
  const r = evaluateBank(bandhan, pr);   // FOIR-only bank (Kotak is now multiplier-limited here)
  expect(r.incomeHints.hlCoApplicant.emi).toBe(30000);
  expect(r.incomeHints.hlCoApplicant.counted).toBe(0);
  expect(r.incomeHints.hlCoApplicant.gain).toBeGreaterThan(0);
  const joint = evaluateBank(bandhan, { ...pr, loans: [{ ...pr.loans[0], isJoint: true, hlEmiPaidBy: 'applicant' }] });
  expect(joint.incomeHints.hlCoApplicant).toBeUndefined();
});

test('L&T: no top-up — own L&T loan stays as obligation', () => {
  const r = evaluateBank(lt, { ...base, netSalary: 120000, cards: [], cibilScore: 770, city: 'Pune', company: { categoriesByBank: { lt: 'CAT A' } },
    loans: [{ id: 'own', lender: 'L&T FINANCE', productType: 'PL', outstanding: 300000, emi: 10000, emisPaid: 20, emisRemaining: 30 }] });
  const l = r.obligations.loans[0];
  expect(l.bt.ok).toBe(false);
  expect(l.bt.why).toMatch(/doesn't top up/);
  expect(l.obligation.amount).toBe(10000);
});

import chola from './chola_pl_policy.json';

describe('Chola (24 Nov 2026)', () => {
  const p = (o = {}) => ({ netSalary: 100000, grossSalary: 120000, ownHouse: true, cibilScore: 760, city: 'Pune', loans: [], cards: [], credit: {},
    company: { categoriesByBank: { chola: 'CAT A' } }, ...o });

  test('CAT A: FOIR 70% on 7 years, lower of FOIR and 26× net salary, special rate 13.5%, max ₹30L', () => {
    const r = evaluateBank(chola, p());
    expect(r.status).toBe('ELIGIBLE');
    expect(r.foirPct).toBe(70);
    expect(r.best.eligibleAmount).toBe(2600000);
    expect(r.best.methods[0].roi).toBe(13.5);
    expect(r.warnings.join()).not.toMatch(/placeholder/);
    const small = evaluateBank(chola, p({ netSalary: 38000, grossSalary: 45000 }));   // ₹40K or below: 60 months, 18×
    expect(small.foirPct).toBe(70);
    expect(small.best.eligibleAmount).toBe(684000);
    expect(small.warnings.join()).toMatch(/16% is a placeholder/);
  });

  test('Caps: above ₹20L only with own house, CIBIL 675–700 up to ₹5L, CIBIL -1 only CAT A/B up to ₹10L', () => {
    expect(evaluateBank(chola, p({ ownHouse: false })).best.eligibleAmount).toBe(2000000);
    const notAsked = evaluateBank(chola, p({ ownHouse: undefined }));   // 27 Nov: not asked → full amount + OHP warning
    expect(notAsked.best.eligibleAmount).toBe(2600000);
    expect(notAsked.warnings.join()).toMatch(/Above ₹20,00,000: own house proof \(OHP\) is mandatory at Chola/);
    expect(evaluateBank(chola, p({ cibilScore: 690 })).best.eligibleAmount).toBe(500000);
    expect(evaluateBank(chola, p({ cibilScore: 660 })).status).toBe('NOT_ELIGIBLE');
    expect(evaluateBank(chola, p({ cibilScore: -1 })).best.eligibleAmount).toBe(1000000);
    const govt = evaluateBank(chola, p({ cibilScore: -1, company: { categoriesByBank: { chola: 'Central Government' } } }));
    expect(govt.status).toBe('NOT_ELIGIBLE');
    expect(govt.reasons.join()).toMatch(/CIBIL -1 \(no history\): Chola does it only for CAT A \/ CAT B/);
  });

  test('CAT B: 65%, 70% with a live home loan; cards free within 3× gross salary; gold loan not counted', () => {
    const b = (o) => evaluateBank(chola, p({ company: { categoriesByBank: { chola: 'CAT B' } }, ...o }));
    expect(b().foirPct).toBe(65);
    expect(b({ loans: [{ id: 'hl', lender: 'SBI', productType: 'HL', emi: 20000, emisPaid: 30, emisRemaining: 200 }] }).foirPct).toBe(70);
    expect(b({ cards: [{ outstanding: 360000 }] }).obligations.cards.amount).toBe(0);
    expect(b({ cards: [{ outstanding: 400000 }] }).obligations.cards.amount).toBe(20000);
    expect(b({ loans: [{ id: 'g', lender: 'MUTHOOT', productType: 'GOLD', outstanding: 200000, emi: 0 }] }).obligations.loans[0].obligation.amount).toBe(0);
  });

  test('Credit: 2 unsecured loans in 6 months rejected; 6 PL enquiries in 30 days or 15 in 120 days rejected; own enquiry blocks', () => {
    const two = evaluateBank(chola, p({ loans: [
      { id: 'a', lender: 'BAJAJ FIN', productType: 'PL', outstanding: 200000, emi: 7000, emisPaid: 2, emisRemaining: 34 },
      { id: 'b', lender: 'ICICI BANK', productType: 'PL', outstanding: 300000, emi: 9000, emisPaid: 4, emisRemaining: 44 }] }));
    expect(two.reasons.join()).toMatch(/2 unsecured loans taken in the last 6 months/);
    const enq = (list) => evaluateBank(chola, p({ credit: { enquiryList: list } }));
    const mk = (n, start) => Array.from({ length: n }, (_, i) => ({ lender: 'X', product: 'Personal Loan', daysAgo: start + i }));
    expect(enq(mk(5, 1)).status).toBe('ELIGIBLE');
    expect(enq(mk(6, 1)).reasons.join()).toMatch(/6 Personal Loan enquiries in 30 days \(max 5\)/);
    expect(enq([...mk(5, 1), ...mk(10, 40)]).reasons.join()).toMatch(/15 Personal Loan enquiries in 120 days \(max 14\)/);
    expect(enq([{ lender: 'CHOLAMANDALAM INV', product: 'Personal Loan', daysAgo: 12 }]).eligibleAfterWait).toBe(true);
  });

  test('Unlisted: own house, CIBIL 725, company age, FOIR 55/60/65, max ₹7.5L with ₹5L+ loan track', () => {
    const u = (o) => evaluateBank(chola, p({ company: { incorporationYear: 2018, categoriesByBank: { chola: null } }, ...o }));
    expect(u({ ownHouse: false }).reasons.join()).toMatch(/Unlisted company: Chola needs an own house/);
    expect(u({ cibilScore: 710 }).reasons.join()).toMatch(/below Chola minimum 725 for UNLISTED/);
    expect(u({ netSalary: 28000 }).status).toBe('NOT_ELIGIBLE');   // ₹30K minimum
    const ok = u({ netSalary: 60000 });
    expect(ok.foirPct).toBe(65);
    expect(ok.best.eligibleAmount).toBe(500000);
    expect(u({ netSalary: 60000, credit: { servedLoanAmount: 600000 } }).best.eligibleAmount).toBe(750000);
  });
});

test('Card treatment: BT always taken when the bank allows, Obligate never taken', () => {
  const pr = (cards) => ({ netSalary: 100000, grossSalary: 120000, ownHouse: true, cibilScore: 760, city: 'Pune', loans: [], credit: {},
    company: { categoriesByBank: { chola: 'CAT A', poonawalla_fincorp: 'CAT A', axis_bank: 'CAT A' } }, cards });
  const cards = [{ id: 'c1', issuer: 'SBI CARD', outstanding: 300000 }, { id: 'c2', issuer: 'HDFC BANK', outstanding: 200000 }];
  const forced = evaluateBank(chola, pr([{ ...cards[0], treatment: 'bt' }, cards[1]]));
  expect(forced.best.btCards).toContain('c1');
  const kept = evaluateBank(chola, pr([{ ...cards[0], treatment: 'obligate' }, { ...cards[1], treatment: 'obligate' }]));
  expect(kept.best.btCards).toEqual([]);
  const noCardBt = evaluateBank(policy, { ...pr([{ ...cards[0], treatment: 'bt' }]), company: { categoriesByBank: { hdfc_bank: 'CAT A' } } });
  expect(noCardBt.warnings.join()).toMatch(/SBI CARD: marked BT but HDFC Bank doesn't take credit card BT/);
  const small = evaluateBank(pfl, pr([{ id: 's', issuer: 'RBL', outstanding: 30000, treatment: 'bt' }]));
  expect(small.warnings.join()).toMatch(/RBL: marked BT but Poonawalla.* takes cards only from ₹50,000/);
});

test('Tata Capital: loans under ₹50,000 outstanding not taken in BT; closed loans never in BT', () => {
  const pr = { netSalary: 120000, ownHouse: true, cibilScore: 760, city: 'Pune', cards: [], credit: {}, company: { categoriesByBank: { tata_capital: 'CAT A' } },
    loans: [{ id: 'small', lender: 'PARFAITFIN', productType: 'PL', outstanding: 21622, emi: 1000, emisPaid: 26, treatment: 'bt' },
      { id: 'big', lender: 'HERO FINCORP', productType: 'PL', outstanding: 415453, emi: 15653, emisPaid: 12 },
      { id: 'closed', lender: 'SMICC', productType: 'PL', outstanding: 33665, emi: 3000, emisPaid: 13, closedBeforeLoginWithProof: true, treatment: 'bt' }] };
  const r = evaluateBank(tata, pr);
  const bt = Object.fromEntries(r.obligations.loans.map((l) => [l.id, l.bt]));
  expect(bt.small.ok).toBe(false);
  expect(bt.small.why).toMatch(/doesn't take loans under ₹50,000 outstanding in BT/);
  expect(bt.closed.ok).toBe(false);
  expect(r.best.bt).toEqual(['big']);
  expect(r.scenarios.every((s) => !s.bt.includes('closed') && !s.bt.includes('small'))).toBe(true);
});

test('Every bank gives the lower of FOIR and multiplier (25 Nov 2026)', () => {
  for (const pol of [policy, icici, kotak, indusind, lt, bandhan, yes, pfl, axis, tata, chola]) expect(pol.eligibility.combine).toBe('lower');
  const k = evaluateBank(kotak, { ...base, loans: [], netSalary: 150000, company: { category: 'CAT A', categoryConfirmed: true }, cibilScore: 800 });
  const foirBest = Math.max(...k.best.methods.filter((m) => m.key.startsWith('foir')).map((m) => m.amount));
  const mult = Math.min(...k.best.methods.filter((m) => m.key.startsWith('multiplier')).map((m) => m.amount));   // no scorecard picked: lowest band
  expect(k.best.eligibleAmount).toBe(Math.min(foirBest, mult));
});

test('HDFC: lower of FOIR and (salary − obligations) × multiplier; FOIR figure shown as good-profile upside', () => {
  const r = evaluateBank(policy, { ...base, loans: [{ id: 'pl', lender: 'XYZ FIN', productType: 'PL', outstanding: 300000, emi: 20000, emisPaid: 3, emisRemaining: 30 }] });
  const mlt = r.best.methods.find((m) => m.key === 'multiplier');
  const foirBest = Math.max(...r.best.methods.filter((m) => m.key.startsWith('foir')).map((m) => m.amount));
  expect(r.best.eligibleAmount).toBe(Math.min(mlt.amount, foirBest));
  expect(mlt.amount).toBe(Math.min((100000 - 20000) * mlt.multiplier, mlt.amount));
  if (foirBest > mlt.amount) {
    expect(r.best.upside.amount).toBe(foirBest);
    expect(r.notes.join()).toMatch(/Good profile: HDFC Bank may give the FOIR figure/);
  }
  expect(evaluateBank(kotak, { ...base, loans: [] }).best.upside).toBeNull();   // only HDFC has this
});

test('Bandhan gold loans: exemption checks the TOTAL gold outstanding, not each loan', () => {
  const g = (id, o) => ({ id, lender: 'INDIAN BANK', productType: 'GOLD', outstanding: o, emi: 0, emisPaid: 4 });
  const pr = (loans) => ({ ...base, netSalary: 100000, cards: [], cibilScore: 770, city: 'Pune', company: { categoriesByBank: { bandhan: 'CAT A' }, category: 'CAT A', categoryConfirmed: true }, loans });
  const many = evaluateBank(bandhan, pr([g('a', 177000), g('b', 112401), g('c', 139990), g('d', 94008), g('e', 201732)]));   // total ₹7,25,131
  expect(many.obligations.loans.map((l) => Math.round(l.obligation.amount))).toEqual([1770, 1124, 1400, 940, 2017]);
  expect(many.obligations.loans[0].obligation.rule).toMatch(/1% of outstanding \(total gold loans ₹7,25,131 ≥ ₹5,00,000\)/);
  const few = evaluateBank(bandhan, pr([g('a', 177000), g('b', 112401)]));
  expect(few.obligations.loans.every((l) => l.obligation.amount === 0)).toBe(true);
  expect(few.obligations.loans[0].obligation.rule).toMatch(/Total gold loans ₹2,89,401 below ₹5,00,000 — not counted/);
});

test('Prema-type case (27 Nov): Poonawalla metro 60L, city missing not capped; HDFC good profile gets FOIR', () => {
  const P = (o) => ({ netSalary: 255723, grossSalary: 353014, cibilScore: 795, cards: [], credit: { servedLoanAmount: 9000000, dpdAccounts: [] }, salaryAccountBank: 'Standard Chartered',
    company: { categoriesByBank: { poonawalla_fincorp: 'CAT A', hdfc_bank: 'CAT A' }, category: 'CAT A', categoryConfirmed: true }, loans: [], ...o });
  expect(evaluateBank(pfl, P({ city: 'Hyderabad' })).best.eligibleAmount).toBe(6000000);
  const noCity = evaluateBank(pfl, P({}));
  expect(noCity.best.eligibleAmount).toBe(6000000);
  expect(noCity.warnings.join()).toMatch(/City not entered — Poonawalla Fincorp city cap not applied/);
  expect(evaluateBank(pfl, P({ city: 'Nashik' })).best.eligibleAmount).toBe(4000000);
  const h = evaluateBank(policy, P({ city: 'Hyderabad' }));
  expect(h.goodProfile.good).toBe(true);
  expect(h.best.eligibleRule).toBe('good_profile_foir');
  expect(h.best.eligibleBy.startsWith('foir')).toBe(true);
  expect(h.best.eligibleAmount).toBeGreaterThan(h.best.methods.find((m) => m.key === 'multiplier').amount);
  expect(h.notes.join()).toMatch(/Good profile \(CIBIL 795, CAT A/);
  const off = evaluateBank(policy, P({ city: 'Hyderabad', goodProfileByBank: { hdfc_bank: false } }));
  expect(off.best.eligibleBy).toBe('multiplier');
  expect(off.best.upside.amount).toBe(h.best.eligibleAmount);
  const low = evaluateBank(policy, P({ city: 'Hyderabad', cibilScore: 730 }));
  expect(low.goodProfile).toEqual({ good: false, why: 'CIBIL below 750' });
  expect(low.best.eligibleBy).toBe('multiplier');
});
