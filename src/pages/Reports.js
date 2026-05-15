/* eslint-disable */
import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import {
  IconUsers, IconPhoneIncoming, IconThumbUp, IconClockHour4,
  IconCircleCheck, IconMoneybag, IconAlertTriangle, IconTarget
} from '@tabler/icons-react'

export default function Reports({ userRole, userId }) {
  const [stats, setStats] = useState({})
  const [agentStats, setAgentStats] = useState([])
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState('today')

  useEffect(() => { fetchReports() }, [dateRange])

  const fetchReports = async () => {
    setLoading(true)
    const now = new Date()
    let startDate = new Date()
    if (dateRange==='today') startDate.setHours(0,0,0,0)
    else if (dateRange==='week') startDate.setDate(now.getDate()-7)
    else if (dateRange==='month') startDate.setDate(1)

    const [leadsRes, callsRes, tasksRes, profilesRes] = await Promise.all([
      supabase.from('leads').select('*').gte('created_at',startDate.toISOString()),
      supabase.from('calls').select('*').gte('created_at',startDate.toISOString()),
      supabase.from('tasks').select('*'),
      supabase.from('profiles').select('*').eq('role','agent')
    ])

    const leads = leadsRes.data||[]
    const calls = callsRes.data||[]
    const tasks = tasksRes.data||[]
    const agents = profilesRes.data||[]

    setStats({
      totalLeads: leads.length,
      totalCalls: calls.length,
      interested: calls.filter(c=>c.call_outcome==='Interested').length,
      callback: calls.filter(c=>c.call_outcome==='Callback').length,
      approved: leads.filter(l=>l.status==='Approved').length,
      disbursed: leads.filter(l=>l.status==='Disbursed').length,
      overdueTasks: tasks.filter(t=>t.status==='Overdue').length,
      completedTasks: tasks.filter(t=>t.status==='Completed').length,
    })

    const agentData = agents.map(agent => {
      const agentCalls = calls.filter(c=>c.agent_id===agent.id)
      const agentLeads = leads.filter(l=>l.assigned_to===agent.id)
      return {
        name: agent.full_name,
        email: agent.email,
        calls: agentCalls.length,
        leads: agentLeads.length,
        interested: agentCalls.filter(c=>c.call_outcome==='Interested').length,
        converted: agentLeads.filter(l=>l.status==='Approved'||l.status==='Disbursed').length,
      }
    }).sort((a,b)=>b.calls-a.calls)

    setAgentStats(agentData)
    setLoading(false)
  }

  const statCards = [
    {icon:<IconUsers size={20} color="#185FA5"/>, label:'Total Leads', value:stats.totalLeads||0, color:'#185FA5', bg:'#E6F1FB'},
    {icon:<IconPhoneIncoming size={20} color="#0F6E56"/>, label:'Total Calls', value:stats.totalCalls||0, color:'#0F6E56', bg:'#E1F5EE'},
    {icon:<IconThumbUp size={20} color="#3B6D11"/>, label:'Interested', value:stats.interested||0, color:'#3B6D11', bg:'#EAF3DE'},
    {icon:<IconClockHour4 size={20} color="#854F0B"/>, label:'Callbacks', value:stats.callback||0, color:'#854F0B', bg:'#FAEEDA'},
    {icon:<IconCircleCheck size={20} color="#3B6D11"/>, label:'Approved', value:stats.approved||0, color:'#3B6D11', bg:'#EAF3DE'},
    {icon:<IconMoneybag size={20} color="#534AB7"/>, label:'Disbursed', value:stats.disbursed||0, color:'#534AB7', bg:'#EEEDFE'},
    {icon:<IconAlertTriangle size={20} color="#A32D2D"/>, label:'Overdue Tasks', value:stats.overdueTasks||0, color:'#A32D2D', bg:'#FCEBEB'},
    {icon:<IconTarget size={20} color="#993C1D"/>, label:'Tasks Done', value:stats.completedTasks||0, color:'#993C1D', bg:'#FAECE7'},
  ]

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Reports & Analytics</h1>
          <p>Track team performance and activity</p>
        </div>
        <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
          {['today','week','month'].map(r=>(
            <button key={r} className={`btn ${dateRange===r?'btn-primary':'btn-ghost'}`}
              onClick={()=>setDateRange(r)}>
              {r==='today'?'Today':r==='week'?'This Week':'This Month'}
            </button>
          ))}
          <button className="btn btn-outline" onClick={fetchReports}>Refresh</button>
        </div>
      </div>

      <div className="page-body">
        {loading ? (
          <div style={{textAlign:'center',padding:'80px',color:'#A0AEC0'}}>
            <div style={{marginBottom:'12px'}}><IconTarget size={36} color="#E2E8F0"/></div>
            <p>Loading reports...</p>
          </div>
        ) : (
          <>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'16px',marginBottom:'24px'}}>
              {statCards.map(s=>(
                <div key={s.label} className="stat-card">
                  <div style={{width:'40px',height:'40px',borderRadius:'10px',background:s.bg,
                    display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    {s.icon}
                  </div>
                  <div className="stat-info">
                    <h3 style={{
                      fontSize:'26px',
                      fontWeight:'600',
                      color: s.label==='Overdue Tasks' && s.value>0 ? '#A32D2D' : '#111827'
                    }}>
                      {s.value}
                    </h3>
                    <p>{s.label}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="card">
              <div className="card-header">
                <h3>Agent Performance</h3>
                <span style={{fontSize:'13px',color:'#A0AEC0'}}>
                  {dateRange==='today'?'Today':dateRange==='week'?'This Week':'This Month'}
                </span>
              </div>
              <div style={{overflow:'hidden'}}>
                <table>
                  <thead>
                    <tr>
                      {['Agent','Calls Made','Leads','Interested','Converted','Rate'].map(h=><th key={h}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {agentStats.length===0 ? (
                      <tr><td colSpan="6">
                        <div className="empty-state">
                          <span className="empty-icon"><IconUsers size={40} strokeWidth={1.2} color="#CBD5E0"/></span>
                          <h3>No data yet</h3>
                          <p>Data will appear as your team starts calling</p>
                        </div>
                      </td></tr>
                    ) : agentStats.map((agent,i)=>(
                      <tr key={i}>
                        <td>
                          <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                            <div style={{width:'34px',height:'34px',borderRadius:'50%',
                              background:'#E6F1FB',display:'flex',alignItems:'center',
                              justifyContent:'center',fontWeight:'600',color:'#185FA5',
                              fontSize:'13px',flexShrink:0}}>
                              {agent.name[0]?.toUpperCase()}
                            </div>
                            <div>
                              <div style={{fontWeight:'600',fontSize:'14px'}}>{agent.name}</div>
                              <div style={{fontSize:'12px',color:'#A0AEC0'}}>{agent.email}</div>
                            </div>
                          </div>
                        </td>
                        <td><strong style={{color:'#185FA5',fontSize:'15px'}}>{agent.calls}</strong></td>
                        <td style={{color:'#111827',fontSize:'14px'}}>{agent.leads}</td>
                        <td style={{color:'#111827',fontSize:'14px',fontWeight:'500'}}>{agent.interested}</td>
                        <td style={{color:'#111827',fontSize:'14px',fontWeight:'500'}}>{agent.converted}</td>
                        <td>
                          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                            <div style={{flex:1,height:'6px',background:'#F5F5F5',
                              borderRadius:'3px',minWidth:'70px'}}>
                              <div style={{
                                height:'100%',background:'#185FA5',borderRadius:'3px',
                                width:(agent.calls>0?Math.min((agent.converted/agent.calls)*100,100):0)+'%',
                                transition:'width 0.3s'
                              }}></div>
                            </div>
                            <span style={{fontSize:'12px',fontWeight:'700',color:'#185FA5',minWidth:'35px'}}>
                              {agent.calls>0?Math.round((agent.converted/agent.calls)*100):0}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}