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
  expect(Math.round(s.foir[60].amount)).toBe(2118432);
  expect(s.foir[60].roi).toBe(9.99);
  expect(Math.round(s.foir[72].amount)).toBe(2429701);
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
  expect(s.conservativeRoi).toBe(9.99);
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
  expect(s.foir[60].roi).toBe(9.99);
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

test('Both methods shown: FOIR can carry the case when the multiplier is below BT POS', () => {
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
  expect(s.eligibleBy).toBe('foir_72');
  expect(s.netInHand).toBeGreaterThan(0);
  expect(r.status).toBe('ELIGIBLE');
});

test('Kotak: category/salary ROI, scorecard multiplier for all cards until one is chosen, manual category', () => {
  const kBase = { ...base, loans: [{ id: 'hl', lender: 'SBI', productType: 'HL', emi: 25000, emisPaid: 50, emisRemaining: 150 }],
    company: { categoriesByBank: { kotak: 'CAT A' } }, credit: { enquiryList: [] } };
  const r = evaluateBank(kotak, kBase);   // salary 1L, obligations 25k
  const ms = r.best.methods.filter((m) => m.key.startsWith('multiplier_'));
  expect(ms.map((m) => m.multiplier)).toEqual([19, 17, 15, 12]);    // 50K-1L column, all scorecards
  expect(ms.every((m) => m.indicative)).toBe(true);
  expect(r.best.eligibleBy.startsWith('foir')).toBe(true);           // indicative rows don't set "highest"
  expect(r.best.methods.find((m) => m.key === 'foir_60').roi).toBe(9.95);
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
  expect(run('CAT A', 36000).roi).toBe(11);      // 36K salary -> loan under 10L
  expect(run('CAT C', 36000).roi).toBe(12.5);
  expect(run('CAT D', 36000).roi).toBe(14);
  expect(run('CAT A', 60000).roi).toBe(9.95);    // 60K salary -> 10L+ at 9.95
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
  expect(r.best.bt).toContain('axis');
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
  // own L&T loan is a top-up
  const own = evaluateBank(lt, p({ netSalary: 120000, loans: [{ id: 'lt', lender: 'L&T FINANCE LTD', productType: 'PL', outstanding: 200000, emi: 9000, emisPaid: 10 }] }));
  expect(own.obligations.loans[0].bt.topUp).toBe(true);
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
  expect(evaluateBank(policy, base).best.eligibleRule).toBe('both');
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
