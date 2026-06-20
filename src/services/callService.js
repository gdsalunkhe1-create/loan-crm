/* eslint-disable */
import { supabase } from '../supabase'

/**
 * Save a call log to Supabase
 */
export const saveCallLog = async (callData) => {
  try {
    const { data, error } = await supabase.from('calls').insert([callData])
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('Error saving call log:', error)
    return { success: false, error }
  }
}

/**
 * Get call history for a lead
 */
export const getCallHistory = async (leadId) => {
  try {
    const { data, error } = await supabase
      .from('calls')
      .select('*')
      .eq('lead_id', leadId)
      .order('call_timestamp', { ascending: false })
    
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('Error fetching call history:', error)
    return { success: false, error }
  }
}

/**
 * Get call statistics for an agent
 */
export const getAgentCallStats = async (agentId, dateRange = 'today') => {
  try {
    const now = new Date()
    let startDate = new Date()

    if (dateRange === 'today') {
      startDate.setHours(0, 0, 0, 0)
    } else if (dateRange === 'week') {
      startDate.setDate(now.getDate() - now.getDay())
    } else if (dateRange === 'month') {
      startDate.setDate(1)
    }

    const { data, error } = await supabase
      .from('calls')
      .select('*')
      .eq('agent_id', agentId)
      .gte('call_timestamp', startDate.toISOString())

    if (error) throw error

    // Calculate statistics
    const stats = {
      totalCalls: data?.length || 0,
      totalDuration: data?.reduce((sum, call) => sum + (call.duration_seconds || 0), 0) || 0,
      connected: data?.filter((call) => call.connected).length || 0,
      notConnected: data?.filter((call) => !call.connected).length || 0,
      dispositions: {},
    }

    data?.forEach((call) => {
      stats.dispositions[call.disposition] = (stats.dispositions[call.disposition] || 0) + 1
    })

    return { success: true, data: stats }
  } catch (error) {
    console.error('Error fetching agent call stats:', error)
    return { success: false, error }
  }
}

/**
 * Get all agents call statistics
 */
export const getAllAgentsCallStats = async (dateRange = 'today') => {
  try {
    const now = new Date()
    let startDate = new Date()

    if (dateRange === 'today') {
      startDate.setHours(0, 0, 0, 0)
    } else if (dateRange === 'week') {
      startDate.setDate(now.getDate() - now.getDay())
    } else if (dateRange === 'month') {
      startDate.setDate(1)
    }

    const { data: callLogs, error: callError } = await supabase
      .from('calls')
      .select('*')
      .gte('call_timestamp', startDate.toISOString())

    if (callError) throw callError

    const { data: agents, error: agentError } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .in('role', ['agent', 'team_leader'])

    if (agentError) throw agentError

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
      agentStats[log.agent_id].totalDuration += log.duration_seconds || 0
      if (log.connected) {
        agentStats[log.agent_id].connected += 1
      } else {
        agentStats[log.agent_id].notConnected += 1
      }
      agentStats[log.agent_id].dispositions[log.disposition] = 
        (agentStats[log.agent_id].dispositions[log.disposition] || 0) + 1
    })

    const agentsWithStats = agents?.map((agent) => ({
      ...agent,
      ...agentStats[agent.id] || {
        totalCalls: 0,
        totalDuration: 0,
        connected: 0,
        notConnected: 0,
        dispositions: {},
      }
    })) || []

    return { success: true, data: agentsWithStats }
  } catch (error) {
    console.error('Error fetching all agents call stats:', error)
    return { success: false, error }
  }
}
