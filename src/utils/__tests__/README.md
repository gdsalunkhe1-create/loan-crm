# Bank Statement Analyzer parsing tests

Regression tests for the parsing/extraction logic in `../bankBehaviour.js`
(PDF line grouping, transaction parsing, header detection, credit
assessment). These exist because on 2026-07-15 a real IDFC FIRST Bank
statement exposed five silent parsing bugs (phantom transaction rows from a
repeated per-page banner, bank misdetection, a case-sensitive header regex,
a malformed-date crash, and duplicate-line double-counting) that no test
would have caught. This is now the standard place to add a fixture instead
of debugging a new format live against a real customer statement.

## How it works

`analyzeBankStatement()` calls into `pdfjs-dist` to read the PDF's text
layer. Tests never touch a real PDF file or the real pdfjs worker - instead
`src/__mocks__/pdfjs-dist.js` is a manual Jest mock that hands back
synthetic text rows you define in a fixture. Call `__setMockPages(pages)`
before invoking `analyzeBankStatement()`, and it flows through the exact
same code path a real PDF would (page/row grouping, `linesToTransactions()`,
`detectHeader()`, `computeCreditAssessment()`, duplicate-row skipping - all
of it), just without needing a binary PDF fixture checked into the repo.

## Adding a fixture for a newly-discovered bug

1. **Never commit a real customer's statement or personal details.** Build a
   synthetic fixture with fake names/accounts/amounts that reproduces the
   *structural* pattern that broke - the label format, the repeated banner,
   the corrupted value, whatever it was. That structural shape is what you're
   protecting against regressing, not the specific numbers.
2. Add a file under `../__fixtures__/`, e.g. `../__fixtures__/someNewBank.fixture.js`. Use
   the `page(lines)` helper from `../__fixtures__/pdfPageBuilder.js` - pass an
   ordered array of line strings (top of the page first) and it builds the
   synthetic pdf.js row/coordinate data for you. Export the `pages` array
   plus whatever "expected" values your test will assert against, so the
   correct numbers are documented next to the fixture instead of buried
   inline in the test.
3. In `bankBehaviour.test.js`, import the fixture, call `__setMockPages(...)`,
   call `analyzeBankStatement(new ArrayBuffer(0), '')`, and assert on the
   specific field that was wrong (`result.summary.bank_name`,
   `result.summary.opening_balance`, `result.transactionCount`, etc.) rather
   than snapshotting the whole result - a targeted assertion tells you
   exactly what regressed.
4. If the fix only touches a small pure function (like
   `parseDateFlexible`'s year-format guard), it's fine to also add a small
   unit-level test through whatever's already exported from
   `bankBehaviour.js` (see the `linesToTransactions()` test in this suite for
   an example) - you don't need to route every assertion through the full
   `analyzeBankStatement()` pipeline if a narrower one proves the point.
5. Run `CI=true npm test` (or `npx react-scripts test --watchAll=false`) and
   confirm the new test fails against the old code and passes against the
   fix, then keep it in the suite permanently.

## Existing fixtures

- `idfcFirstTableHeader.fixture.js` - the 2026-07-15 bug pattern: all-caps
  `"CUSTOMER NAME :"` label, a repeated per-page opening-balance banner sitting
  next to a date, a bank name that also shows up as a transfer counterparty
  elsewhere in the ledger, and a duplicated transaction row.
- `corruptedDateFragment.fixture.js` - the `"08/02/293"` malformed-year
  pattern, isolated from the fixture above so it can be reused independently.
- `narrativeHeaderBaseline.fixture.js` - a plain narrative-style statement
  (the format the original header regexes were built for), kept as a
  regression guard so a future fix to the table-header path can't silently
  break the format that already worked.
