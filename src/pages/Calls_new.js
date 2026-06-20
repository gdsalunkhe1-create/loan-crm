/* eslint-disable */
import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
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
          duration_seconds,
          disposition,
          connected,
          call_timestamp,
          leads(full_name, mobile)
        `)
        .eq('agent_id', userId)
        .order('call_timestamp', { ascending: false })
        .limit(10)

      if (data) setRecentCalls(data)
    } catch (error) {
      console.error('Error fetching calls:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  return (
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
                        {call.connected ? (
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
                          {formatDate(call.call_timestamp)}
                        </div>
                      </div>
                    </div>
                    <div className="call-item-right">
                      <div className="call-duration">
                        <IconClock size={16} />
                        {formatTime(call.duration_seconds)}
                      </div>
                      <span
                        className="disposition-badge"
                        style={{
                          backgroundColor: getDispositionColor(call.disposition) + '20',
                          color: getDispositionColor(call.disposition),
                        }}
                      >
                        {call.disposition}
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
  )
}

function getDispositionColor(disposition) {
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
