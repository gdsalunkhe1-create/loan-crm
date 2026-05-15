/* eslint-disable */
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabase'
import Leads from './Leads'
import Tasks from './Tasks'
import Calls from './Calls'
import Reports from './Reports'
import Settings from './Settings'
import Campaigns from './Campaigns'
import AgentCallingFlow from './AgentCallingFlow'
import {
  IconLayoutDashboard, IconUsers, IconPhoneCall, IconCheckbox,
  IconChartBar, IconSettings, IconAdjustments, IconPhone,
  IconPower, IconEdit, IconPhoneIncoming, IconBuildingStore,
  IconThumbUp, IconCircleCheck, IconRefresh, IconBell,
  IconX, IconAlertTriangle, IconClockHour4, IconBrandWhatsapp,
  IconDownload, IconSearch, IconMail, IconNotes,
  IconBolt, IconDeviceFloppy, IconMenu2
} from '@tabler/icons-react'

const STATUS_OPTIONS = ['New','Interested','Callback','Login','Approved','Disbursed','Not Interested','DND']

const STATUS_STYLE = {
  'New':           {bg:'#E6F1FB', color:'#0C447C'},
  'Interested':    {bg:'#FAEEDA', color:'#633806'},
  'Callback':      {bg:'#F1EFE8', color:'#444441'},
  'Login':         {bg:'#FEF3C7', color:'#92400E'},
  'Approved':      {bg:'#EAF3DE', color:'#27500A'},
  'Disbursed':     {bg:'#D1FAE5', color:'#065F46'},
  'Not Interested':{bg:'#FCEBEB', color:'#791F1F'},
  'DND':           {bg:'#FCEBEB', color:'#791F1F'},
}

const PIPELINE = ['New','Interested','Callback','Login','Approved','Disbursed']

const TEMP_COLORS = {
  Hot: {bg:'#FEE2E2', color:'#DC2626', icon:'🔥'},
  Warm:{bg:'#FEF3C7', color:'#D97706', icon:'☀️'},
  Cold:{bg:'#DBEAFE', color:'#2563EB', icon:'❄️'},
}

const OBLIGATION_TYPES = ['Personal Loan','Housing Loan','Education Loan','Car Loan','Consumer Durable Loan','Credit Card','Business Loan','LAP']
const JOINT_OPTIONS = ['Individual','Joint']
const YES_NO_OPTIONS = ['No','Yes']

const DEFAULT_WA_TEMPLATES = [
  {
    id:'docs', name:'Docs Reminder', icon:'📄', tag:'DOCS',
    tagColor:'#22C55E', tagBg:'#F0FFF4',
    message:`Hi {name} 😊, We have received your loan application for ₹{amount}.\n\nTo proceed, please share:\n📄 PAN Card\n📄 Aadhaar Card\n📄 Last 3 months bank statement\n📄 Latest salary slip\n\nFeel free to reply here if you have any questions!`
  },
  {
    id:'emi', name:'EMI Details', icon:'💰', tag:'EMI',
    tagColor:'#3B82F6', tagBg:'#EFF6FF',
    message:`Hi {name} 😊, Here are your EMI details for the loan of ₹{amount}:\n\n💰 EMI Amount: ₹{emi}/month\n📅 Tenure: 36 months\n📊 Interest Rate: 12.5% p.a.\n\nPlease review and confirm to proceed. 🙏`
  },
  {
    id:'disbursement', name:'Disbursement Update', icon:'🎉', tag:'DISBURSED',
    tagColor:'#F59E0B', tagBg:'#FFF7ED',
    message:`🎉 Congratulations {name}!\n\nYour loan of ₹{amount} has been *DISBURSED* ✅\n\nThe amount has been credited to your bank account.\n\nThank you for choosing us! 🙏`
  },
]

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

// =============================================
// AGENT DASHBOARD
// =============================================
function AgentDashboard({ userId }) {
  const isMobile = useIsMobile()
  const [myLeads,setMyLeads]               = useState([])
  const [myCalls,setMyCalls]               = useState([])
  const [myTasks,setMyTasks]               = useState([])
  const [profile,setProfile]               = useState(null)
  const [dateRange,setDateRange]           = useState('today')
  const [loading,setLoading]               = useState(true)
  const [notifications,setNotifications]   = useState([])
  const [showNotifPanel,setShowNotifPanel] = useState(false)
  const [reminderPopup,setReminderPopup]   = useState(null)
  const [search,setSearch]                 = useState('')
  const [filterStatus,setFilterStatus]     = useState('')
  const [activeTab,setActiveTab]           = useState('leads')
  const [showExportModal,setShowExportModal]   = useState(false)
  const [exportStatus,setExportStatus]         = useState('')
  const [exportDateType,setExportDateType]     = useState('all')
  const [exportStartDate,setExportStartDate]   = useState('')
  const [exportEndDate,setExportEndDate]       = useState('')
  const [waLead,setWaLead]                 = useState(null)
  const [showWAModal,setShowWAModal]       = useState(false)
  const [waTemplates,setWaTemplates]       = useState(DEFAULT_WA_TEMPLATES)
  const [noteLead,setNoteLead]             = useState(null)
  const [showNoteModal,setShowNoteModal]   = useState(false)
  const [noteText,setNoteText]             = useState('')
  const [leadObligations,setLeadObligations] = useState({})
  const [selectedLeadForObligations,setSelectedLeadForObligations] = useState(null)
  const [showObligationModal,setShowObligationModal] = useState(false)
  const [obligationDrafts,setObligationDrafts] = useState([])
  const [savingObligation,setSavingObligation] = useState(false)
  const [obligationError,setObligationError] = useState('')
  const [toast,setToast]                   = useState(null)
  const [darkMode,setDarkMode]             = useState(false)
  const [greeting,setGreeting]             = useState('')
  const [callingLead,setCallingLead]       = useState(null)
  const [showWorkspace,setShowWorkspace]   = useState(false)
  const [leadQueue,setLeadQueue]           = useState([])
  const [queueIndex,setQueueIndex]         = useState(0)
  const [animatedStats,setAnimatedStats]   = useState({
    todayLogins:0, todayDisbursed:0, monthlyLogins:0, monthlyDisbursed:0
  })

  useEffect(()=>{
    const build=()=>{
      const h=new Date().getHours()
      const name=profile?.full_name?.split(' ')[0]||'there'
      if(h>=5&&h<12)  return `Good morning, ${name} 👋`
      if(h>=12&&h<17) return `Good afternoon, ${name} 👋`
      if(h>=17&&h<21) return `Good evening, ${name} 👋`
      return `Good night, ${name} 👋`
    }
    setGreeting(build())
    const t=setInterval(()=>setGreeting(build()),60000)
    return()=>clearInterval(t)
  },[profile])

  useEffect(()=>{ fetchAll() },[dateRange])
  useEffect(()=>{
    checkReminders()
    fetchWATemplates()
    const iv=setInterval(checkReminders,60000)
    return()=>clearInterval(iv)
  },[userId])

  const fetchWATemplates=async()=>{
    const{data}=await supabase.from('settings').select('*').eq('key','wa_templates').single()
    if(data?.value){try{setWaTemplates(JSON.parse(data.value))}catch(e){}}
  }

  const checkReminders=useCallback(async()=>{
    if(!userId)return
    const now=new Date(), five=new Date(now.getTime()+5*60*1000)
    const{data:upcoming}=await supabase.from('tasks').select('*')
      .eq('assigned_to',userId).in('status',['Pending','In Progress'])
      .gte('due_date',now.toISOString()).lte('due_date',five.toISOString())
    const{data:overdue}=await supabase.from('tasks').select('*')
      .eq('assigned_to',userId).in('status',['Pending','In Progress'])
      .lt('due_date',now.toISOString())
    const all=[...(upcoming||[]),...(overdue||[])]
    const unique=all.filter((t,i,a)=>a.findIndex(x=>x.id===t.id)===i)
    setNotifications(unique)
    if(upcoming?.length>0&&!reminderPopup) setReminderPopup(upcoming[0])
  },[userId])

  const fetchAll=async()=>{
    setLoading(true)
    const now=new Date(); let sd=new Date()
    if(dateRange==='today') sd.setHours(0,0,0,0)
    else if(dateRange==='week')  sd.setDate(now.getDate()-7)
    else if(dateRange==='month') sd.setDate(1)
    const[lR,cR,tR,pR]=await Promise.all([
      supabase.from('leads').select('*').eq('assigned_to',userId).order('created_at',{ascending:false}),
      supabase.from('calls').select('*').eq('agent_id',userId).gte('created_at',sd.toISOString()),
      supabase.from('tasks').select('*').eq('assigned_to',userId).order('due_date',{ascending:true}),
      supabase.from('profiles').select('*').eq('id',userId).single(),
    ])
    const leads=lR.data||[]
    let obligationMap={}
    if(leads.length>0){
      const leadIds=leads.map(l=>l.id).filter(Boolean)
      const{oR,error}=await supabase.from('loan_obligations').select('*').in('lead_id',leadIds)
      if(!error){
        obligationMap=(oR||[]).reduce((acc,o)=>{acc[o.lead_id]=[...(acc[o.lead_id]||[]),o];return acc},{})
      }
    }
    setMyLeads(leads); setMyCalls(cR.data||[])
    setMyTasks(tR.data||[]); setProfile(pR.data)
    setLeadObligations(obligationMap)
    computePipelineStats(leads)
    setLoading(false)
  }

  const computePipelineStats=(leads)=>{
    const todayStart=new Date(); todayStart.setHours(0,0,0,0)
    const monthStart=new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0)
    const targets={
      todayLogins:     leads.filter(l=>l.status==='Login'    &&new Date(l.created_at)>=todayStart).length,
      todayDisbursed:  leads.filter(l=>l.status==='Disbursed'&&new Date(l.created_at)>=todayStart).length,
      monthlyLogins:   leads.filter(l=>l.status==='Login'    &&new Date(l.created_at)>=monthStart).length,
      monthlyDisbursed:leads.filter(l=>l.status==='Disbursed'&&new Date(l.created_at)>=monthStart).length,
    }
    const dur=900, t0=Date.now()
    const step=()=>{
      const p=Math.min((Date.now()-t0)/dur,1), e=1-Math.pow(1-p,3)
      setAnimatedStats({
        todayLogins:     Math.round(targets.todayLogins*e),
        todayDisbursed:  Math.round(targets.todayDisbursed*e),
        monthlyLogins:   Math.round(targets.monthlyLogins*e),
        monthlyDisbursed:Math.round(targets.monthlyDisbursed*e),
      })
      if(p<1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  const showToast=(msg,type='success')=>{
    setToast({msg,type})
    setTimeout(()=>setToast(null),2800)
  }

  const updateLeadStatus=async(leadId,newStatus)=>{
    await supabase.from('leads').update({status:newStatus}).eq('id',leadId)
    setMyLeads(prev=>prev.map(l=>l.id===leadId?{...l,status:newStatus}:l))
    showToast('Stage updated to '+newStatus)
  }

  const saveNote=async()=>{
    if(!noteText.trim())return
    const existing=noteLead.notes||''
    const updated=existing+(existing?'\n':'')+`[${new Date().toLocaleString()}] `+noteText
    await supabase.from('leads').update({notes:updated}).eq('id',noteLead.id)
    setMyLeads(prev=>prev.map(l=>l.id===noteLead.id?{...l,notes:updated}:l))
    setShowNoteModal(false); setNoteText('')
    showToast('Note saved for '+noteLead.full_name)
  }

  const cloneObligations=(items=[])=>items.map(o=>({
    ...o,
    obligation_type:o.obligation_type||'Personal Loan',
    bank_name:o.bank_name||'',
    emi_amount:o.emi_amount||'',
    outstanding_amount:o.outstanding_amount||'',
    sanctioned_amount:o.sanctioned_amount||'',
    tenure_months:o.tenure_months||'',
    remaining_tenure:o.remaining_tenure||'',
    emis_paid:o.emis_paid||'',
    bounce:o.bounce||'No',
    overdue_amount:o.overdue_amount||'',
    dpd:o.dpd||'',
    address_proof:o.address_proof||'No',
    joint_type:o.joint_type||'Individual',
    joint_holder_name:o.joint_holder_name||'',
    joint_holder_income:o.joint_holder_income||'',
    joint_holder_relation:o.joint_holder_relation||'',
    editing:false,
    expanded:false,
  }))

  const getLeadObligations=(leadId)=>leadObligations[leadId]||[]

  const openObligationModal=(lead)=>{
    setSelectedLeadForObligations(lead)
    setObligationDrafts(cloneObligations(getLeadObligations(lead.id)))
    setShowObligationModal(true)
    setObligationError('')
  }

  const buildEmptyObligation=()=>({
    id:'tmp-'+Date.now(),
    obligation_type:'Personal Loan',
    bank_name:'',
    emi_amount:'',
    outstanding_amount:'',
    sanctioned_amount:'',
    tenure_months:'',
    remaining_tenure:'',
    emis_paid:'',
    bounce:'No',
    overdue_amount:'',
    dpd:'',
    address_proof:'No',
    joint_type:'Individual',
    joint_holder_name:'',
    joint_holder_income:'',
    joint_holder_relation:'',
    editing:true,
    expanded:true,
  })

  const handleObligationFieldChange=(id,field,value)=>{
    setObligationDrafts(prev=>prev.map(item=>item.id===id?{...item,[field]:value}:item))
  }

  const toggleObligationExpand=(id)=>{
    setObligationDrafts(prev=>prev.map(item=>item.id===id?{...item,expanded:!item.expanded}:item))
  }

  const updateSavedObligations=(leadId,items)=>{
    setLeadObligations(prev=>({
      ...prev,
      [leadId]:items,
    }))
  }

  const calculateObligationTotals=(items)=>{
    const totalEMI=items.reduce((sum,o)=>sum+Number(o.emi_amount||0),0)
    const totalOutstanding=items.reduce((sum,o)=>sum+Number(o.outstanding_amount||0),0)
    const totalSanctioned=items.reduce((sum,o)=>sum+Number(o.sanctioned_amount||0),0)
    const monthlySalary=Number(selectedLeadForObligations?.monthly_salary||0)
    const foir=monthlySalary?Math.round((totalEMI/monthlySalary)*100):0
    return {totalEMI,totalOutstanding,totalSanctioned,foir}
  }

  const saveObligationCard=async(obligation)=>{
    if(!selectedLeadForObligations)return
    setSavingObligation(true)
    setObligationError('')
    const payload={
      lead_id:selectedLeadForObligations.id,
      obligation_type:obligation.obligation_type,
      bank_name:obligation.bank_name,
      emi_amount:Number(obligation.emi_amount||0),
      outstanding_amount:Number(obligation.outstanding_amount||0),
      sanctioned_amount:Number(obligation.sanctioned_amount||0),
      tenure_months:Number(obligation.tenure_months||0),
      remaining_tenure:Number(obligation.remaining_tenure||0),
      emis_paid:Number(obligation.emis_paid||0),
      bounce:obligation.bounce,
      overdue_amount:Number(obligation.overdue_amount||0),
      dpd:obligation.dpd,
      address_proof:obligation.address_proof,
      joint_type:obligation.joint_type,
      joint_holder_name:obligation.joint_holder_name,
      joint_holder_income:obligation.joint_holder_income,
      joint_holder_relation:obligation.joint_holder_relation,
    }
    try{
      if(String(obligation.id).startsWith('tmp-')){
        const {data,error}=await supabase.from('loan_obligations').insert([payload]).select().single()
        if(error) throw error
        const updated=[...(getLeadObligations(selectedLeadForObligations.id)||[]),data]
        updateSavedObligations(selectedLeadForObligations.id,updated)
        setObligationDrafts(prev=>prev.map(item=>item.id===obligation.id?{...data,editing:false,expanded:false}:item))
        showToast('Obligation added successfully')
      } else {
        const {data,error}=await supabase.from('loan_obligations').update(payload).eq('id',obligation.id).select().single()
        if(error) throw error
        const updated=(getLeadObligations(selectedLeadForObligations.id)||[]).map(item=>item.id===data.id?data:item)
        updateSavedObligations(selectedLeadForObligations.id,updated)
        setObligationDrafts(prev=>prev.map(item=>item.id===data.id?{...data,editing:false}:item))
        showToast('Obligation updated successfully')
      }
    }catch(err){
      console.error(err)
      setObligationError('Unable to save obligation. Please try again.')
    }finally{
      setSavingObligation(false)
    }
  }

  const deleteObligationCard=async(obligation)=>{
    if(!window.confirm('Delete this obligation?'))return
    setSavingObligation(true)
    try{
      if(!String(obligation.id).startsWith('tmp-')){
        const {error}=await supabase.from('loan_obligations').delete().eq('id',obligation.id)
        if(error) throw error
      }
      setObligationDrafts(prev=>prev.filter(item=>item.id!==obligation.id))
      const updated=(getLeadObligations(selectedLeadForObligations.id)||[]).filter(item=>item.id!==obligation.id)
      updateSavedObligations(selectedLeadForObligations.id,updated)
      showToast('Obligation deleted')
    }catch(err){
      console.error(err)
      showToast('Failed to delete obligation','error')
    }finally{
      setSavingObligation(false)
    }
  }

  const addObligationDraft=()=>{
    setObligationDrafts(prev=>[...prev,buildEmptyObligation()])
  }

  const enrichDraftTitle=(ob)=>{
    const title=ob.obligation_type||'New Obligation'
    const bank=ob.bank_name?` — ${ob.bank_name}`:''
    return title+bank
  }

  const sendWATemplate=(tpl)=>{
    if(!waLead)return
    const name=waLead.full_name?.split(' ')[0]||'Customer'
    const amount=Number(waLead.loan_amount||0).toLocaleString('en-IN')
    const emi=Math.round((Number(waLead.loan_amount||0)*0.012*Math.pow(1.012,36))/(Math.pow(1.012,36)-1)).toLocaleString('en-IN')
    const msg=tpl.message.replace(/{name}/g,name).replace(/{amount}/g,amount).replace(/{emi}/g,emi)
    window.open(`https://wa.me/91${waLead.mobile}?text=${encodeURIComponent(msg)}`,'_blank')
    setShowWAModal(false)
    showToast('WhatsApp opened for '+waLead.full_name)
  }

  const openCallingWorkspace=(lead)=>{
    const queue=filteredLeads.length>0?filteredLeads:myLeads
    const idx=queue.findIndex(l=>l.id===lead.id)
    setCallingLead(lead)
    setLeadQueue(queue)
    setQueueIndex(idx>=0?idx:0)
    setShowWorkspace(true)
  }

  const handleNextLead=()=>{
    const nextIdx=queueIndex+1
    if(nextIdx<leadQueue.length){
      setQueueIndex(nextIdx)
      setCallingLead(leadQueue[nextIdx])
    } else {
      showToast('🎉 All leads called!')
      setShowWorkspace(false)
    }
  }

  const getExportLeads=()=>{
    let leads=[...myLeads]
    if(exportStatus) leads=leads.filter(l=>l.status===exportStatus)
    if(exportDateType==='today'){const t=new Date();t.setHours(0,0,0,0);leads=leads.filter(l=>new Date(l.created_at)>=t)}
    else if(exportDateType==='week'){const w=new Date();w.setDate(w.getDate()-7);leads=leads.filter(l=>new Date(l.created_at)>=w)}
    else if(exportDateType==='month'){const m=new Date();m.setDate(1);m.setHours(0,0,0,0);leads=leads.filter(l=>new Date(l.created_at)>=m)}
    else if(exportDateType==='custom'&&exportStartDate&&exportEndDate){
      const s=new Date(exportStartDate),e=new Date(exportEndDate);e.setHours(23,59,59,999)
      leads=leads.filter(l=>new Date(l.created_at)>=s&&new Date(l.created_at)<=e)
    }
    return leads
  }

  const handleExport=()=>{
    const leads=getExportLeads()
    if(!leads.length){showToast('No leads found!','error');return}
    const headers=['Name','Mobile','Email','City','Loan Amount','Monthly Salary','Company','Status','Temperature','Notes','Date']
    const rows=leads.map(l=>[l.full_name||'',l.mobile||'',l.email||'',l.city||'',l.loan_amount||'',l.monthly_salary||'',l.company_name||'',l.status||'',l.lead_temperature||'',(l.notes||'').replace(/\n/g,' '),new Date(l.created_at).toLocaleDateString('en-IN')])
    const csv=[headers,...rows].map(r=>r.map(v=>`"${v}"`).join(',')).join('\n')
    const a=document.createElement('a')
    a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}))
    a.download=`leads_${exportStatus||'all'}_${exportDateType}.csv`
    a.click()
    setShowExportModal(false)
    showToast('Report downloaded!')
  }

  const pendingTasks  =myTasks.filter(t=>t.status!=='Completed')
  const overdueTasks  =myTasks.filter(t=>new Date(t.due_date)<new Date()&&t.status!=='Completed')
  const exportCount   =getExportLeads().length
  const filteredLeads =myLeads.filter(l=>{
    const ms=!search||l.full_name?.toLowerCase().includes(search.toLowerCase())||l.mobile?.includes(search)||l.city?.toLowerCase().includes(search.toLowerCase())
    const mf=!filterStatus||l.status===filterStatus
    return ms&&mf
  })
  const obligationTotals = calculateObligationTotals(obligationDrafts)

  const fmtAmt  =n=>n?'₹'+Number(n).toLocaleString('en-IN'):'-'
  const initials=name=>name?.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2)||'?'

  const bg0=darkMode?'#0f172a':'#F8FAFC'
  const bg1=darkMode?'#1e293b':'#ffffff'
  const bg2=darkMode?'#334155':'#F9FAFB'
  const bdr=darkMode?'#334155':'#E2E8F0'
  const txt1=darkMode?'#f1f5f9':'#111827'
  const txt2=darkMode?'#94a3b8':'#6B7280'

  const PIPELINE_CARDS=[
    {label:'Today Logins',     value:animatedStats.todayLogins,     color:'#534AB7',bg:'#EEEDFE',status:'Login'},
    {label:'Today Disbursed',  value:animatedStats.todayDisbursed,  color:'#065F46',bg:'#D1FAE5',status:'Disbursed'},
    {label:'Monthly Logins',   value:animatedStats.monthlyLogins,   color:'#92400E',bg:'#FEF3C7',status:'Login'},
    {label:'Monthly Disbursed',value:animatedStats.monthlyDisbursed,color:'#27500A',bg:'#EAF3DE',status:'Disbursed'},
  ]

  return (
    <div style={{minHeight:'100vh',background:bg0,color:txt1,fontFamily:'system-ui,sans-serif'}}>
      <style>
        {`
          @media (max-width: 768px) {
            .mobile-button { min-height: 44px !important; padding: 12px 16px !important; }
            .mobile-input { min-height: 44px !important; padding: 12px 14px !important; }
            .mobile-select { min-height: 44px !important; padding: 12px 14px !important; }
            .mobile-modal { width: 100% !important; height: 100vh !important; border-radius: 0 !important; top: 0 !important; left: 0 !important; transform: none !important; }
            .mobile-table { overflow-x: auto !important; }
            .mobile-card-stack { flex-direction: column !important; }
            body { overflow-x: hidden !important; }
          }
        `}
      </style>

      {/* CALLING WORKSPACE */}
      {showWorkspace&&callingLead&&(
        <CallingWorkspace
          lead={callingLead}
          userId={userId}
          onClose={()=>setShowWorkspace(false)}
          onSave={(data)=>{
            setMyLeads(prev=>prev.map(l=>l.id===callingLead.id?{...l,...data}:l))
            setLeadQueue(prev=>prev.map(l=>l.id===callingLead.id?{...l,...data}:l))
          }}
          onNext={handleNextLead}
        />
      )}

      {/* TOAST */}
      {toast&&(
        <div style={{position:'fixed',bottom:16,right:16,left:isMobile?16:'auto',zIndex:9999,background:toast.type==='error'?'#FCEBEB':'#EAF3DE',border:'1px solid '+(toast.type==='error'?'#FCA5A5':'#86EFAC'),borderRadius:10,padding:'11px 16px',fontSize:13,fontWeight:500,color:toast.type==='error'?'#791F1F':'#166534',display:'flex',alignItems:'center',gap:8,boxShadow:'0 4px 20px rgba(0,0,0,0.1)'}}>
          <IconCircleCheck size={15}/>{toast.msg}
        </div>
      )}

      {/* REMINDER POPUP */}
      {reminderPopup&&(
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:400}} onClick={()=>setReminderPopup(null)}/>
          <div style={{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',background:'white',borderRadius:16,boxShadow:'0 24px 60px rgba(0,0,0,0.2)',zIndex:500,width:'92%',maxWidth:400,overflow:'hidden'}}>
            <div style={{background:'linear-gradient(135deg,#854F0B,#C05621)',padding:'16px 18px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{width:36,height:36,borderRadius:'50%',background:'rgba(255,255,255,0.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>🔔</div>
                <div>
                  <div style={{color:'white',fontWeight:700,fontSize:14}}>Follow-up Reminder!</div>
                  <div style={{color:'rgba(255,255,255,0.7)',fontSize:12}}>Task due very soon</div>
                </div>
              </div>
              <button onClick={()=>setReminderPopup(null)} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',width:28,height:28,borderRadius:'50%',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><IconX size={13}/></button>
            </div>
            <div style={{padding:'16px 18px'}}>
              <div style={{background:'#FFFAF0',borderRadius:8,padding:12,border:'1px solid #F6E05E',marginBottom:12}}>
                <div style={{fontWeight:700,fontSize:14,color:'#744210',marginBottom:4}}>{reminderPopup.title}</div>
                <div style={{fontSize:12,color:'#975A16'}}>Due: {new Date(reminderPopup.due_date).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>setReminderPopup(null)} style={{flex:1,padding:10,background:'#185FA5',color:'white',border:'none',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer'}}>✅ Got it!</button>
                <button onClick={()=>setReminderPopup(null)} style={{padding:'10px 14px',background:'transparent',border:'1px solid #E2E8F0',borderRadius:8,fontSize:13,cursor:'pointer',color:'#6B7280'}}>Dismiss</button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* NOTIFICATION PANEL */}
      {showNotifPanel&&(
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.3)',zIndex:200}} onClick={()=>setShowNotifPanel(false)}/>
          <div style={{position:'fixed',top:0,right:0,width:isMobile?'100%':340,height:'100vh',background:bg1,boxShadow:'-4px 0 24px rgba(0,0,0,0.15)',zIndex:300,display:'flex',flexDirection:'column'}}>
            <div style={{background:'#185FA5',padding:'16px 18px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div style={{display:'flex',alignItems:'center',gap:8,color:'white',fontWeight:700,fontSize:15}}><IconBell size={17}/>Reminders</div>
              <button onClick={()=>setShowNotifPanel(false)} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',width:28,height:28,borderRadius:'50%',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><IconX size={13}/></button>
            </div>
            <div style={{flex:1,overflowY:'auto',padding:14}}>
              {notifications.length===0
                ?<div style={{textAlign:'center',padding:'40px 20px',color:'#A0AEC0'}}>
                    <IconBell size={32} strokeWidth={1.2} color="#CBD5E0" style={{display:'block',margin:'0 auto 10px'}}/>
                    <div style={{fontSize:13}}>No pending reminders 🎉</div>
                  </div>
                :notifications.map(task=>{
                    const od=new Date(task.due_date)<new Date()
                    return(
                      <div key={task.id} style={{background:od?'#FFF5F5':'#FFFAF0',border:'1px solid '+(od?'#FED7D7':'#F6E05E'),borderRadius:8,padding:12,marginBottom:8,borderLeft:'3px solid '+(od?'#A32D2D':'#854F0B')}}>
                        <div style={{fontWeight:600,fontSize:12,color:od?'#A32D2D':'#744210',marginBottom:3}}>{od&&'⚠️ '}{task.title}</div>
                        <div style={{fontSize:11,color:od?'#A32D2D':'#975A16'}}>🕐 {new Date(task.due_date).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
                      </div>
                    )
                  })
              }
            </div>
            <div style={{padding:14,borderTop:'1px solid '+bdr}}>
              <button onClick={()=>{setNotifications([]);setShowNotifPanel(false)}} style={{width:'100%',padding:10,background:'transparent',border:'1px solid '+bdr,borderRadius:8,fontSize:13,cursor:'pointer',color:txt2}}>Clear All</button>
            </div>
          </div>
        </>
      )}

      {/* WHATSAPP MODAL */}
      {showWAModal&&waLead&&(
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:300}} onClick={()=>setShowWAModal(false)}/>
          <div style={{position:'fixed',top:isMobile?0:'50%',left:isMobile?0:'50%',transform:isMobile?'none':'translate(-50%,-50%)',background:'white',borderRadius:isMobile?0:16,boxShadow:'0 24px 60px rgba(0,0,0,0.18)',zIndex:400,width:isMobile?'100%':'90%',maxWidth:460,height:isMobile?'100%':'auto',maxHeight:isMobile?'100vh':'90vh',overflow:'hidden',display:'flex',flexDirection:'column'}}>
            <div style={{background:'#25D366',padding:'14px 18px',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <IconBrandWhatsapp size={20} color="white"/>
                <div>
                  <div style={{color:'white',fontWeight:700,fontSize:14}}>WhatsApp — {waLead.full_name}</div>
                  <div style={{color:'rgba(255,255,255,0.75)',fontSize:11}}>+91 {waLead.mobile}</div>
                </div>
              </div>
              <button onClick={()=>setShowWAModal(false)} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',width:32,height:32,borderRadius:'50%',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><IconX size={15}/></button>
            </div>
            <div style={{padding:'16px 18px',overflowY:'auto',flex:1}}>
              <div style={{fontSize:12,color:'#6B7280',marginBottom:12}}>Tap a template — name and amount auto-fill:</div>
              {waTemplates.map(tpl=>(
                <div key={tpl.id} onClick={()=>sendWATemplate(tpl)}
                  style={{background:tpl.tagBg||'#F9FAFB',border:'1px solid #E5E7EB',borderRadius:10,padding:14,marginBottom:10,cursor:'pointer'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                    <div style={{fontWeight:700,fontSize:13,color:'#111827'}}>{tpl.icon} {tpl.name}</div>
                    <span style={{background:tpl.tagColor,color:'white',fontSize:10,padding:'2px 8px',borderRadius:20,fontWeight:600}}>{tpl.tag}</span>
                  </div>
                  <div style={{fontSize:12,color:'#4B5563',lineHeight:1.5}}>
                    {tpl.message.replace(/{name}/g,waLead.full_name?.split(' ')[0]||'Customer').replace(/{amount}/g,Number(waLead.loan_amount||0).toLocaleString('en-IN')).replace(/{emi}/g,Math.round((Number(waLead.loan_amount||0)*0.012*Math.pow(1.012,36))/(Math.pow(1.012,36)-1)).toLocaleString('en-IN')).slice(0,120)+'…'}
                  </div>
                  <div style={{marginTop:8,fontSize:11,color:tpl.tagColor,fontWeight:600}}>↗ Opens WhatsApp</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* NOTE MODAL */}
      {showNoteModal&&noteLead&&(
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:300}} onClick={()=>setShowNoteModal(false)}/>
          <div style={{position:'fixed',top:isMobile?'auto':'50%',bottom:isMobile?0:'auto',left:isMobile?0:'50%',transform:isMobile?'none':'translate(-50%,-50%)',background:'white',borderRadius:isMobile?'16px 16px 0 0':16,boxShadow:'0 24px 60px rgba(0,0,0,0.18)',zIndex:400,width:isMobile?'100%':'90%',maxWidth:420,overflow:'hidden'}}>
            <div style={{background:'#854F0B',padding:'14px 18px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div style={{display:'flex',alignItems:'center',gap:8,color:'white',fontWeight:700,fontSize:14}}><IconNotes size={16}/>Add Note — {noteLead.full_name}</div>
              <button onClick={()=>setShowNoteModal(false)} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',width:28,height:28,borderRadius:'50%',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><IconX size={13}/></button>
            </div>
            <div style={{padding:'16px 18px'}}>
              {noteLead.notes&&(
                <div style={{background:'#FFFAF0',border:'1px solid #F6E05E',borderRadius:8,padding:10,marginBottom:12,fontSize:12,color:'#744210',maxHeight:80,overflowY:'auto',lineHeight:1.5}}>
                  <strong style={{display:'block',marginBottom:4}}>Previous:</strong>{noteLead.notes}
                </div>
              )}
              <textarea value={noteText} onChange={e=>setNoteText(e.target.value)}
                placeholder="Type your call note here..."
                style={{width:'100%',border:'1.5px solid #E2E8F0',borderRadius:8,padding:10,fontSize:14,outline:'none',resize:'vertical',minHeight:100,fontFamily:'inherit',marginBottom:12,boxSizing:'border-box',color:'#111827'}}
                onFocus={e=>e.target.style.borderColor='#185FA5'}
                onBlur={e=>e.target.style.borderColor='#E2E8F0'}/>
              <div style={{display:'flex',gap:8}}>
                <button onClick={saveNote} style={{flex:1,padding:12,background:'#185FA5',color:'white',border:'none',borderRadius:8,fontSize:14,fontWeight:600,cursor:'pointer'}}>Save Note</button>
                <button onClick={()=>setShowNoteModal(false)} style={{padding:'12px 16px',background:'transparent',border:'1px solid #E2E8F0',borderRadius:8,fontSize:13,cursor:'pointer',color:'#6B7280'}}>Cancel</button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* OBLIGATION MODAL */}
      {showObligationModal&&selectedLeadForObligations&&(
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:350}} onClick={()=>setShowObligationModal(false)}/>
          <div style={{position:'fixed',top:isMobile?0:'50%',left:isMobile?0:'50%',transform:isMobile?'none':'translate(-50%,-50%)',background:'#0f172a',borderRadius:isMobile?0:18,zIndex:360,width:isMobile?'100%':'92%',maxWidth:980,height:isMobile?'100%':'auto',maxHeight:isMobile?'100vh':'90vh',overflow:'hidden',display:'flex',flexDirection:'column',boxShadow:'0 32px 80px rgba(15,23,42,0.35)'}}>
            <div style={{background:'#111827',padding:'18px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
              <div>
                <div style={{fontSize:17,fontWeight:700,color:'white'}}>Loan Obligations — {selectedLeadForObligations.full_name}</div>
                <div style={{fontSize:12,color:'#94a3b8',marginTop:4}}>Add and manage all obligations fast with summary totals and premium layout.</div>
              </div>
              <button onClick={()=>setShowObligationModal(false)} style={{background:'rgba(255,255,255,0.12)',border:'none',color:'white',width:36,height:36,borderRadius:'50%',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><IconX size={16}/></button>
            </div>
            <div style={{padding:'18px',flex:1,overflowY:'auto',background:'#0f172a',color:'#e2e8f0'}}>
              <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',justifyContent:'space-between',gap:12,marginBottom:14}}>
                <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(3,auto)',gap:10}}>
                  <div style={{background:'#111827',border:'1px solid #334155',borderRadius:14,padding:'14px 16px',minWidth:160}}>
                    <div style={{fontSize:11,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:4}}>Total EMI</div>
                    <div style={{fontSize:22,fontWeight:800,color:'#38bdf8'}}>₹{obligationTotals.totalEMI.toLocaleString('en-IN')}</div>
                  </div>
                  <div style={{background:'#111827',border:'1px solid #334155',borderRadius:14,padding:'14px 16px',minWidth:160}}>
                    <div style={{fontSize:11,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:4}}>Outstanding</div>
                    <div style={{fontSize:22,fontWeight:800,color:'#a78bfa'}}>₹{obligationTotals.totalOutstanding.toLocaleString('en-IN')}</div>
                  </div>
                  <div style={{background:'#111827',border:'1px solid #334155',borderRadius:14,padding:'14px 16px',minWidth:160}}>
                    <div style={{fontSize:11,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:4}}>FOIR</div>
                    <div style={{fontSize:22,fontWeight:800,color:'#22c55e'}}>{obligationTotals.foir}%</div>
                  </div>
                </div>
                <button onClick={addObligationDraft}
                  style={{padding:'12px 18px',borderRadius:12,background:'#2563eb',color:'white',fontWeight:700,fontSize:13,border:'none',cursor:'pointer',minWidth:160}}>
                  + Add Obligation
                </button>
              </div>
              {obligationError&&(
                <div style={{background:'#7f1d1d',color:'white',borderRadius:12,padding:'12px 14px',marginBottom:14,fontSize:13}}>{obligationError}</div>
              )}
              {obligationDrafts.length===0&&(
                <div style={{background:'#111827',border:'1px dashed #334155',borderRadius:16,padding:'30px 20px',textAlign:'center',color:'#94a3b8'}}>
                  No obligations yet. Click <strong style={{color:'white'}}>+ Add Obligation</strong> to start capturing liabilities.
                </div>
              )}
              {obligationDrafts.map(ob=>{
                const isHousing=ob.obligation_type==='Housing Loan'
                return(
                  <div key={ob.id} style={{background:'#111827',border:'1px solid #334155',borderRadius:18,padding:18,marginBottom:14}}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
                      <div>
                        <div style={{fontSize:15,fontWeight:800,color:'white'}}>{enrichDraftTitle(ob)}</div>
                        <div style={{fontSize:12,color:'#94a3b8',marginTop:3}}>{ob.emi_amount?`EMI ₹${Number(ob.emi_amount).toLocaleString('en-IN')}`:'EMI not set'} · {ob.outstanding_amount?`Outstanding ₹${Number(ob.outstanding_amount).toLocaleString('en-IN')}`:'Outstanding not set'}</div>
                      </div>
                      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                        <button onClick={()=>toggleObligationExpand(ob.id)}
                          style={{padding:'10px 14px',borderRadius:10,border:'1px solid #334155',background:'transparent',color:'#e2e8f0',cursor:'pointer',fontSize:12,fontWeight:700}}>{ob.expanded?'Hide':'Edit'}</button>
                        <button onClick={()=>saveObligationCard(ob)} disabled={savingObligation}
                          style={{padding:'10px 14px',borderRadius:10,border:'none',background:'#22c55e',color:'white',cursor:'pointer',fontSize:12,fontWeight:700,opacity:savingObligation?0.6:1}}>{String(ob.id).startsWith('tmp-')?'Save':'Update'}</button>
                        <button onClick={()=>deleteObligationCard(ob)}
                          style={{padding:'10px 14px',borderRadius:10,border:'1px solid #7f1d1d',background:'transparent',color:'#fda4af',cursor:'pointer',fontSize:12,fontWeight:700}}>Delete</button>
                      </div>
                    </div>
                    {ob.expanded&&(
                      <div style={{marginTop:16,display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(2,1fr)',gap:12}}>
                        <label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8'}}>Obligation Type</label>
                        <select value={ob.obligation_type} onChange={e=>handleObligationFieldChange(ob.id,'obligation_type',e.target.value)}
                          style={{width:'100%',padding:12,borderRadius:12,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none'}}>
                          {OBLIGATION_TYPES.map(type=><option key={type} value={type}>{type}</option>)}
                        </select>
                        <label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8'}}>Bank / NBFC Name</label>
                        <input value={ob.bank_name} onChange={e=>handleObligationFieldChange(ob.id,'bank_name',e.target.value)}
                          style={{width:'100%',padding:12,borderRadius:12,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none'}}/>
                        <label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8'}}>EMI Amount</label>
                        <input type="number" min="0" value={ob.emi_amount} onChange={e=>handleObligationFieldChange(ob.id,'emi_amount',e.target.value)}
                          style={{width:'100%',padding:12,borderRadius:12,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none'}}/>
                        <label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8'}}>Outstanding Amount</label>
                        <input type="number" min="0" value={ob.outstanding_amount} onChange={e=>handleObligationFieldChange(ob.id,'outstanding_amount',e.target.value)}
                          style={{width:'100%',padding:12,borderRadius:12,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none'}}/>
                        <label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8'}}>Sanctioned Loan Amount</label>
                        <input type="number" min="0" value={ob.sanctioned_amount} onChange={e=>handleObligationFieldChange(ob.id,'sanctioned_amount',e.target.value)}
                          style={{width:'100%',padding:12,borderRadius:12,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none'}}/>
                        <label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8'}}>Tenure (months)</label>
                        <input type="number" min="0" value={ob.tenure_months} onChange={e=>handleObligationFieldChange(ob.id,'tenure_months',e.target.value)}
                          style={{width:'100%',padding:12,borderRadius:12,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none'}}/>
                        <label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8'}}>Remaining Tenure</label>
                        <input type="number" min="0" value={ob.remaining_tenure} onChange={e=>handleObligationFieldChange(ob.id,'remaining_tenure',e.target.value)}
                          style={{width:'100%',padding:12,borderRadius:12,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none'}}/>
                        <label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8'}}>EMIs Paid</label>
                        <input type="number" min="0" value={ob.emis_paid} onChange={e=>handleObligationFieldChange(ob.id,'emis_paid',e.target.value)}
                          style={{width:'100%',padding:12,borderRadius:12,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none'}}/>
                        <label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8'}}>Any EMI Bounces?</label>
                        <select value={ob.bounce} onChange={e=>handleObligationFieldChange(ob.id,'bounce',e.target.value)}
                          style={{width:'100%',padding:12,borderRadius:12,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none'}}>
                          {YES_NO_OPTIONS.map(opt=><option key={opt} value={opt}>{opt}</option>)}
                        </select>
                        <label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8'}}>Overdue Amount</label>
                        <input type="number" min="0" value={ob.overdue_amount} onChange={e=>handleObligationFieldChange(ob.id,'overdue_amount',e.target.value)}
                          style={{width:'100%',padding:12,borderRadius:12,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none'}}/>
                        <label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8'}}>Current DPD / Delays</label>
                        <input value={ob.dpd} onChange={e=>handleObligationFieldChange(ob.id,'dpd',e.target.value)}
                          style={{width:'100%',padding:12,borderRadius:12,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none'}}/>
                        <label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8'}}>Address Proof Available?</label>
                        <select value={ob.address_proof} onChange={e=>handleObligationFieldChange(ob.id,'address_proof',e.target.value)}
                          style={{width:'100%',padding:12,borderRadius:12,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none'}}>
                          {YES_NO_OPTIONS.map(opt=><option key={opt} value={opt}>{opt}</option>)}
                        </select>
                        {isHousing&&(
                          <>
                            <div style={{gridColumn:'1 / -1',marginTop:4}}>
                              <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(2,1fr)',gap:12}}>
                                <div>
                                  <label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8'}}>Joint or Individual Loan?</label>
                                  <select value={ob.joint_type} onChange={e=>handleObligationFieldChange(ob.id,'joint_type',e.target.value)}
                                    style={{width:'100%',padding:12,borderRadius:12,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none'}}>
                                    {JOINT_OPTIONS.map(opt=><option key={opt} value={opt}>{opt}</option>)}
                                  </select>
                                </div>
                                {ob.joint_type==='Joint'&&(
                                  <>
                                    <div>
                                      <label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8'}}>Joint Holder Name</label>
                                      <input value={ob.joint_holder_name} onChange={e=>handleObligationFieldChange(ob.id,'joint_holder_name',e.target.value)}
                                        style={{width:'100%',padding:12,borderRadius:12,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none'}}/>
                                    </div>
                                    <div>
                                      <label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8'}}>Joint Holder Income</label>
                                      <input type="number" min="0" value={ob.joint_holder_income} onChange={e=>handleObligationFieldChange(ob.id,'joint_holder_income',e.target.value)}
                                        style={{width:'100%',padding:12,borderRadius:12,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none'}}/>
                                    </div>
                                    <div style={{gridColumn:'1 / -1'}}>
                                      <label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8'}}>Joint Holder Relation</label>
                                      <input value={ob.joint_holder_relation} onChange={e=>handleObligationFieldChange(ob.id,'joint_holder_relation',e.target.value)}
                                        style={{width:'100%',padding:12,borderRadius:12,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none'}}/>
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* EXPORT MODAL */}
      {showExportModal&&(
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:300}} onClick={()=>setShowExportModal(false)}/>
          <div style={{position:'fixed',top:isMobile?0:'50%',left:isMobile?0:'50%',transform:isMobile?'none':'translate(-50%,-50%)',background:'white',borderRadius:isMobile?0:16,zIndex:400,width:isMobile?'100%':'90%',maxWidth:500,height:isMobile?'100%':'auto',maxHeight:isMobile?'100vh':'90vh',overflow:'hidden',display:'flex',flexDirection:'column'}}>
            <div style={{background:'linear-gradient(135deg,#185FA5,#2563EB)',padding:'16px 18px',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
              <div>
                <div style={{color:'white',fontWeight:700,fontSize:15}}>Export Leads Report</div>
                <div style={{color:'rgba(255,255,255,0.7)',fontSize:12,marginTop:2}}>Filter by stage or date — download CSV</div>
              </div>
              <button onClick={()=>setShowExportModal(false)} style={{background:'rgba(255,255,255,0.15)',border:'none',color:'white',width:30,height:30,borderRadius:'50%',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><IconX size={14}/></button>
            </div>
            <div style={{padding:16,overflowY:'auto',flex:1}}>
              <div style={{fontSize:13,fontWeight:600,color:'#374151',marginBottom:8}}>Step 1 — Select Stage</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:7,marginBottom:16}}>
                {['',...STATUS_OPTIONS].map(s=>{
                  const st=STATUS_STYLE[s]||{}
                  const sel=exportStatus===s
                  return <div key={s} onClick={()=>setExportStatus(s)} style={{padding:'7px 13px',borderRadius:20,border:'1.5px solid '+(sel?(s?st.color:'#185FA5'):'#E5E7EB'),background:sel?(s?st.bg:'#185FA5'):'white',color:sel?(s?st.color:'white'):'#6B7280',fontSize:12,fontWeight:500,cursor:'pointer'}}>{s||'All Stages'}</div>
                })}
              </div>
              <div style={{fontSize:13,fontWeight:600,color:'#374151',marginBottom:8}}>Step 2 — Select Date</div>
              <div style={{display:'flex',gap:7,flexWrap:'wrap',marginBottom:12}}>
                {[{id:'all',label:'All Time'},{id:'today',label:'Today'},{id:'week',label:'This Week'},{id:'month',label:'This Month'},{id:'custom',label:'📅 Custom'}].map(d=>(
                  <div key={d.id} onClick={()=>setExportDateType(d.id)} style={{padding:'7px 13px',borderRadius:20,border:'1.5px solid '+(exportDateType===d.id?'#185FA5':'#E5E7EB'),background:exportDateType===d.id?'#185FA5':'white',color:exportDateType===d.id?'white':'#6B7280',fontSize:12,fontWeight:500,cursor:'pointer'}}>{d.label}</div>
                ))}
              </div>
              {exportDateType==='custom'&&(
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,background:'#F9FAFB',padding:14,borderRadius:8,marginBottom:14}}>
                  <div><div style={{fontSize:11,fontWeight:600,color:'#6B7280',marginBottom:5,textTransform:'uppercase'}}>From</div><input type="date" value={exportStartDate} onChange={e=>setExportStartDate(e.target.value)} style={{width:'100%',padding:8,border:'1px solid #E2E8F0',borderRadius:6,fontSize:13}}/></div>
                  <div><div style={{fontSize:11,fontWeight:600,color:'#6B7280',marginBottom:5,textTransform:'uppercase'}}>To</div><input type="date" value={exportEndDate} onChange={e=>setExportEndDate(e.target.value)} style={{width:'100%',padding:8,border:'1px solid #E2E8F0',borderRadius:6,fontSize:13}}/></div>
                </div>
              )}
              <div style={{background:exportCount>0?'#EBF8FF':'#FFF5F5',border:'1px solid '+(exportCount>0?'#BEE3F8':'#FED7D7'),borderRadius:10,padding:'14px 16px',marginBottom:16,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div>
                  <div style={{fontWeight:700,fontSize:20,color:exportCount>0?'#185FA5':'#A32D2D'}}>{exportCount} leads ready</div>
                  <div style={{fontSize:12,color:'#9CA3AF',marginTop:2}}>Stage: <strong>{exportStatus||'All'}</strong> · Period: <strong>{exportDateType}</strong></div>
                </div>
                <div style={{fontSize:28}}>📊</div>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={handleExport} disabled={exportCount===0}
                  style={{flex:1,padding:12,background:exportCount>0?'#185FA5':'#E5E7EB',color:exportCount>0?'white':'#9CA3AF',border:'none',borderRadius:8,fontSize:14,fontWeight:600,cursor:exportCount>0?'pointer':'not-allowed',display:'flex',alignItems:'center',justifyContent:'center',gap:7}}>
                  <IconDownload size={15}/>Download CSV ({exportCount})
                </button>
                <button onClick={()=>setShowExportModal(false)} style={{padding:'12px 16px',background:'transparent',border:'1px solid #E2E8F0',borderRadius:8,fontSize:13,cursor:'pointer',color:'#6B7280'}}>Cancel</button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ══════════ TOP BAR ══════════ */}
      <div style={{background:bg1,borderBottom:'1px solid '+bdr,padding:isMobile?'12px 14px':'12px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,position:'sticky',top:0,zIndex:50}}>
        <div style={{minWidth:0,flex:1}}>
          <div style={{fontSize:isMobile?14:16,fontWeight:700,color:txt1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{greeting||'Welcome back 👋'}</div>
          {!isMobile&&<div style={{fontSize:12,color:txt2,marginTop:2}}>Ready to close more loans today? 🚀</div>}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
          {!isMobile&&(
            <button onClick={()=>setDarkMode(!darkMode)} style={{padding:'7px 10px',background:'transparent',border:'1px solid '+bdr,borderRadius:8,cursor:'pointer',fontSize:12,color:txt2}}>{darkMode?'☀️':'🌙'}</button>
          )}
          <button onClick={()=>setShowNotifPanel(true)}
            style={{position:'relative',background:notifications.length>0?'#FAEEDA':'transparent',border:'1px solid '+(notifications.length>0?'#F6E05E':bdr),borderRadius:8,padding:'8px 10px',cursor:'pointer',display:'flex',alignItems:'center',gap:4,color:notifications.length>0?'#854F0B':txt2,fontSize:12,fontWeight:500}}>
            <IconBell size={16}/>
            {notifications.length>0&&<span style={{background:'#A32D2D',color:'white',borderRadius:'50%',width:16,height:16,fontSize:9,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center'}}>{notifications.length}</span>}
          </button>
          {!isMobile&&['today','week','month'].map(r=>(
            <button key={r} onClick={()=>setDateRange(r)}
              style={{padding:'7px 10px',border:'1px solid '+(dateRange===r?'#185FA5':bdr),borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:500,background:dateRange===r?'#185FA5':'transparent',color:dateRange===r?'white':txt2}}>
              {r==='today'?'Today':r==='week'?'Week':'Month'}
            </button>
          ))}
          {isMobile&&(
            <select value={dateRange} onChange={e=>setDateRange(e.target.value)}
              style={{padding:'7px 10px',border:'1px solid '+bdr,borderRadius:8,fontSize:12,background:bg1,color:txt1,outline:'none'}}>
              <option value="today">Today</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          )}
          <button onClick={fetchAll} style={{padding:'7px 9px',border:'1px solid '+bdr,borderRadius:8,cursor:'pointer',background:'transparent',color:txt2,display:'flex',alignItems:'center'}}><IconRefresh size={14}/></button>
        </div>
      </div>

      {/* ══════════ CONTENT ══════════ */}
      <div style={{padding:isMobile?'12px 14px':'16px 20px',maxWidth:1400,margin:'0 auto'}}>

        {overdueTasks.length>0&&(
          <div style={{background:'#FFF5F5',border:'1px solid #FED7D7',borderRadius:10,padding:'11px 14px',marginBottom:14,display:'flex',alignItems:'center',gap:10}}>
            <IconAlertTriangle size={16} color="#A32D2D"/>
            <span style={{fontSize:13,color:'#A32D2D',fontWeight:600,flex:1}}>⚠️ {overdueTasks.length} overdue task{overdueTasks.length>1?'s':''}!</span>
            <button onClick={()=>setShowNotifPanel(true)} style={{background:'#A32D2D',color:'white',border:'none',padding:'4px 10px',borderRadius:6,cursor:'pointer',fontSize:12,fontWeight:600,flexShrink:0}}>View</button>
          </div>
        )}

        {/* PIPELINE CARDS — 2x2 on mobile */}
        <div style={{fontSize:11,fontWeight:700,color:txt2,marginBottom:8,textTransform:'uppercase',letterSpacing:'0.6px'}}>📊 Pipeline Overview</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:10,marginBottom:16}}>
          {PIPELINE_CARDS.map(s=>(
            <div key={s.label}
              onClick={()=>{setFilterStatus(s.status);setActiveTab('leads')}}
              style={{background:s.bg,borderRadius:12,padding:isMobile?'12px':16,cursor:'pointer',border:'1px solid rgba(0,0,0,0.05)'}}>
              <div style={{fontSize:isMobile?24:32,fontWeight:700,color:s.color,lineHeight:1,marginBottom:4}}>{s.value}</div>
              <div style={{fontSize:isMobile?11:12,fontWeight:600,color:s.color}}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* STAT CARDS — 2x2 on mobile */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:10,marginBottom:14}}>
          {[
            {icon:<IconUsers size={16}/>,        label:'Total Leads',  value:myLeads.length,                                                    color:'#185FA5',bg:'#E6F1FB'},
            {icon:<IconPhoneIncoming size={16}/>, label:'Calls Made',   value:myCalls.length,                                                    color:'#0F6E56',bg:'#E1F5EE'},
            {icon:<IconClockHour4 size={16}/>,    label:'Pending Tasks',value:pendingTasks.length,                                               color:'#854F0B',bg:'#FAEEDA'},
            {icon:<IconCircleCheck size={16}/>,   label:'Approvals',    value:myLeads.filter(l=>['Approved','Disbursed'].includes(l.status)).length,color:'#534AB7',bg:'#EEEDFE'},
          ].map(s=>(
            <div key={s.label} style={{background:bg1,border:'1px solid '+bdr,borderRadius:12,padding:isMobile?'12px':14,display:'flex',alignItems:'center',gap:10}}>
              <div style={{width:32,height:32,borderRadius:8,background:s.bg,display:'flex',alignItems:'center',justifyContent:'center',color:s.color,flexShrink:0}}>{s.icon}</div>
              <div>
                <div style={{fontSize:10,color:txt2,marginBottom:2}}>{s.label}</div>
                <div style={{fontSize:20,fontWeight:700,color:s.color,lineHeight:1}}>{s.value}</div>
              </div>
            </div>
          ))}
        </div>

        {/* EXPORT BUTTON */}
        <div style={{background:bg1,borderRadius:10,border:'1px solid '+bdr,padding:'12px 14px',marginBottom:12,display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
          <div>
            <div style={{fontWeight:600,fontSize:13,color:txt1,marginBottom:1}}>📥 Export Leads Report</div>
            {!isMobile&&<div style={{fontSize:12,color:txt2}}>Filter by stage or date range</div>}
          </div>
          <button onClick={()=>setShowExportModal(true)}
            className="mobile-button"
            style={{display:'flex',alignItems:'center',gap:6,background:'#185FA5',color:'white',border:'none',padding:'10px 16px',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:600,flexShrink:0}}>
            <IconDownload size={14}/>Export
          </button>
        </div>

        {/* TABS */}
        <div style={{display:'flex',gap:4,background:darkMode?bg1:'#F0F0F0',padding:4,borderRadius:10,marginBottom:12}}>
          {[{id:'leads',label:`Leads (${myLeads.length})`},{id:'calls',label:`Calls (${myCalls.length})`},{id:'tasks',label:`Tasks (${pendingTasks.length})`}].map(t=>(
            <button key={t.id} onClick={()=>setActiveTab(t.id)}
              style={{flex:1,padding:'9px 8px',border:'none',borderRadius:7,fontSize:13,fontWeight:600,cursor:'pointer',transition:'all 0.15s',
                background:activeTab===t.id?'white':'transparent',
                color:activeTab===t.id?'#185FA5':txt2,
                boxShadow:activeTab===t.id?'0 1px 4px rgba(0,0,0,0.08)':'none'}}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ════════ LEADS TAB ════════ */}
        {activeTab==='leads'&&(
          <div>
            <div style={{display:'flex',gap:8,marginBottom:10,flexWrap:'wrap'}}>
              <div style={{flex:1,minWidth:0,position:'relative'}}>
                <IconSearch size={14} color="#A0AEC0" style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',pointerEvents:'none'}}/>
                <input
                  className="mobile-input"
                  style={{width:'100%',padding:'10px 12px 10px 32px',border:'1.5px solid '+bdr,borderRadius:8,fontSize:14,outline:'none',boxSizing:'border-box',background:bg1,color:txt1}}
                  placeholder="Search name, mobile…"
                  value={search} onChange={e=>setSearch(e.target.value)}
                  onFocus={e=>e.target.style.borderColor='#185FA5'}
                  onBlur={e=>e.target.style.borderColor=bdr}/>
              </div>
              <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}
                className="mobile-select"
                style={{padding:'10px 10px',border:'1.5px solid '+bdr,borderRadius:8,fontSize:13,background:bg1,color:txt1,outline:'none',flexShrink:0}}>
                <option value="">All Stages</option>
                {STATUS_OPTIONS.map(s=><option key={s}>{s}</option>)}
              </select>
            </div>

            {/* MOBILE: card layout | DESKTOP: table layout */}
            {isMobile?(
              <div>
                {loading?(
                  <div style={{padding:30,textAlign:'center',color:txt2}}>Loading…</div>
                ):filteredLeads.length===0?(
                  <div style={{padding:30,textAlign:'center',color:txt2,background:bg1,borderRadius:12,border:'1px solid '+bdr}}>
                    <IconUsers size={32} strokeWidth={1.2} color="#CBD5E0" style={{display:'block',margin:'0 auto 8px'}}/>
                    {search||filterStatus?'No leads match':'No leads assigned yet'}
                  </div>
                ):filteredLeads.map(lead=>{
                  const st=STATUS_STYLE[lead.status]||{bg:'#F3F4F6',color:'#6B7280'}
                  const tc=TEMP_COLORS[lead.lead_temperature]||TEMP_COLORS.Cold
                  return(
                    <div key={lead.id} style={{background:bg1,border:'1px solid '+bdr,borderRadius:12,padding:14,marginBottom:10}}>
                      {/* Lead header */}
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                        <div style={{display:'flex',alignItems:'center',gap:10}}>
                          <div style={{width:36,height:36,borderRadius:'50%',background:'#E6F1FB',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:600,color:'#185FA5',fontSize:13,flexShrink:0}}>{initials(lead.full_name)}</div>
                          <div>
                            <div style={{fontWeight:700,fontSize:14,color:txt1}}>{lead.full_name}</div>
                            <div style={{fontSize:12,color:txt2}}>{lead.mobile}{lead.city?` · ${lead.city}`:''}</div>
                          </div>
                        </div>
                        <span style={{background:tc.bg,color:tc.color,padding:'3px 8px',borderRadius:20,fontSize:11,fontWeight:600,flexShrink:0}}>{tc.icon} {lead.lead_temperature||'Cold'}</span>
                      </div>

                      {/* Loan amount + stage */}
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                        <div>
                          <div style={{fontWeight:700,color:'#185FA5',fontSize:15}}>{fmtAmt(lead.loan_amount)}</div>
                          {lead.monthly_salary&&<div style={{fontSize:11,color:txt2}}>Sal: {fmtAmt(lead.monthly_salary)}</div>}
                        </div>
                        <select value={lead.status||'New'} onChange={e=>updateLeadStatus(lead.id,e.target.value)}
                          style={{background:st.bg,color:st.color,border:'1.5px solid '+st.color+'55',padding:'6px 10px',borderRadius:20,fontSize:12,fontWeight:600,cursor:'pointer',outline:'none'}}>
                          {STATUS_OPTIONS.map(s=><option key={s} value={s} style={{background:'white',color:'black'}}>{s}</option>)}
                        </select>
                      </div>

                      {/* Action buttons */}
                      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:8}}>
                        <button onClick={()=>openCallingWorkspace(lead)}
                          style={{padding:'10px 0',borderRadius:8,background:'#EAF3DE',border:'1px solid #86EFAC',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'#166534',gap:3}}>
                          <IconPhone size={16}/>
                          <span style={{fontSize:10,fontWeight:600}}>Call</span>
                        </button>
                        <button onClick={()=>{setWaLead(lead);setShowWAModal(true)}}
                          style={{padding:'10px 0',borderRadius:8,background:'#F0FFF4',border:'1px solid #86EFAC',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'#16A34A',gap:3}}>
                          <IconBrandWhatsapp size={16}/>
                          <span style={{fontSize:10,fontWeight:600}}>WhatsApp</span>
                        </button>
                        <button onClick={()=>openObligationModal(lead)}
                          style={{padding:'10px 0',borderRadius:8,background:'#EFF6FF',border:'1px solid #93C5FD',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'#1D4ED8',gap:3}}>
                          <IconBuildingStore size={16}/>
                          <span style={{fontSize:10,fontWeight:600}}>Obligations</span>
                        </button>
                        <button onClick={()=>{if(lead.email)window.location.href=`mailto:${lead.email}`;else showToast('No email','error')}}
                          style={{padding:'10px 0',borderRadius:8,background:'#EFF6FF',border:'1px solid #93C5FD',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'#1D4ED8',gap:3,opacity:lead.email?1:0.4}}>
                          <IconMail size={16}/>
                          <span style={{fontSize:10,fontWeight:600}}>Email</span>
                        </button>
                        <button onClick={()=>{setNoteLead(lead);setNoteText('');setShowNoteModal(true)}}
                          style={{padding:'10px 0',borderRadius:8,background:'#FFF7ED',border:'1px solid #FCD34D',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'#92400E',gap:3}}>
                          <IconNotes size={16}/>
                          <span style={{fontSize:10,fontWeight:600}}>Note</span>
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            ):(
              // DESKTOP TABLE
              <div className="mobile-table" style={{background:bg1,border:'1px solid '+bdr,borderRadius:12,overflow:'hidden'}}>
                <div style={{padding:'11px 16px',borderBottom:'1px solid '+bdr,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span style={{fontWeight:600,fontSize:13,color:txt1}}>{filterStatus?`${filterStatus} (${filteredLeads.length})`:`All Leads (${filteredLeads.length})`}</span>
                  <div style={{display:'flex',gap:6}}>
                    {['New','Interested','Callback'].map(s=>{const st=STATUS_STYLE[s]||{};return <span key={s} style={{background:st.bg,color:st.color,padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:500}}>{myLeads.filter(l=>l.status===s).length} {s}</span>})}
                  </div>
                </div>
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <thead>
                      <tr style={{background:darkMode?'#0f172a':'#F9FAFB'}}>
                        {['Lead','Loan Amt','Stage','Temp','Pipeline','Actions'].map(h=>(
                          <th key={h} style={{padding:'10px 14px',fontSize:11,fontWeight:600,color:txt2,textAlign:'left',textTransform:'uppercase',letterSpacing:'0.4px',whiteSpace:'nowrap'}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {loading?(
                        <tr><td colSpan={6} style={{padding:40,textAlign:'center',fontSize:13,color:txt2}}>Loading…</td></tr>
                      ):filteredLeads.length===0?(
                        <tr><td colSpan={6} style={{padding:40,textAlign:'center'}}>
                          <IconUsers size={36} strokeWidth={1.2} color="#CBD5E0" style={{display:'block',margin:'0 auto 8px'}}/>
                          <div style={{fontSize:13,color:txt2}}>{search||filterStatus?'No leads match':'No leads assigned yet'}</div>
                        </td></tr>
                      ):filteredLeads.map(lead=>{
                        const st  =STATUS_STYLE[lead.status]||{bg:'#F3F4F6',color:'#6B7280'}
                        const pIdx=PIPELINE.indexOf(lead.status)
                        const tc  =TEMP_COLORS[lead.lead_temperature]||TEMP_COLORS.Cold
                        return(
                          <tr key={lead.id} style={{borderBottom:'1px solid '+bdr,transition:'background 0.1s'}}
                            onMouseEnter={e=>e.currentTarget.style.background=bg2}
                            onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                            <td style={{padding:'12px 14px'}}>
                              <div style={{display:'flex',alignItems:'center',gap:9}}>
                                <div style={{width:34,height:34,borderRadius:'50%',background:'#E6F1FB',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:600,color:'#185FA5',fontSize:12,flexShrink:0}}>{initials(lead.full_name)}</div>
                                <div>
                                  <div style={{fontWeight:600,fontSize:13,color:txt1}}>{lead.full_name}</div>
                                  <div style={{fontSize:11,color:txt2}}>{lead.mobile}{lead.city?` · ${lead.city}`:''}</div>
                                  {lead.call_count>0&&<div style={{fontSize:10,color:'#9CA3AF'}}>📞 {lead.call_count} calls</div>}
                                </div>
                              </div>
                            </td>
                            <td style={{padding:'12px 14px'}}>
                              <div style={{fontWeight:600,color:'#185FA5',fontSize:13}}>{fmtAmt(lead.loan_amount)}</div>
                              {lead.monthly_salary&&<div style={{fontSize:10,color:txt2}}>Sal: {fmtAmt(lead.monthly_salary)}</div>}
                            </td>
                            <td style={{padding:'12px 14px'}}>
                              <select value={lead.status||'New'} onChange={e=>updateLeadStatus(lead.id,e.target.value)}
                                style={{background:st.bg,color:st.color,border:'1.5px solid '+st.color+'55',padding:'5px 10px',borderRadius:20,fontSize:11,fontWeight:600,cursor:'pointer',outline:'none',minWidth:120}}>
                                {STATUS_OPTIONS.map(s=><option key={s} value={s} style={{background:'white',color:'black'}}>{s}</option>)}
                              </select>
                            </td>
                            <td style={{padding:'12px 14px'}}>
                              <span style={{background:tc.bg,color:tc.color,padding:'3px 8px',borderRadius:20,fontSize:11,fontWeight:600}}>{tc.icon} {lead.lead_temperature||'Cold'}</span>
                            </td>
                            <td style={{padding:'12px 14px'}}>
                              <div style={{display:'flex',gap:3,marginBottom:3}}>
                                {PIPELINE.map((s,i)=>(
                                  <div key={s} title={s} style={{height:5,width:18,borderRadius:3,background:i<=pIdx?'#185FA5':'#E2E8F0'}}/>
                                ))}
                              </div>
                              <div style={{fontSize:10,color:txt2}}>{pIdx>=0&&pIdx<PIPELINE.length-1?`Next: ${PIPELINE[pIdx+1]}`:pIdx===PIPELINE.length-1?'✅ Final':''}</div>
                            </td>
                            <td style={{padding:'12px 14px'}}>
                              <div style={{display:'flex',gap:5}}>
                                <button title="Call" onClick={()=>openCallingWorkspace(lead)}
                                  style={{width:32,height:32,borderRadius:8,background:'#EAF3DE',border:'1px solid #86EFAC',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'#166534'}}
                                  onMouseEnter={e=>{e.currentTarget.style.background='#86EFAC'}}
                                  onMouseLeave={e=>{e.currentTarget.style.background='#EAF3DE'}}>
                                  <IconPhone size={14}/>
                                </button>
                                <button title="WhatsApp" onClick={()=>{setWaLead(lead);setShowWAModal(true)}}
                                  style={{width:32,height:32,borderRadius:8,background:'#F0FFF4',border:'1px solid #86EFAC',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'#16A34A'}}
                                  onMouseEnter={e=>{e.currentTarget.style.background='#86EFAC'}}
                                  onMouseLeave={e=>{e.currentTarget.style.background='#F0FFF4'}}>
                                  <IconBrandWhatsapp size={14}/>
                                </button>
                                <button title="Obligations" onClick={()=>openObligationModal(lead)}
                                  style={{width:32,height:32,borderRadius:8,background:'#EFF6FF',border:'1px solid #93C5FD',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'#1D4ED8'}}
                                  onMouseEnter={e=>{e.currentTarget.style.background='#93C5FD'}}
                                  onMouseLeave={e=>{e.currentTarget.style.background='#EFF6FF'}}>
                                  <IconBuildingStore size={14}/>
                                </button>
                                <button title="Email" onClick={()=>{if(lead.email)window.location.href=`mailto:${lead.email}`;else showToast('No email','error')}}
                                  style={{width:32,height:32,borderRadius:8,background:'#EFF6FF',border:'1px solid #93C5FD',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'#1D4ED8',opacity:lead.email?1:0.4}}
                                  onMouseEnter={e=>{if(lead.email)e.currentTarget.style.background='#93C5FD'}}
                                  onMouseLeave={e=>{e.currentTarget.style.background='#EFF6FF'}}>
                                  <IconMail size={14}/>
                                </button>
                                <button title="Note" onClick={()=>{setNoteLead(lead);setNoteText('');setShowNoteModal(true)}}
                                  style={{width:32,height:32,borderRadius:8,background:'#FFF7ED',border:'1px solid #FCD34D',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'#92400E'}}
                                  onMouseEnter={e=>{e.currentTarget.style.background='#FCD34D'}}
                                  onMouseLeave={e=>{e.currentTarget.style.background='#FFF7ED'}}>
                                  <IconNotes size={14}/>
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════════ CALLS TAB ════════ */}
        {activeTab==='calls'&&(
          <div style={{background:bg1,border:'1px solid '+bdr,borderRadius:12,overflow:'hidden'}}>
            <div style={{padding:'12px 14px',borderBottom:'1px solid '+bdr}}>
              <span style={{fontWeight:600,fontSize:13,color:txt1}}>My Call Logs ({myCalls.length})</span>
            </div>
            {isMobile?(
              <div style={{padding:'8px 12px'}}>
                {myCalls.length===0
                  ?<div style={{padding:30,textAlign:'center',color:txt2}}>No calls logged yet</div>
                  :myCalls.map(call=>{
                      const lead=myLeads.find(l=>l.id===call.lead_id)
                      const cs=call.call_status==='Answered'?{bg:'#EAF3DE',color:'#166534'}:{bg:'#FCEBEB',color:'#991B1B'}
                      return(
                        <div key={call.id} style={{padding:'12px 0',borderBottom:'1px solid '+bdr}}>
                          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                            <div style={{fontWeight:600,fontSize:13,color:txt1}}>{lead?.full_name||'Unknown'}</div>
                            <span style={{...cs,padding:'3px 8px',borderRadius:20,fontSize:11,fontWeight:500}}>{call.call_status}</span>
                          </div>
                          <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:8,fontSize:12,color:txt2}}>
                            <span>{lead?.mobile||'-'}</span>
                            <span>·</span>
                            <span>{call.duration||'-'}</span>
                            <span>·</span>
                            <span>{new Date(call.created_at).toLocaleDateString('en-IN')}</span>
                            {lead && getLeadObligations(lead.id).length>0&&(
                              <span style={{background:'#EFF6FF',color:'#1D4ED8',padding:'3px 8px',borderRadius:20,fontSize:11,fontWeight:600}}>🧾 {getLeadObligations(lead.id).length} obligations</span>
                            )}
                          </div>
                          {call.call_outcome&&<span style={{background:'#FAEEDA',color:'#854F0B',padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:500,marginTop:4,display:'inline-block'}}>{call.call_outcome}</span>}
                        </div>
                      )
                    })
                }
              </div>
            ):(
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead>
                    <tr style={{background:darkMode?'#0f172a':'#F9FAFB'}}>
                      {['Lead Name','Mobile','Status','Disposition','Duration','Date'].map(h=>(
                        <th key={h} style={{padding:'10px 14px',fontSize:11,fontWeight:600,color:txt2,textAlign:'left',textTransform:'uppercase',letterSpacing:'0.4px'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {myCalls.length===0
                      ?<tr><td colSpan={6} style={{padding:40,textAlign:'center',fontSize:13,color:txt2}}>No calls logged yet</td></tr>
                      :myCalls.map(call=>{
                          const lead=myLeads.find(l=>l.id===call.lead_id)
                          const cs=call.call_status==='Answered'?{bg:'#EAF3DE',color:'#166534'}:{bg:'#FCEBEB',color:'#991B1B'}
                          return(
                            <tr key={call.id} style={{borderBottom:'1px solid '+bdr}}>
                              <td style={{padding:'11px 14px',fontWeight:600,fontSize:13,color:txt1}}>
                                {lead?.full_name||'Unknown'}
                                {lead&&getLeadObligations(lead.id).length>0&&(
                                  <div style={{marginTop:4,fontSize:11,color:'#1D4ED8',fontWeight:600}}>🧾 {getLeadObligations(lead.id).length} obligations</div>
                                )}
                              </td>
                              <td style={{padding:'11px 14px',fontSize:13,color:txt2}}>{lead?.mobile||'-'}</td>
                              <td style={{padding:'11px 14px'}}><span style={{...cs,padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:500}}>{call.call_status}</span></td>
                              <td style={{padding:'11px 14px'}}>{call.call_outcome&&<span style={{background:'#FAEEDA',color:'#854F0B',padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:500}}>{call.call_outcome}</span>}</td>
                              <td style={{padding:'11px 14px',fontSize:13,color:txt2}}>{call.duration||'-'}</td>
                              <td style={{padding:'11px 14px',fontSize:12,color:txt2}}>{new Date(call.created_at).toLocaleDateString('en-IN')}</td>
                            </tr>
                          )
                        })
                    }
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ════════ TASKS TAB ════════ */}
        {activeTab==='tasks'&&(
          <div>
            <div style={{marginBottom:10,fontSize:13,color:txt2}}>{pendingTasks.length} pending · {overdueTasks.length} overdue</div>
            {pendingTasks.length===0
              ?<div style={{background:bg1,border:'1px solid '+bdr,borderRadius:12,padding:40,textAlign:'center'}}>
                  <div style={{fontSize:28,marginBottom:8}}>✅</div>
                  <div style={{fontWeight:600,fontSize:14,color:txt1,marginBottom:4}}>All tasks completed!</div>
                  <div style={{fontSize:13,color:txt2}}>Great work!</div>
                </div>
              :pendingTasks.map(task=>{
                  const od=new Date(task.due_date)<new Date()
                  const prC={High:{bg:'#FCEBEB',color:'#991B1B'},Medium:{bg:'#FAEEDA',color:'#92400E'},Low:{bg:'#EAF3DE',color:'#166634'}}[task.priority]||{bg:'#EAF3DE',color:'#166634'}
                  return(
                    <div key={task.id} style={{background:bg1,border:'1px solid '+(od?'#FCA5A5':bdr),borderRadius:10,padding:'13px 14px',marginBottom:8,borderLeft:'3px solid '+(od?'#EF4444':task.priority==='High'?'#EF4444':task.priority==='Medium'?'#F59E0B':'#22C55E')}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                        <div style={{flex:1,minWidth:0,marginRight:8}}>
                          <div style={{fontWeight:600,fontSize:13,color:od?'#DC2626':txt1,marginBottom:3}}>{od&&'⚠️ '}{task.title}</div>
                          {task.notes&&<div style={{fontSize:12,color:txt2,marginBottom:3}}>📝 {task.notes}</div>}
                          <div style={{fontSize:11,color:od?'#DC2626':txt2,fontWeight:od?600:400}}>🕐 {new Date(task.due_date).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
                        </div>
                        <span style={{...prC,padding:'3px 8px',borderRadius:20,fontSize:11,fontWeight:500,flexShrink:0}}>{task.priority}</span>
                      </div>
                    </div>
                  )
                })
            }
          </div>
        )}

      </div>
    </div>
  )
}

// =============================================
// WA TEMPLATE EDITOR
// =============================================
function WATemplateEditor() {
  const [templates,setTemplates]=useState(DEFAULT_WA_TEMPLATES)
  const [saved,setSaved]        =useState(false)
  const [loading,setLoading]    =useState(false)

  useEffect(()=>{
    const load=async()=>{
      const{data}=await supabase.from('settings').select('*').eq('key','wa_templates').single()
      if(data?.value){try{setTemplates(JSON.parse(data.value))}catch(e){}}
    }
    load()
  },[])

  const saveTemplates=async()=>{
    setLoading(true)
    const{data:existing}=await supabase.from('settings').select('*').eq('key','wa_templates').single()
    if(existing){ await supabase.from('settings').update({value:JSON.stringify(templates)}).eq('key','wa_templates') }
    else { await supabase.from('settings').insert([{key:'wa_templates',value:JSON.stringify(templates)}]) }
    setLoading(false); setSaved(true)
    setTimeout(()=>setSaved(false),2500)
  }

  const updateTpl=(id,field,value)=>setTemplates(prev=>prev.map(t=>t.id===id?{...t,[field]:value}:t))

  return(
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16,flexWrap:'wrap',gap:8}}>
        <div>
          <div style={{fontWeight:600,fontSize:15,color:'#111827',marginBottom:2}}>📱 WhatsApp Templates</div>
          <div style={{fontSize:12,color:'#6B7280'}}>Use <strong>{'{name}'}</strong>, <strong>{'{amount}'}</strong>, <strong>{'{emi}'}</strong> as placeholders.</div>
        </div>
        <button onClick={saveTemplates} disabled={loading}
          style={{display:'flex',alignItems:'center',gap:7,background:saved?'#EAF3DE':'#185FA5',color:saved?'#27500A':'white',border:'none',padding:'9px 18px',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:600}}>
          <IconDeviceFloppy size={15}/>{loading?'Saving…':saved?'✅ Saved!':'Save Templates'}
        </button>
      </div>
      {templates.map((tpl,idx)=>(
        <div key={tpl.id} style={{background:'white',border:'1px solid #E2E8F0',borderRadius:12,padding:16,marginBottom:14}}>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
            <div style={{width:32,height:32,borderRadius:8,background:tpl.tagBg||'#F9FAFB',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>{tpl.icon}</div>
            <div style={{fontWeight:600,fontSize:14,color:'#111827'}}>Template {idx+1}</div>
            <span style={{background:tpl.tagColor,color:'white',fontSize:10,padding:'2px 8px',borderRadius:20,fontWeight:600}}>{tpl.tag}</span>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
            <div>
              <label style={{display:'block',fontSize:11,fontWeight:600,color:'#6B7280',marginBottom:4,textTransform:'uppercase'}}>Button Name</label>
              <input value={tpl.name} onChange={e=>updateTpl(tpl.id,'name',e.target.value)} style={{width:'100%',padding:'8px 10px',border:'1px solid #E2E8F0',borderRadius:7,fontSize:13,outline:'none',boxSizing:'border-box'}} onFocus={e=>e.target.style.borderColor='#185FA5'} onBlur={e=>e.target.style.borderColor='#E2E8F0'}/>
            </div>
            <div>
              <label style={{display:'block',fontSize:11,fontWeight:600,color:'#6B7280',marginBottom:4,textTransform:'uppercase'}}>Icon</label>
              <input value={tpl.icon} onChange={e=>updateTpl(tpl.id,'icon',e.target.value)} style={{width:'100%',padding:'8px 10px',border:'1px solid #E2E8F0',borderRadius:7,fontSize:18,outline:'none',boxSizing:'border-box'}} onFocus={e=>e.target.style.borderColor='#185FA5'} onBlur={e=>e.target.style.borderColor='#E2E8F0'}/>
            </div>
          </div>
          <div>
            <label style={{display:'block',fontSize:11,fontWeight:600,color:'#6B7280',marginBottom:4,textTransform:'uppercase'}}>Message · {'{name}'} {'{amount}'} {'{emi}'}</label>
            <textarea value={tpl.message} onChange={e=>updateTpl(tpl.id,'message',e.target.value)} style={{width:'100%',padding:'10px',border:'1px solid #E2E8F0',borderRadius:7,fontSize:12,outline:'none',resize:'vertical',minHeight:90,fontFamily:'inherit',lineHeight:1.6,boxSizing:'border-box',color:'#374151'}} onFocus={e=>e.target.style.borderColor='#185FA5'} onBlur={e=>e.target.style.borderColor='#E2E8F0'}/>
          </div>
          <div style={{marginTop:10,background:'#F0FFF4',border:'1px solid #86EFAC',borderRadius:8,padding:10}}>
            <div style={{fontSize:10,fontWeight:600,color:'#16A34A',marginBottom:4,textTransform:'uppercase'}}>Preview</div>
            <div style={{fontSize:12,color:'#374151',lineHeight:1.6,whiteSpace:'pre-line'}}>{tpl.message.replace(/{name}/g,'Rahul').replace(/{amount}/g,'5,00,000').replace(/{emi}/g,'16,607')}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

// =============================================
// TEAM LEADER PANEL
// =============================================
function TeamLeaderPanel({ userId }) {
  const [myAgents,setMyAgents]     =useState([])
  const [leads,setLeads]           =useState([])
  const [calls,setCalls]           =useState([])
  const [agentStats,setAgentStats] =useState([])
  const [dateRange,setDateRange]   =useState('today')
  const [activeTab,setActiveTab]   =useState('overview')
  const [loading,setLoading]       =useState(true)
  const [overdueAlerts,setOverdueAlerts]=useState([])
  const [showAlerts,setShowAlerts] =useState(false)
  const isMobile=useIsMobile()

  useEffect(()=>{fetchAll()},[dateRange])
  useEffect(()=>{
    checkOverdueTasks()
    const iv=setInterval(checkOverdueTasks,60000)
    return()=>clearInterval(iv)
  },[myAgents])

  const checkOverdueTasks=async()=>{
    if(!myAgents.length)return
    const ids=myAgents.map(a=>a.id)
    const{data}=await supabase.from('tasks').select('*,profiles!tasks_assigned_to_fkey(full_name)').in('assigned_to',ids).in('status',['Pending','In Progress']).lt('due_date',new Date().toISOString())
    if(data?.length) setOverdueAlerts(data)
  }

  const fetchAll=async()=>{
    setLoading(true)
    const now=new Date(),sd=new Date()
    if(dateRange==='today') sd.setHours(0,0,0,0)
    else if(dateRange==='week')  sd.setDate(now.getDate()-7)
    else if(dateRange==='month') sd.setDate(1)
    const{data:ag}=await supabase.from('profiles').select('*').eq('team_leader_id',userId).eq('status','active')
    const agL=ag||[]; setMyAgents(agL)
    if(!agL.length){setLeads([]);setCalls([]);setAgentStats([]);setLoading(false);return}
    const ids=agL.map(a=>a.id)
    const[lR,cR]=await Promise.all([
      supabase.from('leads').select('*').in('assigned_to',ids).gte('created_at',sd.toISOString()),
      supabase.from('calls').select('*').in('agent_id',ids).gte('created_at',sd.toISOString()),
    ])
    const lL=lR.data||[],cL=cR.data||[]
    setLeads(lL); setCalls(cL)
    setAgentStats(agL.map(a=>{
      const ac=cL.filter(c=>c.agent_id===a.id),al=lL.filter(l=>l.assigned_to===a.id)
      return{id:a.id,name:a.full_name,email:a.email,calls:ac.length,leads:al.length,interested:ac.filter(c=>c.call_outcome==='Interested').length,callback:ac.filter(c=>c.call_outcome==='Callback').length,converted:al.filter(l=>['Approved','Disbursed'].includes(l.status)).length,convRate:ac.length?Math.round(al.filter(l=>['Approved','Disbursed'].includes(l.status)).length/ac.length*100):0}
    }).sort((a,b)=>b.calls-a.calls))
    setLoading(false)
  }

  return(
    <div>
      {overdueAlerts.length>0&&showAlerts&&(
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:200}} onClick={()=>setShowAlerts(false)}/>
          <div style={{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',background:'white',borderRadius:16,zIndex:300,width:'92%',maxWidth:480,overflow:'hidden'}}>
            <div style={{background:'#A32D2D',padding:'14px 18px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <span style={{color:'white',fontWeight:700,fontSize:15,display:'flex',alignItems:'center',gap:8}}><IconAlertTriangle size={18}/>Team Overdue Tasks</span>
              <button onClick={()=>setShowAlerts(false)} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',width:28,height:28,borderRadius:'50%',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><IconX size={14}/></button>
            </div>
            <div style={{padding:16,maxHeight:300,overflowY:'auto'}}>
              {overdueAlerts.map(t=>(
                <div key={t.id} style={{padding:12,borderRadius:8,background:'#FFF5F5',border:'1px solid #FED7D7',marginBottom:8}}>
                  <div style={{fontWeight:600,fontSize:13,color:'#A32D2D',marginBottom:4}}>{t.title}</div>
                  <div style={{fontSize:12,color:'#718096'}}>Agent: {t.profiles?.full_name||'Unknown'} · Due: {new Date(t.due_date).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
                </div>
              ))}
            </div>
            <div style={{padding:'12px 16px',borderTop:'1px solid #F3F4F6',textAlign:'center'}}>
              <button onClick={()=>setShowAlerts(false)} style={{padding:'8px 20px',background:'#185FA5',color:'white',border:'none',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer'}}>Acknowledge</button>
            </div>
          </div>
        </>
      )}

      <div className="page-header">
        <div>
          <h1 style={{display:'flex',alignItems:'center',gap:8,fontSize:isMobile?16:18}}><IconChartBar size={isMobile?18:22} strokeWidth={1.6}/>Team Leader</h1>
          <p>{myAgents.length} agents in your team</p>
        </div>
        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
          {overdueAlerts.length>0&&(
            <button onClick={()=>setShowAlerts(true)} style={{display:'flex',alignItems:'center',gap:5,background:'#FCEBEB',color:'#A32D2D',border:'1px solid #FED7D7',padding:'7px 12px',borderRadius:8,cursor:'pointer',fontWeight:600,fontSize:12}}>
              <IconBell size={14}/>{overdueAlerts.length} Overdue
            </button>
          )}
          {isMobile?(
            <select value={dateRange} onChange={e=>setDateRange(e.target.value)} style={{padding:'8px 10px',border:'1px solid #E2E8F0',borderRadius:8,fontSize:13,outline:'none'}}>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
            </select>
          ):(
            ['today','week','month'].map(r=>(
              <button key={r} className={`btn ${dateRange===r?'btn-primary':'btn-ghost'}`} onClick={()=>setDateRange(r)}>{r==='today'?'Today':r==='week'?'This Week':'This Month'}</button>
            ))
          )}
          <button className="btn btn-outline" onClick={fetchAll}><IconRefresh size={15}/></button>
        </div>
      </div>

      <div className="page-body">
        <div className="stats-grid" style={{marginBottom:20}}>
          {[
            {icon:<IconUsers size={18} color="#185FA5"/>,label:'My Agents',value:myAgents.length,color:'#185FA5',bg:'#E6F1FB'},
            {icon:<IconPhoneIncoming size={18} color="#0F6E56"/>,label:'Total Calls',value:calls.length,color:'#0F6E56',bg:'#E1F5EE'},
            {icon:<IconThumbUp size={18} color="#3B6D11"/>,label:'Interested',value:calls.filter(c=>c.call_outcome==='Interested').length,color:'#3B6D11',bg:'#EAF3DE'},
            {icon:<IconCircleCheck size={18} color="#534AB7"/>,label:'Converted',value:leads.filter(l=>['Approved','Disbursed'].includes(l.status)).length,color:'#534AB7',bg:'#EEEDFE'},
          ].map(s=>(
            <div key={s.label} className="stat-card">
              <div style={{width:36,height:36,borderRadius:8,background:s.bg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{s.icon}</div>
              <div className="stat-info"><h3 style={{color:s.color}}>{s.value}</h3><p>{s.label}</p></div>
            </div>
          ))}
        </div>

        <div className="tabs" style={{maxWidth:300,marginBottom:16}}>
          {[{id:'overview',label:'Overview'},{id:'agents',label:'Agents'}].map(t=>(
            <button key={t.id} className={`tab ${activeTab===t.id?'active':''}`} onClick={()=>setActiveTab(t.id)}>{t.label}</button>
          ))}
        </div>

        {activeTab==='overview'&&(
          <div className="table-container">
            <div style={{padding:'12px 16px',borderBottom:'1px solid #E2E8F0',display:'flex',justifyContent:'space-between'}}>
              <span style={{fontWeight:600,fontSize:14}}>Team Performance</span>
            </div>
            {loading?<div style={{padding:40,textAlign:'center',color:'#A0AEC0'}}>Loading…</div>:(
              isMobile?(
                <div style={{padding:'8px 12px'}}>
                  {agentStats.map(a=>(
                    <div key={a.id} style={{padding:'12px 0',borderBottom:'1px solid #F3F4F6'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                        <div style={{fontWeight:600,fontSize:13}}>{a.name}</div>
                        <span style={{background:'#E6F1FB',color:'#185FA5',fontWeight:700,fontSize:13,padding:'2px 8px',borderRadius:6}}>{a.calls} calls</span>
                      </div>
                      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                        <span style={{background:'#EAF3DE',color:'#3B6D11',padding:'2px 8px',borderRadius:4,fontSize:11}}>{a.interested} Interested</span>
                        <span style={{background:'#E1F5EE',color:'#0F6E56',padding:'2px 8px',borderRadius:4,fontSize:11}}>{a.converted} Converted</span>
                        <span style={{background:'#EEEDFE',color:'#534AB7',padding:'2px 8px',borderRadius:4,fontSize:11}}>{a.convRate}% Rate</span>
                      </div>
                    </div>
                  ))}
                </div>
              ):(
                <table>
                  <thead><tr>{['Agent','Calls','Leads','Interested','Callback','Converted','Rate'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {agentStats.length===0
                      ?<tr><td colSpan={7}><div className="empty-state"><h3>No agents yet</h3></div></td></tr>
                      :agentStats.map(a=>(
                        <tr key={a.id}>
                          <td><div style={{display:'flex',alignItems:'center',gap:10}}><div style={{width:30,height:30,borderRadius:'50%',background:'#E6F1FB',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:600,color:'#185FA5',fontSize:12}}>{a.name[0]?.toUpperCase()}</div><div><div style={{fontWeight:600,fontSize:13}}>{a.name}</div><div style={{fontSize:11,color:'#A0AEC0'}}>{a.email}</div></div></div></td>
                          <td><strong style={{color:'#185FA5'}}>{a.calls}</strong></td>
                          <td>{a.leads}</td>
                          <td><span style={{background:'#EAF3DE',color:'#3B6D11',padding:'2px 8px',borderRadius:4,fontSize:12}}>{a.interested}</span></td>
                          <td><span style={{background:'#FAEEDA',color:'#854F0B',padding:'2px 8px',borderRadius:4,fontSize:12}}>{a.callback}</span></td>
                          <td><span style={{background:'#E1F5EE',color:'#0F6E56',padding:'2px 8px',borderRadius:4,fontSize:12}}>{a.converted}</span></td>
                          <td><div style={{display:'flex',alignItems:'center',gap:6}}><div style={{flex:1,height:5,background:'#F5F5F5',borderRadius:3,minWidth:40}}><div style={{height:'100%',background:'#185FA5',borderRadius:3,width:a.convRate+'%'}}/></div><span style={{fontSize:11,fontWeight:700,color:'#185FA5'}}>{a.convRate}%</span></div></td>
                        </tr>
                      ))
                    }
                  </tbody>
                </table>
              )
            )}
          </div>
        )}

        {activeTab==='agents'&&(
          <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(3,1fr)',gap:12}}>
            {myAgents.map(agent=>{
              const st=agentStats.find(s=>s.id===agent.id)||{}
              return(
                <div key={agent.id} className="card" style={{overflow:'hidden'}}>
                  <div style={{background:'linear-gradient(135deg,#185FA5,#2563EB)',padding:'14px 16px'}}>
                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                      <div style={{width:36,height:36,borderRadius:'50%',background:'rgba(255,255,255,0.2)',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,color:'white',fontSize:14}}>{agent.full_name[0]?.toUpperCase()}</div>
                      <div><div style={{color:'white',fontWeight:700,fontSize:14}}>{agent.full_name}</div><div style={{color:'rgba(255,255,255,0.7)',fontSize:11}}>{agent.email}</div></div>
                    </div>
                  </div>
                  <div style={{padding:'12px 16px'}}>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:10}}>
                      {[{label:'Calls',value:st.calls||0,color:'#185FA5'},{label:'Interested',value:st.interested||0,color:'#3B6D11'},{label:'Converted',value:st.converted||0,color:'#534AB7'}].map(s=>(
                        <div key={s.label} style={{background:'#F9FAFB',padding:8,borderRadius:8,textAlign:'center'}}>
                          <div style={{fontSize:16,fontWeight:700,color:s.color}}>{s.value}</div>
                          <div style={{fontSize:10,color:'#9CA3AF',marginTop:1}}>{s.label}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:6}}>
                      <div style={{flex:1,height:5,background:'#F3F4F6',borderRadius:3}}><div style={{height:'100%',background:'#185FA5',borderRadius:3,width:(st.convRate||0)+'%'}}/></div>
                      <span style={{fontSize:12,fontWeight:700,color:'#185FA5'}}>{st.convRate||0}%</span>
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

// =============================================
// MANAGER PANEL
// =============================================
function ManagerPanel({ userId }) {
  const [agents,setAgents]         =useState([])
  const [teamLeaders,setTeamLeaders]=useState([])
  const [leads,setLeads]           =useState([])
  const [calls,setCalls]           =useState([])
  const [agentStats,setAgentStats] =useState([])
  const [dateRange,setDateRange]   =useState('today')
  const [activeTab,setActiveTab]   =useState('overview')
  const [loading,setLoading]       =useState(true)
  const isMobile=useIsMobile()

  useEffect(()=>{fetchAll()},[dateRange])

  const fetchAll=async()=>{
    setLoading(true)
    const now=new Date(),sd=new Date()
    if(dateRange==='today') sd.setHours(0,0,0,0)
    else if(dateRange==='week')  sd.setDate(now.getDate()-7)
    else if(dateRange==='month') sd.setDate(1)
    const[aR,tR,lR,cR]=await Promise.all([
      supabase.from('profiles').select('*').eq('role','agent').eq('status','active'),
      supabase.from('profiles').select('*').eq('role','team_leader').eq('status','active'),
      supabase.from('leads').select('*').gte('created_at',sd.toISOString()),
      supabase.from('calls').select('*').gte('created_at',sd.toISOString()),
    ])
    const aL=aR.data||[],cL=cR.data||[],lL=lR.data||[]
    setAgents(aL); setTeamLeaders(tR.data||[]); setLeads(lL); setCalls(cL)
    setAgentStats(aL.map(a=>{
      const ac=cL.filter(c=>c.agent_id===a.id),al=lL.filter(l=>l.assigned_to===a.id)
      const tl=(tR.data||[]).find(t=>t.id===a.team_leader_id)
      return{id:a.id,name:a.full_name,email:a.email,teamLeader:tl?.full_name||'No TL',calls:ac.length,leads:al.length,interested:ac.filter(c=>c.call_outcome==='Interested').length,callback:ac.filter(c=>c.call_outcome==='Callback').length,converted:al.filter(l=>['Approved','Disbursed'].includes(l.status)).length,convRate:ac.length?Math.round(al.filter(l=>['Approved','Disbursed'].includes(l.status)).length/ac.length*100):0}
    }).sort((a,b)=>b.calls-a.calls))
    setLoading(false)
  }

  return(
    <div>
      <div className="page-header">
        <div>
          <h1 style={{display:'flex',alignItems:'center',gap:8,fontSize:isMobile?16:18}}><IconChartBar size={isMobile?18:22} strokeWidth={1.6}/>Manager Dashboard</h1>
          <p>{agents.length} agents · {teamLeaders.length} TLs</p>
        </div>
        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          {isMobile?(
            <select value={dateRange} onChange={e=>setDateRange(e.target.value)} style={{padding:'8px 10px',border:'1px solid #E2E8F0',borderRadius:8,fontSize:13,outline:'none'}}>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
            </select>
          ):(
            ['today','week','month'].map(r=>(
              <button key={r} className={`btn ${dateRange===r?'btn-primary':'btn-ghost'}`} onClick={()=>setDateRange(r)}>{r==='today'?'Today':r==='week'?'This Week':'This Month'}</button>
            ))
          )}
          <button className="btn btn-outline" onClick={fetchAll}><IconRefresh size={15}/></button>
        </div>
      </div>

      <div className="page-body">
        <div className="stats-grid" style={{marginBottom:20}}>
          {[
            {icon:<IconUsers size={18} color="#185FA5"/>,label:'Total Agents',value:agents.length,color:'#185FA5',bg:'#E6F1FB'},
            {icon:<IconPhoneIncoming size={18} color="#0F6E56"/>,label:'Total Calls',value:calls.length,color:'#0F6E56',bg:'#E1F5EE'},
            {icon:<IconThumbUp size={18} color="#3B6D11"/>,label:'Interested',value:calls.filter(c=>c.call_outcome==='Interested').length,color:'#3B6D11',bg:'#EAF3DE'},
            {icon:<IconCircleCheck size={18} color="#534AB7"/>,label:'Converted',value:leads.filter(l=>['Approved','Disbursed'].includes(l.status)).length,color:'#534AB7',bg:'#EEEDFE'},
          ].map(s=>(
            <div key={s.label} className="stat-card">
              <div style={{width:36,height:36,borderRadius:8,background:s.bg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{s.icon}</div>
              <div className="stat-info"><h3 style={{color:s.color}}>{s.value}</h3><p>{s.label}</p></div>
            </div>
          ))}
        </div>

        <div className="tabs" style={{maxWidth:400,marginBottom:16}}>
          {[{id:'overview',label:'Overview'},{id:'agents',label:'Agents'},{id:'teams',label:'Teams'}].map(t=>(
            <button key={t.id} className={`tab ${activeTab===t.id?'active':''}`} onClick={()=>setActiveTab(t.id)}>{t.label}</button>
          ))}
        </div>

        {activeTab==='overview'&&(
          <div className="table-container">
            <div style={{padding:'12px 16px',borderBottom:'1px solid #E2E8F0'}}>
              <span style={{fontWeight:600,fontSize:14}}>Agent Performance</span>
            </div>
            {loading?<div style={{padding:40,textAlign:'center',color:'#A0AEC0'}}>Loading…</div>:(
              isMobile?(
                <div style={{padding:'8px 12px'}}>
                  {agentStats.map(a=>(
                    <div key={a.id} style={{padding:'12px 0',borderBottom:'1px solid #F3F4F6'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                        <div>
                          <div style={{fontWeight:600,fontSize:13}}>{a.name}</div>
                          <div style={{fontSize:11,color:'#9CA3AF'}}>{a.teamLeader}</div>
                        </div>
                        <span style={{background:'#E6F1FB',color:'#185FA5',fontWeight:700,fontSize:13,padding:'2px 8px',borderRadius:6}}>{a.calls} calls</span>
                      </div>
                      <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:4}}>
                        <span style={{background:'#EAF3DE',color:'#3B6D11',padding:'2px 8px',borderRadius:4,fontSize:11}}>{a.interested} Interested</span>
                        <span style={{background:'#E1F5EE',color:'#0F6E56',padding:'2px 8px',borderRadius:4,fontSize:11}}>{a.converted} Converted</span>
                        <span style={{background:'#EEEDFE',color:'#534AB7',padding:'2px 8px',borderRadius:4,fontSize:11}}>{a.convRate}% Rate</span>
                      </div>
                    </div>
                  ))}
                </div>
              ):(
                <table>
                  <thead><tr>{['Agent','TL','Calls','Leads','Interested','Converted','Rate'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {agentStats.length===0
                      ?<tr><td colSpan={7}><div className="empty-state"><h3>No data yet</h3></div></td></tr>
                      :agentStats.map(a=>(
                        <tr key={a.id}>
                          <td><div style={{display:'flex',alignItems:'center',gap:10}}><div style={{width:30,height:30,borderRadius:'50%',background:'#E6F1FB',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:600,color:'#185FA5',fontSize:12}}>{a.name[0]?.toUpperCase()}</div><div><div style={{fontWeight:600,fontSize:13}}>{a.name}</div><div style={{fontSize:11,color:'#A0AEC0'}}>{a.email}</div></div></div></td>
                          <td><span style={{background:'#EEEDFE',color:'#534AB7',padding:'2px 8px',borderRadius:4,fontSize:12}}>{a.teamLeader}</span></td>
                          <td><strong style={{color:'#185FA5'}}>{a.calls}</strong></td>
                          <td>{a.leads}</td>
                          <td><span style={{background:'#EAF3DE',color:'#3B6D11',padding:'2px 8px',borderRadius:4,fontSize:12}}>{a.interested}</span></td>
                          <td><span style={{background:'#E1F5EE',color:'#0F6E56',padding:'2px 8px',borderRadius:4,fontSize:12}}>{a.converted}</span></td>
                          <td><div style={{display:'flex',alignItems:'center',gap:6}}><div style={{flex:1,height:5,background:'#F5F5F5',borderRadius:3,minWidth:40}}><div style={{height:'100%',background:'#185FA5',borderRadius:3,width:a.convRate+'%'}}/></div><span style={{fontSize:11,fontWeight:700,color:'#185FA5'}}>{a.convRate}%</span></div></td>
                        </tr>
                      ))
                    }
                  </tbody>
                </table>
              )
            )}
          </div>
        )}

        {activeTab==='agents'&&(
          <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(3,1fr)',gap:12}}>
            {agentStats.map(a=>(
              <div key={a.id} className="card" style={{overflow:'hidden'}}>
                <div style={{background:'linear-gradient(135deg,#185FA5,#2563EB)',padding:'14px 16px',display:'flex',alignItems:'center',gap:10}}>
                  <div style={{width:36,height:36,borderRadius:'50%',background:'rgba(255,255,255,0.2)',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,color:'white',fontSize:14}}>{a.name[0]?.toUpperCase()}</div>
                  <div><div style={{color:'white',fontWeight:700,fontSize:14}}>{a.name}</div><div style={{color:'rgba(255,255,255,0.7)',fontSize:11}}>{a.teamLeader}</div></div>
                </div>
                <div style={{padding:'12px 16px'}}>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
                    {[{label:'Calls',value:a.calls,color:'#185FA5'},{label:'Leads',value:a.leads,color:'#534AB7'},{label:'Interested',value:a.interested,color:'#3B6D11'},{label:'Converted',value:a.converted,color:'#0F6E56'}].map(s=>(
                      <div key={s.label} style={{background:'#F9FAFB',padding:8,borderRadius:8,textAlign:'center'}}>
                        <div style={{fontSize:18,fontWeight:700,color:s.color}}>{s.value}</div>
                        <div style={{fontSize:10,color:'#9CA3AF',marginTop:1}}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{height:5,background:'#F3F4F6',borderRadius:3}}><div style={{height:'100%',background:'#185FA5',borderRadius:3,width:a.convRate+'%'}}/></div>
                  <div style={{fontSize:11,color:'#9CA3AF',marginTop:4,textAlign:'right'}}>{a.convRate}% conversion</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab==='teams'&&(
          <div>
            {teamLeaders.map(tl=>{
              const tla=agents.filter(a=>a.team_leader_id===tl.id)
              const tlc=calls.filter(c=>tla.some(a=>a.id===c.agent_id))
              return(
                <div key={tl.id} className="card" style={{marginBottom:14,overflow:'hidden'}}>
                  <div style={{background:'linear-gradient(135deg,#534AB7,#7C3AED)',padding:'12px 16px',color:'white',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                      <div style={{width:34,height:34,borderRadius:'50%',background:'rgba(255,255,255,0.2)',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,color:'white'}}>{tl.full_name[0]?.toUpperCase()}</div>
                      <div><div style={{fontWeight:700,fontSize:14}}>{tl.full_name}</div><div style={{fontSize:11,opacity:0.7}}>Team Leader</div></div>
                    </div>
                    <div style={{display:'flex',gap:12,fontSize:12}}>
                      <div style={{textAlign:'center'}}><div style={{fontWeight:700}}>{tla.length}</div><div style={{opacity:0.7}}>Agents</div></div>
                      <div style={{textAlign:'center'}}><div style={{fontWeight:700}}>{tlc.length}</div><div style={{opacity:0.7}}>Calls</div></div>
                    </div>
                  </div>
                  <div style={{padding:'12px 16px',display:'flex',gap:8,flexWrap:'wrap'}}>
                    {tla.length===0?<span style={{color:'#A0AEC0',fontSize:13}}>No agents</span>:tla.map(a=>(
                      <div key={a.id} style={{background:'#F9FAFB',border:'1px solid #E5E7EB',borderRadius:8,padding:'8px 12px'}}>
                        <div style={{fontWeight:600,fontSize:12,color:'#111827'}}>{a.full_name}</div>
                        <div style={{fontSize:11,color:'#6B7280'}}>{calls.filter(c=>c.agent_id===a.id).length} calls</div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
            {teamLeaders.length===0&&<div className="card"><div className="empty-state"><h3>No team leaders yet</h3></div></div>}
          </div>
        )}
      </div>
    </div>
  )
}

// =============================================
// MAIN DASHBOARD
// =============================================
export default function Dashboard() {
  const [activePage,setActivePage] =useState('dashboard')
  const [profile,setProfile]       =useState(null)
  const [crmName,setCrmName]       =useState('CALL-Q PRO CRM')
  const [crmTagline,setCrmTagline] =useState('Personal Loan Platform')
  const [stats,setStats]           =useState({totalLeads:0,todayCalls:0,pendingTasks:0,converted:0})
  const [recentCalls,setRecentCalls]=useState([])
  const [sidebarOpen,setSidebarOpen]=useState(false)
  const isMobile=useIsMobile()

  useEffect(()=>{ getProfile(); fetchSettings(); fetchDashboardStats() },[])

  // close sidebar on page change
  useEffect(()=>{ setSidebarOpen(false) },[activePage])

  const getProfile=async()=>{
    const{data:{user}}=await supabase.auth.getUser()
    if(user){const{data}=await supabase.from('profiles').select('*').eq('id',user.id).single();setProfile(data)}
  }
  const fetchSettings=async()=>{
    const{data}=await supabase.from('settings').select('*')
    if(data) data.forEach(s=>{if(s.key==='crm_name')setCrmName(s.value);if(s.key==='crm_tagline')setCrmTagline(s.value)})
  }
  const fetchDashboardStats=async()=>{
    const today=new Date().toISOString().split('T')[0]
    const[lR,cR,tR]=await Promise.all([
      supabase.from('leads').select('id,status'),
      supabase.from('calls').select('*').gte('created_at',today+'T00:00:00').order('created_at',{ascending:false}).limit(5),
      supabase.from('tasks').select('id,status').eq('status','Pending')
    ])
    setStats({totalLeads:lR.data?.length||0,todayCalls:cR.data?.length||0,pendingTasks:tR.data?.length||0,converted:lR.data?.filter(l=>['Disbursed','Approved'].includes(l.status)).length||0})
    setRecentCalls(cR.data||[])
  }

  const handleLogout=async()=>{ await supabase.auth.signOut() }
  const role=profile?.role||'agent'

  const getIcon=name=>{
    const p={size:18,strokeWidth:1.6}
    const m={dashboard:<IconLayoutDashboard {...p}/>,users:<IconUsers {...p}/>,'phone-call':<IconPhoneCall {...p}/>,checkbox:<IconCheckbox {...p}/>,'chart-bar':<IconChartBar {...p}/>,settings:<IconSettings {...p}/>,adjustments:<IconAdjustments {...p}/>,campaigns:<IconBuildingStore {...p}/>}
    return m[name]||<IconSettings {...p}/>
  }

  const navSections=[
    {section:'MAIN',items:[
      {id:'dashboard',label:'Dashboard', icon:'dashboard', roles:['agent','team_leader','manager','admin']},
      {id:'leads',    label:'Leads',     icon:'users',     roles:['agent','team_leader','manager','admin']},
      {id:'campaigns',label:'Campaigns', icon:'campaigns', roles:['agent','team_leader','manager','admin']},
      {id:'calls',    label:'Call Logs', icon:'phone-call',roles:['agent','team_leader','manager','admin']},
      {id:'tasks',    label:'Tasks',     icon:'checkbox',  roles:['agent','team_leader','manager','admin']},
    ]},
    {section:'REPORTS',items:[{id:'reports',label:'Reports',icon:'chart-bar',roles:['team_leader','manager','admin']}]},
    {section:'MANAGE',items:[{id:'admin',label:'Admin Panel',icon:'settings',roles:['admin']},{id:'settings',label:'Settings',icon:'adjustments',roles:['admin']}]},
  ]

  const AdminPanel=()=>{
    const [activeTab,setActiveTab]       =useState('users')
    const [users,setUsers]               =useState([])
    const [dispositions,setDispositions] =useState([])
    const [statuses,setStatuses]         =useState([])
    const [showUserForm,setShowUserForm] =useState(false)
    const [loading,setLoading]           =useState(false)
    const [editingUser,setEditingUser]   =useState(null)
    const [editForm,setEditForm]         =useState({full_name:'',mobile:'',department:''})
    const [userForm,setUserForm]         =useState({full_name:'',email:'',phone:'',role:'agent',team_leader_id:'',manager_id:'',department:''})
    const [dispForm,setDispForm]         =useState({label:'',color:'#185FA5'})
    const [statusForm,setStatusForm]     =useState({label:'',color:'#185FA5'})

    useEffect(()=>{ fetchUsers(); fetchDispositions(); fetchStatuses() },[])

    const fetchUsers=async()=>{ const{data}=await supabase.from('profiles').select('*').order('role'); if(data) setUsers(data) }
    const fetchDispositions=async()=>{ const{data}=await supabase.from('dispositions').select('*').order('sort_order'); if(data) setDispositions(data) }
    const fetchStatuses=async()=>{ const{data}=await supabase.from('lead_statuses').select('*').order('sort_order'); if(data) setStatuses(data) }

    const createUser=async(e)=>{
      e.preventDefault(); setLoading(true)
      try{
        const res=await fetch('https://pvnzeueldfmxhesmoetc.supabase.co/auth/v1/admin/users',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2bnpldWVsZGZteGhlc21vZXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzY2MDA0NCwiZXhwIjoyMDkzMjM2MDQ0fQ.J7qjEpXnTlFvRJDM3uHG4JbPmFakaSFnu16mLtCvSdA','apikey':'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2bnpldWVsZGZteGhlc21vZXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzY2MDA0NCwiZXhwIjoyMDkzMjM2MDQ0fQ.J7qjEpXnTlFvRJDM3uHG4JbPmFakaSFnu16mLtCvSdA'},body:JSON.stringify({email:userForm.email,password:'Capital@123',email_confirm:true})})
        const ud=await res.json()
        if(ud.id){
          await supabase.from('profiles').insert([{id:ud.id,full_name:userForm.full_name,email:userForm.email,mobile:userForm.phone,role:userForm.role,team_leader_id:userForm.team_leader_id||null,manager_id:userForm.manager_id||null,department:userForm.department,status:'active'}])
          setUserForm({full_name:'',email:'',phone:'',role:'agent',team_leader_id:'',manager_id:'',department:''});setShowUserForm(false);fetchUsers()
          alert('✅ User created!\nEmail: '+userForm.email+'\nPassword: Capital@123')
        }else alert('Error: '+JSON.stringify(ud))
      }catch(err){alert('Error: '+err.message)}
      setLoading(false)
    }

    const saveEditUser=async(id)=>{ await supabase.from('profiles').update({full_name:editForm.full_name,mobile:editForm.mobile,department:editForm.department}).eq('id',id); setEditingUser(null); fetchUsers() }
    const deleteUser=async(id,email)=>{ if(!window.confirm('Delete '+email+'?'))return; await supabase.from('profiles').delete().eq('id',id); fetchUsers() }
    const updateUserRole=async(id,role)=>{ await supabase.from('profiles').update({role}).eq('id',id); fetchUsers() }
    const assignTeamLeader=async(id,tlId)=>{ await supabase.from('profiles').update({team_leader_id:tlId||null}).eq('id',id); fetchUsers() }
    const toggleUserStatus=async(id,status)=>{ await supabase.from('profiles').update({status:status==='active'?'inactive':'active'}).eq('id',id); fetchUsers() }
    const addDisposition=async(e)=>{ e.preventDefault(); await supabase.from('dispositions').insert([{...dispForm,sort_order:dispositions.length+1}]); setDispForm({label:'',color:'#185FA5'}); fetchDispositions() }
    const deleteDisposition=async(id)=>{ if(!window.confirm('Delete?'))return; await supabase.from('dispositions').delete().eq('id',id); fetchDispositions() }
    const toggleDisposition=async(id,a)=>{ await supabase.from('dispositions').update({is_active:!a}).eq('id',id); fetchDispositions() }
    const addStatus=async(e)=>{ e.preventDefault(); await supabase.from('lead_statuses').insert([{...statusForm,sort_order:statuses.length+1}]); setStatusForm({label:'',color:'#185FA5'}); fetchStatuses() }
    const deleteStatus=async(id)=>{ if(!window.confirm('Delete?'))return; await supabase.from('lead_statuses').delete().eq('id',id); fetchStatuses() }
    const toggleStatus=async(id,a)=>{ await supabase.from('lead_statuses').update({is_active:!a}).eq('id',id); fetchStatuses() }

    const teamLeaders=users.filter(u=>u.role==='team_leader')
    const managers   =users.filter(u=>u.role==='manager')
    const RC={agent:{bg:'#E6F1FB',color:'#185FA5'},team_leader:{bg:'#EEEDFE',color:'#534AB7'},manager:{bg:'#FAEEDA',color:'#854F0B'},admin:{bg:'#FCEBEB',color:'#A32D2D'}}
    const gi=name=>name?name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2):'?'
    const AB=['#E6F1FB','#EEEDFE','#E1F5EE','#FAEEDA','#F1EFE8']
    const AC=['#185FA5','#534AB7','#0F6E56','#854F0B','#5F5E5A']

    return(
      <div>
        <div className="page-header">
          <div><h1 style={{display:'flex',alignItems:'center',gap:8,fontSize:isMobile?16:18}}><IconSettings size={isMobile?18:22} strokeWidth={1.6}/>Admin Panel</h1><p>Manage users, templates and team</p></div>
          <button className="btn btn-outline" style={{fontSize:12}} onClick={()=>setShowUserForm(!showUserForm)}>{showUserForm?'Cancel':'+ Add User'}</button>
        </div>
        <div className="page-body">
          <div className="tabs" style={{marginBottom:16}}>
            {[{id:'users',label:'Users'},{id:'whatsapp',label:'📱 WA'},{id:'dispositions',label:'Dispositions'},{id:'statuses',label:'Statuses'},{id:'overview',label:'Team'}].map(t=>(
              <button key={t.id} className={`tab ${activeTab===t.id?'active':''}`} onClick={()=>setActiveTab(t.id)}>{t.label}</button>
            ))}
          </div>

          {activeTab==='whatsapp'&&<WATemplateEditor/>}

          {activeTab==='users'&&(
            <div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:10,marginBottom:16}}>
                {[{l:'Total',v:users.length,c:'#185FA5'},{l:'Agents',v:users.filter(u=>u.role==='agent').length,c:'#185FA5'},{l:'Team Leaders',v:teamLeaders.length,c:'#534AB7'},{l:'Managers',v:managers.length,c:'#854F0B'}].map(s=>(
                  <div key={s.l} style={{background:'white',padding:'12px 14px',borderRadius:10,border:'1px solid #E2E8F0',borderLeft:'3px solid '+s.c}}>
                    <div style={{fontSize:22,fontWeight:600,color:s.c,lineHeight:1,marginBottom:3}}>{s.v}</div>
                    <div style={{fontSize:12,color:'#718096'}}>{s.l}</div>
                  </div>
                ))}
              </div>

              {showUserForm&&(
                <div className="card" style={{marginBottom:16}}>
                  <div className="card-header"><h3>Add New Member</h3><button className="btn btn-ghost btn-sm" onClick={()=>setShowUserForm(false)}>✕</button></div>
                  <div className="card-body">
                    <form onSubmit={createUser}>
                      <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:10,marginBottom:10}}>
                        {[{l:'Full Name *',k:'full_name',t:'text'},{l:'Email *',k:'email',t:'email'},{l:'Phone',k:'phone',t:'text'},{l:'Department',k:'department',t:'text'}].map(f=>(
                          <div key={f.k}><label className="form-label">{f.l}</label><input type={f.t} className="form-input" value={userForm[f.k]} onChange={e=>setUserForm({...userForm,[f.k]:e.target.value})} required={f.l.includes('*')} placeholder={f.l.replace(' *','')}/></div>
                        ))}
                        <div><label className="form-label">Role</label><select className="form-input" value={userForm.role} onChange={e=>setUserForm({...userForm,role:e.target.value})}>{['agent','team_leader','manager','admin'].map(r=><option key={r} value={r}>{r.replace('_',' ').toUpperCase()}</option>)}</select></div>
                        {userForm.role==='agent'&&teamLeaders.length>0&&(<div><label className="form-label">Team Leader</label><select className="form-input" value={userForm.team_leader_id} onChange={e=>setUserForm({...userForm,team_leader_id:e.target.value})}><option value="">Select TL</option>{teamLeaders.map(tl=><option key={tl.id} value={tl.id}>{tl.full_name}</option>)}</select></div>)}
                      </div>
                      <div style={{background:'#FFFAF0',border:'1px solid #F6E05E',borderRadius:8,padding:'10px 12px',marginBottom:12,fontSize:13,color:'#744210'}}>⚠️ Default password: <strong>Capital@123</strong></div>
                      <button type="submit" className="btn btn-primary" disabled={loading}>{loading?'Creating...':'Create User'}</button>
                    </form>
                  </div>
                </div>
              )}

              <div className="table-container">
                <div style={{padding:'12px 14px',borderBottom:'1px solid #E2E8F0',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  <span style={{fontSize:14,fontWeight:600}}>All Users</span>
                  <span style={{fontSize:12,color:'#A0AEC0'}}>{users.length} members</span>
                </div>
                {isMobile?(
                  <div style={{padding:'8px 12px'}}>
                    {users.map((user,i)=>{
                      const rc=RC[user.role]||{bg:'#F7FAFC',color:'#718096'}
                      return(
                        <div key={user.id} style={{padding:'12px 0',borderBottom:'1px solid #F3F4F6'}}>
                          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                            <div style={{display:'flex',alignItems:'center',gap:8}}>
                              <div style={{width:30,height:30,borderRadius:'50%',background:AB[i%5],display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:600,color:AC[i%5],flexShrink:0}}>{gi(user.full_name)}</div>
                              <div>
                                <div style={{fontWeight:600,fontSize:13}}>{user.full_name}</div>
                                <div style={{fontSize:11,color:'#A0AEC0'}}>{user.email}</div>
                              </div>
                            </div>
                            <select value={user.role} onChange={e=>updateUserRole(user.id,e.target.value)} style={{background:rc.bg,color:rc.color,border:'none',padding:'3px 8px',borderRadius:20,fontSize:10,fontWeight:600,cursor:'pointer',outline:'none'}}>{['agent','team_leader','manager','admin'].map(r=><option key={r} value={r} style={{background:'white',color:'black'}}>{r.replace('_',' ').toUpperCase()}</option>)}</select>
                          </div>
                          <div style={{display:'flex',gap:6}}>
                            <button className="btn btn-ghost btn-sm" onClick={()=>toggleUserStatus(user.id,user.status||'active')}>{user.status==='active'?'Deactivate':'Activate'}</button>
                            <button onClick={()=>deleteUser(user.id,user.email)} style={{padding:'4px 10px',border:'1px solid #FED7D7',borderRadius:6,background:'transparent',cursor:'pointer',color:'#FC8181',fontSize:12}}>Delete</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ):(
                  <table>
                    <thead><tr>{['User','Role','Team Leader','Status','Actions'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                    <tbody>
                      {users.length===0?(<tr><td colSpan={5}><div className="empty-state"><h3>No users yet</h3></div></td></tr>)
                      :users.map((user,i)=>{
                        const rc=RC[user.role]||{bg:'#F7FAFC',color:'#718096'}
                        return(
                          <tr key={user.id}>
                            <td>
                              <div style={{display:'flex',alignItems:'center',gap:10}}>
                                <div style={{width:32,height:32,borderRadius:'50%',background:AB[i%5],display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:600,color:AC[i%5],flexShrink:0}}>{gi(user.full_name)}</div>
                                <div>
                                  {editingUser===user.id
                                    ?<div style={{display:'flex',flexDirection:'column',gap:4}}>
                                        <input className="form-input" style={{padding:'5px 8px',fontSize:13}} value={editForm.full_name} onChange={e=>setEditForm({...editForm,full_name:e.target.value})} placeholder="Full name"/>
                                        <input className="form-input" style={{padding:'5px 8px',fontSize:12}} value={editForm.mobile} onChange={e=>setEditForm({...editForm,mobile:e.target.value})} placeholder="Phone"/>
                                      </div>
                                    :<div>
                                        <div style={{fontWeight:500,fontSize:13,color:'#2D3748'}}>{user.full_name}</div>
                                        <div style={{fontSize:11,color:'#A0AEC0'}}>{user.email}</div>
                                      </div>
                                  }
                                </div>
                              </div>
                            </td>
                            <td><select value={user.role} onChange={e=>updateUserRole(user.id,e.target.value)} style={{background:rc.bg,color:rc.color,border:'none',padding:'4px 10px',borderRadius:20,fontSize:11,fontWeight:600,cursor:'pointer',outline:'none'}}>{['agent','team_leader','manager','admin'].map(r=><option key={r} value={r} style={{background:'white',color:'black'}}>{r.replace('_',' ').toUpperCase()}</option>)}</select></td>
                            <td><select value={user.team_leader_id||''} onChange={e=>assignTeamLeader(user.id,e.target.value)} style={{padding:'5px 8px',border:'1px solid #E2E8F0',borderRadius:6,fontSize:12,background:'white',color:'#4A5568',outline:'none'}}><option value="">No TL</option>{teamLeaders.map(tl=><option key={tl.id} value={tl.id}>{tl.full_name}</option>)}</select></td>
                            <td><span style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:12,fontWeight:500,color:user.status==='active'?'#0F6E56':'#718096'}}><span style={{width:6,height:6,borderRadius:'50%',background:user.status==='active'?'#1D9E75':'#A0AEC0'}}></span>{user.status==='active'?'Active':'Inactive'}</span></td>
                            <td>
                              <div style={{display:'flex',gap:5,alignItems:'center'}}>
                                {editingUser===user.id
                                  ?<><button className="btn btn-success btn-sm" onClick={()=>saveEditUser(user.id)}>Save</button><button className="btn btn-ghost btn-sm" onClick={()=>setEditingUser(null)}>Cancel</button></>
                                  :<button onClick={()=>{setEditingUser(user.id);setEditForm({full_name:user.full_name||'',mobile:user.mobile||'',department:user.department||''})}} style={{width:28,height:28,borderRadius:6,border:'1px solid #E2E8F0',background:'transparent',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'#185FA5'}}><IconEdit size={14} strokeWidth={1.5}/></button>
                                }
                                <button className="btn btn-ghost btn-sm" onClick={()=>toggleUserStatus(user.id,user.status||'active')}>{user.status==='active'?'Deactivate':'Activate'}</button>
                                <button onClick={()=>deleteUser(user.id,user.email)} style={{width:28,height:28,borderRadius:6,border:'1px solid #FED7D7',background:'transparent',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'#FC8181',fontSize:16}}>×</button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {activeTab==='dispositions'&&(
            <div>
              <h3 style={{fontSize:15,fontWeight:600,marginBottom:14}}>Call Dispositions</h3>
              <form onSubmit={addDisposition} className="card" style={{marginBottom:16,padding:16}}>
                <div style={{display:'flex',gap:10,alignItems:'flex-end',flexWrap:'wrap'}}>
                  <div style={{flex:1,minWidth:160}}><label className="form-label">New Disposition</label><input type="text" className="form-input" value={dispForm.label} onChange={e=>setDispForm({...dispForm,label:e.target.value})} required placeholder="e.g. Callback Tomorrow"/></div>
                  <div><label className="form-label">Color</label><input type="color" value={dispForm.color} onChange={e=>setDispForm({...dispForm,color:e.target.value})} style={{width:46,height:40,border:'1px solid #E2E8F0',borderRadius:8,cursor:'pointer'}}/></div>
                  <button type="submit" className="btn btn-primary">Add</button>
                </div>
              </form>
              <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(3,1fr)',gap:8}}>
                {dispositions.map(d=>(
                  <div key={d.id} style={{background:'white',padding:'11px 13px',borderRadius:10,border:'1px solid #E2E8F0',display:'flex',alignItems:'center',justifyContent:'space-between',opacity:d.is_active?1:0.5}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}><div style={{width:10,height:10,borderRadius:'50%',background:d.color,flexShrink:0}}/><span style={{fontWeight:500,fontSize:12}}>{d.label}</span></div>
                    <div style={{display:'flex',gap:4}}>
                      <button onClick={()=>toggleDisposition(d.id,d.is_active)} style={{fontSize:10,padding:'2px 6px',border:'1px solid #E2E8F0',borderRadius:4,background:'transparent',cursor:'pointer',color:'#718096'}}>{d.is_active?'Off':'On'}</button>
                      <button onClick={()=>deleteDisposition(d.id)} style={{width:22,height:22,border:'1px solid #FED7D7',borderRadius:4,background:'transparent',cursor:'pointer',color:'#FC8181',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14}}>×</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab==='statuses'&&(
            <div>
              <h3 style={{fontSize:15,fontWeight:600,marginBottom:14}}>Lead Statuses</h3>
              <form onSubmit={addStatus} className="card" style={{marginBottom:16,padding:16}}>
                <div style={{display:'flex',gap:10,alignItems:'flex-end',flexWrap:'wrap'}}>
                  <div style={{flex:1,minWidth:160}}><label className="form-label">New Status</label><input type="text" className="form-input" value={statusForm.label} onChange={e=>setStatusForm({...statusForm,label:e.target.value})} required placeholder="e.g. Hot Lead"/></div>
                  <div><label className="form-label">Color</label><input type="color" value={statusForm.color} onChange={e=>setStatusForm({...statusForm,color:e.target.value})} style={{width:46,height:40,border:'1px solid #E2E8F0',borderRadius:8,cursor:'pointer'}}/></div>
                  <button type="submit" className="btn btn-primary">Add</button>
                </div>
              </form>
              <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(3,1fr)',gap:8}}>
                {statuses.map(s=>(
                  <div key={s.id} style={{background:'white',padding:'11px 13px',borderRadius:10,border:'1px solid #E2E8F0',display:'flex',alignItems:'center',justifyContent:'space-between',opacity:s.is_active?1:0.5}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}><div style={{width:10,height:10,borderRadius:'50%',background:s.color,flexShrink:0}}/><span style={{fontWeight:500,fontSize:12}}>{s.label}</span></div>
                    <div style={{display:'flex',gap:4}}>
                      <button onClick={()=>toggleStatus(s.id,s.is_active)} style={{fontSize:10,padding:'2px 6px',border:'1px solid #E2E8F0',borderRadius:4,background:'transparent',cursor:'pointer',color:'#718096'}}>{s.is_active?'Off':'On'}</button>
                      <button onClick={()=>deleteStatus(s.id)} style={{width:22,height:22,border:'1px solid #FED7D7',borderRadius:4,background:'transparent',cursor:'pointer',color:'#FC8181',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14}}>×</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab==='overview'&&(
            <div>
              <h3 style={{fontSize:15,fontWeight:600,marginBottom:14}}>Team Structure</h3>
              {managers.length===0?(<div className="card"><div className="empty-state"><h3>No managers yet</h3></div></div>)
              :managers.map(manager=>(
                <div key={manager.id} className="card" style={{marginBottom:12,overflow:'hidden'}}>
                  <div style={{background:'linear-gradient(135deg,#854F0B,#C05621)',padding:'11px 16px',color:'white',fontWeight:600,fontSize:13,display:'flex',alignItems:'center',gap:8}}>
                    <IconUsers size={15} strokeWidth={1.8}/>{manager.full_name}<span style={{opacity:0.7,fontWeight:400,fontSize:11}}>— Manager</span>
                  </div>
                  {teamLeaders.filter(tl=>tl.manager_id===manager.id).map(tl=>(
                    <div key={tl.id} style={{padding:'10px 16px',borderBottom:'1px solid #F7FAFC'}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                        <span style={{background:'#EEEDFE',color:'#534AB7',padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:500}}>TL</span>
                        <strong style={{fontSize:13,color:'#2D3748'}}>{tl.full_name}</strong>
                      </div>
                      <div style={{display:'flex',gap:6,flexWrap:'wrap',paddingLeft:12}}>
                        {users.filter(u=>u.team_leader_id===tl.id).map(agent=>(
                          <span key={agent.id} style={{background:'#E6F1FB',color:'#185FA5',padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:500}}>{agent.full_name}</span>
                        ))}
                        {users.filter(u=>u.team_leader_id===tl.id).length===0&&<span style={{color:'#A0AEC0',fontSize:12}}>No agents</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  const AdminDashboardHome=()=>(
    <div>
      <div className="page-header">
        <div>
          <h1 style={{display:'flex',alignItems:'center',gap:8,fontSize:isMobile?16:18}}><IconLayoutDashboard size={isMobile?18:22} strokeWidth={1.6}/>Dashboard</h1>
          <p>Welcome, {profile?.full_name||'Admin'} — {new Date().toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'})}</p>
        </div>
        <button className="btn btn-outline btn-sm" onClick={fetchDashboardStats}><IconRefresh size={14}/> Refresh</button>
      </div>
      <div className="page-body">
        <div className="stats-grid">
          {[
            {icon:<IconUsers size={18} color="#185FA5"/>,label:'Total Leads',value:stats.totalLeads,color:'#185FA5',bg:'#E6F1FB'},
            {icon:<IconPhoneIncoming size={18} color="#0F6E56"/>,label:'Calls Today',value:stats.todayCalls,color:'#0F6E56',bg:'#E1F5EE'},
            {icon:<IconCheckbox size={18} color="#854F0B"/>,label:'Pending Tasks',value:stats.pendingTasks,color:'#854F0B',bg:'#FAEEDA'},
            {icon:<IconChartBar size={18} color="#534AB7"/>,label:'Converted',value:stats.converted,color:'#534AB7',bg:'#EEEDFE'},
          ].map(s=>(
            <div key={s.label} className="stat-card">
              <div style={{width:34,height:34,borderRadius:8,background:s.bg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{s.icon}</div>
              <div className="stat-info"><h3 style={{color:s.color}}>{s.value}</h3><p>{s.label}</p></div>
            </div>
          ))}
        </div>
        <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:16}}>
          <div className="card">
            <div className="card-header"><h3 style={{display:'flex',alignItems:'center',gap:6,fontSize:13}}><IconPhoneIncoming size={15} strokeWidth={1.6}/>Recent Calls</h3></div>
            {recentCalls.length===0
              ?<div className="empty-state" style={{padding:24}}><p>No calls today yet</p></div>
              :recentCalls.map(call=>(
                <div key={call.id} style={{padding:'10px 16px',borderBottom:'1px solid #F7FAFC',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  <div><div style={{fontWeight:500,fontSize:13,color:'#2D3748'}}>{call.call_outcome||'Logged'}</div><div style={{fontSize:11,color:'#A0AEC0'}}>{call.duration||'N/A'}</div></div>
                  <span style={{background:'#E1F5EE',color:'#0F6E56',padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:500}}>{call.call_status}</span>
                </div>
              ))
            }
          </div>
          <div className="card">
            <div className="card-header"><h3 style={{fontSize:13}}>Quick Actions</h3></div>
            <div className="card-body">
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                {[
                  {icon:<IconUsers size={20} strokeWidth={1.4}/>,label:'Add Lead',color:'#E6F1FB',tc:'#185FA5',page:'leads'},
                  {icon:<IconPhoneIncoming size={20} strokeWidth={1.4}/>,label:'Log Call',color:'#E1F5EE',tc:'#0F6E56',page:'calls'},
                  {icon:<IconBuildingStore size={20} strokeWidth={1.4}/>,label:'Campaigns',color:'#FAEEDA',tc:'#854F0B',page:'campaigns'},
                  {icon:<IconChartBar size={20} strokeWidth={1.4}/>,label:'Reports',color:'#EEEDFE',tc:'#534AB7',page:'reports'},
                ].map(a=>(
                  <div key={a.label} onClick={()=>setActivePage(a.page)}
                    style={{background:a.color,borderRadius:10,padding:14,cursor:'pointer',textAlign:'center'}}
                    onMouseEnter={e=>e.currentTarget.style.opacity='0.85'}
                    onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
                    <div style={{color:a.tc,marginBottom:5,display:'flex',justifyContent:'center'}}>{a.icon}</div>
                    <div style={{fontSize:12,fontWeight:600,color:a.tc}}>{a.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  return(
    <div style={{display:'flex',minHeight:'100vh',background:'#F8FAFC'}}>

      {/* SIDEBAR OVERLAY — mobile */}
      {sidebarOpen&&isMobile&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:99}} onClick={()=>setSidebarOpen(false)}/>
      )}

      {/* SIDEBAR */}
      <aside style={{
        width:220,
        background:'linear-gradient(180deg,#0C3A6B 0%,#185FA5 100%)',
        display:'flex',
        flexDirection:'column',
        flexShrink:0,
        position:isMobile?'fixed':'sticky',
        top:0,
        left:0,
        height:'100vh',
        zIndex:100,
        transform:isMobile?(sidebarOpen?'translateX(0)':'translateX(-100%)'):'translateX(0)',
        transition:'transform 0.25s ease',
        overflowY:'auto',
      }}>
        <div style={{padding:'16px 14px 12px',borderBottom:'1px solid rgba(255,255,255,0.1)'}}>
          <div style={{display:'flex',alignItems:'center',gap:9,marginBottom:4}}>
            <div style={{width:28,height:28,background:'rgba(255,255,255,0.15)',borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <IconBolt size={14} color="white" strokeWidth={2}/>
            </div>
            <h2 style={{fontSize:15,fontWeight:600,color:'white',letterSpacing:'-0.2px'}}>{crmName}</h2>
          </div>
          <p style={{paddingLeft:37,fontSize:10,color:'rgba(255,255,255,0.5)'}}>{crmTagline}</p>
        </div>
        <nav style={{flex:1,padding:'8px 0',overflowY:'auto'}}>
          {navSections.map((section,si)=>(
            <div key={si}>
              <div style={{fontSize:10,fontWeight:600,color:'rgba(255,255,255,0.4)',letterSpacing:'0.8px',textTransform:'uppercase',padding:'12px 14px 4px'}}>{section.section}</div>
              {section.items.filter(item=>item.roles.includes(role)).map(item=>(
                <div key={item.id}
                  style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',margin:'1px 8px',borderRadius:8,cursor:'pointer',fontSize:13,color:activePage===item.id?'white':'rgba(255,255,255,0.7)',background:activePage===item.id?'rgba(255,255,255,0.15)':'transparent',transition:'all 0.15s'}}
                  onClick={()=>{ setActivePage(item.id); setSidebarOpen(false) }}>
                  <span style={{display:'flex',alignItems:'center',flexShrink:0}}>{getIcon(item.icon)}</span>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          ))}
        </nav>
        <div style={{padding:12,borderTop:'1px solid rgba(255,255,255,0.1)'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',borderRadius:10,background:'rgba(255,255,255,0.1)'}}>
            <div style={{width:32,height:32,borderRadius:'50%',background:'rgba(255,255,255,0.25)',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,color:'white',fontSize:13,flexShrink:0}}>{(profile?.full_name||'U')[0].toUpperCase()}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,fontWeight:600,color:'white',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{profile?.full_name||'User'}</div>
              <div style={{fontSize:10,color:'rgba(255,255,255,0.6)',textTransform:'capitalize'}}>{role.replace('_',' ')}</div>
            </div>
            <button onClick={handleLogout} style={{background:'rgba(255,255,255,0.1)',border:'none',color:'rgba(255,255,255,0.7)',width:28,height:28,borderRadius:8,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}} title="Logout"><IconPower size={14} strokeWidth={1.8}/></button>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main style={{flex:1,minWidth:0,marginLeft:isMobile?0:0,display:'flex',flexDirection:'column'}}>

        {/* MOBILE TOP BAR */}
        {isMobile&&(
          <div style={{background:'white',borderBottom:'1px solid #E2E8F0',padding:'12px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',position:'sticky',top:0,zIndex:50}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <button onClick={()=>setSidebarOpen(!sidebarOpen)} style={{background:'transparent',border:'1px solid #E2E8F0',borderRadius:8,width:36,height:36,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'#6B7280'}}>
                <IconMenu2 size={20}/>
              </button>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <IconBolt size={16} color="#185FA5"/>
                <span style={{fontSize:14,fontWeight:700,color:'#111827'}}>{crmName}</span>
              </div>
            </div>
            <div style={{width:32,height:32,borderRadius:'50%',background:'#185FA5',display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontSize:12,fontWeight:600}}>
              {(profile?.full_name||'U')[0].toUpperCase()}
            </div>
          </div>
        )}

        {activePage==='dashboard'&&role==='admin'       &&<AdminDashboardHome/>}
        {activePage==='dashboard'&&role==='manager'     &&<ManagerPanel userId={profile?.id}/>}
        {activePage==='dashboard'&&role==='team_leader' &&<TeamLeaderPanel userId={profile?.id}/>}
        {activePage==='dashboard'&&role==='agent'       &&<AgentDashboard userId={profile?.id}/>}
        {activePage==='leads'    &&<Leads     userRole={role} userId={profile?.id}/>}
        {activePage==='campaigns'&&<Campaigns userRole={role} userId={profile?.id}/>}
        {activePage==='calls'    &&<Calls     userRole={role} userId={profile?.id}/>}
        {activePage==='tasks'    &&<Tasks     userRole={role} userId={profile?.id}/>}
        {activePage==='reports'  &&<Reports   userRole={role} userId={profile?.id}/>}
        {activePage==='admin'    &&role==='admin'&&<AdminPanel/>}
        {activePage==='settings' &&role==='admin'&&<Settings/>}
        {activePage==='admin'    &&role!=='admin'&&(
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'60vh',padding:20,textAlign:'center'}}>
            <IconSettings size={48} strokeWidth={1.2} color="#CBD5E0"/>
            <h2 style={{fontSize:18,fontWeight:600,marginTop:16,color:'#4A5568'}}>Access Denied</h2>
            <p style={{color:'#A0AEC0',marginTop:6,fontSize:14}}>You don't have permission.</p>
          </div>
        )}
      </main>
    </div>
  )
}