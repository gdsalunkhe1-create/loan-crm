// CibilBankReconciliation.js — fetches a lead's saved CIBIL report
// (customer_cibil_data) and saved bank statement analysis
// (customer_bank_statement_data) directly from Supabase by lead_id, runs
// the reconciliation + debt-stress pipeline, and renders the result.
//
// This matches the app's real, already-established pattern: CibilParser.js
// saves to customer_cibil_data keyed by lead_id (one row per lead, upsert
// on conflict), and SaveBsaToLead.js saves bank statement results to
// customer_bank_statement_data the same way. This component just reads
// both back for one lead - it doesn't need props threaded down from
// wherever the parsing originally happened.
//
// Usage (anywhere a leadId is in scope - the lead detail panel in
// Leads.js, a Documents tab, etc.):
//   <CibilBankReconciliation leadId={selectedLead.id} />

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../supabase';
import { reconcileCibilVsBank, computeDebtStressPipeline } from '../utils/cibilReconciliation';
import { downloadBsaWorkbook } from '../utils/bsaExcelExport';

const inr = n => 'Rs.' + (Number(n) || 0).toLocaleString('en-IN');

const S = {
  wrap: { border: '1px solid #E2E8F0', borderRadius: 10, padding: 20, marginTop: 16, background: '#fff' },
  hdr: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  ttl: { fontSize: 16, fontWeight: 700, color: '#1A202C', margin: 0 },
  btn: (bg, fg = '#fff') => ({ background: bg, color: fg, border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }),
  card: { flex: 1, background: '#F7FAFC', borderRadius: 8, padding: 12, textAlign: 'center' },
  cardRow: { display: 'flex', gap: 12, marginBottom: 16 },
  cardVal: (color) => ({ fontSize: 22, fontWeight: 700, color: color || '#1A202C' }),
  cardLbl: { fontSize: 11, color: '#718096', marginTop: 4 },
  section: { fontSize: 13, fontWeight: 700, color: '#1A202C', margin: '16px 0 8px' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #E2E8F0', color: '#718096', fontWeight: 600 },
  td: { padding: '6px 8px', borderBottom: '1px solid #F1F5F9' },
  badge: (bg, fg) => ({ background: bg, color: fg, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600 }),
  empty: { color: '#A0AEC0', fontSize: 13, padding: '20px 0', textAlign: 'center' },
};

const SEVERITY_COLOR = { HIGH: ['#FEF2F2', '#DC2626'], MEDIUM: ['#FFFBEB', '#B45309'], LOW: ['#F0FFF4', '#276749'] };
const RISK_COLOR = { CRITICAL: ['#FEF2F2', '#DC2626'], HIGH: ['#FEF2F2', '#DC2626'], MEDIUM: ['#FFFBEB', '#B45309'], LOW: ['#F0FFF4', '#276749'] };

export default function CibilBankReconciliation({ leadId }) {
  const [showAllFlags, setShowAllFlags] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cibilRow, setCibilRow] = useState(null);
  const [bsaRow, setBsaRow] = useState(null);

  useEffect(() => {
    if (!leadId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      supabase.from('customer_cibil_data').select('*').eq('lead_id', leadId).maybeSingle(),
      supabase.from('customer_bank_statement_data').select('*').eq('lead_id', leadId).maybeSingle(),
    ]).then(([cibilRes, bsaRes]) => {
      if (cancelled) return;
      setCibilRow(cibilRes.data || null);
      setBsaRow(bsaRes.data || null);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [leadId]);

  const cibilAccounts = cibilRow?.accounts || null;
  const bsaResult = bsaRow?.result || null;
  const ready = Array.isArray(cibilAccounts) && cibilAccounts.length > 0 && bsaResult && Array.isArray(bsaResult.emi_obligations);

  const { reconciliation, pipeline } = useMemo(() => {
    if (!ready) return { reconciliation: null, pipeline: null };
    const recon = reconcileCibilVsBank(cibilAccounts, bsaResult.emi_obligations, bsaResult.summary?.statement_period);
    const pipe = computeDebtStressPipeline(cibilAccounts, recon, bsaResult.credit_assessment?.estimated_monthly_income || 0, null);
    return { reconciliation: recon, pipeline: pipe };
  }, [ready, cibilAccounts, bsaResult]);

  if (loading) {
    return (
      <div style={S.wrap}>
        <h3 style={S.ttl}>CIBIL ↔ Bank Statement Reconciliation</h3>
        <div style={S.empty}>Loading saved reports for this lead...</div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div style={S.wrap}>
        <h3 style={S.ttl}>CIBIL ↔ Bank Statement Reconciliation</h3>
        <div style={S.empty}>
          {!cibilAccounts?.length ? 'No CIBIL report saved for this lead yet.' : 'No bank statement analysis saved for this lead yet.'}
          {' '}Both need to be saved to this lead before reconciliation can run.
        </div>
      </div>
    );
  }

  const flags = reconciliation.reconciliation_flags || [];
  const visibleFlags = showAllFlags ? flags : flags.slice(0, 5);
  const risk = pipeline.underwriting_risk;
  const [riskBg, riskFg] = RISK_COLOR[risk] || RISK_COLOR.LOW;

  return (
    <div style={S.wrap}>
      <div style={S.hdr}>
        <h3 style={S.ttl}>CIBIL ↔ Bank Statement Reconciliation</h3>
        <button style={S.btn('#185FA5')} onClick={() => downloadBsaWorkbook(bsaResult, { reconciliation, pipeline })}>
          📊 Download Excel (with CIBIL sheet)
        </button>
      </div>

      <div style={S.cardRow}>
        <div style={S.card}>
          <div style={S.cardVal('#0F6E56')}>{reconciliation.matched.length}</div>
          <div style={S.cardLbl}>Matched</div>
        </div>
        <div style={S.card}>
          <div style={S.cardVal('#DC2626')}>{reconciliation.unmatched_cibil.length}</div>
          <div style={S.cardLbl}>CIBIL-only</div>
        </div>
        <div style={S.card}>
          <div style={S.cardVal('#B45309')}>{reconciliation.unmatched_bank.length}</div>
          <div style={S.cardLbl}>Bank-only</div>
        </div>
        <div style={S.card}>
          <div style={S.cardVal(riskFg)}>{pipeline.liquidity_stress_score}</div>
          <div style={S.cardLbl}>Stress Score /100</div>
        </div>
        <div style={S.card}>
          <span style={S.badge(riskBg, riskFg)}>{risk}</span>
          <div style={S.cardLbl}>{pipeline.recommendation}</div>
        </div>
      </div>

      {flags.length > 0 && (
        <>
          <div style={S.section}>Reconciliation Flags ({flags.length})</div>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Type</th>
                <th style={S.th}>Lender / Party</th>
                <th style={S.th}>Monthly Amt</th>
                <th style={S.th}>Possible Causes</th>
              </tr>
            </thead>
            <tbody>
              {visibleFlags.map((f, i) => {
                const [bg, fg] = SEVERITY_COLOR[f.severity] || SEVERITY_COLOR.MEDIUM;
                return (
                  <tr key={i}>
                    <td style={S.td}><span style={S.badge(bg, fg)}>{f.type === 'CIBIL_OBLIGATION_NOT_IN_BANK' ? 'CIBIL not in bank' : 'Bank not in CIBIL'}</span></td>
                    <td style={S.td}>{f.lender}</td>
                    <td style={S.td}>{inr(f.monthly_obligation)}</td>
                    <td style={{ ...S.td, color: '#718096', fontSize: 11 }}>{(f.possible_causes || []).join(' · ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {flags.length > 5 && (
            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <span style={{ color: '#185FA5', cursor: 'pointer', fontSize: 12 }} onClick={() => setShowAllFlags(!showAllFlags)}>
                {showAllFlags ? 'Show less' : `Show all ${flags.length}`}
              </span>
            </div>
          )}
        </>
      )}

      <div style={S.section}>Debt-Stress Pipeline</div>
      <table style={S.table}>
        <tbody>
          <tr><td style={{ ...S.td, color: '#718096' }}>1. Multiple Small Loan Detection</td><td style={S.td}>{pipeline.small_loan_detection.count} small/short-tenure loan(s) active</td></tr>
          <tr><td style={{ ...S.td, color: '#718096' }}>2. Loan Stacking</td><td style={S.td}>{pipeline.loan_stacking.total_active_obligations} active obligation(s) — {pipeline.loan_stacking.flagged ? <span style={S.badge('#FEF2F2', '#DC2626')}>FLAGGED</span> : 'not flagged'}</td></tr>
          <tr><td style={{ ...S.td, color: '#718096' }}>3. Borrowing Frequency</td><td style={S.td}>{pipeline.borrowing_frequency.avg_days_between_new_loans != null ? `Avg ${pipeline.borrowing_frequency.avg_days_between_new_loans} days between new small loans` : 'Not enough data'} — {pipeline.borrowing_frequency.flagged ? <span style={S.badge('#FEF2F2', '#DC2626')}>FLAGGED</span> : 'not flagged'}</td></tr>
          <tr><td style={{ ...S.td, color: '#718096' }}>4. Debt Cycle Events</td><td style={S.td}>{pipeline.debt_cycle_events.length} possible rollover/refinance event(s)</td></tr>
          <tr><td style={{ ...S.td, color: '#718096' }}>5. Total Monthly Obligation</td><td style={{ ...S.td, fontWeight: 700 }}>{inr(pipeline.total_monthly_obligation)} (FOIR incl. unreported: {pipeline.foir_including_unreported}%)</td></tr>
        </tbody>
      </table>

      {pipeline.debt_cycle_events.length > 0 && (
        <>
          <div style={S.section}>Debt Cycle Events</div>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Closed Lender</th>
                <th style={S.th}>Closed Date</th>
                <th style={S.th}>New Lender</th>
                <th style={S.th}>New Open Date</th>
                <th style={S.th}>Gap</th>
              </tr>
            </thead>
            <tbody>
              {pipeline.debt_cycle_events.map((e, i) => (
                <tr key={i}>
                  <td style={S.td}>{e.closed_lender}</td>
                  <td style={S.td}>{e.closed_date}</td>
                  <td style={S.td}>{e.new_lender}</td>
                  <td style={S.td}>{e.new_open_date}</td>
                  <td style={S.td}>{e.gap_days}d</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
