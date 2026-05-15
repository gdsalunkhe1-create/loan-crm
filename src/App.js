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
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [showInstall, setShowInstall] = useState(false)
  const [showIOSInstall, setShowIOSInstall] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
  }, [])

  useEffect(() => {
    const userAgent = window.navigator.userAgent.toLowerCase()
    const isIOS = /iphone|ipad|ipod/.test(userAgent)
    const inStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true

    if (inStandalone) {
      return
    }

    if (isIOS) {
      setShowIOSInstall(true)
      return
    }

    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault()
      setDeferredPrompt(event)
      setShowInstall(true)
    }

    const handleAppInstalled = () => {
      setShowInstall(false)
      setShowIOSInstall(false)
      setDeferredPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const handleInstallClick = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const choiceResult = await deferredPrompt.userChoice
    if (choiceResult.outcome === 'accepted') {
      setShowInstall(false)
    }
    setDeferredPrompt(null)
  }

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
    <>
      {showInstall && (
        <div style={{position:'fixed',top:0,left:0,right:0,zIndex:9999,display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 14px',background:'#185FA5',color:'white',boxShadow:'0 4px 16px rgba(0,0,0,0.16)'}}>
          <div style={{fontSize:13,fontWeight:600}}>
            Install CALL-Q PRO CRM for a full-screen experience.
          </div>
          <button onClick={handleInstallClick} style={{border:'none',background:'white',color:'#185FA5',fontWeight:700,padding:'10px 14px',borderRadius:'8px',cursor:'pointer'}}>
            Install
          </button>
        </div>
      )}
      {showIOSInstall && (
        <div style={{position:'fixed',top:0,left:0,right:0,zIndex:9999,display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 14px',background:'#111827',color:'white',boxShadow:'0 4px 16px rgba(0,0,0,0.16)'}}>
          <div style={{fontSize:13,fontWeight:600}}>
            Add CALL-Q PRO CRM to your Home Screen: tap Share then Add to Home Screen.
          </div>
          <button onClick={() => setShowIOSInstall(false)} style={{border:'none',background:'white',color:'#111827',fontWeight:700,padding:'10px 14px',borderRadius:'8px',cursor:'pointer'}}>
            Dismiss
          </button>
        </div>
      )}
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={!session ? <Login /> : <Navigate to="/dashboard" />} />
          <Route path="/dashboard" element={session ? <Dashboard /> : <Navigate to="/login" />} />
          <Route path="*" element={<Navigate to={session ? "/dashboard" : "/login"} />} />
        </Routes>
      </BrowserRouter>
    </>
  )
}

export default App