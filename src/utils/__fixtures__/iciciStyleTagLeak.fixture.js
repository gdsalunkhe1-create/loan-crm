// Reproduces the 2026-09-10 bug found in a real ICICI statement (Mohan
// Kumar M): literal `<style fontName='Mulish Black' fontSize='8'>iDirect
// trxn</style>` / `<style fontName='Mulish' fontSize='8'>EBA/F&O Trade
// 03AUG/...</style>` markup is embedded directly in the extracted PDF text
// layer around each narration fragment - confirmed real content, not a
// display artifact. Left unstripped, it (a) clutters every description cell
// across the Stock Market Activity/Investment Activity/Cash-Out Pattern
// Findings sheets and (b) makes partyKey() extract a nonsense "STYLE
// FONTNAME MULISH" pseudo-party instead of anything IDIRECT/broker-related,
// polluting REPEATED_SAME_PARTY_CREDITS with a nonsensical note. Reuses the
// same S.No.-leak row shape as iciciStrayRowNumber.fixture.js (HEADER_AND_
// TRAILING merge strategy, bank name must resolve to ICICI) since the style
// tags appear on exactly that kind of row in the real statement. A plain
// (unstyled) row precedes the styled one, same as that fixture, so the
// styled row's own header line isn't also carrying the leading bank/account
// boilerplate that HEADER_AND_TRAILING unavoidably folds into the very
// FIRST transaction of any statement - not what this fixture is testing.
import { page } from './pdfPageBuilder';

export const iciciStyleTagLeakPages = [
  page([
    'ICICI BANK LIMITED',
    'Statement of Account',
    'Account Name: Mohan Kumar',
    'A/c No: 395201000999',
    'iDirect trxn',
    '8 03-08-2026 EBA/EQ Trade 03AUG/20260803120000 5000.00 281240.65',
    "<style fontName='Mulish Black' fontSize='8'>iDirect trxn</style>",
    "9 04-08-2026 <style fontName='Mulish' fontSize='8'>EBA/F&O Trade 04AUG/20260804183025</style> 1300.00 279940.65",
  ]),
];

export const iciciStyleTagLeakExpected = {
  cleanedDescription: 'iDirect trxn EBA/F&O Trade 04AUG/20260804183025',
};
