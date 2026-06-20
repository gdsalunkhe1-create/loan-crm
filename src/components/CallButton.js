/* eslint-disable */
import { useContext } from 'react'
import { CallContext } from '../context/CallContext'
import { IconPhone } from '@tabler/icons-react'
import './CallButton.css'

export default function CallButton({ phoneNumber, leadName, leadId, size = 'sm' }) {
  const { startCall } = useContext(CallContext)

  const handleCall = () => {
    startCall(leadId, leadName, phoneNumber)
  }

  const sizeClass = {
    xs: 'call-btn-xs',
    sm: 'call-btn-sm',
    md: 'call-btn-md',
    lg: 'call-btn-lg',
  }[size] || 'call-btn-sm'

  return (
    <button
      className={`call-button ${sizeClass}`}
      onClick={handleCall}
      title={`Call ${leadName} at ${phoneNumber}`}
    >
      <IconPhone size={size === 'xs' ? 14 : size === 'sm' ? 16 : size === 'md' ? 18 : 20} />
      {size !== 'xs' && 'Call'}
    </button>
  )
}
