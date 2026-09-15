// Reproduces the 2026-09-10 bug found in a real ICICI statement (Mohan
// Kumar M): the bank's own footer sign-off - "Sincerly, Team ICICI Bank"
// (typo included, confirmed real wording) - printed as the very last line
// of the document, got appended onto the LAST transaction's description
// instead of being discarded. Same root bug class as the S.No. leak
// (iciciStrayRowNumber.fixture.js) but at the document's END: a bare line
// with no date/amount, with nothing after it to belong to. The fix is
// POSITIONAL (any bare line after the last real transaction row is
// undiscardable footer noise), not a hardcoded phrase match - this fixture
// uses the real wording only to prove the general fix actually catches it.
import { page } from './pdfPageBuilder';

export const iciciFooterBoilerplatePages = [
  page([
    'ICICI BANK LIMITED',
    'Statement of Account',
    'Account Name: Mohan Kumar',
    'A/c No: 395201000999',
    'iDirect trxn',
    '8 03-08-2026 EBA/EQ Trade 03AUG/20260803120000 5000.00 281240.65',
    'UPI Payment',
    '9 04-08-2026 UPI/9876543210/grocerystore@ybl 1200.00 279940.65',
    'Sincerly, Team ICICI Bank',
  ]),
];

export const iciciFooterBoilerplateExpected = {
  lastTxnDescription: 'UPI Payment UPI/9876543210/grocerystore@ybl',
};
