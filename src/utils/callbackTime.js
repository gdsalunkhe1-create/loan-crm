// Shared validation for every path that creates or moves a callback task
// (Schedule Callback modal, Log Call modal, reschedule box, Power Dialer).
// All checks compare IST wall-clock strings — the same clock buildIST /
// toDbTimestamp store with — so there's no UTC round-trip to shift the date.
import { addMinutes, buildIST, compareIST, nowIST, toDbTimestamp } from './timeUtils'

export const istToday = () => nowIST().slice(0, 10)

// Default pre-fill for a new callback: the next full hour in IST (6:19 PM ->
// 7:00 PM, 6:00 PM -> 7:00 PM). Before 10:00 AM it's today 10:00 AM; later
// than 8:00 PM it's tomorrow 10:00 AM.
// Returns { date: 'YYYY-MM-DD', time: 'HH:MM' }.
export function defaultCallbackSlot() {
  const now = nowIST()
  const nextHour = Math.max(Number(now.slice(11, 13)) + 1, 10)
  if (nextHour <= 20) return { date: now.slice(0, 10), time: `${String(nextHour).padStart(2, '0')}:00` }
  return { date: addMinutes(`${now.slice(0, 10)} 00:00:00`, 24 * 60).slice(0, 10), time: '10:00' }
}

// Date ('YYYY-MM-DD') + time (24h 'HH:MM') -> value for tasks.due_date (timestamptz).
export const scheduleDueDate = (dateStr, timeStr) => toDbTimestamp(buildIST(dateStr, timeStr))

export const isCallbackInPast = (dateStr, timeStr) => compareIST(buildIST(dateStr, timeStr), nowIST()) < 0

// null when the callback can be saved, otherwise 'date' | 'time' | 'past'.
// TimeInput emits '' for text it can't parse, so a bad time arrives here as ''.
export function callbackTimeProblem(dateStr, timeStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return 'date'
  if (!/^\d{2}:\d{2}$/.test(timeStr || '')) return 'time'
  return isCallbackInPast(dateStr, timeStr) ? 'past' : null
}

export const CALLBACK_TIME_MESSAGES = {
  date: 'Pick a date for the callback.',
  time: 'Enter a valid time, e.g. 1:30',
  past: 'This time has already passed. Pick a later time.',
}
