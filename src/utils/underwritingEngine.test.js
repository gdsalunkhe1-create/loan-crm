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
