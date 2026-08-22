import { getStatusChangeTime, isCurrentlyInStatus, computeTargetProgress } from '../Dashboard'

// Regression test for a real production bug: agent Nithya H
// (5ee005af-1f63-497d-a517-9c37f631acb3) had two leads genuinely Disbursed this
// month, but Monthly Disbursed showed only 1 of 2 (₹19.8L instead of ₹29.8L) —
// Shruti's lead was silently dropped from the sum.
//
// Root cause: the Disbursed-reversal guard added to computePipelineStats /
// computeTargetProgress checked `lead.status`. But for a mirror-assigned lead,
// AgentDashboard's fetchAll overwrites `status` in myLeads with
// `mirror_agent_statuses[userId]` when present — a per-agent view that can go
// stale and diverge from the lead's real, SQL-confirmed status. isCurrentlyInStatus
// reads the real stage_history transition log instead, sidestepping that ambiguity.
describe('Disbursed-reversal guard (isCurrentlyInStatus / getStatusChangeTime)', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-08-22T12:00:00+05:30'))
  })
  afterEach(() => { jest.useRealTimers() })

  // The two real production records (agent Nithya H, Aug 2026), trimmed to the
  // fields the guard/reducers actually read.
  const shruti = {
    id: 'e077f71f-ac1e-4fcd-92b1-f62e8fa134c4',
    status: 'Disbursed',
    disbursed_amount: 1000000,
    stage_history: [{ at: '2026-08-04T07:04:48.812124+00:00', to: 'Disbursed', from: 'Login' }],
  }
  const badavath = {
    id: 'c935caeb-a3e8-4ff5-b2f3-a1ff18971d23',
    status: 'Disbursed',
    disbursed_amount: 1980000,
    stage_history: [{ at: '2026-08-07T14:14:36.81002+00:00', to: 'Disbursed', from: 'Login' }],
  }
  const targetRow = { monthly_disbursement_target: 5000000, working_days: 22 }

  test('both real Disbursed records are recognized as currently Disbursed', () => {
    expect(isCurrentlyInStatus(shruti, 'Disbursed')).toBe(true)
    expect(isCurrentlyInStatus(badavath, 'Disbursed')).toBe(true)
  })

  test('getStatusChangeTime resolves a valid in-month timestamp for both', () => {
    const monthStart = new Date(2026, 7, 1) // Aug 1 2026, local
    const tShruti = getStatusChangeTime(shruti, 'Disbursed')
    const tBadavath = getStatusChangeTime(badavath, 'Disbursed')
    expect(tShruti).not.toBeNull()
    expect(tBadavath).not.toBeNull()
    expect(tShruti.getTime()).toBeGreaterThanOrEqual(monthStart.getTime())
    expect(tBadavath.getTime()).toBeGreaterThanOrEqual(monthStart.getTime())
  })

  test('computeTargetProgress sums BOTH leads — the actual regression (was ₹19.8L/1, must be ₹29.8L/2)', () => {
    const progress = computeTargetProgress([shruti, badavath], targetRow)
    expect(progress.disbursedThisMonth).toBe(2980000)
  })

  test('a mirror-assigned lead with a stale lead.status is still counted, via stage_history', () => {
    // Reproduces the exact mechanism: fetchAll's mirror-lead merge overwrites
    // `status` with mirror_agent_statuses[userId] when present, which can be
    // stale — even though the lead's real, current status (and stage_history)
    // says Disbursed. This is the shape of record that broke the old
    // `lead.status !== 'Disbursed'` guard.
    const mirrorLeadWithStaleStatus = { ...shruti, status: 'Login' }
    expect(isCurrentlyInStatus(mirrorLeadWithStaleStatus, 'Disbursed')).toBe(true)
    const progress = computeTargetProgress([mirrorLeadWithStaleStatus, badavath], targetRow)
    expect(progress.disbursedThisMonth).toBe(2980000)
  })

  test('a genuinely reversed disbursement (moved off Disbursed afterward) is still excluded', () => {
    // Regression guard for the earlier fix (the "Kailash Jadhav" case): disbursed,
    // then moved back to a different status later — must NOT count toward the sum.
    const reversed = {
      id: 'reversed-lead',
      status: 'Callback',
      disbursed_amount: 5000000,
      stage_history: [
        { at: '2026-08-05T09:00:00.000000+00:00', to: 'Disbursed', from: 'Login' },
        { at: '2026-08-10T09:00:00.000000+00:00', to: 'Callback', from: 'Disbursed' },
      ],
    }
    expect(isCurrentlyInStatus(reversed, 'Disbursed')).toBe(false)
    const progress = computeTargetProgress([shruti, badavath, reversed], targetRow)
    expect(progress.disbursedThisMonth).toBe(2980000) // unchanged — reversed lead stays excluded
  })
})
