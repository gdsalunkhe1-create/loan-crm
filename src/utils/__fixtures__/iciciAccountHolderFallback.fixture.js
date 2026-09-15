// Reproduces the 2026-09-10 cosmetic bug found in a real ICICI statement:
// account_holder came back "UNKNOWN" even though "MOHAN KUMAR M" appears in
// the PDF's own header/address block - just with no "Customer Name:"/
// "Account Name:" label and not on line 1 either (ICICI's letterhead line
// comes first). Lower priority than the FOIR-affecting bugs (cosmetic
// only), so this exercises the last, most conservative fallback in
// detectHeader() - a BANNER_WORDS-filtered scan of the first 15 header
// lines for a line that looks like a plausible name.
import { page } from './pdfPageBuilder';

export const iciciAccountHolderFallbackPages = [
  page([
    'ICICI BANK LIMITED',
    'MOHAN KUMAR M',
    'Statement of Account',
    'A/c No: 395201000999',
    '01/08/2026 NEFT CR FROM EMPLOYER SALARY 50000.00 150000.00',
    '02/08/2026 UPI/9876543210/grocerystore@ybl 1200.00 148800.00',
  ]),
];

export const iciciAccountHolderFallbackExpected = {
  account_holder: 'MOHAN KUMAR M',
};
