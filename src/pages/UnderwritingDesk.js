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
  btnPri, btnSec, btnPriSm, btnSecSm, btnLink, SItem, NotEligibleTile,
} from '../utils/uiStyles';
import {
  buildProfileDraft, buildCibilRow, buildBsaRow, passwordErrorKind, normalizeMobile, averageNetPay, summarizeEmployer,
  extractEmployerName, treatmentChoice, treatmentPatch, loanReason, hlJointPatch, hlPayerPatch,
  cardActionPatch, cardOutstandingPatch, cardCountedShare, isZeroBalanceLoan, loanNeedsEmi,
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
  'settledLenders', 'dpdLenders', 'dpdAccounts', 'enquiries90d',
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
  const saveLeadRef = useRef(null); // header "Save as lead" scrolls here

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
          </>
        )}
      </div>

      {draft && !loadingLead && (
        <>
          <ObligationsPanel draft={draft} patchDraft={patchDraft} results={results} bankId={tableBankId} setBankId={setTableBankId} />
          <CreditPanel draft={draft} patchCredit={patchCredit} patchDraft={patchDraft} />
          {policies.length === 0 && !policyError && (
            <div className="info-box info-box-yellow">No active bank policies found.</div>
          )}
          {results.map((r) => <ResultCard key={r.bankId} entry={r} loans={draft.loans} cards={draft.cards} />)}
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
          <div style={{ overflowX: 'auto', marginTop: 14 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '640px' }}>
              <thead>
                <tr><th style={th}>Bank</th><th style={th}>Matched company</th><th style={th}>Category (editable)</th></tr>
              </thead>
              <tbody>
                {bankIds.map((id) => {
                  const b = byBank.banks[id] || { candidates: [], pick: null, category: '' };
                  const isPolicyBank = policyBankIds.includes(id);
                  const variants = b.pick && hasVariants(b.pick) ? b.pick.variants : null;
                  return (
                    <tr key={id}>
                      <td style={{ ...td, whiteSpace: 'nowrap', fontSize: '12px' }}>
                        {id}{isPolicyBank && <span className="badge badge-blue" style={{ marginLeft: 6 }}>policy</span>}
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
    </Sub>
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
          <div style={S.hint}>From the CIBIL report. Some banks set the interest rate by score band.</div>
        </div>
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
const shortTenure = (m) => (m % 12 === 0 ? `${m / 12}y` : `${m}m`);
const num = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const dash = <span style={{ fontSize: '12px', color: '#bcc3d2' }}>—</span>;
const btnGhostSm = { ...btnLink, color: '#9aa1b2', fontSize: '13px', padding: '4px 6px' };

// Fits a 1366px screen with the sidebar open (no sideways scroll): the reason
// sits under Counted EMI and the HL controls under Treatment instead of their own columns.
const OBL_COLS = [
  ['Financier', 150], ['Open date', 92], ['Type', 84], ['Loan amt', 92], ['Outstanding', 100], ['EMI', 90],
  ['Paid', 52], ['Left', 52], ['Treatment', 128], ['Counted EMI', 150], ['', 28],
];
const RIGHT_COLS = new Set(['Loan amt', 'Outstanding', 'EMI', 'Paid', 'Left', 'Counted EMI']);
const OBL_MIN_WIDTH = OBL_COLS.reduce((s, [, w]) => s + w, 0);
const RED = '#dc2626';

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

// Counted EMI / reason come from the selected bank's calculation (its policy rules).
function ObligationsPanel({ draft, patchDraft, results, bankId, setBankId }) {
  const [showZero, setShowZero] = useState(false);
  const setLoanById = (id, patch) => patchDraft({ loans: draft.loans.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const removeLoan = (id) => patchDraft({ loans: draft.loans.filter((l) => l.id !== id) });
  const nextId = (prefix, list) => `${prefix}${Date.now().toString(36)}${list.length}`;

  const entry = results.find((r) => r.bankId === bankId) || results[0];
  const res = entry && entry.result;
  const lines = (res && res.obligations && res.obligations.loans) || [];
  const cardCalc = res && res.obligations && res.obligations.cards;
  const best = res && res.best;
  const lineOf = (id) => lines.find((l) => l.id === id);

  const activeLoans = draft.loans.filter((l) => !isZeroBalanceLoan(l));
  const zeroLoans = draft.loans.filter(isZeroBalanceLoan);
  const loanTotal = (k) => draft.loans.reduce((s, l) => s + (Number(l[k]) || 0), 0);
  const countedLoans = res && res.obligations ? lines.reduce((s, l) => s + l.obligation.amount, 0) : null;

  const addLoan = () => patchDraft({ loans: [...draft.loans, {
    id: nextId('M', draft.loans), manual: true, lender: '', lenderType: null, productType: 'PL', openDate: '', loanAmount: 0, outstanding: 0, emi: 0,
    emisPaid: 0, emisRemaining: null, isJoint: false, coApplicantIncomeOk: null, hlEmiPaidBy: null, treatment: 'auto', closedBeforeLoginWithProof: false,
  }] });

  const loanRow = (l, muted) => {
    const line = lineOf(l.id);
    const isHL = l.productType === 'HL';
    const needsEmi = loanNeedsEmi(l);
    return (
      <tr key={l.id} style={muted ? { background: '#fafbfe', color: '#9aa1b2' } : undefined}>
        <td style={td}><input style={cellInp} value={l.lender} onChange={(e) => setLoanById(l.id, { lender: e.target.value })} placeholder="Bank" title={l.lender} /></td>
        <td style={td}><input style={cellInp} value={l.openDate || ''} onChange={(e) => setLoanById(l.id, { openDate: e.target.value })} placeholder="dd/mm/yyyy" /></td>
        <td style={td} title={l.sourceType || undefined}>
          <select style={cellSel} value={l.productType} onChange={(e) => setLoanById(l.id, { productType: e.target.value })}>
            {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>)}
          </select>
        </td>
        <td style={td}><NumInput value={l.loanAmount} onChange={(v) => setLoanById(l.id, { loanAmount: v })} /></td>
        <td style={td}><NumInput value={l.outstanding} onChange={(v) => setLoanById(l.id, { outstanding: v })} /></td>
        <td style={td}>
          <NumInput value={l.emi} invalid={needsEmi} onChange={(v) => setLoanById(l.id, { emi: v })} />
          {needsEmi && <div style={{ fontSize: '10px', color: RED, textAlign: 'right', fontWeight: 600 }}>Enter EMI</div>}
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
        </td>
        <td style={{ ...td, ...num }}>
          <div style={{ fontWeight: 700, fontSize: '12px' }}>{line ? fmt(line.obligation.amount) : '—'}</div>
          <div style={{ fontSize: '11px', color: '#7a8194', whiteSpace: 'normal', lineHeight: 1.3 }}>{loanReason(l, line, best)}</div>
        </td>
        <td style={td}>
          <button style={btnGhostSm} title="Remove row" onClick={() => removeLoan(l.id)}>✕</button>
        </td>
      </tr>
    );
  };

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
        <h3 style={{ ...cardHeader, margin: 0 }}>Obligations</h3>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {results.length > 1 && (
            <label style={{ ...lbl, display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}>
              Counted for
              <select style={{ ...cellSel, width: 'auto' }} value={entry ? entry.bankId : ''} onChange={(e) => setBankId(e.target.value)}>
                {results.map((r) => <option key={r.bankId} value={r.bankId}>{r.label}</option>)}
              </select>
            </label>
          )}
          <button style={btnSec} onClick={addLoan}>+ Add row</button>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: `${OBL_MIN_WIDTH}px`, tableLayout: 'fixed' }}>
          <colgroup>{OBL_COLS.map(([, w], i) => <col key={i} style={{ width: w + 'px' }} />)}</colgroup>
          <thead><tr>{OBL_COLS.map(([h], i) => <th key={i} style={{ ...th, textAlign: RIGHT_COLS.has(h) ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
          <tbody>
            {activeLoans.length === 0 && (
              <tr><td colSpan={OBL_COLS.length} style={{ ...td, fontSize: '12px', color: '#7a8194' }}>No open loans.</td></tr>
            )}
            {activeLoans.map((l) => loanRow(l, false))}

            {zeroLoans.length > 0 && (
              <tr style={{ background: '#f7f9fc', cursor: 'pointer' }} onClick={() => setShowZero(!showZero)}>
                <td style={{ ...td, fontSize: '12px', color: '#7a8194' }} colSpan={OBL_COLS.length}>
                  Zero-balance accounts ({zeroLoans.length}) — not counted {showZero ? '▾' : '▸'}
                </td>
              </tr>
            )}
            {showZero && zeroLoans.map((l) => loanRow(l, true))}

            <tr style={{ background: '#f0f4fa' }}>
              <td style={{ ...td, fontWeight: 700, fontSize: '12px' }} colSpan={3}>Total loans</td>
              <td style={{ ...td, ...num, fontWeight: 700, fontSize: '12px' }}>{fmt(loanTotal('loanAmount'))}</td>
              <td style={{ ...td, ...num, fontWeight: 700, fontSize: '12px' }}>{fmt(loanTotal('outstanding'))}</td>
              <td style={{ ...td, ...num, fontWeight: 700, fontSize: '12px' }}>{fmt(loanTotal('emi'))}</td>
              <td style={td} colSpan={3} />
              <td style={{ ...td, ...num, fontWeight: 700, fontSize: '12px' }}>{countedLoans == null ? '—' : fmt(countedLoans)}</td>
              <td style={td} />
            </tr>
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: '11px', color: '#9aa1b2', margin: '12px 0 0' }}>
        {entry ? (
          res && res.obligations
            ? <>Counted EMI follows <b>{entry.label}</b>&apos;s policy. </>
            : <>Counted EMI appears once <b>{entry.label}</b> can be calculated (see its card below). </>
        ) : null}
        Treatment: <b>Auto</b> lets the bank decide; <b>BT</b> always takes the loan over when the bank allows it; <b>Obligate</b> keeps it as an obligation.
      </p>

      <CardsSection draft={draft} patchDraft={patchDraft} entry={entry} cardCalc={cardCalc} cardPlan={res && res.cardPlan} />
    </div>
  );
}

const CARD_ACTIONS = [['keep', 'Keep open'], ['paid', 'Paid before login (proof)'], ['close', 'Close before login (suggested)']];
const CARD_COLS = [['Card', 170], ['Outstanding', 110], ['Action', 200], ['Amount paid', 120], ['Counted', 110], ['Note', 220], ['', 28]];
const tag = (background, color) => ({ display: 'inline-block', padding: '1px 8px', borderRadius: '999px', fontSize: '10px', fontWeight: 700, background, color, whiteSpace: 'nowrap', marginRight: '4px' });

function CardsSection({ draft, patchDraft, entry, cardCalc, cardPlan }) {
  const setCard = (id, patch) => patchDraft({ cards: draft.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const addCard = () => patchDraft({
    cards: [...draft.cards, { id: `K${Date.now().toString(36)}${draft.cards.length}`, issuer: '', outstanding: 0, paidBeforeLoginWithProof: 0, action: 'keep' }],
  });
  const lineOf = (id) => ((cardCalc && cardCalc.lines) || []).find((l) => l.id === id);
  const suggested = new Set((cardPlan && cardPlan.closeCards) || []);
  const pendingSuggestion = cardPlan && cardPlan.closeCards.some((id) => {
    const c = draft.cards.find((x) => x.id === id);
    return c && c.action !== 'close';
  });
  const applySuggestion = () => patchDraft({
    cards: draft.cards.map((c) => (suggested.has(c.id) ? { ...c, ...cardActionPatch(c, 'close') } : c)),
  });
  const totalOutstanding = draft.cards.reduce((s, c) => s + (Number(c.outstanding) || 0), 0);

  return (
    <div style={{ marginTop: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#333' }}>Credit cards</div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {pendingSuggestion && (
            <button style={{ ...btnSecSm, color: '#166534', borderColor: '#bbf7d0', background: '#f0fdf4' }} onClick={applySuggestion}>
              Apply suggestion — close {cardPlan.closeCards.length} card{cardPlan.closeCards.length === 1 ? '' : 's'} ({fmtINR(cardPlan.closeAmount)})
              {cardPlan.newEligible != null ? ` → eligible ${fmtINR(cardPlan.newEligible)} (+${fmtINR(cardPlan.gain)})` : ''}
            </button>
          )}
          <button style={btnSecSm} onClick={addCard}>+ Add card</button>
        </div>
      </div>
      {draft.cards.length === 0 ? (
        <div style={{ fontSize: '12px', color: '#7a8194' }}>No open credit cards.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: `${CARD_COLS.reduce((s, [, w]) => s + w, 0)}px`, tableLayout: 'fixed' }}>
            <colgroup>{CARD_COLS.map(([, w], i) => <col key={i} style={{ width: w + 'px' }} />)}</colgroup>
            <thead>
              <tr>{CARD_COLS.map(([h], i) => <th key={i} style={{ ...th, textAlign: ['Outstanding', 'Amount paid', 'Counted'].includes(h) ? 'right' : 'left' }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {draft.cards.map((c) => {
                const action = c.action || (c.paidBeforeLoginWithProof > 0 ? 'paid' : 'keep');
                const line = lineOf(c.id);
                const share = cardCountedShare(cardCalc, c.id);
                return (
                  <tr key={c.id}>
                    <td style={td}><input style={cellInp} value={c.issuer} onChange={(e) => setCard(c.id, { issuer: e.target.value })} placeholder="Card issuer" title={c.issuer} /></td>
                    <td style={td}><NumInput value={c.outstanding} onChange={(v) => setCard(c.id, cardOutstandingPatch(c, v))} /></td>
                    <td style={td}>
                      <select style={cellSel} value={action} onChange={(e) => setCard(c.id, cardActionPatch(c, e.target.value))}>
                        {CARD_ACTIONS.map(([v, labelText]) => <option key={v} value={v}>{labelText}</option>)}
                      </select>
                    </td>
                    <td style={td}>
                      {action === 'paid' && <NumInput value={c.paidBeforeLoginWithProof} onChange={(v) => setCard(c.id, { paidBeforeLoginWithProof: v })} />}
                      {action === 'close' && <div style={{ ...num, fontSize: '12px' }}>{fmt(c.outstanding)} <span style={{ fontSize: '10px', color: '#7a8194' }}>planned</span></div>}
                      {action === 'keep' && dash}
                    </td>
                    <td style={{ ...td, ...num, fontSize: '12px', fontWeight: 700 }}>
                      {!cardCalc ? '—' : share == null ? <span style={{ fontWeight: 400, color: '#7a8194' }}>Not counted</span> : fmt(share)}
                    </td>
                    <td style={{ ...td, fontSize: '11px', whiteSpace: 'normal', lineHeight: 1.5 }}>
                      {suggested.has(c.id) && <span style={tag('#dcfce7', '#166534')}>Suggested: close</span>}
                      {line && !line.paydownAccepted && <span style={{ color: '#b45309', fontWeight: 600 }}>Must reflect in CIBIL before login</span>}
                    </td>
                    <td style={td}>
                      <button style={btnGhostSm} title="Remove card" onClick={() => patchDraft({ cards: draft.cards.filter((x) => x.id !== c.id) })}>✕</button>
                    </td>
                  </tr>
                );
              })}
              <tr style={{ background: '#f0f4fa' }}>
                <td style={{ ...td, fontWeight: 700, fontSize: '12px' }}>Total</td>
                <td style={{ ...td, ...num, fontWeight: 700, fontSize: '12px' }}>{fmt(totalOutstanding)}</td>
                <td style={td} colSpan={2} />
                <td style={{ ...td, ...num, fontWeight: 700, fontSize: '12px' }}>{cardCalc ? fmt(cardCalc.amount) : '—'}</td>
                <td style={{ ...td, fontSize: '11px', color: '#7a8194', whiteSpace: 'normal' }} colSpan={2}>
                  {cardCalc ? `${cardCalc.rule}${entry ? ` (${entry.label})` : ''}` : ''}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
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
  const enquiries = c.enquiries90d == null ? 'Enquiries (90 days): not known' : `${c.enquiries90d} enquiries in 90 days`;
  return { text: items.length ? items.join(' · ') : 'No adverse flags', adverse: items.length > 0, risk, enquiries };
}

function CreditPanel({ draft, patchCredit, patchDraft }) {
  const [open, setOpen] = useState(false);
  const c = draft.credit;
  const fresh = c.freshLoanAfterSettlement || { exists: false, emisPaid: 0 };
  const summary = creditSummary(draft);
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
                <label style={lbl}>CIBIL enquiries in last 90 days</label>
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
  DEVIATION: { label: 'Eligible with deviation', background: '#ffedd5', color: '#9a3412' },
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

function ResultCard({ entry, loans, cards }) {
  const { label, result, error } = entry;
  const st = result ? STATUS[result.status] || STATUS.NEEDS_INPUT : null;
  const lenderOf = (id) => loans.find((l) => l.id === id);
  const best = result && result.best;
  const needsInput = !!(result && result.status === 'NEEDS_INPUT');
  // The engine also words the card plan as a warning; it has its own green line here.
  const warnings = ((result && result.warnings) || []).filter((w) => !(result.cardPlan && /^Close .* before login/.test(w)));

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <h3 style={{ ...cardHeader, margin: 0 }}>{label}</h3>
        {st && <span style={{ ...pill, background: st.background, color: st.color }}>{st.label}</span>}
        <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#9aa1b2' }}>
          {result && result.policyVersion ? `Policy ${result.policyVersion}` : entry.version ? `Policy ${entry.version}` : ''}
        </span>
      </div>

      {error && (
        <div style={{ padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#b91c1c', fontSize: '13px' }}>
          <b>Couldn&apos;t evaluate — policy error.</b> {error}
        </div>
      )}

      {/* Needs input (e.g. EMI missing): the reason goes first and the figures are greyed. */}
      {needsInput && <MessageList items={result.reasons} color="#854d0e" background="#fef9c3" />}

      {best && (
        <div style={needsInput ? { opacity: 0.45, marginTop: '10px' } : undefined} title={needsInput ? 'Provisional — fix the input above' : undefined}>
          <ResultTiles result={result} />
          {result.cardPlan && <CardPlanLine plan={result.cardPlan} cards={cards} />}
          <BtPlan best={best} lenderOf={lenderOf} />
        </div>
      )}

      {result && <MessageList items={result.notes} color={BLUE} background="#eef4fb" />}
      {result && <MessageList items={[...(result.deviations || []), ...orderWarnings(warnings)]} color="#9a3412" background="#fff7ed" />}
      {result && !needsInput && <MessageList items={result.reasons} color="#b91c1c" background="#fef2f2" />}

      {result && result.scenarios && result.scenarios.length > 0 && (
        <OtherOptions scenarios={result.scenarios} best={best} band={result.risk.band} lenderOf={lenderOf} />
      )}
    </div>
  );
}

// CAM-style tile grid for the best scenario.
function ResultTiles({ result }) {
  const best = result.best;
  const risk = result.risk;
  const tenures = Object.keys(best.foir).map(Number);
  const showMult = hasMultiplier(best);
  const indicated = showMult ? best.multiplier[risk.band] : null;
  const otherKey = risk.band === 'better' ? 'lower' : 'better';
  const other = showMult ? best.multiplier[otherKey] : null;
  const byMultiplier = best.limitedBy === 'multiplier';
  const tenure = byMultiplier && indicated ? indicated.tenure : tenures[0];
  const roi = best.conservativeRoi ?? best.foir[tenures[0]].roi;
  const btCount = best.bt.length;
  const inHandNegative = best.btOutstanding > best.conservativeAmount;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
      {tenures.map((t) => (
        <SItem
          key={t}
          label={`FOIR ${tenureLabel(t)}`}
          value={fmtINR(best.foir[t].amount)}
          sub={`${fmtL(best.foir[t].amount)}${best.foir[t].roi != null ? ` · @ ${best.foir[t].roi}%` : ''} · FOIR ${result.foirPct}%`}
        />
      ))}
      {showMult && (
        <SItem
          label="Multiplier"
          value={indicated ? fmtINR(indicated.amount) : '—'}
          sub={indicated
            ? `${indicated.band || risk.band} · ×${indicated.multiplier}${other && other !== indicated && other.band !== indicated.band ? ` · ${other.band || otherKey}: ${fmtL(other.amount)}` : ''}`
            : 'no multiplier for this category / salary'}
        />
      )}
      <SItem label="Eligible amount" value={fmtINR(best.conservativeAmount)} sub={showMult ? 'lower of FOIR & multiplier' : 'FOIR only'} strong />
      <SItem label="ROI" value={roi != null ? `${roi}%` : '—'} sub={best.roiAssumed ? 'assumed — no rate for this amount' : undefined} />
      <SItem label="Tenure" value={tenureLabel(tenure)} />
      <SItem label="Counted obligations" value={`${fmtINR(best.obligations)}/month`} />
      <SItem label="BT POS" value={fmtINR(best.btOutstanding)} sub={`${btCount} loan${btCount === 1 ? '' : 's'}`} />
      {inHandNegative
        ? <NotEligibleTile label="Amount in hand (after BT)" sub={`BT POS ${fmtINR(best.btOutstanding)} > eligibility ${fmtINR(best.conservativeAmount)}`} />
        : <SItem label="Amount in hand (after BT)" value={fmtINR(best.netInHand)} strong />}
      <SItem label="Risk" value={risk.band === 'better' ? 'Better band' : 'Lower band'} sub={risk.reason} />
    </div>
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

const chipText = (loan, id) => `${(loan && loan.lender) || id} · ${fmtL(loan ? loan.outstanding : 0)}`;

function BtPlan({ best, lenderOf }) {
  return (
    <div style={{ marginTop: '14px' }}>
      <div style={{ ...lbl, marginBottom: '4px' }}>BT plan</div>
      {best.bt.length
        ? best.bt.map((id) => <span key={id} style={chip}>{chipText(lenderOf(id), id)}</span>)
        : <span style={{ fontSize: '12px', color: '#7a8194' }}>No BT — every loan stays as an obligation.</span>}
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
  const cols = ['BT loans', 'BT outstanding', 'Counted obligations', ...tenures.map((t) => `FOIR ${shortTenure(t)}`), ...(withMultiplier ? ['Multiplier'] : []), 'Net in hand'];
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
                        {s.bt.slice(0, CHIPS_IN_CELL).map((id) => <span key={id} style={chip}>{chipText(lenderOf(id), id)}</span>)}
                        {s.bt.length > CHIPS_IN_CELL && <span style={{ fontSize: '11px', color: '#7a8194' }}>+{s.bt.length - CHIPS_IN_CELL} more</span>}
                        {s === best && <span style={{ ...pill, background: '#dcfce7', color: '#166534', marginLeft: '4px' }}>Best</span>}
                      </div>
                    </td>
                    <td style={{ ...td, ...num, fontSize: '12px' }}>{fmtINR(s.btOutstanding)}</td>
                    <td style={{ ...td, ...num, fontSize: '12px' }}>{fmtINR(s.obligations)}</td>
                    {tenures.map((t) => <td key={t} style={{ ...td, ...num, fontSize: '12px' }}>{fmtINR(s.foir[t].amount)}</td>)}
                    {withMultiplier && <td style={{ ...td, ...num, fontSize: '12px' }}>{fmtINR(s.multiplier[band] && s.multiplier[band].amount)}</td>}
                    <td style={{ ...td, ...num, fontSize: '12px', fontWeight: 700 }}>{fmtINR(s.netInHand)}</td>
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
