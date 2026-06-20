/* eslint-disable */
import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { IconPhone, IconClock, IconUsers, IconTrendingUp } from '@tabler/icons-react'
import './CallAnalyticsDashboard.css'

export default function CallAnalyticsDashboard() {
  const [analytics, setAnalytics] = useState({})
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [dateFilter, setDateFilter] = useState('today') // today, week, month

  useEffect(() => {
    fetchAnalytics()
  }, [dateFilter])

  const fetchAnalytics = async () => {
    setLoading(true)
    try {
      const now = new Date()
      let startDate = new Date()

      if (dateFilter === 'today') {
        startDate.setHours(0, 0, 0, 0)
      } else if (dateFilter === 'week') {
        startDate.setDate(now.getDate() - now.getDay())
      } else if (dateFilter === 'month') {
        startDate.setDate(1)
      }

      // Fetch call logs
      const { data: callLogs } = await supabase
        .from('calls')
        .select('agent_id, duration_seconds, disposition, connected, call_timestamp')
        .gte('call_timestamp', startDate.toISOString())

      // Group by agent
      const agentStats = {}
      callLogs?.forEach((log) => {
        if (!agentStats[log.agent_id]) {
          agentStats[log.agent_id] = {
            totalCalls: 0,
            totalDuration: 0,
            connected: 0,
            notConnected: 0,
            dispositions: {},
          }
        }
        agentStats[log.agent_id].totalCalls += 1
        agentStats[log.agent_id].totalDuration += log.duration_seconds
        if (log.connected) {
          agentStats[log.agent_id].connected += 1
        } else {
          agentStats[log.agent_id].notConnected += 1
        }
        agentStats[log.agent_id].dispositions[log.disposition] = 
          (agentStats[log.agent_id].dispositions[log.disposition] || 0) + 1
      })

      // Fetch agent names
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .in('role', ['agent', 'team_leader'])

      const agentsWithStats = profiles?.map((profile) => ({
        ...profile,
        ...agentStats[profile.id] || {
          totalCalls: 0,
          totalDuration: 0,
          connected: 0,
          notConnected: 0,
          dispositions: {},
        }
      })) || []

      setAgents(agentsWithStats)

      // Calculate overall analytics
      const overallStats = {
        totalCalls: callLogs?.length || 0,
        totalDuration: callLogs?.reduce((sum, log) => sum + log.duration_seconds, 0) || 0,
        connected: callLogs?.filter((log) => log.connected).length || 0,
        notConnected: callLogs?.filter((log) => !log.connected).length || 0,
      }

      setAnalytics(overallStats)
    } catch (error) {
      console.error('Error fetching analytics:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatTime = (seconds) => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    if (hours > 0) {
      return `${hours}h ${minutes}m`
    }
    return `${minutes}m`
  }

  const getConnectedRatio = () => {
    const total = analytics.connected + analytics.notConnected
    if (total === 0) return 0
    return Math.round((analytics.connected / total) * 100)
  }

  if (loading) {
    return <div className="analytics-loading">Loading analytics...</div>
  }

  return (
    <div className="call-analytics-container">
      <div className="analytics-header">
        <h2>Call Analytics Dashboard</h2>
        <div className="date-filter">
          <button
            className={`filter-btn ${dateFilter === 'today' ? 'active' : ''}`}
            onClick={() => setDateFilter('today')}
          >
            Today
          </button>
          <button
            className={`filter-btn ${dateFilter === 'week' ? 'active' : ''}`}
            onClick={() => setDateFilter('week')}
          >
            This Week
          </button>
          <button
            className={`filter-btn ${dateFilter === 'month' ? 'active' : ''}`}
            onClick={() => setDateFilter('month')}
          >
            This Month
          </button>
        </div>
      </div>

      {/* Overall Stats */}
      <div className="analytics-stats-grid">
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#dbeafe', color: '#0c7ad1' }}>
            <IconPhone size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-value">{analytics.totalCalls}</div>
            <div className="stat-label">Total Calls</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#fef3c7', color: '#f59e0b' }}>
            <IconClock size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-value">{formatTime(analytics.totalDuration)}</div>
            <div className="stat-label">Total Talk Time</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#d1fae5', color: '#10b981' }}>
            <IconTrendingUp size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-value">{getConnectedRatio()}%</div>
            <div className="stat-label">Connected Rate</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#fecaca', color: '#ef4444' }}>
            <IconUsers size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-value">{agents.length}</div>
            <div className="stat-label">Active Agents</div>
          </div>
        </div>
      </div>

      {/* Agent Performance Table */}
      <div className="analytics-section">
        <h3 className="section-title">Agent Performance</h3>
        <div className="agent-table-container">
          <table className="agent-table">
            <thead>
              <tr>
                <th>Agent Name</th>
                <th>Total Calls</th>
                <th>Total Talk Time</th>
                <th>Connected</th>
                <th>Not Connected</th>
                <th>Conversion Rate</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => {
                const interestRate = agent.totalCalls > 0
                  ? Math.round((agent.dispositions['Interested'] || 0) / agent.totalCalls * 100)
                  : 0
                return (
                  <tr key={agent.id}>
                    <td className="agent-name">
                      <div className="agent-avatar">{agent.full_name.charAt(0).toUpperCase()}</div>
                      {agent.full_name}
                    </td>
                    <td>{agent.totalCalls}</td>
                    <td>{formatTime(agent.totalDuration)}</td>
                    <td>
                      <span className="connected-badge">{agent.connected}</span>
                    </td>
                    <td>
                      <span className="not-connected-badge">{agent.notConnected}</span>
                    </td>
                    <td>
                      <span className="conversion-rate">{interestRate}%</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Disposition Summary */}
      {agents.length > 0 && (
        <div className="analytics-section">
          <h3 className="section-title">Disposition Summary</h3>
          <div className="disposition-summary">
            {['Ringing', 'Not Reachable', 'Switched Off', 'Voice Mail', 'Callback', 'Not Interested', 'Approved', 'Disbursed Other'].map((disposition) => {
              const count = agents.reduce((sum, agent) => sum + (agent.dispositions[disposition] || 0), 0)
              const percentage = analytics.totalCalls > 0 
                ? Math.round((count / analytics.totalCalls) * 100) 
                : 0
              
              return (
                <div key={disposition} className="disposition-item">
                  <div className="disposition-bar-container">
                    <div className="disposition-label">{disposition}</div>
                    <div className="disposition-bar-bg">
                      <div
                        className="disposition-bar-fill"
                        style={{
                          width: `${percentage}%`,
                          background: getDispositionColor(disposition),
                        }}
                      />
                    </div>
                  </div>
                  <div className="disposition-stats">
                    <span className="count">{count}</span>
                    <span className="percentage">{percentage}%</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
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
  return colors[disposition] || '#6b7280'
}
