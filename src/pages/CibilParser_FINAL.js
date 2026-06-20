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
        resolve(text)
      } catch (err) { reject(err) }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

// CIBIL.com PDFs inject page headers throughout text AND space out letters
// "A mount" = "Amount", "B alance" = "Balance", "A ccount" = "Account"
// Page header pattern: "28/05/2026, 15:05   CIBIL Report   https://...   4/29"
function cleanCibilText(raw) {
  let t = raw
  // Remove page headers first
  t = t.replace(/\d{2}\/\d{2}\/\d{4},?\s*\d{2}:\d{2}\s*CIBIL\s*Report\s*https?:\/\/\S+\s*\d+\/\d+/gi, ' ')
  t = t.replace(/https?:\/\/myscore\.cibil\.com\S*/gi, ' ')
  // Collapse spaced letters — 12 passes handles long chains like "A CCOUNT DET A ILS"
  for (let i = 0; i < 12; i++) {
    t = t.replace(/([A-Za-z]) ([A-Z]) ([A-Za-z])/g, '$1$2$3')
    t = t.replace(/([A-Z]) ([A-Z]) ([A-Z])/g, '$1$2$3')
    t = t.replace(/\b([A-Z]) ([A-Z])\b/g, '$1$2')
  }
  return t
}

function detectFormat(raw) {
  const t = raw.toLowerCase()
  // Check PaisaBazaar FIRST — these markers are unique to PaisaBazaar
  // PaisaBazaar PDFs contain "Enquiry Control Number (ECN)" and "Credit Health Report"
  // They also say "Hey [NAME]," and "Powered by" with score
  // CIBIL.com PDFs say "Control Number :" (no ECN) and "myscore.cibil.com"
  if (t.includes('enquiry control number') ||
      t.includes('credit health report') ||
      t.includes('paisabazaar') ||
      t.includes('back to top') ||
      (t.includes('hey ') && t.includes('here is your credit'))) return 'paisabazaar'
  if (t.includes('myscore.cibil.com') ||
      t.includes('control number :') ||
      t.includes('member name')) return 'cibil'
  // Fallback on cleaned text
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

function countEnquiries(dates) {
  const now = new Date()
  const d30 = new Date(now); d30.setDate(now.getDate() - 30)
  const d60 = new Date(now); d60.setDate(now.getDate() - 60)
  const d90 = new Date(now); d90.setDate(now.getDate() - 90)
  let c30 = 0, c60 = 0, c90 = 0
  for (const dt of dates) {
    if (dt >= d30)      { c30++; c60++; c90++ }
    else if (dt >= d60) { c60++; c90++ }
    else if (dt >= d90) { c90++ }
  }
  return { last30: c30, last60: c60, last90: c90 }
}

// ── CIBIL.COM PARSER ──────────────────────────────────────────────────────────
// CONFIRMED STRUCTURE from raw PDF text:
// The PDF has spaced letters: "A mount" "B alance" "A ccount" etc.
// After cleanCibilText these become "Amount" "Balance" "Account"
// BUT the split keyword "Member Name" may still have a space issue.
// So we split on BOTH raw and cleaned patterns.
//
// FIELD ORDER: Amounts appear BEFORE "Member Name", dates AFTER.
//   [Sanctioned Amount ₹X] [Current Balance ₹Y] [EMI Amount ₹Z]
//   Member Name
//   BANK NAME
//   Account Type / Personal Loan
//   Date Opened / Disbursed  DD/MM/YYYY
//   Payment History
//   May 2026  0  Apr 2026  0  (0=on time, number=days past due)

function parseCibil(raw) {
  const text = cleanCibilText(raw)

  // Score — look in both raw and cleaned
  const sm = text.match(/Your\s*CIBIL\s*Score\s*is\s*(\d{3})/i) ||
             raw.match(/Your CIBIL Score is\s*(\d{3})/i) ||
             raw.match(/\b(7\d{2}|[89]\d{2})\b/)
  const score = sm ? parseInt(sm[1]) : null

  // Name — raw text has unencoded "Name  MR KIRAN KUMAR..." field
  let customerName = ''
  const nf = raw.match(/\bName\s+(MR|MS|MRS|DR)\.?\s+([A-Z][A-Z ]{3,60}?)(?=\s*Date|\s*Gender|\n)/i)
  if (nf) customerName = (nf[1] + ' ' + nf[2]).replace(/\s+/g, ' ').trim()
  if (!customerName) {
    const hm = text.match(/Hello,?\s*(MR|MS|MRS|DR)\.?\s+([A-Z][A-Z ]{3,50}?)(?=\s*Personal|\s*Name\b|\n)/i)
    if (hm) customerName = (hm[1] + ' ' + hm[2]).replace(/\s+/g, ' ').trim()
  }

  // Enquiries — search both raw and cleaned
  const enqDates = []
  const enqSrc = text + ' ' + raw
  for (const m of enqSrc.matchAll(/Date\s*Of\s*Enquiry\s+([\d\/]+)/gi)) {
    const p = m[1].split('/')
    if (p.length === 3) enqDates.push(new Date(+p[2], +p[1]-1, +p[0]))
  }
  const enquiries = countEnquiries(enqDates)

  // ── ACCOUNTS
  // Split cleaned text on "Member Name" — after cleaning spaces are collapsed
  // Also try splitting raw text in case cleaning broke something
  let parts = text.split(/Member\s*Name/i)
  if (parts.length < 2) {
    // fallback: try raw text
    parts = raw.split(/Member\s*Name/i)
  }

  const accounts = []

  for (let i = 1; i < parts.length; i++) {
    const cur  = parts[i]
    const prev = parts[i - 1]

    // Bank name = first clean line
    let bankName = ''
    for (const line of cur.trim().split('\n').map(s => s.trim()).filter(Boolean)) {
      if (/https?:\/\//i.test(line)) continue
      if (/\d{2}\/\d{2}\/\d{4}/.test(line)) continue
      if (/cibil\s*report/i.test(line)) continue
      if (line.length > 60 || line.length < 2) continue
      bankName = line
        .replace(/\d{2}\/\d{2}\/\d{4}.*$/g, '')
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/\s+/g, ' ').trim()
      if (bankName.length > 1) break
    }
    if (!bankName || isNoise(bankName)) continue

    // Account type
    const typeM = cur.match(/Account\s*Type\s+([\w\s\/\-]+?)(?=\s*Account\s*Number|\s*Ownership|\n)/i)
    const loanType = typeM ? typeM[1].replace(/\s+/g, ' ').trim() : ''
    if (!loanType || /employment/i.test(loanType)) continue

    // Helpers — search prev section first (amounts live there), then cur
    const g   = (src, rx) => { const m = src.match(rx); return m ? m[1].replace(/,/g,'').trim() : '' }
    const any = (rx) => g(prev, rx) || g(cur, rx)

    const sanctioned  = any(/Sanctioned\s*Amount\s*[₹\u20b9]?\s*([\d,]+)/i)
    const creditLimit = any(/Credit\s*Limit\s*[₹\u20b9]?\s*([\d,]+)/i)
    const highCredit  = any(/High\s*Credit\s*[₹\u20b9]?\s*([\d,]+)/i)
    const loanAmount  = sanctioned || creditLimit || highCredit

    const outstanding = any(/Current\s*Balance\s*[₹\u20b9]?\s*([\d,]+)/i) ||
                        any(/Current\s*Outstanding\s*[₹\u20b9]?\s*([\d,]+)/i)
    const emi         = any(/EMI\s*Amount\s*[₹\u20b9]?\s*([\d,]+)/i)
    const overdue     = any(/Amount\s*Overdue\s*[₹\u20b9]?\s*([\d,]+)/i)
    const settlement  = any(/Settlement\s*Amount\s*[₹\u20b9]?\s*([\d,]+)/i)

    const openDate   = g(cur, /Date\s*Opened\s*\/?\s*Disbursed\s+([\d\/]+)/i) ||
                       g(cur, /Date\s*Opened[^\d]*([\d\/]+)/i)
    const closedDate = g(cur, /Date\s*Closed\s+([\d\/]+)/i)
    const isClosed   = !!closedDate && closedDate !== '-' &&
                       closedDate.includes('/') && closedDate.length >= 8

    // DPD — strip months/years first, then find numbers 10-365
    const paySec = cur.match(/Payment\s*History[\s\S]{0,2000}/i)?.[0] || ''
    const payClean = paySec
      .replace(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s*20\d{2}\b/gi, '')
      .replace(/\b20\d{2}\b/g, '').replace(/\b19\d{2}\b/g, '')
      .replace(/\d{1,2}\/\d{2}\/\d{4}/g, '').replace(/₹[\d,]+/g, '')
      .replace(/\b\d{4,}\b/g, '')
      .replace(/\bSTD\b|\bXXX\b|\bDBT\b|\bSUB\b|\bLSS\b|\bSMA\b/gi, '')
    const dpdNums = [...payClean.matchAll(/\b(\d+)\b/g)]
      .map(m => +m[1]).filter(n => n >= 10 && n <= 365)
    const maxDpd = dpdNums.length ? Math.max(...dpdNums) : 0

    accounts.push({
      bankName, loanType, loanAmount,
      outstanding: isClosed ? '0' : outstanding,
      emi, openDate,
      dpds:       String(maxDpd),
      overdue:    (!overdue    || overdue    === '0') ? '' : overdue,
      settlement: (!settlement || settlement === '0') ? '' : settlement,
      status:     isClosed ? 'Closed' : 'Active'
    })
  }
  return { accounts, score, customerName, enquiries }
}

// ── PAISABAZAAR PARSER ────────────────────────────────────────────────────────
function parsePaisaBazaar(text) {
  // Score: appears as "Powered by\n762" or "762\nGood"
  const sm = text.match(/Powered\s*by\s*\n?\s*(\d{3})/i) ||
             text.match(/(\d{3})\s*\n?\s*(?:Very Good|Good|Fair|Poor|Excellent)/i) ||
             text.match(/score[^\d]*(\d{3})/i)
  const score = sm ? parseInt(sm[1]) : null

  // Name: "Hey Varatharajan M," or "Hey ANIRUDH TIWARI,"
  const nm = text.match(/Hey\s+([A-Za-z][A-Za-z ]{2,60}?),/i) ||
             text.match(/Hey\s+([A-Za-z][A-Za-z ]{2,60})\s*\n/i)
  const customerName = nm ? nm[1].trim() : ''

  // Enquiries — search whole text for dates in enquiry section
  const MONTHS = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11}
  // Try to find the enquiries section — PaisaBazaar uses "Credit Enquiries" heading
  const enqSec = text.match(/Credit\s*Enquir(?:ies|y)[\s\S]*?(?=Employment\s*Details|Raise\s*a\s*Dispute|$)/i)?.[0] ||
                 text.match(/An overview of all enquiries[\s\S]*?(?=Employment|$)/i)?.[0] || ''
  const enqDates = []
  // Match dates in format "DD Mon YYYY" e.g. "01 Jun 2026"
  const enqSource = enqSec.length > 100 ? enqSec : text
  for (const m of enqSource.matchAll(/(\d{2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/gi)) {
    enqDates.push(new Date(+m[3], MONTHS[m[2]], +m[1]))
  }
  const enquiries = countEnquiries(enqDates)

  const accounts = []
  const seen = new Set()

  // Pattern: optional "Back to Top Credit Factors" + BANKNAME + "Product Type - X Status: Y"
  const rx = /(?:Back\s+to\s+Top\s+Credit\s+Factors\s+)?([A-Z][A-Z0-9 &]{1,40}?)\s+Product\s+Type\s*[-–]\s*(.+?)\s+Status:\s*(Active|Closed|Payment Delayed)/gi
  let m
  while ((m = rx.exec(text)) !== null) {
    let bankName = m[1].trim()
      .replace(/^(BACK\s+TO\s+TOP\s+CREDIT\s+FACTORS|BACK\s+TO\s+TOP|CREDIT\s+FACTORS)\s*/gi, '')
      .replace(/^(ACTIVE LOAN ACCOUNTS|ACTIVE CREDIT CARD ACCOUNTS|CLOSED LOAN ACCOUNTS|CLOSED CREDIT CARD ACCOUNTS|ACTIVE ACCOUNTS|CLOSED ACCOUNTS|OPEN ACCOUNTS|ALL ACCOUNTS)\s*/gi, '')
      .trim()
    if (isNoise(bankName)) continue

    const loanType  = m[2].trim()
    const rawStatus = m[3].trim()
    const status    = rawStatus === 'Payment Delayed' ? 'Active' : rawStatus
    const block     = text.slice(m.index, Math.min(m.index + 3500, text.length))
    const g = (rx) => { const x = block.match(rx); return x ? x[1].replace(/,/g,'').trim() : '' }

    const loanAmount  = g(/Sanction(?:ed)?\s*Amount\s*[₹\u20b9]?\s*([\d,]+)/i) || g(/Credit\s*Limit\s*[₹\u20b9]?\s*([\d,]+)/i)
    const outstanding = g(/Current\s*Outstanding\s*[₹\u20b9]?\s*([\d,]+)/i) || g(/Current\s*Balance\s*[₹\u20b9]?\s*([\d,]+)/i)
    const overdue     = g(/Overdue\s*Amount\s*[₹\u20b9]?\s*([\d,]+)/i)
    const emi         = g(/EMI\s*Amount\s*[₹\u20b9]?\s*([\d,]+)/i)
    const openDate    = g(/Date\s*Opened\s+(\d{2}\s+\w+\s+\d{4})/i)
    const closedDate  = g(/Date\s*Closed\s+(\d{2}\s+\w+\s+\d{4})/i)
    const accountNum  = g(/Account\s*Number\s+(X+[\w]+)/i)
    const dpdM        = block.match(/Payment\s*Delayed\s*by:\s*(\d+)\s*days/i)
    const dpds        = dpdM ? dpdM[1] : '0'

    const key = `${bankName}|${loanType}|${accountNum}`
    if (seen.has(key)) continue
    seen.add(key)

    accounts.push({
      bankName, loanType, loanAmount,
      outstanding: (status==='Closed'||(closedDate&&closedDate!=='NA')) ? '0' : outstanding,
      emi, openDate, dpds,
      overdue:    (!overdue||overdue==='0') ? '' : overdue,
      settlement: '',
      status
    })
  }
  return { accounts, score, customerName, enquiries }
}

const inr = (v) => {
  if (!v || v==='0') return '—'
  const n = parseInt(String(v).replace(/[^0-9]/g,''))
  if (isNaN(n)||n===0) return '—'
  return '₹'+n.toLocaleString('en-IN')
}

export default function CibilParser({ userRole, userId }) {
  const [accounts,setAccounts]           = useState([])
  const [parsing,setParsing]             = useState(false)
  const [error,setError]                 = useState('')
  const [fileName,setFileName]           = useState('')
  const [pendingFile,setPendingFile]     = useState(null)
  const [format,setFormat]               = useState('')
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
  const pwdRef = useRef(null)

  useEffect(()=>{ loadPdfJs() },[])
  useEffect(()=>{ if(needsPwd&&pwdRef.current) pwdRef.current.focus() },[needsPwd])
  useEffect(()=>{
    if(!leadSearch||leadSearch.length<2){setLeads([]);return}
    const t=setTimeout(async()=>{ const{data}=await supabase.from('leads').select('id,full_name,mobile').ilike('full_name',`%${leadSearch}%`).limit(8); setLeads(data||[]) },300)
    return()=>clearTimeout(t)
  },[leadSearch])

  const parseFile = useCallback(async(file,password='')=>{
    setError('');setParsing(true);setPwdErr('')
    setAccounts([]);setFormat('');setScore(null);setCustomerName('');setEnquiries(null);setDebugText('')
    try{
      const text = await extractTextFromPDF(file,password)
      setDebugText(text)
      if(!text||text.trim().length<50) throw new Error('PDF appears empty or image-only.')
      const fmt = detectFormat(text)
      setFormat(fmt)
      let result={accounts:[],score:null,customerName:'',enquiries:null}
      if(fmt==='cibil')            result=parseCibil(text)
      else if(fmt==='paisabazaar') result=parsePaisaBazaar(text)
      else{ setError(`Format not recognised. Preview: "${text.slice(0,200)}"`); setShowDebug(true); setParsing(false); return }
      if(result.accounts.length===0){ setError(`Detected "${fmt}" but 0 accounts found. Check Debug Panel.`); setShowDebug(true) }
      setAccounts(result.accounts); setScore(result.score); setCustomerName(result.customerName); setEnquiries(result.enquiries||null)
      setNeedsPwd(false); setPwd('')
    }catch(e){
      if(e.message==='NEEDS_PASSWORD'){ setNeedsPwd(true); setPendingFile(file); setParsing(false); return }
      if(e.message==='WRONG_PASSWORD'){ setPwdErr('Incorrect password. Try again.'); setParsing(false); return }
      setError('Parse failed: '+e.message)
    }finally{ setParsing(false) }
  },[])

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
    const h=['Bank Name','Loan Type','Loan Amount','Outstanding','EMI','Open Date','DPDs','Overdue','Settlement','Status']
    const r=accounts.map(a=>[a.bankName,a.loanType,a.loanAmount,a.outstanding,a.emi,a.openDate,a.dpds,a.overdue,a.settlement,a.status])
    const csv=[h,...r].map(row=>row.map(v=>`"${v||''}"`).join(',')).join('\n')
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}))
    a.download=`CIBIL_${customerName||'Report'}.csv`; a.click()
  }

  const reset=()=>{
    setAccounts([]);setFileName('');setFormat('');setScore(null);setCustomerName('')
    setSelectedLead(null);setLeadSearch('');setEnquiries(null)
    setDebugText('');setShowDebug(false);setNeedsPwd(false);setPwd('');setPwdErr('')
  }

  const active=accounts.filter(a=>a.status==='Active')
  const shown=showAll?accounts:active
  const totOut=active.reduce((s,a)=>s+(+a.outstanding||0),0)
  const totEMI=active.reduce((s,a)=>s+(+a.emi||0),0)
  const highDpd=accounts.some(a=>+a.dpds>90)
  const hasSett=accounts.some(a=>a.settlement&&a.settlement!=='0')

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
  const scC=s=>s>=750?'#276749':s>=650?'#B45309':'#DC2626'
  const scB=s=>s>=750?'#F0FFF4':s>=650?'#FFFBEB':'#FEF2F2'
  const scL=s=>s>=750?'Excellent':s>=700?'Good':s>=650?'Fair':'Poor'

  return (
    <div style={S.pg}>
      <div style={{marginBottom:20,display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10}}>
        <div>
          <h2 style={{margin:0,fontSize:18,fontWeight:700,color:'#1A202C'}}>📊 CIBIL Parser</h2>
          <p style={{margin:'2px 0 0',fontSize:13,color:'#718096'}}>Upload CIBIL report to auto-extract loan data</p>
        </div>
        {format&&<span style={S.bdg(format==='cibil'?'#EFF6FF':'#F0FFF4',format==='cibil'?'#1D4ED8':'#15803D')}>📄 {format==='cibil'?'CIBIL.com':'PaisaBazaar'} Format Detected</span>}
      </div>

      {highDpd&&<div style={{background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:8,padding:'10px 16px',marginBottom:12,color:'#DC2626',fontSize:13,fontWeight:500}}>⚠️ One or more accounts have DPD over 90 days</div>}
      {hasSett&&<div style={{background:'#FFFBEB',border:'1px solid #FDE68A',borderRadius:8,padding:'10px 16px',marginBottom:12,color:'#B45309',fontSize:13,fontWeight:500}}>⚠️ Settlement found on one or more accounts</div>}
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
            <p style={{color:'#A0AEC0',margin:0,fontSize:12}}>CIBIL.com · PaisaBazaar · Password-protected PDFs ✓</p>
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
            {[{label:'Active Loans',value:active.length,color:'#185FA5',bg:'#E6F1FB'},{label:'Total Accounts',value:accounts.length,color:'#534AB7',bg:'#EEEDFE'},{label:'Total Outstanding',value:inr(totOut),color:'#854F0B',bg:'#FAEEDA'},{label:'Total EMI/Month',value:inr(totEMI),color:'#0F6E56',bg:'#E1F5EE'}].map(s=>(
              <div key={s.label} style={{background:s.bg,borderRadius:10,padding:'12px 18px',flex:'1 1 140px'}}>
                <div style={{fontSize:11,color:s.color,fontWeight:600,textTransform:'uppercase'}}>{s.label}</div>
                <div style={{fontSize:20,fontWeight:700,color:s.color,marginTop:2}}>{s.value}</div>
              </div>
            ))}
          </div>

          {enquiries&&(
            <div style={{...S.crd,padding:'16px 20px',marginBottom:16}}>
              <div style={{fontSize:13,fontWeight:700,color:'#1A202C',marginBottom:12}}>🔍 Credit Enquiries</div>
              <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
                {[{l:'Last 30 Days',v:enquiries.last30,w:3},{l:'Last 60 Days',v:enquiries.last60,w:5},{l:'Last 90 Days',v:enquiries.last90,w:8}].map(e=>{
                  const bad=e.v>e.w
                  return(
                    <div key={e.l} style={{background:bad?'#FEF2F2':'#F7FAFC',border:`1px solid ${bad?'#FECACA':'#E2E8F0'}`,borderRadius:10,padding:'12px 24px',display:'flex',flexDirection:'column',alignItems:'center',minWidth:120,flex:'1 1 100px'}}>
                      <div style={{fontSize:28,fontWeight:800,color:bad?'#DC2626':'#2D3748'}}>{e.v}</div>
                      <div style={{fontSize:11,fontWeight:600,color:bad?'#DC2626':'#718096',marginTop:2}}>{e.l}</div>
                      {bad&&<div style={{fontSize:10,color:'#DC2626',marginTop:4,fontWeight:600}}>⚠️ HIGH</div>}
                    </div>
                  )
                })}
              </div>
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
                <button style={S.btn('#F1F5F9','#718096')} onClick={reset}>↩ New Upload</button>
              </div>
            </div>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead><tr>{['Bank Name','Loan Type','Loan Amount','Outstanding','EMI','Open Date','DPDs','Overdue','Settlement','Status',''].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {shown.map((acc,i)=>{
                    const ri=accounts.indexOf(acc); const isE=editIdx===ri; const dpd=+acc.dpds||0
                    return(
                      <tr key={i} style={{background:i%2===0?'#fff':'#FAFAFA'}}>
                        {isE?(<>
                          {['bankName','loanType','loanAmount','outstanding','emi','openDate','dpds','overdue','settlement'].map(f=>(
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
                          <td style={{...S.td,color:'#534AB7',fontWeight:500}}>{inr(acc.emi)}</td>
                          <td style={{...S.td,color:'#718096'}}>{acc.openDate||'—'}</td>
                          <td style={S.td}>{dpd>0?<span style={S.bdg(dpd>90?'#FEF2F2':'#FFFBEB',dpd>90?'#DC2626':'#B45309')}>{acc.dpds} days</span>:<span style={{color:'#A0AEC0',fontSize:12}}>—</span>}</td>
                          <td style={{...S.td,color:acc.overdue?'#DC2626':'#718096'}}>{inr(acc.overdue)}</td>
                          <td style={{...S.td,color:acc.settlement?'#DC2626':'#718096'}}>{inr(acc.settlement)}</td>
                          <td style={S.td}><span style={S.bdg(acc.status==='Active'?'#E1F5EE':'#F1F5F9',acc.status==='Active'?'#0F6E56':'#718096')}>{acc.status}</span></td>
                          <td style={{...S.td,whiteSpace:'nowrap'}}>
                            <button style={{background:'none',border:'1px solid #E2E8F0',borderRadius:6,padding:'4px 8px',cursor:'pointer',fontSize:12,marginRight:4}} onClick={()=>{setEditIdx(ri);setEditData({...acc})}}>✏️</button>
                            <button style={{background:'none',border:'1px solid #FECACA',borderRadius:6,padding:'4px 8px',cursor:'pointer',fontSize:12}} onClick={()=>setAccounts(accounts.filter((_,j)=>j!==ri))}>🗑</button>
                          </td>
                        </>)}
                      </tr>
                    )
                  })}
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
