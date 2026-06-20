// ============================================================================
// reminderEngine.js — domain rules for callback/task reminders.
//
// This file contains ZERO date math of its own. Every comparison and time
// shift below goes through src/utils/timeUtils.js, which is the only file
// allowed to touch Date internals, UTC offsets, or timezone conversion.
// That separation is the whole point: if a future bug ever needs fixing,
// there is exactly one file to look at for "how do we read/compare/write
// time" (timeUtils.js) and exactly one file for "what counts as due, what
// stops reminders" (this file).
// ============================================================================

import { nowIST, subtractMinutes, addMinutes, compareIST } from './timeUtils'

// How often a still-unresolved reminder re-fires.
export const SNOOZE_INTERVAL_MIN = 5

// Statuses that permanently stop reminders for a task — the four explicit
// stop conditions: Done (=Completed), Attempted, Rescheduled, Cancelled.
// "Rescheduled" isn't a stored status value — rescheduling works by moving
// due_date into the future and clearing last_snooze_at (see
// Dashboard.js:rescheduleCallback), which naturally restarts the window.
const RESOLVED_STATUSES = new Set(['Completed', 'Attempted', 'Cancelled'])

/** True once a task has reached a stop condition — no more reminders, ever. */
export function isResolved(task) {
  return !task || RESOLVED_STATUSES.has(task.status)
}

/** The moment reminders are allowed to start: due_date minus 5 minutes. */
export function getReminderWindowStart(task) {
  if (!task?.due_date) return null
  return subtractMinutes(task.due_date, SNOOZE_INTERVAL_MIN)
}

/**
 * True once `due_date` has actually passed (status governs only whether the
 * task is resolved — overdue and "still reminding" are independent: a task
 * stays "Pending" and keeps reminding every 5 minutes whether or not it's
 * overdue yet).
 */
export function isOverdue(task) {
  if (!task?.due_date || isResolved(task)) return false
  return compareIST(nowIST(), task.due_date) > 0
}

/**
 * True for the entire lifetime of a reminder — from (due_date - 5 min)
 * onward, until resolved. This is what should drive the PERSISTENT reminder
 * list/panel. It is intentionally broader than shouldTriggerReminder(),
 * which is narrow on purpose (only true at the exact 5-minute pulses, so the
 * popup+beep don't fire every poll). The list must stay populated between
 * those pulses too, or callbacks appear to vanish for 4+ minutes out of
 * every 5 — which is the bug this function exists to fix.
 */
export function isReminderActive(task) {
  if (!task || isResolved(task)) return false
  const windowStart = getReminderWindowStart(task)
  if (!windowStart) return false
  return compareIST(nowIST(), windowStart) >= 0
}

/**
 * Core trigger rule:
 *   - never trigger a resolved task
 *   - never trigger before (due_date - 5 min)
 *   - once in the window, re-trigger every SNOOZE_INTERVAL_MIN minutes,
 *     measured from the last time it was shown (last_snooze_at) — not from
 *     due_date, so it keeps firing every 5 min indefinitely, including past
 *     the due time, until resolved.
 */
export function shouldTriggerReminder(task, lastSnoozeAt) {
  if (!task || isResolved(task)) return false
  const windowStart = getReminderWindowStart(task)
  if (!windowStart) return false

  const now = nowIST()
  if (compareIST(now, windowStart) < 0) return false // not due yet

  if (!lastSnoozeAt) return true
  const nextAllowed = addMinutes(lastSnoozeAt, SNOOZE_INTERVAL_MIN)
  return compareIST(now, nextAllowed) >= 0
}
