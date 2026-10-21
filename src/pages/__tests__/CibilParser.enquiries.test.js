import { parseCibil } from '../CibilParser';

// CIBIL.com enquiry table with mixed purposes; report dated 16/10/2026.
const raw = [
  'Report Date : 16/10/2026',
  'ENQUIRY DETAILS',
  'Member Name HDFC BANK Date Of Enquiry 04/10/2026 Enquiry Purpose Personal Loan – Enquiry Amount ₹5,00,000',            // 12 days, PL
  'Member Name TATA MOTORS FINANCE Date Of Enquiry 10/10/2026 Enquiry Purpose Auto Loan (Personal) – Enquiry Amount ₹8,00,000', // 6 days, auto
  'Member Name SBI CARD Date Of Enquiry 01/09/2026 Enquiry Purpose Credit Card – Enquiry Amount ₹1,00,000',              // 45 days, card
  'Member Name BAJAJ FINANCE LTD Date Of Enquiry 01/08/2026 Enquiry Purpose Short Term Personal Loan – Enquiry Amount ₹50,000', // 76 days, PL
  'Member Name AXIS BANK Date Of Enquiry 01/06/2026 Enquiry Purpose Personal Loan – Enquiry Amount ₹2,00,000',          // 137 days, PL
  'End of report',
].join('\n');

test('CIBIL.com: total and 30/60/90-day windows count Personal Loan enquiries only; details keep every type', () => {
  const { enquiries } = parseCibil(raw);

  expect(enquiries.last30).toBe(1); // HDFC PL (the auto loan 6 days ago doesn't count)
  expect(enquiries.last60).toBe(1); // + SBI card at 45 days doesn't count
  expect(enquiries.last90).toBe(2); // + Bajaj short-term PL at 76 days
  expect(enquiries.items90.map((e) => e.institution)).toEqual(['HDFC BANK', 'BAJAJ FINANCE LTD']);

  expect(enquiries.details.map((e) => e.product)).toEqual([
    'Personal Loan', 'Auto Loan (Personal)', 'Credit Card', 'Short Term Personal Loan', 'Personal Loan',
  ]);
  expect(enquiries.total).toBe(3); // HDFC, Bajaj short-term and Axis PLs (any age); auto loan + card excluded
  expect(enquiries.details).toHaveLength(5);
});
