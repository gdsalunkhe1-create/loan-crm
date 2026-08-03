// Reproduces the 2026-07-15 EMI-detection bug found while cross-checking a
// real customer's Axis Bank statement against their CIBIL report: the EMI
// Tracker sheet came back completely empty even though the statement had
// 4+ active recurring loan repayments in it. Root cause was two-fold:
//   1. detectEmiObligations() only checked DICT.emiKeywords, never
//      DICT.lenders - so fintech NBFC repayments (which print the lender's
//      name, not the word "EMI") were invisible.
//   2. Bank ACH auto-debits print "ACH-DR-..." (hyphen) but the keyword
//      list only had "ACH D" (space), so ICICI/HDFC loan EMIs routed
//      through ACH were also invisible.
// A third pattern is included here too: the same lender printed under two
// different description formats across months ("Navi Finserv Limited" vs
// "Navi Loans") - grouping by free-text partyKey() alone splits this into
// two single-occurrence groups, both below the count>=2 threshold, so the
// obligation disappears even once the keyword match is fixed. Grouping
// must key off the matched lender name once one is recognized.
// All names/accounts/amounts are fabricated - not the real customer's data.
import { page } from './pdfPageBuilder';

export const lenderEmiRepaymentPages = [
  page([
    'HDFC BANK LIMITED',
    'Account Name: Test Borrower',
    'A/C No: 111122223333',
    '30/01/2026 SALARY CREDIT NEFT 50,000.00 2,00,000.00',
    // Fintech lender repayment - no "EMI" in the text anywhere
    '30/01/2026 UPI KISETSU SAISON FINANC REPAYMENT 8,565.00 1,91,435.00',
    // Bank ACH auto-debit - hyphenated "ACH-DR", not "ACH D"
    '05/02/2026 ACH-DR-TP ACH ICICI BANK-2091527317 19,688.00 1,71,747.00',
    // Same lender, format #1
    '30/03/2026 UPI Navi Finserv Limited REQUEST 11,060.00 1,60,687.00',
    '27/02/2026 UPI KISETSU SAISON FINANC REPAYMENT 8,565.00 1,52,122.00',
    // Same lender, format #2 - must merge with format #1 above, not split
    '26/04/2026 UPI Navi Loans PAYMENT 11,060.00 1,41,062.00',
    '05/03/2026 ACH-DR-TP ACH ICICI BANK-2114498730 19,688.00 1,21,374.00',
  ]),
];

export const lenderEmiRepaymentExpected = {
  // KISETSU (2x), ICICI ACH-DR (2x), NAVI (2x, merged across both spellings)
  obligationCount: 3,
  navi: { amount: 11060, count: 2 },
  kisetsu: { amount: 8565, count: 2 },
};
