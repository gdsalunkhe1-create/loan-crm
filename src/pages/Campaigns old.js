/* eslint-disable */
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import {
  IconPlayerPlay, IconPhone, IconUsers, IconUpload,
  IconX, IconCheck, IconPlayerSkipForward,
  IconBuildingStore, IconHandClick, IconRobot,
  IconChevronDown, IconRefresh, IconUserPlus
} from '@tabler/icons-react'

export default function Campaigns({ userRole, userId }) {
  const [campaigns, setCampaigns] = useState([])
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [selectedCampaign, setSelectedCampaign] = useState(null)
  const [campaignLeads, setCampaignLeads] = useState([])
  const [campaignAgents, setCampaignAgents] = useState([])
  const [allAgents, setAllAgents] = useState([])
  const [loading, setLoading] = useState(false)
  const [dialerMode, setDialerMode] = useState(false)
  const [dialerType, setDialerType] = useState('manual')
  const [currentLeadIndex, setCurrentLeadIndex] = useState(0)
  const [dispositions, setDispositions] = useState([])
  const [callForm, setCallForm] = useState({call_status:'Answered', call_outcome:'', duration:'', notes:''})
  const [showCSVModal, setShowCSVModal] = useState(false)
  const [csvFile, setCsvFile] = useState(null)
  const [csvPreview, setCsvPreview] = useState([])
  const [showAgentModal, setShowAgentModal] = useState(false)
  const [campaignStats, setCampaignStats] = useState({})
  const [selectedAgentsForCSV, setSelectedAgentsForCSV] = useState([])
  const [csvDistribution, setCsvDistribution] = useState('single')
  const [reassignModal, setReassignModal] = useState(false)
  const [selectedLeadForReassign, setSelectedLeadForReassign] = useState(null)
  const csvRef = useRef()

  const [form, setForm] = useState({
    name:'', description:'', dialer_type:'manual'
  })

  const isAdmin = userRole === 'admin'
  const isManager = userRole === 'manager'
  const isAdminOrManager = isAdmin || isManager
  const isAgent = userRole === 'agent'

  useEffect(() => {
    fetchCampaigns()
    fetchAllAgents()
    fetchDispositions()
  }, [])

  const fetchCampaigns = async () => {
    if (isAgent) {
      const { data: agentCampaigns } = await supabase
        .from('campaign_agents')
        .select('campaign_id')
        .eq('agent_id', userId)
      if (agentCampaigns && agentCampaigns.length > 0) {
        const ids = agentCampaigns.map(c => c.campaign_id)
        const { data } = await supabase.from('campaigns').select('*').in('id', ids).eq('status','active')
        if (data) setCampaigns(data)
      } else {
        setCampaigns([])
      }
    } else {
      const { data } = await supabase.from('campaigns').select('*').order('created_at',{ascending:false})
      if (data) setCampaigns(data)
    }
  }

  const fetchAllAgents = async () => {
    const { data } = await supabase.from('profiles').select('id,full_name,email,role').in('role',['agent','team_leader']).eq('status','active')
    if (data) setAllAgents(data)
  }

  const fetchDispositions = async () => {
    const { data } = await supabase.from('dispositions').select('*').eq('is_active',true).order('sort_order')
    if (data) setDispositions(data)
  }

  const fetchCampaignLeads = async (campaignId) => {
    let query = supabase.from('leads').select('*,profiles!leads_assigned_to_fkey(full_name)').eq('campaign_id',campaignId).order('created_at',{ascending:true})
    if (isAgent) query = query.eq('assigned_to', userId)
    const { data } = await query
    if (data) setCampaignLeads(data)
    return data || []
  }

  const fetchCampaignAgents = async (campaignId) => {
    const { data } = await supabase.from('campaign_agents').select('agent_id, profiles(id,full_name,email)').eq('campaign_id',campaignId)
    if (data) setCampaignAgents(data.map(d => d.profiles).filter(Boolean))
  }

  const fetchCampaignStats = async (campaignId) => {
    const { data: leads } = await supabase.from('leads').select('id,status,assigned_to').eq('campaign_id',campaignId)
    if (leads) {
      setCampaignStats({
        total: leads.length,
        called: leads.filter(l=>l.status!=='New').length,
        interested: leads.filter(l=>l.status==='Interested').length,
        converted: leads.filter(l=>l.status==='Approved'||l.status==='Disbursed').length,
        pending: leads.filter(l=>l.status==='New').length,
      })
    }
  }

  const createCampaign = async (e) => {
    e.preventDefault()
    setLoading(true)
    const { data } = await supabase.from('campaigns').insert([{...form, created_by:userId}]).select()
    if (data) {
      setShowCreateForm(false)
      setForm({name:'',description:'',dialer_type:'manual'})
      fetchCampaigns()
    }
    setLoading(false)
  }

  const closeCampaign = async (id) => {
    if (!window.confirm('Close this campaign?')) return
    await supabase.from('campaigns').update({status:'closed'}).eq('id',id)
    fetchCampaigns()
    if (selectedCampaign?.id===id) setSelectedCampaign(null)
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
    if (!csvFile) { alert('Please select a CSV file!'); return }
    if (selectedAgentsForCSV.length === 0) { alert('Please select at least one agent!'); return }

    setLoading(true)
    const reader = new FileReader()
    reader.onload = async (evt) => {
      const text = evt.target.result
      const lines = text.split('\n').filter(l=>l.trim())
      const headers = lines[0].split(',').map(h=>h.trim().toLowerCase().replace(/ /g,'_'))
      const allRows = lines.slice(1).map(line => {
        const values = line.split(',')
        const obj = {}
        headers.forEach((h,i)=>{ obj[h]=values[i]?values[i].trim():'' })
        return {...obj, status:'New', product_interest:obj.product_interest||'Personal Loan', campaign_id:selectedCampaign.id}
      }).filter(r=>r.full_name&&r.mobile)

      let rowsToInsert = []

      if (csvDistribution === 'single') {
        // All leads go to selected agent (first selected)
        rowsToInsert = allRows.map(r=>({...r, assigned_to:selectedAgentsForCSV[0]}))
      } else if (csvDistribution === 'equal') {
        // Distribute equally among selected agents
        rowsToInsert = allRows.map((r,i)=>({
          ...r,
          assigned_to: selectedAgentsForCSV[i % selectedAgentsForCSV.length]
        }))
      }

      if (rowsToInsert.length > 0) {
        const { error } = await supabase.from('leads').insert(rowsToInsert)
        if (error) {
          alert('Error: '+error.message)
        } else {
          const agentNames = selectedAgentsForCSV.map(id=>allAgents.find(a=>a.id===id)?.full_name).join(', ')
          alert(`✅ ${rowsToInsert.length} leads uploaded!\nDistributed to: ${agentNames}`)
          setShowCSVModal(false)
          setCsvFile(null)
          setCsvPreview([])
          setSelectedAgentsForCSV([])
          fetchCampaignLeads(selectedCampaign.id)
          fetchCampaignStats(selectedCampaign.id)
        }
      }
      setLoading(false)
    }
    reader.readAsText(csvFile)
  }

  const toggleAgentForCSV = (agentId) => {
    setSelectedAgentsForCSV(prev =>
      prev.includes(agentId)
        ? prev.filter(id=>id!==agentId)
        : [...prev, agentId]
    )
  }

  const assignAgentToCampaign = async (agentId) => {
    const { error } = await supabase.from('campaign_agents').insert([{campaign_id:selectedCampaign.id,agent_id:agentId}])
    if (!error) fetchCampaignAgents(selectedCampaign.id)
  }

  const removeAgentFromCampaign = async (agentId) => {
    await supabase.from('campaign_agents').delete().eq('campaign_id',selectedCampaign.id).eq('agent_id',agentId)
    fetchCampaignAgents(selectedCampaign.id)
  }

  const reassignLead = async (leadId, newAgentId) => {
    await supabase.from('leads').update({assigned_to:newAgentId}).eq('id',leadId)
    fetchCampaignLeads(selectedCampaign.id)
    setReassignModal(false)
    setSelectedLeadForReassign(null)
  }

  const openCampaign = async (campaign) => {
    setSelectedCampaign(campaign)
    setDialerMode(false)
    setDialerType(campaign.dialer_type||'manual')
    setCurrentLeadIndex(0)
    await fetchCampaignLeads(campaign.id)
    await fetchCampaignAgents(campaign.id)
    await fetchCampaignStats(campaign.id)
  }

  const startDialer = () => {
    const pendingLeads = campaignLeads.filter(l=>l.status==='New')
    if (pendingLeads.length===0) { alert('No pending leads to call!'); return }
    setDialerMode(true)
    setCurrentLeadIndex(0)
    setCallForm({call_status:'Answered',call_outcome:'',duration:'',notes:''})
  }

  const currentLead = dialerMode ? campaignLeads.filter(l=>l.status==='New')[currentLeadIndex] : null

  const saveCallAndNext = async () => {
    if (!callForm.call_outcome) { alert('Please select a disposition first!'); return }
    setLoading(true)

    await supabase.from('calls').insert([{
      lead_id:currentLead.id,
      agent_id:userId,
      call_status:callForm.call_status,
      call_outcome:callForm.call_outcome,
      duration:callForm.duration,
      notes:callForm.notes,
    }])

    const statusMap = {Interested:'Interested','Not Interested':'Not Interested',Callback:'Callback',Approved:'Approved',Disbursed:'Disbursed',DND:'DND',HUP:'HUP'}
    const newStatus = statusMap[callForm.call_outcome]||'Callback'
    await supabase.from('leads').update({status:newStatus}).eq('id',currentLead.id)

    if (callForm.call_outcome==='Callback') {
      await supabase.from('tasks').insert([{
        title:'Callback: '+currentLead.full_name,
        lead_id:currentLead.id,
        assigned_to:userId,
        priority:'High',
        status:'Pending',
        notes:callForm.notes,
        due_date:new Date(Date.now()+24*60*60*1000).toISOString()
      }])
    }

    const updatedLeads = await fetchCampaignLeads(selectedCampaign.id)
    const pendingLeads = (updatedLeads||[]).filter(l=>l.status==='New')
    const nextIndex = currentLeadIndex + 1

    if (nextIndex >= pendingLeads.length) {
      alert('🎉 All leads in this session called!')
      setDialerMode(false)
      fetchCampaignStats(selectedCampaign.id)
    } else {
      setCurrentLeadIndex(nextIndex)
      setCallForm({call_status:'Answered',call_outcome:'',duration:'',notes:''})
      if (dialerType==='auto') {
        const nextLead = pendingLeads[nextIndex]
        if (nextLead) setTimeout(()=>{ window.location.href='tel:'+nextLead.mobile }, 1500)
      }
    }
    setLoading(false)
  }

  const CALL_STATUSES = ['Answered','Missed','Busy','Not Reachable','Ringing','Engaged']

  // ========== DIALER VIEW ==========
  if (dialerMode && currentLead) {
    const pendingLeads = campaignLeads.filter(l=>l.status==='New')
    return (
      <div style={{minHeight:'100vh',background:'#F0F4F8'}}>
        <div style={{background:'#185FA5',padding:'14px 24px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:'16px'}}>
            <button onClick={()=>setDialerMode(false)}
              style={{background:'rgba(255,255,255,0.15)',border:'none',color:'white',padding:'7px 14px',borderRadius:'8px',cursor:'pointer',fontSize:'13px',fontWeight:'600'}}>
              ← Back
            </button>
            <div>
              <h2 style={{color:'white',margin:0,fontSize:'15px',fontWeight:'700'}}>
                {selectedCampaign.name}
              </h2>
              <p style={{color:'rgba(255,255,255,0.7)',fontSize:'12px',margin:'2px 0 0'}}>
                Lead {currentLeadIndex+1} of {pendingLeads.length} pending
              </p>
            </div>
          </div>

          {/* Dialer mode toggle — agent can switch anytime */}
          <div style={{display:'flex',alignItems:'center',gap:'8px',background:'rgba(255,255,255,0.1)',borderRadius:'10px',padding:'4px'}}>
            <button
              onClick={()=>setDialerType('manual')}
              style={{
                display:'flex',alignItems:'center',gap:'6px',
                padding:'7px 14px',borderRadius:'7px',border:'none',cursor:'pointer',
                fontSize:'12px',fontWeight:'600',
                background:dialerType==='manual'?'white':'transparent',
                color:dialerType==='manual'?'#185FA5':'rgba(255,255,255,0.7)',
                transition:'all 0.2s'
              }}>
              <IconHandClick size={15}/> Manual
            </button>
            <button
              onClick={()=>{
                setDialerType('auto')
                window.location.href='tel:'+currentLead.mobile
              }}
              style={{
                display:'flex',alignItems:'center',gap:'6px',
                padding:'7px 14px',borderRadius:'7px',border:'none',cursor:'pointer',
                fontSize:'12px',fontWeight:'600',
                background:dialerType==='auto'?'white':'transparent',
                color:dialerType==='auto'?'#185FA5':'rgba(255,255,255,0.7)',
                transition:'all 0.2s'
              }}>
              <IconRobot size={15}/> Auto
            </button>
          </div>
        </div>

        <div style={{maxWidth:'580px',margin:'0 auto',padding:'20px 16px'}}>

          {/* Progress */}
          <div style={{background:'white',borderRadius:'10px',padding:'14px 18px',
            marginBottom:'16px',border:'0.5px solid #E2E8F0'}}>
            <div style={{display:'flex',justifyContent:'space-between',
              fontSize:'12px',color:'#6B7280',marginBottom:'8px'}}>
              <span>Progress</span>
              <span style={{fontWeight:'600',color:'#185FA5'}}>
                {currentLeadIndex}/{pendingLeads.length} called this session
              </span>
            </div>
            <div style={{height:'6px',background:'#F3F4F6',borderRadius:'3px'}}>
              <div style={{
                height:'100%',borderRadius:'3px',background:'#185FA5',
                width:(pendingLeads.length>0?(currentLeadIndex/pendingLeads.length*100):0)+'%',
                transition:'width 0.3s'
              }}/>
            </div>
          </div>

          {/* Lead Card */}
          <div style={{background:'white',borderRadius:'16px',padding:'22px',
            boxShadow:'0 4px 20px rgba(0,0,0,0.08)',marginBottom:'16px',
            border:'0.5px solid #E2E8F0'}}>
            <div style={{display:'flex',alignItems:'center',gap:'14px',marginBottom:'18px'}}>
              <div style={{width:'52px',height:'52px',borderRadius:'50%',
                background:'#E6F1FB',display:'flex',alignItems:'center',
                justifyContent:'center',fontWeight:'700',color:'#185FA5',
                fontSize:'20px',flexShrink:0}}>
                {currentLead.full_name[0]?.toUpperCase()}
              </div>
              <div>
                <h2 style={{margin:0,fontSize:'18px',fontWeight:'700',color:'#111827'}}>
                  {currentLead.full_name}
                </h2>
                <p style={{margin:'3px 0 0',fontSize:'15px',color:'#185FA5',fontWeight:'600'}}>
                  {currentLead.mobile}
                </p>
              </div>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginBottom:'16px'}}>
              {[
                {label:'City', value:currentLead.city||'-'},
                {label:'Loan Amount', value:currentLead.loan_amount?'₹'+Number(currentLead.loan_amount).toLocaleString('en-IN'):'-'},
                {label:'Monthly Income', value:currentLead.budget_range||'-'},
                {label:'Source', value:currentLead.lead_source||'-'},
              ].map(item=>(
                <div key={item.label} style={{background:'#F9FAFB',padding:'9px 12px',
                  borderRadius:'8px',border:'0.5px solid #E5E7EB'}}>
                  <div style={{fontSize:'10px',color:'#9CA3AF',textTransform:'uppercase',
                    letterSpacing:'0.5px',marginBottom:'2px'}}>{item.label}</div>
                  <div style={{fontWeight:'600',fontSize:'13px',color:'#111827'}}>{item.value}</div>
                </div>
              ))}
            </div>

            {currentLead.notes && (
              <div style={{background:'#FFFAF0',border:'0.5px solid #F6E05E',
                borderRadius:'8px',padding:'10px',marginBottom:'14px',
                fontSize:'13px',color:'#744210'}}>
                {currentLead.notes}
              </div>
            )}

            <div style={{display:'flex',gap:'10px',alignItems:'center'}}>
              <a
                href={'tel:'+currentLead.mobile}
                style={{display:'flex',alignItems:'center',gap:'8px',background:'#185FA5',color:'white',padding:'12px 24px',borderRadius:'8px',textDecoration:'none',fontSize:'15px',fontWeight:'700'}}
              >
                <IconPhone size={20} /> Call {currentLead.mobile}
              </a>
            </div>
            {dialerType==='auto' && (
              <p style={{textAlign:'center',fontSize:'12px',color:'#9CA3AF',margin:'8px 0 0'}}>
                Auto mode — next lead opens automatically after saving
              </p>
            )}
          </div>

          {/* Log Call */}
          <div style={{background:'white',borderRadius:'16px',padding:'20px',
            boxShadow:'0 4px 20px rgba(0,0,0,0.08)',border:'0.5px solid #E2E8F0'}}>
            <h3 style={{margin:'0 0 14px',fontSize:'14px',fontWeight:'700',color:'#111827'}}>
              Log This Call
            </h3>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px',marginBottom:'12px'}}>
              <div>
                <label style={{display:'block',fontSize:'11px',fontWeight:'600',
                  color:'#6B7280',marginBottom:'5px',textTransform:'uppercase'}}>
                  Call Status
                </label>
                <select className="form-input" value={callForm.call_status}
                  onChange={e=>setCallForm({...callForm,call_status:e.target.value})}>
                  {CALL_STATUSES.map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={{display:'block',fontSize:'11px',fontWeight:'600',
                  color:'#6B7280',marginBottom:'5px',textTransform:'uppercase'}}>
                  Disposition *
                </label>
                <select className="form-input" value={callForm.call_outcome}
                  onChange={e=>setCallForm({...callForm,call_outcome:e.target.value})}>
                  <option value="">Select...</option>
                  {dispositions.map(d=><option key={d.id} value={d.label}>{d.label}</option>)}
                </select>
              </div>
              <div>
                <label style={{display:'block',fontSize:'11px',fontWeight:'600',
                  color:'#6B7280',marginBottom:'5px',textTransform:'uppercase'}}>
                  Duration
                </label>
                <input type="text" className="form-input" value={callForm.duration}
                  onChange={e=>setCallForm({...callForm,duration:e.target.value})}
                  placeholder="e.g. 3 mins"/>
              </div>
              <div>
                <label style={{display:'block',fontSize:'11px',fontWeight:'600',
                  color:'#6B7280',marginBottom:'5px',textTransform:'uppercase'}}>
                  Notes
                </label>
                <input type="text" className="form-input" value={callForm.notes}
                  onChange={e=>setCallForm({...callForm,notes:e.target.value})}
                  placeholder="Quick note..."/>
              </div>
            </div>
            <div style={{display:'flex',gap:'10px'}}>
              <button onClick={saveCallAndNext}
                disabled={loading||!callForm.call_outcome}
                style={{
                  flex:1,padding:'13px',
                  background:callForm.call_outcome?'#0F6E56':'#E5E7EB',
                  color:callForm.call_outcome?'white':'#9CA3AF',
                  border:'none',borderRadius:'10px',fontSize:'14px',
                  fontWeight:'700',cursor:callForm.call_outcome?'pointer':'not-allowed',
                  display:'flex',alignItems:'center',justifyContent:'center',gap:'8px'
                }}>
                <IconPlayerSkipForward size={16}/>
                {loading?'Saving...':'Save & Next Lead'}
              </button>
              <button onClick={()=>setDialerMode(false)}
                style={{padding:'13px 18px',background:'#F3F4F6',color:'#6B7280',
                  border:'none',borderRadius:'10px',fontSize:'13px',
                  fontWeight:'600',cursor:'pointer'}}>
                Pause
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ========== CAMPAIGN DETAIL VIEW ==========
  if (selectedCampaign) {
    const pendingLeads = campaignLeads.filter(l=>l.status==='New')
    const calledLeads = campaignLeads.filter(l=>l.status!=='New')

    return (
      <div>
        <div className="page-header">
          <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
            <button onClick={()=>setSelectedCampaign(null)}
              style={{background:'#F3F4F6',border:'none',borderRadius:'8px',
                padding:'8px 14px',cursor:'pointer',fontSize:'13px',
                fontWeight:'600',color:'#4B5563'}}>
              ← Back
            </button>
            <div>
              <h1 style={{display:'flex',alignItems:'center',gap:'8px'}}>
                {selectedCampaign.name}
                <span style={{
                  background:selectedCampaign.status==='active'?'#E1F5EE':'#F3F4F6',
                  color:selectedCampaign.status==='active'?'#0F6E56':'#9CA3AF',
                  padding:'2px 10px',borderRadius:'20px',fontSize:'12px',fontWeight:'600'
                }}>
                  {selectedCampaign.status}
                </span>
              </h1>
              <p>{selectedCampaign.description||'No description'}</p>
            </div>
          </div>
          <div style={{display:'flex',gap:'10px',flexWrap:'wrap'}}>
            {isAdminOrManager && (
              <>
                <button className="btn btn-ghost" onClick={()=>setShowAgentModal(true)}>
                  <IconUsers size={15}/> Manage Agents
                </button>
                <button className="btn btn-success" onClick={()=>setShowCSVModal(true)}>
                  <IconUpload size={15}/> Upload CSV
                </button>
              </>
            )}
            {pendingLeads.length > 0 && (
              <button className="btn btn-primary" onClick={startDialer}
                style={{display:'flex',alignItems:'center',gap:'7px'}}>
                <IconPlayerPlay size={15}/> Start Dialer
              </button>
            )}
          </div>
        </div>

        <div className="page-body">
          <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'14px',marginBottom:'24px'}}>
            {[
              {label:'Total Leads', value:campaignStats.total||0, color:'#185FA5', bg:'#E6F1FB'},
              {label:'Pending', value:campaignStats.pending||0, color:'#854F0B', bg:'#FAEEDA'},
              {label:'Called', value:campaignStats.called||0, color:'#534AB7', bg:'#EEEDFE'},
              {label:'Interested', value:campaignStats.interested||0, color:'#0F6E56', bg:'#E1F5EE'},
              {label:'Converted', value:campaignStats.converted||0, color:'#3B6D11', bg:'#EAF3DE'},
            ].map(s=>(
              <div key={s.label} style={{background:'white',padding:'16px',
                borderRadius:'12px',border:'0.5px solid #E2E8F0',
                borderLeft:'3px solid '+s.color}}>
                <div style={{fontSize:'26px',fontWeight:'700',color:s.color,lineHeight:1}}>{s.value}</div>
                <div style={{fontSize:'12px',color:'#9CA3AF',marginTop:'4px'}}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Assigned Agents */}
          {isAdminOrManager && campaignAgents.length > 0 && (
            <div className="card" style={{marginBottom:'20px'}}>
              <div className="card-header">
                <h3>Assigned Agents ({campaignAgents.length})</h3>
                <button className="btn btn-ghost btn-sm" onClick={()=>setShowAgentModal(true)}>
                  <IconUserPlus size={14}/> Add Agent
                </button>
              </div>
              <div style={{padding:'14px 18px',display:'flex',gap:'8px',flexWrap:'wrap'}}>
                {campaignAgents.map(agent=>(
                  <div key={agent?.id} style={{display:'flex',alignItems:'center',gap:'7px',
                    background:'#E6F1FB',padding:'6px 12px',borderRadius:'20px',
                    border:'0.5px solid #BEE3F8'}}>
                    <div style={{width:'22px',height:'22px',borderRadius:'50%',
                      background:'#185FA5',display:'flex',alignItems:'center',
                      justifyContent:'center',color:'white',fontSize:'10px',fontWeight:'700'}}>
                      {agent?.full_name[0]?.toUpperCase()}
                    </div>
                    <span style={{fontSize:'13px',fontWeight:'500',color:'#185FA5'}}>
                      {agent?.full_name}
                    </span>
                    <button onClick={()=>removeAgentFromCampaign(agent?.id)}
                      style={{background:'none',border:'none',cursor:'pointer',
                        color:'#A0AEC0',display:'flex',padding:'0',lineHeight:1,
                        marginLeft:'2px'}}
                      title="Remove from campaign">
                      <IconX size={12}/>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Leads Table */}
          <div className="table-container">
            <div style={{padding:'14px 18px',borderBottom:'0.5px solid #E2E8F0',
              display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontWeight:'600',fontSize:'14px'}}>
                Campaign Leads ({campaignLeads.length})
              </span>
              <div style={{display:'flex',gap:'8px'}}>
                <span style={{background:'#FAEEDA',color:'#854F0B',padding:'3px 10px',
                  borderRadius:'20px',fontSize:'12px',fontWeight:'500'}}>
                  {pendingLeads.length} Pending
                </span>
                <span style={{background:'#EAF3DE',color:'#3B6D11',padding:'3px 10px',
                  borderRadius:'20px',fontSize:'12px',fontWeight:'500'}}>
                  {calledLeads.length} Called
                </span>
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  {['#','Lead Name','Mobile','City','Loan Amount','Assigned To','Status',
                    ...(isAdminOrManager?['Reassign']:[]),'Date'].map(h=><th key={h}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {campaignLeads.length===0 ? (
                  <tr><td colSpan="9">
                    <div className="empty-state">
                      <span className="empty-icon"><IconUsers size={40} strokeWidth={1.2} color="#CBD5E0"/></span>
                      <h3>No leads yet</h3>
                      <p>Upload a CSV to add leads to this campaign</p>
                    </div>
                  </td></tr>
                ) : campaignLeads.map((lead,i)=>(
                  <tr key={lead.id}>
                    <td style={{color:'#A0AEC0',fontSize:'12px'}}>{i+1}</td>
                    <td>
                      <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                        <div style={{width:'28px',height:'28px',borderRadius:'50%',
                          background:'#E6F1FB',display:'flex',alignItems:'center',
                          justifyContent:'center',fontWeight:'600',color:'#185FA5',
                          fontSize:'11px',flexShrink:0}}>
                          {lead.full_name[0]?.toUpperCase()}
                        </div>
                        <span style={{fontWeight:'500',fontSize:'13px'}}>{lead.full_name}</span>
                      </div>
                    </td>
                    <td style={{padding:'0'}}>
                      <div style={{display:'flex',alignItems:'center',gap:'8px',color:'#718096',fontSize:'13px'}}>
                        <a href={'tel:'+lead.mobile} style={{textDecoration:'none',color:'#718096'}}>{lead.mobile}</a>
                      </div>
                    </td>
                    <td style={{color:'#718096',fontSize:'13px'}}>{lead.city||'-'}</td>
                    <td style={{fontWeight:'500',color:'#185FA5',fontSize:'13px'}}>
                      {lead.loan_amount?'₹'+Number(lead.loan_amount).toLocaleString('en-IN'):'-'}
                    </td>
                    <td style={{fontSize:'13px'}}>
                      <span style={{background:'#F3F4F6',color:'#4B5563',
                        padding:'3px 8px',borderRadius:'4px',fontSize:'12px'}}>
                        {lead.profiles?.full_name||'Unassigned'}
                      </span>
                    </td>
                    <td>
                      <span style={{
                        background:lead.status==='New'?'#F3F4F6':
                          lead.status==='Interested'?'#E1F5EE':
                          lead.status==='Not Interested'?'#FCEBEB':
                          lead.status==='Callback'?'#FAEEDA':'#EEEDFE',
                        color:lead.status==='New'?'#6B7280':
                          lead.status==='Interested'?'#0F6E56':
                          lead.status==='Not Interested'?'#A32D2D':
                          lead.status==='Callback'?'#854F0B':'#534AB7',
                        padding:'3px 10px',borderRadius:'20px',
                        fontSize:'12px',fontWeight:'500'
                      }}>
                        {lead.status}
                      </span>
                    </td>
                    {isAdminOrManager && (
                      <td>
                        <button
                          onClick={()=>{setSelectedLeadForReassign(lead);setReassignModal(true)}}
                          style={{display:'flex',alignItems:'center',gap:'5px',
                            background:'#F3F4F6',border:'0.5px solid #E2E8F0',
                            borderRadius:'6px',padding:'5px 10px',cursor:'pointer',
                            fontSize:'12px',color:'#4B5563',fontWeight:'500'}}>
                          <IconRefresh size={12}/> Reassign
                        </button>
                      </td>
                    )}
                    <td style={{color:'#A0AEC0',fontSize:'12px'}}>
                      {new Date(lead.created_at).toLocaleDateString('en-IN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* CSV Upload Modal */}
        {showCSVModal && (
          <>
            <div className="overlay" onClick={()=>setShowCSVModal(false)}/>
            <div style={{position:'fixed',top:'50%',left:'50%',
              transform:'translate(-50%,-50%)',background:'white',
              borderRadius:'16px',boxShadow:'0 20px 60px rgba(0,0,0,0.15)',
              zIndex:300,width:'90%',maxWidth:'560px',
              overflow:'hidden',maxHeight:'90vh',overflowY:'auto'}}>
              <div style={{background:'#185FA5',padding:'18px 22px',
                display:'flex',alignItems:'center',justifyContent:'space-between',
                position:'sticky',top:0,zIndex:1}}>
                <div>
                  <h3 style={{color:'white',margin:0,fontSize:'16px',fontWeight:'700'}}>
                    Upload Leads to Campaign
                  </h3>
                  <p style={{color:'rgba(255,255,255,0.7)',fontSize:'13px',margin:'3px 0 0'}}>
                    Select agents and upload CSV
                  </p>
                </div>
                <button onClick={()=>{setShowCSVModal(false);setCsvFile(null);setCsvPreview([]);setSelectedAgentsForCSV([])}}
                  style={{background:'rgba(255,255,255,0.15)',border:'none',
                    color:'white',width:'30px',height:'30px',borderRadius:'50%',
                    cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <IconX size={15}/>
                </button>
              </div>

              <div style={{padding:'22px'}}>

                {/* Step 1 — Select Agents */}
                <div style={{marginBottom:'20px'}}>
                  <label style={{display:'block',fontSize:'13px',fontWeight:'600',
                    color:'#374151',marginBottom:'8px'}}>
                    Step 1 — Select Agents *
                    <span style={{fontWeight:'400',color:'#9CA3AF',marginLeft:'8px'}}>
                      ({selectedAgentsForCSV.length} selected)
                    </span>
                  </label>
                  <div style={{display:'flex',flexDirection:'column',gap:'6px',
                    maxHeight:'200px',overflowY:'auto',border:'0.5px solid #E5E7EB',
                    borderRadius:'8px',padding:'8px'}}>
                    {allAgents.map(agent=>{
                      const isSelected = selectedAgentsForCSV.includes(agent.id)
                      return (
                        <div key={agent.id}
                          onClick={()=>toggleAgentForCSV(agent.id)}
                          style={{display:'flex',alignItems:'center',gap:'10px',
                            padding:'8px 10px',borderRadius:'6px',cursor:'pointer',
                            background:isSelected?'#E6F1FB':'transparent',
                            border:'0.5px solid '+(isSelected?'#BEE3F8':'transparent'),
                            transition:'all 0.15s'}}>
                          <div style={{width:'18px',height:'18px',borderRadius:'4px',
                            border:'1.5px solid '+(isSelected?'#185FA5':'#D1D5DB'),
                            background:isSelected?'#185FA5':'white',
                            display:'flex',alignItems:'center',justifyContent:'center',
                            flexShrink:0}}>
                            {isSelected && <IconCheck size={11} color="white" strokeWidth={3}/>}
                          </div>
                          <div style={{width:'28px',height:'28px',borderRadius:'50%',
                            background:isSelected?'#185FA5':'#F3F4F6',
                            display:'flex',alignItems:'center',justifyContent:'center',
                            fontSize:'11px',fontWeight:'600',
                            color:isSelected?'white':'#6B7280',flexShrink:0}}>
                            {agent.full_name[0]?.toUpperCase()}
                          </div>
                          <div>
                            <div style={{fontSize:'13px',fontWeight:'500',
                              color:isSelected?'#185FA5':'#111827'}}>
                              {agent.full_name}
                            </div>
                            <div style={{fontSize:'11px',color:'#9CA3AF'}}>{agent.email}</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div style={{display:'flex',gap:'8px',marginTop:'8px'}}>
                    <button onClick={()=>setSelectedAgentsForCSV(allAgents.map(a=>a.id))}
                      style={{fontSize:'12px',color:'#185FA5',background:'none',
                        border:'none',cursor:'pointer',fontWeight:'500',padding:'0'}}>
                      Select All
                    </button>
                    <span style={{color:'#D1D5DB'}}>·</span>
                    <button onClick={()=>setSelectedAgentsForCSV([])}
                      style={{fontSize:'12px',color:'#9CA3AF',background:'none',
                        border:'none',cursor:'pointer',fontWeight:'500',padding:'0'}}>
                      Clear All
                    </button>
                  </div>
                </div>

                {/* Distribution type */}
                {selectedAgentsForCSV.length > 1 && (
                  <div style={{marginBottom:'20px'}}>
                    <label style={{display:'block',fontSize:'13px',fontWeight:'600',
                      color:'#374151',marginBottom:'8px'}}>
                      How to distribute leads?
                    </label>
                    <div style={{display:'flex',gap:'10px'}}>
                      <div onClick={()=>setCsvDistribution('equal')}
                        style={{flex:1,padding:'12px',borderRadius:'8px',cursor:'pointer',
                          border:'1.5px solid '+(csvDistribution==='equal'?'#185FA5':'#E5E7EB'),
                          background:csvDistribution==='equal'?'#EBF8FF':'white',
                          transition:'all 0.15s'}}>
                        <div style={{fontWeight:'600',fontSize:'13px',
                          color:csvDistribution==='equal'?'#185FA5':'#111827',marginBottom:'3px'}}>
                          Equal Distribution
                        </div>
                        <div style={{fontSize:'12px',color:'#9CA3AF'}}>
                          Leads split equally among selected agents
                        </div>
                      </div>
                      <div onClick={()=>setCsvDistribution('single')}
                        style={{flex:1,padding:'12px',borderRadius:'8px',cursor:'pointer',
                          border:'1.5px solid '+(csvDistribution==='single'?'#185FA5':'#E5E7EB'),
                          background:csvDistribution==='single'?'#EBF8FF':'white',
                          transition:'all 0.15s'}}>
                        <div style={{fontWeight:'600',fontSize:'13px',
                          color:csvDistribution==='single'?'#185FA5':'#111827',marginBottom:'3px'}}>
                          First Agent Only
                        </div>
                        <div style={{fontSize:'12px',color:'#9CA3AF'}}>
                          All leads go to the first selected agent
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 2 — Upload CSV */}
                <div style={{marginBottom:'20px'}}>
                  <label style={{display:'block',fontSize:'13px',fontWeight:'600',
                    color:'#374151',marginBottom:'8px'}}>
                    Step 2 — Upload CSV File *
                  </label>
                  <div onClick={()=>csvRef.current.click()}
                    style={{border:'2px dashed '+(csvFile?'#3B6D11':'#E5E7EB'),
                      borderRadius:'10px',padding:'24px',textAlign:'center',
                      cursor:'pointer',background:csvFile?'#F0FFF4':'#FAFAFA',
                      transition:'all 0.2s'}}>
                    <input ref={csvRef} type="file" accept=".csv"
                      style={{display:'none'}} onChange={handleCSVSelect}/>
                    {csvFile ? (
                      <div>
                        <div style={{fontSize:'22px',marginBottom:'6px',color:'#3B6D11',fontWeight:700}}>✓</div>
                        <div style={{fontWeight:'600',color:'#3B6D11',fontSize:'14px'}}>
                          {csvFile.name}
                        </div>
                        <div style={{fontSize:'12px',color:'#9CA3AF',marginTop:'3px'}}>
                          {csvPreview.length}+ leads ready
                        </div>
                      </div>
                    ) : (
                      <div>
                        <IconUpload size={24} color="#9CA3AF" strokeWidth={1.5}/>
                        <div style={{fontSize:'14px',color:'#6B7280',marginTop:'8px'}}>
                          Click to select CSV
                        </div>
                        <div style={{fontSize:'12px',color:'#9CA3AF',marginTop:'4px'}}>
                          Required columns: full_name, mobile
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Preview */}
                {csvPreview.length > 0 && (
                  <div style={{marginBottom:'16px',background:'#F9FAFB',
                    borderRadius:'8px',border:'0.5px solid #E5E7EB',overflow:'hidden'}}>
                    <div style={{padding:'8px 12px',background:'#F3F4F6',
                      fontSize:'11px',fontWeight:'600',color:'#6B7280',
                      textTransform:'uppercase',letterSpacing:'0.5px'}}>
                      Preview — {csvPreview.length} sample rows
                    </div>
                    {csvPreview.map((row,i)=>(
                      <div key={i} style={{padding:'8px 12px',
                        borderTop:'0.5px solid #E5E7EB',
                        display:'flex',gap:'16px',fontSize:'13px'}}>
                        <span style={{fontWeight:'500',color:'#111827',minWidth:'120px'}}>
                          {row.full_name}
                        </span>
                        <span style={{color:'#6B7280'}}>{row.mobile}</span>
                        <span style={{color:'#9CA3AF'}}>{row.city||''}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Summary */}
                {selectedAgentsForCSV.length > 0 && (
                  <div style={{background:'#EBF8FF',border:'0.5px solid #BEE3F8',
                    borderRadius:'8px',padding:'12px 14px',marginBottom:'16px',
                    fontSize:'13px',color:'#185FA5'}}>
                    <div style={{fontWeight:'600',marginBottom:'4px'}}>Summary:</div>
                    <div>• {selectedAgentsForCSV.length} agent(s) selected</div>
                    <div>• Distribution: {selectedAgentsForCSV.length>1?csvDistribution:'all to one agent'}</div>
                    {selectedAgentsForCSV.map(id=>(
                      <div key={id} style={{paddingLeft:'12px',fontSize:'12px',color:'#2B6CB0'}}>
                        — {allAgents.find(a=>a.id===id)?.full_name}
                      </div>
                    ))}
                  </div>
                )}

                <div style={{display:'flex',gap:'10px'}}>
                  <button onClick={handleCSVUpload}
                    disabled={loading||!csvFile||selectedAgentsForCSV.length===0}
                    className="btn btn-primary"
                    style={{flex:1,
                      opacity:(!csvFile||selectedAgentsForCSV.length===0)?0.5:1}}>
                    {loading?'Uploading...':'Upload & Assign Leads'}
                  </button>
                  <button
                    onClick={()=>{setShowCSVModal(false);setCsvFile(null);setCsvPreview([]);setSelectedAgentsForCSV([])}}
                    className="btn btn-ghost">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Manage Agents Modal */}
        {showAgentModal && (
          <>
            <div className="overlay" onClick={()=>setShowAgentModal(false)}/>
            <div style={{position:'fixed',top:'50%',left:'50%',
              transform:'translate(-50%,-50%)',background:'white',
              borderRadius:'16px',boxShadow:'0 20px 60px rgba(0,0,0,0.15)',
              zIndex:300,width:'90%',maxWidth:'460px',overflow:'hidden'}}>
              <div style={{background:'#185FA5',padding:'18px 22px',
                display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <h3 style={{color:'white',margin:0,fontSize:'16px',fontWeight:'700'}}>
                  Manage Agents
                </h3>
                <button onClick={()=>setShowAgentModal(false)}
                  style={{background:'rgba(255,255,255,0.15)',border:'none',
                    color:'white',width:'30px',height:'30px',borderRadius:'50%',
                    cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <IconX size={15}/>
                </button>
              </div>
              <div style={{padding:'20px'}}>
                <p style={{fontSize:'13px',color:'#6B7280',marginBottom:'14px'}}>
                  Assign or remove agents from this campaign.
                </p>
                <div style={{display:'flex',flexDirection:'column',gap:'8px',
                  maxHeight:'350px',overflowY:'auto'}}>
                  {allAgents.map(agent=>{
                    const isAssigned = campaignAgents.some(ca=>ca?.id===agent.id)
                    return (
                      <div key={agent.id} style={{display:'flex',alignItems:'center',
                        justifyContent:'space-between',padding:'11px 14px',
                        borderRadius:'8px',border:'0.5px solid #E5E7EB',
                        background:isAssigned?'#EBF8FF':'white'}}>
                        <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                          <div style={{width:'34px',height:'34px',borderRadius:'50%',
                            background:isAssigned?'#185FA5':'#F3F4F6',
                            display:'flex',alignItems:'center',justifyContent:'center',
                            fontWeight:'600',color:isAssigned?'white':'#9CA3AF',fontSize:'13px'}}>
                            {agent.full_name[0]?.toUpperCase()}
                          </div>
                          <div>
                            <div style={{fontWeight:'500',fontSize:'13px',color:'#111827'}}>
                              {agent.full_name}
                            </div>
                            <div style={{fontSize:'11px',color:'#9CA3AF'}}>{agent.role.replace('_',' ')}</div>
                          </div>
                        </div>
                        <button
                          onClick={()=>isAssigned?removeAgentFromCampaign(agent.id):assignAgentToCampaign(agent.id)}
                          style={{padding:'6px 14px',borderRadius:'6px',border:'none',
                            fontSize:'12px',fontWeight:'600',cursor:'pointer',
                            background:isAssigned?'#FCEBEB':'#185FA5',
                            color:isAssigned?'#A32D2D':'white'}}>
                          {isAssigned?'Remove':'Assign'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Reassign Lead Modal */}
        {reassignModal && selectedLeadForReassign && (
          <>
            <div className="overlay" onClick={()=>setReassignModal(false)}/>
            <div style={{position:'fixed',top:'50%',left:'50%',
              transform:'translate(-50%,-50%)',background:'white',
              borderRadius:'16px',boxShadow:'0 20px 60px rgba(0,0,0,0.15)',
              zIndex:300,width:'90%',maxWidth:'400px',overflow:'hidden'}}>
              <div style={{background:'#185FA5',padding:'16px 20px',
                display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <h3 style={{color:'white',margin:0,fontSize:'15px',fontWeight:'700'}}>
                  Reassign Lead
                </h3>
                <button onClick={()=>setReassignModal(false)}
                  style={{background:'rgba(255,255,255,0.15)',border:'none',
                    color:'white',width:'28px',height:'28px',borderRadius:'50%',
                    cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <IconX size={14}/>
                </button>
              </div>
              <div style={{padding:'18px'}}>
                <div style={{background:'#F9FAFB',borderRadius:'8px',
                  padding:'12px',marginBottom:'16px',border:'0.5px solid #E5E7EB'}}>
                  <div style={{fontWeight:'600',fontSize:'14px',color:'#111827'}}>
                    {selectedLeadForReassign.full_name}
                  </div>
                  <div style={{fontSize:'13px',color:'#6B7280',marginTop:'2px'}}>
                    {selectedLeadForReassign.mobile}
                  </div>
                </div>
                <label style={{display:'block',fontSize:'13px',fontWeight:'600',
                  color:'#374151',marginBottom:'8px'}}>
                  Assign to Agent
                </label>
                <div style={{display:'flex',flexDirection:'column',gap:'6px',
                  maxHeight:'250px',overflowY:'auto'}}>
                  {allAgents.map(agent=>(
                    <div key={agent.id}
                      onClick={()=>reassignLead(selectedLeadForReassign.id,agent.id)}
                      style={{display:'flex',alignItems:'center',gap:'10px',
                        padding:'10px 12px',borderRadius:'8px',cursor:'pointer',
                        border:'0.5px solid #E5E7EB',transition:'all 0.15s',
                        background: selectedLeadForReassign.assigned_to===agent.id?'#EBF8FF':'white'}}
                      onMouseEnter={e=>e.currentTarget.style.background='#F3F4F6'}
                      onMouseLeave={e=>e.currentTarget.style.background=
                        selectedLeadForReassign.assigned_to===agent.id?'#EBF8FF':'white'}>
                      <div style={{width:'32px',height:'32px',borderRadius:'50%',
                        background:'#E6F1FB',display:'flex',alignItems:'center',
                        justifyContent:'center',fontWeight:'600',color:'#185FA5',
                        fontSize:'12px',flexShrink:0}}>
                        {agent.full_name[0]?.toUpperCase()}
                      </div>
                      <div style={{flex:1}}>
                        <div style={{fontWeight:'500',fontSize:'13px',color:'#111827'}}>
                          {agent.full_name}
                        </div>
                        <div style={{fontSize:'11px',color:'#9CA3AF'}}>{agent.email}</div>
                      </div>
                      {selectedLeadForReassign.assigned_to===agent.id && (
                        <span style={{fontSize:'11px',color:'#185FA5',fontWeight:'600'}}>
                          Current
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    )
  }

  // ========== CAMPAIGN LIST VIEW ==========
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <IconBuildingStore size={22} strokeWidth={1.6}/> Campaigns
          </h1>
          <p>{campaigns.filter(c=>c.status==='active').length} active campaigns</p>
        </div>
        {isAdminOrManager && (
          <button className="btn btn-primary" onClick={()=>setShowCreateForm(!showCreateForm)}>
            {showCreateForm?'Cancel':'+ New Campaign'}
          </button>
        )}
      </div>

      <div className="page-body">
        {showCreateForm && (
          <div className="card" style={{marginBottom:'20px'}}>
            <div className="card-header">
              <h3>Create New Campaign</h3>
              <button className="btn btn-ghost btn-sm" onClick={()=>setShowCreateForm(false)}>✕</button>
            </div>
            <div className="card-body">
              <form onSubmit={createCampaign}>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Campaign Name *</label>
                    <input type="text" className="form-input" value={form.name}
                      onChange={e=>setForm({...form,name:e.target.value})}
                      required placeholder="e.g. Dialer 1, June Campaign"/>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Default Dialer Type</label>
                    <select className="form-input" value={form.dialer_type}
                      onChange={e=>setForm({...form,dialer_type:e.target.value})}>
                      <option value="manual">Manual Dialer — Agent calls manually</option>
                      <option value="auto">Auto Dialer — Next lead loads automatically</option>
                    </select>
                  </div>
                  <div className="form-group" style={{gridColumn:'span 2'}}>
                    <label className="form-label">Description (Optional)</label>
                    <input type="text" className="form-input" value={form.description}
                      onChange={e=>setForm({...form,description:e.target.value})}
                      placeholder="e.g. Experienced agents, Fresh leads batch"/>
                  </div>
                </div>
                <div style={{background:'#EBF8FF',border:'0.5px solid #BEE3F8',
                  borderRadius:'8px',padding:'11px 14px',marginBottom:'16px',
                  fontSize:'13px',color:'#185FA5'}}>
                  ℹ️ Agents can switch between Manual and Auto dialer anytime during calling
                </div>
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  {loading?'Creating...':'Create Campaign'}
                </button>
              </form>
            </div>
          </div>
        )}

        {campaigns.length===0 ? (
          <div className="card">
            <div className="empty-state">
              <span className="empty-icon">
                <IconBuildingStore size={48} strokeWidth={1.2} color="#CBD5E0"/>
              </span>
              <h3>{isAgent?'No campaigns assigned to you':'No campaigns yet'}</h3>
              <p>{isAgent?'Ask your admin to assign you to a campaign':'Create your first campaign to get started'}</p>
            </div>
          </div>
        ) : (
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'16px'}}>
            {campaigns.map(campaign=>(
              <div key={campaign.id} style={{background:'white',borderRadius:'14px',
                border:'0.5px solid #E2E8F0',overflow:'hidden',
                boxShadow:'0 2px 8px rgba(0,0,0,0.06)',transition:'all 0.2s'}}
                onMouseEnter={e=>e.currentTarget.style.boxShadow='0 8px 24px rgba(0,0,0,0.1)'}
                onMouseLeave={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'}>
                <div style={{
                  background:campaign.status==='active'
                    ?'linear-gradient(135deg,#185FA5,#2563EB)'
                    :'linear-gradient(135deg,#9CA3AF,#6B7280)',
                  padding:'20px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'14px'}}>
                    <div style={{width:'40px',height:'40px',borderRadius:'10px',
                      background:'rgba(255,255,255,0.15)',
                      display:'flex',alignItems:'center',justifyContent:'center'}}>
                      {campaign.dialer_type==='auto'
                        ? <IconRobot size={20} color="white" strokeWidth={1.8}/>
                        : <IconHandClick size={20} color="white" strokeWidth={1.8}/>
                      }
                    </div>
                    <span style={{background:'rgba(255,255,255,0.2)',color:'white',
                      padding:'3px 10px',borderRadius:'20px',fontSize:'11px',fontWeight:'600'}}>
                      {campaign.status}
                    </span>
                  </div>
                  <h3 style={{color:'white',margin:'0 0 4px',fontSize:'16px',fontWeight:'700'}}>
                    {campaign.name}
                  </h3>
                  <p style={{color:'rgba(255,255,255,0.65)',fontSize:'12px',margin:0}}>
                    {campaign.dialer_type==='auto'?'Auto Dialer (default)':'Manual Dialer (default)'}
                  </p>
                  {campaign.description && (
                    <p style={{color:'rgba(255,255,255,0.55)',fontSize:'12px',margin:'6px 0 0'}}>
                      {campaign.description}
                    </p>
                  )}
                </div>
                <div style={{padding:'14px 16px',display:'flex',gap:'8px'}}>
                  <button onClick={()=>openCampaign(campaign)}
                    className="btn btn-primary btn-sm" style={{flex:1}}>
                    {isAgent?'Open & Call':'View Campaign'}
                  </button>
                  {isAdminOrManager && campaign.status==='active' && (
                    <button onClick={(e)=>{e.stopPropagation();closeCampaign(campaign.id)}}
                      className="btn btn-ghost btn-sm">
                      Close
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}