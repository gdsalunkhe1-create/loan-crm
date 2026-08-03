// SaveBsaToLead.js — drop-in widget that saves a bank-statement-analysis
// result to a lead, using the SAME lead-search-and-save pattern
// CibilParser.js already uses for customer_cibil_data. Self-contained: it
// doesn't assume anything about the file it's placed in beyond having a
// parsed BSA `result` object and the current `userId` available.
//
// Usage (drop this near wherever downloadBsaWorkbook() is already called):
//   <SaveBsaToLead bsaResult={result} userId={userId} />
//
// Requires the customer_bank_statement_data table (already created):
//   lead_id uuid primary key references leads(id), account_holder text,
//   bank_name text, statement_period text, result jsonb, uploaded_by uuid,
//   uploaded_at timestamptz

import { useState, useEffect } from 'react';
import { supabase } from '../supabase';

const S = {
  wrap: { position: 'relative', display: 'inline-block' },
  row: { display: 'flex', gap: 8, alignItems: 'center' },
  input: { padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none', width: 220 },
  dropdown: { position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, marginTop: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', zIndex: 20, maxHeight: 200, overflowY: 'auto' },
  option: { padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f3f4f6' },
  chip: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, fontSize: 13, color: '#1D4ED8' },
  chipClear: { cursor: 'pointer', color: '#1D4ED8', fontWeight: 700 },
  btn: { padding: '8px 16px', background: '#185FA5', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  btnDisabled: { padding: '8px 16px', background: '#9CA3AF', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'not-allowed' },
  msg: (ok) => ({ fontSize: 13, color: ok ? '#16a34a' : '#dc2626', marginLeft: 8 }),
};

export default function SaveBsaToLead({ bsaResult, userId }) {
  const [leadSearch, setLeadSearch] = useState('');
  const [leads, setLeads] = useState([]);
  const [selectedLead, setSelectedLead] = useState(null);
  const [showDrop, setShowDrop] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [error, setError] = useState('');

  // Debounced lead search - identical pattern to CibilParser.js.
  useEffect(() => {
    if (!leadSearch || leadSearch.length < 2) { setLeads([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('leads').select('id,full_name,mobile').ilike('full_name', `%${leadSearch}%`).limit(8);
      setLeads(data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [leadSearch]);

  const save = async () => {
    if (!selectedLead) { setError('Select a customer first.'); return; }
    if (!bsaResult) { setError('No bank statement result to save.'); return; }
    setSaving(true); setError(''); setSavedMsg('');
    try {
      const { error: err } = await supabase.from('customer_bank_statement_data').upsert({
        lead_id: selectedLead.id,
        account_holder: bsaResult.summary?.account_holder || selectedLead.full_name,
        bank_name: bsaResult.summary?.bank_name || '',
        statement_period: bsaResult.summary?.statement_period || '',
        result: bsaResult,
        uploaded_by: userId,
        uploaded_at: new Date().toISOString(),
      }, { onConflict: 'lead_id' });
      if (err) throw err;
      setSavedMsg('✅ Saved to lead!');
      setTimeout(() => setSavedMsg(''), 3000);
    } catch (e) {
      setError('Save failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={S.wrap}>
      <div style={S.row}>
        {!selectedLead ? (
          <div style={{ position: 'relative' }}>
            <input
              style={S.input}
              placeholder="Search customer to save to..."
              value={leadSearch}
              onChange={e => { setLeadSearch(e.target.value); setShowDrop(true); }}
              onFocus={() => setShowDrop(true)}
            />
            {showDrop && leads.length > 0 && (
              <div style={S.dropdown}>
                {leads.map(l => (
                  <div key={l.id} style={S.option}
                    onClick={() => { setSelectedLead(l); setLeadSearch(''); setLeads([]); setShowDrop(false); }}
                    onMouseEnter={e => e.currentTarget.style.background = '#F9FAFB'}
                    onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                    <div style={{ fontWeight: 600 }}>{l.full_name}</div>
                    <div style={{ color: '#9CA3AF', fontSize: 12 }}>{l.mobile}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={S.chip}>
            {selectedLead.full_name}
            <span style={S.chipClear} onClick={() => setSelectedLead(null)}>✕</span>
          </div>
        )}
        <button
          style={selectedLead && !saving ? S.btn : S.btnDisabled}
          disabled={!selectedLead || saving}
          onClick={save}>
          {saving ? 'Saving...' : '💾 Save to Lead'}
        </button>
        {savedMsg && <span style={S.msg(true)}>{savedMsg}</span>}
        {error && <span style={S.msg(false)}>{error}</span>}
      </div>
    </div>
  );
}
