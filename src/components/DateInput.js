import React, { useState, useEffect, useRef, useCallback } from 'react'
import { IconCalendar, IconChevronLeft, IconChevronRight } from '@tabler/icons-react'

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const WEEKDAY_LABELS = ['Su','Mo','Tu','We','Th','Fr','Sa']
const LAYOUT_KEYS = ['flex','flexGrow','flexShrink','flexBasis','width','minWidth','maxWidth','margin','marginTop','marginBottom','marginLeft','marginRight','alignSelf']

const pad2 = n => String(n).padStart(2, '0')
const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function isoToParts(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  if (!m) return null
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) }
}

// Display format is always DD-MM-YYYY, independent of browser/OS locale.
function isoToDisplay(iso) {
  const p = isoToParts(iso)
  return p ? `${pad2(p.d)}-${pad2(p.mo)}-${p.y}` : ''
}

function displayToIso(display) {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(display || '')
  if (!m) return null
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3])
  if (mo < 1 || mo > 12 || y < 1000) return null
  const daysInMonth = new Date(y, mo, 0).getDate()
  if (d < 1 || d > daysInMonth) return null
  return `${y}-${pad2(mo)}-${pad2(d)}`
}

function formatTyping(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (digits.length > 4) return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`
  if (digits.length > 2) return `${digits.slice(0, 2)}-${digits.slice(2)}`
  return digits
}

// Layout props (flex/width/margin/...) must live on the wrapper div so call
// sites that pass e.g. {flex:1} or {flexShrink:0} for the old native input
// still lay out correctly; everything else styles the visible text input.
function splitStyle(style) {
  const layout = {}, visual = {}
  Object.keys(style || {}).forEach(k => {
    if (LAYOUT_KEYS.includes(k)) layout[k] = style[k]
    else visual[k] = style[k]
  })
  return { layout, visual }
}

const navBtnStyle = { background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', padding: 4, display: 'flex' }

// Drop-in replacement for <input type="date">. Displays/accepts DD-MM-YYYY
// text regardless of browser/OS locale, but value/onChange still use the
// native YYYY-MM-DD (ISO) string so existing filter logic and Supabase
// queries don't need to change.
export default function DateInput({ value, onChange, min, max, style, className, placeholder, disabled, onFocus, onBlur, name }) {
  const [text, setText] = useState(() => isoToDisplay(value))
  const [open, setOpen] = useState(false)
  const [viewYear, setViewYear] = useState(() => (isoToParts(value) || isoToParts(todayIso())).y)
  const [viewMonth, setViewMonth] = useState(() => (isoToParts(value) || isoToParts(todayIso())).mo - 1)
  const wrapRef = useRef(null)

  useEffect(() => {
    setText(isoToDisplay(value))
  }, [value])

  useEffect(() => {
    if (!open) return undefined
    const handleClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    const handleKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const emit = useCallback((iso) => {
    if (onChange) onChange({ target: { value: iso, name } })
  }, [onChange, name])

  const openPicker = () => {
    if (disabled) return
    const p = isoToParts(value) || isoToParts(todayIso())
    setViewYear(p.y)
    setViewMonth(p.mo - 1)
    setOpen(o => !o)
  }

  const handleTextChange = (e) => {
    const formatted = formatTyping(e.target.value)
    setText(formatted)
    if (formatted.length === 0) { emit(''); return }
    if (formatted.length === 10) {
      const iso = displayToIso(formatted)
      if (iso && (!min || iso >= min) && (!max || iso <= max)) emit(iso)
    }
  }

  const handleTextBlur = (e) => {
    const iso = displayToIso(text)
    if (!iso || (min && iso < min) || (max && iso > max)) {
      setText(isoToDisplay(value))
    }
    if (onBlur) onBlur(e)
  }

  const selectDay = (d) => {
    const iso = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(d)}`
    if ((min && iso < min) || (max && iso > max)) return
    emit(iso)
    setText(isoToDisplay(iso))
    setOpen(false)
  }

  const changeMonth = (delta) => {
    let m = viewMonth + delta, y = viewYear
    if (m < 0) { m = 11; y -= 1 }
    if (m > 11) { m = 0; y += 1 }
    setViewMonth(m)
    setViewYear(y)
  }

  const { layout, visual } = splitStyle(style)
  const selected = isoToParts(value)
  const firstDow = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  return (
    <div ref={wrapRef} className={className} style={{ position: 'relative', display: 'inline-block', ...layout }}>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder || 'DD-MM-YYYY'}
        value={text}
        disabled={disabled}
        name={name}
        maxLength={10}
        onChange={handleTextChange}
        onBlur={handleTextBlur}
        onFocus={onFocus}
        style={{ ...visual, width: '100%', boxSizing: 'border-box', paddingRight: 28 }}
      />
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled}
        tabIndex={-1}
        aria-label="Open calendar"
        style={{
          position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
          background: 'none', border: 'none', padding: 2, margin: 0, cursor: disabled ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', color: '#6B7280', lineHeight: 0
        }}
      >
        <IconCalendar size={15} stroke={1.8} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 1000,
          background: 'white', border: '1px solid #E2E8F0', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)', padding: 10, width: 220
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <button type="button" onClick={() => changeMonth(-1)} style={navBtnStyle}><IconChevronLeft size={14} /></button>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{MONTH_NAMES[viewMonth]} {viewYear}</div>
            <button type="button" onClick={() => changeMonth(1)} style={navBtnStyle}><IconChevronRight size={14} /></button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 4 }}>
            {WEEKDAY_LABELS.map(w => (
              <div key={w} style={{ fontSize: 10, color: '#9CA3AF', textAlign: 'center', fontWeight: 600 }}>{w}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
            {cells.map((d, i) => {
              if (d === null) return <div key={i} />
              const iso = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(d)}`
              const isDisabled = (min && iso < min) || (max && iso > max)
              const isSelected = selected && selected.y === viewYear && selected.mo === viewMonth + 1 && selected.d === d
              return (
                <button
                  key={i}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => selectDay(d)}
                  style={{
                    padding: '5px 0', fontSize: 12, border: 'none', borderRadius: 5,
                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                    background: isSelected ? '#185FA5' : 'transparent',
                    color: isDisabled ? '#D1D5DB' : (isSelected ? 'white' : '#374151'),
                    fontWeight: isSelected ? 600 : 400
                  }}
                >{d}</button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
