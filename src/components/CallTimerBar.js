/* eslint-disable */
import { useContext } from 'react'
import { CallContext } from '../context/CallContext'
import { IconPhone, IconPhoneOff } from '@tabler/icons-react'
import './CallTimerBar.css'

export default function CallTimerBar() {
  const { callActive, callData, endCall, markNotConnected } = useContext(CallContext)

  if (!callActive) return null

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  return (
    <div className="call-timer-bar">
      <div className="call-timer-left">
        <div className="call-pulsing-dot"></div>
        <div className="call-info">
          <div className="call-lead-name">{callData.leadName}</div>
          <div className="call-phone">{callData.phoneNumber}</div>
        </div>
      </div>

      <div className="call-timer-center">
        <div className="call-timer-display">
          {formatTime(callData.duration)}
        </div>
        <div className="call-status">Call in Progress</div>
      </div>

      <div className="call-timer-right">
        <button className="call-btn not-connected-btn" onClick={markNotConnected}>
          Not Connected
        </button>
        <button className="call-btn end-call-btn" onClick={endCall}>
          <IconPhoneOff size={18} />
          End Call
        </button>
      </div>
    </div>
  )
}
