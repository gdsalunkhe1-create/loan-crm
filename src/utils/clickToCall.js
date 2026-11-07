// Shared Exotel click-to-call helper.
// Calls the `click-to-call` Supabase Edge Function, which rings the agent's own
// mobile (profiles.mobile) first and then connects them to the customer.
// No tel: links, no phone dialer.
import React, { useState } from 'react'
import { supabase } from '../supabase'

// Returns { ok: true, callSid, data } or { ok: false, error }. Never throws.
export async function placeExotelCall(customerPhone, leadId) {
  if (!customerPhone) return { ok: false, error: 'This lead has no mobile number.' }
  try {
    const { data, error } = await supabase.functions.invoke('click-to-call', {
      body: { customerPhone: String(customerPhone), leadId: leadId || undefined },
    })
    if (error) {
      // Non-2xx from the function: read its { error } message from the response body.
      let message = error.message || 'Call failed.'
      try {
        const body = await error.context?.json?.()
        if (body?.error) message = body.error
      } catch (_) { /* body wasn't JSON — keep the generic message */ }
      return { ok: false, error: message }
    }
    if (!data?.ok) return { ok: false, error: data?.error || 'Call failed.' }
    return { ok: true, callSid: data.callSid || null, data }
  } catch (e) {
    return { ok: false, error: e?.message || 'Call failed.' }
  }
}

// Neutralises the browser's default <button> look so a former <a> keeps its
// own inline style. Not applied when a className is passed (e.g. "btn"), so the
// class's own padding/border still win.
const BUTTON_RESET = {
  background: 'none', border: 'none', padding: 0, margin: 0,
  font: 'inherit', color: 'inherit', cursor: 'pointer',
}

// Drop-in replacement for the old <a href={'tel:'+mobile}> call links.
// - Shows `connectingLabel` (default "Connecting…") and disables itself while
//   the request is in flight; icon-only buttons pass a short label like "…".
// - On success shows `ringingLabel` for a few seconds (Exotel is now ringing
//   the agent's phone) and calls onCalled(result); alert()s the error on failure.
export function ExotelCallButton({
  phone, leadId, className, style, title,
  connectingLabel = 'Connecting…', ringingLabel = 'Ringing your phone…',
  onCalled, children, ...rest
}) {
  const [calling, setCalling] = useState(false)
  const [ringing, setRinging] = useState(false)

  const handleClick = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (calling) return
    setCalling(true)
    const res = await placeExotelCall(phone, leadId)
    setCalling(false)
    if (!res.ok) { alert('Call failed: ' + res.error); return }
    setRinging(true)
    setTimeout(() => setRinging(false), 5000)
    if (onCalled) onCalled(res)
  }

  return (
    <button
      {...rest}
      type="button"
      className={className}
      style={{
        ...(className ? null : BUTTON_RESET),
        ...style,
        ...(calling ? { opacity: 0.6, cursor: 'wait' } : null),
      }}
      title={calling ? 'Connecting… answer your phone' : title}
      disabled={calling}
      onClick={handleClick}
    >
      {calling ? connectingLabel : ringing ? ringingLabel : children}
    </button>
  )
}
