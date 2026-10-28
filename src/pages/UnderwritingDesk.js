// UnderwritingDesk.js
//
// Bank-wise eligibility check. Two modes:
//   Existing lead — pulls the lead's saved CIBIL (customer_cibil_data) and
//     bank-statement analysis (customer_bank_statement_data).
//   New customer — for referrals not yet in the CRM; documents are uploaded
//     here and can then be saved as a new lead ("Save as lead").
// In both modes a CIBIL / bank statement / payslip uploaded here overrides the
// saved data for this run. Uploads go through the same parsers the CIBIL
// Analyzer, Bank Analyzer and Tax Calculator use (see underwritingUploads.js),
// then through underwritingAdapters.js exactly like saved rows. Every pre-filled
// value stays editable; evaluateBank() runs against each active policy in
// underwriting_policies. Company category per bank comes from
// search_company_category (same data as Company Category Checker).

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabase } from '../supabase';
import { evaluateBank, fmtINR } from '../utils/underwritingEngine';
import {
  BLUE, page, pageTitle, pageSubtitle, card, cardHeader, lbl, inp, cellInp, cellSel, th, td,
  btnPri, btnSec, btnPriSm, btnSecSm, btnLink, SItem,
} from '../utils/uiStyles';
import {
  buildProfileDraft, buildCibilRow, buildBsaRow, passwordErrorKind, normalizeMobile, averageNetPay, averageVariablePay, summarizeEmployer,
  extractEmployerName, treatmentChoice, treatmentPatch, loanReason, isTopUp, hlJointPatch, hlPayerPatch,
  cardActionPatch, cardOutstandingPatch, cardCountedShare, isZeroBalanceLoan, loanNeedsEmi, emiLooksTooLow, ownBankEnquiries, plEnquiries90d,
  scorecardPatch, scorecardTone, isClosureNote, closureLineText, visibleClosurePlan, companyForBank, typedCategoryPatch, manualCategoryBanks, manualCompany,
  isUnlistedFor, searchedIncorporationYear, cardReason, isZeroBalanceCard, isBulletLoan, bulletNote, termEmiTotal,
  countedObligationsTotal, sameCompany, isExactMatch, uniqueCompanyNames,
} from '../utils/underwritingAdapters';
import {
  parseCibilFile, parseBankStatementFile, parsePayslipFile, matchEmployerToCompanyList, READ_TIMEOUT_MSG,
} from '../utils/underwritingUploads';

const PRODUCT_TYPES = ['PL', 'BL', 'BL_SECURED', 'CONSUMER', 'HL', 'GOLD', 'OD', 'KCC', 'AUTO', 'EDU', 'CARD_LOAN', 'OTHER'];
const AUTOCOMPLETE_DEBOUNCE_MS = 250;

// Which draft fields each document pre-fills — a new upload refreshes only its
// own fields so the agent's edits elsewhere survive.
const CIBIL_CREDIT_KEYS = [
  'hdfcSettlementOrWO', 'hdfcBadHistory', 'dpdAcrossAllTrades', 'settlementsOrWO', 'freshLoanAfterSettlement', 'overdueLast12m',
  'settledLenders', 'dpdLenders', 'dpdAccounts', 'loanAccountsEver', 'enquiries90d', 'enquiryList',
];
const BSA_CREDIT_KEYS = ['bouncesLast12m', 'bouncesOnlyCardOrGold'];
const EMPTY_UPLOADS = { cibil: null, bsa: null, payslips: [] };
const EMPTY_DOC = { busy: false, error: null, needsPassword: false, wrongPassword: false, pending: null, savedMsg: null };
const DOC_TABLES = { cibil: 'customer_cibil_data', bsa: 'customer_bank_statement_data' };
const EMPTY_DOCS = { cibil: EMPTY_DOC, bsa: EMPTY_DOC, payslip: EMPTY_DOC };

const fmtL = (n) => {
  if (n == null || !isFinite(n)) return '—';
  return `${n < 0 ? '−' : ''}₹${(Math.abs(n) / 100000).toFixed(2)}L`;
};
const fmtR = (n) => (n == null || !isFinite(n) ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`);
const fmt = (n) => Math.round(+n || 0).toLocaleString('en-IN'); // table cells: Indian grouping, no ₹
const numOrNull = (v) => (v === '' || v == null ? null : Number(v));
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString('en-GB') : '');
const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));

const S = {
  section: { marginBottom: 18 },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 },
  grid3: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 },
  label: { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' },
  hint: { fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 },
  cellInput: { width: '100%', minWidth: 70, padding: '5px 8px', fontSize: 13 },
  dropdown: {
    position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50,
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
    boxShadow: 'var(--shadow)', maxHeight: 240, overflowY: 'auto',
  },
  option: { padding: '9px 14px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid var(--border-light)' },
  check: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' },
  stat: { fontSize: 12, color: 'var(--text-muted)' },
  uploadBox: { border: '1px dashed var(--border)', borderRadius: 'var(--radius)', padding: 14 },
};

// Rebuilds the draft from the current sources. `changed` limits the refresh to
// the fields that document owns ('all' = full rebuild, e.g. a lead was picked).
function mergeDraft(prev, changed, sources) {
  const cibil = sources.uploads.cibil?.row || sources.saved?.cibil || null;
  const bsa = sources.uploads.bsa?.row || sources.saved?.bsa || null;
  const fresh = buildProfileDraft(cibil, bsa, {
    payslipNetPay: averageNetPay(sources.uploads.payslips),
    payslipVariablePay: averageVariablePay(sources.uploads.payslips),
  });
  if (!prev || changed === 'all') return fresh;
  if (changed === 'cibil') {
    return {
      ...prev, loans: fresh.loans, cards: fresh.cards, cibilScore: fresh.cibilScore,
      credit: { ...prev.credit, ...pick(fresh.credit, CIBIL_CREDIT_KEYS) },
    };
  }
  if (changed === 'bsa') {
    const next = { ...prev, salaryAccountBank: fresh.salaryAccountBank, credit: { ...prev.credit, ...pick(fresh.credit, BSA_CREDIT_KEYS) } };
    // Never overwrite a payslip figure or a salary the agent typed.
    if (prev.netSalarySource === 'bank_statement' || prev.netSalary == null) {
      next.netSalary = fresh.netSalary;
      next.netSalarySource = fresh.netSalarySource;
    }
    return next;
  }
  if (changed === 'payslip') {
    return {
      ...prev, netSalary: fresh.netSalary, netSalarySource: fresh.netSalarySource,
      variablePayMonthly: fresh.variablePayMonthly, variablePaySource: fresh.variablePaySource,
    };
  }
  return prev;
}

export default function UnderwritingDesk({ userId, orgId }) {
  const [policies, setPolicies] = useState([]); // [{ bank_id, version, policy }]
  const [policyError, setPolicyError] = useState(null);

  const [mode, setMode] = useState('lead'); // 'lead' | 'new'
  const [lead, setLead] = useState(null);
  const [loadingLead, setLoadingLead] = useState(false);
  const [leadError, setLeadError] = useState(null);
  const [draft, setDraft] = useState(null);

  // saved = rows from Supabase for the picked lead; uploads = documents parsed
  // here this run. Mirrored in a ref so async upload handlers always build on
  // the latest sources even when two uploads finish close together.
  const sourcesRef = useRef({ saved: null, uploads: EMPTY_UPLOADS });
  const [sources, setSources] = useState(sourcesRef.current);
  const [docs, setDocs] = useState(EMPTY_DOCS);
  const runsRef = useRef({ cibil: 0, bsa: 0, payslip: 0 });
  // Invalidates every read still in flight (lead change / mode switch).
  const cancelReads = () => { Object.keys(runsRef.current).forEach((k) => { runsRef.current[k] += 1; }); };
  const [newLeadForm, setNewLeadForm] = useState({ full_name: '', mobile: '', pan: '' });
  const saveLeadRef = useRef(null); // header "Save as lead" scrolls here

  const [companyQuery, setCompanyQuery] = useState('');
  const [companyByBank, setCompanyByBank] = useState(null); // { query, banks: { bankId: { candidates, pick, category, variantIdx } } }
  // Banker-confirmed category for manual-category banks (Kotak): { bankId: 'CAT A' }.
  // Kept across company searches; cleared only when the lead or mode changes.
  const [manualCatByBank, setManualCatByBank] = useState({});
  // Bumped only when a lead is picked, so CompanyPanel auto-searches that lead's
  // company — but not after "Save as lead", which would wipe the agent's picks.
  const [companyAutoKey, setCompanyAutoKey] = useState(0);
  // Where the company search came from: 'lead' (saved company_name), 'payslip'
  // (employer matched exactly) or 'manual' (agent typed / picked). A payslip
  // match replaces 'lead' or nothing, never 'manual'. Ref copy for async code.
  const [companySource, setCompanySourceState] = useState(null);
  const companySourceRef = useRef(null);
  const setCompanySource = useCallback((src) => { companySourceRef.current = src; setCompanySourceState(src); }, []);
  const [payslipCompany, setPayslipCompany] = useState(null); // { rawName, status, exactTerm, suggestions }

  useEffect(() => {
    supabase
      .from('underwriting_policies')
      .select('bank_id,version,policy')
      .eq('is_active', true)
      .then(({ data, error }) => {
        if (error) setPolicyError(error.message);
        else setPolicies(data || []);
      });
  }, []);

  const updateSources = useCallback((changed, mutate, { rebuildDraft = true } = {}) => {
    const next = mutate(sourcesRef.current);
    sourcesRef.current = next;
    setSources(next);
    if (rebuildDraft) setDraft((prev) => mergeDraft(prev, changed, next));
  }, []);

  const setDoc = (kind, patch) => setDocs((d) => ({ ...d, [kind]: { ...d[kind], ...patch } }));

  const resetAll = (nextMode) => {
    cancelReads();
    setMode(nextMode);
    setLead(null);
    setLeadError(null);
    setDraft(null);
    sourcesRef.current = { saved: null, uploads: EMPTY_UPLOADS };
    setSources(sourcesRef.current);
    setDocs(EMPTY_DOCS);
    setNewLeadForm({ full_name: '', mobile: '', pan: '' });
    setCompanyQuery('');
    setCompanyByBank(null);
    setManualCatByBank({});
    setCompanySource(null);
    setPayslipCompany(null);
  };

  const onPickLead = async (l) => {
    setLead(l);
    setLoadingLead(true);
    setLeadError(null);
    // A different customer: drop anything uploaded (or still being read) for the previous one.
    cancelReads();
    setDocs(EMPTY_DOCS);
    try {
      const [cibilRes, bsaRes] = await Promise.all([
        supabase.from('customer_cibil_data').select('*').eq('lead_id', l.id).maybeSingle(),
        supabase.from('customer_bank_statement_data').select('*').eq('lead_id', l.id).maybeSingle(),
      ]);
      if (cibilRes.error) throw cibilRes.error;
      if (bsaRes.error) throw bsaRes.error;
      updateSources('all', () => ({ saved: { cibil: cibilRes.data, bsa: bsaRes.data }, uploads: EMPTY_UPLOADS }));
    } catch (e) {
      setLeadError(e.message || String(e));
      updateSources('all', () => ({ saved: null, uploads: EMPTY_UPLOADS }), { rebuildDraft: false });
      setDraft(null);
    } finally {
      setLoadingLead(false);
    }
    setCompanyQuery(l.company_name || '');
    setCompanyByBank(null);
    setManualCatByBank({});
    setCompanyAutoKey((k) => k + 1);
    setCompanySource(l.company_name ? 'lead' : null);
  };

  // ---- uploads ----

  const handlePasswordError = (kind, err, pending) => {
    const pw = passwordErrorKind(err);
    if (!pw) return false;
    setDoc(kind, { busy: false, error: null, needsPassword: true, wrongPassword: pw === 'wrong', pending });
    return true;
  };

  // Each read gets a run id per document kind; a read that finishes after a
  // newer upload, a lead change or a mode switch is ignored.
  const startRun = (kind) => ++runsRef.current[kind];
  const isCurrent = (kind, run) => runsRef.current[kind] === run;

  const uploadCibil = async (file, password = '') => {
    if (!file) return;
    const run = startRun('cibil');
    setDoc('cibil', { ...EMPTY_DOC, busy: true });
    try {
      const parsed = await parseCibilFile(file, password);
      if (!isCurrent('cibil', run)) return;
      const row = buildCibilRow(parsed, { leadId: lead?.id || null, fallbackName: lead?.full_name || '', userId });
      updateSources('cibil', (s) => ({ ...s, uploads: { ...s.uploads, cibil: { row, parsed, fileName: file.name } } }));
      setNewLeadForm({ full_name: parsed.customerName || '', mobile: normalizeMobile(parsed.mobile), pan: parsed.pan || '' });
      setDoc('cibil', {
        ...EMPTY_DOC,
        error: parsed.accounts.length === 0 ? 'Read the report but found 0 accounts — check it in CIBIL Analyzer.' : null,
      });
    } catch (e) {
      if (!isCurrent('cibil', run)) return;
      if (!handlePasswordError('cibil', e, [file])) setDoc('cibil', { ...EMPTY_DOC, error: e.message || String(e) });
    }
  };

  const uploadBsa = async (file, password = '') => {
    if (!file) return;
    const run = startRun('bsa');
    setDoc('bsa', { ...EMPTY_DOC, busy: true });
    try {
      const result = await parseBankStatementFile(file, password);
      if (!isCurrent('bsa', run)) return;
      const row = buildBsaRow(result, { leadId: lead?.id || null, fallbackName: lead?.full_name || '', userId });
      updateSources('bsa', (s) => ({ ...s, uploads: { ...s.uploads, bsa: { row, fileName: file.name } } }));
      setDoc('bsa', {
        ...EMPTY_DOC,
        error: !result.transactionCount ? 'No transactions found — this may be a scanned statement without a text layer.' : null,
      });
    } catch (e) {
      if (!isCurrent('bsa', run)) return;
      if (handlePasswordError('bsa', e, [file])) return;
      const msg = e.message || String(e);
      setDoc('bsa', { ...EMPTY_DOC, error: msg === READ_TIMEOUT_MSG ? msg : `Could not read this statement: ${msg}` });
    }
  };

  const uploadPayslips = async (files, password = '') => {
    const list = Array.from(files || []);
    if (!list.length) return;
    const run = startRun('payslip');
    setDoc('payslip', { ...EMPTY_DOC, busy: true });
    const parsed = [];
    const locked = [];
    const failed = [];
    let wrongPassword = false;
    for (const f of list) {
      try {
        parsed.push(await parsePayslipFile(f, password));
      } catch (e) {
        const pw = passwordErrorKind(e);
        if (pw) { locked.push(f); if (pw === 'wrong') wrongPassword = true; } else failed.push(`${f.name}: ${e.message || e}`);
      }
      if (!isCurrent('payslip', run)) return;
    }
    if (parsed.length) {
      updateSources('payslip', (s) => ({ ...s, uploads: { ...s.uploads, payslips: [...s.uploads.payslips, ...parsed] } }));
    }
    setDoc('payslip', {
      ...EMPTY_DOC,
      error: failed.length ? failed.join(' · ') : null,
      needsPassword: locked.length > 0,
      wrongPassword,
      pending: locked.length ? locked : null,
    });
  };

  const retryWithPassword = (kind, password) => {
    const pending = docs[kind].pending || [];
    if (kind === 'cibil') uploadCibil(pending[0], password);
    else if (kind === 'bsa') uploadBsa(pending[0], password);
    else uploadPayslips(pending, password);
  };

  const removeUpload = (kind, index) => {
    if (kind === 'payslip') {
      updateSources('payslip', (s) => ({ ...s, uploads: { ...s.uploads, payslips: s.uploads.payslips.filter((_, i) => i !== index) } }));
    } else {
      updateSources(kind, (s) => ({ ...s, uploads: { ...s.uploads, [kind]: null } }));
    }
    setDoc(kind, EMPTY_DOC);
  };

  // ---- saving uploads to a lead ----

  // Upserts one uploaded document onto `leadRow` in the same shape CibilParser
  // save() / SaveBsaToLead write. Returns the saved row.
  const writeDocToLead = async (kind, upload, leadRow, now = new Date()) => {
    const opts = { leadId: leadRow.id, fallbackName: leadRow.full_name, userId, now };
    const row = kind === 'cibil' ? buildCibilRow(upload.parsed, opts) : buildBsaRow(upload.row.result, opts);
    const { error } = await supabase.from(DOC_TABLES[kind]).upsert(row, { onConflict: 'lead_id' });
    if (error) throw error;
    return row;
  };

  // Existing lead mode: "Save to this lead" for one uploaded document.
  const saveUploadToLead = async (kind) => {
    const upload = sourcesRef.current.uploads[kind];
    if (!lead || !upload) return;
    setDoc(kind, { busy: true, error: null });
    try {
      const row = await writeDocToLead(kind, upload, lead);
      // Saved copy now equals the upload, so the draft stays as is.
      updateSources(kind, (s) => ({ saved: { ...(s.saved || {}), [kind]: row }, uploads: { ...s.uploads, [kind]: null } }), { rebuildDraft: false });
      setDoc(kind, { ...EMPTY_DOC, savedMsg: `Saved to ${lead.full_name}` });
    } catch (e) {
      setDoc(kind, { busy: false, error: `Save failed: ${e.message || e}` });
    }
  };

  const selectedCompanyName = () => {
    const picked = companyByBank && Object.values(companyByBank.banks).find((b) => isExactMatch(b.pick));
    return picked?.pick.company_name || companyByBank?.query || companyQuery.trim() || null;
  };

  // New customer mode: writes the uploaded CIBIL / statement to `leadRow` (new
  // or existing) and switches the screen to Existing lead mode on that lead.
  const attachDocsAndOpen = async (leadRow) => {
    const now = new Date();
    const { uploads } = sourcesRef.current;
    const saved = { cibil: null, bsa: null };
    for (const kind of ['cibil', 'bsa']) {
      if (!uploads[kind]) continue;
      try {
        saved[kind] = await writeDocToLead(kind, uploads[kind], leadRow, now);
      } catch (e) {
        throw new Error(`Lead ready, but saving the ${kind === 'cibil' ? 'CIBIL' : 'bank statement'} to it failed: ${e.message || e}`);
      }
    }
    // The saved rows now ARE the uploads, so the draft (and the agent's edits) stays as is.
    updateSources('all', (s) => ({
      saved,
      uploads: { ...EMPTY_UPLOADS, payslips: s.uploads.payslips },
    }), { rebuildDraft: false });
    setDocs(EMPTY_DOCS);
    setMode('lead');
    setLead(leadRow);
  };

  // find_leads_by_mobile is org-scoped and SECURITY DEFINER, so it also finds
  // leads the agent can't see; can_access says whether they may open/attach.
  const findExistingLeads = async (mobile) => {
    const { data, error } = await supabase.rpc('find_leads_by_mobile', { p_mobile: mobile });
    if (error) throw error;
    return (data || []).map((r) => ({
      id: r.lead_id, full_name: r.customer_name, mobile, status: r.status,
      assigned_to_name: r.assigned_to_name, created_at: r.created_at, can_access: !!r.can_access,
    }));
  };

  // Same insert pattern as Dashboard's lead import: normalized 10-digit mobile,
  // org_id stamped, assigned to the current user with assigned_at.
  const createLead = async () => {
    const now = new Date().toISOString();
    const { data, error } = await supabase.from('leads').insert([{
      full_name: newLeadForm.full_name.trim(),
      mobile: normalizeMobile(newLeadForm.mobile),
      pan_number: newLeadForm.pan.trim().toUpperCase() || null,
      company_name: selectedCompanyName(),
      status: 'Lead',
      lead_temperature: 'Cold',
      assigned_to: userId || null,
      assigned_at: userId ? now : null,
      source: 'Referral',
      sheet_number: 'Referral',
      org_id: orgId,
    }]).select('id,full_name,mobile,company_name,city').single();
    if (error) {
      if (error.code === '23505') throw new Error('You already have a lead with this mobile number — find it in Existing lead mode.');
      throw error;
    }
    await attachDocsAndOpen(data);
  };

  // ---- company from payslip ----

  // Header lines matching the lead's or the CIBIL customer's name are never the
  // employer. Re-extracted here (not just at upload) so a CIBIL or lead picked
  // after the payslip still counts.
  const cibilName = sources.uploads.cibil?.parsed.customerName || sources.saved?.cibil?.customer_name || '';
  const leadName = lead?.full_name || '';
  const payslipsView = useMemo(() => {
    const knownNames = [leadName, cibilName].filter(Boolean);
    return sources.uploads.payslips.map((p) => (p.text == null ? p : {
      ...p, employerName: extractEmployerName(p.text, p.headerLines, { knownNames }),
    }));
  }, [sources.uploads.payslips, leadName, cibilName]);
  const employer = useMemo(() => summarizeEmployer(payslipsView), [payslipsView]);

  useEffect(() => {
    const rawName = employer.employerName;
    if (!rawName) { setPayslipCompany(null); return undefined; }
    let cancelled = false;
    setPayslipCompany({ rawName, status: 'searching', exactTerm: null, suggestions: [] });
    matchEmployerToCompanyList(rawName)
      .then(({ exactTerm, suggestions }) => {
        if (cancelled) return;
        if (!exactTerm) { setPayslipCompany({ rawName, status: 'suggest', exactTerm: null, suggestions }); return; }
        setPayslipCompany({ rawName, status: 'exact', exactTerm, suggestions: [] });
        if (companySourceRef.current === 'manual') return;
        // Same path as the lead company_name pre-fill: CompanyPanel searches the
        // term and auto-selects exact rows (two-category handling unchanged).
        setCompanyQuery(exactTerm);
        setCompanyByBank(null);
        setCompanySource('payslip');
        setCompanyAutoKey((k) => k + 1);
      })
      .catch(() => { if (!cancelled) setPayslipCompany({ rawName, status: 'error', exactTerm: null, suggestions: [] }); });
    return () => { cancelled = true; };
  }, [employer.employerName, setCompanySource]);

  // ---- evaluation ----

  // Bank whose calculation fills the obligations table's Counted EMI / Status.
  const [tableBankId, setTableBankId] = useState(null);

  const patchDraft = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const patchCredit = (patch) => setDraft((d) => ({ ...d, credit: { ...d.credit, ...patch } }));

  const manualCategories = useMemo(() => manualCategoryBanks(policies), [policies]);

  // Manual-category banks (Kotak) use the agent's pick and need no company search.
  const companyFor = useCallback((bankId) => (manualCategories[bankId]
    ? manualCompany(companyByBank, manualCatByBank[bankId])
    : companyForBank(companyByBank, bankId)), [companyByBank, manualCategories, manualCatByBank]);

  // Unlisted company (e.g. IndusInd): banks that need the year of incorporation.
  // The field pre-fills from any bank's company search until the agent edits it.
  const unlistedBanks = useMemo(
    () => policies.filter((p) => isUnlistedFor(p.policy, companyFor(p.bank_id))).map((p) => p.policy?.bank || p.bank_id),
    [policies, companyFor],
  );
  const searchedIncYear = useMemo(() => searchedIncorporationYear(companyByBank), [companyByBank]);
  const incorporationYear = draft && draft.incorporationYear !== undefined ? draft.incorporationYear : searchedIncYear;
  // City pre-fills from the lead until the agent edits it (L&T: higher minimum salary in Mumbai).
  const city = draft && draft.city !== undefined ? draft.city : (lead?.city || '');

  const results = useMemo(() => {
    if (!draft) return [];
    // Every bank's own category (ICICI: Open Market / Preferred / …, HDFC: CAT A / …)
    // and which banks still need the banker-confirmed one picked.
    const categoriesByBank = {};
    const confirmedByBank = {};
    policies.forEach((p) => {
      const c = companyFor(p.bank_id);
      if (!c) return;
      categoriesByBank[p.bank_id] = c.category;
      if (c.categoryConfirmed === false) confirmedByBank[p.bank_id] = false;
    });
    return policies.map((p) => {
      const label = p.policy?.bank || p.bank_id;
      const scorecard = p.policy?.scorecard || null;
      // Salary the bank's figures are on (same order as the engine): − variable pay where the
      // policy counts fixed salary only (IndusInd), + co-applicant's where it adds it (HDFC, Kotak).
      const fixedOnly = p.policy?.exclude_variable_pay ? Math.max(0, draft.variablePayMonthly || 0) : 0;
      const salaryBase = Math.max(0, (draft.netSalary || 0) - fixedOnly)
        + (p.policy?.co_applicant_income ? draft.coApplicantNetSalary || 0 : 0);
      const listed = companyFor(p.bank_id);
      const company = isUnlistedFor(p.policy, listed) && listed.incorporationYear == null ? { ...listed, incorporationYear } : listed;
      const missing = [];
      if (!(draft.netSalary > 0)) missing.push('Enter the net monthly salary');
      if (!company) missing.push('Search the company to get its category');
      if (missing.length) return { bankId: p.bank_id, version: p.version, label, scorecard, salaryBase, result: { status: 'NEEDS_INPUT', reasons: missing, warnings: [] } };
      try {
        // One bad policy must never blank the page: errors stay on that bank's card.
        const result = evaluateBank(p.policy, { ...draft, city, company: { ...company, categoriesByBank, confirmedByBank } });
        return { bankId: p.bank_id, version: p.version, label, scorecard, salaryBase, productInfo: p.policy?.product_info || null, result };
      } catch (e) {
        return { bankId: p.bank_id, version: p.version, label, scorecard, salaryBase, error: e.message || String(e) };
      }
    });
  }, [draft, policies, companyFor, incorporationYear, city]);

  const customerName = lead?.full_name || newLeadForm.full_name || sources.uploads.cibil?.parsed.customerName || '';
  const canUpload = mode === 'new' || !!lead;

  return (
    <div style={{ ...page, maxWidth: '100%', overflowX: 'hidden', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={pageTitle}>Underwriting Desk</h2>
          <p style={pageSubtitle}>Bank-wise eligibility from CIBIL, banking and payslip{customerName ? ` — ${customerName}` : ''}</p>
        </div>
        {canUpload && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <HeaderUpload label="⬆ CIBIL" busy={docs.cibil.busy} onFiles={(fs) => uploadCibil(fs[0])} />
            <HeaderUpload label="⬆ Bank statement" busy={docs.bsa.busy} onFiles={(fs) => uploadBsa(fs[0])} />
            <HeaderUpload label="⬆ Payslips" multiple busy={docs.payslip.busy} onFiles={uploadPayslips} />
            {mode === 'new' && sources.uploads.cibil && (
              <button style={btnPri} onClick={() => saveLeadRef.current && saveLeadRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
                Save as lead
              </button>
            )}
          </div>
        )}
      </div>

      {policyError && <div className="info-box info-box-red">Could not load bank policies: {policyError}</div>}

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <h3 style={{ ...cardHeader, margin: 0 }}>Customer &amp; documents</h3>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button style={mode === 'lead' ? btnPriSm : btnSecSm} onClick={() => mode !== 'lead' && resetAll('lead')}>Existing lead</button>
            <button style={mode === 'new' ? btnPriSm : btnSecSm} onClick={() => mode !== 'new' && resetAll('new')}>New customer</button>
          </div>
        </div>

        {mode === 'lead' && <LeadPicker lead={lead} onPick={onPickLead} />}
        {loadingLead && <div style={{ fontSize: '12px', color: '#7a8194', margin: '10px 0' }}>Loading CIBIL and bank statement…</div>}
        {leadError && <div className="info-box info-box-red">Could not load lead data: {leadError}</div>}

        {mode === 'lead' && !lead && (
          <p style={{ fontSize: '13px', color: '#7a8194', margin: '12px 0 0' }}>
            Pick a lead — their saved CIBIL report and bank statement analysis pre-fill everything below. For a referral not in the CRM yet, use New customer.
          </p>
        )}

        {/* Two columns from 1200px (App.css .uw-two-col): documents left, customer details right. */}
        <div className={draft && !loadingLead ? 'uw-two-col' : undefined}>
          <div>
            {canUpload && (
              <UploadPanel
                uploads={{ ...sources.uploads, payslips: payslipsView }}
                employer={employer}
                docs={docs}
                saveTarget={mode === 'lead' && lead ? { name: lead.full_name, saved: sources.saved || {} } : null}
                onSaveToLead={saveUploadToLead}
                onCibil={uploadCibil}
                onBsa={uploadBsa}
                onPayslips={uploadPayslips}
                onRetry={retryWithPassword}
                onRemove={removeUpload}
              />
            )}
            {draft && !loadingLead && <SourceNotes sources={sources} draft={draft} />}

            {/* New customer only — an existing lead is already saved. */}
            {mode === 'new' && sources.uploads.cibil && (
              <div ref={saveLeadRef}>
                <SaveLeadPanel
                  form={newLeadForm}
                  setForm={setNewLeadForm}
                  findExisting={findExistingLeads}
                  onCreate={createLead}
                  onAttach={attachDocsAndOpen}
                />
              </div>
            )}

            {mode === 'new' && !draft && (
              <p style={{ fontSize: '13px', color: '#7a8194', margin: '12px 0 0' }}>
                Start with the CIBIL report — the bank statement and payslips are optional.
              </p>
            )}
          </div>

        {draft && !loadingLead && (
          <div>
            <CompanyPanel
              query={companyQuery}
              setQuery={setCompanyQuery}
              byBank={companyByBank}
              setByBank={setCompanyByBank}
              policyBankIds={policies.map((p) => p.bank_id)}
              bankLabels={Object.fromEntries(policies.map((p) => [p.bank_id, p.policy?.bank || p.bank_id]))}
              manualCategories={manualCategories}
              manualValues={manualCatByBank}
              setManualValue={(bankId, v) => setManualCatByBank((m) => ({ ...m, [bankId]: v || null }))}
              autoSearchKey={companyAutoKey}
              onManual={() => { if (companySourceRef.current !== 'manual') setCompanySource('manual'); }}
              payslipHint={payslipCompany}
              fromPayslip={companySource === 'payslip'}
            />
            <IncomePanel draft={draft} patchDraft={patchDraft} payslips={sources.uploads.payslips} />
            <ApplicantPanel
              draft={draft}
              patchDraft={patchDraft}
              unlistedBanks={unlistedBanks}
              incorporationYear={incorporationYear}
              searchedIncYear={searchedIncYear}
              city={city}
              cityFromLead={!!lead?.city && draft.city === undefined}
            />
            <OtherIncomePanel draft={draft} patchDraft={patchDraft} />
          </div>
        )}
        </div>
      </div>

      {draft && !loadingLead && (
        <>
          <ObligationsPanel draft={draft} patchDraft={patchDraft} results={results} bankId={tableBankId} setBankId={setTableBankId} />
          <CreditPanel draft={draft} patchCredit={patchCredit} patchDraft={patchDraft} policies={policies} />
          {policies.length === 0 && !policyError && (
            <div className="info-box info-box-yellow">No active bank policies found.</div>
          )}
          {results.map((r) => (
            <ResultCard
              key={r.bankId}
              entry={r}
              loans={draft.loans}
              cards={draft.cards}
              netSalary={r.salaryBase}
              scorecardValue={(draft.scorecardByBank || {})[r.bankId] || null}
              onScorecard={(v) => patchDraft(scorecardPatch(draft.scorecardByBank, r.bankId, v))}
              onMarkClosed={(id) => patchDraft({ loans: draft.loans.map((l) => (l.id === id ? { ...l, ...treatmentPatch('closed') } : l)) })}
            />
          ))}
        </>
      )}
    </div>
  );
}

// Header upload button (CAM-style) feeding the same handlers as the upload boxes.
function HeaderUpload({ label, multiple, busy, onFiles }) {
  const ref = useRef(null);
  return (
    <>
      <button style={btnSec} disabled={busy} onClick={() => ref.current && ref.current.click()}>{busy ? 'Reading…' : label}</button>
      <input
        ref={ref}
        type="file"
        accept="application/pdf,.pdf"
        multiple={!!multiple}
        style={{ display: 'none' }}
        onChange={(e) => { const fs = Array.from(e.target.files || []); e.target.value = ''; if (fs.length) onFiles(fs); }}
      />
    </>
  );
}

// Sub-section inside the Customer & documents card.
const subTitle = { fontSize: '12px', fontWeight: 700, color: '#48506b', margin: '18px 0 8px', textTransform: 'none' };
function Sub({ title, bodyStyle, children }) {
  return (
    <div>
      {title && <div style={subTitle}>{title}</div>}
      <div style={bodyStyle}>{children}</div>
    </div>
  );
}

// ---------------- Lead picker (same pattern as CibilParser "Link to Customer Profile") ----------------

function LeadPicker({ lead, onPick }) {
  const [search, setSearch] = useState('');
  const [leads, setLeads] = useState([]);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!search || search.length < 2) { setLeads([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('leads').select('id,full_name,mobile,company_name,city').ilike('full_name', `%${search}%`).limit(8);
      setLeads(data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <Sub title="Customer" bodyStyle={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 420 }}>
          <input
            style={inp}
            placeholder="Search customer name…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setShow(true); }}
            onFocus={() => setShow(true)}
          />
          {show && leads.length > 0 && (
            <div style={S.dropdown}>
              {leads.map((l) => (
                <div
                  key={l.id}
                  style={S.option}
                  onClick={() => { setSearch(l.full_name); setShow(false); onPick(l); }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <strong>{l.full_name}</strong>
                  <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{l.mobile}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {lead && <span className="badge badge-green">✓ {lead.full_name}</span>}
    </Sub>
  );
}

function SourceNotes({ sources, draft }) {
  const { saved, uploads } = sources;
  const cibilUp = uploads.cibil;
  const bsaUp = uploads.bsa;
  const cibil = saved?.cibil;
  const bsa = saved?.bsa;
  const counts = `${draft.loans.length} open loan(s), ${draft.cards.length} card(s) pre-filled.`;
  return (
    <div className="info-box info-box-blue" style={{ marginTop: 14 }}>
      {cibilUp
        ? <>CIBIL from uploaded file {cibilUp.fileName} (score {cibilUp.parsed.score ?? '—'}){cibil ? ', overriding the saved report' : ''}: {counts}</>
        : cibil
          ? <>CIBIL saved {fmtDate(cibil.uploaded_at || cibil.report_date)} (score {cibil.cibil_score ?? '—'}): {counts}</>
          : <>No CIBIL report — add obligations manually.</>}
      {' '}
      {bsaUp
        ? <>Bank statement from uploaded file {bsaUp.fileName}{bsa ? ' (overriding the saved analysis)' : ''} used for bounces and salary account.</>
        : bsa
          ? <>Bank statement ({bsa.bank_name || 'bank'}, {bsa.statement_period || 'period unknown'}) used for bounces and salary account.</>
          : <>No bank statement analysis — bounces and salary account need manual input.</>}
    </div>
  );
}

// ---------------- Document uploads ----------------

function UploadPanel({ uploads, employer, docs, saveTarget, onSaveToLead, onCibil, onBsa, onPayslips, onRetry, onRemove }) {
  const avg = averageNetPay(uploads.payslips);
  const saveBtn = (kind, label) => saveTarget && (
    <SaveToLeadButton
      busy={docs[kind].busy}
      confirmText={saveTarget.saved[kind]
        ? `This replaces the ${label} already saved on ${saveTarget.name}.`
        : `Saves this ${label} to ${saveTarget.name}.`}
      onConfirm={() => onSaveToLead(kind)}
    />
  );
  return (
    <Sub title="Documents">
        <div style={S.grid3}>
          <UploadBox title="CIBIL report (PDF)" doc={docs.cibil} onFiles={(fs) => onCibil(fs[0])} onRetry={(pw) => onRetry('cibil', pw)}>
            {uploads.cibil && (
              <UploadedLine name={uploads.cibil.fileName} onRemove={() => onRemove('cibil')}>
                {uploads.cibil.parsed.accounts.length} accounts · score {uploads.cibil.parsed.score ?? '—'}
              </UploadedLine>
            )}
            {uploads.cibil && saveBtn('cibil', 'CIBIL report')}
          </UploadBox>
          <UploadBox title="Bank statement (PDF)" doc={docs.bsa} onFiles={(fs) => onBsa(fs[0])} onRetry={(pw) => onRetry('bsa', pw)}>
            {uploads.bsa && (
              <UploadedLine name={uploads.bsa.fileName} onRemove={() => onRemove('bsa')}>
                {uploads.bsa.row.bank_name || 'Bank'} · {uploads.bsa.row.statement_period || 'period unknown'}
              </UploadedLine>
            )}
            {uploads.bsa && saveBtn('bsa', 'bank statement')}
          </UploadBox>
          <UploadBox title="Payslips (PDF, one or more)" multiple doc={docs.payslip} onFiles={onPayslips} onRetry={(pw) => onRetry('payslip', pw)}>
            {uploads.payslips.map((p, i) => (
              <UploadedLine key={`${p.fileName}-${i}`} name={p.month ? `${p.month} — ${p.fileName}` : p.fileName} onRemove={() => onRemove('payslip', i)}>
                {p.netPay > 0 ? `Net pay ${fmtR(p.netPay)}` : <span style={{ color: 'var(--warning)' }}>Net pay not found — not counted</span>}
                {p.employerName ? ` · ${p.employerName}` : ''}
              </UploadedLine>
            ))}
            {employer.differs && (
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--warning)', marginTop: 8 }}>
                Employer differs across payslips — possible job change (using the latest month: {employer.employerName})
              </div>
            )}
            {avg && uploads.payslips.length > 1 && (
              <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 8 }}>Average net pay {fmtR(avg)}</div>
            )}
          </UploadBox>
        </div>
        <div style={S.hint}>An upload here overrides the saved data for this run only.</div>
    </Sub>
  );
}

function UploadBox({ title, multiple, doc, onFiles, onRetry, children }) {
  const inputRef = useRef(null);
  const [pw, setPw] = useState('');
  return (
    <div style={S.uploadBox}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: 13 }}>{title}</strong>
        <button style={btnSecSm} onClick={() => inputRef.current && inputRef.current.click()} disabled={doc.busy}>
          {doc.busy ? 'Reading…' : 'Choose'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple={!!multiple}
          style={{ display: 'none' }}
          onChange={(e) => {
            const fs = Array.from(e.target.files || []);
            e.target.value = ''; // allow re-picking the same file
            setPw('');
            if (fs.length) onFiles(fs);
          }}
        />
      </div>
      {children}
      {doc.needsPassword && (
        <div style={{ marginTop: 10 }}>
          <label style={S.label}>{doc.wrongPassword ? 'Incorrect password — try again' : 'This PDF is password-protected'}</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              style={cellInp}
              type="password"
              value={pw}
              autoFocus
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && pw) onRetry(pw); }}
            />
            <button style={btnPriSm} disabled={!pw || doc.busy} onClick={() => onRetry(pw)}>Unlock</button>
          </div>
          {doc.pending && doc.pending.length > 1 && <div style={S.hint}>{doc.pending.length} files need this password.</div>}
        </div>
      )}
      {doc.error && <div className="info-box info-box-red" style={{ marginTop: 10, fontSize: 12.5 }}>{doc.error}</div>}
      {doc.savedMsg && <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--success)', fontWeight: 600 }}>✓ {doc.savedMsg}</div>}
    </div>
  );
}

// Existing lead mode: two-step "Save to this lead" so replacing the saved copy is deliberate.
function SaveToLeadButton({ busy, confirmText, onConfirm }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button style={{ ...btnSecSm, marginTop: 8 }} disabled={busy} onClick={() => setConfirming(true)}>
        Save to this lead
      </button>
    );
  }
  return (
    <div className="info-box info-box-yellow" style={{ marginTop: 8, fontSize: 12.5 }}>
      <div style={{ marginBottom: 6 }}>{confirmText}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button style={btnPriSm} disabled={busy} onClick={() => { setConfirming(false); onConfirm(); }}>
          {busy ? 'Saving…' : 'Confirm save'}
        </button>
        <button style={btnGhostSm} disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
      </div>
    </div>
  );
}

function UploadedLine({ name, onRemove, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12.5 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>✓ {name}</div>
        <div style={S.stat}>{children}</div>
      </div>
      <button style={btnGhostSm} onClick={onRemove} title="Remove">✕</button>
    </div>
  );
}

// ---------------- Save as lead (New customer mode) ----------------

function SaveLeadPanel({ form, setForm, findExisting, onCreate, onAttach }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [matches, setMatches] = useState(null); // existing leads with the same mobile

  const mobile = normalizeMobile(form.mobile);
  const set = (k) => (e) => { setForm({ ...form, [k]: e.target.value }); setMatches(null); setError(null); };

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(e.message || String(e)); } finally { setBusy(false); }
  };

  const save = () => run(async () => {
    if (!form.full_name.trim()) throw new Error('Enter the customer name.');
    if (mobile.length !== 10) throw new Error('Enter a 10-digit mobile number.');
    const existing = await findExisting(mobile);
    if (existing.length) { setMatches(existing); return; }
    await onCreate();
  });

  return (
    <Sub title="Save as lead">
        <div style={S.grid3}>
          <div>
            <label style={S.label}>Name</label>
            <input style={inp} value={form.full_name} onChange={set('full_name')} />
          </div>
          <div>
            <label style={S.label}>Mobile *</label>
            <input style={inp} value={form.mobile} onChange={set('mobile')} placeholder="10-digit mobile" />
          </div>
          <div>
            <label style={S.label}>PAN</label>
            <input style={inp} value={form.pan} onChange={set('pan')} />
          </div>
        </div>
        <div style={S.hint}>
          Pre-filled from the CIBIL report. Saved with source "Referral", status "Lead", assigned to you, with the uploaded CIBIL and bank statement attached.
        </div>

        {matches && (
          // A match always blocks creating a new lead: attach to one the agent can
          // access, otherwise the lead has to be reassigned / shared by an admin.
          <div className="info-box info-box-yellow" style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              {matches.some((m) => m.can_access)
                ? `A lead with mobile ${mobile} already exists. Attach these documents to it instead?`
                : `Mobile ${mobile} already belongs to a lead — a new lead can't be created with it.`}
            </div>
            {matches.map((m) => (
              <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid var(--border-light)' }}>
                {m.can_access ? (
                  <>
                    <div style={{ fontSize: 13 }}>
                      <strong>{m.full_name}</strong> · {m.mobile}
                      <span style={S.stat}> · {m.status || '—'}{m.assigned_to_name ? ` · ${m.assigned_to_name}` : ''}</span>
                    </div>
                    <button style={btnPriSm} disabled={busy} onClick={() => run(() => onAttach(m))}>Attach here</button>
                  </>
                ) : (
                  <div style={{ fontSize: 13 }}>
                    Already a lead of {m.assigned_to_name || 'another agent'} ({m.status || 'no status'}) — ask your admin to reassign or share it
                  </div>
                )}
              </div>
            ))}
            {matches.some((m) => m.can_access) && (
              <div style={S.hint}>Attaching replaces any CIBIL / bank statement already saved on that lead.</div>
            )}
            <button style={{ ...btnGhostSm, marginTop: 6 }} onClick={() => setMatches(null)} disabled={busy}>Back</button>
          </div>
        )}
        {error && <div className="info-box info-box-red" style={{ marginTop: 12 }}>{error}</div>}

        {!matches && (
          <button style={{ ...btnPri, marginTop: 12 }} onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save as lead'}
          </button>
        )}
    </Sub>
  );
}

// ---------------- Company ----------------

// onManual: called on every agent action here (typing, searching, picking), so a
// later payslip match never replaces a company the agent chose. payslipHint:
// employer read from the payslip and how it matched the company list.
function CompanyPanel({ query, setQuery, byBank, setByBank, policyBankIds, bankLabels, manualCategories, manualValues, setManualValue, autoSearchKey, onManual, payslipHint, fromPayslip }) {
  const [suggestions, setSuggestions] = useState([]);
  const [showSug, setShowSug] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);
  const reqRef = useRef(0);
  const sugReqRef = useRef(0);

  const runSearch = useCallback(async (q) => {
    const term = (q ?? '').trim();
    if (!term) return;
    setShowSug(false);
    const reqId = ++reqRef.current;
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('search_company_category', { p_query: term });
    if (reqId !== reqRef.current) return;
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    const banks = {};
    (data || []).forEach((row) => {
      if (!banks[row.bank]) banks[row.bank] = { candidates: [] };
      banks[row.bank].candidates.push(row);
    });
    Object.values(banks).forEach((b) => {
      // Auto-select only an exact match; fuzzy candidates wait for the agent.
      const exact = b.candidates.find(isExactMatch);
      b.pick = exact || null;
      b.category = exact && !hasVariants(exact) ? exact.category : '';
      b.variantIdx = null;
    });
    // Banks without a list (manual_category, e.g. Kotak) take the agent's banker-confirmed pick only.
    Object.keys(manualCategories).forEach((id) => { delete banks[id]; });
    setByBank({ query: term, banks });
  }, [setByBank, manualCategories]);

  // Auto-search the current query when the key bumps (lead picked / payslip employer matched).
  useEffect(() => {
    if (autoSearchKey && query) runSearch(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSearchKey]);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const onChange = (val) => {
    onManual();
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.trim().length < 2) { sugReqRef.current++; setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      const reqId = ++sugReqRef.current;
      const { data, error: rpcError } = await supabase.rpc('autocomplete_company_name', { p_query: val.trim(), p_limit: 10 });
      if (reqId !== sugReqRef.current) return;
      if (!rpcError) { setSuggestions(uniqueCompanyNames((data || []).map((s) => s.company_name))); setShowSug(true); }
    }, AUTOCOMPLETE_DEBOUNCE_MS);
  };

  const pickTerm = (name) => { onManual(); sugReqRef.current++; setQuery(name); setSuggestions([]); runSearch(name); };
  const searchTyped = () => { onManual(); sugReqRef.current++; runSearch(query); };

  const updateBank = (bankId, patch) => { onManual(); setByBank((s) => ({
    ...s, banks: { ...s.banks, [bankId]: { ...(s.banks[bankId] || { candidates: [] }), ...patch } },
  })); };

  // Manual-category banks (Kotak) are listed before any search; the rest once a search has run.
  // Banks with an active policy come first; every other company list sits in a collapsed group.
  const manualIds = policyBankIds.filter((id) => manualCategories[id]);
  const policyIds = byBank ? policyBankIds : manualIds;
  const otherIds = byBank ? Object.keys(byBank.banks).filter((id) => !policyBankIds.includes(id)) : [];
  const [showOther, setShowOther] = useState(false);
  const [listLabels, setListLabels] = useState({}); // company_category_banks: { id: label }
  useEffect(() => {
    let live = true;
    supabase.from('company_category_banks').select('id, label').then(({ data }) => {
      if (live && data) setListLabels(Object.fromEntries(data.map((b) => [b.id, b.label])));
    });
    return () => { live = false; };
  }, []);
  const labelOf = (id) => bankLabels[id] || listLabels[id] || id;

  const bankRow = (id) => {
    const b = (byBank && byBank.banks[id]) || { candidates: [], pick: null, category: '' };
    const variants = b.pick && hasVariants(b.pick) ? b.pick.variants : null;
    const manual = manualCategories[id];
    if (manual) {
      return (
        <tr key={id}>
          <td style={{ ...td, whiteSpace: 'nowrap', fontSize: '12px' }}>
            {labelOf(id)}
          </td>
          <td style={td} colSpan={2}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-primary)', flexWrap: 'wrap' }}>
              {labelOf(id)} category (confirm with banker)
              <select
                style={{ ...cellInp, width: 'auto', minWidth: 110 }}
                value={manualValues[id] || ''}
                onChange={(e) => setManualValue(id, e.target.value)}
              >
                <option value="">—</option>
                {manual.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </td>
        </tr>
      );
    }
    return (
      <tr key={id}>
        <td style={{ ...td, whiteSpace: 'nowrap', fontSize: '12px' }}>
          {labelOf(id)}
        </td>
        <td style={td}>
          {b.candidates.length === 0 && <span style={S.stat}>Not listed</span>}
          {b.candidates.length > 0 && (
            <select
              style={cellInp}
              value={b.pick ? b.candidates.indexOf(b.pick) : -1}
              onChange={(e) => {
                const pick = b.candidates[+e.target.value] || null;
                updateBank(id, { pick, variantIdx: null, category: pick && !hasVariants(pick) ? pick.category : '' });
              }}
            >
              <option value={-1}>— not this company / not listed —</option>
              {b.candidates.map((c, i) => (
                <option key={i} value={i}>{c.company_name} ({c.match_type})</option>
              ))}
            </select>
          )}
          {b.pick && <CinLine row={b.pick} />}
        </td>
        <td style={td}>
          {variants ? (
            <div>
              <div style={{ fontSize: 12, color: 'var(--warning)', fontWeight: 600, marginBottom: 4 }}>
                Listed twice — pick the banker-confirmed one:
              </div>
              {variants.map((v, i) => (
                <label key={i} style={{ ...S.check, marginBottom: 3 }}>
                  <input
                    type="radio"
                    name={`variant-${id}`}
                    checked={b.variantIdx === i}
                    onChange={() => updateBank(id, { variantIdx: i, category: v.category || '' })}
                  />
                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>{v.cin ? `CIN ${v.cin}` : 'No CIN'}</span>
                  <strong>{v.category || '—'}</strong>
                  {v.incorporation_year && <span style={S.stat}>Inc. {v.incorporation_year}</span>}
                </label>
              ))}
            </div>
          ) : (
            <input
              style={cellInp}
              value={b.category || ''}
              placeholder={`Enter ${labelOf(id)} category`}
              onChange={(e) => updateBank(id, typedCategoryPatch(b, byBank.query, e.target.value))}
            />
          )}
        </td>
      </tr>
    );
  };

  return (
    <Sub title="Company">
        <div style={{ position: 'relative', maxWidth: 520, display: 'flex', gap: 8 }}>
          <input
            style={inp}
            placeholder="Company name, e.g. Infosys Limited"
            value={query}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') searchTyped(); }}
            onBlur={() => setTimeout(() => setShowSug(false), 150)}
            autoComplete="off"
          />
          <button style={btnSecSm} onClick={searchTyped} disabled={busy}>
            {busy ? 'Searching…' : 'Search'}
          </button>
          {showSug && suggestions.length > 0 && (
            <div style={S.dropdown}>
              {suggestions.map((name, i) => (
                <div
                  key={i}
                  style={S.option}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickTerm(name)}
                >
                  {name}
                </div>
              ))}
            </div>
          )}
        </div>
        {error && <div className="info-box info-box-red" style={{ marginTop: 10 }}>Company search failed: {error}</div>}
        {payslipHint && <PayslipCompanyHint hint={payslipHint} applied={fromPayslip} chosen={chosenCompanyNames(byBank, query)} onPick={pickTerm} />}

        {policyIds.length + otherIds.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: 14 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '640px' }}>
              <thead>
                <tr><th style={th}>Bank</th><th style={th}>Matched company</th><th style={th}>Category (editable)</th></tr>
              </thead>
              <tbody>
                {policyIds.map(bankRow)}
                {otherIds.length > 0 && (
                  <tr style={{ background: '#f7f9fc', cursor: 'pointer' }} onClick={() => setShowOther(!showOther)}>
                    <td style={{ ...td, fontSize: '12px', color: '#7a8194' }} colSpan={3}>
                      Other bank lists ({otherIds.length}) {showOther ? '▾' : '▸'}
                    </td>
                  </tr>
                )}
                {showOther && otherIds.map(bankRow)}
              </tbody>
            </table>
          </div>
        )}
    </Sub>
  );
}

const hasVariants = (row) => Array.isArray(row.variants) && row.variants.length > 0;

// The company the agent / lead / payslip search chose: the typed or searched
// term plus every company picked from a bank's list.
function chosenCompanyNames(byBank, query) {
  const picks = byBank ? Object.values(byBank.banks).map((b) => b.pick && b.pick.company_name).filter(Boolean) : [];
  return [query, byBank && byBank.query, ...picks].filter(Boolean);
}

// Source line under the company field for an employer read from the payslip.
// Compared with normCompany, so "Accenture Solutions Pvt Ltd" on the payslip is
// the same company as "ACCENTURE SOLUTIONS PRIVATE LIMITED" chosen here.
function PayslipCompanyHint({ hint, applied, chosen, onPick }) {
  const raw = <strong>{hint.rawName}</strong>;
  const same = (chosen || []).some((c) => sameCompany(hint.rawName, c) || (hint.exactTerm && sameCompany(hint.exactTerm, c)));
  if (same && hint.status !== 'searching') {
    return <div style={{ ...S.hint, marginTop: 8 }}>From payslip: {raw} <span style={{ color: 'var(--success)', fontWeight: 600 }}>✓ same company</span></div>;
  }
  const options = hint.status === 'exact' ? (applied ? [] : [hint.exactTerm]) : hint.suggestions;
  let detail = null;
  if (hint.status === 'searching') detail = ' — matching against the company list…';
  else if (hint.status === 'error') detail = ' — could not check the company list.';
  else if (hint.status === 'exact' && !applied) detail = ' — matches the company list; you have chosen a different company.';
  else if (hint.status === 'suggest') detail = hint.suggestions.length ? ' — no exact match in the company list.' : ' — not found in the company list.';
  return (
    <div style={{ ...S.hint, marginTop: 8 }}>
      From payslip: {raw}{detail}
      {options.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 6 }}>
          <span>{hint.status === 'exact' ? 'Use:' : 'Did you mean:'}</span>
          {options.map((name) => (
            <button key={name} style={btnSecSm} onClick={() => onPick(name)}>{name}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function CinLine({ row }) {
  const parts = [];
  if (row.cin) parts.push(`CIN ${row.cin}`);
  if (row.incorporation_year) parts.push(`Inc. ${row.incorporation_year}`);
  if (!parts.length) return null;
  return <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 3 }}>{parts.join(' · ')}</div>;
}

// ---------------- Income ----------------

function IncomePanel({ draft, patchDraft, payslips }) {
  const counted = (payslips || []).filter((p) => p.netPay > 0);
  return (
    <Sub title="Income &amp; score" bodyStyle={S.grid2}>
        <div>
          <label style={S.label}>Net monthly salary (₹)</label>
          <input
            style={inp}
            type="number"
            value={draft.netSalary ?? ''}
            onChange={(e) => patchDraft({ netSalary: numOrNull(e.target.value), netSalarySource: null })}
            placeholder="From payslip"
          />
          {draft.netSalarySource === 'payslip' && (
            <div style={{ ...S.hint, color: 'var(--warning)', fontWeight: 600 }}>
              From payslip — confirm
              {counted.length > 1 && (
                <span style={{ fontWeight: 400 }}>
                  {' '}(average of {counted.map((p) => `${p.month || p.fileName} ${fmtR(p.netPay)}`).join(', ')})
                </span>
              )}
            </div>
          )}
          {draft.netSalarySource === 'bank_statement' && (
            <div style={{ ...S.hint, color: 'var(--warning)', fontWeight: 600 }}>From bank statement — confirm against payslip</div>
          )}
        </div>
        <div>
          <label style={S.label}>Variable pay in net salary (₹/month)</label>
          <input
            style={inp}
            type="number"
            value={draft.variablePayMonthly ?? ''}
            onChange={(e) => patchDraft({ variablePayMonthly: numOrNull(e.target.value), variablePaySource: null })}
            placeholder="Bonus, incentives, commission"
          />
          {draft.variablePaySource === 'payslip' && (
            <div style={{ ...S.hint, color: 'var(--warning)', fontWeight: 600 }}>From payslip — confirm</div>
          )}
          <div style={S.hint}>IndusInd counts fixed salary only — this amount is left out for banks that exclude variable pay.</div>
        </div>
        <div>
          <label style={S.label}>Co-applicant net salary (₹/month)</label>
          <input
            style={inp}
            type="number"
            value={draft.coApplicantNetSalary ?? ''}
            onChange={(e) => patchDraft({ coApplicantNetSalary: numOrNull(e.target.value) })}
            placeholder="Optional"
          />
          <div style={S.hint}>Added for HDFC and Kotak; add the co-applicant&apos;s loans in the obligations table</div>
        </div>
        <div>
          <label style={S.label}>Salary account bank</label>
          <input
            style={inp}
            value={draft.salaryAccountBank || ''}
            onChange={(e) => patchDraft({ salaryAccountBank: e.target.value })}
            placeholder="e.g. HDFC Bank"
          />
          <div style={S.hint}>Some banks set a lower minimum salary when the salary is credited to their own account.</div>
        </div>
        <div>
          <label style={S.label}>CIBIL score</label>
          <input
            style={inp}
            type="number"
            value={draft.cibilScore ?? ''}
            onChange={(e) => patchDraft({ cibilScore: numOrNull(e.target.value) })}
            placeholder="e.g. 760"
          />
          <div style={S.hint}>From the CIBIL report (-1 = no credit history). Some banks set the interest rate by score band.</div>
        </div>
    </Sub>
  );
}

// Own house (FOIR / multiplier bonus at some banks) and, for an unlisted company,
// the year of incorporation the engine checks against the bank's minimum company age.
function ApplicantPanel({ draft, patchDraft, unlistedBanks, incorporationYear, searchedIncYear, city, cityFromLead }) {
  return (
    <Sub title="Residence &amp; company" bodyStyle={S.grid2}>
        <div>
          <label style={S.label}>City</label>
          <input style={inp} value={city || ''} onChange={(e) => patchDraft({ city: e.target.value })} placeholder="e.g. Bengaluru" />
          <div style={S.hint}>
            Some banks set a higher minimum salary in metro cities (L&amp;T: Mumbai).
            {cityFromLead ? ' From the lead — confirm.' : ''}
          </div>
        </div>
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', marginTop: 20 }}>
            <input type="checkbox" checked={!!draft.ownHouse} onChange={(e) => patchDraft({ ownHouse: e.target.checked })} />
            Own house (on customer or spouse name)
          </label>
          <div style={S.hint}>Some banks allow a higher FOIR or multiplier for an own house.</div>
        </div>
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', marginTop: 20 }}>
            <input type="checkbox" checked={!!draft.govtClass3} onChange={(e) => patchDraft({ govtClass3: e.target.checked })} />
            Government class 3 employee
          </label>
          <div style={S.hint}>Some banks cap the loan for class 3 government staff (L&amp;T: ₹7L).</div>
        </div>
        {unlistedBanks.length > 0 && (
          <div>
            <label style={S.label}>Year of incorporation</label>
            <input
              style={inp}
              type="number"
              value={incorporationYear ?? ''}
              onChange={(e) => patchDraft({ incorporationYear: numOrNull(e.target.value) })}
              placeholder="e.g. 2015 (from CIN / MCA)"
            />
            <div style={S.hint}>
              Company not listed for {unlistedBanks.join(', ')} — needed for the unlisted-company rules.
              {searchedIncYear != null && draft.incorporationYear === undefined ? ' Pre-filled from the company search — confirm.' : ''}
            </div>
          </div>
        )}
    </Sub>
  );
}

// Income on top of net salary. Each bank counts its own share of each item
// (the result card shows what was counted); banks without other-income rules ignore it.
const OTHER_INCOME_FIELDS = [
  ['bonusAnnualNet', 'Annual bonus (net)', 'Per year'],
  ['quarterlyIncentiveNet', 'Quarterly incentive (net)', 'Per quarter'],
  ['monthlyIncentiveAvg6m', 'Monthly incentive', 'Average of the last 6 months'],
  ['rentMonthly', 'Monthly rent', null],
  ['pensionMonthly', 'Monthly pension', null],
  ['consultingMonthly', 'Consulting income per month', 'Doctors, with 26AS / Form 16A'],
];
function OtherIncomePanel({ draft, patchDraft }) {
  const oi = draft.otherIncome || {};
  const hasAny = OTHER_INCOME_FIELDS.some(([k]) => oi[k] > 0);
  const [open, setOpen] = useState(false);
  const patchOi = (patch) => { setOpen(true); patchDraft({ otherIncome: { ...oi, ...patch } }); };
  if (!open && !hasAny) {
    return (
      <div style={{ marginTop: 14 }}>
        <button type="button" style={btnLink} onClick={() => setOpen(true)}>+ Add other income</button>
      </div>
    );
  }
  return (
    <Sub title="Other income" bodyStyle={S.grid2}>
        {OTHER_INCOME_FIELDS.map(([k, label, hint]) => (
          <div key={k}>
            <label style={S.label}>{label} (₹)</label>
            <input style={inp} type="number" value={oi[k] ?? ''} onChange={(e) => patchOi({ [k]: numOrNull(e.target.value) })} />
            {hint && <div style={S.hint}>{hint}</div>}
            {k === 'rentMonthly' && (
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, cursor: 'pointer', marginTop: 6 }}>
                <input type="checkbox" style={{ margin: '2px 0 0' }} checked={!!oi.rentVerified} onChange={(e) => patchOi({ rentVerified: e.target.checked })} />
                Registered/notarised agreement (3+ months) and 6 months rent credits verified
              </label>
            )}
          </div>
        ))}
        {!hasAny && (
          <div style={{ alignSelf: 'end' }}>
            <button type="button" style={btnLink} onClick={() => setOpen(false)}>Hide</button>
          </div>
        )}
    </Sub>
  );
}

// ---------------- Obligations ----------------

const TYPE_LABELS = {
  PL: 'PL', BL: 'BL', BL_SECURED: 'BL (secured)', CONSUMER: 'CD', HL: 'HL', GOLD: 'GOLD', OD: 'OD',
  KCC: 'KCC', AUTO: 'Auto', EDU: 'EDU', CARD_LOAN: 'Card loan', OTHER: 'Other',
};
const TREATMENTS = [['auto', 'Auto'], ['bt', 'BT'], ['obligate', 'Obligate'], ['closed', 'Closed before login (proof)']];
const tenureLabel = (m) => (m % 12 === 0 ? `${m / 12} year${m === 12 ? '' : 's'}` : `${m} months`);
const num = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const dash = <span style={{ fontSize: '12px', color: '#bcc3d2' }}>—</span>;
const btnGhostSm = { ...btnLink, color: '#9aa1b2', fontSize: '13px', padding: '4px 6px' };

// Fits a 1366px screen with the sidebar open (no sideways scroll): the reason
// sits under Counted and the HL / card controls under Treatment / Action instead of their own columns.
const OBL_COLS = [
  ['Financier', 150], ['Type', 84], ['Open date', 92], ['Loan amt / Limit', 100], ['Outstanding', 100], ['EMI', 100],
  ['Paid', 52], ['Left', 52], ['Treatment / Action', 160], ['Counted', 150], ['', 28],
];
const RIGHT_COLS = new Set(['Loan amt / Limit', 'Outstanding', 'EMI', 'Paid', 'Left', 'Counted']);
const COL_TIPS = { Paid: 'Installments since disbursal (first may be interest-only)' };
const OBL_MIN_WIDTH = OBL_COLS.reduce((s, [, w]) => s + w, 0);
const RED = '#dc2626';
const AMBER = '#d97706';
// Loan kind for NBFC / Kotak PLs (engine loan.odStatus); '' = not confirmed.
const OD_KINDS = [['', 'Not confirmed'], ['term', 'Term loan'], ['od_emi', 'OD – EMI started'], ['od_no_emi', 'OD – no EMI yet']];

// Rupee / count cell: shows 1,25,159 (Indian grouping) when not being edited.
function NumInput({ value, onChange, nullable = false, placeholder = '0', invalid = false }) {
  const [focused, setFocused] = useState(false);
  const hasValue = value !== null && value !== undefined && value !== '';
  const shown = focused ? (hasValue ? String(value) : '') : (hasValue ? Math.round(value).toLocaleString('en-IN') : '');
  return (
    <input
      style={{ ...cellInp, ...num, ...(invalid ? { borderColor: RED, background: '#fef2f2' } : null) }}
      inputMode="numeric"
      value={shown}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const digits = e.target.value.replace(/[^0-9.]/g, '');
        onChange(digits === '' ? (nullable ? null : 0) : Number(digits));
      }}
    />
  );
}

const CARD_ACTIONS = [['keep', 'Keep open'], ['paid', 'Paid before login (proof)'], ['close', 'Close before login (suggested)']];
const tag = (background, color) => ({ display: 'inline-block', padding: '1px 8px', borderRadius: '999px', fontSize: '10px', fontWeight: 700, background, color, whiteSpace: 'nowrap', marginRight: '4px' });
const smallNote = { fontSize: '10px', textAlign: 'right', fontWeight: 600, lineHeight: 1.3, whiteSpace: 'normal' };
const totalCell = { ...td, ...num, fontWeight: 700, fontSize: '12px' };

// One table for loans and credit cards. Counted / reason come from the selected
// bank's calculation (its policy rules); cards show their share of the counted CC obligation.
function ObligationsPanel({ draft, patchDraft, results, bankId, setBankId }) {
  const [showZero, setShowZero] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const setLoanById = (id, patch) => patchDraft({ loans: draft.loans.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const removeLoan = (id) => patchDraft({ loans: draft.loans.filter((l) => l.id !== id) });
  const setCard = (id, patch) => patchDraft({ cards: draft.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const removeCard = (id) => patchDraft({ cards: draft.cards.filter((c) => c.id !== id) });
  const nextId = (prefix, list) => `${prefix}${Date.now().toString(36)}${list.length}`;

  const entry = results.find((r) => r.bankId === bankId) || results[0];
  const res = entry && entry.result;
  const lines = (res && res.obligations && res.obligations.loans) || [];
  const cardCalc = res && res.obligations && res.obligations.cards;
  const best = res && res.best;
  const cardPlan = res && res.cardPlan;
  const lineOf = (id) => lines.find((l) => l.id === id);

  const activeLoans = draft.loans.filter((l) => !isZeroBalanceLoan(l));
  const zeroLoans = draft.loans.filter(isZeroBalanceLoan);
  const activeCards = draft.cards.filter((c) => !isZeroBalanceCard(c));
  const zeroCards = draft.cards.filter(isZeroBalanceCard);
  const zeroCount = zeroLoans.length + zeroCards.length;
  const totalOutstanding = [...draft.loans, ...draft.cards].reduce((s, x) => s + (Number(x.outstanding) || 0), 0);
  const counted = countedObligationsTotal(res && res.obligations);

  const suggested = new Set((cardPlan && cardPlan.closeCards) || []);
  const pendingSuggestion = cardPlan && cardPlan.closeCards.some((id) => {
    const c = draft.cards.find((x) => x.id === id);
    return c && c.action !== 'close';
  });
  const applySuggestion = () => patchDraft({
    cards: draft.cards.map((c) => (suggested.has(c.id) ? { ...c, ...cardActionPatch(c, 'close') } : c)),
  });

  const addLoan = () => patchDraft({ loans: [...draft.loans, {
    id: nextId('M', draft.loans), manual: true, lender: '', lenderType: null, productType: 'PL', openDate: '', loanAmount: 0, outstanding: 0, emi: 0,
    emisPaid: 0, emisRemaining: null, isJoint: false, coApplicantIncomeOk: null, hlEmiPaidBy: null, treatment: 'auto', closedBeforeLoginWithProof: false,
    odStatus: null, foreclosureLetter: false,
  }] });
  const addCard = () => patchDraft({ cards: [...draft.cards, {
    id: nextId('K', draft.cards), manual: true, issuer: '', limit: 0, openDate: '', outstanding: 0, paidBeforeLoginWithProof: 0, action: 'keep',
  }] });
  const add = (fn) => { fn(); setAddOpen(false); };

  const mutedRow = { background: '#fafbfe', color: '#9aa1b2' };

  const loanRow = (l, muted) => {
    const line = lineOf(l.id);
    const isHL = l.productType === 'HL';
    const bullet = isBulletLoan(l);
    const needsEmi = loanNeedsEmi(l);
    const showOd = !!((line && line.bt.odUnconfirmed) || l.odStatus);
    const odAsk = !l.odStatus && !!(res && res.odConfirm && res.odConfirm.includes(l.id));
    const showLetter = !!((line && line.bt.needsLetter) || l.foreclosureLetter);
    return (
      <tr key={l.id} style={muted ? mutedRow : undefined}>
        <td style={td}><input style={cellInp} value={l.lender} onChange={(e) => setLoanById(l.id, { lender: e.target.value })} placeholder="Bank" title={l.lender} /></td>
        <td style={td} title={l.sourceType || undefined}>
          <select style={cellSel} value={l.productType} onChange={(e) => setLoanById(l.id, { productType: e.target.value })}>
            {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>)}
          </select>
        </td>
        <td style={td}><input style={cellInp} value={l.openDate || ''} onChange={(e) => setLoanById(l.id, { openDate: e.target.value })} placeholder="dd/mm/yyyy" /></td>
        <td style={td}><NumInput value={l.loanAmount} onChange={(v) => setLoanById(l.id, { loanAmount: v })} /></td>
        <td style={td}><NumInput value={l.outstanding} onChange={(v) => setLoanById(l.id, { outstanding: v })} /></td>
        <td style={td}>
          {bullet ? (
            // Bullet / revolving: the CIBIL EMI is shown for reference only and left out of the EMI total.
            <div style={{ ...num, fontSize: '12px', color: '#9aa1b2', padding: '5px 0' }} title="Not in the EMI total">
              {l.emi > 0 ? fmt(l.emi) : '—'}
              <div style={{ ...smallNote, fontWeight: 400 }}>{bulletNote(line)}</div>
            </div>
          ) : (
            <>
              <NumInput value={l.emi} invalid={needsEmi} onChange={(v) => setLoanById(l.id, { emi: v })} />
              {needsEmi && <div style={{ ...smallNote, color: RED }}>Enter EMI</div>}
              {emiLooksTooLow(l) && <div style={{ ...smallNote, color: AMBER }}>EMI looks too low — check</div>}
            </>
          )}
        </td>
        <td style={td}><NumInput value={l.emisPaid} onChange={(v) => setLoanById(l.id, { emisPaid: v })} /></td>
        <td style={td}><NumInput nullable placeholder="?" value={l.emisRemaining} onChange={(v) => setLoanById(l.id, { emisRemaining: v })} /></td>
        <td style={td}>
          <select style={cellSel} value={treatmentChoice(l)} onChange={(e) => setLoanById(l.id, treatmentPatch(e.target.value))}>
            {TREATMENTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
          {isHL && (
            <div style={{ fontSize: '10px', color: '#555', marginTop: '4px', lineHeight: 1.4 }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '3px', cursor: 'pointer' }}>
                <input type="checkbox" style={{ margin: '1px 0 0' }} checked={!!(l.isJoint && l.coApplicantIncomeOk)} onChange={(e) => setLoanById(l.id, hlJointPatch(e.target.checked))} />
                Joint · co-applicant income OK
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '3px', marginTop: '2px', opacity: l.isJoint ? 1 : 0.5 }}>
                EMI paid by
                <select
                  style={{ ...cellSel, width: 'auto', padding: '1px 2px', fontSize: '10px', cursor: l.isJoint ? 'pointer' : 'not-allowed' }}
                  disabled={!l.isJoint}
                  title={l.isJoint ? undefined : 'Tick Joint first'}
                  value={l.hlEmiPaidBy || ''}
                  onChange={(e) => setLoanById(l.id, hlPayerPatch(e.target.value))}
                >
                  <option value="">—</option>
                  <option value="applicant">Applicant</option>
                  <option value="co_applicant">Co-applicant</option>
                </select>
              </label>
            </div>
          )}
          {showOd && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '3px', marginTop: '4px', fontSize: '10px', color: '#555' }}>
              Loan kind
              <select
                style={{ ...cellSel, width: 'auto', padding: '1px 2px', fontSize: '10px', ...(odAsk ? { borderColor: AMBER, background: '#fef9c3' } : null) }}
                title={odAsk ? 'In the best BT plan — confirm this is a term loan' : undefined}
                value={l.odStatus || ''}
                onChange={(e) => setLoanById(l.id, { odStatus: e.target.value || null })}
              >
                {OD_KINDS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </label>
          )}
          {showLetter && (
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '3px', marginTop: '4px', fontSize: '10px', color: '#555', cursor: 'pointer' }}>
              <input type="checkbox" style={{ margin: '1px 0 0' }} checked={!!l.foreclosureLetter} onChange={(e) => setLoanById(l.id, { foreclosureLetter: e.target.checked })} />
              Foreclosure letter received
            </label>
          )}
        </td>
        <td style={{ ...td, ...num }}>
          <div style={{ fontWeight: 700, fontSize: '12px' }}>{line ? fmt(line.obligation.amount) : '—'}</div>
          <ReasonLine text={loanReason(l, line, best)} />
        </td>
        <td style={td}>
          <button style={btnGhostSm} title="Remove row" onClick={() => removeLoan(l.id)}>✕</button>
        </td>
      </tr>
    );
  };

  const cardRow = (c, muted) => {
    const action = c.action || (c.paidBeforeLoginWithProof > 0 ? 'paid' : 'keep');
    const share = cardCountedShare(cardCalc, c.id);
    return (
      <tr key={c.id} style={muted ? mutedRow : undefined}>
        <td style={td}><input style={cellInp} value={c.issuer} onChange={(e) => setCard(c.id, { issuer: e.target.value })} placeholder="Card issuer" title={c.issuer} /></td>
        <td style={{ ...td, fontSize: '12px' }}>Credit card</td>
        <td style={td}><input style={cellInp} value={c.openDate || ''} onChange={(e) => setCard(c.id, { openDate: e.target.value })} placeholder="dd/mm/yyyy" /></td>
        <td style={td}><NumInput value={c.limit} onChange={(v) => setCard(c.id, { limit: v })} /></td>
        <td style={td}><NumInput value={c.outstanding} onChange={(v) => setCard(c.id, cardOutstandingPatch(c, v))} /></td>
        <td style={{ ...td, ...num }}>{dash}</td>
        <td style={{ ...td, ...num }}>{dash}</td>
        <td style={{ ...td, ...num }}>{dash}</td>
        <td style={td}>
          <select style={cellSel} value={action} onChange={(e) => setCard(c.id, cardActionPatch(c, e.target.value))}>
            {CARD_ACTIONS.map(([v, labelText]) => <option key={v} value={v}>{labelText}</option>)}
          </select>
          {action === 'paid' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px', fontSize: '10px', color: '#555' }}>
              Amount paid
              <NumInput value={c.paidBeforeLoginWithProof} onChange={(v) => setCard(c.id, { paidBeforeLoginWithProof: v })} />
            </label>
          )}
          {suggested.has(c.id) && <div style={{ marginTop: '4px' }}><span style={tag('#dcfce7', '#166534')}>Suggested: close</span></div>}
        </td>
        <td style={{ ...td, ...num }}>
          <div style={{ fontWeight: 700, fontSize: '12px' }}>{!cardCalc ? '—' : share == null ? '0' : fmt(share)}</div>
          <ReasonLine text={cardReason(cardCalc, c)} />
        </td>
        <td style={td}>
          <button style={btnGhostSm} title="Remove card" onClick={() => removeCard(c.id)}>✕</button>
        </td>
      </tr>
    );
  };

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
        <h3 style={{ ...cardHeader, margin: 0 }}>Obligations</h3>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {pendingSuggestion && (
            <button style={{ ...btnSecSm, color: '#166534', borderColor: '#bbf7d0', background: '#f0fdf4' }} onClick={applySuggestion}>
              Apply suggestion — close {cardPlan.closeCards.length} card{cardPlan.closeCards.length === 1 ? '' : 's'} ({fmtINR(cardPlan.closeAmount)})
              {cardPlan.newEligible != null ? ` → eligible ${fmtINR(cardPlan.newEligible)} (+${fmtINR(cardPlan.gain)})` : ''}
            </button>
          )}
          {results.length > 1 && (
            <label style={{ ...lbl, display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}>
              Counted for
              <select style={{ ...cellSel, width: 'auto' }} value={entry ? entry.bankId : ''} onChange={(e) => setBankId(e.target.value)}>
                {results.map((r) => <option key={r.bankId} value={r.bankId}>{r.label}</option>)}
              </select>
            </label>
          )}
          <div style={{ position: 'relative' }}>
            <button style={btnSecSm} onClick={() => setAddOpen(!addOpen)} onBlur={() => setTimeout(() => setAddOpen(false), 150)}>
              + Add row ▾
            </button>
            {addOpen && (
              <div style={{ ...S.dropdown, left: 'auto', right: 0, minWidth: 130 }}>
                <div style={S.option} onMouseDown={(e) => e.preventDefault()} onClick={() => add(addLoan)}>Loan</div>
                <div style={S.option} onMouseDown={(e) => e.preventDefault()} onClick={() => add(addCard)}>Credit card</div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: `${OBL_MIN_WIDTH}px`, tableLayout: 'fixed' }}>
          <colgroup>{OBL_COLS.map(([, w], i) => <col key={i} style={{ width: w + 'px' }} />)}</colgroup>
          <thead><tr>{OBL_COLS.map(([h], i) => <th key={i} style={{ ...th, textAlign: RIGHT_COLS.has(h) ? 'right' : 'left' }} title={COL_TIPS[h]}>{h}</th>)}</tr></thead>
          <tbody>
            {activeLoans.length === 0 && activeCards.length === 0 && (
              <tr><td colSpan={OBL_COLS.length} style={{ ...td, fontSize: '12px', color: '#7a8194' }}>No open loans or credit cards.</td></tr>
            )}
            {activeLoans.map((l) => loanRow(l, false))}

            {activeCards.length > 0 && (
              <tr>
                <td colSpan={OBL_COLS.length} style={{ ...td, padding: '6px 8px 4px', fontSize: '11px', fontWeight: 700, color: '#7a8194', borderTop: '2px solid #e3e8f0', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Credit cards
                </td>
              </tr>
            )}
            {activeCards.map((c) => cardRow(c, false))}

            {zeroCount > 0 && (
              <tr style={{ background: '#f7f9fc', cursor: 'pointer' }} onClick={() => setShowZero(!showZero)}>
                <td style={{ ...td, fontSize: '12px', color: '#7a8194' }} colSpan={OBL_COLS.length}>
                  Zero-balance accounts ({zeroCount}) — not counted {showZero ? '▾' : '▸'}
                </td>
              </tr>
            )}
            {showZero && zeroLoans.map((l) => loanRow(l, true))}
            {showZero && zeroCards.map((c) => cardRow(c, true))}

            <tr style={{ background: '#f0f4fa' }}>
              <td style={{ ...td, fontWeight: 700, fontSize: '12px' }} colSpan={4}>Total</td>
              <td style={totalCell}>{fmt(totalOutstanding)}</td>
              <td style={totalCell} title="Term loans only — gold / OD / KCC left out">{fmt(termEmiTotal(draft.loans))}</td>
              <td style={td} colSpan={3} />
              <td style={totalCell}>{counted == null ? '—' : fmt(counted)}</td>
              <td style={td} />
            </tr>
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: '11px', color: '#9aa1b2', margin: '12px 0 0' }}>
        {entry ? (
          res && res.obligations
            ? <>Counted follows <b>{entry.label}</b>&apos;s policy (loans + cards{cardCalc ? `: ${cardCalc.rule}` : ''}). </>
            : <>Counted appears once <b>{entry.label}</b> can be calculated (see its card below). </>
        ) : null}
        EMI total is term loans only. Treatment: <b>Auto</b> lets the bank decide; <b>BT</b> always takes the loan over when the bank allows it; <b>Obligate</b> keeps it as an obligation.
      </p>
    </div>
  );
}

function NumCell({ value, onChange, placeholder }) {
  return (
    <input
      style={inp}
      type="number"
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(numOrNull(e.target.value))}
    />
  );
}

// ---------------- Credit flags + risk ----------------

const typeLabel = (t) => (t === 'CC' ? 'card' : TYPE_LABELS[t] || t);

// One-line summary of the flags; "Edit" opens the full form.
function creditSummary(draft) {
  const c = draft.credit || {};
  const items = [];
  if (c.bouncesLast12m > 0) items.push(`${c.bouncesLast12m} bounce${c.bouncesLast12m > 1 ? 's' : ''} in 12 months${c.bouncesOnlyCardOrGold ? ' (card / gold only)' : ''}`);
  if (Array.isArray(c.dpdAccounts)) {
    const recent = c.dpdAccounts.filter((a) => a.inLast12m);
    if (recent.length) items.push(`Late in 12 months: ${recent.map((a) => `${a.lender} (${typeLabel(a.productType)})`).join(', ')}`);
  } else {
    if (c.overdueLast12m) items.push('Overdue in 12 months');
    if (c.hdfcBadHistory) items.push('HDFC DPD history');
  }
  if (c.settlementsOrWO > 0) {
    const f = c.freshLoanAfterSettlement || {};
    items.push(`${c.settlementsOrWO} settled / written-off${f.exists ? ` · fresh loan ${f.emisPaid || 0} EMIs paid` : ' · no fresh loan after'}`);
  }
  if (c.hdfcSettlementOrWO) items.push('HDFC settlement / write-off');
  if (c.dpdAcrossAllTrades) items.push('DPD across all accounts');
  const risk = draft.riskOverride ? `Risk band: ${draft.riskOverride === 'better' ? 'Better' : 'Lower'} (override)` : 'Risk band: Auto';
  // Enquiry limits differ per bank (the result cards say if it's over), so the count is shown neutrally.
  const plCount = plEnquiries90d(c.enquiryList);
  const enquiries = plCount != null
    ? `PL enquiries (90 days): ${plCount}`
    : c.enquiries90d == null ? 'Enquiries (90 days): not known' : `Enquiries (90 days): ${c.enquiries90d}`;
  return { text: items.length ? items.join(' · ') : 'No adverse flags', adverse: items.length > 0, risk, enquiries };
}

function CreditPanel({ draft, patchCredit, patchDraft, policies }) {
  const [open, setOpen] = useState(false);
  const c = draft.credit;
  const fresh = c.freshLoanAfterSettlement || { exists: false, emisPaid: 0 };
  const summary = creditSummary(draft);
  const ownEnquiries = ownBankEnquiries(c.enquiryList, policies);
  const enquiryList = c.enquiryList || [];
  // With a per-account list the engine reads it instead of the overdue / HDFC DPD flags.
  const perAccount = Array.isArray(c.dpdAccounts);
  const setAccount = (i, patch) => patchCredit({ dpdAccounts: c.dpdAccounts.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const flag = (k, label) => (
    <label style={S.check}>
      <input type="checkbox" checked={!!c[k]} onChange={(e) => patchCredit({ [k]: e.target.checked })} /> {label}
    </label>
  );
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
        <h3 style={{ ...cardHeader, margin: 0 }}>Credit flags</h3>
        <button style={btnLink} onClick={() => setOpen(!open)}>{open ? 'Done' : 'Edit'}</button>
      </div>
      <div style={{ fontSize: '13px', marginTop: '8px' }}>
        <span style={{ fontWeight: 700, color: summary.adverse ? '#b91c1c' : '#1a1a2e' }}>{summary.text}</span>
        <span style={{ color: '#7a8194' }}> · {summary.enquiries} · {summary.risk}</span>
        {ownEnquiries.length > 0 && (
          <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#b91c1c' }}>Own-bank enquiries (30 days):</span>
            {ownEnquiries.map((e) => <span key={e.bankId} style={tag('#fee2e2', '#991b1b')}>{e.short} {e.daysAgo}d</span>)}
          </div>
        )}
      </div>
      {open && (
        <div style={{ marginTop: '16px' }}>
          {perAccount && (
            <div style={{ marginBottom: '16px' }}>
              <label style={lbl}>Late payments reported in CIBIL</label>
              {c.dpdAccounts.length === 0 ? (
                <div style={{ fontSize: '12px', color: '#7a8194' }}>None.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', minWidth: '420px' }}>
                    <thead><tr>{['Lender', 'Type', 'In last 12 months', ''].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {c.dpdAccounts.map((a, i) => (
                        <tr key={i}>
                          <td style={{ ...td, fontSize: '12px' }}>{a.lender || '—'}</td>
                          <td style={{ ...td, fontSize: '12px' }}>{typeLabel(a.productType)}</td>
                          <td style={td}><input type="checkbox" checked={!!a.inLast12m} onChange={(e) => setAccount(i, { inLast12m: e.target.checked })} /></td>
                          <td style={td}>
                            <button style={btnGhostSm} title="Not a real late payment — remove" onClick={() => patchCredit({ dpdAccounts: c.dpdAccounts.filter((_, j) => j !== i) })}>✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={S.hint}>Each bank checks these against its own rules (e.g. HDFC ignores card late payments but rejects late payment on an HDFC personal loan).</div>
            </div>
          )}
          <div style={{ marginBottom: '16px' }}>
            <label style={lbl}>CIBIL enquiries ({enquiryList.length})</label>
            {enquiryList.length === 0 ? (
              <div style={{ fontSize: '12px', color: '#7a8194' }}>None in the report.</div>
            ) : (
              <div style={{ overflowX: 'auto', maxHeight: '240px', overflowY: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', minWidth: '520px' }}>
                  <thead><tr>{['Lender', 'Product', 'Date', 'Days ago'].map((h) => <th key={h} style={{ ...th, textAlign: h === 'Days ago' ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {enquiryList.map((e, i) => (
                      <tr key={i}>
                        <td style={{ ...td, fontSize: '12px' }}>{e.lender || '—'}</td>
                        <td style={{ ...td, fontSize: '12px' }}>{e.product || '—'}</td>
                        <td style={{ ...td, fontSize: '12px' }}>{e.date.split('-').reverse().join('/')}</td>
                        <td style={{ ...td, ...num, fontSize: '12px' }}>{e.daysAgo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={S.hint}>From CIBIL, read-only. A bank won&apos;t do the case within 30 days of its own personal loan enquiry.</div>
          </div>
          <div style={S.grid2}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {flag('hdfcSettlementOrWO', 'Settlement / write-off with HDFC')}
              {!perAccount && flag('hdfcBadHistory', 'Bad repayment history with HDFC (DPD)')}
              {flag('dpdAcrossAllTrades', 'DPD across all accounts')}
              {!perAccount && flag('overdueLast12m', 'Overdue / DPD in last 12 months')}
              {flag('bouncesOnlyCardOrGold', 'Bounces only on card / gold loan')}
              <div style={S.hint}>Settled / written-off with: {(c.settledLenders || []).join(', ') || 'none'}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div>
                <label style={lbl}>PL enquiries (90 days) — used only when the enquiry list is missing</label>
                <NumCell value={c.enquiries90d} placeholder="Not known" onChange={(v) => patchCredit({ enquiries90d: v })} />
              </div>
              <div>
                <label style={lbl}>Settled / written-off accounts</label>
                <NumCell value={c.settlementsOrWO} onChange={(v) => patchCredit({ settlementsOrWO: v ?? 0 })} />
              </div>
              <div>
                <label style={S.check}>
                  <input
                    type="checkbox"
                    checked={!!fresh.exists}
                    onChange={(e) => patchCredit({ freshLoanAfterSettlement: { ...fresh, exists: e.target.checked } })}
                  />
                  Fresh loan sanctioned after settlement — EMIs paid:
                </label>
                <div style={{ maxWidth: '120px', marginTop: '4px' }}>
                  <NumCell value={fresh.emisPaid} onChange={(v) => patchCredit({ freshLoanAfterSettlement: { ...fresh, emisPaid: v ?? 0 } })} />
                </div>
              </div>
              <div>
                <label style={lbl}>Bounces / ECS returns in last 12 months</label>
                <NumCell value={c.bouncesLast12m} onChange={(v) => patchCredit({ bouncesLast12m: v ?? 0 })} />
              </div>
            </div>
          </div>
          <div style={{ marginTop: '16px' }}>
            <label style={lbl}>Risk band</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              {[[null, 'Auto'], ['better', 'Better'], ['lower', 'Lower']].map(([v, label]) => (
                <button key={label} style={draft.riskOverride === v ? btnPriSm : btnSecSm} onClick={() => patchDraft({ riskOverride: v })}>{label}</button>
              ))}
            </div>
            <div style={S.hint}>Auto = indicated from bounces and late payments in the last 12 months.</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Results ----------------

const STATUS = {
  ELIGIBLE: { label: 'Eligible', background: '#dcfce7', color: '#166534' },
  NOT_ELIGIBLE: { label: 'Not eligible', background: '#fee2e2', color: '#991b1b' },
  NEEDS_INPUT: { label: 'Needs input', background: '#fef9c3', color: '#854d0e' },
  DEVIATION: { label: 'Deviation', background: '#ffedd5', color: '#9a3412' },
};
const pill = { display: 'inline-block', padding: '2px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, whiteSpace: 'nowrap' };
const chip = { display: 'inline-block', padding: '3px 10px', margin: '2px 6px 2px 0', borderRadius: '999px', background: '#eef4fb', color: BLUE, fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap' };

// Banks without a multiplier grid (e.g. ICICI) return an empty best.multiplier.
const hasMultiplier = (best) => !!best && Object.values(best.multiplier || {}).some(Boolean);

// The CC paydown suggestion is the most actionable warning, so it goes first.
const orderWarnings = (ws) => [...ws].sort((a, b) => (/on cards before login/i.test(b) ? 1 : 0) - (/on cards before login/i.test(a) ? 1 : 0));

function MessageList({ items, color, background }) {
  if (!items || !items.length) return null;
  return (
    <div style={{ marginTop: '10px', padding: '8px 12px', borderRadius: '8px', background, color, fontSize: '12px', lineHeight: 1.6 }}>
      {items.map((m, i) => <div key={i}>{m}</div>)}
    </div>
  );
}

const TONES = {
  green: { color: '#166534', background: '#dcfce7', borderColor: '#86efac' },
  amber: { color: '#854d0e', background: '#fef9c3', borderColor: '#fcd34d' },
  red: { color: '#991b1b', background: '#fee2e2', borderColor: '#fca5a5' },
};

// "<scorecard name>: — / Super green / Green / Yellow / Red" — the bank decides it, the agent records it.
function ScorecardSelect({ scorecard, value, onChange }) {
  const tone = TONES[scorecardTone(scorecard, value)];
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#555' }}>
      {scorecard.name}:
      <select
        style={{ ...cellSel, width: 'auto', padding: '1px 4px', fontSize: '11px', fontWeight: value ? 700 : 400, ...tone }}
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">—</option>
        {scorecard.values.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    </label>
  );
}

function ClosurePlan({ plan, onMarkClosed }) {
  return plan.map((c) => (
    <div key={c.id} style={{ marginTop: '6px', padding: '8px 12px', borderRadius: '8px', background: '#f0fdf4', color: '#166534', fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
      <span style={{ flex: 1, minWidth: '220px' }}>
        {c.makesEligible && <span style={{ ...tag('#166534', '#fff'), marginRight: '6px' }}>Makes eligible</span>}
        {closureLineText(c, { fmtAmount: fmtR, fmtLakh: fmtL })}
      </span>
      <button style={{ ...btnSecSm, padding: '2px 8px', fontSize: '11px' }} title="Set Treatment to Closed before login (proof)" onClick={() => onMarkClosed(c.id)}>Mark closed</button>
    </div>
  ));
}

function ResultCard({ entry, loans, cards, netSalary, scorecardValue, onScorecard, onMarkClosed }) {
  const { label, result, error } = entry;
  const st = result ? STATUS[result.status] || STATUS.NEEDS_INPUT : null;
  const lenderOf = (id) => loans.find((l) => l.id === id);
  const best = result && result.best;
  const needsInput = !!(result && result.status === 'NEEDS_INPUT');
  const notEligible = !!(result && result.status === 'NOT_ELIGIBLE');
  const afterWait = !!(notEligible && result.eligibleAfterWait && best);
  // The engine also words the card plan as a warning; it has its own green line here.
  const allWarnings = ((result && result.warnings) || []).filter((w) => !(result.cardPlan && /^Close .* before login/.test(w)));
  // The OD / flexi confirmation blocks the BT plan, so it gets its own amber line first.
  const isOdWarning = (w) => /not OD \/ flexi/.test(w);
  const odWarnings = allWarnings.filter(isOdWarning);
  const warnings = allWarnings.filter((w) => !isOdWarning(w));
  const closurePlan = visibleClosurePlan(result);

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <h3 style={{ ...cardHeader, margin: 0 }}>{label}</h3>
        {st && <span style={{ ...pill, background: st.background, color: st.color }}>{st.label}</span>}
        {entry.scorecard && <ScorecardSelect scorecard={entry.scorecard} value={scorecardValue} onChange={onScorecard} />}
        <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#9aa1b2' }}>
          {result && result.policyVersion ? `Policy ${result.policyVersion}` : entry.version ? `Policy ${entry.version}` : ''}
        </span>
      </div>
      {isLowerRule(best) && <div style={{ fontSize: '12px', color: '#7a8194', margin: '-8px 0 12px' }}>Lower of FOIR &amp; multiplier</div>}
      {isBothRule(best) && (
        <div style={{ fontSize: '12px', color: '#7a8194', margin: '-8px 0 12px' }}>
          FOIR and multiplier — bank decides (good banding → FOIR, bad banding → multiplier)
        </div>
      )}

      {error && (
        <div style={{ padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#b91c1c', fontSize: '13px' }}>
          <b>Couldn&apos;t evaluate — policy error.</b> {error}
        </div>
      )}

      {/* Needs input (e.g. EMI missing): the reason goes first and the figures are greyed. */}
      {needsInput && <MessageList items={result.reasons} color="#854d0e" background="#fef9c3" />}

      {/* Not eligible: only the red reasons, plus the card plan when closing cards could change that. */}
      {notEligible && <MessageList items={result.reasons} color="#b91c1c" background="#fef2f2" />}
      {notEligible && !afterWait && result.cardPlan && <CardPlanLine plan={result.cardPlan} cards={cards} />}
      {/* Soft fail (no EMI room / BT more than eligibility): closing a loan can fix it. Empty for permanent reasons. */}
      {notEligible && !afterWait && closurePlan.length > 0 && <ClosurePlan plan={closurePlan} onMarkClosed={onMarkClosed} />}

      {/* Temporary block (own-bank enquiry wait): the figures still apply once the wait is over. */}
      {afterWait && (
        <>
          <div style={{ marginTop: '10px', padding: '8px 12px', borderRadius: '8px', background: '#eef4fb', color: BLUE, fontSize: '12px', fontWeight: 600 }}>
            Eligible after {result.waitDays} day{result.waitDays === 1 ? '' : 's'}: {fmtINR(best.eligibleAmount)} (amount in hand {fmtINR(best.netInHand)})
          </div>
          <div style={{ opacity: 0.55, marginTop: '10px' }} title="Applies once the wait is over">
            <ResultTiles result={result} netSalary={netSalary} />
            {result.cardPlan && <CardPlanLine plan={result.cardPlan} cards={cards} />}
            <BtPlan best={best} lenderOf={lenderOf} />
          </div>
        </>
      )}

      {best && !notEligible && (
        <div style={needsInput ? { opacity: 0.45, marginTop: '10px' } : undefined} title={needsInput ? 'Provisional — fix the input above' : undefined}>
          <ResultTiles result={result} netSalary={netSalary} />
          {result.cardPlan && <CardPlanLine plan={result.cardPlan} cards={cards} />}
          {closurePlan.length > 0 && <ClosurePlan plan={closurePlan} onMarkClosed={onMarkClosed} />}
          <BtPlan best={best} lenderOf={lenderOf} />
        </div>
      )}

      {result && !notEligible && <MessageList items={odWarnings} color="#854d0e" background="#fef9c3" />}
      {result && !notEligible && <MessageList items={(result.notes || []).filter((n) => !isClosureNote(n))} color={BLUE} background="#eef4fb" />}
      {result && !notEligible && <MessageList items={[...(result.deviations || []), ...orderWarnings(warnings)]} color="#9a3412" background="#fff7ed" />}
      {result && !notEligible && !needsInput && <MessageList items={result.reasons} color="#b91c1c" background="#fef2f2" />}

      {result && !notEligible && result.scenarios && result.scenarios.length > 0 && (
        <OtherOptions scenarios={result.scenarios} best={best} lenderOf={lenderOf} />
      )}

      {result && result.checklist && result.checklist.length > 0 && <Checklist items={result.checklist} />}
      {entry.productInfo && <ProductInfoLine info={entry.productInfo} />}
    </div>
  );
}

// Things the bank checks at login that the engine can't (age, job stability, …).
function Checklist({ items }) {
  return (
    <div style={{ marginTop: '14px', paddingTop: '10px', borderTop: '1px solid #eef0f4', fontSize: '11.5px', color: '#7a8194' }}>
      <div style={{ fontWeight: 700, marginBottom: '2px' }}>Check before login</div>
      <ul style={{ margin: 0, paddingLeft: '18px', lineHeight: 1.6 }}>
        {items.map((c, i) => <li key={i}>{c}</li>)}
      </ul>
    </div>
  );
}

// "Processing fee 1.5–2% + GST · TAT 1 day · Foreclosure after 6 months, 5% · …"
const PRODUCT_INFO_LABELS = { processing_fee: 'Processing fee', tat: 'TAT', foreclosure: 'Foreclosure', part_payment: 'Part payment', insurance: 'Insurance', loan_amount: 'Loan amount' };
const productInfoText = (info) => Object.entries(info || {})
  .filter(([, v]) => v != null && String(v).trim() !== '')
  .map(([k, v]) => `${PRODUCT_INFO_LABELS[k] || (k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' '))} ${v}`)
  .join(' · ');
function ProductInfoLine({ info }) {
  const text = productInfoText(info);
  if (!text) return null;
  return <div style={{ marginTop: '10px', fontSize: '11.5px', color: '#9aa1b2', lineHeight: 1.5 }}>{text}</div>;
}

// Other income this bank counts on top of net salary (bank-specific %).
function OtherIncomeTable({ otherIncome, netSalary }) {
  if (!otherIncome || !(otherIncome.total > 0)) return null;
  const cols = ['Income item', 'Entered', 'Counted %', 'Added per month'];
  return (
    <div style={{ marginTop: '12px', overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '420px' }}>
        <thead><tr>{cols.map((h, i) => <th key={h} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>)}</tr></thead>
        <tbody>
          {otherIncome.lines.map((l) => (
            <tr key={l.key}>
              <td style={{ ...td, fontSize: '12px' }}>{l.label}</td>
              <td style={{ ...td, ...num, fontSize: '12px' }}>{fmtINR(l.raw)}</td>
              <td style={{ ...td, ...num, fontSize: '12px' }}>{l.pct}%</td>
              <td style={{ ...td, ...num, fontSize: '12px', fontWeight: 700 }}>{fmtINR(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: '12px', color: '#48506b', marginTop: '4px', textAlign: 'right' }}>
        Eligibility on <b>{fmtINR((netSalary || 0) + otherIncome.total)}/month</b>
      </div>
    </div>
  );
}

// IndusInd: the bank gives the lower of its best FOIR figure and the multiplier figure.
const isLowerRule = (scenario) => !!(scenario && scenario.eligibleRule === 'lower');
// HDFC: FOIR and multiplier both shown; the bank picks by banding, so no row is marked.
const isBothRule = (scenario) => !!(scenario && scenario.eligibleRule === 'both');

const GREEN = '#166534';
const MUTED = '#9aa1b2';

// Multiplier methods: 'multiplier' (category grid) and 'multiplier_<scorecard>' (e.g. Kotak Green).
const isMultiplierMethod = (m) => m.key === 'multiplier' || m.key.startsWith('multiplier_');
// "A1-B9 · ×27" for the category grid; "×17" for a scorecard row (the label already names it).
const multiplierText = (m) => (m.multiplier == null ? null : `${m.key === 'multiplier' && m.band ? `${m.band} · ` : ''}×${m.multiplier}`);

// Every method side by side (FOIR per tenure + multipliers); the bank may sanction on any of them.
// Indicative rows (scorecard not picked yet) are greyed and never the Highest.
function EligibilityTable({ result }) {
  const best = result.best;
  const band = result.risk.band;
  const indicated = best.multiplier && best.multiplier[band];
  const otherKey = band === 'better' ? 'lower' : 'better';
  const other = best.multiplier && best.multiplier[otherKey];
  const showOther = !!(other && indicated && other.band !== indicated.band);
  const cols = ['Method', 'Eligible amount', 'ROI', 'Tenure', 'Amount in hand after BT'];
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '560px' }}>
        <thead><tr>{cols.map((h, i) => <th key={h} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>)}</tr></thead>
        <tbody>
          {best.methods.map((m) => {
            const isMult = isMultiplierMethod(m);
            const ind = !!m.indicative;
            const highest = !ind && !isBothRule(best) && m.key === best.eligibleBy && m.amount > 0;
            const rowStyle = ind ? { color: MUTED, fontStyle: 'italic' } : highest ? { background: '#f0fdf4' } : undefined;
            const multText = isMult && multiplierText(m);
            return (
              <tr key={m.key} style={rowStyle}>
                <td style={td}>
                  <div style={{ fontSize: '13px', fontWeight: ind ? 400 : 600 }}>
                    {m.label}
                    {ind && <span style={{ fontSize: '11px' }}> (if scorecard is {m.band})</span>}
                    {highest && <span style={{ ...tag('#dcfce7', GREEN), marginLeft: '6px' }}>{isLowerRule(best) ? 'Eligible (lower of FOIR & multiplier)' : 'Highest'}</span>}
                  </div>
                  {!isMult && <div style={{ fontSize: '11px', color: '#7a8194' }}>FOIR {result.foirPct}%</div>}
                  {multText && <div style={{ fontSize: '11px', color: ind ? MUTED : '#7a8194' }}>{multText}</div>}
                  {m.key === 'multiplier' && showOther && <div style={{ fontSize: '11px', color: MUTED }}>{other.band || otherKey}: {fmtINR(other.amount)}</div>}
                </td>
                <td style={{ ...td, ...num, fontSize: '13px', fontWeight: ind ? 400 : 700 }}>{fmtINR(m.amount)}</td>
                <td style={{ ...td, ...num, fontSize: '12px' }}>{m.roi != null ? `${m.roi}%` : '—'}</td>
                <td style={{ ...td, ...num, fontSize: '12px' }}>{m.tenure ? tenureLabel(m.tenure) : '—'}</td>
                <td style={{ ...td, ...num, fontSize: '12px', whiteSpace: 'normal' }}>
                  {m.netInHand > 0
                    ? <b style={{ color: ind ? MUTED : GREEN, fontSize: '13px', fontWeight: ind ? 400 : 700 }}>{fmtINR(m.netInHand)}</b>
                    : <span style={{ color: ind ? MUTED : RED, fontWeight: ind ? 400 : 600 }}>Not eligible on this method (BT POS {fmtINR(best.btOutstanding)} &gt; {fmtINR(m.amount)})</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Eligibility table for the best scenario, then the supporting tiles.
function ResultTiles({ result, netSalary }) {
  const best = result.best;
  const risk = result.risk;
  const btCount = best.bt.length;
  return (
    <>
      <EligibilityTable result={result} />
      <OtherIncomeTable otherIncome={result.otherIncome} netSalary={netSalary} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginTop: '12px' }}>
        <SItem label="Counted obligations" value={`${fmtINR(best.obligations)}/month`} />
        <SItem label={hasTopUp(best) ? 'BT + top-up POS' : 'BT POS'} value={fmtINR(best.btOutstanding)} sub={`${btCount} loan${btCount === 1 ? '' : 's'}`} />
        {hasMultiplier(best) && <SItem label="Risk" value={risk.band === 'better' ? 'Better band' : 'Lower band'} sub={risk.reason} />}
      </div>
    </>
  );
}

// "Close YES BANK, SBI CARD before login (₹3,98,000) → eligible ₹31.2L, +₹4.5L"
function CardPlanLine({ plan, cards }) {
  const names = plan.closeCards.map((id) => ((cards || []).find((c) => c.id === id) || {}).issuer || id).join(', ');
  return (
    <div style={{ marginTop: '10px', padding: '8px 12px', borderRadius: '8px', background: '#f0fdf4', color: '#166534', fontSize: '12px', fontWeight: 600 }}>
      Close {names} before login ({fmtINR(plan.closeAmount)})
      {plan.newEligible != null ? ` → eligible ${fmtL(plan.newEligible)}, +${fmtL(plan.gain)}` : ''}
      {plan.mustReflectInCibil ? ' — payment must reflect in CIBIL before login' : ''}
    </div>
  );
}

const chipText = (loan, id, topUp = false) => `${(loan && loan.lender) || id} · ${fmtL(loan ? loan.outstanding : 0)}${topUp ? ' (top-up)' : ''}`;
const hasTopUp = (scenario) => !!(scenario && Array.isArray(scenario.topUp) && scenario.topUp.length > 0);

// Pill for loans the selected bank's best scenario takes over: BT (green) or own-bank Top-up (purple).
const REASON_PILLS = {
  BT: { background: '#dcfce7', color: '#166534' },
  'Top-up': { background: '#ede9fe', color: '#5b21b6' },
};
function ReasonLine({ text }) {
  const p = REASON_PILLS[text];
  if (p) return <div style={{ marginTop: '2px' }}><span style={{ ...pill, ...p, fontSize: '10px', padding: '1px 8px' }}>{text}</span></div>;
  return <div style={{ fontSize: '11px', color: '#7a8194', whiteSpace: 'normal', lineHeight: 1.3 }}>{text}</div>;
}

function BtPlan({ best, lenderOf }) {
  return (
    <div style={{ marginTop: '14px' }}>
      <div style={{ ...lbl, marginBottom: '4px' }}>{hasTopUp(best) ? 'BT / top-up plan' : 'BT plan'}</div>
      {best.bt.length
        ? best.bt.map((id) => <span key={id} style={chip}>{chipText(lenderOf(id), id, isTopUp(best, id))}</span>)
        : <span style={{ fontSize: '12px', color: '#7a8194' }}>No BT — every loan stays as an obligation.</span>}
    </div>
  );
}

const CHIPS_IN_CELL = 3;
const TOP_OPTIONS = 5;

function OtherOptions({ scenarios, best, lenderOf }) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? scenarios : scenarios.slice(0, TOP_OPTIONS);
  // Same methods, same order as the eligibility table; each cell is "eligible / in hand".
  const methodCols = best.methods.map((m) => ({ key: m.key, label: m.label }));
  const cols = ['BT loans', 'BT outstanding', 'Counted obligations', ...methodCols.map((m) => m.label)];
  return (
    <div style={{ marginTop: '14px' }}>
      <button style={btnLink} onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} Other BT options ({scenarios.length})</button>
      {open && (
        <>
          <div style={{ overflowX: 'auto', marginTop: '8px' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '760px' }}>
              <thead><tr>{cols.map((h, i) => <th key={h} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((s, i) => (
                  <tr key={i} style={s === best ? { background: '#f0fdf4' } : undefined}>
                    <td style={td}>
                      <div style={{ maxWidth: '320px', lineHeight: 1.2 }}>
                        {s.bt.length === 0 && <span style={{ fontSize: '12px', color: '#7a8194' }}>None</span>}
                        {s.bt.slice(0, CHIPS_IN_CELL).map((id) => <span key={id} style={chip}>{chipText(lenderOf(id), id, isTopUp(s, id))}</span>)}
                        {s.bt.length > CHIPS_IN_CELL && <span style={{ fontSize: '11px', color: '#7a8194' }}>+{s.bt.length - CHIPS_IN_CELL} more</span>}
                        {s === best && <span style={{ ...pill, background: '#dcfce7', color: '#166534', marginLeft: '4px' }}>Best</span>}
                      </div>
                    </td>
                    <td style={{ ...td, ...num, fontSize: '12px' }}>{fmtINR(s.btOutstanding)}</td>
                    <td style={{ ...td, ...num, fontSize: '12px' }}>{fmtINR(s.obligations)}</td>
                    {methodCols.map(({ key }) => {
                      const m = s.methods.find((x) => x.key === key);
                      if (!m) return <td key={key} style={{ ...td, ...num }}>{dash}</td>;
                      const top = !m.indicative && key === s.eligibleBy && m.amount > 0;
                      return (
                        <td key={key} style={{ ...td, ...num, fontSize: '12px', fontWeight: top ? 700 : 400, ...(m.indicative ? { color: MUTED, fontStyle: 'italic' } : null) }}>
                          {fmtL(m.amount)} / <span style={{ color: m.indicative ? MUTED : m.netInHand > 0 ? GREEN : RED }}>{fmtL(m.netInHand)}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!showAll && scenarios.length > TOP_OPTIONS && (
            <button style={{ ...btnLink, marginTop: '8px' }} onClick={() => setShowAll(true)}>Show all {scenarios.length} options</button>
          )}
        </>
      )}
    </div>
  );
}
