// Shared click-to-call helper.
//
// Feature flag: REACT_APP_CLICK_TO_CALL (CRA env var, inlined at build time).
// - "true"  → Exotel: calls the `click-to-call` Supabase Edge Function, which
//             rings the agent's own mobile (profiles.mobile) first and then
//             connects them to the customer. No tel: links, no phone dialer.
// - anything else / missing (default) → the original tel: behaviour.
import React, { useState } from 'react'
import { supabase } from '../supabase'

export const CLICK_TO_CALL_ENABLED = process.env.REACT_APP_CLICK_TO_CALL === 'true'

// Opens the device dialer for a tel: link without navigating the SPA.
// (Original Dashboard handleCall behaviour.) Assigning window.location.href
// directly for tel: can, on a PC with no registered calling app or in some
// Android webview states, be treated as a real navigation that blanks/reloads
// the app; a throwaway <a> click lets the OS handle (or ignore) the link.
export function openTelDialer(phone) {
  try {
    const a = document.createElement('a')
    a.href = `tel:${phone}`
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  } catch (e) {
    window.location.href = `tel:${phone}`
  }
}

// A phone number shown as text. Flag off: the original tel: link. Flag on: plain text.
export function PhoneLink({ phone, style, children }) {
  if (!CLICK_TO_CALL_ENABLED) {
    return <a href={'tel:' + phone} style={style}>{children}</a>
  }
  return <span style={style}>{children}</span>
}

const SESSION_ENDED_MESSAGE = 'Your session has ended — please log in again.'

// One request to the function. Returns { ok, status, error, callSid, data }.
// `status` is the HTTP status for non-2xx responses (e.g. 401), otherwise null.
async function invokeClickToCall(customerPhone, leadId) {
  try {
    const { data, error } = await supabase.functions.invoke('click-to-call', {
      body: { customerPhone: String(customerPhone), leadId: leadId || undefined },
    })
    if (error) {
      // Non-2xx from the function: read its { error } message from the response body.
      const status = error.context?.status ?? null
      let message = error.message || 'Call failed.'
      try {
        const body = await error.context?.json?.()
        if (body?.error) message = body.error
      } catch (_) { /* body wasn't JSON — keep the generic message */ }
      return { ok: false, status, error: message }
    }
    if (!data?.ok) return { ok: false, status: null, error: data?.error || 'Call failed.' }
    return { ok: true, status: null, callSid: data.callSid || null, data }
  } catch (e) {
    return { ok: false, status: null, error: e?.message || 'Call failed.' }
  }
}

// Returns { ok: true, callSid, data } or { ok: false, error, signedOut? }. Never throws.
//
// A 401 means the function couldn't verify the session (e.g. this device still
// holds a token whose session was ended elsewhere). In that case only, refresh
// the session once and retry once. If the refresh fails, or the retry is still
// 401, the session is gone: sign out locally so the app returns to the login
// screen. Every other failure (400/403/404, Exotel errors, network) is returned
// as-is with no retry.
export async function placeExotelCall(customerPhone, leadId) {
  if (!customerPhone) return { ok: false, error: 'This lead has no mobile number.' }

  const first = await invokeClickToCall(customerPhone, leadId)
  if (first.ok || first.status !== 401) return first

  let refreshed = false
  try {
    const { data, error } = await supabase.auth.refreshSession()
    refreshed = !error && !!data?.session
  } catch (_) { /* treat as a failed refresh */ }

  if (refreshed) {
    const retry = await invokeClickToCall(customerPhone, leadId) // single retry, never loops
    if (retry.ok || retry.status !== 401) return retry
  }

  try { await supabase.auth.signOut({ scope: 'local' }) } catch (_) { /* already signed out */ }
  return { ok: false, signedOut: true, error: SESSION_ENDED_MESSAGE }
}

// Neutralises the browser's default <button> look so a former <a> keeps its
// own inline style. Not applied when a className is passed (e.g. "btn"), so the
// class's own padding/border still win.
const BUTTON_RESET = {
  background: 'none', border: 'none', padding: 0, margin: 0,
  font: 'inherit', color: 'inherit', cursor: 'pointer',
}

// Call button. Flag off: renders the original <a href="tel:…"> with the same
// className/style/handlers. Flag on: an Exotel <button> that
// - Shows `connectingLabel` (default "Connecting…") and disables itself while
//   the request is in flight; icon-only buttons pass a short label like "…".
// - On success shows `ringingLabel` for a few seconds (Exotel is now ringing
//   the agent's phone) and calls onCalled(result); alert()s the error on failure.
export function ExotelCallButton(props) {
  if (!CLICK_TO_CALL_ENABLED) {
    const { phone, className, style, title, children, ...rest } = props
    // Drop the Exotel-only props so they don't end up on the <a>.
    delete rest.leadId; delete rest.connectingLabel; delete rest.ringingLabel; delete rest.onCalled
    return (
      <a {...rest} href={'tel:' + phone} className={className} style={style} title={title}>
        {children}
      </a>
    )
  }
  return <ExotelButton {...props} />
}

function ExotelButton({
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
    let res
    try {
      res = await placeExotelCall(phone, leadId)
    } finally {
      setCalling(false) // back to the normal label in every outcome
    }
    if (!res.ok) { alert(res.signedOut ? res.error : 'Call failed: ' + res.error); return }
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
