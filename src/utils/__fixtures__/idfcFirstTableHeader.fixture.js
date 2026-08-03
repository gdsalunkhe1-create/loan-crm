// Synthetic fixture reproducing the IDFC FIRST Bank table-style header
// pattern that exposed the 2026-07-15 parsing bugs: an all-caps labeled
// header ("CUSTOMER NAME :"), a per-page repeated "Opening Balance" banner
// sitting next to a date, a bank name that also appears (as a transfer
// counterparty) elsewhere in the ledger, and a duplicated transaction row.
// All names, account numbers and amounts are fabricated - not the real
// customer's statement. See README.md for how this fixture is used and how
// to add a new one.
import { page } from './pdfPageBuilder';

export const idfcFirstTableHeaderPages = [
  page([
    'IDFC FIRST BANK LIMITED - STATEMENT OF ACCOUNT',
    'CUSTOMER NAME : Mrs. Fatima Sheikh',
    'ACCOUNT NUMBER : 90123456789012',
    'STATEMENT PERIOD : 01-Jan-2026 to 30-Jun-2026',
    'OPENING BALANCE AS ON 01-JAN-2026 : 1,23,456.78',
    'DATE DESCRIPTION DEBIT CREDIT BALANCE',
    '05/01/2026 SALARY CREDIT NEFT 45,000.00 1,00,000.00',
    '10/01/2026 ATM WDL CASH 5,000.00 95,000.00',
    '15/01/2026 UPI PAYMENT TO SBI ACCOUNT 2,000.00 93,000.00',
    '15/01/2026 UPI PAYMENT TO SBI ACCOUNT 2,000.00 93,000.00',
    '20/01/2026 NEFT FROM HDFC BANK 10,000.00 1,03,000.00',
  ]),
  page([
    'IDFC FIRST BANK LIMITED - STATEMENT OF ACCOUNT (PAGE 2)',
    'OPENING BALANCE AS ON 01-JAN-2026 : 1,23,456.78',
    '25/01/2026 EMI PAYMENT 8,000.00 95,000.00',
    '30/06/2026 UPI PAYMENT REF12345 50,000.00 45,000.00',
    '30/06/2026 UPI REV REF12345 50,000.00 95,000.00',
  ]),
];

// Expected values once the real first transaction (05/01/2026) is correctly
// identified as transactions[0] - i.e. once the repeated banner line above
// is excluded rather than mistaken for a transaction.
export const idfcFirstTableHeaderExpected = {
  bank_name: 'IDFC FIRST BANK',
  account_holder: 'Mrs. Fatima Sheikh',
  opening_balance: 55000, // = 1,00,000.00 (txn1 balance) - 45,000.00 (txn1 credit), NOT the 1,23,456.78 decoy banner value
  total_credits: 105000,  // 45,000 (salary) + 10,000 (NEFT in) + 50,000 (UPI reversal)
  total_debits: 65000,    // 5,000 (ATM) + 2,000 (UPI, deduped from the doubled row) + 8,000 (EMI) + 50,000 (UPI out)
};
