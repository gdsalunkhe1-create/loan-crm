/* eslint-disable */
import React, { useState, useEffect } from 'react'
import { supabase } from '../supabase'

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null } }
  static getDerivedStateFromError(e) { return { hasError: true, error: e.message } }
  componentDidCatch(e, info) { console.error('Error:', e, info) }
  render() {
    if (this.state.hasError) return (
      <div style={{padding:40,textAlign:'center',background:'white',borderRadius:12,border:'1px solid #fecaca',margin:20}}>
        <div style={{fontSize:28,marginBottom:10}}>⚠️</div>
        <div style={{fontSize:16,fontWeight:700,color:'#dc2626',marginBottom:6}}>Something went wrong</div>
        <div style={{fontSize:13,color:'#6b7280',marginBottom:16}}>{this.state.error}</div>
        <button onClick={()=>this.setState({hasError:false,error:null})} style={{padding:'7px 18px',background:'#185FA5',color:'white',border:'none',borderRadius:8,cursor:'pointer',marginRight:8}}>Try Again</button>
        <button onClick={()=>window.location.reload()} style={{padding:'7px 18px',background:'white',color:'#185FA5',border:'1px solid #185FA5',borderRadius:8,cursor:'pointer'}}>Reload</button>
      </div>
    )
    return this.props.children
  }
}
import { IconPhoneIncoming, IconPhoneOff, IconClock, IconUserCheck } from '@tabler/icons-react'
import CallAnalyticsDashboard from '../components/CallAnalyticsDashboard'
import './Calls.css'

export default function Calls({ userRole, userId }) {
  const [recentCalls, setRecentCalls] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchRecentCalls()
  }, [])

  const fetchRecentCalls = async () => {
    try {
      const { data } = await supabase
        .from('calls')
        .select(`
          id,
          duration,
          call_outcome,
          notes,
          created_at,
          leads(id, full_name, mobile)
        `)
        .eq('agent_id', userId)
        .order('created_at', { ascending: false })
        .limit(20)

      if (data) setRecentCalls(data)
    } catch (error) {
      console.error('Error fetching calls:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (timestamp) => {
    if (!timestamp) return '—'
    return new Date(timestamp).toLocaleString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    })
  }

  const formatDuration = (minutes) => {
    if (!minutes) return '0 min'
    return `${Math.floor(minutes)} min`
  }

  return (
    <ErrorBoundary>
    <div className="calls-page">
      <div className="calls-header">
        <h1>Call Management</h1>
        <p>Manage and track all your call activities</p>
      </div>

      {/* Show analytics for managers/admins */}
      {userRole === 'manager' || userRole === 'admin' ? (
        <CallAnalyticsDashboard />
      ) : (
        <div className="calls-content">
          {/* Your Recent Calls Section */}
          <div className="recent-calls-section">
            <h2>Your Recent Calls</h2>
            {loading ? (
              <div className="loading">Loading calls...</div>
            ) : recentCalls.length === 0 ? (
              <div className="empty-state">
                <IconPhoneIncoming size={40} opacity={0.4} />
                <p>No calls yet</p>
              </div>
            ) : (
              <div className="calls-list">
                {recentCalls.map((call) => (
                  <div key={call.id} className="call-item">
                    <div className="call-item-left">
                      <div className="call-icon">
                        {call.call_outcome ? (
                          <IconUserCheck size={20} />
                        ) : (
                          <IconPhoneOff size={20} />
                        )}
                      </div>
                      <div className="call-details">
                        <div className="call-lead">
                          {call.leads?.full_name || 'Unknown Lead'}
                        </div>
                        <div className="call-time">
                          {formatDate(call.created_at)}
                        </div>
                      </div>
                      {call.leads?.mobile && (
                        <div style={{marginLeft:12,display:'flex',alignItems:'center',gap:8}}>
                          <span style={{fontSize:13,color:'#4B5563'}}>{call.leads.mobile}</span>
                        </div>
                      )}
                    </div>
                    <div className="call-item-right">
                      <div className="call-duration">
                        <IconClock size={16} />
                        {formatDuration(call.duration)}
                      </div>
                      <span
                        className="disposition-badge"
                        style={{
                          backgroundColor: getDispositionColor(call.call_outcome) + '20',
                          color: getDispositionColor(call.call_outcome),
                        }}
                      >
                        {call.call_outcome || '—'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
    </ErrorBoundary>
  )
}

function getDispositionColor(disposition) {
  const colors = {
    'Ringing': '#534AB7',
    'Not Reachable': '#92400E',
    'Switched Off': '#6B7280',
    'Voice Mail': '#0E7490',
    'Callback': '#854F0B',
    'Not Interested': '#791F1F',
    'Approved': '#27500A',
    'Disbursed Other': '#065F46',
  }
  return colors[disposition] || '#64748b'
}
