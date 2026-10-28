import React, { useState, useRef, useEffect } from 'react';

// Value format: 'YYYY-MM-DD' strings in LOCAL time ('' = no limit).
// Usage: <DateRangeFilter from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} />

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // local, no UTC shift
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const pretty = s => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${+d} ${MONTHS[+m - 1]} ${y}`; };

function getPresets() {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const dow = (t.getDay() + 6) % 7; // Monday = 0
  const mStart = new Date(t.getFullYear(), t.getMonth(), 1);
  const lmStart = new Date(t.getFullYear(), t.getMonth() - 1, 1);
  const lmEnd = new Date(t.getFullYear(), t.getMonth(), 0);
  return [
    { key: 'all',       label: 'All dates',    from: '',                     to: '' },
    { key: 'today',     label: 'Today',        from: ymd(t),                 to: ymd(t) },
    { key: 'yesterday', label: 'Yesterday',    from: ymd(addDays(t, -1)),    to: ymd(addDays(t, -1)) },
    { key: 'last7',     label: 'Last 7 days',  from: ymd(addDays(t, -6)),    to: ymd(t) },
    { key: 'week',      label: 'This week',    from: ymd(addDays(t, -dow)),  to: ymd(t) },
    { key: 'month',     label: 'This month',   from: ymd(mStart),            to: ymd(t) },
    { key: 'lastmonth', label: 'Last month',   from: ymd(lmStart),           to: ymd(lmEnd) },
  ];
}

export default function DateRangeFilter({ from = '', to = '', onChange }) {
  const [open, setOpen] = useState(false);
  const [cFrom, setCFrom] = useState(from);
  const [cTo, setCTo] = useState(to);
  const ref = useRef(null);

  useEffect(() => { setCFrom(from); setCTo(to); }, [from, to, open]);
  useEffect(() => {
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const presets = getPresets();
  const active = presets.find(p => p.from === from && p.to === to);
  const label = active ? active.label
    : from && to ? (from === to ? pretty(from) : `${pretty(from)} – ${pretty(to)}`)
    : from ? `From ${pretty(from)}` : `Until ${pretty(to)}`;
  const isFiltered = !!(from || to);
  const invalid = cFrom && cTo && cFrom > cTo;

  const pick = p => { onChange(p.from, p.to); setOpen(false); };
  const applyCustom = () => { if (invalid) return; onChange(cFrom, cTo); setOpen(false); };

  const s = {
    btn: {
      display: 'flex', alignItems: 'center', gap: 8, height: 42, padding: '0 14px',
      borderRadius: 8, cursor: 'pointer', fontSize: 15, whiteSpace: 'nowrap',
      border: `1.5px solid ${isFiltered ? '#1e5aa8' : '#cfd6e0'}`,
      background: isFiltered ? '#eaf2fd' : '#fff',
      color: isFiltered ? '#1e5aa8' : '#333', fontWeight: isFiltered ? 600 : 400,
    },
    panel: {
      position: 'absolute', top: 48, right: 0, zIndex: 50, width: 320, background: '#fff',
      border: '1px solid #dde3ea', borderRadius: 10, boxShadow: '0 8px 24px rgba(20,40,80,.15)', padding: 12,
    },
    grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 },
    chip: on => ({
      padding: '9px 10px', borderRadius: 7, fontSize: 14, cursor: 'pointer', textAlign: 'left',
      border: `1px solid ${on ? '#1e5aa8' : '#e3e8ef'}`,
      background: on ? '#1e5aa8' : '#f7f9fc', color: on ? '#fff' : '#2b3a4f', fontWeight: on ? 600 : 500,
    }),
    lbl: { fontSize: 12, color: '#5b6b80', fontWeight: 600, marginBottom: 4, display: 'block' },
    input: { width: '100%', height: 38, border: '1px solid #cfd6e0', borderRadius: 7, padding: '0 8px', fontSize: 14, boxSizing: 'border-box' },
    apply: {
      marginTop: 10, width: '100%', height: 38, border: 'none', borderRadius: 7, fontSize: 14, fontWeight: 600,
      background: invalid ? '#c5ccd6' : '#1e5aa8', color: '#fff', cursor: invalid ? 'not-allowed' : 'pointer',
    },
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" style={s.btn} onClick={() => setOpen(o => !o)}>
        <span>📅</span>
        <span>{isFiltered ? label : 'Date: All'}</span>
        {isFiltered
          ? <span title="Clear date filter" onClick={e => { e.stopPropagation(); onChange('', ''); }}
              style={{ marginLeft: 2, fontWeight: 700, opacity: .7 }}>✕</span>
          : <span style={{ fontSize: 11 }}>▼</span>}
      </button>

      {open && (
        <div style={s.panel}>
          <div style={s.grid}>
            {presets.map(p => (
              <button key={p.key} type="button" style={s.chip(active?.key === p.key)} onClick={() => pick(p)}>
                {p.label}
              </button>
            ))}
          </div>

          <div style={{ borderTop: '1px solid #eef1f5', margin: '12px 0 10px' }} />
          <div style={{ fontSize: 13, fontWeight: 700, color: '#2b3a4f', marginBottom: 8 }}>Custom range</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={s.lbl}>From</label>
              <input type="date" style={s.input} value={cFrom} max={cTo || undefined} onChange={e => setCFrom(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={s.lbl}>To</label>
              <input type="date" style={s.input} value={cTo} min={cFrom || undefined} onChange={e => setCTo(e.target.value)} />
            </div>
          </div>
          {invalid && <div style={{ color: '#c0392b', fontSize: 12, marginTop: 6 }}>"From" date must be before "To" date.</div>}
          <button type="button" style={s.apply} disabled={invalid} onClick={applyCustom}>Apply range</button>
        </div>
      )}
    </div>
  );
}
