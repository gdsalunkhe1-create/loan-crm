/* eslint-disable */
import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { IconPhoneIncoming, IconThumbUp, IconClockHour4, IconThumbDown } from '@tabler/icons-react'

export default function Calls({ userRole, userId }) {
  const [calls, setCalls] = useState([])
  const [leads, setLeads] = useState([])
  const [dispositions, setDispositions] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [filterOutcome, setFilterOutcome] = useState('')
  const [form, setForm] = useState({
    lead_id:'', call_status:'Answered', call_outcome:'', duration:'', notes:''
  })

  useEffect(() => { fetchCalls(); fetchLeads(); fetchDispositions() }, [])

  const fetchCalls = async () => {
    const { data } = await supabase.from('calls').select('*').order('created_at',{ascending:false})
    if (data) setCalls(data)
  }
  const fetchLeads = async () => {
    const { data } = await supabase.from('leads').select('id,full_name,mobile')
    if (data) setLeads(data)
  }
  const fetchDispositions = async () => {
    const { data } = await supabase.from('dispositions').select('*').eq('is_active',true).order('sort_order')
    if (data) setDispositions(data)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    await supabase.from('calls').insert([{...form}])
    const statusMap = {Interested:'Interested','Not Interested':'Not Interested',Approved:'Approved',Disbursed:'Disbursed',DND:'DND'}
    if (form.lead_id && statusMap[form.call_outcome]) {
      await supabase.from('leads').update({status:statusMap[form.call_outcome]}).eq('id',form.lead_id)
    }
    if (form.call_outcome==='Callback' && form.lead_id) {
      const lead = leads.find(l=>l.id===form.lead_id)
      await supabase.from('tasks').insert([{
        title:'Callback: '+(lead?.full_name||'Lead'),
        lead_id:form.lead_id,
        priority:'High',
        status:'Pending',
        notes:form.notes,
        due_date:new Date(Date.now()+24*60*60*1000).toISOString()
      }])
    }
    setForm({lead_id:'',call_status:'Answered',call_outcome:'',duration:'',notes:''})
    setShowForm(false)
    fetchCalls()
    setLoading(false)
  }

  const getCallStatusStyle = (status) => {
    const styles = {
      Answered:    {background:'#E1F5EE', color:'#0F6E56'},
      Missed:      {background:'#FCEBEB', color:'#A32D2D'},
      Busy:        {background:'#FAECE7', color:'#993C1D'},
      'Not Reachable': {background:'#F1EFE8', color:'#5F5E5A'},
      Ringing:     {background:'#E6F1FB', color:'#185FA5'},
      Engaged:     {background:'#FAEEDA', color:'#854F0B'},
    }
    return styles[status] || {background:'#F7FAFC', color:'#718096'}
  }

  const getDispositionStyle = (outcome) => {
    const styles = {
      Interested:      {background:'#E1F5EE', color:'#0F6E56'},
      'Not Interested':{background:'#FCEBEB', color:'#A32D2D'},
      Callback:        {background:'#FAEEDA', color:'#854F0B'},
      Approved:        {background:'#EAF3DE', color:'#3B6D11'},
      Disbursed:       {background:'#EEEDFE', color:'#534AB7'},
      DND:             {background:'#FCEBEB', color:'#A32D2D'},
      Ringing:         {background:'#E6F1FB', color:'#185FA5'},
      Busy:            {background:'#FAECE7', color:'#993C1D'},
      HUP:             {background:'#F1EFE8', color:'#5F5E5A'},
      Lead:            {background:'#EAF3DE', color:'#3B6D11'},
    }
    return styles[outcome] || {background:'#F7FAFC', color:'#718096'}
  }

  const filtered = filterOutcome ? calls.filter(c=>c.call_outcome===filterOutcome) : calls

  const stats = [
    {icon:<IconPhoneIncoming size={20} color="#185FA5"/>, label:'Total Calls', value:calls.length, color:'#185FA5', bg:'#E6F1FB'},
    {icon:<IconThumbUp size={20} color="#0F6E56"/>, label:'Interested', value:calls.filter(c=>c.call_outcome==='Interested').length, color:'#0F6E56', bg:'#E1F5EE'},
    {icon:<IconClockHour4 size={20} color="#854F0B"/>, label:'Callback', value:calls.filter(c=>c.call_outcome==='Callback').length, color:'#854F0B', bg:'#FAEEDA'},
    {icon:<IconThumbDown size={20} color="#A32D2D"/>, label:'Not Interested', value:calls.filter(c=>c.call_outcome==='Not Interested').length, color:'#A32D2D', bg:'#FCEBEB'},
  ]

  const CALL_STATUSES = ['Answered','Missed','Busy','Not Reachable','Ringing','Engaged']

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Call Logs</h1>
          <p>{calls.length} total calls logged</p>
        </div>
        <button className="btn btn-primary" onClick={()=>setShowForm(!showForm)}>
          {showForm?'Cancel':'+ Log a Call'}
        </button>
      </div>

      <div className="page-body">
        <div className="stats-grid">
          {stats.map(s=>(
            <div key={s.label} className="stat-card">
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
              <h3>Log a Call</h3>
              <button className="btn btn-ghost btn-sm" onClick={()=>setShowForm(false)}>✕</button>
            </div>
            <div className="card-body">
              <form onSubmit={handleSubmit}>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Select Lead *</label>
                    <select className="form-input" value={form.lead_id}
                      onChange={e=>setForm({...form,lead_id:e.target.value})} required>
                      <option value="">Select a lead...</option>
                      {leads.map(l=><option key={l.id} value={l.id}>{l.full_name} — {l.mobile}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Call Status</label>
                    <select className="form-input" value={form.call_status}
                      onChange={e=>setForm({...form,call_status:e.target.value})}>
                      {CALL_STATUSES.map(s=><option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Disposition *</label>
                    <select className="form-input" value={form.call_outcome}
                      onChange={e=>setForm({...form,call_outcome:e.target.value})} required>
                      <option value="">Select disposition...</option>
                      {dispositions.map(d=><option key={d.id} value={d.label}>{d.label}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Duration</label>
                    <input type="text" className="form-input" value={form.duration}
                      onChange={e=>setForm({...form,duration:e.target.value})}
                      placeholder="e.g. 5 mins"/>
                  </div>
                  <div className="form-group" style={{gridColumn:'span 2'}}>
                    <label className="form-label">Call Notes</label>
                    <input type="text" className="form-input" value={form.notes}
                      onChange={e=>setForm({...form,notes:e.target.value})}
                      placeholder="What was discussed..."/>
                  </div>
                </div>
                {form.call_outcome==='Callback' && (
                  <div style={{background:'#FFFAF0',border:'0.5px solid #F6E05E',borderRadius:'8px',
                    padding:'11px 14px',marginBottom:'16px',fontSize:'13px',color:'#744210'}}>
                    A follow-up task will be automatically created for tomorrow!
                  </div>
                )}
                <div style={{display:'flex',gap:'10px'}}>
                  <button type="submit" className="btn btn-success" disabled={loading}>
                    {loading?'Saving...':'Save Call Log'}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={()=>setShowForm(false)}>Cancel</button>
                </div>
              </form>
            </div>
          </div>
        )}

        <div className="search-bar">
          <select className="form-input" style={{width:'220px'}} value={filterOutcome}
            onChange={e=>setFilterOutcome(e.target.value)}>
            <option value="">All Dispositions</option>
            {dispositions.map(d=><option key={d.id}>{d.label}</option>)}
          </select>
          {filterOutcome && (
            <button className="btn btn-ghost btn-sm" onClick={()=>setFilterOutcome('')}>Clear</button>
          )}
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                {['Lead','Mobile','Call Status','Disposition','Duration','Notes','Date'].map(h=><th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {filtered.length===0 ? (
                <tr><td colSpan="7">
                  <div className="empty-state">
                    <span className="empty-icon"><IconPhoneIncoming size={40} strokeWidth={1.2} color="#CBD5E0"/></span>
                    <h3>No calls logged yet</h3>
                    <p>Log your first call to get started</p>
                  </div>
                </td></tr>
              ) : filtered.map(call=>{
                const lead = leads.find(l=>l.id===call.lead_id)
                const csStyle = getCallStatusStyle(call.call_status)
                const dispStyle = getDispositionStyle(call.call_outcome)
                return (
                  <tr key={call.id}>
                    <td>
                      <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                        <div style={{width:'32px',height:'32px',borderRadius:'50%',background:'#E6F1FB',
                          display:'flex',alignItems:'center',justifyContent:'center',
                          fontWeight:'600',color:'#185FA5',fontSize:'12px',flexShrink:0}}>
                          {(lead?.full_name||'?')[0].toUpperCase()}
                        </div>
                        <strong style={{fontSize:'13px'}}>{lead?.full_name||'Unknown'}</strong>
                      </div>
                    </td>
                    <td style={{color:'#718096',fontSize:'13px'}}>{lead?.mobile||'-'}</td>
                    <td>
                      <span style={{
                        ...csStyle,
                        padding:'3px 10px',
                        borderRadius:'20px',
                        fontSize:'12px',
                        fontWeight:'500',
                        display:'inline-block'
                      }}>
                        {call.call_status}
                      </span>
                    </td>
                    <td>
                      {call.call_outcome && (
                        <span style={{
                          ...dispStyle,
                          padding:'3px 10px',
                          borderRadius:'20px',
                          fontSize:'12px',
                          fontWeight:'500',
                          display:'inline-block'
                        }}>
                          {call.call_outcome}
                        </span>
                      )}
                    </td>
                    <td style={{color:'#718096',fontSize:'13px'}}>{call.duration||'-'}</td>
                    <td style={{maxWidth:'180px'}}>
                      <div style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',
                        fontSize:'13px',color:'#718096'}}>
                        {call.notes||'-'}
                      </div>
                    </td>
                    <td style={{color:'#A0AEC0',fontSize:'12px'}}>
                      {new Date(call.created_at).toLocaleDateString('en-IN')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}