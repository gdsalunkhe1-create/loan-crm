// Reproduces the 2026-09-09 bug found in a real ICICI statement (Mohan
// Kumar M, A/c 395201000416, Aug 2026): row 9 of the PDF table
// (04.08.2026, iDirect trxn, EBA//20260804183025, 1300.00, 279940.65) came
// out of the exported description as literally
// "iDirect trxn 9 EBA//20260804183025" - the bare "9" is that row's S.No.
// column value, glued onto the same physical line as the date and the rest
// of the narration by pdfToLines()'s row-bucketing, then surviving
// date/amount stripping as stray text. Only reproducible under ICICI's
// HEADER_AND_TRAILING merge strategy (a bare header line precedes each
// dated line), so the bank name here must resolve to ICICI. All
// account/amount details are fabricated but the row SHAPE - a 1-3 digit
// S.No. immediately before the date on the same line - matches the real
// PDF exactly.
import { page } from './pdfPageBuilder';

export const iciciStrayRowNumberPages = [
  page([
    'ICICI BANK LIMITED',
    'Statement of Account',
    'Account Name: Mohan Kumar',
    'A/c No: 395201000999',
    'iDirect trxn',
    '8 03-08-2026 EBA/EQ Trade 03AUG/20260803120000 5000.00 281240.65',
    'iDirect trxn',
    '9 04-08-2026 EBA//20260804183025 1300.00 279940.65',
  ]),
];

export const iciciStrayRowNumberExpected = {
  secondTxnDescription: 'iDirect trxn EBA//20260804183025',
};
