/* eslint-disable */
import React, { useState, useEffect } from 'react'
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
import { IconListCheck, IconHourglass, IconAlertTriangle, IconCircleCheck, IconTrash } from '@tabler/icons-react'

export default function Tasks({ userRole, userId, orgId }) {
  const [tasks, setTasks] = useState([])
  const [leads, setLeads] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [hoveredDelete, setHoveredDelete] = useState(null)
  const [form, setForm] = useState({
    title:'', lead_id:'', due_date:'', priority:'Medium', notes:''
  })

  useEffect(() => { fetchTasks(); fetchLeads() }, [userId, userRole])

  const fetchTasks = async () => {
    let query = supabase.from('tasks').select('*').order('due_date',{ascending:true})
    if (userRole === 'admin' || userRole === 'manager') {
      const { data } = await query
      if (data) {
        const updated = data.map(t => {
          if (t.status!=='Completed' && new Date(t.due_date)<new Date()) return {...t,status:'Overdue'}
          return t
        })
        setTasks(updated)
      }
    } else {
      const { data } = await query.eq('assigned_to', userId)
      if (data) {
        const updated = data.map(t => {
          if (t.status!=='Completed' && new Date(t.due_date)<new Date()) return {...t,status:'Overdue'}
          return t
        })
        setTasks(updated)
      }
    }
  }

  const fetchLeads = async () => {
    let query = supabase.from('leads').select('id,full_name,mobile')
    if (userRole !== 'admin' && userRole !== 'manager') {
      query = query.eq('assigned_to', userId)
    }
    const { data } = await query
    if (data) setLeads(data)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    // If agent picked a time that has already passed today, auto-roll to tomorrow
    let dueDate = form.due_date
    if (dueDate && new Date(dueDate) < new Date()) {
      const d = new Date(dueDate)
      d.setDate(d.getDate() + 1)
      const pad = n => String(n).padStart(2,'0')
      dueDate = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
    await supabase.from('tasks').insert([{...form, due_date: dueDate, status:'Pending', assigned_to: userId, org_id: orgId}])
    setForm({title:'',lead_id:'',due_date:'',priority:'Medium',notes:''})
    setShowForm(false)
    fetchTasks()
    setLoading(false)
  }

  const updateStatus = async (id,status) => {
    await supabase.from('tasks').update({status}).eq('id',id)
    fetchTasks()
  }

  const deleteTask = async (id) => {
    if (!window.confirm('Delete this task?')) return
    await supabase.from('tasks').delete().eq('id',id)
    fetchTasks()
  }

  const PRIORITIES = ['High','Medium','Low']

  const PRIORITY_STYLES = {
    High:    {background:'#FCEBEB', color:'#A32D2D', padding:'2px 10px', borderRadius:'20px', fontSize:'12px', fontWeight:'500'},
    Medium:  {background:'#FAEEDA', color:'#854F0B', padding:'2px 10px', borderRadius:'20px', fontSize:'12px', fontWeight:'500'},
    Low:     {background:'#EAF3DE', color:'#3B6D11', padding:'2px 10px', borderRadius:'20px', fontSize:'12px', fontWeight:'500'},
  }

  const STATUS_STYLES = {
    Pending:      {background:'#E6F1FB', color:'#185FA5', padding:'2px 10px', borderRadius:'20px', fontSize:'12px', fontWeight:'500'},
    'In Progress':{background:'#EEEDFE', color:'#534AB7', padding:'2px 10px', borderRadius:'20px', fontSize:'12px', fontWeight:'500'},
    Completed:    {background:'#EAF3DE', color:'#3B6D11', padding:'2px 10px', borderRadius:'20px', fontSize:'12px', fontWeight:'500'},
    Overdue:      {background:'#FCEBEB', color:'#A32D2D', padding:'2px 10px', borderRadius:'20px', fontSize:'12px', fontWeight:'500'},
  }

  const filtered = tasks.filter(t => {
    const matchStatus = filterStatus ? t.status===filterStatus : true
    const matchPriority = filterPriority ? t.priority===filterPriority : true
    return matchStatus && matchPriority
  })

  const stats = [
    {icon:<IconListCheck size={20} color="#185FA5"/>, label:'Total', value:tasks.length, color:'#185FA5', bg:'#E6F1FB'},
    {icon:<IconHourglass size={20} color="#854F0B"/>, label:'Pending', value:tasks.filter(t=>t.status==='Pending').length, color:'#854F0B', bg:'#FAEEDA'},
    {icon:<IconAlertTriangle size={20} color="#A32D2D"/>, label:'Overdue', value:tasks.filter(t=>t.status==='Overdue').length, color:'#A32D2D', bg:'#FCEBEB'},
    {icon:<IconCircleCheck size={20} color="#3B6D11"/>, label:'Completed', value:tasks.filter(t=>t.status==='Completed').length, color:'#3B6D11', bg:'#EAF3DE'},
  ]

  return (
    <ErrorBoundary>
    <div>
      <div className="page-header">
        <div>
          <h1>Tasks & Follow-ups</h1>
          <p>{tasks.filter(t=>t.status==='Overdue').length} overdue · {tasks.filter(t=>t.status==='Pending').length} pending</p>
        </div>
        <button className="btn btn-primary" onClick={()=>setShowForm(!showForm)}>
          {showForm?'Cancel':'+ Add Task'}
        </button>
      </div>

      <div className="page-body">
        <div className="stats-grid">
          {stats.map(s=>(
            <div key={s.label} className="stat-card" style={{cursor:'pointer'}}
              onClick={()=>setFilterStatus(s.label==='Total'?'':s.label)}>
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
              <h3>Add New Task</h3>
              <button className="btn btn-ghost btn-sm" onClick={()=>setShowForm(false)}>✕</button>
            </div>
            <div className="card-body">
              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label className="form-label">Task Title *</label>
                  <input type="text" className="form-input" value={form.title}
                    onChange={e=>setForm({...form,title:e.target.value})} required
                    placeholder="e.g. Follow up call, Send documents"/>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Linked Lead</label>
                    <select className="form-input" value={form.lead_id}
                      onChange={e=>setForm({...form,lead_id:e.target.value})}>
                      <option value="">Select Lead</option>
                      {leads.map(l=><option key={l.id} value={l.id}>{l.full_name} — {l.mobile}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Priority</label>
                    <select className="form-input" value={form.priority}
                      onChange={e=>setForm({...form,priority:e.target.value})}>
                      {PRIORITIES.map(p=><option key={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Due Date & Time *</label>
                    <input type="datetime-local" className="form-input" value={form.due_date}
                      onChange={e=>setForm({...form,due_date:e.target.value})} required/>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Notes</label>
                    <input type="text" className="form-input" value={form.notes}
                      onChange={e=>setForm({...form,notes:e.target.value})}
                      placeholder="Additional notes..."/>
                  </div>
                </div>
                <div style={{display:'flex',gap:'10px'}}>
                  <button type="submit" className="btn btn-success" disabled={loading}>
                    {loading?'Saving...':'Save Task'}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={()=>setShowForm(false)}>Cancel</button>
                </div>
              </form>
            </div>
          </div>
        )}

        <div className="search-bar">
          <select className="form-input" style={{width:'180px'}} value={filterStatus}
            onChange={e=>setFilterStatus(e.target.value)}>
            <option value="">All Statuses</option>
            {['Pending','In Progress','Completed','Overdue'].map(s=><option key={s}>{s}</option>)}
          </select>
          <select className="form-input" style={{width:'160px'}} value={filterPriority}
            onChange={e=>setFilterPriority(e.target.value)}>
            <option value="">All Priorities</option>
            {PRIORITIES.map(p=><option key={p}>{p}</option>)}
          </select>
          {(filterStatus||filterPriority) && (
            <button className="btn btn-ghost btn-sm"
              onClick={()=>{setFilterStatus('');setFilterPriority('')}}>Clear</button>
          )}
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
          {filtered.length===0 ? (
            <div className="card">
              <div className="empty-state">
                <span className="empty-icon"><IconListCheck size={40} strokeWidth={1.2} color="#CBD5E0"/></span>
                <h3>No tasks found</h3>
                <p>Add your first follow-up task</p>
              </div>
            </div>
          ) : filtered.map(task=>{
            const lead = leads.find(l=>l.id===task.lead_id)
            const isOverdue = task.status==='Overdue'
            const ps = PRIORITY_STYLES[task.priority]||PRIORITY_STYLES.Medium
            const ss = STATUS_STYLES[task.status]||STATUS_STYLES.Pending
            return (
              <div key={task.id} style={{
                background:'white',
                borderRadius:'12px',
                border:'0.5px solid #E2E8F0',
                borderLeft:'3px solid '+(ps.color),
                padding:'16px 20px',
                boxShadow:'0 1px 3px rgba(0,0,0,0.04)',
                transition:'box-shadow 0.2s'
              }}
                onMouseEnter={e=>e.currentTarget.style.boxShadow='0 4px 12px rgba(0,0,0,0.08)'}
                onMouseLeave={e=>e.currentTarget.style.boxShadow='0 1px 3px rgba(0,0,0,0.04)'}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:'12px'}}>
                  <div style={{flex:1}}>
                    <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'7px',flexWrap:'wrap'}}>
                      <span style={{fontWeight:'600',fontSize:'14px',
                        color:isOverdue?'#A32D2D':'#2D3748',
                        textDecoration:task.status==='Completed'?'line-through':'none'}}>
                        {task.title}
                      </span>
                      <span style={ps}>{task.priority}</span>
                      <span style={ss}>{task.status}</span>
                    </div>
                    {lead && (
                      <div style={{fontSize:'13px',color:'#718096',marginBottom:'5px'}}>
                        {lead.full_name} · {lead.mobile}
                      </div>
                    )}
                    {task.notes && (
                      <div style={{fontSize:'13px',color:'#A0AEC0',marginBottom:'5px'}}>{task.notes}</div>
                    )}
                    <div style={{fontSize:'12px',color:isOverdue?'#A32D2D':'#A0AEC0',fontWeight:isOverdue?'600':'400'}}>
                      Due: {task.due_date?new Date(task.due_date).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'-'}
                    </div>
                  </div>
                  <div style={{display:'flex',gap:'7px',flexWrap:'wrap',alignItems:'center'}}>
                    {task.status!=='Completed' && (
                      <button className="btn btn-success btn-sm"
                        onClick={()=>updateStatus(task.id,'Completed')}>Done</button>
                    )}
                    {task.status==='Pending' && (
                      <button className="btn btn-sm"
                        style={{background:'#EEEDFE',color:'#534AB7',border:'none'}}
                        onClick={()=>updateStatus(task.id,'In Progress')}>Start</button>
                    )}
                    {lead && (
                      <a href={'tel:'+lead.mobile} className="btn btn-outline btn-sm"
                        style={{textDecoration:'none'}}>Call</a>
                    )}
                    <button
                      onClick={()=>deleteTask(task.id)}
                      onMouseEnter={()=>setHoveredDelete(task.id)}
                      onMouseLeave={()=>setHoveredDelete(null)}
                      style={{
                        background:'transparent',
                        border:'none',
                        cursor:'pointer',
                        padding:'6px',
                        borderRadius:'6px',
                        display:'flex',
                        alignItems:'center',
                        justifyContent:'center',
                        color: hoveredDelete===task.id ? '#A32D2D' : '#CBD5E0',
                        transition:'color 0.15s'
                      }}>
                      <IconTrash size={15}/>
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
    </ErrorBoundary>
  )
}