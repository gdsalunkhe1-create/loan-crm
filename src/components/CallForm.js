/* eslint-disable */
import { useContext, useState, useEffect } from 'react'
import { CallContext } from '../context/CallContext'
import { supabase } from '../supabase'
import { IconX } from '@tabler/icons-react'
import toast from 'react-hot-toast'
import './CallForm.css'

const LOAN_TYPES = [
  'Personal Loan',
  'Housing Loan',
  'Credit Card',
  'Education Loan',
  'Car Loan',
  'Bike Loan',
  'Consumer Durable Loan',
  'Business Loan',
  'LAP'
]

const DISPOSITION_OPTIONS = [
  { label: 'Interested', color: '#10b981' },
  { label: 'Callback', color: '#f59e0b' },
  { label: 'Not Interested', color: '#ef4444' },
  { label: 'RNR', color: '#8b5cf6' },
  { label: 'Busy', color: '#6366f1' },
  { label: 'Switched Off', color: '#64748b' },
  { label: 'DND', color: '#dc2626' },
]

export default function CallForm({ userId }) {
  const { callData, showCallForm, closeCallForm } = useContext(CallContext)

  const [selectedDisposition, setSelectedDisposition] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [salary, setSalary] = useState('')
  const [company, setCompany] = useState('')
  const [employmentType, setEmploymentType] = useState('')

  const [obligations, setObligations] = useState([{
    id: 1, loanType: 'Personal Loan', bankName: '', loanAmount: '',
    emiAmount: '', outstandingAmount: '', emisPaid: '', tenure: '',
    anyBounce: 'No', jointStatus: 'Individual', relationWithJoint: '',
    jointHolderIncome: '', emiPaidBy: 'Self', creditLimit: '',
    ccOutstanding: '', anyOverdue: 'No', eduLoanPaidBy: 'Self', emisLeft: '',
  }])
  const [nextObligationId, setNextObligationId] = useState(2)

  // Log when modal opens
  useEffect(() => {
    if (showCallForm) {
      console.log('[CallForm] Modal opened', callData)
    }
  }, [showCallForm])

  // Escape key closes modal
  useEffect(() => {
    if (!showCallForm) return
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        console.log('[CallForm] Closed via Escape key')
        handleCancel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showCallForm])

  // Guard: never render when modal is closed or no real call data
  if (!showCallForm || !callData?.leadId) return null

  const formatTime = (seconds) => {
    const mins = Math.floor((seconds || 0) / 60)
    const secs = (seconds || 0) % 60
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  const handleAddObligation = () => {
    setObligations([...obligations, {
      id: nextObligationId, loanType: 'Personal Loan', bankName: '',
      loanAmount: '', emiAmount: '', outstandingAmount: '', emisPaid: '',
      tenure: '', anyBounce: 'No', jointStatus: 'Individual',
      relationWithJoint: '', jointHolderIncome: '', emiPaidBy: 'Self',
      creditLimit: '', ccOutstanding: '', anyOverdue: 'No',
      eduLoanPaidBy: 'Self', emisLeft: '',
    }])
    setNextObligationId(nextObligationId + 1)
  }

  const handleRemoveObligation = (id) => {
    if (obligations.length > 1) setObligations(obligations.filter(o => o.id !== id))
  }

  const handleUpdateObligation = (id, field, value) => {
    setObligations(obligations.map(o => o.id === id ? { ...o, [field]: value } : o))
  }

  const renderObligationFields = (obligation) => {
    const { loanType, id } = obligation
    switch (loanType) {
      case 'Personal Loan':
        return (
          <div className="form-grid">
            <div className="form-group"><label>Bank Name</label><input type="text" value={obligation.bankName} onChange={e => handleUpdateObligation(id, 'bankName', e.target.value)} /></div>
            <div className="form-group"><label>Loan Amount (₹)</label><input type="number" value={obligation.loanAmount} onChange={e => handleUpdateObligation(id, 'loanAmount', e.target.value)} /></div>
            <div className="form-group"><label>EMI Amount (₹)</label><input type="number" value={obligation.emiAmount} onChange={e => handleUpdateObligation(id, 'emiAmount', e.target.value)} /></div>
            <div className="form-group"><label>Current Outstanding (₹)</label><input type="number" value={obligation.outstandingAmount} onChange={e => handleUpdateObligation(id, 'outstandingAmount', e.target.value)} /></div>
            <div className="form-group"><label>Total EMIs Paid</label><input type="number" value={obligation.emisPaid} onChange={e => handleUpdateObligation(id, 'emisPaid', e.target.value)} /></div>
            <div className="form-group"><label>Tenure (months)</label><input type="number" value={obligation.tenure} onChange={e => handleUpdateObligation(id, 'tenure', e.target.value)} /></div>
            <div className="form-group"><label>Any EMI Bounce?</label><select value={obligation.anyBounce} onChange={e => handleUpdateObligation(id, 'anyBounce', e.target.value)}><option value="No">No</option><option value="Yes">Yes</option></select></div>
          </div>
        )
      case 'Housing Loan':
        return (
          <div className="form-grid">
            <div className="form-group"><label>Loan Amount (₹)</label><input type="number" value={obligation.loanAmount} onChange={e => handleUpdateObligation(id, 'loanAmount', e.target.value)} /></div>
            <div className="form-group"><label>EMI Amount (₹)</label><input type="number" value={obligation.emiAmount} onChange={e => handleUpdateObligation(id, 'emiAmount', e.target.value)} /></div>
            <div className="form-group"><label>Individual or Joint?</label><select value={obligation.jointStatus} onChange={e => handleUpdateObligation(id, 'jointStatus', e.target.value)}><option value="Individual">Individual</option><option value="Joint">Joint</option></select></div>
            {obligation.jointStatus === 'Joint' && (<>
              <div className="form-group"><label>Relation with Joint Holder</label><input type="text" value={obligation.relationWithJoint} onChange={e => handleUpdateObligation(id, 'relationWithJoint', e.target.value)} /></div>
              <div className="form-group"><label>Income of Joint Holder (₹)</label><input type="number" value={obligation.jointHolderIncome} onChange={e => handleUpdateObligation(id, 'jointHolderIncome', e.target.value)} /></div>
              <div className="form-group"><label>EMI Paid by</label><select value={obligation.emiPaidBy} onChange={e => handleUpdateObligation(id, 'emiPaidBy', e.target.value)}><option value="Self">Self</option><option value="Co-applicant">Co-applicant</option><option value="Both">Both</option></select></div>
            </>)}
          </div>
        )
      case 'Credit Card':
        return (
          <div className="form-grid">
            <div className="form-group"><label>Bank Name</label><input type="text" value={obligation.bankName} onChange={e => handleUpdateObligation(id, 'bankName', e.target.value)} /></div>
            <div className="form-group"><label>Credit Limit (₹)</label><input type="number" value={obligation.creditLimit} onChange={e => handleUpdateObligation(id, 'creditLimit', e.target.value)} /></div>
            <div className="form-group"><label>Outstanding Amount (₹)</label><input type="number" value={obligation.ccOutstanding} onChange={e => handleUpdateObligation(id, 'ccOutstanding', e.target.value)} /></div>
            <div className="form-group"><label>Any Overdue / Late Payments?</label><select value={obligation.anyOverdue} onChange={e => handleUpdateObligation(id, 'anyOverdue', e.target.value)}><option value="No">No</option><option value="Yes">Yes</option></select></div>
          </div>
        )
      case 'Education Loan':
        return (
          <div className="form-grid">
            <div className="form-group"><label>Loan Amount (₹)</label><input type="number" value={obligation.loanAmount} onChange={e => handleUpdateObligation(id, 'loanAmount', e.target.value)} /></div>
            <div className="form-group"><label>EMI Amount (₹)</label><input type="number" value={obligation.emiAmount} onChange={e => handleUpdateObligation(id, 'emiAmount', e.target.value)} /></div>
            <div className="form-group"><label>EMI Paid by</label><select value={obligation.eduLoanPaidBy} onChange={e => handleUpdateObligation(id, 'eduLoanPaidBy', e.target.value)}><option value="Self">Self</option><option value="Other">Other (Parent/Guardian)</option></select></div>
          </div>
        )
      case 'Car Loan':
      case 'Bike Loan':
      case 'Consumer Durable Loan':
        return (
          <div className="form-grid">
            <div className="form-group"><label>Loan Amount (₹)</label><input type="number" value={obligation.loanAmount} onChange={e => handleUpdateObligation(id, 'loanAmount', e.target.value)} /></div>
            <div className="form-group"><label>EMI Amount (₹)</label><input type="number" value={obligation.emiAmount} onChange={e => handleUpdateObligation(id, 'emiAmount', e.target.value)} /></div>
            <div className="form-group"><label>EMIs Left</label><input type="number" value={obligation.emisLeft} onChange={e => handleUpdateObligation(id, 'emisLeft', e.target.value)} /></div>
          </div>
        )
      case 'Business Loan':
      case 'LAP':
        return (
          <div className="form-grid">
            <div className="form-group"><label>Bank / NBFC Name</label><input type="text" value={obligation.bankName} onChange={e => handleUpdateObligation(id, 'bankName', e.target.value)} /></div>
            <div className="form-group"><label>Loan Amount (₹)</label><input type="number" value={obligation.loanAmount} onChange={e => handleUpdateObligation(id, 'loanAmount', e.target.value)} /></div>
            <div className="form-group"><label>EMI Amount (₹)</label><input type="number" value={obligation.emiAmount} onChange={e => handleUpdateObligation(id, 'emiAmount', e.target.value)} /></div>
            <div className="form-group"><label>Outstanding Amount (₹)</label><input type="number" value={obligation.outstandingAmount} onChange={e => handleUpdateObligation(id, 'outstandingAmount', e.target.value)} /></div>
            <div className="form-group"><label>Tenure (months)</label><input type="number" value={obligation.tenure} onChange={e => handleUpdateObligation(id, 'tenure', e.target.value)} /></div>
          </div>
        )
      default:
        return null
    }
  }

  const handleCancel = () => {
    console.log('[CallForm] Cancel clicked — closing modal and resetting state')
    setSelectedDisposition('')
    setNotes('')
    setSalary('')
    setCompany('')
    setEmploymentType('')
    setObligations([{
      id: 1, loanType: 'Personal Loan', bankName: '', loanAmount: '',
      emiAmount: '', outstandingAmount: '', emisPaid: '', tenure: '',
      anyBounce: 'No', jointStatus: 'Individual', relationWithJoint: '',
      jointHolderIncome: '', emiPaidBy: 'Self', creditLimit: '',
      ccOutstanding: '', anyOverdue: 'No', eduLoanPaidBy: 'Self', emisLeft: '',
    }])
    setNextObligationId(2)
    closeCallForm()
    console.log('[CallForm] State reset and overlay removed')
  }

  const handleSaveCall = async () => {
    console.log('[CallForm] Save Call clicked', { selectedDisposition, notes, salary, company })
    if (!selectedDisposition) { toast.error('Please select a disposition'); return }
    setLoading(true)
    try {
      const loanDetails = {
        salary, company, employmentType,
        obligations: obligations.map(obl => {
          const base = { loanType: obl.loanType }
          switch (obl.loanType) {
            case 'Personal Loan': return { ...base, bankName: obl.bankName, loanAmount: obl.loanAmount, emiAmount: obl.emiAmount, outstandingAmount: obl.outstandingAmount, emisPaid: obl.emisPaid, tenure: obl.tenure, anyBounce: obl.anyBounce }
            case 'Housing Loan': return { ...base, loanAmount: obl.loanAmount, emiAmount: obl.emiAmount, jointStatus: obl.jointStatus, relationWithJoint: obl.jointStatus === 'Joint' ? obl.relationWithJoint : null, jointHolderIncome: obl.jointStatus === 'Joint' ? obl.jointHolderIncome : null, emiPaidBy: obl.jointStatus === 'Joint' ? obl.emiPaidBy : null }
            case 'Credit Card': return { ...base, bankName: obl.bankName, creditLimit: obl.creditLimit, outstandingAmount: obl.ccOutstanding, anyOverdue: obl.anyOverdue }
            case 'Education Loan': return { ...base, loanAmount: obl.loanAmount, emiAmount: obl.emiAmount, paidBy: obl.eduLoanPaidBy }
            case 'Car Loan': case 'Bike Loan': case 'Consumer Durable Loan': return { ...base, loanAmount: obl.loanAmount, emiAmount: obl.emiAmount, emisLeft: obl.emisLeft }
            case 'Business Loan': case 'LAP': return { ...base, bankName: obl.bankName, loanAmount: obl.loanAmount, emiAmount: obl.emiAmount, outstandingAmount: obl.outstandingAmount, tenure: obl.tenure }
            default: return base
          }
        })
      }
      const { error } = await supabase.from('calls').insert([{
        lead_id: callData?.leadId, agent_id: userId,
        phone_number: callData?.phoneNumber,
        duration_seconds: callData?.duration || 0,
        disposition: selectedDisposition,
        loan_details: loanDetails, notes,
        call_timestamp: new Date().toISOString(), connected: true,
      }])
      if (error) throw error
      console.log('[CallForm] Call saved successfully, closing modal')
      toast.success(`Call saved - ${selectedDisposition}`)
      handleCancel()
    } catch (error) {
      console.error('[CallForm] Error saving call:', error)
      toast.error('Error saving call')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="call-form-overlay">
      <div className="call-form-container">
        <div className="call-form-header">
          <div>
            <h2>Call Summary</h2>
            <p>{callData?.leadName} • {callData?.phoneNumber} • {formatTime(callData?.duration)}</p>
          </div>
          <button className="close-btn" onClick={handleCancel}><IconX size={24} /></button>
        </div>

        <div className="call-form-body">
          <div className="form-section">
            <h3 className="section-title">Basic Details</h3>
            <div className="form-grid">
              <div className="form-group"><label>Monthly Salary (₹)</label><input type="number" value={salary} onChange={e => setSalary(e.target.value)} placeholder="₹" /></div>
              <div className="form-group"><label>Company Name</label><input type="text" value={company} onChange={e => setCompany(e.target.value)} placeholder="Enter company name" /></div>
              <div className="form-group"><label>Employment Type</label>
                <select value={employmentType} onChange={e => setEmploymentType(e.target.value)}>
                  <option value="">Select employment type</option>
                  <option value="Salaried">Salaried</option>
                  <option value="Self Employed">Self Employed</option>
                  <option value="Business">Business</option>
                  <option value="Freelance">Freelance</option>
                </select>
              </div>
            </div>
          </div>

          <div className="form-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 className="section-title">Loan Obligations</h3>
              <button type="button" onClick={handleAddObligation}
                style={{ background: '#10b981', color: 'white', border: 'none', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
                + Add Another Loan
              </button>
            </div>
            {obligations.map((obligation, idx) => (
              <div key={obligation.id} style={{ marginBottom: '20px', padding: '16px', border: '1px solid #e5e7eb', borderRadius: '8px', background: '#f9fafb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div>
                    <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Obligation {idx + 1}</div>
                    <select value={obligation.loanType} onChange={e => handleUpdateObligation(obligation.id, 'loanType', e.target.value)}
                      style={{ marginTop: '4px', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', fontWeight: '600', background: 'white', cursor: 'pointer' }}>
                      {LOAN_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                    </select>
                  </div>
                  {obligations.length > 1 && (
                    <button type="button" onClick={() => handleRemoveObligation(obligation.id)}
                      style={{ background: '#ef4444', color: 'white', border: 'none', padding: '6px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                      Remove
                    </button>
                  )}
                </div>
                {renderObligationFields(obligation)}
              </div>
            ))}
          </div>

          <div className="form-section">
            <h3 className="section-title">Call Outcome</h3>
            <div className="disposition-grid">
              {DISPOSITION_OPTIONS.map(option => (
                <button key={option.label}
                  className={`disposition-btn ${selectedDisposition === option.label ? 'active' : ''}`}
                  style={{ borderColor: selectedDisposition === option.label ? option.color : '#e5e7eb', background: selectedDisposition === option.label ? `${option.color}15` : 'white' }}
                  onClick={() => setSelectedDisposition(option.label)}>
                  <span style={{ color: option.color }}>●</span> {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="form-section">
            <h3 className="section-title">Call Notes</h3>
            <textarea className="call-notes" value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Add agent notes about this call..." rows={4} />
          </div>
        </div>

        <div className="call-form-footer">
          <button className="btn-cancel" onClick={handleCancel}>Cancel</button>
          <button className="btn-save" onClick={handleSaveCall} disabled={loading}>
            {loading ? 'Saving...' : 'Save Call'}
          </button>
        </div>
      </div>
    </div>
  )
}
