import React, { useState, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';

const BLUE = '#185FA5';

const fmt  = n => Math.round(+n || 0).toLocaleString('en-IN');
const fmtL = n => ((+n || 0) / 100000).toFixed(2) + ' L';
const pct  = v => ((+v || 0) * 100).toFixed(1) + '%';

const LOAN_TYPES   = ['Personal Loan', 'Credit Card', 'Property Loan', 'Housing Loan', 'Mortgage Loan', 'Consumer Loan', 'Gold Loan', 'Car Loan', 'Other'];
const OWNERSHIP    = ['Individual', 'Joint'];
const STATUSES     = ['Live', 'Closed', 'BT'];
const PAID_BY      = ['Self', 'Both', 'Co-applicant'];
const PAID_BY_TYPES = ['Housing Loan', 'Mortgage Loan', 'Property Loan'];

function obligatedEMI(row) {
  const emi = +row.emi || 0;
  const out = +row.outstanding || 0;
  if (row.status === 'Closed') return { val: 0, reason: 'Closed' };
  if (row.status === 'BT')     return { val: 0, reason: 'BT — 0%' };
  if (row.loanType === 'Credit Card') return { val: out * 0.05, reason: '5% of o/s' };
  if (row.loanType === 'Gold Loan')   return { val: out * 0.01, reason: '1% of o/s' };
  const rem = (row.remEmi !== '' && row.remEmi != null) ? +row.remEmi : (emi > 0 ? Math.floor(out / emi) : 0);
  if (rem < 3) return { val: 0, reason: '< 3 EMIs left' };
  if (PAID_BY_TYPES.includes(row.loanType)) {
    if (row.paidBy === 'Co-applicant') return { val: 0,         reason: 'Co-applicant 0%' };
    if (row.paidBy === 'Both')         return { val: emi * 0.5, reason: 'Both 50%' };
    return { val: emi, reason: 'Self 100%' };
  }
  return { val: emi, reason: '100% EMI' };
}

const clean = v => String(v == null ? '' : v).replace(/[^0-9]/g, '');
const isClosedStatus = s => /closed|settled|written/i.test(s || '');
const mapCibilType = (t = '') => {
  const s = t.toLowerCase();
  if (s.includes('credit card')) return 'Credit Card';
  if (s.includes('gold')) return 'Gold Loan';
  if (s.includes('property') || s.includes('against property') || s.includes('lap')) return 'Property Loan';
  if (s.includes('home') || s.includes('housing') || s.includes('mortgage')) return 'Housing Loan';
  if (s.includes('personal')) return 'Personal Loan';
  if (s.includes('consumer')) return 'Consumer Loan';
  if (s.includes('auto') || s.includes('car')) return 'Car Loan';
  return 'Other';
};
const cibilToRow = a => ({
  id: Date.now() + Math.random(),
  financier: a.bankName || '',
  ownership: 'Individual',
  loanType: mapCibilType(a.loanType),
  status: 'Live',
  loanAmount: clean(a.loanAmount),
  outstanding: clean(a.outstanding),
  emi: clean(a.emi),
  remEmi: '',
  paidBy: 'Self',
});

const emptyRow = () => ({
  id: Date.now() + Math.random(),
  financier: '', ownership: 'Individual', loanType: 'Personal Loan',
  status: 'Live', loanAmount: '', outstanding: '', emi: '', remEmi: '', paidBy: 'Self',
});

const card = { background: '#fff', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.07)', marginBottom: '18px' };
const cardHeader = { margin: '0 0 16px', fontSize: '15px', color: '#333', fontWeight: 700 };
const lbl = { fontSize: '12px', fontWeight: 600, color: '#555', marginBottom: '6px', display: 'block' };
const inp = { width: '100%', padding: '8px 10px', border: '1px solid #dde3ee', borderRadius: '6px', fontSize: '13px', outline: 'none', boxSizing: 'border-box', background: '#fafbfe' };
const cellInp = { width: '100%', padding: '6px 7px', border: '1px solid #dde3ee', borderRadius: '5px', fontSize: '12px', boxSizing: 'border-box', background: '#fff', outline: 'none' };
const cellSel = { ...cellInp, cursor: 'pointer' };
const th = { padding: '9px 7px', fontSize: '11px', fontWeight: 700, color: '#48506b', textAlign: 'left', background: '#f0f4fa', borderBottom: '2px solid #dde3ee', whiteSpace: 'nowrap' };
const td = { padding: '5px 6px', borderBottom: '1px solid #eef2f7', verticalAlign: 'middle' };
const btnPri = { padding: '9px 16px', background: BLUE, color: '#fff', border: 'none', borderRadius: '7px', fontWeight: 600, fontSize: '13px', cursor: 'pointer' };
const btnSec = { padding: '9px 16px', background: '#fff', color: BLUE, border: '1px solid #cdd8ea', borderRadius: '7px', fontWeight: 600, fontSize: '13px', cursor: 'pointer' };

const COLS = [
  ['Financier', 130], ['Ownership', 95], ['Loan Type', 120], ['Status', 80],
  ['Loan Amt', 95], ['Outstanding', 100], ['EMI', 85], ['Rem. EMI', 72],
  ['Paid By', 105], ['Obligated EMI', 100], ['Reason', 110],
];

export default function CamCalculator({ userRole, userId }) {
  const [obligations, setObligations] = useState([emptyRow()]);
  const [customerName, setCustomerName] = useState('');

  const [netSalary, setNetSalary] = useState('');
  const [variableIncome, setVariableIncome] = useState('');

  const [bankName, setBankName] = useState('');
  const [foirManual, setFoirManual] = useState('');
  const [multiplier, setMultiplier] = useState('');
  const [rateAnnual, setRateAnnual] = useState('9.99');
  const [tenureMonths, setTenureMonths] = useState('60');

  const [requiredAmount, setRequiredAmount] = useState('');

  const updateRow = (id, field, value) => setObligations(p => p.map(r => r.id === id ? { ...r, [field]: value } : r));
  const addRow = () => setObligations(p => [...p, emptyRow()]);
  const clearRows = () => setObligations([emptyRow()]);

  const importFromCibil = () => {
    try {
      const raw = sessionStorage.getItem('cam_import_payload') || sessionStorage.getItem('cam_import_accounts');
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      const accounts = Array.isArray(parsed) ? parsed : (parsed.accounts || []);
      const active = accounts.filter(a => !isClosedStatus(a.status));
      if (!active.length) return false;
      setObligations(active.map(cibilToRow));
      if (!Array.isArray(parsed) && parsed.customerName) setCustomerName(parsed.customerName);
      return true;
    } catch (e) { console.error('CAM import failed', e); return false; }
  };
  useEffect(() => {
    if (importFromCibil()) {
      sessionStorage.removeItem('cam_import_payload');
      sessionStorage.removeItem('cam_import_accounts');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const calc = useMemo(() => {
    const net = +netSalary || 0;
    const varInc = +variableIncome || 0;
    const income = net + varInc;

    const foir = (parseFloat(foirManual) || 0) / 100;
    const mult = parseFloat(multiplier) || 0;
    const r = (parseFloat(rateAnnual) || 0) / 1200;
    const n = parseInt(tenureMonths) || 0;

    const rows = obligations.map(row => {
      const o = obligatedEMI(row);
      return { ...row, obligatedVal: o.val, obligatedReason: o.reason };
    });
    const totalOblExclBT = rows.reduce((s, x) => s + x.obligatedVal, 0);

    const maxEMICapacity = foir * income;
    const balanceEMI = Math.max(0, maxEMICapacity - totalOblExclBT);

    const annuity = (emi) => r > 0 ? emi * (1 - Math.pow(1 + r, -n)) / r : emi * n;
    const emiOf = (P) => r > 0 ? P * r / (1 - Math.pow(1 + r, -n)) : (n > 0 ? P / n : 0);

    const foirEligible = Math.max(0, Math.round(annuity(balanceEMI) / 10000) * 10000);
    const multEligible = mult > 0 ? Math.max(0, Math.round((mult * income) / 10000) * 10000) : null;
    const totalEligibility = multEligible != null ? Math.min(foirEligible, multEligible) : foirEligible;

    const reqAmt = +requiredAmount || 0;
    const offered = reqAmt > 0 ? Math.min(reqAmt, totalEligibility) : totalEligibility;
    const offeredEMI = emiOf(offered);
    const requiredEMI = emiOf(reqAmt);

    const btRows = obligations.filter(x => x.status === 'BT');
    const btPOS = btRows.reduce((s, x) => s + (+x.outstanding || 0), 0);
    const btPL = btRows.filter(x => x.loanType === 'Personal Loan').length;
    const btCard = btRows.filter(x => x.loanType === 'Credit Card').length;
    const btOther = btRows.length - btPL - btCard;
    const btNotEligible = btPOS > totalEligibility;
    const amountInHand = offered - btPOS;

    const resultingFOIR = income > 0 ? (totalOblExclBT + offeredEMI) / income : 0;

    return {
      net, varInc, income, foir, mult, r, n,
      rows, totalOblExclBT, maxEMICapacity, balanceEMI,
      foirEligible, multEligible, totalEligibility, reqAmt, offered, offeredEMI, requiredEMI,
      btPOS, btPL, btCard, btOther, btCount: btRows.length, amountInHand, btNotEligible, resultingFOIR,
    };
  }, [obligations, netSalary, variableIncome, foirManual, multiplier, rateAnnual, tenureMonths, requiredAmount]);

  const buildSummaryRows = () => ([
    ['Applying to (Bank / NBFC)', bankName || ''],
    ['Customer', customerName || ''],
    ['Net Salary', calc.net],
    ['Variable Income', calc.varInc],
    ['Total Considered Income', calc.income],
    ['Applicable FOIR', pct(calc.foir)],
    ['Income Multiplier (x net/month)', calc.mult || ''],
    ['Rate of Interest (%)', rateAnnual],
    ['Tenure (months)', tenureMonths],
    ['Total Obligation (excl BT)', Math.round(calc.totalOblExclBT)],
    ['FOIR Eligibility', calc.foirEligible],
    ['Multiplier Eligibility', calc.multEligible != null ? calc.multEligible : 'N/A'],
    ['Total Eligibility (lower of two)', calc.totalEligibility],
    ['Required Amount', calc.reqAmt],
    ['EMI for Required Amount', Math.round(calc.requiredEMI)],
    ['Recommended / Offered Amount', calc.offered],
    ['Offered EMI', Math.round(calc.offeredEMI)],
    ['Monthly EMI (applied amount)', Math.round(calc.reqAmt > 0 ? calc.requiredEMI : calc.offeredEMI)],
    ['BT POS (existing loan amount total)', Math.round(calc.btPOS)],
    ['BT taken over', `${calc.btPL} PL + ${calc.btCard} Card${calc.btOther ? ' + ' + calc.btOther + ' Other' : ''}`],
    ['Amount in hand after BT POS', calc.btNotEligible ? 'Not Eligible (BT POS > eligibility)' : Math.round(calc.amountInHand)],
  ]);

  const exportExcel = () => {
    const aoa = [];
    aoa.push(['Financier', 'Ownership', 'Loan Type', 'Status', 'Loan Amt', 'Outstanding', 'EMI', 'Rem. EMI', 'Paid By', 'Obligated EMI', 'Reason']);
    calc.rows.forEach(r => aoa.push([
      r.financier, r.ownership, r.loanType, r.status,
      +r.loanAmount || 0, +r.outstanding || 0, +r.emi || 0,
      r.remEmi === '' ? '' : (+r.remEmi || 0),
      PAID_BY_TYPES.includes(r.loanType) ? r.paidBy : '',
      Math.round(r.obligatedVal), r.obligatedReason,
    ]));
    aoa.push([]); aoa.push(['ELIGIBILITY SUMMARY']);
    buildSummaryRows().forEach(([k, v]) => aoa.push([k, v]));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 18 }, { wch: 11 }, { wch: 14 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 9 }, { wch: 12 }, { wch: 13 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'CAM');
    XLSX.writeFile(wb, `CAM_${(customerName || 'customer').replace(/[^\w]+/g, '_')}.xlsx`);
  };

  const exportCSV = () => {
    const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = [];
    lines.push(['Financier', 'Ownership', 'Loan Type', 'Status', 'Loan Amt', 'Outstanding', 'EMI', 'Rem. EMI', 'Paid By', 'Obligated EMI', 'Reason'].map(esc).join(','));
    calc.rows.forEach(r => lines.push([
      r.financier, r.ownership, r.loanType, r.status, +r.loanAmount || 0, +r.outstanding || 0, +r.emi || 0,
      r.remEmi === '' ? '' : (+r.remEmi || 0), PAID_BY_TYPES.includes(r.loanType) ? r.paidBy : '',
      Math.round(r.obligatedVal), r.obligatedReason,
    ].map(esc).join(',')));
    lines.push('');
    lines.push(esc('ELIGIBILITY SUMMARY'));
    buildSummaryRows().forEach(([k, v]) => lines.push([k, v].map(esc).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `CAM_${(customerName || 'customer').replace(/[^\w]+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const SItem = ({ label, value, sub, strong }) => (
    <div style={{ padding: '10px 12px', background: '#f7f9fc', borderRadius: '8px', border: '1px solid #eef2f7' }}>
      <div style={{ fontSize: '11px', color: '#7a8194', fontWeight: 600, marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: strong ? '18px' : '14px', fontWeight: 700, color: strong ? BLUE : '#1a1a2e' }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: '#7a8194', marginTop: '2px' }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ padding: '24px', fontFamily: 'Inter, Arial, sans-serif', background: '#f4f6f9', minHeight: '100vh', color: '#1a1a2e' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800 }}>CAM Builder</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#7a8194' }}>Credit assessment &amp; eligibility{customerName ? ` — ${customerName}` : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button style={btnSec} onClick={() => { if (!importFromCibil()) alert('No CIBIL report found. Open a CIBIL/PaisaBazaar report first and click "Build CAM from this report".'); }}>⬇ Import from CIBIL</button>
          <button style={btnSec} onClick={exportCSV}>⬇ CSV</button>
          <button style={btnPri} onClick={exportExcel}>⬇ Download Excel</button>
        </div>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ ...cardHeader, margin: 0 }}>Existing Obligations</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={btnSec} onClick={addRow}>+ Add Row</button>
            <button style={{ ...btnSec, color: '#a23b3b', borderColor: '#e6cccc' }} onClick={clearRows}>Clear all</button>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '1040px' }}>
            <colgroup>{COLS.map(([, w], i) => <col key={i} style={{ width: w + 'px' }} />)}</colgroup>
            <thead><tr>{COLS.map(([h], i) => <th key={i} style={{ ...th, textAlign: i >= 4 && i <= 9 ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
            <tbody>
              {calc.rows.map(r => {
                const showPaidBy = PAID_BY_TYPES.includes(r.loanType);
                return (
                  <tr key={r.id}>
                    <td style={td}><input style={cellInp} value={r.financier} onChange={e => updateRow(r.id, 'financier', e.target.value)} placeholder="Bank" /></td>
                    <td style={td}><select style={cellSel} value={r.ownership} onChange={e => updateRow(r.id, 'ownership', e.target.value)}>{OWNERSHIP.map(o => <option key={o}>{o}</option>)}</select></td>
                    <td style={td}><select style={cellSel} value={r.loanType} onChange={e => updateRow(r.id, 'loanType', e.target.value)}>{LOAN_TYPES.map(o => <option key={o}>{o}</option>)}</select></td>
                    <td style={td}><select style={cellSel} value={r.status} onChange={e => updateRow(r.id, 'status', e.target.value)}>{STATUSES.map(o => <option key={o}>{o}</option>)}</select></td>
                    <td style={td}><input style={{ ...cellInp, textAlign: 'right' }} value={r.loanAmount} onChange={e => updateRow(r.id, 'loanAmount', e.target.value)} placeholder="0" /></td>
                    <td style={td}><input style={{ ...cellInp, textAlign: 'right' }} value={r.outstanding} onChange={e => updateRow(r.id, 'outstanding', e.target.value)} placeholder="0" /></td>
                    <td style={td}><input style={{ ...cellInp, textAlign: 'right' }} value={r.emi} onChange={e => updateRow(r.id, 'emi', e.target.value)} placeholder="0" /></td>
                    <td style={td}><input style={{ ...cellInp, textAlign: 'right' }} value={r.remEmi} onChange={e => updateRow(r.id, 'remEmi', e.target.value)} placeholder="auto" /></td>
                    <td style={td}>{showPaidBy
                      ? <select style={cellSel} value={r.paidBy} onChange={e => updateRow(r.id, 'paidBy', e.target.value)}>{PAID_BY.map(o => <option key={o}>{o}</option>)}</select>
                      : <span style={{ fontSize: '12px', color: '#bcc3d2' }}>—</span>}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700, fontSize: '12px' }}>{fmt(r.obligatedVal)}</td>
                    <td style={{ ...td, fontSize: '11px', color: '#7a8194' }}>{r.obligatedReason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: '11px', color: '#9aa1b2', margin: '12px 0 0' }}>Imported from CIBIL: only active accounts are loaded. Mark the loan being transferred as <b>BT</b>, and set Paid By on housing/mortgage/property loans.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '18px' }}>
        <div style={card}>
          <h3 style={cardHeader}>Income Details</h3>
          <div style={{ marginBottom: '14px' }}>
            <label style={lbl}>Net Salary (₹/month)</label>
            <input style={inp} value={netSalary} onChange={e => setNetSalary(e.target.value)} placeholder="e.g. 100000" />
          </div>
          <div style={{ marginBottom: '14px' }}>
            <label style={lbl}>Variable Income (₹/month)</label>
            <input style={inp} value={variableIncome} onChange={e => setVariableIncome(e.target.value)} placeholder="incentive / rent" />
          </div>
          <div style={{ padding: '10px 12px', background: '#eef4fb', borderRadius: '8px', fontSize: '13px', color: BLUE, fontWeight: 700 }}>
            Total Considered Income: ₹{fmt(calc.income)}
          </div>
        </div>

        <div style={card}>
          <h3 style={cardHeader}>FOIR &amp; Loan Parameters</h3>
          <div style={{ marginBottom: '14px' }}>
            <label style={lbl}>Applying to (Bank / NBFC)</label>
            <input style={inp} value={bankName} onChange={e => setBankName(e.target.value)} placeholder="e.g. HDFC Bank" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div><label style={lbl}>FOIR (%)</label><input style={inp} value={foirManual} onChange={e => setFoirManual(e.target.value)} placeholder="e.g. 70" /></div>
            <div><label style={lbl}>Income Multiplier (× net/mo)</label><input style={inp} value={multiplier} onChange={e => setMultiplier(e.target.value)} placeholder="e.g. 20" /></div>
            <div><label style={lbl}>Rate of Interest (%)</label><input style={inp} value={rateAnnual} onChange={e => setRateAnnual(e.target.value)} placeholder="9.99" /></div>
            <div><label style={lbl}>Tenure (months)</label><input style={inp} value={tenureMonths} onChange={e => setTenureMonths(e.target.value)} placeholder="60" /></div>
          </div>
        </div>
      </div>

      <div style={card}>
        <h3 style={cardHeader}>Eligibility &amp; Recommended Amount</h3>
        <div style={{ marginBottom: '16px', maxWidth: '280px' }}>
          <label style={lbl}>Required Amount (₹)</label>
          <input style={inp} value={requiredAmount} onChange={e => setRequiredAmount(e.target.value)} placeholder="amount customer wants" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
          <SItem label="FOIR Eligibility" value={`₹${fmt(calc.foirEligible)}`} sub={`₹${fmtL(calc.foirEligible)}`} />
          <SItem label="Multiplier Eligibility" value={calc.multEligible != null ? `₹${fmt(calc.multEligible)}` : '—'} sub={calc.multEligible != null ? `₹${fmtL(calc.multEligible)}` : 'no multiplier set'} />
          <SItem label="Total Eligibility" value={`₹${fmt(calc.totalEligibility)}`} sub={`₹${fmtL(calc.totalEligibility)} · lower of the two`} strong />
          <SItem label="Required Amount" value={`₹${fmt(calc.reqAmt)}`} sub={calc.reqAmt > 0 ? `EMI ₹${fmt(calc.requiredEMI)}/mo` : ''} />

          <SItem label="Applicable FOIR" value={pct(calc.foir)} />
          <SItem label="Monthly EMI (applied amount)" value={`₹${fmt(calc.reqAmt > 0 ? calc.requiredEMI : calc.offeredEMI)}`} sub={`at ${rateAnnual}% · ${tenureMonths} mo`} strong />
          <SItem label="Total Obligated EMI" value={`₹${fmt(calc.totalOblExclBT)}`} sub={`from ${calc.rows.filter(r => r.obligatedVal > 0).length} live loan${calc.rows.filter(r => r.obligatedVal > 0).length !== 1 ? 's' : ''}`} />
          <SItem label="BT POS (existing total)" value={`₹${fmt(calc.btPOS)}`} sub={`${calc.btPL} PL + ${calc.btCard} Card${calc.btOther ? ' + ' + calc.btOther + ' Other' : ''}`} />
          {calc.btNotEligible
            ? <div style={{ padding: '10px 12px', background: '#fef2f2', borderRadius: '8px', border: '1px solid #fecaca' }}>
                <div style={{ fontSize: '11px', color: '#b91c1c', fontWeight: 600, marginBottom: '4px' }}>Amount in hand (after BT)</div>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#dc2626' }}>Not Eligible</div>
                <div style={{ fontSize: '11px', color: '#b91c1c', marginTop: '2px' }}>BT POS ₹{fmt(calc.btPOS)} &gt; eligibility ₹{fmt(calc.totalEligibility)}</div>
              </div>
            : <SItem label="Amount in hand (after BT)" value={`₹${fmt(calc.amountInHand)}`} strong />}
        </div>
      </div>
    </div>
  );
}
