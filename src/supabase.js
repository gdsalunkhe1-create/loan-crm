import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://pvnzeueldfmxhesmoetc.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2bnpldWVsZGZteGhlc21vZXRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NjAwNDQsImV4cCI6MjA5MzIzNjA0NH0.XyHJrRleVGuHQBCBxqvu3nmndGy3uIoBE3dBTRx63yI'
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2bnpldWVsZGZteGhlc21vZXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzY2MDA0NCwiZXhwIjoyMDkzMjM2MDQ0fQ.J7qjEpXnTlFvRJDM3uHG4JbPmFakaSFnu16mLtCvSdA'

export const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  global: {
    // Force every Supabase fetch to bypass browser HTTP cache and the PWA
    // service worker cache — prevents stale API responses on first load.
    fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }),
  },
})

export const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})
