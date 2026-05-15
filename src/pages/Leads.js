/* eslint-disable */
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import {
  IconUsers, IconUserPlus, IconThumbUp, IconCircleCheck,
  IconPhone, IconBrandWhatsapp, IconUpload, IconEdit,
  IconX, IconCheck
} from '@tabler/icons-react'

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

  useEffect(() => { fetchLeads(); fetchStatuses(); fetchAgents() }, [])

  const fetchLeads = async () => {
    let query = supabase.from('leads').select('*').order('created_at',{ascending:false})
    if (userRole === 'agent') {
      query = query.eq('assigned_to', userId)
    }
    const { data } = await query
    if (data) setLeads(data)
  }

  const fetchStatuses = async () => {
    const { data } = await supabase.from('lead_statuses').select('*').eq('is_active',true).order('sort_order')
    if (data) setStatuses(data)
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

  const updateStatus = async (id, status) => {
    await supabase.from('leads').update({status}).eq('id',id)
    fetchLeads()
    if (selectedLead?.id===id) setSelectedLead({...selectedLead,status})
  }

  const addNote = async () => {
    if (!note.trim()) return
    const existing = selectedLead.notes||''
    const updated = existing+(existing?'\n':'')+'['+new Date().toLocaleString()+'] '+note
    await supabase.from('leads').update({notes:updated}).eq('id',selectedLead.id)
    setSelectedLead({...selectedLead,notes:updated})
    setNote('')
    fetchLeads()
  }

  const handleCSVSelect = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setCsvFile(file)
    const reader = new FileReader()
    reader.onload = (evt) => {
      const text = evt.target.result
      const lines = text.split('\n').filter(l=>l.trim())
      const headers = lines[0].split(',').map(h=>h.trim().toLowerCase().replace(/ /g,'_'))
      const rows = lines.slice(1).map(line => {
        const values = line.split(',')
        const obj = {}
        headers.forEach((h,i)=>{ obj[h]=values[i]?values[i].trim():'' })
        return obj
      }).filter(r=>r.full_name&&r.mobile)
      setCsvPreview(rows.slice(0,5))
    }
    reader.readAsText(file)
    e.target.value=''
  }

  const handleCSVUpload = async () => {
    if (!csvFile || !csvAgent) {
      alert('Please select both a CSV file and an agent to assign leads to!')
      return
    }
    setCsvUploading(true)
    const reader = new FileReader()
    reader.onload = async (evt) => {
      const text = evt.target.result
      const lines = text.split('\n').filter(l=>l.trim())
      const headers = lines[0].split(',').map(h=>h.trim().toLowerCase().replace(/ /g,'_'))
      const rows = lines.slice(1).map(line => {
        const values = line.split(',')
        const obj = {}
        headers.forEach((h,i)=>{ obj[h]=values[i]?values[i].trim():'' })
        return {
          ...obj,
          status:'New',
          product_interest: obj.product_interest||'Personal Loan',
          assigned_to: csvAgent
        }
      }).filter(r=>r.full_name&&r.mobile)

      if (rows.length>0) {
        const { error } = await supabase.from('leads').insert(rows)
        if (error) {
          alert('Error: '+error.message)
        } else {
          alert('✅ '+rows.length+' leads imported and assigned successfully!')
          setShowCSVModal(false)
          setCsvFile(null)
          setCsvPreview([])
          setCsvAgent('')
          fetchLeads()
        }
      } else {
        alert('No valid leads found in CSV. Make sure it has full_name and mobile columns.')
      }
      setCsvUploading(false)
    }
    reader.readAsText(csvFile)
  }

  const downloadTemplate = () => {
    const csv = 'full_name,mobile,email,city,lead_source,loan_amount,budget_range\nRahul Sharma,9876543210,rahul@email.com,Mumbai,Referral,500000,50000\nPriya Patel,9876543211,priya@email.com,Pune,Website,300000,40000'
    const blob = new Blob([csv],{type:'text/csv'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href=url; a.download='leads_template.csv'; a.click()
  }

  const reassignLead = async (leadId, agentId) => {
    await supabase.from('leads').update({assigned_to: agentId||null}).eq('id', leadId)
    fetchLeads()
  }

  const SOURCES = ['Walk-in','Website','Referral','WhatsApp','SMS','Inbound Call','Import','Other']

  const filtered = leads.filter(l => {
    const matchSearch = l.full_name?.toLowerCase().includes(search.toLowerCase())||l.mobile?.includes(search)
    const matchStatus = filterStatus ? l.status===filterStatus : true
    const matchSource = filterSource ? l.lead_source===filterSource : true
    const matchAgent = filterAgent ? l.assigned_to===filterAgent : true
    return matchSearch && matchStatus && matchSource && matchAgent
  })

  const stats = [
    {icon:<IconUsers size={20} color="#185FA5"/>, label:'Total Leads', value:leads.length, color:'#185FA5', bg:'#E6F1FB'},
    {icon:<IconUserPlus size={20} color="#5F5E5A"/>, label:'New', value:leads.filter(l=>l.status==='New').length, color:'#5F5E5A', bg:'#F1EFE8'},
    {icon:<IconThumbUp size={20} color="#0F6E56"/>, label:'Interested', value:leads.filter(l=>l.status==='Interested').length, color:'#0F6E56', bg:'#E1F5EE'},
    {icon:<IconCircleCheck size={20} color="#3B6D11"/>, label:'Approved', value:leads.filter(l=>l.status==='Approved'||l.status==='Disbursed').length, color:'#3B6D11', bg:'#EAF3DE'},
  ]

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Leads Management</h1>
          <p>{filtered.length} leads {filterStatus?'· '+filterStatus:''}</p>
        </div>
        <div style={{display:'flex',gap:'10px',flexWrap:'wrap'}}>
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
                    Upload CSV and assign to an agent
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
                    Step 2 — Upload CSV File *
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
                    <input ref={csvRef} type="file" accept=".csv"
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
                          Click to select CSV file
                        </div>
                        <div style={{fontSize:'12px',color:'#9CA3AF',marginTop:'4px'}}>
                          Must have: full_name, mobile columns
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
              <div style={{width:'40px',height:'40px',borderRadius:'10px',background:s.bg,
                display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                {s.icon}
              </div>
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

        <div className="search-bar">
          <input className="search-input" placeholder="Search by name or mobile..."
            value={search} onChange={e=>setSearch(e.target.value)}/>
          <select className="form-input" style={{width:'160px'}} value={filterStatus}
            onChange={e=>setFilterStatus(e.target.value)}>
            <option value="">All Statuses</option>
            {statuses.map(s=><option key={s.id}>{s.label}</option>)}
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

        <div className="table-container">
          <table>
            <thead>
              <tr>
                {[
                  'Lead','Contact','City','Loan Amount','Source','Status',
                  ...(isAdminOrManager?['Assigned To']:[]),
                  'Actions','Date'
                ].map(h=><th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {filtered.length===0 ? (
                <tr><td colSpan={isAdminOrManager?9:8}>
                  <div className="empty-state">
                    <span className="empty-icon">
                      <IconUsers size={40} strokeWidth={1.2} color="#CBD5E0"/>
                    </span>
                    <h3>No leads found</h3>
                    <p>{userRole==='agent'?'No leads assigned to you yet':'Add leads or import from CSV'}</p>
                  </div>
                </td></tr>
              ) : filtered.map(lead=>{
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
                      <div style={{fontSize:'14px'}}>{lead.mobile}</div>
                      {lead.email&&<div style={{fontSize:'12px',color:'#A0AEC0'}}>{lead.email}</div>}
                    </td>
                    <td style={{color:'#718096'}}>{lead.city||'-'}</td>
                    <td style={{fontWeight:'600',color:'#185FA5'}}>
                      {lead.loan_amount?'₹'+Number(lead.loan_amount).toLocaleString('en-IN'):'-'}
                    </td>
                    <td>
                      {lead.lead_source&&(
                        <span style={{background:'#F7FAFC',color:'#718096',padding:'3px 8px',
                          borderRadius:'4px',fontSize:'12px',border:'0.5px solid #E2E8F0'}}>
                          {lead.lead_source}
                        </span>
                      )}
                    </td>
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
      </div>

      {selectedLead && (
        <>
          <div className="overlay" onClick={()=>setSelectedLead(null)}/>
          <div className="side-panel">
            <div className="side-panel-header">
              <div>
                <h3>{selectedLead.full_name}</h3>
                <p style={{color:'rgba(255,255,255,0.7)',fontSize:'13px',marginTop:'2px'}}>
                  {selectedLead.mobile}
                </p>
              </div>
              <button className="side-panel-close" onClick={()=>setSelectedLead(null)}>✕</button>
            </div>
            <div className="side-panel-body">
              <div className="tabs">
                {['details','notes','actions'].map(t=>(
                  <button key={t} className={`tab ${activeTab===t?'active':''}`}
                    onClick={()=>setActiveTab(t)}>
                    {t==='details'?'Details':t==='notes'?'Notes':'Actions'}
                  </button>
                ))}
              </div>

              {activeTab==='details' && (
                <div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px',marginBottom:'20px'}}>
                    {[
                      {label:'Mobile',value:selectedLead.mobile},
                      {label:'Email',value:selectedLead.email||'-'},
                      {label:'City',value:selectedLead.city||'-'},
                      {label:'Loan Amount',value:selectedLead.loan_amount?'₹'+Number(selectedLead.loan_amount).toLocaleString('en-IN'):'-'},
                      {label:'Monthly Income',value:selectedLead.budget_range||'-'},
                      {label:'Lead Source',value:selectedLead.lead_source||'-'},
                    ].map(item=>(
                      <div key={item.label} style={{background:'#F7FAFC',padding:'12px',
                        borderRadius:'8px',border:'0.5px solid #E2E8F0'}}>
                        <div style={{fontSize:'11px',color:'#A0AEC0',marginBottom:'3px',
                          textTransform:'uppercase',letterSpacing:'0.5px'}}>{item.label}</div>
                        <div style={{fontWeight:'600',fontSize:'14px',color:'#2D3748'}}>{item.value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="form-group">
                    <label className="form-label">Update Status</label>
                    <select className="form-input" value={selectedLead.status||'New'}
                      onChange={e=>updateStatus(selectedLead.id,e.target.value)}>
                      {statuses.map(s=><option key={s.id}>{s.label}</option>)}
                    </select>
                  </div>
                  {isAdminOrManager && (
                    <div className="form-group">
                      <label className="form-label">Assigned Agent</label>
                      <select className="form-input"
                        value={selectedLead.assigned_to||''}
                        onChange={e=>{
                          reassignLead(selectedLead.id, e.target.value)
                          setSelectedLead({...selectedLead, assigned_to:e.target.value})
                        }}>
                        <option value="">Unassigned</option>
                        {agents.map(a=><option key={a.id} value={a.id}>{a.full_name}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {activeTab==='notes' && (
                <div>
                  <div style={{background:'#F7FAFC',borderRadius:'10px',padding:'14px',
                    minHeight:'150px',marginBottom:'14px',fontSize:'13px',
                    whiteSpace:'pre-wrap',color:'#4A5568',maxHeight:'300px',
                    overflowY:'auto',lineHeight:'1.6',border:'0.5px solid #E2E8F0'}}>
                    {selectedLead.notes||'No notes yet. Add your first call note!'}
                  </div>
                  <div style={{display:'flex',gap:'8px'}}>
                    <input className="form-input" value={note}
                      onChange={e=>setNote(e.target.value)}
                      placeholder="Add call note..."
                      onKeyPress={e=>e.key==='Enter'&&addNote()}/>
                    <button className="btn btn-primary" onClick={addNote}>Add</button>
                  </div>
                  <p style={{fontSize:'12px',color:'#A0AEC0',marginTop:'6px'}}>
                    Press Enter or click Add
                  </p>
                </div>
              )}

              {activeTab==='actions' && (
                <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
                  <a href={'tel:'+selectedLead.mobile} className="btn btn-success"
                    style={{textDecoration:'none',justifyContent:'center',padding:'13px'}}>
                    Call {selectedLead.full_name}
                  </a>
                  <a href={'https://wa.me/91'+selectedLead.mobile}
                    target="_blank" rel="noreferrer" className="btn"
                    style={{background:'#25D366',color:'white',textDecoration:'none',
                      justifyContent:'center',padding:'13px'}}>
                    WhatsApp Message
                  </a>
                  {selectedLead.email && (
                    <a href={'mailto:'+selectedLead.email} className="btn btn-outline"
                      style={{textDecoration:'none',justifyContent:'center',padding:'13px'}}>
                      Send Email
                    </a>
                  )}
                  <div style={{borderTop:'0.5px solid #E2E8F0',paddingTop:'14px',marginTop:'4px'}}>
                    <div style={{fontSize:'12px',color:'#A0AEC0'}}>
                      Created: {new Date(selectedLead.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}
                    </div>
                    {selectedLead.follow_up_date && (
                      <div style={{marginTop:'4px',color:'#C05621',fontWeight:'500',fontSize:'13px'}}>
                        Follow-up: {new Date(selectedLead.follow_up_date).toLocaleString('en-IN')}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}