/* eslint-disable */
import { useState, useCallback, useEffect } from 'react'
import { supabase } from '../supabase'

async function extractTextFromPDF(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const pdfjsLib = window['pdfjs-dist/build/pdf']
        if (!pdfjsLib) throw new Error('PDF.js not loaded')
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(e.target.result) }).promise
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

function detectFormat(text) {
  if (text.includes('myscore.cibil.com') || text.includes('Control Number :')) return 'cibil'
  if (text.toLowerCase().includes('paisabazaar') || text.includes('Enquiry Control Number')) return 'paisabazaar'
  return 'unknown'
}

function parseCibil(text) {
  const accounts = []
  const scoreMatch = text.match(/Your CIBIL Score is (\d{3})/)
  const score = scoreMatch ? parseInt(scoreMatch[1]) : null
  const nameMatch = text.match(/(MR|MS|MRS|DR)\.?\s+([A-Z ]{5,40})\n/)
  const customerName = nameMatch ? nameMatch[0].trim() : ''
  const sections = text.split(/Member Name\s+/i).slice(1)
  for (const sec of sections) {
    const lines = sec.trim().split(/\n/).map(s => s.trim()).filter(Boolean)
    if (!lines[0] || lines[0].length > 60) continue
    const bankName = lines[0].replace(/\s+/g, ' ').trim()
    const typeMatch = sec.match(/Account Type\s+([\w\s]+?)(?=Account Number)/i)
    const loanType = typeMatch ? typeMatch[1].trim() : ''
    if (!loanType || loanType.toLowerCase().includes('employment')) continue
    const get = (rx) => { const m = sec.match(rx); return m ? m[1].replace(/,/g, '') : '' }
    const loanAmount  = get(/Sanctioned Amount\s+₹([\d,]+)/i)
    const outstanding = get(/Current Balance\s+₹([\d,]+)/i)
    const emi         = get(/EMI Amount\s+₹([\d,]+)/i)
    const openDate    = get(/Date Opened \/ Disbursed\s+([\d\/]+)/i)
    const overdue     = get(/Amount Overdue\s+₹([\d,]+)/i)
    const settlement  = get(/Settlement Amount\s+₹([\d,]+)/i)
    const closedDate  = get(/Date Closed\s+([\d\/]+)/i)
    const isClosed    = !!closedDate && closedDate !== '-'
    const dpdNums = [...sec.matchAll(/\b(\d{2,3})\b/g)].map(m => parseInt(m[1])).filter(n => n > 0 && n < 999)
    const maxDpd = dpdNums.length > 0 ? Math.max(...dpdNums) : 0
    accounts.push({ bankName, loanType, loanAmount, outstanding: isClosed ? '0' : outstanding, emi, openDate, dpds: String(maxDpd), overdue: overdue === '0' ? '' : overdue, settlement, status: isClosed ? 'Closed' : 'Active' })
  }
  return { accounts, score, customerName }
}

function parsePaisaBazaar(text) {
  const scoreMatch = text.match(/(\d{3})\s*(?:Very Good|Good|Fair|Poor|Excellent)/i)
  const score = scoreMatch ? parseInt(scoreMatch[1]) : null
  const nameMatch = text.match(/Hey\s+([A-Za-z ]{3,40}),/)
  const customerName = nameMatch ? nameMatch[1].trim() : ''
  const accounts = []
  const blockRx = /(?:RBL BANK|IDFC FIRST BANK|HDFC BANK|CANARA BANK|KARUR VYSYA|AXIO|AMEX|INDUSIND BANK|BOBCARD|SBI CARD|ICICI BANK|ADBIRLACAP|PIRAMALFIN|HLF|GHALLA|CAPFLOAT|YES BANK|AXIS BANK|KOTAK|BAJAJ)/g
  const positions = []
  let m
  while ((m = blockRx.exec(text)) !== null) positions.push(m.index)
  for (let i = 0; i < positions.length; i++) {
    const block = text.slice(positions[i], positions[i + 1] || text.length)
    const bankMatch = block.match(/^([A-Z][A-Z0-9 &]+?)(?:\s+Product Type|\n)/)
    if (!bankMatch) continue
    const bankName = bankMatch[1].trim()
    const get = (rx) => { const m = block.match(rx); return m ? m[1].replace(/,/g, '') : '' }
    const loanType    = get(/Product Type\s*[-–]\s*(.+?)\s+Status:/i)
    if (!loanType) continue
    const status      = get(/Status:\s*(Active|Closed)/i) || 'Active'
    const loanAmount  = get(/Sanction(?:ed)? Amount\s+₹\s*([\d,]+)/i)
    const outstanding = get(/Current Outstanding\s+₹\s*([\d,]+)/i)
    const emi         = get(/EMI Amount\s+₹\s*([\d,]+)/i)
    const openDate    = get(/Date Opened\s+([\d]+ \w+ \d{4})/i)
    const overdue     = get(/Overdue Amount\s+₹\s*([\d,]+)/i)
    const dpdNums = [...block.matchAll(/(\d{2,3})\s*days late/gi)].map(m => parseInt(m[1]))
    const maxDpd = dpdNums.length > 0 ? Math.max(...dpdNums) : 0
    accounts.push({ bankName, loanType, loanAmount, outstanding: status === 'Closed' ? '0' : outstanding, emi, openDate, dpds: String(maxDpd), overdue: overdue === '0' ? '' : overdue, settlement: '', status })
  }
  return { accounts, score, customerName }
}

const inr = (val) => {
  if (!val || val === '0') return '—'
  const n = parseInt(String(val).replace(/,/g, ''))
  if (isNaN(n) || n === 0) return '—'
  return '₹' + n.toLocaleString('en-IN')
}

export default function CibilParser({ userRole, userId }) {
  const [accounts, setAccounts]         = useState([])
  const [parsing, setParsing]           = useState(false)
  const [error, setError]               = useState('')
  const [fileName, setFileName]         = useState('')
  const [format, setFormat]             = useState('')
  const [score, setScore]               = useState(null)
  const [customerName, setCustomerName] = useState('')
  const [showAll, setShowAll]           = useState(false)
  const [editIdx, setEditIdx]           = useState(null)
  const [editData, setEditData]         = useState({})
  const [saving, setSaving]             = useState(false)
  const [savedMsg, setSavedMsg]         = useState('')
  const [leadSearch, setLeadSearch]     = useState('')
  const [leads, setLeads]               = useState([])
  const [selectedLead, setSelectedLead] = useState(null)
  const [showLeadDrop, setShowLeadDrop] = useState(false)

  useEffect(() => {
    if (!window['pdfjs-dist/build/pdf']) {
      const s = document.createElement('script')
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
      document.head.appendChild(s)
    }
  }, [])

  useEffect(() => {
    if (!leadSearch || leadSearch.length < 2) { setLeads([]); return }
    const timer = setTimeout(async () => {
      const { data } = await supabase.from('leads').select('id,full_name,mobile').ilike('full_name', `%${leadSearch}%`).limit(8)
      setLeads(data || [])
    }, 300)
    return () => clearTimeout(timer)
  }, [leadSearch])

  const handleFile = useCallback(async (file) => {
    if (!file || file.type !== 'application/pdf') { setError('Please upload a valid PDF file.'); return }
    setError(''); setParsing(true); setFileName(file.name)
    setAccounts([]); setFormat(''); setScore(null); setCustomerName('')
    try {
      let attempts = 0
      while (!window['pdfjs-dist/build/pdf'] && attempts < 20) {
        await new Promise(r => setTimeout(r, 300)); attempts++
      }
      const text = await extractTextFromPDF(file)
      const fmt = detectFormat(text)
      setFormat(fmt)
      let result = { accounts: [], score: null, customerName: '' }
      if (fmt === 'cibil') result = parseCibil(text)
      else if (fmt === 'paisabazaar') result = parsePaisaBazaar(text)
      else setError('Could not detect format. Please upload from CIBIL.com or PaisaBazaar.')
      setAccounts(result.accounts)
      setScore(result.score)
      setCustomerName(result.customerName)
    } catch (e) {
      setError('Failed to parse PDF. ' + e.message)
    } finally { setParsing(false) }
  }, [])

  const handleDrop = (e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]) }

  const saveToSupabase = async () => {
    if (!selectedLead) { setError('Please select a customer to save against.'); return }
    setSaving(true); setSavedMsg('')
    try {
      const { error: err } = await supabase.from('customer_cibil_data').upsert({
        lead_id: selectedLead.id, customer_name: customerName || selectedLead.full_name,
        cibil_score: score, report_source: format,
        report_date: new Date().toISOString().split('T')[0],
        accounts: accounts, uploaded_by: userId, uploaded_at: new Date().toISOString()
      }, { onConflict: 'lead_id' })
      if (err) throw err
      setSavedMsg('✅ Saved to customer profile!')
      setTimeout(() => setSavedMsg(''), 3000)
    } catch (e) { setError('Save failed: ' + e.message) }
    finally { setSaving(false) }
  }

  const exportCSV = () => {
    const headers = ['Bank Name','Loan Type','Loan Amount','Outstanding','EMI','Open Date','DPDs','Overdue','Settlement','Status']
    const rows = accounts.map(a => [a.bankName,a.loanType,a.loanAmount,a.outstanding,a.emi,a.openDate,a.dpds,a.overdue,a.settlement,a.status])
    const csv = [headers,...rows].map(r => r.map(v => `"${v||''}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `CIBIL_${customerName || 'Report'}.csv`
    a.click()
  }

  const activeAccounts = accounts.filter(a => a.status === 'Active')
  const displayed = showAll ? accounts : activeAccounts
  const totalOutstanding = activeAccounts.reduce((s, a) => s + (parseInt(a.outstanding) || 0), 0)
  const totalEMI = activeAccounts.reduce((s, a) => s + (parseInt(a.emi) || 0), 0)
  const hasHighDpd = accounts.some(a => parseInt(a.dpds) > 90)
  const hasSettlement = accounts.some(a => a.settlement)

  const S = {
    page: { padding: '24px', background: 'var(--bg, #F8FAFC)', minHeight: '100vh' },
    card: { background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', marginBottom: 16, overflow: 'hidden' },
    header: { padding: '16px 20px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
    title: { fontSize: 14, fontWeight: 700, color: '#1A202C', margin: 0 },
    badge: (bg, color) => ({ background: bg, color, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600 }),
    btn: (bg, color='#fff') => ({ background: bg, color, border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }),
    input: { border: '1px solid #E2E8F0', borderRadius: 8, padding: '8px 12px', fontSize: 13, width: '100%', outline: 'none' },
    th: { padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#718096', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.5px', background: '#F9FAFB', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' },
    td: { padding: '11px 14px', fontSize: 13, color: '#2D3748', borderBottom: '1px solid #F7FAFC' },
  }

  return (
    <div style={S.page}>
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#1A202C' }}>📊 CIBIL Parser</h2>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: '#718096' }}>Upload CIBIL report to auto-extract loan data</p>
        </div>
        {format && <span style={S.badge(format === 'cibil' ? '#EFF6FF' : '#F0FFF4', format === 'cibil' ? '#1D4ED8' : '#15803D')}>{format === 'cibil' ? '📄 CIBIL.com' : '📄 PaisaBazaar'} Format Detected</span>}
      </div>
      {hasHighDpd && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 16px', marginBottom: 12, color: '#DC2626', fontSize: 13, fontWeight: 500 }}>⚠️ Alert: One or more accounts have DPD over 90 days</div>}
      {hasSettlement && <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '10px 16px', marginBottom: 12, color: '#B45309', fontSize: 13, fontWeight: 500 }}>⚠️ Alert: Settlement found on one or more accounts</div>}
      {score !== null && score < 650 && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 16px', marginBottom: 12, color: '#DC2626', fontSize: 13, fontWeight: 500 }}>⚠️ Low CIBIL Score: {score}</div>}
      {error && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 16px', marginBottom: 12, color: '#DC2626', fontSize: 13 }}>{error}</div>}
      {savedMsg && <div style={{ background: '#F0FFF4', border: '1px solid #9AE6B4', borderRadius: 8, padding: '10px 16px', marginBottom: 12, color: '#276749', fontSize: 13, fontWeight: 600 }}>{savedMsg}</div>}
      {accounts.length === 0 && !parsing && (
        <div style={S.card}>
          <div onDrop={handleDrop} onDragOver={e => e.preventDefault()} onClick={() => document.getElementById('cibil-file-input').click()}
            style={{ padding: '48px 32px', textAlign: 'center', cursor: 'pointer', border: '2px dashed #CBD5E0', borderRadius: 12, margin: 16 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>☁️</div>
            <h3 style={{ margin: '0 0 6px', color: '#2D3748', fontSize: 15 }}>Upload CIBIL Report PDF</h3>
            <p style={{ color: '#718096', margin: '0 0 16px', fontSize: 13 }}>Drag and drop or click to browse. Supports CIBIL.com and PaisaBazaar formats.</p>
            <input id="cibil-file-input" type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
          </div>
        </div>
      )}
      {parsing && <div style={{ ...S.card, padding: 32, textAlign: 'center' }}><div style={{ fontSize: 32, marginBottom: 10 }}>⏳</div><p style={{ color: '#718096', margin: 0 }}>Parsing CIBIL report, please wait...</p></div>}
      {accounts.length > 0 && (
        <>
          {(score || customerName) && (
            <div style={{ ...S.card, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
              {customerName && <div style={{ fontSize: 14, fontWeight: 600, color: '#2D3748' }}>👤 {customerName}</div>}
              {score && <div style={{ background: score >= 750 ? '#F0FFF4' : score >= 650 ? '#FFFBEB' : '#FEF2F2', color: score >= 750 ? '#276749' : score >= 650 ? '#B45309' : '#DC2626', padding: '6px 16px', borderRadius: 20, fontWeight: 700, fontSize: 14 }}>CIBIL Score: {score}</div>}
              <div style={{ fontSize: 12, color: '#718096', marginLeft: 'auto' }}>📄 {fileName}</div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            {[{label:'Active Loans',value:activeAccounts.length,color:'#185FA5',bg:'#E6F1FB'},{label:'Total Accounts',value:accounts.length,color:'#534AB7',bg:'#EEEDFE'},{label:'Total Outstanding',value:inr(totalOutstanding),color:'#854F0B',bg:'#FAEEDA'},{label:'Total EMI/Month',value:inr(totalEMI),color:'#0F6E56',bg:'#E1F5EE'}].map(s => (
              <div key={s.label} style={{ background: s.bg, borderRadius: 10, padding: '12px 18px', flex: '1 1 140px' }}>
                <div style={{ fontSize: 11, color: s.color, fontWeight: 600, textTransform: 'uppercase' }}>{s.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: s.color, marginTop: 2 }}>{s.value}</div>
              </div>
            ))}
          </div>
          <div style={S.card}>
            <div style={S.header}><h3 style={S.title}>🔗 Link to Customer Profile</h3></div>
            <div style={{ padding: '14px 20px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', flex: '1 1 260px' }}>
                <input style={S.input} placeholder="Search customer name..." value={leadSearch} onChange={e => { setLeadSearch(e.target.value); setShowLeadDrop(true) }} onFocus={() => setShowLeadDrop(true)} />
                {showLeadDrop && leads.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, zIndex: 100, boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}>
                    {leads.map(lead => (
                      <div key={lead.id} onClick={() => { setSelectedLead(lead); setLeadSearch(lead.full_name); setShowLeadDrop(false) }}
                        style={{ padding: '10px 14px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #F7FAFC' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#F7FAFC'}
                        onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                        <strong>{lead.full_name}</strong><span style={{ color: '#718096', marginLeft: 8 }}>{lead.mobile}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {selectedLead && <span style={S.badge('#F0FFF4','#276749')}>✓ {selectedLead.full_name}</span>}
              <button style={S.btn('#185FA5')} onClick={saveToSupabase} disabled={saving}>{saving ? '⏳ Saving...' : '💾 Save to Profile'}</button>
            </div>
          </div>
          <div style={S.card}>
            <div style={S.header}>
              <h3 style={S.title}>Loan Summary ({displayed.length} accounts)</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={S.btn(showAll ? '#EFF6FF' : '#F9FAFB', showAll ? '#1D4ED8' : '#718096')} onClick={() => setShowAll(!showAll)}>{showAll ? 'Active Only' : 'Show All'}</button>
                <button style={S.btn('#0F6E56')} onClick={exportCSV}>⬇ Export CSV</button>
                <button style={S.btn('#F1F5F9','#718096')} onClick={() => { setAccounts([]); setFileName(''); setFormat(''); setScore(null); setCustomerName(''); setSelectedLead(null); setLeadSearch('') }}>↩ New Upload</button>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Bank Name','Loan Type','Loan Amount','Outstanding','EMI','Open Date','DPDs','Overdue','Settlement','Status',''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {displayed.map((acc, i) => {
                    const realIdx = accounts.indexOf(acc)
                    const isEditing = editIdx === realIdx
                    const dpd = parseInt(acc.dpds) || 0
                    return (
                      <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                        {isEditing ? (
                          <>
                            {['bankName','loanType','loanAmount','outstanding','emi','openDate','dpds','overdue','settlement'].map(f => (
                              <td key={f} style={S.td}><input value={editData[f]||''} onChange={e => setEditData({...editData,[f]:e.target.value})} style={{...S.input,padding:'5px 8px',minWidth:70}}/></td>
                            ))}
                            <td style={S.td}><span style={S.badge('#E1F5EE','#0F6E56')}>{editData.status}</span></td>
                            <td style={{...S.td,whiteSpace:'nowrap'}}>
                              <button style={S.btn('#185FA5')} onClick={() => { const u=[...accounts]; u[realIdx]=editData; setAccounts(u); setEditIdx(null) }}>Save</button>
                              <button style={{...S.btn('#F1F5F9','#718096'),marginLeft:6}} onClick={() => setEditIdx(null)}>Cancel</button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td style={{...S.td,fontWeight:600}}>{acc.bankName}</td>
                            <td style={S.td}>{acc.loanType}</td>
                            <td style={S.td}>{inr(acc.loanAmount)}</td>
                            <td style={{...S.td,color:acc.outstanding&&acc.outstanding!=='0'?'#854F0B':'#718096',fontWeight:500}}>{inr(acc.outstanding)}</td>
                            <td style={{...S.td,color:'#534AB7',fontWeight:500}}>{inr(acc.emi)}</td>
                            <td style={{...S.td,color:'#718096'}}>{acc.openDate||'—'}</td>
                            <td style={S.td}><span style={S.badge(dpd>90?'#FEF2F2':dpd>0?'#FFFBEB':'#F0FFF4',dpd>90?'#DC2626':dpd>0?'#B45309':'#276749')}>{acc.dpds||'0'}</span></td>
                            <td style={{...S.td,color:acc.overdue?'#DC2626':'#718096'}}>{inr(acc.overdue)}</td>
                            <td style={{...S.td,color:acc.settlement?'#DC2626':'#718096'}}>{inr(acc.settlement)}</td>
                            <td style={S.td}><span style={S.badge(acc.status==='Active'?'#E1F5EE':'#F1F5F9',acc.status==='Active'?'#0F6E56':'#718096')}>{acc.status}</span></td>
                            <td style={{...S.td,whiteSpace:'nowrap'}}>
                              <button style={{background:'none',border:'1px solid #E2E8F0',borderRadius:6,padding:'4px 8px',cursor:'pointer',fontSize:12,marginRight:4}} onClick={() => { setEditIdx(realIdx); setEditData({...acc}) }}>✏️</button>
                              <button style={{background:'none',border:'1px solid #FECACA',borderRadius:6,padding:'4px 8px',cursor:'pointer',fontSize:12}} onClick={() => setAccounts(accounts.filter((_,j) => j!==realIdx))}>🗑</button>
                            </td>
                          </>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {!showAll && accounts.length > activeAccounts.length && (
              <div style={{ padding: '12px 20px', fontSize: 12, color: '#718096', textAlign: 'center' }}>
                {accounts.length - activeAccounts.length} closed accounts hidden · <span style={{ color: '#185FA5', cursor: 'pointer' }} onClick={() => setShowAll(true)}>Show all</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
