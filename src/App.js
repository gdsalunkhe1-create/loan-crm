/* eslint-disable */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { supabase } from './supabase'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import './App.css'

function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
  }, [])

  if (loading) return (
    <div style={{display:'flex',justifyContent:'center',alignItems:'center',height:'100vh',background:'#0D47A1'}}>
      <div style={{textAlign:'center',color:'white'}}>
        <div style={{fontSize:'48px',marginBottom:'16px'}}>📞</div>
        <div style={{fontSize:'20px',fontWeight:'700'}}>CALL-Q PRO CRM</div>
        <div style={{fontSize:'14px',opacity:0.7,marginTop:'8px'}}>Loading...</div>
      </div>
    </div>
  )

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={!session ? <Login /> : <Navigate to="/dashboard" />} />
        <Route path="/dashboard" element={session ? <Dashboard /> : <Navigate to="/login" />} />
        <Route path="*" element={<Navigate to={session ? "/dashboard" : "/login"} />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App