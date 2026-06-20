/* eslint-disable */
import { useState, useCallback, useEffect, useRef } from 'react'
import { supabase } from '../supabase'

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

async function extractTextFromPDF(file, password = '') {
  const pdfjsLib = await loadPdfJs()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const task = pdfjsLib.getDocument({
          data: new Uint8Array(e.target.result),
          ...(password ? { password } : {})
        })
        task.onPassword = (cb, reason) => {
          reject(new Error(reason === 2 ? 'WRONG_PASSWORD' : 'NEEDS_PASSWORD'))
        }
        const pdf = await task.promise
        let text = ''
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const content = await page.getTextContent()
          text += content.items.map(x => x.str).join(' ') + '\n'
        }
        resolve({ text, pdf, pdfjsLib })
      } catch (err) { reject(err) }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

// CIBIL.com PDFs inject page headers throughout text AND space out letters
function cleanCibilText(raw) {
  let t = raw
  t = t.replace(/\d{2}\/\d{2}\/\d{4},?\s*\d{2}:\d{2}\s*CIBIL\s*Report\s*https?:\/\/\S+\s*\d+\/\d+/gi, ' ')
  t = t.replace(/https?:\/\/myscore\.cibil\.com\S*/gi, ' ')
  for (let i = 0; i < 12; i++) {
    t = t.replace(/([A-Za-z]) ([A-Z]) ([A-Za-z])/g, '$1$2$3')
    t = t.replace(/([A-Z]) ([A-Z]) ([A-Z])/g, '$1$2$3')
    t = t.replace(/\b([A-Z]) ([A-Z])\b/g, '$1$2')
    t = t.replace(/\b([A-Z]) ([a-z])/g, '$1$2')
    t = t.replace(/\b([A-Z]) ([A-Z]{2,})/g, '$1$2')
  }
  return t
}

function detectFormat(raw) {
  const t = raw.toLowerCase()
  if (t.includes('enquiry control number') ||
      t.includes('credit health report') ||
      t.includes('paisabazaar') ||
      t.includes('back to top') ||
      (t.includes('hey ') && t.includes('here is your credit'))) return 'paisabazaar'
  if (t.includes('myscore.cibil.com') ||
      t.includes('control number :') ||
      t.includes('member name')) return 'cibil'
  const c = cleanCibilText(raw).toLowerCase()
  if (c.includes('product type') || c.includes('paisabazaar')) return 'paisabazaar'
  if (c.includes('member name')) return 'cibil'
  return 'unknown'
}

const NOISE = new Set([
  'BACK TO TOP','CREDIT FACTORS','BACK TO TOP CREDIT FACTORS',
  'ACTIVE LOAN ACCOUNTS','ACTIVE CREDIT CARD ACCOUNTS','CLOSED LOAN ACCOUNTS',
  'CLOSED CREDIT CARD ACCOUNTS','ACTIVE ACCOUNTS','CLOSED ACCOUNTS',
  'ALL ACCOUNTS','OPEN ACCOUNTS','PAYMENT STATUS','PAYMENT HISTORY',
  'ACCOUNT DETAILS','ACCOUNT SUMMARY','ENQUIRY DETAILS','EMPLOYMENT DETAILS',
  'ALL OPEN ACCOUNTS','ALL CLOSED ACCOUNTS','STD','DBT','LSS','SUB','SMA',
])
function isNoise(name) {
  const n = name.toUpperCase().trim()
  if (!n || n.length < 2) return true
  if (NOISE.has(n)) return true
  if (/^(BACK TO|ACTIVE |CLOSED |OPEN |ALL |PAYMENT |ACCOUNT |ENQUIRY |EMPLOYMENT )/.test(n)) return true
  if (/https?:\/\//.test(n)) return true
  if (/CIBIL REPORT/.test(n)) return true
  if (/\d{2}\/\d{2}\/\d{4}/.test(n)) return true
  if (/^\d/.test(n)) return true
  if (!/[A-Z]{2,}/.test(n)) return true
  return false
}

// ── PART A: Enquiry helpers (anchored to report date) ────────────────────────
const MON = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 }
function mkDate(d, mon, y) { return new Date(+y, MON[String(mon).slice(0,3).toLowerCase()], +d) }
const fmtD = d => d ? new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : ''


// ── PART B: Late-payment extraction via pdf.js operator list ─────────────────
// PaisaBazaar draws the month grid as colored filled circles; getTextContent()
// never sees them. We read fill-color + path coordinates from the draw operators.
async function extractLatePayments(pdf, pdfjsLib) {
  const { OPS, Util } = pdfjsLib
  const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
  const ORANGE = [255,138,0], RED = [214,38,23]
  const near = (c, r, t = 26) => Math.abs(c[0]-r[0]) + Math.abs(c[1]-r[1]) + Math.abs(c[2]-r[2]) < t
  const result = {}
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const tc = await page.getTextContent()
    const items = tc.items.map(it => ({ s: it.str.trim(), x: it.transform[4], y: it.transform[5] }))
    const accNum = (items.map(i => i.s).join(' ').match(/Account Number\s+(X+\d+)/i) || [])[1]
    const mcol = MONTHS.map(m => { const it = items.find(i => i.s === m); return it ? it.x : null })
    const years = items.filter(i => /^20\d\d$/.test(i.s)).map(i => ({ yr: i.s, y: i.y })).sort((a,b)=>b.y-a.y)
    if (!accNum || mcol.filter(Boolean).length < 6 || !years.length) continue
    const ops = await page.getOperatorList()
    const names = {}; for (const k in OPS) names[OPS[k]] = k
    let ctm = [1,0,0,1,0,0]; const stack = []; let fill = null; const raw = []
    for (let i = 0; i < ops.fnArray.length; i++) {
      const op = names[ops.fnArray[i]], a = ops.argsArray[i]
      if (op === 'save') stack.push(ctm.slice())
      else if (op === 'restore') ctm = stack.pop() || [1,0,0,1,0,0]
      else if (op === 'transform') ctm = Util.transform(ctm, a)
      else if (op === 'setFillRGBColor') fill = [a[0], a[1], a[2]]
      else if (op === 'fill' || op === 'eoFill') {
        if (fill && (near(fill, ORANGE) || near(fill, RED)))
          raw.push({ st: near(fill, ORANGE) ? 'L' : 'XL', x: ctm[4], y: ctm[5] })
      }
    }
    const marks = []
    for (const r of raw) if (!marks.some(m => Math.abs(m.x-r.x) < 6 && Math.abs(m.y-r.y) < 6 && m.st === r.st)) marks.push(r)
    const acc = result[accNum] || (result[accNum] = { late1_89: 0, late90: 0, months: [] })
    for (const k of marks) {
      let mi = -1, bx = 8
      mcol.forEach((cx, j) => { if (cx != null && Math.abs(cx - k.x) < bx) { bx = Math.abs(cx - k.x); mi = j } })
      if (mi < 0) continue
      let yr = null, by = 18
      years.forEach(y => { if (Math.abs(y.y - k.y) < by) { by = Math.abs(y.y - k.y); yr = y.yr } })
      if (!yr) continue
      if (k.st === 'XL') acc.late90++; else acc.late1_89++
      acc.months.push(`${yr} ${MONTHS[mi]}${k.st === 'XL' ? ' (90+)' : ''}`)
    }
    console.log(`[ops p${p}] ${accNum}: late1_89=${acc.late1_89} late90=${acc.late90} marks=${marks.length}`)
  }
  console.log('[ops] result:', JSON.stringify(Object.fromEntries(Object.entries(result).map(([k,v])=>[k,{l1_89:v.late1_89,l90:v.late90}]))))
  return result
}

// Per-account monthly obligation: 5% for credit cards, 1% for gold loans, EMI otherwise
function monthlyObligation(acc) {
  const out = parseInt(String(acc.outstanding || '0').replace(/[^0-9]/g, '')) || 0
  const emi = parseInt(String(acc.emi || '0').replace(/[^0-9]/g, '')) || 0
  const type = (acc.loanType || '').toLowerCase()
  if (type.includes('credit card')) return Math.round(out * 0.05)
  if (type.includes('gold'))        return Math.round(out * 0.01)
  return emi
}

// ── CIBIL.COM PARSER ──────────────────────────────────────────────────────────
function parseCibil(raw) {
  const text = cleanCibilText(raw)
  const MONTHS_RX = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec'
  const dmy = s => { const p = s.split('/'); return new Date(+p[2], +p[1] - 1, +p[0]) }
  const score = parseInt((text.match(/Your\s*CIBIL\s*Score\s*is\s*(\d{3})/i) || [])[1]) || null
  const nf = raw.match(/\bName\s+(MR|MS|MRS|DR)\.?\s+([A-Z][A-Z ]{3,60}?)(?=\s*Date|\s*Gender|\n)/i)
  const customerName = nf ? (nf[1] + ' ' + nf[2]).replace(/\s+/g, ' ').trim() : ''
  const rd = text.match(/\bDate\s*:\s*(\d{2}\/\d{2}\/\d{4})/)
  const anchor = rd ? dmy(rd[1]) : new Date()
  const [acctRegion, enqRegion = ''] = text.split(/ENQUIRY\s*DETAILS/i)
  const enqDetails = []
  const ENQ = /Member\s*Name\s+(.+?)\s+Date\s*Of\s*Enquiry\s+(\d{2}\/\d{2}\/\d{4})\s+Enquiry\s*Purpose\s+(.+?)(?=\s*Member\s*Name|\s*Disclaimer|\s*End of report|$)/gis
  for (const m of enqRegion.matchAll(ENQ)) {
    enqDetails.push({ institution: m[1].trim(), date: dmy(m[2]), product: m[3].split('–')[0].replace(/\s+/g, ' ').trim() })
  }
  const inWin = n => enqDetails.filter(e => { const x = (anchor - e.date) / 86400000; return x >= 0 && x <= n })
  const byType = {}; enqDetails.forEach(e => { byType[e.product] = (byType[e.product] || 0) + 1 })
  const enquiries = {
    total: enqDetails.length,
    last30: inWin(30).length, last60: inWin(60).length, last90: inWin(90).length,
    items30: inWin(30).map(e => ({ institution: e.institution, product: e.product, date: fmtD(e.date) })),
    items60: inWin(60).map(e => ({ institution: e.institution, product: e.product, date: fmtD(e.date) })),
    items90: inWin(90).map(e => ({ institution: e.institution, product: e.product, date: fmtD(e.date) })),
    byType, details: enqDetails,
  }
  const anchors = [...acctRegion.matchAll(/Member\s*Name/gi)].map(m => m.index)
  console.log('[parseCibil] score:', score, 'anchors:', anchors.length, 'text snippet:', text.slice(0, 300))
  const accounts = []
  for (let i = 0; i < anchors.length; i++) {
    const pos = anchors[i]
    const nextPos = i + 1 < anchors.length ? anchors[i + 1] : acctRegion.length
    const fieldWin = acctRegion.slice(Math.max(0, pos - 450), pos + 520)
    const payWin = acctRegion.slice(pos, nextPos)
    const bm = acctRegion.slice(pos).match(/Member\s*Name\s+(.+?)\s+(?:Account\s*Type|Credit\s*Limit|Sanctioned\s*Amount|High\s*Credit|Current\s*Balance|Cash\s*Limit)/is)
    const bankName = bm ? bm[1].replace(/\s+/g, ' ').trim() : ''
    if (!bankName || isNoise(bankName)) continue
    const tm = payWin.match(/Account\s*Type\s+(.+?)\s+(?:Account\s*Number|Ownership)/is)
    const loanType = tm ? tm[1].replace(/\s+/g, ' ').trim() : ''
    if (!loanType || /employment/i.test(loanType)) continue
    const accNumM = payWin.match(/Account\s*Number\s+([A-Za-z0-9]+)/i)
    const accountNum = accNumM ? accNumM[1] : ''
    const g = (s, rx) => { const m = s.match(rx); return m ? m[1].replace(/,/g, '').trim() : '' }
    const loanAmount = g(fieldWin, /Sanctioned\s*Amount\s*[₹₹]\s*([\d,]+)/i) || g(fieldWin, /Credit\s*Limit\s*[₹₹]\s*([\d,]+)/i) || g(fieldWin, /High\s*Credit\s*[₹₹]\s*([\d,]+)/i)
    const outstandingRaw = g(fieldWin, /Current\s*Balance\s*[₹₹]\s*([\d,]+)/i)
    const emi = g(fieldWin, /EMI\s*Amount\s*[₹₹]\s*([\d,]+)/i)
    const overdue = g(fieldWin, /Amount\s*Overdue\s*[₹₹]\s*([\d,]+)/i)
    const settlement = g(fieldWin, /Settlement\s*Amount\s*[₹₹]\s*([\d,]+)/i)
    const writtenOffRaw = g(fieldWin, /Written[- ]?off\s*Amount\s*\(\s*Total\s*\)\s*[₹₹]?\s*([\d,]+)/i) ||
                          g(fieldWin, /Written[- ]?off\s*Amount\s*\(\s*Principal\s*\)\s*[₹₹]?\s*([\d,]+)/i)
    const openDate = g(fieldWin, /Date\s*Opened\s*\/?\s*Disbursed\s+(\d{2}\/\d{2}\/\d{4})/i)
    const closedDate = g(fieldWin, /Date\s*Closed\s+(\d{2}\/\d{2}\/\d{4})/i)
    const isClosed = !!closedDate
    const settlementVal = (!settlement || settlement === '0' || settlement === '-') ? '' : settlement
    const writtenOffVal  = (!writtenOffRaw || writtenOffRaw === '0' || writtenOffRaw === '-') ? '' : writtenOffRaw
    const cibilStatusTag = isClosed
      ? (settlementVal ? 'Closed · Settled' : writtenOffVal ? 'Closed · Written-off' : 'Closed')
      : 'Active'
    const dpdHits = [...payWin.matchAll(new RegExp('((?:' + MONTHS_RX + ')\\s+20\\d{2})\\s+(\\d{1,3})\\b', 'gi'))]
    const lateMonthsCibil = dpdHits.filter(m => +m[2] > 0 && +m[2] <= 365).map(m => `${m[1]} (${m[2]}d)`)
    const dpdNums = dpdHits.map(m => +m[2]).filter(n => n > 0 && n <= 365)
    const maxDpd = dpdNums.length ? Math.max(...dpdNums) : 0
    accounts.push({
      bankName, loanType, loanAmount, accountNum,
      outstanding: isClosed ? '0' : outstandingRaw,
      emi, openDate, closedDate, dpds: String(maxDpd), lateMonths: lateMonthsCibil,
      overdue: (!overdue || overdue === '0') ? '' : overdue,
      settlement: settlementVal,
      writtenOff: writtenOffVal,
      status: cibilStatusTag,
    })
  }
  return { accounts, score, customerName, enquiries }
}

// ── PAISABAZAAR PARSER ────────────────────────────────────────────────────────
function parsePaisaBazaar(text) {
  // Score
  const sm = text.match(/Powered\s*by\s*\n?\s*(\d{3})/i) ||
             text.match(/(\d{3})\s*\n?\s*(?:Very Good|Good|Fair|Poor|Excellent)/i) ||
             text.match(/score[^\d]*(\d{3})/i)
  const score = sm ? parseInt(sm[1]) : null

  // Name
  const nm = text.match(/Hey\s+([A-Za-z][A-Za-z ]{2,60}?),/i) ||
             text.match(/Hey\s+([A-Za-z][A-Za-z ]{2,60})\s*\n/i)
  const customerName = nm ? nm[1].trim() : ''

  const rdM = text.match(/Report\s*Date\s*:?\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/i)
  const anchor = rdM ? mkDate(rdM[1], rdM[2], rdM[3]) : new Date()
  const reportDate = anchor

  const enqSec = (text.match(/Financial\s*Institution\s+Product\s*Type\s+Reported\s*Date\s+Amount([\s\S]*?)(?=\bTip\b|Employment\s*Details|Back\s*to\s*Top|$)/i) || [])[1] || ''
  const ENQ_ROW = /([A-Z][A-Za-z0-9 .&'\-]{1,40}?)\s+(Personal Loan|Gold Loan|Credit Card|Consumer Loan|Home Loan|Housing Loan|Auto Loan|Business Loan|Two[- ]?Wheeler Loan|Education Loan|Overdraft)\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+[₹₹]?\s*([\d,]+)/g
  const enqDetails = []
  for (const m of enqSec.matchAll(ENQ_ROW)) {
    enqDetails.push({ institution: m[1].trim(), product: m[2], date: mkDate(m[3], m[4], m[5]) })
  }
  const inWin = n => enqDetails.filter(e => { const x = (anchor - e.date) / 86400000; return x >= 0 && x <= n })
  const byType = {}; enqDetails.forEach(e => { byType[e.product] = (byType[e.product] || 0) + 1 })
  const enquiries = {
    total: enqDetails.length,
    last30: inWin(30).length, last60: inWin(60).length, last90: inWin(90).length,
    items30: inWin(30).map(e => ({ institution: e.institution, product: e.product, date: fmtD(e.date) })),
    items60: inWin(60).map(e => ({ institution: e.institution, product: e.product, date: fmtD(e.date) })),
    items90: inWin(90).map(e => ({ institution: e.institution, product: e.product, date: fmtD(e.date) })),
    byType, details: enqDetails,
  }

  // ── Accounts ─────────────────────────────────────────────────────────────────
  const accounts = []
  const seen = new Set()

  // TASK 2: collect ALL matches first so each block is bounded to the next match
  const rx = /(?:Back\s+to\s+Top\s+Credit\s+Factors\s+)?([A-Z][A-Z0-9 &]{1,40}?)\s+Product\s+Type\s*[-–]\s*(.+?)\s+Status:\s*(Active|Closed|Payment Delayed)/gi
  const allMatches = [...text.matchAll(rx)]

  for (let mi = 0; mi < allMatches.length; mi++) {
    const m = allMatches[mi]

    // TASK 3: clean bank name — strip all leading noise tokens repeatedly
    let rawName = m[1].trim()
    // Strip repeating "Back to Top", "Credit Factors", dates, "Report Date", ECN lines
    let prev = null
    while (prev !== rawName) {
      prev = rawName
      rawName = rawName
        .replace(/^(BACK\s+TO\s+TOP\s+CREDIT\s+FACTORS|BACK\s+TO\s+TOP|CREDIT\s+FACTORS)\s*/gi, '')
        .replace(/^(ACTIVE LOAN ACCOUNTS|ACTIVE CREDIT CARD ACCOUNTS|CLOSED LOAN ACCOUNTS|CLOSED CREDIT CARD ACCOUNTS|ACTIVE ACCOUNTS|CLOSED ACCOUNTS|OPEN ACCOUNTS|ALL ACCOUNTS)\s*/gi, '')
        .replace(/^\d{1,2}\s+\w+\s+\d{4}\s*/g, '')
        .replace(/^Report\s*Date\s*:?\s*/gi, '')
        .replace(/^Enquiry\s+Control\s+Number\s*\S*\s*/gi, '')
        .trim()
    }
    // Keep only the trailing uppercase institution token-run
    // e.g. "y 2026 Back to Top Credit Factors BOB" → after stripping → "BOB"
    // Use the last contiguous run of [A-Z0-9 &.] that looks like an institution
    const instM = rawName.match(/([A-Z][A-Z0-9 &.'\/\-]{1,39}?)$/)
    let bankName = instM ? instM[1].trim() : rawName.trim()
    // Final fallback: take last word-run after any lowercase contamination
    if (/[a-z]/.test(bankName)) {
      const parts = rawName.split(/[^A-Z0-9 &.'\/\-]+/)
      bankName = parts.filter(p => /[A-Z]{2,}/.test(p) && p.trim().length >= 2).pop()?.trim() || ''
    }
    if (!bankName || isNoise(bankName)) continue

    const loanType  = m[2].trim()
    const rawStatus = m[3].trim()
    const status    = rawStatus === 'Payment Delayed' ? 'Active' : rawStatus

    // TASK 2: bound block to start of next match (prevents field bleed into next account)
    const blockStart = m.index
    const blockEnd   = allMatches[mi + 1]?.index ?? text.length
    const block      = text.slice(blockStart, blockEnd)

    const g = (rx) => { const x = block.match(rx); return x ? x[1].replace(/,/g,'').trim() : '' }

    // TASK 4: credit cards use Credit Limit, loans use Sanction Amount
    const isCard = /credit\s*card/i.test(loanType)
    const sanctioned  = g(/Sanction(?:ed)?\s*Amount\s*[₹₹]?\s*([\d,]+)/i)
    const creditLimit = g(/Credit\s*Limit\s*[₹₹]?\s*([\d,]+)/i)
    const loanAmount  = isCard ? (creditLimit || sanctioned) : (sanctioned || creditLimit)

    const outstanding = g(/Current\s*Outstanding\s*[₹₹]?\s*([\d,]+)/i) ||
                        g(/Current\s*Balance\s*[₹₹]?\s*([\d,]+)/i)
    const overdue     = g(/Overdue\s*Amount\s*[₹₹]?\s*([\d,]+)/i)
    const emi         = g(/EMI\s*Amount\s*[₹₹]?\s*([\d,]+)/i)
    const openDate    = g(/Date\s*Opened\s+(\d{2}\s+\w+\s+\d{4})/i)

    // TASK 2: closed = only a real date (not "NA") in Date Closed field
    const closedRaw   = block.match(/Date\s*Closed\s+(\d{2}\s+\w+\s+\d{4}|NA)/i)?.[1] || ''
    const closedDate  = (closedRaw && closedRaw !== 'NA') ? closedRaw : ''
    const isClosed    = status === 'Closed' || !!closedDate

    const accountNum  = g(/Account\s*Number\s+(X+[\w]+)/i)

    // TASK 6B: DPD — PaisaBazaar grid is icons (not text); use summary line only
    // Historical late markers in the payment grid are NOT recoverable from PDF text extraction
    const dpdM = block.match(/Payment\s*Delayed\s*by:\s*(\d+)\s*days/i)
    const dpds = dpdM ? dpdM[1] : '0'

    // Settlement — Suit-Filed Status field; treat NA / ₹-1 / 0 as blank
    let settlement = ''
    const settM = block.match(/Suit[- ]?Filed\s*Status\s+(NA|[₹₹]?\s*-?[\d,]+)/i)
    if (settM && settM[1] !== 'NA') {
      const sv = parseInt(settM[1].replace(/[^0-9]/g, '')) || 0
      if (sv > 0) settlement = String(sv)
    }
    // Written-off — Principal Write-off Amount field; treat NA / 0 as blank
    let writtenOff = ''
    const woM = block.match(/Principal\s*Write[- ]?off\s*Amount\s+(NA|[₹₹]?\s*-?[\d,]+)/i)
    if (woM && woM[1] !== 'NA') {
      const wv = parseInt(woM[1].replace(/[^0-9]/g, '')) || 0
      if (wv > 0) writtenOff = String(wv)
    }
    const pbStatusTag = isClosed
      ? (settlement ? 'Closed · Settled' : writtenOff ? 'Closed · Written-off' : 'Closed')
      : 'Active'

    const key = `${bankName}|${loanType}|${accountNum}`
    if (seen.has(key)) continue
    seen.add(key)

    accounts.push({
      bankName, loanType, loanAmount, accountNum,
      outstanding: isClosed ? '0' : outstanding,
      emi, openDate, closedDate,
      dpds, overdue: (!overdue || overdue === '0') ? '' : overdue,
      settlement, writtenOff, status: pbStatusTag
    })
  }
  return { accounts, score, customerName, enquiries, reportDate }
}

const inr = (v) => {
  if (!v || v === '0') return '—'
  const n = parseInt(String(v).replace(/[^0-9]/g, ''))
  if (isNaN(n) || n === 0) return '—'
  return '₹' + n.toLocaleString('en-IN')
}

export default function CibilParser({ userRole, userId, source, onUseInCam }) {
  const [accounts,setAccounts]           = useState([])
  const [parsing,setParsing]             = useState(false)
  const [error,setError]                 = useState('')
  const [fileName,setFileName]           = useState('')
  const [pendingFile,setPendingFile]     = useState(null)
  const [format,setFormat]               = useState('')
  const [formatWarning,setFormatWarning] = useState('')
  const [score,setScore]                 = useState(null)
  const [customerName,setCustomerName]   = useState('')
  const [enquiries,setEnquiries]         = useState(null)
  const [showAll,setShowAll]             = useState(false)
  const [editIdx,setEditIdx]             = useState(null)
  const [editData,setEditData]           = useState({})
  const [saving,setSaving]               = useState(false)
  const [savedMsg,setSavedMsg]           = useState('')
  const [leadSearch,setLeadSearch]       = useState('')
  const [leads,setLeads]                 = useState([])
  const [selectedLead,setSelectedLead]   = useState(null)
  const [showLeadDrop,setShowLeadDrop]   = useState(false)
  const [debugText,setDebugText]         = useState('')
  const [showDebug,setShowDebug]         = useState(false)
  const [needsPwd,setNeedsPwd]           = useState(false)
  const [pwd,setPwd]                     = useState('')
  const [pwdErr,setPwdErr]               = useState('')
  const [showPwd,setShowPwd]             = useState(false)
  const [showEnqDetail,setShowEnqDetail] = useState(false)
  const pwdRef = useRef(null)

  useEffect(()=>{ loadPdfJs() },[])
  useEffect(()=>{ if(needsPwd&&pwdRef.current) pwdRef.current.focus() },[needsPwd])
  useEffect(()=>{
    if(!leadSearch||leadSearch.length<2){setLeads([]);return}
    const t=setTimeout(async()=>{ const{data}=await supabase.from('leads').select('id,full_name,mobile').ilike('full_name',`%${leadSearch}%`).limit(8); setLeads(data||[]) },300)
    return()=>clearTimeout(t)
  },[leadSearch])

  const parseFile = useCallback(async(file,password='')=>{
    setError('');setParsing(true);setPwdErr('');setFormatWarning('')
    setAccounts([]);setFormat('');setScore(null);setCustomerName('');setEnquiries(null);setDebugText('')
    try{
      const { text, pdf, pdfjsLib } = await extractTextFromPDF(file,password)
      setDebugText(text)
      if(!text||text.trim().length<50) throw new Error('PDF appears empty or image-only.')

      const detected = detectFormat(text)

      // TASK 1: if source prop provided, force that parser; warn if mismatch
      const fmt = source || detected
      setFormat(fmt)
      if (source && detected !== 'unknown' && detected !== source) {
        setFormatWarning(`This looks like a ${detected === 'cibil' ? 'CIBIL.com' : 'PaisaBazaar'} report — you may want the other tool`)
      }

      let result = { accounts:[], score:null, customerName:'', enquiries:null }
      if (fmt === 'cibil')            result = parseCibil(text)
      else if (fmt === 'paisabazaar') result = parsePaisaBazaar(text)
      else { setError(`Format not recognised. Preview: "${text.slice(0,200)}"`); setShowDebug(true); setParsing(false); return }

      // PART B: enrich PaisaBazaar accounts with canvas-extracted late payment data
      if (fmt === 'paisabazaar' && result.accounts.length > 0) {
        try {
          const late = await extractLatePayments(pdf, pdfjsLib)
          console.log('[PART B] account accountNums:', result.accounts.map(a=>a.accountNum))
          console.log('[PART B] late keys:', Object.keys(late))
          result.accounts.forEach(a => {
            const lp = a.accountNum && late[a.accountNum]
            console.log(`[PART B] ${a.bankName} (${a.accountNum||'?'}):`, lp ? `late1_89=${lp.late1_89} late90=${lp.late90}` : 'no canvas match')
            if (lp) {
              a.latePayments = lp
              a.dpds = lp.late90   ? `90+ days (×${lp.late90})`
                     : lp.late1_89 ? `1-89 days (×${lp.late1_89})`
                     : a.dpds
              if (lp.late90 || lp.late1_89) a.lateMonths = lp.months
            }
          })
        } catch (lpErr) {
          // Canvas extraction failed — silently continue with text-only DPDs
          console.warn('Late payment extraction failed:', lpErr)
        }
      }

      if(result.accounts.length===0){ setError(`Detected "${fmt}" but 0 accounts found. Check Debug Panel.`); setShowDebug(true) }
      setAccounts(result.accounts); setScore(result.score); setCustomerName(result.customerName); setEnquiries(result.enquiries||null)
      setNeedsPwd(false); setPwd('')
    }catch(e){
      if(e.message==='NEEDS_PASSWORD'){ setNeedsPwd(true); setPendingFile(file); setParsing(false); return }
      if(e.message==='WRONG_PASSWORD'){ setPwdErr('Incorrect password. Try again.'); setParsing(false); return }
      setError('Parse failed: '+e.message)
    }finally{ setParsing(false) }
  },[source])

  const handleFile = useCallback((file)=>{
    if(!file||file.type!=='application/pdf'){ setError('Please upload a valid PDF.'); return }
    setFileName(file.name); setNeedsPwd(false); setPwd(''); setPwdErr('')
    parseFile(file,'')
  },[parseFile])

  const handleDrop=(e)=>{ e.preventDefault(); handleFile(e.dataTransfer.files[0]) }
  const submitPwd=()=>{ if(pendingFile) parseFile(pendingFile,pwd) }

  const save=async()=>{
    if(!selectedLead){ setError('Select a customer first.'); return }
    setSaving(true); setSavedMsg('')
    try{
      const{error:err}=await supabase.from('customer_cibil_data').upsert({
        lead_id:selectedLead.id, customer_name:customerName||selectedLead.full_name,
        cibil_score:score, report_source:format,
        report_date:new Date().toISOString().split('T')[0],
        accounts, enquiries, uploaded_by:userId, uploaded_at:new Date().toISOString()
      },{onConflict:'lead_id'})
      if(err) throw err
      setSavedMsg('✅ Saved!'); setTimeout(()=>setSavedMsg(''),3000)
    }catch(e){ setError('Save failed: '+e.message) }
    finally{ setSaving(false) }
  }

  const exportCSV=()=>{
    const h=['Bank Name','Loan Type','Loan Amount','Outstanding','EMI/Obligation','Open Date','Closed Date','DPDs','Overdue','Settlement','Status']
    const r=accounts.map(a=>{
      const ob = monthlyObligation(a)
      return [a.bankName,a.loanType,a.loanAmount,a.outstanding,ob||a.emi,a.openDate,a.closedDate||'',a.dpds,a.overdue,a.settlement,a.status]
    })
    const csv=[h,...r].map(row=>row.map(v=>`"${v||''}"`).join(',')).join('\n')
    const el=document.createElement('a'); el.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}))
    el.download=`CIBIL_${customerName||'Report'}.csv`; el.click()
  }

  const reset=()=>{
    setAccounts([]);setFileName('');setFormat('');setScore(null);setCustomerName('')
    setSelectedLead(null);setLeadSearch('');setEnquiries(null);setFormatWarning('')
    setDebugText('');setShowDebug(false);setNeedsPwd(false);setPwd('');setPwdErr('')
  }

  const active  = accounts.filter(a=>a.status==='Active')
  const shown   = showAll ? accounts : active
  const totOut  = active.reduce((s,a)=>s+(parseInt(String(a.outstanding||'0').replace(/[^0-9]/g,''))||0),0)
  const totObl  = active.reduce((s,a)=>s+monthlyObligation(a),0)
  const totLoan = active.reduce((s,a)=>s+(parseInt(String(a.loanAmount||'0').replace(/[^0-9]/g,''))||0),0)
  const highDpd = accounts.some(a=>{ const d=parseInt(a.dpds)||0; return d>90||(a.dpds&&String(a.dpds).includes('90+')) })
  const hasSett    = accounts.some(a=>a.settlement&&a.settlement!=='0')
  const hasWritten = accounts.some(a=>a.writtenOff&&a.writtenOff!=='0')

  // Page title / subtitle based on source prop
  const pageTitle    = source==='paisabazaar' ? '📊 PaisaBazaar Analyzer' : source==='cibil' ? '📊 CIBIL.com Analyzer' : '📊 CIBIL Parser'
  const pageSubtitle = source==='paisabazaar' ? 'Upload PaisaBazaar Credit Health Report PDF'
                     : source==='cibil'       ? 'Upload CIBIL.com myscore PDF'
                     : 'Upload CIBIL report to auto-extract loan data'

  const S={
    pg:  {padding:'24px',background:'var(--bg,#F8FAFC)',minHeight:'100vh'},
    crd: {background:'#fff',borderRadius:12,border:'1px solid #E2E8F0',marginBottom:16,overflow:'hidden'},
    hdr: {padding:'16px 20px',borderBottom:'1px solid #F1F5F9',display:'flex',alignItems:'center',justifyContent:'space-between'},
    ttl: {fontSize:14,fontWeight:700,color:'#1A202C',margin:0},
    bdg: (bg,fg)=>({background:bg,color:fg,padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:600}),
    btn: (bg,fg='#fff')=>({background:bg,color:fg,border:'none',borderRadius:8,padding:'9px 18px',cursor:'pointer',fontSize:13,fontWeight:600,display:'inline-flex',alignItems:'center',gap:6}),
    inp: {border:'1px solid #E2E8F0',borderRadius:8,padding:'8px 12px',fontSize:13,width:'100%',outline:'none',boxSizing:'border-box'},
    th:  {padding:'10px 14px',fontSize:11,fontWeight:600,color:'#718096',textAlign:'left',textTransform:'uppercase',letterSpacing:'0.5px',background:'#F9FAFB',borderBottom:'1px solid #E2E8F0',whiteSpace:'nowrap'},
    td:  {padding:'11px 14px',fontSize:13,color:'#2D3748',borderBottom:'1px solid #F7FAFC'},
  }

  // Score band: PaisaBazaar uses 800+ = Excellent, 750-799 = Very Good
  const scC = s => s>=750?'#276749':s>=650?'#B45309':'#DC2626'
  const scB = s => s>=750?'#F0FFF4':s>=650?'#FFFBEB':'#FEF2F2'
  const scL = s => {
    if (s>=800) return 'Excellent'
    if (s>=750) return source==='paisabazaar' ? 'Very Good' : 'Excellent'
    if (s>=700) return 'Good'
    if (s>=650) return 'Fair'
    return 'Poor'
  }

  return (
    <div style={S.pg}>
      <div style={{marginBottom:20,display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10}}>
        <div>
          <h2 style={{margin:0,fontSize:18,fontWeight:700,color:'#1A202C'}}>{pageTitle}</h2>
          <p style={{margin:'2px 0 0',fontSize:13,color:'#718096'}}>{pageSubtitle}</p>
        </div>
        {format&&<span style={S.bdg(format==='cibil'?'#EFF6FF':'#F0FFF4',format==='cibil'?'#1D4ED8':'#15803D')}>📄 {format==='cibil'?'CIBIL.com':'PaisaBazaar'} Format Detected</span>}
      </div>

      {formatWarning&&<div style={{background:'#FFFBEB',border:'1px solid #FDE68A',borderRadius:8,padding:'10px 16px',marginBottom:12,color:'#B45309',fontSize:13,fontWeight:500}}>⚠️ {formatWarning}</div>}
      {highDpd&&<div style={{background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:8,padding:'10px 16px',marginBottom:12,color:'#DC2626',fontSize:13,fontWeight:500}}>⚠️ One or more accounts have DPD over 90 days</div>}
      {hasSett&&<div style={{background:'#FFFBEB',border:'1px solid #FDE68A',borderRadius:8,padding:'10px 16px',marginBottom:12,color:'#B45309',fontSize:13,fontWeight:500}}>⚠️ Settlement found on one or more accounts</div>}
      {hasWritten&&<div style={{background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:8,padding:'10px 16px',marginBottom:12,color:'#DC2626',fontSize:13,fontWeight:500}}>⚠️ Written-off amount found on one or more accounts</div>}
      {score!==null&&score<650&&<div style={{background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:8,padding:'10px 16px',marginBottom:12,color:'#DC2626',fontSize:13,fontWeight:500}}>⚠️ Low CIBIL Score: {score}</div>}
      {error&&<div style={{background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:8,padding:'10px 16px',marginBottom:12,color:'#DC2626',fontSize:13}}>{error}</div>}
      {savedMsg&&<div style={{background:'#F0FFF4',border:'1px solid #9AE6B4',borderRadius:8,padding:'10px 16px',marginBottom:12,color:'#276749',fontSize:13,fontWeight:600}}>{savedMsg}</div>}

      {needsPwd&&(
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.55)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'#fff',borderRadius:16,padding:32,width:400,boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
            <div style={{fontSize:40,textAlign:'center',marginBottom:12}}>🔐</div>
            <h3 style={{margin:'0 0 6px',fontSize:16,fontWeight:700,color:'#1A202C',textAlign:'center'}}>PDF is Password Protected</h3>
            <p style={{margin:'0 0 20px',fontSize:13,color:'#718096',textAlign:'center'}}>
              <strong>PaisaBazaar default:</strong> Date of Birth in <code style={{background:'#F7FAFC',padding:'1px 6px',borderRadius:4}}>DDMMYYYY</code> format
            </p>
            {pwdErr&&<div style={{background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:8,padding:'8px 12px',marginBottom:12,color:'#DC2626',fontSize:13}}>{pwdErr}</div>}
            <div style={{position:'relative',marginBottom:16}}>
              <input ref={pwdRef} type={showPwd?'text':'password'} value={pwd}
                onChange={e=>setPwd(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submitPwd()}
                placeholder="e.g. 14121979" style={{...S.inp,paddingRight:44,fontSize:15}}/>
              <button onClick={()=>setShowPwd(v=>!v)} style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',fontSize:18,color:'#718096'}}>
                {showPwd?'🙈':'👁️'}
              </button>
            </div>
            <div style={{display:'flex',gap:10}}>
              <button style={{...S.btn('#185FA5'),flex:1,justifyContent:'center'}} onClick={submitPwd} disabled={parsing}>{parsing?'⏳ Unlocking…':'🔓 Unlock & Parse'}</button>
              <button style={{...S.btn('#F1F5F9','#718096'),flex:1,justifyContent:'center'}} onClick={()=>{setNeedsPwd(false);setPwd('');setPwdErr('')}}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {accounts.length===0&&!parsing&&!needsPwd&&(
        <div style={S.crd}>
          <div onDrop={handleDrop} onDragOver={e=>e.preventDefault()} onClick={()=>document.getElementById('cibil-inp').click()}
            style={{padding:'48px 32px',textAlign:'center',cursor:'pointer',border:'2px dashed #CBD5E0',borderRadius:12,margin:16}}
            onMouseEnter={e=>e.currentTarget.style.borderColor='#185FA5'}
            onMouseLeave={e=>e.currentTarget.style.borderColor='#CBD5E0'}>
            <div style={{fontSize:40,marginBottom:12}}>☁️</div>
            <h3 style={{margin:'0 0 6px',color:'#2D3748',fontSize:15}}>Upload CIBIL Report PDF</h3>
            <p style={{color:'#718096',margin:'0 0 4px',fontSize:13}}>Drag and drop or click to browse</p>
            <p style={{color:'#A0AEC0',margin:0,fontSize:12}}>
              {source==='cibil'?'CIBIL.com myscore PDFs':source==='paisabazaar'?'PaisaBazaar Credit Health Reports':'CIBIL.com · PaisaBazaar · Password-protected PDFs ✓'}
            </p>
            <input id="cibil-inp" type="file" accept=".pdf" style={{display:'none'}} onChange={e=>handleFile(e.target.files[0])}/>
          </div>
        </div>
      )}

      {parsing&&<div style={{...S.crd,padding:32,textAlign:'center'}}><div style={{fontSize:32,marginBottom:10}}>⏳</div><p style={{color:'#718096',margin:0}}>Parsing…</p></div>}

      {debugText&&(
        <div style={{...S.crd,marginBottom:16}}>
          <div style={{...S.hdr,background:'#1A202C'}}>
            <h3 style={{...S.ttl,color:'#F7FAFC'}}>🔧 Debug Panel</h3>
            <div style={{display:'flex',gap:8}}>
              <button style={S.btn('#3182CE')} onClick={()=>navigator.clipboard.writeText(debugText.slice(0,5000)).then(()=>alert('Copied!')).catch(()=>alert('Select manually'))}>📋 Copy</button>
              <button style={S.btn('#718096')} onClick={()=>setShowDebug(v=>!v)}>{showDebug?'Hide':'Show'} Raw</button>
            </div>
          </div>
          {showDebug&&(
            <div style={{padding:16}}>
              <div style={{background:'#F7FAFC',border:'1px solid #E2E8F0',borderRadius:8,padding:12,marginBottom:12,fontSize:11,color:'#4A5568'}}>
                <b>Format:</b> {format||'NONE'} &nbsp;|&nbsp; <b>Chars:</b> {debugText.length} &nbsp;|&nbsp; <b>Accounts:</b> {accounts.length} &nbsp;|&nbsp; <b>Score:</b> {score||'—'}
              </div>
              <textarea readOnly value={debugText.slice(0,3000)} style={{width:'100%',height:260,fontSize:11,fontFamily:'monospace',background:'#1A202C',color:'#68D391',border:'none',borderRadius:8,padding:12,resize:'vertical',boxSizing:'border-box'}}/>
            </div>
          )}
        </div>
      )}

      {accounts.length>0&&(
        <>
          <div style={{...S.crd,padding:'20px 24px',display:'flex',alignItems:'center',gap:20,flexWrap:'wrap'}}>
            {customerName&&<div style={{fontSize:15,fontWeight:700,color:'#2D3748'}}>👤 {customerName}</div>}
            {score!==null&&(
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{background:scB(score),color:scC(score),padding:'8px 20px',borderRadius:24,fontWeight:800,fontSize:22}}>{score}</div>
                <div>
                  <div style={{fontSize:11,color:'#718096'}}>CIBIL Score</div>
                  <div style={{fontSize:13,fontWeight:700,color:scC(score)}}>{scL(score)}</div>
                </div>
              </div>
            )}
            <div style={{fontSize:12,color:'#718096',marginLeft:'auto'}}>📄 {fileName}</div>
          </div>

          <div style={{display:'flex',gap:12,marginBottom:16,flexWrap:'wrap'}}>
            {[
              {label:'Active Loans',       value:active.length,    color:'#185FA5',bg:'#E6F1FB'},
              {label:'Total Accounts',     value:accounts.length,  color:'#534AB7',bg:'#EEEDFE'},
              {label:'Total Outstanding',  value:inr(totOut),      color:'#854F0B',bg:'#FAEEDA'},
              {label:'Total EMI/Obligation',value:inr(totObl),     color:'#0F6E56',bg:'#E1F5EE'},
            ].map(s=>(
              <div key={s.label} style={{background:s.bg,borderRadius:10,padding:'12px 18px',flex:'1 1 140px'}}>
                <div style={{fontSize:11,color:s.color,fontWeight:600,textTransform:'uppercase'}}>{s.label}</div>
                <div style={{fontSize:20,fontWeight:700,color:s.color,marginTop:2}}>{s.value}</div>
              </div>
            ))}
          </div>

          {enquiries&&(
            <div style={{...S.crd,padding:'16px 20px',marginBottom:16}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                <div style={{fontSize:13,fontWeight:700,color:'#1A202C'}}>🔍 Credit Enquiries</div>
                {enquiries.details&&enquiries.details.length>0&&(
                  <button style={S.btn('#EFF6FF','#1D4ED8')} onClick={()=>setShowEnqDetail(v=>!v)}>
                    {showEnqDetail?'Hide Details':'Show Details'}
                  </button>
                )}
              </div>

              {/* 30/60/90 window cards */}
              <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:12}}>
                {[
                  {l:'Last 30 Days', v:enquiries.last30, items:enquiries.items30||[], w:3},
                  {l:'Last 60 Days', v:enquiries.last60, items:enquiries.items60||[], w:5},
                  {l:'Last 90 Days', v:enquiries.last90, items:enquiries.items90||[], w:8},
                ].map(e=>{
                  const bad=e.v>e.w
                  return(
                    <div key={e.l} style={{background:bad?'#FEF2F2':'#F7FAFC',border:`1px solid ${bad?'#FECACA':'#E2E8F0'}`,borderRadius:10,padding:'12px 16px',flex:'1 1 160px'}}>
                      <div style={{fontSize:28,fontWeight:800,color:bad?'#DC2626':'#2D3748'}}>{e.v}</div>
                      <div style={{fontSize:11,fontWeight:600,color:bad?'#DC2626':'#718096',marginTop:2}}>{e.l}</div>
                      {bad&&<div style={{fontSize:10,color:'#DC2626',marginTop:4,fontWeight:600}}>⚠️ HIGH</div>}
                      {e.items.length>0&&(
                        <div style={{marginTop:6,fontSize:10,color:'#4A5568',lineHeight:1.5}}>
                          {e.items.map((b,i)=><div key={i}>• {b.institution}{b.product?' — '+b.product:''}{b.date?' · '+b.date:''}</div>)}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Detailed enquiry table */}
              {showEnqDetail&&enquiries.details&&enquiries.details.length>0&&(
                <div style={{marginTop:12,overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <thead><tr>{['Institution','Product','Date','Amount'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {enquiries.details.map((d,i)=>(
                        <tr key={i} style={{background:i%2===0?'#fff':'#FAFAFA'}}>
                          <td style={{...S.td,fontWeight:500}}>{d.institution||'—'}</td>
                          <td style={S.td}>{d.product||'—'}</td>
                          <td style={S.td}>{d.date?d.date.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):'—'}</td>
                          <td style={S.td}>{d.amount?inr(d.amount):'—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div style={S.crd}>
            <div style={S.hdr}><h3 style={S.ttl}>🔗 Link to Customer Profile</h3></div>
            <div style={{padding:'14px 20px',display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
              <div style={{position:'relative',flex:'1 1 260px'}}>
                <input style={S.inp} placeholder="Search customer name…" value={leadSearch}
                  onChange={e=>{setLeadSearch(e.target.value);setShowLeadDrop(true)}} onFocus={()=>setShowLeadDrop(true)}/>
                {showLeadDrop&&leads.length>0&&(
                  <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:'1px solid #E2E8F0',borderRadius:8,zIndex:100,boxShadow:'0 4px 16px rgba(0,0,0,0.1)',maxHeight:200,overflowY:'auto'}}>
                    {leads.map(l=>(
                      <div key={l.id} onClick={()=>{setSelectedLead(l);setLeadSearch(l.full_name);setShowLeadDrop(false)}}
                        style={{padding:'10px 14px',cursor:'pointer',fontSize:13,borderBottom:'1px solid #F7FAFC'}}
                        onMouseEnter={e=>e.currentTarget.style.background='#F7FAFC'}
                        onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                        <strong>{l.full_name}</strong><span style={{color:'#718096',marginLeft:8}}>{l.mobile}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {selectedLead&&<span style={S.bdg('#F0FFF4','#276749')}>✓ {selectedLead.full_name}</span>}
              <button style={S.btn('#185FA5')} onClick={save} disabled={saving}>{saving?'⏳ Saving…':'💾 Save to Profile'}</button>
            </div>
          </div>

          <div style={S.crd}>
            <div style={S.hdr}>
              <h3 style={S.ttl}>Loan Summary ({shown.length} accounts)</h3>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                <button style={S.btn(showAll?'#EFF6FF':'#F9FAFB',showAll?'#1D4ED8':'#718096')} onClick={()=>setShowAll(!showAll)}>{showAll?'Active Only':'Show All'}</button>
                <button style={S.btn('#0F6E56')} onClick={exportCSV}>⬇ Export CSV</button>
                {onUseInCam && <button style={S.btn('#185FA5')} onClick={() => {
                  try {
                    sessionStorage.setItem('cam_import_payload', JSON.stringify({
                      accounts,
                      score,
                      customerName,
                      flags: { highDpd, hasSett, hasWritten }
                    }));
                    if (onUseInCam) onUseInCam();
                  } catch (e) { console.error('CAM handoff failed', e); }
                }}>📋 Build CAM from this report</button>}
                <button style={S.btn('#F1F5F9','#718096')} onClick={reset}>↩ New Upload</button>
              </div>
            </div>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead><tr>{['Bank Name','Loan Type','Loan Amount','Outstanding','EMI/Obligation','Open Date','Closed Date','DPDs','Overdue','Settlement','Status',''].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {shown.map((acc,i)=>{
                    const ri=accounts.indexOf(acc); const isE=editIdx===ri; const dpd=parseInt(acc.dpds)||0
                    const obl = monthlyObligation(acc)
                    const isCard = /credit\s*card/i.test(acc.loanType||'')
                    const isGold = /gold/i.test(acc.loanType||'')
                    const oblNote = isCard ? '5% of o/s' : isGold ? '1% of o/s' : ''
                    return(
                      <tr key={i} style={{background:i%2===0?'#fff':'#FAFAFA'}}>
                        {isE?(<>
                          {['bankName','loanType','loanAmount','outstanding','emi','openDate','closedDate','dpds','overdue','settlement'].map(f=>(
                            <td key={f} style={S.td}><input value={editData[f]||''} onChange={e=>setEditData({...editData,[f]:e.target.value})} style={{...S.inp,padding:'5px 8px',minWidth:70}}/></td>
                          ))}
                          <td style={S.td}><span style={S.bdg('#E1F5EE','#0F6E56')}>{editData.status}</span></td>
                          <td style={{...S.td,whiteSpace:'nowrap'}}>
                            <button style={S.btn('#185FA5')} onClick={()=>{const u=[...accounts];u[ri]=editData;setAccounts(u);setEditIdx(null)}}>Save</button>
                            <button style={{...S.btn('#F1F5F9','#718096'),marginLeft:6}} onClick={()=>setEditIdx(null)}>Cancel</button>
                          </td>
                        </>):(<>
                          <td style={{...S.td,fontWeight:600}}>{acc.bankName}</td>
                          <td style={S.td}>{acc.loanType}</td>
                          <td style={S.td}>{inr(acc.loanAmount)}</td>
                          <td style={{...S.td,color:acc.outstanding&&acc.outstanding!=='0'?'#854F0B':'#718096',fontWeight:500}}>{inr(acc.outstanding)}</td>
                          <td style={{...S.td,color:'#534AB7',fontWeight:500}}>
                            {obl>0
                              ? <div>{inr(obl)}{oblNote&&<div style={{fontSize:10,color:'#718096',marginTop:1}}>{oblNote}</div>}</div>
                              : <span style={{color:'#A0AEC0'}}>—</span>
                            }
                          </td>
                          <td style={{...S.td,color:'#718096'}}>{acc.openDate||'—'}</td>
                          <td style={{...S.td,color:'#718096'}}>{acc.closedDate||'—'}</td>
                          <td style={S.td}>{(()=>{
                            const ds=String(acc.dpds||'0')
                            const isHigh=dpd>90||ds.includes('90+')
                            const hasLate=dpd>0||ds.includes('1-89')||ds.includes('90+')
                            const label=ds.includes('days')||ds.includes('+')?ds:dpd>0?ds+' days':null
                            return hasLate&&label?(
                              <div>
                                <span style={S.bdg(isHigh?'#FEF2F2':'#FFFBEB',isHigh?'#DC2626':'#B45309')}>{label}</span>
                                {acc.lateMonths&&acc.lateMonths.length>0&&(
                                  <div style={{fontSize:9,color:'#A0AEC0',marginTop:3,lineHeight:1.4,maxWidth:150}}>{acc.lateMonths.join(', ')}</div>
                                )}
                              </div>
                            ):<span style={{color:'#A0AEC0',fontSize:12}}>—</span>
                          })()}</td>
                          <td style={{...S.td,color:acc.overdue?'#DC2626':'#718096'}}>{inr(acc.overdue)}</td>
                          <td style={{...S.td,color:acc.settlement?'#DC2626':'#718096'}}>{inr(acc.settlement)}</td>
                          <td style={S.td}>{(()=>{
                            const isActive=acc.status==='Active', isSett=acc.status?.includes('Settled'), isWO=acc.status?.includes('Written-off')
                            const sbg=isActive?'#E1F5EE':isSett?'#FFFBEB':isWO?'#FEF2F2':'#F1F5F9'
                            const sfg=isActive?'#0F6E56':isSett?'#B45309':isWO?'#DC2626':'#718096'
                            return <span style={S.bdg(sbg,sfg)}>{acc.status}</span>
                          })()}</td>
                          <td style={{...S.td,whiteSpace:'nowrap'}}>
                            <button style={{background:'none',border:'1px solid #E2E8F0',borderRadius:6,padding:'4px 8px',cursor:'pointer',fontSize:12,marginRight:4}} onClick={()=>{setEditIdx(ri);setEditData({...acc})}}>✏️</button>
                            <button style={{background:'none',border:'1px solid #FECACA',borderRadius:6,padding:'4px 8px',cursor:'pointer',fontSize:12}} onClick={()=>setAccounts(accounts.filter((_,j)=>j!==ri))}>🗑</button>
                          </td>
                        </>)}
                      </tr>
                    )
                  })}
                  {active.length>0&&(
                    <tr style={{background:'#EFF6FF',borderTop:'2px solid #BEE3F8'}}>
                      <td style={{...S.td,fontWeight:700,color:'#1A202C',fontSize:12}}>TOTAL</td>
                      <td style={S.td}></td>
                      <td style={{...S.td,fontWeight:700,color:'#185FA5'}}>{totLoan?'₹'+totLoan.toLocaleString('en-IN'):'—'}</td>
                      <td style={{...S.td,fontWeight:700,color:'#854F0B'}}>{totOut?'₹'+totOut.toLocaleString('en-IN'):'—'}</td>
                      <td style={{...S.td,fontWeight:700,color:'#0F6E56'}}>{totObl?'₹'+totObl.toLocaleString('en-IN'):'—'}</td>
                      <td style={S.td}></td><td style={S.td}></td><td style={S.td}></td>
                      <td style={S.td}></td><td style={S.td}></td><td style={S.td}></td><td style={S.td}></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {!showAll&&accounts.length>active.length&&(
              <div style={{padding:'12px 20px',fontSize:12,color:'#718096',textAlign:'center'}}>
                {accounts.length-active.length} closed accounts hidden · <span style={{color:'#185FA5',cursor:'pointer'}} onClick={()=>setShowAll(true)}>Show all</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
