// ========== AGENT DASHBOARD ==========
function AgentDashboard({ userId }) {
  const [myLeads, setMyLeads] = useState([])
  const [myCalls, setMyCalls] = useState([])
  const [myTasks, setMyTasks] = useState([])
  const [profile, setProfile] = useState(null)
  const [dateRange, setDateRange] = useState('today')
  const [loading, setLoading] = useState(true)
  const [notifications, setNotifications] = useState([])
  const [showNotifPanel, setShowNotifPanel] = useState(false)
  const [reminderPopup, setReminderPopup] = useState(null)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [activeTab, setActiveTab] = useState('leads')
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportStatus, setExportStatus] = useState('')
  const [exportDateType, setExportDateType] = useState('all')
  const [exportStartDate, setExportStartDate] = useState('')
  const [exportEndDate, setExportEndDate] = useState('')
  const [callingLead, setCallingLead]     = useState(null)
const [showWorkspace, setShowWorkspace] = useState(false)
const [leadQueue, setLeadQueue]         = useState([])
const [queueIndex, setQueueIndex]       = useState(0)
  const [mirroredLeadIds, setMirroredLeadIds] = useState(new Set())
  const [newLeadAlert, setNewLeadAlert]       = useState(null)

  useEffect(() => { fetchAll() }, [dateRange])

  useEffect(() => {
    checkReminders()
    const interval = setInterval(checkReminders, 60000)
    return () => clearInterval(interval)
  }, [userId])

  const checkReminders = useCallback(async () => {
    if (!userId) return
    const now = new Date()
    const fiveMin = new Date(now.getTime() + 5 * 60 * 1000)
    const { data: upcoming } = await supabase
      .from('tasks').select('*').eq('assigned_to', userId)
      .in('status', ['Pending','In Progress'])
      .gte('due_date', now.toISOString())
      .lte('due_date', fiveMin.toISOString())
    const { data: overdue } = await supabase
      .from('tasks').select('*').eq('assigned_to', userId)
      .in('status', ['Pending','In Progress'])
      .lt('due_date', now.toISOString())
    const all = [...(upcoming||[]), ...(overdue||[])]
    const unique = all.filter((t,i,a)=>a.findIndex(x=>x.id===t.id)===i)
    setNotifications(unique)
    if (upcoming && upcoming.length > 0 && !reminderPopup) setReminderPopup(upcoming[0])
  }, [userId])

  const fetchAll = async () => {
    setLoading(true)
    const now = new Date()
    let startDate = new Date()
    if (dateRange==='today') startDate.setHours(0,0,0,0)
    else if (dateRange==='week') startDate.setDate(now.getDate()-7)
    else if (dateRange==='month') startDate.setDate(1)
    const [leadsRes, mirrorRes, callsRes, tasksRes, profileRes] = await Promise.all([
      supabase.from('leads').select('*').eq('assigned_to', userId).order('created_at',{ascending:false}),
      supabase.from('leads').select('*').contains('mirror_agents', [userId]).order('created_at',{ascending:false}),
      supabase.from('calls').select('*').eq('agent_id', userId).gte('created_at', startDate.toISOString()),
      supabase.from('tasks').select('*').eq('assigned_to', userId).order('due_date',{ascending:true}),
      supabase.from('profiles').select('*').eq('id', userId).single(),
    ])
    const ownLeads = leadsRes.data||[]
    const mirroredLeads = (mirrorRes.data||[]).filter(l=>!ownLeads.find(o=>o.id===l.id))
    setMirroredLeadIds(new Set(mirroredLeads.map(l=>l.id)))
    setMyLeads([...ownLeads,...mirroredLeads])
    setMyCalls(callsRes.data||[])
    setMyTasks(tasksRes.data||[])
    setProfile(profileRes.data)
    setLoading(false)
  }

  useEffect(() => {
    if(!userId) return

    const playBuzz = () => {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)()
        const buzz = (freq, start, dur) => {
          const o = ctx.createOscillator()
          const g = ctx.createGain()
          o.connect(g); g.connect(ctx.destination)
          o.frequency.value = freq
          g.gain.setValueAtTime(0.8, ctx.currentTime + start)
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur)
          o.start(ctx.currentTime + start)
          o.stop(ctx.currentTime + start + dur)
        }
        buzz(880, 0, 0.3)
        buzz(1100, 0.3, 0.3)
        buzz(880, 0.6, 0.3)
        buzz(1100, 0.9, 0.5)
      } catch(e) { console.log('Audio error:', e) }
      if(navigator.vibrate) navigator.vibrate([400,100,400,100,400])
    }

    const channel = supabase
      .channel('leads-alert-'+userId)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'leads',
        filter: `assigned_to=eq.${userId}`
      }, (payload) => {
        if(payload.new.assigned_to === userId && payload.old.assigned_to !== userId) {
          playBuzz()
          setNewLeadAlert(payload.new)
        }
        fetchAll()
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'leads',
        filter: `assigned_to=eq.${userId}`
      }, (payload) => {
        playBuzz()
        setNewLeadAlert(payload.new)
        fetchAll()
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'leads'
      }, (payload) => {
        const newMirrors = payload.new.mirror_agents || []
        const oldMirrors = payload.old.mirror_agents || []
        if(newMirrors.includes(userId) && !oldMirrors.includes(userId)) {
          playBuzz()
          setNewLeadAlert({...payload.new, alertMessage: 'A lead has been shared with you!'})
        }
        if(newMirrors.includes(userId) || oldMirrors.includes(userId)) {
          fetchAll()
        }
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [userId]) // eslint-disable-line

  // Smart filtered export
  const getExportLeads = () => {
    let leads = [...myLeads]
    if (exportStatus) leads = leads.filter(l=>l.status===exportStatus)
    if (exportDateType==='today') {
      const today = new Date(); today.setHours(0,0,0,0)
      leads = leads.filter(l=>new Date(l.created_at)>=today)
    } else if (exportDateType==='week') {
      const w = new Date(); w.setDate(w.getDate()-7)
      leads = leads.filter(l=>new Date(l.created_at)>=w)
    } else if (exportDateType==='month') {
      const m = new Date(); m.setDate(1); m.setHours(0,0,0,0)
      leads = leads.filter(l=>new Date(l.created_at)>=m)
    } else if (exportDateType==='custom' && exportStartDate && exportEndDate) {
      const start = new Date(exportStartDate)
      const end = new Date(exportEndDate); end.setHours(23,59,59,999)
      leads = leads.filter(l=>new Date(l.created_at)>=start && new Date(l.created_at)<=end)
    }
    return leads
  }

  const handleExport = () => {
    const leads = getExportLeads()
    if (leads.length===0) { alert('No leads found for selected filters!'); return }
    const headers = ['Name','Mobile','Email','City','Loan Amount','Monthly Income','Source','Status','Notes','Created Date']
    const rows = leads.map(l=>[
      l.full_name||'', l.mobile||'', l.email||'', l.city||'',
      l.loan_amount||'', l.budget_range||'',
      l.lead_source||'', l.status||'',
      (l.notes||'').replace(/\n/g,' ').replace(/,/g,' '),
      new Date(l.created_at).toLocaleDateString('en-IN')
    ])
    const csv = [headers,...rows].map(r=>r.map(v=>`"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv],{type:'text/csv'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const statusLabel = exportStatus||'All'
    const dateLabel = exportDateType==='custom'?`${exportStartDate}_to_${exportEndDate}`:exportDateType
    a.href=url
    a.download=`leads_${statusLabel}_${dateLabel}_${profile?.full_name?.replace(/ /g,'_')}.csv`
    a.click()
    setShowExportModal(false)
  }

  const pendingTasks = myTasks.filter(t=>t.status!=='Completed')
  const overdueTasks = myTasks.filter(t=>new Date(t.due_date)<new Date()&&t.status!=='Completed')

  const STATUS_OPTIONS = [
    'New','Interested','Callback','Documents Pending',
    'Logged','Approved','Disbursed','Not Interested','DND'
  ]

  const filteredLeads = myLeads.filter(l=>{
    const matchSearch = !search||
      l.full_name?.toLowerCase().includes(search.toLowerCase())||
      l.mobile?.includes(search)||
      l.city?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = !filterStatus||l.status===filterStatus
    return matchSearch && matchStatus
  })

  const exportPreviewCount = getExportLeads().length

  return (
    <div>
      {/* New Lead Alert */}
      {newLeadAlert && (
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.65)',zIndex:9000}} onClick={()=>setNewLeadAlert(null)}/>
          <div style={{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',background:'white',borderRadius:20,boxShadow:'0 25px 80px rgba(0,0,0,0.5)',zIndex:9001,width:'90%',maxWidth:400,overflow:'hidden'}}>
            <div style={{background:'linear-gradient(135deg,#185FA5,#0C3A6B)',padding:'28px 24px',textAlign:'center'}}>
              <div style={{fontSize:56,marginBottom:8}}>🔔</div>
              <div style={{fontSize:22,fontWeight:800,color:'white',marginBottom:6}}>
                {newLeadAlert.alertMessage || 'New Lead Assigned!'}
              </div>
              <div style={{fontSize:13,color:'rgba(255,255,255,0.85)'}}>
                You have a new lead to follow up
              </div>
            </div>
            <div style={{padding:'20px 24px'}}>
              <div style={{background:'#f0f9ff',borderRadius:12,padding:'16px',marginBottom:16,border:'1px solid #bae6fd'}}>
                <div style={{fontWeight:700,fontSize:17,color:'#0c4a6e',marginBottom:6}}>{newLeadAlert.full_name||'New Lead'}</div>
                <div style={{fontSize:13,color:'#0369a1',marginBottom:3}}>📱 {newLeadAlert.mobile||'—'}</div>
                {newLeadAlert.city&&<div style={{fontSize:13,color:'#0369a1',marginBottom:3}}>📍 {newLeadAlert.city}</div>}
                {newLeadAlert.loan_amount&&<div style={{fontSize:13,color:'#0369a1'}}>💰 ₹{Number(newLeadAlert.loan_amount).toLocaleString('en-IN')}</div>}
              </div>
              <div style={{display:'flex',gap:10}}>
                <button onClick={()=>{ setNewLeadAlert(null); setActiveTab('leads') }} style={{flex:1,padding:'13px',background:'#185FA5',color:'white',border:'none',borderRadius:10,fontSize:15,fontWeight:700,cursor:'pointer'}}>
                  View Lead →
                </button>
                <button onClick={()=>setNewLeadAlert(null)} style={{padding:'13px 16px',background:'#f3f4f6',color:'#6b7280',border:'none',borderRadius:10,fontSize:14,cursor:'pointer'}}>
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Reminder Popup */}
      {reminderPopup&&(
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:400}} onClick={()=>setReminderPopup(null)}/>
          <div style={{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',background:'white',borderRadius:'16px',boxShadow:'0 20px 60px rgba(0,0,0,0.2)',zIndex:500,width:'90%',maxWidth:'420px',overflow:'hidden'}}>
            <div style={{background:'linear-gradient(135deg,#854F0B,#C05621)',padding:'20px 24px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
                <div style={{width:'40px',height:'40px',borderRadius:'50%',background:'rgba(255,255,255,0.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'20px'}}>🔔</div>
                <div>
                  <h3 style={{color:'white',margin:0,fontSize:'15px',fontWeight:'700'}}>Follow-up Reminder!</h3>
                  <p style={{color:'rgba(255,255,255,0.8)',fontSize:'12px',margin:'3px 0 0'}}>Task due very soon</p>
                </div>
              </div>
              <button onClick={()=>setReminderPopup(null)} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',width:'30px',height:'30px',borderRadius:'50%',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><IconX size={14}/></button>
            </div>
            <div style={{padding:'20px 24px'}}>
              <div style={{background:'#FFFAF0',borderRadius:'10px',padding:'16px',border:'0.5px solid #F6E05E',marginBottom:'16px'}}>
                <div style={{fontWeight:'700',fontSize:'15px',color:'#744210',marginBottom:'6px'}}>{reminderPopup.title}</div>
                <div style={{fontSize:'13px',color:'#975A16'}}>Due: {new Date(reminderPopup.due_date).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
                {reminderPopup.notes&&<div style={{fontSize:'13px',color:'#975A16',marginTop:'6px'}}>📝 {reminderPopup.notes}</div>}
              </div>
              <div style={{display:'flex',gap:'10px'}}>
                <button onClick={()=>setReminderPopup(null)} className="btn btn-primary" style={{flex:1}}>✅ Got it!</button>
                <button onClick={()=>setReminderPopup(null)} className="btn btn-ghost">Dismiss</button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Notification Panel */}
      {showNotifPanel&&(
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.3)',zIndex:200}} onClick={()=>setShowNotifPanel(false)}/>
          <div style={{position:'fixed',top:0,right:0,width:'360px',height:'100vh',background:'white',boxShadow:'-4px 0 24px rgba(0,0,0,0.12)',zIndex:300,display:'flex',flexDirection:'column'}}>
            <div style={{background:'#185FA5',padding:'20px 24px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <h3 style={{color:'white',margin:0,fontSize:'16px',fontWeight:'700',display:'flex',alignItems:'center',gap:'8px'}}><IconBell size={18}/> Reminders</h3>
              <button onClick={()=>setShowNotifPanel(false)} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',width:'30px',height:'30px',borderRadius:'50%',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><IconX size={14}/></button>
            </div>
            <div style={{flex:1,overflowY:'auto',padding:'16px'}}>
              {notifications.length===0?(
                <div style={{textAlign:'center',padding:'40px 20px',color:'#A0AEC0'}}>
                  <IconBell size={36} strokeWidth={1.2} color="#CBD5E0"/>
                  <p style={{marginTop:'12px',fontSize:'14px'}}>No pending reminders!</p>
                </div>
              ):notifications.map(task=>{
                const isOverdue = new Date(task.due_date)<new Date()
                return (
                  <div key={task.id} style={{background:isOverdue?'#FFF5F5':'#FFFAF0',border:'0.5px solid '+(isOverdue?'#FED7D7':'#F6E05E'),borderRadius:'10px',padding:'14px',marginBottom:'10px',borderLeft:'3px solid '+(isOverdue?'#A32D2D':'#854F0B')}}>
                    <div style={{fontWeight:'600',fontSize:'13px',color:isOverdue?'#A32D2D':'#744210',marginBottom:'4px'}}>{isOverdue&&'⚠️ OVERDUE: '}{task.title}</div>
                    {task.notes&&<div style={{fontSize:'12px',color:'#9CA3AF',marginBottom:'4px'}}>📝 {task.notes}</div>}
                    <div style={{fontSize:'12px',color:isOverdue?'#A32D2D':'#975A16',fontWeight:'500'}}>🕐 {new Date(task.due_date).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
                  </div>
                )
              })}
            </div>
            <div style={{padding:'16px',borderTop:'0.5px solid #F3F4F6'}}>
              <button onClick={()=>{setNotifications([]);setShowNotifPanel(false)}} className="btn btn-ghost" style={{width:'100%'}}>Clear All</button>
            </div>
          </div>
        </>
      )}

      {/* ===== SMART EXPORT MODAL ===== */}
      {showExportModal&&(
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:300}} onClick={()=>setShowExportModal(false)}/>
          <div style={{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',background:'white',borderRadius:'16px',boxShadow:'0 20px 60px rgba(0,0,0,0.15)',zIndex:400,width:'90%',maxWidth:'500px',overflow:'hidden'}}>
            <div style={{background:'linear-gradient(135deg,#185FA5,#2563EB)',padding:'20px 24px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div>
                <h3 style={{color:'white',margin:0,fontSize:'16px',fontWeight:'700'}}>Export My Leads Report</h3>
                <p style={{color:'rgba(255,255,255,0.7)',fontSize:'13px',margin:'3px 0 0'}}>Filter and download as CSV</p>
              </div>
              <button onClick={()=>setShowExportModal(false)} style={{background:'rgba(255,255,255,0.15)',border:'none',color:'white',width:'30px',height:'30px',borderRadius:'50%',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><IconX size={15}/></button>
            </div>

            <div style={{padding:'24px'}}>

              {/* Filter by Status */}
              <div style={{marginBottom:'20px'}}>
                <label style={{display:'block',fontSize:'13px',fontWeight:'600',color:'#374151',marginBottom:'8px'}}>
                  Filter by Lead Status
                </label>
                <div style={{display:'flex',flexWrap:'wrap',gap:'8px'}}>
                  <div
                    onClick={()=>setExportStatus('')}
                    style={{padding:'6px 14px',borderRadius:'20px',border:'1.5px solid '+(exportStatus===''?'#185FA5':'#E5E7EB'),background:exportStatus===''?'#185FA5':'white',color:exportStatus===''?'white':'#6B7280',fontSize:'13px',fontWeight:'500',cursor:'pointer',transition:'all 0.15s'}}>
                    All Leads
                  </div>
                  {STATUS_OPTIONS.map(s=>(
                    <div key={s}
                      onClick={()=>setExportStatus(s)}
                      style={{padding:'6px 14px',borderRadius:'20px',border:'1.5px solid '+(exportStatus===s?'#185FA5':'#E5E7EB'),background:exportStatus===s?'#185FA5':'white',color:exportStatus===s?'white':'#6B7280',fontSize:'13px',fontWeight:'500',cursor:'pointer',transition:'all 0.15s'}}>
                      {s}
                    </div>
                  ))}
                </div>
              </div>

              {/* Filter by Date */}
              <div style={{marginBottom:'20px'}}>
                <label style={{display:'block',fontSize:'13px',fontWeight:'600',color:'#374151',marginBottom:'8px'}}>
                  Filter by Date
                </label>
                <div style={{display:'flex',gap:'8px',marginBottom:'12px',flexWrap:'wrap'}}>
                  {[
                    {id:'all',label:'All Time'},
                    {id:'today',label:'Today'},
                    {id:'week',label:'This Week'},
                    {id:'month',label:'This Month'},
                    {id:'custom',label:'Custom Range'},
                  ].map(d=>(
                    <div key={d.id}
                      onClick={()=>setExportDateType(d.id)}
                      style={{padding:'6px 14px',borderRadius:'20px',border:'1.5px solid '+(exportDateType===d.id?'#185FA5':'#E5E7EB'),background:exportDateType===d.id?'#185FA5':'white',color:exportDateType===d.id?'white':'#6B7280',fontSize:'13px',fontWeight:'500',cursor:'pointer',transition:'all 0.15s'}}>
                      {d.label}
                    </div>
                  ))}
                </div>

                {/* Custom date pickers */}
                {exportDateType==='custom'&&(
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',background:'#F9FAFB',padding:'14px',borderRadius:'10px',border:'0.5px solid #E5E7EB'}}>
                    <div>
                      <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#6B7280',marginBottom:'6px',textTransform:'uppercase',letterSpacing:'0.5px'}}>From Date</label>
                      <input type="date" className="form-input"
                        value={exportStartDate}
                        onChange={e=>setExportStartDate(e.target.value)}
                        style={{padding:'8px 12px',fontSize:'13px'}}/>
                    </div>
                    <div>
                      <label style={{display:'block',fontSize:'12px',fontWeight:'600',color:'#6B7280',marginBottom:'6px',textTransform:'uppercase',letterSpacing:'0.5px'}}>To Date</label>
                      <input type="date" className="form-input"
                        value={exportEndDate}
                        onChange={e=>setExportEndDate(e.target.value)}
                        style={{padding:'8px 12px',fontSize:'13px'}}/>
                    </div>
                  </div>
                )}
              </div>

              {/* Preview count */}
              <div style={{background:exportPreviewCount>0?'#EBF8FF':'#FFF5F5',border:'0.5px solid '+(exportPreviewCount>0?'#BEE3F8':'#FED7D7'),borderRadius:'10px',padding:'14px 16px',marginBottom:'20px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div>
                  <div style={{fontWeight:'700',fontSize:'16px',color:exportPreviewCount>0?'#185FA5':'#A32D2D'}}>{exportPreviewCount} leads will be exported</div>
                  <div style={{fontSize:'12px',color:'#9CA3AF',marginTop:'2px'}}>
                    {exportStatus?`Status: ${exportStatus}`:'All statuses'} · {exportDateType==='custom'&&exportStartDate&&exportEndDate?`${exportStartDate} to ${exportEndDate}`:exportDateType==='all'?'All time':exportDateType==='today'?'Today':exportDateType==='week'?'This week':'This month'}
                  </div>
                </div>
                <div style={{fontSize:'28px'}}>📊</div>
              </div>

              <div style={{display:'flex',gap:'10px'}}>
                <button onClick={handleExport}
                  disabled={exportPreviewCount===0}
                  style={{flex:1,padding:'13px',background:exportPreviewCount>0?'#185FA5':'#E5E7EB',color:exportPreviewCount>0?'white':'#9CA3AF',border:'none',borderRadius:'10px',fontSize:'14px',fontWeight:'700',cursor:exportPreviewCount>0?'pointer':'not-allowed',display:'flex',alignItems:'center',justifyContent:'center',gap:'8px'}}>
                  ↓ Download CSV ({exportPreviewCount} leads)
                </button>
                <button onClick={()=>setShowExportModal(false)} className="btn btn-ghost">Cancel</button>
              </div>
            </div>
          </div>
        </>
      )}

      <div className="page-header">
        <div>
          <h1>My Dashboard</h1>
          <p>Welcome back, {profile?.full_name} 👋</p>
        </div>
        <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
          <button onClick={()=>setShowNotifPanel(true)} style={{position:'relative',background:notifications.length>0?'#FAEEDA':'#F3F4F6',border:'0.5px solid '+(notifications.length>0?'#F6E05E':'#E5E7EB'),borderRadius:'8px',padding:'8px 14px',cursor:'pointer',display:'flex',alignItems:'center',gap:'6px',color:notifications.length>0?'#854F0B':'#6B7280',fontWeight:'600',fontSize:'13px'}}>
            <IconBell size={16}/> {notifications.length>0?`${notifications.length} Reminders`:'Reminders'}
            {notifications.length>0&&<span style={{position:'absolute',top:'-6px',right:'-6px',background:'#854F0B',color:'white',borderRadius:'50%',width:'18px',height:'18px',fontSize:'10px',fontWeight:'700',display:'flex',alignItems:'center',justifyContent:'center'}}>{notifications.length}</span>}
          </button>
          {['today','week','month'].map(r=>(
            <button key={r} className={`btn ${dateRange===r?'btn-primary':'btn-ghost'}`} onClick={()=>setDateRange(r)}>
              {r==='today'?'Today':r==='week'?'This Week':'This Month'}
            </button>
          ))}
          <button className="btn btn-outline" onClick={fetchAll}><IconRefresh size={15}/></button>
        </div>
      </div>

      <div className="page-body">
        {overdueTasks.length>0&&(
          <div style={{background:'#FFF5F5',border:'0.5px solid #FED7D7',borderRadius:'10px',padding:'12px 16px',marginBottom:'20px',display:'flex',alignItems:'center',gap:'10px'}}>
            <IconAlertTriangle size={18} color="#A32D2D"/>
            <span style={{fontSize:'14px',color:'#A32D2D',fontWeight:'600'}}>You have {overdueTasks.length} overdue task{overdueTasks.length>1?'s':''}!</span>
            <button onClick={()=>setShowNotifPanel(true)} style={{marginLeft:'auto',background:'#A32D2D',color:'white',border:'none',padding:'5px 12px',borderRadius:'6px',cursor:'pointer',fontSize:'12px',fontWeight:'600'}}>View All</button>
          </div>
        )}

        {/* Stats */}
        <div className="stats-grid" style={{marginBottom:'20px'}}>
          {[
            {icon:<IconUsers size={20} color="#185FA5"/>, label:'My Total Leads', value:myLeads.length, color:'#185FA5', bg:'#E6F1FB'},
            {icon:<IconPhoneIncoming size={20} color="#0F6E56"/>, label:'Calls Made', value:myCalls.length, color:'#0F6E56', bg:'#E1F5EE'},
            {icon:<IconClockHour4 size={20} color="#854F0B"/>, label:'Pending Tasks', value:pendingTasks.length, color:'#854F0B', bg:'#FAEEDA'},
            {icon:<IconCircleCheck size={20} color="#534AB7"/>, label:'Converted', value:myLeads.filter(l=>l.status==='Approved'||l.status==='Disbursed').length, color:'#534AB7', bg:'#EEEDFE'},
          ].map(s=>(
            <div key={s.label} className="stat-card">
              <div style={{width:'40px',height:'40px',borderRadius:'10px',background:s.bg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{s.icon}</div>
              <div className="stat-info"><h3 style={{color:s.color}}>{s.value}</h3><p>{s.label}</p></div>
            </div>
          ))}
        </div>

        {/* Status Summary Cards */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'10px',marginBottom:'20px'}}>
          {[
            {label:'Documents Pending', value:myLeads.filter(l=>l.status==='Documents Pending').length, color:'#534AB7', bg:'#EEEDFE'},
            {label:'Logged', value:myLeads.filter(l=>l.status==='Logged').length, color:'#854F0B', bg:'#FAEEDA'},
            {label:'Approved', value:myLeads.filter(l=>l.status==='Approved').length, color:'#3B6D11', bg:'#EAF3DE'},
            {label:'Disbursed', value:myLeads.filter(l=>l.status==='Disbursed').length, color:'#0F6E56', bg:'#E1F5EE'},
          ].map(s=>(
            <div key={s.label} style={{background:s.bg,borderRadius:'10px',padding:'14px 16px',border:'0.5px solid rgba(0,0,0,0.05)'}}>
              <div style={{fontSize:'22px',fontWeight:'700',color:s.color,lineHeight:1,marginBottom:'4px'}}>{s.value}</div>
              <div style={{fontSize:'12px',color:s.color,opacity:0.8}}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Export Button — ONE single button */}
        <div style={{background:'white',borderRadius:'12px',border:'0.5px solid #E2E8F0',padding:'16px 20px',marginBottom:'20px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div>
            <div style={{fontWeight:'600',fontSize:'14px',color:'#111827',marginBottom:'3px'}}>📥 Export My Leads Report</div>
            <div style={{fontSize:'13px',color:'#9CA3AF'}}>Filter by status, date range or custom dates — download as CSV</div>
          </div>
          <button
            onClick={()=>setShowExportModal(true)}
            style={{display:'flex',alignItems:'center',gap:'8px',background:'#185FA5',color:'white',border:'none',padding:'11px 20px',borderRadius:'8px',cursor:'pointer',fontSize:'14px',fontWeight:'600',flexShrink:0}}>
            <IconDownload size={16}/> Export Report
          </button>
        </div>

        {/* Tabs */}
        <div style={{display:'flex',gap:'4px',background:'#F0F0F0',padding:'4px',borderRadius:'10px',maxWidth:'440px',marginBottom:'16px'}}>
          {[
            {id:'leads',label:`Leads (${myLeads.length})`},
            {id:'calls',label:`Calls (${myCalls.length})`},
            {id:'tasks',label:`Tasks (${pendingTasks.length})`},
          ].map(t=>(
            <button key={t.id} onClick={()=>setActiveTab(t.id)}
              style={{flex:1,padding:'8px 10px',border:'none',borderRadius:'7px',fontSize:'13px',fontWeight:'600',cursor:'pointer',transition:'all 0.15s',
                background:activeTab===t.id?'white':'transparent',
                color:activeTab===t.id?'#185FA5':'#9CA3AF',
                boxShadow:activeTab===t.id?'0 1px 4px rgba(0,0,0,0.08)':'none'}}>
              {t.label}
            </button>
          ))}
        </div>

        {/* LEADS TAB */}
        {activeTab==='leads'&&(
          <div>
            <div style={{display:'flex',gap:'10px',marginBottom:'14px',flexWrap:'wrap',alignItems:'center'}}>
              <div style={{flex:1,minWidth:'200px',position:'relative'}}>
                <IconSearch size={15} color="#A0AEC0" style={{position:'absolute',left:'12px',top:'50%',transform:'translateY(-50%)',pointerEvents:'none'}}/>
                <input
                  style={{width:'100%',padding:'10px 14px 10px 36px',border:'1.5px solid #E2E8F0',borderRadius:'8px',fontSize:'14px',outline:'none',boxSizing:'border-box'}}
                  placeholder="Search by name, mobile, city..."
                  value={search} onChange={e=>setSearch(e.target.value)}
                  onFocus={e=>e.target.style.borderColor='#185FA5'}
                  onBlur={e=>e.target.style.borderColor='#E2E8F0'}/>
              </div>
              <select className="form-input" style={{width:'170px'}} value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
                <option value="">All Statuses</option>
                {STATUS_OPTIONS.map(s=><option key={s}>{s}</option>)}
              </select>
              {(search||filterStatus)&&(
                <button className="btn btn-ghost btn-sm" onClick={()=>{setSearch('');setFilterStatus('')}}>✕ Clear</button>
              )}
            </div>

            <div className="table-container">
              <div style={{padding:'12px 18px',borderBottom:'0.5px solid #E2E8F0',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontWeight:'600',fontSize:'14px'}}>Showing {filteredLeads.length} of {myLeads.length} leads</span>
                <div style={{display:'flex',gap:'8px'}}>
                  <span style={{background:'#FAEEDA',color:'#854F0B',padding:'3px 10px',borderRadius:'20px',fontSize:'12px',fontWeight:'500'}}>{myLeads.filter(l=>l.status==='New').length} New</span>
                  <span style={{background:'#E1F5EE',color:'#0F6E56',padding:'3px 10px',borderRadius:'20px',fontSize:'12px',fontWeight:'500'}}>{myLeads.filter(l=>l.status==='Interested').length} Interested</span>
                  <span style={{background:'#EEEDFE',color:'#534AB7',padding:'3px 10px',borderRadius:'20px',fontSize:'12px',fontWeight:'500'}}>{myLeads.filter(l=>l.status==='Callback').length} Callback</span>
                </div>
              </div>
              <table>
                <thead>
                  <tr>{['#','Lead Name','Mobile','City','Loan Amount','Status','Actions'].map(h=><th key={h}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {loading?(
                    <tr><td colSpan="7" style={{padding:'40px',textAlign:'center',color:'#A0AEC0'}}>Loading your leads...</td></tr>
                  ):filteredLeads.length===0?(
                    <tr><td colSpan="7">
                      <div className="empty-state">
                        <span className="empty-icon"><IconUsers size={40} strokeWidth={1.2} color="#CBD5E0"/></span>
                        <h3>{search||filterStatus?'No leads match your search':'No leads assigned yet'}</h3>
                        <p>{search||filterStatus?'Try different search terms':'Your manager will assign leads soon'}</p>
                      </div>
                    </td></tr>
                  ):filteredLeads.map((lead,i)=>(
                    <tr key={lead.id}>
                      <td style={{color:'#A0AEC0',fontSize:'12px'}}>{i+1}</td>
                      <td>
                        <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                          <div style={{width:'30px',height:'30px',borderRadius:'50%',background:'#E6F1FB',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:'600',color:'#185FA5',fontSize:'12px',flexShrink:0}}>{lead.full_name[0]?.toUpperCase()}</div>
                          <div>
                            <div style={{fontWeight:'500',fontSize:'13px',display:'flex',alignItems:'center',gap:'5px'}}>{lead.full_name}{mirroredLeadIds.has(lead.id)&&<span style={{background:'#EEEDFE',color:'#534AB7',padding:'1px 6px',borderRadius:'10px',fontSize:'10px',fontWeight:'600'}}>Shared</span>}</div>
                            {lead.email&&<div style={{fontSize:'11px',color:'#A0AEC0'}}>{lead.email}</div>}
                          </div>
                        </div>
                      </td>
                      <td style={{color:'#718096',fontSize:'13px'}}>{lead.mobile}</td>
                      <td style={{color:'#718096',fontSize:'13px'}}>{lead.city||'-'}</td>
                      <td style={{fontWeight:'500',color:'#185FA5',fontSize:'13px'}}>{lead.loan_amount?'₹'+Number(lead.loan_amount).toLocaleString('en-IN'):'-'}</td>
                      <td>
                        <span style={{
                          background:lead.status==='New'?'#F3F4F6':lead.status==='Interested'?'#E1F5EE':lead.status==='Not Interested'?'#FCEBEB':lead.status==='Callback'?'#FAEEDA':lead.status==='Approved'?'#EAF3DE':lead.status==='Disbursed'?'#E1F5EE':lead.status==='Documents Pending'?'#EEEDFE':'#F3F4F6',
                          color:lead.status==='New'?'#6B7280':lead.status==='Interested'?'#0F6E56':lead.status==='Not Interested'?'#A32D2D':lead.status==='Callback'?'#854F0B':lead.status==='Approved'?'#3B6D11':lead.status==='Disbursed'?'#0F6E56':lead.status==='Documents Pending'?'#534AB7':'#6B7280',
                          padding:'3px 10px',borderRadius:'20px',fontSize:'12px',fontWeight:'500'
                        }}>{lead.status}</span>
                      </td>
                      <td>
                        <div style={{display:'flex',gap:'6px',alignItems:'center'}}>
                          <a href={'tel:'+lead.mobile} style={{width:'30px',height:'30px',borderRadius:'8px',background:'#FCEBEB',border:'none',display:'flex',alignItems:'center',justifyContent:'center',textDecoration:'none',color:'#A32D2D'}}><IconPhone size={14}/></a>
                          <a href={'https://wa.me/91'+lead.mobile} target="_blank" rel="noreferrer" style={{width:'30px',height:'30px',borderRadius:'8px',background:'#E1F5EE',border:'none',display:'flex',alignItems:'center',justifyContent:'center',textDecoration:'none',color:'#0F6E56'}}><IconBrandWhatsapp size={14}/></a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* CALLS TAB */}
        {activeTab==='calls'&&(
          <div className="table-container">
            <div style={{padding:'12px 18px',borderBottom:'0.5px solid #E2E8F0',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontWeight:'600',fontSize:'14px'}}>My Call Logs ({myCalls.length})</span>
            </div>
            <table>
              <thead>
                <tr>{['Lead Name','Mobile','Call Status','Disposition','Duration','Notes','Date'].map(h=><th key={h}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {myCalls.length===0?(
                  <tr><td colSpan="7">
                    <div className="empty-state">
                      <span className="empty-icon"><IconPhoneIncoming size={40} strokeWidth={1.2} color="#CBD5E0"/></span>
                      <h3>No calls yet</h3><p>Start calling your leads!</p>
                    </div>
                  </td></tr>
                ):myCalls.map(call=>{
                  const lead = myLeads.find(l=>l.id===call.lead_id)
                  return (
                    <tr key={call.id}>
                      <td><strong style={{fontSize:'13px'}}>{lead?.full_name||'Unknown'}</strong></td>
                      <td style={{color:'#718096',fontSize:'13px'}}>{lead?.mobile||'-'}</td>
                      <td><span style={{background:call.call_status==='Answered'?'#E1F5EE':'#FCEBEB',color:call.call_status==='Answered'?'#0F6E56':'#A32D2D',padding:'3px 10px',borderRadius:'20px',fontSize:'12px',fontWeight:'500'}}>{call.call_status}</span></td>
                      <td>{call.call_outcome&&<span style={{background:'#FAEEDA',color:'#854F0B',padding:'3px 10px',borderRadius:'20px',fontSize:'12px',fontWeight:'500'}}>{call.call_outcome}</span>}</td>
                      <td style={{color:'#718096',fontSize:'13px'}}>{call.duration||'-'}</td>
                      <td style={{maxWidth:'150px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:'13px',color:'#718096'}}>{call.notes||'-'}</td>
                      <td style={{color:'#A0AEC0',fontSize:'12px'}}>{new Date(call.created_at).toLocaleString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'})}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* TASKS TAB */}
        {activeTab==='tasks'&&(
          <div>
            <div style={{marginBottom:'14px'}}>
              <span style={{fontSize:'14px',color:'#6B7280'}}>{pendingTasks.length} pending · {overdueTasks.length} overdue</span>
            </div>
            {pendingTasks.length===0?(
              <div className="card"><div className="empty-state"><span className="empty-icon">✅</span><h3>All tasks completed!</h3><p>Great work!</p></div></div>
            ):pendingTasks.map(task=>{
              const isOverdue = new Date(task.due_date)<new Date()
              return (
                <div key={task.id} style={{background:'white',borderRadius:'10px',border:'0.5px solid '+(isOverdue?'#FED7D7':'#E2E8F0'),padding:'14px 18px',marginBottom:'10px',borderLeft:'3px solid '+(isOverdue?'#A32D2D':task.priority==='High'?'#A32D2D':task.priority==='Medium'?'#854F0B':'#3B6D11')}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                    <div>
                      <div style={{fontWeight:'600',fontSize:'14px',color:isOverdue?'#A32D2D':'#111827',marginBottom:'4px'}}>{isOverdue&&'⚠️ '}{task.title}</div>
                      {task.notes&&<div style={{fontSize:'13px',color:'#9CA3AF',marginBottom:'4px'}}>📝 {task.notes}</div>}
                      <div style={{fontSize:'12px',color:isOverdue?'#A32D2D':'#9CA3AF',fontWeight:isOverdue?'600':'400'}}>🕐 Due: {new Date(task.due_date).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
                    </div>
                    <span style={{background:task.priority==='High'?'#FCEBEB':task.priority==='Medium'?'#FAEEDA':'#EAF3DE',color:task.priority==='High'?'#A32D2D':task.priority==='Medium'?'#854F0B':'#3B6D11',padding:'3px 10px',borderRadius:'20px',fontSize:'12px',fontWeight:'500',flexShrink:0}}>{task.priority}</span>
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