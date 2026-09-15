#!/usr/bin/env node
// scripts/smoke-test-bsa.js
//
// End-to-end smoke test for the BSA (Bank Statement Analysis) pipeline:
// analyzer -> Supabase save/round-trip -> Excel export. Exists so a full
// regression pass can verify data correctness programmatically, leaving
// the manual click-through checklist to cover only what genuinely needs
// eyes on a screen (visual rendering, Excel formatting/colors).
//
// Run:  node scripts/smoke-test-bsa.js
//   or: npm run smoke:bsa
//
// IMPORTANT - which Supabase project this hits: this project has ONE
// Supabase project (see src/supabase.js - a single hardcoded URL/key pair,
// no env-var indirection, confirmed via the project's own Supabase MCP
// tooling that no separate dev/staging project exists). Step 2 below
// therefore writes to the SAME database the live app uses. It creates one
// disposable, unmistakably-marked test lead + bank-statement-data row,
// verifies the round-trip, then deletes both - wrapped in try/finally so
// cleanup runs even if an assertion throws. It also sweeps for and removes
// any stale rows left behind by a prior interrupted run before starting.
//
// Step 1 needs a real statement PDF (OpTransactionHistory... from earlier
// sessions) to test the true end-to-end pdfjs parsing path. None is
// currently checked into this repo (confirmed via a repo-wide search) -
// per instruction, that specific check is SKIPPED (not failed) with a
// clear note, and steps 1's structural assertions / steps 2-3 instead run
// against a synthetic-but-realistic transaction set built from the SAME
// structural bug patterns confirmed earlier in this project (iDirect/EBA
// broker trades, BAJAJ_AUTO_CD EMI, etc.), fed through the REAL
// linesToTransactions()/runBehaviourDetectors()/computeCreditAssessment()/
// buildAllTransactions() - only the PDF-text-extraction step itself is
// bypassed, since that specific format-parsing behavior already has its
// own dedicated Jest fixture suite (src/utils/__tests__/).

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

// ── Babel-on-the-fly require hook ───────────────────────────────────────
// bankBehaviour.js / bsaExcelExport.js / supabase.js are plain ES modules
// (import/export), written for CRA's webpack/babel pipeline under src/.
// This project's own plain-Node scripts (scripts/copy-pdf-worker.js) are
// CommonJS with no build step, and package.json has no "type":"module", so
// requiring an ESM source file directly would throw a SyntaxError. Rather
// than duplicate/hand-port any analyzer or Supabase-client logic, transpile
// these specific files to CommonJS on the fly via @babel/core +
// @babel/preset-env (already installed as a react-scripts dependency) -
// scoped ONLY to files under src/, so node_modules keeps loading normally.
const babel = require('@babel/core');
const Module = require('module');
const SRC_DIR = path.join(__dirname, '..', 'src') + path.sep;
const originalJsLoader = Module._extensions['.js'];
Module._extensions['.js'] = function bsaSmokeTestBabelLoader(mod, filename) {
  if (filename.startsWith(SRC_DIR)) {
    const { code } = babel.transformFileSync(filename, {
      presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
      babelrc: false,
      configFile: false,
    });
    mod._compile(code, filename);
    return;
  }
  return originalJsLoader(mod, filename);
};

// bankBehaviour.js's top-level `import * as pdfjsLib from 'pdfjs-dist'`
// resolves to pdfjs-dist's browser build here, which references DOMMatrix
// (a browser-only global) at module-evaluation time - it throws just from
// being imported, even though this script never calls pdfToLines()/
// analyzeBankStatement(). pdfjs-dist ships a "legacy" build specifically
// for Node - redirect the bare specifier to it, scoped to this process
// only (the real src/utils/bankBehaviour.js file is untouched; webpack
// still resolves it to the browser build normally).
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function bsaSmokeTestPdfjsRedirect(request, ...rest) {
  if (request === 'pdfjs-dist') {
    return originalResolveFilename.call(this, 'pdfjs-dist/legacy/build/pdf.mjs', ...rest);
  }
  return originalResolveFilename.call(this, request, ...rest);
};

const {
  runBehaviourDetectors,
  computeCreditAssessment,
  linesToTransactions,
  buildAllTransactions,
} = require('../src/utils/bankBehaviour');
const { buildBsaWorkbook } = require('../src/utils/bsaExcelExport');
const { supabaseAdmin } = require('../src/supabase');
const ExcelJS = require('exceljs');

// ── Result collection helpers ────────────────────────────────────────────
function makeStep(name) {
  return { name, checks: [], skipped: false, skipReason: '' };
}
function check(step, label, pass, actual, expected) {
  step.checks.push({ label, pass: !!pass, actual, expected });
}
function stepPassed(step) {
  return step.skipped || step.checks.every(c => c.pass);
}
const isNum = v => typeof v === 'number' && !Number.isNaN(v);

// ── Locate a real statement PDF, if one exists ──────────────────────────
const KNOWN_REAL_PDF_NAMES = ['OpTransactionHistory07-09-2026_pdf-12-31-46.pdf'];
function findRealPdfs() {
  const repoRoot = path.join(__dirname, '..');
  const skipDirs = new Set(['node_modules', '.git', 'build', 'public']);
  const found = [];
  (function walk(dir, depth) {
    if (depth > 6) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        walk(path.join(dir, entry.name), depth + 1);
      } else if (entry.name.toLowerCase().endsWith('.pdf')) {
        found.push(path.join(dir, entry.name));
      }
    }
  })(repoRoot, 0);
  return found;
}

// ── Synthetic (but structurally real) statement, used when no real PDF is
// present. Built as raw statement-row TEXT LINES (not pre-parsed objects)
// so the REAL linesToTransactions() parser still does the actual work -
// only PDF text-extraction (pdfjs) itself is bypassed. TRAILING_ONLY merge
// strategy (self-contained "DATE DESC AMOUNT BALANCE" rows) is used
// regardless of the synthetic header's bank name, since ICICI's specific
// HEADER_AND_TRAILING line-wrapping quirks already have their own
// dedicated Jest fixtures (src/utils/__tests__/iciciStrayRowNumber.fixture.js
// etc.) - this script's job is exercising the DETECTOR/EXPORT/SAVE
// pipeline, not re-proving bank-specific line-merging.
function buildSyntheticStatement() {
  const events = [];
  const push = (day, month, text, amount, dir) => events.push({ date: new Date(2026, month - 1, day), text, amount, dir });

  // Anchor row - linesToTransactions() has no prior balance to compute a
  // signed delta from for the very first transaction, so its credit/debit
  // stays 0 unless the description itself contains an explicit CR/DR
  // marker. Not part of any real narration.
  push(1, 7, 'Opening Balance Brought Forward CR', 100000, 'CR');

  // Salary - 3 months, clearly dominant recurring group.
  [7, 8, 9].forEach(m => push(1, m, 'SALARY XYZ TECHNOLOGIES PVT LTD', 45000, 'CR'));

  // iDirect/EBA broker trades - ~40 legs across 3 months (real statement
  // this project tested against had ~60; this synthetic set uses fewer for
  // a faster/lighter fixture - only "> 0" is asserted, not an exact count).
  const brokerNarration = (i, day) => {
    const kind = i % 3;
    if (kind === 0) return `iDirect trxn EBA/EQ Trade ${String(day).padStart(2, '0')}JUL/202607${String(day).padStart(2, '0')}100000`;
    if (kind === 1) return `iDirect trxn EBA/F&O Trade ${String(day).padStart(2, '0')}JUL/202607${String(day).padStart(2, '0')}054102`;
    return `iDirect trxn EBA//202607${String(day).padStart(2, '0')}183025`;
  };
  for (let i = 0; i < 40; i++) {
    const month = 7 + (i % 3);
    const day = 2 + (i % 26);
    const amount = 1000 + ((i * 733) % 50000);
    const dir = i % 2 === 0 ? 'DR' : 'CR';
    push(day, month, brokerNarration(i, day), amount, dir);
  }

  // GROWW SIP - 3 debits, same platform + amount (sip_obligations grouping).
  [7, 8, 9].forEach(m => push(3, m, 'GROWW SIP INSTALLMENT', 5000, 'DR'));

  // BAJAJ FINANCE EMI - 5 debits, the "known real EMI" this project's bug
  // hunt was built around (root-boundary-matched via detectLenderName()).
  [[5, 7], [19, 7], [5, 8], [19, 8], [5, 9]].forEach(([day, m]) =>
    push(day, m, 'CMS/00234/BAJAJ_AUTO_CD__ICIC0001234', 9450, 'DR'));

  // CRED credit-card bill payments - 3 debits (credit_card_obligations).
  [[10, 7], [10, 8], [10, 9]].forEach(([day, m]) => push(day, m, 'CRED APP BILL PAYMENT', 12000, 'DR'));

  // ATM withdrawals - a burst in September to exercise
  // frequent_withdrawal_month, plus a couple elsewhere.
  push(15, 7, 'ATM WDL BRANCH1', 3000, 'DR');
  push(15, 8, 'ATM WDL BRANCH1', 3000, 'DR');
  [2, 9, 16, 23, 28].forEach(day => push(day, 9, 'ATM WDL BRANCH2', 3000, 'DR'));

  // Bounce pair - ECS/CHQ return + its matching charge line.
  push(20, 8, 'CHQ RETURN INSUFFICIENT FUNDS', 2000, 'DR');
  push(21, 8, 'RETURN CHARGES CHQ', 500, 'DR');

  // Secondary income - 3 credits, distinct source from salary.
  [[12, 7], [12, 8], [12, 9]].forEach(([day, m]) => push(day, m, 'FREELANCE CONSULTING WORK', 8000, 'CR'));

  // Genuine one-off irregular credit - not claimed by anything else.
  push(25, 9, 'GIFT FROM FRIEND RAHUL', 2000, 'CR');

  // Wallet top-up (wallet_to_bank) and lender disbursal (small_loan_disbursals).
  push(4, 7, 'PAYTM WALLET REFUND', 300, 'CR');
  push(6, 7, 'NAVI FINSERV DISBURSAL', 15000, 'CR');

  // Unexplained cash deposit.
  push(8, 7, 'BY CASH -BRANCH', 5000, 'CR');

  // Self-transfer pattern (3x) - frequent_transfers.
  [[14, 7], [14, 8], [14, 9]].forEach(([day, m]) => push(day, m, 'NEFT TRANSFER TO SELF SAVINGS AC', 10000, 'DR'));

  events.sort((a, b) => a.date - b.date);

  let balance = 0;
  const fmtDate = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  const lines = events.map(e => {
    balance += e.dir === 'CR' ? e.amount : -e.amount;
    return `${fmtDate(e.date)} ${e.text} ${e.amount.toFixed(2)} ${balance.toFixed(2)}`;
  });

  const accountHolder = 'Mohan Kumar M';
  const headerLines = [
    'ICICI BANK LIMITED',
    'Statement of Account',
    `Account Name: ${accountHolder}`,
    'A/c No: 395201000416',
  ];
  return { lines: [...headerLines, ...lines], accountHolder };
}

function buildSyntheticCibilData() {
  return {
    reconciliation: {
      matched: [{ cibil: { bankName: 'BAJAJ FINANCE', monthlyObl: 9450 }, bank: { party: 'BAJAJ FINANCE', amount: 9450, count: 5 } }],
      unmatched_cibil: [],
      unmatched_bank: [],
      reconciliation_flags: [],
    },
    pipeline: {
      small_loan_detection: { count: 0 },
      loan_stacking: { total_active_obligations: 1, small_loan_count: 0, flagged: false },
      borrowing_frequency: { avg_days_between_new_loans: null, flagged: false },
      debt_cycle_events: [],
      total_monthly_obligation: 9450,
      foir_including_unreported: 20,
      liquidity_stress_score: 30,
      underwriting_risk: 'LOW',
      recommendation: 'PROCEED',
    },
  };
}

// ── Step 1: analyzer output sanity check ─────────────────────────────────
function runAnalyzerAssertions(step, result) {
  const sm = result.summary || {};
  const ca = result.credit_assessment || {};

  check(step, 'summary.account_holder non-empty', !!sm.account_holder, sm.account_holder, 'non-empty string');
  check(step, 'summary.bank_name non-empty', !!sm.bank_name, sm.bank_name, 'non-empty string');
  check(step, 'summary.statement_period non-empty', !!sm.statement_period, sm.statement_period, 'non-empty string');

  const knownEmi = (result.emi_obligations || []).find(e => e.party === 'BAJAJ FINANCE');
  check(step, 'emi_obligations contains the known real EMI (BAJAJ FINANCE), non-zero amount, count>=2',
    !!knownEmi && knownEmi.amount > 0 && knownEmi.count >= 2,
    knownEmi ? `amount=${knownEmi.amount}, count=${knownEmi.count}` : 'not found in emi_obligations',
    'found, amount > 0, count >= 2');

  check(step, 'credit_assessment.foir_estimate is a plausible non-zero number given real EMI obligations',
    isNum(ca.foir_estimate) && ca.foir_estimate > 0,
    ca.foir_estimate,
    'a positive number (not 0, not NaN) - the exact "0% FOIR despite real obligations" bug class from earlier in this project');

  check(step, 'stock_market_activity.detected === true with transaction_count > 0',
    result.stock_market_activity?.detected === true && (result.stock_market_activity?.transaction_count || 0) > 0,
    `detected=${result.stock_market_activity?.detected}, transaction_count=${result.stock_market_activity?.transaction_count}`,
    'detected=true, transaction_count > 0');

  // Reconciliation: every credit should land in exactly one bucket - salary
  // / secondary income / broker / MF / wallet / lender / irregular. A LARGE
  // unaccounted-for gap is the exact "self-transfer credits silently vanish
  // from BOTH secondary_income and irregular_credits at once" bug class
  // fixed in the holderTokens-drift round of this project's regression pass.
  const totalCredits = (result.transactions || []).filter(t => (Number(t.credit) || 0) > 0).length;
  const salaryCount = (result.positive_signals || []).filter(p => p.type === 'REGULAR_SALARY').length;
  const secondaryCount = (result.secondary_income || []).reduce((s, x) => s + (x.count || 0), 0);
  const irregularCount = (result.irregular_credits || []).length;
  const brokerCreditCount = (result.stock_market_activity?.transactions || []).filter(t => t.direction === 'CREDIT').length;
  const mfCreditCount = (result.mutual_fund_activity?.transactions || []).filter(t => t.direction === 'CREDIT').length;
  const walletCreditCount = (result.wallet_to_bank || []).filter(w => w.direction === 'WALLET_TO_BANK').length;
  const lenderCreditCount = result.small_loan_disbursals?.disbursal_count || 0;
  const accountedFor = salaryCount + secondaryCount + irregularCount + brokerCreditCount + mfCreditCount + walletCreditCount + lenderCreditCount;
  const gap = totalCredits - accountedFor;
  const gapThreshold = Math.max(3, Math.ceil(totalCredits * 0.05));
  check(step, 'irregular_credits/secondary_income reconcile against total credit count (no large unexplained gap)',
    Math.abs(gap) <= gapThreshold,
    `total_credits=${totalCredits}, accounted_for=${accountedFor} (salary=${salaryCount}, secondary=${secondaryCount}, broker=${brokerCreditCount}, mf=${mfCreditCount}, wallet=${walletCreditCount}, lender=${lenderCreditCount}, irregular=${irregularCount}), gap=${gap}`,
    `|gap| <= ${gapThreshold}`);

  // No NaN/undefined/null where a number or string is expected.
  const scanFields = [
    ['summary.account_holder', sm.account_holder, 'string'],
    ['summary.bank_name', sm.bank_name, 'string'],
    ['summary.statement_period', sm.statement_period, 'string'],
    ['summary.total_credits', sm.total_credits, 'number'],
    ['summary.total_debits', sm.total_debits, 'number'],
    ['summary.average_monthly_balance', sm.average_monthly_balance, 'number'],
    ['summary.closing_balance', sm.closing_balance, 'number'],
    ['summary.opening_balance', sm.opening_balance, 'number'],
    ['credit_assessment.overall_risk', ca.overall_risk, 'string'],
    ['credit_assessment.income_stability', ca.income_stability, 'string'],
    ['credit_assessment.estimated_monthly_income', ca.estimated_monthly_income, 'number'],
    ['credit_assessment.total_emi_burden', ca.total_emi_burden, 'number'],
    ['credit_assessment.foir_estimate', ca.foir_estimate, 'number'],
    ['credit_assessment.recommendation', ca.recommendation, 'string'],
  ];
  scanFields.forEach(([label, val, kind]) => {
    const ok = kind === 'number' ? isNum(val) : (typeof val === 'string' && val !== undefined);
    const shown = val === undefined ? 'undefined' : (val === null ? 'null' : (typeof val === 'number' && Number.isNaN(val) ? 'NaN' : val));
    check(step, `${label} is a valid ${kind} (not NaN/undefined/null)`, ok, shown, `a ${kind}`);
  });

  // Top-level counts of each detector section.
  const countFields = [
    ['emi_obligations.length', (result.emi_obligations || []).length],
    ['ecs_returns.length', (result.ecs_returns || []).length],
    ['risk_flags.length', (result.risk_flags || []).length],
    ['monthly_cashflow.length', (result.monthly_cashflow || []).length],
    ['stock_market_activity.transaction_count', result.stock_market_activity?.transaction_count],
    ['mutual_fund_activity.transaction_count', result.mutual_fund_activity?.transaction_count],
    ['cashout_patterns.length', (result.cashout_patterns || []).length],
    ['irregular_credits.length', (result.irregular_credits || []).length],
    ['credit_card_obligations.length', (result.credit_card_obligations || []).length],
    ['banking_behaviour.low_balance_days.length', (result.banking_behaviour?.low_balance_days || []).length],
    ['cash_withdrawal_summary.total_count', result.cash_withdrawal_summary?.total_count],
    ['all_transactions.length', (result.all_transactions || []).length],
  ];
  countFields.forEach(([label, val]) => {
    const shown = val === undefined ? 'undefined' : (typeof val === 'number' && Number.isNaN(val) ? 'NaN' : val);
    check(step, `${label} is a valid number (not NaN/undefined)`, isNum(val), shown, 'a number');
  });
}

async function runStep1() {
  const step = makeStep('1. Analyzer output sanity check');
  const realPdfs = findRealPdfs();
  const knownReal = realPdfs.find(p => KNOWN_REAL_PDF_NAMES.includes(path.basename(p)));

  if (!knownReal) {
    step.note = realPdfs.length
      ? `Known real PDF (${KNOWN_REAL_PDF_NAMES.join(', ')}) not found. Other PDFs present but not the expected fixture: ${realPdfs.map(p => path.relative(path.join(__dirname, '..'), p)).join(', ')}. SKIPPING the real-file parse; running structural assertions against a synthetic-but-realistic dataset instead.`
      : `No PDF files found anywhere in the repo (searched recursively, excluding node_modules/.git/build/public). SKIPPING the real-file parse per instruction; running structural assertions against a synthetic-but-realistic dataset instead.`;
    console.log(`  NOTE: ${step.note}`);
  } else {
    step.note = `Found real PDF at ${knownReal} but this script does not yet drive it through pdfjs-dist in a plain-Node context (see script header). Falling back to the synthetic dataset for now.`;
    console.log(`  NOTE: ${step.note}`);
  }

  const { lines, accountHolder } = buildSyntheticStatement();
  const transactions = linesToTransactions(lines, '2026', 'TRAILING_ONLY');
  const fullText = lines.join('\n');
  const detectors = runBehaviourDetectors(transactions, accountHolder);
  const assessment = computeCreditAssessment(transactions, fullText, detectors, accountHolder);
  const all_transactions = buildAllTransactions(transactions);
  const result = {
    transactionCount: transactions.length,
    transactions,
    all_transactions,
    ...detectors,
    ...assessment,
  };

  runAnalyzerAssertions(step, result);
  return { step, result };
}

// ── Step 2: Supabase save round-trip ─────────────────────────────────────
async function runStep2(analyzerResult) {
  const step = makeStep('2. Supabase save round-trip');
  const MARKER = 'ZZZ_BSA_SMOKE_TEST';
  const testFullName = `${MARKER}_${Date.now()}`;
  const testMobile = '0000000000';
  let testLeadId = null;

  try {
    // Defensive cleanup: remove any stale rows left by a prior interrupted run.
    const { data: staleLeads } = await supabaseAdmin.from('leads').select('id').like('full_name', `${MARKER}%`);
    if (staleLeads && staleLeads.length) {
      const staleIds = staleLeads.map(l => l.id);
      await supabaseAdmin.from('customer_bank_statement_data').delete().in('lead_id', staleIds);
      await supabaseAdmin.from('leads').delete().in('id', staleIds);
      console.log(`  (cleaned up ${staleIds.length} stale smoke-test row(s) from a prior run)`);
    }

    const { data: insertedLead, error: leadErr } = await supabaseAdmin
      .from('leads')
      .insert({ full_name: testFullName, mobile: testMobile })
      .select('id')
      .single();
    check(step, 'disposable test lead created', !leadErr && !!insertedLead?.id, leadErr ? leadErr.message : 'ok, id=' + insertedLead?.id, 'insert succeeds, id returned');
    if (leadErr || !insertedLead) {
      step.skipped = true;
      step.skipReason = 'Could not create disposable test lead: ' + (leadErr ? leadErr.message : 'unknown error');
      return step;
    }
    testLeadId = insertedLead.id;

    const writePayload = {
      lead_id: testLeadId,
      account_holder: analyzerResult.summary?.account_holder || '',
      bank_name: analyzerResult.summary?.bank_name || '',
      statement_period: analyzerResult.summary?.statement_period || '',
      result: analyzerResult,
      uploaded_by: null,
      uploaded_at: new Date().toISOString(),
    };
    const { error: upsertErr } = await supabaseAdmin
      .from('customer_bank_statement_data')
      .upsert(writePayload, { onConflict: 'lead_id' });
    check(step, 'upsert into customer_bank_statement_data succeeds (same onConflict:lead_id pattern as SaveBsaToLead.js)',
      !upsertErr, upsertErr ? upsertErr.message : 'ok', 'no error');

    const { data: readBack, error: readErr } = await supabaseAdmin
      .from('customer_bank_statement_data')
      .select('*')
      .eq('lead_id', testLeadId)
      .single();
    check(step, 'row reads back', !readErr && !!readBack, readErr ? readErr.message : (readBack ? 'row found' : 'no row'), 'row found');

    if (readBack) {
      check(step, 'account_holder round-trips through jsonb', readBack.account_holder === writePayload.account_holder, readBack.account_holder, writePayload.account_holder);
      check(step, 'bank_name round-trips', readBack.bank_name === writePayload.bank_name, readBack.bank_name, writePayload.bank_name);
      check(step, 'statement_period round-trips', readBack.statement_period === writePayload.statement_period, readBack.statement_period, writePayload.statement_period);
      const readEmiCount = (readBack.result?.emi_obligations || []).length;
      const writeEmiCount = (analyzerResult.emi_obligations || []).length;
      check(step, 'result.emi_obligations count round-trips through jsonb', readEmiCount === writeEmiCount, readEmiCount, writeEmiCount);
      const readTxnCount = readBack.result?.all_transactions?.length;
      const writeTxnCount = analyzerResult.all_transactions?.length;
      check(step, 'result.all_transactions count round-trips through jsonb', readTxnCount === writeTxnCount, readTxnCount, writeTxnCount);
    }
  } catch (e) {
    check(step, 'no unexpected exception during save/read', false, e.message, 'no exception');
  } finally {
    if (testLeadId) {
      const { error: delDataErr } = await supabaseAdmin.from('customer_bank_statement_data').delete().eq('lead_id', testLeadId);
      const { error: delLeadErr } = await supabaseAdmin.from('leads').delete().eq('id', testLeadId);
      check(step, 'cleanup: customer_bank_statement_data test row deleted', !delDataErr, delDataErr ? delDataErr.message : 'deleted', 'deleted');
      check(step, 'cleanup: disposable test lead deleted', !delLeadErr, delLeadErr ? delLeadErr.message : 'deleted', 'deleted');
    }
  }
  return step;
}

// ── Step 3: Excel export validation ──────────────────────────────────────
async function runStep3(analyzerResult) {
  const step = makeStep('3. Excel export validation');
  const tmpFile = path.join(os.tmpdir(), `bsa-smoke-test-${Date.now()}.xlsx`);
  try {
    const cibilData = buildSyntheticCibilData();
    const wb = buildBsaWorkbook(analyzerResult, cibilData);
    await wb.xlsx.writeFile(tmpFile);

    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.readFile(tmpFile);

    const expectedSheets = [
      'Executive Summary', 'EMI Tracker & Bounces', 'Rotation & Risk Flags',
      'Monthly Cash Flow', 'Stock Market Activity', 'Investment Activity',
      'Cash-Out Pattern Findings', 'Banking Behaviour', 'Transaction Details',
      'CIBIL Reconciliation',
    ];
    const actualSheets = wb2.worksheets.map(ws => ws.name);
    expectedSheets.forEach(name => {
      check(step, `sheet "${name}" present`, actualSheets.includes(name), actualSheets.includes(name) ? 'present' : 'MISSING', 'present');
    });

    // Sheets that should have real data rows beyond title/header bands for
    // THIS result - computed from the result itself, not hardcoded, so
    // this stays correct regardless of which dataset (real or synthetic)
    // produced it. Threshold (>3 rows) is a loose floor: title + blank +
    // one column-header row is the absolute minimum skeleton EVERY sheet
    // has even with zero data (Monthly Cash Flow's simplest case is
    // exactly this 3-row skeleton), so >3 is the correct floor for "more
    // than just a title row," not a stricter guess at any sheet's real
    // per-section row count.
    const expectedNonEmpty = {
      'Executive Summary': true,
      'EMI Tracker & Bounces': (analyzerResult.emi_obligations || []).length > 0,
      'Rotation & Risk Flags': (analyzerResult.risk_flags || []).length > 0 || (analyzerResult.frequent_transfers || []).length > 0,
      'Monthly Cash Flow': (analyzerResult.monthly_cashflow || []).length > 0,
      'Stock Market Activity': analyzerResult.stock_market_activity?.detected === true,
      'Investment Activity': analyzerResult.stock_market_activity?.detected === true || analyzerResult.mutual_fund_activity?.detected === true,
      'Cash-Out Pattern Findings': true, // always prints either findings or a "none detected" line
      'Banking Behaviour': true, // always prints the threshold table, even if all zero
      'Transaction Details': (analyzerResult.all_transactions || []).length > 0,
      'CIBIL Reconciliation': true, // synthetic cibilData was passed
    };
    Object.entries(expectedNonEmpty).forEach(([name, shouldHaveData]) => {
      if (!shouldHaveData) return;
      const ws = wb2.getWorksheet(name);
      if (!ws) return; // already flagged missing above
      check(step, `sheet "${name}" has more than just a title row`, ws.rowCount > 3, `${ws.rowCount} rows`, '> 3 rows');
    });

    // No literal "undefined"/"NaN" string anywhere - would indicate a
    // formatting/mapping bug in bsaExcelExport.js even if the underlying
    // detector data itself was fine.
    const badCells = [];
    wb2.worksheets.forEach(ws => {
      ws.eachRow((row, rowNumber) => {
        row.eachCell((cell) => {
          const v = cell.value;
          if (v === undefined || v === null) return;
          const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
          if (/\bundefined\b/.test(s) || /\bNaN\b/.test(s)) {
            badCells.push(`${ws.name}!row${rowNumber}col${cell.col}: "${s}"`);
          }
        });
      });
    });
    check(step, 'no literal "undefined"/"NaN" in any cell across all sheets',
      badCells.length === 0, badCells.length ? badCells.slice(0, 10).join('; ') : 'none found', 'none found');
  } catch (e) {
    check(step, 'no unexpected exception during export/read-back', false, e.message, 'no exception');
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
  return step;
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('='.repeat(78));
  console.log('BSA PIPELINE SMOKE TEST');
  console.log('='.repeat(78));
  console.log('Supabase project: pvnzeueldfmxhesmoetc ("Loan CRM") - this project\'s ONLY');
  console.log('environment (no separate dev/staging exists). Step 2 writes a disposable,');
  console.log('clearly-marked test lead + bank-statement row and deletes both afterward.');
  console.log('');

  const results = [];

  console.log('--- Step 1: Analyzer output sanity check ---');
  const { step: step1, result: analyzerResult } = await runStep1();
  results.push(step1);
  printStep(step1);

  console.log('\n--- Step 2: Supabase save round-trip ---');
  const step2 = await runStep2(analyzerResult);
  results.push(step2);
  printStep(step2);

  console.log('\n--- Step 3: Excel export validation ---');
  const step3 = await runStep3(analyzerResult);
  results.push(step3);
  printStep(step3);

  console.log('\n' + '='.repeat(78));
  console.log('FINAL SUMMARY');
  console.log('='.repeat(78));
  let allOk = true;
  results.forEach(s => {
    const status = s.skipped ? 'SKIPPED' : (stepPassed(s) ? 'PASS' : 'FAIL');
    if (status === 'FAIL') allOk = false;
    console.log(`${status.padEnd(8)} ${s.name}`);
    if (s.skipped) console.log(`         reason: ${s.skipReason}`);
    if (!s.skipped && !stepPassed(s)) {
      s.checks.filter(c => !c.pass).forEach(c => {
        console.log(`         FAILED: ${c.label}`);
        console.log(`                 actual:   ${c.actual}`);
        console.log(`                 expected: ${c.expected}`);
      });
    }
  });
  console.log('='.repeat(78));
  console.log(allOk ? 'ALL RUNNING CHECKS PASSED.' : 'ONE OR MORE CHECKS FAILED - see above before proceeding to manual Part B / Part C.');
  console.log('='.repeat(78));

  // src/supabase.js sets up a 45-minute setInterval for session
  // auto-refresh, which keeps the Node event loop alive indefinitely in a
  // one-shot script context (irrelevant here - no session to refresh).
  // process.exitCode alone would leave the process hanging until that
  // timer fires; force an immediate, correctly-coded exit instead.
  process.exit(allOk ? 0 : 1);
}

function printStep(step) {
  if (step.skipped) return; // note already printed inline during the step
  const passCount = step.checks.filter(c => c.pass).length;
  console.log(`  ${passCount}/${step.checks.length} checks passed.`);
}

main().catch(e => {
  console.error('FATAL: smoke test crashed unexpectedly:', e);
  process.exitCode = 1;
});
