// Shared visual constants for calculator-style tool pages (CAM Builder, Underwriting Desk).
// Moved out of CamCalculator.js unchanged, so both pages look the same.
import React from 'react';

export const BLUE = '#185FA5';

export const page = { padding: '24px', fontFamily: 'Inter, Arial, sans-serif', background: '#f4f6f9', minHeight: '100vh', color: '#1a1a2e' };
export const pageTitle = { margin: 0, fontSize: '20px', fontWeight: 800 };
export const pageSubtitle = { margin: '4px 0 0', fontSize: '13px', color: '#7a8194' };

export const card = { background: '#fff', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.07)', marginBottom: '18px' };
export const cardHeader = { margin: '0 0 16px', fontSize: '15px', color: '#333', fontWeight: 700 };
export const lbl = { fontSize: '12px', fontWeight: 600, color: '#555', marginBottom: '6px', display: 'block' };
export const inp = { width: '100%', padding: '8px 10px', border: '1px solid #dde3ee', borderRadius: '6px', fontSize: '13px', outline: 'none', boxSizing: 'border-box', background: '#fafbfe' };
export const cellInp = { width: '100%', padding: '6px 7px', border: '1px solid #dde3ee', borderRadius: '5px', fontSize: '12px', boxSizing: 'border-box', background: '#fff', outline: 'none' };
export const cellSel = { ...cellInp, cursor: 'pointer' };
export const th = { padding: '9px 7px', fontSize: '11px', fontWeight: 700, color: '#48506b', textAlign: 'left', background: '#f0f4fa', borderBottom: '2px solid #dde3ee', whiteSpace: 'nowrap' };
export const td = { padding: '5px 6px', borderBottom: '1px solid #eef2f7', verticalAlign: 'middle' };
export const btnPri = { padding: '9px 16px', background: BLUE, color: '#fff', border: 'none', borderRadius: '7px', fontWeight: 600, fontSize: '13px', cursor: 'pointer' };
export const btnSec = { padding: '9px 16px', background: '#fff', color: BLUE, border: '1px solid #cdd8ea', borderRadius: '7px', fontWeight: 600, fontSize: '13px', cursor: 'pointer' };

// Compact variants for buttons inside tables / small panels (not used by CAM Builder).
export const btnSecSm = { ...btnSec, padding: '5px 10px', fontSize: '12px' };
export const btnPriSm = { ...btnPri, padding: '5px 10px', fontSize: '12px' };
export const btnLink = { background: 'none', border: 'none', padding: 0, color: BLUE, fontWeight: 600, fontSize: '13px', cursor: 'pointer' };

// Summary tile: label, value, optional sub line; `strong` = the headline figure.
export function SItem({ label, value, sub, strong }) {
  return (
    <div style={{ padding: '10px 12px', background: '#f7f9fc', borderRadius: '8px', border: '1px solid #eef2f7' }}>
      <div style={{ fontSize: '11px', color: '#7a8194', fontWeight: 600, marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: strong ? '18px' : '14px', fontWeight: 700, color: strong ? BLUE : '#1a1a2e' }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: '#7a8194', marginTop: '2px' }}>{sub}</div>}
    </div>
  );
}

// Red tile CAM Builder shows when BT outstanding exceeds the eligible amount.
export function NotEligibleTile({ label, sub }) {
  return (
    <div style={{ padding: '10px 12px', background: '#fef2f2', borderRadius: '8px', border: '1px solid #fecaca' }}>
      <div style={{ fontSize: '11px', color: '#b91c1c', fontWeight: 600, marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '18px', fontWeight: 800, color: '#dc2626' }}>Not Eligible</div>
      {sub && <div style={{ fontSize: '11px', color: '#b91c1c', marginTop: '2px' }}>{sub}</div>}
    </div>
  );
}
