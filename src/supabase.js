import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://fuldzrvhyjwsrwtfpvae.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1bGR6cnZoeWp3c3J3dGZwdmFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNTg4NDIsImV4cCI6MjA5ODYzNDg0Mn0.v5smXL7APyasPIbZRHk3EnAZrfZKgZTXTRSdSZ1WE6E'

export const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }),
  },
})

const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1bGR6cnZoeWp3c3J3dGZwdmFlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzA1ODg0MiwiZXhwIjoyMDk4NjM0ODQyfQ.UXJsk0pNWWn6ItHVVsybv7Bky8hxE18LhGxZ54VWWm8'

export const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    storageKey: 'sb-admin-auth-token',
  },
})

// Auto-refresh session every 45 minutes — prevents JWT expired error
setInterval(async () => {
  const { error } = await supabase.auth.refreshSession()
  if (error) console.warn('[Session] Auto-refresh failed:', error.message)
}, 45 * 60 * 1000)