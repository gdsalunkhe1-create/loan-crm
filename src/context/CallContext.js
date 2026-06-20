/* eslint-disable */
import { createContext, useState, useCallback, useRef, useEffect } from 'react'

export const CallContext = createContext()

export function CallProvider({ children }) {
  const [callActive, setCallActive] = useState(false)
  const [callData, setCallData] = useState({
    leadId: null,
    leadName: '',
    phoneNumber: '',
    startTime: null,
    duration: 0,
  })
  const [showCallForm, setShowCallForm] = useState(false)
  const [callFormData, setCallFormData] = useState({})
  const timerRef = useRef(null)
  // Tracks whether a call was actually started — prevents endCall from opening
  // the form unless the agent truly initiated a call via startCall.
  const callWasStartedRef = useRef(false)

  // Start a call
  const startCall = useCallback((leadId, leadName, phoneNumber) => {
    callWasStartedRef.current = true
    setCallActive(true)
    setCallData({
      leadId,
      leadName,
      phoneNumber,
      startTime: Date.now(),
      duration: 0,
    })
  }, [])

  // Update duration
  useEffect(() => {
    if (callActive) {
      timerRef.current = setInterval(() => {
        setCallData(prev => ({
          ...prev,
          duration: Math.floor((Date.now() - prev.startTime) / 1000)
        }))
      }, 1000)
      return () => clearInterval(timerRef.current)
    }
  }, [callActive])

  // End call and show form — only opens the summary if a call was actually started
  const endCall = useCallback(() => {
    if (!callWasStartedRef.current) return
    callWasStartedRef.current = false
    setCallActive(false)
    setShowCallForm(true)
  }, [])

  // Mark not connected — clears call state without showing form
  const markNotConnected = useCallback(() => {
    callWasStartedRef.current = false
    setCallActive(false)
    setCallData({ leadId: null, leadName: '', phoneNumber: '', startTime: null, duration: 0 })
  }, [])

  // Close call form and reset all state
  const closeCallForm = useCallback(() => {
    callWasStartedRef.current = false
    setShowCallForm(false)
    setCallActive(false)
    setCallData({ leadId: null, leadName: '', phoneNumber: '', startTime: null, duration: 0 })
    setCallFormData({})
  }, [])

  return (
    <CallContext.Provider
      value={{
        callActive,
        callData,
        showCallForm,
        callFormData,
        setCallFormData,
        startCall,
        endCall,
        markNotConnected,
        closeCallForm,
      }}
    >
      {children}
    </CallContext.Provider>
  )
}
