/* eslint-disable */
import React, { useState } from 'react'
import { IconCalculator, IconInfoCircle, IconUpload, IconFileText, IconLoader2, IconCircleCheck, IconCoin } from '@tabler/icons-react'

/*
  Income Tax & Net Take-Home — New Regime (FY 2025-26 / 2026-27)
  Three input modes:
    1. Manual entry (annual figures)
    2. Monthly Gross — enter monthly figures, auto-annualised (x12)
    3. Upload CTC / Payslip (PDF) — read 100% IN-BROWSER via pdf.js (same as CibilParser). No API, no key.
  Verified against a real payslip: gross 18,31,855 -> tax 1,57,426; net monthly (excl bonus) 1,22,387.
*/

const BRAND = '#185FA5'
const inr = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN')

// ── pdf.js loader (identical to CibilParser) ─────────────────────────────
function loadPdfJs() {
  return new Promise((resolve) => {
    if (window['pdfjs-dist/build/pdf']) { resolve(window['pdfjs-dist/build/pdf']); return }
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
    s.onload = () => {
      window['pdfjs-dist/build/pdf'].GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
      resolve(window['pdfjs-dist/build/pdf'])
    }
    document.head.appendChild(s)
  })
}
// `password` is optional; a protected PDF without it rejects with pdf.js's PasswordException.
export async function extractTextFromPDF(file, password = '') {
  const pdfjsLib = await loadPdfJs()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(e.target.result), ...(password ? { password } : {}) }).promise
        let text = ''
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const content = await page.getTextContent()
          text += content.items.map(x => x.str).join(' ') + '\n'
        }
        resolve(text)
      } catch (err) { reject(err) }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

// ── payslip / CTC text parser (in-browser) ───────────────────────────────
// NOTE: `after()` caps the gap between a label and its number at 40 non-digit
// chars. Earlier this was unbounded ([^0-9]*), which let a label with no
// nearby value (e.g. a blank "Professional Tax" field before the "Under
// Chapter VI-A ... Taxable Income 44,62,550" section) reach across the whole
// document and grab a completely unrelated number many lines away. Capping
// the gap makes a field resolve to "not found" instead of a wrong number.
const GAP = 40
export function parseSalaryText(text) {
  const num = (s) => parseFloat(String(s).replace(/,/g, '')) || 0
  const after = (label) => {
    const re = new RegExp(label + `[^0-9]{0,${GAP}}([0-9][0-9,]*\\.?[0-9]*)`, 'i')
    const m = text.match(re)
    return m ? num(m[1]) : 0
  }
  const isPayslip = /payslip|earnings|net\s*pay|deductions|days\s*paid/i.test(text)

  const basic = after('Basic\\s*Salary') || after('Basic')
  const hra = after('HRA') || after('House\\s*Rent')
  const spl = after('Special\\s*Allowance') || after('Other\\s*Allowance')
  // PF: try explicit labels first; fall back to a bare "PF" (common in payslip
  // deduction tables, e.g. "PF 29,867") but never match "PF No." field labels.
  const pf = after('Employee\\s*PF') || after('Provident\\s*Fund') || after('PF\\s*contribu') || after('PF(?!\\s*No)')
  // Professional tax: added the "PTAX" abbreviation used on many payslips.
  const pt = after('Prof\\s*Tax') || after('PTAX') || after('Professional\\s*Tax')
  const bonus = after('Annual\\s*Bonus') || after('Bonus') || after('Incentive')
  const nps = after('Employer\\s*NPS') || after('NPS')
  // Monthly take-home as printed on the payslip (used by Underwriting Desk; the
  // tax calculator itself doesn't read it). Most specific labels first.
  const netPay = after('Net\\s*Amount\\s*Payable') || after('Net\\s*Payable') || after('Net\\s*Pay(?!able)')
    || after('Net\\s*Salary') || after('Take\\s*Home')

  // Payslip earnings tables often have more line items than Basic/HRA/Special
  // (e.g. "Professional Development", "Conveyance", "LTA" ...). Summing only
  // those three named heads silently drops the rest and undercounts gross.
  // Instead, generically sum every row in the Earnings block that has the
  // "<Label> Actual Earned Arrear Total" 4-number shape, using the Actual
  // (recurring, non-arrear) column — this naturally includes any extra
  // earning heads a specific org's template adds.
  let regularFromRows = 0
  if (isPayslip) {
    const blockMatch = text.match(/Earnings[\s\S]{0,2000}?(?:GROSS\s*PAY|NET\s*PAY)/i)
    const block = blockMatch ? blockMatch[0] : ''
    const rowRe = /([A-Za-z][A-Za-z ]{2,30}?)\s+([0-9][0-9,]*\.?[0-9]*)\s+([0-9][0-9,]*\.?[0-9]*)\s+([0-9][0-9,]*\.?[0-9]*)\s+([0-9][0-9,]*\.?[0-9]*)/g
    let m
    while ((m = rowRe.exec(block))) {
      const label = m[1].trim()
      if (/gross|deduction|net\s*pay/i.test(label)) continue
      regularFromRows += num(m[2]) // "Actual" column — recurring monthly, excludes one-time arrears
    }
  }
  const regularMonthly = Math.max(basic + hra + spl, regularFromRows)

  // Variable earning heads paid in this month's earnings table (Underwriting
  // Desk: IndusInd counts fixed salary only). One alternation, longest names
  // first, so "Performance Bonus" is counted once, not also as "Bonus".
  // "Performance Pay" is not here: it is a regular monthly component (e.g. TCS).
  let variablePay = 0
  if (isPayslip) {
    const blockMatch = text.match(/Earnings[\s\S]{0,2000}?(?:GROSS\s*PAY|NET\s*PAY|Total\s*Earnings)/i)
    const block = blockMatch ? blockMatch[0] : ''
    // "PBI" = performance-based incentive; "Encashment" (comp-off / leave encashment) is one-time.
    const varRe = /\b(Performance\s*Bonus|Variable\s*Pay|Variable\s*Allowance|Incentives?|Bonus|Commission|PBI|Encashment)\b[^0-9]{0,25}([0-9][0-9,]*\.?[0-9]*)/gi
    let m
    while ((m = varRe.exec(block))) variablePay += num(m[2])
  }

  // Monthly gross (total earnings) as printed (Underwriting Desk: Bandhan checks its
  // minimum on gross). A printed figure below net pay, or far above the summed
  // earnings (a YTD / annual column), is not this month's gross: use the sum instead.
  //
  // Summary row printed as a header line then a value line (e.g. Sutherland):
  // "Earnings Deductions Net Pay 1,02,856.00 3,954.00 98,903.00" — map the amounts by position.
  // Two plain "Total" rows (earnings list, then deductions list) are read the same way.
  const summary = isPayslip ? readSummaryRow(text) : {}
  const totals = isPayslip ? plainTotals(text) : []
  const printedGross = after('Total\\s*Earnings') || after('Gross\\s*Earnings') || after('Gross\\s*Pay')
    || after('Gross\\s*Salary')
  const grossCands = [summary.gross, printedGross, totals[0]].filter((g) => g > 0)
  const printedNet = summary.net || netPay
  const grossOkFor = (g) => (!(regularMonthly > 0) || g <= regularMonthly * 3) && (!(printedNet > 0) || g >= printedNet)
  const pickedGross = grossCands.find(grossOkFor) || 0
  const grossOk = pickedGross > 0
  const grossMonthly = isPayslip ? (grossOk ? pickedGross : regularMonthly) : 0
  const deductions = summary.deductions || after('Total\\s*Deductions') || totals[1] || 0

  // Net pay: the summary row's Net Pay column wins. A "Net Pay" figure equal to the gross is the
  // next column's header value, not the net. Then cross-check net ≈ gross − deductions (₹10),
  // with the amount in words after "Net Pay (In Words)" as a confirmation when it is printed.
  let net = printedNet
  if (isPayslip && grossOk && net === grossMonthly && deductions > 0) net = 0
  if (isPayslip && grossOk && deductions > 0 && deductions < grossMonthly) {
    const diff = grossMonthly - deductions
    const words = netPayInWords(text)
    const near = (a, b) => Math.abs(a - b) <= 10
    if (words > 0 && near(words, diff) && !near(net, words)) net = diff
    else if (!(net > 0) || (!near(net, diff) && !(words > 0 && near(net, words)))) net = diff
  }

  // Payslip figures are monthly -> annualise x12. "Annual Bonus" is already annual.
  const mult = isPayslip ? 12 : 1
  return {
    regularGrossAnnual: Math.round(isPayslip ? regularMonthly * mult : regularMonthly),
    basicAnnual: Math.round(basic * mult),
    employeePFAnnual: Math.round(pf * mult),
    professionalTaxAnnual: Math.round(pt * mult),
    employerNPSAnnual: Math.round(nps * mult),
    bonusAnnual: Math.round(bonus), // annual as-is
    netPayMonthly: Math.round(net),
    variablePayMonthly: Math.round(variablePay),
    grossMonthly: Math.round(grossMonthly),
    ok: regularMonthly > 0,
    isPayslip,
  }
}

const AMT = '(-?[0-9][0-9,]*(?:\\.[0-9]+)?)'
const amt = (s) => parseFloat(String(s).replace(/,/g, '')) || 0
const SEP = '[\\s|:]+'

// "Earnings Deductions Net Pay <n> <n> <n>": 2–3 consecutive column labels, then as many amounts.
function readSummaryRow(text) {
  const LBL = '(?:(?:Total|Gross)\\s+)?Earnings|(?:Total\\s+)?Deductions|Net\\s*Pay(?!able)(?!\\s*\\()'
  const re = new RegExp(`((?:${LBL})(?:${SEP}(?:${LBL})){1,2})${SEP}${AMT}${SEP}${AMT}(?:${SEP}${AMT})?`, 'gi')
  let m, out = {}
  while ((m = re.exec(text))) {
    const labels = m[1].split(new RegExp(`${SEP}(?=(?:${LBL}))`, 'i')).map((l) => l.trim())
    const vals = [m[2], m[3], m[4]].filter((v) => v != null).map(amt)
    if (vals.length < labels.length) continue
    const row = {}
    labels.forEach((l, i) => {
      if (/earnings/i.test(l)) row.gross = vals[i]
      else if (/deductions/i.test(l)) row.deductions = vals[i]
      else row.net = vals[i]
    })
    out = row   // the last such row is the payslip summary
  }
  return out
}

// Plain "Total <n>" rows (not "Total Earnings" etc.): the first follows the earnings list, the second the deductions.
function plainTotals(text) {
  const re = new RegExp(`\\bTotal${SEP}${AMT}`, 'gi')
  const vals = []
  let m
  while ((m = re.exec(text)) && vals.length < 2) vals.push(amt(m[1]))
  return vals.length === 2 && vals[0] > vals[1] ? vals : []
}

// "Net Pay (In Words) NINETY EIGHT THOUSAND NINE HUNDRED THREE RUPEES ONLY" -> 98903 (0 if absent).
const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const SCALES = { hundred: 100, thousand: 1000, lakh: 100000, lakhs: 100000, lac: 100000, crore: 10000000, crores: 10000000 }
export function netPayInWords(text) {
  const m = String(text).match(/Net\s*Pay\s*\(\s*In\s*Words\s*\)[\s|:]*(?:Rs\.?|Rupees|INR)?\s*([A-Za-z\s-]+?)(?:\s+(?:Rupees|Only)\b|$)/i)
  if (!m) return 0
  let total = 0, cur = 0, seen = false
  for (const w of m[1].toLowerCase().split(/[\s-]+/)) {
    if (w === 'and' || !w) continue
    if (ONES[w] != null) { cur += ONES[w]; seen = true }
    else if (w === 'hundred') { cur = (cur || 1) * 100; seen = true }
    else if (SCALES[w]) { total += (cur || 1) * SCALES[w]; cur = 0; seen = true }
    else break
  }
  return seen ? total + cur : 0
}

function taxNewRegime(taxable) {
  const slabs = [[400000,0],[800000,0.05],[1200000,0.1],[1600000,0.15],[2000000,0.2],[2400000,0.25],[Infinity,0.3]]
  let slabTax = 0, lo = 0
  const breakup = []
  for (const [up, rate] of slabs) {
    if (taxable > lo) {
      const amt = Math.min(taxable, up) - lo
      const t = amt * rate
      slabTax += t
      if (amt > 0 && rate > 0) breakup.push({ from: lo, to: up === Infinity ? null : up, rate, tax: t })
    }
    lo = up
    if (taxable <= up) break
  }
  const afterRebate = taxable <= 1200000 ? 0 : Math.min(slabTax, taxable - 1200000)
  let sr = 0
  if (taxable > 20000000) sr = 0.25; else if (taxable > 10000000) sr = 0.15; else if (taxable > 5000000) sr = 0.1
  const surcharge = afterRebate * sr
  const cess = (afterRebate + surcharge) * 0.04
  return { taxable, slabTax, breakup, afterRebate, surcharge, surchargeRate: sr, cess, total: afterRebate + surcharge + cess, rebated: taxable <= 1200000 && slabTax > 0 }
}

function compute({ regular, bonus, basic, employerNPS, empPF, profTax }) {
  const nps = Math.min(employerNPS || 0, basic > 0 ? basic * 0.14 : (employerNPS || 0))
  const stdDeduction = 75000
  const tReg = taxNewRegime(Math.max(0, regular - stdDeduction - nps))
  const tTot = taxNewRegime(Math.max(0, regular + (bonus || 0) - stdDeduction - nps))
  const regularNetAnnual = regular - (empPF || 0) - (profTax || 0) - tReg.total
  const netAnnual = regular + (bonus || 0) - (empPF || 0) - (profTax || 0) - tTot.total
  return {
    nps, stdDeduction, tReg, tTot,
    annualTax: tTot.total,
    bonusTax: tTot.total - tReg.total,
    bonusNet: (bonus || 0) - (tTot.total - tReg.total),
    regularNetMonthly: regularNetAnnual / 12,
    netAnnual,
    effRate: (regular + (bonus || 0)) > 0 ? (tTot.total / (regular + (bonus || 0))) * 100 : 0,
  }
}

export default function TaxCalculator() {
  const [mode, setMode] = useState('manual')
  const [regular, setRegular] = useState('')
  const [bonus, setBonus] = useState('')
  const [basic, setBasic] = useState('')
  const [employerNPS, setEmployerNPS] = useState('')
  const [empPF, setEmpPF] = useState('')
  const [profTax, setProfTax] = useState('')
  // Monthly-gross mode inputs — annualised (x12) into the same calc as above.
  const [monthlyRegular, setMonthlyRegular] = useState('')
  const [monthlyBasic, setMonthlyBasic] = useState('')
  const [monthlyEmpPF, setMonthlyEmpPF] = useState('')
  const [monthlyProfTax, setMonthlyProfTax] = useState('')
  const [reading, setReading] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const monthlyRegularNum = parseFloat(monthlyRegular) || 0
  const monthlyBasicNum = parseFloat(monthlyBasic) || 0
  const monthlyEmpPFNum = parseFloat(monthlyEmpPF) || 0
  const monthlyProfTaxNum = parseFloat(monthlyProfTax) || 0

  const nums = mode === 'monthly'
    ? {
        regular: monthlyRegularNum * 12,
        bonus: parseFloat(bonus) || 0,
        basic: monthlyBasicNum * 12,
        employerNPS: parseFloat(employerNPS) || 0,
        empPF: monthlyEmpPFNum * 12,
        profTax: monthlyProfTaxNum * 12,
      }
    : {
        regular: parseFloat(regular) || 0, bonus: parseFloat(bonus) || 0, basic: parseFloat(basic) || 0,
        employerNPS: parseFloat(employerNPS) || 0, empPF: parseFloat(empPF) || 0, profTax: parseFloat(profTax) || 0,
      }
  const r = nums.regular > 0 ? compute(nums) : null

  const handleFile = async (file) => {
    if (!file) return
    setErr(''); setMsg(''); setReading(true)
    try {
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
      if (!isPdf) { setErr('Please upload a PDF payslip or CTC letter.'); setReading(false); return }
      const text = await extractTextFromPDF(file)
      const p = parseSalaryText(text)
      if (!p.ok) { setErr("Couldn't find salary figures in this document. Please enter them manually."); setReading(false); return }
      if (p.regularGrossAnnual) setRegular(String(p.regularGrossAnnual))
      if (p.bonusAnnual) setBonus(String(p.bonusAnnual))
      if (p.basicAnnual) setBasic(String(p.basicAnnual))
      if (p.employeePFAnnual) setEmpPF(String(p.employeePFAnnual))
      if (p.professionalTaxAnnual) setProfTax(String(p.professionalTaxAnnual))
      if (p.employerNPSAnnual) setEmployerNPS(String(p.employerNPSAnnual))
      setMsg((p.isPayslip ? 'Payslip' : 'Document') + ' read — figures annualised. Please review each value below and correct if needed.')
      setMode('manual')
    } catch (e) {
      setErr("Couldn't read that PDF. Please enter the figures manually.")
    } finally { setReading(false) }
  }

  const card = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 20 }

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: 20, fontFamily: 'system-ui, sans-serif', color: '#0f172a' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: '#e6f0fb', color: BRAND, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><IconCalculator size={22} /></div>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Income Tax & Net Take-Home</h1>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>New Regime · FY 2025-26 &amp; 2026-27</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '18px 0', flexWrap: 'wrap' }}>
        {[
          { k: 'manual', t: 'Enter manually', ic: <IconCalculator size={15} /> },
          { k: 'monthly', t: 'Monthly Gross', ic: <IconCoin size={15} /> },
          { k: 'upload', t: 'Upload CTC / Payslip (PDF)', ic: <IconUpload size={15} /> },
        ].map((m) => (
          <button key={m.k} onClick={() => setMode(m.k)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: mode === m.k ? `1px solid ${BRAND}` : '1px solid #e2e8f0', background: mode === m.k ? BRAND : '#fff', color: mode === m.k ? '#fff' : '#334155' }}>{m.ic} {m.t}</button>
        ))}
      </div>

      {mode === 'upload' && (
        <div style={{ ...card, marginBottom: 16, borderStyle: 'dashed', textAlign: 'center' }}>
          <IconFileText size={26} color={BRAND} />
          <p style={{ fontSize: 13, color: '#475569', margin: '8px 0 12px' }}>Upload a payslip or CTC letter (PDF). Read securely in your browser — figures auto-fill below to confirm.</p>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', background: BRAND, color: '#fff', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            {reading ? <IconLoader2 size={15} className="spin" /> : <IconUpload size={15} />}{reading ? 'Reading…' : 'Choose PDF'}
            <input type="file" accept="application/pdf" style={{ display: 'none' }} onChange={(e) => handleFile(e.target.files?.[0])} disabled={reading} />
          </label>
          {msg && <div style={{ marginTop: 12, fontSize: 12, color: '#166534', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}><IconCircleCheck size={14} /> {msg}</div>}
          {err && <div style={{ marginTop: 12, fontSize: 12, color: '#dc2626' }}>{err}</div>}
        </div>
      )}

      {mode === 'monthly' && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
            <Field label="Monthly Gross Salary *" val={monthlyRegular} set={setMonthlyRegular} ph="140858" />
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6, display: 'block' }}>Yearly Gross (auto-calculated)</label>
              <div style={{ width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', background: '#f8fafc', color: '#0f172a', fontWeight: 600 }}>{inr(monthlyRegularNum * 12)}</div>
            </div>
            <Field label="Annual Bonus / One-time" val={bonus} set={setBonus} ph="141558" />
            <Field label="Monthly Basic (for NPS cap)" val={monthlyBasic} set={setMonthlyBasic} ph="63386" />
            <Field label="Monthly Employee PF" val={monthlyEmpPF} set={setMonthlyEmpPF} ph="7606" />
            <Field label="Monthly Professional Tax" val={monthlyProfTax} set={setMonthlyProfTax} ph="200" />
            <Field label="Employer NPS 80CCD(2) (annual)" val={employerNPS} set={setEmployerNPS} ph="0" />
          </div>
          <div style={{ fontSize: 11, color: '#64748b', display: 'flex', gap: 6, marginTop: 12 }}>
            <IconInfoCircle size={16} color="#94a3b8" style={{ flexShrink: 0 }} />
            <span>Monthly figures are simply multiplied by 12 to estimate the yearly gross. For an employee who joined mid-year, got a raise, or has variable pay, this will differ from payroll's own FY-annualised figure — treat it as an estimate.</span>
          </div>
        </div>
      )}

      {mode !== 'monthly' && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
            <Field label="Regular Gross Annual (excl. bonus) *" val={regular} set={setRegular} ph="1690296" />
            <Field label="Annual Bonus / One-time" val={bonus} set={setBonus} ph="141558" />
            <Field label="Annual Basic (for NPS cap)" val={basic} set={setBasic} ph="760634" />
            <Field label="Employee PF (annual)" val={empPF} set={setEmpPF} ph="91272" />
            <Field label="Professional Tax (annual)" val={profTax} set={setProfTax} ph="2400" />
            <Field label="Employer NPS 80CCD(2) (annual)" val={employerNPS} set={setEmployerNPS} ph="0" />
          </div>
          {msg && mode === 'manual' && <div style={{ marginTop: 10, fontSize: 12, color: '#166534', display: 'flex', alignItems: 'center', gap: 6 }}><IconCircleCheck size={14} /> {msg}</div>}
          <div style={{ fontSize: 11, color: '#64748b', display: 'flex', gap: 6, marginTop: 12 }}>
            <IconInfoCircle size={16} color="#94a3b8" style={{ flexShrink: 0 }} />
            <span>New regime allows only the ₹75,000 standard deduction and employer NPS. Bonus is taxed but kept out of the regular monthly figure. PF &amp; Professional Tax reduce take-home but are not income tax.</span>
          </div>
        </div>
      )}

      {r ? (
        <div style={{ ...card }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
            <Tile label="Net Monthly Take-Home (bonus excluded)" value={inr(r.regularNetMonthly)} big color="#166534" />
            <Tile label="Annual Income Tax (incl. bonus)" value={inr(r.annualTax)} big color="#dc2626" />
            <Tile label="Net Annual Take-Home (incl. bonus)" value={inr(r.netAnnual)} />
            <Tile label="Effective Tax Rate" value={r.effRate.toFixed(2) + '%'} />
          </div>

          <SectionTitle>Income tax (new regime)</SectionTitle>
          <div style={{ fontSize: 13 }}>
            <Row k="Regular gross salary" v={inr(nums.regular)} />
            {nums.bonus > 0 && <Row k="Bonus / one-time pay" v={inr(nums.bonus)} />}
            <Row k="Standard deduction" v={'– ' + inr(r.stdDeduction)} />
            {r.nps > 0 && <Row k="Employer NPS 80CCD(2)" v={'– ' + inr(r.nps)} />}
            <Row k="Taxable income (incl. bonus)" v={inr(r.tTot.taxable)} bold />
            <div style={{ height: 1, background: '#e2e8f0', margin: '8px 0' }} />
            {r.tTot.breakup.map((s, i) => (
              <Row key={i} k={`${inr(s.from)} – ${s.to ? inr(s.to) : 'above'} @ ${s.rate * 100}%`} v={inr(s.tax)} sub />
            ))}
            <Row k="Tax as per slabs" v={inr(r.tTot.slabTax)} bold />
            {r.tTot.rebated && <Row k="Section 87A rebate (≤ ₹12L)" v={'– ' + inr(r.tTot.slabTax)} green />}
            {r.tTot.surcharge > 0 && <Row k={`Surcharge (${r.tTot.surchargeRate * 100}%)`} v={'+ ' + inr(r.tTot.surcharge)} />}
            <Row k="Health & Education cess (4%)" v={'+ ' + inr(r.tTot.cess)} />
            <Row k="Total annual income tax" v={inr(r.annualTax)} bold />
          </div>

          <SectionTitle>Regular monthly take-home (bonus excluded)</SectionTitle>
          <div style={{ fontSize: 13 }}>
            <Row k="Regular gross ÷ 12" v={inr(nums.regular / 12)} />
            <Row k="Employee PF ÷ 12" v={'– ' + inr(nums.empPF / 12)} />
            <Row k="Professional Tax ÷ 12" v={'– ' + inr(nums.profTax / 12)} />
            <Row k="Income tax on regular salary ÷ 12" v={'– ' + inr(r.tReg.total / 12)} />
            <div style={{ height: 1, background: '#e2e8f0', margin: '8px 0' }} />
            <Row k="Net monthly take-home" v={inr(r.regularNetMonthly)} bold green />
          </div>

          {nums.bonus > 0 && (
            <>
              <SectionTitle>Bonus (one-time, separate)</SectionTitle>
              <div style={{ fontSize: 13 }}>
                <Row k="Bonus amount" v={inr(nums.bonus)} />
                <Row k="Extra tax on bonus" v={'– ' + inr(r.bonusTax)} />
                <Row k="Bonus received (net)" v={inr(r.bonusNet)} bold />
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>Paid once, in the bonus month — not part of regular monthly salary.</div>
              </div>
            </>
          )}
        </div>
      ) : (
        <div style={{ ...card, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Enter the {mode === 'monthly' ? 'monthly gross salary' : 'regular gross annual salary'} (or upload a PDF) to see the net take-home.</div>
      )}

      <style>{`.spin{animation:sp 1s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

function Field({ label, val, set, ph }) {
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6, display: 'block' }}>{label}</label>
      <input style={{ width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box' }} type="number" placeholder={ph} value={val} onChange={(e) => set(e.target.value)} />
    </div>
  )
}
function SectionTitle({ children }) {
  return <div style={{ fontSize: 12, fontWeight: 700, color: BRAND, textTransform: 'uppercase', letterSpacing: 0.5, margin: '18px 0 8px' }}>{children}</div>
}
function Tile({ label, value, big, color }) {
  return (
    <div style={{ background: '#f8fafc', border: '1px solid #eef2f7', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: big ? 22 : 16, fontWeight: 700, color: color || '#0f172a', marginTop: 4 }}>{value}</div>
    </div>
  )
}
function Row({ k, v, bold, sub, green }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: sub ? '3px 0 3px 12px' : '5px 0' }}>
      <span style={{ color: sub ? '#64748b' : green ? '#166534' : '#475569', fontSize: sub ? 12 : 13, fontWeight: bold ? 700 : 400 }}>{k}</span>
      <span style={{ fontWeight: bold ? 700 : green ? 600 : 500, color: green ? '#166534' : '#0f172a', fontSize: sub ? 12 : 13 }}>{v}</span>
    </div>
  )
}
