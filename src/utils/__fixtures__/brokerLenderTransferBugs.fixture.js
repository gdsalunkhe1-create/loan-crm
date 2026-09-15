// Reproduces the 2026-09-09 bug hunt against a real ICICI statement (Mohan
// Kumar M, A/c 395201000416, Aug 2026) - all names/accounts/amounts here are
// fabricated, structurally matching the real narrations that broke:
//   1. ICICI Direct's own narration ("iDirect trxn" / "EBA/...") was
//      invisible to DICT.brokers entirely - Stock Market Activity showed
//      "Detected: NO" despite 60+ real F&O/equity trade legs.
//   2. Those same broker settlement credits, with no exclusion in the
//      primary-salary scorer, got adopted as "Monthly Salary Credits".
//   3. BAJAJ FINANCE auto-debits print as "BAJAJ_AUTO_CD" (CMS style) and
//      "AD~1ADBAJAJFINNEW~<date>~<bank>" (ICICI SI style) - neither matched
//      any DICT.lenders entry or emiKeywords pattern, so a real recurring
//      EMI showed zero obligations.
//   4. ICICI's own "INFT" (Internal Fund Transfer) rail code isn't NEFT and
//      wasn't in DICT.transferRails, so a clean 4x self-transfer pattern
//      never reached the >=3 frequent_transfers threshold.
// Uses a fictitious, unrecognized bank name so TRAILING_ONLY (single
// self-contained line per row) applies - this fixture is about detector
// logic, not the ICICI-specific line-merging bug (see
// iciciStrayRowNumber.fixture.js for that one). Running balances are
// computed exactly so each row's delta equals its stated amount - keep
// them in sync if you edit any amount here.
import { page } from './pdfPageBuilder';

export const brokerLenderTransferBugsPages = [
  page([
    'TEST SAVINGS BANK LTD',
    'Statement of Account',
    'Account Name: Mohan Kumar',
    'A/c No: 395201000999',
    // 10 broker settlement credits - the "salary" that never was. Amounts
    // deliberately span a wide range like the real statement (958.75 to
    // 233949.55) with no other repeating credit group anywhere in the
    // statement, so if the exclusion is missing, this group is the ONLY
    // candidate and necessarily wins detectSalary's scoring. First row
    // carries an explicit "CR" marker only to resolve the parser's
    // opening-row credit/debit ambiguity - not part of the real narration.
    '01/08/2026 iDirect trxn EBA/EQ Trade 01AUG/20260801100000 CR 958.75 100958.75',
    '02/08/2026 iDirect trxn EBA/EQ Trade 02AUG/20260802100000 45230.50 146189.25',
    '03/08/2026 iDirect trxn EBA/F&O Trade 03AUG/20260803100000 12045.00 158234.25',
    '04/08/2026 iDirect trxn EBA//20260804183025 1300.00 159534.25',
    '05/08/2026 iDirect trxn EBA/EQ Margin 05AUG/20260805090000 8760.30 168294.55',
    '06/08/2026 iDirect trxn EBA/F&O Trade 06AUG/20260806054102 233949.55 402244.10',
    '07/08/2026 iDirect trxn EBA/EQ Trade 07AUG/20260807100000 33500.00 435744.10',
    '08/08/2026 iDirect trxn EBA//20260808120000 2100.00 437844.10',
    '09/08/2026 iDirect trxn EBA/F&O Trade 09AUG/20260809100000 61200.00 499044.10',
    '10/08/2026 iDirect trxn EBA/EQ Trade 10AUG/20260810100000 19875.65 518919.75',
    // BAJAJ FINANCE EMI - two different narration styles for the same
    // obligation, neither containing "BAJAJ FINANCE" as a literal phrase.
    '11/08/2026 CMS/00234/BAJAJ_AUTO_CD__ICIC0001234 9450.00 509469.75',
    // Self-transfer OUT via ICICI's INFT rail (not NEFT) - 4x, clears the
    // >=3 frequent_transfers threshold once INFT is recognized as a rail.
    // Outbound (debit) so it can't also feed the credit-side salary scorer.
    '12/08/2026 IMB/INFT/000111/Self 25000.00 484469.75',
    '19/08/2026 IMB/INFT/000222/Self 25000.00 459469.75',
    '26/08/2026 IMB/INFT/000333/Self 15000.00 444469.75',
    '31/08/2026 IMB/INFT/000444/Self 15000.00 429469.75',
    '05/09/2026 CMS/00567/BAJAJ_AUTO_CD__ICIC0001234 9450.00 420019.75',
    '05/10/2026 CMS/00891/BAJAJ_AUTO_CD__ICIC0001234 9450.00 410569.75',
    '05/11/2026 AD~1ADBAJAJFINNEW~05NOV26~ICIC 9450.00 401119.75',
    '05/12/2026 AD~1ADBAJAJFINNEW~05DEC26~ICIC 9450.00 391669.75',
  ]),
];

export const brokerLenderTransferBugsExpected = {
  brokerTxnCount: 10,
  brokerSubTypes: { EQUITY: 4, 'F&O': 3, MARGIN_CALL: 1, NET_SETTLEMENT: 2 },
  bajajObligation: { party: 'BAJAJ FINANCE', amount: 9450, count: 5 },
  inftBeneficiary: 'IMB INFT',
  inftTransferCount: 4,
};
