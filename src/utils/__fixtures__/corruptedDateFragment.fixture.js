// Reproduces the "08/02/293" date-corruption pattern: a transaction-shaped
// row whose date field has a malformed 3-digit year fragment, mixed in with
// otherwise-valid transactions. Fabricated data only.
import { page } from './pdfPageBuilder';

export const corruptedDatePages = [
  page([
    'IDFC FIRST BANK LIMITED - STATEMENT OF ACCOUNT',
    'CUSTOMER NAME : Mrs. Fatima Sheikh',
    'DATE DESCRIPTION DEBIT CREDIT BALANCE',
    '08/02/293 CORRUPTED TEXT EXTRACTION ROW 1,000.00 50,000.00',
    '05/01/2026 SALARY CREDIT NEFT 45,000.00 95,000.00',
    '20/06/2026 UPI PAYMENT 5,000.00 90,000.00',
  ]),
];

export const corruptedDateExpectedPeriod = '05/01/2026 - 20/06/2026';
