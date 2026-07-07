import React, { useState, useEffect, useCallback } from 'react'

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

function displayToParts(display) {
  const m = /^(\d{2}):(\d{2})$/.exec(display || '')
  if (!m) return null
  const h12 = Number(m[1]), mm = Number(m[2])
  if (h12 < 1 || h12 > 12 || mm > 59) return null
  return { h12, mm }
}

function formatTyping(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 4)
  if (digits.length > 2) return `${digits.slice(0, 2)}:${digits.slice(2)}`
  return digits
}

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
// don't need to change.
export default function TimeInput({ value, onChange, style, className, placeholder, disabled, onFocus, onBlur, name }) {
  const [text, setText] = useState(() => { const p = to12(value); return p ? partsToDisplay(p.h12, p.mm) : '' })
  const [ampm, setAmpm] = useState(() => { const p = to12(value); return p ? p.ampm : 'AM' })

  useEffect(() => {
    const p = to12(value)
    setText(p ? partsToDisplay(p.h12, p.mm) : '')
    setAmpm(p ? p.ampm : 'AM')
  }, [value])

  const emit = useCallback((iso) => {
    if (onChange) onChange({ target: { value: iso, name } })
  }, [onChange, name])

  const handleTextChange = (e) => {
    const formatted = formatTyping(e.target.value)
    setText(formatted)
    if (formatted.length === 0) { emit(''); return }
    if (formatted.length === 5) {
      const p = displayToParts(formatted)
      if (p) emit(to24(p.h12, p.mm, ampm))
    }
  }

  const handleTextBlur = (e) => {
    const p = displayToParts(text)
    if (!p) {
      const cur = to12(value)
      setText(cur ? partsToDisplay(cur.h12, cur.mm) : '')
    }
    if (onBlur) onBlur(e)
  }

  const selectAmpm = (next) => {
    if (disabled || next === ampm) return
    setAmpm(next)
    const p = displayToParts(text)
    if (p) emit(to24(p.h12, p.mm, next))
  }

  const { layout, visual } = splitStyle(style)
  const { padding, ...restVisual } = visual

  const ampmBtnStyle = (active) => ({
    padding: '0 8px', fontSize: 11, fontWeight: 700, border: 'none',
    cursor: disabled ? 'default' : 'pointer',
    background: active ? '#185FA5' : 'transparent', color: active ? 'white' : '#6B7280'
  })

  return (
    <div className={className} style={{
      display: 'inline-flex', alignItems: 'stretch', boxSizing: 'border-box',
      border: '1.5px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', background: 'white',
      opacity: disabled ? 0.6 : 1,
      ...layout, ...restVisual, padding: 0
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
        onFocus={onFocus}
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
  )
}
