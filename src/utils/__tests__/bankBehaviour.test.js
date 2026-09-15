// Regression tests for the Bank Statement Analyzer parsing/extraction logic
// in bankBehaviour.js. See README.md in this folder for how to add a new
// fixture the next time a statement format reveals a new parsing bug.
import { analyzeBankStatement, linesToTransactions, runBehaviourDetectors, computeCreditAssessment, buildAllTransactions } from '../bankBehaviour';
import { __setMockPages } from 'pdfjs-dist';
import { idfcFirstTableHeaderPages, idfcFirstTableHeaderExpected } from '../__fixtures__/idfcFirstTableHeader.fixture';
import { corruptedDatePages, corruptedDateExpectedPeriod } from '../__fixtures__/corruptedDateFragment.fixture';
import { narrativeHeaderPages, narrativeHeaderExpected } from '../__fixtures__/narrativeHeaderBaseline.fixture';
import { lenderEmiRepaymentPages, lenderEmiRepaymentExpected } from '../__fixtures__/lenderEmiRepayments.fixture';
import { brokerLenderTransferBugsPages, brokerLenderTransferBugsExpected } from '../__fixtures__/brokerLenderTransferBugs.fixture';
import { iciciStrayRowNumberPages, iciciStrayRowNumberExpected } from '../__fixtures__/iciciStrayRowNumber.fixture';
import { bajajMultiAmountEmiPages, bajajMultiAmountEmiExpected } from '../__fixtures__/bajajMultiAmountEmi.fixture';
import { iciciStyleTagLeakPages, iciciStyleTagLeakExpected } from '../__fixtures__/iciciStyleTagLeak.fixture';
import { iciciFooterBoilerplatePages, iciciFooterBoilerplateExpected } from '../__fixtures__/iciciFooterBoilerplate.fixture';
import { iciciAccountHolderFallbackPages, iciciAccountHolderFallbackExpected } from '../__fixtures__/iciciAccountHolderFallback.fixture';
import {
  cardCashoutSuspectedPages, cardCashoutSuspectedExpected,
  matchedRoundTripPages, matchedRoundTripExpected,
  exactMatchExcludedPages,
  creditThenCashWithdrawalPages, creditThenCashWithdrawalExpected,
  repeatedSamePartyCreditsPages, repeatedSamePartyCreditsExpected,
  aggregatedLimitMatchPages, aggregatedLimitMatchExpected,
  creditFundsCcRepaymentPages, creditFundsCcRepaymentExpected,
} from '../__fixtures__/cashoutPatterns.fixture';
import { page } from '../__fixtures__/pdfPageBuilder';

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

describe('ICICI Direct broker/lender/transfer bugs (2026-09-09 real-statement bug fixes)', () => {
  let result;

  beforeAll(async () => {
    __setMockPages(brokerLenderTransferBugsPages);
    result = await analyzeBankStatement(new ArrayBuffer(0), '');
  });

  test('CONFIRMED BUG 1: "iDirect trxn"/"EBA/..." narrations ARE detected as stock market activity, with a per-sub-type rollup', () => {
    expect(result.stock_market_activity.detected).toBe(true);
    expect(result.stock_market_activity.transaction_count).toBe(brokerLenderTransferBugsExpected.brokerTxnCount);
    const rollup = Object.fromEntries(result.stock_market_activity.sub_type_summary.map(r => [r.sub_type, r.transaction_count]));
    expect(rollup).toEqual(brokerLenderTransferBugsExpected.brokerSubTypes);
    expect(result.stock_market_activity.transactions.every(t => t.sub_type)).toBe(true);
  });

  test('CONFIRMED BUG 2: broker settlement credits do NOT get adopted as salary - salaryRows comes back empty', () => {
    const salaryRows = result.positive_signals.filter(p => p.type === 'REGULAR_SALARY');
    expect(salaryRows).toEqual([]);
  });

  test('CONFIRMED BUG 3: "BAJAJ_AUTO_CD" and "AD~1ADBAJAJFINNEW~" debits merge into ONE EMI obligation, not two separate under-threshold ones', () => {
    const bajaj = result.emi_obligations.find(e => e.party === brokerLenderTransferBugsExpected.bajajObligation.party);
    expect(bajaj).toBeDefined();
    expect(bajaj.count).toBe(brokerLenderTransferBugsExpected.bajajObligation.count);
    expect(bajaj.amount).toBe(brokerLenderTransferBugsExpected.bajajObligation.amount);
  });

  test('CONFIRMED BUG 4: INFT self-transfers clear the frequent_transfers threshold', () => {
    const inft = result.frequent_transfers.find(t => t.beneficiary === brokerLenderTransferBugsExpected.inftBeneficiary);
    expect(inft).toBeDefined();
    expect(inft.transfer_count).toBe(brokerLenderTransferBugsExpected.inftTransferCount);
    expect(inft.is_self).toBe(true);
  });
});

describe('ICICI HEADER_AND_TRAILING: stray S.No. column digit does not leak into the transaction description (2026-09-09 bug fix, CONFIRMED BUG 5)', () => {
  test('a bare 1-3 digit S.No. token immediately before the date is stripped, not merged into the narration', async () => {
    __setMockPages(iciciStrayRowNumberPages);
    const result = await analyzeBankStatement(new ArrayBuffer(0), '');
    const t = result.transactions.find(t => t.description.includes('EBA//20260804183025'));
    expect(t).toBeDefined();
    expect(t.description).toBe(iciciStrayRowNumberExpected.secondTxnDescription);
    expect(t.description).not.toMatch(/\b9\b/);
  });
});

describe('EMI Tracker: same lender, multiple financially distinct amount clusters (2026-09-10 real-statement bug fix)', () => {
  let result;

  beforeAll(async () => {
    __setMockPages(bajajMultiAmountEmiPages);
    result = await analyzeBankStatement(new ArrayBuffer(0), '');
  });

  test('the 5 real BAJAJ FINANCE debits are NOT collapsed into one obligation - each amount cluster becomes its own row', () => {
    const bajajRows = result.emi_obligations.filter(e => e.party === bajajMultiAmountEmiExpected.party);
    expect(bajajRows.length).toBe(bajajMultiAmountEmiExpected.clusters.length);
    const actual = bajajRows.map(r => ({ amount: r.amount, count: r.count })).sort((a, b) => a.amount - b.amount);
    const expected = [...bajajMultiAmountEmiExpected.clusters].sort((a, b) => a.amount - b.amount);
    expect(actual).toEqual(expected);
  });

  test('none of the 5 real debit amounts is silently dropped across the resulting rows', () => {
    const bajajRows = result.emi_obligations.filter(e => e.party === bajajMultiAmountEmiExpected.party);
    const allAmounts = bajajRows.flatMap(r => r.transactions.map(t => t.amount)).sort((a, b) => a - b);
    expect(allAmounts).toEqual([...bajajMultiAmountEmiExpected.allAmounts].sort((a, b) => a - b));
  });

  test('a clean two-cluster synthetic case: same lender, two clearly distinct EMI amounts, neither merged nor dropped', () => {
    const txn = (date, description, debit) => ({ date, description, debit, credit: 0, balance: 1000 });
    const detectors = runBehaviourDetectors([
      txn('01/01/2026', 'CMS/00111/BAJAJ_AUTO_CD__ICIC0001234', 590),
      txn('01/02/2026', 'CMS/00222/BAJAJ_AUTO_CD__ICIC0001234', 590),
      txn('01/03/2026', 'AD~1ADBAJAJFINNEW~01MAR26~ICIC', 22198),
      txn('01/04/2026', 'AD~1ADBAJAJFINNEW~01APR26~ICIC', 22198),
    ], '');
    const { emi_obligations } = computeCreditAssessment([
      txn('01/01/2026', 'CMS/00111/BAJAJ_AUTO_CD__ICIC0001234', 590),
      txn('01/02/2026', 'CMS/00222/BAJAJ_AUTO_CD__ICIC0001234', 590),
      txn('01/03/2026', 'AD~1ADBAJAJFINNEW~01MAR26~ICIC', 22198),
      txn('01/04/2026', 'AD~1ADBAJAJFINNEW~01APR26~ICIC', 22198),
    ], '', detectors, '');
    const bajajRows = emi_obligations.filter(e => e.party === 'BAJAJ FINANCE');
    expect(bajajRows.length).toBe(2);
    expect(bajajRows.map(r => ({ amount: r.amount, count: r.count })).sort((a, b) => a.amount - b.amount)).toEqual([
      { amount: 590, count: 2 },
      { amount: 22198, count: 2 },
    ]);
  });
});

describe('<style> tag leak in ICICI narrations (2026-09-10 real-statement bug fix)', () => {
  let result;

  beforeAll(async () => {
    __setMockPages(iciciStyleTagLeakPages);
    result = await analyzeBankStatement(new ArrayBuffer(0), '');
  });

  test('the parsed description has the style markup stripped, keeping only the inner narration text', () => {
    const t = result.transactions.find(t => t.description.includes('EBA/F&O Trade 04AUG'));
    expect(t).toBeDefined();
    expect(t.description).toBe(iciciStyleTagLeakExpected.cleanedDescription);
    expect(t.description).not.toMatch(/[<>]/);
    expect(t.description.toUpperCase()).not.toMatch(/STYLE|MULISH|FONTNAME/);
  });

  test('partyKey()-derived entity resolves toward the broker narration, not a "STYLE FONTNAME MULISH" pseudo-party', () => {
    const t = result.all_transactions.find(t => t.description.includes('EBA/F&O Trade 04AUG'));
    expect(t).toBeDefined();
    expect(t.entity).toMatch(/IDIRECT/);
    expect(t.entity.toUpperCase()).not.toMatch(/STYLE|MULISH|FONTNAME/);
  });
});

describe('End-of-document footer boilerplate is not appended to the last transaction (2026-09-10 real-statement bug fix)', () => {
  test('the bank\'s own sign-off line ("Sincerly, Team ICICI Bank") is discarded, not merged into the last transaction\'s description', async () => {
    __setMockPages(iciciFooterBoilerplatePages);
    const result = await analyzeBankStatement(new ArrayBuffer(0), '');
    const last = result.transactions[result.transactions.length - 1];
    expect(last).toBeDefined();
    expect(last.description).toBe(iciciFooterBoilerplateExpected.lastTxnDescription);
    expect(last.description.toUpperCase()).not.toMatch(/SINCERLY|ICICI BANK/);
  });
});

describe('account_holder fallback: unlabeled name in the ICICI header/address block (2026-09-10 cosmetic bug fix)', () => {
  test('"MOHAN KUMAR M" is picked up from the header block even with no "Customer Name:"/"Account Name:" label', async () => {
    __setMockPages(iciciAccountHolderFallbackPages);
    const result = await analyzeBankStatement(new ArrayBuffer(0), '');
    expect(result.summary.account_holder).toBe(iciciAccountHolderFallbackExpected.account_holder);
    expect(result.summary.account_holder).not.toBe('UNKNOWN');
  });
});

describe('CRED / bill-payment-app tagging and card-to-bank cash-out pattern detection (2026-09-09 feature)', () => {
  test('a CRED debit is tagged CREDIT_CARD_BILL_PAYMENT instead of falling through to UPI/OTHER, and produces a CARD_CASHOUT_SUSPECTED finding', async () => {
    __setMockPages(cardCashoutSuspectedPages);
    const result = await analyzeBankStatement(new ArrayBuffer(0), '');
    const credTxn = result.all_transactions.find(t => t.description.includes(cardCashoutSuspectedExpected.credDescription));
    expect(credTxn).toBeDefined();
    expect(credTxn.category).toBe('CREDIT_CARD_BILL_PAYMENT');

    const finding = result.cashout_patterns.find(f => f.pattern_type === 'CARD_CASHOUT_SUSPECTED');
    expect(finding).toBeDefined();
    expect(finding.confidence).toBe('MEDIUM');
    expect(finding.gap_days).toBe(cardCashoutSuspectedExpected.gapDays);
    expect(finding.transactions.map(t => t.amount).sort((a, b) => a - b)).toEqual(
      [cardCashoutSuspectedExpected.followUpAmount, cardCashoutSuspectedExpected.legAmount].sort((a, b) => a - b)
    );
    expect(finding.notes.length).toBeGreaterThan(0);
  });

  test('POST_MERCHANT_CREDIT also fires for the same large wallet-platform debit followed by a credit', async () => {
    __setMockPages(cardCashoutSuspectedPages);
    const result = await analyzeBankStatement(new ArrayBuffer(0), '');
    const finding = result.cashout_patterns.find(f => f.pattern_type === 'POST_MERCHANT_CREDIT');
    expect(finding).toBeDefined();
    expect(finding.confidence).toBe('LOW');
  });

  test('MATCHED_ROUND_TRIP: credit offset by a debit at 97-99% within 1-2 days is MEDIUM confidence with a notes field', async () => {
    __setMockPages(matchedRoundTripPages);
    const result = await analyzeBankStatement(new ArrayBuffer(0), '');
    const finding = result.cashout_patterns.find(f => f.pattern_type === 'MATCHED_ROUND_TRIP');
    expect(finding).toBeDefined();
    expect(finding.confidence).toBe('MEDIUM');
    expect(finding.gap_days).toBe(matchedRoundTripExpected.gapDays);
    expect(finding.notes).toEqual(expect.any(String));
    expect(finding.notes.length).toBeGreaterThan(0);
  });

  test('Confidence-tier rule: an exact amount-in -> amount-out pair does NOT produce a MATCHED_ROUND_TRIP finding at all', async () => {
    __setMockPages(exactMatchExcludedPages);
    const result = await analyzeBankStatement(new ArrayBuffer(0), '');
    expect(result.cashout_patterns.filter(f => f.pattern_type === 'MATCHED_ROUND_TRIP')).toEqual([]);
  });

  test('CREDIT_THEN_CASH_WITHDRAWAL: credit almost fully withdrawn as cash within 1-2 days is HIGH confidence (strongest signal)', async () => {
    __setMockPages(creditThenCashWithdrawalPages);
    const result = await analyzeBankStatement(new ArrayBuffer(0), '');
    const finding = result.cashout_patterns.find(f => f.pattern_type === 'CREDIT_THEN_CASH_WITHDRAWAL');
    expect(finding).toBeDefined();
    expect(finding.confidence).toBe('HIGH');
    expect(finding.gap_days).toBe(creditThenCashWithdrawalExpected.gapDays);
    // The same pair must not ALSO be double-counted as a separate
    // MATCHED_ROUND_TRIP finding - ATM debits are excluded from that branch.
    expect(result.cashout_patterns.filter(f => f.pattern_type === 'MATCHED_ROUND_TRIP')).toEqual([]);
    // A HIGH-confidence cashout finding rolls into risk_flags/overall_risk.
    expect(result.risk_flags.some(f => f.type === 'CASHOUT_PATTERN' && f.severity === 'HIGH')).toBe(true);
    expect(result.credit_assessment.overall_risk).toBe('HIGH');
  });

  test('REPEATED_SAME_PARTY_CREDITS: 3+ credits from the same UPI VPA within 30 days is LOW confidence', async () => {
    __setMockPages(repeatedSamePartyCreditsPages);
    const result = await analyzeBankStatement(new ArrayBuffer(0), '');
    const finding = result.cashout_patterns.find(f => f.pattern_type === 'REPEATED_SAME_PARTY_CREDITS');
    expect(finding).toBeDefined();
    expect(finding.confidence).toBe('LOW');
    expect(finding.transactions.length).toBe(repeatedSamePartyCreditsExpected.count);
  });

  test('AGGREGATED_LIMIT_MATCH: 2+ credits within a 7-day window summing within 5% of a round card-limit figure', async () => {
    __setMockPages(aggregatedLimitMatchPages);
    const result = await analyzeBankStatement(new ArrayBuffer(0), '');
    const finding = result.cashout_patterns.find(f => f.pattern_type === 'AGGREGATED_LIMIT_MATCH');
    expect(finding).toBeDefined();
    expect(finding.confidence).toBe('MEDIUM');
    expect(finding.gap_days).toBe(aggregatedLimitMatchExpected.gapDays);
    expect(finding.notes).toContain(aggregatedLimitMatchExpected.limit.toLocaleString('en-IN'));
  });

  test('CREDIT_FUNDS_CC_REPAYMENT: always LOW/INFORMATIONAL and must NOT contribute to risk_flags or overall_risk', async () => {
    __setMockPages(creditFundsCcRepaymentPages);
    const result = await analyzeBankStatement(new ArrayBuffer(0), '');
    const finding = result.cashout_patterns.find(f => f.pattern_type === 'CREDIT_FUNDS_CC_REPAYMENT');
    expect(finding).toBeDefined();
    expect(finding.confidence).toBe('LOW');
    expect(finding.gap_days).toBe(creditFundsCcRepaymentExpected.gapDays);
    expect(result.risk_flags.some(f => f.type === 'CASHOUT_PATTERN')).toBe(false);
    expect(result.credit_assessment.overall_risk).toBe('LOW');
  });
});

describe('CRED bare-substring false positive inside the English word "Credit" (2026-09-10 real-statement bug fix)', () => {
  const txn = (description, debit = 0, credit = 0) => ({ date: '01/01/2026', description, debit, credit, balance: 1000 });

  test('a generic "Credit trxn ... Self" self-transfer narration is NOT tagged CREDIT_CARD_BILL_PAYMENT', () => {
    const [t] = buildAllTransactions([txn('Credit trxn IMB/INFT/000111/Self', 5000)]);
    expect(t.category).not.toBe('CREDIT_CARD_BILL_PAYMENT');
  });

  test('a real CRED-app narration ("UPI/CRED/cred.club@axis/...") still matches CREDIT_CARD_BILL_PAYMENT', () => {
    const [t] = buildAllTransactions([txn('UPI/CRED/cred.club@axis/CRED Club Payment', 15000)]);
    expect(t.category).toBe('CREDIT_CARD_BILL_PAYMENT');
  });
});

describe('PLA / EMI bare-substring false positives inside "MARKETPLACE" and "PREMIUM" (2026-09-11 real-statement bug fix)', () => {
  const txn = (description, debit = 0, credit = 0) => ({ date: '01/01/2026', description, debit, credit, balance: 1000 });

  test('a "ZEPTO MARKETPLACE PRI" grocery debit is NOT tagged EMI (bare "PLA" inside "MARKETPLACE")', () => {
    const [t] = buildAllTransactions([txn('UPI/ZEPTOMARKETPL/Zepto Marketplace Pri', 345)]);
    expect(t.category).not.toBe('EMI');
  });

  test('an insurance premium debit is NOT tagged EMI (bare "EMI" inside "PREMIUM")', () => {
    const [t] = buildAllTransactions([txn('ICICI PRUDENTIAL LIFE PREMIUM DEBIT', 5000)]);
    expect(t.category).not.toBe('EMI');
    expect(t.category).toBe('INSURANCE');
  });

  test('a real standalone "EMI" narration still matches', () => {
    const [t] = buildAllTransactions([txn('PERSONAL LOAN EMI DEBIT', 5000)]);
    expect(t.category).toBe('EMI');
  });
});

describe('EMI Tracker: recurring merchant debits with no lender/EMI signal are never counted as an obligation (2026-09-11 real-statement bug fix)', () => {
  test('9 recurring Zepto grocery debits (no lender-dictionary or EMI-keyword match) produce ZERO EMI obligations, while a real lender-keyword-matched EMI in the same statement still does', () => {
    const zeptoTxns = [
      ...Array.from({ length: 6 }, (_, i) => mkTxn(`0${(i % 9) + 1}/01/2026`, 'UPI/ZEPTOMARKETPL/Zepto Marketplace Pri', { debit: 345, balance: 96000 - i * 345 })),
      ...Array.from({ length: 3 }, (_, i) => mkTxn(`0${(i % 9) + 1}/02/2026`, 'UPI/ZEPTOMARKETPL/Zepto Marketplace Pri', { debit: 1086, balance: 90000 - i * 1086 })),
    ];
    const bajajTxns = [
      mkTxn('05/01/2026', 'CMS/00111/BAJAJ_AUTO_CD__ICIC0001234', { debit: 9450, balance: 80000 }),
      mkTxn('05/02/2026', 'CMS/00222/BAJAJ_AUTO_CD__ICIC0001234', { debit: 9450, balance: 70550 }),
    ];
    const txns = [...zeptoTxns, ...bajajTxns];
    const detectors = runBehaviourDetectors(txns, '');
    const emis = computeCreditAssessment(txns, '', detectors, '').emi_obligations;
    expect(emis.find(e => e.party.includes('ZEPTO'))).toBeUndefined();
    expect(emis.some(e => /MARKETPLACE|ZEPTO/i.test(e.party))).toBe(false);
    const bajaj = emis.find(e => e.party === 'BAJAJ FINANCE');
    expect(bajaj).toBeDefined();
    expect(bajaj.count).toBe(2);
    expect(bajaj.amount).toBe(9450);
  });
});

describe('Broker fallback: STOCK requires a word boundary + two-or-more-word phrase, not a bare substring (2026-09-09 false-positive fix)', () => {
  const txn = (description, debit = 0, credit = 0) => ({ date: '01/01/2026', description, debit, credit, balance: 1000 });

  test('STOCKIST, LIVESTOCK, and "WOODSTOCK CAFE"-style narrations do NOT match the broker fallback (no word boundary around STOCK)', () => {
    const detectors = runBehaviourDetectors([
      txn('PAYMENT TO STOCKIST FOR GOODS', 5000),
      txn('LIVESTOCK FEED PURCHASE', 3000),
      txn('WOODSTOCK CAFE BILL PAYMENT', 450),
    ], '');
    expect(detectors.stock_market_activity.detected).toBe(false);
    expect(detectors.stock_market_activity.transaction_count).toBe(0);
  });

  test('a bare, isolated "STOCK" with no surrounding company-name context does NOT match', () => {
    const detectors = runBehaviourDetectors([txn('STOCK', 1000)], '');
    expect(detectors.stock_market_activity.detected).toBe(false);
  });

  test('a real unlisted-broker narration ("XYZ STOCK BROKING PVT LTD") still matches and tags UNLISTED BROKER', () => {
    const detectors = runBehaviourDetectors([txn('XYZ STOCK BROKING PVT LTD', 25000)], '');
    expect(detectors.stock_market_activity.detected).toBe(true);
    expect(detectors.stock_market_activity.transaction_count).toBe(1);
    expect(detectors.stock_market_activity.brokers_seen).toContain('UNLISTED BROKER');
  });

  test('STOCK paired with company-name-like context but no other broker keyword ("ABC STOCK MARKETS LTD") still matches via the STOCK fallback alone', () => {
    const detectors = runBehaviourDetectors([txn('ABC STOCK MARKETS LTD', 15000)], '');
    expect(detectors.stock_market_activity.detected).toBe(true);
    expect(detectors.stock_market_activity.brokers_seen).toContain('UNLISTED BROKER');
  });
});

// Shared helper for the detector-level unit tests below - constructs a
// transaction object directly (bypassing pdfToLines/linesToTransactions
// entirely), since these tests exercise runBehaviourDetectors()/
// computeCreditAssessment() directly and don't need real PDF parsing.
const mkTxn = (date, description, { debit = 0, credit = 0, balance = 0 } = {}) => ({ date, description, debit, credit, balance });

describe('Mutual fund / SIP detection (2026-09-09 feature)', () => {
  const mfTxns = [
    // Dual-purpose platform (GROWW) disambiguated by narration sub-text:
    // "SIP" -> mutual fund, no MF sub-text -> stays a broker/stock trade.
    mkTxn('01/01/2026', 'GROWW SIP INSTALLMENT', { debit: 5000, balance: 95000 }),
    mkTxn('01/02/2026', 'GROWW SIP INSTALLMENT', { debit: 5000, balance: 90000 }),
    mkTxn('05/01/2026', 'GROWW EQUITY DELIVERY BUY', { debit: 12000, balance: 78000 }),
    // MF-only AMC name (not in DICT.brokers at all) - always mutual fund,
    // recurring at similar amounts, deliberately the ONLY recurring credit
    // group in this fixture so it would win detectSalary's scoring if the
    // MF exclusion were missing (the same regression class as the
    // 2026-09-09 broker-settlement-as-salary bug).
    mkTxn('10/01/2026', 'HDFC MUTUAL FUND REDEMPTION', { credit: 20000, balance: 98000 }),
    mkTxn('10/02/2026', 'HDFC MUTUAL FUND REDEMPTION', { credit: 20500, balance: 118500 }),
    mkTxn('10/03/2026', 'HDFC MUTUAL FUND REDEMPTION', { credit: 19800, balance: 138300 }),
  ];
  let detectors, assessment;

  beforeAll(() => {
    detectors = runBehaviourDetectors(mfTxns, '');
    assessment = computeCreditAssessment(mfTxns, '', detectors, '');
  });

  test('a dual-purpose platform (GROWW) with "SIP" in the narration is tagged mutual fund, not stock', () => {
    const sipTxns = detectors.mutual_fund_activity.transactions.filter(t => t.sub_type === 'SIP');
    expect(sipTxns.length).toBe(2);
    expect(sipTxns.every(t => t.platform === 'GROWW')).toBe(true);
  });

  test('the same platform WITHOUT MF sub-text stays a broker/stock trade, not mutual fund', () => {
    expect(detectors.stock_market_activity.detected).toBe(true);
    expect(detectors.stock_market_activity.transaction_count).toBe(1);
    expect(detectors.stock_market_activity.transactions[0].description).toBe('GROWW EQUITY DELIVERY BUY');
    expect(detectors.mutual_fund_activity.transactions.some(t => t.description === 'GROWW EQUITY DELIVERY BUY')).toBe(false);
  });

  test('an MF-only AMC name (HDFC MUTUAL FUND) is always tagged mutual fund / REDEMPTION on credits, regardless of sub-text', () => {
    const redemptions = detectors.mutual_fund_activity.transactions.filter(t => t.sub_type === 'REDEMPTION');
    expect(redemptions.length).toBe(3);
    expect(redemptions.every(t => t.platform === 'HDFC MUTUAL FUND')).toBe(true);
    expect(detectors.mutual_fund_activity.total_redeemed).toBeCloseTo(60300);
  });

  test('two same-platform, same-amount SIP debits are grouped into a recurring sip_obligation', () => {
    const sip = detectors.mutual_fund_activity.sip_obligations.find(s => s.platform === 'GROWW');
    expect(sip).toBeDefined();
    expect(sip.amount).toBe(5000);
    expect(sip.count).toBe(2);
  });

  test('REGRESSION: recurring MF redemption credits do NOT get adopted as salary (same exclusion as broker settlements)', () => {
    expect(assessment.positive_signals.filter(p => p.type === 'REGULAR_SALARY')).toEqual([]);
    expect(assessment.credit_assessment.employer_name).toBe('');
  });
});

describe('MF redemption exclusion also matches ICICI\'s spaced "M F" narration format (2026-09-11 real-statement bug fix)', () => {
  // Real evidence: 4 credits from ICICI Prudential MF redemptions landed in
  // "Salary Credits" because the narration prints "M F" - a space between
  // every letter - not "MF" as one token, which matched neither the plain
  // substring DICT.mutualFundPlatforms check ('ICICI PRUDENTIAL MF' isn't a
  // substring of "...M F...") nor the MF_SUBTEXT_RE word-boundary regex.
  // employer_name surfaced as the meaningless "TRXN HDFCH ICICI" fragment.
  const spacedMfTxns = [
    mkTxn('05/02/2026', 'NEFT trxn NEFT-HDFCH01070877907-ICICI PRUDENTIAL M F REDEMPTION POOL A/C-XXXXXX', { credit: 45000, balance: 145000 }),
    mkTxn('04/03/2026', 'NEFT trxn NEFT-HDFCH01074412846-ICICI PRUDENTIAL M F REDEMPTION POOL A/C-XXXXXX', { credit: 46200, balance: 191200 }),
    mkTxn('05/04/2026', 'NEFT trxn NEFT-HDFCH01076497866-ICICI PRUDENTIAL M F REDEMPTION POOL A/C-XXXXXX', { credit: 44100, balance: 235300 }),
    mkTxn('06/05/2026', 'NEFT trxn NEFT-HDFCH01076497868-ICICI PRUDENTIAL M F REDEMPTION POOL A/C-XXXXXX', { credit: 45800, balance: 281100 }),
  ];

  test('the exact real "M F" (spaced) narration is excluded from detectSalary()\'s candidates', () => {
    const detectors = runBehaviourDetectors(spacedMfTxns, '');
    const result = computeCreditAssessment(spacedMfTxns, '', detectors, '');
    expect(result.credit_assessment.employer_name).toBe('');
    expect(result.credit_assessment.employer_name).not.toMatch(/HDFCH|ICICI/);
    expect(result.positive_signals.filter(p => p.type === 'REGULAR_SALARY')).toEqual([]);
  });

  test('the same narration is correctly tagged as mutual fund activity instead', () => {
    const detectors = runBehaviourDetectors(spacedMfTxns, '');
    expect(detectors.mutual_fund_activity.transaction_count).toBe(4);
    expect(detectors.mutual_fund_activity.transactions.every(t => t.sub_type === 'REDEMPTION')).toBe(true);
    expect(detectors.mutual_fund_activity.platforms_seen).toContain('ICICI PRUDENTIAL MF');
  });

  test('a spaced "S I P" debit narration is also recognized as SIP, not LUMPSUM', () => {
    const txns = [
      mkTxn('01/01/2026', 'GROWW S I P INSTALLMENT', { debit: 5000, balance: 95000 }),
      mkTxn('01/02/2026', 'GROWW S I P INSTALLMENT', { debit: 5000, balance: 90000 }),
    ];
    const detectors = runBehaviourDetectors(txns, '');
    const sipTxns = detectors.mutual_fund_activity.transactions.filter(t => t.sub_type === 'SIP');
    expect(sipTxns.length).toBe(2);
  });
});

describe('Loan-type bucketing (2026-09-09 feature): one case per classifyLoanType() bucket', () => {
  const loanTypeTxns = [
    // BNPL - recognized fintech-app lender (NAVI)
    mkTxn('05/01/2026', 'NAVI FINSERV EMI', { debit: 3000, balance: 97000 }),
    mkTxn('05/02/2026', 'NAVI FINSERV EMI', { debit: 3000, balance: 94000 }),
    // AUTO - an explicit "CAR LOAN" narration, NOT the generic BAJAJ_AUTO_CD
    // autodebit marker (see the dedicated describe block below for why that
    // one is deliberately PERSONAL, not AUTO, as of the 2026-09-11 fix).
    mkTxn('06/01/2026', 'CMS/00234/CAR LOAN EMI ICIC0001234', { debit: 9450, balance: 84550 }),
    mkTxn('06/02/2026', 'CMS/00567/CAR LOAN EMI ICIC0001234', { debit: 9450, balance: 75100 }),
    // HOME
    mkTxn('07/01/2026', 'HOME LOAN EMI HDFC0001', { debit: 25000, balance: 50100 }),
    mkTxn('07/02/2026', 'HOME LOAN EMI HDFC0001', { debit: 25000, balance: 25100 }),
    // BUSINESS
    mkTxn('08/01/2026', 'BUSINESS LOAN EMI EQUIPMENT', { debit: 15000, balance: 200000 }),
    mkTxn('08/02/2026', 'BUSINESS LOAN EMI EQUIPMENT', { debit: 15000, balance: 185000 }),
    // CREDIT_CARD - ICICI's own "PAVC" (Pay any Visa credit card) legend code
    mkTxn('09/01/2026', 'PAVC EMI ICICI CARD', { debit: 5000, balance: 180000 }),
    mkTxn('09/02/2026', 'PAVC EMI ICICI CARD', { debit: 5000, balance: 175000 }),
    // PERSONAL - fallback default, no other hint matches
    mkTxn('10/01/2026', 'PERSONAL LOAN EMI XYZ FINANCE', { debit: 8000, balance: 167000 }),
    mkTxn('10/02/2026', 'PERSONAL LOAN EMI XYZ FINANCE', { debit: 8000, balance: 159000 }),
  ];
  let emiObligations;

  beforeAll(() => {
    const detectors = runBehaviourDetectors(loanTypeTxns, '');
    emiObligations = computeCreditAssessment(loanTypeTxns, '', detectors, '').emi_obligations;
  });

  test.each([
    ['BNPL', 3000], ['AUTO', 9450], ['HOME', 25000], ['BUSINESS', 15000], ['CREDIT_CARD', 5000], ['PERSONAL', 8000],
  ])('%s bucket is classified correctly with the right monthly amount', (loanType, amount) => {
    const ob = emiObligations.find(e => e.loan_type === loanType);
    expect(ob).toBeDefined();
    expect(ob.count).toBe(2);
    expect(ob.amount).toBe(amount);
  });
});

describe('classifyLoanType(): generic AUTO_CD/AUTO CD autodebit marker is not an auto-loan signal (2026-09-11 real-statement bug fix)', () => {
  test('a real BAJAJ_AUTO_CD narration (confirmed PERSONAL loan) is classified PERSONAL, not AUTO', () => {
    const txns = [
      mkTxn('01/01/2026', 'CMS/00111/BAJAJ_AUTO_CD__ICIC0001234', { debit: 22198, balance: 96000 }),
      mkTxn('01/02/2026', 'CMS/00222/BAJAJ_AUTO_CD__ICIC0001234', { debit: 22198, balance: 73802 }),
    ];
    const detectors = runBehaviourDetectors(txns, '');
    const emis = computeCreditAssessment(txns, '', detectors, '').emi_obligations;
    const bajaj = emis.find(e => e.party === 'BAJAJ FINANCE');
    expect(bajaj).toBeDefined();
    expect(bajaj.loan_type).toBe('PERSONAL');
  });

  test('a narration that actually says VEHICLE LOAN/CAR LOAN still classifies AUTO', () => {
    const vehicleTxns = [
      mkTxn('01/01/2026', 'VEHICLE LOAN EMI XYZ FINANCE', { debit: 12000, balance: 96000 }),
      mkTxn('01/02/2026', 'VEHICLE LOAN EMI XYZ FINANCE', { debit: 12000, balance: 84000 }),
    ];
    const carTxns = [
      mkTxn('02/01/2026', 'CAR LOAN EMI ABC MOTORS FINANCE', { debit: 15000, balance: 96000 }),
      mkTxn('02/02/2026', 'CAR LOAN EMI ABC MOTORS FINANCE', { debit: 15000, balance: 81000 }),
    ];
    [vehicleTxns, carTxns].forEach(txns => {
      const detectors = runBehaviourDetectors(txns, '');
      const emis = computeCreditAssessment(txns, '', detectors, '').emi_obligations;
      expect(emis.some(e => e.loan_type === 'AUTO')).toBe(true);
    });
  });
});

describe('detectEmiDateDrift(): inferred bounce via EMI due-date drift (2026-09-11 real-statement feature)', () => {
  test('the exact real scenario - 8-month Bajaj obligation, 7 payments on the 2nd, 1 on the 3rd - flags only the 1-day-late payment', () => {
    const txns = [
      mkTxn('02/01/2026', 'CMS/00111/BAJAJ_AUTO_CD__ICIC0001234', { debit: 22198, balance: 500000 }),
      mkTxn('02/02/2026', 'CMS/00222/BAJAJ_AUTO_CD__ICIC0001234', { debit: 22198, balance: 477802 }),
      // The one drifted month - one day later than every other occurrence,
      // with no RETURN/BOUNCE/charge narration anywhere - the exact real
      // pattern this detector exists to catch.
      mkTxn('03/03/2026', 'CMS/00333/BAJAJ_AUTO_CD__ICIC0001234', { debit: 22198, balance: 455604 }),
      mkTxn('02/04/2026', 'CMS/00444/BAJAJ_AUTO_CD__ICIC0001234', { debit: 22198, balance: 433406 }),
      mkTxn('02/05/2026', 'CMS/00555/BAJAJ_AUTO_CD__ICIC0001234', { debit: 22198, balance: 411208 }),
      mkTxn('02/06/2026', 'CMS/00666/BAJAJ_AUTO_CD__ICIC0001234', { debit: 22198, balance: 389010 }),
      mkTxn('02/07/2026', 'CMS/00777/BAJAJ_AUTO_CD__ICIC0001234', { debit: 22198, balance: 366812 }),
      mkTxn('02/08/2026', 'CMS/00888/BAJAJ_AUTO_CD__ICIC0001234', { debit: 22198, balance: 344614 }),
    ];
    const detectors = runBehaviourDetectors(txns, '');
    const result = computeCreditAssessment(txns, '', detectors, '');
    const bajaj = result.emi_obligations.find(e => e.party === 'BAJAJ FINANCE');
    expect(bajaj).toBeDefined();
    expect(bajaj.count).toBe(8);

    const drift = result.emi_date_drift;
    expect(drift.length).toBe(1);
    expect(drift[0].pattern_type).toBe('EMI_DATE_DRIFT_SUSPECTED');
    expect(drift[0].party).toBe('BAJAJ FINANCE');
    expect(drift[0].date).toBe('03/03/2026');
    expect(drift[0].modal_day).toBe(2);
    expect(drift[0].actual_day).toBe(3);
    expect(drift[0].drift_days).toBe(1);
    expect(drift[0].confidence).toBe('MEDIUM');
    expect(drift[0].notes).toMatch(/verify manually/i);

    // Merged into ecs_returns for the Bounce Detail sheet, tagged distinctly
    // from an explicit, bank-confirmed return - and counted in TOTAL
    // BOUNCES there, per the fix.
    const mergedRow = result.ecs_returns.find(r => r.bounce_type === 'INFERRED_DATE_DRIFT');
    expect(mergedRow).toBeDefined();
    expect(mergedRow.return_date).toBe('03/03/2026');
    expect(mergedRow.party).toBe('BAJAJ FINANCE');
    // The other 7 on-time payments must NOT show up as separate drift rows.
    expect(result.ecs_returns.filter(r => r.bounce_type === 'INFERRED_DATE_DRIFT').length).toBe(1);
  });

  test('a payment earlier than the modal day is NOT flagged - only later-than-usual counts', () => {
    const txns = [
      mkTxn('05/01/2026', 'CMS/00111/BAJAJ_AUTO_CD__ICIC0001234', { debit: 22198, balance: 500000 }),
      mkTxn('05/02/2026', 'CMS/00222/BAJAJ_AUTO_CD__ICIC0001234', { debit: 22198, balance: 477802 }),
      // Paid EARLY (day 3) against a modal day of 5 - must not be flagged.
      mkTxn('03/03/2026', 'CMS/00333/BAJAJ_AUTO_CD__ICIC0001234', { debit: 22198, balance: 455604 }),
      mkTxn('05/04/2026', 'CMS/00444/BAJAJ_AUTO_CD__ICIC0001234', { debit: 22198, balance: 433406 }),
    ];
    const detectors = runBehaviourDetectors(txns, '');
    const result = computeCreditAssessment(txns, '', detectors, '');
    expect(result.emi_date_drift).toEqual([]);
  });
});

describe('detectLenderName() root-matcher stopwords: MAHINDRA (2026-09-11 real-statement bug fix)', () => {
  test('a "...Paymen/KOTAK MAHINDRA BANK" payee-bank mention on an ordinary grocery debit is NOT miscategorized as "MAHINDRA FINANCE" via root-matching', () => {
    // "EMI" is present so the debit clears detectEmiObligations' own gate -
    // this isolates the root-matcher specifically, not the gate itself.
    // Real evidence: repeat Zepto grocery orders where the recipient's own
    // bank happened to be Kotak Mahindra - India's 4th-largest private
    // bank, so this collision risk is common, not a rare edge case.
    const txns = [
      mkTxn('01/01/2026', 'UPI/Zepto Marketplace Paymen/KOTAK MAHINDRA BANK EMI', { debit: 345, balance: 96000 }),
      mkTxn('01/02/2026', 'UPI/Zepto Marketplace Paymen/KOTAK MAHINDRA BANK EMI', { debit: 345, balance: 92000 }),
    ];
    const detectors = runBehaviourDetectors(txns, '');
    const emis = computeCreditAssessment(txns, '', detectors, '').emi_obligations;
    expect(emis.find(e => e.party === 'MAHINDRA FINANCE')).toBeUndefined();
  });

  test('a real "MAHINDRA FINANCE" EMI narration still matches directly - only the fuzzy root fallback is affected', () => {
    const txns = [
      mkTxn('01/01/2026', 'MAHINDRA FINANCE EMI REPAYMENT', { debit: 8000, balance: 96000 }),
      mkTxn('01/02/2026', 'MAHINDRA FINANCE EMI REPAYMENT', { debit: 8000, balance: 88000 }),
    ];
    const detectors = runBehaviourDetectors(txns, '');
    const emis = computeCreditAssessment(txns, '', detectors, '').emi_obligations;
    expect(emis.find(e => e.party === 'MAHINDRA FINANCE')).toBeDefined();
  });
});

describe('detectLenderName() root-matcher stopwords: AMAZON, BHARAT, TATA (2026-09-09 false-positive fix)', () => {
  test('a plain Amazon.in shopping debit is NOT miscategorized as "AMAZON PAY LATER" via root-matching', () => {
    // "EMI" is present so the debit clears detectEmiObligations' own gate -
    // this isolates the root-matcher specifically, not the gate itself.
    const txns = [
      mkTxn('01/01/2026', 'AMAZON.IN EMI PURCHASE', { debit: 4000, balance: 96000 }),
      mkTxn('01/02/2026', 'AMAZON.IN EMI PURCHASE', { debit: 4000, balance: 92000 }),
    ];
    const detectors = runBehaviourDetectors(txns, '');
    const emis = computeCreditAssessment(txns, '', detectors, '').emi_obligations;
    expect(emis.find(e => e.party === 'AMAZON PAY LATER')).toBeUndefined();
  });

  test('a "BHARAT PETROLEUM" fuel-card narration is NOT miscategorized as "BHARAT LOAN" via root-matching', () => {
    const txns = [
      mkTxn('01/01/2026', 'BHARAT PETROLEUM EMI FUEL CARD', { debit: 2500, balance: 96000 }),
      mkTxn('01/02/2026', 'BHARAT PETROLEUM EMI FUEL CARD', { debit: 2500, balance: 92000 }),
    ];
    const detectors = runBehaviourDetectors(txns, '');
    const emis = computeCreditAssessment(txns, '', detectors, '').emi_obligations;
    expect(emis.find(e => e.party === 'BHARAT LOAN')).toBeUndefined();
  });

  test('a Tata Sky/Tata AIA-style consumer narration is NOT miscategorized as "TATA CAPITAL" via root-matching', () => {
    const txns = [
      mkTxn('01/01/2026', 'TATA SKY RECHARGE EMI', { debit: 500, balance: 96000 }),
      mkTxn('01/02/2026', 'TATA SKY RECHARGE EMI', { debit: 500, balance: 92000 }),
    ];
    const detectors = runBehaviourDetectors(txns, '');
    const emis = computeCreditAssessment(txns, '', detectors, '').emi_obligations;
    expect(emis.find(e => e.party === 'TATA CAPITAL')).toBeUndefined();
  });

  test('the real "AMAZON PAY LATER" and "BHARAT LOAN" EXACT phrases still match directly - only the fuzzy root fallback is affected', () => {
    const txns = [
      mkTxn('01/01/2026', 'AMAZON PAY LATER EMI', { debit: 4000, balance: 96000 }),
      mkTxn('01/02/2026', 'AMAZON PAY LATER EMI', { debit: 4000, balance: 92000 }),
      mkTxn('02/01/2026', 'BHARAT LOAN EMI REPAYMENT', { debit: 2500, balance: 89500 }),
      mkTxn('02/02/2026', 'BHARAT LOAN EMI REPAYMENT', { debit: 2500, balance: 87000 }),
    ];
    const detectors = runBehaviourDetectors(txns, '');
    const emis = computeCreditAssessment(txns, '', detectors, '').emi_obligations;
    expect(emis.find(e => e.party === 'AMAZON PAY LATER')).toBeDefined();
    expect(emis.find(e => e.party === 'BHARAT LOAN')).toBeDefined();
  });
});

describe('detectSalary()/detectSecondaryIncome(): self-transfers are excluded from income detection (2026-09-11 real-statement bug fix)', () => {
  // Real evidence: 7 credits narrated "Fund transfer INF/INFT/.../Self"
  // (varying amounts, Rs.29,697.58 to Rs.1,00,000) were adopted as "salary",
  // with employer_name surfacing as the nonsense "FUND INF INFT" -
  // partyKey() strips the transfer-rail codes and the word SELF, leaving
  // that residue as the grouping key.
  const selfTransferTxns = [
    mkTxn('05/02/2026', 'Fund transfer INF/INFT/000081245209/Self', { credit: 29697.58, balance: 129697.58 }),
    mkTxn('03/03/2026', 'Fund transfer INF/INFT/000081245310/Self', { credit: 45000, balance: 174697.58 }),
    mkTxn('04/04/2026', 'Fund transfer INF/INFT/000081245421/Self', { credit: 60000, balance: 234697.58 }),
    mkTxn('02/05/2026', 'Fund transfer INF/INFT/000081245532/Self', { credit: 75000, balance: 309697.58 }),
    mkTxn('06/06/2026', 'Fund transfer INF/INFT/000081245643/Self', { credit: 82000, balance: 391697.58 }),
    mkTxn('05/07/2026', 'Fund transfer INF/INFT/000081245754/Self', { credit: 91000, balance: 482697.58 }),
    mkTxn('03/08/2026', 'Fund transfer INF/INFT/000081245865/Self', { credit: 100000, balance: 582697.58 }),
  ];

  test('7 self-transfer credits produce NO salary group - falls back to "not clearly identified", nothing fabricated', () => {
    const detectors = runBehaviourDetectors(selfTransferTxns, '');
    const result = computeCreditAssessment(selfTransferTxns, '', detectors, '');
    expect(result.credit_assessment.employer_name).toBe('');
    expect(result.credit_assessment.employer_name).not.toMatch(/FUND|INF|INFT/i);
    expect(result.credit_assessment.income_stability).toBe('IRREGULAR');
    expect(result.positive_signals.filter(p => p.type === 'REGULAR_SALARY')).toEqual([]);
  });

  test('the same self-transfer credits are also excluded from secondary_income, not just primary salary', () => {
    const detectors = runBehaviourDetectors(selfTransferTxns, '');
    const result = computeCreditAssessment(selfTransferTxns, '', detectors, '');
    expect(result.secondary_income.find(s => /FUND|INF|INFT/i.test(s.source))).toBeUndefined();
  });

  test('a genuine salary pattern in the SAME statement is still correctly detected - the self-transfer exclusion is not overly broad', () => {
    const mixedTxns = [
      ...selfTransferTxns,
      mkTxn('01/02/2026', 'SALARY CREDIT NEFT ACME CORP LTD', { credit: 55000, balance: 55000 }),
      mkTxn('01/03/2026', 'SALARY CREDIT NEFT ACME CORP LTD', { credit: 55000, balance: 84697.58 }),
      mkTxn('01/04/2026', 'SALARY CREDIT NEFT ACME CORP LTD', { credit: 55000, balance: 144697.58 }),
    ];
    const detectors = runBehaviourDetectors(mixedTxns, '');
    const result = computeCreditAssessment(mixedTxns, '', detectors, '');
    expect(result.credit_assessment.employer_name).toContain('ACME');
    expect(result.credit_assessment.estimated_monthly_income).toBe(55000);
  });

  // Real evidence: "GILBARCO VEEDER ROOT INDIA PVT LTD" NEFT credits land
  // almost every month for 7 consecutive months (Rs.317,311.62 /
  // Rs.317,366 / Rs.251,209 / Rs.247,219 / Rs.242,234 x3 - ~12% CV, well
  // under the 0.4 secondary-income threshold) but appeared in NONE of
  // Monthly Salary Credits, Secondary Income Sources, or Irregular/
  // Unclassified Credits in the real export. Investigated categorizeTxn()/
  // irregular_credits (doesn't filter by category, ruled out), the CV
  // threshold (12% is nowhere near the 40% cutoff, ruled out), and every
  // DICT.lenders/wallets/brokers/mutualFundPlatforms entry for an
  // accidental substring collision (programmatically checked - zero
  // matches, ruled out). This scenario, reconstructed from the real
  // figures, correctly surfaces as the top-scoring recurring credit group
  // (adopted as salary, since nothing here disproves that reading) rather
  // than vanishing - proving detectSalary/detectSecondaryIncome's
  // count/CV/exclusion logic itself is not what caused the real
  // statement's total invisibility. That points to something specific to
  // the REAL narration text (exact reference-code format, or interaction
  // with another real credit group in the full 7-month statement) that
  // isn't reproducible from the figures alone - flagged back to Gauri to
  // pull the real narration strings for these 7 rows if it recurs after
  // this fix.
  test('a large, uneven-but-recurring non-salary-keyword credit group does not vanish - it is adopted as the top income candidate, not silently dropped', () => {
    const txns = [
      mkTxn('05/02/2026', 'NEFT GILBARCO VEEDER ROOT INDIA PVT LTD SETTLEMENT', { credit: 317311.62, balance: 317311.62 }),
      mkTxn('04/03/2026', 'NEFT GILBARCO VEEDER ROOT INDIA PVT LTD SETTLEMENT', { credit: 317366, balance: 634677.62 }),
      mkTxn('05/04/2026', 'NEFT GILBARCO VEEDER ROOT INDIA PVT LTD SETTLEMENT', { credit: 251209, balance: 885886.62 }),
      mkTxn('06/05/2026', 'NEFT GILBARCO VEEDER ROOT INDIA PVT LTD SETTLEMENT', { credit: 247219, balance: 1133105.62 }),
      mkTxn('04/06/2026', 'NEFT GILBARCO VEEDER ROOT INDIA PVT LTD SETTLEMENT', { credit: 242234, balance: 1375339.62 }),
      mkTxn('05/07/2026', 'NEFT GILBARCO VEEDER ROOT INDIA PVT LTD SETTLEMENT', { credit: 242234, balance: 1617573.62 }),
      mkTxn('04/08/2026', 'NEFT GILBARCO VEEDER ROOT INDIA PVT LTD SETTLEMENT', { credit: 242234, balance: 1859807.62 }),
    ];
    const detectors = runBehaviourDetectors(txns, '');
    const result = computeCreditAssessment(txns, '', detectors, '');
    const foundSomewhere =
      result.credit_assessment.employer_name.includes('GILBARCO') ||
      result.secondary_income.some(s => s.source.includes('GILBARCO')) ||
      detectors.irregular_credits.some(c => c.description.includes('GILBARCO'));
    expect(foundSomewhere).toBe(true);
  });

  test('the same recurring credit group still surfaces in secondary_income (not dropped) when a DIFFERENT group wins the primary salary slot', () => {
    const gilbarcoTxns = [
      mkTxn('05/02/2026', 'NEFT GILBARCO VEEDER ROOT INDIA PVT LTD SETTLEMENT', { credit: 317311.62, balance: 317311.62 }),
      mkTxn('04/03/2026', 'NEFT GILBARCO VEEDER ROOT INDIA PVT LTD SETTLEMENT', { credit: 317366, balance: 800000 }),
      mkTxn('05/04/2026', 'NEFT GILBARCO VEEDER ROOT INDIA PVT LTD SETTLEMENT', { credit: 251209, balance: 1200000 }),
      mkTxn('06/05/2026', 'NEFT GILBARCO VEEDER ROOT INDIA PVT LTD SETTLEMENT', { credit: 247219, balance: 1600000 }),
      mkTxn('04/06/2026', 'NEFT GILBARCO VEEDER ROOT INDIA PVT LTD SETTLEMENT', { credit: 242234, balance: 2000000 }),
      mkTxn('05/07/2026', 'NEFT GILBARCO VEEDER ROOT INDIA PVT LTD SETTLEMENT', { credit: 242234, balance: 2400000 }),
      mkTxn('04/08/2026', 'NEFT GILBARCO VEEDER ROOT INDIA PVT LTD SETTLEMENT', { credit: 242234, balance: 2800000 }),
    ];
    // A dominant, explicitly SALARY-keyword-labeled group so it outscores
    // GILBARCO for the single "best" salary slot (salaryHint doubles its
    // score) - forcing GILBARCO down the secondary-income path instead.
    const salaryTxns = Array.from({ length: 7 }, (_, i) =>
      mkTxn(`0${(i % 9) + 1}/0${(i % 8) + 1}/2026`, 'SALARY CREDIT NEFT ACME CORP LTD', { credit: 400000, balance: 3000000 + i * 400000 })
    );
    const txns = [...gilbarcoTxns, ...salaryTxns];
    const detectors = runBehaviourDetectors(txns, '');
    const result = computeCreditAssessment(txns, '', detectors, '');
    expect(result.credit_assessment.employer_name).toContain('ACME');
    expect(result.secondary_income.find(s => s.source.includes('GILBARCO'))).toBeDefined();
  });
});

describe('Employer name + salary date extraction (2026-09-09 feature, dropped during bug-fix sessions)', () => {
  test('a recurring salary group on the SAME exact day surfaces employer_name and an exact salary_date', () => {
    const txns = [
      mkTxn('01/01/2026', 'SALARY ACME CORP LTD', { credit: 50000, balance: 50000 }),
      mkTxn('01/02/2026', 'SALARY ACME CORP LTD', { credit: 50000, balance: 100000 }),
      mkTxn('01/03/2026', 'SALARY ACME CORP LTD', { credit: 50000, balance: 150000 }),
    ];
    const detectors = runBehaviourDetectors(txns, '');
    const assessment = computeCreditAssessment(txns, '', detectors, '');
    expect(assessment.credit_assessment.employer_name).toBeTruthy();
    expect(assessment.credit_assessment.salary_date).toBe('1st');
  });

  test('salary dates clustered around month-end (28th and 1st) report as a wraparound window, not a wide spread', () => {
    const txns = [
      mkTxn('28/01/2026', 'SALARY ACME CORP LTD', { credit: 50000, balance: 50000 }),
      mkTxn('01/03/2026', 'SALARY ACME CORP LTD', { credit: 50000, balance: 100000 }),
    ];
    const detectors = runBehaviourDetectors(txns, '');
    const assessment = computeCreditAssessment(txns, '', detectors, '');
    expect(assessment.credit_assessment.salary_date).toBe('28th-1st');
  });

  test('salary dates within a plain +/-3 day non-wraparound window report as that window', () => {
    const txns = [
      mkTxn('05/01/2026', 'SALARY ACME CORP LTD', { credit: 50000, balance: 50000 }),
      mkTxn('08/02/2026', 'SALARY ACME CORP LTD', { credit: 50000, balance: 100000 }),
    ];
    const detectors = runBehaviourDetectors(txns, '');
    const assessment = computeCreditAssessment(txns, '', detectors, '');
    expect(assessment.credit_assessment.salary_date).toBe('5th-8th');
  });

  test('no clear recurring salary pattern -> employer_name and salary_date come back empty, not fabricated', () => {
    const txns = [
      mkTxn('01/01/2026', 'NEFT FROM ONE PARTY', { credit: 15000, balance: 15000 }),
      mkTxn('15/02/2026', 'UPI FROM ANOTHER PARTY', { credit: 8000, balance: 23000 }),
    ];
    const detectors = runBehaviourDetectors(txns, '');
    const assessment = computeCreditAssessment(txns, '', detectors, '');
    expect(assessment.credit_assessment.employer_name).toBe('');
    expect(assessment.credit_assessment.salary_date).toBe('');
  });
});

describe('Low-balance-day banking behaviour (2026-09-09 feature)', () => {
  test('detects low-balance days and the longest consecutive streak at both threshold levels', () => {
    const txns = [
      mkTxn('01/01/2026', 'NEFT CREDIT SOMEONE', { credit: 10000, balance: 10000 }),
      mkTxn('02/01/2026', 'UPI PAYMENT SHOP1', { debit: 6000, balance: 4000 }),
      mkTxn('03/01/2026', 'UPI PAYMENT SHOP2', { debit: 3500, balance: 500 }),
      mkTxn('04/01/2026', 'UPI PAYMENT SHOP3', { debit: 200, balance: 300 }),
      mkTxn('05/01/2026', 'NEFT CREDIT SALARY', { credit: 20000, balance: 20300 }),
    ];
    const detectors = runBehaviourDetectors(txns, '');
    const th5000 = detectors.banking_behaviour.low_balance_days.find(t => t.threshold === 5000);
    const th1000 = detectors.banking_behaviour.low_balance_days.find(t => t.threshold === 1000);
    expect(th5000.count).toBe(3);
    expect(th5000.longest_streak).toBe(3);
    expect(th1000.count).toBe(2);
    expect(th1000.longest_streak).toBe(2);
  });

  test('flags a month with ATM withdrawal count meaningfully (>1.5x) above the statement average as frequent_withdrawal_month', () => {
    const txns = [
      mkTxn('05/01/2026', 'ATM WDL BRANCH1', { debit: 2000, balance: 98000 }),
      mkTxn('05/02/2026', 'ATM WDL BRANCH1', { debit: 2000, balance: 96000 }),
      mkTxn('05/03/2026', 'ATM WDL BRANCH1', { debit: 2000, balance: 94000 }),
      mkTxn('10/03/2026', 'ATM WDL BRANCH2', { debit: 2000, balance: 92000 }),
      mkTxn('15/03/2026', 'ATM WDL BRANCH3', { debit: 2000, balance: 90000 }),
      mkTxn('20/03/2026', 'ATM WDL BRANCH4', { debit: 2000, balance: 88000 }),
      mkTxn('25/03/2026', 'ATM WDL BRANCH5', { debit: 2000, balance: 86000 }),
    ];
    const detectors = runBehaviourDetectors(txns, '');
    const months = detectors.banking_behaviour.frequent_withdrawals;
    const march = months.find(m => m.count === 5);
    const jan = months.find(m => m.label && m.label.startsWith('Jan'));
    expect(march.frequent_withdrawal_month).toBe(true);
    expect(jan.frequent_withdrawal_month).toBe(false);
  });
});

describe('Credit card obligations rollup (2026-09-09 feature)', () => {
  test('groups recurring bill-payment-app debits (>=2 occurrences) as a CREDIT_CARD obligation, distinct from emi_obligations', () => {
    const txns = [
      mkTxn('05/01/2026', 'CRED APP BILL PAYMENT', { debit: 15000, balance: 85000 }),
      mkTxn('05/02/2026', 'CRED APP BILL PAYMENT', { debit: 18000, balance: 67000 }),
      mkTxn('05/03/2026', 'CRED APP BILL PAYMENT', { debit: 12000, balance: 55000 }),
    ];
    const detectors = runBehaviourDetectors(txns, '');
    const assessment = computeCreditAssessment(txns, '', detectors, '');
    const cc = detectors.credit_card_obligations.find(c => c.party === 'CRED');
    expect(cc).toBeDefined();
    expect(cc.loan_type).toBe('CREDIT_CARD');
    expect(cc.count).toBe(3);
    expect(cc.average_monthly_amount).toBe(15000);
    // Not double-counted as a separate EMI obligation.
    expect(assessment.emi_obligations.find(e => e.party === 'CRED')).toBeUndefined();
  });
});

describe('Balance-before/after on bounce events (2026-09-09 feature)', () => {
  test('a bounce carries the balance immediately before it and its own balance after', () => {
    const txns = [
      mkTxn('01/01/2026', 'OPENING CREDIT', { credit: 10000, balance: 10000 }),
      // "CHQ RETURN", not "ECS RETURN" - the latter contains "ECS RET",
      // which is itself a DICT.chargeWords entry, so it would get excluded
      // from `returns` entirely (classified as a charge line instead).
      mkTxn('05/01/2026', 'CHQ RETURN INSUFFICIENT FUNDS', { debit: 5000, balance: 5000 }),
    ];
    const detectors = runBehaviourDetectors(txns, '');
    const bounce = detectors.ecs_returns.find(r => r.return_date === '05/01/2026');
    expect(bounce).toBeDefined();
    expect(bounce.balance_before).toBe(10000);
    expect(bounce.balance_after).toBe(5000);
  });
});

describe('Irregular credits bucket (2026-09-09 feature)', () => {
  test('excludes everything claimed by salary, secondary income, broker/MF activity, wallet top-ups and lender disbursals, keeping only genuine one-offs', () => {
    const txns = [
      // Salary (best-scoring recurring group, wins via the SALARY keyword hint)
      mkTxn('01/01/2026', 'SALARY ACME CORP LTD', { credit: 50000, balance: 50000 }),
      mkTxn('01/02/2026', 'SALARY ACME CORP LTD', { credit: 50000, balance: 100000 }),
      // Secondary income (3+ occurrences, low CV, no salary keyword)
      mkTxn('05/01/2026', 'FREELANCE CLIENT WORK', { credit: 10000, balance: 110000 }),
      mkTxn('05/02/2026', 'FREELANCE CLIENT WORK', { credit: 10000, balance: 120000 }),
      mkTxn('05/03/2026', 'FREELANCE CLIENT WORK', { credit: 10000, balance: 130000 }),
      // Claimed by stock_market_activity
      mkTxn('10/01/2026', 'GROWW EQUITY SELL', { credit: 8000, balance: 138000 }),
      // Claimed by mutual_fund_activity
      mkTxn('11/01/2026', 'HDFC MUTUAL FUND REDEMPTION', { credit: 15000, balance: 153000 }),
      // Claimed by wallet_to_bank
      mkTxn('12/01/2026', 'PAYTM WALLET REFUND', { credit: 500, balance: 153500 }),
      // Claimed by small_loan_disbursals
      mkTxn('13/01/2026', 'NAVI FINSERV DISBURSAL', { credit: 20000, balance: 173500 }),
      // Genuine one-off - not claimed by anything
      mkTxn('15/01/2026', 'GIFT FROM FRIEND RAHUL', { credit: 3000, balance: 176500 }),
    ];
    const detectors = runBehaviourDetectors(txns, '');
    expect(detectors.irregular_credits.length).toBe(1);
    expect(detectors.irregular_credits[0]).toEqual({ date: '15/01/2026', amount: 3000, description: 'GIFT FROM FRIEND RAHUL' });
  });
});

describe('Per-month minimum balance (2026-09-09 feature)', () => {
  test('matches a hand-computed minimum balance per month on a synthetic multi-month fixture', () => {
    const txns = [
      mkTxn('01/01/2026', 'CREDIT ONE', { credit: 50000, balance: 50000 }),
      mkTxn('10/01/2026', 'DEBIT ONE', { debit: 20000, balance: 30000 }),
      mkTxn('20/01/2026', 'CREDIT TWO', { credit: 15000, balance: 45000 }),
      mkTxn('01/02/2026', 'DEBIT TWO', { debit: 25000, balance: 20000 }),
      mkTxn('10/02/2026', 'CREDIT THREE', { credit: 40000, balance: 60000 }),
      mkTxn('20/02/2026', 'DEBIT THREE', { debit: 55000, balance: 5000 }),
    ];
    const detectors = runBehaviourDetectors(txns, '');
    const assessment = computeCreditAssessment(txns, '', detectors, '');
    const jan = assessment.monthly_cashflow.find(m => m.month.startsWith('Jan'));
    const feb = assessment.monthly_cashflow.find(m => m.month.startsWith('Feb'));
    expect(jan.minimum_balance).toBe(30000);
    expect(feb.minimum_balance).toBe(5000);
  });
});

describe('Total cash withdrawal summary (2026-09-09 feature)', () => {
  test('totals count/amount and computes the average correctly across the whole statement', () => {
    const txns = [
      mkTxn('01/01/2026', 'ATM WDL BRANCH1', { debit: 2000, balance: 98000 }),
      mkTxn('05/01/2026', 'ATM WDL BRANCH2', { debit: 3000, balance: 95000 }),
      mkTxn('10/01/2026', 'CASH WITHDRAWAL COUNTER', { debit: 5000, balance: 90000 }),
    ];
    const detectors = runBehaviourDetectors(txns, '');
    expect(detectors.cash_withdrawal_summary.total_count).toBe(3);
    expect(detectors.cash_withdrawal_summary.total_amount).toBe(10000);
    expect(detectors.cash_withdrawal_summary.average_amount).toBeCloseTo(3333.33, 1);
  });
});

describe('Entity field (partyKey()) in buildAllTransactions() (2026-09-09 feature)', () => {
  test('entity is populated from partyKey() and stays empty (not fabricated) when partyKey() returns nothing', async () => {
    __setMockPages([
      page([
        'TEST BANK LTD',
        'Statement of Account',
        '01/01/2026 XYZ ENTERPRISES PAYMENT 5000.00 95000.00',
        // Every word here ("NEFT", "TRANSFER", "REF", "UTR") is on
        // partyKey()'s own stripped-word list, so nothing survives.
        '02/01/2026 NEFT TRANSFER REF UTR 3000.00 92000.00',
      ]),
    ]);
    const result = await analyzeBankStatement(new ArrayBuffer(0), '');
    const withEntity = result.all_transactions.find(t => t.description.includes('XYZ ENTERPRISES'));
    const withoutEntity = result.all_transactions.find(t => t.description.includes('NEFT TRANSFER'));
    expect(withEntity.entity).toBe('XYZ ENTERPRISES PAYMENT');
    expect(withoutEntity.entity).toBe('');
  });
});

describe('runBehaviourDetectors()/computeCreditAssessment() holderTokens drift (2026-09-09 regression pass finding)', () => {
  test('a self-transfer-to-own-account credit group is excluded from secondary_income AND correctly surfaces in irregular_credits, not silently swallowed by both - using the exact accountHolderOverride=\'\' pattern both Dashboard.js and Admin.js always call with', async () => {
    // Both real UI call sites always call analyzeBankStatement(buf, '') -
    // an empty override, relying entirely on the statement's own detected
    // header for the account holder's name. runBehaviourDetectors() used
    // to receive that raw (empty) override directly, while
    // computeCreditAssessment() fell back to the statement-detected name -
    // so the two functions' internal detectSecondaryIncome() calls could
    // disagree about which credits are a "self transfer" and should be
    // excluded. A separate, clearly-dominant SALARY-keyword group is
    // included so the self-transfer group can't win detectSalary() instead
    // (which doesn't consult holderTokens at all) and mask the bug.
    __setMockPages([
      page([
        'TEST BANK LTD',
        'Statement of Account',
        'Account Name: Ramesh Kumar',
        'A/c No: 123456789012',
        '01/01/2026 Initial Credit CR 50000.00 50000.00',
        '02/01/2026 TRANSFER FROM RAMESH KUMAR OWN AC 5000.00 55000.00',
        '05/01/2026 TRANSFER FROM RAMESH KUMAR OWN AC 5000.00 60000.00',
        '10/01/2026 TRANSFER FROM RAMESH KUMAR OWN AC 5000.00 65000.00',
        '15/01/2026 SALARY ACME CORP LTD CR 40000.00 105000.00',
        '15/02/2026 SALARY ACME CORP LTD CR 40000.00 145000.00',
      ]),
    ]);
    const result = await analyzeBankStatement(new ArrayBuffer(0), '');
    expect(result.secondary_income.some(s => s.source.includes('RAMESH'))).toBe(false);
    const selfTransferCredits = result.irregular_credits.filter(c => c.description.includes('RAMESH KUMAR OWN AC'));
    expect(selfTransferCredits.length).toBe(3);
    expect(selfTransferCredits.every(c => c.amount === 5000)).toBe(true);
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
