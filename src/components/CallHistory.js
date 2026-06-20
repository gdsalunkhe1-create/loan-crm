/* eslint-disable */
import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { IconPhone, IconClock, IconNotes } from '@tabler/icons-react'
import './CallHistory.css'

export default function CallHistory({ leadId }) {
  const [calls, setCalls] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedCall, setExpandedCall] = useState(null)

  useEffect(() => {
    if (leadId) {
      fetchCallHistory()
    }
  }, [leadId])

  const fetchCallHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('calls')
        .select('*')
        .eq('lead_id', leadId)
        .order('call_timestamp', { ascending: false })

      if (error) throw error
      setCalls(data || [])
    } catch (error) {
      console.error('Error fetching call history:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getDispositionColor = (disposition) => {
    const colors = {
      'Interested': '#10b981',
      'Callback': '#f59e0b',
      'Not Interested': '#ef4444',
      'RNR': '#8b5cf6',
      'Busy': '#6366f1',
      'Switched Off': '#64748b',
      'DND': '#dc2626',
    }
    return colors[disposition] || '#6b7280'
  }

  if (loading) {
    return <div className="call-history-loading">Loading call history...</div>
  }

  if (calls.length === 0) {
    return (
      <div className="call-history-empty">
        <IconPhone size={32} opacity={0.4} />
        <p>No call history</p>
      </div>
    )
  }

  return (
    <div className="call-history-container">
      <h3 className="call-history-title">Call History</h3>
      <div className="call-history-list">
        {calls.map((call) => (
          <div key={call.id} className="call-history-item">
            <div
              className="call-history-header"
              onClick={() => setExpandedCall(expandedCall === call.id ? null : call.id)}
            >
              <div className="call-history-left">
                <div className="call-history-icon">
                  <IconPhone size={16} />
                </div>
                <div className="call-history-info">
                  <div className="call-history-time">
                    {formatDate(call.call_timestamp)}
                  </div>
                  <div className="call-history-duration">
                    <IconClock size={14} />
                    {formatTime(call.duration_seconds)}
                  </div>
                </div>
              </div>
              <div className="call-history-disposition">
                <span
                  className="disposition-badge"
                  style={{ backgroundColor: `${getDispositionColor(call.disposition)}20`, color: getDispositionColor(call.disposition) }}
                >
                  {call.disposition}
                </span>
              </div>
            </div>

            {expandedCall === call.id && (
              <div className="call-history-details">
                <div className="details-section">
                  <h4>Loan Details</h4>
                  <div className="loan-details">
                    {call.loan_details ? (
                      <>
                        <div className="detail-row">
                          <span className="detail-label">Loan Type:</span>
                          <span className="detail-value">{call.loan_details.loanType}</span>
                        </div>
                        {call.loan_details.salary && (
                          <div className="detail-row">
                            <span className="detail-label">Monthly Salary:</span>
                            <span className="detail-value">₹{Number(call.loan_details.salary).toLocaleString('en-IN')}</span>
                          </div>
                        )}
                        {call.loan_details.company && (
                          <div className="detail-row">
                            <span className="detail-label">Company:</span>
                            <span className="detail-value">{call.loan_details.company}</span>
                          </div>
                        )}
                        {call.loan_details.employmentType && (
                          <div className="detail-row">
                            <span className="detail-label">Employment Type:</span>
                            <span className="detail-value">{call.loan_details.employmentType}</span>
                          </div>
                        )}
                        {call.loan_details.personalLoan && (
                          <>
                            <div className="detail-row">
                              <span className="detail-label">Bank:</span>
                              <span className="detail-value">{call.loan_details.personalLoan.bankName}</span>
                            </div>
                            <div className="detail-row">
                              <span className="detail-label">Loan Amount:</span>
                              <span className="detail-value">₹{Number(call.loan_details.personalLoan.loanAmount).toLocaleString('en-IN')}</span>
                            </div>
                            <div className="detail-row">
                              <span className="detail-label">EMI Amount:</span>
                              <span className="detail-value">₹{Number(call.loan_details.personalLoan.emiAmount).toLocaleString('en-IN')}</span>
                            </div>
                          </>
                        )}
                      </>
                    ) : (
                      <p className="no-details">No loan details recorded</p>
                    )}
                  </div>
                </div>

                {call.notes && (
                  <div className="details-section">
                    <h4>
                      <IconNotes size={14} />
                      Notes
                    </h4>
                    <p className="call-notes-text">{call.notes}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
