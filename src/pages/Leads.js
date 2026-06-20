/* eslint-disable */
import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null } }
  static getDerivedStateFromError(e) { return { hasError: true, error: e.message } }
  componentDidCatch(e, info) { console.error('Error:', e, info) }
  render() {
    if (this.state.hasError) return (
      <div style={{padding:40,textAlign:'center',background:'white',borderRadius:12,border:'1px solid #fecaca',margin:20}}>
        <div style={{fontSize:28,marginBottom:10}}>⚠️</div>
        <div style={{fontSize:16,fontWeight:700,color:'#dc2626',marginBottom:6}}>Something went wrong</div>
        <div style={{fontSize:13,color:'#6b7280',marginBottom:16}}>{this.state.error}</div>
        <button onClick={()=>this.setState({hasError:false,error:null})} style={{padding:'7px 18px',background:'#185FA5',color:'white',border:'none',borderRadius:8,cursor:'pointer',marginRight:8}}>Try Again</button>
        <button onClick={()=>window.location.reload()} style={{padding:'7px 18px',background:'white',color:'#185FA5',border:'1px solid #185FA5',borderRadius:8,cursor:'pointer'}}>Reload</button>
      </div>
    )
    return this.props.children
  }
}
import { exportToExcel, parseSpreadsheet, autoMapHeaders } from '../utils/spreadsheet'
import {
  IconUsers, IconUserPlus, IconThumbUp, IconCircleCheck,
  IconPhone, IconBrandWhatsapp, IconUpload, IconEdit,
  IconX, IconCheck, IconSearch
} from '@tabler/icons-react'
import CallHistory from '../components/CallHistory'

// ─── MOBILE HOOK ───
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return isMobile
}

const LEAD_STAGES = ['New','Interested','Callback','Login','Approved','Disbursed','Not Interested','DND']

const fmtAmt = n => n ? '₹' + Number(n).toLocaleString('en-IN') : '-'
export default function Leads({ userRole, userId }) {
  const [leads, setLeads] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [showCSVModal, setShowCSVModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterSource, setFilterSource] = useState('')
  const [filterAgent, setFilterAgent] = useState('')
  const [selectedLead, setSelectedLead] = useState(null)
  const [note, setNote] = useState('')
  const [statuses, setStatuses] = useState([])
  const [agents, setAgents] = useState([])
  const [activeTab, setActiveTab] = useState('details')
  const [pendingStatus, setPendingStatus] = useState('')
  const [csvAgent, setCsvAgent] = useState('')
  const [csvPreview, setCsvPreview] = useState([])
  const [csvFile, setCsvFile] = useState(null)
  const [csvUploading, setCsvUploading] = useState(false)
  const [editingLead, setEditingLead] = useState(null)
  const [form, setForm] = useState({
    full_name:'', mobile:'', email:'', city:'',
    lead_source:'', product_interest:'Personal Loan',
    loan_amount:'', budget_range:'', notes:'',
    assigned_to:'', follow_up_date:''
  })
  const fileRef = useRef()
  const csvRef = useRef()

  const isAdmin = userRole === 'admin'
  const isManager = userRole === 'manager'
  const isAdminOrManager = isAdmin || isManager

  useEffect(() => {
    fetchLeads()
    fetchStatuses()
    fetchAgents()
  }, [])

  useEffect(() => {
    const channel = supabase
      .channel('leads-page-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, (payload) => {
        const row = payload.new || payload.old
        if (!row || !row.id) { fetchLeads(); return }
        if (payload.eventType === 'UPDATE') {
          setLeads(prev => prev.some(l => l.id === row.id)
            ? prev.map(l => l.id === row.id ? { ...l, ...payload.new } : l)
            : prev)
          setLeads(prev => { if (!prev.some(l => l.id === row.id)) fetchLeads(); return prev })
        } else if (payload.eventType === 'INSERT') {
          fetchLeads()
        } else if (payload.eventType === 'DELETE') {
          setLeads(prev => prev.filter(l => l.id !== row.id))
        }
      })
      .subscribe((status) => console.log('[leads-page-rt] subscription:', status))

    const poll = setInterval(fetchLeads, 8000)
    const onFocus = () => { if (document.visibilityState === 'visible') fetchLeads() }
    document.addEventListener('visibilitychange', onFocus)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [])

  useEffect(() => { if(selectedLead) setPendingStatus(selectedLead.status||'New') }, [selectedLead])

  const fetchLeads = async () => {
    let query = supabase.from('leads').select('*').order('created_at',{ascending:false})
    if (userRole === 'agent') {
      query = query.eq('assigned_to', userId)
    }
    const { data } = await query
    if (data) setLeads(data)
  }

  const fetchStatuses = async () => {
    const { data } = await supabase.from('lead_stages').select('*').eq('is_active',true).order('order_index')
    // Map name→label so all existing s.label references keep working
    if (data) setStatuses(data.map(s=>({...s, label:s.name})))
  }

  const fetchAgents = async () => {
    const { data } = await supabase.from('profiles').select('id,full_name,role,email').in('role',['agent','team_leader'])
    if (data) setAgents(data)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    await supabase.from('leads').insert([{...form, status:'New'}])
    setForm({full_name:'',mobile:'',email:'',city:'',lead_source:'',product_interest:'Personal Loan',loan_amount:'',budget_range:'',notes:'',assigned_to:'',follow_up_date:''})
    setShowForm(false)
    fetchLeads()
    setLoading(false)
  }

  const isMobile = useIsMobile()

  const SOURCES = ['Referral','Website','Walk-in','IVR','Social Media','Agent','Other']

  const filtered = leads.filter(l => {
    const ms = !search || l.full_name?.toLowerCase().includes(search.toLowerCase()) || l.mobile?.includes(search)
    const mf = !filterStatus || l.status === filterStatus
    const msrc = !filterSource || l.lead_source === filterSource
    const mag = !filterAgent || l.assigned_to === filterAgent
    return ms && mf && msrc && mag
  })
  // Deduplicate by id to prevent duplicate rows from appearing in the table
  const uniqueFiltered = Array.from(new Map(filtered.map(l => [l.id, l])).values())

  const stats = [
    {label:'Total Leads', value:leads.length, bg:'#EFF6FF', color:'#1D4ED8',
      icon:<IconUsers size={22} strokeWidth={1.8} color='#1D4ED8'/>},
    {label:'New', value:leads.filter(l=>l.status==='New').length, bg:'#EFF6FF', color:'#0C447C',
      icon:<IconUserPlus size={22} strokeWidth={1.8} color='#2563EB'/>},
    {label:'Interested', value:leads.filter(l=>l.status==='Interested').length, bg:'#FFFBEB', color:'#B45309',
      icon:<IconThumbUp size={22} strokeWidth={1.8} color='#D97706'/>},
    {label:'Disbursed', value:leads.filter(l=>l.status==='Disbursed').length, bg:'#ECFDF5', color:'#065F46',
      icon:<IconCircleCheck size={22} strokeWidth={1.8} color='#059669'/>},
  ]

  const updateStatus = async (leadId, status) => {
    await supabase.from('leads').update({status}).eq('id',leadId)
    setLeads(prev=>prev.map(l=>l.id===leadId?{...l,status}:l))
    if(selectedLead?.id===leadId) setSelectedLead(prev=>({...prev,status}))
  }

  const reassignLead = async (leadId, agentId) => {
    await supabase.from('leads').update({assigned_to:agentId||null}).eq('id',leadId)
    setLeads(prev=>prev.map(l=>l.id===leadId?{...l,assigned_to:agentId||null}:l))
  }

  const addNote = async () => {
    if(!note.trim()||!selectedLead) return
    const timestamp = new Date().toLocaleString('en-IN')
    const newNote = `[${timestamp}] ${note.trim()}`
    const updatedNotes = selectedLead.notes ? selectedLead.notes + '\n' + newNote : newNote
    await supabase.from('leads').update({notes:updatedNotes}).eq('id',selectedLead.id)
    setLeads(prev=>prev.map(l=>l.id===selectedLead.id?{...l,notes:updatedNotes}:l))
    setSelectedLead(prev=>({...prev,notes:updatedNotes}))
    setNote('')
  }

  const downloadTemplate = () => {
    exportToExcel('leads_template', [['Name','Mobile','Loan Amount','Application ID','Email','City','Notes']], 'Template')
  }

  const handleCSVSelect = (e) => {
    const file = e.target.files[0]
    if(!file) return
    setCsvFile(file)
    parseSpreadsheet(file).then(({headers, rows}) => {
      const map = autoMapHeaders(headers)
      const preview = rows.slice(0,5).map(row => ({
        full_name:   map.full_name   ? (row[map.full_name]||'').trim()   : '',
        mobile:      map.mobile      ? (row[map.mobile]||'').trim()      : '',
        city:        map.city        ? (row[map.city]||'').trim()        : '',
        lead_source: ''
      })).filter(r => r.full_name)
      setCsvPreview(preview)
    }).catch(err => console.error('File parse error:', err))
  }

  const handleCSVUpload = async () => {
    if(!csvFile||!csvAgent) return
    setCsvUploading(true)
    try {
      const {headers, rows} = await parseSpreadsheet(csvFile)
      const map = autoMapHeaders(headers)
      const leads = rows
        .map(row => ({
          full_name:      map.full_name      ? (row[map.full_name]||'').trim()      : '',
          mobile:         map.mobile         ? (row[map.mobile]||'').replace(/\D/g,'').slice(-10) : '',
          city:           map.city           ? (row[map.city]||'').trim()           : '',
          loan_amount:    map.loan_amount    ? (parseFloat(String(row[map.loan_amount]||'').replace(/,/g,''))||null) : null,
          notes:          map.notes          ? (row[map.notes]||'').trim()||null    : null,
          application_id: map.application_id ? (row[map.application_id]||'').trim()||null : null,
          email:          map.email          ? (row[map.email]||'').trim()||null    : null,
          lead_source:    '',
          assigned_to:    csvAgent,
          status:         'New',
        }))
        .filter(r => r.full_name && r.mobile)
      if(leads.length > 0) await supabase.from('leads').insert(leads)
    } catch(err) { console.error('Upload error:', err) }
    setCsvUploading(false)
    setShowCSVModal(false)
    setCsvFile(null)
    setCsvPreview([])
    fetchLeads()
  }

  return (
    <ErrorBoundary>
    <div style={{display:'flex',alignItems:'flex-start',minHeight:'100%'}}>
      <div style={{flex:1,minWidth:0,overflow:'hidden'}}>
      {isMobile && (
          <div style={{display:'grid',gap:12}}>
            {uniqueFiltered.length===0 ? (
              <div>
                <div className="empty-state">
                  <span className="empty-icon">
                    <IconUsers size={40} strokeWidth={1.2} color="#CBD5E0"/>
                  </span>
                  <h3>No leads found</h3>
                  <p>{userRole==='agent'?'No leads assigned to you yet':'Add leads or import from CSV'}</p>
                </div>
              </div>
            ) : uniqueFiltered.map(lead=>{
              const statusObj = statuses.find(s=>s.label===lead.status)
              return (
                <div key={lead.id} style={{background:'white',borderRadius:12,boxShadow:'0 6px 18px rgba(15,23,42,0.06)',padding:14}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                    <div style={{fontWeight:700,fontSize:16,color:'#111827'}}>{lead.full_name}</div>
                    <div style={{background:statusObj?.color||'#E6F1FB',color:statusObj?.textColor||'#185FA5',padding:'6px 10px',borderRadius:20,fontSize:12,fontWeight:700}}>{lead.status||'New'}</div>
                  </div>
                  <div style={{marginBottom:8, display:'flex',alignItems:'center',gap:'10px'}}>
                    <a href={'tel:'+lead.mobile} style={{textDecoration:'none',color:'#0F172A',fontSize:15,fontWeight:600,display:'flex',alignItems:'center',gap:6}}><IconPhone size={15} color='#185FA5'/>{lead.mobile}</a>
                  </div>
                  <div style={{color:'#6B7280',marginBottom:8,fontSize:13}}>
                    {lead.city||'-'} {lead.city&&lead.loan_amount? '•':''} {lead.loan_amount?fmtAmt(lead.loan_amount):'-'}
                  </div>
                  <div style={{color:'#9CA3AF',fontSize:12,marginBottom:12}}>{new Date(lead.created_at).toLocaleDateString('en-IN')}</div>
                  <div style={{display:'flex',gap:8}}>
                    <a href={'tel:'+lead.mobile} style={{flex:1,background:'#185FA5',color:'white',padding:'10px',borderRadius:8,textDecoration:'none',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,gap:5}}><IconPhone size={15}/>Call</a>
                    <a href={'https://wa.me/91'+lead.mobile} target="_blank" rel="noreferrer" style={{flex:1,background:'#25D366',color:'white',padding:'10px',borderRadius:8,textDecoration:'none',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,gap:5}}><IconBrandWhatsapp size={15}/>WhatsApp</a>
                    <button onClick={()=>setSelectedLead(lead)} style={{flex:1,border:'1.5px solid #E2E8F0',background:'transparent',padding:'10px',borderRadius:8,fontWeight:600,cursor:'pointer',fontSize:13}}>View</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      {/* desktop table is rendered inside page-body table-container below */}
      {false && (
          <div style={{overflowX:'auto'}}>
          <table>
            <thead>
              <tr>
                {[
                  'Lead','Contact','City','Loan Amount','Sheet No.','Status',
                  ...(isAdminOrManager?['Assigned To']:[]),
                  'Actions','Date'
                ].map(h=><th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {uniqueFiltered.length===0 ? (
                <tr><td colSpan={isAdminOrManager?9:8}>
                  <div className="empty-state">
                    <span className="empty-icon">
                      <IconUsers size={40} strokeWidth={1.2} color="#CBD5E0"/>
                    </span>
                    <h3>No leads found</h3>
                    <p>{userRole==='agent'?'No leads assigned to you yet':'Add leads or import from CSV'}</p>
                  </div>
                </td></tr>
              ) : uniqueFiltered.map(lead=>{
                const statusObj = statuses.find(s=>s.label===lead.status)
                const assignedAgent = agents.find(a=>a.id===lead.assigned_to)
                return (
                  <tr key={lead.id}>
                    <td>
                      <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                        <div style={{width:'34px',height:'34px',borderRadius:'50%',
                          background:'#E6F1FB',display:'flex',alignItems:'center',
                          justifyContent:'center',fontWeight:'600',color:'#185FA5',
                          fontSize:'13px',flexShrink:0}}>
                          {lead.full_name[0]?.toUpperCase()}
                        </div>
                        <div>
                          <div style={{fontWeight:'600',fontSize:'14px'}}>{lead.full_name}</div>
                          <div style={{fontSize:'12px',color:'#A0AEC0'}}>Personal Loan</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div style={{fontSize:'14px', display: 'flex', alignItems: 'center', gap: '8px'}}>
                        <a href={'tel:'+lead.mobile} style={{textDecoration:'none',color:'#0F172A'}}>{lead.mobile}</a>
                      </div>
                      {lead.email&&<div style={{fontSize:'12px',color:'#A0AEC0'}}>{lead.email}</div>}
                    </td>
                    <td style={{color:'#718096'}}>{lead.city||'-'}</td>
                    <td style={{fontWeight:'600',color:'#185FA5'}}>
                      {lead.loan_amount?fmtAmt(lead.loan_amount):'-'}
                    </td>
                    <td style={{color:'#718096',fontSize:'13px'}}>{lead.sheet_number||'-'}</td>
                    <td>
                      <select value={lead.status||'New'}
                        onChange={e=>updateStatus(lead.id,e.target.value)}
                        style={{background:statusObj?.color||'#185FA5',color:'white',
                          border:'none',padding:'4px 10px',borderRadius:'20px',
                          fontSize:'12px',fontWeight:'600',cursor:'pointer',outline:'none'}}>
                        {statuses.map(s=>(
                          <option key={s.id} value={s.label}
                            style={{background:'white',color:'black'}}>{s.label}</option>
                        ))}
                      </select>
                    </td>
                    {isAdminOrManager && (
                      <td>
                        <select value={lead.assigned_to||''}
                          onChange={e=>reassignLead(lead.id,e.target.value)}
                          style={{padding:'5px 8px',border:'0.5px solid #E2E8F0',
                            borderRadius:'6px',fontSize:'12px',background:'white',
                            color:'#4A5568',outline:'none',maxWidth:'130px'}}>
                          <option value="">Unassigned</option>
                          {agents.map(a=>(
                            <option key={a.id} value={a.id}>{a.full_name}</option>
                          ))}
                        </select>
                      </td>
                    )}
                    <td>
                      <div style={{display:'flex',gap:'5px',alignItems:'center'}}>
                        <button className="btn btn-outline btn-sm"
                          onClick={()=>setSelectedLead(lead)}>View</button>
                        <a href={'tel:'+lead.mobile}
                          style={{width:'30px',height:'30px',borderRadius:'8px',
                            background:'#FCEBEB',border:'none',display:'flex',
                            alignItems:'center',justifyContent:'center',
                            cursor:'pointer',textDecoration:'none',
                            color:'#A32D2D',flexShrink:0}}>
                          <IconPhone size={15}/>
                        </a>
                        <a href={'https://wa.me/91'+lead.mobile}
                          target="_blank" rel="noreferrer"
                          style={{width:'30px',height:'30px',borderRadius:'8px',
                            background:'#E1F5EE',border:'none',display:'flex',
                            alignItems:'center',justifyContent:'center',
                            cursor:'pointer',textDecoration:'none',
                            color:'#0F6E56',flexShrink:0}}>
                          <IconBrandWhatsapp size={15}/>
                        </a>
                      </div>
                    </td>
                    <td style={{color:'#A0AEC0',fontSize:'12px'}}>
                      {new Date(lead.created_at).toLocaleDateString('en-IN')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        )}
        <div style={{
          display:'flex',alignItems:'center',justifyContent:'space-between',
          flexWrap:'wrap',gap:'12px',
          padding:'10px 20px 10px 20px',
          marginBottom:'8px',
          background:'white',
          borderRadius:'12px',
          border:'1px solid #F1F5F9',
          boxShadow:'0 1px 3px rgba(15,23,42,0.05)',
        }}>
          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
            <span style={{fontWeight:'700',fontSize:'15px',color:'#1E293B',lineHeight:1}}>
              {uniqueFiltered.length}
            </span>
            <span style={{fontWeight:'500',fontSize:'14px',color:'#64748B',lineHeight:1}}>
              {filterStatus ? `${filterStatus} Leads` : 'Total Leads'}
            </span>
          </div>
          <div style={{display:'flex',gap:'10px',alignItems:'center',flexWrap:'wrap'}}>
            {isAdminOrManager && (
              <>
                <button className="btn btn-ghost" onClick={downloadTemplate}>
                  Download Template
                </button>
                <button className="btn btn-success"
                  onClick={()=>setShowCSVModal(true)}
                  style={{display:'flex',alignItems:'center',gap:'6px'}}>
                  <IconUpload size={15}/> Import & Assign CSV
                </button>
              </>
            )}
            <button className="btn btn-primary" onClick={()=>setShowForm(!showForm)}>
              {showForm?'Cancel':'+ Add Lead'}
            </button>
          </div>
        </div>

      <div className="page-body">

        {/* CSV Upload Modal */}
        {showCSVModal && (
          <>
            <div className="overlay" onClick={()=>setShowCSVModal(false)}/>
            <div style={{
              position:'fixed',top:'50%',left:'50%',
              transform:'translate(-50%,-50%)',
              background:'white',borderRadius:'16px',
              boxShadow:'0 20px 60px rgba(0,0,0,0.15)',
              zIndex:300,width:'90%',maxWidth:'560px',
              overflow:'hidden'
            }}>
              <div style={{
                background:'#185FA5',padding:'20px 24px',
                display:'flex',alignItems:'center',justifyContent:'space-between'
              }}>
                <div>
                  <h3 style={{color:'white',fontSize:'16px',fontWeight:'700',margin:0}}>
                    Import & Assign Leads
                  </h3>
                  <p style={{color:'rgba(255,255,255,0.7)',fontSize:'13px',marginTop:'3px'}}>
                    Upload Excel or CSV and assign to an agent
                  </p>
                </div>
                <button onClick={()=>setShowCSVModal(false)}
                  style={{background:'rgba(255,255,255,0.15)',border:'none',color:'white',
                    width:'32px',height:'32px',borderRadius:'50%',cursor:'pointer',
                    display:'flex',alignItems:'center',justifyContent:'center',fontSize:'16px'}}>
                  <IconX size={16}/>
                </button>
              </div>

              <div style={{padding:'24px'}}>

                {/* Step 1 — Select Agent */}
                <div style={{marginBottom:'20px'}}>
                  <label style={{display:'block',fontSize:'13px',fontWeight:'600',
                    color:'#374151',marginBottom:'8px'}}>
                    Step 1 — Select Agent to Assign Leads *
                  </label>
                  <select className="form-input" value={csvAgent}
                    onChange={e=>setCsvAgent(e.target.value)}>
                    <option value="">Choose an agent...</option>
                    {agents.map(a=>(
                      <option key={a.id} value={a.id}>
                        {a.full_name} ({a.role.replace('_',' ')})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Step 2 — Upload CSV */}
                <div style={{marginBottom:'20px'}}>
                  <label style={{display:'block',fontSize:'13px',fontWeight:'600',
                    color:'#374151',marginBottom:'8px'}}>
                    Step 2 — Upload Excel or CSV File *
                  </label>
                  <div
                    onClick={()=>csvRef.current.click()}
                    style={{
                      border:'2px dashed #E5E7EB',borderRadius:'10px',
                      padding:'28px',textAlign:'center',cursor:'pointer',
                      background:csvFile?'#F0FFF4':'#FAFAFA',
                      transition:'all 0.2s'
                    }}
                    onMouseEnter={e=>e.currentTarget.style.borderColor='#185FA5'}
                    onMouseLeave={e=>e.currentTarget.style.borderColor=csvFile?'#3B6D11':'#E5E7EB'}>
                    <input ref={csvRef} type="file" accept=".xlsx,.xls,.csv,.txt"
                      style={{display:'none'}} onChange={handleCSVSelect}/>
                    {csvFile ? (
                      <div>
                        <div style={{fontSize:'28px',marginBottom:'6px'}}>✅</div>
                        <div style={{fontWeight:'600',color:'#3B6D11',fontSize:'14px'}}>
                          {csvFile.name}
                        </div>
                        <div style={{fontSize:'12px',color:'#A0AEC0',marginTop:'3px'}}>
                          {csvPreview.length}+ leads ready to import
                        </div>
                      </div>
                    ) : (
                      <div>
                        <IconUpload size={28} color="#9CA3AF" strokeWidth={1.5}/>
                        <div style={{fontSize:'14px',color:'#6B7280',marginTop:'8px',fontWeight:'500'}}>
                          Click to select file
                        </div>
                        <div style={{fontSize:'12px',color:'#9CA3AF',marginTop:'4px'}}>
                          Upload Excel (.xlsx/.xls) or CSV — any column headers
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Preview */}
                {csvPreview.length > 0 && (
                  <div style={{marginBottom:'20px'}}>
                    <label style={{display:'block',fontSize:'13px',fontWeight:'600',
                      color:'#374151',marginBottom:'8px'}}>
                      Preview (first {csvPreview.length} rows)
                    </label>
                    <div style={{background:'#F9FAFB',borderRadius:'8px',
                      border:'0.5px solid #E5E7EB',overflow:'hidden'}}>
                      <table style={{width:'100%',borderCollapse:'collapse'}}>
                        <thead>
                          <tr style={{background:'#F3F4F6'}}>
                            {['Name','Mobile','City','Source'].map(h=>(
                              <th key={h} style={{padding:'8px 12px',fontSize:'11px',
                                fontWeight:'600',color:'#6B7280',textAlign:'left',
                                textTransform:'uppercase',letterSpacing:'0.5px'}}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {csvPreview.map((row,i)=>(
                            <tr key={i} style={{borderTop:'0.5px solid #E5E7EB'}}>
                              <td style={{padding:'8px 12px',fontSize:'13px',fontWeight:'500'}}>{row.full_name||'-'}</td>
                              <td style={{padding:'8px 12px',fontSize:'13px',color:'#6B7280'}}>{row.mobile||'-'}</td>
                              <td style={{padding:'8px 12px',fontSize:'13px',color:'#6B7280'}}>{row.city||'-'}</td>
                              <td style={{padding:'8px 12px',fontSize:'13px',color:'#6B7280'}}>{row.lead_source||'-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Selected agent confirmation */}
                {csvAgent && (
                  <div style={{background:'#EBF8FF',border:'0.5px solid #BEE3F8',
                    borderRadius:'8px',padding:'12px 14px',marginBottom:'20px',
                    fontSize:'13px',color:'#185FA5',display:'flex',alignItems:'center',gap:'8px'}}>
                    <IconCheck size={15}/>
                    Leads will be assigned to: <strong>
                      {agents.find(a=>a.id===csvAgent)?.full_name}
                    </strong>
                  </div>
                )}

                <div style={{display:'flex',gap:'10px'}}>
                  <button className="btn btn-primary" style={{flex:1}}
                    onClick={handleCSVUpload} disabled={csvUploading||!csvFile||!csvAgent}>
                    {csvUploading?'Uploading...':'Upload & Assign Leads'}
                  </button>
                  <button className="btn btn-ghost"
                    onClick={()=>setShowCSVModal(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        <div className="stats-grid">
          {stats.map(s=>(
            <div key={s.label} className="stat-card" style={{cursor:'pointer'}}
              onClick={()=>setFilterStatus(s.label==='Total Leads'?'':s.label)}>
              <div className='stat-icon' style={{background:s.bg,display:'flex',alignItems:'center',justifyContent:'center'}}>{s.icon}</div>
              <div className="stat-info">
                <h3 style={{color:s.color}}>{s.value}</h3>
                <p>{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {showForm && (
          <div className="card" style={{marginBottom:'20px'}}>
            <div className="card-header">
              <h3>Add New Lead</h3>
              <button className="btn btn-ghost btn-sm" onClick={()=>setShowForm(false)}>✕</button>
            </div>
            <div className="card-body">
              <form onSubmit={handleSubmit}>
                <div className="form-grid-3">
                  {[
                    {label:'Full Name *',key:'full_name',type:'text',ph:'Customer full name'},
                    {label:'Mobile Number *',key:'mobile',type:'text',ph:'10 digit mobile'},
                    {label:'Email',key:'email',type:'email',ph:'email@example.com'},
                    {label:'City',key:'city',type:'text',ph:'City name'},
                    {label:'Loan Amount Required',key:'loan_amount',type:'text',ph:'e.g. 5,00,000'},
                    {label:'Monthly Income',key:'budget_range',type:'text',ph:'e.g. 50,000/month'},
                  ].map(f=>(
                    <div className="form-group" key={f.key}>
                      <label className="form-label">{f.label}</label>
                      <input type={f.type} className="form-input" value={form[f.key]}
                        onChange={e=>setForm({...form,[f.key]:e.target.value})}
                        required={f.label.includes('*')} placeholder={f.ph}/>
                    </div>
                  ))}
                  <div className="form-group">
                    <label className="form-label">Lead Source</label>
                    <select className="form-input" value={form.lead_source}
                      onChange={e=>setForm({...form,lead_source:e.target.value})}>
                      <option value="">Select Source</option>
                      {SOURCES.map(s=><option key={s}>{s}</option>)}
                    </select>
                  </div>
                  {isAdminOrManager && (
                    <div className="form-group">
                      <label className="form-label">Assign To Agent</label>
                      <select className="form-input" value={form.assigned_to}
                        onChange={e=>setForm({...form,assigned_to:e.target.value})}>
                        <option value="">Select Agent</option>
                        {agents.map(a=><option key={a.id} value={a.id}>{a.full_name}</option>)}
                      </select>
                    </div>
                  )}
                  <div className="form-group">
                    <label className="form-label">Follow-up Date</label>
                    <input type="datetime-local" className="form-input" value={form.follow_up_date}
                      onChange={e=>setForm({...form,follow_up_date:e.target.value})}/>
                  </div>
                  <div className="form-group" style={{gridColumn:'span 3'}}>
                    <label className="form-label">Initial Notes</label>
                    <input type="text" className="form-input" value={form.notes}
                      onChange={e=>setForm({...form,notes:e.target.value})}
                      placeholder="Any initial remarks..."/>
                  </div>
                </div>
                <div style={{display:'flex',gap:'10px',marginTop:'8px'}}>
                  <button type="submit" className="btn btn-success" disabled={loading}>
                    {loading?'Saving...':'Save Lead'}
                  </button>
                  <button type="button" className="btn btn-ghost"
                    onClick={()=>setShowForm(false)}>Cancel</button>
                </div>
              </form>
            </div>
          </div>
        )}

        <div className="filter-bar">
          <div className="search-bar" style={{flex:1,minWidth:200}}><IconSearch size={15}/><input className="form-input" style={{paddingLeft:34}} placeholder="Search by name or mobile..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
          <select className="form-input" style={{width:'160px'}} value={filterStatus}
            onChange={e=>setFilterStatus(e.target.value)}>
            <option value="">All Statuses</option>
            {LEAD_STAGES.map(s=><option key={s}>{s}</option>)}
          </select>
          <select className="form-input" style={{width:'150px'}} value={filterSource}
            onChange={e=>setFilterSource(e.target.value)}>
            <option value="">All Sources</option>
            {SOURCES.map(s=><option key={s}>{s}</option>)}
          </select>
          {isAdminOrManager && (
            <select className="form-input" style={{width:'160px'}} value={filterAgent}
              onChange={e=>setFilterAgent(e.target.value)}>
              <option value="">All Agents</option>
              {agents.map(a=><option key={a.id} value={a.id}>{a.full_name}</option>)}
            </select>
          )}
          {(filterStatus||filterSource||search||filterAgent) && (
            <button className="btn btn-ghost btn-sm"
              onClick={()=>{setFilterStatus('');setFilterSource('');setSearch('');setFilterAgent('')}}>
              Clear
            </button>
          )}
        </div>

        {!isMobile && (
        <div className="table-container">
          <table style={{borderCollapse:'collapse',width:'100%'}}>
            <thead>
              <tr style={{borderBottom:'1.5px solid #F1F5F9',background:'#FAFBFC'}}>
                {[
                  'Lead','Contact','City','Loan Amount','Sheet No.','Status',
                  ...(isAdminOrManager?['Assigned To']:[]),
                  'Actions','Date'
                ].map(h=>(
                  <th key={h} style={{
                    fontSize:'11px',fontWeight:'600',color:'#94A3B8',
                    textTransform:'uppercase',letterSpacing:'0.07em',
                    padding:'11px 14px',textAlign:'left',whiteSpace:'nowrap',
                    background:'#FAFBFC'
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {uniqueFiltered.length===0 ? (
                <tr><td colSpan={isAdminOrManager?9:8}>
                  <div className="empty-state">
                    <span className="empty-icon">
                      <IconUsers size={40} strokeWidth={1.2} color="#CBD5E0"/>
                    </span>
                    <h3>No leads found</h3>
                    <p>{userRole==='agent'?'No leads assigned to you yet':'Add leads or import from CSV'}</p>
                  </div>
                </td></tr>
              ) : uniqueFiltered.map(lead=>{
                const statusObj = statuses.find(s=>s.label===lead.status)
                const assignedAgent = agents.find(a=>a.id===lead.assigned_to)
                // Compute pastel pill colours for status select
                const statusName = lead.status||'New'
                const pasteMap = {
                  'New':{bg:'#EFF6FF',color:'#1D4ED8'},
                  'Interested':{bg:'#FFF7ED',color:'#C2410C'},
                  'Callback':{bg:'#F0FDF4',color:'#166534'},
                  'Not Interested':{bg:'#FEF2F2',color:'#991B1B'},
                  'DND':{bg:'#F5F3FF',color:'#6D28D9'},
                  'Approved':{bg:'#ECFDF5',color:'#065F46'},
                  'Disbursed':{bg:'#D1FAE5',color:'#064E3B'},
                  'HUP':{bg:'#FFF1F2',color:'#BE123C'},
                }
                const pillBg = statusObj?.color ? statusObj.color+'22' : (pasteMap[statusName]?.bg||'#F1F5F9')
                const pillColor = statusObj?.color ? statusObj.color : (pasteMap[statusName]?.color||'#475569')
                return (
                  <tr key={lead.id} style={{borderBottom:'1px solid #F8FAFC',transition:'background 0.15s'}}
                    onMouseEnter={e=>e.currentTarget.style.background='#FAFBFD'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <td style={{padding:'12px 14px',verticalAlign:'middle'}}>
                      <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                        <div style={{width:'34px',height:'34px',borderRadius:'50%',
                          background:'linear-gradient(135deg,#E6F1FB,#DBEAFE)',
                          display:'flex',alignItems:'center',
                          justifyContent:'center',fontWeight:'700',color:'#185FA5',
                          fontSize:'13px',flexShrink:0,letterSpacing:'0.01em'}}>
                          {lead.full_name[0]?.toUpperCase()}
                        </div>
                        <div>
                          <div style={{fontWeight:'600',fontSize:'14px',color:'#0F172A',lineHeight:1.3}}>{lead.full_name}</div>
                          <div style={{fontSize:'11px',color:'#94A3B8',marginTop:1}}>{lead.product_interest||'Personal Loan'}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{padding:'12px 14px',verticalAlign:'middle'}}>
                      <div style={{fontSize:'13px',fontWeight:'500',color:'#1E293B'}}>{lead.mobile}</div>
                      {lead.email&&<div style={{fontSize:'11px',color:'#94A3B8',marginTop:2}}>{lead.email}</div>}
                    </td>
                    <td style={{padding:'12px 14px',verticalAlign:'middle',color:'#64748B',fontSize:'13px'}}>{lead.city||'—'}</td>
                    <td style={{padding:'12px 14px',verticalAlign:'middle',fontWeight:'600',color:'#185FA5',fontSize:'13px'}}>
                      {lead.loan_amount?'₹'+Number(lead.loan_amount).toLocaleString('en-IN'):'—'}
                    </td>
                    <td style={{color:'#718096',fontSize:'13px',padding:'12px 14px',verticalAlign:'middle'}}>{lead.sheet_number||'-'}</td>
                    <td style={{padding:'12px 14px',verticalAlign:'middle'}}>
                      <select value={statusName}
                        onChange={e=>updateStatus(lead.id,e.target.value)}
                        style={{background:pillBg,color:pillColor,
                          border:'none',padding:'5px 12px',borderRadius:'20px',
                          fontSize:'11px',fontWeight:'700',cursor:'pointer',outline:'none',
                          letterSpacing:'0.02em',appearance:'none',WebkitAppearance:'none',
                          minWidth:'100px',textAlign:'center'}}>
                        {LEAD_STAGES.map(s=>(
                          <option key={s} value={s}
                            style={{background:'white',color:'#1E293B'}}>{s}</option>
                        ))}
                      </select>
                    </td>
                    {isAdminOrManager && (
                      <td style={{padding:'12px 14px',verticalAlign:'middle'}}>
                        <select value={lead.assigned_to||''}
                          onChange={e=>reassignLead(lead.id,e.target.value)}
                          style={{padding:'5px 8px',border:'1px solid #E2E8F0',
                            borderRadius:'8px',fontSize:'12px',background:'white',
                            color:'#374151',outline:'none',maxWidth:'130px',cursor:'pointer'}}>
                          <option value="">Unassigned</option>
                          {agents.map(a=>(
                            <option key={a.id} value={a.id}>{a.full_name}</option>
                          ))}
                        </select>
                      </td>
                    )}
                    <td style={{padding:'12px 14px',verticalAlign:'middle'}}>
                      <div style={{display:'flex',gap:'4px',alignItems:'center'}}>
                        <button
                          onClick={()=>setSelectedLead(lead)}
                          style={{padding:'5px 12px',borderRadius:'8px',border:'1px solid #E2E8F0',
                            background:'white',color:'#374151',fontSize:'12px',fontWeight:'600',
                            cursor:'pointer',whiteSpace:'nowrap',transition:'all 0.15s'}}
                          onMouseEnter={e=>{e.currentTarget.style.background='#F1F5F9';e.currentTarget.style.borderColor='#CBD5E4'}}
                          onMouseLeave={e=>{e.currentTarget.style.background='white';e.currentTarget.style.borderColor='#E2E8F0'}}>
                          View
                        </button>
                        <a href={'tel:'+lead.mobile}
                          style={{width:'30px',height:'30px',borderRadius:'50%',
                            background:'transparent',border:'none',display:'flex',
                            alignItems:'center',justifyContent:'center',
                            cursor:'pointer',textDecoration:'none',
                            color:'#DC2626',flexShrink:0,transition:'background 0.15s'}}
                          onMouseEnter={e=>e.currentTarget.style.background='#FEF2F2'}
                          onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                          <IconPhone size={15}/>
                        </a>
                        <a href={'https://wa.me/91'+lead.mobile}
                          target="_blank" rel="noreferrer"
                          style={{width:'30px',height:'30px',borderRadius:'50%',
                            background:'transparent',border:'none',display:'flex',
                            alignItems:'center',justifyContent:'center',
                            cursor:'pointer',textDecoration:'none',
                            color:'#16A34A',flexShrink:0,transition:'background 0.15s'}}
                          onMouseEnter={e=>e.currentTarget.style.background='#F0FDF4'}
                          onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                          <IconBrandWhatsapp size={15}/>
                        </a>
                      </div>
                    </td>
                    <td style={{padding:'12px 14px',verticalAlign:'middle',color:'#94A3B8',fontSize:'12px',whiteSpace:'nowrap'}}>
                      {new Date(lead.created_at).toLocaleDateString('en-IN')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        )}
      </div>

      </div>{/* end flex main content */}

      {selectedLead && (
        <div style={{
          width:400,
          flexShrink:0,
          borderLeft:'1px solid #e5e7eb',
          background:'white',
          position:'sticky',
          top:0,
          height:'100vh',
          overflowY:'auto',
          display:'flex',
          flexDirection:'column',
          boxShadow:'-4px 0 16px rgba(0,0,0,0.06)',
        }}>
          {/* Panel header */}
          <div style={{padding:'20px 20px 0',borderBottom:'1px solid #e5e7eb',flexShrink:0}}>
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:16}}>
              <div>
                <h2 style={{fontSize:20,fontWeight:700,color:'#111827',margin:0,lineHeight:1.2}}>{selectedLead.full_name}</h2>
                <div style={{fontSize:13,color:'#6b7280',marginTop:4}}>{selectedLead.mobile}</div>
              </div>
              <button
                onClick={()=>setSelectedLead(null)}
                style={{width:32,height:32,borderRadius:8,border:'1px solid #e5e7eb',background:'white',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:'#6b7280',flexShrink:0,fontSize:16}}
                onMouseEnter={e=>{e.currentTarget.style.background='#f3f4f6';e.currentTarget.style.borderColor='#d1d5db'}}
                onMouseLeave={e=>{e.currentTarget.style.background='white';e.currentTarget.style.borderColor='#e5e7eb'}}>
                ✕
              </button>
            </div>
            {/* Tabs */}
            <div style={{display:'flex'}}>
              {[{id:'details',label:'Details'},{id:'notes',label:'Notes'},{id:'actions',label:'Actions'}].map(t=>(
                <button key={t.id}
                  onClick={()=>setActiveTab(t.id)}
                  style={{
                    flex:1,padding:'10px 0',border:'none',background:'transparent',
                    fontSize:14,fontWeight:activeTab===t.id?600:400,
                    color:activeTab===t.id?'#185FA5':'#6b7280',
                    cursor:'pointer',
                    borderBottom:activeTab===t.id?'2px solid #185FA5':'2px solid transparent',
                    transition:'color 0.15s',
                  }}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Panel body */}
          <div style={{padding:20,flex:1,overflowY:'auto'}}>

            {activeTab==='details' && (
              <div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:20}}>
                  {[
                    {label:'Mobile',    value:selectedLead.mobile,                                                              span:false},
                    {label:'City',      value:selectedLead.city||'-',                                                           span:false},
                    {label:'Loan Amount',value:selectedLead.loan_amount?'₹'+Number(selectedLead.loan_amount).toLocaleString('en-IN'):'-', span:false},
                    {label:'Monthly Income',value:selectedLead.budget_range||'-',                                               span:false},
                    {label:'Lead Source',value:selectedLead.lead_source||'-',                                                   span:false},
                    {label:'Email',     value:selectedLead.email||'-',                                                          span:true},
                  ].map(item=>(
                    <div key={item.label} style={{gridColumn:item.span?'span 2':'auto'}}>
                      <div style={{fontSize:11,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:4}}>{item.label}</div>
                      <div style={{fontSize:14,color:'#111827',fontWeight:500,wordBreak:'break-word'}}>{item.value}</div>
                    </div>
                  ))}
                </div>

                <div style={{borderTop:'1px solid #e5e7eb',paddingTop:16,marginBottom:16}}>
                  <div style={{fontSize:13,fontWeight:600,color:'#374151',marginBottom:8}}>Update Status</div>
                  <select
                    value={pendingStatus}
                    onChange={e=>setPendingStatus(e.target.value)}
                    style={{width:'100%',padding:'8px 12px',border:'1px solid #d1d5db',borderRadius:8,fontSize:14,outline:'none',marginBottom:10,background:'white',color:'#111827'}}>
                    {LEAD_STAGES.map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                  <button
                    onClick={()=>updateStatus(selectedLead.id, pendingStatus)}
                    style={{width:'100%',padding:10,background:'#185FA5',color:'white',border:'none',borderRadius:8,fontSize:14,fontWeight:600,cursor:'pointer'}}
                    onMouseEnter={e=>e.currentTarget.style.background='#1a4f8a'}
                    onMouseLeave={e=>e.currentTarget.style.background='#185FA5'}>
                    Save Status
                  </button>
                </div>

                {isAdminOrManager && (
                  <div>
                    <div style={{fontSize:13,fontWeight:600,color:'#374151',marginBottom:8}}>Assigned Agent</div>
                    <select
                      value={selectedLead.assigned_to||''}
                      onChange={e=>{
                        reassignLead(selectedLead.id, e.target.value)
                        setSelectedLead({...selectedLead, assigned_to:e.target.value})
                      }}
                      style={{width:'100%',padding:'8px 12px',border:'1px solid #d1d5db',borderRadius:8,fontSize:14,outline:'none',background:'white',color:'#111827'}}>
                      <option value="">Unassigned</option>
                      {agents.map(a=><option key={a.id} value={a.id}>{a.full_name}</option>)}
                    </select>
                  </div>
                )}
              </div>
            )}

            {activeTab==='notes' && (
              <div>
                <div style={{background:'#f9fafb',borderRadius:10,padding:14,
                  minHeight:150,marginBottom:14,fontSize:13,
                  whiteSpace:'pre-wrap',color:'#374151',maxHeight:320,
                  overflowY:'auto',lineHeight:1.6,border:'1px solid #e5e7eb'}}>
                  {selectedLead.notes||'No notes yet. Add your first call note!'}
                </div>
                <div style={{display:'flex',gap:8}}>
                  <input
                    style={{flex:1,padding:'8px 12px',border:'1px solid #d1d5db',borderRadius:8,fontSize:14,outline:'none'}}
                    value={note}
                    onChange={e=>setNote(e.target.value)}
                    placeholder="Add call note..."
                    onKeyPress={e=>e.key==='Enter'&&addNote()}/>
                  <button
                    onClick={addNote}
                    style={{padding:'8px 16px',background:'#185FA5',color:'white',border:'none',borderRadius:8,fontSize:14,fontWeight:600,cursor:'pointer'}}>
                    Add
                  </button>
                </div>
                <p style={{fontSize:12,color:'#9ca3af',marginTop:6}}>Press Enter or click Add</p>
              </div>
            )}

            {activeTab==='actions' && (
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                <a href={'tel:'+selectedLead.mobile}
                  style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8,padding:13,background:'#185FA5',color:'white',borderRadius:8,textDecoration:'none',fontSize:14,fontWeight:600}}>
                  📞 Call {selectedLead.full_name}
                </a>
                <a href={'https://wa.me/91'+selectedLead.mobile}
                  target="_blank" rel="noreferrer"
                  style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8,padding:13,background:'#25D366',color:'white',borderRadius:8,textDecoration:'none',fontSize:14,fontWeight:600}}>
                  💬 WhatsApp Message
                </a>
                {selectedLead.email && (
                  <a href={'mailto:'+selectedLead.email}
                    style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8,padding:13,background:'white',color:'#374151',border:'1px solid #d1d5db',borderRadius:8,textDecoration:'none',fontSize:14,fontWeight:600}}>
                    ✉ Send Email
                  </a>
                )}
                <div style={{borderTop:'1px solid #e5e7eb',paddingTop:14,marginTop:4}}>
                  <div style={{fontSize:12,color:'#9ca3af'}}>
                    Created: {new Date(selectedLead.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}
                  </div>
                  {selectedLead.follow_up_date && (
                    <div style={{marginTop:4,color:'#c05621',fontWeight:500,fontSize:13}}>
                      Follow-up: {new Date(selectedLead.follow_up_date).toLocaleString('en-IN')}
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
    </ErrorBoundary>
  )
}