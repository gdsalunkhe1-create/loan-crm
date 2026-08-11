// CompanyCategoryChecker.js
//
// Drop this into src/pages/ (or src/components/) alongside Dashboard.js.
//
// SETUP NEEDED IN YOUR REPO:
//   1. npm install xlsx
//   2. Fix the import on the next line to match wherever your existing
//      Supabase client lives (Dashboard.js already imports it from somewhere —
//      copy that same import path here).
//   3. Render <CompanyCategoryChecker currentUserRole={profile.role} /> from
//      Dashboard.js — e.g. as a new item in the admin/manager nav, or its own
//      route. currentUserRole is only used to hide the "Manage Lists" tab for
//      non-admins (the database also enforces this via RLS, so this is just UI).
//
// Backend (already set up in Supabase, project pvnzeueldfmxhesmoetc):
//   - table   public.company_categories   (bank, company_name, category, ...)
//   - RPC     public.search_company_category(p_query text)
//   Both are global/shared across orgs — this is platform reference data, not
//   scoped to a single org_id.

import React, { useState, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../supabase';

const BANKS = [
  { id: 'icici', label: 'ICICI Bank' },
  { id: 'indusind', label: 'IndusInd Bank' },
  { id: 'lt', label: 'L&T Finance' },
  { id: 'yes', label: 'Yes Bank' },
  { id: 'bandhan', label: 'Bandhan Bank' },
];

const UPSERT_BATCH_SIZE = 500;

function scoreNameHeader(h) {
  h = String(h || '').toLowerCase();
  if (/sr\.?\s*no|^no$|s\.\s*no/.test(h)) return -1;
  if (/company|entity/.test(h)) return 3;
  if (/name/.test(h)) return 1.5;
  return 0;
}
function scoreCatHeader(h) {
  h = String(h || '').toLowerCase();
  if (/categ/.test(h)) return 3;
  if (/classif/.test(h)) return 2;
  if (/grade|tier|segment/.test(h)) return 1.5;
  if (/status/.test(h)) return 0.5;
  return 0;
}

export default function CompanyCategoryChecker({ currentUserRole }) {
  const isAdmin = currentUserRole === 'admin';
  const [tab, setTab] = useState('search');

  return (
    <div style={styles.wrap}>
      <div style={styles.tabs}>
        <button
          style={{ ...styles.tab, ...(tab === 'search' ? styles.tabActive : {}) }}
          onClick={() => setTab('search')}
        >
          Search
        </button>
        {isAdmin && (
          <button
            style={{ ...styles.tab, ...(tab === 'manage' ? styles.tabActive : {}) }}
            onClick={() => setTab('manage')}
          >
            Manage Lists
          </button>
        )}
      </div>
      {tab === 'search' ? <SearchPanel /> : <ManagePanel />}
    </div>
  );
}

// ---------------- Search ----------------

function SearchPanel() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null); // { bankId: {status, rows} }
  const [error, setError] = useState(null);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('search_company_category', {
        p_query: q,
      });
      if (rpcError) throw rpcError;

      const grouped = {};
      BANKS.forEach((b) => { grouped[b.id] = { status: 'none', rows: [] }; });
      (data || []).forEach((row) => {
        const g = grouped[row.bank];
        if (!g) return;
        g.rows.push(row);
        if (row.match_type === 'exact') g.status = 'exact';
        else if (g.status !== 'exact') g.status = 'fuzzy';
      });
      setResults(grouped);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [query]);

  return (
    <div>
      <div style={styles.searchRow}>
        <input
          style={styles.input}
          placeholder="Type a company name, e.g. Reliance Industries"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
        />
        <button style={styles.btn} onClick={runSearch} disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      {error && <div style={styles.errText}>Search failed: {error}</div>}

      {!results && !loading && (
        <div style={styles.emptyState}>Type a company name above and hit Search.</div>
      )}

      {results && (
        <div style={styles.grid}>
          {BANKS.map((b) => {
            const r = results[b.id];
            const exact = r.rows.find((x) => x.match_type === 'exact');
            return (
              <div
                key={b.id}
                style={{
                  ...styles.card,
                  borderColor: exact ? '#1f3d38' : r.rows.length ? '#8a6f2c' : '#232b3a',
                }}
              >
                <div style={styles.cardTop}>
                  <div style={styles.bankName}>{b.label}</div>
                  <span
                    style={{
                      ...styles.badge,
                      ...(exact ? styles.badgeFound : r.rows.length ? styles.badgeFuzzy : styles.badgeNone),
                    }}
                  >
                    {exact ? 'Listed' : r.rows.length ? 'Possible match' : 'Not listed'}
                  </span>
                </div>
                {exact && (
                  <>
                    <div style={styles.catText}>{exact.category || '—'}</div>
                    <div style={styles.matchText}>Matched: {exact.company_name}</div>
                  </>
                )}
                {!exact && r.rows.length > 0 && (
                  <>
                    <div style={styles.catTextDim}>No exact match — closest entries:</div>
                    <div style={styles.fuzzyList}>
                      {r.rows.map((m, i) => (
                        <div key={i} style={styles.fuzzyItem}>
                          <span style={styles.fuzzyName}>{m.company_name}</span>{' '}
                          <span style={styles.fuzzyCat}>{m.category || '—'}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {!exact && r.rows.length === 0 && (
                  <div style={styles.catTextDim}>Not listed</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------- Manage / Upload ----------------

function ManagePanel() {
  return (
    <div>
      <div style={styles.bankList}>
        {BANKS.map((b) => <BankUploadCard key={b.id} bank={b} />)}
      </div>
      <div style={styles.footnote}>
        Uploading replaces that bank's rows with the new file's data (matched by company name),
        so re-uploading next month is the same steps. Only admins can upload — everyone can search.
      </div>
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
      const clean = [];
      for (const r of dataRows) {
        const name = String(r[nameIdx] || '').trim();
        if (!name) continue;
        const cat = String(r[catIdx] || '').trim();
        clean.push({ bank: bank.id, company_name: name, category: cat, source_sheet: sheetName });
      }

      const total = clean.length;
      let done = 0;
      for (let i = 0; i < clean.length; i += UPSERT_BATCH_SIZE) {
        const batch = clean.slice(i, i + UPSERT_BATCH_SIZE);
        const { error } = await supabase
          .from('company_categories')
          .upsert(batch, { onConflict: 'bank,company_name_norm' });
        if (error) throw error;
        done += batch.length;
        setStatus(`Importing… ${done.toLocaleString()} / ${total.toLocaleString()}`);
      }

      setStatus(`Imported ${total.toLocaleString()} companies for ${bank.label}.`);
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
    <div style={styles.bankCard}>
      <div style={styles.bcHead}>
        <div style={styles.bankName}>{bank.label}</div>
        <div>
          <button style={styles.btnSecondary} onClick={onPickFile}>Upload / Replace file</button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.xlsb,.csv"
            style={{ display: 'none' }}
            onChange={onFileChange}
          />
        </div>
      </div>

      {status && <div style={styles.parseStatus}>{status}</div>}
      {errorText && <div style={styles.errText}>{errorText}</div>}

      {mapping && (
        <div style={styles.mappingBox}>
          <MapRow label="Sheet">
            <select
              style={styles.select}
              value={mapping.sheetName}
              onChange={(e) => changeSheet(e.target.value)}
            >
              {mapping.sheetNames.map((sn) => <option key={sn} value={sn}>{sn}</option>)}
            </select>
          </MapRow>
          <MapRow label="Company name column">
            <select
              style={styles.select}
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
              style={styles.select}
              value={mapping.catIdx}
              onChange={(e) => setMapping({ ...mapping, catIdx: parseInt(e.target.value, 10) })}
            >
              {mapping.headers.map((h, i) => (
                <option key={i} value={i}>{h || `(column ${i + 1})`}</option>
              ))}
            </select>
          </MapRow>

          <div style={styles.previewNote}>
            {mapping.dataRows.length.toLocaleString()} rows on this sheet. Preview:
          </div>
          <table style={styles.previewTable}>
            <thead>
              <tr>
                {mapping.headers.map((h, i) => (
                  <th
                    key={i}
                    style={{
                      ...styles.th,
                      color: i === mapping.nameIdx || i === mapping.catIdx ? '#cda133' : undefined,
                    }}
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
                        ...styles.td,
                        color: i === mapping.nameIdx || i === mapping.catIdx ? '#cda133' : undefined,
                      }}
                    >
                      {r[i] || ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          <div style={styles.mapActions}>
            <button style={styles.btn} onClick={confirmImport} disabled={busy}>
              {busy ? 'Importing…' : 'Save & Import'}
            </button>
            <button style={styles.btnSecondary} onClick={cancel} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function MapRow({ label, children }) {
  return (
    <div style={styles.mapRow}>
      <label style={styles.mapLabel}>{label}</label>
      {children}
    </div>
  );
}

// ---------------- styles ----------------

const styles = {
  wrap: { fontFamily: 'Inter, -apple-system, sans-serif', color: '#edf0f5', maxWidth: 980, margin: '0 auto' },
  tabs: { display: 'flex', gap: 4, borderBottom: '1px solid #2b3446', marginBottom: 20 },
  tab: {
    fontWeight: 600, fontSize: 14, background: 'none', border: 'none', color: '#5f6a7d',
    padding: '10px 4px', marginRight: 22, cursor: 'pointer', borderBottom: '2px solid transparent',
  },
  tabActive: { color: '#edf0f5', borderBottomColor: '#cda133' },
  searchRow: { display: 'flex', gap: 10, marginBottom: 14 },
  input: {
    flex: 1, background: '#161c27', border: '1px solid #2b3446', color: '#edf0f5',
    fontSize: 15, padding: '13px 16px', borderRadius: 8, outline: 'none',
  },
  btn: {
    fontWeight: 600, fontSize: 14, background: '#cda133', color: '#1a1406',
    border: 'none', borderRadius: 8, padding: '13px 22px', cursor: 'pointer', whiteSpace: 'nowrap',
  },
  btnSecondary: {
    fontWeight: 600, fontSize: 13, background: '#1d2532', color: '#edf0f5',
    border: '1px solid #2b3446', borderRadius: 8, padding: '9px 16px', cursor: 'pointer', marginLeft: 8,
  },
  errText: { color: '#c85f45', fontSize: 13, margin: '8px 2px' },
  emptyState: {
    border: '1px dashed #2b3446', borderRadius: 10, padding: '32px 20px',
    textAlign: 'center', color: '#97a2b5', fontSize: 14,
  },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px,1fr))', gap: 12, marginTop: 18 },
  card: { background: '#161c27', border: '1px solid #2b3446', borderRadius: 10, padding: '16px 18px' },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  bankName: { fontWeight: 600, fontSize: 14.5 },
  badge: {
    fontSize: 9.5, letterSpacing: '0.06em', textTransform: 'uppercase',
    padding: '3px 7px', borderRadius: 20,
  },
  badgeFound: { background: '#1f3d38', color: '#45ab97' },
  badgeFuzzy: { background: 'rgba(205,161,51,0.14)', color: '#cda133' },
  badgeNone: { background: '#1d2532', color: '#5f6a7d' },
  catText: { fontFamily: 'monospace', fontSize: 16, fontWeight: 600, marginBottom: 4 },
  catTextDim: { fontSize: 13, color: '#5f6a7d' },
  matchText: { fontSize: 11.5, color: '#5f6a7d' },
  fuzzyList: { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 },
  fuzzyItem: { fontSize: 12.5, borderTop: '1px solid #232b3a', paddingTop: 6 },
  fuzzyName: { fontFamily: 'monospace', color: '#97a2b5' },
  fuzzyCat: { color: '#cda133', fontWeight: 600 },
  bankList: { display: 'flex', flexDirection: 'column', gap: 12 },
  bankCard: { background: '#161c27', border: '1px solid #2b3446', borderRadius: 10, padding: '18px 20px' },
  bcHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  parseStatus: { fontSize: 12.5, color: '#97a2b5', marginTop: 10, fontFamily: 'monospace' },
  mappingBox: { marginTop: 16, paddingTop: 16, borderTop: '1px solid #232b3a' },
  mapRow: { display: 'grid', gridTemplateColumns: '160px 1fr', gap: 10, alignItems: 'center', marginBottom: 10 },
  mapLabel: { fontSize: 12.5, color: '#97a2b5' },
  select: {
    background: '#1d2532', border: '1px solid #2b3446', color: '#edf0f5',
    padding: '9px 10px', borderRadius: 6, fontSize: 13.5, width: '100%',
  },
  previewNote: { fontSize: 12, color: '#97a2b5', margin: '8px 0' },
  previewTable: { width: '100%', borderCollapse: 'collapse', marginBottom: 14, fontSize: 12, fontFamily: 'monospace' },
  th: { textAlign: 'left', color: '#5f6a7d', fontWeight: 500, padding: '5px 8px', borderBottom: '1px solid #2b3446', textTransform: 'uppercase', fontSize: 10 },
  td: { padding: '5px 8px', borderBottom: '1px solid #232b3a', color: '#97a2b5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 },
  mapActions: { display: 'flex', gap: 8, marginTop: 6 },
  footnote: { marginTop: 24, fontSize: 12, color: '#5f6a7d', lineHeight: 1.6 },
};
