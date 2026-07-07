/* eslint-disable */
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../supabase'
import { buildIST, toDbTimestamp, formatIST } from '../utils/timeUtils'
import CallState from '../plugins/CallState'
import TimeInput from '../components/TimeInput'
import {
  IconPhone, IconPhoneOff, IconBrandWhatsapp, IconNotes,
  IconClock, IconX, IconCheck, IconFlame, IconDroplet,
  IconSnowflake, IconCalendar, IconChevronRight, IconUser,
  IconBuildingStore, IconCurrencyRupee, IconAlertCircle,
  IconPlayerSkipForward, IconSend
} from '@tabler/icons-react'

const QUICK_DISPOSITIONS = [
  {label:'Callback',        color:'#854F0B', bg:'#FAEEDA'},
  {label:'Ringing',         color:'#534AB7', bg:'#EEEDFE'},
  {label:'Not Reachable',   color:'#92400E', bg:'#FEF3C7'},
  {label:'Switched Off',    color:'#6B7280', bg:'#F3F4F6'},
  {label:'Voice Mail',      color:'#0E7490', bg:'#CFFAFE'},
  {label:'DND',             color:'#991B1B', bg:'#FEE2E2'},
  {label:'Not Doable',      color:'#475569', bg:'#F1F5F9'},
  {label:'Not Interested',  color:'#791F1F', bg:'#FCEBEB'},
  {label:'Interested',      color:'#27500A', bg:'#EAF3DE'},
]

const STAGE_OPTIONS = ['Callback','New','Login','Approved','Disbursed','DND','Ringing','Busy','Call Cut','Not Required Hup','Wrong Number / Invalid Number','Not Required Polite','Switched Off','Lead','Voice Mail','Disbursed Other','Not Doable','Police']

const CALL_OUTCOMES = [
  'Connected','Not Connected','Busy','Switched Off','RNR','Interested','Follow Up','Rejected'
]

const LOAN_TYPES = ['Personal Loan','Business Loan','Home Loan','Loan Against Property','Education Loan']

const OBLIGATION_TYPES = ['Personal Loan','Housing Loan','Education Loan','Car Loan','Consumer Durable Loan','Credit Card','Business Loan','LAP']
const JOINT_OPTIONS = ['Individual','Joint']
const YES_NO_OPTIONS = ['No','Yes']

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

export default function CallingWorkspace({ lead, userId, onClose, onNext, onSave, queuePosition, totalInQueue }) {
  const isMobile = useIsMobile()
  const [callStarted, setCallStarted]     = useState(false)
  const [callTimer, setCallTimer]         = useState(0)
  const [callOutcome, setCallOutcome]     = useState('')
  const [disposition, setDisposition]     = useState('')
  const [leadStage, setLeadStage]         = useState(lead?.status||'New')
  const [liveNote, setLiveNote]           = useState('')
  const [noteHistory, setNoteHistory]     = useState([])
  const [followUpDate, setFollowUpDate]   = useState('')
  const [followUpTime, setFollowUpTime]   = useState('')
  const [showFollowUp, setShowFollowUp]   = useState(false)
  const [temperature, setTemperature]     = useState(lead?.lead_temperature||'Cold')
  const [saving, setSaving]               = useState(false)
  const [saved, setSaved]                 = useState(false)
  const [callSaved, setCallSaved]         = useState(false)
  const [savedCallId, setSavedCallId]     = useState(null)
  const [showWA, setShowWA]               = useState(false)
  const [waTemplates, setWaTemplates]     = useState([])

  // Loan qualification fields
  const [loanForm, setLoanForm] = useState({
    monthly_salary:   lead?.monthly_salary||'',
    company_name:     lead?.company_name||'',
    loan_type:        lead?.loan_type||'Personal Loan',
    existing_emi:     lead?.existing_emi||'',
    existing_loan:    lead?.existing_loan||'',
    outstanding_amount:lead?.outstanding_amount||'',
    housing_loan:     lead?.housing_loan||false,
    joint_loan:       lead?.joint_loan||false,
    loan_amount:      lead?.loan_amount||'',
  })

  // Obligation fields
  const [obligationDrafts, setObligationDrafts] = useState([])
  const [savingObligation, setSavingObligation] = useState(false)
  const [obligationError, setObligationError] = useState('')

  const timerRef   = useRef(null)
  const autoSaveRef= useRef(null)
  const noteRef    = useRef(null)

  // ── CALL-STATE PLUGIN: auto-detection additions ─────────────────────────
  // To revert: remove this block, the "CALL-STATE PLUGIN" useEffect, the
  // callJustEnded + callNotConnected banners in JSX, and the import of CallState.
  const seenOffhookRef   = useRef(false)   // true only after OFFHOOK this cycle
  const callStartedRef   = useRef(false)   // mirrors callStarted for plugin callbacks
  const handleEndCallRef = useRef(null)    // always points to latest handleEndCall
  const isDialingRef     = useRef(false)   // mirrors isDialing for plugin callbacks
  const [callJustEnded,    setCallJustEnded]    = useState(false)
  const [callNotConnected, setCallNotConnected] = useState(false)
  const [isDialing,        setIsDialing]        = useState(false)

  // Reset ALL local state ONLY when the lead identity (id) actually changes.
  // Using a ref to track the previous id prevents re-runs when the parent
  // refreshes the lead object (same id, new reference) mid-session — which
  // was silently overwriting the stage the agent had already selected.
  const prevLeadIdRef = useRef(null)
  useEffect(()=>{
    if(prevLeadIdRef.current === lead?.id) return   // same lead — do NOT reset
    prevLeadIdRef.current = lead?.id
    setDisposition('')
    setCallOutcome('')
    setLeadStage(lead?.status||'New')
    setTemperature(lead?.lead_temperature||'Cold')
    setLoanForm({
      monthly_salary:    lead?.monthly_salary||'',
      company_name:      lead?.company_name||'',
      loan_type:         lead?.loan_type||'Personal Loan',
      existing_emi:      lead?.existing_emi||'',
      existing_loan:     lead?.existing_loan||'',
      outstanding_amount:lead?.outstanding_amount||'',
      housing_loan:      lead?.housing_loan||false,
      joint_loan:        lead?.joint_loan||false,
      loan_amount:       lead?.loan_amount||'',
    })
    setCallTimer(0)
    setCallStarted(false)
    setCallSaved(false)
    setSavedCallId(null)
    setLiveNote('')
    setFollowUpDate('')
    setFollowUpTime('')
    setShowFollowUp(false)
    setCallJustEnded(false)
    setCallNotConnected(false)
    setIsDialing(false)
    seenOffhookRef.current = false
    if(lead?.call_history){
      try{ setNoteHistory(typeof lead.call_history==='string'?JSON.parse(lead.call_history):lead.call_history) }
      catch(e){ setNoteHistory([]) }
    } else {
      setNoteHistory([])
    }
    loadWATemplates()
    loadObligations()
  },[lead?.id])

  // Auto save every 8 seconds — saves ONLY loan qualification fields + temperature.
  // Never saves status/leadStage here; that only happens on explicit Save & Next.
  useEffect(()=>{
    autoSaveRef.current = setInterval(()=>{
      if(liveNote.trim()) autoSaveDraft()
    }, 8000)
    return()=>clearInterval(autoSaveRef.current)
  },[liveNote, loanForm, temperature])

  // Call timer
  useEffect(()=>{
    if(callStarted){
      timerRef.current = setInterval(()=>setCallTimer(t=>t+1), 1000)
    } else {
      clearInterval(timerRef.current)
    }
    return()=>clearInterval(timerRef.current)
  },[callStarted])

  // ── CALL-STATE PLUGIN: register listener once per lead ───────────────────
  useEffect(()=>{
    let handle = null
    CallState.startListening().catch(()=>{})
    CallState.addListener('callStateChanged', ({ state })=>{
      if(state === 'OFFHOOK'){
        // Call actually connected — NOW start the real talk timer
        seenOffhookRef.current = true
        setIsDialing(false)
        setCallNotConnected(false)
        if(!callStartedRef.current){
          setCallTimer(0)
          setCallStarted(true)
          setCallSaved(false)
          setSavedCallId(null)
        }
      } else if(state === 'IDLE'){
        if(seenOffhookRef.current){
          // Real call ended (OFFHOOK was seen) — stop timer, prompt disposition
          seenOffhookRef.current = false
          setIsDialing(false)
          handleEndCallRef.current?.()
          setCallJustEnded(true)
        } else if(isDialingRef.current || callStartedRef.current){
          // IDLE without OFFHOOK — missed / busy / cancelled before answer
          setIsDialing(false)
          setCallStarted(false)
          setCallTimer(0)
          setCallNotConnected(true)
          setCallOutcome('Not Connected')
        }
      } else if(state === 'RINGING'){
        // Ringing: OFFHOOK hasn't fired yet; keep isDialing state as-is
        seenOffhookRef.current = false
      }
    }).then(h=>{ handle = h })
    return()=>{
      CallState.stopListening().catch(()=>{})
      handle?.remove()
    }
  },[lead?.id])

  const loadWATemplates=async()=>{
    const{data}=await supabase.from('settings').select('*').eq('key','wa_templates').single()
    if(data?.value){try{setWaTemplates(JSON.parse(data.value))}catch(e){}}
  }

  const loadObligations=async()=>{
    if(!lead?.id)return
    try{
      const{data,error}=await supabase.from('loan_obligations').select('*').eq('lead_id',lead.id)
      if(error) throw error
      setObligationDrafts(data||[])
    }catch(e){}
  }

  const formatTimer=(s)=>{
    const m=Math.floor(s/60), sec=s%60
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
  }

  // Obligation helper functions
  const buildEmptyObligation=()=>({
    id: 'tmp-'+Date.now(),
    obligation_type: 'Personal Loan',
    bank_name: '',
    emi_amount: '',
    outstanding_amount: '',
    sanctioned_amount: '',
    tenure_months: '',
    remaining_tenure: '',
    emis_paid: '',
    bounce: 'No',
    overdue_amount: '',
    dpd: '',
    address_proof: 'Yes',
    joint_type: 'Individual',
    joint_holder_name: '',
    joint_holder_income: '',
    joint_holder_relation: '',
    expanded: true,
    editing: true
  })

  const calculateObligationTotals=(items)=>{
    const totalEMI=items.reduce((sum,o)=>sum+Number(o.emi_amount||0),0)
    const totalOutstanding=items.reduce((sum,o)=>sum+Number(o.outstanding_amount||0),0)
    const totalSanctioned=items.reduce((sum,o)=>sum+Number(o.sanctioned_amount||0),0)
    const monthlySalary=Number(loanForm.monthly_salary||0)
    const foir=monthlySalary?Math.round((totalEMI/monthlySalary)*100):0
    return {totalEMI,totalOutstanding,totalSanctioned,foir}
  }

  const enrichDraftTitle=(ob)=>{
    const type=ob.obligation_type||'Unknown'
    const bank=ob.bank_name||'Bank'
    const emi=ob.emi_amount?`₹${Number(ob.emi_amount).toLocaleString('en-IN')}`:'EMI'
    return `${type} - ${bank} (${emi})`
  }

  const handleObligationFieldChange=(id,field,value)=>{
    setObligationDrafts(prev=>prev.map(item=>item.id===id?{...item,[field]:value}:item))
  }

  const toggleObligationExpand=(id)=>{
    setObligationDrafts(prev=>prev.map(item=>item.id===id?{...item,expanded:!item.expanded}:item))
  }

  const addObligationDraft=()=>{
    setObligationDrafts(prev=>[...prev,buildEmptyObligation()])
  }

  const deleteObligationCard=(obligation)=>{
    setObligationDrafts(prev=>prev.filter(item=>item.id!==obligation.id))
  }

  const saveObligationCard=async(obligation)=>{
    setSavingObligation(true)
    setObligationError('')
    const payload={
      lead_id: lead.id,
      obligation_type: obligation.obligation_type,
      bank_name: obligation.bank_name,
      emi_amount: Number(obligation.emi_amount||0),
      outstanding_amount: Number(obligation.outstanding_amount||0),
      sanctioned_amount: Number(obligation.sanctioned_amount||0),
      tenure_months: Number(obligation.tenure_months||0),
      remaining_tenure: Number(obligation.remaining_tenure||0),
      emis_paid: Number(obligation.emis_paid||0),
      bounce: obligation.bounce,
      overdue_amount: Number(obligation.overdue_amount||0),
      dpd: obligation.dpd,
      address_proof: obligation.address_proof,
      joint_type: obligation.joint_type,
      joint_holder_name: obligation.joint_holder_name,
      joint_holder_income: obligation.joint_holder_income,
      joint_holder_relation: obligation.joint_holder_relation,
    }
    try{
      if(String(obligation.id).startsWith('tmp-')){
        const {data,error}=await supabase.from('loan_obligations').insert([payload]).select().single()
        if(error) throw error
        setObligationDrafts(prev=>prev.map(item=>item.id===obligation.id?{...data,editing:false,expanded:false}:item))
      } else {
        const {data,error}=await supabase.from('loan_obligations').update(payload).eq('id',obligation.id).select().single()
        if(error) throw error
        setObligationDrafts(prev=>prev.map(item=>item.id===data.id?{...data,editing:false}:item))
      }
    }catch(err){
      setObligationError('Failed to save obligation: '+err.message)
    }
    setSavingObligation(false)
  }

  const startCall=()=>{
    setCallTimer(0)
    setCallStarted(false)   // timer starts only when OFFHOOK fires
    setIsDialing(true)
    setCallSaved(false)
    setSavedCallId(null)
    setCallJustEnded(false)
    setCallNotConnected(false)
    if(lead?.mobile) window.location.href=`tel:${lead.mobile}`
  }

  const buildCallNotesText=()=>noteHistory.map(n=>`[${n.time}] ${n.text}`).join('\n')

  const saveCallRecord=async()=>{
    const callPayload={
      lead_id:      lead.id,
      agent_id:     userId,
      call_status:  callOutcome||'Answered',
      call_outcome: disposition||'Connected',
      duration:     formatTimer(callTimer),
      notes:        buildCallNotesText(),
    }
    if(savedCallId){
      const {data,error}=await supabase.from('calls').update(callPayload).eq('id',savedCallId).select().single()
      if(error) throw error
      return data
    }
    const {data,error}=await supabase.from('calls').insert([callPayload]).select().single()
    if(error) throw error
    setSavedCallId(data?.id||null)
    return data
  }

  const handleEndCall=async()=>{
    if(!callStarted) return
    setIsDialing(false)
    setCallStarted(false)
    clearInterval(timerRef.current)
    if(callTimer<=0) return
    try{
      const savedCall=await saveCallRecord()
      if(savedCall){
        setCallSaved(true)
        setTimeout(()=>setCallSaved(false),2500)
        if(onSave) onSave({call:savedCall})
      }
    }catch(err){
      console.error('Failed to save call on end:', err)
    }
  }

  const addTimestampedNote=()=>{
    if(!liveNote.trim())return
    const now=new Date()
    const time=now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'})
    const entry={time, text:liveNote.trim(), at:now.toISOString()}
    setNoteHistory(prev=>[...prev, entry])
    setLiveNote('')
    if(noteRef.current) noteRef.current.focus()
  }

  const autoSaveDraft=async()=>{
    if(!lead?.id)return
    // IMPORTANT: Never include `status` here. Stage is only written on
    // explicit "Save & Next" so the agent's selection is never silently
    // overwritten between auto-save ticks.
    try {
      await supabase.from('leads').update({
        monthly_salary: loanForm.monthly_salary||null,
        company_name:   loanForm.company_name||null,
        loan_type:      loanForm.loan_type,
        existing_emi:   loanForm.existing_emi||null,
        existing_loan:  loanForm.existing_loan||null,
        outstanding_amount: loanForm.outstanding_amount||null,
        housing_loan:   loanForm.housing_loan,
        joint_loan:     loanForm.joint_loan,
        loan_amount:    loanForm.loan_amount||null,
        lead_temperature: temperature,
      }).eq('id', lead.id)
      setSaved(true)
      setTimeout(()=>setSaved(false), 2000)
    } catch(e) {}
  }

  // Disposition and Lead Stage are intentionally independent.
  // Clicking a quick disposition only sets the disposition label + shows
  // the follow-up scheduler for Callback; it never auto-changes leadStage.
  const handleDispositionClick=(disp)=>{
    setDisposition(disp.label)
    if(disp.label==='Callback') setShowFollowUp(true)
  }

  const handleSaveAndNext=async()=>{
    setCallJustEnded(false)
    setCallNotConnected(false)
    setSaving(true)
    try {
      const now=new Date()
      const callEntry={
        time: now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'}),
        date: now.toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata'}),
        duration: formatTimer(callTimer),
        outcome: callOutcome,
        disposition,
        notes: noteHistory,
        agent_id: userId,
        at: now.toISOString()
      }

      const existingHistory = lead.call_history
        ? (typeof lead.call_history==='string'?JSON.parse(lead.call_history):lead.call_history)
        : []

      const notesText = noteHistory.map(n=>`[${n.time}] ${n.text}`).join('\n')

      const updateData = {
        status:           leadStage,
        disposition:      disposition,
        lead_temperature: temperature,
        monthly_salary:   loanForm.monthly_salary||null,
        company_name:     loanForm.company_name||null,
        loan_type:        loanForm.loan_type,
        existing_emi:     loanForm.existing_emi||null,
        existing_loan:    loanForm.existing_loan||null,
        outstanding_amount: loanForm.outstanding_amount||null,
        housing_loan:     loanForm.housing_loan,
        joint_loan:       loanForm.joint_loan,
        loan_amount:      loanForm.loan_amount||null,
        notes:            (lead.notes||'')+(lead.notes?'\n':'')+notesText,
        call_history:     JSON.stringify([...existingHistory, callEntry]),
        call_count:       (lead.call_count||0)+1,
        // leads.follow_up_date is a plain `timestamp` (no timezone) column —
        // write the canonical IST string directly, no UTC conversion needed.
        follow_up_date:   followUpDate&&followUpTime
          ? buildIST(followUpDate,followUpTime)
          : lead.follow_up_date||null,
      }

      // Log call
      const callPayload={
        lead_id:      lead.id,
        agent_id:     userId,
        call_status:  callOutcome||'Connected',
        call_outcome: disposition,
        duration:     formatTimer(callTimer),
        notes:        notesText,
      }

      const [, callsResult] = await Promise.all([
        supabase.from('leads').update(updateData).eq('id', lead.id),
        savedCallId
          ? supabase.from('calls').update(callPayload).eq('id',savedCallId).select().single()
          : supabase.from('calls').insert([callPayload]).select().single()
      ])

      if(callsResult.error) throw callsResult.error
      const savedCall=callsResult.data
      if(!savedCallId && savedCall?.id) setSavedCallId(savedCall.id)

      if(onSave) onSave({lead:updateData, call:savedCall})

      // Create callback task if needed
      if(disposition==='Callback' && followUpDate && followUpTime){
        await supabase.from('tasks').insert([{
          title:       `Callback: ${lead?.full_name||''}`,
          lead_id:     lead?.id,
          assigned_to: userId,
          priority:    'High',
          status:      'Pending',
          notes:       notesText,
          // tasks.due_date is `timestamptz` — must be written as an explicit
          // UTC instant (toDbTimestamp) or Postgres stores it 5h30m off.
          // See src/utils/timeUtils.js for the full explanation.
          due_date:    toDbTimestamp(buildIST(followUpDate,followUpTime))
        }])
      }

      if(onSave) onSave(updateData)
      if(onNext) onNext()
    } catch(err){ alert('Error saving: '+err.message) }
    setSaving(false)
  }

  const sendWA=(tpl)=>{
    const name=lead.full_name?.split(' ')[0]||'Customer'
    const amount=Number(lead.loan_amount||loanForm.loan_amount||0).toLocaleString('en-IN')
    const emi=Math.round((Number(lead.loan_amount||loanForm.loan_amount||0)*0.012*Math.pow(1.012,36))/(Math.pow(1.012,36)-1)).toLocaleString('en-IN')
    const msg=tpl.message.replace(/{name}/g,name).replace(/{amount}/g,amount).replace(/{emi}/g,emi)
    window.open(`https://wa.me/91${lead.mobile}?text=${encodeURIComponent(msg)}`,'_blank')
    setShowWA(false)
  }

  const fmtAmt=n=>n?'₹'+Number(n).toLocaleString('en-IN'):'-'
  const TEMP_CONFIG={
    Hot:  {icon:<IconFlame size={13}/>,    color:'#DC2626', bg:'#FEE2E2'},
    Warm: {icon:<IconDroplet size={13}/>,  color:'#D97706', bg:'#FEF3C7'},
    Cold: {icon:<IconSnowflake size={13}/>,color:'#2563EB', bg:'#DBEAFE'},
  }

  const obligationTotals = calculateObligationTotals(obligationDrafts)

  // Keep plugin-callback refs in sync with the latest render's values
  callStartedRef.current   = callStarted
  handleEndCallRef.current = handleEndCall
  isDialingRef.current     = isDialing

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <div style={{background:'white',borderRadius:16,width:'100%',maxWidth:1000,maxHeight:'95vh',overflow:'hidden',display:'flex',flexDirection:'column',boxShadow:'0 24px 80px rgba(0,0,0,0.3)'}}>

        {/* ── HEADER ── */}
        <div style={{background:'linear-gradient(135deg,#2563EB,#1D4ED8)',padding:'14px 16px',display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexShrink:0}}>
          {/* Left — avatar + info block */}
          <div style={{display:'flex',alignItems:'flex-start',gap:12,flex:1,minWidth:0}}>
            <div style={{width:42,height:42,borderRadius:'50%',background:'rgba(255,255,255,0.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,fontWeight:700,color:'white',flexShrink:0}}>
              {lead.full_name?.[0]?.toUpperCase()}
            </div>
            <div style={{flex:1,minWidth:0}}>
              {/* Name — max 2 lines then ellipsis */}
              <div style={{color:'white',fontWeight:700,fontSize:15,lineHeight:1.3,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',wordBreak:'break-word'}}>
                {lead?.full_name||'—'}
              </div>
              {/* Queue badge + temperature tags on one wrapping row */}
              <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:5,marginTop:5}}>
                {totalInQueue>0&&(
                  <span style={{background:'rgba(255,255,255,0.2)',color:'white',fontSize:11,fontWeight:700,padding:'3px 8px',borderRadius:20,letterSpacing:'0.03em',flexShrink:0}}>
                    ⚡ {queuePosition} / {totalInQueue}
                  </span>
                )}
                {Object.entries(TEMP_CONFIG).map(([t,cfg])=>(
                  <button key={t} onClick={()=>setTemperature(t)}
                    style={{display:'flex',alignItems:'center',gap:4,padding:'3px 9px',borderRadius:20,border:'1.5px solid '+(temperature===t?'white':'rgba(255,255,255,0.3)'),background:temperature===t?'white':'transparent',color:temperature===t?cfg.color:'rgba(255,255,255,0.7)',fontSize:11,fontWeight:600,cursor:'pointer',transition:'all 0.15s',flexShrink:0}}>
                    {cfg.icon}{t}
                  </button>
                ))}
              </div>
              {/* Phone / City / App# */}
              <div style={{color:'rgba(255,255,255,0.7)',fontSize:12,marginTop:4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                +91 {lead?.mobile||'—'}{lead?.city?` · ${lead.city}`:''}{lead?.application_id?` · App# ${lead.application_id}`:''}
              </div>
            </div>
          </div>
          {/* Right — state indicator + saved + close */}
          <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0,marginLeft:8}}>
            {isDialing&&(
              <div style={{background:'rgba(255,255,255,0.15)',borderRadius:8,padding:'6px 10px',color:'#fde68a',fontWeight:700,fontSize:13,display:'flex',alignItems:'center',gap:5}}>
                📞 Calling…
              </div>
            )}
            {callStarted&&(
              <div style={{background:'rgba(255,255,255,0.15)',borderRadius:8,padding:'6px 10px',color:'white',fontWeight:700,fontSize:13,display:'flex',alignItems:'center',gap:5}}>
                <IconClock size={14}/>{formatTimer(callTimer)}
              </div>
            )}
            {saved&&<div style={{background:'rgba(255,255,255,0.15)',borderRadius:8,padding:'6px 10px',color:'#86efac',fontSize:12,fontWeight:500}}>✓</div>}
            <button onClick={onClose} style={{background:'rgba(255,255,255,0.15)',border:'none',color:'white',width:32,height:32,borderRadius:'50%',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <IconX size={16}/>
            </button>
          </div>
        </div>

        {/* ── BODY ── */}
        <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',flex:1,overflow:'hidden'}}>

          {/* LEFT — Customer Info + Loan Qualification */}
          <div style={{padding:18,overflowY:'auto',borderRight:'1px solid #E2E8F0'}}>

            {/* Dialing indicator */}
            {isDialing&&(
              <div style={{marginBottom:16,padding:16,background:'#FFFBEB',border:'1px solid #FCD34D',borderRadius:14,textAlign:'center'}}>
                <div style={{fontSize:28,fontWeight:800,color:'#92400E',letterSpacing:2}}>📞 Calling…</div>
                <div style={{fontSize:12,color:'#78350F',fontWeight:600,marginTop:6}}>Waiting for call to connect</div>
              </div>
            )}
            {/* Live call timer (only once OFFHOOK fires) */}
            {callStarted&&(
              <div style={{marginBottom:16,padding:16,background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:14,textAlign:'center'}}>
                <div style={{fontSize:34,fontWeight:800,color:'#B91C1C'}}>{formatTimer(callTimer)}</div>
                <div style={{fontSize:12,color:'#991B1B',fontWeight:700,marginTop:4}}>Connected — real talk time</div>
              </div>
            )}
            {/* Call button — 3 states: Start / Calling… / End Call */}
            <div style={{marginBottom:16,display:'flex',gap:10}}>
              {!isDialing&&!callStarted?(
                <button onClick={startCall}
                  style={{flex:1,padding:'13px',background:'#16a34a',color:'white',border:'none',borderRadius:10,fontSize:14,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,boxShadow:'0 4px 14px rgba(22,163,74,0.35)'}}>
                  <IconPhone size={18}/>Start Call
                </button>
              ):isDialing?(
                <button onClick={()=>setIsDialing(false)}
                  style={{flex:1,padding:'13px',background:'#d97706',color:'white',border:'none',borderRadius:10,fontSize:14,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
                  <IconPhone size={18}/>Calling… — tap to cancel
                </button>
              ):(
                <button onClick={handleEndCall}
                  style={{flex:1,padding:'13px',background:'#dc2626',color:'white',border:'none',borderRadius:10,fontSize:14,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
                  <IconPhoneOff size={18}/>End Call — {formatTimer(callTimer)}
                </button>
              )}
              <button onClick={()=>setShowWA(true)}
                style={{width:46,height:46,background:'#25D366',color:'white',border:'none',borderRadius:10,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
                <IconBrandWhatsapp size={20}/>
              </button>
            </div>

            {/* LOAN QUALIFICATION */}
            <div style={{background:'#F9FAFB',borderRadius:10,padding:16,border:'1px solid #E2E8F0',marginBottom:14}}>
              <div style={{fontSize:14,fontWeight:800,color:'#111827',marginBottom:14,textTransform:'uppercase',letterSpacing:'0.5px'}}>Loan Qualification</div>

              <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:12}}>

                {/* Monthly Salary */}
                <div>
                  <label style={{display:'block',fontSize:13,fontWeight:700,color:'#111827',marginBottom:6}}>Monthly Salary (₹)</label>
                  <input type="number" value={loanForm.monthly_salary} onChange={e=>setLoanForm({...loanForm,monthly_salary:e.target.value})}
                    placeholder="e.g. 45000"
                    style={{width:'100%',padding:'10px 12px',border:'2px solid #E2E8F0',borderRadius:8,fontSize:14,outline:'none',boxSizing:'border-box',background:'white',fontWeight:500}}
                    onFocus={e=>e.target.style.borderColor='#185FA5'} onBlur={e=>e.target.style.borderColor='#E2E8F0'}/>
                </div>

                {/* Company Name */}
                <div>
                  <label style={{display:'block',fontSize:13,fontWeight:700,color:'#111827',marginBottom:6}}>Company Name</label>
                  <input type="text" value={loanForm.company_name} onChange={e=>setLoanForm({...loanForm,company_name:e.target.value})}
                    placeholder="e.g. Infosys Ltd"
                    style={{width:'100%',padding:'10px 12px',border:'2px solid #E2E8F0',borderRadius:8,fontSize:14,outline:'none',boxSizing:'border-box',background:'white',fontWeight:500}}
                    onFocus={e=>e.target.style.borderColor='#185FA5'} onBlur={e=>e.target.style.borderColor='#E2E8F0'}/>
                </div>

                {/* Loan Type */}
                <div>
                  <label style={{display:'block',fontSize:13,fontWeight:700,color:'#111827',marginBottom:6}}>Loan Type</label>
                  <select value={loanForm.loan_type} onChange={e=>setLoanForm({...loanForm,loan_type:e.target.value})}
                    style={{width:'100%',padding:'10px 12px',border:'2px solid #E2E8F0',borderRadius:8,fontSize:14,outline:'none',background:'white',boxSizing:'border-box',fontWeight:500}}>
                    {LOAN_TYPES.map(l=><option key={l}>{l}</option>)}
                  </select>
                </div>

                {/* Required Loan Amount */}
                <div>
                  <label style={{display:'block',fontSize:13,fontWeight:700,color:'#111827',marginBottom:6}}>Required Amount (₹)</label>
                  <input type="number" value={loanForm.loan_amount} onChange={e=>setLoanForm({...loanForm,loan_amount:e.target.value})}
                    placeholder="e.g. 500000"
                    style={{width:'100%',padding:'10px 12px',border:'2px solid #E2E8F0',borderRadius:8,fontSize:14,outline:'none',boxSizing:'border-box',background:'white',fontWeight:500}}
                    onFocus={e=>e.target.style.borderColor='#185FA5'} onBlur={e=>e.target.style.borderColor='#E2E8F0'}/>
                </div>

                {/* Existing EMI */}
                <div>
                  <label style={{display:'block',fontSize:13,fontWeight:700,color:'#111827',marginBottom:6}}>Existing EMI (₹)</label>
                  <input type="number" value={loanForm.existing_emi} onChange={e=>setLoanForm({...loanForm,existing_emi:e.target.value})}
                    placeholder="0 if none"
                    style={{width:'100%',padding:'10px 12px',border:'2px solid #E2E8F0',borderRadius:8,fontSize:14,outline:'none',boxSizing:'border-box',background:'white',fontWeight:500}}
                    onFocus={e=>e.target.style.borderColor='#185FA5'} onBlur={e=>e.target.style.borderColor='#E2E8F0'}/>
                </div>

                {/* Outstanding Amount */}
                <div>
                  <label style={{display:'block',fontSize:13,fontWeight:700,color:'#111827',marginBottom:6}}>Outstanding Loan (₹)</label>
                  <input type="number" value={loanForm.outstanding_amount} onChange={e=>setLoanForm({...loanForm,outstanding_amount:e.target.value})}
                    placeholder="0 if none"
                    style={{width:'100%',padding:'10px 12px',border:'2px solid #E2E8F0',borderRadius:8,fontSize:14,outline:'none',boxSizing:'border-box',background:'white',fontWeight:500}}
                    onFocus={e=>e.target.style.borderColor='#185FA5'} onBlur={e=>e.target.style.borderColor='#E2E8F0'}/>
                </div>
              </div>

              {/* Toggles */}
              <div style={{display:'flex',gap:16,marginTop:16}}>
                {[
                  {key:'housing_loan',label:'Housing Loan?'},
                  {key:'joint_loan',  label:'Joint Loan?'},
                ].map(f=>(
                  <div key={f.key} onClick={()=>setLoanForm({...loanForm,[f.key]:!loanForm[f.key]})}
                    style={{display:'flex',alignItems:'center',gap:10,padding:'12px 16px',borderRadius:10,border:'2px solid '+(loanForm[f.key]?'#185FA5':'#E2E8F0'),background:loanForm[f.key]?'#E6F1FB':'white',cursor:'pointer',flex:1,justifyContent:'center'}}>
                    <div style={{width:20,height:20,borderRadius:6,background:loanForm[f.key]?'#185FA5':'white',border:'2px solid '+(loanForm[f.key]?'#185FA5':'#D1D5DB'),display:'flex',alignItems:'center',justifyContent:'center'}}>
                      {loanForm[f.key]&&<IconCheck size={14} color="white" strokeWidth={3}/>}
                    </div>
                    <span style={{fontSize:14,fontWeight:700,color:loanForm[f.key]?'#185FA5':'#111827'}}>{f.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* OBLIGATIONS SECTION */}
            <div style={{background:'#111827',borderRadius:16,padding:18,border:'1px solid #334155',marginBottom:14}}>
              <div style={{fontSize:14,fontWeight:800,color:'white',marginBottom:16,textTransform:'uppercase',letterSpacing:'0.5px'}}>Existing Obligations</div>

              {/* Obligation Totals */}
              <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(3,auto)',gap:10,marginBottom:16}}>
                <div style={{background:'#0f172a',border:'1px solid #334155',borderRadius:14,padding:'14px 16px',minWidth:160}}>
                  <div style={{fontSize:11,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:4}}>Total EMI</div>
                  <div style={{fontSize:22,fontWeight:800,color:'#38bdf8'}}>₹{obligationTotals.totalEMI.toLocaleString('en-IN')}</div>
                </div>
                <div style={{background:'#0f172a',border:'1px solid #334155',borderRadius:14,padding:'14px 16px',minWidth:160}}>
                  <div style={{fontSize:11,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:4}}>Outstanding</div>
                  <div style={{fontSize:22,fontWeight:800,color:'#a78bfa'}}>₹{obligationTotals.totalOutstanding.toLocaleString('en-IN')}</div>
                </div>
                <div style={{background:'#0f172a',border:'1px solid #334155',borderRadius:14,padding:'14px 16px',minWidth:160}}>
                  <div style={{fontSize:11,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:4}}>FOIR</div>
                  <div style={{fontSize:22,fontWeight:800,color:'#22c55e'}}>{obligationTotals.foir}%</div>
                </div>
              </div>

              <button onClick={addObligationDraft}
                style={{padding:'12px 18px',borderRadius:12,background:'#2563eb',color:'white',fontWeight:700,fontSize:13,border:'none',cursor:'pointer',minWidth:160,marginBottom:16}}>
                + Add Obligation
              </button>

              {obligationError&&(
                <div style={{background:'#7f1d1d',color:'white',borderRadius:12,padding:'12px 14px',marginBottom:14,fontSize:13}}>{obligationError}</div>
              )}

              {obligationDrafts.length===0&&(
                <div style={{background:'#0f172a',border:'1px dashed #334155',borderRadius:16,padding:'30px 20px',textAlign:'center',color:'#94a3b8'}}>
                  No obligations yet. Click <strong style={{color:'white'}}>+ Add Obligation</strong> to start capturing liabilities.
                </div>
              )}

              {obligationDrafts.map(ob=>{
                const isHousing=ob.obligation_type==='Housing Loan'
                return(
                  <div key={ob.id} style={{background:'#0f172a',border:'1px solid #334155',borderRadius:18,padding:18,marginBottom:14}}>
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

            {/* Previous call history */}
            {lead.call_count>0&&(
              <div style={{background:'#FFFAF0',border:'1px solid #F6E05E',borderRadius:8,padding:12}}>
                <div style={{fontSize:11,fontWeight:700,color:'#744210',marginBottom:8,textTransform:'uppercase'}}>Previous Calls ({lead.call_count})</div>
                {(()=>{
                  try{
                    const hist=typeof lead.call_history==='string'?JSON.parse(lead.call_history):lead.call_history||[]
                    return hist.slice(-3).reverse().map((h,i)=>(
                      <div key={i} style={{fontSize:12,color:'#744210',marginBottom:4,paddingBottom:4,borderBottom:i<hist.slice(-3).length-1?'1px solid #F6E05E':'none'}}>
                        <strong>{h.date} {h.time}</strong> — {h.outcome||h.disposition} ({h.duration})
                      </div>
                    ))
                  }catch(e){return null}
                })()}
              </div>
            )}
          </div>

          {/* RIGHT — Notes + Quick Actions */}
          <div style={{padding:18,display:'flex',flexDirection:'column',gap:14,overflowY:'auto'}}>

            {/* Real call ended — OFFHOOK was seen */}
            {callJustEnded&&(
              <div style={{background:'#fef3c7',border:'2px solid #f59e0b',borderRadius:12,padding:'14px 16px',display:'flex',alignItems:'center',gap:12,flexShrink:0}}>
                <span style={{fontSize:22,lineHeight:1}}>📞</span>
                <div>
                  <div style={{fontSize:14,fontWeight:800,color:'#92400e'}}>Call ended · {formatTimer(callTimer)} talk time</div>
                  <div style={{fontSize:12,color:'#78350f',marginTop:2}}>Select a disposition below and tap <strong>Save &amp; Next Lead</strong></div>
                </div>
              </div>
            )}

            {/* Not connected — IDLE fired without OFFHOOK */}
            {callNotConnected&&(
              <div style={{background:'#f1f5f9',border:'2px solid #94a3b8',borderRadius:12,padding:'14px 16px',display:'flex',alignItems:'center',gap:12,flexShrink:0}}>
                <span style={{fontSize:22,lineHeight:1}}>📵</span>
                <div>
                  <div style={{fontSize:14,fontWeight:800,color:'#334155'}}>Call not answered</div>
                  <div style={{fontSize:12,color:'#64748b',marginTop:2}}>Select <strong>RNR</strong>, <strong>Busy</strong> or <strong>Not Connected</strong> then tap <strong>Save &amp; Next Lead</strong></div>
                </div>
              </div>
            )}

            {/* LIVE NOTES */}
            <div>
              <div style={{fontSize:14,fontWeight:800,color:'#111827',marginBottom:10,textTransform:'uppercase',letterSpacing:'0.5px'}}>Live Call Notes</div>

              {/* Notes history */}
              {noteHistory.length>0&&(
                <div style={{background:'#F9FAFB',border:'1px solid #E2E8F0',borderRadius:8,padding:12,marginBottom:10,maxHeight:140,overflowY:'auto'}}>
                  {noteHistory.map((n,i)=>(
                    <div key={i} style={{fontSize:13,color:'#111827',marginBottom:6,lineHeight:1.5}}>
                      <span style={{color:'#6B7280',fontWeight:700}}>{n.time}</span> — {n.text}
                    </div>
                  ))}
                </div>
              )}

              {/* Note input */}
              <div style={{display:'flex',gap:10}}>
                <textarea ref={noteRef} value={liveNote} onChange={e=>setLiveNote(e.target.value)}
                  onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();addTimestampedNote()}}}
                  placeholder="Type note... (Enter to save with timestamp)"
                  style={{flex:1,padding:'12px',border:'2px solid #E2E8F0',borderRadius:8,fontSize:14,outline:'none',resize:'none',minHeight:80,fontFamily:'inherit',lineHeight:1.5,color:'#111827',fontWeight:500}}
                  onFocus={e=>e.target.style.borderColor='#185FA5'} onBlur={e=>e.target.style.borderColor='#E2E8F0'}/>
                <button onClick={addTimestampedNote} style={{width:48,background:'#185FA5',color:'white',border:'none',borderRadius:8,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                  <IconSend size={16}/>
                </button>
              </div>
              <div style={{fontSize:12,color:'#6B7280',marginTop:6}}>Enter to add timestamped note · Shift+Enter for new line</div>
            </div>

            {/* QUICK DISPOSITIONS */}
            <div>
              <div style={{fontSize:14,fontWeight:800,color:'#111827',marginBottom:10,textTransform:'uppercase',letterSpacing:'0.5px'}}>Quick Disposition</div>
              <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr 1fr':'1fr 1fr 1fr',gap:8}}>
                {QUICK_DISPOSITIONS.map(d=>(
                  <button key={d.label} onClick={()=>handleDispositionClick(d)}
                    style={{padding:'12px 10px',borderRadius:10,border:'2px solid '+(disposition===d.label?d.color:'#E2E8F0'),background:disposition===d.label?d.bg:'white',color:disposition===d.label?d.color:'#374151',fontSize:13,fontWeight:700,cursor:'pointer',transition:'all 0.15s',textAlign:'center'}}>
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {/* LEAD STAGE — separate from disposition */}
            <div>
              <div style={{fontSize:14,fontWeight:800,color:'#111827',marginBottom:10,textTransform:'uppercase',letterSpacing:'0.5px'}}>Lead Stage (separate from disposition)</div>
              <select
                value={leadStage}
                onChange={e=>setLeadStage(e.target.value)}
                style={{width:'100%',padding:'10px 12px',borderRadius:8,border:'2px solid #E2E8F0',background:'white',color:'#111827',fontSize:14,outline:'none',boxSizing:'border-box',fontWeight:500}}>
                {STAGE_OPTIONS.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* CALLBACK SCHEDULER */}
            {(showFollowUp||disposition==='Callback')&&(
              <div style={{background:'#FFFAF0',border:'1px solid #F6E05E',borderRadius:12,padding:16}}>
                <div style={{fontSize:14,fontWeight:800,color:'#744210',marginBottom:12,display:'flex',alignItems:'center',gap:8}}><IconCalendar size={16}/>Schedule Callback</div>
                <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:12}}>
                  <div>
                    <label style={{display:'block',fontSize:13,fontWeight:700,color:'#111827',marginBottom:6}}>Date</label>
                    <input type="date" value={followUpDate} onChange={e=>setFollowUpDate(e.target.value)}
                      min={new Date().toISOString().split('T')[0]}
                      style={{width:'100%',padding:'10px 12px',border:'2px solid #E2E8F0',borderRadius:8,fontSize:14,outline:'none',boxSizing:'border-box'}}/>
                  </div>
                  <div>
                    <label style={{display:'block',fontSize:13,fontWeight:700,color:'#111827',marginBottom:6}}>Time</label>
                    <TimeInput value={followUpTime} onChange={e=>setFollowUpTime(e.target.value)}
                      style={{width:'100%',padding:'10px 12px',border:'2px solid #E2E8F0',borderRadius:8,fontSize:14,outline:'none',boxSizing:'border-box'}}/>
                  </div>
                </div>
                {followUpDate&&followUpTime&&(
                  <div style={{marginTop:10,fontSize:13,color:'#744210',fontWeight:600}}>
                    ✅ Reminder set: {formatIST(buildIST(followUpDate,followUpTime))}
                  </div>
                )}
              </div>
            )}

            {/* SAVE & NEXT */}
            <div style={{marginTop:'auto',display:'flex',gap:10}}>
              <button onClick={handleSaveAndNext} disabled={saving}
                style={{flex:1,padding:'14px 20px',background:saving?'#E5E7EB':'#059669',color:saving?'#9CA3AF':'white',border:'none',borderRadius:12,fontSize:15,fontWeight:700,cursor:saving?'not-allowed':'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
                <IconPlayerSkipForward size={17}/>
                {saving?'Saving…':totalInQueue>0&&queuePosition>=totalInQueue?'Save & Finish ✓':'Save & Next Lead'}
              </button>
              <button onClick={()=>{autoSaveDraft();onClose&&onClose()}}
                style={{padding:'14px 20px',background:'#F3F4F6',color:'#374151',border:'none',borderRadius:12,fontSize:15,fontWeight:700,cursor:'pointer'}}>
                Save & Close
              </button>
            </div>
          </div>
        </div>

        {/* WA MODAL */}
        {showWA&&(
          <>
            <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.5)',zIndex:10}} onClick={()=>setShowWA(false)}/>
            <div style={{position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',background:'white',borderRadius:14,width:420,maxHeight:'80vh',overflow:'hidden',zIndex:20,boxShadow:'0 20px 60px rgba(0,0,0,0.2)'}}>
              <div style={{background:'#25D366',padding:'14px 18px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div style={{display:'flex',alignItems:'center',gap:8,color:'white',fontWeight:700,fontSize:14}}><IconBrandWhatsapp size={18}/>WhatsApp — {lead?.full_name}</div>
                <button onClick={()=>setShowWA(false)} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'white',width:26,height:26,borderRadius:'50%',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><IconX size={13}/></button>
              </div>
              <div style={{padding:16,overflowY:'auto',maxHeight:'calc(80vh - 60px)'}}>
                {waTemplates.length===0
                  ?<div style={{textAlign:'center',padding:20,color:'#9CA3AF',fontSize:13}}>No templates configured.<br/>Go to Admin Panel → WA Templates</div>
                  :waTemplates.map(tpl=>(
                    <div key={tpl.id} onClick={()=>sendWA(tpl)}
                      style={{background:tpl.tagBg||'#F9FAFB',border:'1px solid #E5E7EB',borderRadius:10,padding:12,marginBottom:10,cursor:'pointer',transition:'all 0.15s'}}
                      onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-1px)';e.currentTarget.style.boxShadow='0 4px 12px rgba(0,0,0,0.08)'}}
                      onMouseLeave={e=>{e.currentTarget.style.transform='none';e.currentTarget.style.boxShadow='none'}}>
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:5}}>
                        <div style={{fontWeight:700,fontSize:13,color:'#111827'}}>{tpl.icon} {tpl.name}</div>
                        <span style={{background:tpl.tagColor,color:'white',fontSize:10,padding:'2px 7px',borderRadius:20,fontWeight:600}}>{tpl.tag}</span>
                      </div>
                      <div style={{fontSize:11,color:'#6B7280',lineHeight:1.5}}>{tpl.message.replace(/{name}/g,lead.full_name?.split(' ')[0]).replace(/{amount}/g,Number(loanForm.loan_amount||lead.loan_amount||0).toLocaleString('en-IN')).slice(0,100)}…</div>
                    </div>
                  ))
                }
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}