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
import { IconSearch, IconScale } from '@tabler/icons-react';
import { evaluateBank } from '../utils/underwritingEngine';
import {
  buildProfileDraft, buildCibilRow, buildBsaRow, passwordErrorKind, normalizeMobile, averageNetPay, summarizeEmployer,
  extractEmployerName, treatmentChoice, treatmentPatch, loanStatus, hlJointPatch, hlPayerPatch,
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
  'settledLenders', 'dpdLenders', 'enquiries90d',
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
  const fresh = buildProfileDraft(cibil, bsa, { payslipNetPay: averageNetPay(sources.uploads.payslips) });
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
  if (changed === 'payslip') return { ...prev, netSalary: fresh.netSalary, netSalarySource: fresh.netSalarySource };
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

  const [companyQuery, setCompanyQuery] = useState('');
  const [companyByBank, setCompanyByBank] = useState(null); // { query, banks: { bankId: { candidates, pick, category, variantIdx } } }
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
    const picked = companyByBank && Object.values(companyByBank.banks).find((b) => b.pick?.match_type === 'exact');
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
    }]).select('id,full_name,mobile,company_name').single();
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

  const results = useMemo(() => {
    if (!draft) return [];
    // Every bank's own category (ICICI: Open Market / Preferred / …, HDFC: CAT A / …)
    // and which banks still need the banker-confirmed one picked.
    const categoriesByBank = {};
    const confirmedByBank = {};
    policies.forEach((p) => {
      const c = companyForBank(companyByBank, p.bank_id);
      if (!c) return;
      categoriesByBank[p.bank_id] = c.category;
      if (c.categoryConfirmed === false) confirmedByBank[p.bank_id] = false;
    });
    return policies.map((p) => {
      const label = p.policy?.bank || p.bank_id;
      const company = companyForBank(companyByBank, p.bank_id);
      const missing = [];
      if (!(draft.netSalary > 0)) missing.push('Enter the net monthly salary');
      if (!company) missing.push('Search the company to get its category');
      if (missing.length) return { bankId: p.bank_id, version: p.version, label, result: { status: 'NEEDS_INPUT', reasons: missing, warnings: [] } };
      try {
        // One bad policy must never blank the page: errors stay on that bank's card.
        const result = evaluateBank(p.policy, { ...draft, company: { ...company, categoriesByBank, confirmedByBank } });
        return { bankId: p.bank_id, version: p.version, label, result };
      } catch (e) {
        return { bankId: p.bank_id, version: p.version, label, error: e.message || String(e) };
      }
    });
  }, [draft, policies, companyByBank]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconScale size={22} strokeWidth={1.6} /> Underwriting Desk
          </h1>
          <p>Check bank-wise loan eligibility from CIBIL, banking and payslip.</p>
        </div>
      </div>
      <div className="page-body" style={{ maxWidth: '100%', overflowX: 'hidden' }}>
        <style>{UW_CSS}</style>
        {policyError && <div className="info-box info-box-red">Could not load bank policies: {policyError}</div>}

        <div className="uw-section-title">1. Customer &amp; documents</div>

        <div className="tabs" style={{ maxWidth: 360 }}>
          <button className={`tab ${mode === 'lead' ? 'active' : ''}`} onClick={() => mode !== 'lead' && resetAll('lead')}>Existing lead</button>
          <button className={`tab ${mode === 'new' ? 'active' : ''}`} onClick={() => mode !== 'new' && resetAll('new')}>New customer</button>
        </div>

        {mode === 'lead' && <LeadPicker lead={lead} onPick={onPickLead} />}
        {loadingLead && <div style={{ fontSize: 13, color: 'var(--text-muted)', margin: '10px 0' }}>Loading CIBIL and bank statement…</div>}
        {leadError && <div className="info-box info-box-red">Could not load lead data: {leadError}</div>}

        {(mode === 'new' || lead) && (
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

        {mode === 'new' && sources.uploads.cibil && (
          <SaveLeadPanel
            form={newLeadForm}
            setForm={setNewLeadForm}
            findExisting={findExistingLeads}
            onCreate={createLead}
            onAttach={attachDocsAndOpen}
          />
        )}

        {mode === 'lead' && !lead && (
          <div className="empty-state">
            <IconSearch size={36} strokeWidth={1.2} color="#CBD5E0" />
            <h3>Pick a lead to start</h3>
            <p>Their saved CIBIL report and bank statement analysis will pre-fill the profile. For a referral not in the CRM yet, use New customer.</p>
          </div>
        )}
        {mode === 'new' && !draft && (
          <div className="empty-state">
            <IconSearch size={36} strokeWidth={1.2} color="#CBD5E0" />
            <h3>Upload the customer's documents</h3>
            <p>Start with the CIBIL report — the bank statement and payslips are optional.</p>
          </div>
        )}

        {draft && !loadingLead && (
          <>
            <SourceNotes sources={sources} draft={draft} />
            <CompanyPanel
              query={companyQuery}
              setQuery={setCompanyQuery}
              byBank={companyByBank}
              setByBank={setCompanyByBank}
              policyBankIds={policies.map((p) => p.bank_id)}
              autoSearchKey={companyAutoKey}
              onManual={() => { if (companySourceRef.current !== 'manual') setCompanySource('manual'); }}
              payslipHint={payslipCompany}
              fromPayslip={companySource === 'payslip'}
            />
            <IncomePanel draft={draft} patchDraft={patchDraft} payslips={sources.uploads.payslips} />

            <div className="uw-section-title">2. Obligations</div>
            <ObligationsPanel draft={draft} patchDraft={patchDraft} results={results} bankId={tableBankId} setBankId={setTableBankId} />

            <div className="uw-section-title">3. Credit flags</div>
            <CreditPanel draft={draft} patchCredit={patchCredit} patchDraft={patchDraft} />

            <div className="uw-section-title">4. Bank results</div>
            {policies.length === 0 && !policyError && (
              <div className="info-box info-box-yellow">No active bank policies found.</div>
            )}
            {results.map((r) => <ResultCard key={r.bankId} entry={r} loans={draft.loans} />)}
          </>
        )}
      </div>
    </div>
  );
}

// Engine company object for one bank, or null when no company search has run yet.
function companyForBank(byBank, bankId) {
  if (!byBank) return null;
  const c = byBank.banks[bankId];
  if (!c || !c.pick) return { name: byBank.query, category: null, categoryConfirmed: true, incorporationYear: null };
  const variants = Array.isArray(c.pick.variants) && c.pick.variants.length ? c.pick.variants : null;
  if (variants && c.variantIdx == null) {
    return { name: c.pick.company_name, category: c.category, categoryConfirmed: false, incorporationYear: c.pick.incorporation_year };
  }
  const v = variants ? variants[c.variantIdx] : null;
  return {
    name: c.pick.company_name,
    category: c.category || null,
    categoryConfirmed: true,
    incorporationYear: (v ? v.incorporation_year : c.pick.incorporation_year) ?? null,
  };
}

// ---------------- Lead picker (same pattern as CibilParser "Link to Customer Profile") ----------------

function LeadPicker({ lead, onPick }) {
  const [search, setSearch] = useState('');
  const [leads, setLeads] = useState([]);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!search || search.length < 2) { setLeads([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('leads').select('id,full_name,mobile,company_name').ilike('full_name', `%${search}%`).limit(8);
      setLeads(data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div className="card" style={{ overflow: 'visible' }}>
      <div className="card-header"><h3>Customer</h3></div>
      <div className="card-body" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 420 }}>
          <input
            className="form-input"
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
      </div>
    </div>
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
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-header"><h3>Upload documents</h3></div>
      <div className="card-body">
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
      </div>
    </div>
  );
}

function UploadBox({ title, multiple, doc, onFiles, onRetry, children }) {
  const inputRef = useRef(null);
  const [pw, setPw] = useState('');
  return (
    <div style={S.uploadBox}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: 13 }}>{title}</strong>
        <button className="btn btn-outline btn-sm" onClick={() => inputRef.current && inputRef.current.click()} disabled={doc.busy}>
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
              className="form-input"
              type="password"
              style={S.cellInput}
              value={pw}
              autoFocus
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && pw) onRetry(pw); }}
            />
            <button className="btn btn-primary btn-sm" disabled={!pw || doc.busy} onClick={() => onRetry(pw)}>Unlock</button>
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
      <button className="btn btn-outline btn-sm" style={{ marginTop: 8 }} disabled={busy} onClick={() => setConfirming(true)}>
        Save to this lead
      </button>
    );
  }
  return (
    <div className="info-box info-box-yellow" style={{ marginTop: 8, fontSize: 12.5 }}>
      <div style={{ marginBottom: 6 }}>{confirmText}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => { setConfirming(false); onConfirm(); }}>
          {busy ? 'Saving…' : 'Confirm save'}
        </button>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
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
      <button className="btn btn-ghost btn-sm" onClick={onRemove} title="Remove">✕</button>
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
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-header"><h3>Save as lead</h3></div>
      <div className="card-body">
        <div style={S.grid3}>
          <div>
            <label style={S.label}>Name</label>
            <input className="form-input" value={form.full_name} onChange={set('full_name')} />
          </div>
          <div>
            <label style={S.label}>Mobile *</label>
            <input className="form-input" value={form.mobile} onChange={set('mobile')} placeholder="10-digit mobile" />
          </div>
          <div>
            <label style={S.label}>PAN</label>
            <input className="form-input" value={form.pan} onChange={set('pan')} />
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
                    <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(() => onAttach(m))}>Attach here</button>
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
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={() => setMatches(null)} disabled={busy}>Back</button>
          </div>
        )}
        {error && <div className="info-box info-box-red" style={{ marginTop: 12 }}>{error}</div>}

        {!matches && (
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save as lead'}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------- Company ----------------

// onManual: called on every agent action here (typing, searching, picking), so a
// later payslip match never replaces a company the agent chose. payslipHint:
// employer read from the payslip and how it matched the company list.
function CompanyPanel({ query, setQuery, byBank, setByBank, policyBankIds, autoSearchKey, onManual, payslipHint, fromPayslip }) {
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
      const exact = b.candidates.find((c) => c.match_type === 'exact');
      b.pick = exact || null;
      b.category = exact && !hasVariants(exact) ? exact.category : '';
      b.variantIdx = null;
    });
    setByBank({ query: term, banks });
  }, [setByBank]);

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
      if (!rpcError) { setSuggestions(data || []); setShowSug(true); }
    }, AUTOCOMPLETE_DEBOUNCE_MS);
  };

  const pickTerm = (name) => { onManual(); sugReqRef.current++; setQuery(name); setSuggestions([]); runSearch(name); };
  const searchTyped = () => { onManual(); sugReqRef.current++; runSearch(query); };

  const updateBank = (bankId, patch) => { onManual(); setByBank((s) => ({
    ...s, banks: { ...s.banks, [bankId]: { ...(s.banks[bankId] || { candidates: [] }), ...patch } },
  })); };

  const bankIds = byBank
    ? [...new Set([...policyBankIds, ...Object.keys(byBank.banks)])].sort((a, b) => policyBankIds.includes(b) - policyBankIds.includes(a))
    : [];

  return (
    <div className="card" style={{ overflow: 'visible', marginTop: 18 }}>
      <div className="card-header"><h3>Company</h3></div>
      <div className="card-body">
        <div style={{ position: 'relative', maxWidth: 520, display: 'flex', gap: 8 }}>
          <input
            className="form-input"
            placeholder="Company name, e.g. Infosys Limited"
            value={query}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') searchTyped(); }}
            onBlur={() => setTimeout(() => setShowSug(false), 150)}
            autoComplete="off"
          />
          <button className="btn btn-outline btn-sm" onClick={searchTyped} disabled={busy}>
            {busy ? 'Searching…' : 'Search'}
          </button>
          {showSug && suggestions.length > 0 && (
            <div style={S.dropdown}>
              {suggestions.map((s, i) => (
                <div
                  key={i}
                  style={S.option}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickTerm(s.company_name)}
                >
                  {s.company_name}
                </div>
              ))}
            </div>
          )}
        </div>
        {error && <div className="info-box info-box-red" style={{ marginTop: 10 }}>Company search failed: {error}</div>}
        {payslipHint && <PayslipCompanyHint hint={payslipHint} applied={fromPayslip} onPick={pickTerm} />}

        {byBank && (
          <div className="table-container" style={{ marginTop: 14 }}>
            <table>
              <thead>
                <tr><th>Bank</th><th>Matched company</th><th>Category (editable)</th></tr>
              </thead>
              <tbody>
                {bankIds.map((id) => {
                  const b = byBank.banks[id] || { candidates: [], pick: null, category: '' };
                  const isPolicyBank = policyBankIds.includes(id);
                  const variants = b.pick && hasVariants(b.pick) ? b.pick.variants : null;
                  return (
                    <tr key={id}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {id}{isPolicyBank && <span className="badge badge-blue" style={{ marginLeft: 6 }}>policy</span>}
                      </td>
                      <td>
                        {b.candidates.length === 0 && <span style={S.stat}>Not listed</span>}
                        {b.candidates.length > 0 && (
                          <select
                            className="form-input"
                            style={S.cellInput}
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
                      <td>
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
                            className="form-input"
                            style={S.cellInput}
                            value={b.category || ''}
                            placeholder={b.pick ? '' : 'Not listed'}
                            onChange={(e) => updateBank(id, { category: e.target.value, pick: b.pick || { company_name: byBank.query, category: e.target.value } })}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const hasVariants = (row) => Array.isArray(row.variants) && row.variants.length > 0;

// Source line under the company field for an employer read from the payslip.
function PayslipCompanyHint({ hint, applied, onPick }) {
  const raw = <strong>{hint.rawName}</strong>;
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
            <button key={name} className="btn btn-outline btn-sm" onClick={() => onPick(name)}>{name}</button>
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
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-header"><h3>Income</h3></div>
      <div className="card-body" style={S.grid2}>
        <div>
          <label style={S.label}>Net monthly salary (₹)</label>
          <input
            className="form-input"
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
          <label style={S.label}>Salary account bank</label>
          <input
            className="form-input"
            value={draft.salaryAccountBank || ''}
            onChange={(e) => patchDraft({ salaryAccountBank: e.target.value })}
            placeholder="e.g. HDFC Bank"
          />
          <div style={S.hint}>Some banks set a lower minimum salary when the salary is credited to their own account.</div>
        </div>
        <div>
          <label style={S.label}>CIBIL score</label>
          <input
            className="form-input"
            type="number"
            value={draft.cibilScore ?? ''}
            onChange={(e) => patchDraft({ cibilScore: numOrNull(e.target.value) })}
            placeholder="e.g. 760"
          />
          <div style={S.hint}>From the CIBIL report. Some banks set the interest rate by score band.</div>
        </div>
      </div>
    </div>
  );
}

// ---------------- Shared table / result styles ----------------

// Scoped to .uw-* so the CRM's global table styles (uppercase headers etc.)
// elsewhere are untouched. Media queries can't be inline, hence a <style> block.
const UW_CSS = `
.uw-section-title { font-size: 16px; font-weight: 700; color: #1A202C; margin: 32px 0 8px; }
.uw-section-title:first-of-type { margin-top: 24px; }
.uw-label { font-size: 12px; font-weight: 600; color: #4A5568; }
.uw-value { font-weight: 700; color: #1A202C; font-variant-numeric: tabular-nums; }
.uw-table-wrap { overflow-x: auto; max-width: 100%; border: 1px solid #E2E8F0; border-radius: 8px; background: #fff; }
.uw-table { width: 100%; border-collapse: collapse; font-size: 14px; color: #1A202C; }
.uw-table th { font-size: 13px; font-weight: 700; color: #4A5568; text-transform: none; letter-spacing: 0;
  text-align: left; padding: 8px; background: #F7FAFC; border-bottom: 1px solid #E2E8F0; white-space: nowrap; }
.uw-table td { padding: 4px 8px; height: 44px; border-bottom: 1px solid #EDF2F7; white-space: nowrap; vertical-align: middle; }
.uw-table tbody tr.uw-row:nth-of-type(even) td { background: #F7FAFC; }
.uw-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.uw-table tr.uw-group td, .uw-table tr.uw-total td { font-weight: 700; background: #EDF2F7; }
.uw-table tr.uw-best td { background: #F0FFF4 !important; }
.uw-wrap2 { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-width: 220px; line-height: 1.3; }
.uw-input { width: 100%; min-width: 72px; padding: 6px 8px; font-size: 14px; color: #1A202C; border: 1px solid #E2E8F0;
  border-radius: 6px; background: #fff; font-variant-numeric: tabular-nums; }
.uw-input.num { text-align: right; }
.uw-mini { display: flex; align-items: center; gap: 4px; font-size: 12px; color: #4A5568; margin-top: 4px; white-space: nowrap; cursor: pointer; }
.uw-pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 700; white-space: nowrap; }
.uw-chip { display: inline-block; padding: 2px 8px; margin: 2px 4px 2px 0; border-radius: 999px; background: #EDF2F7;
  color: #1A202C; font-size: 13px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.uw-card { background: #fff; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px 24px; margin-bottom: 16px; min-width: 0; }
.uw-strip { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px 32px; padding: 16px 0; border-top: 1px solid #EDF2F7; border-bottom: 1px solid #EDF2F7; }
.uw-figures { display: grid; gap: 16px; margin-top: 16px; }
.uw-figure { border: 1px solid #EDF2F7; border-radius: 8px; padding: 8px 16px; min-width: 0; }
.uw-link { background: none; border: none; padding: 0; color: var(--primary, #185FA5); font-weight: 600; font-size: 13px; cursor: pointer; }
@media (max-width: 900px) {
  .uw-figures { grid-template-columns: 1fr !important; }
  .uw-card { padding: 16px; }
}
`;

const TYPE_LABELS = {
  PL: 'PL', BL: 'BL', BL_SECURED: 'BL (secured)', CONSUMER: 'CD', HL: 'HL', GOLD: 'GOLD', OD: 'OD',
  KCC: 'KCC', AUTO: 'Auto', EDU: 'EDU', CARD_LOAN: 'Card loan', OTHER: 'Other',
};
const TREATMENTS = [['auto', 'Auto'], ['bt', 'BT'], ['obligate', 'Obligate'], ['closed', 'Closed before login (proof)']];
const LOAN_PILLS = {
  bt: { label: 'BT', background: '#C6F6D5', color: '#22543D' },
  obligated: { label: 'Obligated', background: '#E2E8F0', color: '#2D3748' },
  not_counted: { label: 'Not counted', background: '#F7FAFC', color: '#718096', border: '1px solid #E2E8F0' },
  closed: { label: 'Closed', background: '#BEE3F8', color: '#2A4365' },
};
const tenureLabel = (m) => (m % 12 === 0 ? `${m / 12} year${m === 12 ? '' : 's'}` : `${m} months`);
const shortTenure = (m) => (m % 12 === 0 ? `${m / 12}y` : `${m}m`);

// Rupee / count input: shows ₹1,25,159 (Indian grouping) when not being edited.
function NumInput({ value, onChange, money = true, placeholder, nullable = false, style }) {
  const [focused, setFocused] = useState(false);
  const hasValue = value !== null && value !== undefined && value !== '';
  const shown = focused
    ? (hasValue ? String(value) : '')
    : (hasValue ? `${money ? '₹' : ''}${Math.round(value).toLocaleString('en-IN')}` : '');
  return (
    <input
      className="uw-input num"
      inputMode="numeric"
      style={style}
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

// Lender name: up to two lines of text, click to edit.
function LenderCell({ value, onChange }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return <input className="uw-input" style={{ minWidth: 160 }} autoFocus value={value} onChange={(e) => onChange(e.target.value)} onBlur={() => setEditing(false)} />;
  }
  return (
    <div className="uw-wrap2" title="Click to edit" style={{ cursor: 'text', minWidth: 120 }} onClick={() => setEditing(true)}>
      {value || <span style={{ color: '#A0AEC0' }}>Add lender</span>}
    </div>
  );
}

function Pill({ kind }) {
  const p = LOAN_PILLS[kind];
  if (!p) return <span style={{ color: '#A0AEC0' }}>—</span>;
  return <span className="uw-pill" style={{ background: p.background, color: p.color, border: p.border }}>{p.label}</span>;
}

// ---------------- Obligations ----------------

// One table in the credit-team sheet format. Counted EMI / Status come from the
// selected bank's calculation (the engine applies that bank's policy rules).
function ObligationsPanel({ draft, patchDraft, results, bankId, setBankId }) {
  const setLoan = (i, patch) => patchDraft({ loans: draft.loans.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const setCard = (i, patch) => patchDraft({ cards: draft.cards.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const nextId = (prefix, list) => `${prefix}${Date.now().toString(36)}${list.length}`;

  const entry = results.find((r) => r.bankId === bankId) || results[0];
  const res = entry && entry.result;
  const lines = (res && res.obligations && res.obligations.loans) || [];
  const cardCalc = res && res.obligations && res.obligations.cards;
  const best = res && res.best;
  const lineOf = (id) => lines.find((l) => l.id === id);

  const loanTotal = (k) => draft.loans.reduce((s, l) => s + (Number(l[k]) || 0), 0);
  const cardOutstanding = draft.cards.reduce((s, c) => s + (Number(c.outstanding) || 0), 0);
  const countedLoans = lines.reduce((s, l) => s + l.obligation.amount, 0);
  const countedTotal = res && res.obligations ? countedLoans + (cardCalc ? cardCalc.amount : 0) : null;

  const addLoan = () => patchDraft({ loans: [...draft.loans, {
    id: nextId('M', draft.loans), lender: '', lenderType: null, productType: 'PL', loanAmount: 0, outstanding: 0, emi: 0,
    emisPaid: 0, emisRemaining: null, isJoint: false, coApplicantIncomeOk: null, treatment: 'auto', closedBeforeLoginWithProof: false,
  }] });
  const addCard = () => patchDraft({ cards: [...draft.cards, { id: nextId('K', draft.cards), issuer: '', outstanding: 0, paidBeforeLoginWithProof: 0 }] });

  return (
    <div className="uw-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <div className="uw-label">
          {results.length > 1 ? (
            <>
              Counted EMI and status for{' '}
              <select className="uw-input" style={{ width: 'auto', display: 'inline-block' }} value={entry ? entry.bankId : ''} onChange={(e) => setBankId(e.target.value)}>
                {results.map((r) => <option key={r.bankId} value={r.bankId}>{r.label}</option>)}
              </select>
            </>
          ) : entry ? `Counted EMI and status for ${entry.label}` : 'No bank policy loaded'}
          {entry && !(res && res.obligations) && (
            <span style={{ fontWeight: 400 }}> — appears once {entry.label} can be calculated (see its result below).</span>
          )}
        </div>
        <button className="btn btn-outline btn-sm" onClick={addLoan}>+ Add loan</button>
      </div>

      <div className="uw-table-wrap">
        <table className="uw-table">
          <thead>
            <tr>
              <th>Loan type</th><th>Financer</th><th className="num">Loan amount</th><th className="num">Outstanding</th>
              <th className="num">EMI</th><th className="num">EMIs paid</th><th className="num">EMIs left</th>
              <th>Treatment</th><th className="num">Counted EMI</th><th>Status</th><th aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {draft.loans.length === 0 && (
              <tr className="uw-row"><td colSpan={11} style={{ color: '#718096' }}>No open loans.</td></tr>
            )}
            {draft.loans.map((l, i) => {
              const line = lineOf(l.id);
              const choice = treatmentChoice(l);
              return (
                <tr key={l.id} className="uw-row">
                  <td title={l.sourceType || undefined}>
                    <select className="uw-input" style={{ minWidth: 96 }} value={l.productType} onChange={(e) => setLoan(i, { productType: e.target.value })}>
                      {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>)}
                    </select>
                  </td>
                  <td><LenderCell value={l.lender} onChange={(v) => setLoan(i, { lender: v })} /></td>
                  <td className="num"><NumInput value={l.loanAmount} onChange={(v) => setLoan(i, { loanAmount: v })} /></td>
                  <td className="num"><NumInput value={l.outstanding} onChange={(v) => setLoan(i, { outstanding: v })} /></td>
                  <td className="num">
                    <NumInput value={l.emi} onChange={(v) => setLoan(i, { emi: v })} />
                    {!l.emi && !['GOLD', 'OD', 'KCC'].includes(l.productType) && (
                      <div style={{ fontSize: 11, color: 'var(--warning)', textAlign: 'right' }}>EMI missing</div>
                    )}
                  </td>
                  <td className="num"><NumInput money={false} style={{ minWidth: 56 }} value={l.emisPaid} onChange={(v) => setLoan(i, { emisPaid: v })} /></td>
                  <td className="num"><NumInput money={false} nullable style={{ minWidth: 56 }} placeholder="?" value={l.emisRemaining} onChange={(v) => setLoan(i, { emisRemaining: v })} /></td>
                  <td>
                    <select className="uw-input" style={{ minWidth: 120 }} value={choice} onChange={(e) => setLoan(i, treatmentPatch(e.target.value))}>
                      {TREATMENTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                    </select>
                    {l.productType === 'HL' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <label className="uw-mini">
                          <input
                            type="checkbox"
                            checked={!!(l.isJoint && l.coApplicantIncomeOk)}
                            onChange={(e) => setLoan(i, hlJointPatch(e.target.checked))}
                          />
                          Joint · co-applicant income OK
                        </label>
                        <label className="uw-mini" style={{ opacity: l.isJoint ? 1 : 0.5, cursor: l.isJoint ? 'pointer' : 'not-allowed' }}>
                          EMI paid by
                          <select
                            className="uw-input"
                            style={{ width: 'auto', minWidth: 0, padding: '2px 4px', fontSize: 12 }}
                            disabled={!l.isJoint}
                            title={l.isJoint ? undefined : 'Tick Joint first'}
                            value={l.hlEmiPaidBy || ''}
                            onChange={(e) => setLoan(i, hlPayerPatch(e.target.value))}
                          >
                            <option value="">—</option>
                            <option value="applicant">Applicant</option>
                            <option value="co_applicant">Co-applicant</option>
                          </select>
                        </label>
                      </div>
                    )}
                  </td>
                  <td className="num" title={line ? line.obligation.rule : undefined} style={{ cursor: line ? 'help' : undefined }}>
                    {line ? fmtR(line.obligation.amount) : '—'}
                  </td>
                  <td><Pill kind={loanStatus(l, line, best)} /></td>
                  <td>
                    <button className="btn btn-ghost btn-sm" title="Remove loan" onClick={() => patchDraft({ loans: draft.loans.filter((_, j) => j !== i) })}>✕</button>
                  </td>
                </tr>
              );
            })}

            <tr className="uw-group">
              <td colSpan={3}>Credit cards</td>
              <td className="num">{fmtR(cardOutstanding)}</td>
              <td colSpan={4} style={{ fontWeight: 400, color: '#4A5568' }}>{cardCalc ? cardCalc.rule : ''}</td>
              <td className="num">{cardCalc ? fmtR(cardCalc.amount) : '—'}</td>
              <td colSpan={2}><button className="btn btn-outline btn-sm" onClick={addCard}>+ Add card</button></td>
            </tr>
            {draft.cards.map((c, i) => (
              <tr key={c.id} className="uw-row">
                <td style={{ color: '#4A5568' }}>Card</td>
                <td><LenderCell value={c.issuer} onChange={(v) => setCard(i, { issuer: v })} /></td>
                <td />
                <td className="num"><NumInput value={c.outstanding} onChange={(v) => setCard(i, { outstanding: v })} /></td>
                <td colSpan={3} />
                <td>
                  <div className="uw-label" style={{ fontSize: 11 }}>Paid before login (proof)</div>
                  <NumInput value={c.paidBeforeLoginWithProof} onChange={(v) => setCard(i, { paidBeforeLoginWithProof: v })} />
                </td>
                <td colSpan={2} />
                <td>
                  <button className="btn btn-ghost btn-sm" title="Remove card" onClick={() => patchDraft({ cards: draft.cards.filter((_, j) => j !== i) })}>✕</button>
                </td>
              </tr>
            ))}

            <tr className="uw-total">
              <td colSpan={2}>Total</td>
              <td className="num">{fmtR(loanTotal('loanAmount'))}</td>
              <td className="num">{fmtR(loanTotal('outstanding') + cardOutstanding)}</td>
              <td className="num">{fmtR(loanTotal('emi'))}</td>
              <td colSpan={3} />
              <td className="num">{countedTotal == null ? '—' : fmtR(countedTotal)}</td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ ...S.hint, marginTop: 8 }}>
        Treatment: Auto lets the bank policy decide; BT always takes the loan over when the bank allows it; Obligate keeps it as an obligation.
        Hover a Counted EMI to see the rule applied.
      </div>
    </div>
  );
}

function NumCell({ value, onChange, placeholder }) {
  return (
    <input
      className="form-input"
      type="number"
      style={S.cellInput}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(numOrNull(e.target.value))}
    />
  );
}

// ---------------- Credit flags + risk ----------------

// One-line summary of the flags; "Edit" opens the full form.
function creditSummary(draft) {
  const c = draft.credit || {};
  const items = [];
  if (c.bouncesLast12m > 0) items.push(`${c.bouncesLast12m} bounce${c.bouncesLast12m > 1 ? 's' : ''} in 12 months${c.bouncesOnlyCardOrGold ? ' (card / gold only)' : ''}`);
  if (c.overdueLast12m) items.push('Overdue in 12 months');
  if (c.settlementsOrWO > 0) {
    const f = c.freshLoanAfterSettlement || {};
    items.push(`${c.settlementsOrWO} settled / written-off${f.exists ? ` · fresh loan ${f.emisPaid || 0} EMIs paid` : ' · no fresh loan after'}`);
  }
  if (c.hdfcSettlementOrWO) items.push('HDFC settlement / write-off');
  if (c.hdfcBadHistory) items.push('HDFC DPD history');
  if (c.dpdAcrossAllTrades) items.push('DPD across all accounts');
  const risk = draft.riskOverride ? `Risk band: ${draft.riskOverride === 'better' ? 'Better' : 'Lower'} (override)` : 'Risk band: Auto';
  // Enquiry limits differ per bank (the result cards say if it's over), so the count is shown neutrally.
  const enquiries = c.enquiries90d == null ? 'Enquiries (90 days): not known' : `${c.enquiries90d} enquiries in 90 days`;
  return { text: items.length ? items.join(' · ') : 'No adverse flags', adverse: items.length > 0, risk, enquiries };
}

function CreditPanel({ draft, patchCredit, patchDraft }) {
  const [open, setOpen] = useState(false);
  const c = draft.credit;
  const fresh = c.freshLoanAfterSettlement || { exists: false, emisPaid: 0 };
  const summary = creditSummary(draft);
  const flag = (k, label) => (
    <label style={S.check}>
      <input type="checkbox" checked={!!c[k]} onChange={(e) => patchCredit({ [k]: e.target.checked })} /> {label}
    </label>
  );
  return (
    <div className="uw-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <div style={{ fontSize: 14, minWidth: 0 }}>
          <span style={{ fontWeight: 700, color: summary.adverse ? '#C53030' : '#1A202C' }}>{summary.text}</span>
          <span style={{ color: '#4A5568' }}> · {summary.enquiries} · {summary.risk}</span>
        </div>
        <button className="uw-link" onClick={() => setOpen(!open)}>{open ? 'Done' : 'Edit'}</button>
      </div>
      {open && (
        <div style={{ marginTop: 16 }}>
          <div style={S.grid2}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {flag('hdfcSettlementOrWO', 'Settlement / write-off with HDFC')}
              {flag('hdfcBadHistory', 'Bad repayment history with HDFC (DPD)')}
              {flag('dpdAcrossAllTrades', 'DPD across all accounts')}
              {flag('overdueLast12m', 'Overdue / DPD in last 12 months')}
              {flag('bouncesOnlyCardOrGold', 'Bounces only on card / gold loan')}
              <div style={S.hint}>
                Settled / written-off with: {(c.settledLenders || []).join(', ') || 'none'}<br />
                DPD reported by: {(c.dpdLenders || []).join(', ') || 'none'}<br />
                From CIBIL — each bank checks these against its own name.
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                <label style={S.label}>CIBIL enquiries in last 90 days</label>
                <NumCell value={c.enquiries90d} placeholder="Not known" onChange={(v) => patchCredit({ enquiries90d: v })} />
              </div>
              <div>
                <label style={S.label}>Settled / written-off accounts</label>
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
                <div style={{ maxWidth: 120, marginTop: 4 }}>
                  <NumCell value={fresh.emisPaid} onChange={(v) => patchCredit({ freshLoanAfterSettlement: { ...fresh, emisPaid: v ?? 0 } })} />
                </div>
              </div>
              <div>
                <label style={S.label}>Bounces / ECS returns in last 12 months</label>
                <NumCell value={c.bouncesLast12m} onChange={(v) => patchCredit({ bouncesLast12m: v ?? 0 })} />
              </div>
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <label style={S.label}>Risk band</label>
            <div className="tabs" style={{ maxWidth: 320, marginBottom: 0 }}>
              {[[null, 'Auto'], ['better', 'Better'], ['lower', 'Lower']].map(([v, label]) => (
                <button key={label} className={`tab ${draft.riskOverride === v ? 'active' : ''}`} onClick={() => patchDraft({ riskOverride: v })}>
                  {label}
                </button>
              ))}
            </div>
            <div style={S.hint}>Auto = indicated from bounces / overdue in the last 12 months.</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Results ----------------

const STATUS = {
  ELIGIBLE: { label: 'Eligible', background: '#C6F6D5', color: '#22543D' },
  NOT_ELIGIBLE: { label: 'Not eligible', background: '#FED7D7', color: '#822727' },
  NEEDS_INPUT: { label: 'Needs input', background: '#FEFCBF', color: '#744210' },
  DEVIATION: { label: 'Eligible with deviation', background: '#FEEBC8', color: '#7B341E' },
};

// Banks without a multiplier grid (e.g. ICICI) return an empty best.multiplier.
const hasMultiplier = (best) => !!best && Object.values(best.multiplier || {}).some(Boolean);

const riskText = (risk) => {
  const band = risk.band === 'better' ? 'Better band' : 'Lower band';
  if (risk.reason === 'Agent override') return `${band} — agent override`;
  return risk.band === 'better' ? `${band} — no bounces in 12 months` : `${band} — chance`;
};

// The CC paydown suggestion is the most actionable warning, so it goes first.
const orderWarnings = (ws) => [...ws].sort((a, b) => (/on cards before login/i.test(b) ? 1 : 0) - (/on cards before login/i.test(a) ? 1 : 0));

function ResultCard({ entry, loans }) {
  const { label, result, error } = entry;
  const st = result ? STATUS[result.status] || STATUS.NEEDS_INPUT : null;
  const lenderOf = (id) => loans.find((l) => l.id === id);
  const showStrip = !!(result && result.best && ['ELIGIBLE', 'DEVIATION'].includes(result.status));

  return (
    <div className="uw-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1A202C' }}>{label}</div>
        {st && <span className="uw-pill" style={{ background: st.background, color: st.color }}>{st.label}</span>}
        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#718096' }}>
          {result && result.policyVersion ? `Policy ${result.policyVersion}` : entry.version ? `Policy ${entry.version}` : ''}
        </div>
      </div>

      {error && (
        <div className="info-box info-box-red" style={{ marginTop: 8 }}>
          <strong>Couldn't evaluate — policy error.</strong> {error}
        </div>
      )}

      {result && result.reasons.length > 0 && (
        <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 14, color: result.status === 'NOT_ELIGIBLE' ? '#C53030' : '#744210' }}>
          {result.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}

      {result && !showStrip && <Deviations items={result.deviations} />}

      {showStrip && (
        <>
          <DecisionStrip best={result.best} risk={result.risk} />
          <Deviations items={result.deviations} />
          <Figures best={result.best} risk={result.risk} foirPct={result.foirPct} />
          <BtPlan best={result.best} lenderOf={lenderOf} />
        </>
      )}

      {result && result.warnings.length > 0 && (
        <ul style={{ margin: '16px 0 0', paddingLeft: 20, fontSize: 14, color: '#975A16' }}>
          {orderWarnings(result.warnings).map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}

      {result && result.scenarios && result.scenarios.length > 0 && (
        <OtherOptions scenarios={result.scenarios} best={result.best} band={result.risk.band} lenderOf={lenderOf} />
      )}
    </div>
  );
}

// Which method / tenure / ROI produced the eligible amount: the engine takes the
// lower of FOIR (first tenure) and the indicated multiplier, and reports
// limitedBy + conservativeRoi (the rate slab for that final amount).
function bindingTerms(best, risk) {
  const t0 = Object.keys(best.foir).map(Number)[0];
  const mult = best.multiplier && best.multiplier[risk.band];
  const byMultiplier = best.limitedBy === 'multiplier';
  return {
    tenure: byMultiplier && mult ? mult.tenure : t0,
    roi: best.conservativeRoi ?? best.foir[t0].roi,
    byMultiplier,
  };
}

// Policy deviations the bank may approve (e.g. too many enquiries), in amber.
function Deviations({ items }) {
  if (!items || !items.length) return null;
  return (
    <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 14, color: '#975A16', fontWeight: 600 }}>
      {items.map((d, i) => <li key={i}>{d}</li>)}
    </ul>
  );
}

function DecisionStrip({ best, risk }) {
  const { tenure, roi, byMultiplier } = bindingTerms(best, risk);
  const limitText = !hasMultiplier(best) ? 'FOIR only' : byMultiplier ? 'Limited by multiplier' : 'Limited by FOIR';
  const item = (labelText, value, extra) => (
    <div>
      <div className="uw-label">{labelText}</div>
      <div className="uw-value" style={{ fontSize: 16, ...extra }}>{value}</div>
    </div>
  );
  return (
    <div className="uw-strip" style={{ marginTop: 16 }}>
      <div>
        <div className="uw-label">Eligible amount</div>
        <div className="uw-value" style={{ fontSize: 30, lineHeight: 1.1 }}>{fmtL(best.conservativeAmount)}</div>
        <div style={{ fontSize: 12, color: '#718096' }}>{limitText}</div>
      </div>
      {item('Net in hand', fmtL(best.netInHand), { color: best.netInHand > 0 ? '#22543D' : '#1A202C' })}
      {item('ROI', roi != null ? (
        <>
          {roi}%
          {best.roiAssumed && (
            <span className="uw-pill" style={{ background: '#FEFCBF', color: '#744210', marginLeft: 4, fontSize: 11 }} title="The bank has no rate for this amount; highest known rate used">
              assumed
            </span>
          )}
        </>
      ) : '—')}
      {item('Tenure', tenureLabel(tenure))}
      {item('Risk', riskText(risk), { fontSize: 14, fontWeight: 600 })}
    </div>
  );
}

function Figures({ best, risk, foirPct }) {
  const tenures = Object.keys(best.foir).map(Number);
  const indicated = best.multiplier && best.multiplier[risk.band];
  const otherKey = risk.band === 'better' ? 'lower' : 'better';
  const other = best.multiplier && best.multiplier[otherKey];
  const sameBand = indicated && other && indicated.band === other.band && indicated.multiplier === other.multiplier;
  const showMultiplier = hasMultiplier(best);
  return (
    <div className="uw-figures" style={{ gridTemplateColumns: `repeat(${tenures.length + (showMultiplier ? 1 : 0)}, minmax(0, 1fr))` }}>
      {tenures.map((t) => (
        <div key={t} className="uw-figure">
          <div className="uw-label">FOIR {tenureLabel(t)}</div>
          <div className="uw-value" style={{ fontSize: 20 }}>{fmtL(best.foir[t].amount)}</div>
          <div style={{ fontSize: 12, color: '#4A5568' }}>
            {best.foir[t].roi != null ? `@ ${best.foir[t].roi}% · ` : ''}FOIR {foirPct}% · EMI room {fmtR(best.emiRoom)}
          </div>
        </div>
      ))}
      {showMultiplier && (
      <div className="uw-figure">
        <div className="uw-label">Multiplier</div>
        {indicated ? (
          <>
            <div className="uw-value" style={{ fontSize: 20 }}>{fmtL(indicated.amount)}</div>
            <div style={{ fontSize: 12, color: '#4A5568' }}>
              {indicated.band || risk.band} · ×{indicated.multiplier} · {indicated.tenure}M (indicated)
            </div>
            {other && !sameBand && (
              <div style={{ fontSize: 12, color: '#718096', marginTop: 4 }}>
                {other.band || otherKey}: {fmtL(other.amount)} · ×{other.multiplier}
              </div>
            )}
          </>
        ) : <div style={{ fontSize: 13, color: '#718096' }}>No multiplier for this category / salary</div>}
      </div>
      )}
    </div>
  );
}

const chipText = (loan, id) => `${(loan && loan.lender) || id} · ${fmtL(loan ? loan.outstanding : 0)}`;

function BtPlan({ best, lenderOf }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div className="uw-label" style={{ marginBottom: 4 }}>
        BT plan{best.bt.length ? ` — ${fmtL(best.btOutstanding)} paid off from the new loan` : ''}
      </div>
      {best.bt.length
        ? best.bt.map((id) => <span key={id} className="uw-chip">{chipText(lenderOf(id), id)}</span>)
        : <span style={{ fontSize: 14, color: '#4A5568' }}>No BT — every loan stays as an obligation.</span>}
    </div>
  );
}

const CHIPS_IN_CELL = 3;
const TOP_OPTIONS = 5;

function OtherOptions({ scenarios, best, band, lenderOf }) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const tenures = Object.keys(best.foir).map(Number);
  const rows = showAll ? scenarios : scenarios.slice(0, TOP_OPTIONS);
  const withMultiplier = hasMultiplier(best);
  return (
    <div style={{ marginTop: 16 }}>
      <button className="uw-link" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} Other BT options ({scenarios.length})
      </button>
      {open && (
        <>
          <div className="uw-table-wrap" style={{ marginTop: 8 }}>
            <table className="uw-table">
              <thead>
                <tr>
                  <th>BT loans</th><th className="num">BT outstanding</th><th className="num">Counted obligations</th>
                  {tenures.map((t) => <th key={t} className="num">FOIR {shortTenure(t)}</th>)}
                  {withMultiplier && <th className="num">Multiplier</th>}<th className="num">Net in hand</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s, i) => (
                  <tr key={i} className={`uw-row${s === best ? ' uw-best' : ''}`}>
                    <td>
                      <div style={{ whiteSpace: 'normal', maxWidth: 320, lineHeight: 1.2 }}>
                        {s.bt.length === 0 && <span style={{ color: '#4A5568' }}>None</span>}
                        {s.bt.slice(0, CHIPS_IN_CELL).map((id) => <span key={id} className="uw-chip">{chipText(lenderOf(id), id)}</span>)}
                        {s.bt.length > CHIPS_IN_CELL && <span style={{ fontSize: 12, color: '#4A5568' }}>+{s.bt.length - CHIPS_IN_CELL} more</span>}
                        {s === best && <span className="uw-pill" style={{ background: '#C6F6D5', color: '#22543D', marginLeft: 4 }}>Best</span>}
                      </div>
                    </td>
                    <td className="num">{fmtL(s.btOutstanding)}</td>
                    <td className="num">{fmtR(s.obligations)}</td>
                    {tenures.map((t) => <td key={t} className="num">{fmtL(s.foir[t].amount)}</td>)}
                    {withMultiplier && <td className="num">{fmtL(s.multiplier[band] && s.multiplier[band].amount)}</td>}
                    <td className="num" style={{ fontWeight: 700 }}>{fmtL(s.netInHand)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!showAll && scenarios.length > TOP_OPTIONS && (
            <button className="uw-link" style={{ marginTop: 8 }} onClick={() => setShowAll(true)}>Show all {scenarios.length} options</button>
          )}
        </>
      )}
    </div>
  );
}
