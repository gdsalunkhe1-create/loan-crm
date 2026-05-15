/* eslint-disable */
import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import {
  IconUsers, IconPhoneIncoming, IconThumbUp,
  IconCircleCheck, IconRefresh, IconChartBar
} from '@tabler/icons-react'

export default function ManagerPanel({ userId }) {
  const [agents, setAgents] = useState([])
  const [teamLeaders, setTeamLeaders] = useState([])
  const [leads, setLeads] = useState([])
  const [calls, setCalls] = useState([])
  const [agentStats, setAgentStats] = useState([])
  const [dateRange, setDateRange] = useState('today')
  const [activeTab, setActiveTab] = useState('overview')
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchAll() }, [dateRange])

  const fetchAll = async () => {
    setLoading(true)
    const now = new Date()
    let startDate = new Date()
    if (dateRange==='today') startDate.setHours(0,0,0,0)
    else if (dateRange==='week') startDate.setDate(now.getDate()-7)
    else if (dateRange==='month') startDate.setDate(1)

    const [agentsRes, tlRes, leadsRes, callsRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('role','agent').eq('status','active'),
      supabase.from('profiles').select('*').eq('role','team_leader').eq('status','active'),
      supabase.from('leads').select('*').gte('created_at', startDate.toISOString()),
      supabase.from('calls').select('*').gte('created_at', startDate.toISOString()),
    ])

    const agentList = agentsRes.data||[]
    const callList = callsRes.data||[]
    const leadList = leadsRes.data||[]

    setAgents(agentList)
    setTeamLeaders(tlRes.data||[])
    setLeads(leadList)
    setCalls(callList)

    const stats = agentList.map(agent => {
      const agentCalls = callList.filter(c=>c.agent_id===agent.id)
      const agentLeads = leadList.filter(l=>l.assigned_to===agent.id)
      const tl = (tlRes.data||[]).find(t=>t.id===agent.team_leader_id)
      return {
        id: agent.id,
        name: agent.full_name,
        email: agent.email,
        teamLeader: tl?.full_name||'No TL',
        calls: agentCalls.length,
        leads: agentLeads.length,
        interested: agentCalls.filter(c=>c.call_outcome==='Interested').length,
        callback: agentCalls.filter(c=>c.call_outcome==='Callback').length,
        notInterested: agentCalls.filter(c=>c.call_outcome==='Not Interested').length,
        converted: agentLeads.filter(l=>l.status==='Approved'||l.status==='Disbursed').length,
        convRate: agentCalls.length>0?Math.round((agentLeads.filter(l=>l.status==='Approved'||l.status==='Disbursed').length/agentCalls.length)*100):0
      }
    }).sort((a,b)=>b.calls-a.calls)

    setAgentStats(stats)
    setLoading(false)
  }

  const totalCalls = calls.length
  const totalInterested = calls.filter(c=>c.call_outcome==='Interested').length
  const totalConverted = leads.filter(l=>l.status==='Approved'||l.status==='Disbursed').length

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <IconChartBar size={22} strokeWidth={1.6}/> Manager Dashboard
          </h1>
          <p>{agents.length} agents · {teamLeaders.length} team leaders</p>
        </div>
        <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
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
            {icon:<IconUsers size={20} color="#185FA5"/>, label:'Total Agents', value:agents.length, color:'#185FA5', bg:'#E6F1FB'},
            {icon:<IconPhoneIncoming size={20} color="#0F6E56"/>, label:'Total Calls', value:totalCalls, color:'#0F6E56', bg:'#E1F5EE'},
            {icon:<IconThumbUp size={20} color="#3B6D11"/>, label:'Interested', value:totalInterested, color:'#3B6D11', bg:'#EAF3DE'},
            {icon:<IconCircleCheck size={20} color="#534AB7"/>, label:'Converted', value:totalConverted, color:'#534AB7', bg:'#EEEDFE'},
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

        <div className="tabs" style={{maxWidth:'400px',marginBottom:'20px'}}>
          {[
            {id:'overview',label:'Team Overview'},
            {id:'agents',label:'Agent Cards'},
            {id:'teams',label:'Team Structure'},
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
              display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontWeight:'600',fontSize:'14px'}}>Agent Performance</span>
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
                    {['Agent','Team Leader','Calls','Leads','Interested','Callback','Converted','Rate'].map(h=>(
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {agentStats.length===0 ? (
                    <tr><td colSpan="8">
                      <div className="empty-state">
                        <span className="empty-icon">
                          <IconUsers size={40} strokeWidth={1.2} color="#CBD5E0"/>
                        </span>
                        <h3>No data yet</h3>
                        <p>Data will appear as agents start calling</p>
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
                      <td>
                        <span style={{background:'#EEEDFE',color:'#534AB7',
                          padding:'3px 8px',borderRadius:'4px',fontSize:'12px',fontWeight:'500'}}>
                          {agent.teamLeader}
                        </span>
                      </td>
                      <td><strong style={{color:'#185FA5'}}>{agent.calls}</strong></td>
                      <td style={{color:'#111827'}}>{agent.leads}</td>
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
            {agentStats.length===0 ? (
              <div style={{gridColumn:'span 3'}}>
                <div className="card">
                  <div className="empty-state">
                    <span className="empty-icon">
                      <IconUsers size={40} strokeWidth={1.2} color="#CBD5E0"/>
                    </span>
                    <h3>No agents yet</h3>
                    <p>Add agents from the Admin Panel</p>
                  </div>
                </div>
              </div>
            ) : agentStats.map(agent=>(
              <div key={agent.id} className="card" style={{overflow:'hidden'}}>
                <div style={{background:'linear-gradient(135deg,#185FA5,#2563EB)',
                  padding:'16px 18px',display:'flex',alignItems:'center',gap:'12px'}}>
                  <div style={{width:'40px',height:'40px',borderRadius:'50%',
                    background:'rgba(255,255,255,0.2)',display:'flex',alignItems:'center',
                    justifyContent:'center',fontWeight:'700',color:'white',fontSize:'16px'}}>
                    {agent.name[0]?.toUpperCase()}
                  </div>
                  <div>
                    <div style={{color:'white',fontWeight:'700',fontSize:'14px'}}>{agent.name}</div>
                    <div style={{color:'rgba(255,255,255,0.7)',fontSize:'12px'}}>{agent.teamLeader}</div>
                  </div>
                </div>
                <div style={{padding:'14px 18px'}}>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginBottom:'12px'}}>
                    {[
                      {label:'Calls',value:agent.calls,color:'#185FA5'},
                      {label:'Leads',value:agent.leads,color:'#534AB7'},
                      {label:'Interested',value:agent.interested,color:'#3B6D11'},
                      {label:'Converted',value:agent.converted,color:'#0F6E56'},
                    ].map(s=>(
                      <div key={s.label} style={{background:'#F9FAFB',padding:'10px',
                        borderRadius:'8px',textAlign:'center'}}>
                        <div style={{fontSize:'20px',fontWeight:'700',color:s.color}}>{s.value}</div>
                        <div style={{fontSize:'11px',color:'#9CA3AF',marginTop:'2px'}}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',
                    fontSize:'12px',color:'#9CA3AF',marginBottom:'5px'}}>
                    <span>Conversion Rate</span>
                    <span style={{fontWeight:'600',color:'#185FA5'}}>{agent.convRate}%</span>
                  </div>
                  <div style={{height:'6px',background:'#F3F4F6',borderRadius:'3px'}}>
                    <div style={{height:'100%',background:'#185FA5',
                      borderRadius:'3px',width:agent.convRate+'%'}}/>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab==='teams' && (
          <div>
            {teamLeaders.map(tl=>{
              const tlAgents = agents.filter(a=>a.team_leader_id===tl.id)
              const tlCalls = calls.filter(c=>tlAgents.some(a=>a.id===c.agent_id))
              return (
                <div key={tl.id} className="card" style={{marginBottom:'16px',overflow:'hidden'}}>
                  <div style={{background:'linear-gradient(135deg,#534AB7,#7C3AED)',
                    padding:'14px 18px',color:'white',
                    display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                    <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                      <div style={{width:'36px',height:'36px',borderRadius:'50%',
                        background:'rgba(255,255,255,0.2)',display:'flex',alignItems:'center',
                        justifyContent:'center',fontWeight:'700',color:'white'}}>
                        {tl.full_name[0]?.toUpperCase()}
                      </div>
                      <div>
                        <div style={{fontWeight:'700',fontSize:'14px'}}>{tl.full_name}</div>
                        <div style={{fontSize:'12px',opacity:0.7}}>Team Leader</div>
                      </div>
                    </div>
                    <div style={{display:'flex',gap:'16px'}}>
                      {[
                        {label:'Agents',value:tlAgents.length},
                        {label:'Calls',value:tlCalls.length},
                      ].map(s=>(
                        <div key={s.label} style={{textAlign:'center'}}>
                          <div style={{fontSize:'18px',fontWeight:'700'}}>{s.value}</div>
                          <div style={{fontSize:'11px',opacity:0.7}}>{s.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{padding:'14px 18px',display:'flex',gap:'8px',flexWrap:'wrap'}}>
                    {tlAgents.length===0 ? (
                      <span style={{color:'#A0AEC0',fontSize:'13px'}}>No agents in this team</span>
                    ) : tlAgents.map(agent=>{
                      const aCalls = calls.filter(c=>c.agent_id===agent.id).length
                      return (
                        <div key={agent.id} style={{background:'#F9FAFB',
                          border:'0.5px solid #E5E7EB',borderRadius:'10px',
                          padding:'10px 14px',minWidth:'140px'}}>
                          <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'6px'}}>
                            <div style={{width:'26px',height:'26px',borderRadius:'50%',
                              background:'#E6F1FB',display:'flex',alignItems:'center',
                              justifyContent:'center',fontWeight:'600',color:'#185FA5',fontSize:'10px'}}>
                              {agent.full_name[0]?.toUpperCase()}
                            </div>
                            <span style={{fontWeight:'600',fontSize:'12px',color:'#111827'}}>
                              {agent.full_name}
                            </span>
                          </div>
                          <div style={{fontSize:'12px',color:'#6B7280'}}>
                            {aCalls} calls today
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {teamLeaders.length===0 && (
              <div className="card">
                <div className="empty-state">
                  <span className="empty-icon">
                    <IconUsers size={40} strokeWidth={1.2} color="#CBD5E0"/>
                  </span>
                  <h3>No team leaders yet</h3>
                  <p>Add team leaders from the Admin Panel</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}