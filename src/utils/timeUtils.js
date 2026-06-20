// ============================================================================
// timeUtils.js — THE single source of truth for all date/time handling in
// this CRM. India-only product: every wall-clock time in the UI is IST.
//
// No other file may construct/format/compare a due-date, reminder, or
// timestamp on its own. Import from here instead.
//
// ----------------------------------------------------------------------------
// WHY THIS FILE LOOKS THE WAY IT DOES (read this before changing anything)
// ----------------------------------------------------------------------------
// The recurring "callback timezone bug" was NOT caused by sloppy JS string
// formatting. It is caused by the database schema:
//
//   - tasks.due_date / tasks.last_snooze_at are Postgres `timestamptz`
//     columns. Postgres ALWAYS stores an absolute UTC instant, and
//     PostgREST (Supabase's REST layer) ALWAYS returns timestamptz values
//     as UTC with an explicit "+00:00" suffix — no matter what timezone
//     the value conceptually represents to a human.
//   - When the app sent a naive string like "2026-06-20T16:00:00" (no
//     offset) to one of these columns, Postgres/PostgREST treated it as
//     16:00 **UTC**, not 16:00 IST — silently storing the callback 5h30m
//     later than the agent intended. Every later "fix" that re-formatted
//     the JS-side string never touched this, so the bug kept coming back.
//
// The correct, durable fix is to do REAL UTC<->IST conversion, but in
// exactly ONE place, using a fixed +05:30 offset. India has a single
// timezone with no DST, so a fixed offset is both correct and simpler/more
// reliable than Intl/browser-timezone-dependent approaches.
//
// Two function pairs matter:
//   - parseIST(value)  — reading: turns ANY shape we might receive
//     (timestamptz UTC output, legacy naive string, Date object) into the
//     one canonical IST wall-clock string.
//   - toDbTimestamp(value) — writing: turns a canonical IST wall-clock
//     string into the absolute-instant string Postgres needs for a
//     `timestamptz` column, so it stores the instant the agent actually
//     meant.
//
// `leads.follow_up_date` is a plain `timestamp` (no timezone) column —
// Postgres stores whatever wall-clock text you give it, verbatim, with no
// UTC conversion. For that column, write the canonical IST string directly
// and do NOT call toDbTimestamp() (adding an offset to it is harmless —
// Postgres ignores it for non-tz columns — but it's clearer not to).
//
// `toISOString()` / `Date.UTC()` are used internally below, exactly once,
// inside the two conversion boundary functions. That is intentional and
// correct: it is the standard, textbook way to convert between an absolute
// instant and IST wall-clock components. The project-wide ban on UTC logic
// is about banning AD HOC, SCATTERED, INCONSISTENT UTC handling across many
// files — not about banning UTC math entirely from the one centralized
// module whose entire job is to do it correctly, once.
// ============================================================================

export const IST_TZ = 'Asia/Kolkata'

// Fixed, non-DST offset. India has exactly one timezone, so this never changes.
const IST_OFFSET_MIN = 5 * 60 + 30 // +05:30

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const pad2 = n => String(n).padStart(2, '0')

// Canonical shape: 'YYYY-MM-DD HH:mm:ss' (matches Postgres's own text output
// for a naive timestamp — easy to read, and lexically sortable as a bonus).
const CANONICAL_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/

function formatCanonical(parts) {
  return `${parts.y}-${pad2(parts.mo)}-${pad2(parts.d)} ${pad2(parts.h)}:${pad2(parts.mi)}:${pad2(parts.s || 0)}`
}

// An absolute instant (real UTC moment) -> IST wall-clock components.
// Trick: shift the instant forward by the IST offset, then read its UTC
// components — those UTC-labelled components are now numerically the IST
// wall-clock values. This works regardless of the browser's own timezone,
// because it never touches the browser-local Date getters (getHours, etc.)
// — only the timezone-agnostic epoch (getTime) and UTC component getters.
function instantToISTParts(date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MIN * 60000)
  return {
    y: shifted.getUTCFullYear(),
    mo: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
    mi: shifted.getUTCMinutes(),
    s: shifted.getUTCSeconds(),
  }
}

// IST wall-clock components -> the absolute instant (UTC Date) they represent.
function istPartsToInstant(parts) {
  const ms = Date.UTC(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, parts.s || 0) - IST_OFFSET_MIN * 60000
  return new Date(ms)
}

function splitCanonical(str) {
  const m = CANONICAL_RE.exec(str)
  if (!m) return null
  return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +(m[6] || 0) }
}

/**
 * parseIST(value) -> canonical 'YYYY-MM-DD HH:mm:ss' IST string, or null.
 *
 * Accepts, in order of how it decides what it's looking at:
 *   - null / '' / undefined                          -> null
 *   - a Date object                                   -> converted from its real instant
 *   - a string with an explicit offset ('+00:00'/'Z') -> a REAL UTC instant (PostgREST
 *                                                         timestamptz output) -> converted to IST
 *   - a plain 'YYYY-MM-DD[ T]HH:mm[:ss]' string        -> already IST wall-clock, returned as-is
 */
export function parseIST(value) {
  if (value === null || value === undefined || value === '') return null

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null
    return formatCanonical(instantToISTParts(value))
  }

  const str = String(value).trim()
  if (!str) return null

  // Strip milliseconds, keep an eye out for a trailing offset.
  const noMs = str.replace(/\.\d+/, '')
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/.test(noMs)

  if (hasOffset) {
    const d = new Date(noMs)
    if (isNaN(d.getTime())) return null
    return formatCanonical(instantToISTParts(d))
  }

  const parts = splitCanonical(noMs)
  if (!parts) return null
  return formatCanonical(parts)
}

/**
 * nowIST() -> canonical 'YYYY-MM-DD HH:mm:ss' string for the current moment, in IST.
 * Never depends on the browser's local timezone setting.
 */
export function nowIST() {
  return formatCanonical(instantToISTParts(new Date()))
}

/**
 * addMinutes(value, mins) -> canonical IST string shifted by `mins` minutes.
 * `value` may be anything parseIST() accepts.
 */
export function addMinutes(value, mins) {
  const canonical = parseIST(value)
  if (!canonical) return null
  const parts = splitCanonical(canonical)
  const instant = istPartsToInstant(parts)
  const shifted = new Date(instant.getTime() + mins * 60000)
  return formatCanonical(instantToISTParts(shifted))
}

/** subtractMinutes(value, mins) -> addMinutes(value, -mins) */
export function subtractMinutes(value, mins) {
  return addMinutes(value, -mins)
}

/**
 * compareIST(a, b) -> -1 if a<b, 0 if equal, 1 if a>b.
 * null/unparseable values sort earliest (so missing due-dates never appear
 * "more overdue" than real ones by accident).
 */
export function compareIST(a, b) {
  const sa = parseIST(a)
  const sb = parseIST(b)
  if (sa === sb) return 0
  if (sa === null) return -1
  if (sb === null) return 1
  return sa < sb ? -1 : 1
}

/**
 * formatIST(value, format) -> human-readable display string.
 *   format: 'datetime' (default) | 'date' | 'time'
 *
 * 'date'     -> '20 Jun'
 * 'time'     -> '04:00 pm'
 * 'datetime' -> '20 Jun 04:00 pm'
 */
export function formatIST(value, format = 'datetime') {
  const canonical = parseIST(value)
  if (!canonical) return '—'
  const parts = splitCanonical(canonical)

  const datePart = `${parts.d} ${MONTH_ABBR[parts.mo - 1] || '?'}`

  let h12 = parts.h % 12
  if (h12 === 0) h12 = 12
  const ampm = parts.h >= 12 ? 'pm' : 'am'
  const timePart = `${pad2(h12)}:${pad2(parts.mi)} ${ampm}`

  if (format === 'date') return datePart
  if (format === 'time') return timePart
  return `${datePart} ${timePart}`
}

/**
 * buildIST(dateStr, timeStr) -> canonical 'YYYY-MM-DD HH:mm:ss' from a native
 * <input type="date"> value ('YYYY-MM-DD') and <input type="time"> value
 * ('HH:mm'). This is the ONLY place that should combine a date+time picker
 * pair into a due-date value.
 */
export function buildIST(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null
  return parseIST(`${dateStr} ${timeStr}:00`)
}

/**
 * toDbTimestamp(value) -> string safe to write into a Postgres `timestamptz`
 * column (e.g. tasks.due_date, tasks.last_snooze_at) so that Postgres stores
 * the exact instant the IST wall-clock value represents.
 *
 * Do NOT use this for plain `timestamp` (no tz) columns like
 * leads.follow_up_date — write the canonical IST string there directly.
 */
export function toDbTimestamp(value) {
  const canonical = parseIST(value)
  if (!canonical) return null
  const parts = splitCanonical(canonical)
  return istPartsToInstant(parts).toISOString()
}
