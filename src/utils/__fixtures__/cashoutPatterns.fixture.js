// Synthetic fixtures for detectCardCashoutPatterns() (2026-09-09 feature
// add) and the CRED/bill-payment-app tagging it depends on. All
// names/amounts are fabricated. Uses a fictitious, unrecognized bank name
// so TRAILING_ONLY (single self-contained line per row) applies - these
// fixtures are about detector logic, not bank-specific line-merging. Each
// scenario is kept in its own small statement (not combined into one long
// one) so the transactions that satisfy ONE sub-pattern can't accidentally
// also satisfy another sub-pattern's amount/timing band and produce a
// confusing extra finding - every fixture below was checked to produce
// only the finding(s) named in its "Expected" block.
import { page } from './pdfPageBuilder';

const HEADER = ['TEST SAVINGS BANK LTD', 'Statement of Account', 'Account Name: Test Customer', 'A/c No: 395201000998'];
// First row of every fixture needs an explicit "CR" marker so the parser's
// opening-row credit/debit ambiguity (see linesToTransactions - the very
// first transaction has no prior balance to compute a signed delta from)
// resolves as a credit; it's not part of any real narration.
const ANCHOR = '01/01/2026 Initial Credit CR 100000.00 100000.00';

// 1. CARD_CASHOUT_SUSPECTED + CRED tagging (categorizeTxn ->
//    CREDIT_CARD_BILL_PAYMENT) + POST_MERCHANT_CREDIT (same pair also
//    qualifies: CRED debit >= Rs.10,000 followed by a credit next day).
export const cardCashoutSuspectedPages = [
  page([
    ...HEADER,
    ANCHOR,
    '02/01/2026 CRED APP BILL PAYMENT 20000.00 80000.00',
    '03/01/2026 NEFT XYZ ENTERPRISES 19500.00 99500.00',
  ]),
];
export const cardCashoutSuspectedExpected = {
  credDescription: 'CRED APP BILL PAYMENT',
  legAmount: 20000,
  followUpAmount: 19500,
  gapDays: 1,
};

// 2. MATCHED_ROUND_TRIP - credit followed within 1-2 days by a (non-ATM,
//    non-bill-payment-app) debit at 97-99% of the credit.
export const matchedRoundTripPages = [
  page([
    ...HEADER,
    ANCHOR,
    '02/01/2026 NEFT FROM CLIENT PAYMENT 50000.00 150000.00',
    '03/01/2026 IMPS TO VENDOR SETTLEMENT 49000.00 101000.00',
  ]),
];
export const matchedRoundTripExpected = { creditAmount: 50000, debitAmount: 49000, gapDays: 1 };

// 3. Confidence-tier rule: an EXACT amount-in -> amount-out pair (no
//    shrinkage) must NOT produce a MATCHED_ROUND_TRIP finding at all.
export const exactMatchExcludedPages = [
  page([
    ...HEADER,
    ANCHOR,
    '02/01/2026 NEFT FROM CLIENT PAYMENT 50000.00 150000.00',
    '03/01/2026 IMPS TO VENDOR SETTLEMENT 50000.00 100000.00',
  ]),
];

// 4. CREDIT_THEN_CASH_WITHDRAWAL - credit almost fully withdrawn as cash
//    within 1-2 days. Strongest signal -> HIGH confidence.
export const creditThenCashWithdrawalPages = [
  page([
    ...HEADER,
    ANCHOR,
    '02/01/2026 NEFT LARGE INFLOW 40000.00 140000.00',
    '03/01/2026 ATM WDL NATIONAL 39500.00 100500.00',
  ]),
];
export const creditThenCashWithdrawalExpected = { creditAmount: 40000, withdrawalAmount: 39500, gapDays: 1 };

// 5. REPEATED_SAME_PARTY_CREDITS - 3+ credits from the same UPI VPA within
//    a 30-day window.
export const repeatedSamePartyCreditsPages = [
  page([
    ...HEADER,
    ANCHOR,
    '05/01/2026 UPI/rahulsharma5@ybl/Payment 8000.00 108000.00',
    '15/01/2026 UPI/rahulsharma5@ybl/Payment 8500.00 116500.00',
    '25/01/2026 UPI/rahulsharma5@ybl/Payment 7800.00 124300.00',
  ]),
];
export const repeatedSamePartyCreditsExpected = { count: 3 };

// 6. AGGREGATED_LIMIT_MATCH - 2+ credits within a 7-day window summing to
//    within +/-5% of a round Rs.1,00,000 card-limit figure. Anchor is dated
//    two weeks before either target credit so it can't be swept into the
//    same 7-day window and shift the sum.
export const aggregatedLimitMatchPages = [
  page([
    ...HEADER,
    ANCHOR,
    '15/01/2026 NEFT PARTY A 48000.00 148000.00',
    '18/01/2026 NEFT PARTY B 50500.00 198500.00',
  ]),
];
export const aggregatedLimitMatchExpected = { sum: 98500, limit: 100000, gapDays: 3 };

// 7. CREDIT_FUNDS_CC_REPAYMENT - credit followed by a bill-payment-app
//    (CRED) debit of similar-ish size (90% here - deliberately outside the
//    tighter MATCHED_ROUND_TRIP 97-99% band, so this fixture produces ONLY
//    this one finding for the pair, proving the LOW tier in isolation).
//    Always LOW/INFORMATIONAL - must not raise risk_flags/overall_risk.
export const creditFundsCcRepaymentPages = [
  page([
    ...HEADER,
    ANCHOR,
    '02/01/2026 NEFT FROM CLIENT 30000.00 130000.00',
    '04/01/2026 CRED CARD BILL PAYMENT 27000.00 103000.00',
  ]),
];
export const creditFundsCcRepaymentExpected = { creditAmount: 30000, debitAmount: 27000, gapDays: 2 };
