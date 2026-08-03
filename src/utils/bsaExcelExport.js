// bsaExcelExport.js — builds the multi-sheet Bank Statement Analysis workbook
// (Executive Summary / EMI Tracker & Bounces / Rotation & Risk Flags /
// Monthly Cash Flow / Stock Market Activity) from the object returned by
// analyzeBankStatement() in bankBehaviour.js. No API — pure client-side.
// Uses exceljs (not xlsx/SheetJS) so real cell colors, fonts and borders
// can be written, not just number formats.
import ExcelJS from 'exceljs';

const inr = n => Number(n) || 0;
const CUR = '₹#,##0.00';
const PCT = '0.0%';
const FONT = 'Arial';

const TITLE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC00000' } };
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E5597' } };
const THIN = { style: 'thin' };
const THIN_BORDER = { top: THIN, bottom: THIN, left: THIN, right: THIN };

// Wraps a worksheet with row-adding helpers so every sheet applies the same
// title / section-header / column-header / data styling consistently.
function sheetHelpers(ws, numCols) {
  const bandRow = (values, { size, color, fill }) => {
    const row = ws.addRow(values);
    for (let c = 1; c <= numCols; c++) {
      const cell = row.getCell(c);
      cell.font = { name: FONT, size, bold: true, color: { argb: color } };
      cell.fill = fill;
      cell.border = THIN_BORDER;
    }
    return row;
  };
  return {
    title: (text) => bandRow([text], { size: 13, color: 'FFFFFFFF', fill: TITLE_FILL }),
    header: (values) => bandRow(Array.isArray(values) ? values : [values], { size: 10, color: 'FFFFFFFF', fill: HEADER_FILL }),
    data: (values, { fmts = {}, bold = [] } = {}) => {
      const row = ws.addRow(values);
      values.forEach((_, i) => {
        const c = i + 1;
        const cell = row.getCell(c);
        cell.font = { name: FONT, size: 9, bold: bold.includes(c) };
        if (fmts[c]) cell.numFmt = fmts[c];
      });
      return row;
    },
    blank: () => ws.addRow([]),
  };
}

export function buildBsaWorkbook(result, cibilData) {
  const sm = result.summary || {};
  const ca = result.credit_assessment || {};
  const wb = new ExcelJS.Workbook();

  // ── Sheet 1: Executive Summary ──────────────────────────────────────────
  const salaryRows = (result.positive_signals || []).filter(p => p.type === 'REGULAR_SALARY');
  const avgSalary = salaryRows.length ? Math.round(salaryRows.reduce((s, r) => s + inr(r.amount), 0) / salaryRows.length) : ca.estimated_monthly_income || 0;

  const colWidths1 = [26, 18, 26, 18];
  const ws1 = wb.addWorksheet('Executive Summary');
  ws1.columns = colWidths1.map(w => ({ width: w }));
  const s1 = sheetHelpers(ws1, colWidths1.length);
  s1.title(`BANK STATEMENT ANALYSIS — ${sm.account_holder || 'UNKNOWN'}`);
  s1.data([`${sm.bank_name || ''} | A/c ${sm.account_number || ''} | Period: ${sm.statement_period || ''}`]);
  s1.blank();
  s1.header('KEY ACCOUNT METRICS');
  s1.header(['Metric', 'Value', 'Metric', 'Value']);
  s1.data(['Opening Balance', sm.opening_balance || 0, 'Closing Balance', sm.closing_balance || 0], { fmts: { 2: CUR, 4: CUR }, bold: [2, 4] });
  s1.data(['Total Deposits', sm.total_credits || 0, 'Total Withdrawals', sm.total_debits || 0], { fmts: { 2: CUR, 4: CUR }, bold: [2, 4] });
  s1.data(['Net Cash Flow', (sm.total_credits || 0) - (sm.total_debits || 0), 'Avg Monthly Balance', sm.average_monthly_balance || 0], { fmts: { 2: CUR, 4: CUR }, bold: [2, 4] });
  s1.data(['No. of Salary Credits', salaryRows.length, 'Avg Monthly Salary', avgSalary], { fmts: { 4: CUR }, bold: [2, 4] });
  s1.data(['Total Known EMI Obligation', ca.total_emi_burden || 0, 'FOIR (EMI/Income)', (ca.foir_estimate || 0) / 100], { fmts: { 2: CUR, 4: PCT }, bold: [2, 4] });
  s1.data(['Overall Risk', ca.overall_risk || '', 'Recommendation', ca.recommendation || ''], { bold: [2, 4] });
  s1.blank();
  s1.header('ANALYST NOTES');
  s1.data([ca.summary_notes || '']);
  s1.blank();
  s1.header('MONTHLY SALARY CREDITS');
  s1.header(['Date', 'Amount', 'Description']);
  salaryRows.forEach(r => s1.data([r.date, inr(r.amount), r.description], { fmts: { 2: CUR } }));
  s1.blank();

  const secondaryIncome = result.secondary_income || [];
  if (secondaryIncome.length) {
    s1.header('SECONDARY INCOME SOURCES');
    s1.header(['Source', 'Occurrences', 'Avg Amount', 'Consistency (CV)', 'First Seen', 'Last Seen']);
    secondaryIncome.forEach(s => s1.data([s.source, s.count, inr(s.mean), s.cv, s.first_seen, s.last_seen], { fmts: { 3: CUR } }));
  }

  // ── Sheet 2: EMI Tracker & Bounces ──────────────────────────────────────
  const emis = result.emi_obligations || [];
  const ecs = result.ecs_returns || [];
  const colWidths2 = [22, 22, 12, 14, 8, 14, 14, 30];
  const ws2 = wb.addWorksheet('EMI Tracker & Bounces');
  ws2.columns = colWidths2.map(w => ({ width: w }));
  const s2 = sheetHelpers(ws2, colWidths2.length);
  s2.title(`EMI TRACKER & BOUNCE ANALYSIS — ${sm.account_holder || ''}`);
  s2.blank();
  s2.header('EMI / LOAN OBLIGATIONS OBSERVED');
  s2.header(['#', 'Party / Lender', 'Type', 'Monthly EMI', 'Count', 'First Seen', 'Last Seen']);
  emis.forEach((e, i) => s2.data([i + 1, e.party, e.type, inr(e.amount), e.count, e.first_seen, e.last_seen], { fmts: { 4: CUR } }));
  s2.blank();

  const grid = result.emi_payment_grid || [];
  if (grid.length) {
    s2.header('MONTHLY PAYMENT GRID — PAID / MISSED');
    s2.header(['Lender / Party', 'Monthly Amt', 'Paid', 'Missed', 'Month-by-Month']);
    grid.forEach(ob => {
      const gridStr = (ob.monthly_grid || []).map(g => `${g.month}:${g.status === 'PAID' ? '✓' : '✗'}`).join('  ');
      s2.data([ob.party, inr(ob.amount), ob.paid_count, ob.missed_count, gridStr], { fmts: { 2: CUR } });
    });
    s2.blank();
  }

  s2.header('BOUNCE DETAIL — ECS / NACH / CHEQUE RETURNS');
  s2.header(['Party', 'Type', 'Return Date', 'Return Amount', 'Charge Date', 'Charge Amount', 'Charge Description']);
  ecs.forEach(r => s2.data([r.party, r.return_type, r.return_date, inr(r.return_amount), r.charge_date, inr(r.charge_amount), r.charge_description], { fmts: { 4: CUR, 6: CUR } }));
  s2.blank();
  s2.data([`TOTAL BOUNCES: ${ecs.filter(r => r.return_date).length}`]);

  // ── Sheet 3: Rotation & Risk Flags ──────────────────────────────────────
  const rot = (result.cc_card_rotation && result.cc_card_rotation.transactions) || [];
  const selfXfer = (result.frequent_transfers || []);
  const flags = result.risk_flags || [];
  const colWidths3 = [24, 8, 22, 16, 40, 14];
  const ws3 = wb.addWorksheet('Rotation & Risk Flags');
  ws3.columns = colWidths3.map(w => ({ width: w }));
  const s3 = sheetHelpers(ws3, colWidths3.length);
  s3.title(`CREDIT CARD ROTATION & RISK ANALYSIS — ${sm.account_holder || ''}`);
  s3.blank();
  s3.header('POS / AGGREGATOR SETTLEMENT CREDITS (CARD-TO-CASH INDICATOR)');
  s3.header(['Vendor', 'Date', 'Amount', 'Description']);
  rot.forEach(t => s3.data([t.vendor, t.date, inr(t.amount), t.description], { fmts: { 3: CUR } }));
  s3.blank();
  s3.header('SELF / FREQUENT TRANSFER PATTERN');
  s3.header(['Beneficiary', 'Self?', 'Transfer Count', 'Total Amount', 'First Date', 'Last Date']);
  selfXfer.forEach(t => s3.data([t.beneficiary, t.is_self ? 'YES' : 'NO', t.transfer_count, inr(t.total_amount), t.first_date, t.last_date], { fmts: { 4: CUR } }));
  s3.blank();

  const cashDep = result.cash_deposits || {};
  if (cashDep.detected) {
    s3.header('UNEXPLAINED CASH DEPOSITS');
    s3.header(['Date', 'Amount', 'Description']);
    (cashDep.transactions || []).forEach(t => s3.data([t.date, inr(t.amount), t.description], { fmts: { 2: CUR } }));
    s3.blank();
  }

  const circular = result.circular_transactions || [];
  if (circular.length) {
    s3.header('CIRCULAR / ROUND-TRIP TRANSACTIONS (POSSIBLE TURNOVER INFLATION)');
    s3.header(['Party', 'Round-Trips', 'Total Out', 'Total In', 'Out Date', 'In Date']);
    circular.forEach(c => {
      const firstPair = c.pairs[0] || {};
      s3.data([c.party, c.round_trip_count, inr(c.total_debit), inr(c.total_credit), firstPair.out_date, firstPair.in_date], { fmts: { 3: CUR, 4: CUR } });
    });
    s3.blank();
  }

  s3.header('CONSOLIDATED RISK FLAGS');
  s3.header(['#', 'Type', 'Severity', 'Date', 'Description', 'Amount']);
  flags.forEach((f, i) => s3.data([i + 1, f.type, f.severity, f.date, f.description, inr(f.amount)], { fmts: { 6: CUR } }));

  // ── Sheet 4: Monthly Cash Flow ───────────────────────────────────────────
  const mc = result.monthly_cashflow || [];
  const colWidths4 = [12, 16, 16, 18, 14];
  const ws4 = wb.addWorksheet('Monthly Cash Flow');
  ws4.columns = colWidths4.map(w => ({ width: w }));
  const s4 = sheetHelpers(ws4, colWidths4.length);
  s4.title(`MONTHLY CASH FLOW SUMMARY — ${sm.account_holder || ''}`);
  s4.blank();
  s4.header(['Month', 'Total Credit', 'Total Debit', 'Closing Balance', 'Bounce Count']);
  mc.forEach(m => s4.data([m.month, inr(m.total_credit), inr(m.total_debit), inr(m.closing_balance), m.bounce_count], { fmts: { 2: CUR, 3: CUR, 4: CUR } }));

  // ── Sheet 5: Stock Market Activity ──────────────────────────────────────
  const stk = result.stock_market_activity || {};
  const colWidths5 = [18, 14, 14, 12, 40];
  const ws5 = wb.addWorksheet('Stock Market Activity');
  ws5.columns = colWidths5.map(w => ({ width: w }));
  const s5 = sheetHelpers(ws5, colWidths5.length);
  s5.title(`STOCK MARKET / BROKER ACTIVITY — ${sm.account_holder || ''}`);
  s5.blank();
  s5.data(['Detected', stk.detected ? 'YES' : 'NO']);
  s5.data(['Transaction Count', stk.transaction_count || 0]);
  s5.data(['Total Invested', inr(stk.total_invested)], { fmts: { 2: CUR } });
  s5.data(['Total Withdrawn', inr(stk.total_withdrawn)], { fmts: { 2: CUR } });
  s5.data(['Brokers Seen', (stk.brokers_seen || []).join(', ')]);
  s5.blank();
  s5.header('TRANSACTIONS');
  s5.header(['Broker', 'Date', 'Amount', 'Direction', 'Description']);
  (stk.transactions || []).forEach(t => s5.data([t.broker, t.date, inr(t.amount), t.direction, t.description], { fmts: { 3: CUR } }));

  // ── Sheet 6: CIBIL Reconciliation (optional — only if CIBIL data was passed in) ──
  if (cibilData && (cibilData.reconciliation || cibilData.pipeline)) {
    const recon = cibilData.reconciliation || {};
    const pipe = cibilData.pipeline || {};
    const colWidths6 = [26, 16, 26, 16, 44, 40];
    const ws6 = wb.addWorksheet('CIBIL Reconciliation');
    ws6.columns = colWidths6.map(w => ({ width: w }));
    const s6 = sheetHelpers(ws6, colWidths6.length);
    s6.title(`CIBIL vs BANK STATEMENT RECONCILIATION — ${sm.account_holder || ''}`);
    s6.blank();

    s6.header('RECONCILIATION SUMMARY');
    s6.header(['Metric', 'Value', 'Metric', 'Value']);
    s6.data(['Obligations Matched', (recon.matched || []).length, 'CIBIL Obligations Unmatched', (recon.unmatched_cibil || []).length], { bold: [2, 4] });
    s6.data(['Bank EMIs Unmatched to CIBIL', (recon.unmatched_bank || []).length, '', ''], { bold: [2] });
    s6.blank();

    if ((recon.reconciliation_flags || []).length) {
      s6.header('RECONCILIATION RISK FLAGS');
      s6.header(['Type', 'Severity', 'Lender / Party', 'Monthly Obligation', 'Description', 'Possible Causes']);
      recon.reconciliation_flags.forEach(f => s6.data(
        [f.type, f.severity, f.lender, inr(f.monthly_obligation), f.description, (f.possible_causes || []).join(' / ')],
        { fmts: { 4: CUR } }
      ));
      s6.blank();
    }

    if ((recon.matched || []).length) {
      s6.header('MATCHED OBLIGATIONS (CIBIL ↔ BANK STATEMENT)');
      s6.header(['CIBIL Lender', 'CIBIL Monthly Obl.', 'Bank Party', 'Bank Monthly Amt', 'Bank Occurrences', '']);
      recon.matched.forEach(m => s6.data([m.cibil.bankName, inr(m.cibil.monthlyObl), m.bank.party, inr(m.bank.amount), m.bank.count, ''], { fmts: { 2: CUR, 4: CUR } }));
      s6.blank();
    }

    if (pipe && Object.keys(pipe).length) {
      s6.header('DEBT-STRESS PIPELINE');
      s6.header(['Stage', 'Result', '', '', '', '']);
      s6.data(['1. Multiple Small Loan Detection', `${pipe.small_loan_detection?.count || 0} small/short-tenure loan(s) active`]);
      s6.data(['2. Loan Stacking Analysis', `${pipe.loan_stacking?.total_active_obligations || 0} active obligation(s) total (${pipe.loan_stacking?.small_loan_count || 0} small loans) — ${pipe.loan_stacking?.flagged ? 'FLAGGED' : 'not flagged'}`]);
      s6.data(['3. Short-Term Borrowing Frequency', pipe.borrowing_frequency?.avg_days_between_new_loans != null ? `Avg ${pipe.borrowing_frequency.avg_days_between_new_loans} days between new small loans — ${pipe.borrowing_frequency.flagged ? 'FLAGGED' : 'not flagged'}` : 'Not enough data']);
      s6.data(['4. Debt Cycle Detection', `${(pipe.debt_cycle_events || []).length} rollover/refinance event(s) detected`]);
      s6.data(['5. Total Obligation Calculation', inr(pipe.total_monthly_obligation)], { fmts: { 2: CUR } });
      s6.data(['   FOIR incl. unreported obligations', `${pipe.foir_including_unreported || 0}%`]);
      s6.data(['6. Liquidity Stress Score (0-100)', pipe.liquidity_stress_score ?? '']);
      s6.data(['7. Underwriting Risk / Recommendation', `${pipe.underwriting_risk || ''} — ${pipe.recommendation || ''}`], { bold: [1, 2] });
      s6.blank();

      if ((pipe.debt_cycle_events || []).length) {
        s6.header('DEBT CYCLE EVENTS (POSSIBLE ROLLOVER / REFINANCE)');
        s6.header(['Closed Lender', 'Closed Date', 'New Lender', 'New Open Date', 'Gap (Days)', '']);
        pipe.debt_cycle_events.forEach(e => s6.data([e.closed_lender, e.closed_date, e.new_lender, e.new_open_date, e.gap_days, '']));
      }
    }
  }

  return wb;
}

export async function downloadBsaWorkbook(result, cibilData) {
  const wb = buildBsaWorkbook(result, cibilData);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const name = (result.summary?.account_holder || 'statement').replace(/\s+/g, '_');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `BSA_${name}_${Date.now()}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
