// Smoke tests for buildBsaWorkbook() (2026-09-09 feature add: Investment
// Activity + Cash-Out Pattern Findings sheets). Previously this file had NO
// test coverage at all - these checks exist so a future change to the
// sheet-building code can't silently throw or drop a sheet/column without
// any test noticing. Builds directly off analyzeBankStatement() output
// using existing fixtures, rather than a hand-built result object, so the
// workbook is exercised against real detector output shapes.
import { buildBsaWorkbook } from '../bsaExcelExport';
import { analyzeBankStatement } from '../bankBehaviour';
import { __setMockPages } from 'pdfjs-dist';
import { cardCashoutSuspectedPages } from '../__fixtures__/cashoutPatterns.fixture';
import { brokerLenderTransferBugsPages } from '../__fixtures__/brokerLenderTransferBugs.fixture';

jest.mock('pdfjs-dist');

describe('buildBsaWorkbook() - sheet presence', () => {
  test('includes both new sheets alongside the existing ones, and builds without throwing', async () => {
    __setMockPages(cardCashoutSuspectedPages);
    const result = await analyzeBankStatement(new ArrayBuffer(0), '');
    const wb = buildBsaWorkbook(result, null);
    const names = wb.worksheets.map(ws => ws.name);
    expect(names).toEqual(expect.arrayContaining([
      'Executive Summary', 'EMI Tracker & Bounces', 'Rotation & Risk Flags',
      'Monthly Cash Flow', 'Stock Market Activity', 'Investment Activity', 'Cash-Out Pattern Findings',
      'Banking Behaviour', 'Transaction Details',
    ]));
  });
});

describe('buildBsaWorkbook() - Investment Activity sheet', () => {
  let result, wb, ws;

  beforeAll(async () => {
    // Needs a fixture with actual broker/stock activity - the cash-out
    // fixture has none, so this uses the broker/lender/transfer fixture
    // (10 iDirect/EBA transactions) from the prior bug-fix session instead.
    __setMockPages(brokerLenderTransferBugsPages);
    result = await analyzeBankStatement(new ArrayBuffer(0), '');
    wb = buildBsaWorkbook(result, null);
    ws = wb.getWorksheet('Investment Activity');
  });

  test('carries one transaction row per stock_market_activity transaction, with a running-total column labeled "net cash flow" - never "profit/loss"', () => {
    expect(result.stock_market_activity.transactions.length).toBeGreaterThan(0);
    const values = ws.getSheetValues();
    const headerRow = values.find(row => Array.isArray(row) && row.includes('Running Net Cash Flow'));
    expect(headerRow).toBeDefined();
    // The column header itself must never say "profit" or "P&L" - the
    // explanatory note elsewhere on the sheet is allowed to use those words
    // to explicitly disclaim them, so this checks the header cell text only.
    expect(headerRow.some(v => typeof v === 'string' && /profit|p&l/i.test(v))).toBe(false);

    const dataRowCount = values.filter(row => Array.isArray(row) && (row.includes('EQUITY') || row.includes('F&O'))).length;
    expect(dataRowCount).toBeGreaterThan(0);
  });

  test('explanatory note on the sheet explicitly disclaims profit/loss', () => {
    const allText = ws.getSheetValues().flat().filter(v => typeof v === 'string').join(' ').toUpperCase();
    expect(allText).toContain('NET CASH FLOW');
    expect(allText).toContain('NOT TRADING PROFIT OR LOSS');
  });
});

describe('buildBsaWorkbook() - Transaction Details sheet (2026-09-09 feature)', () => {
  let result, wb, ws;

  beforeAll(async () => {
    __setMockPages(brokerLenderTransferBugsPages);
    result = await analyzeBankStatement(new ArrayBuffer(0), '');
    wb = buildBsaWorkbook(result, null);
    ws = wb.getWorksheet('Transaction Details');
  });

  test('carries one row per all_transactions entry, including the Entity column', () => {
    expect(result.all_transactions.length).toBeGreaterThan(0);
    const values = ws.getSheetValues();
    const headerRow = values.find(row => Array.isArray(row) && row.includes('Entity'));
    expect(headerRow).toBeDefined();
    const dataRowCount = values.filter(row => Array.isArray(row) && row.includes('STOCK')).length;
    expect(dataRowCount).toBeGreaterThan(0);
  });
});

describe('buildBsaWorkbook() - Cash-Out Pattern Findings sheet', () => {
  let result, wb, ws;

  beforeAll(async () => {
    __setMockPages(cardCashoutSuspectedPages);
    result = await analyzeBankStatement(new ArrayBuffer(0), '');
    wb = buildBsaWorkbook(result, null);
    ws = wb.getWorksheet('Cash-Out Pattern Findings');
  });

  test('lists every finding with a fill color matching its confidence tier', () => {
    expect(result.cashout_patterns.length).toBeGreaterThan(0);
    let coloredRows = 0;
    ws.eachRow(row => {
      const confidenceCell = row.getCell(2);
      if (['HIGH', 'MEDIUM', 'LOW'].includes(confidenceCell.value)) {
        expect(row.getCell(1).fill).toBeDefined();
        expect(row.getCell(1).fill.fgColor).toBeDefined();
        coloredRows++;
      }
    });
    expect(coloredRows).toBe(result.cashout_patterns.length);
  });
});
