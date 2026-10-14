// Underwriting Desk direct uploads — thin wrappers around the parsers the other
// tools already use (no parsing logic of its own):
//   CIBIL          -> CibilParser.js  extractTextFromPDF / detectFormat / parseCibil / parsePaisaBazaar / extractLatePayments
//   Bank statement -> bankBehaviour.js analyzeBankStatement (same entry point as BankStatementAnalyzer)
//   Payslip        -> TaxCalculator.js extractTextFromPDF / parseSalaryText
// Password errors are rethrown untouched so the screen can classify them with
// passwordErrorKind() and retry with a password. Every read is capped at
// CibilParser's PARSE_TIMEOUT_MS.

import { supabase } from '../supabase';
import {
  loadPdfJs, extractTextFromPDF, reconstructPageText, detectFormat, parseCibil, parsePaisaBazaar, extractLatePayments, PARSE_TIMEOUT_MS,
} from '../pages/CibilParser';
import { extractTextFromPDF as extractPayslipText, parseSalaryText } from '../pages/TaxCalculator';
import { analyzeBankStatement } from './bankBehaviour';
import { detectPayslipMonth, extractEmployerName, companyNameVariants } from './underwritingAdapters';

export const NO_TEXT_LAYER_MSG = 'This PDF has no text. Open it in CIBIL Analyzer (OCR) or re-save it from the browser using Save as PDF.';
export const READ_TIMEOUT_MSG = "Couldn't read this file — try again or use CIBIL Analyzer / Bank Statement Analyzer";

// Rejects with READ_TIMEOUT_MSG if `promise` hasn't settled in time. The
// underlying read can't be cancelled; the screen ignores its late result.
export function withTimeout(promise, ms = PARSE_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(READ_TIMEOUT_MSG)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// -> { format, accounts, score, customerName, pan, mobile, email, enquiries, reportDate }
async function readCibil(file, password) {
  const { text, pdf, pdfjsLib } = await extractTextFromPDF(file, password);
  if (!text || text.trim().length < 50) throw new Error(NO_TEXT_LAYER_MSG);

  const format = detectFormat(text);
  let result;
  if (format === 'cibil') result = parseCibil(text);
  else if (format === 'paisabazaar') result = parsePaisaBazaar(text);
  else throw new Error('Not a recognised CIBIL.com or PaisaBazaar report.');

  // Same PaisaBazaar late-payment enrichment CibilParser.parseFile applies.
  if (format === 'paisabazaar' && result.accounts.length > 0) {
    try {
      const late = await extractLatePayments(pdf, pdfjsLib);
      result.accounts.forEach((a) => {
        const lp = a.accountNum && late[a.accountNum];
        if (!lp) return;
        a.latePayments = lp;
        a.dpds = lp.late90 ? `90+ days (×${lp.late90})` : lp.late1_89 ? `1-89 days (×${lp.late1_89})` : a.dpds;
        if (lp.late90 || lp.late1_89) a.lateMonths = lp.months;
      });
    } catch (e) {
      // Same as CibilParser: fall back to text-only DPDs.
      console.warn('[underwriting] late payment extraction failed:', e);
    }
  }
  return { ...result, format };
}

export function parseCibilFile(file, password = '') {
  return withTimeout(readCibil(file, password));
}

// -> analyzeBankStatement() result. Reads the file fresh on every call: pdf.js
// may detach the ArrayBuffer it is given, so a password retry can't reuse it.
export function parseBankStatementFile(file, password = '') {
  return withTimeout(file.arrayBuffer().then((buf) => analyzeBankStatement(buf, '', password)));
}

// Page-1 text as visual rows (top first), via CibilParser's reconstructPageText —
// TaxCalculator's extractor joins a page into one line, which loses the header.
async function firstPageLines(file, password) {
  const pdfjsLib = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data, ...(password ? { password } : {}) }).promise;
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    return reconstructPageText(content.items).split('\n').map((l) => l.trim()).filter(Boolean);
  } finally {
    pdf.destroy();
  }
}

// -> { fileName, month, netPay, employerName } (netPay 0 / employerName null when not found)
async function readPayslip(file, password) {
  // TaxCalculator's own pdf.js loader has no error handler, so a failed CDN load
  // would just hang. Load the same pdf.js build through CibilParser's loader
  // first (it rejects on failure); TaxCalculator then reuses the loaded global.
  try {
    await loadPdfJs();
  } catch (e) {
    throw new Error("Couldn't load the PDF reader — check your connection and try again.");
  }
  const text = await extractPayslipText(file, password);
  const parsed = parseSalaryText(text);
  let headerLines = [];
  try {
    headerLines = await firstPageLines(file, password);
  } catch (e) {
    // Header lines only improve employer detection; labelled fields in `text` still work.
    console.warn('[underwriting] payslip header read failed:', e);
  }
  return {
    fileName: file.name,
    month: detectPayslipMonth(text, file.name),
    netPay: parsed.netPayMonthly || 0,
    employerName: extractEmployerName(text, headerLines),
    // Kept so the screen can re-run the extraction once the lead / CIBIL name is known.
    text,
    headerLines,
  };
}

export function parsePayslipFile(file, password = '') {
  return withTimeout(readPayslip(file, password));
}

// Employer name -> company list. Tries each search variant against
// search_company_category; the first variant with an exact match wins and is
// returned as the term to search (the screen then auto-selects it exactly like
// a lead's company_name). No exact match -> "Did you mean" suggestions only.
export async function matchEmployerToCompanyList(rawName) {
  const variants = companyNameVariants(rawName);
  for (const v of variants) {
    const { data, error } = await supabase.rpc('search_company_category', { p_query: v });
    if (error) throw error;
    if ((data || []).some((r) => r.match_type === 'exact')) return { exactTerm: v, suggestions: [] };
  }
  const expanded = variants[1] || variants[0];
  if (!expanded) return { exactTerm: null, suggestions: [] };
  const { data } = await supabase.rpc('autocomplete_company_name', { p_query: expanded, p_limit: 5 });
  return { exactTerm: null, suggestions: [...new Set((data || []).map((s) => s.company_name))] };
}
