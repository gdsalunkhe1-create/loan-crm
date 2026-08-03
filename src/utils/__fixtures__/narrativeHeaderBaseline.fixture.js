// Baseline "known good" fixture: a simple narrative-style statement header
// (the format the analyzer's original regexes were built around, before the
// IDFC table-style header exposed gaps). Kept as a regression guard so
// future changes to bankBehaviour.js can't silently break this already-
// working format while fixing a new one. Fabricated data only.
import { page } from './pdfPageBuilder';

export const narrativeHeaderPages = [
  page([
    'HDFC BANK LIMITED',
    'Thank you for banking with us.',
    'Account Name: Rohit Verma',
    'A/C No: 123456789012',
    '01/03/2026 SALARY CREDIT NEFT 50,000.00 1,50,000.00',
    '05/03/2026 ATM WDL CASH 3,000.00 1,47,000.00',
    '10/03/2026 UPI PAYMENT 2,500.00 1,44,500.00',
  ]),
];

export const narrativeHeaderExpected = {
  bank_name: 'HDFC BANK',
  account_holder: 'Rohit Verma',
  opening_balance: 100000, // 1,50,000.00 (txn1 balance) - 50,000.00 (txn1 credit)
  total_credits: 50000,
  total_debits: 5500, // 3,000 (ATM) + 2,500 (UPI)
};
