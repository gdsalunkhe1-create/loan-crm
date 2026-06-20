/* eslint-disable */
import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { analyzeBankStatement } from '../utils/bankBehaviour'

const IST_TZ = 'Asia/Kolkata'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error: error.message }
  }
  componentDidCatch(error, info) {
    console.error('Admin Panel Error:', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 40,
          textAlign: 'center',
          fontFamily: 'sans-serif',
          background: 'white',
          borderRadius: 12,
          border: '1px solid #fecaca',
          margin: 20
        }}>
          <div style={{fontSize: 32, marginBottom: 12}}>⚠️</div>
          <div style={{fontSize: 18, fontWeight: 700, color: '#dc2626', marginBottom: 8}}>
            Something went wrong
          </div>
          <div style={{fontSize: 13, color: '#6b7280', marginBottom: 20, maxWidth: 400, margin: '0 auto 20px'}}>
            {this.state.error}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{padding: '8px 20px', background: '#185FA5', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', marginRight: 8}}
          >
            Try Again
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{padding: '8px 20px', background: 'white', color: '#185FA5', border: '1px solid #185FA5', borderRadius: 8, cursor: 'pointer'}}
          >
            Reload Page
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

const P = '#185FA5'
const SUPABASE_URL = 'https://pvnzeueldfmxhesmoetc.supabase.co'
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2bnpldWVsZGZteGhlc21vZXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzY2MDA0NCwiZXhwIjoyMDkzMjM2MDQ0fQ.J7qjEpXnTlFvRJDM3uHG4JbPmFakaSFnu16mLtCvSdA'

const NAV = [
  { id: 'overview',  label: 'Overview'     },
  { id: 'users',     label: 'Users'        },
  { id: 'leads',     label: 'Leads'        },
  { id: 'reports',   label: 'Performance'  },
  { id: 'pipeline',  label: 'Pipeline'     },
  { id: 'activity',  label: 'Activity Log' },
  { id: 'stages',    label: 'Lead Stages'  },
  { id: 'config',    label: 'Config'       },
]

const TOOLS_NAV = [
  { id: 'bsa', label: '🔍 Bank Analyzer' },
]

const SC = { New:'#185FA5',Interested:'#7c3aed',Callback:'#d97706',Approved:'#16a34a',Disbursed:'#15803d','Not Interested':'#dc2626',DND:'#dc2626',Login:'#0891b2' }
const sc = s => SC[s] || '#6b7280'
const fmtV = v => { if(!v&&v!==0)return'—'; const n=Math.round(parseFloat(v)); if(n>=10000000)return'₹'+(n/10000000).toFixed(2)+' Cr'; if(n>=100000)return'₹'+(n/100000).toFixed(2)+' L'; return'₹'+n.toLocaleString('en-IN') }
const fmtDt = d => d ? new Date(d).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:IST_TZ}) : '—'
const todayStr = () => new Date().toISOString().split('T')[0]
const monthStr = () => new Date().toISOString().slice(0,7)

const TH = { padding:'10px 16px', textAlign:'left', fontSize:12, fontWeight:600, color:'#6b7280', background:'#f9fafb', borderBottom:'1px solid #e5e7eb', whiteSpace:'nowrap' }
const TD = { padding:'10px 16px', fontSize:13, borderBottom:'1px solid #f3f4f6', verticalAlign:'middle' }
const INP = { width:'100%', padding:'8px 12px', border:'1px solid #d1d5db', borderRadius:8, fontSize:13, outline:'none', boxSizing:'border-box', background:'white' }
const SEL = { padding:'8px 12px', border:'1px solid #d1d5db', borderRadius:8, fontSize:13, background:'white', outline:'none', cursor:'pointer' }
const LBL = { fontSize:12, color:'#6b7280', display:'block', marginBottom:4, fontWeight:500 }

function Card({children,style}){ return <div style={{background:'white',borderRadius:12,border:'1px solid #e5e7eb',boxShadow:'0 1px 3px rgba(0,0,0,0.05)',...style}}>{children}</div> }
function Btn({onClick,disabled,children,danger,outline,small,style}){
  return <button onClick={onClick} disabled={disabled} style={{padding:small?'5px 12px':'8px 18px',fontSize:small?12:13,fontWeight:600,borderRadius:8,cursor:disabled?'not-allowed':'pointer',opacity:disabled?0.6:1,border:danger?'1px solid #fecaca':outline?'1px solid '+P:'none',background:danger?'#fef2f2':outline?'white':P,color:danger?'#dc2626':outline?P:'white',whiteSpace:'nowrap',display:'inline-flex',alignItems:'center',gap:4,...style}}>{children}</button>
}
function Badge({text,color}){ return <span style={{padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:600,background:(color||P)+'18',color:color||P,display:'inline-block',whiteSpace:'nowrap'}}>{text}</span> }
function Toast({toast}){
  if(!toast) return null
  return <div style={{position:'fixed',bottom:24,right:24,zIndex:9999,background:toast.type==='error'?'#dc2626':'#15803d',color:'white',padding:'12px 20px',borderRadius:10,fontSize:14,fontWeight:500,boxShadow:'0 4px 12px rgba(0,0,0,0.2)',maxWidth:320}}>{toast.msg}</div>
}

// ─── OVERVIEW ────────────────────────────────────────────────────────────────
function Overview({ users, leads, callLogs, authUsers, settings, saveSetting, onGoToImport }) {
  const [editKey,setEditKey] = useState(null)
  const [editVal,setEditVal] = useState('')
  const [saving,setSaving]   = useState(false)

  const td = todayStr(), tm = monthStr()
  const callsToday  = callLogs.filter(c=>(c.created_at||'').startsWith(td)).length
  const leadsToday  = leads.filter(l=>(l.created_at||'').startsWith(td)).length
  const leadsMonth  = leads.filter(l=>(l.created_at||'').startsWith(tm)).length
  const agentIds    = new Set(users.filter(u=>u.role==='agent').map(u=>u.id))
  const agentLogT   = authUsers.filter(u=>agentIds.has(u.id)&&(u.last_sign_in_at||'').startsWith(td)).length
  const agentLogM   = authUsers.filter(u=>agentIds.has(u.id)&&(u.last_sign_in_at||'').startsWith(tm)).length
  const totalLogM   = authUsers.filter(u=>(u.last_sign_in_at||'').startsWith(tm)).length

  const mk = new Date().toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:IST_TZ}).toLowerCase().replace(' ','_')
  const manualStats = [
    {key:`disbursements_${mk}`, label:'Disbursements This Month'},
    {key:`applications_${mk}`,  label:'Applications Logged In'},
    {key:`obligations_${mk}`,   label:'Obligations Disbursed'},
  ]

  const saveManual = async () => {
    setSaving(true)
    await saveSetting(editKey, editVal)
    setSaving(false); setEditKey(null)
  }

  const agents = users.filter(u=>u.role==='agent')
  const agentRows = agents.map(a=>{
    const myLeads = leads.filter(l=>l.assigned_to===a.id)
    const au = authUsers.find(u=>u.id===a.id)
    return { ...a,
      callsToday: callLogs.filter(c=>c.agent_id===a.id&&(c.created_at||'').startsWith(td)).length,
      totalLeads: myLeads.length,
      leadsMonth: myLeads.filter(l=>(l.created_at||'').startsWith(tm)).length,
      interested: myLeads.filter(l=>l.status==='Interested').length,
      callback:   myLeads.filter(l=>l.status==='Callback').length,
      disbursed:  myLeads.filter(l=>l.status==='Disbursed').length,
      lastLogin:  au?.last_sign_in_at||null,
    }
  }).sort((a,b)=>b.callsToday-a.callsToday)

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
        <h2 style={{fontSize:18,fontWeight:700,color:'#111827'}}>Dashboard Overview</h2>
        {onGoToImport && <Btn outline onClick={onGoToImport}>⬆ Import CSV</Btn>}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(155px,1fr))',gap:10,marginBottom:10}}>
        {[{l:'Calls Today',v:callsToday,c:P},{l:'Leads Today',v:leadsToday,c:'#0891b2'},{l:'Leads This Month',v:leadsMonth,c:'#7c3aed'}].map(s=>(
          <Card key={s.l} style={{padding:'16px 18px'}}>
            <div style={{fontSize:26,fontWeight:700,color:s.c,lineHeight:1,marginBottom:4}}>{s.v}</div>
            <div style={{fontSize:12,color:'#6b7280'}}>{s.l}</div>
          </Card>
        ))}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(155px,1fr))',gap:10,marginBottom:10}}>
        {[{l:'Agent Logins Today',v:agentLogT,c:'#d97706'},{l:'Agent Logins Month',v:agentLogM,c:'#059669'},{l:'Total Logins Month',v:totalLogM,c:'#dc2626'}].map(s=>(
          <Card key={s.l} style={{padding:'16px 18px'}}>
            <div style={{fontSize:26,fontWeight:700,color:s.c,lineHeight:1,marginBottom:4}}>{s.v}</div>
            <div style={{fontSize:12,color:'#6b7280'}}>{s.l}</div>
          </Card>
        ))}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:10,marginBottom:20}}>
        {manualStats.map(m=>(
          <Card key={m.key} style={{padding:'16px 18px'}}>
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:6}}>
              <div style={{fontSize:12,color:'#6b7280',fontWeight:500}}>{m.label}</div>
              <button onClick={()=>{setEditKey(m.key);setEditVal(settings[m.key]||'')}} style={{background:'none',border:'none',cursor:'pointer',color:'#9ca3af',fontSize:14,padding:0,lineHeight:1}}>✏</button>
            </div>
            {editKey===m.key?(
              <div style={{display:'flex',gap:6,marginTop:4}}>
                <input style={{...INP,fontSize:14}} value={editVal} onChange={e=>setEditVal(e.target.value)} autoFocus onKeyDown={e=>e.key==='Enter'&&saveManual()}/>
                <Btn small onClick={saveManual} disabled={saving}>{saving?'…':'Save'}</Btn>
              </div>
            ):(
              <div style={{fontSize:26,fontWeight:700,color:P}}>{settings[m.key]||'—'}</div>
            )}
          </Card>
        ))}
      </div>

      <Card style={{marginBottom:20}}>
        <div style={{padding:'14px 20px',borderBottom:'1px solid #e5e7eb',fontWeight:600,fontSize:14}}>Agent Performance — {new Date().toLocaleDateString('en-IN',{month:'long',year:'numeric',timeZone:IST_TZ})}</div>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr>{['Agent','Calls Today','Total Leads','Leads/Month','Interested','Callback','Disbursed','Last Login'].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
            <tbody>
              {agentRows.length===0?(<tr><td colSpan={8} style={{...TD,textAlign:'center',color:'#9ca3af',padding:32}}>No agents</td></tr>)
              :agentRows.map(r=>(
                <tr key={r.id}>
                  <td style={TD}><div style={{fontWeight:500}}>{r.full_name}</div></td>
                  <td style={{...TD,textAlign:'center',fontWeight:700,color:r.callsToday>0?'#15803d':'#6b7280'}}>{r.callsToday}</td>
                  <td style={{...TD,textAlign:'center'}}>{r.totalLeads}</td>
                  <td style={{...TD,textAlign:'center'}}>{r.leadsMonth}</td>
                  <td style={{...TD,textAlign:'center',color:'#7c3aed'}}>{r.interested}</td>
                  <td style={{...TD,textAlign:'center',color:'#d97706'}}>{r.callback}</td>
                  <td style={{...TD,textAlign:'center',color:'#15803d',fontWeight:600}}>{r.disbursed}</td>
                  <td style={{...TD,fontSize:11,color:'#6b7280'}}>{r.lastLogin?new Date(r.lastLogin).toLocaleString('en-IN',{dateStyle:'short',timeStyle:'short',timeZone:IST_TZ}):'—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div style={{padding:'14px 20px',borderBottom:'1px solid #e5e7eb',fontWeight:600,fontSize:14}}>Recent Leads</div>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr>{['Name','Mobile','Status','Loan Amount','Agent'].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
            <tbody>
              {leads.slice(0,10).map(l=>{
                const agent=users.find(u=>u.id===l.assigned_to)
                return(
                  <tr key={l.id}>
                    <td style={TD}>{l.full_name||'—'}</td>
                    <td style={{...TD,color:'#6b7280'}}>{l.mobile||'—'}</td>
                    <td style={TD}><Badge text={l.status||'New'} color={sc(l.status)}/></td>
                    <td style={TD}>{fmtV(l.loan_amount)}</td>
                    <td style={{...TD,color:'#6b7280'}}>{agent?.full_name||'Unassigned'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ─── USERS ───────────────────────────────────────────────────────────────────
function Users({ users, reload, showToast }) {
  const [showForm,setShowForm] = useState(false)
  const [loading,setLoading]   = useState(false)
  const [form,setForm]         = useState({full_name:'',email:'',phone:'',role:'agent'})
  const RC = {agent:P,team_leader:'#7c3aed',manager:'#d97706',admin:'#dc2626'}

  const createUser = async e => {
    e.preventDefault(); setLoading(true)
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${SERVICE_KEY}`,'apikey':SERVICE_KEY},body:JSON.stringify({email:form.email,password:'Capital@123',email_confirm:true})})
      const ud = await res.json()
      if(ud.id){
        await supabase.from('profiles').insert([{id:ud.id,full_name:form.full_name,email:form.email,mobile:form.phone,role:form.role,status:'active'}])
        showToast('User created! Password: Capital@123')
        setForm({full_name:'',email:'',phone:'',role:'agent'}); setShowForm(false); reload()
      } else { showToast('Error: '+JSON.stringify(ud),'error') }
    } catch(err){ showToast('Error: '+err.message,'error') }
    setLoading(false)
  }

  const toggleStatus = async (id,status) => { await supabase.from('profiles').update({status:status==='active'?'inactive':'active'}).eq('id',id); reload() }

  const handleDeleteAgentLeads = async (agent) => {
    const { count } = await supabase.from('leads').select('*',{count:'exact',head:true}).eq('assigned_to', agent.id)
    const confirmed = window.confirm(`Delete ALL ${count} leads assigned to ${agent.full_name}?\n\nThis will permanently delete all their leads, call logs and tasks. This cannot be undone.`)
    if(!confirmed) return
    const confirmed2 = window.confirm(`Final confirmation: Delete all ${count} leads for ${agent.full_name}?`)
    if(!confirmed2) return
    try {
      const { data: agentLeads } = await supabase.from('leads').select('id').eq('assigned_to', agent.id)
      const leadIds = agentLeads?.map(l=>l.id) || []
      if(leadIds.length > 0) {
        for(let i=0; i<leadIds.length; i+=50) {
          const batch = leadIds.slice(i, i+50)
          await supabase.from('calls').delete().in('lead_id', batch)
          await supabase.from('tasks').delete().in('lead_id', batch)
          await supabase.from('loan_obligations').delete().in('lead_id', batch)
          await supabase.from('leads').delete().in('id', batch)
        }
      }
      showToast(`All leads for ${agent.full_name} deleted successfully`)
      reload()
    } catch(e) {
      showToast('Error: '+e.message, 'error')
    }
  }

  const resetPwd = async (id,email) => {
    if(!window.confirm(`Reset password for ${email} to Capital@123?`))return
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`,{method:'PUT',headers:{'Content-Type':'application/json','Authorization':`Bearer ${SERVICE_KEY}`,'apikey':SERVICE_KEY},body:JSON.stringify({password:'Capital@123'})})
    const ud = await res.json()
    ud.id ? showToast('Password reset to Capital@123') : showToast('Error: '+JSON.stringify(ud),'error')
  }

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
        <h2 style={{fontSize:18,fontWeight:700,color:'#111827'}}>User Management</h2>
        <Btn onClick={()=>setShowForm(!showForm)}>{showForm?'Cancel':'+ Add User'}</Btn>
      </div>
      {showForm&&(
        <Card style={{padding:20,marginBottom:16}}>
          <div style={{fontWeight:600,marginBottom:14}}>Create New User</div>
          <form onSubmit={createUser} style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:12}}>
            <div><label style={LBL}>Full Name</label><input required style={INP} value={form.full_name} onChange={e=>setForm({...form,full_name:e.target.value})} placeholder="Full Name"/></div>
            <div><label style={LBL}>Email</label><input required type="email" style={INP} value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="email@example.com"/></div>
            <div><label style={LBL}>Phone</label><input style={INP} value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="Mobile"/></div>
            <div><label style={LBL}>Role</label><select style={SEL} value={form.role} onChange={e=>setForm({...form,role:e.target.value})}><option value="agent">Agent</option><option value="team_leader">Team Leader</option><option value="manager">Manager</option><option value="admin">Admin</option></select></div>
            <div style={{display:'flex',alignItems:'flex-end'}}><Btn disabled={loading}>{loading?'Creating…':'Create User'}</Btn></div>
          </form>
          <div style={{background:'#fffbeb',border:'1px solid #fde68a',borderRadius:8,padding:'8px 12px',marginTop:12,fontSize:12,color:'#92400e'}}>⚠️ Default password: <strong>Capital@123</strong></div>
        </Card>
      )}
      <Card>
        <div style={{padding:'14px 20px',borderBottom:'1px solid #e5e7eb',fontWeight:600}}>All Users ({users.length})</div>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr>{['Name','Email','Phone','Role','Status','Actions'].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
            <tbody>
              {users.map(u=>(
                <tr key={u.id}>
                  <td style={TD}><div style={{fontWeight:500}}>{u.full_name||'—'}</div></td>
                  <td style={{...TD,color:'#6b7280'}}>{u.email||'—'}</td>
                  <td style={{...TD,color:'#6b7280'}}>{u.mobile||'—'}</td>
                  <td style={TD}><Badge text={u.role||'agent'} color={RC[u.role]||P}/></td>
                  <td style={TD}><Badge text={u.status||'active'} color={u.status==='inactive'?'#dc2626':'#15803d'}/></td>
                  <td style={TD}>
                    <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                      <Btn small outline onClick={()=>resetPwd(u.id,u.email)}>Reset Pwd</Btn>
                      <Btn small danger onClick={()=>toggleStatus(u.id,u.status)}>{u.status==='active'?'Deactivate':'Activate'}</Btn>
                      {['agent','team_leader'].includes(u.role)&&(
                        <button onClick={()=>handleDeleteAgentLeads(u)} style={{padding:'5px 10px',fontSize:11,fontWeight:600,borderRadius:6,border:'1px solid #fecaca',background:'#fef2f2',color:'#dc2626',cursor:'pointer'}}>
                          🗑 Delete Leads
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ─── LEADS ───────────────────────────────────────────────────────────────────
function Leads({ leads, users, dispositions, adminUser, adminProfile, reload, showToast }) {
  const [search,setSearch]       = useState('')
  const [statusF,setStatusF]     = useState('All')
  const [dispF,setDispF]         = useState('All')
  const [agentF,setAgentF]       = useState('All')
  const [dateFrom,setDateFrom]   = useState('')
  const [dateTo,setDateTo]       = useState('')
  const [selected,setSelected]   = useState(new Set())
  const [assignTo,setAssignTo]   = useState('')
  const [assigning,setAssigning] = useState(false)
  const [bulkDeleting,setBulkDeleting] = useState(false)
  const [showAssignTypeModal, setShowAssignTypeModal] = useState(false)
  const [assignType, setAssignType] = useState('mirror')

  const agents  = users.filter(u=>['agent','team_leader'].includes(u.role))
  const statuses= ['All',...Array.from(new Set(leads.map(l=>l.status).filter(Boolean)))]
  const dispNames = ['All',...(dispositions.map(d=>d.label).filter(Boolean))]

  const filtered = leads.filter(l=>{
    const q=search.toLowerCase()
    const mQ=!q||(l.full_name||'').toLowerCase().includes(q)||(l.mobile||'').includes(q)
    const mS=statusF==='All'||l.status===statusF
    const mD=dispF==='All'||l.disposition===dispF
    const mA=agentF==='All'||l.assigned_to===agentF
    const mF=!dateFrom||(l.created_at||'')>=dateFrom
    const mT=!dateTo||(l.created_at||'')<=dateTo+'T23:59:59'
    return mQ&&mS&&mD&&mA&&mF&&mT
  })

  const allSel = filtered.length>0&&filtered.every(l=>selected.has(l.id))

  const toggleAll = () => {
    const next=new Set(selected)
    allSel ? filtered.forEach(l=>next.delete(l.id)) : filtered.forEach(l=>next.add(l.id))
    setSelected(next)
  }
  const toggleOne = id => { const next=new Set(selected); next.has(id)?next.delete(id):next.add(id); setSelected(next) }
  const clearFilters = () => { setSearch('');setStatusF('All');setDispF('All');setAgentF('All');setDateFrom('');setDateTo('') }

  const doAssign = async (type) => {
    if(!assignTo||selected.size===0) return
    setAssigning(true)
    try {
      const selLeads = leads.filter(l=>selected.has(l.id))
      const agent = users.find(u=>u.id===assignTo)
      const ids = [...selected]

      if(type === 'mirror') {
        for(const lead of selLeads) {
          const originalAgent = lead.assigned_to
          const currentMirrors = lead.mirror_agents || []
          const newMirrors = [...new Set([...currentMirrors, originalAgent, assignTo].filter(Boolean))]
          const { error } = await supabase.from('leads').update({
            assigned_to: assignTo,
            mirror_agents: newMirrors,
            assignment_type: 'mirror'
          }).eq('id', lead.id)
          if(error) { showToast('Error: '+error.message,'error'); setAssigning(false); return }
        }
      } else {
        for(let i=0;i<ids.length;i+=100) {
          await supabase.from('leads').update({
            assigned_to: assignTo,
            mirror_agents: [],
            assignment_type: 'transfer'
          }).in('id', ids.slice(i,i+100))
        }
      }

      const logEntries = selLeads.map(l => {
        const prev = users.find(u=>u.id===l.assigned_to)
        return {
          lead_id: l.id,
          lead_name: l.full_name||'',
          action: type==='mirror' ? 'Mirror Assigned' : (l.assigned_to ? 'Reassigned' : 'Assigned'),
          assigned_to: assignTo,
          assigned_to_name: agent?.full_name||'',
          assigned_by: adminUser?.id||null,
          assigned_by_name: adminProfile?.full_name||'Admin',
          previous_agent_id: l.assigned_to||null,
          previous_agent_name: prev?.full_name||null
        }
      })
      await supabase.from('activity_log').insert(logEntries)

      showToast(`${ids.length} lead${ids.length>1?'s':''} ${type==='mirror'?'mirrored to':'transferred to'} ${agent?.full_name}`)
      setSelected(new Set())
      setAssignTo('')
      setShowAssignTypeModal(false)
      reload()
    } catch(err) {
      showToast('Error: '+err.message,'error')
    }
    setAssigning(false)
  }

  const handleDeleteLead = async (lead) => {
    const confirmed = window.confirm(`Delete lead "${lead.full_name}" (${lead.mobile})?\n\nThis will also delete all call logs and tasks for this lead. This cannot be undone.`)
    if(!confirmed) return
    try {
      await supabase.from('calls').delete().eq('lead_id', lead.id)
      await supabase.from('tasks').delete().eq('lead_id', lead.id)
      await supabase.from('loan_obligations').delete().eq('lead_id', lead.id)
      await supabase.from('activity_log').delete().eq('lead_id', lead.id)
      await supabase.from('leads').delete().eq('id', lead.id)
      showToast(`Lead "${lead.full_name}" deleted successfully`)
      reload()
    } catch(e) {
      showToast('Error deleting lead: '+e.message, 'error')
    }
  }

  const handleBulkDelete = async () => {
    const ids = [...selected]
    const confirmed = window.confirm(`Permanently delete ${ids.length} selected leads?\n\nThis will also delete all their call logs, tasks and obligations. This cannot be undone.`)
    if(!confirmed) return
    const confirmed2 = window.confirm(`Are you absolutely sure? This will delete ${ids.length} leads permanently.`)
    if(!confirmed2) return
    setBulkDeleting(true)
    try {
      for(let i=0; i<ids.length; i+=50) {
        const batch = ids.slice(i, i+50)
        await supabase.from('calls').delete().in('lead_id', batch)
        await supabase.from('tasks').delete().in('lead_id', batch)
        await supabase.from('loan_obligations').delete().in('lead_id', batch)
        await supabase.from('activity_log').delete().in('lead_id', batch)
        await supabase.from('leads').delete().in('id', batch)
      }
      showToast(`${ids.length} leads deleted successfully`)
      setSelected(new Set())
      reload()
    } catch(e) {
      showToast('Error: '+e.message, 'error')
    } finally {
      setBulkDeleting(false)
    }
  }

  return (
    <div>
      <h2 style={{fontSize:18,fontWeight:700,color:'#111827',marginBottom:16}}>All Leads</h2>

      {/* Filter bar */}
      <Card style={{padding:14,marginBottom:12}}>
        <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'flex-end'}}>
          <div style={{flex:'1 1 200px'}}>
            <label style={LBL}>Search</label>
            <input style={INP} placeholder="Name or mobile…" value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          <div><label style={LBL}>Status</label><select style={SEL} value={statusF} onChange={e=>setStatusF(e.target.value)}>{statuses.map(s=><option key={s}>{s}</option>)}</select></div>
          <div><label style={LBL}>Disposition</label><select style={SEL} value={dispF} onChange={e=>setDispF(e.target.value)}>{dispNames.map(d=><option key={d}>{d}</option>)}</select></div>
          <div><label style={LBL}>Agent</label><select style={SEL} value={agentF} onChange={e=>setAgentF(e.target.value)}><option value="All">All Agents</option>{agents.map(a=><option key={a.id} value={a.id}>{a.full_name}</option>)}</select></div>
          <div><label style={LBL}>From</label><input type="date" style={SEL} value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/></div>
          <div><label style={LBL}>To</label><input type="date" style={SEL} value={dateTo} onChange={e=>setDateTo(e.target.value)}/></div>
          <Btn outline onClick={clearFilters} style={{marginBottom:1}}>Clear</Btn>
        </div>
        <div style={{marginTop:8,fontSize:12,color:'#6b7280'}}>{filtered.length} of {leads.length} leads</div>
      </Card>

      {/* Floating selection bar */}
      {selected.size>0&&(
        <div style={{position:'sticky',top:0,zIndex:50,background:'#0C3A6B',color:'white',padding:'10px 16px',borderRadius:10,marginBottom:12,display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',boxShadow:'0 4px 16px rgba(0,0,0,0.25)'}}>
          <span style={{fontWeight:700,fontSize:14,minWidth:120}}>{selected.size} lead{selected.size>1?'s':''} selected</span>
          <select style={{...SEL,flex:'1 1 180px',minWidth:180}} value={assignTo} onChange={e=>setAssignTo(e.target.value)}>
            <option value="">Select agent to assign…</option>
            {agents.map(a=><option key={a.id} value={a.id}>{a.full_name}</option>)}
          </select>
          <Btn
            onClick={() => { if(!assignTo||selected.size===0) return; setShowAssignTypeModal(true) }}
            disabled={!assignTo||assigning}
            style={{background:assignTo?P:'#374151'}}
          >
            {assigning?'Assigning…':'Assign'}
          </Btn>
          <button onClick={handleBulkDelete} disabled={bulkDeleting} style={{padding:'7px 14px',borderRadius:8,border:'none',background:'#dc2626',color:'white',cursor:'pointer',fontSize:13,fontWeight:600,opacity:bulkDeleting?0.6:1}}>
            {bulkDeleting ? 'Deleting...' : `🗑 Delete ${selected.size} Leads`}
          </button>
          <Btn onClick={()=>setSelected(new Set())} style={{background:'transparent',color:'white',border:'1px solid rgba(255,255,255,0.3)'}}>Clear Selection</Btn>
        </div>
      )}

      <Card>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead>
              <tr>
                <th style={{...TH,width:40}}><input type="checkbox" checked={allSel} onChange={toggleAll} style={{cursor:'pointer'}}/></th>
                {['Name','Mobile','Status','Loan Amount','Source','Assigned To','Also Assigned To','Created','Actions'].map(h=><th key={h} style={TH}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {filtered.map(l=>{
                const agent=users.find(u=>u.id===l.assigned_to)
                const isSel=selected.has(l.id)
                return(
                  <tr key={l.id} style={{background:isSel?'#eff6ff':'white'}}>
                    <td style={TD}><input type="checkbox" checked={isSel} onChange={()=>toggleOne(l.id)} style={{cursor:'pointer'}}/></td>
                    <td style={TD}><div style={{fontWeight:500}}>{l.full_name||'—'}</div></td>
                    <td style={{...TD,color:'#6b7280'}}>{l.mobile||'—'}</td>
                    <td style={TD}><Badge text={l.status||'New'} color={sc(l.status)}/></td>
                    <td style={TD}>{fmtV(l.loan_amount)}</td>
                    <td style={{...TD,color:'#6b7280'}}>{l.source||l.lead_source||'—'}</td>
                    <td style={TD}>{agent?<span style={{fontSize:12,fontWeight:500}}>{agent.full_name}</span>:<span style={{fontSize:12,color:'#9ca3af'}}>Unassigned</span>}</td>
                    <td style={TD}>
                      {(() => {
                        const mirrorAgentNames = (l.mirror_agents||[])
                          .filter(id => id !== l.assigned_to)
                          .map(id => users.find(u=>u.id===id)?.full_name)
                          .filter(Boolean)
                        return mirrorAgentNames.length > 0
                          ? <span style={{fontSize:11,color:'#185FA5'}}>{mirrorAgentNames.join(', ')}</span>
                          : <span style={{fontSize:11,color:'#9ca3af'}}>—</span>
                      })()}
                    </td>
                    <td style={{...TD,fontSize:11,color:'#9ca3af'}}>{l.created_at?new Date(l.created_at).toLocaleDateString('en-IN',{timeZone:IST_TZ}):'—'}</td>
                    <td style={TD}>
                      <button
                        onClick={()=>handleDeleteLead(l)}
                        style={{padding:'4px 10px',fontSize:11,fontWeight:600,borderRadius:6,border:'1px solid #fecaca',background:'#fef2f2',color:'#dc2626',cursor:'pointer',whiteSpace:'nowrap'}}
                      >
                        🗑 Delete
                      </button>
                    </td>
                  </tr>
                )
              })}
              {filtered.length===0&&<tr><td colSpan={10} style={{...TD,textAlign:'center',color:'#9ca3af',padding:32}}>No leads found</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {showAssignTypeModal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:3000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
          <div style={{background:'white',borderRadius:16,width:'100%',maxWidth:480,padding:28,boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
            <div style={{fontSize:17,fontWeight:700,marginBottom:4}}>
              Assign {selected.size} Lead{selected.size>1?'s':''}
            </div>
            <div style={{fontSize:13,color:'#6b7280',marginBottom:20}}>
              To: <strong>{users.find(u=>u.id===assignTo)?.full_name}</strong>
            </div>
            <div style={{fontSize:12,fontWeight:600,color:'#374151',marginBottom:10}}>Choose Assignment Type:</div>

            <div onClick={()=>setAssignType('mirror')} style={{padding:'14px 16px',borderRadius:10,cursor:'pointer',marginBottom:8,border:assignType==='mirror'?'2px solid #185FA5':'2px solid #e5e7eb',background:assignType==='mirror'?'#eff6ff':'white'}}>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4}}>
                <div style={{width:16,height:16,borderRadius:'50%',border:'2px solid #185FA5',background:assignType==='mirror'?'#185FA5':'white',flexShrink:0}}/>
                <div style={{fontWeight:600,fontSize:14}}>Mirror Assignment ✅ Recommended</div>
              </div>
              <div style={{fontSize:12,color:'#6b7280',paddingLeft:26}}>Lead stays with original agent AND also goes to new agent. Both agents see and work on this lead. Original agent is NOT removed.</div>
            </div>

            <div onClick={()=>setAssignType('transfer')} style={{padding:'14px 16px',borderRadius:10,cursor:'pointer',marginBottom:20,border:assignType==='transfer'?'2px solid #dc2626':'2px solid #e5e7eb',background:assignType==='transfer'?'#fef2f2':'white'}}>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4}}>
                <div style={{width:16,height:16,borderRadius:'50%',border:'2px solid #dc2626',background:assignType==='transfer'?'#dc2626':'white',flexShrink:0}}/>
                <div style={{fontWeight:600,fontSize:14}}>Full Transfer ⚠️</div>
              </div>
              <div style={{fontSize:12,color:'#6b7280',paddingLeft:26}}>Lead completely moves to new agent. Original agent loses access permanently.</div>
            </div>

            <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
              <button onClick={()=>setShowAssignTypeModal(false)} style={{padding:'9px 20px',border:'1px solid #e5e7eb',borderRadius:8,background:'white',cursor:'pointer',fontSize:13}}>Cancel</button>
              <button onClick={()=>doAssign(assignType)} disabled={assigning} style={{padding:'9px 20px',borderRadius:8,border:'none',background:assignType==='mirror'?'#185FA5':'#dc2626',color:'white',cursor:'pointer',fontSize:13,fontWeight:600,opacity:assigning?0.6:1}}>
                {assigning?'Assigning...':(assignType==='mirror'?'Mirror Assign':'Transfer Lead')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── REPORTS ─────────────────────────────────────────────────────────────────
function Reports({ leads, users, callLogs, authUsers }) {
  const td=todayStr(), tm=monthStr()
  const agents = users.filter(u=>['agent','team_leader'].includes(u.role))
  const rows = agents.map(a=>{
    const myLeads = leads.filter(l=>l.assigned_to===a.id)
    const au = authUsers.find(u=>u.id===a.id)
    return { ...a,
      callsToday: callLogs.filter(c=>c.agent_id===a.id&&(c.created_at||'').startsWith(td)).length,
      totalLeads: myLeads.length,
      leadsMonth: myLeads.filter(l=>(l.created_at||'').startsWith(tm)).length,
      interested: myLeads.filter(l=>l.status==='Interested').length,
      callback:   myLeads.filter(l=>l.status==='Callback').length,
      disbursed:  myLeads.filter(l=>l.status==='Disbursed').length,
      lastLogin:  au?.last_sign_in_at||null,
    }
  }).sort((a,b)=>b.callsToday-a.callsToday)

  return (
    <div>
      <h2 style={{fontSize:18,fontWeight:700,color:'#111827',marginBottom:16}}>Agent Performance</h2>
      <Card>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr>{['Agent','Calls Today','Total Leads','Leads/Month','Interested','Callback','Disbursed','Last Login'].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.length===0?(<tr><td colSpan={8} style={{...TD,textAlign:'center',color:'#9ca3af',padding:32}}>No agents</td></tr>)
              :rows.map(r=>(
                <tr key={r.id}>
                  <td style={TD}><div style={{fontWeight:500}}>{r.full_name}</div><div style={{fontSize:11,color:'#9ca3af'}}>{r.email}</div></td>
                  <td style={{...TD,textAlign:'center',fontWeight:700,color:r.callsToday>0?'#15803d':'#6b7280'}}>{r.callsToday}</td>
                  <td style={{...TD,textAlign:'center'}}>{r.totalLeads}</td>
                  <td style={{...TD,textAlign:'center'}}>{r.leadsMonth}</td>
                  <td style={{...TD,textAlign:'center',color:'#7c3aed'}}>{r.interested}</td>
                  <td style={{...TD,textAlign:'center',color:'#d97706'}}>{r.callback}</td>
                  <td style={{...TD,textAlign:'center',color:'#15803d',fontWeight:600}}>{r.disbursed}</td>
                  <td style={{...TD,fontSize:11,color:'#6b7280'}}>{r.lastLogin?new Date(r.lastLogin).toLocaleString('en-IN',{dateStyle:'short',timeStyle:'short',timeZone:IST_TZ}):'—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ─── PIPELINE ────────────────────────────────────────────────────────────────
function Pipeline({ leads, users }) {
  const STAGES=['New','Interested','Callback','Login','Approved','Disbursed','Not Interested']
  const [expanded,setExpanded]=useState(null)
  return (
    <div>
      <h2 style={{fontSize:18,fontWeight:700,color:'#111827',marginBottom:16}}>Loan Pipeline</h2>
      <div style={{display:'flex',gap:12,overflowX:'auto',paddingBottom:12}}>
        {STAGES.map(stage=>{
          const sl=leads.filter(l=>l.status===stage)
          const val=sl.reduce((s,l)=>s+(parseFloat(l.loan_amount)||0),0)
          const isExp=expanded===stage
          return(
            <div key={stage} style={{minWidth:175,flex:'0 0 auto',background:'white',borderRadius:12,border:'1px solid #e5e7eb',borderTop:'3px solid '+sc(stage),overflow:'hidden'}}>
              <div onClick={()=>setExpanded(isExp?null:stage)} style={{padding:'14px 16px',cursor:'pointer'}}>
                <div style={{fontWeight:600,fontSize:13,color:'#374151',marginBottom:6}}>{stage}</div>
                <div style={{fontSize:28,fontWeight:700,color:sc(stage),lineHeight:1}}>{sl.length}</div>
                <div style={{fontSize:12,color:'#9ca3af',marginTop:4}}>{fmtV(val)}</div>
                <div style={{fontSize:11,color:P,marginTop:6}}>{isExp?'▲ hide':'▼ show leads'}</div>
              </div>
              {isExp&&(
                <div style={{borderTop:'1px solid #f3f4f6',maxHeight:250,overflowY:'auto'}}>
                  {sl.length===0?<div style={{padding:'12px 16px',color:'#9ca3af',fontSize:13}}>No leads</div>
                  :sl.map(l=>{
                    const agent=users.find(u=>u.id===l.assigned_to)
                    return(
                      <div key={l.id} style={{padding:'10px 16px',borderBottom:'1px solid #f9fafb'}}>
                        <div style={{fontWeight:500,fontSize:13}}>{l.full_name}</div>
                        <div style={{fontSize:12,color:'#9ca3af'}}>{l.mobile} · {fmtV(l.loan_amount)}</div>
                        <div style={{fontSize:11,color:P,marginTop:2}}>{agent?.full_name||'Unassigned'}</div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── ACTIVITY LOG ────────────────────────────────────────────────────────────
const ACTIVITY_LOG_SQL = `CREATE TABLE IF NOT EXISTS activity_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid,
  lead_name text,
  action text,
  assigned_to uuid,
  assigned_to_name text,
  assigned_by uuid,
  assigned_by_name text,
  previous_agent_id uuid,
  previous_agent_name text,
  created_at timestamptz DEFAULT now()
);`

function ActivityLog({ activityLog, users, reload }) {
  const [dateFrom,setDateFrom] = useState('')
  const [dateTo,setDateTo]     = useState('')
  const [agentF,setAgentF]     = useState('All')

  const agents = users.filter(u=>['agent','team_leader'].includes(u.role))
  const filtered = activityLog.filter(a=>{
    const mF=!dateFrom||(a.created_at||'')>=dateFrom
    const mT=!dateTo||(a.created_at||'')<=dateTo+'T23:59:59'
    const mA=agentF==='All'||a.assigned_to===agentF||a.assigned_by===agentF
    return mF&&mT&&mA
  })

  if(activityLog.length===0) return (
    <div>
      <h2 style={{fontSize:18,fontWeight:700,color:'#111827',marginBottom:16}}>Activity Log</h2>
      <Card style={{padding:28,textAlign:'center'}}>
        <div style={{color:'#6b7280',fontSize:13,marginBottom:12}}>No activity log records yet. Create the table in Supabase SQL Editor:</div>
        <pre style={{textAlign:'left',background:'#f9fafb',padding:14,borderRadius:8,fontSize:11,overflowX:'auto',border:'1px solid #e5e7eb'}}>{ACTIVITY_LOG_SQL}</pre>
      </Card>
    </div>
  )

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
        <h2 style={{fontSize:18,fontWeight:700,color:'#111827'}}>Activity Log</h2>
        <Btn outline small onClick={reload}>Refresh</Btn>
      </div>
      <Card style={{padding:14,marginBottom:12}}>
        <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'flex-end'}}>
          <div><label style={LBL}>From</label><input type="date" style={SEL} value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/></div>
          <div><label style={LBL}>To</label><input type="date" style={SEL} value={dateTo} onChange={e=>setDateTo(e.target.value)}/></div>
          <div><label style={LBL}>Agent</label><select style={SEL} value={agentF} onChange={e=>setAgentF(e.target.value)}><option value="All">All Agents</option>{agents.map(a=><option key={a.id} value={a.id}>{a.full_name}</option>)}</select></div>
        </div>
        <div style={{marginTop:8,fontSize:12,color:'#6b7280'}}>{filtered.length} records</div>
      </Card>
      <Card>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr>{['Lead Name','Action','Assigned To','Assigned By','Previous Agent','Date/Time'].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
            <tbody>
              {filtered.length===0?(<tr><td colSpan={6} style={{...TD,textAlign:'center',color:'#9ca3af',padding:32}}>No records in this range</td></tr>)
              :filtered.map(a=>(
                <tr key={a.id}>
                  <td style={TD}><div style={{fontWeight:500}}>{a.lead_name||'—'}</div></td>
                  <td style={TD}><Badge text={a.action||'Assigned'} color={a.action==='Reassigned'?'#d97706':'#15803d'}/></td>
                  <td style={TD}>{a.assigned_to_name||'—'}</td>
                  <td style={TD}>{a.assigned_by_name||'—'}</td>
                  <td style={TD}>{a.previous_agent_name?<span style={{color:'#dc2626',fontSize:12}}>{a.previous_agent_name}</span>:<span style={{color:'#9ca3af',fontSize:12}}>—</span>}</td>
                  <td style={{...TD,fontSize:11,color:'#6b7280'}}>{fmtDt(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ─── CSV IMPORT ──────────────────────────────────────────────────────────────
function CSVImport({ users, onImported, showToast }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState([])
  const [errors, setErrors] = useState([])
  const [importing, setImporting] = useState(false)
  const [assignTo, setAssignTo] = useState('')
  const [imported, setImported] = useState(0)
  const [dragOver, setDragOver] = useState(false)

  const agents = users.filter(u => ['agent','team_leader'].includes(u.role))

  const downloadTemplate = () => {
    const headers = ['City','Loan ID','Contact','Name','Loan Amount','Sheet Name','2nd Owner Name','Date']
    const sample = ['Hyderabad','8015243325','9876543210','Rahul Kumar','500000','Capital Volts','','29/05/2026']
    const csv = [headers.join(','), sample.join(',')].join('\n')
    const a = document.createElement('a')
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)
    a.download = 'leads_template.csv'
    a.click()
  }

  const parseCSV = (text) => {
    text = text.replace(/^﻿/, '')
    const lines = text.split('\n').filter(l => l.trim())
    if (lines.length < 2) return { rows: [], headers: [] }
    const delim = lines[0].includes(';') ? ';' : ','
    const headers = lines[0].split(delim).map(h => h.trim().replace(/^"|"$/g, ''))
    const rows = lines.slice(1).map((line, idx) => {
      const vals = line.split(delim).map(v => v.trim().replace(/^"|"$/g, ''))
      const row = { _row: idx + 2 }
      headers.forEach((h, i) => { row[h] = vals[i] || '' })
      return row
    }).filter(r => Object.entries(r).some(([k, v]) => k !== '_row' && v.trim()))
    return { rows, headers }
  }

  const handleFile = (f) => {
    if (!f) return
    setFile(f)
    setPreview([])
    setErrors([])
    setImported(0)
    const reader = new FileReader()
    reader.onload = (e) => {
      const { rows } = parseCSV(e.target.result)
      const errs = []
      const valid = []
      rows.forEach((row) => {
        const name = row['Name'] || row['name'] || ''
        const mobile = row['Contact'] || row['Contatct'] || row['contact'] || ''
        if (!name.trim()) errs.push(`Row ${row._row}: Name is missing`)
        if (!mobile.trim()) errs.push(`Row ${row._row}: Contact/Mobile is missing`)
        if (mobile && !/^\d{10}$/.test(mobile.replace(/\s/g,''))) {
          errs.push(`Row ${row._row}: Mobile "${mobile}" is not 10 digits`)
        }
        if (name.trim() && mobile.trim()) valid.push(row)
      })
      setErrors(errs)
      setPreview(valid.slice(0, 5))
    }
    reader.readAsText(f, 'UTF-8')
  }

  const handleImport = async () => {
    if (!file) return
    setImporting(true)
    setImported(0)
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const { rows } = parseCSV(e.target.result)
        const valid = rows.filter(row => {
          const name = row['Name'] || row['name'] || ''
          const mobile = row['Contact'] || row['Contatct'] || row['contact'] || ''
          return name.trim() && mobile.trim()
        })
        const leads = valid.map(row => {
          const mobile = (row['Contact'] || row['Contatct'] || row['contact'] || '').replace(/\s/g,'')
          const loanAmt = row['Loan Amount'] || row['loan amount'] || ''
          const loanAmtNum = parseFloat(loanAmt.replace(/[^0-9.]/g,'')) || null
          let createdAt = new Date().toISOString()
          const dateStr = row['Date'] || row['date'] || ''
          if (dateStr) {
            const parts = dateStr.split('/')
            if (parts.length === 3) {
              const d = new Date(`${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`)
              if (!isNaN(d)) createdAt = d.toISOString()
            }
          }
          return {
            full_name: (row['Name'] || row['name'] || '').trim(),
            mobile: mobile,
            city: (row['City'] || row['city'] || '').trim(),
            loan_amount: loanAmtNum,
            application_id: (row['Loan ID'] || row['loan id'] || '').trim() || null,
            source: (row['Sheet Name'] || row['sheet name'] || '').trim() || null,
            company_name: (row['2nd Owner Name'] || row['2nd owner name'] || '').trim() || null,
            status: 'New',
            assigned_to: assignTo || null,
            created_at: createdAt,
          }
        })
        let count = 0
        for (let i = 0; i < leads.length; i += 50) {
          const batch = leads.slice(i, i + 50)
          const { error } = await supabase.from('leads').insert(batch)
          if (error) {
            showToast('Error importing batch: ' + error.message, 'error')
          } else {
            count += batch.length
            setImported(count)
          }
        }
        showToast(`Successfully imported ${count} leads!`)
        setFile(null)
        setPreview([])
        setErrors([])
        if (onImported) onImported()
      } catch (err) {
        showToast('Import failed: ' + err.message, 'error')
      } finally {
        setImporting(false)
      }
    }
    reader.readAsText(file, 'UTF-8')
  }

  return (
    <div>
      <h2 style={{fontSize:18,fontWeight:700,color:'#111827',marginBottom:4}}>Import Leads from CSV</h2>
      <p style={{fontSize:13,color:'#6b7280',marginBottom:20}}>Upload a CSV file with lead data. Download the template to get started.</p>

      <div style={{marginBottom:20}}>
        <Btn outline onClick={downloadTemplate}>
          ⬇ Download CSV Template
        </Btn>
        <span style={{fontSize:12,color:'#9ca3af',marginLeft:12}}>
          Columns: City, Loan ID, Contact, Name, Loan Amount, Sheet Name, 2nd Owner Name, Date
        </span>
      </div>

      <div style={{marginBottom:16}}>
        <label style={LBL}>Assign imported leads to agent (optional)</label>
        <select style={{...SEL, minWidth:220}} value={assignTo} onChange={e=>setAssignTo(e.target.value)}>
          <option value="">— Unassigned —</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
        </select>
      </div>

      <div
        onDragOver={e=>{e.preventDefault();setDragOver(true)}}
        onDragLeave={()=>setDragOver(false)}
        onDrop={e=>{e.preventDefault();setDragOver(false);handleFile(e.dataTransfer.files[0])}}
        onClick={()=>document.getElementById('csv-import-input').click()}
        style={{
          border:`2px dashed ${dragOver?'#185FA5':'#d1d5db'}`,
          borderRadius:12, padding:'36px 24px', textAlign:'center',
          cursor:'pointer', background:dragOver?'#eff6ff':'#fafafa',
          transition:'all 0.2s', marginBottom:16
        }}
      >
        <div style={{fontSize:36,marginBottom:8}}>📂</div>
        <div style={{fontSize:15,fontWeight:600,color:'#374151',marginBottom:4}}>
          {file ? file.name : 'Drop CSV file here or click to browse'}
        </div>
        <div style={{fontSize:12,color:'#9ca3af'}}>
          {file ? `${(file.size/1024).toFixed(1)} KB` : 'Supports .csv files'}
        </div>
      </div>
      <input
        id="csv-import-input" type="file" accept=".csv"
        style={{display:'none'}}
        onChange={e=>handleFile(e.target.files[0])}
      />

      {errors.length > 0 && (
        <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:10,padding:'12px 16px',marginBottom:16}}>
          <div style={{fontWeight:600,color:'#dc2626',fontSize:13,marginBottom:6}}>
            {errors.length} issue{errors.length>1?'s':''} found (these rows will be skipped):
          </div>
          {errors.slice(0,5).map((e,i) => (
            <div key={i} style={{fontSize:12,color:'#dc2626',marginBottom:2}}>• {e}</div>
          ))}
          {errors.length > 5 && <div style={{fontSize:12,color:'#dc2626'}}>...and {errors.length-5} more</div>}
        </div>
      )}

      {preview.length > 0 && (
        <div style={{marginBottom:16}}>
          <div style={{fontWeight:600,fontSize:13,color:'#374151',marginBottom:8}}>
            Preview (first {preview.length} rows):
          </div>
          <div style={{overflowX:'auto',borderRadius:10,border:'1px solid #e5e7eb'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead>
                <tr>
                  {['Name','Mobile','City','Loan Amount','Loan ID','Source'].map(h=>(
                    <th key={h} style={{...TH,fontSize:11}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row,i)=>(
                  <tr key={i}>
                    <td style={TD}>{row['Name']||row['name']||'—'}</td>
                    <td style={TD}>{row['Contact']||row['Contatct']||row['contact']||'—'}</td>
                    <td style={TD}>{row['City']||row['city']||'—'}</td>
                    <td style={TD}>{row['Loan Amount']||row['loan amount']||'—'}</td>
                    <td style={TD}>{row['Loan ID']||row['loan id']||'—'}</td>
                    <td style={TD}>{row['Sheet Name']||row['sheet name']||'—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {file && (
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <Btn onClick={handleImport} disabled={importing}>
            {importing ? `Importing... (${imported} done)` : `Import Leads`}
          </Btn>
          <Btn outline onClick={()=>{setFile(null);setPreview([]);setErrors([]);setImported(0)}}>
            Clear
          </Btn>
          {imported > 0 && (
            <span style={{fontSize:13,color:'#16a34a',fontWeight:600}}>
              {imported} leads imported successfully!
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ─── DUPLICATE LEADS FINDER ──────────────────────────────────────────────────
function DuplicateLeadsFinder({ leads, reload, showToast }) {
  const [duplicates, setDuplicates] = useState([])
  const [finding, setFinding]       = useState(false)
  const [deleting, setDeleting]     = useState(false)

  const findDuplicates = () => {
    setFinding(true)
    const mobileMap = {}
    leads.forEach(lead => {
      const mobile = lead.mobile?.replace(/\s/g,'')
      if(!mobile) return
      if(!mobileMap[mobile]) mobileMap[mobile] = []
      mobileMap[mobile].push(lead)
    })
    const dups = Object.entries(mobileMap)
      .filter(([,ls]) => ls.length > 1)
      .map(([mobile, ls]) => ({ mobile, leads: ls.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)) }))
    setDuplicates(dups)
    setFinding(false)
    if(dups.length === 0) showToast('No duplicates found!')
  }

  const deleteOlderDuplicates = async () => {
    const toDelete = duplicates.flatMap(d => d.leads.slice(1).map(l=>l.id))
    if(toDelete.length === 0) return
    const confirmed = window.confirm(`Delete ${toDelete.length} duplicate leads? This keeps the most recent lead for each mobile number.`)
    if(!confirmed) return
    setDeleting(true)
    try {
      for(let i=0; i<toDelete.length; i+=50) {
        const batch = toDelete.slice(i, i+50)
        await supabase.from('calls').delete().in('lead_id', batch)
        await supabase.from('tasks').delete().in('lead_id', batch)
        await supabase.from('loan_obligations').delete().in('lead_id', batch)
        await supabase.from('leads').delete().in('id', batch)
      }
      showToast(`${toDelete.length} duplicate leads deleted`)
      setDuplicates([])
      reload()
    } catch(e) {
      showToast('Error: '+e.message, 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <div style={{display:'flex',gap:10,marginBottom:16}}>
        <button onClick={findDuplicates} disabled={finding} style={{padding:'8px 18px',background:'#185FA5',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:600}}>
          {finding ? 'Finding...' : '🔍 Find Duplicates'}
        </button>
        {duplicates.length > 0 && (
          <button onClick={deleteOlderDuplicates} disabled={deleting} style={{padding:'8px 18px',background:'#dc2626',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:600,opacity:deleting?0.6:1}}>
            {deleting ? 'Deleting...' : `🗑 Delete ${duplicates.flatMap(d=>d.leads.slice(1)).length} Duplicates`}
          </button>
        )}
      </div>
      {duplicates.length > 0 && (
        <div>
          <div style={{fontSize:13,fontWeight:600,color:'#dc2626',marginBottom:10}}>
            Found {duplicates.length} mobile numbers with duplicates:
          </div>
          <div style={{maxHeight:300,overflowY:'auto',border:'1px solid #e5e7eb',borderRadius:8}}>
            {duplicates.map((dup,i) => (
              <div key={i} style={{padding:'10px 14px',borderBottom:'1px solid #f3f4f6'}}>
                <div style={{fontWeight:600,fontSize:13,marginBottom:6}}>📱 {dup.mobile} — {dup.leads.length} duplicates</div>
                {dup.leads.map((lead,j) => (
                  <div key={lead.id} style={{fontSize:12,color:j===0?'#16a34a':'#dc2626',display:'flex',gap:8,alignItems:'center',marginBottom:2}}>
                    <span>{j===0?'✅ Keep:':'🗑 Delete:'}</span>
                    <span>{lead.full_name}</span>
                    <span style={{color:'#9ca3af'}}>{new Date(lead.created_at).toLocaleDateString('en-IN',{timeZone:IST_TZ})}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── CONFIG ──────────────────────────────────────────────────────────────────
function Config({ users, onImported, showToast, leads, reload }) {
  const [sources,setSources]     = useState([])
  const [newSource,setNewSource] = useState('')
  const [saving,setSaving]       = useState(false)

  useEffect(()=>{ loadSources() },[])
  const loadSources = async () => { const{data}=await supabase.from('lead_sources').select('*').order('name'); if(data)setSources(data) }
  const addSource   = async () => { if(!newSource.trim())return; setSaving(true); await supabase.from('lead_sources').insert([{name:newSource.trim()}]); setNewSource(''); setSaving(false); loadSources() }
  const delSource   = async id  => { if(!window.confirm('Delete?'))return; await supabase.from('lead_sources').delete().eq('id',id); loadSources() }

  return (
    <div>
      <h2 style={{fontSize:18,fontWeight:700,color:'#111827',marginBottom:16}}>Configuration</h2>
      <Card style={{padding:20,marginBottom:20}}>
        <CSVImport users={users||[]} onImported={onImported} showToast={showToast} />
      </Card>
      <Card style={{padding:20,marginBottom:16}}>
        <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>🔍 Find Duplicate Leads</div>
        <div style={{fontSize:13,color:'#6b7280',marginBottom:16}}>Find leads with the same mobile number and delete duplicates keeping only the latest one.</div>
        <DuplicateLeadsFinder leads={leads||[]} reload={reload||(() => {})} showToast={showToast}/>
      </Card>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:20}}>
        <Card style={{padding:20}}>
          <div style={{fontWeight:600,marginBottom:14}}>Lead Sources</div>
          <div style={{display:'flex',gap:8,marginBottom:12}}>
            <input style={{...INP,flex:1}} placeholder="New source name" value={newSource} onChange={e=>setNewSource(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addSource()}/>
            <Btn onClick={addSource} disabled={saving}>Add</Btn>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {sources.map(s=>(
              <div key={s.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 12px',background:'#f9fafb',borderRadius:8}}>
                <span style={{fontSize:13}}>{s.name}</span>
                <Btn small danger onClick={()=>delSource(s.id)}>Delete</Btn>
              </div>
            ))}
            {sources.length===0&&<div style={{color:'#9ca3af',fontSize:13}}>No sources yet</div>}
          </div>
        </Card>
      </div>
    </div>
  )
}
// ─── EXPORT MODAL ────────────────────────────────────────────────────────────
const ALL_COLS = ['Lead Name','Mobile','Email','City','Loan Amount','Status','Disposition','Source','Assigned To','Assigned Date','Call Count','Last Call Date','Notes','Created Date','Monthly Salary','Company Name','FOIR%','Eligible Loan Amount','Total EMI','Outstanding Amount','All Obligations','Call History']

function ExportModal({ leads, users, dispositions, onClose }) {
  const [whoMode,setWhoMode]   = useState('all')
  const [whoAgent,setWhoAgent] = useState('')
  const [dateMode,setDateMode] = useState('all')
  const [dateFrom,setDateFrom] = useState('')
  const [dateTo,setDateTo]     = useState('')
  const [statusF,setStatusF]   = useState('All')
  const [dispF,setDispF]       = useState('All')
  const [agentF,setAgentF]     = useState('All')
  const [cols,setCols]         = useState(new Set(ALL_COLS))
  const [filename,setFilename] = useState('leads_export_'+new Date().toLocaleDateString('en-IN',{timeZone:IST_TZ}).replace(/\//g,'-'))
  const [exporting,setExporting] = useState(false)

  const agents  = users.filter(u=>['agent','team_leader'].includes(u.role))
  const statuses= ['All',...Array.from(new Set(leads.map(l=>l.status).filter(Boolean)))]
  const disps   = Array.from(new Set(leads.map(l=>l.disposition).filter(Boolean)))
  const toggleCol = c => { const next=new Set(cols); next.has(c)?next.delete(c):next.add(c); setCols(next) }

  const getRange = () => {
    const td=new Date().toISOString().split('T')[0]
    if(dateMode==='today') return {from:td,to:td}
    if(dateMode==='week'){const d=new Date();d.setDate(d.getDate()-7);return{from:d.toISOString().split('T')[0],to:td}}
    if(dateMode==='month'){const d=new Date();return{from:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`,to:td}}
    if(dateMode==='custom') return{from:dateFrom,to:dateTo}
    return{from:'',to:''}
  }

  const getFiltered = () => {
    const {from,to}=getRange()
    return leads.filter(l=>{
      const mW=whoMode==='all'||l.assigned_to===whoAgent
      const mS=statusF==='All'||l.status===statusF
      const mD=dispF==='All'||l.disposition===dispF
      const mA=agentF==='All'||l.assigned_to===agentF
      const mF=!from||(l.created_at||'')>=from
      const mT=!to||(l.created_at||'')<=to+'T23:59:59'
      return mW&&mS&&mD&&mA&&mF&&mT
    })
  }

  const filteredLeads = getFiltered()

  const doExport = async () => {
    setExporting(true)
    try {
      const fl = filteredLeads
      if(!fl.length){alert('No leads to export');setExporting(false);return}
      const ids = fl.map(l=>l.id)
      let callMap={}, oblMap={}
      if(cols.has('Call Count')||cols.has('Last Call Date')||cols.has('Call History')){
        const{data}=await supabase.from('calls').select('*').in('lead_id',ids)
        ;(data||[]).forEach(c=>{if(!callMap[c.lead_id])callMap[c.lead_id]=[];callMap[c.lead_id].push(c)})
      }
      if(cols.has('All Obligations')){
        const{data}=await supabase.from('loan_obligations').select('*').in('lead_id',ids).catch(()=>({data:[]}))
        ;(data||[]).forEach(o=>{if(!oblMap[o.lead_id])oblMap[o.lead_id]=[];oblMap[o.lead_id].push(o)})
      }
      const headers=ALL_COLS.filter(c=>cols.has(c))
      const rows=[]
      for(const l of fl){
        const agent=users.find(u=>u.id===l.assigned_to)
        const calls=(callMap[l.id]||[]).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))
        const obls=oblMap[l.id]||[]
        const lastCall=calls[0]
        const getV = col => {
          switch(col){
            case 'Lead Name': return l.full_name||''
            case 'Mobile': return l.mobile||''
            case 'Email': return l.email||''
            case 'City': return l.city||''
            case 'Loan Amount': return l.loan_amount||''
            case 'Status': return l.status||''
            case 'Disposition': return l.disposition||''
            case 'Source': return l.source||l.lead_source||''
            case 'Assigned To': return agent?.full_name||'Unassigned'
            case 'Assigned Date': return l.assigned_at||''
            case 'Call Count': return calls.length
            case 'Last Call Date': return lastCall?new Date(lastCall.created_at).toLocaleDateString('en-IN',{timeZone:IST_TZ}):''
            case 'Notes': return l.notes||''
            case 'Created Date': return l.created_at?new Date(l.created_at).toLocaleDateString('en-IN',{timeZone:IST_TZ}):''
            case 'Monthly Salary': return l.monthly_salary||''
            case 'Company Name': return l.company_name||''
            case 'FOIR%': return l.foir||''
            case 'Eligible Loan Amount': return l.eligible_loan_amount||''
            case 'Total EMI': return l.total_emi||''
            case 'Outstanding Amount': return l.outstanding_amount||''
            case 'Call History': return calls.map(c=>`${new Date(c.created_at).toLocaleDateString('en-IN',{timeZone:IST_TZ})}: ${c.call_status||''} ${c.call_outcome||''}`).join(' | ')
            case 'All Obligations': return obls.length?JSON.stringify(obls):''
            default: return ''
          }
        }
        if(cols.has('All Obligations')&&obls.length>1){
          for(const obl of obls){
            rows.push(headers.map(c=>c==='All Obligations'?JSON.stringify(obl):getV(c)))
          }
        } else {
          rows.push(headers.map(getV))
        }
      }
      const esc=v=>{const s=String(v);return s.includes(',')||s.includes('"')||s.includes('\n')?`"${s.replace(/"/g,'""')}"`  :s}
      const csv=[headers.map(esc).join(','),...rows.map(r=>r.map(esc).join(','))].join('\n')
      const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download=(filename||'leads_export')+'.csv';a.click()
    } catch(err){ alert('Export error: '+err.message) }
    setExporting(false)
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <div style={{background:'white',borderRadius:16,width:'100%',maxWidth:660,maxHeight:'90vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
        <div style={{padding:'16px 24px',borderBottom:'1px solid #e5e7eb',display:'flex',alignItems:'center',justifyContent:'space-between',position:'sticky',top:0,background:'white',zIndex:1}}>
          <div style={{fontWeight:700,fontSize:16}}>Export Leads</div>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',fontSize:20,color:'#6b7280',lineHeight:1}}>✕</button>
        </div>
        <div style={{padding:24}}>
          {/* WHO */}
          <div style={{marginBottom:18}}>
            <div style={{fontWeight:600,fontSize:12,color:'#374151',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:8}}>1 · Who</div>
            <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
              {[['all','All Agents'],['agent','Specific Agent']].map(([v,l])=>(
                <label key={v} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:13}}><input type="radio" checked={whoMode===v} onChange={()=>setWhoMode(v)}/>{l}</label>
              ))}
            </div>
            {whoMode==='agent'&&<select style={{...SEL,width:'100%',marginTop:10}} value={whoAgent} onChange={e=>setWhoAgent(e.target.value)}><option value="">Select agent…</option>{agents.map(a=><option key={a.id} value={a.id}>{a.full_name}</option>)}</select>}
          </div>
          {/* DATE */}
          <div style={{marginBottom:18}}>
            <div style={{fontWeight:600,fontSize:12,color:'#374151',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:8}}>2 · Date Range</div>
            <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
              {[['all','All Time'],['today','Today'],['week','This Week'],['month','This Month'],['custom','Custom']].map(([v,l])=>(
                <label key={v} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:13}}><input type="radio" checked={dateMode===v} onChange={()=>setDateMode(v)}/>{l}</label>
              ))}
            </div>
            {dateMode==='custom'&&<div style={{display:'flex',gap:10,marginTop:10}}><div style={{flex:1}}><label style={LBL}>Start</label><input type="date" style={INP} value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/></div><div style={{flex:1}}><label style={LBL}>End</label><input type="date" style={INP} value={dateTo} onChange={e=>setDateTo(e.target.value)}/></div></div>}
          </div>
          {/* FILTERS */}
          <div style={{marginBottom:18}}>
            <div style={{fontWeight:600,fontSize:12,color:'#374151',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:8}}>3 · Filters</div>
            <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
              <select style={SEL} value={statusF} onChange={e=>setStatusF(e.target.value)}>{statuses.map(s=><option key={s}>{s}</option>)}</select>
              <select style={SEL} value={dispF} onChange={e=>setDispF(e.target.value)}><option value="All">All Dispositions</option>{disps.map(d=><option key={d}>{d}</option>)}</select>
              <select style={SEL} value={agentF} onChange={e=>setAgentF(e.target.value)}><option value="All">All Agents</option>{agents.map(a=><option key={a.id} value={a.id}>{a.full_name}</option>)}</select>
            </div>
          </div>
          {/* COLUMNS */}
          <div style={{marginBottom:18}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
              <div style={{fontWeight:600,fontSize:12,color:'#374151',textTransform:'uppercase',letterSpacing:'0.5px'}}>4 · Columns</div>
              <div style={{display:'flex',gap:10}}>
                <button onClick={()=>setCols(new Set(ALL_COLS))} style={{fontSize:11,color:P,background:'none',border:'none',cursor:'pointer',fontWeight:600}}>All</button>
                <button onClick={()=>setCols(new Set())} style={{fontSize:11,color:'#dc2626',background:'none',border:'none',cursor:'pointer',fontWeight:600}}>None</button>
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(170px,1fr))',gap:6}}>
              {ALL_COLS.map(c=>(
                <label key={c} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:12,color:'#374151'}}>
                  <input type="checkbox" checked={cols.has(c)} onChange={()=>toggleCol(c)}/>{c}
                </label>
              ))}
            </div>
          </div>
          {/* FILENAME */}
          <div style={{marginBottom:20}}>
            <div style={{fontWeight:600,fontSize:12,color:'#374151',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:8}}>5 · Filename</div>
            <input style={INP} value={filename} onChange={e=>setFilename(e.target.value)} placeholder="leads_export"/>
            <div style={{fontSize:11,color:'#9ca3af',marginTop:4}}>Downloads as {filename||'leads_export'}.csv</div>
          </div>
          <Btn onClick={doExport} disabled={exporting} style={{width:'100%',justifyContent:'center',padding:'12px 20px',fontSize:14}}>
            {exporting?'Exporting…':`Export ${filteredLeads.length} Lead${filteredLeads.length!==1?'s':''}`}
          </Btn>
        </div>
      </div>
    </div>
  )
}

// ─── LEAD STAGES ─────────────────────────────────────────────────────────────
function LeadStages({ showToast }) {
  const [stages,   setStages]   = useState([])
  const [newName,  setNewName]  = useState('')
  const [newColor, setNewColor] = useState('#3b82f6')
  const [saving,   setSaving]   = useState(false)

  useEffect(() => { loadStages() }, [])

  const loadStages = async () => {
    const { data } = await supabase.from('lead_stages').select('*').order('order_index')
    if (data) setStages(data)
  }

  const addStage = async () => {
    if (!newName.trim()) return
    setSaving(true)
    const maxOrder = stages.length > 0 ? Math.max(...stages.map(s => s.order_index)) : 0
    const { error } = await supabase.from('lead_stages').insert([{ name: newName.trim(), color: newColor, order_index: maxOrder + 1 }])
    if (error) { showToast('Error: ' + error.message, 'error'); setSaving(false); return }
    setNewName(''); setNewColor('#3b82f6'); setSaving(false)
    loadStages(); showToast('Stage added')
  }

  const toggleActive = async (id, current) => {
    await supabase.from('lead_stages').update({ is_active: !current }).eq('id', id)
    setStages(prev => prev.map(s => s.id === id ? { ...s, is_active: !current } : s))
    showToast(current ? 'Stage deactivated' : 'Stage activated')
  }

  const deleteStage = async (id, name) => {
    if (!window.confirm(`Delete stage "${name}"? This cannot be undone.`)) return
    await supabase.from('lead_stages').delete().eq('id', id)
    loadStages(); showToast('Stage deleted')
  }

  const moveStage = async (id, dir) => {
    const idx = stages.findIndex(s => s.id === id)
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= stages.length) return
    const a = stages[idx], b = stages[swapIdx]
    await Promise.all([
      supabase.from('lead_stages').update({ order_index: b.order_index }).eq('id', a.id),
      supabase.from('lead_stages').update({ order_index: a.order_index }).eq('id', b.id),
    ])
    loadStages()
  }

  const updateColor = async (id, color) => {
    await supabase.from('lead_stages').update({ color }).eq('id', id)
    setStages(prev => prev.map(s => s.id === id ? { ...s, color } : s))
  }

  const updateName = async (id, name) => {
    if (!name.trim()) return
    await supabase.from('lead_stages').update({ name: name.trim() }).eq('id', id)
    setStages(prev => prev.map(s => s.id === id ? { ...s, name: name.trim() } : s))
    showToast('Name updated')
  }

  return (
    <div>
      <h2 style={{fontSize:18,fontWeight:700,color:'#111827',marginBottom:4}}>Lead Stages</h2>
      <p style={{fontSize:13,color:'#6b7280',marginBottom:20}}>Manage lead stages across the CRM. Active stages appear in all dropdowns. Click a color swatch to change it.</p>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:20}}>

        {/* ── Stage list ── */}
        <Card style={{padding:20}}>
          <div style={{fontWeight:600,marginBottom:14,fontSize:14}}>Stages ({stages.length})</div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {stages.length === 0 && <div style={{color:'#9ca3af',fontSize:13}}>No stages found. Add default stages via SQL first.</div>}
            {stages.map((s, i) => (
              <div key={s.id} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',background:'#f9fafb',borderRadius:8,border:'1px solid #e5e7eb'}}>
                {/* Color swatch — click to open native color picker */}
                <label title="Click to change color" style={{cursor:'pointer',flexShrink:0,position:'relative'}}>
                  <div style={{width:22,height:22,borderRadius:5,background:s.color,border:'2px solid rgba(0,0,0,0.12)'}}/>
                  <input type="color" value={s.color} onChange={e=>updateColor(s.id,e.target.value)}
                    style={{position:'absolute',opacity:0,width:0,height:0,pointerEvents:'none'}}/>
                </label>
                {/* Editable name */}
                <input defaultValue={s.name} onBlur={e=>updateName(s.id,e.target.value)} onKeyDown={e=>e.key==='Enter'&&e.target.blur()}
                  style={{flex:1,border:'none',background:'transparent',fontSize:13,fontWeight:500,color:s.is_active?'#111827':'#9ca3af',textDecoration:s.is_active?'none':'line-through',outline:'none',minWidth:0}}/>
                {/* Order arrows */}
                <button onClick={()=>moveStage(s.id,-1)} disabled={i===0}
                  style={{background:'none',border:'none',cursor:i===0?'default':'pointer',color:i===0?'#e5e7eb':'#6b7280',fontSize:13,padding:'0 2px',lineHeight:1}}>▲</button>
                <button onClick={()=>moveStage(s.id,1)} disabled={i===stages.length-1}
                  style={{background:'none',border:'none',cursor:i===stages.length-1?'default':'pointer',color:i===stages.length-1?'#e5e7eb':'#6b7280',fontSize:13,padding:'0 2px',lineHeight:1}}>▼</button>
                {/* Active toggle */}
                <button onClick={()=>toggleActive(s.id,s.is_active)}
                  style={{background:s.is_active?'#dcfce7':'#f3f4f6',border:'none',borderRadius:12,padding:'3px 9px',cursor:'pointer',fontSize:11,fontWeight:600,color:s.is_active?'#15803d':'#6b7280',whiteSpace:'nowrap',flexShrink:0}}>
                  {s.is_active?'Active':'Off'}
                </button>
                {/* Delete */}
                <Btn small danger onClick={()=>deleteStage(s.id,s.name)}>✕</Btn>
              </div>
            ))}
          </div>
        </Card>

        {/* ── Add new stage ── */}
        <Card style={{padding:20}}>
          <div style={{fontWeight:600,marginBottom:14,fontSize:14}}>Add New Stage</div>
          <div style={{marginBottom:12}}>
            <label style={LBL}>Stage Name</label>
            <input style={INP} placeholder="e.g. Under Review" value={newName}
              onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addStage()}/>
          </div>
          <div style={{marginBottom:18}}>
            <label style={LBL}>Badge Color</label>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <input type="color" value={newColor} onChange={e=>setNewColor(e.target.value)}
                style={{width:42,height:38,border:'1px solid #d1d5db',borderRadius:7,cursor:'pointer',padding:2}}/>
              <div style={{padding:'5px 14px',borderRadius:20,background:newColor+'22',color:newColor,fontSize:12,fontWeight:700,border:'1px solid '+newColor+'55'}}>
                {newName||'Preview'}
              </div>
            </div>
          </div>
          <Btn onClick={addStage} disabled={saving||!newName.trim()} style={{width:'100%',justifyContent:'center',padding:'10px 16px'}}>
            {saving?'Adding…':'+ Add Stage'}
          </Btn>

          <div style={{marginTop:20,padding:14,background:'#f0fdf4',borderRadius:8,border:'1px solid #bbf7d0'}}>
            <div style={{fontSize:12,fontWeight:600,color:'#15803d',marginBottom:6}}>SQL to create table</div>
            <pre style={{fontSize:10,color:'#374151',whiteSpace:'pre-wrap',margin:0,lineHeight:1.6,fontFamily:'monospace'}}>
{`CREATE TABLE IF NOT EXISTS lead_stages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  color text DEFAULT '#6b7280',
  order_index integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE lead_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON lead_stages
  FOR ALL USING (true) WITH CHECK (true);
INSERT INTO lead_stages (name,color,order_index) VALUES
('New','#6b7280',1),('Interested','#10b981',2),
('Callback','#f59e0b',3),('Login','#3b82f6',4),
('Approved','#8b5cf6',5),('Disbursed','#059669',6),
('Not Interested','#ef4444',7),('DND','#dc2626',8);`}
            </pre>
          </div>
        </Card>
      </div>
    </div>
  )
}

// ─── BANK STATEMENT ANALYZER ─────────────────────────────────────────────────
function BankStatementAnalyzer() {
  const [file, setFile] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [phase, setPhase] = useState(0)
  const [result, setResult] = useState(null)
  const [behaviour, setBehaviour] = useState(null)
  const [error, setError] = useState(null)

  const steps = ['Uploading statement...', 'Analyzing income & risk...', 'Detecting EMIs & patterns...', 'Checking behaviour patterns...', 'Building report...']

  const toBase64 = f => new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result.split(',')[1])
    r.onerror = rej
    r.readAsDataURL(f)
  })

  const callAPI = async (base64, phaseNum) => {
    const resp = await fetch('/api/analyze-statement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdfBase64: base64, phase: phaseNum })
    })
    const data = await resp.json()
    if (!resp.ok) throw new Error(data.error || 'Server error')
    return data
  }

  const analyze = async () => {
    if (!file) return
    setError(null)
    setResult(null)
    setBehaviour(null)
    setPhase(1)
    try {
      const base64 = await toBase64(file)
      setPhase(2)
      const p1 = await callAPI(base64, 1)
      setPhase(3)
      const p2 = await callAPI(base64, 2)
      setPhase(4)
      const buf = await file.arrayBuffer()
      const b = await analyzeBankStatement(buf, p1.summary?.account_holder || '')
      setPhase(5)
      await new Promise(r => setTimeout(r, 400))
      setResult({ ...p1, ...p2, all_transactions: [] })
      setBehaviour(b)
      setPhase(0)
    } catch (e) {
      setError(e.message)
      setPhase(0)
    }
  }

  const reset = () => { setResult(null); setBehaviour(null); setFile(null); setPhase(0); setError(null) }

  const downloadCSV = () => {
    if (!result?.all_transactions?.length) return
    const headers = ['Date', 'Description', 'Debit', 'Credit', 'Balance', 'Category', 'Flag']
    const rows = result.all_transactions.map(t => [
      t.date, `"${(t.description || '').replace(/"/g, '')}"`,
      t.debit || 0, t.credit || 0, t.balance || 0, t.category || '', t.flag || ''
    ])
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `bsa_${result.summary?.account_holder?.replace(/\s/g,'_') || Date.now()}.csv`
    a.click()
  }

  const RC = r => r === 'HIGH' ? '#dc2626' : r === 'MEDIUM' ? '#d97706' : '#16a34a'
  const SC = s => s === 'HIGH' ? { bg: '#fef2f2', tc: '#dc2626' } : s === 'MEDIUM' ? { bg: '#fffbeb', tc: '#d97706' } : { bg: '#f0fdf4', tc: '#16a34a' }
  const CC = c => ['BOUNCE','ECS_RETURN','CC_FUNDING','GAMBLING'].includes(c) ? '#fef2f2' : ['SALARY','GST','INSURANCE'].includes(c) ? '#f0fdf4' : ['EMI','NACH','ECS'].includes(c) ? '#fffbeb' : 'transparent'

  const BSABadge = ({ text, bg, tc }) => (
    <span style={{ display:'inline-block', fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:20, background:bg, color:tc, letterSpacing:'0.03em' }}>{text}</span>
  )

  const SCard = ({ label, value, color, icon }) => (
    <div style={{ background:'#f9fafb', borderRadius:10, padding:'14px 16px', border:'1px solid #f0f0f0' }}>
      <div style={{ fontSize:11, color:'#9ca3af', marginBottom:6, display:'flex', alignItems:'center', gap:5 }}>{icon && <span>{icon}</span>}{label}</div>
      <div style={{ fontSize:18, fontWeight:700, color: color || '#111827' }}>{value}</div>
    </div>
  )

  const bTH = { padding:'10px 14px', fontSize:11, fontWeight:600, color:'#6b7280', textAlign:'left', borderBottom:'1px solid #f0f0f0', textTransform:'uppercase', letterSpacing:'0.05em', whiteSpace:'nowrap' }
  const bTD = { padding:'10px 14px', fontSize:12, color:'#374151', borderBottom:'1px solid #f9fafb', verticalAlign:'top' }

  const Section = ({ title, icon, color, count, children }) => (
    <div style={{ background:'white', borderRadius:12, border:'1px solid #f0f0f0', marginBottom:14, overflow:'hidden', boxShadow:'0 1px 3px rgba(0,0,0,0.04)' }}>
      <div style={{ padding:'13px 18px', borderBottom:'1px solid #f0f0f0', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:15 }}>{icon}</span>
          <span style={{ fontSize:13, fontWeight:600, color: color || '#111827' }}>{title}</span>
          {count !== undefined && <span style={{ fontSize:11, background:'#f3f4f6', color:'#6b7280', padding:'1px 8px', borderRadius:20, fontWeight:600 }}>{count}</span>}
        </div>
      </div>
      <div style={{ overflowX:'auto' }}>{children}</div>
    </div>
  )

  if (phase > 0) return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:400, gap:32 }}>
      <div style={{ position:'relative', width:80, height:80 }}>
        <svg width="80" height="80" style={{ transform:'rotate(-90deg)' }}>
          <circle cx="40" cy="40" r="34" fill="none" stroke="#f0f0f0" strokeWidth="6" />
          <circle cx="40" cy="40" r="34" fill="none" stroke={P} strokeWidth="6"
            strokeDasharray={`${(phase/5)*213} 213`} strokeLinecap="round"
            style={{ transition:'stroke-dasharray 0.5s ease' }} />
        </svg>
        <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', fontSize:14, fontWeight:700, color:P }}>{Math.round((phase/5)*100)}%</div>
      </div>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontSize:16, fontWeight:600, color:'#111827', marginBottom:6 }}>{steps[phase-1]}</div>
        <div style={{ fontSize:12, color:'#9ca3af' }}>Step {phase} of 5 — please wait</div>
      </div>
      <div style={{ display:'flex', gap:8 }}>
        {steps.map((s,i) => (
          <div key={i} style={{ width:8, height:8, borderRadius:'50%', background: i < phase ? P : '#e5e7eb', transition:'background 0.3s' }} />
        ))}
      </div>
    </div>
  )

  if (!result) return (
    <div>
      <div style={{ marginBottom:24 }}>
        <h2 style={{ fontSize:20, fontWeight:700, color:'#111827', margin:'0 0 4px' }}>🔍 Bank Statement Analyzer</h2>
        <p style={{ fontSize:13, color:'#6b7280', margin:0 }}>AI-powered credit risk analysis · Upload any Indian bank statement PDF</p>
      </div>
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f?.type==='application/pdf') setFile(f) }}
        onClick={() => document.getElementById('bsa-file-input').click()}
        style={{ border:`2px dashed ${dragOver ? P : '#d1d5db'}`, borderRadius:16, padding:'52px 24px', textAlign:'center', cursor:'pointer', background: dragOver ? '#eff6ff' : '#fafafa', transition:'all 0.2s' }}
      >
        <div style={{ fontSize:48, marginBottom:12 }}>📄</div>
        <div style={{ fontSize:16, fontWeight:600, color:'#374151', marginBottom:6 }}>Drop bank statement PDF here</div>
        <div style={{ fontSize:13, color:'#9ca3af', marginBottom:16 }}>or click to browse · supports all Indian banks</div>
        {file
          ? <div style={{ display:'inline-flex', alignItems:'center', gap:8, background:'#eff6ff', color:P, padding:'8px 16px', borderRadius:20, fontSize:13, fontWeight:500 }}>
              <span>✓</span><span>{file.name}</span>
            </div>
          : <div style={{ display:'inline-flex', alignItems:'center', gap:6, background:'#f3f4f6', color:'#6b7280', padding:'6px 14px', borderRadius:20, fontSize:12 }}>
              PDF only · Max 10MB
            </div>
        }
      </div>
      <input id="bsa-file-input" type="file" accept="application/pdf" style={{ display:'none' }} onChange={e => setFile(e.target.files[0])} />
      {file && (
        <div style={{ marginTop:20, display:'flex', gap:12, justifyContent:'center' }}>
          <Btn onClick={analyze} style={{ padding:'12px 36px', fontSize:14, borderRadius:10 }}>🔍 Analyze Statement</Btn>
          <Btn outline onClick={() => setFile(null)} style={{ padding:'12px 20px', borderRadius:10 }}>Clear</Btn>
        </div>
      )}
      {error && (
        <div style={{ marginTop:16, background:'#fef2f2', border:'1px solid #fecaca', borderRadius:10, padding:'12px 16px', fontSize:13, color:'#dc2626' }}>
          ⚠ {error}
        </div>
      )}
      <div style={{ marginTop:28, display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:12 }}>
        {[
          { icon:'🏦', label:'All Indian banks', sub:'HDFC, SBI, ICICI, Axis...' },
          { icon:'⚡', label:'Fast 2-phase AI', sub:'Results in ~20 seconds' },
          { icon:'🔒', label:'Secure analysis', sub:'Data not stored' },
          { icon:'📊', label:'Full credit report', sub:'Risk, EMI, FOIR & more' },
        ].map(f => (
          <div key={f.label} style={{ background:'white', border:'1px solid #f0f0f0', borderRadius:12, padding:'14px 16px' }}>
            <div style={{ fontSize:24, marginBottom:8 }}>{f.icon}</div>
            <div style={{ fontSize:12, fontWeight:600, color:'#374151', marginBottom:2 }}>{f.label}</div>
            <div style={{ fontSize:11, color:'#9ca3af' }}>{f.sub}</div>
          </div>
        ))}
      </div>
    </div>
  )

  const ca = result.credit_assessment || {}
  const sm = result.summary || {}

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ fontSize:18, fontWeight:700, color:'#111827', margin:'0 0 2px' }}>📋 Analysis Report</h2>
          <div style={{ fontSize:12, color:'#9ca3af' }}>{sm.account_holder} · {sm.bank_name} · {sm.statement_period}</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <Btn small onClick={downloadCSV}>⬇ CSV</Btn>
          <Btn small outline onClick={reset}>← New Analysis</Btn>
        </div>
      </div>

      <div style={{ background:`linear-gradient(135deg, ${RC(ca.overall_risk)}11 0%, white 100%)`, border:`1.5px solid ${RC(ca.overall_risk)}33`, borderLeft:`5px solid ${RC(ca.overall_risk)}`, borderRadius:14, padding:'18px 20px', marginBottom:16 }}>
        <div style={{ display:'flex', flexWrap:'wrap', gap:24, alignItems:'flex-start' }}>
          <div>
            <div style={{ fontSize:10, color:'#9ca3af', fontWeight:600, marginBottom:4, letterSpacing:'0.08em' }}>OVERALL RISK</div>
            <div style={{ fontSize:26, fontWeight:800, color:RC(ca.overall_risk) }}>{ca.overall_risk}</div>
          </div>
          <div>
            <div style={{ fontSize:10, color:'#9ca3af', fontWeight:600, marginBottom:4, letterSpacing:'0.08em' }}>RECOMMENDATION</div>
            <div style={{ fontSize:18, fontWeight:700, color: ca.recommendation==='PROCEED' ? '#16a34a' : ca.recommendation==='CAUTION' ? '#d97706' : '#dc2626' }}>{ca.recommendation}</div>
          </div>
          <div>
            <div style={{ fontSize:10, color:'#9ca3af', fontWeight:600, marginBottom:4, letterSpacing:'0.08em' }}>MONTHLY INCOME</div>
            <div style={{ fontSize:18, fontWeight:700, color:'#111827' }}>₹{(ca.estimated_monthly_income||0).toLocaleString('en-IN')}</div>
          </div>
          <div>
            <div style={{ fontSize:10, color:'#9ca3af', fontWeight:600, marginBottom:4, letterSpacing:'0.08em' }}>EMI BURDEN</div>
            <div style={{ fontSize:18, fontWeight:700, color:'#d97706' }}>₹{(ca.total_emi_burden||0).toLocaleString('en-IN')}</div>
          </div>
          <div>
            <div style={{ fontSize:10, color:'#9ca3af', fontWeight:600, marginBottom:4, letterSpacing:'0.08em' }}>FOIR</div>
            <div style={{ fontSize:18, fontWeight:700, color:'#7c3aed' }}>{ca.foir_estimate||0}%</div>
          </div>
          <div style={{ flex:1, minWidth:200 }}>
            <div style={{ fontSize:10, color:'#9ca3af', fontWeight:600, marginBottom:4, letterSpacing:'0.08em' }}>ANALYST NOTES</div>
            <div style={{ fontSize:12, color:'#374151', lineHeight:1.6 }}>{ca.summary_notes}</div>
          </div>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))', gap:10, marginBottom:16 }}>
        <SCard label="Total Credits" value={'₹'+(sm.total_credits||0).toLocaleString('en-IN')} color="#16a34a" icon="⬆" />
        <SCard label="Total Debits" value={'₹'+(sm.total_debits||0).toLocaleString('en-IN')} color="#dc2626" icon="⬇" />
        <SCard label="Avg Balance" value={'₹'+(sm.average_monthly_balance||0).toLocaleString('en-IN')} color="#2563eb" icon="📊" />
        <SCard label="Risk Flags" value={result.risk_flags?.length||0} color="#dc2626" icon="🚩" />
        <SCard label="EMI Count" value={result.emi_obligations?.length||0} color="#d97706" icon="📋" />
        <SCard label="CC Fundings" value={result.cc_vendor_funding?.length||0} color="#7c3aed" icon="💳" />
      </div>

      {result.risk_flags?.length > 0 && (
        <Section title="Risk Flags" icon="🔴" color="#dc2626" count={result.risk_flags.length}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr><th style={bTH}>Type</th><th style={bTH}>Date</th><th style={bTH}>Description</th><th style={bTH}>Amount</th><th style={bTH}>Severity</th></tr></thead>
            <tbody>{result.risk_flags.map((f,i) => {
              const s = SC(f.severity)
              return <tr key={i} style={{ background: s.bg }}>
                <td style={bTD}><BSABadge text={f.type} bg={s.bg} tc={s.tc} /></td>
                <td style={{ ...bTD, whiteSpace:'nowrap' }}>{f.date}</td>
                <td style={bTD}>{f.description}</td>
                <td style={{ ...bTD, fontWeight:600 }}>₹{(f.amount||0).toLocaleString('en-IN')}</td>
                <td style={bTD}><BSABadge text={f.severity} bg={s.bg} tc={s.tc} /></td>
              </tr>
            })}</tbody>
          </table>
        </Section>
      )}

      {result.cc_vendor_funding?.length > 0 && (
        <Section title="CC / Fintech Vendor Funding" icon="💳" color="#7c3aed" count={result.cc_vendor_funding.length}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr><th style={bTH}>Vendor</th><th style={bTH}>Date</th><th style={bTH}>Description</th><th style={bTH}>Amount</th></tr></thead>
            <tbody>{result.cc_vendor_funding.map((f,i) => (
              <tr key={i} style={{ background:'#faf5ff' }}>
                <td style={bTD}><BSABadge text={f.vendor} bg="#ede9fe" tc="#6d28d9" /></td>
                <td style={{ ...bTD, whiteSpace:'nowrap' }}>{f.date}</td>
                <td style={bTD}>{f.description}</td>
                <td style={{ ...bTD, fontWeight:600, color:'#7c3aed' }}>₹{(f.amount||0).toLocaleString('en-IN')}</td>
              </tr>
            ))}</tbody>
          </table>
        </Section>
      )}

      {result.emi_obligations?.length > 0 && (
        <Section title="EMI & Recurring Obligations" icon="📋" color="#d97706" count={result.emi_obligations.length}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr><th style={bTH}>Party / Lender</th><th style={bTH}>Amount</th><th style={bTH}>Type</th><th style={bTH}>Count</th><th style={bTH}>First Seen</th><th style={bTH}>Last Seen</th></tr></thead>
            <tbody>{result.emi_obligations.map((e,i) => (
              <tr key={i} style={{ background:'#fffbeb' }}>
                <td style={{ ...bTD, fontWeight:500 }}>{e.party}</td>
                <td style={{ ...bTD, fontWeight:700, color:'#d97706' }}>₹{(e.amount||0).toLocaleString('en-IN')}</td>
                <td style={bTD}><BSABadge text={e.type} bg="#fef3c7" tc="#92400e" /></td>
                <td style={bTD}>{e.count}x</td>
                <td style={bTD}>{e.first_seen}</td>
                <td style={bTD}>{e.last_seen}</td>
              </tr>
            ))}</tbody>
          </table>
        </Section>
      )}

      {result.watchlist?.length > 0 && (
        <Section title="Watchlist" icon="🟡" color="#d97706" count={result.watchlist.length}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr><th style={bTH}>Type</th><th style={bTH}>Date</th><th style={bTH}>Description</th><th style={bTH}>Amount</th></tr></thead>
            <tbody>{result.watchlist.map((w,i) => (
              <tr key={i} style={{ background:'#fffbeb' }}>
                <td style={bTD}><BSABadge text={w.type} bg="#fef3c7" tc="#92400e" /></td>
                <td style={{ ...bTD, whiteSpace:'nowrap' }}>{w.date}</td>
                <td style={bTD}>{w.description}</td>
                <td style={{ ...bTD, fontWeight:600 }}>₹{(w.amount||0).toLocaleString('en-IN')}</td>
              </tr>
            ))}</tbody>
          </table>
        </Section>
      )}

      {result.positive_signals?.length > 0 && (
        <Section title="Positive Signals" icon="🟢" color="#16a34a" count={result.positive_signals.length}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr><th style={bTH}>Type</th><th style={bTH}>Date</th><th style={bTH}>Description</th><th style={bTH}>Amount</th></tr></thead>
            <tbody>{result.positive_signals.map((s,i) => (
              <tr key={i} style={{ background:'#f0fdf4' }}>
                <td style={bTD}><BSABadge text={s.type} bg="#dcfce7" tc="#166534" /></td>
                <td style={{ ...bTD, whiteSpace:'nowrap' }}>{s.date}</td>
                <td style={bTD}>{s.description}</td>
                <td style={{ ...bTD, fontWeight:600, color:'#16a34a' }}>₹{(s.amount||0).toLocaleString('en-IN')}</td>
              </tr>
            ))}</tbody>
          </table>
        </Section>
      )}

      {result.repeat_parties?.length > 0 && (
        <Section title="Repeat Transaction Parties" icon="👥" count={result.repeat_parties.length}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr><th style={bTH}>Party</th><th style={bTH}>Total Debit</th><th style={bTH}>Total Credit</th><th style={bTH}>Count</th><th style={bTH}>Status</th></tr></thead>
            <tbody>{result.repeat_parties.map((p,i) => (
              <tr key={i} style={{ background: p.flag==='SUSPICIOUS' ? '#fef2f2' : 'transparent' }}>
                <td style={{ ...bTD, fontWeight:500 }}>{p.party}</td>
                <td style={{ ...bTD, color:'#dc2626' }}>₹{(p.total_debit||0).toLocaleString('en-IN')}</td>
                <td style={{ ...bTD, color:'#16a34a' }}>₹{(p.total_credit||0).toLocaleString('en-IN')}</td>
                <td style={bTD}>{p.transaction_count}x</td>
                <td style={bTD}><BSABadge text={p.flag} bg={p.flag==='SUSPICIOUS'?'#fee2e2':'#dcfce7'} tc={p.flag==='SUSPICIOUS'?'#991b1b':'#166534'} /></td>
              </tr>
            ))}</tbody>
          </table>
        </Section>
      )}

      {result.monthly_cashflow?.length > 0 && (
        <Section title="Month-wise Cash Flow" icon="📈">
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr><th style={bTH}>Month</th><th style={bTH}>Credits</th><th style={bTH}>Debits</th><th style={bTH}>Closing Balance</th><th style={bTH}>Bounces</th></tr></thead>
            <tbody>{result.monthly_cashflow.map((m,i) => (
              <tr key={i} style={{ background: m.bounce_count > 0 ? '#fef2f2' : 'transparent' }}>
                <td style={{ ...bTD, fontWeight:500 }}>{m.month}</td>
                <td style={{ ...bTD, color:'#16a34a', fontWeight:600 }}>₹{(m.total_credit||0).toLocaleString('en-IN')}</td>
                <td style={{ ...bTD, color:'#dc2626', fontWeight:600 }}>₹{(m.total_debit||0).toLocaleString('en-IN')}</td>
                <td style={{ ...bTD, fontWeight:600 }}>₹{(m.closing_balance||0).toLocaleString('en-IN')}</td>
                <td style={bTD}>{m.bounce_count > 0 ? <BSABadge text={m.bounce_count+' bounce(s)'} bg="#fee2e2" tc="#991b1b" /> : <BSABadge text="None" bg="#dcfce7" tc="#166534" />}</td>
              </tr>
            ))}</tbody>
          </table>
        </Section>
      )}

      {behaviour && (
        <div style={{ fontSize:11, color:'#9ca3af', margin:'0 0 14px' }}>Parsed {behaviour.transactionCount} transactions</div>
      )}

      {behaviour?.stock_market_activity?.detected && (
        <Section title="Stock Market Activity" icon="📈" color="#2563eb" count={behaviour.stock_market_activity.transaction_count}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))', gap:10, padding:'14px 18px' }}>
            <SCard label="Transactions" value={behaviour.stock_market_activity.transaction_count||0} color="#2563eb" icon="📈" />
            <SCard label="Invested" value={'₹'+(behaviour.stock_market_activity.total_invested||0).toLocaleString('en-IN')} color="#dc2626" icon="⬇" />
            <SCard label="Withdrawn" value={'₹'+(behaviour.stock_market_activity.total_withdrawn||0).toLocaleString('en-IN')} color="#16a34a" icon="⬆" />
          </div>
          {behaviour.stock_market_activity.transactions?.length > 0 && (
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr><th style={bTH}>Broker</th><th style={bTH}>Date</th><th style={bTH}>Amount</th><th style={bTH}>Direction</th><th style={bTH}>Description</th></tr></thead>
              <tbody>{behaviour.stock_market_activity.transactions.map((t,i) => (
                <tr key={i} style={{ background:'#eff6ff' }}>
                  <td style={{ ...bTD, fontWeight:500 }}>{t.broker}</td>
                  <td style={{ ...bTD, whiteSpace:'nowrap' }}>{t.date}</td>
                  <td style={{ ...bTD, fontWeight:600, color:'#2563eb' }}>₹{(t.amount||0).toLocaleString('en-IN')}</td>
                  <td style={bTD}><BSABadge text={t.direction} bg="#dbeafe" tc="#1d4ed8" /></td>
                  <td style={{ ...bTD, fontSize:11, color:'#6b7280' }}>{t.description}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Section>
      )}

      {behaviour?.cc_card_rotation?.detected && (
        <Section title="Credit Card Rotation (Card-to-Cash)" icon="🔄" color="#dc2626" count={behaviour.cc_card_rotation.transaction_count}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))', gap:10, padding:'14px 18px' }}>
            <SCard label="Instances" value={behaviour.cc_card_rotation.transaction_count||0} color="#dc2626" icon="🔄" />
            <SCard label="Total" value={'₹'+(behaviour.cc_card_rotation.total_amount||0).toLocaleString('en-IN')} color="#dc2626" icon="💸" />
          </div>
          {behaviour.cc_card_rotation.transactions?.length > 0 && (
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr><th style={bTH}>Vendor</th><th style={bTH}>Date</th><th style={bTH}>Amount</th><th style={bTH}>Description</th></tr></thead>
              <tbody>{behaviour.cc_card_rotation.transactions.map((t,i) => (
                <tr key={i} style={{ background:'#fef2f2' }}>
                  <td style={{ ...bTD, fontWeight:500 }}>{t.vendor}</td>
                  <td style={{ ...bTD, whiteSpace:'nowrap' }}>{t.date}</td>
                  <td style={{ ...bTD, fontWeight:600, color:'#dc2626' }}>₹{(t.amount||0).toLocaleString('en-IN')}</td>
                  <td style={{ ...bTD, fontSize:11, color:'#6b7280' }}>{t.description}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Section>
      )}

      {(behaviour?.ecs_returns?.length > 0) && (
        <Section title="ECS / Auto-Debit Returns" icon="⚠️" color="#d97706" count={behaviour.ecs_returns.length}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr><th style={bTH}>Party</th><th style={bTH}>Type</th><th style={bTH}>Return Date</th><th style={bTH}>Return Amt</th><th style={bTH}>Charge Date</th><th style={bTH}>Charge Amt</th></tr></thead>
            <tbody>{behaviour.ecs_returns.map((e,i) => (
              <tr key={i} style={{ background:'#fffbeb' }}>
                <td style={{ ...bTD, fontWeight:500 }}>{e.party}</td>
                <td style={bTD}><BSABadge text={e.return_type} bg="#fef3c7" tc="#92400e" /></td>
                <td style={{ ...bTD, whiteSpace:'nowrap' }}>{e.return_date}</td>
                <td style={{ ...bTD, fontWeight:600, color:'#d97706' }}>₹{(e.return_amount||0).toLocaleString('en-IN')}</td>
                <td style={{ ...bTD, whiteSpace:'nowrap' }}>{e.charge_date}</td>
                <td style={{ ...bTD, fontWeight:600, color:'#dc2626' }}>₹{(e.charge_amount||0).toLocaleString('en-IN')}</td>
              </tr>
            ))}</tbody>
          </table>
        </Section>
      )}

      {behaviour?.small_loan_disbursals?.detected && (
        <Section title="Small / App Loan Disbursals" icon="💰" color="#7c3aed" count={behaviour.small_loan_disbursals.disbursal_count}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))', gap:10, padding:'14px 18px' }}>
            <SCard label="Count" value={behaviour.small_loan_disbursals.disbursal_count||0} color="#7c3aed" icon="💰" />
            <SCard label="Total Disbursed" value={'₹'+(behaviour.small_loan_disbursals.total_disbursed||0).toLocaleString('en-IN')} color="#7c3aed" icon="💸" />
          </div>
          {behaviour.small_loan_disbursals.frequent && (
            <div style={{ padding:'6px 18px 10px' }}>
              <BSABadge text="FREQUENT — possible loan stacking" bg="#fee2e2" tc="#991b1b" />
            </div>
          )}
          {behaviour.small_loan_disbursals.disbursals?.length > 0 && (
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr><th style={bTH}>Lender</th><th style={bTH}>Date</th><th style={bTH}>Amount</th><th style={bTH}>Description</th></tr></thead>
              <tbody>{behaviour.small_loan_disbursals.disbursals.map((t,i) => (
                <tr key={i} style={{ background: behaviour.small_loan_disbursals.frequent ? '#fef2f2' : '#faf5ff' }}>
                  <td style={{ ...bTD, fontWeight:500 }}>{t.lender}</td>
                  <td style={{ ...bTD, whiteSpace:'nowrap' }}>{t.date}</td>
                  <td style={{ ...bTD, fontWeight:600, color:'#7c3aed' }}>₹{(t.amount||0).toLocaleString('en-IN')}</td>
                  <td style={{ ...bTD, fontSize:11, color:'#6b7280' }}>{t.description}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Section>
      )}

      {(behaviour?.wallet_to_bank?.length > 0) && (
        <Section title="Wallet ↔ Bank Transfers" icon="👛" count={behaviour.wallet_to_bank.length}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr><th style={bTH}>Wallet</th><th style={bTH}>Date</th><th style={bTH}>Amount</th><th style={bTH}>Direction</th></tr></thead>
            <tbody>{behaviour.wallet_to_bank.map((t,i) => (
              <tr key={i}>
                <td style={{ ...bTD, fontWeight:500 }}>{t.wallet}</td>
                <td style={{ ...bTD, whiteSpace:'nowrap' }}>{t.date}</td>
                <td style={{ ...bTD, fontWeight:600 }}>₹{(t.amount||0).toLocaleString('en-IN')}</td>
                <td style={bTD}><BSABadge text={t.direction} bg={t.direction==='IN'?'#dcfce7':'#fee2e2'} tc={t.direction==='IN'?'#166534':'#991b1b'} /></td>
              </tr>
            ))}</tbody>
          </table>
        </Section>
      )}

      {(behaviour?.frequent_transfers?.length > 0) && (
        <Section title="Frequent Transfers" icon="🔁" count={behaviour.frequent_transfers.length}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr><th style={bTH}>Beneficiary</th><th style={bTH}>Count</th><th style={bTH}>Total</th><th style={bTH}>First Date</th><th style={bTH}>Last Date</th></tr></thead>
            <tbody>{behaviour.frequent_transfers.map((t,i) => (
              <tr key={i} style={{ background: t.is_self ? '#fef2f2' : 'transparent' }}>
                <td style={{ ...bTD, fontWeight:500 }}>{t.beneficiary}{t.is_self && <> <BSABadge text="SELF" bg="#fee2e2" tc="#991b1b" /></>}</td>
                <td style={bTD}>{t.transfer_count}x</td>
                <td style={{ ...bTD, fontWeight:600 }}>₹{(t.total_amount||0).toLocaleString('en-IN')}</td>
                <td style={{ ...bTD, whiteSpace:'nowrap' }}>{t.first_date}</td>
                <td style={{ ...bTD, whiteSpace:'nowrap' }}>{t.last_date}</td>
              </tr>
            ))}</tbody>
          </table>
        </Section>
      )}

      {(behaviour?.forex_trading?.length > 0) && (
        <Section title="Forex Trading" icon="💱" color="#dc2626" count={behaviour.forex_trading.length}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr><th style={bTH}>Platform</th><th style={bTH}>Date</th><th style={bTH}>Amount</th><th style={bTH}>Direction</th><th style={bTH}>Description</th></tr></thead>
            <tbody>{behaviour.forex_trading.map((t,i) => (
              <tr key={i} style={{ background:'#fef2f2' }}>
                <td style={{ ...bTD, fontWeight:500 }}>{t.platform}</td>
                <td style={{ ...bTD, whiteSpace:'nowrap' }}>{t.date}</td>
                <td style={{ ...bTD, fontWeight:600, color:'#dc2626' }}>₹{(t.amount||0).toLocaleString('en-IN')}</td>
                <td style={bTD}><BSABadge text={t.direction} bg={t.direction==='IN'?'#dcfce7':'#fee2e2'} tc={t.direction==='IN'?'#166534':'#991b1b'} /></td>
                <td style={{ ...bTD, fontSize:11, color:'#6b7280' }}>{t.description}</td>
              </tr>
            ))}</tbody>
          </table>
        </Section>
      )}

      {result.all_transactions?.length > 0 && (
        <Section title={`All Transactions (${result.all_transactions.length})`} icon="📊">
          <div style={{ padding:'8px 18px', borderBottom:'1px solid #f0f0f0', display:'flex', justifyContent:'flex-end' }}>
            <Btn small onClick={downloadCSV}>⬇ Download CSV</Btn>
          </div>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr><th style={bTH}>Date</th><th style={bTH}>Description</th><th style={bTH}>Debit</th><th style={bTH}>Credit</th><th style={bTH}>Balance</th><th style={bTH}>Category</th><th style={bTH}>Flag</th></tr></thead>
            <tbody>{result.all_transactions.map((t,i) => (
              <tr key={i} style={{ background: CC(t.category) }}>
                <td style={{ ...bTD, whiteSpace:'nowrap' }}>{t.date}</td>
                <td style={{ ...bTD, maxWidth:240, fontSize:11 }}>{t.description}</td>
                <td style={{ ...bTD, color:'#dc2626', fontWeight: t.debit ? 600 : 400 }}>{t.debit ? '₹'+t.debit.toLocaleString('en-IN') : '—'}</td>
                <td style={{ ...bTD, color:'#16a34a', fontWeight: t.credit ? 600 : 400 }}>{t.credit ? '₹'+t.credit.toLocaleString('en-IN') : '—'}</td>
                <td style={bTD}>{t.balance ? '₹'+t.balance.toLocaleString('en-IN') : '—'}</td>
                <td style={bTD}><BSABadge text={t.category||'OTHER'} bg={CC(t.category)||'#f3f4f6'} tc={['BOUNCE','ECS_RETURN','CC_FUNDING','GAMBLING'].includes(t.category)?'#991b1b':['SALARY','GST','INSURANCE'].includes(t.category)?'#166534':'#374151'} /></td>
                <td style={bTD}>{t.flag ? <BSABadge text={t.flag} bg="#fee2e2" tc="#991b1b" /> : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </Section>
      )}
    </div>
  )
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function FullAdminPanel() {
  const [active,setActive]           = useState('overview')
  const [users,setUsers]             = useState([])
  const [leads,setLeads]             = useState([])
  const [callLogs,setCallLogs]       = useState([])
  const [dispositions,setDispositions]=useState([])
  const [activityLog,setActivityLog] = useState([])
  const [authUsers,setAuthUsers]     = useState([])
  const [settings,setSettings]       = useState({})
  const [loading,setLoading]         = useState(true)
  const [menuOpen,setMenuOpen]       = useState(false)
  const [toast,setToast]             = useState(null)
  const [adminUser,setAdminUser]     = useState(null)
  const [showExport,setShowExport]   = useState(false)
  const [renderError,setRenderError] = useState(null)
  const [fatalError,setFatalError]   = useState(null)

  useEffect(()=>{
    window.onerror=(msg,src,line,col,err)=>{ setFatalError(msg+' (line '+line+')'); return true }
    return()=>{ window.onerror=null }
  },[])

  useEffect(()=>{ supabase.auth.getSession().then(({data:{session}})=>{ if(session?.user)setAdminUser(session.user) }); fetchData() },[])

  const showToast = (msg,type='success') => { setToast({msg,type}); setTimeout(()=>setToast(null),3500) }

  const fetchData = async () => {
    setLoading(true)
    try {
      const [uR,lR,cR,dR] = await Promise.all([
        supabase.from('profiles').select('*').order('role'),
        supabase.from('leads').select('*').order('created_at',{ascending:false}),
        supabase.from('calls').select('id,agent_id,lead_id,created_at,call_status,call_outcome').order('created_at',{ascending:false}),
        supabase.from('dispositions').select('*').order('sort_order'),
      ])
      setUsers(uR.data||[]);setLeads(lR.data||[]);setCallLogs(cR.data||[]);setDispositions(dR.data||[])

      const aR = await supabase.from('activity_log').select('*').order('created_at',{ascending:false}).limit(500)
      setActivityLog(aR.data||[])

      const sR = await supabase.from('settings').select('key,value')
      if(!sR.error&&sR.data){ const m={}; sR.data.forEach(s=>{m[s.key]=s.value}); setSettings(m) }

      try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`,{headers:{'Authorization':`Bearer ${SERVICE_KEY}`,'apikey':SERVICE_KEY}})
        const data = await res.json()
        setAuthUsers(data.users||[])
      } catch{}
    } catch(err) {
      setRenderError('Failed to load data: '+err.message)
    } finally {
      setLoading(false)
    }
  }

  const saveSetting = async (key,value) => {
    await supabase.from('settings').upsert([{key,value:String(value)}],{onConflict:'key'})
    setSettings(p=>({...p,[key]:String(value)}))
  }

  const isMobile = window.innerWidth < 768
  const adminProfile = users.find(u=>u.id===adminUser?.id)

  const safeRender = (component) => {
    try { return component }
    catch(e) { return <div style={{padding:20,color:'#dc2626',fontSize:13}}>Error in this section: {e.message}</div> }
  }

  if(fatalError) return (
    <div style={{padding:40,textAlign:'center',fontFamily:'sans-serif'}}>
      <div style={{fontSize:20,color:'#dc2626',marginBottom:8}}>Admin Panel Error</div>
      <div style={{fontSize:13,color:'#6b7280',marginBottom:20,maxWidth:400,margin:'0 auto 20px'}}>{fatalError}</div>
      <button onClick={()=>window.location.reload()} style={{padding:'8px 20px',background:'#185FA5',color:'white',border:'none',borderRadius:8,cursor:'pointer'}}>Reload</button>
    </div>
  )

  return (
    <div style={{display:'flex',minHeight:'100vh',background:'#f1f5f9'}}>
      <Toast toast={toast}/>
      {showExport&&<ExportModal leads={leads} users={users} dispositions={dispositions} onClose={()=>setShowExport(false)}/>}

      {isMobile&&menuOpen&&<div onClick={()=>setMenuOpen(false)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:998}}/>}

      {/* Sidebar */}
      {(!isMobile||menuOpen)&&(
        <div style={{width:220,flexShrink:0,background:'#111827',minHeight:'100vh',display:'flex',flexDirection:'column',position:isMobile?'fixed':'sticky',top:0,left:0,height:isMobile?'100vh':'auto',zIndex:isMobile?999:1,overflowY:'auto'}}>
          <div style={{padding:'20px 16px 16px',borderBottom:'1px solid #1f2937'}}>
            <div style={{fontSize:16,fontWeight:700,color:'white'}}>Admin Panel</div>
            <div style={{fontSize:12,color:'#6b7280',marginTop:2}}>Full Access</div>
          </div>
          <nav style={{flex:1,padding:'10px 8px'}}>
            {NAV.map(n=>(
              <button key={n.id} onClick={()=>{setActive(n.id);setMenuOpen(false)}} style={{width:'100%',display:'flex',alignItems:'center',padding:'10px 14px',borderRadius:8,border:'none',cursor:'pointer',textAlign:'left',marginBottom:2,background:active===n.id?P:'transparent',color:active===n.id?'white':'#9ca3af',fontSize:14,fontWeight:active===n.id?600:400,transition:'all 0.15s'}}>
                {n.label}
              </button>
            ))}
            <div style={{margin:'12px 6px 6px',borderTop:'1px solid #1f2937',paddingTop:10}}>
              <div style={{fontSize:10,fontWeight:700,color:'#4b5563',letterSpacing:'0.08em',padding:'0 8px 6px',textTransform:'uppercase'}}>🛠 Tools</div>
              {TOOLS_NAV.map(n=>(
                <button key={n.id} onClick={()=>{setActive(n.id);setMenuOpen(false)}} style={{width:'100%',display:'flex',alignItems:'center',padding:'9px 14px',borderRadius:8,border:'none',cursor:'pointer',textAlign:'left',marginBottom:2,background:active===n.id?P:'transparent',color:active===n.id?'white':'#9ca3af',fontSize:13,fontWeight:active===n.id?600:400,transition:'all 0.15s'}}>
                  {n.label}
                </button>
              ))}
            </div>
          </nav>
          <div style={{padding:'12px 8px',borderBottom:'1px solid #1f2937'}}>
            <button onClick={()=>{setShowExport(true);setMenuOpen(false)}} style={{width:'100%',padding:'9px 14px',borderRadius:8,border:'1px solid #374151',background:'transparent',color:'#9ca3af',fontSize:13,fontWeight:500,cursor:'pointer',textAlign:'left'}}>
              ↓ Export Leads
            </button>
          </div>
          <div style={{padding:'12px 16px'}}>
            <div style={{fontSize:12,color:'#6b7280'}}>{users.length} users · {leads.length} leads</div>
          </div>
        </div>
      )}

      {/* Main */}
      <div style={{flex:1,minWidth:0,overflow:'auto'}}>
        {isMobile&&(
          <div style={{padding:'12px 16px',background:'white',borderBottom:'1px solid #e5e7eb',display:'flex',alignItems:'center',justifyContent:'space-between',position:'sticky',top:0,zIndex:10}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <button onClick={()=>setMenuOpen(true)} style={{background:'none',border:'1px solid #e5e7eb',borderRadius:8,padding:'6px 10px',cursor:'pointer',fontSize:16}}>☰</button>
              <span style={{fontWeight:600,fontSize:15}}>Admin Panel</span>
            </div>
            <Btn small outline onClick={()=>setShowExport(true)}>Export</Btn>
          </div>
        )}
        <div style={{padding:isMobile?14:28}}>
          {renderError?(
            <div style={{padding:40,textAlign:'center'}}>
              <div style={{color:'#dc2626',fontSize:16,fontWeight:600,marginBottom:8}}>Something went wrong</div>
              <div style={{color:'#6b7280',fontSize:13,marginBottom:16}}>{renderError}</div>
              <Btn onClick={()=>{ setRenderError(null); fetchData() }}>Retry</Btn>
            </div>
          ):loading?(
            <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'60vh',color:'#9ca3af',fontSize:14}}>Loading…</div>
          ):(
            <>
              {active==='overview' && (
                <ErrorBoundary>
                  <Overview users={users} leads={leads} callLogs={callLogs} authUsers={authUsers} settings={settings} saveSetting={saveSetting} onGoToImport={()=>setActive('config')}/>
                </ErrorBoundary>
              )}
              {active==='users' && (
                <ErrorBoundary>
                  <Users users={users} reload={fetchData} showToast={showToast}/>
                </ErrorBoundary>
              )}
              {active==='leads' && (
                <ErrorBoundary>
                  <Leads leads={leads} users={users} dispositions={dispositions} adminUser={adminUser} adminProfile={adminProfile} reload={fetchData} showToast={showToast}/>
                </ErrorBoundary>
              )}
              {active==='reports' && (
                <ErrorBoundary>
                  <Reports leads={leads} users={users} callLogs={callLogs} authUsers={authUsers}/>
                </ErrorBoundary>
              )}
              {active==='pipeline' && (
                <ErrorBoundary>
                  <Pipeline leads={leads} users={users}/>
                </ErrorBoundary>
              )}
              {active==='activity' && (
                <ErrorBoundary>
                  <ActivityLog activityLog={activityLog} users={users} reload={fetchData}/>
                </ErrorBoundary>
              )}
              {active==='stages' && (
                <ErrorBoundary>
                  <LeadStages showToast={showToast}/>
                </ErrorBoundary>
              )}
              {active==='config' && (
                <ErrorBoundary>
                  <Config users={users} leads={leads} reload={fetchData} onImported={()=>{ fetchData(); showToast('Leads imported!') }} showToast={showToast}/>
                </ErrorBoundary>
              )}
              {active==='bsa' && (
                <ErrorBoundary>
                  <BankStatementAnalyzer/>
                </ErrorBoundary>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
