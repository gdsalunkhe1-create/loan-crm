// Reproduces the 2026-09-10 bug found while running a real ICICI statement
// (Mohan Kumar M) through the app: 5 real BAJAJ FINANCE debits -
// Rs.22,198.00, Rs.590.00, Rs.1,212.00, Rs.365.38 and Rs.224.60 - printed
// under the same two narration styles as brokerLenderTransferBugs.fixture.js
// ("CMS/.../BAJAJ_AUTO_CD__..." and "AD~1ADBAJAJFINNEW~...") all collapsed
// into ONE EMI Tracker row at Rs.590/month, count 5 - silently discarding
// the Rs.22,198 and Rs.1,212 legs entirely. detectEmiObligations() grouped
// purely by lender name with no amount-consistency check, so two (in fact
// three, once the real figures are run through the same Rs.500-or-15%
// tolerance formula reconcileCibilVsBank() already uses) financially
// distinct obligations sharing a lender name got folded into one.
// Amounts/dates/account number are fabricated but match the real figures
// and narration shapes exactly. Uses a fictitious bank name so TRAILING_ONLY
// applies, matching brokerLenderTransferBugs.fixture.js's convention.
import { page } from './pdfPageBuilder';

export const bajajMultiAmountEmiPages = [
  page([
    'TEST SAVINGS BANK LTD',
    'Statement of Account',
    'Account Name: Mohan Kumar',
    'A/c No: 395201000999',
    // Anchor credit so every later row's debit is derived from the running
    // balance delta unambiguously - linesToTransactions() only special-cases
    // credit/debit direction on the very FIRST parsed row (no prior balance
    // to diff against), and that special-case requires an explicit CR/DR/
    // salary-keyword hint. Without this anchor, the first EMI debit below
    // would need that same hint just to be recognized as a debit at all,
    // which isn't what this fixture is testing.
    '01/01/2026 NEFT CR FROM EMPLOYER SALARY 100000.00 100000.00',
    '02/01/2026 CMS/00111/BAJAJ_AUTO_CD__ICIC0001234 224.60 99775.40',
    '02/02/2026 AD~1ADBAJAJFINNEW~02FEB26~ICIC 365.38 99410.02',
    '02/03/2026 CMS/00222/BAJAJ_AUTO_CD__ICIC0001234 590.00 98820.02',
    '02/04/2026 AD~1ADBAJAJFINNEW~02APR26~ICIC 1212.00 97608.02',
    '02/05/2026 CMS/00333/BAJAJ_AUTO_CD__ICIC0001234 22198.00 75410.02',
  ]),
];

// Under the literal Rs.500-or-15%-of-cluster-average tolerance formula, the
// real figures form THREE amount clusters, not two - 1212 is more than
// Rs.500 away from both its neighbours (590 and 22198). The fix must
// preserve mathematical correctness (every rupee accounted for, nothing
// silently dropped) rather than being forced into an approximate "2 rows"
// shape.
export const bajajMultiAmountEmiExpected = {
  party: 'BAJAJ FINANCE',
  clusters: [
    { amount: 365.38, count: 3 }, // 224.60, 365.38, 590 - median 365.38
    { amount: 1212, count: 1 },
    { amount: 22198, count: 1 },
  ],
  allAmounts: [224.60, 365.38, 590, 1212, 22198],
};
