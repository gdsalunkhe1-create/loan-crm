// CompanyCategoryChecker.js
//
// Search + admin-managed reference tool for looking up which category a
// company falls into for each partner bank. The bank list itself lives in
// company_category_banks (admins can add more via Manage Lists), not as a
// hardcoded const here. Search (with type-ahead autocomplete) is open to
// everyone; the Manage Lists tab (bulk upload, add bank) is admin-only —
// enforced here in the UI and backed by RLS/RPC checks on the database side.

import React, { useState, useCallback, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../supabase';
import { IconSearch, IconUpload, IconBuildingBank } from '@tabler/icons-react';

const UPSERT_BATCH_SIZE = 150;
const AUTOCOMPLETE_DEBOUNCE_MS = 250;
const AUTOCOMPLETE_MIN_CHARS = 2;

function dbNormalize(name) {
  return String(name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .trim();
}

function scoreNameHeader(h) {
  h = String(h || '').toLowerCase();
  if (/sr\.?\s*no|^no$|s\.\s*no/.test(h)) return -1;
  if (/company|entity/.test(h)) return 3;
  if (/name/.test(h)) return 1.5;
  return 0;
}
function scoreCatHeader(h) {
  const tokens = String(h || '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (tokens.some(t => t === 'CAT' || t === 'CATG' || t.startsWith('CATEG'))) return 3;
  if (/classif/i.test(h)) return 2;
  if (/grade|tier|segment/i.test(h)) return 1.5;
  if (/status/i.test(h)) return 0.5;
  return 0;
}

async function upsertCompanyCategoryBatch(batch) {
  const { error } = await supabase
    .from('company_categories')
    .upsert(batch, { onConflict: 'bank,company_name_norm' });
  if (!error) return;

  // One retry at half the batch size, split into two calls — a single slow
  // batch degrades gracefully instead of aborting the whole import.
  const mid = Math.ceil(batch.length / 2);
  const halves = [batch.slice(0, mid), batch.slice(mid)];
  for (const half of halves) {
    if (half.length === 0) continue;
    const { error: halfError } = await supabase
      .from('company_categories')
      .upsert(half, { onConflict: 'bank,company_name_norm' });
    if (halfError) throw halfError;
  }
}

export default function CompanyCategoryChecker({ currentUserRole }) {
  const isAdmin = currentUserRole === 'admin';
  const [tab, setTab] = useState('search');
  // Non-admins never see the Manage Lists button — but also never render its
  // panel, even if `tab` state were somehow 'manage' (e.g. role changes mid-session).
  const activeTab = tab === 'manage' && isAdmin ? 'manage' : 'search';

  const [banks, setBanks] = useState([]); // [{id, label}] — company_category_banks is the source of truth

  const fetchBanks = useCallback(async () => {
    const { data, error } = await supabase
      .from('company_category_banks')
      .select('id, label')
      .order('label');
    if (!error) setBanks(data || []);
  }, []);

  useEffect(() => { fetchBanks(); }, [fetchBanks]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconBuildingBank size={22} strokeWidth={1.6} /> Company Category Checker
          </h1>
          <p>
            Look up a company's category across partner banks
            {isAdmin ? ', or manage the uploaded lists' : ''}.
          </p>
        </div>
      </div>
      <div className="page-body">
        {isAdmin && (
          <div className="tabs" style={{ maxWidth: 300 }}>
            <button className={`tab ${activeTab === 'search' ? 'active' : ''}`} onClick={() => setTab('search')}>
              Search
            </button>
            <button className={`tab ${activeTab === 'manage' ? 'active' : ''}`} onClick={() => setTab('manage')}>
              Manage Lists
            </button>
          </div>
        )}
        {activeTab === 'search'
          ? <SearchPanel banks={banks} />
          : <ManagePanel banks={banks} onBanksChanged={fetchBanks} />}
      </div>
    </div>
  );
}

// ---------------- Search ----------------

function SearchPanel({ banks }) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null); // { bankId: {status, rows} }
  const [error, setError] = useState(null);
  const boxRef = useRef(null);
  const debounceRef = useRef(null);
  const suggestReqRef = useRef(0); // stamps autocomplete_company_name requests so late responses can't clobber newer ones
  const searchReqRef = useRef(0);  // stamps search_company_category requests, same reason

  useEffect(() => {
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setShowSuggestions(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const runSearch = useCallback(async (qOverride) => {
    const q = (qOverride !== undefined ? qOverride : query).trim();
    if (!q) return;
    setShowSuggestions(false);
    const reqId = ++searchReqRef.current;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('search_company_category', {
        p_query: q,
      });
      if (reqId !== searchReqRef.current) return; // a newer search superseded this one
      if (rpcError) throw rpcError;

      const grouped = {};
      banks.forEach((b) => { grouped[b.id] = { status: 'none', rows: [] }; });
      (data || []).forEach((row) => {
        const g = grouped[row.bank];
        if (!g) return;
        g.rows.push(row);
        if (row.match_type === 'exact') g.status = 'exact';
        else if (g.status !== 'exact') g.status = 'fuzzy';
      });
      setResults(grouped);
    } catch (e) {
      if (reqId !== searchReqRef.current) return;
      setError(e.message || String(e));
    } finally {
      if (reqId === searchReqRef.current) setLoading(false);
    }
  }, [query, banks]);

  const fetchSuggestions = useCallback((q) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const reqId = ++suggestReqRef.current;
      const { data, error: rpcError } = await supabase.rpc('autocomplete_company_name', {
        p_query: q,
        p_limit: 10,
      });
      if (reqId !== suggestReqRef.current) return; // a newer keystroke superseded this one
      if (!rpcError) setSuggestions(data || []);
    }, AUTOCOMPLETE_DEBOUNCE_MS);
  }, []);

  const onQueryChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    if (val.trim().length >= AUTOCOMPLETE_MIN_CHARS) {
      fetchSuggestions(val.trim());
      setShowSuggestions(true);
    } else {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      suggestReqRef.current++; // invalidate any suggestion request still in flight
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const pickSuggestion = (name) => {
    suggestReqRef.current++; // invalidate any suggestion request still in flight
    setQuery(name);
    setSuggestions([]);
    setShowSuggestions(false);
    runSearch(name);
  };

  return (
    <div>
      <div ref={boxRef} style={{ position: 'relative', maxWidth: 640, marginBottom: 28 }}>
        <div className="search-bar">
          <IconSearch size={16} />
          <input
            className="form-input"
            placeholder="Type a company name, e.g. Reliance Industries"
            value={query}
            onChange={onQueryChange}
            onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
            onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
            autoComplete="off"
          />
        </div>
        {showSuggestions && suggestions.length > 0 && (
          <div
            style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50,
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)',
              maxHeight: 280, overflowY: 'auto',
            }}
          >
            {suggestions.map((s, i) => (
              <div
                key={i}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickSuggestion(s.company_name)}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                style={{
                  padding: '10px 14px', fontSize: 13.5, cursor: 'pointer', color: 'var(--text-primary)',
                  borderBottom: i < suggestions.length - 1 ? '1px solid var(--border-light)' : 'none',
                }}
              >
                {s.company_name}
              </div>
            ))}
          </div>
        )}
      </div>

      {loading && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>Searching…</div>}
      {error && <div className="info-box info-box-red">Search failed: {error}</div>}

      {!results && !loading && (
        <div className="empty-state">
          <IconSearch size={36} strokeWidth={1.2} color="#CBD5E0" />
          <h3>Check a company's category</h3>
          <p>Type a company name above, or pick a suggestion as you type.</p>
        </div>
      )}

      {results && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 18 }}>
          {banks.map((b) => {
            const r = results[b.id];
            if (!r) return null; // bank was added after this search ran
            const exact = r.rows.find((x) => x.match_type === 'exact');
            const badgeClass = exact ? 'badge-green' : r.rows.length ? 'badge-yellow' : 'badge-gray';
            const borderColor = exact ? 'var(--success)' : r.rows.length ? 'var(--warning)' : 'var(--border)';
            return (
              <div key={b.id} className="card" style={{ borderColor, marginBottom: 0 }}>
                <div className="card-body">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{b.label}</div>
                    <span className={`badge ${badgeClass}`}>
                      {exact ? 'Listed' : r.rows.length ? 'Possible match' : 'Not listed'}
                    </span>
                  </div>
                  {exact && (
                    <>
                      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                        {exact.category || '—'}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Matched: {exact.company_name}</div>
                    </>
                  )}
                  {!exact && r.rows.length > 0 && (
                    <>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>
                        No exact match — closest entries:
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {r.rows.map((m, i) => (
                          <div key={i} style={{ fontSize: 13, borderTop: '1px solid var(--border-light)', paddingTop: 8 }}>
                            <span style={{ color: 'var(--text-secondary)' }}>{m.company_name}</span>{' '}
                            <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{m.category || '—'}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {!exact && r.rows.length === 0 && (
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Not listed</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------- Manage / Upload ----------------

function ManagePanel({ banks, onBanksChanged }) {
  return (
    <div>
      <div className="info-box info-box-blue">
        Uploading replaces that bank's rows with the new file's data (matched by company name),
        so re-uploading next month is the same steps. Only admins can upload — everyone can search.
      </div>
      <AddBankControl onAdded={onBanksChanged} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 18 }}>
        {banks.map((b) => <BankUploadCard key={b.id} bank={b} />)}
      </div>
    </div>
  );
}

function AddBankControl({ onAdded }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    const label = name.trim();
    if (!label) { setError('Enter a bank name.'); return; }
    setBusy(true);
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc('add_company_category_bank', { p_label: label });
      if (rpcError) throw rpcError;
      setName('');
      if (onAdded) await onAdded();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', gap: 8, maxWidth: 420 }}>
        <input
          className="form-input"
          placeholder="New bank name, e.g. Axis Bank"
          value={name}
          onChange={(e) => { setName(e.target.value); if (error) setError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          disabled={busy}
        />
        <button className="btn btn-outline btn-sm" onClick={submit} disabled={busy} style={{ whiteSpace: 'nowrap' }}>
          {busy ? 'Adding…' : '+ Add bank'}
        </button>
      </div>
      {error && <div className="info-box info-box-red" style={{ marginTop: 10, maxWidth: 420 }}>{error}</div>}
    </div>
  );
}

function BankUploadCard({ bank }) {
  const fileInputRef = useRef(null);
  const [status, setStatus] = useState(null); // text status line
  const [errorText, setErrorText] = useState(null);
  const [mapping, setMapping] = useState(null); // { workbook, sheetName, sheetNames, headers, dataRows, nameIdx, catIdx }
  const [busy, setBusy] = useState(false);

  const onPickFile = () => fileInputRef.current && fileInputRef.current.click();

  const onFileChange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setErrorText(null);
    setStatus('Reading ' + file.name + '…');
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetNames = workbook.SheetNames;
        let bestSheet = sheetNames[0];
        let bestScore = -Infinity;
        sheetNames.forEach((sn) => {
          const ws = workbook.Sheets[sn];
          const ref = ws['!ref'];
          let rc = 0;
          if (ref) {
            const range = XLSX.utils.decode_range(ref);
            rc = range.e.r - range.s.r;
          }
          const penalized = /summary|removed|readme|instructions/i.test(sn);
          const score = penalized ? rc - 1000000 : rc;
          if (score > bestScore) { bestScore = score; bestSheet = sn; }
        });
        loadSheet(workbook, sheetNames, bestSheet);
        setStatus(null);
      } catch (err) {
        setErrorText('Could not read this file: ' + (err.message || String(err)));
        setStatus(null);
      }
    };
    reader.onerror = () => setErrorText('Could not read this file.');
    reader.readAsArrayBuffer(file);
  };

  const loadSheet = (workbook, sheetNames, sheetName) => {
    const ws = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    let headerRowIdx = 0;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const nonEmpty = rows[i].filter((c) => String(c).trim() !== '').length;
      if (nonEmpty >= 2) { headerRowIdx = i; break; }
    }
    const headers = rows[headerRowIdx].map((h) => String(h).trim());
    const dataRows = rows.slice(headerRowIdx + 1);

    let nameIdx = 0, catIdx = headers.length > 1 ? 1 : 0;
    let bestNameScore = -Infinity, bestCatScore = -Infinity;
    headers.forEach((h, i) => {
      const ns = scoreNameHeader(h);
      if (ns > bestNameScore) { bestNameScore = ns; nameIdx = i; }
      const cs = scoreCatHeader(h);
      if (cs > bestCatScore) { bestCatScore = cs; catIdx = i; }
    });

    setMapping({ workbook, sheetNames, sheetName, headers, dataRows, nameIdx, catIdx });
  };

  const changeSheet = (sheetName) => {
    if (!mapping) return;
    loadSheet(mapping.workbook, mapping.sheetNames, sheetName);
  };

  const cancel = () => {
    setMapping(null);
    setStatus(null);
    setErrorText(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const confirmImport = async () => {
    if (!mapping) return;
    setBusy(true);
    setErrorText(null);
    try {
      const { nameIdx, catIdx, dataRows, sheetName } = mapping;
      const seen = new Map(); // normalized name -> row
      for (const r of dataRows) {
        const name = String(r[nameIdx] || '').trim();
        if (!name) continue;
        const cat = String(r[catIdx] || '').trim();
        const key = dbNormalize(name);
        if (!key) continue;
        seen.set(key, { bank: bank.id, company_name: name, category: cat, source_sheet: sheetName });
      }
      const clean = Array.from(seen.values());

      const total = clean.length;
      let done = 0;
      const importStartedAt = new Date().toISOString();
      for (let i = 0; i < clean.length; i += UPSERT_BATCH_SIZE) {
        const batch = clean.slice(i, i + UPSERT_BATCH_SIZE);
        await upsertCompanyCategoryBatch(batch);
        done += batch.length;
        setStatus(`Importing… ${done.toLocaleString()} / ${total.toLocaleString()}`);
      }

      // Every row this import touched (inserted or updated) now has
      // updated_at >= importStartedAt, courtesy of the column default / the
      // BEFORE UPDATE trigger — so anything still older than that, for this
      // bank only, fell out of the newly uploaded file and should go.
      setStatus('Removing delisted companies…');
      const { error: deleteError, count: removedCount } = await supabase
        .from('company_categories')
        .delete({ count: 'exact' })
        .eq('bank', bank.id)
        .lt('updated_at', importStartedAt);
      if (deleteError) throw deleteError;

      setStatus(`Imported ${total.toLocaleString()} companies for ${bank.label} (${(removedCount || 0).toLocaleString()} no longer listed removed).`);
      setTimeout(() => {
        setMapping(null);
        setStatus(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }, 1200);
    } catch (err) {
      setErrorText('Import failed: ' + (err.message || String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h3>{bank.label}</h3>
        <div>
          <button className="btn btn-outline btn-sm" onClick={onPickFile}>
            <IconUpload size={14} /> Upload / Replace file
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.xlsb,.csv"
            style={{ display: 'none' }}
            onChange={onFileChange}
          />
        </div>
      </div>

      {(status || errorText || mapping) && (
        <div className="card-body">
          {status && <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 10, fontFamily: 'monospace' }}>{status}</div>}
          {errorText && <div className="info-box info-box-red">{errorText}</div>}

          {mapping && (
            <div>
              <MapRow label="Sheet">
                <select
                  className="form-input"
                  value={mapping.sheetName}
                  onChange={(e) => changeSheet(e.target.value)}
                >
                  {mapping.sheetNames.map((sn) => <option key={sn} value={sn}>{sn}</option>)}
                </select>
              </MapRow>
              <MapRow label="Company name column">
                <select
                  className="form-input"
                  value={mapping.nameIdx}
                  onChange={(e) => setMapping({ ...mapping, nameIdx: parseInt(e.target.value, 10) })}
                >
                  {mapping.headers.map((h, i) => (
                    <option key={i} value={i}>{h || `(column ${i + 1})`}</option>
                  ))}
                </select>
              </MapRow>
              <MapRow label="Category column">
                <select
                  className="form-input"
                  value={mapping.catIdx}
                  onChange={(e) => setMapping({ ...mapping, catIdx: parseInt(e.target.value, 10) })}
                >
                  {mapping.headers.map((h, i) => (
                    <option key={i} value={i}>{h || `(column ${i + 1})`}</option>
                  ))}
                </select>
              </MapRow>

              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '12px 0' }}>
                {mapping.dataRows.length.toLocaleString()} rows on this sheet. Preview:
              </p>
              <div className="table-container" style={{ marginBottom: 16 }}>
                <table>
                  <thead>
                    <tr>
                      {mapping.headers.map((h, i) => (
                        <th
                          key={i}
                          style={{ color: i === mapping.nameIdx || i === mapping.catIdx ? 'var(--primary)' : undefined }}
                        >
                          {h || `(col ${i + 1})`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mapping.dataRows.slice(0, 5).map((r, ri) => (
                      <tr key={ri}>
                        {mapping.headers.map((h, i) => (
                          <td
                            key={i}
                            style={{
                              color: i === mapping.nameIdx || i === mapping.catIdx ? 'var(--primary)' : undefined,
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220,
                            }}
                          >
                            {r[i] || ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={confirmImport} disabled={busy}>
                  {busy ? 'Importing…' : 'Save & Import'}
                </button>
                <button className="btn btn-ghost" onClick={cancel} disabled={busy}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MapRow({ label, children }) {
  return (
    <div className="form-group" style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 10, alignItems: 'center' }}>
      <label className="form-label" style={{ marginBottom: 0 }}>{label}</label>
      {children}
    </div>
  );
}
