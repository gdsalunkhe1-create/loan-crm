/* eslint-disable */
import { render, screen } from '@testing-library/react';
import App from './App';

// The original test asserted CRA's starter-template text ("Learn React"),
// which stopped existing the moment this became a real CRM - it was never
// updated to match the actual app, so it always failed once App.js could
// even load. Replaced with an assertion against what App.js genuinely
// renders: a loading splash while Supabase's auth.getSession() call is in
// flight, before the real route tree (Login vs. the authenticated app)
// takes over.
test('renders the initial loading state without crashing', async () => {
  render(<App />);
  // findByText (not getByText) waits/polls - this gives the in-flight
  // supabase.auth.getSession() promise a chance to settle inside the
  // test's tracked async boundary, which is also what keeps React from
  // warning about a state update outside act() the way a bare synchronous
  // assertion would.
  expect(await screen.findByText(/CALL-Q PRO CRM/i)).toBeInTheDocument();
});
