/* eslint-disable */
import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import {
  IconUsers, IconPhoneIncoming, IconThumbUp,
  IconCircleCheck, IconRefresh, IconChartBar,
  IconBell, IconX, IconAlertTriangle
} from '@tabler/icons-react'

export default function TeamLeaderPanel({ userId }) {
  const [myAgents, setMyAgents] = useState([])
  const [leads, setLeads] = useState([])
  const [calls, setCalls] = useState([])
  const [agentStats, setAgentStats] = useState([])
  const [dateRange, setDateRange] = useState('today')
  const [activeTab, setActiveTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [overdueAlerts, setOverdueAlerts] = useState([])
  const [showAlerts, setShowAlerts] = useState(false)

  useEffect(() => { fetchAll() }, [dateRange])

  // Check for overdue tasks every minute
  useEffect(() => {
    checkOverdueTasks()
    const interval = setInterval(checkOverdueTasks, 60000)
    return () => clearInterval(interval)
  }, [myAgents])

  const checkOverdueTasks = async () => {
    if (myAgents.length === 0) return
    const agentIds = myAgents.map(a=>a.id)
    const { data } = await supabase
      .from('tasks')
      .select('*, profiles!tasks_assigned_to_fkey(full_name)')
      .in('assigned_to', agentIds)
      .in('status', ['Pending','In Progress'])
      .lt('due_date', new Date().toISOString())
    if (data && data.length > 0) {
      setOverdueAlerts(data)
    }
  }

  const fetchAll = async () => {
    setLoading(true)
    const now = new Date()
    let startDate = new Date()
    if (dateRange==='today') startDate.setHours(0,0,0,0)
    else if (dateRange==='week') startDate.setDate(now.getDate()-7)
    else if (dateRange==='month') startDate.setDate(1)

    const { data: agentsData } = await supabase
      .from('profiles').select('*').eq('team_leader_id', userId).eq('status','active')

    const agentList = agentsData||[]
    setMyAgents(agentList)

    if (agentList.length === 0) {
      setLeads([]); setCalls([]); setAgentStats([])
      setLoading(false); return
    }

    const agentIds = agentList.map(a=>a.id)
    const [leadsRes, callsRes] = await Promise.all([
      supabase.from('leads').select('*').in('assigned_to', agentIds).gte('created_at', startDate.toISOString()),
      supabase.from('calls').select('*').in('agent_id', agentIds).gte('created_at', startDate.toISOString()),
    ])

    const leadList = leadsRes.data||[]
    const callList = callsRes.data||[]
    setLeads(leadList)
    setCalls(callList)

    const stats = agentList.map(agent=>{
      const aCalls = callList.filter(c=>c.agent_id===agent.id)
      const aLeads = leadList.filter(l=>l.assigned_to===agent.id)
      return {
        id: agent.id,
        name: agent.full_name,
        email: agent.email,
        calls: aCalls.length,
        leads: aLeads.length,
        interested: aCalls.filter(c=>c.call_outcome==='Interested').length,
        callback: aCalls.filter(c=>c.call_outcome==='Callback').length,
        converted: aLeads.filter(l=>l.status==='Approved'||l.status==='Disbursed').length,
        convRate: aCalls.length>0?Math.round((aLeads.filter(l=>l.status==='Approved'||l.status==='Disbursed').length/aCalls.length)*100):0
      }
    }).sort((a,b)=>b.calls-a.calls)

    setAgentStats(stats)
    setLoading(false)
  }

  return (
    <div>
      {/* Overdue Alert Popup */}
      {overdueAlerts.length > 0 && showAlerts && (
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:200}}
            onClick={()=>setShowAlerts(false)}/>
          <div style={{position:'fixed',top:'50%',left:'50%',
            transform:'translate(-50%,-50%)',background:'white',
            borderRadius:'16px',boxShadow:'0 20px 60px rgba(0,0,0,0.15)',
            zIndex:300,width:'90%',maxWidth:'480px',overflow:'hidden'}}>
            <div style={{background:'#A32D2D',padding:'16px 20px',
              display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <h3 style={{color:'white',margin:0,fontSize:'15px',fontWeight:'700',
                display:'flex',alignItems:'center',gap:'8px'}}>
                <IconAlertTriangle size={18}/> Overdue Tasks Alert
              </h3>
              <button onClick={()=>setShowAlerts(false)}
                style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',
                  width:'28px',height:'28px',borderRadius:'50%',cursor:'pointer',
                  display:'flex',alignItems:'center',justifyContent:'center'}}>
                <IconX size={14}/>
              </button>
            </div>
            <div style={{padding:'16px',maxHeight:'300px',overflowY:'auto'}}>
              {overdueAlerts.map(task=>(
                <div key={task.id} style={{padding:'12px',borderRadius:'8px',
                  background:'#FFF5F5',border:'0.5px solid #FED7D7',marginBottom:'8px'}}>
                  <div style={{fontWeight:'600',fontSize:'13px',color:'#A32D2D',marginBottom:'4px'}}>
                    {task.title}
                  </div>
                  <div style={{fontSize:'12px',color:'#718096'}}>
                    Agent: {task.profiles?.full_name||'Unknown'} · 
                    Due: {new Date(task.due_date).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}
                  </div>
                </div>
              ))}
            </div>
            <div style={{padding:'12px 16px',borderTop:'0.5px solid #F3F4F6',textAlign:'center'}}>
              <button onClick={()=>setShowAlerts(false)} className="btn btn-primary btn-sm">
                Acknowledge
              </button>
            </div>
          </div>
        </>
      )}

      <div className="page-header">
        <div>
          <h1 style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <IconChartBar size={22} strokeWidth={1.6}/> Team Leader Dashboard
          </h1>
          <p>{myAgents.length} agents in your team</p>
        </div>
        <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
          {overdueAlerts.length > 0 && (
            <button onClick={()=>setShowAlerts(true)}
              style={{display:'flex',alignItems:'center',gap:'6px',
                background:'#FCEBEB',color:'#A32D2D',border:'0.5px solid #FED7D7',
                padding:'8px 14px',borderRadius:'8px',cursor:'pointer',
                fontWeight:'600',fontSize:'13px',position:'relative'}}>
              <IconBell size={15}/>
              {overdueAlerts.length} Overdue
              <span style={{position:'absolute',top:'-6px',right:'-6px',
                background:'#A32D2D',color:'white',borderRadius:'50%',
                width:'18px',height:'18px',fontSize:'10px',fontWeight:'700',
                display:'flex',alignItems:'center',justifyContent:'center'}}>
                {overdueAlerts.length}
              </span>
            </button>
          )}
          {['today','week','month'].map(r=>(
            <button key={r} className={`btn ${dateRange===r?'btn-primary':'btn-ghost'}`}
              onClick={()=>setDateRange(r)}>
              {r==='today'?'Today':r==='week'?'This Week':'This Month'}
            </button>
          ))}
          <button className="btn btn-outline" onClick={fetchAll}>
            <IconRefresh size={15}/>
          </button>
        </div>
      </div>

      <div className="page-body">
        <div className="stats-grid" style={{marginBottom:'24px'}}>
          {[
            {icon:<IconUsers size={20} color="#185FA5"/>, label:'My Agents', value:myAgents.length, color:'#185FA5', bg:'#E6F1FB'},
            {icon:<IconPhoneIncoming size={20} color="#0F6E56"/>, label:'Total Calls', value:calls.length, color:'#0F6E56', bg:'#E1F5EE'},
            {icon:<IconThumbUp size={20} color="#3B6D11"/>, label:'Interested', value:calls.filter(c=>c.call_outcome==='Interested').length, color:'#3B6D11', bg:'#EAF3DE'},
            {icon:<IconCircleCheck size={20} color="#534AB7"/>, label:'Converted', value:leads.filter(l=>l.status==='Approved'||l.status==='Disbursed').length, color:'#534AB7', bg:'#EEEDFE'},
          ].map(s=>(
            <div key={s.label} className="stat-card">
              <div style={{width:'40px',height:'40px',borderRadius:'10px',
                background:s.bg,display:'flex',alignItems:'center',
                justifyContent:'center',flexShrink:0}}>
                {s.icon}
              </div>
              <div className="stat-info">
                <h3 style={{color:s.color}}>{s.value}</h3>
                <p>{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="tabs" style={{maxWidth:'300px',marginBottom:'20px'}}>
          {[
            {id:'overview',label:'Overview'},
            {id:'agents',label:'My Agents'},
          ].map(t=>(
            <button key={t.id} className={`tab ${activeTab===t.id?'active':''}`}
              onClick={()=>setActiveTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {activeTab==='overview' && (
          <div className="table-container">
            <div style={{padding:'14px 18px',borderBottom:'0.5px solid #E2E8F0',
              display:'flex',justifyContent:'space-between'}}>
              <span style={{fontWeight:'600',fontSize:'14px'}}>Team Performance</span>
              <span style={{fontSize:'13px',color:'#A0AEC0'}}>
                {dateRange==='today'?'Today':dateRange==='week'?'This Week':'This Month'}
              </span>
            </div>
            {loading ? (
              <div style={{padding:'40px',textAlign:'center',color:'#A0AEC0'}}>Loading...</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    {['Agent','Calls','Leads','Interested','Callback','Converted','Rate'].map(h=>(
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {agentStats.length===0 ? (
                    <tr><td colSpan="7">
                      <div className="empty-state">
                        <span className="empty-icon">
                          <IconUsers size={40} strokeWidth={1.2} color="#CBD5E0"/>
                        </span>
                        <h3>No agents in your team yet</h3>
                        <p>Ask admin to assign agents to you</p>
                      </div>
                    </td></tr>
                  ) : agentStats.map(agent=>(
                    <tr key={agent.id}>
                      <td>
                        <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                          <div style={{width:'32px',height:'32px',borderRadius:'50%',
                            background:'#E6F1FB',display:'flex',alignItems:'center',
                            justifyContent:'center',fontWeight:'600',color:'#185FA5',fontSize:'12px'}}>
                            {agent.name[0]?.toUpperCase()}
                          </div>
                          <div>
                            <div style={{fontWeight:'600',fontSize:'13px'}}>{agent.name}</div>
                            <div style={{fontSize:'11px',color:'#A0AEC0'}}>{agent.email}</div>
                          </div>
                        </div>
                      </td>
                      <td><strong style={{color:'#185FA5'}}>{agent.calls}</strong></td>
                      <td>{agent.leads}</td>
                      <td>
                        <span style={{background:'#EAF3DE',color:'#3B6D11',
                          padding:'2px 8px',borderRadius:'4px',fontSize:'12px'}}>
                          {agent.interested}
                        </span>
                      </td>
                      <td>
                        <span style={{background:'#FAEEDA',color:'#854F0B',
                          padding:'2px 8px',borderRadius:'4px',fontSize:'12px'}}>
                          {agent.callback}
                        </span>
                      </td>
                      <td>
                        <span style={{background:'#E1F5EE',color:'#0F6E56',
                          padding:'2px 8px',borderRadius:'4px',fontSize:'12px'}}>
                          {agent.converted}
                        </span>
                      </td>
                      <td>
                        <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
                          <div style={{flex:1,height:'6px',background:'#F5F5F5',
                            borderRadius:'3px',minWidth:'50px'}}>
                            <div style={{height:'100%',background:'#185FA5',
                              borderRadius:'3px',width:agent.convRate+'%'}}/>
                          </div>
                          <span style={{fontSize:'11px',fontWeight:'700',
                            color:'#185FA5',minWidth:'30px'}}>{agent.convRate}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab==='agents' && (
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'14px'}}>
            {myAgents.length===0 ? (
              <div style={{gridColumn:'span 3'}}>
                <div className="card">
                  <div className="empty-state">
                    <span className="empty-icon">
                      <IconUsers size={40} strokeWidth={1.2} color="#CBD5E0"/>
                    </span>
                    <h3>No agents in your team</h3>
                    <p>Ask admin to assign agents to you</p>
                  </div>
                </div>
              </div>
            ) : myAgents.map(agent=>{
              const stat = agentStats.find(s=>s.id===agent.id)||{}
              return (
                <div key={agent.id} className="card" style={{overflow:'hidden'}}>
                  <div style={{background:'linear-gradient(135deg,#185FA5,#2563EB)',
                    padding:'16px 18px'}}>
                    <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                      <div style={{width:'38px',height:'38px',borderRadius:'50%',
                        background:'rgba(255,255,255,0.2)',display:'flex',
                        alignItems:'center',justifyContent:'center',
                        fontWeight:'700',color:'white',fontSize:'15px'}}>
                        {agent.full_name[0]?.toUpperCase()}
                      </div>
                      <div>
                        <div style={{color:'white',fontWeight:'700',fontSize:'14px'}}>
                          {agent.full_name}
                        </div>
                        <div style={{color:'rgba(255,255,255,0.7)',fontSize:'12px'}}>
                          {agent.email}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div style={{padding:'14px 18px'}}>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',
                      gap:'8px',marginBottom:'12px'}}>
                      {[
                        {label:'Calls',value:stat.calls||0,color:'#185FA5'},
                        {label:'Interested',value:stat.interested||0,color:'#3B6D11'},
                        {label:'Converted',value:stat.converted||0,color:'#534AB7'},
                      ].map(s=>(
                        <div key={s.label} style={{background:'#F9FAFB',padding:'10px',
                          borderRadius:'8px',textAlign:'center'}}>
                          <div style={{fontSize:'18px',fontWeight:'700',color:s.color}}>{s.value}</div>
                          <div style={{fontSize:'11px',color:'#9CA3AF',marginTop:'2px'}}>{s.label}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
                      <div style={{flex:1,height:'6px',background:'#F3F4F6',borderRadius:'3px'}}>
                        <div style={{height:'100%',background:'#185FA5',
                          borderRadius:'3px',width:(stat.convRate||0)+'%'}}/>
                      </div>
                      <span style={{fontSize:'12px',fontWeight:'700',color:'#185FA5'}}>
                        {stat.convRate||0}%
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}