// BankRates.js — "Bank Rates" page for CALL-Q PRO
// Agents/TL/managers: view current bank rate offers.
// Admin: Add, Edit/Replace, Duplicate (for next month), Delete, attach flyer image.
// Data: public.bank_rate_offers (org-scoped RLS) + private storage bucket "rate-offers".
// Usage in Dashboard.js:  <BankRates supabase={supabase} />

import React, { useEffect, useMemo, useState, useCallback } from 'react';

const EMPTY_ROW = { segment: '', loan_amount: '', roi: '', pf: '', cibil: '', note: '' };
const ROW_FIELDS = [
  { key: 'segment', label: 'Category / Segment', w: 220 },
  { key: 'loan_amount', label: 'Loan Amount', w: 130 },
  { key: 'roi', label: 'ROI', w: 80 },
  { key: 'pf', label: 'Processing Fee', w: 120 },
  { key: 'cibil', label: 'CIBIL', w: 80 },
  { key: 'note', label: 'Note', w: 140 },
];

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmtDate = (s) => {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
const daysLeft = (till) => {
  if (!till) return null;
  const [y, m, d] = till.split('-').map(Number);
  const t = new Date(y, m - 1, d); const n = new Date(); n.setHours(0, 0, 0, 0);
  return Math.round((t - n) / 86400000);
};
const statusOf = (o) => {
  const t = todayStr();
  if (o.valid_till && o.valid_till < t) return 'expired';
  if (o.valid_from && o.valid_from > t) return 'upcoming';
  return 'active';
};
const roiNum = (r) => { const n = parseFloat(String(r || '').replace(/[^0-9.]/g, '')); return isNaN(n) ? null : n; };

const C = {
  primary: '#4f46e5', primarySoft: '#eef2ff', border: '#e5e7eb', text: '#111827', muted: '#6b7280',
  green: '#059669', greenSoft: '#ecfdf5', red: '#dc2626', redSoft: '#fef2f2', amber: '#b45309', amberSoft: '#fffbeb', bg: '#f9fafb',
};
const btn = (variant = 'ghost') => ({
  padding: '7px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  border: variant === 'primary' ? 'none' : `1px solid ${variant === 'danger' ? '#fecaca' : C.border}`,
  background: variant === 'primary' ? C.primary : variant === 'danger' ? C.redSoft : '#fff',
  color: variant === 'primary' ? '#fff' : variant === 'danger' ? C.red : C.text,
});
const input = { width: '100%', padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, boxSizing: 'border-box' };

export default function BankRates({ supabase }) {
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [role, setRole] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('active');
  const [bankFilter, setBankFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [view, setView] = useState('cards'); // cards | compare
  const [editing, setEditing] = useState(null); // offer object (new has no id)
  const [flyerUrl, setFlyerUrl] = useState(null);
  const [toast, setToast] = useState('');

  const isAdmin = role === 'admin';
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2500); };

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const { data, error } = await supabase
      .from('bank_rate_offers')
      .select('*')
      .order('bank_name', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) setError(error.message); else setOffers(data || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      await supabase.auth.getSession();
      const [{ data: r }, { data: o }] = await Promise.all([
        supabase.rpc('current_user_role'),
        supabase.rpc('current_org_id'),
      ]);
      setRole(r || null); setOrgId(o || null);
      await load();
    })();
  }, [supabase, load]);

  const banks = useMemo(() => ['All', ...Array.from(new Set(offers.map((o) => o.bank_name))).sort()], [offers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return offers.filter((o) => {
      const st = statusOf(o);
      if (statusFilter !== 'all' && st !== statusFilter) return false;
      if (bankFilter !== 'All' && o.bank_name !== bankFilter) return false;
      if (!q) return true;
      const hay = [o.bank_name, o.title, ...(o.conditions || []), ...(o.rows || []).flatMap((r) => Object.values(r))].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [offers, statusFilter, bankFilter, search]);

  const compareRows = useMemo(() => filtered
    .flatMap((o) => (o.rows || []).map((r) => ({ ...r, bank: o.bank_name, title: o.title, till: o.valid_till })))
    .sort((a, b) => (roiNum(a.roi) ?? 99) - (roiNum(b.roi) ?? 99)), [filtered]);

  const counts = useMemo(() => {
    const c = { active: 0, upcoming: 0, expired: 0 };
    offers.forEach((o) => { c[statusOf(o)]++; });
    return c;
  }, [offers]);

  const openFlyer = async (path) => {
    const { data, error } = await supabase.storage.from('rate-offers').createSignedUrl(path, 3600);
    if (error) return showToast('Could not open flyer: ' + error.message);
    setFlyerUrl(data.signedUrl);
  };

  const removeOffer = async (o) => {
    if (!window.confirm(`Delete "${o.bank_name} – ${o.title}"?\nThis cannot be undone.`)) return;
    if (o.flyer_path) await supabase.storage.from('rate-offers').remove([o.flyer_path]);
    const { error } = await supabase.from('bank_rate_offers').delete().eq('id', o.id);
    if (error) return showToast('Delete failed: ' + error.message);
    setOffers((prev) => prev.filter((x) => x.id !== o.id));
    showToast('Offer deleted');
  };

  const duplicate = (o) => {
    setEditing({
      bank_name: o.bank_name, title: o.title, valid_from: '', valid_till: '',
      rows: (o.rows || []).map((r) => ({ ...EMPTY_ROW, ...r })), conditions: o.conditions || [],
      flyer_path: null, sort_order: o.sort_order, _replaceId: o.id,
    });
  };

  return (
    <div style={{ padding: 16, color: C.text, fontFamily: 'inherit' }}>
      {/* Header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>🏦 Bank Rates</h2>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>Current personal loan rate offers by bank</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btn()} onClick={() => setView(view === 'cards' ? 'compare' : 'cards')}>
            {view === 'cards' ? '📊 Compare all rates' : '🗂 Offer cards'}
          </button>
          {isAdmin && (
            <button style={btn('primary')} onClick={() => setEditing({ bank_name: '', title: '', valid_from: '', valid_till: '', rows: [{ ...EMPTY_ROW }], conditions: [], flyer_path: null, sort_order: 0 })}>
              + Add Offer
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {[['active', `Active (${counts.active})`], ['upcoming', `Upcoming (${counts.upcoming})`], ['expired', `Expired (${counts.expired})`], ['all', 'All']].map(([k, l]) => (
          <button key={k} onClick={() => setStatusFilter(k)}
            style={{ ...btn(), background: statusFilter === k ? C.primarySoft : '#fff', color: statusFilter === k ? C.primary : C.text, borderColor: statusFilter === k ? C.primary : C.border }}>
            {l}
          </button>
        ))}
        <input placeholder="Search bank, category, condition…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...input, width: 260, flex: '1 1 200px' }} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
        {banks.map((b) => (
          <button key={b} onClick={() => setBankFilter(b)}
            style={{ padding: '4px 10px', borderRadius: 999, fontSize: 12, cursor: 'pointer', border: `1px solid ${bankFilter === b ? C.primary : C.border}`, background: bankFilter === b ? C.primary : '#fff', color: bankFilter === b ? '#fff' : C.text }}>
            {b}
          </button>
        ))}
      </div>

      {loading && <div style={{ color: C.muted }}>Loading rates…</div>}
      {error && <div style={{ color: C.red, background: C.redSoft, padding: 10, borderRadius: 8 }}>{error}</div>}
      {!loading && !error && filtered.length === 0 && (
        <div style={{ color: C.muted, background: C.bg, padding: 24, borderRadius: 12, textAlign: 'center' }}>
          No {statusFilter !== 'all' ? statusFilter : ''} offers{bankFilter !== 'All' ? ` for ${bankFilter}` : ''}.
          {isAdmin && ' Use "+ Add Offer" to add one.'}
        </div>
      )}

      {/* Compare view */}
      {!loading && view === 'compare' && compareRows.length > 0 && (
        <div style={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: C.bg }}>
              {['Bank', 'Category / Segment', 'Loan Amount', 'ROI', 'PF', 'CIBIL', 'Valid till'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {compareRows.map((r, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: '8px 12px', fontWeight: 600, whiteSpace: 'nowrap' }}>{r.bank}<div style={{ fontWeight: 400, color: C.muted, fontSize: 11 }}>{r.title}</div></td>
                  <td style={{ padding: '8px 12px' }}>{r.segment}{r.note && <div style={{ color: C.muted, fontSize: 11 }}>{r.note}</div>}</td>
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{r.loan_amount}</td>
                  <td style={{ padding: '8px 12px', fontWeight: 700, color: C.primary }}>{r.roi}</td>
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{r.pf || '—'}</td>
                  <td style={{ padding: '8px 12px' }}>{r.cibil || '—'}</td>
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{fmtDate(r.till) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Cards view */}
      {!loading && view === 'cards' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 14 }}>
          {filtered.map((o) => <OfferCard key={o.id} o={o} isAdmin={isAdmin} onEdit={() => setEditing({ ...o, rows: (o.rows || []).map((r) => ({ ...EMPTY_ROW, ...r })) })} onDuplicate={() => duplicate(o)} onDelete={() => removeOffer(o)} onFlyer={() => openFlyer(o.flyer_path)} />)}
        </div>
      )}

      {editing && (
        <OfferEditor supabase={supabase} orgId={orgId} offer={editing} banks={banks.filter((b) => b !== 'All')} existing={offers}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => { setEditing(null); await load(); showToast(msg); }} />
      )}

      {flyerUrl && (
        <div onClick={() => setFlyerUrl(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: '95vw', maxHeight: '92vh', position: 'relative' }}>
            {/\.pdf(\?|$)/i.test(flyerUrl.split('?')[0])
              ? <iframe title="flyer" src={flyerUrl} style={{ width: '85vw', height: '88vh', background: '#fff', border: 0, borderRadius: 8 }} />
              : <img src={flyerUrl} alt="Offer flyer" style={{ maxWidth: '95vw', maxHeight: '88vh', borderRadius: 8, display: 'block' }} />}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <a href={flyerUrl} target="_blank" rel="noreferrer" style={{ ...btn(), textDecoration: 'none' }}>Open / Download</a>
              <button style={btn()} onClick={() => setFlyerUrl(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: C.text, color: '#fff', padding: '10px 16px', borderRadius: 8, fontSize: 13, zIndex: 1100 }}>{toast}</div>}
    </div>
  );
}

function StatusBadge({ o }) {
  const st = statusOf(o);
  const dl = daysLeft(o.valid_till);
  const map = {
    expired: { bg: C.redSoft, fg: C.red, t: `Expired ${fmtDate(o.valid_till)}` },
    upcoming: { bg: C.amberSoft, fg: C.amber, t: `Starts ${fmtDate(o.valid_from)}` },
    active: { bg: dl !== null && dl <= 5 ? C.amberSoft : C.greenSoft, fg: dl !== null && dl <= 5 ? C.amber : C.green,
      t: o.valid_till ? `Valid till ${fmtDate(o.valid_till)}${dl !== null ? ` · ${dl === 0 ? 'last day' : `${dl} day${dl === 1 ? '' : 's'} left`}` : ''}` : 'No end date' },
  };
  const s = map[st];
  return <span style={{ background: s.bg, color: s.fg, fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>{s.t}</span>;
}

function OfferCard({ o, isAdmin, onEdit, onDuplicate, onDelete, onFlyer }) {
  const hasCibil = (o.rows || []).some((r) => r.cibil);
  const hasPf = (o.rows || []).some((r) => r.pf);
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: '#fff', overflow: 'hidden', opacity: statusOf(o) === 'expired' ? 0.7 : 1 }}>
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{o.bank_name}</div>
          <div style={{ color: C.muted, fontSize: 13 }}>{o.title}</div>
          {o.valid_from && <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>From {fmtDate(o.valid_from)}</div>}
        </div>
        <StatusBadge o={o} />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: C.bg }}>
            <th style={th}>Category</th><th style={th}>Loan Amount</th><th style={th}>ROI</th>
            {hasPf && <th style={th}>PF</th>}{hasCibil && <th style={th}>CIBIL</th>}
          </tr></thead>
          <tbody>
            {(o.rows || []).map((r, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={td}>{r.segment}{r.note && <div style={{ color: C.muted, fontSize: 11 }}>{r.note}</div>}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.loan_amount}</td>
                <td style={{ ...td, fontWeight: 800, color: C.primary, whiteSpace: 'nowrap' }}>{r.roi}</td>
                {hasPf && <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.pf || '—'}</td>}
                {hasCibil && <td style={td}>{r.cibil || '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(o.conditions || []).length > 0 && (
        <ul style={{ margin: 0, padding: '10px 14px 10px 30px', fontSize: 12, color: '#374151', background: '#fcfcfd', borderTop: `1px solid ${C.border}` }}>
          {o.conditions.map((c, i) => <li key={i} style={{ marginBottom: 3 }}>{c}</li>)}
        </ul>
      )}
      {(o.flyer_path || isAdmin) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 14px', borderTop: `1px solid ${C.border}` }}>
          {o.flyer_path && <button style={btn()} onClick={onFlyer}>🖼 View flyer</button>}
          {isAdmin && <>
            <button style={btn()} onClick={onEdit}>✏️ Edit / Replace</button>
            <button style={btn()} onClick={onDuplicate} title="Copy this offer as a new one (e.g. next month)">📄 Duplicate</button>
            <button style={btn('danger')} onClick={onDelete}>🗑 Delete</button>
          </>}
        </div>
      )}
    </div>
  );
}
const th = { textAlign: 'left', padding: '8px 12px', fontSize: 12, color: C.muted, fontWeight: 700 };
const td = { padding: '8px 12px', verticalAlign: 'top' };

function OfferEditor({ supabase, orgId, offer, banks, existing, onClose, onSaved }) {
  const isNew = !offer.id;
  const [f, setF] = useState({
    bank_name: offer.bank_name || '', title: offer.title || '',
    valid_from: offer.valid_from || '', valid_till: offer.valid_till || '',
    rows: offer.rows?.length ? offer.rows : [{ ...EMPTY_ROW }],
    conditionsText: (offer.conditions || []).join('\n'),
    sort_order: offer.sort_order || 0,
  });
  const [file, setFile] = useState(null);
  const [removeFlyer, setRemoveFlyer] = useState(false);
  const [deleteOld, setDeleteOld] = useState(!!offer._replaceId);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const setRow = (i, k, v) => setF((p) => ({ ...p, rows: p.rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }));
  const addRow = () => setF((p) => ({ ...p, rows: [...p.rows, { ...EMPTY_ROW }] }));
  const delRow = (i) => setF((p) => ({ ...p, rows: p.rows.filter((_, j) => j !== i) }));
  const moveRow = (i, d) => setF((p) => {
    const rows = [...p.rows]; const j = i + d; if (j < 0 || j >= rows.length) return p;
    [rows[i], rows[j]] = [rows[j], rows[i]]; return { ...p, rows };
  });
  const oldOffer = offer._replaceId ? existing.find((x) => x.id === offer._replaceId) : null;

  const save = async () => {
    setErr('');
    const rows = f.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v || '').trim()])))
      .filter((r) => r.segment || r.loan_amount || r.roi);
    if (!f.bank_name.trim()) return setErr('Bank name is required');
    if (!f.title.trim()) return setErr('Offer title is required');
    if (!rows.length) return setErr('Add at least one rate row');
    if (rows.some((r) => !r.roi)) return setErr('Every row needs an ROI');
    if (f.valid_from && f.valid_till && f.valid_till < f.valid_from) return setErr('"Valid till" is before "Valid from"');
    setSaving(true);
    try {
      const payload = {
        bank_name: f.bank_name.trim(), title: f.title.trim(),
        valid_from: f.valid_from || null, valid_till: f.valid_till || null,
        rows, conditions: f.conditionsText.split('\n').map((s) => s.trim()).filter(Boolean),
        sort_order: Number(f.sort_order) || 0,
      };
      let id = offer.id;
      if (isNew) {
        const { data, error } = await supabase.from('bank_rate_offers').insert(payload).select('id').single();
        if (error) throw error; id = data.id;
      } else {
        const { error } = await supabase.from('bank_rate_offers').update(payload).eq('id', id);
        if (error) throw error;
      }
      // flyer: upload new / remove old
      const oldPath = offer.flyer_path;
      if (file) {
        if (!orgId) throw new Error('Could not resolve organisation for upload');
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${orgId}/${id}-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('rate-offers').upload(path, file, { upsert: false, contentType: file.type });
        if (upErr) throw upErr;
        const { error } = await supabase.from('bank_rate_offers').update({ flyer_path: path }).eq('id', id);
        if (error) throw error;
        if (oldPath) await supabase.storage.from('rate-offers').remove([oldPath]);
      } else if (removeFlyer && oldPath) {
        await supabase.storage.from('rate-offers').remove([oldPath]);
        await supabase.from('bank_rate_offers').update({ flyer_path: null }).eq('id', id);
      }
      // duplicate-to-replace: delete the old offer after the new one saved
      if (isNew && deleteOld && oldOffer) {
        if (oldOffer.flyer_path) await supabase.storage.from('rate-offers').remove([oldOffer.flyer_path]);
        const { error } = await supabase.from('bank_rate_offers').delete().eq('id', oldOffer.id);
        if (error) throw error;
      }
      onSaved(isNew ? (deleteOld && oldOffer ? 'Offer replaced' : 'Offer added') : 'Offer updated');
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const lbl = { fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 4, display: 'block' };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '30px 12px' }}>
      <div style={{ background: '#fff', borderRadius: 14, width: 'min(980px, 100%)', boxShadow: '0 20px 50px rgba(0,0,0,.25)' }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>{isNew ? (offer._replaceId ? 'New offer (from copy)' : 'Add offer') : 'Edit / Replace offer'}</h3>
          <button style={btn()} onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: 18, display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div>
              <label style={lbl}>Bank *</label>
              <input list="rate-banks" style={input} value={f.bank_name} onChange={(e) => setF({ ...f, bank_name: e.target.value })} placeholder="e.g. HDFC Bank" />
              <datalist id="rate-banks">{banks.map((b) => <option key={b} value={b} />)}</datalist>
            </div>
            <div>
              <label style={lbl}>Offer title *</label>
              <input style={input} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Festive Special Offer" />
            </div>
            <div>
              <label style={lbl}>Valid from</label>
              <input type="date" style={input} value={f.valid_from} onChange={(e) => setF({ ...f, valid_from: e.target.value })} />
            </div>
            <div>
              <label style={lbl}>Valid till</label>
              <input type="date" style={input} value={f.valid_till} onChange={(e) => setF({ ...f, valid_till: e.target.value })} />
            </div>
          </div>

          <div>
            <label style={lbl}>Rate rows *</label>
            <div style={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 10 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
                <thead><tr style={{ background: C.bg }}>
                  {ROW_FIELDS.map((c) => <th key={c.key} style={{ ...th, minWidth: c.w }}>{c.label}</th>)}<th style={th} />
                </tr></thead>
                <tbody>
                  {f.rows.map((r, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                      {ROW_FIELDS.map((c) => (
                        <td key={c.key} style={{ padding: 4 }}>
                          <input style={{ ...input, padding: '6px 8px' }} value={r[c.key] || ''} onChange={(e) => setRow(i, c.key, e.target.value)}
                            placeholder={{ segment: 'CAT A / Govt', loan_amount: '₹15L & above', roi: '10.25%', pf: '₹6,999', cibil: '750+', note: '' }[c.key]} />
                        </td>
                      ))}
                      <td style={{ padding: 4, whiteSpace: 'nowrap' }}>
                        <button style={{ ...btn(), padding: '4px 7px' }} onClick={() => moveRow(i, -1)} title="Move up">↑</button>{' '}
                        <button style={{ ...btn(), padding: '4px 7px' }} onClick={() => moveRow(i, 1)} title="Move down">↓</button>{' '}
                        <button style={{ ...btn('danger'), padding: '4px 7px' }} onClick={() => delRow(i)} title="Remove row">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button style={{ ...btn(), marginTop: 8 }} onClick={addRow}>+ Add row</button>
          </div>

          <div>
            <label style={lbl}>Conditions / Please note (one per line)</label>
            <textarea rows={6} style={{ ...input, fontFamily: 'inherit' }} value={f.conditionsText} onChange={(e) => setF({ ...f, conditionsText: e.target.value })}
              placeholder={'Offer applicable for new logins till 30 Nov\nCIBIL 750 & above\nNot applicable for blue collar'} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            <div>
              <label style={lbl}>Flyer image (optional — JPG / PNG / PDF, max 10 MB)</label>
              <input type="file" accept="image/*,application/pdf" onChange={(e) => { setFile(e.target.files?.[0] || null); setRemoveFlyer(false); }} />
              {!isNew && offer.flyer_path && !file && (
                <label style={{ display: 'block', fontSize: 12, marginTop: 6 }}>
                  <input type="checkbox" checked={removeFlyer} onChange={(e) => setRemoveFlyer(e.target.checked)} /> Remove current flyer
                </label>
              )}
              {file && <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{offer.flyer_path ? 'Will replace current flyer: ' : 'Will upload: '}{file.name}</div>}
            </div>
            <div>
              <label style={lbl}>Display order (lower shows first within the bank)</label>
              <input type="number" style={{ ...input, width: 120 }} value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: e.target.value })} />
            </div>
          </div>

          {oldOffer && (
            <label style={{ fontSize: 13, background: C.amberSoft, padding: 10, borderRadius: 8 }}>
              <input type="checkbox" checked={deleteOld} onChange={(e) => setDeleteOld(e.target.checked)} />{' '}
              Replace: delete the old offer “{oldOffer.title}” ({oldOffer.valid_till ? `till ${fmtDate(oldOffer.valid_till)}` : 'no end date'}) after saving this one
            </label>
          )}

          {err && <div style={{ color: C.red, background: C.redSoft, padding: 10, borderRadius: 8, fontSize: 13 }}>{err}</div>}
        </div>
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button style={btn()} onClick={onClose} disabled={saving}>Cancel</button>
          <button style={btn('primary')} onClick={save} disabled={saving}>{saving ? 'Saving…' : isNew ? 'Save offer' : 'Save changes'}</button>
        </div>
      </div>
    </div>
  );
}
