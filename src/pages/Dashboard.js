/* eslint-disable */
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../supabase'

import Leads from './Leads'
import Tasks from './Tasks'
import Calls from './Calls'
import Reports from './Reports'
import Settings from './Settings'
import Campaigns from './Campaigns'
import AgentCallingFlow from './AgentCallingFlow'
import CibilParser from './CibilParser'
import {
  IconLayoutDashboard, IconUsers, IconPhoneCall, IconCheckbox,
  IconChartBar, IconSettings, IconAdjustments, IconPhone,
  IconPower, IconEdit, IconPhoneIncoming, IconBuildingStore,
  IconThumbUp, IconCircleCheck, IconRefresh, IconBell,
  IconX, IconAlertTriangle, IconClockHour4, IconBrandWhatsapp,
  IconDownload, IconSearch, IconMail, IconNotes,
  IconBolt, IconDeviceFloppy, IconMenu2, IconEye
} from '@tabler/icons-react'

const STATUS_OPTIONS = ['New','Interested','Callback','Login','Approved','Disbursed','Not Interested','DND']
const IST_TZ     = 'Asia/Kolkata'
// Returns current IST date as 'YYYY-MM-DD'
const istToday   = () => new Date().toLocaleDateString('en-CA',{timeZone:IST_TZ})
// Returns current IST datetime as 'YYYY-MM-DDTHH:mm:ss' (no timezone suffix).
// Used for ALL comparisons — matches the plain format we store in Supabase.
const istNowStr  = () => istToday()+'T'+new Date().toLocaleTimeString('en-GB',{timeZone:IST_TZ,hour12:false})
// Same but 5 minutes ahead
const istFiveStr = () => {const d=new Date(Date.now()+5*60*1000);return d.toLocaleDateString('en-CA',{timeZone:IST_TZ})+'T'+d.toLocaleTimeString('en-GB',{timeZone:IST_TZ,hour12:false})}

// Shift a plain IST datetime string by ±N minutes.
// Uses Date component constructor so it always treats the string as local/IST,
// never as UTC — safe regardless of the browser's timezone setting.
const addMinutesToISTStr=(isoStr,mins)=>{
  const clean=String(isoStr||'').replace(/\.\d+/,'').replace(/(\+\d{2}:\d{2}|Z)$/,'').replace('T',' ')
  const[dp,tp]=clean.split(' ')
  const[yr,mo,dy]=(dp||'').split('-').map(Number)
  const[hh=0,mm=0,sc=0]=(tp||'00:00:00').split(':').map(Number)
  const d=new Date(yr,mo-1,dy,hh,mm,sc)
  d.setMinutes(d.getMinutes()+mins)
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')
    +'T'+[String(d.getHours()).padStart(2,'0'),String(d.getMinutes()).padStart(2,'0'),String(d.getSeconds()).padStart(2,'0')].join(':')
}
const subtractMinutesFromISTStr=(isoStr,mins)=>addMinutesToISTStr(isoStr,-mins)

const SNOOZE_INTERVAL_MIN = 5

const shouldTriggerReminder=(task, lastSnoozeAt)=>{
  if(!task) return false
  if(task.status==='Completed'||task.status==='Attempted') return false
  const now=istNowStr()
  const due=String(task.due_date||'').replace(/\.\d+/,'').replace(/(\+\d{2}:\d{2}|Z)$/,'').replace(' ','T')
  if(!due) return false
  const reminderStart=subtractMinutesFromISTStr(due,SNOOZE_INTERVAL_MIN)
  if(now<reminderStart) return false
  if(!lastSnoozeAt) return true
  const nextAllowed=addMinutesToISTStr(lastSnoozeAt,SNOOZE_INTERVAL_MIN)
  return now>=nextAllowed
}

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

const CALL_DISPOSITIONS = [
  'Interested',
  'Callback',
  'Not Interested',
  'DND',
  'Busy',
  'Ringing',
  'Switched Off',
  'Not Reachable',
  'Voice Mail',
  'Call cut',
  'Wrong Number/ Invalid Number',
  'Not Required Hup',
  'Not Required Polite',
  'Not Doable',
  'Login',
  'Approved',
  'Disbursed',
  'Disbursed Other',
  'Police',
  'Lead',
]

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
  const [callLogDuration,setCallLogDuration]     = useState('')
  const [callLogNotes,setCallLogNotes]           = useState('')
  const [callLogCallbackDate,setCallLogCallbackDate] = useState('')
  const [callLogCallbackTime,setCallLogCallbackTime] = useState('10:00')
  const [savingCallLog,setSavingCallLog]         = useState(false)

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
    checkRemindersRef.current?.()
    fetchWATemplates()
    fetchCallbackTasksRef.current?.()
    // 30-second poll — refs always point to the latest function so closures stay fresh
    const iv=setInterval(()=>{checkRemindersRef.current?.();fetchCallbackTasksRef.current?.()},30000)
    return()=>clearInterval(iv)
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
        // Normalize any disposition value that leaked into lead status
        const _rtDispositionToStage={
          'Busy':'Callback','Ringing':'Callback','Switched Off':'Callback',
          'Not Reachable':'Callback','Voice Mail':'Callback','Call cut':'Callback',
          'Wrong Number/ Invalid Number':'Not Interested','Not Required Hup':'Not Interested',
          'Not Required Polite':'Not Interested','Not Doable':'Not Interested',
          'Police':'Callback','Lead':'New','Disbursed Other':'Disbursed',
        }
        if(upd.status && _rtDispositionToStage[upd.status]){
          upd.status=_rtDispositionToStage[upd.status]
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
          if(upd.assigned_to&&upd.assigned_to!==userId){
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
    // Fetch ALL non-terminal callbacks — no date restriction so overdue tasks surface
    const{data}=await supabase.from('tasks').select('*')
      .eq('assigned_to',userId)
      .in('status',['Pending','Attempted'])
      .ilike('title','Callback:%')
      .order('due_date',{ascending:true})
    const allTasks=data||[]
    const now=istNowStr()

    // Active = shouldTriggerReminder (5-min-before window, repeating every SNOOZE_INTERVAL_MIN)
    const triggeredTasks=allTasks.filter(t=>{
      if(t.status==='Attempted') return false
      return shouldTriggerReminder(t, snoozedTasksRef.current[t.id]||null)
    })

    // Overdue = past due_date, not Completed/Attempted
    const overdueTasks=allTasks.filter(t=>{
      if(t.status==='Attempted') return false
      const due=String(t.due_date||'').replace(/\.\d+/,'').replace(/(\+\d{2}:\d{2}|Z)$/,'').replace(' ','T')
      return due&&now>due
    })

    // Display list: overdue first, then triggered (deduplicated)
    const displayTasks=[...overdueTasks,...triggeredTasks]
      .filter((t,i,a)=>a.findIndex(x=>x.id===t.id)===i)
    setCallbackTasks(displayTasks)
    const map={}; displayTasks.forEach(t=>{ if(t.lead_id) map[t.lead_id]=t })
    setLeadCallbackMap(map)

    // Show popup + beep when any task is triggered and popup isn't already up
    if(triggeredTasks.length>0){
      // Stamp snooze time for each triggered task
      triggeredTasks.forEach(t=>{ snoozedTasksRef.current[t.id]=now })
      setShowCallbackReminder(true)
      if(!alreadyBuzzingRef.current){
        alreadyBuzzingRef.current=true
        playCallbackBeep()
      }
    }
  }

  const markCallbackDone=async(taskId)=>{
    console.log('[Action] markCallbackDone → DB write task:', taskId)
    const {error}=await supabase.from('tasks').update({status:'Completed'}).eq('id',taskId)
    if(error){ console.error('[Action] markCallbackDone error:', error); return }
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
    const {error}=await supabase.from('tasks').update({status:'Attempted'}).eq('id',taskId)
    if(error){ console.error('[Action] markCallbackAttempted error:', error); return }
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

  // Store plain local datetime — no UTC conversion.
  // Supabase keeps the value as-is; getUTCHours/Minutes reads it back unchanged.
  const scheduleDueDate=(dateStr,timeStr)=>`${dateStr}T${timeStr}:00`

  // If the composed datetime is already in the past, roll forward by exactly 1 day
  // so agents who pick an earlier time slot don't silently create overdue tasks.
  const safeDueDate=(dateStr,timeStr)=>{
    const candidate=`${dateStr}T${timeStr}:00`
    if(candidate<=istNowStr()) return addMinutesToISTStr(candidate,24*60)
    return candidate
  }

  const rescheduleCallback=async(taskId)=>{
    if(!rescheduleDate||!rescheduleTime) return
    const iso=scheduleDueDate(rescheduleDate,rescheduleTime)
    console.log('[Action] rescheduleCallback → DB write task:', taskId, 'due:', iso)
    const {error}=await supabase.from('tasks').update({due_date:iso,status:'Pending'}).eq('id',taskId)
    if(error){ console.error('[Action] rescheduleCallback error:', error); return }
    delete snoozedTasksRef.current[taskId]
    setMyTasks(prev=>[...prev.map(t=>t.id===taskId?{...t,due_date:iso,status:'Pending'}:t)])
    setRescheduleTaskId(null)
    fetchCallbackTasks()
    showToast('Callback rescheduled!')
  }

  const scheduleCallback=async()=>{
    if(!callbackLead||!callbackDate||!callbackTime) return
    const iso=safeDueDate(callbackDate,callbackTime)
    console.log('[Action] scheduleCallback → DB write lead:', callbackLead.id, 'task due:', iso)
    const {error:lErr}=await supabase.from('leads').update({status:'Callback'}).eq('id',callbackLead.id)
    if(lErr){ console.error('[Action] scheduleCallback lead update error:', lErr) }
    else { setMyLeads(prev=>[...prev.map(l=>l.id===callbackLead.id?{...l,status:'Callback'}:l)]) }
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
    setShowCallbackModal(false)
    fetchCallbackTasks()
    const d=new Date(callbackDate).toLocaleDateString('en-IN',{day:'numeric',month:'short'})
    showToast(`Callback scheduled for ${d} at ${callbackTime}`)
  }

  const skipCallback=async()=>{
    if(!callbackLead) return
    await supabase.from('leads').update({status:'Callback'}).eq('id',callbackLead.id)
    setMyLeads(prev=>prev.map(l=>l.id===callbackLead.id?{...l,status:'Callback'}:l))
    setShowCallbackModal(false)
    showToast('Stage updated to Callback')
  }

  const checkReminders=async()=>{
    if(!userId)return
    const now=istNowStr(), five=istFiveStr()
    const{data:upcoming}=await supabase.from('tasks').select('*')
      .eq('assigned_to',userId).in('status',['Pending','In Progress'])
      .gte('due_date',now).lte('due_date',five)
    const{data:overdue}=await supabase.from('tasks').select('*')
      .eq('assigned_to',userId).in('status',['Pending','In Progress'])
      .lt('due_date',now)
    const all=[...(upcoming||[]),...(overdue||[])]
    const unique=all.filter((t,i,a)=>a.findIndex(x=>x.id===t.id)===i)
    setNotifications(unique)
    // Exclude Callback: tasks — handled by the dedicated callback reminder popup
    const nonCb=upcoming?.filter(t=>!t.title?.startsWith('Callback:'))||[]
    // Use ref so we never read a stale reminderPopup closure value
    if(nonCb.length>0&&!reminderPopupRef.current) setReminderPopup(nonCb[0])
  }

  const fetchLeadStages=async()=>{
    const{data}=await supabase.from('lead_stages').select('*').eq('is_active',true).order('order_index')
    if(data&&data.length>0) setLeadStages(data)
  }

  const fetchAll=async()=>{
    if(!userId) return
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
      const{data:obligationsData,error:oErr}=await supabase.from('loan_obligations').select('*').in('lead_id',leadIds)
      if(!oErr){
        obligationMap=(obligationsData||[]).reduce((acc,o)=>{acc[o.lead_id]=[...(acc[o.lead_id]||[]),o];return acc},{})
      }
    }
    setMyLeads(leads); setMyCalls(cR.data||[])
    setMyTasks(tR.data||[]); setProfile(pR.data)
    setLeadObligations(obligationMap)
    computePipelineStats(leads)
    setLoading(false)
  }
  // Always keep ref pointing to latest fetchAll so real-time callbacks don't go stale
  fetchAllRef.current = fetchAll
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

  const updateLeadStatus=async(leadId,newStatus)=>{
    if(newStatus==='Callback'){
      const lead=myLeads.find(l=>l.id===leadId)
      setCallbackLead(lead)
      setCallbackDate(istToday())
      setCallbackTime('10:00')
      setCallbackNotes('')
      setShowCallbackModal(true)
      return
    }
    console.log('[Action] updateLeadStatus → DB write:', leadId, newStatus)
    const {error}=await supabase.from('leads').update({status:newStatus}).eq('id',leadId)
    if(error){ console.error('[Action] updateLeadStatus DB error:', error); return }
    // Optimistic update — RT subscription will also fire on other devices
    setMyLeads(prev=>[...prev.map(l=>l.id===leadId?{...l,status:newStatus}:l)])
    showToast('Stage updated to '+newStatus)
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
    const relaxationLoans=['Personal Loan','Housing Loan','Car Loan','Bike Loan','Consumer Durable Loan']
    if(relaxationLoans.includes(loanType)&&remaining<=3)return 0
    switch(loanType){
      case 'Personal Loan':
        if(ob.balance_transfer===true||ob.balance_transfer==='true'||ob.balance_transfer==='Yes'||ob.balance_transfer==='yes')return 0
        return emi
      case 'Credit Card':
        if(ob.balance_transfer===true||ob.balance_transfer==='true'||ob.balance_transfer==='Yes'||ob.balance_transfer==='yes')return 0
        return (parseFloat(ob.outstanding_amount)||0)*0.05
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
      case 'Bike Loan': case 'Consumer Durable Loan': case 'Gold Loan': return emi
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
    const salary=parseFloat(obModalSalary)||0
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
      // Persist salary, company, and notes back to the lead record
      const salaryVal=obModalSalary===''?null:parseFloat(obModalSalary)||null
      await supabase.from('leads').update({
        monthly_salary:salaryVal,
        company_name:obModalCompany||null,
        notes:obModalNotes||null,
      }).eq('id',leadId)
      setMyLeads(prev=>prev.map(l=>l.id===leadId?{...l,monthly_salary:salaryVal,company_name:obModalCompany||null,notes:obModalNotes||null}:l))
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

  const handleCall=(lead)=>{
    window.location.href=`tel:${lead.mobile}`
    setCallLogLead(lead)
    setCallLogDisposition('')
    setCallLogDuration('')
    setCallLogNotes('')
    setCallLogCallbackDate(istToday())
    setCallLogCallbackTime('10:00')
    setShowCallLogModal(true)
  }

  const openCallingWorkspace=(lead)=>{ handleCall(lead) }

  const saveCallLog=async()=>{
    if(!callLogLead) return
    setSavingCallLog(true)

    await supabase.from('calls').insert({
      lead_id: callLogLead.id,
      agent_id: userId,
      call_outcome: callLogDisposition||null,
      duration: callLogDuration||null,
      notes: callLogNotes||null,
      created_at: new Date().toISOString()
    })

    if(callLogDisposition){
      const dispositionToStage={
        'Interested':'Interested',
        'Callback':'Callback',
        'Not Interested':'Not Interested',
        'DND':'DND',
        'Login':'Login',
        'Approved':'Approved',
        'Disbursed':'Disbursed',
        'Disbursed Other':'Disbursed',
        'Busy':'Callback',
        'Ringing':'Callback',
        'Switched Off':'Callback',
        'Not Reachable':'Callback',
        'Voice Mail':'Callback',
        'Call cut':'Callback',
        'Wrong Number/ Invalid Number':'Not Interested',
        'Not Required Hup':'Not Interested',
        'Not Required Polite':'Not Interested',
        'Not Doable':'Not Interested',
        'Police':'Callback',
        'Lead':'New',
      }
      const mappedStage=dispositionToStage[callLogDisposition]||null
      if(mappedStage){
        const{error}=await supabase.from('leads').update({status:mappedStage}).eq('id',callLogLead.id)
        if(!error) setMyLeads(prev=>[...prev.map(l=>l.id===callLogLead.id?{...l,status:mappedStage}:l)])
      }
    }

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

    setMyCalls(prev=>[{
      id: Date.now().toString(),
      lead_id: callLogLead.id,
      agent_id: userId,
      call_outcome: callLogDisposition||null,
      duration: callLogDuration||null,
      notes: callLogNotes||null,
      created_at: new Date().toISOString()
    },...prev])

    setSavingCallLog(false)
    setShowCallLogModal(false)
    setCallLogDisposition('')
    setCallLogDuration('')
    setCallLogNotes('')
    showToast('Call logged successfully')
    fetchAll()
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

  const _stripTZ=(value)=>{
    if(!value) return ''
    try{ return String(value).replace(/\.\d+/,'').replace(/(\+\d{2}:\d{2}|Z)$/,'').trim() }
    catch(e){ return '' }
  }
  const _MO=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const fmtISTDate=(iso)=>{try{const[dt]=_stripTZ(iso).split('T');const[,mo,d]=(dt||'').split('-');if(!mo||!d)return '—';return Number(d)+' '+(_MO[Number(mo)-1]||'?')}catch(e){return '—'}}
  const fmtISTTime=(iso)=>{try{const[,tm]=_stripTZ(iso).split('T');const[hh,mm]=(tm||'00:00').split(':');let h=Number(hh)||0,m=Number(mm)||0,ap=h>=12?'pm':'am';h=h%12||12;return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+' '+ap}catch(e){return '—'}}
  const isISTToday=(iso)=>{try{return _stripTZ(iso).slice(0,10)===istToday()}catch(e){return false}}
  const fmtIST=(iso)=>fmtISTDate(iso)+' '+fmtISTTime(iso)

  // Dynamic stage helpers — fall back to module-level constants when table not yet loaded
  const stageNames=leadStages.length>0?leadStages.map(s=>s.name):STATUS_OPTIONS
  const stageStyle=name=>{const s=leadStages.find(st=>st.name===name);if(s?.color)return{bg:s.color+'22',color:s.color};return STATUS_STYLE[name]||{bg:'#F3F4F6',color:'#6B7280'}}

  const pendingTasks  =myTasks.filter(t=>t.status!=='Completed')
  const overdueTasks  =myTasks.filter(t=>_stripTZ(t.due_date)<istNowStr()&&t.status!=='Completed')
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
            if(result?.lead){
              setLeadQueue(prev=>prev.map(l=>l.id===callingLead.id?{...l,...result.lead}:l))
              setMyLeads(prev=>prev.map(l=>l.id===callingLead.id?{...l,...result.lead}:l))
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
                const now=istNowStr()
                const due=String(task.due_date||'').replace(/\.\d+/,'').replace(/(\+\d{2}:\d{2}|Z)$/,'').replace(' ','T')
                const isOverdue=due&&now>due
                const isUpcoming=due&&now<due
                const leadName=task.title.replace('Callback: ','')
                const lead=myLeads.find(l=>l.id===task.lead_id)
                const isRescheduling=rescheduleTaskId===task.id
                const isToday=isISTToday(task.due_date)
                return(
                  <div key={task.id} style={{border:'1px solid '+(isOverdue?'#FED7D7':'#FDE68A'),borderLeft:'4px solid '+(isOverdue?'#DC2626':'#F59E0B'),borderRadius:12,padding:14,marginBottom:12,background:isOverdue?'#FFF5F5':'#FFFBF0'}}>

                    {/* Task header with status badge */}
                    <div style={{marginBottom:6,display:'flex',alignItems:'flex-start',gap:6,flexWrap:'wrap'}}>
                      {isOverdue&&(
                        <span style={{background:'#DC2626',color:'white',fontSize:10,fontWeight:800,padding:'2px 8px',borderRadius:20,letterSpacing:'0.04em',flexShrink:0}}>
                          ⚠️ OVERDUE
                        </span>
                      )}
                      {isUpcoming&&(
                        <span style={{background:'#F59E0B',color:'white',fontSize:10,fontWeight:800,padding:'2px 8px',borderRadius:20,letterSpacing:'0.04em',flexShrink:0}}>
                          🔔 UPCOMING
                        </span>
                      )}
                      <div style={{fontWeight:700,fontSize:15,color:isOverdue?'#991B1B':'#92400E',width:'100%',marginTop:4}}>
                        📞 {leadName}
                      </div>
                    </div>

                    <div style={{fontSize:12,color:isOverdue?'#B91C1C':'#B45309',marginBottom:task.notes?4:8}}>
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
                    const od=_stripTZ(task.due_date)<istNowStr()
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
              {/* Duration */}
              <div style={{marginBottom:12}}>
                <label style={{display:'block',fontSize:11,fontWeight:600,color:'#6B7280',marginBottom:5,textTransform:'uppercase',letterSpacing:'0.04em'}}>Call Duration (minutes)</label>
                <input type="number" min="0" step="1" value={callLogDuration}
                  onChange={e=>setCallLogDuration(e.target.value)}
                  placeholder="e.g. 3"
                  style={{width:'100%',padding:'9px 10px',border:'1.5px solid #E2E8F0',borderRadius:8,fontSize:13,outline:'none',boxSizing:'border-box',color:'#111827'}}
                  onFocus={e=>e.target.style.borderColor='#185FA5'} onBlur={e=>e.target.style.borderColor='#E2E8F0'}/>
              </div>
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
      )}

      {/* OBLIGATION FULL-SCREEN PANEL */}
      {showObligationModal&&selectedLeadForObligations&&(
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
                  <span style={{fontSize:isMobile?15:20,fontWeight:800,color:'white',letterSpacing:'0.04em',textTransform:'uppercase',lineHeight:1.1}}>{selectedLeadForObligations.full_name}</span>
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
                    console.log('[Action] obModal save info → DB write lead:', leadId)
                    const {error}=await supabase.from('leads').update({monthly_salary:salaryVal,company_name:obModalCompany||null,notes:obModalNotes||null}).eq('id',leadId)
                    if(error){ console.error('[Action] obModal save error:', error); return }
                    setMyLeads(prev=>[...prev.map(l=>l.id===leadId?{...l,monthly_salary:salaryVal,company_name:obModalCompany||null,notes:obModalNotes||null}:l)])
                    setObSavedSnapshot({salary:obModalSalary,company:obModalCompany,notes:obModalNotes})
                    setObIsNewLead(false)
                    setIsObEditing(false)
                    showToast('Info saved for '+selectedLeadForObligations.full_name)
                  }} style={{padding:'7px 16px',borderRadius:8,background:'#16a34a',color:'white',border:'none',cursor:'pointer',fontSize:13,fontWeight:700,display:'flex',alignItems:'center',gap:6}}>
                    <IconDeviceFloppy size={14}/> {obIsNewLead?'Save Info & Notes':'Save'}
                  </button>
                  {!obIsNewLead&&(
                    <button onClick={()=>{
                      if(obSavedSnapshot){setObModalSalary(obSavedSnapshot.salary);setObModalCompany(obSavedSnapshot.company);setObModalNotes(obSavedSnapshot.notes)}
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
                <div style={{background:'#111827',border:'1px solid #1e293b',borderRadius:12,padding:'14px 16px'}}>
                  <div style={{fontSize:10,fontWeight:700,color:'#475569',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>Monthly Salary</div>
                  {isObEditing?(
                    <input type="number" min="0" value={obModalSalary} onChange={e=>setObModalSalary(e.target.value)} placeholder="e.g. 60000"
                      style={{width:'100%',padding:'8px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:14,boxSizing:'border-box'}}/>
                  ):(
                    <div style={{fontSize:20,fontWeight:800,color:'#38bdf8'}}>{obModalSalary?`₹${Number(obModalSalary).toLocaleString('en-IN')}`:'-'}</div>
                  )}
                </div>
                <div style={{background:'#111827',border:'1px solid #1e293b',borderRadius:12,padding:'14px 16px'}}>
                  <div style={{fontSize:10,fontWeight:700,color:'#475569',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>Company Name</div>
                  {isObEditing?(
                    <input type="text" value={obModalCompany} onChange={e=>setObModalCompany(e.target.value)} placeholder="e.g. Infosys Ltd."
                      style={{width:'100%',padding:'8px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:14,boxSizing:'border-box'}}/>
                  ):(
                    <div style={{fontSize:15,fontWeight:700,color:'#e2e8f0'}}>{obModalCompany||'-'}</div>
                  )}
                </div>
              </div>

              {/* Right column: Call Notes */}
              <div style={{background:'#111827',border:'1px solid #1e293b',borderRadius:12,padding:'14px 16px',display:'flex',flexDirection:'column'}}>
                <div style={{fontSize:10,fontWeight:700,color:'#475569',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>Call Notes</div>
                <div style={{flex:1,minHeight:80,background:'#0a0f1a',border:'1px solid #1e293b',borderRadius:8,padding:'8px 10px',overflowY:'auto',fontSize:12,color:'#94a3b8',lineHeight:1.7,whiteSpace:'pre-wrap',marginBottom:isObEditing?8:0}}>
                  {obModalNotes||<span style={{color:'#334155',fontStyle:'italic'}}>No notes yet.</span>}
                </div>
                {isObEditing&&(
                  <div style={{display:'flex',gap:6}}>
                    <input type="text" value={obModalNoteInput} onChange={e=>setObModalNoteInput(e.target.value)}
                      placeholder="Add a note and press Enter…"
                      onKeyDown={e=>{
                        if(e.key==='Enter'&&obModalNoteInput.trim()){
                          const _n=new Date(),_d=String(_n.getDate()).padStart(2,'0'),_mo=String(_n.getMonth()+1).padStart(2,'0'),_y=_n.getFullYear(),_h=String(_n.getHours()).padStart(2,'0'),_mi=String(_n.getMinutes()).padStart(2,'0')
                          const ts=`[${_d}/${_mo}/${_y} ${_h}:${_mi} - ${profile?.full_name||'Agent'}]`
                          setObModalNotes(prev=>(prev?prev+'\n':'')+`${ts}: `+obModalNoteInput.trim())
                          setObModalNoteInput('')
                        }
                      }}
                      style={{flex:1,padding:'7px 10px',borderRadius:8,border:'1px solid #334155',background:'#0f172a',color:'white',outline:'none',fontSize:12}}/>
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
                  <div style={{background:'#111827',border:'1px solid #334155',borderRadius:10,padding:'10px 12px',minWidth:110}}>
                    <div style={{fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:3}}>Total EMI</div>
                    <div style={{fontSize:17,fontWeight:800,color:'#38bdf8'}}>₹{obligationTotals.totalEMI.toLocaleString('en-IN')}</div>
                    <div style={{fontSize:10,color:'#64748b',marginTop:2}}>All obligations</div>
                  </div>
                  <div style={{background:'#111827',border:'1px solid #334155',borderRadius:10,padding:'10px 12px',minWidth:110}}>
                    <div style={{fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:3}}>Obligated EMI</div>
                    <div style={{fontSize:17,fontWeight:800,color:'#f97316'}}>₹{obligationTotals.totalObligatedEMI.toLocaleString('en-IN')}</div>
                    <div style={{fontSize:10,color:'#64748b',marginTop:2}}>Used for FOIR</div>
                  </div>
                  <div style={{background:'#111827',border:'1px solid #334155',borderRadius:10,padding:'10px 12px',minWidth:110}}>
                    <div style={{fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:3}}>Outstanding</div>
                    <div style={{fontSize:17,fontWeight:800,color:'#a78bfa'}}>₹{obligationTotals.totalOutstanding.toLocaleString('en-IN')}</div>
                  </div>
                  <div style={{background:'#111827',border:'1px solid #334155',borderRadius:10,padding:'10px 12px',minWidth:110}}>
                    <div style={{fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:3}}>FOIR (Obl. EMI)</div>
                    <div style={{fontSize:17,fontWeight:800,color:obligationTotals.isEligible?'#22c55e':'#ef4444'}}>{obligationTotals.currentFoir}%</div>
                    <div style={{fontSize:10,color:'#64748b',marginTop:2}}>Max: {obligationTotals.maxFoir}%</div>
                  </div>
                  <div style={{background:obligationTotals.isEligible?'#052e16':'#450a0a',border:'1px solid '+(obligationTotals.isEligible?'#166534':'#991b1b'),borderRadius:10,padding:'10px 12px',minWidth:120,display:'flex',flexDirection:'column',justifyContent:'center'}}>
                    <div style={{fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:4}}>Eligibility</div>
                    <div style={{fontSize:13,fontWeight:800,color:obligationTotals.isEligible?'#4ade80':'#f87171'}}>
                      {obModalSalary?obligationTotals.isEligible?'✓ Eligible':'✗ Exceeds Limit':'—'}
                    </div>
                    {obModalSalary&&!obligationTotals.isEligible&&(
                      <div style={{fontSize:10,color:'#fca5a5',marginTop:2}}>By {obligationTotals.currentFoir-obligationTotals.maxFoir}%</div>
                    )}
                  </div>
                  <div style={{background:'#111827',border:'1px solid #334155',borderRadius:10,padding:'10px 12px',minWidth:140}}>
                    <div style={{fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:3}}>Eligible Loan Amt</div>
                    {!obModalSalary
                      ? <div style={{fontSize:17,fontWeight:800,color:'#64748b'}}>—</div>
                      : <div style={{fontSize:15,fontWeight:800,color:obligationTotals.eligibleLoan>0?'#22c55e':'#ef4444'}}>₹{obligationTotals.eligibleLoan.toLocaleString('en-IN')}</div>
                    }
                    {obModalSalary&&<div style={{fontSize:10,color:'#64748b',marginTop:2}}>Avail EMI: ₹{Math.round(obligationTotals.availableEMI).toLocaleString('en-IN')}</div>}
                    <button onClick={()=>window.open('https://www.axisbank.com/calculators/emi-calculator','_blank')}
                      style={{marginTop:6,display:'flex',alignItems:'center',gap:4,background:'#1e3a5f',border:'1px solid #334155',color:'#7dd3fc',padding:'3px 8px',borderRadius:6,fontSize:10,fontWeight:600,cursor:'pointer',width:'100%',justifyContent:'center'}}>
                      🧮 EMI Calc
                    </button>
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
                <div style={{background:'#111827',border:'1px dashed #334155',borderRadius:16,padding:'30px 20px',textAlign:'center',color:'#94a3b8'}}>
                  No obligations yet. Click <strong style={{color:'white'}}>+ Add Obligation</strong> to start capturing liabilities.
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
                        {/* BALANCE TRANSFER - Personal Loan only (Credit Card has its own BT toggle below) */}
                        {ob.obligation_type==='Personal Loan'&&(
                        <div style={{display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>
                          <label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>Balance Transfer?</label>
                          <div onClick={()=>!obModalReadOnly&&handleObligationFieldChange(ob.id,'balance_transfer',!ob.balance_transfer)}
                            style={{display:'flex',alignItems:'center',gap:8,padding:'7px 12px',borderRadius:8,border:'1px solid '+(ob.balance_transfer?'#16a34a':'#334155'),background:ob.balance_transfer?'#052e16':'#0f172a',cursor:obModalReadOnly?'default':'pointer',userSelect:'none'}}>
                            <div style={{width:18,height:18,borderRadius:5,background:ob.balance_transfer?'#16a34a':'#334155',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                              {ob.balance_transfer&&<span style={{color:'white',fontSize:12,fontWeight:700}}>✓</span>}
                            </div>
                            <span style={{fontSize:12,fontWeight:700,color:ob.balance_transfer?'#4ade80':'#94a3b8'}}>{ob.balance_transfer?'Yes — BT':'No'}</span>
                          </div>
                        </div>
                        )}

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
                            {ob.outstanding_amount&&!ob.balance_transfer&&<div style={{fontSize:10,color:'#f97316',marginTop:3}}>Obligated: ₹{Math.round((parseFloat(ob.outstanding_amount)||0)*0.05).toLocaleString('en-IN')} (5% of Outstanding)</div>}
                            {ob.outstanding_amount&&ob.balance_transfer&&<div style={{fontSize:10,color:'#4ade80',marginTop:3}}>Not Obligated (BT applied)</div>}
                          </div>
                          <div style={{display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>
                            <label style={{display:'block',fontSize:11,fontWeight:700,color:'#94a3b8',marginBottom:4}}>Balance Transfer?</label>
                            <div onClick={()=>!obModalReadOnly&&handleObligationFieldChange(ob.id,'balance_transfer',!ob.balance_transfer)}
                              style={{display:'flex',alignItems:'center',gap:8,padding:'7px 12px',borderRadius:8,border:'1px solid '+(ob.balance_transfer?'#16a34a':'#334155'),background:ob.balance_transfer?'#052e16':'#0f172a',cursor:obModalReadOnly?'default':'pointer',userSelect:'none'}}>
                              <div style={{width:18,height:18,borderRadius:5,background:ob.balance_transfer?'#16a34a':'#334155',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                                {ob.balance_transfer&&<span style={{color:'white',fontSize:12,fontWeight:700}}>✓</span>}
                              </div>
                              <span style={{fontSize:12,fontWeight:700,color:ob.balance_transfer?'#4ade80':'#94a3b8'}}>{ob.balance_transfer?'Yes — BT (Not Obligated)':'No'}</span>
                            </div>
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
                        </>)}

                      </div>
                    )}
                  </div>
                )
              })}
          </div>
        </div>
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
      <div style={{background:bg1,borderBottom:'1px solid '+bdr,padding:isMobile?'12px 14px':'12px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,position:'sticky',top:0,zIndex:50}}>
        <div style={{minWidth:0,flex:1}}>
          <div style={{fontSize:isMobile?14:16,fontWeight:700,color:txt1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{greeting||'Welcome back 👋'}</div>
          {!isMobile&&<div style={{fontSize:12,color:txt2,marginTop:2}}>{lastSynced?`Synced ${lastSynced.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})} · `:''}Ready to close more loans today? 🚀</div>}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
          {!isMobile&&(
            <button onClick={()=>setDarkMode(!darkMode)} style={{padding:'7px 10px',background:'transparent',border:'1px solid '+bdr,borderRadius:8,cursor:'pointer',fontSize:12,color:txt2}}>{darkMode?'☀️':'🌙'}</button>
          )}
          <button onClick={()=>setShowNotifPanel(true)}
            style={{position:'relative',background:callbackTasks.length>0?'#FFF7ED':notifications.length>0?'#FAEEDA':'transparent',border:'1px solid '+(callbackTasks.length>0?'#FDE68A':notifications.length>0?'#F6E05E':bdr),borderRadius:8,padding:'8px 10px',cursor:'pointer',display:'flex',alignItems:'center',gap:4,color:callbackTasks.length>0?'#92400E':notifications.length>0?'#854F0B':txt2,fontSize:12,fontWeight:500}}>
            <IconBell size={16}/>
            {(callbackTasks.length+notifications.length)>0&&<span style={{background:'#A32D2D',color:'white',borderRadius:'50%',width:16,height:16,fontSize:9,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center'}}>{callbackTasks.length+notifications.length}</span>}
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
          {!isMobile&&(
            <div style={{display:'flex',alignItems:'center',gap:5,fontSize:11,fontWeight:700,color:rtConnected?'#16a34a':'#9ca3af',letterSpacing:'0.02em'}}>
              <div style={{width:8,height:8,borderRadius:'50%',background:rtConnected?'#22c55e':'#d1d5db',boxShadow:rtConnected?'0 0 6px #22c55e':undefined,flexShrink:0}}/>
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
                    {_stripTZ(task.due_date)<istNowStr()?'Overdue · ':'Today · '}
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
            {/* POWER DIALER BUTTON */}
            <button onClick={startPowerDialer}
              style={{width:'100%',marginBottom:10,padding:isMobile?'13px':'14px 20px',background:'linear-gradient(135deg,#7C3AED,#5B21B6)',color:'white',border:'none',borderRadius:10,fontSize:14,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,boxShadow:'0 4px 14px rgba(124,58,237,0.35)',letterSpacing:'0.01em'}}>
              <IconBolt size={17}/> ⚡ Start Power Dialer — {filteredLeads.length||myLeads.length} Leads
            </button>
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
                {stageNames.map(s=><option key={s}>{s}</option>)}
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
                  const st=stageStyle(lead.status)
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
                          style={{background:st.bg,color:st.color,border:'1.5px solid '+st.color+'55',padding:'6px 10px',borderRadius:20,fontSize:12,fontWeight:600,cursor:'pointer',outline:'none'}}>
                          {stageNames.map(s=><option key={s} value={s} style={{background:'white',color:'black'}}>{s}</option>)}
                        </select>
                      </div>

                      {/* Action buttons */}
                      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:8}}>
                        <button onClick={()=>openCallingWorkspace(lead)}
                          style={{padding:'10px 0',borderRadius:8,background:'#EAF3DE',border:'1px solid #86EFAC',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'#166534',gap:3}}>
                          <IconPhone size={16}/>
                          <span style={{fontSize:10,fontWeight:600}}>Call</span>
                        </button>
                        <button onClick={(e)=>{e.stopPropagation();setShowWAQuick(prev=>prev===lead.id?null:lead.id)}}
                          style={{padding:'10px 0',borderRadius:8,background:showWAQuick===lead.id?'#DCFCE7':'#F0FFF4',border:'1px solid #86EFAC',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'#16A34A',gap:3}}>
                          <IconBrandWhatsapp size={16}/>
                          <span style={{fontSize:10,fontWeight:600}}>WhatsApp</span>
                        </button>
                        <button onClick={()=>openObligationModal(lead)}
                          style={{padding:'10px 0',borderRadius:8,background:'#EFF6FF',border:'1px solid #93C5FD',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'#1D4ED8',gap:3}}>
                          <IconBuildingStore size={16}/>
                          <span style={{fontSize:10,fontWeight:600}}>Obligations</span>
                        </button>
                        <button onClick={()=>openObligationModal(lead,true)}
                          style={{padding:'10px 0',borderRadius:8,background:'#F5F3FF',border:'1px solid #C4B5FD',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'#6D28D9',gap:3}}>
                          <IconEye size={16}/>
                          <span style={{fontSize:10,fontWeight:600}}>View Obs</span>
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
                    {['New','Interested','Callback'].map(s=>{const st=stageStyle(s);return <span key={s} style={{background:st.bg,color:st.color,padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:500}}>{myLeads.filter(l=>l.status===s).length} {s}</span>})}
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
                        const st  =stageStyle(lead.status)
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
                                style={{background:st.bg,color:st.color,border:'1.5px solid '+st.color+'55',padding:'5px 10px',borderRadius:20,fontSize:11,fontWeight:600,cursor:'pointer',outline:'none',minWidth:120}}>
                                {stageNames.map(s=><option key={s} value={s} style={{background:'white',color:'black'}}>{s}</option>)}
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
                            <td style={{padding:'8px 14px'}}>
                              <div style={{display:'flex',gap:5}}>
                                <button onClick={()=>openCallingWorkspace(lead)}
                                  style={{padding:'8px 8px',borderRadius:8,background:'#EAF3DE',border:'1px solid #86EFAC',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'#166534',gap:3,whiteSpace:'nowrap'}}
                                  onMouseEnter={e=>{e.currentTarget.style.background='#C6EFCE'}}
                                  onMouseLeave={e=>{e.currentTarget.style.background='#EAF3DE'}}>
                                  <IconPhone size={15}/>
                                  <span style={{fontSize:10,fontWeight:600}}>Call</span>
                                </button>
                                <button onClick={(e)=>{
                                    e.stopPropagation()
                                    if(showWAQuick===lead.id){ setShowWAQuick(null); return }
                                    const rect=e.currentTarget.getBoundingClientRect()
                                    setWaQuickPos({top:rect.bottom+6, left:rect.left})
                                    setShowWAQuick(lead.id)
                                  }}
                                  style={{padding:'8px 8px',borderRadius:8,background:showWAQuick===lead.id?'#DCFCE7':'#F0FFF4',border:'1px solid #86EFAC',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'#16A34A',gap:3,whiteSpace:'nowrap'}}
                                  onMouseEnter={e=>{if(showWAQuick!==lead.id)e.currentTarget.style.background='#DCFCE7'}}
                                  onMouseLeave={e=>{if(showWAQuick!==lead.id)e.currentTarget.style.background='#F0FFF4'}}>
                                  <IconBrandWhatsapp size={15}/>
                                  <span style={{fontSize:10,fontWeight:600}}>WhatsApp</span>
                                </button>
                                <button onClick={()=>openObligationModal(lead)}
                                  style={{padding:'8px 8px',borderRadius:8,background:'#EFF6FF',border:'1px solid #93C5FD',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'#1D4ED8',gap:3,whiteSpace:'nowrap'}}
                                  onMouseEnter={e=>{e.currentTarget.style.background='#DBEAFE'}}
                                  onMouseLeave={e=>{e.currentTarget.style.background='#EFF6FF'}}>
                                  <IconBuildingStore size={15}/>
                                  <span style={{fontSize:10,fontWeight:600}}>Obligations</span>
                                </button>
                                <button onClick={()=>openObligationModal(lead,true)}
                                  style={{padding:'8px 8px',borderRadius:8,background:'#F5F3FF',border:'1px solid #C4B5FD',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'#6D28D9',gap:3,whiteSpace:'nowrap'}}
                                  onMouseEnter={e=>{e.currentTarget.style.background='#EDE9FE'}}
                                  onMouseLeave={e=>{e.currentTarget.style.background='#F5F3FF'}}>
                                  <IconEye size={15}/>
                                  <span style={{fontSize:10,fontWeight:600}}>View Obs</span>
                                </button>
                                <button onClick={()=>{setNoteLead(lead);setNoteText('');setShowNoteModal(true)}}
                                  style={{padding:'8px 8px',borderRadius:8,background:'#FFF7ED',border:'1px solid #FCD34D',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'#92400E',gap:3,whiteSpace:'nowrap'}}
                                  onMouseEnter={e=>{e.currentTarget.style.background='#FEF3C7'}}
                                  onMouseLeave={e=>{e.currentTarget.style.background='#FFF7ED'}}>
                                  <IconNotes size={15}/>
                                  <span style={{fontSize:10,fontWeight:600}}>Note</span>
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
                              <td style={{padding:'11px 14px',fontSize:13,color:txt2}}>
                                <div style={{display:'flex',alignItems:'center',gap:8}}>
                                  <span>{lead?.mobile||'-'}</span>
                                </div>
                              </td>
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
                  const od=_stripTZ(task.due_date)<istNowStr()
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
    const{data}=await supabase.from('tasks').select('*,profiles!tasks_assigned_to_fkey(full_name)').in('assigned_to',ids).in('status',['Pending','In Progress']).lt('due_date',istNowStr())
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
                        <span>{new Date(call.created_at).toLocaleDateString('en-IN')}</span>
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
                          <td style={{padding:'11px 14px',fontSize:13,color:'#4A5568'}}>{new Date(call.created_at).toLocaleDateString('en-IN')}</td>
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
  const isMobile=useIsMobile()

  useEffect(()=>{ getProfile(); fetchSettings(); fetchDashboardStats() },[])

  // close sidebar on page change
  useEffect(()=>{ setSidebarOpen(false) },[activePage])

  // Fix leads that were accidentally saved with call disposition values as status
  useEffect(()=>{
    const r=(profile?.role||'').toLowerCase().trim()
    if(r==='admin'||r==='manager') fixWrongLeadStages()
  },[profile?.role])

  const fixWrongLeadStages=async()=>{
    const stageMap={
      'Busy':'Callback','Ringing':'Callback','Switched Off':'Callback',
      'Not Reachable':'Callback','Voice Mail':'Callback','Call cut':'Callback',
      'Wrong Number/ Invalid Number':'Not Interested','Not Required Hup':'Not Interested',
      'Not Required Polite':'Not Interested','Not Doable':'Not Interested',
      'Police':'Callback','Lead':'New','Disbursed Other':'Disbursed',
    }
    for(const [wrong,correct] of Object.entries(stageMap)){
      await supabase.from('leads').update({status:correct}).eq('status',wrong)
    }
  }

  const getProfile=async()=>{
    try{
      const userId=session?.user?.id
      if(!userId){console.log('[Auth] No session user');return}
      const{data,error:profileErr}=await supabase.from('profiles').select('*').eq('id',userId).single()
      if(profileErr){console.error('[Profile] Fetch error:',profileErr);return}
      if(!data){console.log('[Profile] No row for',userId);return}
      const normalizedRole=(data.role||'agent').toLowerCase().trim()
      console.log('[Profile] id:',data.id,'raw role:',data.role,'normalized:',normalizedRole)
      setProfile({...data,role:normalizedRole})
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
    const m={dashboard:<IconLayoutDashboard {...p}/>,users:<IconUsers {...p}/>,'phone-call':<IconPhoneCall {...p}/>,checkbox:<IconCheckbox {...p}/>,'chart-bar':<IconChartBar {...p}/>,settings:<IconSettings {...p}/>,adjustments:<IconAdjustments {...p}/>,campaigns:<IconBuildingStore {...p}/>}
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
    {section:'TOOLS',items:[{id:'cibil',label:'CIBIL Parser',icon:'chart-bar',roles:['agent','team_leader','manager','admin']}]},
    {section:'MANAGE',items:[
      {id:'admin',    label:'Admin Panel', icon:'settings',    roles:['admin']},
      {id:'settings', label:'Settings',   icon:'adjustments', roles:['admin']},
    ]},
  ]

  const AdminPanel=()=>{
    const [activeTab,setActiveTab]         =useState('overview')
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
    const [leadStatusF,setLeadStatusF]     =useState('All')
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
    const fetchLeadsRef                    =useRef(null)

    useEffect(()=>{ fetchUsers(); fetchDispositions(); fetchLeadSources(); fetchLeads(); fetchAuthUsers(); fetchSettings(); fetchActivityFull(); fetchAdminStages() },[])

    useEffect(()=>{
      const sub=supabase
        .channel('admin-rt-leads')
        .on('postgres_changes',{event:'*',schema:'public',table:'leads'},()=>{ fetchLeadsRef.current?.() })
        .on('postgres_changes',{event:'*',schema:'public',table:'loan_obligations'},()=>{ fetchLeadsRef.current?.() })
        .subscribe(status=>setApRtConnected(status==='SUBSCRIBED'))
      return()=>{ supabase.removeChannel(sub) }
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

        const esc=v=>{ const s=String(v??''); return s.includes(',')||s.includes('"')||s.includes('\n')?'"'+s.replace(/"/g,'""')+'"':s }
        const headers=['Lead Name','Mobile','City','Loan Amount','Current Stage','Last Disposition','Last Call Date','No. of Calls','Agent Notes','Monthly Salary','Company','Total EMI','FOIR %','Eligible Loan Amount','Obligations Summary','Callback Scheduled','Assigned Agent']
        const rows=leadsToExport.map(l=>{
          const calls=callMap[l.id]||[]
          const obls=oblMap[l.id]||[]
          const lastCall=calls[0]
          const agent=users.find(u=>u.id===l.assigned_to)
          const oblSummary=obls.map(o=>`${o.obligation_type||'Loan'} @ ${o.bank_name||'—'} EMI ₹${o.emi_amount||0}`).join(' | ')
          const cbTask=taskMap[l.id]
          const cbDate=cbTask?_stripTZ(cbTask.due_date).replace('T',' ').slice(0,16):''
          return[
            l.full_name||'',l.mobile||'',l.city||'',l.loan_amount||'',
            l.status||'New',l.disposition||'',
            lastCall?new Date(lastCall.created_at).toLocaleDateString('en-IN'):'',
            calls.length,
            (l.notes||'').replace(/\n/g,' | '),
            l.monthly_salary||'',l.company_name||'',
            l.total_emi||'',l.foir||'',l.eligible_loan_amount||'',
            oblSummary,cbDate,agent?.full_name||'Unassigned'
          ].map(esc).join(',')
        })
        const csv=[headers.map(esc).join(','),...rows].join('\n')
        const dd=new Date().toLocaleDateString('en-IN').replace(/\//g,'-')
        const a=document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv); a.download='reassignment_export_'+dd+'.csv'; a.click()
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
    const mk=new Date().toLocaleDateString('en-US',{month:'short',year:'numeric'}).toLowerCase().replace(' ','_')
    const manualStats=[{key:'disbursements_'+mk,label:'Disbursements This Month'},{key:'applications_'+mk,label:'Applications Logged In'},{key:'obligations_'+mk,label:'Obligations Disbursed'}]
    const filteredLeads=adminLeads.filter(l=>{ const q=leadSearch.toLowerCase(); const mQ=!q||(l.full_name||'').toLowerCase().includes(q)||(l.mobile||'').includes(q); const mS=leadStatusF==='All'||l.status===leadStatusF; const mA=leadAgentF==='All'||l.assigned_to===leadAgentF; const mF=!leadDateFrom||(l.created_at||'')>=leadDateFrom; const mT=!leadDateTo||(l.created_at||'')<=leadDateTo+'T23:59:59'; return mQ&&mS&&mA&&mF&&mT })
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
                <div style={{padding:'12px 16px',borderBottom:'1px solid #E2E8F0',fontWeight:600,fontSize:14}}>Agent Performance — {new Date().toLocaleDateString('en-IN',{month:'long',year:'numeric'})}</div>
                <div style={{overflowX:'auto'}}><table><thead><tr>{['Agent','Calls Today','Total Leads','Leads/Month','Interested','Callback','Disbursed','Last Login'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                <tbody>{agentRows.length===0?(<tr><td colSpan={8} style={{textAlign:'center',color:'#A0AEC0',padding:24}}>No agents</td></tr>):agentRows.map(r=>(<tr key={r.id}><td><div style={{fontWeight:500}}>{r.full_name}</div></td><td style={{textAlign:'center',fontWeight:700,color:r.callsToday>0?'#15803d':'#718096'}}>{r.callsToday}</td><td style={{textAlign:'center'}}>{r.totalLeads}</td><td style={{textAlign:'center'}}>{r.leadsMonth}</td><td style={{textAlign:'center',color:'#7c3aed'}}>{r.interested}</td><td style={{textAlign:'center',color:'#d97706'}}>{r.callback}</td><td style={{textAlign:'center',color:'#15803d',fontWeight:600}}>{r.disbursed}</td><td style={{fontSize:11,color:'#A0AEC0'}}>{r.lastLogin?new Date(r.lastLogin).toLocaleString('en-IN',{dateStyle:'short',timeStyle:'short'}):'—'}</td></tr>))}
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
                            {i===2&&<span style={{background:'#FEF3C7',color:'#92400E',padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:600}}>🥉 3rd</span>}
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
                <select className='form-input' style={{width:'auto',fontSize:13}} value={leadStatusF} onChange={e=>setLeadStatusF(e.target.value)}><option value='All'>All Status</option>{(adminStages.length>0?adminStages:STATUS_OPTIONS.map(n=>({name:n}))).map(s=><option key={s.id||s.name} value={s.name}>{s.name}</option>)}</select>
                <select className='form-input' style={{width:'auto',fontSize:13}} value={leadAgentF} onChange={e=>setLeadAgentF(e.target.value)}><option value='All'>All Agents</option>{users.filter(u=>['agent','team_leader'].includes(u.role)).map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select>
                <input type='date' className='form-input' style={{width:'auto',fontSize:13}} value={leadDateFrom} onChange={e=>setLeadDateFrom(e.target.value)}/>
                <input type='date' className='form-input' style={{width:'auto',fontSize:13}} value={leadDateTo} onChange={e=>setLeadDateTo(e.target.value)}/>
                <button className='btn btn-ghost btn-sm' onClick={()=>{setLeadSearch('');setLeadStatusF('All');setLeadAgentF('All');setLeadDateFrom('');setLeadDateTo('')}}>Clear</button>
                <button className='btn btn-outline btn-sm' style={{whiteSpace:'nowrap',fontSize:12}} onClick={()=>doReassignExport(selected.size>0?adminLeads.filter(l=>selected.has(l.id)):filteredLeads)}>↓ Export{selected.size>0?' Selected':''} for Reassignment</button>
              </div>
              {selected.size>0&&(
                <div style={{background:'#185FA5',color:'white',padding:'10px 14px',borderRadius:8,marginBottom:10,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                  <span style={{fontSize:13,fontWeight:600}}>{selected.size} lead{selected.size>1?'s':''} selected</span>
                  <select value={assignTo} onChange={e=>setAssignTo(e.target.value)} style={{padding:'5px 10px',borderRadius:6,border:'none',fontSize:13,minWidth:160}}>
                    <option value=''>Select agent...</option>
                    {users.filter(u=>['agent','team_leader'].includes(u.role)).map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)}
                  </select>
                  <button className='btn' style={{background:'white',color:'#185FA5',fontSize:13,padding:'5px 14px'}} onClick={async()=>{ if(!assignTo||selected.size===0)return; setAssigning(true); try{ const selLeads=adminLeads.filter(l=>selected.has(l.id)); const agent=users.find(u=>u.id===assignTo); const ids=[...selected]; for(let i=0;i<ids.length;i+=100) await supabase.from('leads').update({assigned_to:assignTo}).in('id',ids.slice(i,i+100)); const logEntries=selLeads.map(l=>({lead_id:l.id,lead_name:l.full_name||'',action:l.assigned_to?'Reassigned':'Assigned',assigned_to:assignTo,assigned_to_name:agent?.full_name||'',assigned_by:profile?.id||null,assigned_by_name:profile?.full_name||'Admin',previous_agent_id:l.assigned_to||null,previous_agent_name:users.find(u=>u.id===l.assigned_to)?.full_name||null})); await supabase.from('activity_log').insert(logEntries); showApToast(ids.length+' lead'+(ids.length>1?'s':'')+' assigned to '+agent?.full_name); setSelected(new Set()); setAssignTo(''); fetchLeads(); fetchActivityFull() }catch(err){showApToast('Error: '+err.message,'error')} setAssigning(false)}} disabled={assigning||!assignTo}>{assigning?'Assigning…':'Assign'}</button>
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
                  <table><thead><tr><th style={{width:36}}><input type='checkbox' checked={allLdSel} onChange={()=>{ const next=new Set(selected); allLdSel?filteredLeads.forEach(l=>next.delete(l.id)):filteredLeads.forEach(l=>next.add(l.id)); setSelected(next) }}/></th>{['Name','Mobile','Status','Agent','Loan Amt','Obligations','FOIR%','Obl. EMI','Last Note','Date'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                  <tbody>{filteredLeads.length===0?(<tr><td colSpan={11}><div className='empty-state'><h3>No leads found</h3></div></td></tr>):filteredLeads.map(l=>{ const agent=users.find(u=>u.id===l.assigned_to); const ss=apStageStyle(l.status); const obs=adminObligations[l.id]||[]; const totalEMI=obs.reduce((s,o)=>s+(parseFloat(o.emi_amount)||0),0); const sal=parseFloat(l.monthly_salary)||0; const foir=sal>0?Math.round((totalEMI/sal)*100):null; const lastNote=l.notes?l.notes.split('\n').filter(Boolean).pop():''; return(<tr key={l.id} style={{background:selected.has(l.id)?'#EFF6FF':undefined}}><td><input type='checkbox' checked={selected.has(l.id)} onChange={()=>{ const n=new Set(selected); n.has(l.id)?n.delete(l.id):n.add(l.id); setSelected(n) }}/></td><td><div style={{fontWeight:500,fontSize:13}}>{l.full_name||'—'}</div></td><td style={{fontSize:12,color:'#718096'}}>{l.mobile||'—'}</td><td><span style={{background:ss.bg,color:ss.color,padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:500}}>{l.status||'New'}</span></td><td style={{fontSize:12,color:'#718096'}}>{agent?.full_name||<span style={{color:'#A0AEC0'}}>Unassigned</span>}</td><td style={{fontSize:12}}>{l.loan_amount?'₹'+Number(l.loan_amount).toLocaleString('en-IN'):'—'}</td><td style={{fontSize:11,color:'#6366f1'}}>{obs.length>0?obs.map(o=>o.obligation_type).join(', '):'—'}</td><td style={{fontSize:12,fontWeight:600,color:foir===null?'#9ca3af':foir>50?'#ef4444':'#16a34a'}}>{foir!==null?foir+'%':'—'}</td><td style={{fontSize:12,color:'#185FA5'}}>{totalEMI>0?'₹'+totalEMI.toLocaleString('en-IN'):'—'}</td><td style={{fontSize:11,color:'#718096',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={lastNote}>{lastNote||'—'}</td><td style={{fontSize:11,color:'#A0AEC0'}}>{l.created_at?new Date(l.created_at).toLocaleDateString('en-IN'):'—'}</td></tr>) })}
                  </tbody></table>
                </div>
              </div>
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
                  <tbody>{filteredAct.length===0?(<tr><td colSpan={6}><div className='empty-state'><h3>No activity yet</h3><p>Lead assignments will appear here</p></div></td></tr>):filteredAct.map(a=>(<tr key={a.id}><td style={{fontSize:11,color:'#718096',whiteSpace:'nowrap'}}>{a.created_at?new Date(a.created_at).toLocaleString('en-IN',{dateStyle:'short',timeStyle:'short'}):'—'}</td><td style={{fontWeight:500,fontSize:13}}>{a.lead_name||'—'}</td><td><span style={{background:a.action==='Reassigned'?'#FEF3C7':'#E6F1FB',color:a.action==='Reassigned'?'#92400E':'#185FA5',padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:500}}>{a.action||'—'}</span></td><td style={{fontSize:12}}>{a.assigned_to_name||users.find(u=>u.id===a.assigned_to)?.full_name||'—'}</td><td style={{fontSize:12,color:'#718096'}}>{a.assigned_by_name||users.find(u=>u.id===a.assigned_by)?.full_name||'—'}</td><td style={{fontSize:12,color:'#A0AEC0'}}>{a.previous_agent_name||'—'}</td></tr>))}
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
                    const csv=[keys.join(','),...data.map(r=>keys.map(k=>{const v=r[k]??'';return typeof v==='string'&&v.includes(',')?('"'+v+'"'):v}).join(','))].join('\n')
                    const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download='leads_export.csv';a.click()
                  }}><IconDownload size={14} style={{marginRight:6}}/>Export Leads CSV</button>
                  <button className="btn btn-outline" style={{justifyContent:'flex-start'}} onClick={async()=>{
                    const{data}=await supabase.from('profiles').select('id,full_name,email,mobile,role,status,department').order('role')
                    if(!data||!data.length)return
                    const keys=Object.keys(data[0])
                    const csv=[keys.join(','),...data.map(r=>keys.map(k=>{const v=r[k]??'';return typeof v==='string'&&v.includes(',')?('"'+v+'"'):v}).join(','))].join('\n')
                    const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download='users_export.csv';a.click()
                  }}><IconDownload size={14} style={{marginRight:6}}/>Export Users CSV</button>
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
                      <div style={{fontSize:10,color:'#A0AEC0',marginTop:2}}>{new Date(log.created_at).toLocaleString('en-IN')}</div>
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
    const [csvRows,setCsvRows]           = useState([])
    const [csvError,setCsvError]         = useState('')
    const [csvAgents,setCsvAgents]       = useState([])
    const [assignTo,setAssignTo]         = useState('')
    const [importing,setImporting]       = useState(false)
    const [importResult,setImportResult] = useState(null)

    const fetchCSVAgents=async()=>{
      const{data}=await supabase.from('profiles').select('id,full_name').in('role',['agent','team_leader','manager']).order('full_name')
      setCsvAgents(data||[])
    }

    const parseCSVText=(text)=>{
      const parseLine=(line)=>{
        const res=[]; let inQ=false,cur=''
        for(const ch of line){
          if(ch==='"'){inQ=!inQ}
          else if(ch===','&&!inQ){res.push(cur.trim());cur=''}
          else{cur+=ch}
        }
        res.push(cur.trim()); return res
      }
      const lines=text.trim().split(/\r?\n/)
      const hdrs=parseLine(lines[0]).map(h=>h.toLowerCase().replace(/[\s"]/g,''))
      const fi=(...ns)=>hdrs.findIndex(h=>ns.includes(h))
      const cols={
        name:   fi('name','fullname','customername','leadname','full_name'),
        mobile: fi('number','mobile','phone','mobilenumber','phonenumber','contact'),
        amount: fi('loanamount','amount','loan','loan_amount'),
        appid:  fi('applicationid','app_id','appid','application_id','application'),
        notes:  fi('notes','remarks','comment','comments','note','remark'),
        city:   fi('city','location','area'),
      }
      return lines.slice(1).filter(l=>l.trim()).map((line,i)=>{
        const v=parseLine(line)
        const nm=cols.name>=0?v[cols.name]||'':''
        const mb=cols.mobile>=0?v[cols.mobile]||'':''
        const am=cols.amount>=0?v[cols.amount]||'':''
        const ai=cols.appid>=0?v[cols.appid]||'':''
        const nt=cols.notes>=0?v[cols.notes]||'':''
        const ct=cols.city>=0?v[cols.city]||'':''
        return{_row:i+2,full_name:nm,mobile:mb,loan_amount:am,application_id:ai,notes:nt,city:ct,_valid:!!(nm&&mb)}
      })
    }

    const handleFile=(e)=>{
      const file=e.target.files[0]; if(!file)return
      const reader=new FileReader()
      reader.onload=(ev)=>{
        try{
          const rows=parseCSVText(ev.target.result)
          if(!rows.length){setCsvError('No data rows found');return}
          setCsvRows(rows); setCsvError(''); setImportResult(null)
        }catch(err){setCsvError('Parse error: '+err.message)}
      }
      reader.readAsText(file)
    }

    const handleImport=async()=>{
      setImporting(true)
      const valid=csvRows.filter(r=>r._valid)
      let ok=0,fail=0
      for(let i=0;i<valid.length;i+=100){
        const chunk=valid.slice(i,i+100).map(r=>({
          full_name:      r.full_name,
          mobile:         r.mobile.replace(/\D/g,'').slice(-10),
          loan_amount:    r.loan_amount?(parseFloat(r.loan_amount.replace(/,/g,''))||null):null,
          application_id: r.application_id||null,
          notes:          r.notes||null,
          city:           r.city||null,
          status:         'New',
          lead_temperature:'Cold',
          assigned_to:    assignTo||null,
          source:         'CSV Import',
        }))
        const{error,data}=await supabase.from('leads').insert(chunk).select('id')
        if(error){fail+=chunk.length}else{ok+=data?.length||chunk.length}
      }
      setImportResult({ok,fail,total:valid.length})
      setImporting(false)
      if(ok>0)fetchDashboardStats()
    }

    return(
    <div>
      <div className="page-header">
        <div>
          <h1 style={{display:'flex',alignItems:'center',gap:8,fontSize:isMobile?16:18}}><IconLayoutDashboard size={isMobile?18:22} strokeWidth={1.6}/>Dashboard</h1>
          <p>Welcome, {profile?.full_name||'Admin'} — {new Date().toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'})}</p>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <button onClick={()=>{setShowImport(true);fetchCSVAgents();setCsvRows([]);setCsvError('');setImportResult(null)}}
            style={{display:'flex',alignItems:'center',gap:6,background:'#185FA5',color:'white',border:'none',padding:'8px 14px',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer'}}>
            <IconDownload size={15}/> Import CSV
          </button>
          <button className="btn btn-outline btn-sm" onClick={fetchDashboardStats}><IconRefresh size={14}/> Refresh</button>
        </div>
      </div>

      {/* CSV IMPORT MODAL */}
      {showImport&&(
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:500}} onClick={()=>setShowImport(false)}/>
          <div style={{position:'fixed',top:isMobile?0:'50%',left:isMobile?0:'50%',transform:isMobile?'none':'translate(-50%,-50%)',background:'white',borderRadius:isMobile?0:16,zIndex:600,width:isMobile?'100%':'94%',maxWidth:700,height:isMobile?'100%':'auto',maxHeight:isMobile?'100vh':'90vh',overflow:'hidden',display:'flex',flexDirection:'column',boxShadow:'0 32px 80px rgba(0,0,0,0.25)'}}>
            <div style={{background:'linear-gradient(135deg,#185FA5,#1e40af)',padding:'16px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
              <div>
                <div style={{color:'white',fontWeight:700,fontSize:16,display:'flex',alignItems:'center',gap:8}}><IconDownload size={18}/>Import Leads from CSV</div>
                <div style={{color:'rgba(255,255,255,0.7)',fontSize:12,marginTop:2}}>Columns: Name, Number, Loan Amount, Application ID</div>
              </div>
              <button onClick={()=>setShowImport(false)} style={{background:'rgba(255,255,255,0.15)',border:'none',color:'white',width:32,height:32,borderRadius:'50%',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><IconX size={16}/></button>
            </div>
            <div style={{padding:20,overflowY:'auto',flex:1}}>
              {/* Step 1: Upload */}
              <div style={{marginBottom:18}}>
                <div style={{fontSize:13,fontWeight:700,color:'#111827',marginBottom:8}}>Step 1 — Upload CSV file</div>
                <div style={{background:'#F8FAFC',border:'2px dashed #CBD5E0',borderRadius:10,padding:'20px',textAlign:'center',cursor:'pointer',position:'relative'}}
                  onClick={()=>document.getElementById('csv-file-input').click()}>
                  <input id="csv-file-input" type="file" accept=".csv,.txt" style={{display:'none'}} onChange={handleFile}/>
                  <IconDownload size={28} color="#94A3B8" style={{display:'block',margin:'0 auto 8px'}}/>
                  <div style={{fontSize:13,fontWeight:600,color:'#374151'}}>Click to upload CSV</div>
                  <div style={{fontSize:11,color:'#9CA3AF',marginTop:4}}>Required columns: Name, Number — Optional: Loan Amount, Application ID</div>
                </div>
                {csvError&&<div style={{marginTop:8,color:'#DC2626',fontSize:12,fontWeight:500}}>{csvError}</div>}
              </div>

              {/* Step 2: Assign */}
              {csvRows.length>0&&(
                <div style={{marginBottom:18}}>
                  <div style={{fontSize:13,fontWeight:700,color:'#111827',marginBottom:8}}>Step 2 — Assign to Agent (optional)</div>
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
                </div>
              )}
            </div>
            <div style={{padding:'14px 20px',borderTop:'1px solid #E2E8F0',display:'flex',gap:10,justifyContent:'flex-end',flexShrink:0}}>
              <button onClick={()=>setShowImport(false)} style={{padding:'9px 18px',background:'transparent',border:'1px solid #E2E8F0',borderRadius:8,fontSize:13,cursor:'pointer',color:'#6B7280'}}>Close</button>
              {csvRows.filter(r=>r._valid).length>0&&!importResult&&(
                <button onClick={handleImport} disabled={importing}
                  style={{padding:'9px 20px',background:'#185FA5',color:'white',border:'none',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer',opacity:importing?0.6:1}}>
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
                          <td style={{padding:'11px 14px',fontSize:13,color:'#4A5568'}}>{new Date(call.created_at).toLocaleDateString('en-IN')}</td>
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

        {activePage==='dashboard'&&role==='admin'       &&<AdminDashboardHome userId={profile?.id}/>}
        {activePage==='admin'    &&role==='admin'       &&<AdminPanel/>}
        {activePage==='dashboard'&&role==='manager'     &&<ManagerPanel     userId={profile?.id}/>}
        {activePage==='dashboard'&&role==='team_leader' &&<TeamLeaderPanel  userId={profile?.id}/>}
        {activePage==='dashboard'&&role==='agent'       &&<AgentDashboard   userId={profile?.id}/>}
        {activePage==='leads'    &&<Leads     userRole={role} userId={profile?.id}/>}
        {activePage==='campaigns'&&<Campaigns userRole={role} userId={profile?.id}/>}
        {activePage==='calls'    &&<Calls     userRole={role} userId={profile?.id}/>}
        {activePage==='tasks'    &&<Tasks     userRole={role} userId={profile?.id}/>}
        {activePage==='cibil'    &&<CibilParser userRole={role} userId={profile?.id}/>}
        {activePage==='reports'  &&<Reports   userRole={role} userId={profile?.id}/>}
      </main>
    </div>
  )
}
