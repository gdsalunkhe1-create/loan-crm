/* eslint-disable */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../supabase'
import * as XLSX from 'xlsx'
import { exportToExcel, parseSpreadsheet, autoMapHeaders } from '../utils/spreadsheet'
import { IST_TZ, nowIST, parseIST, formatIST, addMinutes, compareIST, buildIST, toDbTimestamp } from '../utils/timeUtils'
import { isOverdue, isReminderActive, isResolved, getReminderWindowStart, shouldTriggerReminder } from '../utils/reminderEngine'

import Leads from './Leads'
import Tasks from './Tasks'
import Calls from './Calls'
import Reports from './Reports'
import Settings from './Settings'
import Campaigns from './Campaigns'
import CallingWorkspace from './AgentCallingFlow'
import CibilParser from './CibilParser'
import EmiCalculator from './EmiCalculator'
import CamCalculator from './CamCalculator'
import CallAssist from './CallAssist'
import {
  IconLayoutDashboard, IconUsers, IconPhoneCall, IconCheckbox,
  IconChartBar, IconSettings, IconAdjustments, IconPhone,
  IconPower, IconEdit, IconPhoneIncoming, IconBuildingStore,
  IconThumbUp, IconCircleCheck, IconRefresh, IconBell,
  IconX, IconAlertTriangle, IconClockHour4, IconBrandWhatsapp,
  IconDownload, IconSearch, IconMail, IconNotes,
  IconBolt, IconDeviceFloppy, IconMenu2, IconEye, IconHeadset
} from '@tabler/icons-react'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error: error.message }
  }
  componentDidCatch(error, info) {
    console.error('Panel Error:', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 40,
          textAlign: 'center',
          background: 'white',
          borderRadius: 12,
          border: '1px solid #fecaca',
          margin: 20
        }}>
          <div style={{fontSize: 32, marginBottom: 12}}>⚠️</div>
          <div style={{fontSize: 18, fontWeight: 700, color: '#dc2626', marginBottom: 8}}>
            Something went wrong
          </div>
          <div style={{fontSize: 13, color: '#6b7280', marginBottom: 20}}>
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

const STATUS_OPTIONS = ['New','Interested','Callback','Login','Approved','Disbursed','Not Interested','DND']
// 'YYYY-MM-DD' for today in IST — used only to default/min-bound date pickers.
// Built from the single canonical nowIST() so it can never drift from the
// reminder engine's notion of "now".
const istToday = () => nowIST().slice(0,10)

const TIME_OPTIONS = (()=>{
  const opts=[]
  for(let h=9;h<=21;h++){
    for(const m of ['00','30']){
      if(h===21&&m==='30') continue
      const ampm=h<12?'AM':h===12?'PM':'PM'
      const dh=h>12?h-12:h===0?12:h
      opts.push(`${dh}:${m} ${ampm}`)
    }
  }
  return opts
})()

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

// ── Simple clean theme for the agent-dashboard filter bar ──
const filterBarWrapStyle = {
  display:'flex', gap:10, alignItems:'center', flexWrap:'wrap',
  padding:'12px 16px', borderRadius:12,
  background:'white',
  border:'1px solid #e5e7eb',
  boxShadow:'0 1px 4px rgba(0,0,0,0.06)',
  marginBottom:12
}
const filterClayStage = {
  padding:'8px 14px',
  borderRadius:8,
  border:'1.5px solid #185FA5',
  background:'linear-gradient(145deg,#f0f7ff,#e6f1fb)',
  color:'#0C447C',
  fontWeight:600,
  fontSize:13,
  cursor:'pointer',
  outline:'none',
  boxShadow:'0 2px 6px rgba(24,95,165,0.15)'
}
const filterClayAmount = {
  padding:'8px 14px',
  borderRadius:8,
  border:'1.5px solid #d1d5db',
  background:'white',
  color:'#374151',
  fontWeight:500,
  fontSize:13,
  cursor:'pointer',
  outline:'none',
  appearance:'none',
  WebkitAppearance:'none',
  boxShadow:'0 1px 4px rgba(0,0,0,0.08)'
}
const filterClayCity = {
  padding:'8px 14px',
  borderRadius:8,
  border:'1.5px solid #d1d5db',
  background:'white',
  color:'#374151',
  fontWeight:500,
  fontSize:13,
  cursor:'pointer',
  outline:'none',
  appearance:'none',
  WebkitAppearance:'none',
  boxShadow:'0 1px 4px rgba(0,0,0,0.08)'
}
const filterClayDate = {
  padding:'8px 12px',
  borderRadius:8,
  border:'1.5px solid #d1d5db',
  background:'white',
  color:'#374151',
  fontWeight:500,
  fontSize:13,
  cursor:'pointer',
  outline:'none',
  colorScheme:'light',
  minWidth:130,
  boxShadow:'0 1px 4px rgba(0,0,0,0.08)'
}
const filterSearchStyle = {
  flex:1,
  padding:'9px 16px 9px 36px',
  borderRadius:8,
  border:'1px solid #d1d5db',
  background:'white',
  color:'#374151',
  fontWeight:400,
  fontSize:13,
  outline:'none',
  boxShadow:'0 1px 3px rgba(0,0,0,0.08)',
  transition:'all 0.2s ease'
}
const filterClearBtnStyle = {
  position:'absolute',
  right:10,
  top:'50%',
  transform:'translateY(-50%)',
  width:22,
  height:22,
  borderRadius:'50%',
  border:'none',
  background:'#e5e7eb',
  color:'#6b7280',
  cursor:'pointer',
  display:'flex',
  alignItems:'center',
  justifyContent:'center',
  fontSize:13,
  lineHeight:1,
  padding:0
}
// Original clean pill colors for lead pipeline stages (used on the inline stage selector)
const stageBadgeStyle = {
  'New':           {bg:'#E6F1FB', color:'#0C447C'},
  'Interested':    {bg:'#FAEEDA', color:'#633806'},
  'Callback':      {bg:'#F1EFE8', color:'#444441'},
  'Login':         {bg:'#FEF3C7', color:'#92400E'},
  'Approved':      {bg:'#EAF3DE', color:'#27500A'},
  'Disbursed':     {bg:'#D1FAE5', color:'#065F46'},
  'Not Interested':{bg:'#FCEBEB', color:'#791F1F'},
  'DND':           {bg:'#FCEBEB', color:'#791F1F'},
  'Documents Pending':{bg:'#EEEDFE', color:'#534AB7'},
  'Voice Mail':    {bg:'#EEEDFE', color:'#534AB7'},
  'Ringing':       {bg:'#E6F1FB', color:'#185FA5'},
  'Busy':          {bg:'#FAEEDA', color:'#854F0B'},
  'Switched Off':  {bg:'#F1EFE8', color:'#5F5E5A'},
  'Not Reachable': {bg:'#F1EFE8', color:'#5F5E5A'},
  'Not Required Hup':{bg:'#E6F1FB', color:'#185FA5'},
  'Not Required Polite':{bg:'#E6F1FB', color:'#185FA5'},
  'Call Cut':      {bg:'#EAF3DE', color:'#27500A'},
  'Police':        {bg:'#FCEBEB', color:'#791F1F'},
  'Disbursed Other':{bg:'#D1FAE5', color:'#065F46'},
  'Wrong Number/ Invalid Number':{bg:'#FCEBEB', color:'#791F1F'},
  'Lead':          {bg:'#E6F1FB', color:'#0C447C'},
  'Not Doable':    {bg:'#F1EFE8', color:'#5F5E5A'},
}

// Icon + label variant of the clay action buttons (mobile card layout)
const actionBtnLabeledBase = {
  display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:3,
  padding:'8px 6px', borderRadius:10, border:'none', cursor:'pointer',
  minWidth:50, minHeight:44, transition:'all 0.1s ease',
  fontSize:10, fontWeight:600, boxShadow:'none', position:'relative', top:0
}
const actionBtnLabeledStyles = {
  call:        {...actionBtnLabeledBase, background:'#DCFCE7', color:'#16A34A'},
  whatsapp:    {...actionBtnLabeledBase, background:'#D1FAE5', color:'#059669'},
  obligations: {...actionBtnLabeledBase, background:'#F5F3FF', color:'#7C3AED'},
  viewObs:     {...actionBtnLabeledBase, background:'#EFF6FF', color:'#2563EB'},
  note:        {...actionBtnLabeledBase, background:'#FEF3C7', color:'#D97706'},
  view:        {...actionBtnLabeledBase, background:'#FFEDD5', color:'#EA580C'},
}

// Standard action button — icon only, no label (desktop table Actions column)
const actionBtnSimpleBase = {
  padding:'5px 9px', borderRadius:10, border:'none',
  cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center',
  justifyContent:'center', gap:2, fontSize:9, fontWeight:600, boxShadow:'none'
}
const actionBtnSimpleStyles = {
  call:        {...actionBtnSimpleBase, background:'#DCFCE7', color:'#16A34A'},
  whatsapp:    {...actionBtnSimpleBase, background:'#D1FAE5', color:'#059669'},
  obligations: {...actionBtnSimpleBase, background:'#F5F3FF', color:'#7C3AED'},
  viewObs:     {...actionBtnSimpleBase, background:'#EFF6FF', color:'#2563EB'},
  note:        {...actionBtnSimpleBase, background:'#FEF3C7', color:'#D97706'},
  view:        {...actionBtnSimpleBase, background:'#FFEDD5', color:'#EA580C'},
}

const CALL_DISPOSITIONS = [
  'Ringing',
  'Busy',
  'Call Cut',
  'Not Required Hup',
  'Wrong Number/ Invalid Number',
  'Not Required Polite',
  'Switched Off',
  'Voice Mail',
  'Disbursed Other',
  'Not Doable',
  'Police',
  'Lead',
  'Callback'
]

const STAGE_OPTIONS = ['New','Interested','Callback','Documents Pending','Login','Approved','Disbursed','Not Interested','DND','Ringing','Busy','Call Cut','Not Required Hup','Wrong Number/ Invalid Number','Not Required Polite','Switched Off','Voice Mail','Disbursed Other','Not Doable','Police','Lead']

const OBLIGATION_TYPES = ['Personal Loan','Housing Loan','Education Loan','Car Loan','Bike Loan','Consumer Durable Loan','Credit Card','Gold Loan']
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
  const [showPipeline,setShowPipeline]     = useState(true)
  const [showStatCards,setShowStatCards]   = useState(true)
  const [agentDbNotifs,setAgentDbNotifs]   = useState([])
  const [agentDbUnread,setAgentDbUnread]   = useState(0)
  const [showAgentDbBell,setShowAgentDbBell] = useState(false)
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
  const [showWAQuick,setShowWAQuick]       = useState(null)
  const [waQuickPos,setWaQuickPos]         = useState({top:0,left:0})
  const [noteLead,setNoteLead]             = useState(null)
  const [showNoteModal,setShowNoteModal]   = useState(false)
  const [noteText,setNoteText]             = useState('')
  const [leadObligations,setLeadObligations] = useState({})
  const [selectedLeadForObligations,setSelectedLeadForObligations] = useState(null)
  const [showObligationModal,setShowObligationModal] = useState(false)
  const [obligationDrafts,setObligationDrafts] = useState([])
  const [savingObligation,setSavingObligation] = useState(false)
  const [obligationError,setObligationError] = useState('')
  const [obModalSalary,setObModalSalary]     = useState('')
  const [obModalNetTakeHome,setObModalNetTakeHome] = useState('')
  const [obModalCompany,setObModalCompany]   = useState('')
  const [obModalReadOnly,setObModalReadOnly] = useState(false)
  const [obModalNotes,setObModalNotes]       = useState('')
  const [obModalNoteInput,setObModalNoteInput] = useState('')
  const [isObEditing,setIsObEditing]         = useState(false)
  const [obSavedSnapshot,setObSavedSnapshot] = useState(null)
  const [obIsNewLead,setObIsNewLead]         = useState(false)
  const [toast,setToast]                   = useState(null)
  const [darkMode,setDarkMode]             = useState(false)
  const [greeting,setGreeting]             = useState('')
  const [callingLead,setCallingLead]       = useState(null)
  const [showWorkspace,setShowWorkspace]   = useState(false)
  const [leadQueue,setLeadQueue]           = useState([])
  const [queueIndex,setQueueIndex]         = useState(0)
  const [queueComplete,setQueueComplete]   = useState(false)
  const [showCallbackModal,setShowCallbackModal] = useState(false)
  const [showExportPanel, setShowExportPanel] = useState(false)
  const [callbackLead,setCallbackLead]           = useState(null)
  const [callbackDate,setCallbackDate]           = useState('')
  const [callbackTime,setCallbackTime]           = useState('10:00')
  const [callbackNotes,setCallbackNotes]         = useState('')
  const [callbackTasks,setCallbackTasks]         = useState([])
  const [leadCallbackMap,setLeadCallbackMap]     = useState({})
  const [showCallbackReminder,setShowCallbackReminder] = useState(false)
  const [rescheduleTaskId,setRescheduleTaskId]   = useState(null)
  const [rescheduleDate,setRescheduleDate]       = useState('')
  const [rescheduleTime,setRescheduleTime]       = useState('10:00')
  const snoozedTasksRef                           = useRef({})
  const alreadyBuzzingRef                         = useRef(false)
  const fetchAllRef                              = useRef(null)
  const selectedLeadObRef                        = useRef(null)
  const checkRemindersRef                        = useRef(null)
  const fetchCallbackTasksRef                    = useRef(null)
  const reminderPopupRef                         = useRef(null)
  const agentStatusDropOpenRef                   = useRef(false)
  const [leadStages,setLeadStages]         = useState([])
  const [rtConnected,setRtConnected]       = useState(false)
  const [lastSynced,setLastSynced]         = useState(null)
  const [leadReassignInfo,setLeadReassignInfo] = useState(null)
  const [animatedStats,setAnimatedStats]   = useState({
    todayLogins:0, todayDisbursed:0, monthlyLogins:0, monthlyDisbursed:0
  })
  const [showCallLogModal,setShowCallLogModal]   = useState(false)
  const [callLogLead,setCallLogLead]             = useState(null)
  const [callLogDisposition,setCallLogDisposition] = useState('')
  const [callLogStage,setCallLogStage]           = useState('New')
  const [callLogNotes,setCallLogNotes]           = useState('')
  const [callLogCallbackDate,setCallLogCallbackDate] = useState('')
  const [callLogCallbackTime,setCallLogCallbackTime] = useState('10:00')
  const [previousOutcomes,setPreviousOutcomes]   = useState([])
  const [savingCallLog,setSavingCallLog]         = useState(false)
  const [viewLead,setViewLead]                   = useState(null)
  const [agentStatusSet,setAgentStatusSet]       = useState([])
  const [agentStatusDropOpen,setAgentStatusDropOpen] = useState(false)
  agentStatusDropOpenRef.current = agentStatusDropOpen
  const [agentDateFrom,setAgentDateFrom]         = useState('')
  const [agentDateTo,setAgentDateTo]             = useState('')
  const [filterLoanAmount,setFilterLoanAmount]   = useState('')
  const [filterCity,setFilterCity]               = useState('')

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

  useEffect(()=>{ if(userId) fetchAll() },[dateRange, userId])
  useEffect(()=>{ fetchLeadStages() },[])

  useEffect(()=>{
    if(!viewLead) return
    const fresh=myLeads.find(l=>l.id===viewLead.id)
    if(fresh && (fresh.notes!==viewLead.notes || fresh.status!==viewLead.status || fresh.disposition!==viewLead.disposition || fresh.call_history!==viewLead.call_history)){
      setViewLead(fresh)
    }
  },[myLeads,viewLead])

  useEffect(()=>{
    if(!userId)return
    supabase.from('notifications').select('*').eq('agent_id',userId).eq('type','leads_assigned').order('created_at',{ascending:false}).limit(30)
      .then(({data})=>{ if(data){setAgentDbNotifs(data);setAgentDbUnread(data.filter(n=>!n.read).length)} })
    const ch=supabase.channel('agent-db-notifs-'+userId)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:'agent_id=eq.'+userId},(payload)=>{
        const n=payload.new
        if(n.type!=='leads_assigned')return
        setAgentDbNotifs(prev=>[n,...prev.slice(0,29)])
        setAgentDbUnread(c=>c+1)
        showToast(n.message)
      })
      .subscribe()
    return()=>supabase.removeChannel(ch)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[userId])
  useEffect(()=>{
    checkRemindersRef.current?.()
    fetchWATemplates()
    fetchCallbackTasksRef.current?.()
    // 30-second poll — refs always point to the latest function so closures stay fresh
    const iv=setInterval(()=>{checkRemindersRef.current?.();fetchCallbackTasksRef.current?.()},30000)
    return()=>clearInterval(iv)
  },[userId])
  // 8-second lead-list polling fallback (catches updates when RT channel is unreliable)
  useEffect(()=>{
    if(!userId) return
    const leadPoll=setInterval(()=>{ if(!agentStatusDropOpenRef.current) fetchAllRef.current?.() },8000)
    return()=>clearInterval(leadPoll)
  },[userId])
  // Keep ref in sync so RT obligation callback can check which lead panel is open
  useEffect(()=>{ selectedLeadObRef.current=selectedLeadForObligations },[selectedLeadForObligations])
  // Keep reminderPopupRef in sync so checkReminders never reads a stale closure value
  useEffect(()=>{ reminderPopupRef.current=reminderPopup },[reminderPopup])
  // Close WA quick popup when clicking anywhere outside it
  useEffect(()=>{
    const close=()=>setShowWAQuick(null)
    if(showWAQuick) document.addEventListener('click',close)
    return()=>document.removeEventListener('click',close)
  },[showWAQuick])

  // Real-time subscriptions
  useEffect(()=>{
    if(!userId) return

    const channelId='agent-rt-'+userId+'-'+Math.random().toString(36).slice(2,8)
    console.log('[RT] Subscribing channel:', channelId)

    const sub=supabase
      .channel(channelId)

      // ── LEAD UPDATE ──
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'leads'},(payload)=>{
        console.log('[RT] leads UPDATE received:', payload)
        const upd=payload.new
        if(!upd?.id){
          console.log('[RT] leads UPDATE: empty payload (RLS blocked), falling back to fetchAll')
          fetchAllRef.current?.()
          setLastSynced(new Date())
          return
        }
        setMyLeads(prev=>{
          const idx=prev.findIndex(l=>l.id===upd.id)
          if(idx===-1){
            if(upd.assigned_to===userId){
              const next=[upd,...prev]
              computePipelineStats(next)
              return next
            }
            return prev
          }
          if(upd.assigned_to&&upd.assigned_to!==userId){setTimeout(()=>fetchAllRef.current?.(),50);return prev;}if(false){
            const next=[...prev.filter(l=>l.id!==upd.id)]
            computePipelineStats(next)
            return next
          }
          const next=[...prev.map(l=>l.id===upd.id?{...l,...upd}:l)]
          computePipelineStats(next)
          return next
        })
        setLastSynced(new Date())
      })

      // ── LEAD INSERT ──
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'leads'},(payload)=>{
        console.log('[RT] leads INSERT received:', payload)
        const inserted=payload.new
        if(!inserted?.id){
          console.log('[RT] leads INSERT: empty payload, falling back to fetchAll')
          fetchAllRef.current?.()
          setLastSynced(new Date())
          return
        }
        if(inserted.assigned_to!==userId) return
        setMyLeads(prev=>{
          if(prev.some(l=>l.id===inserted.id)) return prev
          const next=[inserted,...prev]
          computePipelineStats(next)
          return next
        })
        setLastSynced(new Date())
      })

      // ── LEAD DELETE ──
      .on('postgres_changes',{event:'DELETE',schema:'public',table:'leads'},(payload)=>{
        console.log('[RT] leads DELETE received:', payload)
        if(!payload.old?.id) return
        setMyLeads(prev=>{
          const next=[...prev.filter(l=>l.id!==payload.old.id)]
          computePipelineStats(next)
          return next
        })
        setLastSynced(new Date())
      })

      // ── OBLIGATIONS ──
      .on('postgres_changes',{event:'*',schema:'public',table:'loan_obligations'},(payload)=>{
        console.log('[RT] loan_obligations event received:', payload)
        const leadId=payload.new?.lead_id||payload.old?.lead_id
        if(!leadId) return
        supabase.from('loan_obligations').select('*').eq('lead_id',leadId).then(({data})=>{
          if(!data) return
          setLeadObligations(prev=>({...prev,[leadId]:data}))
          if(selectedLeadObRef.current?.id===leadId) setObligationDrafts(cloneObligations(data))
        })
        setLastSynced(new Date())
      })

      // ── CALLS INSERT ──
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'calls',filter:'agent_id=eq.'+userId},(payload)=>{
        console.log('[RT] calls INSERT received:', payload)
        const call=payload.new
        if(!call?.id){ fetchAllRef.current?.(); setLastSynced(new Date()); return }
        setMyCalls(prev=>prev.some(c=>c.id===call.id)?[...prev]:[call,...prev])
        setLastSynced(new Date())
      })
      // ── CALLS UPDATE ──
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'calls',filter:'agent_id=eq.'+userId},(payload)=>{
        console.log('[RT] calls UPDATE received:', payload)
        const call=payload.new
        if(!call?.id) return
        setMyCalls(prev=>[...prev.map(c=>c.id===call.id?call:c)])
        setLastSynced(new Date())
      })
      // ── CALLS DELETE ──
      .on('postgres_changes',{event:'DELETE',schema:'public',table:'calls',filter:'agent_id=eq.'+userId},(payload)=>{
        console.log('[RT] calls DELETE received:', payload)
        if(!payload.old?.id) return
        setMyCalls(prev=>[...prev.filter(c=>c.id!==payload.old.id)])
        setLastSynced(new Date())
      })

      // ── TASKS INSERT ──
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'tasks',filter:'assigned_to=eq.'+userId},(payload)=>{
        console.log('[RT] tasks INSERT received:', payload)
        const task=payload.new
        if(!task?.id){ fetchAllRef.current?.(); setLastSynced(new Date()); return }
        setMyTasks(prev=>prev.some(t=>t.id===task.id)?[...prev]:[task,...prev])
        fetchCallbackTasksRef.current?.()
        setLastSynced(new Date())
      })
      // ── TASKS UPDATE ──
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'tasks',filter:'assigned_to=eq.'+userId},(payload)=>{
        console.log('[RT] tasks UPDATE received:', payload)
        const task=payload.new
        if(!task?.id){ fetchAllRef.current?.(); setLastSynced(new Date()); return }
        setMyTasks(prev=>[...prev.map(t=>t.id===task.id?task:t)])
        fetchCallbackTasksRef.current?.()
        setLastSynced(new Date())
      })
      // ── TASKS DELETE ──
      .on('postgres_changes',{event:'DELETE',schema:'public',table:'tasks',filter:'assigned_to=eq.'+userId},(payload)=>{
        console.log('[RT] tasks DELETE received:', payload)
        if(!payload.old?.id) return
        setMyTasks(prev=>[...prev.filter(t=>t.id!==payload.old.id)])
        setCallbackTasks(prev=>[...prev.filter(t=>t.id!==payload.old.id)])
        setLastSynced(new Date())
      })

      .subscribe((status)=>{
        console.log('[RT] channel', channelId, 'status:', status)
        setRtConnected(status==='SUBSCRIBED')
      })

    const onVisible=()=>{
      if(document.visibilityState==='visible'){
        console.log('[RT] tab visible — re-syncing')
        fetchAllRef.current?.()
        setLastSynced(new Date())
      }
    }
    document.addEventListener('visibilitychange',onVisible)

    return()=>{
      console.log('[RT] cleaning up channel:', channelId)
      document.removeEventListener('visibilitychange',onVisible)
      supabase.removeChannel(sub)
    }
  },[userId])

  const fetchWATemplates=async()=>{
    const{data}=await supabase.from('settings').select('*').eq('key','wa_templates').single()
    if(data?.value){try{setWaTemplates(JSON.parse(data.value))}catch(e){}}
  }

  const playCallbackBeep=()=>{
    try{
      const ctx=new(window.AudioContext||window.webkitAudioContext)()
      const play=(freq,start,dur)=>{
        const osc=ctx.createOscillator(),gain=ctx.createGain()
        osc.connect(gain);gain.connect(ctx.destination)
        osc.frequency.value=freq;osc.type='sine'
        gain.gain.setValueAtTime(0,ctx.currentTime+start)
        gain.gain.linearRampToValueAtTime(0.35,ctx.currentTime+start+0.05)
        gain.gain.linearRampToValueAtTime(0,ctx.currentTime+start+dur)
        osc.start(ctx.currentTime+start);osc.stop(ctx.currentTime+start+dur+0.05)
      }
      play(880,0,0.3);play(660,0.35,0.3);play(880,0.7,0.4)
    }catch(e){}
  }

  const fetchCallbackTasks=async()=>{
    if(!userId) return
    // Fetch ALL non-terminal callbacks — no date restriction, so overdue tasks
    // AND tomorrow's/future callbacks all surface (filtering happens client-side
    // below, never as a DB-side comparison against the timestamptz column —
    // see timeUtils.js for why that matters).
    const{data}=await supabase.from('tasks').select('*')
      .eq('assigned_to',userId)
      .in('status',['Pending','Attempted'])
      .ilike('title','Callback:%')
      .order('due_date',{ascending:true})
    const allTasks=data||[]
    const now=nowIST()

    // Debug: see exactly why any given callback is or isn't reminding right now.
    allTasks.forEach(t=>{
      const lastSnoozeAt=t.last_snooze_at||snoozedTasksRef.current[t.id]||null
      console.log({
        title:t.title,
        now,
        due_date:t.due_date,
        reminderStart:getReminderWindowStart(t),
        completed:t.status==='Completed',
        attempted:t.status==='Attempted',
        resolved:isResolved(t),
        lastSnoozeAt,
        shouldTrigger:shouldTriggerReminder(t,lastSnoozeAt),
      })
    })

    // Persistent list: every non-resolved callback whose window has opened
    // (due_date - 5min has arrived) stays in the list continuously — this is
    // deliberately broader than the popup trigger below, so callbacks don't
    // disappear from the panel between the every-5-minute popup pulses.
    const displayTasks=allTasks.filter(t=>t.status!=='Attempted'&&isReminderActive(t))
    setCallbackTasks(displayTasks)

    // Popup/beep = shouldTriggerReminder (5-min-before window, repeating
    // every SNOOZE_INTERVAL_MIN). last_snooze_at is read from the DB row
    // first — that's what makes the snooze cadence survive a page refresh —
    // and falls back to the in-memory ref only as an optimistic same-tab cache.
    const triggeredTasks=allTasks.filter(t=>
      t.status!=='Attempted'&&shouldTriggerReminder(t, t.last_snooze_at||snoozedTasksRef.current[t.id]||null)
    )
    const map={}; displayTasks.forEach(t=>{ if(t.lead_id) map[t.lead_id]=t })
    setLeadCallbackMap(map)

    // Show popup + beep when any task is triggered and popup isn't already up
    if(triggeredTasks.length>0){
      // Persist the snooze stamp to the DB (not just the in-memory ref) so a
      // browser refresh can't make the popup re-fire early or lose the cadence.
      triggeredTasks.forEach(t=>{
        snoozedTasksRef.current[t.id]=now
        supabase.from('tasks').update({last_snooze_at:toDbTimestamp(now)}).eq('id',t.id)
          .then(({error})=>{ if(error) console.error('[Reminder] last_snooze_at write failed — has the migration been run? See REMINDER_ENGINE_MIGRATION.sql', error) })
      })
      setShowCallbackReminder(true)
      if(!alreadyBuzzingRef.current){
        alreadyBuzzingRef.current=true
        playCallbackBeep()
      }
    }
  }

  const markCallbackDone=async(taskId)=>{
    console.log('[Action] markCallbackDone → DB write task:', taskId)
    const {data,error}=await supabase.from('tasks').update({status:'Completed',last_snooze_at:null}).eq('id',taskId).select()
    if(error){ console.error('[Action] markCallbackDone error:', error); showToast('Could not mark done: '+error.message,'error'); return }
    if(!data||data.length===0){ console.warn('[Action] markCallbackDone updated 0 rows — RLS blocked or task not found'); showToast('Not saved — permission denied on this task','error'); fetchCallbackTasks(); return }
    delete snoozedTasksRef.current[taskId]
    setCallbackTasks(prev=>[...prev.filter(t=>t.id!==taskId)])
    setMyTasks(prev=>[...prev.map(t=>t.id===taskId?{...t,status:'Completed'}:t)])
    setLeadCallbackMap(prev=>{
      const next={...prev}
      Object.keys(next).forEach(lid=>{ if(next[lid]?.id===taskId) delete next[lid] })
      return next
    })
    showToast('Callback marked as done')
  }

  const markCallbackAttempted=async(taskId)=>{
    console.log('[Action] markCallbackAttempted → DB write task:', taskId)
    const {data,error}=await supabase.from('tasks').update({status:'Attempted',last_snooze_at:null}).eq('id',taskId).select()
    if(error){ console.error('[Action] markCallbackAttempted error:', error); showToast('Could not mark attempted: '+error.message,'error'); return }
    if(!data||data.length===0){ console.warn('[Action] markCallbackAttempted updated 0 rows — RLS blocked or task not found'); showToast('Not saved — permission denied on this task','error'); fetchCallbackTasks(); return }
    delete snoozedTasksRef.current[taskId]
    setCallbackTasks(prev=>[...prev.filter(t=>t.id!==taskId)])
    setMyTasks(prev=>[...prev.map(t=>t.id===taskId?{...t,status:'Attempted'}:t)])
    setLeadCallbackMap(prev=>{
      const next={...prev}
      Object.keys(next).forEach(lid=>{ if(next[lid]?.id===taskId) delete next[lid] })
      return next
    })
    showToast('Marked as Attempted')
  }

  // Combine the date+time pickers into the canonical IST value, then convert
  // to the absolute instant Postgres needs for the `timestamptz` due_date
  // column (see timeUtils.js — this conversion is the actual bug fix).
  const scheduleDueDate=(dateStr,timeStr)=>toDbTimestamp(buildIST(dateStr,timeStr))

  // If the composed datetime is already in the past, roll forward by exactly 1 day
  // so agents who pick an earlier time slot don't silently create overdue tasks.
  const safeDueDate=(dateStr,timeStr)=>{
    const candidate=buildIST(dateStr,timeStr)
    const safe=compareIST(candidate,nowIST())<=0 ? addMinutes(candidate,24*60) : candidate
    return toDbTimestamp(safe)
  }

  const rescheduleCallback=async(taskId)=>{
    if(!rescheduleDate||!rescheduleTime) return
    const iso=scheduleDueDate(rescheduleDate,rescheduleTime)
    console.log('[Action] rescheduleCallback → DB write task:', taskId, 'due:', iso)
    // Clearing last_snooze_at is what stops the OLD reminder cadence and lets
    // the new due_date start a fresh 5-min-before window.
    const {error}=await supabase.from('tasks').update({due_date:iso,status:'Pending',last_snooze_at:null}).eq('id',taskId)
    if(error){ console.error('[Action] rescheduleCallback error:', error); return }
    delete snoozedTasksRef.current[taskId]
    setMyTasks(prev=>[...prev.map(t=>t.id===taskId?{...t,due_date:iso,status:'Pending',last_snooze_at:null}:t)])
    setRescheduleTaskId(null)
    fetchCallbackTasks()
    showToast('Callback rescheduled!')
  }

  const scheduleCallback=async()=>{
    if(!callbackLead||!callbackDate||!callbackTime) return
    const iso=safeDueDate(callbackDate,callbackTime)
    console.log('[Action] scheduleCallback → DB write lead:', callbackLead.id, 'task due:', iso)
    const {data:lData,error:lErr}=await supabase.from('leads').update({status:'Callback'}).eq('id',callbackLead.id).select()
    if(lErr){ console.error('[Action] scheduleCallback lead update error:', lErr); showToast('Could not update stage: '+lErr.message,'error') }
    else if(!lData||lData.length===0){ console.warn('[Action] scheduleCallback lead update hit 0 rows — RLS blocked or lead not found'); showToast('Stage not saved — permission denied on this lead','error'); fetchAllRef.current?.() }
    else { setMyLeads(prev=>[...prev.map(l=>l.id===callbackLead.id?{...l,status:'Callback'}:l)]); fetchAllRef.current?.() }
    const {error:tErr}=await supabase.from('tasks').insert([{
      title:'Callback: '+callbackLead.full_name,
      lead_id:callbackLead.id,
      due_date:iso,
      notes:callbackNotes||null,
      priority:'High',
      status:'Pending',
      assigned_to:userId,
    }])
    if(tErr){ console.error('[Action] scheduleCallback task insert error:', tErr) }
    else{
      notifyAdmins({type:'callback_set',lead_id:callbackLead.id,customer_name:callbackLead.full_name,due_at:iso,
        message:`⏰ ${profile?.full_name||'Agent'} set a callback for ${callbackLead.full_name} on ${formatIST(iso)}`,
      })
    }
    setShowCallbackModal(false)
    fetchCallbackTasks()
    const d=formatIST(`${callbackDate} 00:00:00`,'date')
    showToast(`Callback scheduled for ${d} at ${callbackTime}`)
  }

  const skipCallback=async()=>{
    if(!callbackLead) return
    const {data:skipData,error:skipErr}=await supabase.from('leads').update({status:'Callback'}).eq('id',callbackLead.id).select()
    if(skipErr){ console.error('[Action] skipCallback lead update error:', skipErr); showToast('Could not update stage: '+skipErr.message,'error') }
    else if(!skipData||skipData.length===0){ console.warn('[Action] skipCallback lead update hit 0 rows — RLS blocked or lead not found'); showToast('Stage not saved — permission denied on this lead','error'); fetchAllRef.current?.() }
    else { setMyLeads(prev=>prev.map(l=>l.id===callbackLead.id?{...l,status:'Callback'}:l)); showToast('Stage updated to Callback'); fetchAllRef.current?.() }
    setShowCallbackModal(false)
  }

  const checkReminders=async()=>{
    if(!userId)return
    // Fetch ALL non-terminal, non-callback tasks for this agent (callbacks are
    // handled by the dedicated popup above) — no DB-side date filter, so every
    // comparison happens client-side through the canonical IST module.
    const{data}=await supabase.from('tasks').select('*')
      .eq('assigned_to',userId).in('status',['Pending','In Progress'])
    const all=(data||[]).filter(t=>!t.title?.startsWith('Callback:'))
    const now=nowIST()
    const five=addMinutes(now,5)
    const upcoming=all.filter(t=>t.due_date&&compareIST(t.due_date,now)>=0&&compareIST(t.due_date,five)<=0)
    const overdue=all.filter(t=>t.due_date&&compareIST(t.due_date,now)<0)
    const unique=[...upcoming,...overdue].filter((t,i,a)=>a.findIndex(x=>x.id===t.id)===i)
    setNotifications(unique)
    // Use ref so we never read a stale reminderPopup closure value
    if(upcoming.length>0&&!reminderPopupRef.current) setReminderPopup(upcoming[0])
  }

  const fetchLeadStages=async()=>{
    const{data}=await supabase.from('lead_stages').select('*').eq('is_active',true).order('order_index')
    if(data&&data.length>0) setLeadStages(data)
  }

  const fetchAll=async(opts={})=>{
    if(!userId) return
    if(!opts.silent) setLoading(true)
    const now=new Date(); let sd=new Date()
    if(dateRange==='today') sd.setHours(0,0,0,0)
    else if(dateRange==='week')  sd.setDate(now.getDate()-7)
    else if(dateRange==='month') sd.setDate(1)
    const[lR,mirR,cR,tR,pR]=await Promise.all([
      supabase.from('leads').select('*').eq('assigned_to',userId).order('created_at',{ascending:false}),
      supabase.from('leads').select('*').contains('mirror_agents',[userId]).order('created_at',{ascending:false}),
      supabase.from('calls').select('*').eq('agent_id',userId).gte('created_at',sd.toISOString()),
      supabase.from('tasks').select('*').eq('assigned_to',userId).order('due_date',{ascending:true}),
      supabase.from('profiles').select('*').eq('id',userId).single(),
    ])
    const leads=[...(lR.data||[]),...(mirR.data||[]).filter(m=>!(lR.data||[]).find(l=>l.id===m.id)).map(m=>({...m,status:(m.mirror_agent_statuses||{})[userId]||m.status}))]
    let obligationMap={}
    const leadIds=leads.map(l=>l.id).filter(Boolean)
    const{data:obligationsData,error:oErr}=await supabase.from('loan_obligations').select('*').in('lead_id',leadIds)
    if(!oErr){
      obligationMap=(obligationsData||[]).reduce((acc,o)=>{acc[o.lead_id]=[...(acc[o.lead_id]||[]),o];return acc},{})
    }
    setMyLeads(leads); setMyCalls(cR.data||[])
    setMyTasks(tR.data||[]); setProfile(pR.data)
    setLeadObligations(obligationMap)
    computePipelineStats(leads)
    setLoading(false)
  }
  // Always keep ref pointing to latest fetchAll (silent=true so background refreshes don't flash the spinner)
  fetchAllRef.current = ()=>fetchAll({silent:true})
  checkRemindersRef.current = checkReminders
  fetchCallbackTasksRef.current = fetchCallbackTasks

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

  const notifyAdmins=async(payload)=>{
    try{
      await supabase.from('notifications').insert([{
        type:payload.type,
        lead_id:payload.lead_id||null,
        agent_id:profile?.id||null,
        agent_name:profile?.full_name||'Agent',
        customer_name:payload.customer_name||null,
        message:payload.message,
        amount:payload.amount??null,
        due_at:payload.due_at||null,
        stage:payload.stage||null,
      }])
    }catch(e){console.error('[notifyAdmins]',e)}
  }

  const updateLeadStatus=async(leadId,newStatus)=>{
    const lead=myLeads.find(l=>l.id===leadId)
    const isMirrorLead=lead&&Array.isArray(lead.mirror_agents)&&lead.mirror_agents.includes(userId)&&lead.assigned_to!==userId
    if(newStatus==='Callback'){
      setCallbackLead(lead)
      setCallbackDate(istToday())
      setCallbackTime('10:00')
      setCallbackNotes('')
      setShowCallbackModal(true)
      return
    }
    if(isMirrorLead){
      const newMirrorStatuses={...(lead.mirror_agent_statuses||{}), [userId]:newStatus}
      const {error}=await supabase.from('leads').update({mirror_agent_statuses:newMirrorStatuses}).eq('id',leadId)
      if(error){ showToast('Could not update stage: '+error.message,'error'); return }
      setMyLeads(prev=>prev.map(l=>l.id===leadId?{...l,mirror_agent_statuses:newMirrorStatuses}:l))
      showToast('Stage updated to '+newStatus)
      return
    }
    console.log('[Action] updateLeadStatus → DB write:', leadId, newStatus)
    const {data,error}=await supabase.from('leads').update({status:newStatus}).eq('id',leadId).select()
    if(error){ console.error('[Action] updateLeadStatus DB error:', error); showToast('Could not update stage: '+error.message,'error'); return }
    if(!data||data.length===0){ console.warn('[Action] updateLeadStatus hit 0 rows — RLS blocked or lead not found'); showToast('Stage not saved — permission denied on this lead','error'); fetchAllRef.current?.(); return }
    // Optimistic update — RT subscription will also fire on other devices
    setMyLeads(prev=>[...prev.map(l=>l.id===leadId?{...l,status:newStatus}:l)])
    showToast('Stage updated to '+newStatus)
    fetchAllRef.current?.()
    if(newStatus==='Lead'){
      const lead=data[0]
      notifyAdmins({type:'lead_saved',lead_id:leadId,customer_name:lead.full_name,amount:lead.loan_amount||null,
        message:`🎯 ${profile?.full_name||'Agent'} booked a LEAD — ${lead.full_name}${lead.loan_amount?' · ₹'+Number(lead.loan_amount).toLocaleString('en-IN'):''}`,
      })
    }
  }

  const saveNote=async()=>{
    if(!noteText.trim())return
    const now=new Date()
    const dd=String(now.getDate()).padStart(2,'0')
    const mon=String(now.getMonth()+1).padStart(2,'0')
    const yyyy=now.getFullYear()
    const hh=String(now.getHours()).padStart(2,'0')
    const mi=String(now.getMinutes()).padStart(2,'0')
    const agentName=profile?.full_name||'Agent'
    const stamp=`[${dd}/${mon}/${yyyy} ${hh}:${mi} - ${agentName}]`
    const newEntry=`${stamp}: ${noteText.trim()}`
    const existing=noteLead.notes||''
    const updated=existing?(existing+'\n'+newEntry):newEntry
    console.log('[Action] saveNote → DB write lead:', noteLead.id)
    const {error}=await supabase.from('leads').update({notes:updated}).eq('id',noteLead.id)
    if(error){ console.error('[Action] saveNote DB error:', error); return }
    // Optimistic update — RT subscription will also fire on other devices
    setMyLeads(prev=>[...prev.map(l=>l.id===noteLead.id?{...l,notes:updated}:l)])
    setNoteLead(prev=>prev?{...prev,notes:updated}:prev)
    setShowNoteModal(false); setNoteText('')
    showToast('Note saved for '+noteLead.full_name)
  }

  const cloneObligations=(items=[])=>items.map(o=>({
    ...o,
    obligation_type:o.obligation_type||'Personal Loan',
    bank_name:o.bank_name||'',
    emi_amount:o.emi_amount||'',
    outstanding_amount:o.outstanding_amount||'',
    pos_amount:o.pos_amount||'',
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
    balance_transfer:o.balance_transfer||false,
    credit_limit:o.credit_limit||o.sanctioned_amount||'',
    editing:false,
    expanded:false,
  }))

  const getLeadObligations=(leadId)=>leadObligations[leadId]||[]

  const openObligationModal=async(lead, readOnly=false)=>{
    setSelectedLeadForObligations(lead)
    setObligationDrafts(cloneObligations(getLeadObligations(lead.id)))
    setShowObligationModal(true)
    setObligationError('')
    setObModalSalary(lead.monthly_salary||'')
    setObModalNetTakeHome(lead.net_take_home||'')
    setObModalCompany(lead.company_name||'')
    setObModalReadOnly(readOnly)
    setObModalNotes(lead.notes||'')
    setObModalNoteInput('')
    const existingObs=getLeadObligations(lead.id)||[]
    const isNew=!readOnly&&lead.status==='New'&&existingObs.length===0
    setObIsNewLead(isNew)
    setIsObEditing(isNew)
    setObSavedSnapshot({salary:lead.monthly_salary||'',company:lead.company_name||'',notes:lead.notes||''})
    setLeadReassignInfo(null)
    if(!readOnly&&userId){
      const{data:rl}=await supabase.from('activity_log').select('*').eq('lead_id',lead.id).eq('action','Reassigned').eq('assigned_to',userId).order('created_at',{ascending:false}).limit(1)
      setLeadReassignInfo(rl&&rl.length>0?rl[0]:null)
    }
  }

  const buildEmptyObligation=()=>({
    id:'tmp-'+Date.now(),
    obligation_type:'Personal Loan',
    bank_name:'',
    emi_amount:'',
    outstanding_amount:'',
    pos_amount:'',
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
    balance_transfer:false,
    credit_limit:'',
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

  const getMaxFoir=(salary)=>{
    if(!salary||salary<=0) return 50
    if(salary>=100001) return 75
    if(salary>=75001)  return 70
    if(salary>=60001)  return 65
    if(salary>=50000)  return 60
    return 50
  }

  const calculateObligatedEMI=(ob)=>{
    const emi=parseFloat(ob.emi_amount)||0
    const remaining=parseInt(ob.remaining_tenure)||999
    const loanType=ob.obligation_type
    const creditLimit=parseFloat(ob.sanctioned_amount)||0
    const isBT=ob.balance_transfer===true||ob.balance_transfer==='true'||ob.balance_transfer==='Yes'||ob.balance_transfer==='yes'
    if(isBT)return 0
    const relaxationLoans=['Personal Loan','Housing Loan','Car Loan','Bike Loan','Consumer Durable Loan']
    if(relaxationLoans.includes(loanType)&&remaining<=3)return 0
    const posOrOutstanding=parseFloat(ob.pos_amount)||parseFloat(ob.outstanding_amount)||0
    switch(loanType){
      case 'Personal Loan':
        return emi
      case 'Credit Card':
        return posOrOutstanding*0.05
      case 'Housing Loan':{
        if(ob.joint_type==='Joint'){
          const p=ob.joint_holder_name||''
          if(p==='Co-applicant')return 0
          if(p==='Both')return emi*0.5
          return emi
        }
        return emi
      }
      case 'Education Loan':{
        const p=ob.joint_holder_name||'Self'
        if(p==='Co-applicant')return emi*0.5
        return emi
      }
      case 'Car Loan':{
        if(ob.joint_type==='Joint'){
          const p=ob.joint_holder_name||''
          if(p==='Co-applicant')return 0
          if(p==='Both')return emi*0.5
          return emi
        }
        return emi
      }
      case 'Bike Loan': case 'Consumer Durable Loan': return emi
      case 'Gold Loan': return (posOrOutstanding||creditLimit)*0.01
      default: return emi
    }
  }

  const getObligatedReason=(ob)=>{
    const emi=parseFloat(ob.emi_amount)||0
    const obligated=calculateObligatedEMI(ob)
    if(obligated===emi)return null
    const remaining=parseInt(ob.remaining_tenure)||999
    const relaxationLoans=['Personal Loan','Housing Loan','Car Loan','Bike Loan','Consumer Durable Loan']
    if(relaxationLoans.includes(ob.obligation_type)&&remaining<=3)return '< 3 EMIs left'
    const isBT=ob.balance_transfer===true||ob.balance_transfer==='true'||ob.balance_transfer==='Yes'||ob.balance_transfer==='yes'
    if(isBT&&obligated===0)return 'BT Applied — Not Obligated'
    if(ob.obligation_type==='Credit Card'){
      const out=parseFloat(ob.outstanding_amount)||0
      if(out>0)return `5% of ₹${out.toLocaleString('en-IN')} outstanding = ₹${Math.round(out*0.05).toLocaleString('en-IN')} obligated`
      return null
    }
    if(obligated===0)return '100% — Co-applicant'
    if(obligated===emi*0.5)return '50% — Joint / Both'
    return null
  }

  const calculateObligationTotals=(items)=>{
    const totalEMI=items.reduce((sum,o)=>sum+Number(o.emi_amount||0),0)
    const totalObligatedEMI=items.reduce((sum,o)=>sum+calculateObligatedEMI(o),0)
    const totalOutstanding=items.reduce((sum,o)=>sum+Number(o.outstanding_amount||0),0)
    const totalSanctioned=items.reduce((sum,o)=>sum+Number(o.sanctioned_amount||0),0)
    const salary=parseFloat(obModalNetTakeHome)||parseFloat(obModalSalary)||0
    const currentFoir=salary?Math.round((totalObligatedEMI/salary)*100):0
    const maxFoir=getMaxFoir(salary)
    const isEligible=!salary||currentFoir<=maxFoir
    const maxEMI=salary*(maxFoir/100)
    const availableEMI=salary?Math.max(0,maxEMI-totalObligatedEMI):0
    const eligibleLoan=availableEMI?Math.round((availableEMI/2200)*100000):0
    return {totalEMI,totalObligatedEMI,totalOutstanding,totalSanctioned,currentFoir,maxFoir,isEligible,availableEMI,eligibleLoan}
  }

  const saveObligationCard=async(obligation)=>{
    if(!selectedLeadForObligations)return
    const leadId=selectedLeadForObligations.id
    console.log('[saveObligationCard] lead:', leadId, '| obligation id:', obligation.id)
    if(!leadId){
      setObligationError('Lead ID is missing. Please close and reopen the modal.')
      return
    }
    setSavingObligation(true)
    setObligationError('')
    const n=v=>(v===''||v==null)?null:parseFloat(v)||0
    const payload={
      lead_id:leadId,
      obligation_type:obligation.obligation_type,
      bank_name:obligation.bank_name||null,
      emi_amount:n(obligation.emi_amount),
      outstanding_amount:n(obligation.outstanding_amount),
      pos_amount:n(obligation.pos_amount),
      sanctioned_amount:n(obligation.sanctioned_amount),
      tenure_months:n(obligation.tenure_months),
      remaining_tenure:n(obligation.remaining_tenure),
      emis_paid:n(obligation.emis_paid),
      bounce:obligation.bounce,
      overdue_amount:n(obligation.overdue_amount),
      dpd:obligation.dpd||null,
      address_proof:obligation.address_proof,
      joint_type:obligation.joint_type,
      joint_holder_name:obligation.joint_holder_name||null,
      joint_holder_income:n(obligation.joint_holder_income),
      joint_holder_relation:obligation.joint_holder_relation||null,
      balance_transfer:obligation.balance_transfer||false,
      obligated_emi:n(obligation.emi_amount),
      last_updated_by:userId,
      last_updated_at:new Date().toISOString(),
    }
    try{
      if(String(obligation.id).startsWith('tmp-')){
        const {data,error}=await supabase.from('loan_obligations').insert([payload]).select().single()
        if(error) throw error
        if(!data) throw new Error('Insert succeeded but no data returned — check RLS SELECT policy on loan_obligations')
        console.log('[saveObligationCard] inserted:', data.id)
        const updated=[...(getLeadObligations(leadId)||[]),data]
        updateSavedObligations(leadId,updated)
        setObligationDrafts(prev=>prev.map(item=>item.id===obligation.id?{...data,editing:false,expanded:false}:item))
        showToast('Obligation added successfully')
        const _cname=selectedLeadForObligations?.full_name||''
        notifyAdmins({type:'obligation_added',lead_id:leadId,customer_name:_cname,
          amount:payload.required_loan_amount||payload.loan_amount||null,
          message:`📋 ${profile?.full_name||'Agent'} added a requirement for ${_cname}${payload.required_loan_amount?' · ₹'+Number(payload.required_loan_amount).toLocaleString('en-IN'):''}`,
        })
      } else {
        const {data,error}=await supabase.from('loan_obligations').update(payload).eq('id',obligation.id).select().single()
        if(error) throw error
        if(!data) throw new Error('Update succeeded but no data returned — check RLS SELECT policy on loan_obligations')
        console.log('[saveObligationCard] updated:', data.id)
        const updated=(getLeadObligations(leadId)||[]).map(item=>item.id===data.id?data:item)
        updateSavedObligations(leadId,updated)
        setObligationDrafts(prev=>prev.map(item=>item.id===data.id?{...data,editing:false}:item))
        showToast('Obligation updated successfully')
      }
      // Persist salary, net take home, company, and notes back to the lead record
      const salaryVal=obModalSalary===''?null:parseFloat(obModalSalary)||null
      const netTakeHomeVal=obModalNetTakeHome===''?null:parseFloat(obModalNetTakeHome)||null
      await supabase.from('leads').update({
        monthly_salary:salaryVal,
        net_take_home:netTakeHomeVal,
        company_name:obModalCompany||null,
        notes:obModalNotes||null,
      }).eq('id',leadId)
      setMyLeads(prev=>prev.map(l=>l.id===leadId?{...l,monthly_salary:salaryVal,net_take_home:netTakeHomeVal,company_name:obModalCompany||null,notes:obModalNotes||null}:l))
    }catch(err){
      console.error('[saveObligationCard] error:', err)
      setObligationError('Unable to save obligation: '+err.message)
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
    // Log WA activity to lead notes so all devices see it via RT
    const now=new Date()
    const agentName=profile?.full_name||'Agent'
    const stamp=`[${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')} - ${agentName}]`
    const entry=`${stamp}: WhatsApp sent — "${tpl.name}" template`
    const updated=(waLead.notes||'')?(waLead.notes+'\n'+entry):entry
    supabase.from('leads').update({notes:updated}).eq('id',waLead.id)
    setMyLeads(prev=>prev.map(l=>l.id===waLead.id?{...l,notes:updated}:l))
    setShowWAModal(false)
    showToast('WhatsApp opened for '+waLead.full_name)
  }

  // Quick one-click WA send (no modal) — logs note and opens WA directly
  const sendWAQuick=(tpl,lead)=>{
    const name=lead.full_name?.split(' ')[0]||'Customer'
    const amount=Number(lead.loan_amount||0).toLocaleString('en-IN')
    const emi=Math.round((Number(lead.loan_amount||0)*0.012*Math.pow(1.012,36))/(Math.pow(1.012,36)-1)).toLocaleString('en-IN')
    const msg=tpl.message.replace(/{name}/g,name).replace(/{amount}/g,amount).replace(/{emi}/g,emi)
    window.open(`https://wa.me/91${lead.mobile}?text=${encodeURIComponent(msg)}`,'_blank')
    const now=new Date()
    const agentName=profile?.full_name||'Agent'
    const stamp=`[${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')} - ${agentName}]`
    const entry=`${stamp}: WhatsApp sent — "${tpl.name}" template`
    const updated=(lead.notes||'')?(lead.notes+'\n'+entry):entry
    supabase.from('leads').update({notes:updated}).eq('id',lead.id)
    setMyLeads(prev=>prev.map(l=>l.id===lead.id?{...l,notes:updated}:l))
    setShowWAQuick(null)
    showToast('WhatsApp sent to '+lead.full_name)
  }

  useEffect(()=>{
    if(!callLogLead?.id) return
    const fetchPreviousOutcomes=async()=>{
      const{data}=await supabase
        .from('calls')
        .select('call_outcome, created_at')
        .eq('lead_id', callLogLead.id)
        .order('created_at',{ascending:false})
        .limit(5)
      setPreviousOutcomes(data||[])
    }
    fetchPreviousOutcomes()
  },[callLogLead?.id])

  const handleCall=(lead)=>{
    window.location.href=`tel:${lead.mobile}`
    setCallLogLead(lead)
    setCallLogDisposition('')
    setCallLogStage(lead?.status||'New')
    setCallLogNotes('')
    setCallLogCallbackDate(istToday())
    setCallLogCallbackTime('10:00')
    setShowCallLogModal(true)
  }

  const openCallingWorkspace=(lead)=>{ handleCall(lead) }

  const saveCallLog=async()=>{
    if(!callLogLead) return
    setSavingCallLog(true)

    try{
      // Build leads update object with both fields at once - single DB call not two
      const leadsUpdate={}
      if(callLogDisposition) leadsUpdate.disposition=callLogDisposition
      if(callLogStage) leadsUpdate.status=callLogStage

      // Run calls insert and leads update in parallel - both fire at same time
      await Promise.all([
        supabase.from('calls').insert({
          lead_id: callLogLead.id,
          agent_id: userId,
          call_outcome: callLogDisposition||null,
          notes: callLogNotes||null,
          created_at: new Date().toISOString()
        }),
        Object.keys(leadsUpdate).length>0
          ? supabase.from('leads').update(leadsUpdate).eq('id',callLogLead.id)
          : Promise.resolve()
      ])

      // Update local state immediately without waiting for fetchAll
      if(Object.keys(leadsUpdate).length>0){
        setMyLeads(prev=>prev.map(l=>l.id===callLogLead.id?{...l,...leadsUpdate}:l))
      }

      // Add to local calls state immediately
      setMyCalls(prev=>[{
        id: Date.now().toString(),
        lead_id: callLogLead.id,
        agent_id: userId,
        call_outcome: callLogDisposition||null,
        notes: callLogNotes||null,
        created_at: new Date().toISOString()
      },...prev])

      // Handle callback task creation if needed
      if(callLogDisposition==='Callback'&&callLogCallbackDate&&callLogCallbackTime){
        await supabase.from('tasks').insert([{
          lead_id:callLogLead.id,
          assigned_to:userId,
          title:'Callback: '+callLogLead.full_name,
          due_date:safeDueDate(callLogCallbackDate,callLogCallbackTime),
          status:'Pending',
          priority:'High'
        }])
        fetchCallbackTasks()
      }

      // Show success immediately, don't wait for background refresh
      showToast('Call logged successfully')

      // Close modal and reset fields immediately
      setShowCallLogModal(false)
      setCallLogDisposition('')
      setCallLogNotes('')

      // Refresh in background after modal is already closed
      setTimeout(()=>fetchAll(),500)
    }catch(err){
      showToast('Error saving call log: '+err.message,'error')
    }finally{
      setSavingCallLog(false)
    }
  }

  const handleNextLead=()=>{
    const nextIdx=queueIndex+1
    if(nextIdx<leadQueue.length){
      setQueueIndex(nextIdx)
      setCallingLead(leadQueue[nextIdx])
    } else {
      setQueueComplete(true)
    }
  }

  const startPowerDialer=async()=>{
    const baseLeads=filteredLeads.length>0?[...filteredLeads]:[...myLeads]
    let extraLeads=[]
    try{
      // Also pull any campaign leads this agent is assigned to but not in current pool
      const{data:agentCampaigns}=await supabase
        .from('campaign_agents').select('campaign_id').eq('agent_id',userId)
      if(agentCampaigns?.length>0){
        const cIds=agentCampaigns.map(c=>c.campaign_id)
        const existingIds=new Set(baseLeads.map(l=>l.id))
        const{data:campLeads}=await supabase
          .from('leads').select('*').in('campaign_id',cIds)
        if(campLeads) extraLeads=campLeads.filter(l=>!existingIds.has(l.id))
      }
    }catch(e){}
    const queue=[...baseLeads,...extraLeads]
    if(!queue.length){ showToast('No leads to dial','error'); return }
    setLeadQueue(queue)
    setQueueIndex(0)
    setCallingLead(queue[0])
    setQueueComplete(false)
    setShowWorkspace(true)
  }

  const getExportLeads=()=>{
    let leads=[...myLeads]
    if(exportStatus) leads=leads.filter(l=>l.status===exportStatus)
    const inR=(ts,from,to)=>!!ts&&new Date(ts)>=from&&(!to||new Date(ts)<=to)
    const matchDate=(l,from,to)=>inR(l.created_at,from,to)||inR(l.assigned_at,from,to)
    if(exportDateType==='today'){const t=new Date();t.setHours(0,0,0,0);leads=leads.filter(l=>matchDate(l,t,null))}
    else if(exportDateType==='week'){const w=new Date();w.setDate(w.getDate()-7);leads=leads.filter(l=>matchDate(l,w,null))}
    else if(exportDateType==='month'){const m=new Date();m.setDate(1);m.setHours(0,0,0,0);leads=leads.filter(l=>matchDate(l,m,null))}
    else if(exportDateType==='custom'&&exportStartDate&&exportEndDate){
      const s=new Date(exportStartDate),e=new Date(exportEndDate);e.setHours(23,59,59,999)
      leads=leads.filter(l=>matchDate(l,s,e))
    }
    return leads
  }

  const handleExport=()=>{
    const leads=getExportLeads()
    if(!leads.length){showToast('No leads found!','error');return}
    const headers=['Name','Mobile','Email','City','Loan Amount','Monthly Salary','Company','Status','Temperature','Notes','Date']
    const rows=leads.map(l=>[l.full_name||'',l.mobile||'',l.email||'',l.city||'',l.loan_amount||'',l.monthly_salary||'',l.company_name||'',l.status||'',l.lead_temperature||'',(l.notes||'').replace(/\n/g,' '),new Date(l.created_at).toLocaleDateString('en-IN',{timeZone:IST_TZ})])
    exportToExcel(`leads_${exportStatus||'all'}_${exportDateType}`,[headers,...rows],'Leads')
    setShowExportModal(false)
    showToast('Report downloaded!')
  }

  // Thin display-formatting aliases over the canonical timeUtils.formatIST —
  // kept under their original names so the many render call sites below
  // don't all need touching, but the actual date logic now lives in exactly
  // one place (src/utils/timeUtils.js).
  const fmtISTDate=(v)=>formatIST(v,'date')
  const fmtISTTime=(v)=>formatIST(v,'time')
  const fmtIST=(v)=>formatIST(v,'datetime')
  const isISTToday=(v)=>parseIST(v)?.slice(0,10)===istToday()

  // Dynamic stage helpers — fall back to module-level constants when table not yet loaded
  const stageNames=leadStages.length>0?leadStages.map(s=>s.name):STATUS_OPTIONS
  const stageStyle=name=>{const s=leadStages.find(st=>st.name===name);if(s?.color)return{bg:s.color+'22',color:s.color};return STATUS_STYLE[name]||{bg:'#F3F4F6',color:'#6B7280'}}

  const pendingTasks  =myTasks.filter(t=>t.status!=='Completed')
  const overdueTasks  =myTasks.filter(t=>t.status!=='Completed'&&compareIST(t.due_date,nowIST())<0)
  const exportCount   =getExportLeads().length
  const filteredLeads =myLeads.filter(l=>{
    const ms=!search||l.full_name?.toLowerCase().includes(search.toLowerCase())||l.mobile?.includes(search)||l.city?.toLowerCase().includes(search.toLowerCase())
    const mf=agentStatusSet.length===0||agentStatusSet.includes(l.status)
    const fd=agentDateFrom?new Date(agentDateFrom):null
    const td=agentDateTo?new Date(agentDateTo+'T23:59:59'):null
    const inDateRange=(ts)=>{ const d=ts?new Date(ts):null; return(!fd||(d&&d>=fd))&&(!td||(d&&d<=td)) }
    const md=(!fd&&!td)||inDateRange(l.created_at)||inDateRange(l.assigned_at)
    const mCity=!filterCity||l.city===filterCity
    const mLoan=(()=>{
      if(!filterLoanAmount)return true
      const [min,max]=filterLoanAmount.split('-').map(Number)
      const amt=Number(l.loan_amount)||0
      return amt>=min&&amt<=max
    })()
    return ms&&mf&&md&&mCity&&mLoan
  })
  const obligationTotals = calculateObligationTotals(obligationDrafts)

  const isBTFlag=ob=>ob.balance_transfer===true||ob.balance_transfer==='true'||ob.balance_transfer==='Yes'||ob.balance_transfer==='yes'
  const btPosTotal = obligationDrafts
    .filter(isBTFlag)
    .reduce((sum, ob) => sum + (Number(ob.pos_amount) || Number(ob.outstanding_amount) || 0), 0)
  const btPersonalLoanCount = obligationDrafts.filter(ob => isBTFlag(ob) && ob.obligation_type === 'Personal Loan').length
  const btCreditCardCount = obligationDrafts.filter(ob => isBTFlag(ob) && ob.obligation_type === 'Credit Card').length
  const amountInHandAfterBT = Math.max(0, (obligationTotals.eligibleLoan||0) - btPosTotal)

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
          @keyframes cb-bell-pulse {
            0%,100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255,255,255,0.4); }
            50% { transform: scale(1.12); box-shadow: 0 0 0 8px rgba(255,255,255,0); }
          }
          .cb-bell-icon { animation: cb-bell-pulse 1.4s ease-in-out infinite; }
        `}
      </style>

      {/* CALLING WORKSPACE */}
      {showWorkspace&&(leadQueue[queueIndex]||callingLead)&&!queueComplete&&(
        <CallingWorkspace
          key={(leadQueue[queueIndex]||callingLead)?.id}
          lead={leadQueue[queueIndex]||callingLead}
          userId={userId}
          queuePosition={queueIndex+1}
          totalInQueue={leadQueue.length}
          onClose={()=>{ setShowWorkspace(false); setQueueComplete(false); fetchAll() }}
          onSave={(result)=>{
            // CallingWorkspace calls onSave twice:
            // 1st call: {lead: {...}, call: {...}}
            // 2nd call: updateData directly (no wrapper)
            // We need to handle both shapes.
            const currentLeadId = (leadQueue[queueIndex]||callingLead)?.id

            // Shape 1: {lead: {...}, call: {...}}
            if(result?.lead && typeof result.lead === 'object'){
              const leadUpdate = result.lead
              setLeadQueue(prev=>prev.map(l=>l.id===currentLeadId?{...l,...leadUpdate}:l))
              setMyLeads(prev=>prev.map(l=>l.id===currentLeadId?{...l,...leadUpdate}:l))
            }
            // Shape 2: plain updateData object (has 'status' or 'notes' directly)
            else if(result && !result.lead && !result.call && typeof result === 'object'){
              const leadUpdate = result
              setLeadQueue(prev=>prev.map(l=>l.id===currentLeadId?{...l,...leadUpdate}:l))
              setMyLeads(prev=>prev.map(l=>l.id===currentLeadId?{...l,...leadUpdate}:l))
            }
            if(result?.call){
              setMyCalls(prev=>{
                const exists=prev.some(c=>c.id===result.call.id)
                if(exists) return prev.map(c=>c.id===result.call.id?result.call:c)
                return [result.call,...prev]
              })
            }
          }}
          onNext={handleNextLead}
        />
      )}

      {/* POWER DIALER — QUEUE COMPLETE */}
      {showWorkspace&&queueComplete&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div style={{background:'white',borderRadius:20,padding:'40px 48px',maxWidth:480,width:'100%',textAlign:'center',boxShadow:'0 24px 80px rgba(0,0,0,0.3)'}}>
            <div style={{fontSize:56,marginBottom:12}}>🎉</div>
            <div style={{fontSize:22,fontWeight:800,color:'#111827',marginBottom:8}}>Queue Completed!</div>
            <div style={{fontSize:14,color:'#6B7280',marginBottom:6}}>
              You've dialled all <strong>{leadQueue.length}</strong> lead{leadQueue.length!==1?'s':''} in this session.
            </div>
            <div style={{display:'flex',gap:10,justifyContent:'center',marginTop:28}}>
              <button onClick={()=>{ setShowWorkspace(false); setQueueComplete(false) }}
                style={{padding:'12px 24px',background:'#185FA5',color:'white',border:'none',borderRadius:10,fontSize:14,fontWeight:700,cursor:'pointer'}}>
                Return to Dashboard
              </button>
              <button onClick={()=>startPowerDialer()}
                style={{padding:'12px 24px',background:'#F3F4F6',color:'#374151',border:'none',borderRadius:10,fontSize:14,fontWeight:700,cursor:'pointer'}}>
                Restart Queue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast&&(
        <div style={{position:'fixed',bottom:16,right:16,left:isMobile?16:'auto',zIndex:9999,background:toast.type==='error'?'#FCEBEB':'#EAF3DE',border:'1px solid '+(toast.type==='error'?'#FCA5A5':'#86EFAC'),borderRadius:10,padding:'11px 16px',fontSize:13,fontWeight:500,color:toast.type==='error'?'#791F1F':'#166534',display:'flex',alignItems:'center',gap:8,boxShadow:'0 4px 20px rgba(0,0,0,0.1)'}}>
          <IconCircleCheck size={15}/>{toast.msg}
        </div>
      )}

      {/* WA QUICK SEND POPUP — desktop: fixed near button, mobile: fixed bottom sheet */}
      {showWAQuick&&(
        <>
          {isMobile?(
            <>
              <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:490}} onClick={()=>setShowWAQuick(null)}/>
              <div style={{position:'fixed',bottom:0,left:0,right:0,background:'white',borderRadius:'16px 16px 0 0',padding:'16px 12px 32px',zIndex:491,boxShadow:'0 -4px 30px rgba(0,0,0,0.18)',maxHeight:'60vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12,paddingBottom:10,borderBottom:'1px solid #f3f4f6'}}>
                  <div style={{fontWeight:700,fontSize:15,color:'#111827'}}>Send WhatsApp</div>
                  <button onClick={()=>setShowWAQuick(null)} style={{background:'#f3f4f6',border:'none',width:30,height:30,borderRadius:'50%',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:'#6B7280'}}><IconX size={14}/></button>
                </div>
                {waTemplates.map(tpl=>(
                  <button key={tpl.id} onClick={()=>{ const lead=myLeads.find(l=>l.id===showWAQuick); if(lead) sendWAQuick(tpl,lead) }}
                    style={{display:'flex',alignItems:'center',gap:12,width:'100%',padding:'13px 14px',border:'none',background:'transparent',borderRadius:10,cursor:'pointer',textAlign:'left',marginBottom:4}}
                    onMouseEnter={e=>e.currentTarget.style.background='#f3f4f6'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <span style={{fontSize:22,flexShrink:0}}>{tpl.icon}</span>
                    <div>
                      <div style={{fontSize:14,fontWeight:600,color:'#111827'}}>{tpl.name}</div>
                      <div style={{fontSize:11,color:'#9CA3AF',marginTop:1}}>{tpl.tag}</div>
                    </div>
                  </button>
                ))}
                <button onClick={()=>{ const lead=myLeads.find(l=>l.id===showWAQuick); if(lead){setShowWAQuick(null);setWaLead(lead);setShowWAModal(true)} }}
                  style={{display:'flex',alignItems:'center',gap:8,width:'100%',padding:'12px 14px',border:'none',background:'#F9FAFB',borderRadius:10,cursor:'pointer',fontSize:14,color:'#6B7280',marginTop:6}}>
                  ✏️ Custom message
                </button>
              </div>
            </>
          ):(
            <div style={{position:'fixed',top:waQuickPos.top,left:waQuickPos.left,background:'white',border:'1px solid #e5e7eb',borderRadius:12,padding:8,zIndex:491,boxShadow:'0 6px 24px rgba(0,0,0,0.14)',display:'flex',flexDirection:'column',gap:2,minWidth:210}} onClick={e=>e.stopPropagation()}>
              {waTemplates.map(tpl=>(
                <button key={tpl.id} onClick={()=>{ const lead=myLeads.find(l=>l.id===showWAQuick); if(lead) sendWAQuick(tpl,lead) }}
                  style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',border:'none',background:'transparent',borderRadius:8,cursor:'pointer',textAlign:'left',fontSize:13,color:'#111827',width:'100%'}}
                  onMouseEnter={e=>e.currentTarget.style.background='#f3f4f6'}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  <span style={{fontSize:16}}>{tpl.icon}</span>
                  <span style={{fontWeight:500}}>{tpl.name}</span>
                </button>
              ))}
              <button onClick={()=>{ const lead=myLeads.find(l=>l.id===showWAQuick); if(lead){setShowWAQuick(null);setWaLead(lead);setShowWAModal(true)} }}
                style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',border:'none',background:'transparent',borderRadius:8,cursor:'pointer',fontSize:12,color:'#6B7280',borderTop:'1px solid #f3f4f6',marginTop:2,width:'100%'}}>
                ✏️ Custom message
              </button>
            </div>
          )}
        </>
      )}

      {/* GENERAL TASK REMINDER POPUP (5-min window, non-callback tasks only) */}
      {reminderPopup&&!showCallbackReminder&&(
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
                <div style={{fontSize:12,color:'#975A16'}}>Due: {fmtISTDate(reminderPopup.due_date)} {fmtISTTime(reminderPopup.due_date)}</div>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>setReminderPopup(null)} style={{flex:1,padding:10,background:'#185FA5',color:'white',border:'none',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer'}}>✅ Got it!</button>
                <button onClick={()=>setReminderPopup(null)} style={{padding:'10px 14px',background:'transparent',border:'1px solid #E2E8F0',borderRadius:8,fontSize:13,cursor:'pointer',color:'#6B7280'}}>Dismiss</button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* CALLBACK REMINDER POPUP */}
      {showCallbackReminder&&callbackTasks.length>0&&(
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.65)',zIndex:490}} onClick={()=>{ setShowCallbackReminder(false); alreadyBuzzingRef.current=false }}/>
          <div style={{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',background:'white',borderRadius:18,boxShadow:'0 32px 80px rgba(0,0,0,0.35)',zIndex:491,width:'92%',maxWidth:480,maxHeight:'88vh',display:'flex',flexDirection:'column',overflow:'hidden'}}>

            {/* HEADER */}
            <div style={{background:'linear-gradient(135deg,#9B2C2C,#C05621)',padding:'16px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
              <div style={{display:'flex',alignItems:'center',gap:12,color:'white'}}>
                <div className="cb-bell-icon" style={{width:42,height:42,borderRadius:'50%',background:'rgba(255,255,255,0.18)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>
                  🔔
                </div>
                <div>
                  <div style={{fontWeight:800,fontSize:16,letterSpacing:'-0.2px'}}>Callback Reminder!</div>
                  <div style={{fontSize:12,opacity:0.82,marginTop:1}}>
                    {callbackTasks.length} callback{callbackTasks.length>1?'s':''} require your attention
                  </div>
                </div>
              </div>
              <button onClick={()=>{ setShowCallbackReminder(false); alreadyBuzzingRef.current=false }}
                style={{background:'rgba(255,255,255,0.18)',border:'none',color:'white',width:30,height:30,borderRadius:'50%',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                <IconX size={14}/>
              </button>
            </div>

            {/* SCROLLABLE TASK LIST */}
            <div style={{overflowY:'auto',flex:1,padding:'14px 16px'}}>
              {callbackTasks.map(task=>{
                const now=nowIST()
                const taskOverdue=isOverdue(task)
                const isUpcoming=task.due_date&&compareIST(task.due_date,now)>0
                const leadName=task.title.replace('Callback: ','')
                const lead=myLeads.find(l=>l.id===task.lead_id)
                const isRescheduling=rescheduleTaskId===task.id
                const isToday=isISTToday(task.due_date)
                return(
                  <div key={task.id} style={{border:'1px solid '+(taskOverdue?'#FED7D7':'#FDE68A'),borderLeft:'4px solid '+(taskOverdue?'#DC2626':'#F59E0B'),borderRadius:12,padding:14,marginBottom:12,background:taskOverdue?'#FFF5F5':'#FFFBF0'}}>

                    {/* Task header with status badge */}
                    <div style={{marginBottom:6,display:'flex',alignItems:'flex-start',gap:6,flexWrap:'wrap'}}>
                      {taskOverdue&&(
                        <span style={{background:'#DC2626',color:'white',fontSize:10,fontWeight:800,padding:'2px 8px',borderRadius:20,letterSpacing:'0.04em',flexShrink:0}}>
                          ⚠️ OVERDUE
                        </span>
                      )}
                      {isUpcoming&&(
                        <span style={{background:'#F59E0B',color:'white',fontSize:10,fontWeight:800,padding:'2px 8px',borderRadius:20,letterSpacing:'0.04em',flexShrink:0}}>
                          🔔 UPCOMING
                        </span>
                      )}
                      <div style={{fontWeight:700,fontSize:15,color:taskOverdue?'#991B1B':'#92400E',width:'100%',marginTop:4}}>
                        📞 {leadName}
                      </div>
                    </div>

                    <div style={{fontSize:12,color:taskOverdue?'#B91C1C':'#B45309',marginBottom:task.notes?4:8}}>
                      🕐 Scheduled: {isToday?'Today ':''}{fmtISTDate(task.due_date)}{' '}{fmtISTTime(task.due_date)}
                    </div>
                    {task.notes&&(
                      <div style={{fontSize:12,color:'#6B7280',marginBottom:8,lineHeight:1.4}}>
                        📝 Notes: {task.notes}
                      </div>
                    )}

                    {/* Inline reschedule picker */}
                    {isRescheduling&&(
                      <div style={{background:'#EFF6FF',border:'1px solid #93C5FD',borderRadius:8,padding:'10px 12px',marginBottom:10}}>
                        <div style={{fontSize:11,fontWeight:700,color:'#1e40af',marginBottom:8,textTransform:'uppercase',letterSpacing:'0.04em'}}>Pick new date & time</div>
                        <div style={{display:'flex',gap:8,marginBottom:8}}>
                          <input type="date" min={istToday()} value={rescheduleDate}
                            onChange={e=>setRescheduleDate(e.target.value)}
                            style={{flex:1,padding:'7px 8px',border:'1.5px solid #93C5FD',borderRadius:6,fontSize:12,outline:'none'}}/>
                          <input type="time" value={rescheduleTime} onChange={e=>setRescheduleTime(e.target.value)}
                            style={{flex:1,padding:'7px 8px',border:'1.5px solid #93C5FD',borderRadius:6,fontSize:12,outline:'none'}}/>
                        </div>
                        <div style={{display:'flex',gap:6}}>
                          <button onClick={()=>{ rescheduleCallback(task.id); alreadyBuzzingRef.current=false }} disabled={!rescheduleDate}
                            style={{flex:1,padding:'7px',background:rescheduleDate?'#185FA5':'#CBD5E0',color:'white',border:'none',borderRadius:6,fontSize:12,fontWeight:600,cursor:rescheduleDate?'pointer':'not-allowed'}}>
                            Confirm
                          </button>
                          <button onClick={()=>setRescheduleTaskId(null)}
                            style={{padding:'7px 12px',background:'transparent',border:'1px solid #E2E8F0',borderRadius:6,fontSize:12,cursor:'pointer',color:'#6B7280'}}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div style={{display:'flex',gap:7}}>
                      <button onClick={()=>{ if(lead){ setShowCallbackReminder(false); alreadyBuzzingRef.current=false; handleCall(lead) } }}
                        style={{flex:1,padding:'9px 6px',background:'#10B981',color:'white',border:'none',borderRadius:8,fontSize:12,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:5}}>
                        <IconPhone size={13}/>Call Now
                      </button>
                      <button onClick={()=>{ setRescheduleTaskId(task.id);setRescheduleDate(istToday());setRescheduleTime('10:00') }}
                        style={{flex:1,padding:'9px 6px',background:'#185FA5',color:'white',border:'none',borderRadius:8,fontSize:12,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:5}}>
                        <IconClockHour4 size={13}/>Reschedule
                      </button>
                      <button onClick={()=>{ markCallbackAttempted(task.id); alreadyBuzzingRef.current=false }}
                        style={{padding:'9px 10px',background:'#FEF3C7',color:'#92400E',border:'1px solid #FDE68A',borderRadius:8,fontSize:12,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:4}}>
                        <IconPhone size={13}/>Attempted
                      </button>
                      <button onClick={()=>{ markCallbackDone(task.id); alreadyBuzzingRef.current=false }}
                        style={{padding:'9px 10px',background:'#F3F4F6',color:'#374151',border:'1px solid #E2E8F0',borderRadius:8,fontSize:12,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:4}}>
                        <IconCircleCheck size={13}/>Done
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* FOOTER */}
            <div style={{padding:'12px 16px',borderTop:'1px solid #F3F4F6',background:'#FAFAFA',flexShrink:0}}>
              <button onClick={()=>{ setShowCallbackReminder(false); alreadyBuzzingRef.current=false }}
                style={{width:'100%',padding:'10px',background:'transparent',border:'1.5px solid #E2E8F0',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer',color:'#6B7280',marginBottom:6}}>
                Dismiss All
              </button>
              <div style={{textAlign:'center',fontSize:11,color:'#9CA3AF'}}>Reminders will buzz again every 5 minutes until actioned</div>
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
              {callbackTasks.length>0&&(
                <>
                  <div style={{fontSize:11,fontWeight:700,color:'#92400E',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:6}}>📞 Callbacks Due Today</div>
                  {callbackTasks.map(task=>(
                    <div key={'cb-'+task.id} style={{background:'#FFF7ED',border:'1px solid #FDE68A',borderRadius:8,padding:10,marginBottom:8,borderLeft:'3px solid #F59E0B'}}>
                      <div style={{fontWeight:600,fontSize:12,color:'#92400E',marginBottom:2}}>{task.title.replace('Callback: ','')}</div>
                      <div style={{fontSize:11,color:'#B45309'}}>🕐 {fmtISTDate(task.due_date)} {fmtISTTime(task.due_date)}</div>
                      {task.notes&&<div style={{fontSize:11,color:'#B45309',marginTop:2}}>{task.notes}</div>}
                      <button onClick={()=>{const lead=myLeads.find(l=>l.id===task.lead_id);if(lead){openCallingWorkspace(lead);setShowNotifPanel(false)}}}
                        style={{marginTop:6,background:'#92400E',color:'white',border:'none',padding:'4px 10px',borderRadius:5,cursor:'pointer',fontSize:11,fontWeight:600}}>Call Now</button>
                    </div>
                  ))}
                  {notifications.length>0&&<div style={{fontSize:11,fontWeight:700,color:'#6B7280',textTransform:'uppercase',letterSpacing:'0.5px',margin:'10px 0 6px'}}>Other Reminders</div>}
                </>
              )}
              {(notifications.length===0&&callbackTasks.length===0)
                ?<div style={{textAlign:'center',padding:'40px 20px',color:'#A0AEC0'}}>
                    <IconBell size={32} strokeWidth={1.2} color="#CBD5E0" style={{display:'block',margin:'0 auto 10px'}}/>
                    <div style={{fontSize:13}}>No pending reminders 🎉</div>
                  </div>
                :notifications.map(task=>{
                    const od=compareIST(task.due_date,nowIST())<0
                    return(
                      <div key={task.id} style={{background:od?'#FFF5F5':'#FFFAF0',border:'1px solid '+(od?'#FED7D7':'#F6E05E'),borderRadius:8,padding:12,marginBottom:8,borderLeft:'3px solid '+(od?'#A32D2D':'#854F0B')}}>
                        <div style={{fontWeight:600,fontSize:12,color:od?'#A32D2D':'#744210',marginBottom:3}}>{od&&'⚠️ '}{task.title}</div>
                        <div style={{fontSize:11,color:od?'#A32D2D':'#975A16'}}>🕐 {fmtISTDate(task.due_date)} {fmtISTTime(task.due_date)}</div>
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
        <ErrorBoundary>
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
        </ErrorBoundary>
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

      {/* CALLBACK SCHEDULE MODAL */}
      {showCallbackModal&&callbackLead&&(
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:300}} onClick={()=>setShowCallbackModal(false)}/>
          <div style={{position:'fixed',top:isMobile?'auto':'50%',bottom:isMobile?0:'auto',left:isMobile?0:'50%',transform:isMobile?'none':'translate(-50%,-50%)',background:'white',borderRadius:isMobile?'16px 16px 0 0':16,boxShadow:'0 24px 60px rgba(0,0,0,0.2)',zIndex:400,width:isMobile?'100%':'90%',maxWidth:420,overflow:'hidden'}}>
            <div style={{background:'linear-gradient(135deg,#185FA5,#1e40af)',padding:'14px 18px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div style={{display:'flex',alignItems:'center',gap:10,color:'white'}}>
                <div style={{width:34,height:34,borderRadius:'50%',background:'rgba(255,255,255,0.15)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <IconClockHour4 size={17}/>
                </div>
                <div>
                  <div style={{fontWeight:700,fontSize:15}}>Schedule Callback</div>
                  <div style={{fontSize:12,opacity:0.8}}>{callbackLead.full_name} · {callbackLead.mobile}</div>
                </div>
              </div>
              <button onClick={()=>setShowCallbackModal(false)} style={{background:'rgba(255,255,255,0.15)',border:'none',color:'white',width:28,height:28,borderRadius:'50%',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><IconX size={13}/></button>
            </div>
            <div style={{padding:'16px 18px'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
                <div>
                  <label style={{display:'block',fontSize:11,fontWeight:600,color:'#6B7280',marginBottom:5,textTransform:'uppercase'}}>Date *</label>
                  <input type="date" min={istToday()} value={callbackDate}
                    onChange={e=>setCallbackDate(e.target.value)}
                    style={{width:'100%',padding:'9px 10px',border:'1.5px solid #E2E8F0',borderRadius:8,fontSize:13,outline:'none',boxSizing:'border-box',color:'#111827'}}
                    onFocus={e=>e.target.style.borderColor='#185FA5'} onBlur={e=>e.target.style.borderColor='#E2E8F0'}/>
                </div>
                <div>
                  <label style={{display:'block',fontSize:11,fontWeight:600,color:'#6B7280',marginBottom:5,textTransform:'uppercase'}}>Time *</label>
                  <input type="time" value={callbackTime} onChange={e=>setCallbackTime(e.target.value)}
                    style={{width:'100%',padding:'9px 10px',border:'1.5px solid #E2E8F0',borderRadius:8,fontSize:13,outline:'none',boxSizing:'border-box',color:'#111827'}}/>
                </div>
              </div>
              <div style={{marginBottom:14}}>
                <label style={{display:'block',fontSize:11,fontWeight:600,color:'#6B7280',marginBottom:5,textTransform:'uppercase'}}>Reason for callback</label>
                <textarea value={callbackNotes} onChange={e=>setCallbackNotes(e.target.value)}
                  placeholder="Reason for callback…"
                  rows={3}
                  style={{width:'100%',padding:'9px 10px',border:'1.5px solid #E2E8F0',borderRadius:8,fontSize:13,outline:'none',resize:'vertical',fontFamily:'inherit',boxSizing:'border-box',color:'#111827'}}
                  onFocus={e=>e.target.style.borderColor='#185FA5'} onBlur={e=>e.target.style.borderColor='#E2E8F0'}/>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={scheduleCallback} disabled={!callbackDate}
                  style={{flex:1,padding:'12px',background:callbackDate?'#185FA5':'#CBD5E0',color:'white',border:'none',borderRadius:8,fontSize:14,fontWeight:600,cursor:callbackDate?'pointer':'not-allowed',display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>
                  <IconClockHour4 size={15}/>Schedule Callback
                </button>
                <button onClick={skipCallback}
                  style={{padding:'12px 16px',background:'transparent',border:'1.5px solid #E2E8F0',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer',color:'#6B7280'}}>
                  Skip
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* CALL LOG POPUP */}
      {showCallLogModal&&callLogLead&&(
        <ErrorBoundary>
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:500}} onClick={()=>setShowCallLogModal(false)}/>
          <div style={{position:'fixed',top:isMobile?'auto':'50%',bottom:isMobile?0:'auto',left:isMobile?0:'50%',transform:isMobile?'none':'translate(-50%,-50%)',background:'white',borderRadius:isMobile?'16px 16px 0 0':16,boxShadow:'0 24px 60px rgba(0,0,0,0.2)',zIndex:501,width:isMobile?'100%':'90%',maxWidth:460,maxHeight:isMobile?'92vh':'90vh',overflow:'hidden',display:'flex',flexDirection:'column'}}>
            {/* Header */}
            <div style={{background:'linear-gradient(135deg,#166534,#16a34a)',padding:'14px 18px',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
              <div style={{display:'flex',alignItems:'center',gap:10,color:'white'}}>
                <div style={{width:36,height:36,borderRadius:'50%',background:'rgba(255,255,255,0.18)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <IconPhone size={18}/>
                </div>
                <div>
                  <div style={{fontWeight:700,fontSize:15}}>Log Call — {callLogLead.full_name}</div>
                  <div style={{fontSize:12,opacity:0.82}}>{callLogLead.mobile}</div>
                </div>
              </div>
              <button onClick={()=>setShowCallLogModal(false)} style={{background:'rgba(255,255,255,0.18)',border:'none',color:'white',width:30,height:30,borderRadius:'50%',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><IconX size={14}/></button>
            </div>
            {/* Body */}
            <div style={{padding:'16px 18px',overflowY:'auto',flex:1}}>
              {/* Disposition */}
              <div style={{marginBottom:12}}>
                <label style={{display:'block',fontSize:11,fontWeight:600,color:'#6B7280',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.04em'}}>Disposition</label>
                <select value={callLogDisposition} onChange={e=>setCallLogDisposition(e.target.value)}
                  style={{width:'100%',padding:'9px 10px',border:'1.5px solid #E2E8F0',borderRadius:8,fontSize:13,background:'white',color:'#111827',outline:'none',boxSizing:'border-box'}}
                  onFocus={e=>e.target.style.borderColor='#185FA5'} onBlur={e=>e.target.style.borderColor='#E2E8F0'}>
                  <option value="">— Select Disposition —</option>
                  {CALL_DISPOSITIONS.map(d=><option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              {/* Previous Outcomes */}
              {previousOutcomes.length>0?(
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:11,fontWeight:600,color:'#6b7280',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:6}}>Previous Outcomes</div>
                  <div style={{maxHeight:100,overflowY:'auto',border:'1px solid #e5e7eb',borderRadius:8,padding:'6px 10px'}}>
                    {previousOutcomes.map((o,i)=>(
                      <div key={i} style={{fontSize:12,color:'#374151',padding:'4px 0',borderBottom:i<previousOutcomes.length-1?'1px solid #f3f4f6':'none',display:'flex',justifyContent:'space-between'}}>
                        <span style={{fontWeight:600}}>{o.call_outcome||'—'}</span>
                        <span style={{color:'#9ca3af'}}>{new Date(o.created_at).toLocaleString('en-IN',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'})}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ):(
                <div style={{fontSize:12,color:'#9ca3af',marginBottom:14,fontStyle:'italic'}}>No previous call outcomes for this lead</div>
              )}
              {/* Lead Stage — separate from disposition */}
              <div style={{marginBottom:12}}>
                <label style={{display:'block',fontSize:11,fontWeight:600,color:'#6B7280',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.04em'}}>Lead Stage</label>
                <select value={callLogStage} onChange={e=>setCallLogStage(e.target.value)}
                  style={{width:'100%',padding:'9px 10px',border:'1.5px solid #E2E8F0',borderRadius:8,fontSize:13,background:'white',color:'#111827',outline:'none',boxSizing:'border-box'}}
                  onFocus={e=>e.target.style.borderColor='#185FA5'} onBlur={e=>e.target.style.borderColor='#E2E8F0'}>
                  {STAGE_OPTIONS.map(s=><option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {/* Callback Date + Time (only when disposition = Callback) */}
              {callLogDisposition==='Callback'&&(
                <div style={{background:'#EFF6FF',border:'1px solid #93C5FD',borderRadius:8,padding:'12px',marginBottom:12}}>
                  <div style={{fontSize:11,fontWeight:700,color:'#1e40af',marginBottom:8,textTransform:'uppercase',letterSpacing:'0.04em'}}>Schedule Callback</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                    <div>
                      <label style={{display:'block',fontSize:11,fontWeight:600,color:'#6B7280',marginBottom:4}}>Date *</label>
                      <input type="date" min={istToday()} value={callLogCallbackDate}
                        onChange={e=>setCallLogCallbackDate(e.target.value)}
                        style={{width:'100%',padding:'8px 10px',border:'1.5px solid #93C5FD',borderRadius:6,fontSize:13,outline:'none',boxSizing:'border-box',color:'#111827'}}/>
                    </div>
                    <div>
                      <label style={{display:'block',fontSize:11,fontWeight:600,color:'#6B7280',marginBottom:4}}>Time *</label>
                      <input type="time" value={callLogCallbackTime}
                        onChange={e=>setCallLogCallbackTime(e.target.value)}
                        style={{width:'100%',padding:'8px 10px',border:'1.5px solid #93C5FD',borderRadius:6,fontSize:13,outline:'none',boxSizing:'border-box',color:'#111827'}}/>
                    </div>
                  </div>
                </div>
              )}
              {/* Notes */}
              <div style={{marginBottom:16}}>
                <label style={{display:'block',fontSize:11,fontWeight:600,color:'#6B7280',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.04em'}}>Notes</label>
                <textarea value={callLogNotes} onChange={e=>setCallLogNotes(e.target.value)}
                  placeholder="Add call notes here…"
                  rows={3}
                  style={{width:'100%',padding:'9px 10px',border:'1.5px solid #E2E8F0',borderRadius:8,fontSize:13,outline:'none',resize:'vertical',fontFamily:'inherit',boxSizing:'border-box',color:'#111827'}}
                  onFocus={e=>e.target.style.borderColor='#185FA5'} onBlur={e=>e.target.style.borderColor='#E2E8F0'}/>
              </div>
              {/* Buttons */}
              <div style={{display:'flex',gap:8}}>
                <button onClick={saveCallLog} disabled={savingCallLog}
                  style={{flex:1,padding:'12px',background:savingCallLog?'#93C5FD':'#185FA5',color:'white',border:'none',borderRadius:8,fontSize:14,fontWeight:600,cursor:savingCallLog?'not-allowed':'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>
                  <IconDeviceFloppy size={15}/>{savingCallLog?'Saving…':'Save Call Log'}
                </button>
                <button onClick={()=>setShowCallLogModal(false)}
                  style={{padding:'12px 16px',background:'transparent',border:'1.5px solid #E2E8F0',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer',color:'#6B7280'}}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </>
        </ErrorBoundary>
      )}

      {/* OBLIGATION FULL-SCREEN PANEL */}
      {showObligationModal&&selectedLeadForObligations&&(
        <ErrorBoundary>
        <div style={{position:'fixed',top:0,bottom:0,right:0,left:isMobile?0:'var(--sidebar-width)',background:'#0f172a',zIndex:360,display:'flex',flexDirection:'column',overflow:'hidden'}}>

          {/* ── Header Bar ── */}
          <div style={{background:'#111827',borderBottom:'1px solid #1e293b',padding:'14px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexShrink:0}}>
            <div style={{display:'flex',alignItems:'center',gap:14,minWidth:0}}>
              <button onClick={()=>setShowObligationModal(false)}
                style={{display:'flex',alignItems:'center',gap:6,background:'rgba(255,255,255,0.08)',border:'1px solid #334155',color:'#94a3b8',padding:'7px 12px',borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:600,flexShrink:0}}>
                ← Back
              </button>
              <div style={{minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                  <span style={{fontSize:isMobile?14:22,fontWeight:500,color:'white',letterSpacing:'0.3px',lineHeight:1.1}}>{selectedLeadForObligations.full_name}</span>
                  {selectedLeadForObligations.status&&(()=>{const ss=stageStyle(selectedLeadForObligations.status);return<span style={{background:ss.bg,color:ss.color,fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:20,flexShrink:0}}>{selectedLeadForObligations.status}</span>})()}
                  {obModalReadOnly&&<span style={{background:'#1e40af',color:'#93c5fd',fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:20,letterSpacing:'0.06em',flexShrink:0}}>VIEW ONLY</span>}
                </div>
                {selectedLeadForObligations.mobile&&<div style={{fontSize:12,color:'#64748b',marginTop:3}}>{selectedLeadForObligations.mobile}{selectedLeadForObligations.company_name?` · ${selectedLeadForObligations.company_name}`:''}</div>}
              </div>
            </div>
            <div style={{display:'flex',gap:8,flexShrink:0,alignItems:'center'}}>
              {!obModalReadOnly&&(isObEditing?(
                <>
                  <button onClick={async()=>{
                    if(!selectedLeadForObligations)return
                    const leadId=selectedLeadForObligations.id
                    const salaryVal=obModalSalary===''?null:parseFloat(obModalSalary)||null
                    const netTakeHomeVal=obModalNetTakeHome===''?null:parseFloat(obModalNetTakeHome)||null
                    console.log('[Action] obModal save info → DB write lead:', leadId)
                    const {error}=await supabase.from('leads').update({monthly_salary:salaryVal,net_take_home:netTakeHomeVal,company_name:obModalCompany||null,notes:obModalNotes||null}).eq('id',leadId)
                    if(error){ console.error('[Action] obModal save error:', error); return }
                    setMyLeads(prev=>[...prev.map(l=>l.id===leadId?{...l,monthly_salary:salaryVal,net_take_home:netTakeHomeVal,company_name:obModalCompany||null,notes:obModalNotes||null}:l)])
                    setObSavedSnapshot({salary:obModalSalary,netTakeHome:obModalNetTakeHome,company:obModalCompany,notes:obModalNotes})
                    setObIsNewLead(false)
                    setIsObEditing(false)
                    showToast('Info saved for '+selectedLeadForObligations.full_name)
                  }} style={{padding:'7px 16px',borderRadius:8,background:'#16a34a',color:'white',border:'none',cursor:'pointer',fontSize:13,fontWeight:700,display:'flex',alignItems:'center',gap:6}}>
                    <IconDeviceFloppy size={14}/> {obIsNewLead?'Save Info & Notes':'Save'}
                  </button>
                  {!obIsNewLead&&(
                    <button onClick={()=>{
                      if(obSavedSnapshot){setObModalSalary(obSavedSnapshot.salary);setObModalNetTakeHome(obSavedSnapshot.netTakeHome||'');setObModalCompany(obSavedSnapshot.company);setObModalNotes(obSavedSnapshot.notes)}
                      setIsObEditing(false)
                    }} style={{padding:'7px 14px',borderRadius:8,background:'transparent',border:'1px solid #334155',color:'#94a3b8',cursor:'pointer',fontSize:13}}>
                      Cancel
                    </button>
                  )}
                </>
              ):(!obIsNewLead&&(
                <button onClick={()=>setIsObEditing(true)}
                  style={{padding:'7px 14px',borderRadius:8,background:'#1e40af',color:'#93c5fd',border:'1px solid #1e40af',cursor:'pointer',fontSize:13,fontWeight:600,display:'flex',alignItems:'center',gap:6}}>
                  <IconEdit size={14}/> Edit
                </button>
              )))}
              <button onClick={()=>setShowObligationModal(false)}
                style={{background:'rgba(255,255,255,0.08)',border:'1px solid #334155',color:'#94a3b8',width:34,height:34,borderRadius:8,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
                <IconX size={15}/>
              </button>
            </div>
          </div>

          {/* ── Reassigned Banner ── */}
          {leadReassignInfo&&(
            <div style={{background:'#7c2d12',borderBottom:'1px solid #ea580c',padding:'10px 20px',display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
              <span style={{fontSize:18}}>🔀</span>
              <span style={{color:'#fed7aa',fontSize:13,fontWeight:600}}>This lead was reassigned to you{leadReassignInfo.previous_agent_name?` from ${leadReassignInfo.previous_agent_name}`:''}</span>
            </div>
          )}

          {/* ── Scrollable Body ── */}
          <div style={{flex:1,overflowY:'auto',padding:isMobile?'14px':'20px 24px',background:'#0f172a',color:'#e2e8f0'}}>

            {/* ── UPPER ROW: Salary + Company + Notes ── */}
            <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:16,marginBottom:20}}>

              {/* Left column: Salary + Company */}
              <div style={{display:'flex',flexDirection:'column',gap:12}}>
                <div style={{background:'rgba(255,255,255,0.06)',borderRadius:10,padding:'14px 16px',border:'1px solid rgba(255,255,255,0.1)'}}>
                  <div style={{fontSize:11,fontWeight:600,color:'rgba(255,255,255,0.6)',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:8}}>Net Take Home (Net In Hand)</div>
                  {isObEditing?(
                    <input type="number" placeholder="Enter net take home salary" value={obModalNetTakeHome||''} onChange={e=>setObModalNetTakeHome(e.target.value)}
                      style={{width:'100%',padding:'10px 12px',borderRadius:8,border:'1px solid rgba(255,255,255,0.2)',background:'rgba(255,255,255,0.1)',color:'white',fontSize:14,boxSizing:'border-box',outline:'none'}}/>
                  ):(
                    <div style={{fontSize:15,color:'#ffffff',fontWeight:500}}>{obModalNetTakeHome?`₹${Number(obModalNetTakeHome).toLocaleString('en-IN')}`:'Not entered'}</div>
                  )}
                  <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginTop:6}}>Used for FOIR if entered, else falls back to Monthly Salary</div>
                </div>
                <div style={{background:'rgba(255,255,255,0.06)',borderRadius:10,padding:'14px 16px',border:'1px solid rgba(255,255,255,0.1)'}}>
                  <div style={{fontSize:11,fontWeight:600,color:'rgba(255,255,255,0.6)',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:8}}>Monthly Salary</div>
                  {isObEditing?(
                    <input type="number" placeholder="Enter monthly salary" value={obModalSalary||''} onChange={e=>setObModalSalary(e.target.value)}
                      style={{width:'100%',padding:'10px 12px',borderRadius:8,border:'1px solid rgba(255,255,255,0.2)',background:'rgba(255,255,255,0.1)',color:'white',fontSize:14,boxSizing:'border-box',outline:'none'}}/>
                  ):(
                    <div style={{fontSize:15,color:'#ffffff',fontWeight:500}}>{obModalSalary?`₹${Number(obModalSalary).toLocaleString('en-IN')}`:'Not entered'}</div>
                  )}
                </div>
                <div style={{background:'rgba(255,255,255,0.06)',borderRadius:10,padding:'14px 16px',border:'1px solid rgba(255,255,255,0.1)'}}>
                  <div style={{fontSize:11,fontWeight:600,color:'rgba(255,255,255,0.6)',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:8}}>Company Name</div>
                  {isObEditing?(
                    <input type="text" placeholder="Enter company name" value={obModalCompany||''} onChange={e=>setObModalCompany(e.target.value)}
                      style={{width:'100%',padding:'10px 12px',borderRadius:8,border:'1px solid rgba(255,255,255,0.2)',background:'rgba(255,255,255,0.1)',color:'white',fontSize:14,boxSizing:'border-box',outline:'none'}}/>
                  ):(
                    <div style={{fontSize:15,color:'#ffffff',fontWeight:500}}>{obModalCompany||'Not entered'}</div>
                  )}
                </div>
              </div>

              {/* Right column: Call Notes */}
              <div style={{background:'rgba(255,255,255,0.06)',borderRadius:10,padding:'14px 16px',border:'1px solid rgba(255,255,255,0.1)',display:'flex',flexDirection:'column'}}>
                <div style={{fontSize:11,fontWeight:600,color:'rgba(255,255,255,0.6)',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:8}}>Call Notes</div>
                <div style={{flex:1,minHeight:220,background:'#0a0f1a',border:'1px solid #1e293b',borderRadius:8,overflowY:'auto',marginBottom:isObEditing?8:0}}>
                  <div style={{flex:1,overflowY:'auto',padding:'12px 16px'}}>
                    {(obModalNotes||'').split('\n').filter(line=>{
                      const trimmed=line.trim()
                      return trimmed&&trimmed!=='undefined'&&trimmed!=='-'&&trimmed!=='[object Object]'
                    }).map((line,i)=>(
                      <div key={i} style={{fontSize:13,color:'#ffffff',marginBottom:8,lineHeight:1.6,padding:'6px 0',borderBottom:'1px solid rgba(255,255,255,0.08)'}}>
                        {line}
                      </div>
                    ))}
                    {!(obModalNotes||'').split('\n').some(line=>{const t=line.trim();return t&&t!=='undefined'&&t!=='-'&&t!=='[object Object]'})&&(
                      <div style={{color:'rgba(255,255,255,0.4)',fontSize:13,fontStyle:'italic'}}>No notes yet</div>
                    )}
                  </div>
                </div>
                {isObEditing&&(
                  <div style={{display:'flex',gap:6}}>
                    <textarea rows={3} value={obModalNoteInput} onChange={e=>setObModalNoteInput(e.target.value)}
                      placeholder="Add a note and press Enter…"
                      onKeyDown={e=>{
                        if(e.key==='Enter'&&!e.shiftKey&&obModalNoteInput.trim()){
                          e.preventDefault()
                          const _n=new Date(),_d=String(_n.getDate()).padStart(2,'0'),_mo=String(_n.getMonth()+1).padStart(2,'0'),_y=_n.getFullYear(),_h=String(_n.getHours()).padStart(2,'0'),_mi=String(_n.getMinutes()).padStart(2,'0')
                          const ts=`[${_d}/${_mo}/${_y} ${_h}:${_mi} - ${profile?.full_name||'Agent'}]`
                          setObModalNotes(prev=>(prev?prev+'\n':'')+`${ts}: `+obModalNoteInput.trim())
                          setObModalNoteInput('')
                        }
                      }}
                      style={{flex:1,padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:12,resize:'vertical'}}/>
                    <button onClick={()=>{
                      if(!obModalNoteInput.trim())return
                      const _n=new Date(),_d=String(_n.getDate()).padStart(2,'0'),_mo=String(_n.getMonth()+1).padStart(2,'0'),_y=_n.getFullYear(),_h=String(_n.getHours()).padStart(2,'0'),_mi=String(_n.getMinutes()).padStart(2,'0')
                      const ts=`[${_d}/${_mo}/${_y} ${_h}:${_mi} - ${profile?.full_name||'Agent'}]`
                      setObModalNotes(prev=>(prev?prev+'\n':'')+`${ts}: `+obModalNoteInput.trim())
                      setObModalNoteInput('')
                    }} style={{padding:'7px 12px',borderRadius:8,background:'#2563eb',color:'white',border:'none',cursor:'pointer',fontSize:12,fontWeight:700,flexShrink:0}}>Add</button>
                  </div>
                )}
              </div>
            </div>

              {/* ── Summary cards ── */}
              <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',justifyContent:'space-between',gap:8,marginBottom:10}}>
                <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(auto-fit,minmax(110px,1fr))',gap:8,flex:1}}>
                  <div style={{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:10,padding:'14px 16px',minWidth:110,flex:1}}>
                    <div style={{fontSize:11,fontWeight:600,color:'rgba(255,255,255,0.6)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:6}}>Total EMI</div>
                    <div style={{fontSize:20,fontWeight:600,color:'#60A5FA'}}>₹{obligationTotals.totalEMI.toLocaleString('en-IN')}</div>
                    <div style={{fontSize:11,color:'rgba(255,255,255,0.45)',marginTop:4}}>All obligations</div>
                  </div>
                  <div style={{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:10,padding:'14px 16px',minWidth:110,flex:1}}>
                    <div style={{fontSize:11,fontWeight:600,color:'rgba(255,255,255,0.6)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:6}}>Obligated EMI</div>
                    <div style={{fontSize:20,fontWeight:600,color:'#F59E0B'}}>₹{obligationTotals.totalObligatedEMI.toLocaleString('en-IN')}</div>
                    <div style={{fontSize:11,color:'rgba(255,255,255,0.45)',marginTop:4}}>Used for FOIR</div>
                  </div>
                  <div style={{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:10,padding:'14px 16px',minWidth:110,flex:1}}>
                    <div style={{fontSize:11,fontWeight:600,color:'rgba(255,255,255,0.6)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:6}}>Outstanding</div>
                    <div style={{fontSize:20,fontWeight:600,color:'#60A5FA'}}>₹{obligationTotals.totalOutstanding.toLocaleString('en-IN')}</div>
                  </div>
                  <div style={{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:10,padding:'14px 16px',minWidth:110,flex:1}}>
                    <div style={{fontSize:11,fontWeight:600,color:'rgba(255,255,255,0.6)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:6}}>FOIR (Obl. EMI)</div>
                    <div style={{fontSize:20,fontWeight:700,color:obligationTotals.isEligible?'#34D399':'#F87171'}}>{obligationTotals.currentFoir}%</div>
                    <div style={{fontSize:11,color:'rgba(255,255,255,0.45)',marginTop:4}}>Max: {obligationTotals.maxFoir}%</div>
                  </div>
                  <div style={{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:10,padding:'14px 16px',minWidth:140,flex:1}}>
                    <div style={{fontSize:11,fontWeight:600,color:'rgba(255,255,255,0.6)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:6}}>Eligible Loan Amt</div>
                    {!(obModalNetTakeHome||obModalSalary)
                      ? <div style={{fontSize:20,fontWeight:600,color:'#64748b'}}>—</div>
                      : <div style={{fontSize:18,fontWeight:600,color:obligationTotals.eligibleLoan>0?'#34D399':'#ef4444'}}>₹{obligationTotals.eligibleLoan.toLocaleString('en-IN')}</div>
                    }
                    {(obModalNetTakeHome||obModalSalary)&&<div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginTop:4}}>Avail EMI: ₹{Math.round(obligationTotals.availableEMI).toLocaleString('en-IN')}</div>}
                    <button onClick={()=>window.open('https://www.axisbank.com/calculators/emi-calculator','_blank')}
                      style={{marginTop:6,display:'flex',alignItems:'center',gap:4,background:'#1e3a5f',border:'1px solid #334155',color:'#7dd3fc',padding:'3px 8px',borderRadius:6,fontSize:10,fontWeight:600,cursor:'pointer',width:'100%',justifyContent:'center'}}>
                      🧮 EMI Calc
                    </button>
                  </div>
                  <div style={{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:10,padding:'14px 16px',minWidth:140,flex:1}}>
                    <div style={{fontSize:11,fontWeight:600,color:'rgba(255,255,255,0.6)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:6}}>BT POS (Existing Total)</div>
                    <div style={{fontSize:20,fontWeight:600,color:'#A78BFA'}}>₹{btPosTotal.toLocaleString('en-IN')}</div>
                    <div style={{fontSize:11,color:'rgba(255,255,255,0.45)',marginTop:4}}>{btPersonalLoanCount} PL + {btCreditCardCount} Card</div>
                  </div>
                  <div style={{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:10,padding:'14px 16px',minWidth:140,flex:1}}>
                    <div style={{fontSize:11,fontWeight:600,color:'rgba(255,255,255,0.6)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:6}}>Amount In Hand (After BT)</div>
                    <div style={{fontSize:20,fontWeight:600,color:'#34D399'}}>₹{amountInHandAfterBT.toLocaleString('en-IN')}</div>
                  </div>
                </div>
                {!obModalReadOnly&&(
                  <button onClick={addObligationDraft}
                    style={{padding:'10px 16px',borderRadius:10,background:'#2563eb',color:'white',fontWeight:700,fontSize:13,border:'none',cursor:'pointer',minWidth:150}}>
                    + Add Obligation
                  </button>
                )}
              </div>
              {obligationError&&(
                <div style={{background:'#7f1d1d',color:'white',borderRadius:12,padding:'12px 14px',marginBottom:14,fontSize:13}}>{obligationError}</div>
              )}
              {obligationDrafts.length===0&&(
                <div style={{background:'#111827',border:'1px dashed #334155',borderRadius:16,padding:'30px 20px',textAlign:'center',color:'rgba(255,255,255,0.5)',fontSize:14}}>
                  No obligations yet. Click <strong style={{color:'#60A5FA'}}>+ Add Obligation</strong> to start capturing liabilities.
                </div>
              )}
              {obligationDrafts.map(ob=>{
                const isHousing=ob.obligation_type==='Housing Loan'
                const showExpanded=ob.expanded||obModalReadOnly
                return(
                  <div key={ob.id} style={{background:'#111827',border:'1px solid #334155',borderRadius:14,padding:12,marginBottom:10}}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
                      <div>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                          <div style={{fontSize:14,fontWeight:800,color:'white'}}>{enrichDraftTitle(ob)}</div>
                          {ob.balance_transfer&&<span style={{background:'#052e16',border:'1px solid #16a34a',color:'#4ade80',fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:20,letterSpacing:'0.05em'}}>BT</span>}
                        </div>
                        <div style={{fontSize:11,color:'#94a3b8',marginTop:2,display:'flex',flexWrap:'wrap',alignItems:'center',gap:6}}>
                          {ob.obligation_type==='Credit Card'?(()=>{
                            const cl=parseFloat(ob.credit_limit)||parseFloat(ob.sanctioned_amount)||0
                            const out=parseFloat(ob.outstanding_amount)||0
                            const isBT=ob.balance_transfer===true||ob.balance_transfer==='true'||ob.balance_transfer==='Yes'||ob.balance_transfer==='yes'
                            return(<>
                              {cl>0&&<span>Credit Limit ₹{cl.toLocaleString('en-IN')}</span>}
                              {cl>0&&out>0&&<span style={{color:'#475569'}}>·</span>}
                              <span>{out>0?`Outstanding ₹${out.toLocaleString('en-IN')}`:'Outstanding not set'}</span>
                              {out>0&&(isBT
                                ?<span style={{background:'#14532d',color:'#4ade80',fontSize:10,fontWeight:700,padding:'1px 7px',borderRadius:12}}>BT Applied — Not Obligated</span>
                                :<span style={{background:'#431407',color:'#fb923c',fontSize:10,fontWeight:700,padding:'1px 7px',borderRadius:12}}>Obligated ₹{Math.round(out*0.05).toLocaleString('en-IN')} (5% of Outstanding)</span>
                              )}
                            </>)
                          })():(()=>{
                            const obl=calculateObligatedEMI(ob)
                            const orig=parseFloat(ob.emi_amount)||0
                            const reason=getObligatedReason(ob)
                            return(<>
                              <span>{orig>0?`EMI ₹${orig.toLocaleString('en-IN')}`:'EMI not set'}</span>
                              {orig>0&&(obl===0&&reason
                                ?<span style={{background:'#14532d',color:'#4ade80',fontSize:10,fontWeight:700,padding:'1px 7px',borderRadius:12}}>Not Obligated · {reason}</span>
                                :obl<orig
                                  ?<span style={{background:'#1e3a5f',color:'#93c5fd',fontSize:10,fontWeight:700,padding:'1px 7px',borderRadius:12}}>Obligated ₹{obl.toLocaleString('en-IN')} · {reason}</span>
                                  :<span style={{background:'#1f2937',color:'#64748b',fontSize:10,fontWeight:600,padding:'1px 7px',borderRadius:12}}>Obligated ₹{obl.toLocaleString('en-IN')}</span>
                              )}
                              <span style={{color:'#475569'}}>·</span>
                              <span>{ob.outstanding_amount?`Outstanding ₹${Number(ob.outstanding_amount).toLocaleString('en-IN')}`:'Outstanding not set'}</span>
                            </>)
                          })()}
                        </div>
                      </div>
                      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                        {!obModalReadOnly&&(
                          <button onClick={()=>toggleObligationExpand(ob.id)}
                            style={{padding:'7px 12px',borderRadius:8,border:'1px solid #334155',background:'transparent',color:'#e2e8f0',cursor:'pointer',fontSize:12,fontWeight:700}}>{ob.expanded?'Hide':'Edit'}</button>
                        )}
                        {!obModalReadOnly&&(
                          <button onClick={()=>saveObligationCard(ob)} disabled={savingObligation}
                            style={{padding:'7px 12px',borderRadius:8,border:'none',background:'#22c55e',color:'white',cursor:'pointer',fontSize:12,fontWeight:700,opacity:savingObligation?0.6:1}}>{String(ob.id).startsWith('tmp-')?'Save':'Update'}</button>
                        )}
                        {!obModalReadOnly&&(
                          <button onClick={()=>deleteObligationCard(ob)}
                            style={{padding:'7px 12px',borderRadius:8,border:'1px solid #7f1d1d',background:'transparent',color:'#fda4af',cursor:'pointer',fontSize:12,fontWeight:700}}>Delete</button>
                        )}
                      </div>
                    </div>
                    {showExpanded&&obModalReadOnly&&(
                      <div style={{marginTop:10,display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:8,fontSize:12}}>
                        <div style={{color:'#64748b'}}>Type<div style={{color:'#e2e8f0',fontWeight:600,marginTop:2}}>{ob.obligation_type}</div></div>
                        <div style={{color:'#64748b'}}>Bank<div style={{color:'#e2e8f0',fontWeight:600,marginTop:2}}>{ob.bank_name||'—'}</div></div>
                        <div style={{color:'#64748b'}}>EMI<div style={{color:'#38bdf8',fontWeight:700,marginTop:2}}>{ob.emi_amount?'₹'+Number(ob.emi_amount).toLocaleString('en-IN'):'—'}</div></div>
                        <div style={{color:'#64748b'}}>Outstanding<div style={{color:'#a78bfa',fontWeight:700,marginTop:2}}>{ob.outstanding_amount?'₹'+Number(ob.outstanding_amount).toLocaleString('en-IN'):'—'}</div></div>
                        <div style={{color:'#64748b'}}>Required Loan<div style={{color:'#e2e8f0',fontWeight:600,marginTop:2}}>{ob.sanctioned_amount?'₹'+Number(ob.sanctioned_amount).toLocaleString('en-IN'):'—'}</div></div>
                        <div style={{color:'#64748b'}}>Balance Transfer<div style={{marginTop:2}}>{ob.balance_transfer?<span style={{color:'#4ade80',fontWeight:700}}>✓ Yes</span>:<span style={{color:'#94a3b8'}}>No</span>}</div></div>
                        {ob.tenure_months&&<div style={{color:'#64748b'}}>Tenure<div style={{color:'#e2e8f0',marginTop:2}}>{ob.tenure_months} months</div></div>}
                        {ob.bounce&&ob.bounce!=='No'&&<div style={{color:'#64748b'}}>Bounce<div style={{color:'#f87171',fontWeight:600,marginTop:2}}>{ob.bounce}</div></div>}
                      </div>
                    )}
                    {showExpanded&&!obModalReadOnly&&(
                      <div style={{marginTop:12,display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(2,1fr)',gap:8}}>
                        {/* OBLIGATION TYPE - always shown */}
                        <div>
                          <label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>Obligation Type</label>
                          <select value={ob.obligation_type} onChange={e=>handleObligationFieldChange(ob.id,'obligation_type',e.target.value)}
                            style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}>
                            {OBLIGATION_TYPES.map(type=><option key={type} value={type}>{type}</option>)}
                          </select>
                        </div>
                        {/* BALANCE TRANSFER - applies to every obligation type */}
                        <div style={{display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>
                          <label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>Balance Transfer (BT)?</label>
                          <div onClick={()=>!obModalReadOnly&&handleObligationFieldChange(ob.id,'balance_transfer',!ob.balance_transfer)}
                            style={{display:'flex',alignItems:'center',gap:8,padding:'7px 12px',borderRadius:8,border:'1px solid '+(ob.balance_transfer?'#16a34a':'#334155'),background:ob.balance_transfer?'#052e16':'#0f172a',cursor:obModalReadOnly?'default':'pointer',userSelect:'none'}}>
                            <div style={{width:18,height:18,borderRadius:5,background:ob.balance_transfer?'#16a34a':'#334155',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                              {ob.balance_transfer&&<span style={{color:'white',fontSize:12,fontWeight:700}}>✓</span>}
                            </div>
                            <span style={{fontSize:12,fontWeight:700,color:ob.balance_transfer?'#4ade80':'#94a3b8'}}>{ob.balance_transfer?'Yes — BT':'No'}</span>
                          </div>
                          <div style={{fontSize:10,color:'#64748b',marginTop:4}}>BT loans are excluded at 0% in FOIR</div>
                        </div>

                        {/* ── PERSONAL LOAN ── */}
                        {ob.obligation_type==='Personal Loan'&&(<>
                          <div><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>Bank / NBFC Name</label>
                            <input value={ob.bank_name||''} onChange={e=>handleObligationFieldChange(ob.id,'bank_name',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}/></div>
                          <div><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>Loan Amount (₹)</label>
                            <input type="number" min="0" value={ob.overdue_amount||''} onChange={e=>handleObligationFieldChange(ob.id,'overdue_amount',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}/></div>
                          <div><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>Required Loan Amount (₹)</label>
                            <input type="number" min="0" value={ob.sanctioned_amount||''} onChange={e=>handleObligationFieldChange(ob.id,'sanctioned_amount',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}/></div>
                          <div><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>EMI Amount (₹)</label>
                            <input type="number" min="0" value={ob.emi_amount||''} onChange={e=>handleObligationFieldChange(ob.id,'emi_amount',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}/></div>
                          <div><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>Current Outstanding (₹)</label>
                            <input type="number" min="0" value={ob.outstanding_amount||''} onChange={e=>handleObligationFieldChange(ob.id,'outstanding_amount',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}/></div>
                          <div><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>POS (Principal Outstanding)</label>
                            <input type="number" min="0" placeholder="Enter POS amount" value={ob.pos_amount||''} onChange={e=>handleObligationFieldChange(ob.id,'pos_amount',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}/></div>
                          <div><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>Total EMIs Paid</label>
                            <input type="number" min="0" value={ob.emis_paid||''} onChange={e=>handleObligationFieldChange(ob.id,'emis_paid',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}/></div>
                          <div><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>Tenure (months)</label>
                            <input type="number" min="0" value={ob.tenure_months||''} onChange={e=>handleObligationFieldChange(ob.id,'tenure_months',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}/></div>
                          <div><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>EMIs Remaining</label>
                            <input type="number" min="0" value={ob.remaining_tenure||''} onChange={e=>handleObligationFieldChange(ob.id,'remaining_tenure',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}/></div>
                          <div><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>Any EMI Bounce?</label>
                            <select value={ob.bounce||'No'} onChange={e=>handleObligationFieldChange(ob.id,'bounce',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}>
                              {YES_NO_OPTIONS.map(opt=><option key={opt} value={opt}>{opt}</option>)}
                            </select></div>
                        </>)}

                        {/* ── HOUSING LOAN ── */}
                        {ob.obligation_type==='Housing Loan'&&(<>
                          <div><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>Loan Amount (₹)</label>
                            <input type="number" min="0" value={ob.sanctioned_amount||''} onChange={e=>handleObligationFieldChange(ob.id,'sanctioned_amount',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}/></div>
                          <div><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>EMI Amount (₹)</label>
                            <input type="number" min="0" value={ob.emi_amount||''} onChange={e=>handleObligationFieldChange(ob.id,'emi_amount',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}/></div>
                          <div><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>EMIs Remaining</label>
                            <input type="number" min="0" value={ob.remaining_tenure||''} onChange={e=>handleObligationFieldChange(ob.id,'remaining_tenure',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}/></div>
                          <div style={{gridColumn:'1 / -1'}}><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>Individual or Joint Loan?</label>
                            <select value={ob.joint_type||'Individual'} onChange={e=>handleObligationFieldChange(ob.id,'joint_type',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}>
                              {JOINT_OPTIONS.map(opt=><option key={opt} value={opt}>{opt}</option>)}
                            </select></div>
                          {ob.joint_type==='Joint'&&(<>
                            <div><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>Relation with Joint Holder</label>
                              <input value={ob.joint_holder_relation||''} onChange={e=>handleObligationFieldChange(ob.id,'joint_holder_relation',e.target.value)} placeholder="e.g. Spouse, Parent" style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}/></div>
                            <div><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>Income of Joint Holder (₹)</label>
                              <input type="number" min="0" value={ob.joint_holder_income||''} onChange={e=>handleObligationFieldChange(ob.id,'joint_holder_income',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}/></div>
                            <div style={{gridColumn:'1 / -1'}}><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>EMI Paid by</label>
                              <select value={ob.joint_holder_name||'Self'} onChange={e=>handleObligationFieldChange(ob.id,'joint_holder_name',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}>
                                <option value="Self">Self</option>
                                <option value="Co-applicant">Co-applicant</option>
                                <option value="Both">Both</option>
                              </select></div>
                          </>)}
                        </>)}

                        {/* ── CREDIT CARD ── */}
                        {ob.obligation_type==='Credit Card'&&(<>
                          <div><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>Bank Name</label>
                            <input value={ob.bank_name||''} onChange={e=>handleObligationFieldChange(ob.id,'bank_name',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}/></div>
                          <div>
                            <label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>Credit Limit (₹)</label>
                            <input type="number" min="0" value={ob.sanctioned_amount||''} onChange={e=>{handleObligationFieldChange(ob.id,'sanctioned_amount',e.target.value);handleObligationFieldChange(ob.id,'credit_limit',e.target.value)}} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}/>
                          </div>
                          <div>
                            <label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>Outstanding Amount (₹)</label>
                            <input type="number" min="0" value={ob.outstanding_amount||''} onChange={e=>handleObligationFieldChange(ob.id,'outstanding_amount',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}/>
                            {(ob.pos_amount||ob.outstanding_amount)&&!ob.balance_transfer&&<div style={{fontSize:10,color:'#f97316',marginTop:3}}>Obligated: ₹{Math.round((parseFloat(ob.pos_amount)||parseFloat(ob.outstanding_amount)||0)*0.05).toLocaleString('en-IN')} (5% of Outstanding/POS)</div>}
                            {(ob.pos_amount||ob.outstanding_amount)&&ob.balance_transfer&&<div style={{fontSize:10,color:'#4ade80',marginTop:3}}>Not Obligated (BT applied)</div>}
                          </div>
                          <div>
                            <label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>POS (Principal Outstanding)</label>
                            <input type="number" min="0" placeholder="Enter POS amount" value={ob.pos_amount||''} onChange={e=>handleObligationFieldChange(ob.id,'pos_amount',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}/>
                          </div>
                        </>)}

                        {/* ── EDUCATION LOAN ── */}
                        {ob.obligation_type==='Education Loan'&&(<>
                          <div><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>Loan Amount (₹)</label>
                            <input type="number" min="0" value={ob.sanctioned_amount||''} onChange={e=>handleObligationFieldChange(ob.id,'sanctioned_amount',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}/></div>
                          <div><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>EMI Amount (₹)</label>
                            <input type="number" min="0" value={ob.emi_amount||''} onChange={e=>handleObligationFieldChange(ob.id,'emi_amount',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}/></div>
                          <div><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>EMIs Remaining</label>
                            <input type="number" min="0" value={ob.remaining_tenure||''} onChange={e=>handleObligationFieldChange(ob.id,'remaining_tenure',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}/></div>
                          <div style={{gridColumn:'1 / -1'}}><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>EMI Paid by</label>
                            <select value={ob.joint_holder_name||'Self'} onChange={e=>handleObligationFieldChange(ob.id,'joint_holder_name',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}>
                              <option value="Self">Self (100% obligated)</option>
                              <option value="Co-applicant">Co-applicant (50% obligated)</option>
                            </select></div>
                        </>)}

                        {/* ── CAR LOAN / BIKE LOAN / CONSUMER DURABLE ── */}
                        {['Car Loan','Bike Loan','Consumer Durable Loan'].includes(ob.obligation_type)&&(<>
                          <div><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>Loan Amount (₹)</label>
                            <input type="number" min="0" value={ob.sanctioned_amount||''} onChange={e=>handleObligationFieldChange(ob.id,'sanctioned_amount',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}/></div>
                          <div><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>EMIs Left</label>
                            <input type="number" min="0" value={ob.remaining_tenure||''} onChange={e=>handleObligationFieldChange(ob.id,'remaining_tenure',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}/></div>
                          <div><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>EMI Amount (₹)</label>
                            <input type="number" min="0" value={ob.emi_amount||''} onChange={e=>handleObligationFieldChange(ob.id,'emi_amount',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}/></div>
                          {ob.obligation_type==='Car Loan'&&(<>
                            <div style={{gridColumn:'1 / -1'}}><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>Individual or Joint Loan?</label>
                              <select value={ob.joint_type||'Individual'} onChange={e=>handleObligationFieldChange(ob.id,'joint_type',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}>
                                <option value="Individual">Individual</option>
                                <option value="Joint">Joint</option>
                              </select></div>
                            {ob.joint_type==='Joint'&&(
                              <div style={{gridColumn:'1 / -1'}}><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>EMI Paid by</label>
                                <select value={ob.joint_holder_name||'Self'} onChange={e=>handleObligationFieldChange(ob.id,'joint_holder_name',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}>
                                  <option value="Self">Self</option>
                                  <option value="Both">Both</option>
                                  <option value="Co-applicant">Co-applicant</option>
                                </select></div>
                            )}
                          </>)}
                        </>)}

                        {/* ── GOLD LOAN ── */}
                        {ob.obligation_type==='Gold Loan'&&(<>
                          <div><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>Loan Amount (₹)</label>
                            <input type="number" min="0" value={ob.sanctioned_amount||''} onChange={e=>{const v=e.target.value;handleObligationFieldChange(ob.id,'sanctioned_amount',v);if(v)handleObligationFieldChange(ob.id,'emi_amount',String(Math.round(parseFloat(v)*0.01)))}} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}/></div>
                          <div><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>EMI Amount (₹) <span style={{fontWeight:400,color:'#64748b'}}>= 1% of Loan Amt</span></label>
                            <input type="number" min="0" value={ob.emi_amount||''} onChange={e=>handleObligationFieldChange(ob.id,'emi_amount',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}/></div>
                          <div><label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>POS (Principal Outstanding)</label>
                            <input type="number" min="0" placeholder="Enter POS amount" value={ob.pos_amount||''} onChange={e=>handleObligationFieldChange(ob.id,'pos_amount',e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:13}}/>
                            <div style={{fontSize:10,color:'#64748b',marginTop:3}}>Used for FOIR (1% of POS) if entered, else falls back to Loan Amount</div>
                          </div>
                        </>)}

                      </div>
                    )}
                  </div>
                )
              })}
          </div>
        </div>
        </ErrorBoundary>
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
                {['',...stageNames].map(s=>{
                  const st=stageStyle(s)||{}
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
      <div style={{background:'linear-gradient(135deg,#0f3460 0%,#185FA5 100%)',padding:isMobile?'12px 14px':'12px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,position:'sticky',top:0,zIndex:50}}>
        <div style={{minWidth:0,flex:1}}>
          <div style={{fontSize:isMobile?14:16,fontWeight:700,color:'#ffffff',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{greeting||'Welcome back 👋'}</div>
          {!isMobile&&<div style={{fontSize:12,color:'rgba(255,255,255,0.7)',marginTop:2}}>{lastSynced?`Synced ${lastSynced.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:IST_TZ})} · `:''}Ready to close more loans today? 🚀</div>}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
          {!isMobile&&(
            <button onClick={()=>setDarkMode(!darkMode)} style={{padding:'7px 10px',background:'rgba(255,255,255,0.12)',border:'1px solid rgba(255,255,255,0.25)',borderRadius:8,cursor:'pointer',fontSize:12,color:'#ffffff'}}>{darkMode?'☀️':'🌙'}</button>
          )}
          <button onClick={()=>setShowNotifPanel(true)}
            style={{position:'relative',background:callbackTasks.length>0?'#FFF7ED':notifications.length>0?'#FAEEDA':'rgba(255,255,255,0.12)',border:'1px solid '+(callbackTasks.length>0?'#FDE68A':notifications.length>0?'#F6E05E':'rgba(255,255,255,0.25)'),borderRadius:8,padding:'8px 10px',cursor:'pointer',display:'flex',alignItems:'center',gap:4,color:callbackTasks.length>0?'#92400E':notifications.length>0?'#854F0B':'#ffffff',fontSize:12,fontWeight:500}}>
            <IconBell size={16}/>
            {(callbackTasks.length+notifications.length)>0&&<span style={{background:'#A32D2D',color:'white',borderRadius:'50%',width:16,height:16,fontSize:9,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center'}}>{callbackTasks.length+notifications.length}</span>}
          </button>
          <div style={{position:'relative'}}>
            <button onClick={()=>setShowAgentDbBell(b=>!b)} style={{position:'relative',background:'rgba(255,255,255,0.12)',border:'1px solid rgba(255,255,255,0.25)',borderRadius:8,padding:'8px 10px',cursor:'pointer',display:'flex',alignItems:'center',gap:4,color:'#ffffff',fontSize:12,fontWeight:500}}>
              📥
              {agentDbUnread>0&&<span style={{position:'absolute',top:-5,right:-5,background:'#DC2626',color:'white',borderRadius:'50%',width:16,height:16,fontSize:9,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center'}}>{agentDbUnread}</span>}
            </button>
            {showAgentDbBell&&(
              <>
                <div onClick={()=>setShowAgentDbBell(false)} style={{position:'fixed',inset:0,zIndex:199}}/>
                <div style={{position:'absolute',right:0,top:'110%',width:300,maxHeight:340,overflowY:'auto',background:'white',border:'1px solid #e5e7eb',borderRadius:12,boxShadow:'0 8px 24px rgba(0,0,0,0.14)',zIndex:200}}>
                  <div style={{padding:'10px 14px',borderBottom:'1px solid #e5e7eb',display:'flex',justifyContent:'space-between',alignItems:'center',position:'sticky',top:0,background:'white'}}>
                    <span style={{fontWeight:700,fontSize:13,color:'#111827'}}>Assigned Leads {agentDbUnread>0&&<span style={{color:'#DC2626'}}>({agentDbUnread})</span>}</span>
                    {agentDbUnread>0&&<button onClick={markAgentDbNotifsRead} style={{fontSize:11,color:'#185FA5',background:'none',border:'none',cursor:'pointer',fontWeight:600,padding:0}}>Mark all read</button>}
                  </div>
                  {agentDbNotifs.length===0?(
                    <div style={{padding:'20px 14px',color:'#9ca3af',fontSize:13,textAlign:'center'}}>No assignments yet.</div>
                  ):agentDbNotifs.map(n=>(
                    <div key={n.id} style={{padding:'10px 14px',borderBottom:'1px solid #f3f4f6',background:n.read?'white':'#EFF6FF'}}>
                      <div style={{fontSize:12,color:'#111827',lineHeight:1.5}}>{n.message}</div>
                      <div style={{fontSize:11,color:'#9ca3af',marginTop:3}}>{n.created_at?new Date(n.created_at).toLocaleString('en-IN',{dateStyle:'short',timeStyle:'short',timeZone:IST_TZ}):''}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          {!isMobile&&(
            <div style={{display:'flex',border:'1px solid rgba(255,255,255,0.25)',borderRadius:8,overflow:'hidden'}}>
              {['today','week','month'].map(r=>(
                <button key={r} onClick={()=>setDateRange(r)}
                  style={{padding:'7px 10px',border:'none',cursor:'pointer',fontSize:12,fontWeight:500,background:dateRange===r?'rgba(255,255,255,0.25)':'transparent',color:'#ffffff'}}>
                  {r==='today'?'Today':r==='week'?'Week':'Month'}
                </button>
              ))}
            </div>
          )}
          {isMobile&&(
            <select value={dateRange} onChange={e=>setDateRange(e.target.value)}
              style={{padding:'7px 10px',border:'1px solid rgba(255,255,255,0.25)',borderRadius:8,fontSize:12,background:'rgba(255,255,255,0.12)',color:'#ffffff',outline:'none'}}>
              <option value="today">Today</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          )}
          <button onClick={fetchAll} style={{padding:'7px 9px',border:'1px solid rgba(255,255,255,0.25)',borderRadius:8,cursor:'pointer',background:'rgba(255,255,255,0.12)',color:'#ffffff',display:'flex',alignItems:'center'}}><IconRefresh size={14}/></button>
          {!isMobile&&(
            <div style={{display:'flex',alignItems:'center',gap:5,fontSize:11,fontWeight:700,color:rtConnected?'#4ade80':'rgba(255,255,255,0.5)',letterSpacing:'0.02em'}}>
              <div style={{width:8,height:8,borderRadius:'50%',background:rtConnected?'#22c55e':'rgba(255,255,255,0.4)',boxShadow:rtConnected?'0 0 6px #22c55e':undefined,flexShrink:0}}/>
              {rtConnected?'Live':'Offline'}
            </div>
          )}
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

        {/* CALLBACK REMINDER BAR */}
        {callbackTasks.length>0&&(
          <div style={{background:'#FFF7ED',border:'1px solid #FDE68A',borderRadius:10,padding:'12px 14px',marginBottom:14}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:callbackTasks.length>0?8:0}}>
              <span style={{fontSize:13,fontWeight:700,color:'#92400E'}}>📞 You have {callbackTasks.length} callback{callbackTasks.length>1?'s':''} due today!</span>
              <button onClick={()=>setCallbackTasks([])} style={{background:'transparent',border:'1px solid #FCD34D',color:'#92400E',padding:'3px 8px',borderRadius:6,cursor:'pointer',fontSize:11,fontWeight:600,flexShrink:0}}>Dismiss All</button>
            </div>
            {callbackTasks.map((task,i)=>(
              <div key={task.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 0',borderTop:'1px solid #FDE68A'}}>
                <div style={{minWidth:0,flex:1}}>
                  <div style={{fontWeight:600,fontSize:12,color:'#92400E',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{task.title.replace('Callback: ','')}</div>
                  <div style={{fontSize:11,color:'#B45309',marginTop:1}}>
                    {compareIST(task.due_date,nowIST())<0?'Overdue · ':'Today · '}
                    {fmtISTDate(task.due_date)} {fmtISTTime(task.due_date)}
                    {task.notes&&` · ${task.notes}`}
                  </div>
                </div>
                <button onClick={()=>{const lead=myLeads.find(l=>l.id===task.lead_id);if(lead)openCallingWorkspace(lead)}}
                  style={{marginLeft:10,background:'#92400E',color:'white',border:'none',padding:'5px 10px',borderRadius:6,cursor:'pointer',fontSize:11,fontWeight:600,flexShrink:0,display:'flex',alignItems:'center',gap:4}}>
                  <IconPhone size={12}/>Call Now
                </button>
              </div>
            ))}
          </div>
        )}

        {/* PIPELINE CARDS — 2x2 on mobile */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
          <div style={{fontSize:11,fontWeight:700,color:txt2,textTransform:'uppercase',letterSpacing:'0.6px'}}>📊 Pipeline Overview</div>
          <button onClick={()=>setShowPipeline(p=>!p)} style={{padding:'3px 10px',borderRadius:20,border:'1px solid #e5e7eb',background:'white',cursor:'pointer',fontSize:11,fontWeight:600,color:'#6b7280'}}>
            {showPipeline?'Hide':'Show'}
          </button>
        </div>
        {showPipeline && (
          <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:10,marginBottom:10}}>
            {PIPELINE_CARDS.map(s=>(
              <div key={s.label}
                onClick={()=>{setFilterStatus(s.status);setActiveTab('leads')}}
                style={{background:s.bg,borderRadius:12,padding:isMobile?'12px':16,cursor:'pointer',border:'1px solid rgba(0,0,0,0.05)'}}>
                <div style={{fontSize:isMobile?24:32,fontWeight:700,color:s.color,lineHeight:1,marginBottom:4}}>{s.value}</div>
                <div style={{fontSize:isMobile?11:12,fontWeight:600,color:s.color}}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* STAT CARDS — 2x2 on mobile */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
          <div style={{fontSize:11,fontWeight:700,color:txt2,textTransform:'uppercase',letterSpacing:'0.6px'}}>📈 Today's Stats</div>
          <button onClick={()=>setShowStatCards(p=>!p)} style={{padding:'3px 10px',borderRadius:20,border:'1px solid #e5e7eb',background:'white',cursor:'pointer',fontSize:11,fontWeight:600,color:'#6b7280'}}>
            {showStatCards?'Hide':'Show'}
          </button>
        </div>
        {showStatCards && (
          <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:10,marginBottom:10}}>
            {[
              {icon:<IconUsers size={16}/>,        label:'Total Leads',  value:myLeads.length,                                                    color:'#185FA5',bg:'#E6F1FB'},
              {icon:<IconPhoneIncoming size={16}/>, label:'Calls Made',   value:myCalls.length,                                                    color:'#0F6E56',bg:'#E1F5EE'},
              {icon:<IconClockHour4 size={16}/>,    label:'Pending Tasks',value:pendingTasks.length,                                               color:'#854F0B',bg:'#FAEEDA'},
              {icon:<IconCircleCheck size={16}/>,   label:'Approvals',    value:myLeads.filter(l=>['Approved','Disbursed'].includes(l.status)).length,color:'#534AB7',bg:'#EEEDFE'},
            ].map(s=>(
              <div key={s.label} style={{background:bg1,border:'1px solid '+bdr,borderRadius:12,padding:isMobile?'12px':14,display:'flex',alignItems:'center',gap:10,boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
                <div style={{width:32,height:32,borderRadius:8,background:s.bg,display:'flex',alignItems:'center',justifyContent:'center',color:s.color,flexShrink:0}}>{s.icon}</div>
                <div>
                  <div style={{fontSize:10,color:txt2,marginBottom:2}}>{s.label}</div>
                  <div style={{fontSize:20,fontWeight:700,color:s.color,lineHeight:1}}>{s.value}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* EXPORT BUTTON with show/hide toggle */}
        <div style={{background:bg1,borderRadius:10,border:'1px solid '+bdr,marginBottom:10,overflow:'hidden'}}>
          <div style={{padding:'10px 14px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontSize:13,fontWeight:600,color:txt1}}>📥 Export Leads Report</span>
            </div>
            <button
              onClick={()=>setShowExportPanel(p=>!p)}
              style={{padding:'3px 10px',borderRadius:20,border:'1px solid #e5e7eb',background:'white',cursor:'pointer',fontSize:11,fontWeight:600,color:'#6b7280'}}>
              {showExportPanel?'Hide':'Show'}
            </button>
          </div>
          {showExportPanel&&(
            <div style={{padding:'0 14px 14px',borderTop:'1px solid '+bdr}}>
              {!isMobile&&<div style={{fontSize:12,color:txt2,marginBottom:10,paddingTop:10}}>Filter by stage or date range before exporting.</div>}
              <button onClick={()=>setShowExportModal(true)}
                className="mobile-button"
                style={{display:'flex',alignItems:'center',gap:6,background:'#185FA5',color:'white',border:'none',padding:'10px 16px',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:600}}>
                <IconDownload size={14}/>Export
              </button>
            </div>
          )}
        </div>

        {/* TABS */}
        <div style={{display:'flex',borderBottom:'1px solid '+bdr,marginBottom:14}}>
          {[{id:'leads',label:'Leads',count:myLeads.length},{id:'calls',label:'Calls',count:myCalls.length},{id:'tasks',label:'Tasks',count:pendingTasks.length}].map(t=>(
            <button key={t.id} onClick={()=>setActiveTab(t.id)}
              style={{padding:'9px 20px',border:'none',background:'transparent',fontSize:13,fontWeight:600,cursor:'pointer',
                color:activeTab===t.id?'#185FA5':txt2,
                borderBottom:activeTab===t.id?'2px solid #185FA5':'2px solid transparent',
                marginBottom:-1,display:'flex',alignItems:'center',gap:6,transition:'color 0.15s'}}>
              {t.label}
              <span style={{background:activeTab===t.id?'#E6F1FB':bg2,color:activeTab===t.id?'#185FA5':txt2,borderRadius:20,padding:'1px 8px',fontSize:11,fontWeight:700}}>{t.count}</span>
            </button>
          ))}
        </div>

        {/* ════════ LEADS TAB ════════ */}
        {activeTab==='leads'&&(
          <div>
            {/* POWER DIALER BUTTON — heavy physical master switch */}
            <div style={{borderRadius:14,padding:'0 0 4px',marginBottom:10,background:'rgba(10,40,40,0.25)',boxShadow:'inset 0 -3px 6px rgba(0,0,0,0.15)'}}>
              <button onClick={startPowerDialer}
                onMouseEnter={e=>{e.currentTarget.style.boxShadow='0 6px 20px rgba(20,88,88,0.5), 0 3px 8px rgba(20,88,88,0.3), inset 0 1px 0 rgba(255,255,255,0.2), inset 0 -3px 6px rgba(0,0,0,0.25)'; e.currentTarget.style.transform='translateY(-1px)'}}
                onMouseLeave={e=>{e.currentTarget.style.boxShadow='0 4px 15px rgba(26,107,107,0.45), inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -3px 6px rgba(0,0,0,0.25)'; e.currentTarget.style.transform='translateY(0)'}}
                onMouseDown={e=>{e.currentTarget.style.transform='translateY(2px)'; e.currentTarget.style.boxShadow='0 2px 6px rgba(20,88,88,0.4), inset 0 3px 6px rgba(0,0,0,0.3)'}}
                onMouseUp={e=>{e.currentTarget.style.transform='translateY(-1px)'; e.currentTarget.style.boxShadow='0 6px 20px rgba(20,88,88,0.5), inset 0 1px 0 rgba(255,255,255,0.2)'}}
                style={{width:'100%',padding:'12px 20px',background:'linear-gradient(135deg,#1e7a7a,#1a6b6b,#145858)',color:'#fff',border:'none',borderRadius:12,fontSize:14,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:10,boxShadow:'0 4px 15px rgba(26,107,107,0.45), inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -3px 6px rgba(0,0,0,0.25)',letterSpacing:'0.3px',transition:'all 0.15s ease'}}>
                <IconBolt size={17}/> ⚡ Start Power Dialer — {filteredLeads.length||myLeads.length} Leads
              </button>
            </div>

            {/* FILTER BAR — simple clean style */}
            <div style={filterBarWrapStyle}>
              <div style={{flex:'1 1 280px',minWidth:0,position:'relative'}}>
                <IconSearch size={14} color="#A0AEC0" style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',pointerEvents:'none'}}/>
                <input
                  className="mobile-input"
                  style={{...filterSearchStyle,width:'100%',boxSizing:'border-box'}}
                  placeholder="Search name, mobile…"
                  value={search} onChange={e=>setSearch(e.target.value)}
                  onFocus={e=>{e.currentTarget.style.borderColor='#185FA5'}}
                  onBlur={e=>{e.currentTarget.style.borderColor='#d1d5db'}}/>
                {search&&(
                  <button
                    onClick={()=>setSearch('')}
                    style={filterClearBtnStyle}>
                    ✕
                  </button>
                )}
              </div>
              <div style={{position:'relative',flexShrink:0}}>
                <button type='button' onClick={()=>setAgentStatusDropOpen(o=>!o)}
                  style={{...filterClayStage,whiteSpace:'nowrap'}}>
                  {agentStatusSet.length===0?'All Stages':`${agentStatusSet.length} selected`} ▾
                </button>
                {agentStatusDropOpen&&(
                  <div style={{position:'absolute',top:'110%',left:0,zIndex:50,background:bg1,border:'1px solid '+bdr,borderRadius:8,boxShadow:'0 8px 24px rgba(0,0,0,0.12)',padding:8,minWidth:180,maxHeight:280,overflowY:'auto'}}>
                    <label style={{display:'flex',alignItems:'center',gap:8,padding:'5px 8px',fontSize:13,cursor:'pointer',color:txt1}}><input type='checkbox' checked={agentStatusSet.length===0} onChange={()=>setAgentStatusSet([])}/> All Stages</label>
                    {stageNames.map(s=>(
                      <label key={s} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 8px',fontSize:13,cursor:'pointer',color:txt1}}><input type='checkbox' checked={agentStatusSet.includes(s)} onChange={()=>setAgentStatusSet(prev=>prev.includes(s)?prev.filter(x=>x!==s):[...prev,s])}/> {s}</label>
                    ))}
                  </div>
                )}
              </div>
              <div style={{position:'relative',display:'inline-block'}}>
                <select value={filterLoanAmount} onChange={e=>setFilterLoanAmount(e.target.value)}
                  style={{...filterClayAmount,paddingRight:30,flexShrink:0}}>
                  <option value="">All Amounts</option>
                  <option value="0-100000">Up to ₹1 Lakh</option>
                  <option value="100000-300000">₹1L - ₹3L</option>
                  <option value="300000-500000">₹3L - ₹5L</option>
                  <option value="500000-1000000">₹5L - ₹10L</option>
                  <option value="1000000-2000000">₹10L - ₹20L</option>
                  <option value="2000000-99999999">Above ₹20L</option>
                </select>
                <span style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',color:'#6b7280',fontSize:9,pointerEvents:'none',fontWeight:700}}>▼</span>
              </div>
              <div style={{position:'relative',display:'inline-block'}}>
                <select value={filterCity} onChange={e=>setFilterCity(e.target.value)}
                  style={{...filterClayCity,paddingRight:30,flexShrink:0}}>
                  <option value="">All Cities</option>
                  {[...new Set(myLeads.map(l=>l.city).filter(Boolean))].sort().map(city=>(
                    <option key={city} value={city}>{city}</option>
                  ))}
                </select>
                <span style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',color:'#6b7280',fontSize:9,pointerEvents:'none',fontWeight:700}}>▼</span>
              </div>
              <input type='date' value={agentDateFrom} onChange={e=>setAgentDateFrom(e.target.value)}
                style={{...filterClayDate,flexShrink:0}}/>
              <input type='date' value={agentDateTo} onChange={e=>setAgentDateTo(e.target.value)}
                style={{...filterClayDate,flexShrink:0}}/>
            </div>

            {/* MOBILE: card layout | DESKTOP: table layout */}
            {isMobile?(
              <div>
                {loading?(
                  <div style={{padding:30,textAlign:'center',color:txt2}}>Loading…</div>
                ):filteredLeads.length===0?(
                  <div style={{padding:30,textAlign:'center',color:txt2,background:bg1,borderRadius:12,border:'1px solid '+bdr}}>
                    <IconUsers size={32} strokeWidth={1.2} color="#CBD5E0" style={{display:'block',margin:'0 auto 8px'}}/>
                    {search||agentStatusSet.length||agentDateFrom||agentDateTo?'No leads match':'No leads assigned yet'}
                  </div>
                ):filteredLeads.map(lead=>{
                  const isMirrorLead=Array.isArray(lead.mirror_agents)&&lead.mirror_agents.includes(userId)&&lead.assigned_to!==userId
                  const displayStatus=isMirrorLead?(lead.mirror_agent_statuses?.[userId]||lead.status):lead.status
                  const st=stageBadgeStyle[displayStatus]||{bg:'#F1EFE8',color:'#5F5E5A'}
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
                            {lead.application_id&&<div style={{fontSize:10,color:txt2,marginTop:1}}>App# {lead.application_id}</div>}
                            {lead.sheet_number&&<div style={{fontSize:10,color:txt2,marginTop:1}}>📄 {lead.sheet_number}</div>}
                            {lead.previous_status&&lead.previous_status!=='New'&&<div style={{display:'inline-block',marginTop:2,fontSize:10,fontWeight:600,color:'#92400E',background:'#FEF3C7',padding:'1px 7px',borderRadius:10}}>was: {lead.previous_status}</div>}
                            {(()=>{const obs=leadObligations[lead.id]||[];if(!obs.length)return null;const totalObl=obs.reduce((s,o)=>s+calculateObligatedEMI(o),0);const sal=parseFloat(lead.monthly_salary)||0;const foir=sal>0?Math.round((totalObl/sal)*100):null;return(<div style={{fontSize:10,color:'#6366f1',fontWeight:600,marginTop:1}}>📋 Obl. EMI: ₹{totalObl.toLocaleString('en-IN')}{foir!==null?` | FOIR: ${foir}%`:''}</div>)})()}
                            {lead.notes&&<div style={{fontSize:10,color:'#059669',fontWeight:600,marginTop:1}}>📝 Notes updated</div>}
                            {leadCallbackMap[lead.id]&&(
                              <div style={{fontSize:10,color:'#92400E',fontWeight:600,marginTop:1}}>
                                📅 {fmtISTDate(leadCallbackMap[lead.id].due_date)} {fmtISTTime(leadCallbackMap[lead.id].due_date)}
                              </div>
                            )}
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
                          style={{background:st.bg,color:st.color,border:'none',padding:'6px 10px',borderRadius:20,fontSize:12,fontWeight:600,cursor:'pointer',outline:'none',boxShadow:'0 1px 3px rgba(0,0,0,0.1)'}}>
                          {stageNames.map(s=><option key={s} value={s} style={{background:'white',color:'black'}}>{s}</option>)}
                        </select>
                      </div>

                      {/* Action buttons */}
                      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:6}}>
                        <button onClick={()=>openCallingWorkspace(lead)}
                          style={actionBtnLabeledStyles.call}>
                          <IconPhone size={16}/>
                          <span style={{fontSize:10,fontWeight:600}}>Call</span>
                        </button>
                        <button onClick={(e)=>{e.stopPropagation();setShowWAQuick(prev=>prev===lead.id?null:lead.id)}}
                          style={actionBtnLabeledStyles.whatsapp}>
                          <IconBrandWhatsapp size={16}/>
                          <span style={{fontSize:10,fontWeight:600}}>WhatsApp</span>
                        </button>
                        <button onClick={()=>openObligationModal(lead)}
                          style={actionBtnLabeledStyles.obligations}>
                          <IconBuildingStore size={16}/>
                          <span style={{fontSize:10,fontWeight:600}}>Obligations</span>
                        </button>
                        <button onClick={()=>openObligationModal(lead,true)}
                          style={actionBtnLabeledStyles.viewObs}>
                          <IconEye size={16}/>
                          <span style={{fontSize:10,fontWeight:600}}>View Obs</span>
                        </button>
                        <button onClick={()=>{
                            const freshLead=myLeads.find(l=>l.id===lead.id)||lead
                            setNoteLead(freshLead); setNoteText(''); setShowNoteModal(true)
                          }}
                          style={actionBtnLabeledStyles.note}>
                          <IconNotes size={16}/>
                          <span style={{fontSize:10,fontWeight:600}}>Note</span>
                        </button>
                        <button onClick={()=>setViewLead(lead)}
                          style={actionBtnLabeledStyles.view}>
                          <IconEye size={16}/>
                          <span style={{fontSize:10,fontWeight:600}}>View</span>
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            ):(
              // DESKTOP TABLE
              <div className="mobile-table" style={{background:bg1,border:'1px solid '+bdr,borderRadius:12,overflow:'hidden'}}>
                <div style={{padding:'11px 16px',borderBottom:'1px solid '+(darkMode?bdr:'#F3F4F6'),background:darkMode?bg2:'#FAFAFA',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span style={{fontWeight:600,fontSize:13,color:txt1}}>{agentStatusSet.length===1?`${agentStatusSet[0]} (${filteredLeads.length})`:agentStatusSet.length>1?`${agentStatusSet.length} stages (${filteredLeads.length})`:`All Leads (${filteredLeads.length})`}</span>
                  <div style={{display:'flex',gap:6}}>
                    {['New','Interested','Callback'].map(s=>{const st=stageStyle(s);return <span key={s} style={{background:st.bg,color:st.color,padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:500}}>{myLeads.filter(l=>l.status===s).length} {s}</span>})}
                  </div>
                </div>
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <thead>
                      <tr style={{background:darkMode?'#0f172a':'#F9FAFB'}}>
                        {['Lead','Loan Amt','Stage','Temp','Pipeline','Actions'].map(h=>(
                          <th key={h} style={{padding:'10px 14px',fontSize:11,fontWeight:600,color:txt2,textAlign:'left',textTransform:'uppercase',letterSpacing:'0.4px',whiteSpace:'nowrap',display:(h==='Temp'||h==='Pipeline')?'none':undefined}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {loading?(
                        <tr><td colSpan={6} style={{padding:40,textAlign:'center',fontSize:13,color:txt2}}>Loading…</td></tr>
                      ):filteredLeads.length===0?(
                        <tr><td colSpan={6} style={{padding:40,textAlign:'center'}}>
                          <IconUsers size={36} strokeWidth={1.2} color="#CBD5E0" style={{display:'block',margin:'0 auto 8px'}}/>
                          <div style={{fontSize:13,color:txt2}}>{search||agentStatusSet.length||agentDateFrom||agentDateTo?'No leads match':'No leads assigned yet'}</div>
                        </td></tr>
                      ):filteredLeads.map(lead=>{
                        const isMirrorLead=Array.isArray(lead.mirror_agents)&&lead.mirror_agents.includes(userId)&&lead.assigned_to!==userId
                        const displayStatus=isMirrorLead?(lead.mirror_agent_statuses?.[userId]||lead.status):lead.status
                        const pIdx=PIPELINE.indexOf(displayStatus)
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
                                  <div style={{display:'flex',alignItems:'center',gap:8,fontSize:11,color:txt2}}>
                                    <span>{lead.mobile}{lead.city?` · ${lead.city}`:''}</span>
                                  </div>
                                  {lead.application_id&&<div style={{fontSize:10,color:'#9CA3AF'}}>App# {lead.application_id}</div>}
                                  {lead.call_count>0&&<div style={{fontSize:10,color:'#9CA3AF'}}>📞 {lead.call_count} calls</div>}
                                  {(()=>{const obs=leadObligations[lead.id]||[];if(!obs.length)return null;const totalObl=obs.reduce((s,o)=>s+calculateObligatedEMI(o),0);const sal=parseFloat(lead.monthly_salary)||0;const foir=sal>0?Math.round((totalObl/sal)*100):null;return(<div style={{fontSize:10,color:'#6366f1',fontWeight:600,marginTop:1}}>📋 Obl. EMI: ₹{totalObl.toLocaleString('en-IN')}{foir!==null?` | FOIR: ${foir}%`:''}</div>)})()}
                                  {lead.notes&&<div style={{fontSize:10,color:'#059669',fontWeight:600,marginTop:1}}>📝 Notes updated</div>}
                                  {leadCallbackMap[lead.id]&&(
                                    <div style={{fontSize:10,color:'#92400E',fontWeight:600,marginTop:1}}>
                                      📅 Callback: {fmtISTDate(leadCallbackMap[lead.id].due_date)} {fmtISTTime(leadCallbackMap[lead.id].due_date)}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td style={{padding:'12px 14px'}}>
                              <div style={{fontWeight:600,color:'#185FA5',fontSize:13}}>{fmtAmt(lead.loan_amount)}</div>
                              {lead.monthly_salary&&<div style={{fontSize:10,color:txt2}}>Sal: {fmtAmt(lead.monthly_salary)}</div>}
                            </td>
                            <td style={{padding:'12px 14px'}}>
                              <select value={lead.status||'New'} onChange={e=>updateLeadStatus(lead.id,e.target.value)}
                                style={{
                                  background:(stageBadgeStyle[lead.status]||{bg:'#F1EFE8'}).bg,
                                  color:(stageBadgeStyle[lead.status]||{color:'#5F5E5A'}).color,
                                  border:'none',
                                  padding:'6px 28px 6px 12px',
                                  borderRadius:20,
                                  fontSize:12,
                                  fontWeight:600,
                                  cursor:'pointer',
                                  outline:'none',
                                  appearance:'none',
                                  WebkitAppearance:'none',
                                  boxShadow:'0 1px 3px rgba(0,0,0,0.1)',
                                  minWidth:140
                                }}>
                                {stageNames.map(s=><option key={s} value={s} style={{background:'white',color:'black'}}>{s}</option>)}
                              </select>
                            </td>
                            <td style={{padding:'12px 14px',display:'none'}}>
                              <span style={{background:tc.bg,color:tc.color,padding:'3px 8px',borderRadius:20,fontSize:11,fontWeight:600}}>{tc.icon} {lead.lead_temperature||'Cold'}</span>
                            </td>
                            <td style={{padding:'12px 14px',display:'none'}}>
                              <div style={{display:'flex',gap:3,marginBottom:3}}>
                                {PIPELINE.map((s,i)=>(
                                  <div key={s} title={s} style={{height:5,width:18,borderRadius:3,background:i<=pIdx?'#185FA5':'#E2E8F0'}}/>
                                ))}
                              </div>
                              <div style={{fontSize:10,color:txt2}}>{pIdx>=0&&pIdx<PIPELINE.length-1?`Next: ${PIPELINE[pIdx+1]}`:pIdx===PIPELINE.length-1?'✅ Final':''}</div>
                            </td>
                            <td style={{padding:'8px 14px'}}>
                              <div style={{display:'flex',gap:6}}>
                                <button title="Call" onClick={()=>openCallingWorkspace(lead)}
                                  style={actionBtnSimpleStyles.call}>
                                  <IconPhone size={14}/>
                                  <span>Call</span>
                                </button>
                                <button title="WhatsApp" onClick={(e)=>{
                                    e.stopPropagation()
                                    if(showWAQuick===lead.id){ setShowWAQuick(null); return }
                                    const rect=e.currentTarget.getBoundingClientRect()
                                    setWaQuickPos({top:rect.bottom+6, left:rect.left})
                                    setShowWAQuick(lead.id)
                                  }}
                                  style={actionBtnSimpleStyles.whatsapp}>
                                  <IconBrandWhatsapp size={14}/>
                                  <span>WhatsApp</span>
                                </button>
                                <button title="Obligations" onClick={()=>openObligationModal(lead)}
                                  style={actionBtnSimpleStyles.obligations}>
                                  <IconBuildingStore size={14}/>
                                  <span>Obligations</span>
                                </button>
                                <button title="View Obligations" onClick={()=>openObligationModal(lead,true)}
                                  style={actionBtnSimpleStyles.viewObs}>
                                  <IconEye size={14}/>
                                  <span>View Obs</span>
                                </button>
                                <button title="Note" onClick={()=>{
                                    const freshLead=myLeads.find(l=>l.id===lead.id)||lead
                                    setNoteLead(freshLead); setNoteText(''); setShowNoteModal(true)
                                  }}
                                  style={actionBtnSimpleStyles.note}>
                                  <IconNotes size={14}/>
                                  <span>Note</span>
                                </button>
                                <button title="View" onClick={()=>setViewLead(lead)}
                                  style={actionBtnSimpleStyles.view}>
                                  <IconEye size={14}/>
                                  <span>View</span>
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
                            <div style={{display:'flex',alignItems:'center',gap:8}}>
                            <span>{lead?.mobile||'-'}</span>
                          </div>
                            <span>·</span>
                            <span>{call.duration||'-'}</span>
                            <span>·</span>
                            <span>{new Date(call.created_at).toLocaleDateString('en-IN',{timeZone:IST_TZ})}</span>
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
                              <td style={{padding:'11px 14px',fontSize:13,color:txt2}}>
                                <div style={{display:'flex',alignItems:'center',gap:8}}>
                                  <span>{lead?.mobile||'-'}</span>
                                </div>
                              </td>
                              <td style={{padding:'11px 14px'}}><span style={{...cs,padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:500}}>{call.call_status}</span></td>
                              <td style={{padding:'11px 14px'}}>{call.call_outcome&&<span style={{background:'#FAEEDA',color:'#854F0B',padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:500}}>{call.call_outcome}</span>}</td>
                              <td style={{padding:'11px 14px',fontSize:13,color:txt2}}>{call.duration||'-'}</td>
                              <td style={{padding:'11px 14px',fontSize:12,color:txt2}}>{new Date(call.created_at).toLocaleDateString('en-IN',{timeZone:IST_TZ})}</td>
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
                  const od=compareIST(task.due_date,nowIST())<0
                  const prC={High:{bg:'#FCEBEB',color:'#991B1B'},Medium:{bg:'#FAEEDA',color:'#92400E'},Low:{bg:'#EAF3DE',color:'#166634'}}[task.priority]||{bg:'#EAF3DE',color:'#166634'}
                  return(
                    <div key={task.id} style={{background:bg1,border:'1px solid '+(od?'#FCA5A5':bdr),borderRadius:10,padding:'13px 14px',marginBottom:8,borderLeft:'3px solid '+(od?'#EF4444':task.priority==='High'?'#EF4444':task.priority==='Medium'?'#F59E0B':'#22C55E')}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                        <div style={{flex:1,minWidth:0,marginRight:8}}>
                          <div style={{fontWeight:600,fontSize:13,color:od?'#DC2626':txt1,marginBottom:3}}>{od&&'⚠️ '}{task.title}</div>
                          {task.notes&&<div style={{fontSize:12,color:txt2,marginBottom:3}}>📝 {task.notes}</div>}
                          <div style={{fontSize:11,color:od?'#DC2626':txt2,fontWeight:od?600:400}}>🕐 {fmtIST(task.due_date)}</div>
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

      {/* ════════ VIEW LEAD MODAL ════════ */}
      {viewLead&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={()=>setViewLead(null)}>
          <div style={{background:bg1,borderRadius:16,padding:24,maxWidth:440,width:'100%',boxShadow:'0 16px 48px rgba(0,0,0,0.2)'}} onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
              <div>
                <div style={{fontWeight:700,fontSize:16,color:txt1}}>{viewLead.full_name}</div>
                <div style={{fontSize:13,color:txt2}}>{viewLead.mobile}</div>
              </div>
              <button onClick={()=>setViewLead(null)} style={{background:'none',border:'none',cursor:'pointer',fontSize:22,color:txt2,lineHeight:1}}>×</button>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              {[
                ['Current Status',viewLead.status||'—'],
                ['Previous Status',viewLead.previous_status||'—'],
                ['Previous Agent',viewLead.previous_agent_name||'—'],
                ['Sheet No.',viewLead.sheet_number||'—'],
                ['City',viewLead.city||'—'],
                ['Loan Amount',fmtAmt(viewLead.loan_amount)],
                ['Company',viewLead.company||'—'],
                ['App ID',viewLead.application_id||'—'],
              ].map(([label,val])=>(
                <div key={label} style={{background:bg0,borderRadius:8,padding:'10px 12px'}}>
                  <div style={{fontSize:11,color:txt2,marginBottom:3}}>{label}</div>
                  <div style={{fontSize:13,fontWeight:600,color:txt1,wordBreak:'break-word'}}>{val}</div>
                </div>
              ))}
            </div>
            {viewLead.notes&&(
              <div style={{marginTop:10,background:bg0,borderRadius:8,padding:'10px 12px'}}>
                <div style={{fontSize:11,color:txt2,marginBottom:3}}>Notes</div>
                <div style={{fontSize:13,color:txt1,lineHeight:1.5}}>{viewLead.notes}</div>
              </div>
            )}
            {(leadObligations[viewLead.id]||[]).length>0&&(<div style={{marginTop:10,background:bg0,borderRadius:8,padding:'10px 12px'}}><div style={{fontSize:11,color:txt2,marginBottom:6,fontWeight:600}}>Obligations</div>{(leadObligations[viewLead.id]||[]).map((ob,i)=>(<div key={i} style={{display:'flex',justifyContent:'space-between',fontSize:12,color:txt1,padding:'3px 0',borderBottom:'1px solid rgba(0,0,0,0.05)'}}><span>{ob.bank_name||'Bank '+(i+1)}</span><span style={{fontWeight:600}}>EMI: ₹{Number(ob.emi_amount||0).toLocaleString('en-IN')}</span></div>))}<div style={{marginTop:6,fontSize:12,fontWeight:700,color:'#6366f1'}}>Total EMI: ₹{(leadObligations[viewLead.id]||[]).reduce((s,o)=>s+(parseFloat(o.emi_amount)||0),0).toLocaleString('en-IN')}</div></div>)}
            {(leadObligations[viewLead.id]||[]).length>0&&(<div style={{marginTop:10,background:bg0,borderRadius:8,padding:'10px 12px'}}><div style={{fontSize:11,color:txt2,marginBottom:6,fontWeight:600}}>Obligations</div>{(leadObligations[viewLead.id]||[]).map((ob,i)=>(<div key={i} style={{display:'flex',justifyContent:'space-between',fontSize:12,color:txt1,padding:'3px 0',borderBottom:'1px solid rgba(0,0,0,0.05)'}}><span>{ob.bank_name||'Bank '+(i+1)}</span><span style={{fontWeight:600}}>EMI: ₹{Number(ob.emi_amount||0).toLocaleString('en-IN')}</span></div>))}<div style={{marginTop:6,fontSize:12,fontWeight:700,color:'#6366f1'}}>Total EMI: ₹{(leadObligations[viewLead.id]||[]).reduce((s,o)=>s+(parseFloat(o.emi_amount)||0),0).toLocaleString('en-IN')}</div></div>)}
          </div>
        </div>
      )}

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

  const markAgentDbNotifsRead=async()=>{
    const ids=agentDbNotifs.filter(n=>!n.read).map(n=>n.id)
    if(!ids.length)return
    await supabase.from('notifications').update({read:true}).in('id',ids)
    setAgentDbNotifs(prev=>prev.map(n=>({...n,read:true})))
    setAgentDbUnread(0)
  }

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
    // No DB-side due_date filter — tasks.due_date is `timestamptz`, and a
    // naive IST string compared server-side would be evaluated in UTC terms.
    // Fetch broadly and compare through the canonical IST module instead.
    const{data}=await supabase.from('tasks').select('*,profiles!tasks_assigned_to_fkey(full_name)').in('assigned_to',ids).in('status',['Pending','In Progress'])
    const overdue=(data||[]).filter(t=>t.due_date&&compareIST(t.due_date,nowIST())<0)
    setOverdueAlerts(overdue)
  }

  const fetchAll=async(opts={})=>{
    if(!opts.silent) setLoading(true)
    const now=new Date(),sd=new Date()
    if(dateRange==='today') sd.setHours(0,0,0,0)
    else if(dateRange==='week')  sd.setDate(now.getDate()-7)
    else if(dateRange==='month') sd.setDate(1)
    const{data:ag}=await supabase.from('profiles').select('*').eq('team_leader_id',userId).eq('status','active')
    const agL=ag||[]; setMyAgents(agL)
    if(!agL.length){setLeads([]);setCalls([]);setAgentStats([]);setLoading(false);return}
    const ids=agL.map(a=>a.id)
    const[lR,cR]=await Promise.all([
      supabase.from('leads').select('*').in('assigned_to',ids).order('created_at',{ascending:false}),
      supabase.from('calls').select('*').in('agent_id',ids).gte('created_at',sd.toISOString()),
    ])
    const allL=lR.data||[],cL=cR.data||[]
    // Filter leads by date matching created_at OR assigned_at so reassigned leads appear
    const inDateRange=(ts)=>!!ts&&new Date(ts)>=sd
    const lL=allL.filter(l=>inDateRange(l.created_at)||inDateRange(l.assigned_at))
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
                  <div style={{fontSize:12,color:'#718096'}}>Agent: {t.profiles?.full_name||'Unknown'} · Due: {fmtIST(t.due_date)}</div>
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

  const fetchAll=async(opts={})=>{
    if(!opts.silent) setLoading(true)
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
          {[{id:'overview',label:'Overview'},{id:'agents',label:'Agents'},{id:'calls',label:'Call Logs'},{id:'teams',label:'Teams'}].map(t=>(
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

        {activeTab==='calls'&&(
          <div className="table-container">
            <div style={{padding:'12px 16px',borderBottom:'1px solid #E2E8F0',display:'flex',justifyContent:'space-between'}}>
              <span style={{fontWeight:600,fontSize:14}}>All Call Logs</span>
              <span style={{fontSize:12,color:'#A0AEC0'}}>{calls.length} records</span>
            </div>
            {loading?
              <div style={{padding:40,textAlign:'center',color:'#A0AEC0'}}>Loading…</div>
            :calls.length===0?
              <div className="empty-state" style={{padding:24}}><h3>No call logs yet</h3></div>
            :isMobile?
              <div style={{padding:'8px 12px'}}>
                {calls.map(call=>{
                  const lead = leads.find(l=>l.id===call.lead_id)
                  const agent = myAgents.find(a=>a.id===call.agent_id)
                  return(
                    <div key={call.id} style={{padding:'12px 0',borderBottom:'1px solid #F3F4F6'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                        <div style={{fontWeight:600,fontSize:13,color:'#2D3748'}}>{lead?.full_name||'Unknown Lead'}</div>
                        <span style={{fontSize:12,color:'#6B7280'}}>{call.duration||'-'}</span>
                      </div>
                      <div style={{display:'flex',flexWrap:'wrap',gap:8,fontSize:12,color:'#718096'}}>
                        <span>{agent?.full_name||'Unknown Agent'}</span>
                        <span>·</span>
                        <span>{call.call_status||'Status'}</span>
                        <span>·</span>
                        <span>{call.call_outcome||'-'}</span>
                        <span>·</span>
                        <span>{new Date(call.created_at).toLocaleDateString('en-IN',{timeZone:IST_TZ})}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            :
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead>
                    <tr style={{background:'#F9FAFB'}}>
                      {['Lead','Agent','Status','Disposition','Duration','Date'].map(h=>(
                        <th key={h} style={{padding:'10px 14px',fontSize:11,fontWeight:600,color:'#718096',textAlign:'left',textTransform:'uppercase',letterSpacing:'0.4px'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {calls.map(call=>{
                      const lead = leads.find(l=>l.id===call.lead_id)
                      const agent = myAgents.find(a=>a.id===call.agent_id)
                      return(
                        <tr key={call.id} style={{borderBottom:'1px solid #E2E8F0'}}>
                          <td style={{padding:'11px 14px',fontSize:13,color:'#2D3748'}}>{lead?.full_name||'Unknown'}</td>
                          <td style={{padding:'11px 14px',fontSize:13,color:'#2D3748'}}>{agent?.full_name||'Unknown'}</td>
                          <td style={{padding:'11px 14px',fontSize:13,color:'#4A5568'}}>{call.call_status}</td>
                          <td style={{padding:'11px 14px',fontSize:13,color:'#4A5568'}}>{call.call_outcome||'-'}</td>
                          <td style={{padding:'11px 14px',fontSize:13,color:'#4A5568'}}>{call.duration||'-'}</td>
                          <td style={{padding:'11px 14px',fontSize:13,color:'#4A5568'}}>{new Date(call.created_at).toLocaleDateString('en-IN',{timeZone:IST_TZ})}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            }
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

// ─── BANK STATEMENT ANALYZER ─────────────────────────────────────────────────
function BankStatementAnalyzer() {
  const BSA_P = '#185FA5'
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [dragOver, setDragOver] = useState(false)

  const toBase64 = (f) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(f)
  })

  const analyze = async () => {
    if (!file) return
    setLoading(true); setError(null); setResult(null)
    try {
      const base64 = await toBase64(file)
      const prompt = `You are an expert Indian bank statement analyzer for a lending company. Analyze this bank statement PDF thoroughly and return ONLY a valid JSON object (no markdown, no explanation, no backticks) with exactly this structure:

{
  "summary": {
    "account_holder": "name if found",
    "bank_name": "bank name",
    "account_number": "last 4 digits if visible",
    "statement_period": "from - to",
    "total_credits": 0,
    "total_debits": 0,
    "average_monthly_balance": 0,
    "net_cash_flow": 0
  },
  "risk_flags": [
    { "type": "BOUNCE/ECS_RETURN/CC_FUNDING/LOAN_STACKING/GAMBLING/MIN_BAL_CHARGE", "date": "", "description": "", "amount": 0, "severity": "HIGH/MEDIUM/LOW" }
  ],
  "watchlist": [
    { "type": "ROUND_FIGURE/UPI_LARGE/SALARY_ADVANCE/FREQUENT_ATM/INWARD_CHEQUE_RETURN", "date": "", "description": "", "amount": 0 }
  ],
  "positive_signals": [
    { "type": "REGULAR_SALARY/GST_PAYMENT/INSURANCE_PREMIUM/CONSISTENT_BALANCE", "date": "", "description": "", "amount": 0 }
  ],
  "emi_obligations": [
    { "party": "", "amount": 0, "frequency": "MONTHLY", "type": "EMI/ECS/NACH", "first_seen": "", "last_seen": "", "count": 0 }
  ],
  "cc_vendor_funding": [
    { "vendor": "", "date": "", "amount": 0, "description": "" }
  ],
  "repeat_parties": [
    { "party": "", "total_debit": 0, "total_credit": 0, "transaction_count": 0, "flag": "NORMAL/SUSPICIOUS" }
  ],
  "monthly_cashflow": [
    { "month": "", "total_credit": 0, "total_debit": 0, "closing_balance": 0, "bounce_count": 0 }
  ],
  "all_transactions": [
    { "date": "", "description": "", "debit": 0, "credit": 0, "balance": 0, "category": "SALARY/EMI/BOUNCE/ECS_RETURN/CC_FUNDING/UTILITY/ATM/UPI/TRANSFER/INSURANCE/GST/GAMBLING/OTHER", "flag": "" }
  ],
  "credit_assessment": {
    "overall_risk": "LOW/MEDIUM/HIGH",
    "income_stability": "STABLE/UNSTABLE/IRREGULAR",
    "estimated_monthly_income": 0,
    "total_emi_burden": 0,
    "foir_estimate": 0,
    "recommendation": "PROCEED/CAUTION/REJECT",
    "summary_notes": ""
  }
}

Known Credit Card / Fintech Vendors to detect (mark as CC_FUNDING): Slice, Kreditbee, KreditBee, Navi, Paytm Postpaid, LazyPay, ZestMoney, MoneyTap, EarlySalary, Early Salary, Kissht, Prefr, Faircent, Lendingkart, FlexSalary, CASHe, PaySense, Fibe, SmartCoin, StashFin, Muthoot, Manappuram, IIFL, Capital Float, Indifi, NeoGrowth, Lendbox, RupeeRedee, mPokket, Credy, AnyTimeLoan, LoanTap, Fullerton, HomeCredit, Home Credit, Bajaj Finserv, HDB Financial, HDFC Sales, Tata Capital, Aditya Birla Finance, L&T Finance, Cholamandalam.

Bounces and ECS Returns: Look for keywords like RETURN, BOUNCE, DISHONOUR, DIShonour, UNPAID, INSUFFICIENT, INWARD RTN, ECS RTN, NACH RTN, ACH RTN, CHQ RTN, CHEQUE RETURN.

Gambling: Dream11, MPL, My11Circle, Paytm First Games, BalleBaazi, Betway, 1xBet, Rummy, PokerBaazi, Adda52.

Return only the raw JSON. No markdown, no explanation.`

      const response = await fetch('/api/analyze-statement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfBase64: base64 })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Server error')
      }

      setResult(data)
    } catch (e) {
      setError('Analysis failed. Please ensure the PDF is a valid bank statement and try again. ' + e.message)
    }
    setLoading(false)
  }

  const downloadCSV = () => {
    if (!result?.all_transactions?.length) return
    const headers = ['Date','Description','Debit','Credit','Balance','Category','Flag']
    const rows = result.all_transactions.map(t => [
      t.date, `"${(t.description||'').replace(/"/g,'')}"`,
      t.debit||0, t.credit||0, t.balance||0, t.category||'', t.flag||''
    ])
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `bank_analysis_${Date.now()}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const riskColor = r => r==='HIGH'?'#dc2626':r==='MEDIUM'?'#d97706':'#16a34a'
  const sevColor  = s => s==='HIGH'?'#fef2f2':s==='MEDIUM'?'#fffbeb':'#f0fdf4'
  const sevText   = s => s==='HIGH'?'#dc2626':s==='MEDIUM'?'#d97706':'#16a34a'
  const catColor  = c => {
    if (['BOUNCE','ECS_RETURN','CC_FUNDING','GAMBLING'].includes(c)) return '#fef2f2'
    if (['SALARY','GST','INSURANCE'].includes(c)) return '#f0fdf4'
    if (['EMI','NACH','ECS'].includes(c)) return '#fffbeb'
    return 'white'
  }

  const Card = ({children, style}) => <div style={{background:'white',borderRadius:12,border:'1px solid #e5e7eb',boxShadow:'0 1px 3px rgba(0,0,0,0.05)',...style}}>{children}</div>
  const Btn  = ({onClick,disabled,children,outline,small,style}) => (
    <button onClick={onClick} disabled={disabled} style={{padding:small?'5px 12px':'8px 18px',fontSize:small?12:13,fontWeight:600,borderRadius:8,cursor:disabled?'not-allowed':'pointer',opacity:disabled?0.6:1,border:outline?'1px solid '+BSA_P:'none',background:outline?'white':BSA_P,color:outline?BSA_P:'white',whiteSpace:'nowrap',display:'inline-flex',alignItems:'center',gap:4,...style}}>{children}</button>
  )
  const Badge = ({text,color}) => <span style={{padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:600,background:(color||BSA_P)+'18',color:color||BSA_P,display:'inline-block',whiteSpace:'nowrap'}}>{text}</span>
  const TH = {padding:'10px 16px',textAlign:'left',fontSize:12,fontWeight:600,color:'#6b7280',background:'#f9fafb',borderBottom:'1px solid #e5e7eb',whiteSpace:'nowrap'}
  const TD = {padding:'10px 16px',fontSize:13,borderBottom:'1px solid #f3f4f6',verticalAlign:'middle'}

  return (
    <div style={{padding:24,background:'#f8fafc',minHeight:'100vh'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
        <div>
          <h2 style={{fontSize:18,fontWeight:700,color:'#111827',margin:0}}>🔍 Bank Statement Analyzer</h2>
          <div style={{fontSize:13,color:'#6b7280',marginTop:4}}>AI-powered credit risk analysis for loan processing</div>
        </div>
        {result && <Btn onClick={downloadCSV}>⬇ Download CSV</Btn>}
      </div>

      {!result && (
        <Card style={{padding:32,textAlign:'center',marginBottom:24}}>
          <div
            onDragOver={e=>{e.preventDefault();setDragOver(true)}}
            onDragLeave={()=>setDragOver(false)}
            onDrop={e=>{e.preventDefault();setDragOver(false);const f=e.dataTransfer.files[0];if(f?.type==='application/pdf')setFile(f)}}
            style={{border:`2px dashed ${dragOver?BSA_P:'#d1d5db'}`,borderRadius:12,padding:40,cursor:'pointer',background:dragOver?'#eff6ff':'#f9fafb',transition:'all 0.2s'}}
            onClick={()=>document.getElementById('bsa-dash-input').click()}
          >
            <div style={{fontSize:40,marginBottom:12}}>📄</div>
            <div style={{fontWeight:600,color:'#374151',marginBottom:6}}>Drop bank statement PDF here</div>
            <div style={{fontSize:13,color:'#9ca3af'}}>or click to browse · PDF only</div>
            {file && <div style={{marginTop:12,color:BSA_P,fontWeight:500,fontSize:13}}>✓ {file.name}</div>}
          </div>
          <input id="bsa-dash-input" type="file" accept="application/pdf" style={{display:'none'}} onChange={e=>setFile(e.target.files[0])}/>
          {file && (
            <Btn onClick={analyze} disabled={loading} style={{marginTop:20,padding:'10px 32px',fontSize:14}}>
              {loading?'⏳ Analyzing...':'🔍 Analyze Statement'}
            </Btn>
          )}
          {error && <div style={{marginTop:16,color:'#dc2626',fontSize:13,background:'#fef2f2',padding:'10px 16px',borderRadius:8}}>{error}</div>}
        </Card>
      )}

      {loading && (
        <Card style={{padding:48,textAlign:'center'}}>
          <div style={{fontSize:32,marginBottom:12}}>⏳</div>
          <div style={{fontWeight:600,color:'#374151',marginBottom:6}}>Analyzing Bank Statement...</div>
          <div style={{fontSize:13,color:'#9ca3af'}}>Reading transactions, detecting risks, identifying EMIs and funding patterns</div>
        </Card>
      )}

      {result && !loading && (
        <div>
          <Btn outline small onClick={()=>{setResult(null);setFile(null)}} style={{marginBottom:20}}>← Analyze Another</Btn>

          {/* Credit Assessment Banner */}
          <Card style={{padding:20,marginBottom:16,borderLeft:`4px solid ${riskColor(result.credit_assessment?.overall_risk)}`}}>
            <div style={{display:'flex',flexWrap:'wrap',gap:24,alignItems:'flex-start'}}>
              <div><div style={{fontSize:11,color:'#6b7280',fontWeight:600,marginBottom:4}}>OVERALL RISK</div><div style={{fontSize:22,fontWeight:700,color:riskColor(result.credit_assessment?.overall_risk)}}>{result.credit_assessment?.overall_risk}</div></div>
              <div><div style={{fontSize:11,color:'#6b7280',fontWeight:600,marginBottom:4}}>RECOMMENDATION</div><div style={{fontSize:16,fontWeight:700,color:result.credit_assessment?.recommendation==='PROCEED'?'#16a34a':result.credit_assessment?.recommendation==='CAUTION'?'#d97706':'#dc2626'}}>{result.credit_assessment?.recommendation}</div></div>
              <div><div style={{fontSize:11,color:'#6b7280',fontWeight:600,marginBottom:4}}>EST. MONTHLY INCOME</div><div style={{fontSize:16,fontWeight:700,color:'#111827'}}>₹{(result.credit_assessment?.estimated_monthly_income||0).toLocaleString('en-IN')}</div></div>
              <div><div style={{fontSize:11,color:'#6b7280',fontWeight:600,marginBottom:4}}>TOTAL EMI BURDEN</div><div style={{fontSize:16,fontWeight:700,color:'#d97706'}}>₹{(result.credit_assessment?.total_emi_burden||0).toLocaleString('en-IN')}</div></div>
              <div><div style={{fontSize:11,color:'#6b7280',fontWeight:600,marginBottom:4}}>FOIR ESTIMATE</div><div style={{fontSize:16,fontWeight:700,color:'#7c3aed'}}>{result.credit_assessment?.foir_estimate||0}%</div></div>
              <div style={{flex:1,minWidth:200}}><div style={{fontSize:11,color:'#6b7280',fontWeight:600,marginBottom:4}}>ANALYST NOTES</div><div style={{fontSize:13,color:'#374151'}}>{result.credit_assessment?.summary_notes}</div></div>
            </div>
          </Card>

          {/* Summary Cards */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:10,marginBottom:16}}>
            {[
              {l:'Total Credits',      v:'₹'+(result.summary?.total_credits||0).toLocaleString('en-IN'),  c:'#16a34a'},
              {l:'Total Debits',       v:'₹'+(result.summary?.total_debits||0).toLocaleString('en-IN'),   c:'#dc2626'},
              {l:'Avg Monthly Balance',v:'₹'+(result.summary?.average_monthly_balance||0).toLocaleString('en-IN'), c:BSA_P},
              {l:'Risk Flags',         v:result.risk_flags?.length||0,          c:'#dc2626'},
              {l:'EMI Obligations',    v:result.emi_obligations?.length||0,     c:'#d97706'},
              {l:'CC Vendor Credits',  v:result.cc_vendor_funding?.length||0,   c:'#7c3aed'},
            ].map(s=>(
              <Card key={s.l} style={{padding:'14px 16px'}}>
                <div style={{fontSize:20,fontWeight:700,color:s.c,lineHeight:1,marginBottom:4}}>{s.v}</div>
                <div style={{fontSize:11,color:'#6b7280'}}>{s.l}</div>
              </Card>
            ))}
          </div>

          {/* Risk Flags */}
          {result.risk_flags?.length>0&&(
            <Card style={{marginBottom:16}}>
              <div style={{padding:'14px 20px',borderBottom:'1px solid #e5e7eb',fontWeight:600,fontSize:14,color:'#dc2626'}}>🔴 Risk Flags ({result.risk_flags.length})</div>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr>{['Type','Date','Description','Amount','Severity'].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
                  <tbody>{result.risk_flags.map((f,i)=>(
                    <tr key={i} style={{background:sevColor(f.severity)}}>
                      <td style={TD}><Badge text={f.type} color={sevText(f.severity)}/></td>
                      <td style={TD}>{f.date}</td><td style={TD}>{f.description}</td>
                      <td style={{...TD,fontWeight:600}}>₹{(f.amount||0).toLocaleString('en-IN')}</td>
                      <td style={TD}><Badge text={f.severity} color={sevText(f.severity)}/></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
          )}

          {/* CC Vendor Funding */}
          {result.cc_vendor_funding?.length>0&&(
            <Card style={{marginBottom:16}}>
              <div style={{padding:'14px 20px',borderBottom:'1px solid #e5e7eb',fontWeight:600,fontSize:14,color:'#7c3aed'}}>💳 Credit Card / Fintech Vendor Funding ({result.cc_vendor_funding.length})</div>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr>{['Vendor','Date','Description','Amount'].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
                  <tbody>{result.cc_vendor_funding.map((f,i)=>(
                    <tr key={i} style={{background:'#faf5ff'}}>
                      <td style={TD}><Badge text={f.vendor} color='#7c3aed'/></td>
                      <td style={TD}>{f.date}</td><td style={TD}>{f.description}</td>
                      <td style={{...TD,fontWeight:600,color:'#7c3aed'}}>₹{(f.amount||0).toLocaleString('en-IN')}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
          )}

          {/* EMI Obligations */}
          {result.emi_obligations?.length>0&&(
            <Card style={{marginBottom:16}}>
              <div style={{padding:'14px 20px',borderBottom:'1px solid #e5e7eb',fontWeight:600,fontSize:14,color:'#d97706'}}>📋 EMI & Recurring Obligations</div>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr>{['Party / Lender','Amount','Type','Count','First Seen','Last Seen'].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
                  <tbody>{result.emi_obligations.map((e,i)=>(
                    <tr key={i} style={{background:'#fffbeb'}}>
                      <td style={{...TD,fontWeight:500}}>{e.party}</td>
                      <td style={{...TD,fontWeight:700,color:'#d97706'}}>₹{(e.amount||0).toLocaleString('en-IN')}</td>
                      <td style={TD}><Badge text={e.type} color='#d97706'/></td>
                      <td style={TD}>{e.count}x</td>
                      <td style={TD}>{e.first_seen}</td><td style={TD}>{e.last_seen}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Watchlist */}
          {result.watchlist?.length>0&&(
            <Card style={{marginBottom:16}}>
              <div style={{padding:'14px 20px',borderBottom:'1px solid #e5e7eb',fontWeight:600,fontSize:14,color:'#d97706'}}>🟡 Watchlist ({result.watchlist.length})</div>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr>{['Type','Date','Description','Amount'].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
                  <tbody>{result.watchlist.map((w,i)=>(
                    <tr key={i} style={{background:'#fffbeb'}}>
                      <td style={TD}><Badge text={w.type} color='#d97706'/></td>
                      <td style={TD}>{w.date}</td><td style={TD}>{w.description}</td>
                      <td style={{...TD,fontWeight:600}}>₹{(w.amount||0).toLocaleString('en-IN')}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Positive Signals */}
          {result.positive_signals?.length>0&&(
            <Card style={{marginBottom:16}}>
              <div style={{padding:'14px 20px',borderBottom:'1px solid #e5e7eb',fontWeight:600,fontSize:14,color:'#16a34a'}}>🟢 Positive Signals</div>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr>{['Type','Date','Description','Amount'].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
                  <tbody>{result.positive_signals.map((s,i)=>(
                    <tr key={i} style={{background:'#f0fdf4'}}>
                      <td style={TD}><Badge text={s.type} color='#16a34a'/></td>
                      <td style={TD}>{s.date}</td><td style={TD}>{s.description}</td>
                      <td style={{...TD,fontWeight:600,color:'#16a34a'}}>₹{(s.amount||0).toLocaleString('en-IN')}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Repeat Parties */}
          {result.repeat_parties?.length>0&&(
            <Card style={{marginBottom:16}}>
              <div style={{padding:'14px 20px',borderBottom:'1px solid #e5e7eb',fontWeight:600,fontSize:14}}>👥 Repeat Transaction Parties</div>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr>{['Party','Total Debit','Total Credit','Count','Status'].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
                  <tbody>{result.repeat_parties.map((p,i)=>(
                    <tr key={i} style={{background:p.flag==='SUSPICIOUS'?'#fef2f2':'white'}}>
                      <td style={{...TD,fontWeight:500}}>{p.party}</td>
                      <td style={{...TD,color:'#dc2626'}}>₹{(p.total_debit||0).toLocaleString('en-IN')}</td>
                      <td style={{...TD,color:'#16a34a'}}>₹{(p.total_credit||0).toLocaleString('en-IN')}</td>
                      <td style={TD}>{p.transaction_count}x</td>
                      <td style={TD}><Badge text={p.flag} color={p.flag==='SUSPICIOUS'?'#dc2626':'#16a34a'}/></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Monthly Cashflow */}
          {result.monthly_cashflow?.length>0&&(
            <Card style={{marginBottom:16}}>
              <div style={{padding:'14px 20px',borderBottom:'1px solid #e5e7eb',fontWeight:600,fontSize:14}}>📈 Month-wise Cash Flow</div>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr>{['Month','Total Credit','Total Debit','Closing Balance','Bounces'].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
                  <tbody>{result.monthly_cashflow.map((m,i)=>(
                    <tr key={i} style={{background:m.bounce_count>0?'#fef2f2':'white'}}>
                      <td style={{...TD,fontWeight:500}}>{m.month}</td>
                      <td style={{...TD,color:'#16a34a',fontWeight:600}}>₹{(m.total_credit||0).toLocaleString('en-IN')}</td>
                      <td style={{...TD,color:'#dc2626',fontWeight:600}}>₹{(m.total_debit||0).toLocaleString('en-IN')}</td>
                      <td style={{...TD,fontWeight:600}}>₹{(m.closing_balance||0).toLocaleString('en-IN')}</td>
                      <td style={TD}>{m.bounce_count>0?<Badge text={m.bounce_count+' bounce(s)'} color='#dc2626'/>:<Badge text='None' color='#16a34a'/>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
          )}

          {/* ECS / NACH Returns */}
          {result.ecs_returns?.length>0&&(
            <Card style={{marginBottom:16}}>
              <div style={{padding:'14px 20px',borderBottom:'1px solid #fecaca',fontWeight:600,fontSize:14,color:'#dc2626',background:'#fef2f2'}}>↩️ ECS / NACH Returns ({result.ecs_returns.length})</div>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr>{['Party','Return Type','Return Date','Return Amount','Charge Date','Charge Amount','Charge Description'].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
                  <tbody>{result.ecs_returns.map((r,i)=>(
                    <tr key={i} style={{background:'#fef2f2'}}>
                      <td style={{...TD,fontWeight:500}}>{r.party}</td>
                      <td style={TD}><Badge text={r.return_type} color='#dc2626'/></td>
                      <td style={{...TD,whiteSpace:'nowrap'}}>{r.return_date}</td>
                      <td style={{...TD,fontWeight:600,color:'#dc2626'}}>₹{(r.return_amount||0).toLocaleString('en-IN')}</td>
                      <td style={{...TD,whiteSpace:'nowrap'}}>{r.charge_date}</td>
                      <td style={{...TD,fontWeight:600,color:'#d97706'}}>₹{(r.charge_amount||0).toLocaleString('en-IN')}</td>
                      <td style={TD}>{r.charge_description}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
          )}

          {/* CC Card Rotation — high severity RED */}
          {result.cc_card_rotation?.detected&&result.cc_card_rotation?.transactions?.length>0&&(
            <Card style={{marginBottom:16,borderLeft:'4px solid #dc2626'}}>
              <div style={{padding:'14px 20px',borderBottom:'1px solid #fecaca',fontWeight:600,fontSize:14,color:'#dc2626',background:'#fef2f2'}}>
                🔴 CC Card Rotation / Cash Advance ({result.cc_card_rotation.transaction_count} transactions · ₹{(result.cc_card_rotation.total_amount||0).toLocaleString('en-IN')} total)
              </div>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr>{['Vendor','Date','Amount','Description'].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
                  <tbody>{result.cc_card_rotation.transactions.map((t,i)=>(
                    <tr key={i} style={{background:'#fef2f2'}}>
                      <td style={TD}><Badge text={t.vendor} color='#dc2626'/></td>
                      <td style={{...TD,whiteSpace:'nowrap'}}>{t.date}</td>
                      <td style={{...TD,fontWeight:600,color:'#dc2626'}}>₹{(t.amount||0).toLocaleString('en-IN')}</td>
                      <td style={TD}>{t.description}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Stock Market Activity */}
          {result.stock_market_activity?.detected&&result.stock_market_activity?.transactions?.length>0&&(
            <Card style={{marginBottom:16}}>
              <div style={{padding:'14px 20px',borderBottom:'1px solid #e5e7eb',fontWeight:600,fontSize:14,color:'#7c3aed'}}>
                📈 Stock Market / Trading Activity ({result.stock_market_activity.transaction_count} txns · Invested ₹{(result.stock_market_activity.total_invested||0).toLocaleString('en-IN')} · Withdrawn ₹{(result.stock_market_activity.total_withdrawn||0).toLocaleString('en-IN')})
              </div>
              {result.stock_market_activity.brokers_seen?.length>0&&(
                <div style={{padding:'10px 20px',display:'flex',flexWrap:'wrap',gap:6,borderBottom:'1px solid #f3f4f6'}}>
                  {result.stock_market_activity.brokers_seen.map(b=><Badge key={b} text={b} color='#7c3aed'/>)}
                </div>
              )}
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr>{['Broker','Date','Amount','Direction','Description'].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
                  <tbody>{result.stock_market_activity.transactions.map((t,i)=>(
                    <tr key={i} style={{background:'#faf5ff'}}>
                      <td style={TD}><Badge text={t.broker} color='#7c3aed'/></td>
                      <td style={{...TD,whiteSpace:'nowrap'}}>{t.date}</td>
                      <td style={{...TD,fontWeight:600,color:'#7c3aed'}}>₹{(t.amount||0).toLocaleString('en-IN')}</td>
                      <td style={TD}><Badge text={t.direction} color={t.direction==='OUT'?'#dc2626':'#16a34a'}/></td>
                      <td style={TD}>{t.description}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Small Loan Disbursals */}
          {result.small_loan_disbursals?.detected&&result.small_loan_disbursals?.disbursals?.length>0&&(
            <Card style={{marginBottom:16,borderLeft:`4px solid ${result.small_loan_disbursals.frequent?'#dc2626':'#d97706'}`}}>
              <div style={{padding:'14px 20px',borderBottom:'1px solid #e5e7eb',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                <span style={{fontWeight:600,fontSize:14,color:result.small_loan_disbursals.frequent?'#dc2626':'#d97706'}}>
                  💸 Small Loan Disbursals ({result.small_loan_disbursals.disbursal_count} · ₹{(result.small_loan_disbursals.total_disbursed||0).toLocaleString('en-IN')} total)
                </span>
                {result.small_loan_disbursals.frequent&&<Badge text='FREQUENT — HIGH RISK' color='#dc2626'/>}
              </div>
              {result.small_loan_disbursals.lenders_seen?.length>0&&(
                <div style={{padding:'10px 20px',display:'flex',flexWrap:'wrap',gap:6,borderBottom:'1px solid #f3f4f6'}}>
                  {result.small_loan_disbursals.lenders_seen.map(l=><Badge key={l} text={l} color='#d97706'/>)}
                </div>
              )}
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr>{['Lender','Date','Amount','Description'].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
                  <tbody>{result.small_loan_disbursals.disbursals.map((d,i)=>(
                    <tr key={i} style={{background:result.small_loan_disbursals.frequent?'#fef2f2':'#fffbeb'}}>
                      <td style={TD}><Badge text={d.lender} color={result.small_loan_disbursals.frequent?'#dc2626':'#d97706'}/></td>
                      <td style={{...TD,whiteSpace:'nowrap'}}>{d.date}</td>
                      <td style={{...TD,fontWeight:600,color:result.small_loan_disbursals.frequent?'#dc2626':'#d97706'}}>₹{(d.amount||0).toLocaleString('en-IN')}</td>
                      <td style={TD}>{d.description}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Wallet-to-Bank Transfers */}
          {result.wallet_to_bank?.length>0&&(
            <Card style={{marginBottom:16}}>
              <div style={{padding:'14px 20px',borderBottom:'1px solid #e5e7eb',fontWeight:600,fontSize:14,color:'#0891b2'}}>👛 Wallet-to-Bank Transfers ({result.wallet_to_bank.length})</div>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr>{['Wallet','Date','Amount','Direction'].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
                  <tbody>{result.wallet_to_bank.map((w,i)=>(
                    <tr key={i} style={{background:'#ecfeff'}}>
                      <td style={TD}><Badge text={w.wallet} color='#0891b2'/></td>
                      <td style={{...TD,whiteSpace:'nowrap'}}>{w.date}</td>
                      <td style={{...TD,fontWeight:600,color:'#0891b2'}}>₹{(w.amount||0).toLocaleString('en-IN')}</td>
                      <td style={TD}><Badge text={w.direction} color={w.direction==='IN'?'#16a34a':'#dc2626'}/></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Frequent Transfers */}
          {result.frequent_transfers?.length>0&&(
            <Card style={{marginBottom:16}}>
              <div style={{padding:'14px 20px',borderBottom:'1px solid #e5e7eb',fontWeight:600,fontSize:14}}>🔄 Frequent Transfers ({result.frequent_transfers.length})</div>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr>{['Beneficiary','Total Amount','Count','First Transfer','Last Transfer','Type'].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
                  <tbody>{result.frequent_transfers.map((t,i)=>(
                    <tr key={i} style={{background:t.is_self?'#eff6ff':'white'}}>
                      <td style={{...TD,fontWeight:500}}>{t.beneficiary}</td>
                      <td style={{...TD,fontWeight:600}}>₹{(t.total_amount||0).toLocaleString('en-IN')}</td>
                      <td style={TD}>{t.transfer_count}x</td>
                      <td style={{...TD,whiteSpace:'nowrap'}}>{t.first_date}</td>
                      <td style={{...TD,whiteSpace:'nowrap'}}>{t.last_date}</td>
                      <td style={TD}>{t.is_self?<Badge text='SELF TRANSFER' color='#185FA5'/>:<Badge text='THIRD PARTY' color='#6b7280'/>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Forex / International Trading — high severity RED */}
          {result.forex_trading?.length>0&&(
            <Card style={{marginBottom:16,borderLeft:'4px solid #dc2626'}}>
              <div style={{padding:'14px 20px',borderBottom:'1px solid #fecaca',fontWeight:600,fontSize:14,color:'#dc2626',background:'#fef2f2'}}>🌐 Forex / International Trading ({result.forex_trading.length})</div>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr>{['Platform','Date','Amount','Direction','Description'].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
                  <tbody>{result.forex_trading.map((f,i)=>(
                    <tr key={i} style={{background:'#fef2f2'}}>
                      <td style={TD}><Badge text={f.platform} color='#dc2626'/></td>
                      <td style={{...TD,whiteSpace:'nowrap'}}>{f.date}</td>
                      <td style={{...TD,fontWeight:600,color:'#dc2626'}}>₹{(f.amount||0).toLocaleString('en-IN')}</td>
                      <td style={TD}><Badge text={f.direction} color={f.direction==='OUT'?'#dc2626':'#d97706'}/></td>
                      <td style={TD}>{f.description}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
          )}

          {/* All Transactions */}
          {result.all_transactions?.length>0&&(
            <Card style={{marginBottom:16}}>
              <div style={{padding:'14px 20px',borderBottom:'1px solid #e5e7eb',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div style={{fontWeight:600,fontSize:14}}>📊 All Transactions ({result.all_transactions.length})</div>
                <Btn small onClick={downloadCSV}>⬇ CSV</Btn>
              </div>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr>{['Date','Description','Debit','Credit','Balance','Category','Flag'].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
                  <tbody>{result.all_transactions.map((t,i)=>(
                    <tr key={i} style={{background:catColor(t.category)}}>
                      <td style={{...TD,whiteSpace:'nowrap'}}>{t.date}</td>
                      <td style={{...TD,maxWidth:280}}>{t.description}</td>
                      <td style={{...TD,color:'#dc2626',fontWeight:t.debit?600:400}}>{t.debit?'₹'+t.debit.toLocaleString('en-IN'):'—'}</td>
                      <td style={{...TD,color:'#16a34a',fontWeight:t.credit?600:400}}>{t.credit?'₹'+t.credit.toLocaleString('en-IN'):'—'}</td>
                      <td style={TD}>{t.balance?'₹'+t.balance.toLocaleString('en-IN'):'—'}</td>
                      <td style={TD}><Badge text={t.category||'OTHER'} color={['BOUNCE','ECS_RETURN','CC_FUNDING','GAMBLING'].includes(t.category)?'#dc2626':['SALARY','GST','INSURANCE'].includes(t.category)?'#16a34a':'#6b7280'}/></td>
                      <td style={TD}>{t.flag?<Badge text={t.flag} color='#dc2626'/>:'—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

// =============================================
// MAIN DASHBOARD
// =============================================
export default function Dashboard({ session }) {
  const [activePage,setActivePage]   =useState('dashboard')
  const [profile,setProfile]         =useState(null)
  const [roleLoading,setRoleLoading] =useState(true)
  const [crmName,setCrmName]       =useState('CALL-Q PRO CRM')
  const [crmTagline,setCrmTagline] =useState('Personal Loan Platform')
  const [stats,setStats]           =useState({totalLeads:0,todayCalls:0,pendingTasks:0,converted:0})
  const [recentCalls,setRecentCalls]=useState([])
  const [allCalls,setAllCalls]     =useState([])
  const [allLeads,setAllLeads]     =useState([])
  const [sidebarOpen,setSidebarOpen]=useState(false)
  const [viewLead,setViewLead]=useState(null)
  const isMobile=useIsMobile()

  useEffect(()=>{ getProfile() },[session?.user?.id])
  useEffect(()=>{ fetchSettings(); fetchDashboardStats() },[])

  // close sidebar on page change
  useEffect(()=>{ setSidebarOpen(false) },[activePage])

  const getProfile=async()=>{
    const userId=session?.user?.id
    if(!userId){ console.log('[Auth] No session user yet — waiting'); return }
    try{
      const{data,error:profileErr}=await supabase.from('profiles').select('*').eq('id',userId).single()
      if(profileErr){ console.error('[Profile] Fetch error:',profileErr) }
      else if(data){
        const normalizedRole=(data.role||'agent').toLowerCase().trim()
        setProfile({...data,role:normalizedRole})
      }
    } finally {
      setRoleLoading(false)
    }
  }
  const fetchSettings=async()=>{
    const{data}=await supabase.from('settings').select('*')
    if(data) data.forEach(s=>{if(s.key==='crm_name')setCrmName(s.value);if(s.key==='crm_tagline')setCrmTagline(s.value)})
  }
  const fetchDashboardStats=async()=>{
    const today=new Date().toISOString().split('T')[0]
    const[lR,recentR,tR,allR]=await Promise.all([
      supabase.from('leads').select('id,status,full_name'),
      supabase.from('calls').select('*').gte('created_at',today+'T00:00:00').order('created_at',{ascending:false}).limit(5),
      supabase.from('tasks').select('id,status').eq('status','Pending'),
      supabase.from('calls').select('*').order('created_at',{ascending:false})
    ])
    setStats({totalLeads:lR.data?.length||0,todayCalls:recentR.data?.length||0,pendingTasks:tR.data?.length||0,converted:lR.data?.filter(l=>['Disbursed','Approved'].includes(l.status)).length||0})
    setRecentCalls(recentR.data||[])
    setAllCalls(allR.data||[])
    setAllLeads(lR.data||[])
  }

  const handleLogout=async()=>{ await supabase.auth.signOut() }
  const role=(profile?.role||'').toLowerCase().trim()||'agent'

  const getIcon=name=>{
    const p={size:18,strokeWidth:1.6}
    const m={dashboard:<IconLayoutDashboard {...p}/>,users:<IconUsers {...p}/>,'phone-call':<IconPhoneCall {...p}/>,checkbox:<IconCheckbox {...p}/>,'chart-bar':<IconChartBar {...p}/>,settings:<IconSettings {...p}/>,adjustments:<IconAdjustments {...p}/>,campaigns:<IconBuildingStore {...p}/>,headset:<IconHeadset {...p}/>}
    return m[name]||<IconSettings {...p}/>
  }

  const navSections=[
    {section:'MAIN',items:[
      {id:'dashboard', label:'Dashboard',          icon:'dashboard',  roles:['agent']},
      {id:'dashboard', label:'Manager Panel',      icon:'dashboard',  roles:['manager']},
      {id:'dashboard', label:'Team Leader Panel',  icon:'dashboard',  roles:['team_leader']},
      {id:'dashboard', label:'Admin Dashboard',    icon:'dashboard',  roles:['admin']},
      {id:'leads',     label:'Leads',              icon:'users',      roles:['agent','team_leader','manager','admin']},
      {id:'campaigns', label:'Campaigns',          icon:'campaigns',  roles:['agent','team_leader','manager','admin']},
      {id:'calls',     label:'Call Logs',          icon:'phone-call', roles:['agent','team_leader','manager','admin']},
      {id:'tasks',     label:'Tasks',              icon:'checkbox',   roles:['agent','team_leader','manager','admin']},
    ]},
    {section:'REPORTS',items:[{id:'reports',label:'Reports',icon:'chart-bar',roles:['team_leader','manager','admin']}]},
    {section:'TOOLS',items:[
      {id:'cibil',             label:'CIBIL.com Analyzer',     icon:'chart-bar',roles:['agent','team_leader','manager','admin']},
      {id:'cibil-paisabazaar', label:'PaisaBazaar Analyzer',   icon:'chart-bar',roles:['agent','team_leader','manager','admin']},
      {id:'bsa',               label:'🔍 Bank Analyzer',        icon:'chart-bar',roles:['agent','team_leader','manager','admin']},
      {id:'emi',               label:'EMI Calculator',          icon:'chart-bar',roles:['agent','team_leader','manager','admin']},
      {id:'cam',               label:'📋 CAM Builder',          icon:'chart-bar',roles:['agent','team_leader','manager','admin']},
      {id:'call-assist',       label:'📞 Call Assist',          icon:'headset',  roles:['agent','team_leader','manager','admin']},
    ]},
    {section:'MANAGE',items:[
      {id:'admin',    label:'Admin Panel', icon:'settings',    roles:['admin']},
      {id:'settings', label:'Settings',   icon:'adjustments', roles:['admin']},
    ]},
  ]

  const AdminPanel=()=>{
    const [activeTab,setActiveTab]         =useState('overview')
    const [viewLead,setViewLead]           =useState(null)
    const isMobile                         =typeof window!=='undefined'&&window.innerWidth<768
    const [users,setUsers]                 =useState([])
    const [dispositions,setDispositions]   =useState([])
    const [leadSources,setLeadSources]     =useState([])
    const [callLogs,setCallLogs]           =useState([])
    const [activityLogs,setActivityLogs]   =useState([])
    const [showUserForm,setShowUserForm]   =useState(false)
    const [loading,setLoading]             =useState(false)
    const [editingUser,setEditingUser]     =useState(null)
    const [editForm,setEditForm]           =useState({full_name:'',mobile:'',department:'',role:'agent',team_leader_id:'',manager_id:''})
    const [userForm,setUserForm]           =useState({full_name:'',email:'',mobile:'',role:'agent',team_leader_id:'',manager_id:'',department:''})
    const [dispForm,setDispForm]           =useState({label:'',color:'#185FA5'})
    const [sourceForm,setSourceForm]       =useState({name:''})
    const [search,setSearch]               =useState('')
    const [roleFilter,setRoleFilter]       =useState('all')
    const [resetEmail,setResetEmail]       =useState('')
    const [resetLoading,setResetLoading]   =useState(false)
    const [stats,setStats]                 =useState({total:0,active_agents:0,team_leaders:0,inactive:0})
    const [adminLeads,setAdminLeads]       =useState([])
    const [adminObligations,setAdminObligations]=useState({})
    const [selected,setSelected]           =useState(new Set())
    const [assignTo,setAssignTo]           =useState('')
    const [assigning,setAssigning]         =useState(false)
    const [authUsers,setAuthUsers]         =useState([])
    const [settings,setSettings]           =useState({})
    const [editManualKey,setEditManualKey] =useState(null)
    const [editManualVal,setEditManualVal] =useState('')
    const [savingManual,setSavingManual]   =useState(false)
    const [leadSearch,setLeadSearch]       =useState('')
    const [leadStatusSet,setLeadStatusSet] =useState([])
    const [statusDropOpen,setStatusDropOpen]=useState(false)
    const statusDropOpenRef                =useRef(false)
    statusDropOpenRef.current = statusDropOpen
    const [leadAgentF,setLeadAgentF]       =useState('All')
    const [leadDateFrom,setLeadDateFrom]   =useState('')
    const [leadDateTo,setLeadDateTo]       =useState('')
    const [apToast,setApToast]             =useState(null)
    const [actFdAgent,setActFdAgent]       =useState('')
    const [actFdDate,setActFdDate]         =useState('')
    const [activityFull,setActivityFull]   =useState([])
    const [adminStages,setAdminStages]     =useState([])
    const [stageForm,setStageForm]         =useState({name:'',color:'#3b82f6'})
    const [apRtConnected,setApRtConnected] =useState(false)
    const [reassignTarget,setReassignTarget]=useState(null)
    const [reassignTo,setReassignTo]       =useState('')
    const [reassigning,setReassigning]     =useState(false)
    const [showDupOnly,setShowDupOnly]     =useState(false)
    const fetchLeadsRef                    =useRef(null)

    useEffect(()=>{ fetchUsers(); fetchDispositions(); fetchLeadSources(); fetchLeads(); fetchAuthUsers(); fetchSettings(); fetchActivityFull(); fetchAdminStages() },[])

    useEffect(()=>{
      const sub=supabase
        .channel('admin-rt-leads')
        .on('postgres_changes',{event:'*',schema:'public',table:'leads'},()=>{ if(!statusDropOpenRef.current) fetchLeadsRef.current?.() })
        .on('postgres_changes',{event:'*',schema:'public',table:'loan_obligations'},()=>{ if(!statusDropOpenRef.current) fetchLeadsRef.current?.() })
        .subscribe(status=>setApRtConnected(status==='SUBSCRIBED'))
      const poll=setInterval(()=>{ if(!statusDropOpenRef.current) fetchLeadsRef.current?.() },8000)
      const onVis=()=>{ if(document.visibilityState==='visible'&&!statusDropOpenRef.current) fetchLeadsRef.current?.() }
      document.addEventListener('visibilitychange',onVis)
      return()=>{ supabase.removeChannel(sub); clearInterval(poll); document.removeEventListener('visibilitychange',onVis) }
    },[])

    const fetchUsers=async()=>{
      const{data}=await supabase.from('profiles').select('*').order('role')
      if(data){
        setUsers(data)
        setStats({
          total:data.length,
          active_agents:data.filter(u=>u.role==='agent'&&u.status==='active').length,
          team_leaders:data.filter(u=>u.role==='team_leader').length,
          inactive:data.filter(u=>u.status==='inactive').length,
        })
      }
    }
    const fetchDispositions=async()=>{ const{data}=await supabase.from('dispositions').select('*').order('sort_order'); if(data) setDispositions(data) }
    const fetchLeadSources=async()=>{ const{data}=await supabase.from('lead_sources').select('*').order('created_at'); if(data) setLeadSources(data) }
    const fetchLeaderboard=async()=>{
      const weekAgo=new Date(); weekAgo.setDate(weekAgo.getDate()-7)
      const{data}=await supabase.from('calls').select('agent_id').gte('created_at',weekAgo.toISOString())
      if(data) setCallLogs(data)
    }
    const fetchActivityLogs=async()=>{
      const{data}=await supabase.from('activity_logs').select('*, profiles(full_name)').order('created_at',{ascending:false}).limit(50)
      if(data) setActivityLogs(data)
    }

    const SK='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2bnpldWVsZGZteGhlc21vZXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzY2MDA0NCwiZXhwIjoyMDkzMjM2MDQ0fQ.J7qjEpXnTlFvRJDM3uHG4JbPmFakaSFnu16mLtCvSdA'
    const fetchLeads=async()=>{
      const{data}=await supabase.from('leads').select('*').order('created_at',{ascending:false})
      if(data) setAdminLeads(data)
      const{data:obls}=await supabase.from('loan_obligations').select('*')
      if(obls){const m={};obls.forEach(o=>{if(!m[o.lead_id])m[o.lead_id]=[];m[o.lead_id].push(o)});setAdminObligations(m)}
    }
    fetchLeadsRef.current=fetchLeads
    const fetchAuthUsers=async()=>{ try{ const res=await fetch('https://pvnzeueldfmxhesmoetc.supabase.co/auth/v1/admin/users?per_page=1000',{headers:{'Authorization':'Bearer '+SK,'apikey':SK}}); const d=await res.json(); setAuthUsers(d.users||[]) }catch{} }
    const fetchSettings=async()=>{ const{data}=await supabase.from('settings').select('key,value'); if(!data)return; const m={}; data.forEach(s=>{m[s.key]=s.value}); setSettings(m) }
    const fetchActivityFull=async()=>{ const{data}=await supabase.from('activity_log').select('*').order('created_at',{ascending:false}).limit(500); if(data) setActivityFull(data) }
    const showApToast=(msg,type='success')=>{ setApToast({msg,type}); setTimeout(()=>setApToast(null),3500) }

    // Per-lead reassign — always mirror so the original agent keeps access and the
    // new agent also gets the lead with full history (prevents agent data loss)
    const doReassignLead=async()=>{
      if(!reassignTo||!reassignTarget)return
      setReassigning(true)
      try{
        const agent=users.find(u=>u.id===reassignTo)
        const originalAgent=reassignTarget.assigned_to
        const currentMirrors=reassignTarget.mirror_agents||[]
        const newMirrors=[...new Set([...currentMirrors,originalAgent].filter(Boolean))]
        const newMirrorStatuses={...(reassignTarget.mirror_agent_statuses||{})}; if(originalAgent) newMirrorStatuses[originalAgent]=reassignTarget.status
        const{error}=await supabase.from('leads').update({assigned_to:reassignTo,mirror_agents:newMirrors,mirror_agent_statuses:newMirrorStatuses,assignment_type:'mirror',assigned_at:new Date().toISOString()}).eq('id',reassignTarget.id)
        if(error){ showApToast('Error: '+error.message,'error'); setReassigning(false); return }
        await supabase.from('activity_log').insert([{lead_id:reassignTarget.id,lead_name:reassignTarget.full_name||'',action:'Reassigned',assigned_to:reassignTo,assigned_to_name:agent?.full_name||'',assigned_by:profile?.id||null,assigned_by_name:profile?.full_name||'Admin',previous_agent_id:originalAgent||null,previous_agent_name:users.find(u=>u.id===originalAgent)?.full_name||null}])
        try{ await supabase.from('notifications').insert([{type:'leads_assigned',agent_id:reassignTo,agent_name:'Admin',message:'📥 A lead was assigned to you'}]) }catch(e){}
        showApToast('Lead reassigned to '+(agent?.full_name||'agent')+'. Original agent retains access.')
        setReassignTarget(null); setReassignTo(''); fetchLeads(); fetchActivityFull()
      }catch(err){ showApToast('Error: '+err.message,'error') }
      setReassigning(false)
    }

    const handleUnassignLead=async(l)=>{
      if(!window.confirm('Unassign "'+(l.full_name||'this lead')+'" from '+(users.find(u=>u.id===l.assigned_to)?.full_name||'agent')+'?'))return
      const{error}=await supabase.from('leads').update({assigned_to:null,mirror_agents:[],assignment_type:null}).eq('id',l.id)
      if(error){ showApToast('Error: '+error.message,'error'); return }
      showApToast('Lead unassigned'); fetchLeads()
    }

    const handleDeleteLead=async(l)=>{
      if(!window.confirm('Delete lead "'+(l.full_name||'')+'" ('+(l.mobile||'')+')?\n\nThis also deletes its call logs, tasks and obligations. This cannot be undone.'))return
      try{
        await supabase.from('calls').delete().eq('lead_id',l.id)
        await supabase.from('tasks').delete().eq('lead_id',l.id)
        await supabase.from('loan_obligations').delete().eq('lead_id',l.id)
        await supabase.from('activity_log').delete().eq('lead_id',l.id)
        await supabase.from('leads').delete().eq('id',l.id)
        showApToast('Lead "'+(l.full_name||'')+'" deleted'); fetchLeads()
      }catch(e){ showApToast('Error deleting lead: '+e.message,'error') }
    }

    const doReassignExport=async(leadsToExport)=>{
      if(!leadsToExport||!leadsToExport.length){ showApToast('No leads to export','error'); return }
      showApToast('Preparing export…')
      try{
        const ids=leadsToExport.map(l=>l.id)
        const[callRes,oblRes,taskRes]=await Promise.all([
          supabase.from('calls').select('*').in('lead_id',ids).order('created_at',{ascending:false}),
          supabase.from('loan_obligations').select('*').in('lead_id',ids),
          supabase.from('tasks').select('*').in('lead_id',ids).ilike('title','Callback:%').eq('status','Pending'),
        ])
        const callMap={},oblMap={},taskMap={}
        ;(callRes.data||[]).forEach(c=>{ if(!callMap[c.lead_id])callMap[c.lead_id]=[]; callMap[c.lead_id].push(c) })
        ;(oblRes.data||[]).forEach(o=>{ if(!oblMap[o.lead_id])oblMap[o.lead_id]=[]; oblMap[o.lead_id].push(o) })
        ;(taskRes.data||[]).forEach(t=>{ taskMap[t.lead_id]=t })

        const headers=['Lead Name','Mobile','City','Sheet No.','Loan Amount','Current Stage','Last Disposition','Last Call Date','No. of Calls','Agent Notes','Monthly Salary','Company','Total EMI','FOIR %','Eligible Loan Amount','Obligations Summary','Callback Scheduled','Assigned Agent']
        const rows=leadsToExport.map(l=>{
          const calls=callMap[l.id]||[]
          const obls=oblMap[l.id]||[]
          const lastCall=calls[0]
          const agent=users.find(u=>u.id===l.assigned_to)
          const oblSummary=obls.map(o=>`${o.obligation_type||'Loan'} @ ${o.bank_name||'—'} EMI ₹${o.emi_amount||0}`).join(' | ')
          const cbTask=taskMap[l.id]
          const cbDate=cbTask&&cbTask.due_date?String(cbTask.due_date).replace('T',' ').slice(0,16):''
          return[
            l.full_name||'',l.mobile||'',l.city||'',l.sheet_number||'',l.loan_amount||'',
            l.status||'New',l.disposition||'',
            lastCall?new Date(lastCall.created_at).toLocaleDateString('en-IN',{timeZone:IST_TZ}):'',
            calls.length,
            (l.notes||'').replace(/\n/g,' | '),
            l.monthly_salary||'',l.company_name||'',
            l.total_emi||'',l.foir||'',l.eligible_loan_amount||'',
            oblSummary,cbDate,agent?.full_name||'Unassigned'
          ]
        })
        const dd=new Date().toLocaleDateString('en-IN',{timeZone:IST_TZ}).replace(/\//g,'-')
        exportToExcel('reassignment_export_'+dd,[headers,...rows],'Leads')
        showApToast('Exported '+leadsToExport.length+' leads')
      }catch(err){ showApToast('Export error: '+err.message,'error') }
    }
    const saveManualSetting=async(key,val)=>{ setSavingManual(true); await supabase.from('settings').upsert([{key,value:String(val)}],{onConflict:'key'}); setSettings(p=>({...p,[key]:String(val)})); setSavingManual(false); setEditManualKey(null) }

    const createUser=async(e)=>{
      e.preventDefault(); setLoading(true)
      try{
        const res=await fetch('https://pvnzeueldfmxhesmoetc.supabase.co/auth/v1/admin/users',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+SK,'apikey':SK},body:JSON.stringify({email:userForm.email,password:'Capital@123',email_confirm:true})})
        const ud=await res.json()
        if(ud.id){
          await supabase.from('profiles').insert([{id:ud.id,full_name:userForm.full_name,email:userForm.email,mobile:userForm.mobile,role:userForm.role,team_leader_id:userForm.team_leader_id||null,manager_id:userForm.manager_id||null,department:userForm.department,status:'active'}])
          setUserForm({full_name:'',email:'',mobile:'',role:'agent',team_leader_id:'',manager_id:'',department:''});setShowUserForm(false);fetchUsers()
          alert('✅ User created!\nEmail: '+userForm.email+'\nPassword: Capital@123')
        }else alert('Error: '+JSON.stringify(ud))
      }catch(err){alert('Error: '+err.message)}
      setLoading(false)
    }

    const saveEditUser=async(id)=>{ await supabase.from('profiles').update({full_name:editForm.full_name,mobile:editForm.mobile,department:editForm.department,role:editForm.role,team_leader_id:editForm.team_leader_id||null,manager_id:editForm.manager_id||null}).eq('id',id); setEditingUser(null); fetchUsers() }
    const deleteUser=async(id,email)=>{ if(!window.confirm('Delete '+email+'?'))return; await supabase.from('profiles').delete().eq('id',id); fetchUsers() }
    const updateUserRole=async(id,role)=>{ await supabase.from('profiles').update({role}).eq('id',id); fetchUsers() }
    const assignTeamLeader=async(id,tlId)=>{ await supabase.from('profiles').update({team_leader_id:tlId||null}).eq('id',id); fetchUsers() }
    const toggleUserStatus=async(id,status)=>{ await supabase.from('profiles').update({status:status==='active'?'inactive':'active'}).eq('id',id); fetchUsers() }
    const addDisposition=async(e)=>{ e.preventDefault(); await supabase.from('dispositions').insert([{...dispForm,sort_order:dispositions.length+1}]); setDispForm({label:'',color:'#185FA5'}); fetchDispositions() }
    const deleteDisposition=async(id)=>{ if(!window.confirm('Delete?'))return; await supabase.from('dispositions').delete().eq('id',id); fetchDispositions() }
    const toggleDisposition=async(id,a)=>{ await supabase.from('dispositions').update({is_active:!a}).eq('id',id); fetchDispositions() }
    const addLeadSource=async(e)=>{ e.preventDefault(); await supabase.from('lead_sources').insert([{...sourceForm,is_active:true}]); setSourceForm({name:''}); fetchLeadSources() }
    const deleteLeadSource=async(id)=>{ if(!window.confirm('Delete?'))return; await supabase.from('lead_sources').delete().eq('id',id); fetchLeadSources() }
    const toggleLeadSource=async(id,a)=>{ await supabase.from('lead_sources').update({is_active:!a}).eq('id',id); fetchLeadSources() }
    const fetchAdminStages=async()=>{ const{data}=await supabase.from('lead_stages').select('*').order('order_index'); if(data) setAdminStages(data) }
    const addAdminStage=async(e)=>{ e.preventDefault(); if(!stageForm.name.trim())return; const maxOrder=adminStages.length>0?Math.max(...adminStages.map(s=>s.order_index)):0; const{error}=await supabase.from('lead_stages').insert([{name:stageForm.name.trim(),color:stageForm.color,order_index:maxOrder+1}]); if(error){showApToast('Error: '+error.message,'error');return} setStageForm({name:'',color:'#3b82f6'}); fetchAdminStages(); showApToast('Stage added') }
    const deleteAdminStage=async(id,name)=>{ if(!window.confirm('Delete stage "'+name+'"?'))return; await supabase.from('lead_stages').delete().eq('id',id); fetchAdminStages(); showApToast('Stage deleted') }
    const toggleAdminStage=async(id,a)=>{ await supabase.from('lead_stages').update({is_active:!a}).eq('id',id); setAdminStages(prev=>prev.map(s=>s.id===id?{...s,is_active:!a}:s)) }
    const moveAdminStage=async(id,dir)=>{ const idx=adminStages.findIndex(s=>s.id===id); const swapIdx=idx+dir; if(swapIdx<0||swapIdx>=adminStages.length)return; const a=adminStages[idx],b=adminStages[swapIdx]; await Promise.all([supabase.from('lead_stages').update({order_index:b.order_index}).eq('id',a.id),supabase.from('lead_stages').update({order_index:a.order_index}).eq('id',b.id)]); fetchAdminStages() }
    const updateAdminStageColor=async(id,color)=>{ await supabase.from('lead_stages').update({color}).eq('id',id); setAdminStages(prev=>prev.map(s=>s.id===id?{...s,color}:s)) }
    const resetPassword=async()=>{
      if(!resetEmail.trim())return; setResetLoading(true)
      try{
        const{data:u}=await supabase.from('profiles').select('id,email').eq('email',resetEmail.trim()).single()
        if(!u){alert('User not found');setResetLoading(false);return}
        const res=await fetch('https://pvnzeueldfmxhesmoetc.supabase.co/auth/v1/admin/users/'+u.id,{method:'PUT',headers:{'Content-Type':'application/json','Authorization':'Bearer '+SK,'apikey':SK},body:JSON.stringify({password:'Capital@123'})})
        const r=await res.json()
        if(r.id) alert('✅ Password reset to Capital@123 for '+resetEmail)
        else alert('Error: '+JSON.stringify(r))
      }catch(err){alert('Error: '+err.message)}
      setResetLoading(false)
    }

    const teamLeaders=users.filter(u=>u.role==='team_leader')
    const managers   =users.filter(u=>u.role==='manager')
    const RC={agent:{bg:'#E6F1FB',color:'#185FA5'},team_leader:{bg:'#EEEDFE',color:'#534AB7'},manager:{bg:'#FAEEDA',color:'#854F0B'},admin:{bg:'#FCEBEB',color:'#A32D2D'}}
    const gi=name=>name?name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2):'?'
    const AB=['#E6F1FB','#EEEDFE','#E1F5EE','#FAEEDA','#F1EFE8']
    const AC=['#185FA5','#534AB7','#0F6E56','#854F0B','#5F5E5A']
    const filteredUsers=users.filter(u=>{
      const ms=!search||u.full_name?.toLowerCase().includes(search.toLowerCase())||u.email?.toLowerCase().includes(search.toLowerCase())||u.mobile?.includes(search)
      const mr=roleFilter==='all'||u.role===roleFilter
      return ms&&mr
    })
    const leaderboard=Object.entries(callLogs.reduce((acc,cl)=>{acc[cl.agent_id]=(acc[cl.agent_id]||0)+1;return acc},{})).map(([agentId,count])=>{const agent=users.find(u=>u.id===agentId);return{agentId,name:agent?.full_name||'Unknown',count}}).sort((a,b)=>b.count-a.count)
    const TABS=[{id:'overview',label:'Overview'},{id:'users',label:'Users & Roles'},{id:'teams',label:'Team Overview'},{id:'leaderboard',label:'Leaderboard'},{id:'leads_admin',label:'All Leads'},{id:'activity',label:'Activity Log'},{id:'dispositions',label:'Dispositions'},{id:'stages_admin',label:'Lead Stages'},{id:'sources',label:'Lead Sources'},{id:'config',label:'System Config'}]
    const td=new Date().toISOString().split('T')[0]
    const tm=new Date().toISOString().slice(0,7)
    const callsToday=callLogs.filter(c=>(c.created_at||'').startsWith(td)).length
    const leadsToday=adminLeads.filter(l=>(l.created_at||'').startsWith(td)).length
    const leadsMonth=adminLeads.filter(l=>(l.created_at||'').startsWith(tm)).length
    const agentIds=new Set(users.filter(u=>u.role==='agent').map(u=>u.id))
    const agentLogT=authUsers.filter(u=>agentIds.has(u.id)&&(u.last_sign_in_at||'').startsWith(td)).length
    const agentLogM=authUsers.filter(u=>agentIds.has(u.id)&&(u.last_sign_in_at||'').startsWith(tm)).length
    const agentRows=users.filter(u=>u.role==='agent').map(a=>{ const ml=adminLeads.filter(l=>l.assigned_to===a.id); const au=authUsers.find(u=>u.id===a.id); return{...a,callsToday:callLogs.filter(c=>c.agent_id===a.id&&(c.created_at||'').startsWith(td)).length,totalLeads:ml.length,leadsMonth:ml.filter(l=>(l.created_at||'').startsWith(tm)).length,interested:ml.filter(l=>l.status==='Interested').length,callback:ml.filter(l=>l.status==='Callback').length,disbursed:ml.filter(l=>l.status==='Disbursed').length,lastLogin:au?.last_sign_in_at||null} }).sort((a,b)=>b.callsToday-a.callsToday)
    const mk=new Date().toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:IST_TZ}).toLowerCase().replace(' ','_')
    const manualStats=[{key:'disbursements_'+mk,label:'Disbursements This Month'},{key:'applications_'+mk,label:'Applications Logged In'},{key:'obligations_'+mk,label:'Obligations Disbursed'}]
    // Duplicate detection: same mobile (last 10 digits) assigned to the same agent more than once
    const dupKeyCount={}
    adminLeads.forEach(l=>{ if(!l.mobile||!l.assigned_to)return; const k=l.mobile.replace(/\D/g,'').slice(-10)+'|'+l.assigned_to; dupKeyCount[k]=(dupKeyCount[k]||0)+1 })
    const dupLeadIds=new Set()
    adminLeads.forEach(l=>{ if(!l.mobile||!l.assigned_to)return; const k=l.mobile.replace(/\D/g,'').slice(-10)+'|'+l.assigned_to; if(dupKeyCount[k]>1) dupLeadIds.add(l.id) })
    const filteredLeads=adminLeads.filter(l=>{ const q=leadSearch.toLowerCase(); const mQ=!q||(l.full_name||'').toLowerCase().includes(q)||(l.mobile||'').includes(q); const mS=leadStatusSet.length===0||leadStatusSet.includes(l.status); const mA=leadAgentF==='All'||l.assigned_to===leadAgentF||(Array.isArray(l.mirror_agents)&&l.mirror_agents.includes(leadAgentF)); const mF=!leadDateFrom||(l.assigned_at||l.created_at||'')>=leadDateFrom; const mT=!leadDateTo||(l.assigned_at||l.created_at||'')<=leadDateTo+'T23:59:59'; const mDup=!showDupOnly||dupLeadIds.has(l.id); return mQ&&mS&&mA&&mF&&mT&&mDup })
    const allLdSel=filteredLeads.length>0&&filteredLeads.every(l=>selected.has(l.id))
    const filteredAct=activityFull.filter(a=>{ const mA=!actFdAgent||a.assigned_to===actFdAgent||a.assigned_by===actFdAgent; const mD=!actFdDate||(a.created_at||'').startsWith(actFdDate); return mA&&mD })
    const apStageStyle=name=>{const s=adminStages.find(st=>st.name===name);if(s?.color)return{bg:s.color+'22',color:s.color};return{bg:'#F7FAFC',color:'#4A5568'}}

    return(
      <div>
        {apToast&&<div style={{position:'fixed',bottom:24,right:24,zIndex:9999,background:apToast.type==='error'?'#dc2626':'#15803d',color:'white',padding:'12px 20px',borderRadius:10,fontSize:14,fontWeight:500,boxShadow:'0 4px 12px rgba(0,0,0,0.2)',maxWidth:320}}>{apToast.msg}</div>}
        <div className="page-header">
          <div><h1 style={{display:'flex',alignItems:'center',gap:8,fontSize:isMobile?16:18}}><IconSettings size={isMobile?18:22} strokeWidth={1.6}/>Admin Panel<span style={{display:'flex',alignItems:'center',gap:4,fontSize:10,fontWeight:600,color:apRtConnected?'#16a34a':'#9ca3af',marginLeft:4}}><span style={{width:7,height:7,borderRadius:'50%',background:apRtConnected?'#22c55e':'#d1d5db',display:'inline-block',boxShadow:apRtConnected?'0 0 4px #22c55e':undefined}}/>{apRtConnected?'Live':''}</span></h1><p>Manage users, teams and system settings</p></div>
          <button className="btn btn-primary" style={{fontSize:12}} onClick={()=>setShowUserForm(!showUserForm)}>{showUserForm?'Cancel':'+ Add User'}</button>
        </div>
        <div className="page-body">
          {/* Stats Row */}
          <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(4,1fr)',gap:10,marginBottom:16}}>
            {[{l:'Total Users',v:stats.total,c:'#185FA5'},{l:'Active Agents',v:stats.active_agents,c:'#0F6E56'},{l:'Team Leaders',v:stats.team_leaders,c:'#534AB7'},{l:'Inactive Users',v:stats.inactive,c:'#854F0B'}].map(s=>(
              <div key={s.l} style={{background:'white',padding:'12px 14px',borderRadius:10,border:'1px solid #E2E8F0',borderLeft:'3px solid '+s.c}}>
                <div style={{fontSize:22,fontWeight:600,color:s.c,lineHeight:1,marginBottom:3}}>{s.v}</div>
                <div style={{fontSize:12,color:'#718096'}}>{s.l}</div>
              </div>
            ))}
          </div>
          {/* Tabs */}
          <div className='tabs'>
            {TABS.map(t=>(
              <button key={t.id} className={'tab'+(activeTab===t.id?' active':'')} onClick={()=>{setActiveTab(t.id);if(t.id==='leaderboard')fetchLeaderboard();if(t.id==='config')fetchActivityLogs();if(t.id==='activity')fetchActivityFull();if(t.id==='stages_admin')fetchAdminStages()}}>{t.label}</button>
            ))}
          </div>

          {activeTab==='overview'&&(
            <div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:10,marginBottom:10}}>
                {[{l:'Calls Today',v:callsToday,c:'#185FA5'},{l:'Leads Today',v:leadsToday,c:'#0891b2'},{l:'Leads This Month',v:leadsMonth,c:'#7c3aed'}].map(s=>(<div key={s.l} style={{background:'white',padding:'14px 16px',borderRadius:10,border:'1px solid #E2E8F0',borderLeft:'3px solid '+s.c}}><div style={{fontSize:24,fontWeight:700,color:s.c,lineHeight:1,marginBottom:3}}>{s.v}</div><div style={{fontSize:12,color:'#718096'}}>{s.l}</div></div>))}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:10,marginBottom:10}}>
                {[{l:'Agent Logins Today',v:agentLogT,c:'#d97706'},{l:'Agent Logins Month',v:agentLogM,c:'#059669'},{l:'Total Users',v:stats.total,c:'#534AB7'},{l:'Inactive Users',v:stats.inactive,c:'#854F0B'}].map(s=>(<div key={s.l} style={{background:'white',padding:'14px 16px',borderRadius:10,border:'1px solid #E2E8F0',borderLeft:'3px solid '+s.c}}><div style={{fontSize:24,fontWeight:700,color:s.c,lineHeight:1,marginBottom:3}}>{s.v}</div><div style={{fontSize:12,color:'#718096'}}>{s.l}</div></div>))}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:10,marginBottom:16}}>
                {manualStats.map(m=>(<div key={m.key} style={{background:'white',padding:'14px 16px',borderRadius:10,border:'1px solid #E2E8F0'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}><div style={{fontSize:12,color:'#718096',fontWeight:500}}>{m.label}</div><button onClick={()=>{setEditManualKey(m.key);setEditManualVal(settings[m.key]||'')}} style={{background:'none',border:'none',cursor:'pointer',color:'#A0AEC0',fontSize:13,padding:0}}>✏</button></div>
                  {editManualKey===m.key?(<div style={{display:'flex',gap:6}}><input className='form-input' style={{flex:1,padding:'4px 8px',fontSize:13}} value={editManualVal} onChange={e=>setEditManualVal(e.target.value)} autoFocus onKeyDown={e=>{if(e.key==='Enter')saveManualSetting(m.key,editManualVal)}}/><button className='btn btn-primary btn-sm' onClick={()=>saveManualSetting(m.key,editManualVal)} disabled={savingManual}>{savingManual?'…':'Save'}</button></div>):(<div style={{fontSize:24,fontWeight:700,color:'#185FA5'}}>{settings[m.key]||'—'}</div>)}
                </div>))}
              </div>
              <div className='table-container' style={{marginBottom:16}}>
                <div style={{padding:'12px 16px',borderBottom:'1px solid #E2E8F0',fontWeight:600,fontSize:14}}>Agent Performance — {new Date().toLocaleDateString('en-IN',{month:'long',year:'numeric',timeZone:IST_TZ})}</div>
                <div style={{overflowX:'auto'}}><table><thead><tr>{['Agent','Calls Today','Total Leads','Leads/Month','Interested','Callback','Disbursed','Last Login'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                <tbody>{agentRows.length===0?(<tr><td colSpan={8} style={{textAlign:'center',color:'#A0AEC0',padding:24}}>No agents</td></tr>):agentRows.map(r=>(<tr key={r.id}><td><div style={{fontWeight:500}}>{r.full_name}</div></td><td style={{textAlign:'center',fontWeight:700,color:r.callsToday>0?'#15803d':'#718096'}}>{r.callsToday}</td><td style={{textAlign:'center'}}>{r.totalLeads}</td><td style={{textAlign:'center'}}>{r.leadsMonth}</td><td style={{textAlign:'center',color:'#7c3aed'}}>{r.interested}</td><td style={{textAlign:'center',color:'#d97706'}}>{r.callback}</td><td style={{textAlign:'center',color:'#15803d',fontWeight:600}}>{r.disbursed}</td><td style={{fontSize:11,color:'#A0AEC0'}}>{r.lastLogin?new Date(r.lastLogin).toLocaleString('en-IN',{dateStyle:'short',timeStyle:'short',timeZone:IST_TZ}):'—'}</td></tr>))}
                </tbody></table></div>
              </div>
            </div>
          )}
          {activeTab==='users'&&(
            <div>
              <div style={{display:'none'}}></div>

              {showUserForm&&(
                <div className="card" style={{marginBottom:16}}>
                  <div className="card-header"><h3>Add New Member</h3><button className="btn btn-ghost btn-sm" onClick={()=>setShowUserForm(false)}>✕</button></div>
                  <div className="card-body">
                    <form onSubmit={createUser}>
                      <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:10,marginBottom:10}}>
                        {[{l:'Full Name *',k:'full_name',t:'text'},{l:'Email *',k:'email',t:'email'},{l:'Mobile',k:'mobile',t:'text'},{l:'Department',k:'department',t:'text'}].map(f=>(
                          <div key={f.k}><label className="form-label">{f.l}</label><input type={f.t} className="form-input" value={userForm[f.k]} onChange={e=>setUserForm({...userForm,[f.k]:e.target.value})} required={f.l.includes('*')} placeholder={f.l.replace(' *','')}/></div>
                        ))}
                        <div><label className="form-label">Role</label><select className="form-input" value={userForm.role} onChange={e=>setUserForm({...userForm,role:e.target.value})}>{['agent','team_leader','manager','admin'].map(r=><option key={r} value={r}>{r.replace('_',' ').toUpperCase()}</option>)}</select></div>
                        {userForm.role==='agent'&&teamLeaders.length>0&&(<div><label className="form-label">Team Leader</label><select className="form-input" value={userForm.team_leader_id} onChange={e=>setUserForm({...userForm,team_leader_id:e.target.value})}><option value="">Select TL</option>{teamLeaders.map(tl=><option key={tl.id} value={tl.id}>{tl.full_name}</option>)}</select></div>)}
                        {(userForm.role==='agent'||userForm.role==='team_leader')&&managers.length>0&&(<div><label className="form-label">Manager</label><select className="form-input" value={userForm.manager_id} onChange={e=>setUserForm({...userForm,manager_id:e.target.value})}><option value="">Select Manager</option>{managers.map(m=><option key={m.id} value={m.id}>{m.full_name}</option>)}</select></div>)}
                      </div>
                      <div style={{background:'#FFFAF0',border:'1px solid #F6E05E',borderRadius:8,padding:'10px 12px',marginBottom:12,fontSize:13,color:'#744210'}}>⚠️ Default password: <strong>Capital@123</strong></div>
                      <button type="submit" className="btn btn-primary" disabled={loading}>{loading?'Creating...':'Create User'}</button>
                    </form>
                  </div>
                </div>
              )}
              <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
                <div style={{flex:1,minWidth:200,position:'relative'}}>
                  <IconSearch size={14} style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'#A0AEC0'}}/>
                  <input className="form-input" style={{paddingLeft:32,fontSize:13}} placeholder="Search users..." value={search} onChange={e=>setSearch(e.target.value)}/>
                </div>
                <select className="form-input" style={{width:'auto',fontSize:13}} value={roleFilter} onChange={e=>setRoleFilter(e.target.value)}>
                  <option value="all">All Roles</option>
                  {['agent','team_leader','manager','admin'].map(r=><option key={r} value={r}>{r.replace('_',' ').toUpperCase()}</option>)}
                </select>
              </div>
              <div className="table-container">
                <div style={{padding:'12px 14px',borderBottom:'1px solid #E2E8F0',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  <span style={{fontSize:14,fontWeight:600}}>All Users</span>
                  <span style={{fontSize:12,color:'#A0AEC0'}}>{filteredUsers.length} of {users.length}</span>
                </div>
                {isMobile?(
                  <div style={{padding:'8px 12px'}}>
                    {filteredUsers.map((user,i)=>{
                      const rc=RC[user.role]||{bg:'#F7FAFC',color:'#718096'}
                      return(
                        <div key={user.id} style={{padding:'12px 0',borderBottom:'1px solid #F3F4F6'}}>
                          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                            <div style={{display:'flex',alignItems:'center',gap:8}}>
                              <div style={{width:32,height:32,borderRadius:'50%',background:AB[i%5],display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:600,color:AC[i%5],flexShrink:0}}>{gi(user.full_name)}</div>
                              <div>
                                <div style={{fontWeight:600,fontSize:13}}>{user.full_name}</div>
                                <div style={{fontSize:11,color:'#A0AEC0'}}>{user.mobile||user.email}</div>
                              </div>
                            </div>
                            <span style={{background:rc.bg,color:rc.color,padding:'3px 8px',borderRadius:20,fontSize:10,fontWeight:600}}>{user.role.replace('_',' ').toUpperCase()}</span>
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
                    <thead><tr>{['User','Role','Mobile','Team Leader','Status','Actions'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                    <tbody>
                      {filteredUsers.length===0?(<tr><td colSpan={6}><div className="empty-state"><h3>No users found</h3></div></td></tr>)
                      :filteredUsers.map((user,i)=>{
                        const rc=RC[user.role]||{bg:'#F7FAFC',color:'#718096'}
                        return(
                          <tr key={user.id}>
                            <td>
                              <div style={{display:'flex',alignItems:'center',gap:10}}>
                                <div style={{width:32,height:32,borderRadius:'50%',background:AB[i%5],display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:600,color:AC[i%5],flexShrink:0}}>{gi(user.full_name)}</div>
                                <div>
                                  {editingUser===user.id
                                    ?<div style={{display:'flex',flexDirection:'column',gap:4}}>
                                        <input className="form-input" style={{padding:'4px 8px',fontSize:12}} value={editForm.full_name} onChange={e=>setEditForm({...editForm,full_name:e.target.value})} placeholder="Full name"/>
                                        <input className="form-input" style={{padding:'4px 8px',fontSize:11}} value={editForm.mobile} onChange={e=>setEditForm({...editForm,mobile:e.target.value})} placeholder="Mobile"/>
                                        <input className="form-input" style={{padding:'4px 8px',fontSize:11}} value={editForm.department} onChange={e=>setEditForm({...editForm,department:e.target.value})} placeholder="Department"/>
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
                            <td style={{fontSize:12,color:'#4A5568'}}>{user.mobile||'—'}</td>
                            <td><select value={user.team_leader_id||''} onChange={e=>assignTeamLeader(user.id,e.target.value)} style={{padding:'4px 8px',border:'1px solid #E2E8F0',borderRadius:6,fontSize:12,background:'white',color:'#4A5568',outline:'none'}}><option value="">No TL</option>{teamLeaders.map(tl=><option key={tl.id} value={tl.id}>{tl.full_name}</option>)}</select></td>
                            <td><span style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:12,fontWeight:500,color:user.status==='active'?'#0F6E56':'#718096'}}><span style={{width:6,height:6,borderRadius:'50%',background:user.status==='active'?'#1D9E75':'#A0AEC0'}}></span>{user.status==='active'?'Active':'Inactive'}</span></td>
                            <td>
                              <div style={{display:'flex',gap:5,alignItems:'center'}}>
                                {editingUser===user.id
                                  ?<><button className="btn btn-success btn-sm" onClick={()=>saveEditUser(user.id)}>Save</button><button className="btn btn-ghost btn-sm" onClick={()=>setEditingUser(null)}>Cancel</button></>
                                  :<button onClick={()=>{setEditingUser(user.id);setEditForm({full_name:user.full_name||'',mobile:user.mobile||'',department:user.department||'',role:user.role,team_leader_id:user.team_leader_id||'',manager_id:user.manager_id||''})}} style={{width:28,height:28,borderRadius:6,border:'1px solid #E2E8F0',background:'transparent',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'#185FA5'}}><IconEdit size={14} strokeWidth={1.5}/></button>
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

          {activeTab==='teams'&&(
            <div>
              <h3 style={{fontSize:15,fontWeight:600,marginBottom:14}}>Team Structure</h3>
              {teamLeaders.length===0?(<div className="card"><div className="empty-state"><h3>No team leaders yet</h3></div></div>)
              :teamLeaders.map((tl,i)=>{
                const tlAgents=users.filter(u=>u.team_leader_id===tl.id&&u.role==='agent')
                return(
                  <div key={tl.id} className="card" style={{marginBottom:12,overflow:'hidden'}}>
                    <div style={{background:'linear-gradient(135deg,#0C3A6B,#185FA5)',padding:'11px 16px',color:'white',fontWeight:600,fontSize:13,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <div style={{width:28,height:28,borderRadius:'50%',background:'rgba(255,255,255,0.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700}}>{gi(tl.full_name)}</div>
                        {tl.full_name}<span style={{opacity:0.7,fontWeight:400,fontSize:11}}>— Team Leader</span>
                      </div>
                      <span style={{background:'rgba(255,255,255,0.2)',borderRadius:12,padding:'2px 10px',fontSize:11}}>{tlAgents.length} agents</span>
                    </div>
                    <div style={{padding:'10px 16px',display:'flex',gap:6,flexWrap:'wrap'}}>
                      {tlAgents.length===0?(<span style={{color:'#A0AEC0',fontSize:12}}>No agents assigned</span>)
                      :tlAgents.map(agent=>(
                        <span key={agent.id} style={{background:'#E6F1FB',color:'#185FA5',padding:'4px 10px',borderRadius:6,fontSize:12,fontWeight:500,display:'flex',alignItems:'center',gap:4}}>
                          <span style={{width:5,height:5,borderRadius:'50%',background:agent.status==='active'?'#1D9E75':'#A0AEC0'}}></span>
                          {agent.full_name}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })}
              {users.filter(u=>u.role==='agent'&&!u.team_leader_id).length>0&&(
                <div className="card" style={{overflow:'hidden'}}>
                  <div style={{background:'#F7FAFC',padding:'11px 16px',fontWeight:600,fontSize:13,color:'#718096',borderBottom:'1px solid #E2E8F0'}}>Unassigned Agents</div>
                  <div style={{padding:'10px 16px',display:'flex',gap:6,flexWrap:'wrap'}}>
                    {users.filter(u=>u.role==='agent'&&!u.team_leader_id).map(agent=>(
                      <span key={agent.id} style={{background:'#F7FAFC',color:'#718096',padding:'4px 10px',borderRadius:6,fontSize:12,fontWeight:500}}>{agent.full_name}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab==='leaderboard'&&(
            <div>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
                <h3 style={{fontSize:15,fontWeight:600}}>Leaderboard — Calls This Week</h3>
                <button className="btn btn-outline" style={{fontSize:12}} onClick={fetchLeaderboard}>Refresh</button>
              </div>
              {leaderboard.length===0?(
                <div className="card"><div className="empty-state"><h3>No call data this week</h3><p>Calls logged this week will appear here</p></div></div>
              ):(
                <div className="table-container">
                  <table>
                    <thead><tr><th>#</th><th>Agent</th><th>Calls This Week</th><th>Badge</th></tr></thead>
                    <tbody>
                      {leaderboard.map((row,i)=>(
                        <tr key={row.agentId}>
                          <td style={{fontWeight:700,color:i===0?'#F6AE2D':i===1?'#A0AEC0':i===2?'#B45309':'#718096'}}>{i+1}</td>
                          <td>
                            <div style={{display:'flex',alignItems:'center',gap:8}}>
                              <div style={{width:28,height:28,borderRadius:'50%',background:AB[i%5],display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:600,color:AC[i%5]}}>{gi(row.name)}</div>
                              <span style={{fontWeight:500,fontSize:13}}>{row.name}</span>
                            </div>
                          </td>
                          <td style={{fontWeight:700,fontSize:16,color:'#185FA5'}}>{row.count}</td>
                          <td>
                            {i===0&&<span style={{background:'#FEF3C7',color:'#92400E',padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:600}}>🥇 Top</span>}
                            {i===1&&<span style={{background:'#F3F4F6',color:'#374151',padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:600}}>🥈 2nd</span>}

                            {i>2&&<span style={{color:'#A0AEC0',fontSize:12}}>#{i+1}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab==='leads_admin'&&(
            <div>
              <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
                <div style={{flex:1,minWidth:180,position:'relative'}}><IconSearch size={14} style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'#A0AEC0'}}/><input className='form-input' style={{paddingLeft:32,fontSize:13}} placeholder='Search leads...' value={leadSearch} onChange={e=>setLeadSearch(e.target.value)}/></div>
                <div style={{position:'relative'}}>
                  <button type='button' onClick={()=>setStatusDropOpen(o=>!o)} className='form-input' style={{width:'auto',fontSize:13,cursor:'pointer'}}>{leadStatusSet.length===0?'All Status':`${leadStatusSet.length} selected`} ▾</button>
                  {statusDropOpen&&(
                    <div style={{position:'absolute',top:'110%',left:0,zIndex:50,background:'white',border:'1px solid #E2E8F0',borderRadius:8,boxShadow:'0 8px 24px rgba(0,0,0,0.12)',padding:8,minWidth:200,maxHeight:280,overflowY:'auto'}}>
                      <label style={{display:'flex',alignItems:'center',gap:8,padding:'5px 8px',fontSize:13,cursor:'pointer'}}><input type='checkbox' checked={leadStatusSet.length===0} onChange={()=>setLeadStatusSet([])}/> All Status</label>
                      {(adminStages.length>0?adminStages:STATUS_OPTIONS.map(n=>({name:n}))).map(s=>(
                        <label key={s.id||s.name} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 8px',fontSize:13,cursor:'pointer'}}><input type='checkbox' checked={leadStatusSet.includes(s.name)} onChange={()=>setLeadStatusSet(prev=>prev.includes(s.name)?prev.filter(x=>x!==s.name):[...prev,s.name])}/> {s.name}</label>
                      ))}
                    </div>
                  )}
                </div>
                <select className='form-input' style={{width:'auto',fontSize:13}} value={leadAgentF} onChange={e=>setLeadAgentF(e.target.value)}><option value='All'>All Agents</option>{users.filter(u=>['agent','team_leader'].includes(u.role)).map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select>
                <input type='date' className='form-input' style={{width:'auto',fontSize:13}} value={leadDateFrom} onChange={e=>setLeadDateFrom(e.target.value)}/>
                <input type='date' className='form-input' style={{width:'auto',fontSize:13}} value={leadDateTo} onChange={e=>setLeadDateTo(e.target.value)}/>
                <button className='btn btn-ghost btn-sm' onClick={()=>{setLeadSearch('');setLeadStatusSet([]);setStatusDropOpen(false);setLeadAgentF('All');setLeadDateFrom('');setLeadDateTo('')}}>Clear</button>
                <button className='btn btn-outline btn-sm' style={{whiteSpace:'nowrap',fontSize:12}} onClick={()=>doReassignExport(selected.size>0?adminLeads.filter(l=>selected.has(l.id)):filteredLeads)}>↓ Export{selected.size>0?' Selected':''} for Reassignment</button>
                <button onClick={()=>setShowDupOnly(o=>!o)} style={{padding:'7px 13px',borderRadius:8,border:'1.5px solid '+(showDupOnly?'#dc2626':'#E2E8F0'),background:showDupOnly?'#FEF2F2':'white',color:showDupOnly?'#dc2626':'#64748B',fontSize:12,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>⚠️ Duplicates{dupLeadIds.size>0?' ('+dupLeadIds.size+')':''}</button>
              </div>
              {dupLeadIds.size>0&&(
                <div style={{fontSize:12,color:'#dc2626',fontWeight:600,marginBottom:10}}>⚠️ {dupLeadIds.size} duplicate lead{dupLeadIds.size>1?'s':''} detected (same mobile assigned to the same agent)</div>
              )}
              {selected.size>0&&(
                <div style={{background:'#185FA5',color:'white',padding:'10px 14px',borderRadius:8,marginBottom:10,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                  <span style={{fontSize:13,fontWeight:600}}>{selected.size} lead{selected.size>1?'s':''} selected</span>
                  <select value={assignTo} onChange={e=>setAssignTo(e.target.value)} style={{padding:'5px 10px',borderRadius:6,border:'none',fontSize:13,minWidth:160}}>
                    <option value=''>Reassign to agent...</option>
                    {users.filter(u=>['agent','team_leader'].includes(u.role)).map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)}
                  </select>
                  <button className='btn' style={{background:'white',color:'#185FA5',fontSize:13,padding:'5px 14px'}} onClick={async()=>{ if(!assignTo||selected.size===0)return; setAssigning(true); try{ const selLeads=adminLeads.filter(l=>selected.has(l.id)); const agent=users.find(u=>u.id===assignTo); const ids=[...selected]; const now=new Date().toISOString(); for(let i=0;i<selLeads.length;i+=50){ const batch=selLeads.slice(i,i+50); for(const lead of batch){ const currentMirrors=lead.mirror_agents||[]; const newMirrors=[...new Set([...currentMirrors,lead.assigned_to].filter(Boolean))]; await supabase.from('leads').update({assigned_to:assignTo,mirror_agents:newMirrors,assignment_type:'mirror',assigned_at:now}).eq('id',lead.id) } } const logEntries=selLeads.map(l=>({lead_id:l.id,lead_name:l.full_name||'',action:'Reassigned',assigned_to:assignTo,assigned_to_name:agent?.full_name||'',assigned_by:profile?.id||null,assigned_by_name:profile?.full_name||'Admin',previous_agent_id:l.assigned_to||null,previous_agent_name:users.find(u=>u.id===l.assigned_to)?.full_name||null})); await supabase.from('activity_log').insert(logEntries); showApToast(ids.length+' lead'+(ids.length>1?'s':'')+' reassigned to '+agent?.full_name+'. Original agents retain access.'); try{await supabase.from('notifications').insert([{type:'leads_assigned',agent_id:assignTo,agent_name:'Admin',message:`📥 ${ids.length} new lead${ids.length>1?'s':''} assigned to you`}])}catch(e){} setSelected(new Set()); setAssignTo(''); fetchLeads(); fetchActivityFull() }catch(err){showApToast('Error: '+err.message,'error')} setAssigning(false)}} disabled={assigning||!assignTo}>{assigning?'Reassigning…':'↩ Reassign'}</button>
                  <button onClick={async()=>{ if(!window.confirm('Delete '+selected.size+' selected lead'+(selected.size>1?'s':'')+' permanently?\n\nThis also deletes their call logs, tasks and obligations. This cannot be undone.'))return; try{ const ids=[...selected]; for(let i=0;i<ids.length;i+=50){ const batch=ids.slice(i,i+50); await supabase.from('calls').delete().in('lead_id',batch); await supabase.from('tasks').delete().in('lead_id',batch); await supabase.from('loan_obligations').delete().in('lead_id',batch); await supabase.from('activity_log').delete().in('lead_id',batch); await supabase.from('leads').delete().in('id',batch) } showApToast(ids.length+' lead'+(ids.length>1?'s':'')+' deleted'); setSelected(new Set()); fetchLeads() }catch(e){showApToast('Error: '+e.message,'error')} }} style={{background:'#FEF2F2',border:'1px solid #FECACA',color:'#DC2626',borderRadius:6,padding:'5px 12px',cursor:'pointer',fontSize:13,fontWeight:600}}>🗑 Delete Selected</button>
                  <button onClick={()=>setSelected(new Set())} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',borderRadius:6,padding:'5px 10px',cursor:'pointer',fontSize:12}}>Clear</button>
                </div>
              )}
              <div className='table-container'>
                <div style={{padding:'10px 14px',borderBottom:'1px solid #E2E8F0',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  <span style={{fontSize:13,fontWeight:600}}>{filteredLeads.length} of {adminLeads.length} leads</span>
                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    <div style={{display:'flex',alignItems:'center',gap:4,fontSize:11,fontWeight:600,color:apRtConnected?'#16a34a':'#9ca3af'}}>
                      <div style={{width:7,height:7,borderRadius:'50%',background:apRtConnected?'#22c55e':'#d1d5db',boxShadow:apRtConnected?'0 0 4px #22c55e':undefined}}/>
                      {apRtConnected?'Live sync':'Offline'}
                    </div>
                    <button className='btn btn-ghost btn-sm' style={{fontSize:11}} onClick={fetchLeads}>↻ Refresh</button>
                  </div>
                </div>
                
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}><thead><tr>
<th style={{width:32,padding:'8px 6px',background:'#F8FAFC',borderBottom:'1px solid #E2E8F0',position:'sticky',top:0,zIndex:1}}><input type='checkbox' checked={allLdSel} onChange={()=>{ const next=new Set(selected); allLdSel?filteredLeads.forEach(l=>next.delete(l.id)):filteredLeads.forEach(l=>next.add(l.id)); setSelected(next) }}/></th>
{[['Name',130],['Mobile',105],['Status',120],['Agent',110],['Loan Amt',90],['Actions',180],['Date',90]].map(([h,w])=><th key={h} style={{width:w,padding:'8px 6px',textAlign:'left',fontSize:10.5,fontWeight:600,color:'#94A3B8',textTransform:'uppercase',letterSpacing:'0.04em',whiteSpace:'nowrap',background:'#F8FAFC',borderBottom:'1px solid #E2E8F0',position:'sticky',top:0,zIndex:1,overflow:'hidden'}}>{h}</th>)}
</tr></thead>
                  <tbody>{filteredLeads.length===0?(<tr><td colSpan={8}><div className='empty-state'><h3>No leads found</h3></div></td></tr>):filteredLeads.map(l=>{ const agent=users.find(u=>u.id===l.assigned_to); const ss=apStageStyle(l.status); const obs=adminObligations[l.id]||[]; const totalEMI=obs.reduce((s,o)=>s+(parseFloat(o.emi_amount)||0),0); const sal=parseFloat(l.monthly_salary)||0; const foir=sal>0?Math.round((totalEMI/sal)*100):null; const lastNote=l.notes?l.notes.split('\n').filter(Boolean).pop():''; const isDup=dupLeadIds.has(l.id); const rowBg=selected.has(l.id)?'#EFF6FF':isDup?'#FFF7ED':'white'; return(<tr key={l.id} style={{background:rowBg,borderBottom:'1px solid #F1F5F9'}} onMouseEnter={e=>{if(!selected.has(l.id))e.currentTarget.style.background='#F8FAFC'}} onMouseLeave={e=>{if(!selected.has(l.id))e.currentTarget.style.background=rowBg}}>
<td style={{padding:'8px 6px',verticalAlign:'middle'}}><input type='checkbox' checked={selected.has(l.id)} onChange={()=>{ const n=new Set(selected); n.has(l.id)?n.delete(l.id):n.add(l.id); setSelected(n) }}/></td>
<td style={{padding:'8px 6px',verticalAlign:'middle',overflow:'hidden'}}><div style={{fontWeight:600,fontSize:12,color:'#1E293B',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={l.full_name||''}>{l.full_name||'—'}</div>{isDup&&<span style={{display:'inline-block',marginTop:2,padding:'1px 5px',borderRadius:8,background:'#FEF3C7',color:'#92400E',fontSize:9,fontWeight:700}}>⚠️ DUP</span>}</td>
<td style={{padding:'8px 6px',verticalAlign:'middle',fontSize:11.5,color:'#475569',fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{l.mobile||'—'}</td>
<td style={{padding:'8px 6px',verticalAlign:'middle',whiteSpace:'nowrap'}}><span style={{display:'inline-block',background:ss.bg,color:ss.color,padding:'3px 7px',borderRadius:5,fontSize:10.5,fontWeight:600,border:'1px solid '+ss.color+'33',lineHeight:1.3}}>{l.status||'New'}</span></td>
<td style={{padding:'8px 6px',verticalAlign:'middle',fontSize:11.5,color:'#475569',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={agent?.full_name||''}>{agent?.full_name||<span style={{color:'#CBD5E1'}}>Unassigned</span>}</td>
<td style={{padding:'8px 6px',verticalAlign:'middle',fontSize:11.5,color:'#1E293B',fontWeight:500,whiteSpace:'nowrap'}}>{l.loan_amount?'₹'+Number(l.loan_amount).toLocaleString('en-IN'):<span style={{color:'#CBD5E1'}}>—</span>}</td>


<td style={{padding:'8px 4px',verticalAlign:'middle',whiteSpace:'nowrap'}}>
  <div style={{display:'flex',alignItems:'center',gap:3}}>
    <button onClick={()=>setViewLead(l)} title='View lead' style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:26,height:26,borderRadius:6,background:'white',border:'1px solid #CBD5E1',color:'#185FA5',fontSize:13,cursor:'pointer'}}>👁</button>
    <a href={'tel:'+(l.mobile||'')} title='Call' style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:26,height:26,borderRadius:6,border:'1px solid #FECACA',background:'#FEF2F2',textDecoration:'none'}}><IconPhone size={13} color='#DC2626'/></a>
    <a href={'https://wa.me/91'+(l.mobile||'')} target='_blank' rel='noreferrer' title='WhatsApp' style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:26,height:26,borderRadius:6,border:'1px solid #BBF7D0',background:'#F0FDF4',textDecoration:'none'}}><IconBrandWhatsapp size={13} color='#25D366'/></a>
    <button onClick={()=>{setReassignTarget(l);setReassignTo('')}} title='Reassign (original agent keeps access)' style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:26,height:26,borderRadius:6,background:'#EFF6FF',border:'1px solid #BFDBFE',color:'#1D4ED8',fontSize:13,cursor:'pointer'}}>↩</button>
    <button onClick={()=>handleUnassignLead(l)} title='Unassign agent' style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:26,height:26,borderRadius:6,background:'#FFF7ED',border:'1px solid #FED7AA',color:'#C2410C',fontSize:13,cursor:'pointer'}}>⊘</button>
    <button onClick={()=>handleDeleteLead(l)} title='Delete lead permanently' style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:26,height:26,borderRadius:6,background:'#FEF2F2',border:'1px solid #FECACA',color:'#DC2626',fontSize:12,cursor:'pointer'}}>🗑</button>
  </div>
</td>
<td style={{padding:'8px 6px',verticalAlign:'middle',fontSize:11,color:'#94A3B8',whiteSpace:'nowrap'}}>{l.created_at?new Date(l.created_at).toLocaleDateString('en-IN',{timeZone:IST_TZ}):'—'}</td>
</tr>) })}
                  </tbody></table>
                </div>
              </div>
              {reassignTarget&&(
                <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:3000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={()=>{setReassignTarget(null);setReassignTo('')}}>
                  <div onClick={e=>e.stopPropagation()} style={{background:'white',borderRadius:16,width:'100%',maxWidth:440,padding:28,boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
                    <div style={{fontSize:17,fontWeight:700,marginBottom:4}}>Reassign Lead</div>
                    <div style={{fontSize:13,color:'#64748B',marginBottom:16}}><strong>{reassignTarget.full_name}</strong> ({reassignTarget.mobile})<br/>Currently assigned to: <strong>{users.find(u=>u.id===reassignTarget.assigned_to)?.full_name||'Unassigned'}</strong></div>
                    <div style={{background:'#EFF6FF',border:'1px solid #BFDBFE',borderRadius:10,padding:'10px 14px',marginBottom:16,fontSize:12,color:'#1E40AF'}}>✅ <strong>Safe Reassign:</strong> The original agent keeps access to this lead. The new agent also gets it with full history.</div>
                    <label className='form-label'>Assign To</label>
                    <select className='form-input' style={{width:'100%',marginBottom:20}} value={reassignTo} onChange={e=>setReassignTo(e.target.value)}>
                      <option value=''>Select agent…</option>
                      {users.filter(u=>['agent','team_leader'].includes(u.role)).map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)}
                    </select>
                    <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
                      <button onClick={()=>{setReassignTarget(null);setReassignTo('')}} style={{padding:'9px 20px',border:'1px solid #E2E8F0',borderRadius:8,background:'white',cursor:'pointer',fontSize:13}}>Cancel</button>
                      <button onClick={doReassignLead} disabled={reassigning||!reassignTo} style={{padding:'9px 20px',borderRadius:8,border:'none',background:reassignTo?'#185FA5':'#9CA3AF',color:'white',cursor:reassignTo?'pointer':'not-allowed',fontSize:13,fontWeight:600,opacity:reassigning?0.6:1}}>{reassigning?'Reassigning…':'Reassign Lead'}</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          {activeTab==='activity'&&(
            <div>
              <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
                <select className='form-input' style={{width:'auto',fontSize:13}} value={actFdAgent} onChange={e=>setActFdAgent(e.target.value)}><option value=''>All Agents</option>{users.filter(u=>['agent','team_leader'].includes(u.role)).map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select>
                <input type='date' className='form-input' style={{width:'auto',fontSize:13}} value={actFdDate} onChange={e=>setActFdDate(e.target.value)}/>
                <button className='btn btn-ghost btn-sm' onClick={()=>{setActFdAgent('');setActFdDate('')}}>Clear</button>
                <button className='btn btn-outline btn-sm' onClick={fetchActivityFull}>Refresh</button>
                <span style={{fontSize:12,color:'#718096',marginLeft:'auto'}}>{filteredAct.length} records</span>
              </div>
              <div className='table-container'>
                <div style={{overflowX:'auto'}}>
                  <table><thead><tr>{['Date','Lead Name','Action','Assigned To','Assigned By','Previous Agent'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                  <tbody>{filteredAct.length===0?(<tr><td colSpan={6}><div className='empty-state'><h3>No activity yet</h3><p>Lead assignments will appear here</p></div></td></tr>):filteredAct.map(a=>(<tr key={a.id}><td style={{fontSize:11,color:'#718096',whiteSpace:'nowrap'}}>{a.created_at?new Date(a.created_at).toLocaleString('en-IN',{dateStyle:'short',timeStyle:'short',timeZone:IST_TZ}):'—'}</td><td style={{fontWeight:500,fontSize:13}}>{a.lead_name||'—'}</td><td><span style={{background:a.action==='Reassigned'?'#FEF3C7':'#E6F1FB',color:a.action==='Reassigned'?'#92400E':'#185FA5',padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:500}}>{a.action||'—'}</span></td><td style={{fontSize:12}}>{a.assigned_to_name||users.find(u=>u.id===a.assigned_to)?.full_name||'—'}</td><td style={{fontSize:12,color:'#718096'}}>{a.assigned_by_name||users.find(u=>u.id===a.assigned_by)?.full_name||'—'}</td><td style={{fontSize:12,color:'#A0AEC0'}}>{a.previous_agent_name||'—'}</td></tr>))}
                  </tbody></table>
                </div>
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
                {dispositions.length===0&&<div style={{gridColumn:'1/-1',color:'#A0AEC0',fontSize:13,padding:12}}>No dispositions yet. Add one above.</div>}
              </div>
            </div>
          )}

          {activeTab==='stages_admin'&&(
            <div>
              <h3 style={{fontSize:15,fontWeight:600,marginBottom:14}}>Lead Stages</h3>
              <form onSubmit={addAdminStage} className="card" style={{marginBottom:16,padding:16}}>
                <div style={{display:'flex',gap:10,alignItems:'flex-end',flexWrap:'wrap'}}>
                  <div style={{flex:1,minWidth:160}}><label className="form-label">Stage Name</label><input type="text" className="form-input" value={stageForm.name} onChange={e=>setStageForm({...stageForm,name:e.target.value})} required placeholder="e.g. Under Review"/></div>
                  <div><label className="form-label">Color</label><input type="color" value={stageForm.color} onChange={e=>setStageForm({...stageForm,color:e.target.value})} style={{width:46,height:40,border:'1px solid #E2E8F0',borderRadius:8,cursor:'pointer'}}/></div>
                  <div style={{display:'flex',alignItems:'center',padding:'0 14px',height:40,borderRadius:20,background:stageForm.color+'22',color:stageForm.color,fontSize:12,fontWeight:600,border:'1px solid '+stageForm.color+'44',minWidth:70,justifyContent:'center'}}>{stageForm.name||'Preview'}</div>
                  <button type="submit" className="btn btn-primary">Add Stage</button>
                </div>
              </form>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {adminStages.map((s,i)=>(
                  <div key={s.id} style={{background:'white',padding:'10px 12px',borderRadius:10,border:'1px solid #E2E8F0',display:'flex',alignItems:'center',gap:8,opacity:s.is_active?1:0.55}}>
                    <label title="Click to change color" style={{cursor:'pointer',flexShrink:0,position:'relative'}}>
                      <div style={{width:22,height:22,borderRadius:5,background:s.color,border:'2px solid rgba(0,0,0,0.12)'}}/>
                      <input type="color" value={s.color} onChange={e=>updateAdminStageColor(s.id,e.target.value)} style={{position:'absolute',opacity:0,width:0,height:0,pointerEvents:'none'}}/>
                    </label>
                    <span style={{flex:1,fontWeight:500,fontSize:13,color:s.is_active?'#111827':'#9ca3af',textDecoration:s.is_active?'none':'line-through'}}>{s.name}</span>
                    <span style={{fontSize:11,color:'#A0AEC0',minWidth:18,textAlign:'center'}}>{s.order_index}</span>
                    <button onClick={()=>moveAdminStage(s.id,-1)} disabled={i===0} style={{background:'none',border:'none',cursor:i===0?'default':'pointer',color:i===0?'#E2E8F0':'#718096',fontSize:13,padding:'0 2px',lineHeight:1}}>▲</button>
                    <button onClick={()=>moveAdminStage(s.id,1)} disabled={i===adminStages.length-1} style={{background:'none',border:'none',cursor:i===adminStages.length-1?'default':'pointer',color:i===adminStages.length-1?'#E2E8F0':'#718096',fontSize:13,padding:'0 2px',lineHeight:1}}>▼</button>
                    <button onClick={()=>toggleAdminStage(s.id,s.is_active)} style={{fontSize:10,padding:'2px 6px',border:'1px solid #E2E8F0',borderRadius:4,background:'transparent',cursor:'pointer',color:'#718096'}}>{s.is_active?'Off':'On'}</button>
                    <button onClick={()=>deleteAdminStage(s.id,s.name)} style={{width:22,height:22,border:'1px solid #FED7D7',borderRadius:4,background:'transparent',cursor:'pointer',color:'#FC8181',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14}}>×</button>
                  </div>
                ))}
                {adminStages.length===0&&<div style={{color:'#A0AEC0',fontSize:13,padding:12}}>No stages found. Run the SQL setup script in Supabase to create the lead_stages table and insert defaults.</div>}
              </div>
            </div>
          )}

          {activeTab==='sources'&&(
            <div>
              <h3 style={{fontSize:15,fontWeight:600,marginBottom:14}}>Lead Sources</h3>
              <form onSubmit={addLeadSource} className="card" style={{marginBottom:16,padding:16}}>
                <div style={{display:'flex',gap:10,alignItems:'flex-end',flexWrap:'wrap'}}>
                  <div style={{flex:1,minWidth:160}}><label className="form-label">New Source Name</label><input type="text" className="form-input" value={sourceForm.name} onChange={e=>setSourceForm({...sourceForm,name:e.target.value})} required placeholder="e.g. Facebook Ads"/></div>
                  <button type="submit" className="btn btn-primary">Add</button>
                </div>
              </form>
              <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'repeat(3,1fr)',gap:8}}>
                {leadSources.map(s=>(
                  <div key={s.id} style={{background:'white',padding:'11px 13px',borderRadius:10,border:'1px solid #E2E8F0',display:'flex',alignItems:'center',justifyContent:'space-between',opacity:s.is_active?1:0.5}}>
                    <span style={{fontWeight:500,fontSize:12}}>{s.name}</span>
                    <div style={{display:'flex',gap:4}}>
                      <button onClick={()=>toggleLeadSource(s.id,s.is_active)} style={{fontSize:10,padding:'2px 6px',border:'1px solid #E2E8F0',borderRadius:4,background:'transparent',cursor:'pointer',color:'#718096'}}>{s.is_active?'Off':'On'}</button>
                      <button onClick={()=>deleteLeadSource(s.id)} style={{width:22,height:22,border:'1px solid #FED7D7',borderRadius:4,background:'transparent',cursor:'pointer',color:'#FC8181',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14}}>×</button>
                    </div>
                  </div>
                ))}
                {leadSources.length===0&&<div style={{gridColumn:'1/-1',color:'#A0AEC0',fontSize:13,padding:12}}>No lead sources yet. Add one above.</div>}
              </div>
            </div>
          )}

          {activeTab==='config'&&(
            <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:14}}>
              <div className="card">
                <div className="card-header"><h3>Reset User Password</h3></div>
                <div className="card-body">
                  <label className="form-label">User Email</label>
                  <div style={{display:'flex',gap:8}}>
                    <input className="form-input" style={{flex:1}} placeholder="user@example.com" value={resetEmail} onChange={e=>setResetEmail(e.target.value)}/>
                    <button className="btn btn-primary" onClick={resetPassword} disabled={resetLoading}>{resetLoading?'Resetting...':'Reset'}</button>
                  </div>
                  <p style={{fontSize:11,color:'#718096',marginTop:6}}>Resets to default: Capital@123</p>
                </div>
              </div>
              <div className="card">
                <div className="card-header"><h3>Export Data</h3></div>
                <div className="card-body" style={{display:'flex',flexDirection:'column',gap:8}}>
                  <button className="btn btn-outline" style={{justifyContent:'flex-start'}} onClick={async()=>{
                    const{data}=await supabase.from('leads').select('*').order('created_at',{ascending:false})
                    if(!data||!data.length)return
                    const keys=Object.keys(data[0])
                    exportToExcel('leads_export',[keys,...data.map(r=>keys.map(k=>r[k]??''))],'Leads')
                  }}><IconDownload size={14} style={{marginRight:6}}/>Export Leads Excel</button>
                  <button className="btn btn-outline" style={{justifyContent:'flex-start'}} onClick={async()=>{
                    const{data}=await supabase.from('profiles').select('id,full_name,email,mobile,role,status,department').order('role')
                    if(!data||!data.length)return
                    const keys=Object.keys(data[0])
                    exportToExcel('users_export',[keys,...data.map(r=>keys.map(k=>r[k]??''))],'Users')
                  }}><IconDownload size={14} style={{marginRight:6}}/>Export Users Excel</button>
                </div>
              </div>
              <div className="card" style={{gridColumn:isMobile?'auto':'1/-1'}}>
                <div className="card-header"><h3>Recent Activity Log</h3><button className="btn btn-ghost btn-sm" onClick={fetchActivityLogs}>Refresh</button></div>
                <div className="card-body" style={{padding:0,maxHeight:300,overflowY:'auto'}}>
                  {activityLogs.length===0?(
                    <div style={{padding:16,color:'#A0AEC0',fontSize:13}}>No activity logs found.</div>
                  ):activityLogs.map(log=>(
                    <div key={log.id} style={{padding:'10px 16px',borderBottom:'1px solid #F3F4F6'}}>
                      <div style={{fontSize:12,fontWeight:500,color:'#2D3748'}}>{log.profiles?.full_name||'Unknown'} — <span style={{color:'#185FA5'}}>{log.action}</span></div>
                      {log.details&&<div style={{fontSize:11,color:'#718096',marginTop:2}}>{typeof log.details==='string'?log.details:JSON.stringify(log.details)}</div>}
                      <div style={{fontSize:10,color:'#A0AEC0',marginTop:2}}>{new Date(log.created_at).toLocaleString('en-IN',{timeZone:IST_TZ})}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  const AdminDashboardHome=()=>{
    const [showImport,setShowImport]     = useState(false)
    const [fileHeaders,setFileHeaders]   = useState([])
    const [rawRows,setRawRows]           = useState([])
    const [colMap,setColMap]             = useState({})
    const [csvError,setCsvError]         = useState('')
    const [csvAgents,setCsvAgents]       = useState([])
    const [assignTo,setAssignTo]         = useState('')
    const [importing,setImporting]       = useState(false)
    const [importResult,setImportResult] = useState(null)
    const [adminNotifs,setAdminNotifs]   = useState([])
    const [unreadCount,setUnreadCount]   = useState(0)
    const [showBell,setShowBell]         = useState(false)
    const [adminToast,setAdminToast]     = useState(null)

    const showAdminToast=(msg)=>{ setAdminToast(msg); setTimeout(()=>setAdminToast(null),5000) }

    const fetchAdminNotifs=async()=>{
      const{data}=await supabase.from('notifications').select('*').order('created_at',{ascending:false}).limit(50)
      if(data){ setAdminNotifs(data); setUnreadCount(data.filter(n=>!n.read).length) }
    }

    const markAllRead=async()=>{
      const ids=adminNotifs.filter(n=>!n.read).map(n=>n.id)
      if(!ids.length)return
      await supabase.from('notifications').update({read:true}).in('id',ids)
      setAdminNotifs(prev=>prev.map(n=>({...n,read:true})))
      setUnreadCount(0)
    }

    const markOneRead=async(id)=>{
      await supabase.from('notifications').update({read:true}).eq('id',id)
      setAdminNotifs(prev=>prev.map(n=>n.id===id?{...n,read:true}:n))
      setUnreadCount(c=>Math.max(0,c-1))
    }

    const STALE_STAGES=['Callback','New','Approved','Ringing','Busy','Call cut','Not Required Hup','Not Required Polite','Switched Off','Lead','Voice Mail','Disbursed Other']

    const checkStaleLeads=async()=>{
      try{
        const threeDaysAgo=new Date(Date.now()-3*24*60*60*1000).toISOString()
        const{data:staleLeads}=await supabase.from('leads').select('id,full_name,status,assigned_to,assigned_at,created_at').in('status',STALE_STAGES)
        if(!staleLeads||!staleLeads.length)return
        const stale=staleLeads.filter(l=>{ const ref=l.assigned_at||l.created_at; return ref&&ref<threeDaysAgo })
        if(!stale.length)return
        const staleIds=stale.map(l=>l.id)
        const{data:existing}=await supabase.from('notifications').select('lead_id').eq('type','stale_lead').eq('read',false).in('lead_id',staleIds)
        const alreadyNotified=new Set((existing||[]).map(n=>n.lead_id))
        const toNotify=stale.filter(l=>!alreadyNotified.has(l.id))
        if(!toNotify.length)return
        const agentIds=[...new Set(toNotify.map(l=>l.assigned_to).filter(Boolean))]
        let agentMap={}
        if(agentIds.length){
          const{data:profs}=await supabase.from('profiles').select('id,full_name').in('id',agentIds)
          ;(profs||[]).forEach(p=>{ agentMap[p.id]=p.full_name })
        }
        const rows=toNotify.map(l=>{
          const agentName=agentMap[l.assigned_to]||'Unassigned'
          return{type:'stale_lead',lead_id:l.id,agent_id:l.assigned_to||null,agent_name:agentName,customer_name:l.full_name,stage:l.status,
            message:`🔴 ${agentName}'s lead "${l.full_name}" has been in "${l.status}" for 3+ days with no Login.`}
        })
        await supabase.from('notifications').insert(rows)
      }catch(e){console.error('[checkStaleLeads]',e)}
    }

    useEffect(()=>{
      fetchAdminNotifs()
      checkStaleLeads()
      const staleTick=setInterval(checkStaleLeads,3*60*60*1000)
      const ch=supabase.channel('admin-notifs-ch')
        .on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications'},payload=>{
          const n=payload.new
          setAdminNotifs(prev=>[n,...prev.slice(0,49)])
          setUnreadCount(c=>c+1)
          showAdminToast(n.message)
        })
        .subscribe()
      return ()=>{ clearInterval(staleTick); supabase.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    },[])

    // Derived rows from rawRows + colMap (keeps all existing csvRows references working)
    const csvRows = rawRows.map((row,i)=>{
      const nm  = colMap.full_name       ? (row[colMap.full_name]||'').trim()       : ''
      const mb  = colMap.mobile          ? (row[colMap.mobile]||'').trim()          : ''
      const am  = colMap.loan_amount     ? (row[colMap.loan_amount]||'').trim()     : ''
      const ai  = colMap.application_id  ? (row[colMap.application_id]||'').trim()  : ''
      const nt  = colMap.notes           ? (row[colMap.notes]||'').trim()           : ''
      const ct  = colMap.city            ? (row[colMap.city]||'').trim()            : ''
      const ld  = colMap.lead_date       ? (row[colMap.lead_date]||'')              : ''
      const sn  = colMap.sheet_number    ? (row[colMap.sheet_number]||'').trim()    : ''
      const an  = colMap.agent_name      ? (row[colMap.agent_name]||'').trim()      : ''
      return{_row:i+2,full_name:nm,mobile:mb,loan_amount:am,application_id:ai,notes:nt,city:ct,lead_date:ld,sheet_number:sn,agent_name:an,_valid:!!(nm&&mb)}
    })

    const fetchCSVAgents=async()=>{
      const{data}=await supabase.from('profiles').select('id,full_name').in('role',['agent','team_leader','manager']).order('full_name')
      setCsvAgents(data||[])
    }

    const handleFile=async(e)=>{
      const file=e.target.files[0]; if(!file)return
      try{
        const{headers,rows}=await parseSpreadsheet(file)
        if(!rows.length){setCsvError('No data rows found');return}
        setFileHeaders(headers)
        setRawRows(rows)
        setColMap(autoMapHeaders(headers))
        setCsvError(''); setImportResult(null)
      }catch(err){setCsvError('Parse error: '+err.message)}
    }

    const notifyAgentAssigned=async(agentId,count)=>{
      if(!agentId||!count)return
      try{
        await supabase.from('notifications').insert([{
          type:'leads_assigned',
          agent_id:agentId,
          agent_name:profile?.full_name||'Admin',
          message:`📥 ${count} new lead${count>1?'s':''} assigned to you`,
        }])
      }catch(e){console.error('[notifyAgentAssigned]',e)}
    }

    const handleImport=async()=>{
      setImporting(true)
      const valid=csvRows.filter(r=>r._valid)
      let ok=0,fail=0,firstError=''
      for(let i=0;i<valid.length;i+=100){
        const now=new Date().toISOString()
        const chunk=valid.slice(i,i+100).map(r=>{
          let resolvedAgent=assignTo||null
          if(r.agent_name){
            const norm=r.agent_name.toLowerCase().trim()
            const match=csvAgents.find(a=>(a.full_name||'').toLowerCase().trim()===norm)
            if(match) resolvedAgent=match.id
          }
          return{
            full_name:      r.full_name,
            mobile:         r.mobile.replace(/\D/g,'').slice(-10),
            loan_amount:    r.loan_amount?(parseFloat(String(r.loan_amount).replace(/,/g,''))||null):null,
            application_id: r.application_id||null,
            lead_date:      r.lead_date||null,
            sheet_number:   r.sheet_number||null,
            notes:          r.notes||null,
            city:           r.city||null,
            status:         'New',
            lead_temperature:'Cold',
            assigned_to:    resolvedAgent,
            assigned_at:    resolvedAgent?now:null,
            source:         'Excel Import',
          }
        })
        const{error,data}=await supabase.from('leads').insert(chunk).select('id')
        if(error){ fail+=chunk.length; if(!firstError)firstError=error.message }
        else if(!data||data.length===0){ fail+=chunk.length; if(!firstError)firstError='No rows were inserted — likely a Row Level Security (RLS) block on assigning leads to this agent.' }
        else { ok+=data.length; if(data.length<chunk.length){ fail+=chunk.length-data.length } }
      }
      setImportResult({ok,fail,total:valid.length,error:firstError})
      setImporting(false)
      if(ok>0)fetchDashboardStats()
      if(ok>0&&assignTo) await notifyAgentAssigned(assignTo,ok)
    }

    return(
    <div>
      <div className="page-header">
        <div>
          <h1 style={{display:'flex',alignItems:'center',gap:8,fontSize:isMobile?16:18}}><IconLayoutDashboard size={isMobile?18:22} strokeWidth={1.6}/>Dashboard</h1>
          <p>Welcome, {profile?.full_name||'Admin'} — {new Date().toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',timeZone:IST_TZ})}</p>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <button onClick={()=>{setShowImport(true);fetchCSVAgents();setRawRows([]);setFileHeaders([]);setColMap({});setCsvError('');setImportResult(null)}}
            style={{display:'flex',alignItems:'center',gap:6,background:'#185FA5',color:'white',border:'none',padding:'8px 14px',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer'}}>
            <IconDownload size={15}/> Import Leads
          </button>
          <button className="btn btn-outline btn-sm" onClick={fetchDashboardStats}><IconRefresh size={14}/> Refresh</button>
          <div style={{position:'relative'}}>
            <button onClick={()=>setShowBell(b=>!b)} style={{position:'relative',display:'flex',alignItems:'center',gap:5,padding:'7px 11px',borderRadius:8,border:'1px solid #e5e7eb',background:'white',cursor:'pointer',fontSize:13,fontWeight:500,color:'#374151'}}>
              <IconBell size={16}/>
              {unreadCount>0&&<span style={{position:'absolute',top:-6,right:-6,background:'#dc2626',color:'white',fontSize:10,fontWeight:700,borderRadius:'50%',minWidth:18,height:18,display:'flex',alignItems:'center',justifyContent:'center',padding:'0 3px',lineHeight:1}}>{unreadCount>99?'99+':unreadCount}</span>}
            </button>
            {showBell&&(
              <>
                <div onClick={()=>setShowBell(false)} style={{position:'fixed',inset:0,zIndex:199}}/>
                <div style={{position:'absolute',right:0,top:'110%',width:340,maxHeight:420,overflowY:'auto',background:'white',border:'1px solid #e5e7eb',borderRadius:12,boxShadow:'0 8px 24px rgba(0,0,0,0.14)',zIndex:200}}>
                  <div style={{padding:'10px 14px',borderBottom:'1px solid #e5e7eb',display:'flex',alignItems:'center',justifyContent:'space-between',position:'sticky',top:0,background:'white'}}>
                    <span style={{fontWeight:700,fontSize:13}}>Notifications {unreadCount>0&&<span style={{color:'#dc2626'}}>({unreadCount})</span>}</span>
                    {unreadCount>0&&<button onClick={markAllRead} style={{fontSize:11,color:'#185FA5',background:'none',border:'none',cursor:'pointer',fontWeight:600,padding:0}}>Mark all read</button>}
                  </div>
                  {adminNotifs.length===0?(
                    <div style={{padding:'24px 14px',color:'#9ca3af',fontSize:13,textAlign:'center'}}>No notifications yet.</div>
                  ):adminNotifs.map(n=>(
                    <div key={n.id} onClick={()=>{ if(!n.read)markOneRead(n.id) }} style={{padding:'10px 14px',borderBottom:'1px solid #f3f4f6',cursor:n.read?'default':'pointer',background:n.read?'white':'#eff6ff'}}>
                      <div style={{fontSize:12,color:'#111827',lineHeight:1.5}}>{n.message}</div>
                      <div style={{display:'flex',justifyContent:'space-between',marginTop:4,gap:8}}>
                        <span style={{fontSize:11,color:'#6b7280',fontWeight:500}}>{n.agent_name||''}</span>
                        <span style={{fontSize:11,color:'#9ca3af',flexShrink:0}}>{n.created_at?new Date(n.created_at).toLocaleString('en-IN',{dateStyle:'short',timeStyle:'short',timeZone:IST_TZ}):''}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {adminToast&&<div style={{position:'fixed',bottom:24,right:24,zIndex:9999,background:'#1e293b',color:'white',padding:'12px 18px',borderRadius:10,fontSize:13,fontWeight:500,boxShadow:'0 4px 16px rgba(0,0,0,0.25)',maxWidth:340,lineHeight:1.4}}>{adminToast}</div>}

      {/* CSV IMPORT MODAL */}
      {showImport&&(
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:500}} onClick={()=>setShowImport(false)}/>
          <div style={{position:'fixed',top:isMobile?0:'50%',left:isMobile?0:'50%',transform:isMobile?'none':'translate(-50%,-50%)',background:'white',borderRadius:isMobile?0:16,zIndex:600,width:isMobile?'100%':'94%',maxWidth:700,height:isMobile?'100%':'auto',maxHeight:isMobile?'100vh':'90vh',overflow:'hidden',display:'flex',flexDirection:'column',boxShadow:'0 32px 80px rgba(0,0,0,0.25)'}}>
            <div style={{background:'linear-gradient(135deg,#185FA5,#1e40af)',padding:'16px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
              <div>
                <div style={{color:'white',fontWeight:700,fontSize:16,display:'flex',alignItems:'center',gap:8}}><IconDownload size={18}/>Import Leads from Excel / CSV</div>
                <div style={{color:'rgba(255,255,255,0.7)',fontSize:12,marginTop:2}}>Upload any Excel or CSV — map columns in the next step</div>
              </div>
              <button onClick={()=>setShowImport(false)} style={{background:'rgba(255,255,255,0.15)',border:'none',color:'white',width:32,height:32,borderRadius:'50%',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><IconX size={16}/></button>
            </div>
            <div style={{padding:20,overflowY:'auto',flex:1}}>
              {/* Step 1: Upload */}
              <div style={{marginBottom:18}}>
                <div style={{fontSize:13,fontWeight:700,color:'#111827',marginBottom:8}}>Step 1 — Upload Excel (.xlsx/.xls) or CSV file</div>
                <div style={{background:'#F8FAFC',border:'2px dashed #CBD5E0',borderRadius:10,padding:'20px',textAlign:'center',cursor:'pointer',position:'relative'}}
                  onClick={()=>document.getElementById('csv-file-input').click()}>
                  <input id="csv-file-input" type="file" accept=".xlsx,.xls,.csv,.txt" style={{display:'none'}} onChange={handleFile}/>
                  <IconDownload size={28} color="#94A3B8" style={{display:'block',margin:'0 auto 8px'}}/>
                  <div style={{fontSize:13,fontWeight:600,color:'#374151'}}>Click to upload Excel (.xlsx/.xls) or CSV</div>
                  <div style={{fontSize:11,color:'#9CA3AF',marginTop:4}}>Upload Excel (.xlsx/.xls) or CSV — any column headers</div>
                </div>
                {csvError&&<div style={{marginTop:8,color:'#DC2626',fontSize:12,fontWeight:500}}>{csvError}</div>}
              </div>

              {/* Step 2: Column Mapping */}
              {fileHeaders.length>0&&(
                <div style={{marginBottom:18}}>
                  <div style={{fontSize:13,fontWeight:700,color:'#111827',marginBottom:8}}>Step 2 — Map Columns <span style={{fontWeight:400,color:'#6B7280',fontSize:12}}>(* required)</span></div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:8}}>
                    {[
                      {field:'full_name',label:'Name *',required:true},
                      {field:'mobile',label:'Mobile *',required:true},
                      {field:'loan_amount',label:'Loan Amount'},
                      {field:'application_id',label:'Application ID'},
                      {field:'lead_date',label:'Date'},
                      {field:'sheet_number',label:'Sheet Number'},
                      {field:'agent_name',label:'Existing Agent Name'},
                      {field:'city',label:'City'},
                      {field:'notes',label:'Notes'},
                    ].map(({field,label,required})=>(
                      <div key={field}>
                        <div style={{fontSize:11,fontWeight:600,color:required?'#DC2626':'#6B7280',marginBottom:3}}>{label}</div>
                        <select value={colMap[field]||''} onChange={e=>setColMap(p=>({...p,[field]:e.target.value||null}))}
                          style={{width:'100%',padding:'7px 10px',border:'1.5px solid '+(required&&!colMap[field]?'#FCA5A5':'#E2E8F0'),borderRadius:7,fontSize:12,outline:'none',background:'white'}}>
                          <option value="">— none —</option>
                          {fileHeaders.map(h=><option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 3: Assign */}
              {rawRows.length>0&&(
                <div style={{marginBottom:18}}>
                  <div style={{fontSize:13,fontWeight:700,color:'#111827',marginBottom:8}}>Step 3 — Assign to Agent (optional)</div>
                  <select value={assignTo} onChange={e=>setAssignTo(e.target.value)}
                    style={{width:'100%',padding:'10px 12px',border:'1.5px solid #E2E8F0',borderRadius:8,fontSize:13,outline:'none',background:'white'}}>
                    <option value="">— Unassigned —</option>
                    {csvAgents.map(a=><option key={a.id} value={a.id}>{a.full_name}</option>)}
                  </select>
                </div>
              )}

              {/* Preview */}
              {csvRows.length>0&&(
                <div style={{marginBottom:18}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                    <div style={{fontSize:13,fontWeight:700,color:'#111827'}}>Preview — {csvRows.length} rows ({csvRows.filter(r=>r._valid).length} valid)</div>
                    {csvRows.filter(r=>!r._valid).length>0&&<span style={{fontSize:11,color:'#DC2626',fontWeight:600}}>{csvRows.filter(r=>!r._valid).length} rows missing Name/Number will be skipped</span>}
                  </div>
                  <div style={{overflowX:'auto',borderRadius:8,border:'1px solid #E2E8F0'}}>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                      <thead>
                        <tr style={{background:'#F9FAFB'}}>
                          {['#','Name','Mobile','Loan Amount','App ID','Notes','Status'].map(h=><th key={h} style={{padding:'8px 12px',fontWeight:600,color:'#6B7280',textAlign:'left',whiteSpace:'nowrap'}}>{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {csvRows.slice(0,8).map(r=>(
                          <tr key={r._row} style={{borderTop:'1px solid #F3F4F6',opacity:r._valid?1:0.4}}>
                            <td style={{padding:'7px 12px',color:'#9CA3AF'}}>{r._row}</td>
                            <td style={{padding:'7px 12px',fontWeight:500,color:'#111827'}}>{r.full_name||'—'}</td>
                            <td style={{padding:'7px 12px',color:'#374151'}}>{r.mobile||'—'}</td>
                            <td style={{padding:'7px 12px',color:'#374151'}}>{r.loan_amount?'₹'+r.loan_amount:'—'}</td>
                            <td style={{padding:'7px 12px',color:'#374151'}}>{r.application_id||'—'}</td>
                            <td style={{padding:'7px 12px',color:'#374151',maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.notes||'—'}</td>
                            <td style={{padding:'7px 12px'}}>{r._valid?<span style={{background:'#D1FAE5',color:'#065F46',padding:'2px 7px',borderRadius:4,fontWeight:600}}>✓ OK</span>:<span style={{background:'#FEE2E2',color:'#991B1B',padding:'2px 7px',borderRadius:4,fontWeight:600}}>Skip</span>}</td>
                          </tr>
                        ))}
                        {csvRows.length>8&&<tr><td colSpan={6} style={{padding:'7px 12px',color:'#9CA3AF',textAlign:'center'}}>...and {csvRows.length-8} more rows</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Result */}
              {importResult&&(
                <div style={{background:importResult.fail===0?'#F0FFF4':'#FFFBEB',border:'1px solid '+(importResult.fail===0?'#86EFAC':'#FCD34D'),borderRadius:10,padding:14,marginBottom:16}}>
                  <div style={{fontWeight:700,fontSize:14,color:importResult.fail===0?'#065F46':'#92400E',marginBottom:4}}>Import Complete</div>
                  <div style={{fontSize:13,color:importResult.fail===0?'#166534':'#78350F'}}>✅ {importResult.ok} leads imported successfully{importResult.fail>0?` · ⚠️ ${importResult.fail} failed`:''}</div>
                  {importResult.error&&<div style={{fontSize:12,color:'#dc2626',marginTop:6}}>Error: {importResult.error}</div>}
                </div>
              )}
            </div>
            <div style={{padding:'14px 20px',borderTop:'1px solid #E2E8F0',display:'flex',gap:10,justifyContent:'flex-end',flexShrink:0}}>
              <button onClick={()=>setShowImport(false)} style={{padding:'9px 18px',background:'transparent',border:'1px solid #E2E8F0',borderRadius:8,fontSize:13,cursor:'pointer',color:'#6B7280'}}>Close</button>
              {rawRows.length>0&&!importResult&&(
                <button onClick={handleImport} disabled={importing||!colMap.full_name||!colMap.mobile||csvRows.filter(r=>r._valid).length===0}
                  style={{padding:'9px 20px',background:'#185FA5',color:'white',border:'none',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer',opacity:(importing||!colMap.full_name||!colMap.mobile||csvRows.filter(r=>r._valid).length===0)?0.6:1}}>
                  {importing?'Importing…':`Import ${csvRows.filter(r=>r._valid).length} Leads`}
                </button>
              )}
              {importResult&&<button onClick={()=>setShowImport(false)} style={{padding:'9px 20px',background:'#065F46',color:'white',border:'none',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer'}}>Done</button>}
            </div>
          </div>
        </>
      )}

      <div className="page-body">
        <div className="stats-grid">
          {[
            {icon:<IconUsers size={18} color="#185FA5"/>,label:'Total Leads',value:stats.totalLeads,color:'#185FA5',bg:'#E6F1FB'},
            {icon:<IconPhoneIncoming size={18} color="#0F6E56"/>,label:'Calls Today',value:stats.todayCalls,color:'#0F6E56',bg:'#E1F5EE'},
            {icon:<IconCheckbox size={18} color="#854F0B"/>,label:'Pending Tasks',value:stats.pendingTasks,color:'#854F0B',bg:'#FAEEDA'},
            {icon:<IconChartBar size={18} color="#534AB7"/>,label:'Converted',value:stats.converted,color:'#534AB7',bg:'#EEEDFE'},
          ].map(s=>(
            <div key={s.label} className="stat-card">
              <div className='stat-icon' style={{background:s.bg}}>{s.icon}</div>
              <div className='stat-info'><h3 style={{color:s.color}}>{s.value}</h3><p>{s.label}</p></div>
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
            <div className="card-header"><h3 style={{fontSize:13}}>All Call Logs</h3></div>
            {allCalls.length===0
              ?<div className="empty-state" style={{padding:24}}><p>No call logs yet</p></div>
              :<div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead>
                    <tr style={{background:'#F9FAFB'}}>
                      {['Lead','Status','Outcome','Duration','Date'].map(h=>(
                        <th key={h} style={{padding:'10px 14px',fontSize:11,fontWeight:600,color:'#718096',textAlign:'left',textTransform:'uppercase',letterSpacing:'0.4px'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allCalls.map(call=>{
                      const lead = allLeads.find(l=>l.id===call.lead_id)
                      return(
                        <tr key={call.id} style={{borderBottom:'1px solid #F7FAFC'}}>
                          <td style={{padding:'11px 14px',fontSize:13,color:'#2D3748'}}>{lead?.full_name||'Unknown'}</td>
                          <td style={{padding:'11px 14px',fontSize:13,color:'#4A5568'}}>{call.call_status||'N/A'}</td>
                          <td style={{padding:'11px 14px',fontSize:13,color:'#4A5568'}}>{call.call_outcome||'-'}</td>
                          <td style={{padding:'11px 14px',fontSize:13,color:'#4A5568'}}>{call.duration||'-'}</td>
                          <td style={{padding:'11px 14px',fontSize:13,color:'#4A5568'}}>{new Date(call.created_at).toLocaleDateString('en-IN',{timeZone:IST_TZ})}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
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
  }

  if(roleLoading) return(
    <div className='loading-screen'>
      <div className='spinner spinner-lg'/>
      <p>Loading…</p>
    </div>
  )
  // admin uses main layout — no early return

  return(
    <div style={{display:'flex',minHeight:'100vh',background:'var(--bg)'}}>

      {/* SIDEBAR OVERLAY */}
      {isMobile&&<div className={'sidebar-overlay'+(sidebarOpen?' show':'')} onClick={()=>setSidebarOpen(false)}/>}

      {/* SIDEBAR */}
      <aside className={'sidebar'+(isMobile?(sidebarOpen?' open':''):'')}>
        <div className='sidebar-logo'>
          <div className='sidebar-logo-icon'><IconBolt size={16} color='white' strokeWidth={2}/></div>
          <div className='sidebar-logo-text'><h2>{crmName}</h2><p>{crmTagline}</p></div>
        </div>
        <nav className='sidebar-nav'>
          {navSections.map((section,si)=>(
            <div key={si}>
              <div className='nav-section-label'>{section.section}</div>
              {section.items.filter(item=>item.roles.includes(role)).map(item=>(
                <div key={item.id} className={'nav-item'+(activePage===item.id?' active':'')} onClick={()=>{ setActivePage(item.id); setSidebarOpen(false) }}>
                  <span className='nav-icon'>{getIcon(item.icon)}</span>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          ))}
        </nav>
        <div className='sidebar-footer'>
          <div className='user-card'>
            <div className='user-avatar'>{(profile?.full_name||'U')[0].toUpperCase()}</div>
            <div className='user-info'><h4>{profile?.full_name||'User'}</h4><p>{role.replace('_',' ')}</p></div>
            <button className='logout-btn' onClick={handleLogout} title='Logout'><IconPower size={14} strokeWidth={1.8}/></button>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main className='main-content'>
        {/* MOBILE TOP BAR */}
        <div className='mobile-topbar'>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <button className='hamburger' onClick={()=>setSidebarOpen(!sidebarOpen)}><IconMenu2 size={20}/></button>
            <div style={{display:'flex',alignItems:'center',gap:7}}>
              <IconBolt size={16} color='#185FA5'/>
              <span style={{fontSize:14,fontWeight:700,color:'#0f172a'}}>{crmName}</span>
            </div>
          </div>
          <div className='user-avatar' style={{background:'#185FA5',width:32,height:32,fontSize:12}}>{(profile?.full_name||'U')[0].toUpperCase()}</div>
        </div>

        {activePage==='dashboard'&&role==='admin'       &&<ErrorBoundary><AdminDashboardHome userId={profile?.id}/></ErrorBoundary>}
        {activePage==='admin'    &&role==='admin'       &&<ErrorBoundary><AdminPanel/></ErrorBoundary>}
        {activePage==='dashboard'&&role==='manager'     &&<ErrorBoundary><ManagerPanel     userId={profile?.id}/></ErrorBoundary>}
        {activePage==='dashboard'&&role==='team_leader' &&<ErrorBoundary><TeamLeaderPanel  userId={profile?.id}/></ErrorBoundary>}
        {activePage==='dashboard'&&role==='agent'       &&<ErrorBoundary><AgentDashboard   userId={profile?.id}/></ErrorBoundary>}
        {activePage==='leads'    &&<ErrorBoundary><Leads     userRole={role} userId={profile?.id}/></ErrorBoundary>}
        {activePage==='campaigns'&&<ErrorBoundary><Campaigns userRole={role} userId={profile?.id}/></ErrorBoundary>}
        {activePage==='calls'    &&<ErrorBoundary><Calls     userRole={role} userId={profile?.id}/></ErrorBoundary>}
        {activePage==='tasks'    &&<ErrorBoundary><Tasks     userRole={role} userId={profile?.id}/></ErrorBoundary>}
        {activePage==='cibil'             &&<ErrorBoundary><CibilParser userRole={role} userId={profile?.id} source="cibil"        onUseInCam={()=>setActivePage('cam')}/></ErrorBoundary>}
        {activePage==='cibil-paisabazaar' &&<ErrorBoundary><CibilParser userRole={role} userId={profile?.id} source="paisabazaar" onUseInCam={()=>setActivePage('cam')}/></ErrorBoundary>}
        {activePage==='bsa'               &&<ErrorBoundary><BankStatementAnalyzer/></ErrorBoundary>}
        {activePage==='emi'               &&<ErrorBoundary><EmiCalculator userRole={role} userId={profile?.id}/></ErrorBoundary>}
        {activePage==='cam'               &&<ErrorBoundary><CamCalculator userRole={role} userId={profile?.id}/></ErrorBoundary>}
        {activePage==='call-assist'       &&<ErrorBoundary><CallAssist    userRole={role} userId={profile?.id}/></ErrorBoundary>}
        {activePage==='reports'  &&<ErrorBoundary><Reports   userRole={role} userId={profile?.id}/></ErrorBoundary>}
      </main>
      {viewLead&&(
        <div onClick={()=>setViewLead(null)} style={{position:'fixed',inset:0,background:'rgba(15,23,42,0.55)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999,padding:16}}>
          <div onClick={e=>e.stopPropagation()} style={{background:'white',borderRadius:14,width:'100%',maxWidth:520,maxHeight:'85vh',overflowY:'auto',boxShadow:'0 20px 50px rgba(0,0,0,0.25)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'18px 22px',borderBottom:'1px solid #EEF2F6'}}>
              <div>
                <div style={{fontSize:17,fontWeight:700,color:'#0F172A'}}>{viewLead.full_name||'—'}</div>
                <div style={{fontSize:13,color:'#64748B'}}>{viewLead.mobile||'—'}</div>
              </div>
              <button onClick={()=>setViewLead(null)} style={{border:'none',background:'#F1F5F9',width:32,height:32,borderRadius:8,cursor:'pointer',fontSize:18,color:'#475569'}}>×</button>
            </div>
            <div style={{padding:'18px 22px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'14px 18px'}}>
              {[
                ['Status',viewLead.status||'—'],
                ['Previous Status',viewLead.previous_status||'—'],
                ['Sheet No.',viewLead.sheet_number||'—'],
                ['City',viewLead.city||'—'],
                ['Loan Amount',viewLead.loan_amount?'₹'+Number(viewLead.loan_amount).toLocaleString('en-IN'):'—'],
                ['Monthly Salary',viewLead.monthly_salary?'₹'+Number(viewLead.monthly_salary).toLocaleString('en-IN'):'—'],
                ['Company',viewLead.company_name||'—'],
                ['Application ID',viewLead.application_id||'—'],
                ['Date',viewLead.created_at?new Date(viewLead.created_at).toLocaleDateString('en-IN',{timeZone:IST_TZ}):'—'],
              ].map(([k,v])=>(
                <div key={k}>
                  <div style={{fontSize:11,fontWeight:600,color:'#94A3B8',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:3}}>{k}</div>
                  <div style={{fontSize:14,color:'#1E293B',fontWeight:500}}>{v}</div>
                </div>
              ))}
              <div style={{gridColumn:'1 / -1'}}>
                <div style={{fontSize:11,fontWeight:600,color:'#94A3B8',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:3}}>Notes</div>
                <div style={{fontSize:13.5,color:'#334155',whiteSpace:'pre-wrap',lineHeight:1.5}}>{viewLead.notes||'—'}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
 
