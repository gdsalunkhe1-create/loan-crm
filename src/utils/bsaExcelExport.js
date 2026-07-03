// bsaExcelExport.js — builds the multi-sheet Bank Statement Analysis workbook
// (Executive Summary / EMI Tracker & Bounces / Rotation & Risk Flags /
// Monthly Cash Flow / Stock Market Activity) from the object returned by
// analyzeBankStatement() in bankBehaviour.js. No API — pure client-side.
import * as XLSX from 'xlsx';

const inr = n => Number(n) || 0;

function sheetFromRows(rows, colWidths) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (colWidths) ws['!cols'] = colWidths.map(w => ({ wch: w }));
  return ws;
}

export function buildBsaWorkbook(result) {
  const sm = result.summary || {};
  const ca = result.credit_assessment || {};
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Executive Summary ──────────────────────────────────────────
  const salaryRows = (result.positive_signals || []).filter(p => p.type === 'REGULAR_SALARY');
  const avgSalary = salaryRows.length ? Math.round(salaryRows.reduce((s, r) => s + inr(r.amount), 0) / salaryRows.length) : ca.estimated_monthly_income || 0;

  const s1 = [
    [`BANK STATEMENT ANALYSIS — ${sm.account_holder || 'UNKNOWN'}`],
    [`${sm.bank_name || ''} | A/c ${sm.account_number || ''} | Period: ${sm.statement_period || ''}`],
    [],
    ['KEY ACCOUNT METRICS'],
    ['Metric', 'Value', 'Metric', 'Value'],
    ['Opening Balance', sm.opening_balance || 0, 'Closing Balance', sm.closing_balance || 0],
    ['Total Deposits', sm.total_credits || 0, 'Total Withdrawals', sm.total_debits || 0],
    ['Net Cash Flow', (sm.total_credits || 0) - (sm.total_debits || 0), 'Avg Monthly Balance', sm.average_monthly_balance || 0],
    ['No. of Salary Credits', salaryRows.length, 'Avg Monthly Salary', avgSalary],
    ['Total Known EMI Obligation', ca.total_emi_burden || 0, 'FOIR (EMI/Income)', (ca.foir_estimate || 0) + '%'],
    ['Overall Risk', ca.overall_risk || '', 'Recommendation', ca.recommendation || ''],
    [],
    ['ANALYST NOTES'],
    [ca.summary_notes || ''],
    [],
    ['MONTHLY SALARY CREDITS'],
    ['Date', 'Amount', 'Description'],
    ...salaryRows.map(r => [r.date, inr(r.amount), r.description]),
  ];
  XLSX.utils.book_append_sheet(wb, sheetFromRows(s1, [26, 18, 26, 18]), 'Executive Summary');

  // ── Sheet 2: EMI Tracker & Bounces ──────────────────────────────────────
  const emis = result.emi_obligations || [];
  const ecs = result.ecs_returns || [];
  const s2 = [
    [`EMI TRACKER & BOUNCE ANALYSIS — ${sm.account_holder || ''}`],
    [],
    ['EMI / LOAN OBLIGATIONS OBSERVED'],
    ['#', 'Party / Lender', 'Type', 'Monthly EMI', 'Count', 'First Seen', 'Last Seen'],
    ...emis.map((e, i) => [i + 1, e.party, e.type, inr(e.amount), e.count, e.first_seen, e.last_seen]),
    [],
    ['BOUNCE DETAIL — ECS / NACH / CHEQUE RETURNS'],
    ['Party', 'Type', 'Return Date', 'Return Amount', 'Charge Date', 'Charge Amount', 'Charge Description'],
    ...ecs.map(r => [r.party, r.return_type, r.return_date, inr(r.return_amount), r.charge_date, inr(r.charge_amount), r.charge_description]),
    [],
    [`TOTAL BOUNCES: ${ecs.filter(r => r.return_date).length}`],
  ];
  XLSX.utils.book_append_sheet(wb, sheetFromRows(s2, [22, 22, 12, 14, 8, 14, 14, 30]), 'EMI Tracker & Bounces');

  // ── Sheet 3: Rotation & Risk Flags ──────────────────────────────────────
  const rot = (result.cc_card_rotation && result.cc_card_rotation.transactions) || [];
  const selfXfer = (result.frequent_transfers || []);
  const flags = result.risk_flags || [];
  const s3 = [
    [`CREDIT CARD ROTATION & RISK ANALYSIS — ${sm.account_holder || ''}`],
    [],
    ['POS / AGGREGATOR SETTLEMENT CREDITS (CARD-TO-CASH INDICATOR)'],
    ['Vendor', 'Date', 'Amount', 'Description'],
    ...rot.map(t => [t.vendor, t.date, inr(t.amount), t.description]),
    [],
    ['SELF / FREQUENT TRANSFER PATTERN'],
    ['Beneficiary', 'Self?', 'Transfer Count', 'Total Amount', 'First Date', 'Last Date'],
    ...selfXfer.map(t => [t.beneficiary, t.is_self ? 'YES' : 'NO', t.transfer_count, inr(t.total_amount), t.first_date, t.last_date]),
    [],
    ['CONSOLIDATED RISK FLAGS'],
    ['#', 'Type', 'Severity', 'Date', 'Description', 'Amount'],
    ...flags.map((f, i) => [i + 1, f.type, f.severity, f.date, f.description, inr(f.amount)]),
  ];
  XLSX.utils.book_append_sheet(wb, sheetFromRows(s3, [24, 8, 22, 16, 40, 14]), 'Rotation & Risk Flags');

  // ── Sheet 4: Monthly Cash Flow ───────────────────────────────────────────
  const mc = result.monthly_cashflow || [];
  const s4 = [
    [`MONTHLY CASH FLOW SUMMARY — ${sm.account_holder || ''}`],
    [],
    ['Month', 'Total Credit', 'Total Debit', 'Closing Balance', 'Bounce Count'],
    ...mc.map(m => [m.month, inr(m.total_credit), inr(m.total_debit), inr(m.closing_balance), m.bounce_count]),
  ];
  XLSX.utils.book_append_sheet(wb, sheetFromRows(s4, [12, 16, 16, 18, 14]), 'Monthly Cash Flow');

  // ── Sheet 5: Stock Market Activity ──────────────────────────────────────
  const stk = result.stock_market_activity || {};
  const s5 = [
    [`STOCK MARKET / BROKER ACTIVITY — ${sm.account_holder || ''}`],
    [],
    ['Detected', stk.detected ? 'YES' : 'NO'],
    ['Transaction Count', stk.transaction_count || 0],
    ['Total Invested', inr(stk.total_invested)],
    ['Total Withdrawn', inr(stk.total_withdrawn)],
    ['Brokers Seen', (stk.brokers_seen || []).join(', ')],
    [],
    ['TRANSACTIONS'],
    ['Broker', 'Date', 'Amount', 'Direction', 'Description'],
    ...(stk.transactions || []).map(t => [t.broker, t.date, inr(t.amount), t.direction, t.description]),
  ];
  XLSX.utils.book_append_sheet(wb, sheetFromRows(s5, [18, 14, 14, 12, 40]), 'Stock Market Activity');

  return wb;
}

export function downloadBsaWorkbook(result) {
  const wb = buildBsaWorkbook(result);
  const name = (result.summary?.account_holder || 'statement').replace(/\s+/g, '_');
  XLSX.writeFile(wb, `BSA_${name}_${Date.now()}.xlsx`);
}