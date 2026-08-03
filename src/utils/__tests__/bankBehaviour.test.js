// Regression tests for the Bank Statement Analyzer parsing/extraction logic
// in bankBehaviour.js. See README.md in this folder for how to add a new
// fixture the next time a statement format reveals a new parsing bug.
import { analyzeBankStatement, linesToTransactions } from '../bankBehaviour';
import { __setMockPages } from 'pdfjs-dist';
import { idfcFirstTableHeaderPages, idfcFirstTableHeaderExpected } from '../__fixtures__/idfcFirstTableHeader.fixture';
import { corruptedDatePages, corruptedDateExpectedPeriod } from '../__fixtures__/corruptedDateFragment.fixture';
import { narrativeHeaderPages, narrativeHeaderExpected } from '../__fixtures__/narrativeHeaderBaseline.fixture';
import { lenderEmiRepaymentPages, lenderEmiRepaymentExpected } from '../__fixtures__/lenderEmiRepayments.fixture';

jest.mock('pdfjs-dist');

describe('IDFC FIRST Bank table-style header fixture (2026-07-15 bug fixes)', () => {
  let result;

  beforeAll(async () => {
    __setMockPages(idfcFirstTableHeaderPages);
    result = await analyzeBankStatement(new ArrayBuffer(0), '');
  });

  test('opening balance is derived from the real first transaction, not the repeated per-page banner', () => {
    expect(result.summary.opening_balance).toBe(idfcFirstTableHeaderExpected.opening_balance);
    expect(result.summary.opening_balance).not.toBe(123456.78);
  });

  test('bank name is detected from the header, not a bank mentioned in a transaction description', () => {
    expect(result.summary.bank_name).toBe(idfcFirstTableHeaderExpected.bank_name);
    expect(result.summary.bank_name).not.toBe('SBI');
    expect(result.summary.bank_name).not.toBe('HDFC BANK');
  });

  test('account holder matches an all-caps table-style label ("CUSTOMER NAME :")', () => {
    expect(result.summary.account_holder).toBe(idfcFirstTableHeaderExpected.account_holder);
    expect(result.summary.account_holder).not.toBe('');
  });

  test('duplicate consecutive rows and repeated per-page banners do not inflate totals', () => {
    expect(result.summary.total_credits).toBe(idfcFirstTableHeaderExpected.total_credits);
    expect(result.summary.total_debits).toBe(idfcFirstTableHeaderExpected.total_debits);
  });

  test('the repeated banner and duplicate row are excluded from the transaction list itself', () => {
    expect(result.transactionCount).toBe(7);
  });
});

describe('Corrupted date fragment ("08/02/293")', () => {
  test('parseDateFlexible-derived statement period ignores a malformed 3-digit-year row', async () => {
    __setMockPages(corruptedDatePages);
    const result = await analyzeBankStatement(new ArrayBuffer(0), '');
    expect(result.summary.statement_period).toBe(corruptedDateExpectedPeriod);
    expect(result.summary.statement_period).not.toMatch(/293/);
  });
});

describe('linesToTransactions() malformed-year guard (unit level)', () => {
  test('a 3-digit year fragment does not stop the row from being read as an amount-bearing line, but never survives into a valid parsed date downstream', () => {
    const txns = linesToTransactions(['08/02/293 CORRUPTED ROW 1,000.00 50,000.00']);
    expect(txns).toHaveLength(1);
    expect(txns[0].date).toBe('08/02/293');
  });
});

describe('EMI Tracker: fintech-lender repayments and ACH-DR bank auto-debits (2026-07-15 bug fix)', () => {
  let result;

  beforeAll(async () => {
    __setMockPages(lenderEmiRepaymentPages);
    result = await analyzeBankStatement(new ArrayBuffer(0), '');
  });

  test('EMI Tracker is not empty when repayments are lender-named rather than "EMI"-labeled', () => {
    expect(result.emi_obligations.length).toBe(lenderEmiRepaymentExpected.obligationCount);
  });

  test('bank ACH-DR (hyphenated) auto-debits are detected, not just space-separated "ACH D"', () => {
    const icici = result.emi_obligations.find(e => e.party.includes('ICICI'));
    expect(icici).toBeDefined();
    expect(icici.count).toBe(2);
  });

  test('the same lender printed under two different description formats is merged into one obligation, not split below the detection threshold', () => {
    const navi = result.emi_obligations.find(e => e.party === 'NAVI');
    expect(navi).toBeDefined();
    expect(navi.amount).toBe(lenderEmiRepaymentExpected.navi.amount);
    expect(navi.count).toBe(lenderEmiRepaymentExpected.navi.count);
  });

  test('a consistently-repeating fintech lender is detected with the correct median EMI amount', () => {
    const kisetsu = result.emi_obligations.find(e => e.party.includes('KISETSU'));
    expect(kisetsu).toBeDefined();
    expect(kisetsu.amount).toBe(lenderEmiRepaymentExpected.kisetsu.amount);
    expect(kisetsu.count).toBe(lenderEmiRepaymentExpected.kisetsu.count);
  });
});

describe('Baseline: narrative-header statement (already working before 2026-07-15)', () => {
  let result;

  beforeAll(async () => {
    __setMockPages(narrativeHeaderPages);
    result = await analyzeBankStatement(new ArrayBuffer(0), '');
  });

  test('bank name, account holder and totals are still detected correctly', () => {
    expect(result.summary.bank_name).toBe(narrativeHeaderExpected.bank_name);
    expect(result.summary.account_holder).toBe(narrativeHeaderExpected.account_holder);
    expect(result.summary.opening_balance).toBe(narrativeHeaderExpected.opening_balance);
    expect(result.summary.total_credits).toBe(narrativeHeaderExpected.total_credits);
    expect(result.summary.total_debits).toBe(narrativeHeaderExpected.total_debits);
  });

  test('no phantom transactions are introduced', () => {
    expect(result.transactionCount).toBe(3);
  });
});
