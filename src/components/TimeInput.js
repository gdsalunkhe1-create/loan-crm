import React, { useState, useEffect, useCallback, useRef } from 'react'

const pad2 = n => String(n).padStart(2, '0')
const LAYOUT_KEYS = ['flex','flexGrow','flexShrink','flexBasis','width','minWidth','maxWidth','margin','marginTop','marginBottom','marginLeft','marginRight','alignSelf']

function isoToParts24(iso) {
  const m = /^(\d{2}):(\d{2})$/.exec(iso || '')
  if (!m) return null
  const hh = Number(m[1]), mm = Number(m[2])
  if (hh > 23 || mm > 59) return null
  return { hh, mm }
}

// 24-hour "HH:MM" -> { h12, mm, ampm }
function to12(iso) {
  const p = isoToParts24(iso)
  if (!p) return null
  const ampm = p.hh < 12 ? 'AM' : 'PM'
  let h12 = p.hh % 12
  if (h12 === 0) h12 = 12
  return { h12, mm: p.mm, ampm }
}

// (h12, mm, ampm) -> 24-hour "HH:MM"
function to24(h12, mm, ampm) {
  let hh = h12 % 12
  if (ampm === 'PM') hh += 12
  return `${pad2(hh)}:${pad2(mm)}`
}

function partsToDisplay(h12, mm) {
  return `${pad2(h12)}:${pad2(mm)}`
}

// Lenient 12-hour parse so agents never have to type a leading zero:
//   1 / 9 / 12        -> hour only        (01:00, 09:00, 12:00)
//   130 / 945         -> H + MM           (01:30, 09:45)
//   1130 / 0130       -> HH + MM          (11:30, 01:30)
//   1:30 / 1.30 / 1 30 -> separated       (01:30)
// Hours must be 1-12 and minutes 0-59; anything else is null.
export function parseTime12(raw) {
  const s = (raw || '').trim()
  let h, mm
  let m = /^(\d{1,2})\s*[:. ]\s*(\d{1,2})$/.exec(s)
  if (m) { h = m[1]; mm = m[2] }
  else if ((m = /^\d{1,4}$/.exec(s))) {
    if (s.length <= 2) { h = s; mm = '0' }
    else if (s.length === 3) { h = s.slice(0, 1); mm = s.slice(1) }
    else { h = s.slice(0, 2); mm = s.slice(2) }
  } else return null
  const h12 = Number(h), min = Number(mm)
  if (h12 < 1 || h12 > 12 || min > 59) return null
  return { h12, mm: min }
}

const cleanTyping = raw => raw.replace(/[^\d:. ]/g, '').slice(0, 5)

// Layout props (flex/width/margin/...) must live on the wrapper div so call
// sites that pass e.g. {width:'100%'} for the old native input still lay
// out correctly; padding lives on the inner text input; everything else
// visual (border/radius/fontSize/...) frames the whole control.
function splitStyle(style) {
  const layout = {}, visual = {}
  Object.keys(style || {}).forEach(k => {
    if (LAYOUT_KEYS.includes(k)) layout[k] = style[k]
    else visual[k] = style[k]
  })
  return { layout, visual }
}

// Drop-in replacement for <input type="time">. Displays/accepts 12-hour
// HH:MM text with an explicit AM/PM toggle, but value/onChange still use
// the native 24-hour HH:MM string so existing logic and Supabase queries
// don't need to change. Text that isn't a valid time emits '' (so callers'
// "time required" checks block saving) and shows an inline error on blur.
// `error` is an optional caller-supplied message (e.g. "already passed")
// shown in the same slot; it's hidden while focused so it doesn't flicker
// as the agent types.
export default function TimeInput({ value, onChange, style, className, placeholder, disabled, onFocus, onBlur, name, error }) {
  const [text, setText] = useState(() => { const p = to12(value); return p ? partsToDisplay(p.h12, p.mm) : '' })
  const [ampm, setAmpm] = useState(() => { const p = to12(value); return p ? p.ampm : 'AM' })
  const [invalid, setInvalid] = useState(false)
  const [focused, setFocused] = useState(false)
  // Last value we emitted ourselves — when it echoes back via `value`, don't
  // overwrite what the agent is mid-way through typing (e.g. "1" -> "130").
  const lastEmitted = useRef(value)

  useEffect(() => {
    if (value === lastEmitted.current) return
    lastEmitted.current = value
    const p = to12(value)
    setText(p ? partsToDisplay(p.h12, p.mm) : '')
    setAmpm(p ? p.ampm : 'AM')
    setInvalid(false)
  }, [value])

  const emit = useCallback((iso) => {
    lastEmitted.current = iso
    if (onChange) onChange({ target: { value: iso, name } })
  }, [onChange, name])

  const handleTextChange = (e) => {
    const typed = cleanTyping(e.target.value)
    setText(typed)
    setInvalid(false)
    const p = parseTime12(typed)
    emit(p ? to24(p.h12, p.mm, ampm) : '')
  }

  const handleTextBlur = (e) => {
    const p = parseTime12(text)
    if (p) {
      setText(partsToDisplay(p.h12, p.mm))
      emit(to24(p.h12, p.mm, ampm))
    }
    setInvalid(!p && text.trim() !== '')
    setFocused(false)
    if (onBlur) onBlur(e)
  }

  const selectAmpm = (next) => {
    if (disabled || next === ampm) return
    setAmpm(next)
    const p = parseTime12(text)
    if (p) emit(to24(p.h12, p.mm, next))
  }

  const { layout, visual } = splitStyle(style)
  const { padding, ...restVisual } = visual

  const ampmBtnStyle = (active) => ({
    padding: '0 8px', fontSize: 11, fontWeight: 700, border: 'none',
    cursor: disabled ? 'default' : 'pointer',
    background: active ? '#185FA5' : 'transparent', color: active ? 'white' : '#6B7280'
  })

  const message = disabled ? null : invalid ? 'Enter a valid time, e.g. 1:30' : (!focused && error) || null

  return (
    <div className={className} style={{ display: 'inline-flex', flexDirection: 'column', boxSizing: 'border-box', ...layout }}>
    <div style={{
      display: 'flex', alignItems: 'stretch', boxSizing: 'border-box',
      border: '1.5px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', background: 'white',
      opacity: disabled ? 0.6 : 1,
      ...restVisual, ...(message ? { borderColor: '#DC2626' } : null), padding: 0
    }}>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder || 'HH:MM'}
        value={text}
        disabled={disabled}
        name={name}
        maxLength={5}
        onChange={handleTextChange}
        onBlur={handleTextBlur}
        onFocus={e => { setFocused(true); if (onFocus) onFocus(e) }}
        style={{
          flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
          font: 'inherit', color: 'inherit', padding: padding || '9px 10px', boxSizing: 'border-box'
        }}
      />
      <div style={{ display: 'flex', flexShrink: 0, borderLeft: '1.5px solid #E2E8F0' }}>
        <button type="button" disabled={disabled} onClick={() => selectAmpm('AM')} style={ampmBtnStyle(ampm === 'AM')}>AM</button>
        <button type="button" disabled={disabled} onClick={() => selectAmpm('PM')} style={ampmBtnStyle(ampm === 'PM')}>PM</button>
      </div>
    </div>
    {message && <div style={{ color: '#DC2626', fontSize: 12, marginTop: 4 }}>{message}</div>}
    </div>
  )
}
