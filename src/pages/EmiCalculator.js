import React, { useState, useMemo } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { IconFileTypePdf, IconFileSpreadsheet, IconBrandWhatsapp, IconShare } from '@tabler/icons-react';

const BLUE = '#185FA5';

const LOAN_TYPES = {
  home:     { label: 'Home Loan',     amountMax: 20000000, rateMin: 5,  rateMax: 20, rateDefault: 10.75, tenureMaxYr: 30 },
  personal: { label: 'Personal Loan', amountMax:  5000000, rateMin: 9,  rateMax: 24, rateDefault: 15,    tenureMaxYr: 7  },
  car:      { label: 'Car Loan',      amountMax:  5000000, rateMin: 7,  rateMax: 16, rateDefault: 9.5,   tenureMaxYr: 8  },
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const fmt = n => Math.round(n).toLocaleString('en-IN');

function tenureStr(months) {
  const yrs = Math.floor(months / 12);
  const mos = months % 12;
  if (mos === 0) return `${yrs} year${yrs !== 1 ? 's' : ''}`;
  if (yrs === 0) return `${mos} month${mos !== 1 ? 's' : ''}`;
  return `${yrs} year${yrs !== 1 ? 's' : ''} ${mos} month${mos !== 1 ? 's' : ''}`;
}

function calcEMI(P, annualRate, months) {
  if (!P || !months) return { emi: 0, schedule: [], totalInterest: 0, totalPayment: P || 0 };
  const r = annualRate / 12 / 100;
  const pow = r === 0 ? 0 : Math.pow(1 + r, months);
  const rawEmi = r === 0 ? P / months : (P * r * pow) / (pow - 1);
  const emi = Math.round(rawEmi);

  const schedule = [];
  let balance = P;
  let totalInterest = 0;
  const now = new Date();
  const sm = now.getMonth();
  const sy = now.getFullYear();

  for (let i = 1; i <= months; i++) {
    const absM = sm + i - 1;
    const yr = sy + Math.floor(absM / 12);
    const mIdx = absM % 12;
    const interest = Math.round(balance * r);
    const isFinal = i === months;
    const principal = isFinal ? balance : emi - interest;
    const rowEmi = isFinal ? principal + interest : emi;
    const newBalance = isFinal ? 0 : Math.max(0, balance - principal);
    totalInterest += interest;
    balance = newBalance;
    schedule.push({ month: i, monthLabel: `${MONTHS[mIdx]}-${yr}`, principal, interest, emi: rowEmi, balance, year: yr });
  }

  return { emi, schedule, totalInterest, totalPayment: P + totalInterest };
}

const S = {
  label: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, color: '#555', marginBottom: '6px' },
  input: { width: '100%', padding: '8px 10px', border: '1px solid #dde3ee', borderRadius: '6px', fontSize: '13px', outline: 'none', boxSizing: 'border-box', background: '#fafbfe' },
  slider: { width: '100%', marginTop: '8px', accentColor: BLUE, cursor: 'pointer' },
  rangeLabel: { display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#bbb', marginTop: '2px' },
  prefix: { padding: '8px 10px', background: '#eef2f7', border: '1px solid #dde3ee', borderRadius: '6px', fontSize: '13px', color: '#666', whiteSpace: 'nowrap', flexShrink: 0 },
};

const btnStyle = bg => ({
  padding: '9px 20px', borderRadius: '7px', border: 'none', cursor: 'pointer',
  background: bg, color: '#fff', fontWeight: 600, fontSize: '13px',
  boxShadow: '0 2px 6px rgba(0,0,0,0.18)', letterSpacing: '0.2px',
  display: 'flex', alignItems: 'center', gap: '6px',
});

export default function EmiCalculator({ userRole, userId }) {
  const [loanType,   setLoanType]   = useState('home');
  const [bankName,   setBankName]   = useState('');
  const [whatsapp,   setWhatsapp]   = useState('');
  const [amount,     setAmount]     = useState(1050000);  // may briefly be a string while typing
  const [rate,       setRate]       = useState(10.75);    // may briefly be a string while typing
  const [tenure,     setTenure]     = useState(60);       // always months (number)
  const [tenureUnit, setTenureUnit] = useState('yr');
  const [tenureRaw,  setTenureRaw]  = useState('');       // raw string while user types in tenure input
  const [expanded,   setExpanded]   = useState({});

  const cfg = LOAN_TYPES[loanType];

  // Coerced numbers — used for all math, sliders, and display. Raw amount/rate
  // kept as state so the text input can go empty while the user is typing.
  const amountN = Number(amount) || 0;
  const rateN   = parseFloat(rate) || 0;

  const switchLoanType = type => {
    const c = LOAN_TYPES[type];
    setLoanType(type);
    setRate(c.rateDefault);
    setAmount(a => Math.min(Number(a) || 0, c.amountMax));
    setTenure(t => Math.min(t, c.tenureMaxYr * 12));
  };

  const { emi, schedule, totalInterest, totalPayment } = useMemo(
    () => calcEMI(amountN, rateN, tenure), [amountN, rateN, tenure]
  );

  const yearlyData = useMemo(() => {
    const map = {};
    schedule.forEach(r => {
      if (!map[r.year]) map[r.year] = { year: r.year, principal: 0, interest: 0, total: 0, balance: 0, months: [] };
      map[r.year].principal += r.principal;
      map[r.year].interest  += r.interest;
      map[r.year].total     += r.emi;
      map[r.year].balance    = r.balance;
      map[r.year].months.push(r);
    });
    return Object.values(map).sort((a, b) => a.year - b.year);
  }, [schedule]);

  const principalPct = totalPayment > 0 ? Math.round((amountN / totalPayment) * 100) : 0;
  const interestPct  = 100 - principalPct;
  const tUnit        = tenureUnit === 'yr';
  const tDisplay     = tUnit ? Math.round(tenure / 12) : tenure;
  const tMax         = tUnit ? cfg.tenureMaxYr : cfg.tenureMaxYr * 12;

  // Shared WhatsApp summary text (reused by sendWhatsApp and sharePDF)
  const buildMsg = () => {
    const header = bankName ? `*${bankName} — EMI Calculation*\n` : `*EMI Calculation*\n`;
    return header +
      `Loan Amount: ₹${fmt(amountN)}\n` +
      `Rate of Interest: ${rateN}%\n` +
      `Loan Tenure: ${tenureStr(tenure)}\n` +
      `EMI: ₹${fmt(emi)}\n` +
      `Total Interest Payable: ₹${fmt(totalInterest)}\n` +
      `Total Payment (Principal + Interest): ₹${fmt(totalPayment)}`;
  };

  // Builds the jsPDF doc; shared between downloadPDF and sharePDF
  const buildPdfDoc = () => {
    const doc = new jsPDF();
    const title = bankName || 'EMI Calculation';
    doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.text(title, 14, 18);
    doc.setFont(undefined, 'normal'); doc.setFontSize(10);
    let y = 28;
    doc.setFont(undefined, 'bold'); doc.text('Loan Details', 14, y); doc.setFont(undefined, 'normal'); y += 7;
    doc.text(`Loan Amount: Rs.${fmt(amountN)}`, 14, y); y += 6;
    doc.text(`Interest Rate: ${rateN}%`, 14, y); y += 6;
    doc.text(`Tenure: ${tenureStr(tenure)}`, 14, y); y += 10;
    doc.setFont(undefined, 'bold'); doc.text('Payment Summary', 14, y); doc.setFont(undefined, 'normal'); y += 7;
    doc.text(`Loan EMI: Rs.${fmt(emi)}`, 14, y); y += 6;
    doc.text(`Total Interest Payable: Rs.${fmt(totalInterest)}`, 14, y); y += 6;
    doc.text(`Total Payment: Rs.${fmt(totalPayment)}`, 14, y); y += 10;
    autoTable(doc, {
      startY: y,
      head: [['#', 'Month', 'Principal', 'Interest', 'Total Pmt', 'Balance']],
      body: schedule.map(r => [
        r.month, r.monthLabel,
        fmt(r.principal), fmt(r.interest), fmt(r.emi), fmt(r.balance),
      ]),
      styles: { fontSize: 7.5 },
      headStyles: { fillColor: [24, 95, 165] },
    });
    return doc;
  };

  const downloadPDF = () => {
    const doc = buildPdfDoc();
    const safe = (bankName || 'Calculation').replace(/[^a-zA-Z0-9]/g, '_');
    doc.save(`EMI_${safe}_${amountN}.pdf`);
  };

  const sharePDF = async () => {
    const doc = buildPdfDoc();
    const blob = doc.output('blob');
    const safe = (bankName || 'Calculation').replace(/[^a-zA-Z0-9]/g, '_');
    const file = new File([blob], `EMI_${safe}.pdf`, { type: 'application/pdf' });
    const summary = buildMsg();
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'EMI Calculation', text: summary }); }
      catch (e) { /* user cancelled */ }
    } else {
      // Desktop fallback: download PDF then open WhatsApp with prefilled text
      doc.save(`EMI_${safe}.pdf`);
      const num = whatsapp.trim();
      window.open(`https://wa.me/${num ? '91' + num : ''}?text=${encodeURIComponent(summary)}`, '_blank');
    }
  };

  const downloadExcel = () => {
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet([
      ['EMI Calculation Summary'], [],
      ['Bank Name', bankName || '-'],
      ['Loan Amount', `Rs.${fmt(amountN)}`],
      ['Interest Rate', `${rateN}%`],
      ['Tenure', tenureStr(tenure)],
      ['Loan EMI', `Rs.${fmt(emi)}`],
      ['Total Interest Payable', `Rs.${fmt(totalInterest)}`],
      ['Total Payment', `Rs.${fmt(totalPayment)}`],
    ]);
    XLSX.utils.book_append_sheet(wb, ws1, 'Summary');
    const ws2 = XLSX.utils.aoa_to_sheet([
      ['Month#', 'Month-Year', 'Principal', 'Interest', 'Total Payment', 'Balance'],
      ...schedule.map(r => [
        r.month, r.monthLabel, r.principal, r.interest, r.emi, r.balance,
      ]),
    ]);
    XLSX.utils.book_append_sheet(wb, ws2, 'Amortization');
    const safe = (bankName || 'Calculation').replace(/[^a-zA-Z0-9]/g, '_');
    XLSX.writeFile(wb, `EMI_${safe}_${amountN}.xlsx`);
  };

  const sendWhatsApp = () => {
    const num = whatsapp.trim();
    const msg = buildMsg();
    window.open(`https://wa.me/${num ? '91' + num : ''}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  return (
    <div style={{ padding: '24px', fontFamily: 'Inter, Arial, sans-serif', background: '#f4f6f9', minHeight: '100vh', color: '#1a1a2e' }}>
      <h2 style={{ color: BLUE, margin: '0 0 4px', fontSize: '22px', fontWeight: 800 }}>EMI Calculator</h2>
      <p style={{ color: '#888', margin: '0 0 20px', fontSize: '13px' }}>Calculate EMI, total interest, and view full amortization schedule.</p>

      {/* Loan Type Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {Object.entries(LOAN_TYPES).map(([key, val]) => (
          <button key={key} onClick={() => switchLoanType(key)} style={{
            padding: '8px 22px', borderRadius: '7px', border: 'none', cursor: 'pointer',
            background: loanType === key ? BLUE : '#fff',
            color: loanType === key ? '#fff' : '#555',
            fontWeight: loanType === key ? 700 : 500,
            boxShadow: loanType === key ? '0 2px 10px rgba(24,95,165,0.35)' : '0 1px 3px rgba(0,0,0,0.1)',
            fontSize: '14px', transition: 'all 0.15s',
          }}>{val.label}</button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px,1fr) minmax(280px,1fr)', gap: '20px', marginBottom: '20px' }}>
        {/* ── LEFT: INPUTS ── */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
          <h3 style={{ margin: '0 0 18px', fontSize: '15px', color: '#333', fontWeight: 700 }}>Loan Details</h3>

          <div style={{ marginBottom: '14px' }}>
            <label style={S.label}>
              Bank Name <span style={{ color: '#bbb', fontWeight: 400, fontSize: '11px' }}>(optional)</span>
            </label>
            <input value={bankName} onChange={e => setBankName(e.target.value)}
              placeholder="e.g. SBI, HDFC, ICICI..." style={S.input} />
          </div>

          <div style={{ marginBottom: '14px' }}>
            <label style={S.label}>
              Customer WhatsApp <span style={{ color: '#bbb', fontWeight: 400, fontSize: '11px' }}>(optional, 10-digit)</span>
            </label>
            <input value={whatsapp} onChange={e => setWhatsapp(e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="9876543210" style={S.input} maxLength={10} />
          </div>

          {/* Loan Amount */}
          <div style={{ marginBottom: '14px' }}>
            <label style={S.label}>Loan Amount</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={S.prefix}>₹</span>
              <input type="number" value={amount} min={0} max={cfg.amountMax} step={1000}
                onChange={e => setAmount(e.target.value)}
                onBlur={() => {
                  let n = Number(amount);
                  if (isNaN(n) || !String(amount).trim()) n = 0;
                  setAmount(Math.min(Math.max(n, 0), cfg.amountMax));
                }}
                style={{ ...S.input, flex: 1 }} />
            </div>
            <input type="range" min={50000} max={cfg.amountMax} step={50000}
              value={Math.min(amountN, cfg.amountMax) || 50000}
              onChange={e => setAmount(Number(e.target.value))} style={S.slider} />
            <div style={S.rangeLabel}><span>₹50,000</span><span>₹{fmt(cfg.amountMax)}</span></div>
          </div>

          {/* Interest Rate */}
          <div style={{ marginBottom: '14px' }}>
            <label style={S.label}>Annual Interest Rate</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="number" value={rate} step="0.05" min={cfg.rateMin} max={cfg.rateMax}
                onChange={e => setRate(e.target.value)}
                onBlur={() => {
                  let n = parseFloat(rate);
                  if (isNaN(n)) n = cfg.rateMin;
                  setRate(Math.min(Math.max(n, 0), cfg.rateMax));
                }}
                style={{ ...S.input, flex: 1 }} />
              <span style={S.prefix}>%</span>
            </div>
            <input type="range" min={cfg.rateMin} max={cfg.rateMax} step={0.05}
              value={Math.min(Math.max(rateN, cfg.rateMin), cfg.rateMax)}
              onChange={e => setRate(parseFloat(e.target.value))} style={S.slider} />
            <div style={S.rangeLabel}><span>{cfg.rateMin}%</span><span>{cfg.rateMax}%</span></div>
          </div>

          {/* Tenure */}
          <div>
            <label style={S.label}>
              <span>Loan Tenure</span>
              <span style={{ background: '#eef2f7', borderRadius: '5px', display: 'inline-flex', border: '1px solid #dde3ee', overflow: 'hidden' }}>
                {[['yr', 'Yr'], ['mo', 'Mo']].map(([u, l]) => (
                  <button key={u} onClick={() => { setTenureUnit(u); setTenureRaw(''); }} style={{
                    padding: '2px 10px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 600,
                    background: tenureUnit === u ? BLUE : 'transparent',
                    color: tenureUnit === u ? '#fff' : '#777',
                  }}>{l}</button>
                ))}
              </span>
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="number" value={tenureRaw !== '' ? tenureRaw : tDisplay} min={1} max={tMax}
                onChange={e => setTenureRaw(e.target.value)}
                onBlur={() => {
                  let n = parseInt(tenureRaw !== '' ? tenureRaw : tDisplay);
                  if (isNaN(n) || n < 1) n = 1;
                  n = Math.min(n, tMax);
                  setTenure(tUnit ? n * 12 : n);
                  setTenureRaw('');
                }}
                style={{ ...S.input, flex: 1 }} />
              <span style={S.prefix}>{tUnit ? 'Yr' : 'Mo'}</span>
            </div>
            <input type="range" min={1} max={tMax} step={1} value={tDisplay}
              onChange={e => { const v = parseInt(e.target.value); setTenure(tUnit ? v * 12 : v); setTenureRaw(''); }}
              style={S.slider} />
            <div style={S.rangeLabel}><span>1 {tUnit ? 'Yr' : 'Mo'}</span><span>{tMax} {tUnit ? 'Yrs' : 'Mos'}</span></div>
          </div>
        </div>

        {/* ── RIGHT: RESULTS ── */}
        <div style={{
          background: '#fff', borderRadius: '12px', padding: '24px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
        }}>
          <div style={{ textAlign: 'center', marginBottom: '18px', width: '100%' }}>
            <div style={{ fontSize: '11px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '4px' }}>Monthly EMI</div>
            <div style={{ fontSize: '38px', fontWeight: 900, color: BLUE, letterSpacing: '-1px' }}>₹{fmt(emi)}</div>
          </div>

          {/* Conic-gradient donut pie */}
          <div style={{ position: 'relative', marginBottom: '14px' }}>
            <div style={{
              width: '168px', height: '168px', borderRadius: '50%',
              background: `conic-gradient(#8BC34A 0% ${principalPct}%, #FF9800 ${principalPct}% 100%)`,
              boxShadow: '0 4px 18px rgba(0,0,0,0.13)',
            }} />
            <div style={{
              position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
              width: '84px', height: '84px', borderRadius: '50%', background: '#fff',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.07)',
            }}>
              <div style={{ fontSize: '15px', fontWeight: 800, color: '#8BC34A', lineHeight: 1 }}>{principalPct}%</div>
              <div style={{ fontSize: '11px', color: '#bbb', marginTop: '2px' }}>Principal</div>
            </div>
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: '20px', marginBottom: '18px' }}>
            {[['#8BC34A', `Principal (${principalPct}%)`], ['#FF9800', `Interest (${interestPct}%)`]].map(([c, l]) => (
              <div key={l} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                <div style={{ width: '11px', height: '11px', borderRadius: '3px', background: c, flexShrink: 0 }} />
                <span style={{ color: '#555' }}>{l}</span>
              </div>
            ))}
          </div>

          {/* Summary rows */}
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {[
              { label: 'Principal Amount',       value: `₹${fmt(amountN)}`,       color: '#8BC34A' },
              { label: 'Total Interest Payable', value: `₹${fmt(totalInterest)}`, color: '#FF9800' },
              { label: 'Total Payment (P + I)',  value: `₹${fmt(totalPayment)}`,  color: BLUE },
            ].map(({ label, value, color }) => (
              <div key={label} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '9px 12px', background: '#f8fafd', borderRadius: '7px', borderLeft: `3px solid ${color}`,
              }}>
                <span style={{ fontSize: '12px', color: '#777' }}>{label}</span>
                <span style={{ fontSize: '14px', fontWeight: 700, color }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── ACTION BUTTONS ── */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={downloadPDF}   style={btnStyle('#e53935')}><IconFileTypePdf size={16} stroke={2}/> Download PDF</button>
        <button onClick={downloadExcel} style={btnStyle('#2e7d32')}><IconFileSpreadsheet size={16} stroke={2}/> Download Excel</button>
        <button onClick={sendWhatsApp}  style={btnStyle('#25D366')}><IconBrandWhatsapp size={16} stroke={2}/> Send on WhatsApp</button>
        <button onClick={sharePDF}      style={btnStyle(BLUE)}><IconShare size={16} stroke={2}/> Share PDF</button>
        <span style={{ fontSize: '11px', color: '#999', lineHeight: 1.4, maxWidth: '260px' }}>
          On mobile, 'Share PDF' sends the actual PDF file via WhatsApp. On desktop it downloads the PDF and opens WhatsApp with the summary text.
        </span>
      </div>

      {/* ── AMORTIZATION TABLE ── */}
      <div style={{ background: '#fff', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #eef2f7', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#333' }}>Amortization Schedule</h3>
          <span style={{ fontSize: '11px', color: '#bbb' }}>Click year row to expand monthly details</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: BLUE, color: '#fff' }}>
                {['Year', 'Principal (A)', 'Interest (B)', 'Total Payment (A+B)', 'Balance'].map(h => (
                  <th key={h} style={{
                    padding: '10px 14px', textAlign: h === 'Year' ? 'left' : 'right',
                    fontWeight: 600, whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {yearlyData.map((yr, yi) => {
                const isOpen = !!expanded[yr.year];
                return (
                  <React.Fragment key={yr.year}>
                    <tr
                      onClick={() => setExpanded(p => ({ ...p, [yr.year]: !p[yr.year] }))}
                      style={{ background: yi % 2 === 0 ? '#fafbfe' : '#fff', cursor: 'pointer' }}
                    >
                      <td style={{ padding: '10px 14px', fontWeight: 700, color: BLUE }}>
                        <span style={{ marginRight: '6px', fontSize: '11px' }}>{isOpen ? '▼' : '▶'}</span>
                        {yr.year}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: '#5a8a2a', fontWeight: 600 }}>₹{fmt(yr.principal)}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: '#b06a00', fontWeight: 600 }}>₹{fmt(yr.interest)}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>₹{fmt(yr.total)}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: '#c62828', fontWeight: 600 }}>₹{fmt(yr.balance)}</td>
                    </tr>
                    {isOpen && yr.months.map(row => (
                      <tr key={row.month} style={{ background: '#edf2fb', fontSize: '12px' }}>
                        <td style={{ padding: '7px 14px 7px 32px', color: '#555' }}>
                          <span style={{ color: '#aaa', marginRight: '4px' }}>#{row.month}</span>{row.monthLabel}
                        </td>
                        <td style={{ padding: '7px 14px', textAlign: 'right', color: '#4a7020' }}>₹{fmt(row.principal)}</td>
                        <td style={{ padding: '7px 14px', textAlign: 'right', color: '#8a5000' }}>₹{fmt(row.interest)}</td>
                        <td style={{ padding: '7px 14px', textAlign: 'right' }}>₹{fmt(row.emi)}</td>
                        <td style={{ padding: '7px 14px', textAlign: 'right' }}>₹{fmt(row.balance)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
