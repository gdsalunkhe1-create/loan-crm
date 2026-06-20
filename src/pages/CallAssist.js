/* eslint-disable */
import React, { useState } from 'react';

const BLUE = '#185FA5';

// ── Shared style tokens (same as CamCalculator) ─────────────────────────────
const card = { background: '#fff', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.07)', marginBottom: '18px' };
const cardHeader = { margin: '0 0 14px', fontSize: '15px', color: '#333', fontWeight: 700 };
const lbl = { fontSize: '12px', fontWeight: 600, color: '#555', marginBottom: '6px', display: 'block' };
const inp = { width: '100%', padding: '8px 10px', border: '1px solid #dde3ee', borderRadius: '6px', fontSize: '13px', outline: 'none', boxSizing: 'border-box', background: '#fafbfe' };
const btnPri = { padding: '9px 16px', background: BLUE, color: '#fff', border: 'none', borderRadius: '7px', fontWeight: 600, fontSize: '13px', cursor: 'pointer' };
const btnSec = { padding: '9px 16px', background: '#fff', color: BLUE, border: '1px solid #cdd8ea', borderRadius: '7px', fontWeight: 600, fontSize: '13px', cursor: 'pointer' };

// ── Knowledge base defaults (EXAMPLE — replace with your real content) ───────
// Edit these in the Setup tab at runtime, or replace the seed values here.
const DEFAULT_KB = {
  script: '[EXAMPLE — replace] Greeting: "Hello {name}, I\'m calling from [DSA Name]. We have a pre-approved personal loan offer for you at great rates. Do you have 2 minutes?"',
  policies: '[EXAMPLE — replace] Min loan: ₹50,000. Max: ₹25,00,000. Tenure: 12–60 months. Salaried only. Min salary: ₹20,000/mo. Docs: PAN, Aadhaar, 3-month bank statement, latest salary slip.',
  usps: '[EXAMPLE — replace] Doorstep document pickup. Disbursal in 24–48 hours. No collateral needed. Rates from 10.5% p.a. Minimal paperwork.',
  rebuttals: '[EXAMPLE — replace]\nRate too high: "Sir, the rate depends on your CIBIL and income profile. Let me check the best rate available for you — shall I proceed?"\nNeed to think: "Of course sir, take your time. Can I call you tomorrow at a convenient time to answer any questions?"',
  eligibilityRules: '[EXAMPLE — replace] Age: 21–58 years. Min CIBIL: 700. Employment: Salaried, minimum 6 months in current job. FOIR: max 60%. ITR required for self-employed.',
};

const QUICK_OBJECTIONS = [
  'Rate is too high',
  'Processing fee is too much',
  "I'll think about it",
  'I already have a loan',
  'Need to ask my family',
  'Call me later',
  'How fast is disbursal?',
  'Is my CIBIL enough?',
];

const CONFIDENCE_STYLE = {
  high:   { background: '#d1fae5', color: '#065f46' },
  medium: { background: '#f3f4f6', color: '#374151' },
  low:    { background: '#fef3c7', color: '#92400e' },
};

export default function CallAssist() {
  const [activeTab, setActiveTab] = useState('assist');

  // Knowledge base — editable in Setup tab
  const [kb, setKb] = useState(DEFAULT_KB);

  // Assist tab state
  const [question, setQuestion]   = useState('');
  const [history, setHistory]     = useState([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [result, setResult]       = useState(null);

  // Eligibility tab state
  const [income, setIncome]         = useState('');
  const [existingEmi, setExistingEmi] = useState('');
  const [rate, setRate]             = useState('12');
  const [tenure, setTenure]         = useState('48');
  const [foir, setFoir]             = useState('50');

  // ── Build the system prompt from the current knowledge base ─────────────────
  const buildSystem = () =>
    `You are "Call Assist", a real-time helper for a sales agent at an Indian personal-loan DSA. The agent is on a LIVE phone call and needs a ready-to-speak answer fast.

Use ONLY the knowledge base below. Do NOT invent interest rates, fees, eligibility numbers, or policies that are not present. If the customer's question is not covered by the knowledge base, set "needsManager" to true and give a safe holding line (offer to confirm the exact detail and call back).

Style: short, natural, confident phone language an Indian loan agent would actually speak. Hinglish is fine if it fits. Keep "say" to 1-3 sentences. No markdown.

KNOWLEDGE BASE
== SCRIPT ==
${kb.script}
== POLICIES ==
${kb.policies}
== USPs ==
${kb.usps}
== REBUTTALS ==
${kb.rebuttals}
== ELIGIBILITY RULES ==
${kb.eligibilityRules}

Respond with ONLY a JSON object, no preamble, no code fences:
{"say": "...", "followUp": "...", "note": "...", "confidence": "high|medium|low", "needsManager": false}`;

  // ── Send a question to the AI ────────────────────────────────────────────────
  const sendQuestion = async (override) => {
    const text = (override !== undefined ? override : question).trim();
    if (!text || loading) return;

    setLoading(true);
    setError('');
    setResult(null);

    // append new user turn and keep last 8 messages for context
    const newHistory = [...history, { role: 'user', content: `Customer said: "${text}"` }].slice(-8);

    try {
      const res = await fetch('/api/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: buildSystem(), messages: newHistory }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      const raw = (data.content || []).map(b => b.text || '').join('');
      const stripped = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
      let parsed;
      try {
        parsed = JSON.parse(stripped);
      } catch {
        parsed = { say: raw, followUp: '', note: '', confidence: 'low', needsManager: false };
      }

      setResult(parsed);
      setHistory([...newHistory, { role: 'assistant', content: raw }]);
    } catch (e) {
      setError(e.message || 'Something went wrong. Check your API key and try again.');
    } finally {
      setLoading(false);
      setQuestion('');
    }
  };

  // ── Deterministic eligibility calculation ────────────────────────────────────
  const eligibility = (() => {
    const inc = parseFloat(income) || 0;
    if (inc <= 0) return null;
    const emi = parseFloat(existingEmi) || 0;
    const r   = parseFloat(rate) / 12 / 100;
    const n   = parseInt(tenure) || 0;
    const f   = parseFloat(foir) / 100;
    const maxEmi = inc * f - emi;
    if (maxEmi <= 0) return null;
    if (n <= 0)     return null;
    const pow  = Math.pow(1 + r, n);
    const loan = r > 0 ? maxEmi * ((pow - 1) / (r * pow)) : maxEmi * n;
    return {
      maxEmi: Math.round(maxEmi),
      loan:   Math.round(loan / 1000) * 1000,
      foirUsed: f * 100,
    };
  })();

  // ── Styles ──────────────────────────────────────────────────────────────────
  const tabBtn = (t) => ({
    padding: '9px 18px',
    background: activeTab === t ? BLUE : '#f0f4fa',
    color: activeTab === t ? '#fff' : '#48506b',
    border: 'none',
    borderRadius: '8px',
    fontWeight: 600,
    fontSize: '13px',
    cursor: 'pointer',
  });

  const ConfidenceBadge = ({ c }) => {
    const s = CONFIDENCE_STYLE[c] || CONFIDENCE_STYLE.medium;
    return (
      <span style={{ ...s, padding: '2px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
        {c || 'medium'}
      </span>
    );
  };

  const SItem = ({ label, value }) => (
    <div style={{ padding: '10px 12px', background: '#f7f9fc', borderRadius: '8px', border: '1px solid #eef2f7' }}>
      <div style={{ fontSize: '11px', color: '#7a8194', fontWeight: 600, marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '16px', fontWeight: 700, color: '#1a1a2e' }}>{value}</div>
    </div>
  );

  return (
    <div style={{ padding: '20px', fontFamily: 'Inter, Arial, sans-serif', background: '#f4f6f9', minHeight: '100vh', color: '#1a1a2e' }}>

      {/* Page header */}
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800 }}>Call Assist</h2>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#7a8194' }}>AI helper for live loan sales calls</p>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <button style={tabBtn('assist')}      onClick={() => setActiveTab('assist')}>Assist</button>
        <button style={tabBtn('eligibility')} onClick={() => setActiveTab('eligibility')}>Eligibility</button>
        <button style={tabBtn('setup')}       onClick={() => setActiveTab('setup')}>Setup</button>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/*  ASSIST TAB                                                           */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'assist' && (
        <div>
          {/* Quick objection chips */}
          <div style={card}>
            <div style={cardHeader}>Quick Objections — tap to send</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {QUICK_OBJECTIONS.map(obj => (
                <button
                  key={obj}
                  disabled={loading}
                  style={{
                    padding: '7px 13px',
                    background: '#eef2fb',
                    color: BLUE,
                    border: '1px solid #c8d8f0',
                    borderRadius: '99px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    opacity: loading ? 0.6 : 1,
                  }}
                  onClick={() => sendQuestion(obj)}
                >
                  {obj}
                </button>
              ))}
            </div>
          </div>

          {/* Free-text input */}
          <div style={card}>
            <div style={cardHeader}>What did the customer say?</div>
            <textarea
              style={{ ...inp, minHeight: '72px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
              placeholder="e.g. tumhare rate bahut zyada hai"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQuestion(); }
              }}
            />
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
              <button style={{ ...btnPri, opacity: loading ? 0.7 : 1 }} onClick={() => sendQuestion()} disabled={loading}>
                {loading ? '⏳ Getting answer…' : '⚡ Get Answer'}
              </button>
              <button
                style={btnSec}
                onClick={() => { setHistory([]); setResult(null); setError(''); setQuestion(''); }}
              >
                New call
              </button>
              {history.length > 0 && (
                <span style={{ fontSize: '11px', color: '#9aa1b2', marginLeft: 'auto' }}>
                  {Math.floor(history.length / 2)} exchange{history.length > 2 ? 's' : ''} in this call
                </span>
              )}
            </div>
            {error && (
              <div style={{ marginTop: '10px', padding: '10px 12px', background: '#fef2f2', borderRadius: '7px', color: '#b91c1c', fontSize: '13px' }}>
                ⚠ {error}
              </div>
            )}
          </div>

          {/* AI result cards */}
          {result && (
            <div>
              {/* "Say this" card */}
              <div style={{
                ...card,
                border: result.needsManager ? '2px solid #f59e0b' : '2px solid #93c5fd',
                background: result.needsManager ? '#fffbeb' : '#f0f7ff',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '6px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: result.needsManager ? '#92400e' : BLUE, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {result.needsManager ? '⚠ Not in script' : '💬 Say this'}
                  </span>
                  <ConfidenceBadge c={result.confidence} />
                </div>
                <div style={{ fontSize: '17px', fontWeight: 700, lineHeight: 1.55, color: '#1a1a2e' }}>
                  {result.say}
                </div>
                {result.needsManager && (
                  <div style={{ marginTop: '10px', padding: '8px 12px', background: '#fef3c7', borderRadius: '7px', fontSize: '12px', color: '#92400e', fontWeight: 600 }}>
                    Not in your script — confirm with your TL before promising anything.
                  </div>
                )}
              </div>

              {/* "If they push back" card */}
              {result.followUp && (
                <div style={{ ...card, background: '#f7f9fc' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#7a8194', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
                    If they push back
                  </div>
                  <div style={{ fontSize: '14px', color: '#1a1a2e', lineHeight: 1.55 }}>{result.followUp}</div>
                </div>
              )}

              {/* Note line */}
              {result.note && (
                <div style={{ fontSize: '12px', color: '#7a8194', padding: '0 4px 10px' }}>📝 {result.note}</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/*  ELIGIBILITY TAB                                                      */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'eligibility' && (
        <div>
          <div style={card}>
            <h3 style={cardHeader}>Quick Eligibility Check</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
              <div>
                <label style={lbl}>Net Monthly Income (₹)</label>
                <input style={inp} value={income} onChange={e => setIncome(e.target.value)} placeholder="e.g. 50000" />
              </div>
              <div>
                <label style={lbl}>Existing EMIs (₹/month)</label>
                <input style={inp} value={existingEmi} onChange={e => setExistingEmi(e.target.value)} placeholder="e.g. 5000" />
              </div>
              <div>
                <label style={lbl}>Interest Rate (% p.a.)</label>
                <input style={inp} value={rate} onChange={e => setRate(e.target.value)} placeholder="12" />
              </div>
              <div>
                <label style={lbl}>Tenure (months)</label>
                <input style={inp} value={tenure} onChange={e => setTenure(e.target.value)} placeholder="48" />
              </div>
              <div>
                <label style={lbl}>FOIR Cap (%)</label>
                <input style={inp} value={foir} onChange={e => setFoir(e.target.value)} placeholder="50" />
              </div>
            </div>
          </div>

          {income && !eligibility && (
            <div style={{ ...card, background: '#fef2f2', border: '1px solid #fecaca' }}>
              <div style={{ fontWeight: 700, color: '#b91c1c' }}>Not eligible at this FOIR</div>
              <div style={{ fontSize: '12px', color: '#b91c1c', marginTop: '4px' }}>
                Existing EMIs already meet or exceed the FOIR limit. Customer may need to reduce obligations first.
              </div>
            </div>
          )}

          {eligibility && (
            <div>
              <div style={{ ...card, border: `2px solid ${BLUE}`, background: '#f0f7ff' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: BLUE, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
                  Eligible Loan Amount
                </div>
                <div style={{ fontSize: '34px', fontWeight: 800, color: BLUE }}>
                  ₹{eligibility.loan.toLocaleString('en-IN')}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '14px' }}>
                <SItem label="Max Affordable EMI" value={`₹${eligibility.maxEmi.toLocaleString('en-IN')}/mo`} />
                <SItem label="FOIR Used" value={`${eligibility.foirUsed}%`} />
                <SItem label="Rate / Tenure" value={`${rate}% · ${tenure} mo`} />
              </div>
              <div style={{ fontSize: '11px', color: '#9aa1b2' }}>
                Indicative only. Final eligibility depends on the bank's credit policy and CIBIL.
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/*  SETUP TAB                                                             */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'setup' && (
        <div style={card}>
          <h3 style={cardHeader}>Knowledge Base Setup</h3>
          <p style={{ fontSize: '12px', color: '#7a8194', marginBottom: '20px', marginTop: '-6px', lineHeight: 1.6 }}>
            The assistant answers only from this. Replace the example text with your real content.
          </p>
          {[
            ['script',           'Call Script'],
            ['policies',         'Loan Policies'],
            ['usps',             'USPs / Key Selling Points'],
            ['rebuttals',        'Objection Rebuttals'],
            ['eligibilityRules', 'Eligibility Rules'],
          ].map(([key, label]) => (
            <div key={key} style={{ marginBottom: '18px' }}>
              <label style={lbl}>{label}</label>
              <textarea
                style={{ ...inp, minHeight: '90px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
                value={kb[key]}
                onChange={e => setKb(prev => ({ ...prev, [key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
