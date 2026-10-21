import { parseDate, mapProductType, cibilToProfile, bankStatementToProfile, buildCibilRow, buildBsaRow, passwordErrorKind, detectPayslipMonth, averageNetPay, buildProfileDraft, normalizeMobile, extractEmployerName, companyNameVariants, summarizeEmployer, normalizePersonName, treatmentPatch, treatmentChoice, loanReason, hlJointPatch, hlPayerPatch, cardActionPatch, cardOutstandingPatch, cardCountedShare, isZeroBalanceLoan, loanNeedsEmi, buildEnquiryList, ownBankEnquiries, plEnquiries90d, scorecardPatch, scorecardTone, isClosureNote, closureLineText, visibleClosurePlan, companyForBank, typedCategoryPatch, manualCategoryBanks, manualCompany } from './underwritingAdapters';
import { parseSalaryText } from '../pages/TaxCalculator';
import { evaluateBank } from './underwritingEngine';
import policy from './hdfc_pl_policy.json';
import kotak from './kotak_pl_policy.json';

// Shapes mirror real customer_cibil_data.accounts rows (all strings, two date formats).
const acc = (o) => ({ bankName: '', loanType: 'Personal Loan', status: 'Active', openDate: '', closedDate: '', tenure: '', emi: '', outstanding: '', overdue: '', dpds: '0', lateMonths: [], settlement: '', writtenOff: '', ...o });

test('parses both CIBIL date formats and ISO', () => {
  expect(parseDate('07/04/2026')).toEqual(new Date(2026, 3, 7));
  expect(parseDate('07 Jun 2026')).toEqual(new Date(2026, 5, 7));
  expect(parseDate('2026-10-09')).toEqual(new Date(2026, 9, 9));
});

test('maps CIBIL loan types', () => {
  expect(mapProductType('Short Term Personal Loan')).toBe('PL');
  expect(mapProductType('Kisan Credit Card')).toBe('KCC');
  expect(mapProductType('Corporate Credit Card')).toBe('CARD');
  expect(mapProductType('Loan on Credit Card')).toBe('CARD_LOAN');
  expect(mapProductType('Education Loan')).toBe('EDU');
  expect(mapProductType('Used Car Loan')).toBe('AUTO');
  expect(mapProductType('Property Loan')).toBe('HL');
  expect(mapProductType('Business Loan - Secured')).toBe('BL_SECURED');
  expect(mapProductType('Business Loan - Priority Sector- Small Busine')).toBe('BL');
  expect(mapProductType('Other')).toBe('OTHER');
});

test('non-BT types stay as full-EMI obligations in the engine', () => {
  const p = cibilToProfile({ report_date: '2026-10-09', accounts: [
    acc({ bankName: 'SBI', loanType: 'Education Loan', openDate: '01/01/2024', emi: '8000', outstanding: '300000' }),
    acc({ bankName: 'ICICI BANK', loanType: 'Loan on Credit Card', openDate: '01/01/2025', emi: '4000', outstanding: '60000' }),
    acc({ bankName: 'AXIS BANK', loanType: 'Business Loan - Secured', openDate: '01/01/2024', emi: '15000', outstanding: '900000' }),
  ] });
  const r = evaluateBank(policy, { netSalary: 100000, salaryAccountBank: 'ICICI Bank', company: { category: 'CAT A', categoryConfirmed: true }, ...p, credit: {} });
  r.obligations.loans.forEach((l) => {
    expect(l.obligation).toEqual({ amount: l.emi, rule: 'Full EMI' });
    expect(l.bt.ok).toBe(false);
  });
  expect(r.scenarios).toHaveLength(1);
});

test('open loans and cards, EMI progress from open date to report date', () => {
  const p = cibilToProfile({ report_date: '2026-10-09', accounts: [
    acc({ bankName: 'ICICI BANK', openDate: '27/03/2025', tenure: '36', emi: '10,370', outstanding: '83640' }),
    acc({ bankName: 'HDFC BANK', loanType: 'Credit Card', outstanding: '45000' }),
    acc({ bankName: 'AXIS BANK', status: 'Closed', closedDate: '01/01/2026' }),
  ] });
  expect(p.loans).toHaveLength(1);
  expect(p.loans[0]).toMatchObject({ productType: 'PL', emi: 10370, emisPaid: 18, emisRemaining: 18 });
  expect(p.cards).toEqual([{ id: 'C1', issuer: 'HDFC BANK', outstanding: 45000, paidBeforeLoginWithProof: 0, action: 'keep' }]);
});

test('credit flags: settlement, fresh loan after it, HDFC history, recent DPD', () => {
  const p = cibilToProfile({ report_date: '2026-10-09', accounts: [
    acc({ bankName: 'SHRIRAMFIN', status: 'Post (WO) Settled', closedDate: '10/10/2023' }),
    acc({ bankName: 'HDFC BANK', status: 'Closed', closedDate: '07 Jun 2026', dpds: '1-89 days (×16)', lateMonths: ['2026 JAN', '2025 JAN'] }),
    acc({ bankName: 'ICICI BANK', openDate: '01/01/2025' }),
  ] });
  expect(p.credit.settlementsOrWO).toBe(1);
  expect(p.credit.hdfcSettlementOrWO).toBe(false);
  expect(p.credit.freshLoanAfterSettlement).toEqual({ exists: true, emisPaid: 21 });
  expect(p.credit.hdfcBadHistory).toBe(true);
  expect(p.credit.overdueLast12m).toBe(true);
  expect(p.credit.dpdAcrossAllTrades).toBe(false);
});

test('bank statement: confirmed bounces in last 12 months, salary only when detected', () => {
  const b = bankStatementToProfile({ bank_name: 'HDFC Bank', result: {
    summary: { bank_name: 'HDFC Bank' },
    credit_assessment: { estimated_monthly_income: 84500.4 },
    positive_signals: [{ type: 'REGULAR_SALARY' }],
    ecs_returns: [
      { party: 'SBI CARD', return_date: '05/08/2026', bounce_type: 'CONFIRMED' },
      { party: 'BAJAJ', return_date: '05/07/2026', bounce_type: 'INFERRED_DATE_DRIFT' },
      { party: 'UNMATCHED', return_date: '' },
      { party: 'AXIS', return_date: '05/01/2024', bounce_type: 'CONFIRMED' },
    ],
  } }, new Date(2026, 9, 14));
  expect(b).toEqual({ bouncesLast12m: 1, bouncesOnlyCardOrGold: true, salaryAccountBank: 'HDFC Bank', salaryFromStatement: 84500 });
  expect(bankStatementToProfile({ result: { credit_assessment: { estimated_monthly_income: 50000 } } }).salaryFromStatement).toBeNull();
});

describe('direct uploads', () => {
  const now = new Date('2026-10-14T06:30:00Z');

  test('CIBIL row has exactly the fields CibilParser save() writes', () => {
    const parsed = { format: 'cibil', customerName: 'RAVI KUMAR', score: 742, accounts: [acc({})], enquiries: { total: 2 }, pan: 'ABCDE1234F', mobile: '9876543210' };
    expect(buildCibilRow(parsed, { leadId: 'L1', userId: 'U1', now })).toEqual({
      lead_id: 'L1', customer_name: 'RAVI KUMAR', cibil_score: 742, report_source: 'cibil', report_date: '2026-10-14',
      accounts: parsed.accounts, enquiries: { total: 2 }, uploaded_by: 'U1', uploaded_at: now.toISOString(),
    });
    expect(buildCibilRow({ ...parsed, customerName: '' }, { fallbackName: 'Lead Name', now }).customer_name).toBe('Lead Name');
  });

  test('bank statement row has exactly the fields SaveBsaToLead writes', () => {
    const result = { summary: { account_holder: 'RAVI', bank_name: 'HDFC Bank', statement_period: '01/04/2026 - 30/09/2026' } };
    expect(buildBsaRow(result, { leadId: 'L1', userId: 'U1', now })).toEqual({
      lead_id: 'L1', account_holder: 'RAVI', bank_name: 'HDFC Bank', statement_period: '01/04/2026 - 30/09/2026',
      result, uploaded_by: 'U1', uploaded_at: now.toISOString(),
    });
  });

  test('password errors from pdf.js and from CibilParser', () => {
    expect(passwordErrorKind({ name: 'PasswordException', code: 1 })).toBe('needs');
    expect(passwordErrorKind({ name: 'PasswordException', code: 2 })).toBe('wrong');
    expect(passwordErrorKind(new Error('NEEDS_PASSWORD'))).toBe('needs');
    expect(passwordErrorKind(new Error('WRONG_PASSWORD'))).toBe('wrong');
    expect(passwordErrorKind(new Error('Invalid PDF structure'))).toBeNull();
  });

  test('payslip month prefers the pay period over a joining date', () => {
    expect(detectPayslipMonth('Date of Joining 01 Jan 2020 Payslip for the month of March 2026')).toBe('Mar 2026');
    expect(detectPayslipMonth('Pay Period: Aug-26')).toBe('Aug 2026');
    expect(detectPayslipMonth('no dates here', 'salary_slip_sep_2026.pdf')).toBe('Sep 2026');
    expect(detectPayslipMonth('nothing', 'slip.pdf')).toBeNull();
  });

  test('payslip average ignores slips without net pay and beats the bank-statement salary', () => {
    const slips = [{ netPay: 82000 }, { netPay: 84000 }, { netPay: 0 }];
    expect(averageNetPay(slips)).toBe(83000);
    expect(averageNetPay([])).toBeNull();
    const bsaRow = { result: { credit_assessment: { estimated_monthly_income: 90000 }, positive_signals: [{ type: 'REGULAR_SALARY' }] } };
    expect(buildProfileDraft(null, bsaRow, { payslipNetPay: 83000 })).toMatchObject({ netSalary: 83000, netSalarySource: 'payslip' });
    expect(buildProfileDraft(null, bsaRow)).toMatchObject({ netSalary: 90000, netSalarySource: 'bank_statement' });
  });

  test('normalizes mobiles to the last 10 digits', () => {
    expect(normalizeMobile('+91 98765-43210')).toBe('9876543210');
  });
});

test('TaxCalculator parseSalaryText reads net pay labels', () => {
  expect(parseSalaryText('Earnings Basic 40,000 ... NET PAY 1,22,387.00').netPayMonthly).toBe(122387);
  expect(parseSalaryText('Net Amount Payable : Rs. 84,500').netPayMonthly).toBe(84500);
  expect(parseSalaryText('Take Home 61,250').netPayMonthly).toBe(61250);
  expect(parseSalaryText('Net Salary 55,000').netPayMonthly).toBe(55000);
  expect(parseSalaryText('Gross 90,000').netPayMonthly).toBe(0);
});

describe('employer from payslip', () => {
  test('labelled field wins and stops at the next field on the row', () => {
    const text = 'Payslip for the month of March 2026 Company Name : Acme Technologies Pvt. Ltd. Employee Name : RAVI KUMAR Designation : Analyst';
    expect(extractEmployerName(text, [])).toBe('Acme Technologies Pvt. Ltd.');
    expect(extractEmployerName('Name of the Employer - Globex India Limited Month: Mar 2026', [])).toBe('Globex India Limited');
  });

  test('"Employer PF" in a deductions table is not read as the company', () => {
    expect(extractEmployerName('Deductions Employer PF 1,800 Employee PF 1,800', ['ZETA LABS', 'Payslip for March 2026'])).toBe('ZETA LABS');
  });

  test('header line with a company word, skipping title, address and the employee', () => {
    const lines = [
      'Salary Slip for the month of March 2026',
      'RAVI KUMAR',
      'INITECH SOLUTIONS PRIVATE LIMITED Bengaluru',
      '4th Floor, Prestige Tower, MG Road, Bengaluru 560001',
    ];
    expect(extractEmployerName('Employee Name: RAVI KUMAR Basic 40,000', lines)).toBe('INITECH SOLUTIONS PRIVATE LIMITED');
  });

  test('falls back to the first heading-like line; null for a logo-only header', () => {
    expect(extractEmployerName('', ['Payslip', 'Hooli', 'Plot 12, Sector 5, Noida 201301'])).toBe('Hooli');
    expect(extractEmployerName('Basic 40,000 Net Pay 52,000', ['Payslip - March 2026', 'Emp Code: 1042'])).toBeNull();
  });

  test('variants expand and shorten company suffixes', () => {
    expect(companyNameVariants('Acme Technologies Pvt. Ltd.')).toEqual([
      'ACME TECHNOLOGIES PVT. LTD',
      'ACME TECHNOLOGIES PRIVATE LIMITED',
      'ACME TECHNOLOGIES PVT LTD',
    ]);
    expect(companyNameVariants('Tata Consultancy Services Limited')).toEqual([
      'TATA CONSULTANCY SERVICES LIMITED',
      'TATA CONSULTANCY SERVICES LTD',
    ]);
    expect(companyNameVariants('Larsen & Toubro (India) Co.')).toEqual([
      'LARSEN & TOUBRO (INDIA) CO',
      'LARSEN AND TOUBRO INDIA COMPANY',
    ]);
    expect(companyNameVariants('Wipro Co. Pvt Ltd')).toContain('WIPRO COMPANY PRIVATE LIMITED');
    expect(companyNameVariants('  ')).toEqual([]);
  });

  test('latest month employer is used; a different employer is flagged', () => {
    const slips = [
      { month: 'Feb 2026', employerName: 'Old Corp Pvt Ltd' },
      { month: 'Mar 2026', employerName: 'New Labs Private Limited' },
      { month: null, employerName: null },
    ];
    expect(summarizeEmployer(slips)).toEqual({ employerName: 'New Labs Private Limited', differs: true });
    expect(summarizeEmployer([
      { month: 'Feb 2026', employerName: 'Acme Pvt. Ltd.' },
      { month: 'Mar 2026', employerName: 'ACME PRIVATE LIMITED' },
    ])).toEqual({ employerName: 'ACME PRIVATE LIMITED', differs: false });
    expect(summarizeEmployer([])).toEqual({ employerName: null, differs: false });
  });
});

describe('employer skips the customer name', () => {
  const lines = ['Pay Slip for March 2026', 'MR. RAVI KUMAR SHARMA S/O RAMESH SHARMA', 'Globex Engineering', 'Plot 12, Sector 5, Noida 201301'];

  test('a header line matching the lead / CIBIL name is skipped (titles and S/O ignored)', () => {
    // Without the name, the person line is the first heading-like line.
    expect(extractEmployerName('', lines)).toBe('MR. RAVI KUMAR SHARMA S/O RAMESH SHARMA');
    expect(extractEmployerName('', lines, { knownNames: ['Ravi Kumar Sharma'] })).toBe('Globex Engineering');
    // CIBIL often prints a shorter form of the name; every word of it still belongs to the line.
    expect(extractEmployerName('', ['RAVI SHARMA', 'Globex Engineering'], { knownNames: ['MR RAVI KUMAR SHARMA'] })).toBe('Globex Engineering');
  });

  test('a company line that merely shares a word with the name is kept', () => {
    expect(extractEmployerName('', ['SHARMA TECHNOLOGIES PVT LTD'], { knownNames: ['Ravi Kumar Sharma'] })).toBe('SHARMA TECHNOLOGIES PVT LTD');
  });

  test('normalizePersonName drops titles and the relation part', () => {
    expect(normalizePersonName('Mrs. Anita Rao W/O Suresh Rao')).toBe('ANITA RAO');
    expect(normalizePersonName('DR. K. S. Iyer')).toBe('K S IYER');
  });
});

describe('obligations table helpers', () => {
  test('Treatment dropdown maps to engine fields', () => {
    expect(treatmentPatch('auto')).toEqual({ closedBeforeLoginWithProof: false, treatment: 'auto' });
    expect(treatmentPatch('bt')).toEqual({ closedBeforeLoginWithProof: false, treatment: 'bt' });
    expect(treatmentPatch('obligate')).toEqual({ closedBeforeLoginWithProof: false, treatment: 'obligate' });
    expect(treatmentPatch('closed')).toEqual({ closedBeforeLoginWithProof: true, treatment: 'auto' });
    expect(treatmentChoice({ treatment: 'bt', closedBeforeLoginWithProof: true })).toBe('closed');
    expect(treatmentChoice({ treatment: 'obligate' })).toBe('obligate');
    expect(treatmentChoice({})).toBe('auto');
  });

  test('Reason column: BT in the best scenario, otherwise the engine rule', () => {
    const best = { bt: ['a'] };
    const line = (rule) => ({ obligation: { amount: 0, rule } });
    expect(loanReason({ id: 'a' }, line('Full EMI'), best)).toBe('BT');
    expect(loanReason({ id: 'b' }, line('Only 2 EMI(s) left — not obligated'), best)).toBe('Only 2 EMI(s) left — not obligated');
    expect(loanReason({ id: 'c', closedBeforeLoginWithProof: true }, null, null)).toBe('Closed before login (proof)');
    expect(loanReason({ id: 'd' }, null, null)).toBe('');
  });

  test('CIBIL loans carry loan amount and default to Auto treatment', () => {
    const p = cibilToProfile({ report_date: '2026-10-09', accounts: [acc({ bankName: 'BAJAJ FIN', loanAmount: '2,00,000', outstanding: '120000', emi: '6000' })] });
    expect(p.loans[0]).toMatchObject({ loanAmount: 200000, treatment: 'auto', closedBeforeLoginWithProof: false });
  });
});

describe('multi-bank profile fields', () => {
  const row = {
    report_date: '2026-10-09', cibil_score: 768, enquiries: { last30: 2, last60: 5, last90: 8 },
    accounts: [
      acc({ bankName: 'ICICI BANK', status: 'Post (WO) Settled', closedDate: '10/10/2023' }),
      acc({ bankName: 'SHRIRAMFIN', status: 'Closed', closedDate: '01/01/2025', dpds: '57', lateMonths: ['May 2023 (57d)'] }),
      acc({ bankName: 'HDFC BANK', openDate: '01/01/2025', emi: '12000', outstanding: '300000', tenure: '48' }),
      acc({ bankName: 'SBI', loanType: 'Housing Loan', openDate: '01/01/2020', emi: '25000', outstanding: '2500000' }),
    ],
  };

  test('score, 90-day enquiries, settled and DPD lender names, HL payer', () => {
    const d = buildProfileDraft(row, null);
    expect(d.cibilScore).toBe(768);
    expect(d.credit.enquiries90d).toBe(8);
    expect(d.credit.settledLenders).toEqual(['ICICI BANK']);
    expect(d.credit.dpdLenders).toEqual(['SHRIRAMFIN']);
    expect(d.loans.find((l) => l.productType === 'HL').hlEmiPaidBy).toBeNull();
    expect(buildProfileDraft({ ...row, cibil_score: null, enquiries: null }, null)).toMatchObject({ cibilScore: null, credit: { enquiries90d: null } });
  });

  test('one profile, each bank with its own category: HDFC and ICICI policies both evaluate', () => {
    const hdfc = require('./hdfc_pl_policy.json');
    const icici = require('./icici_pl_policy.json');
    const d = buildProfileDraft({ ...row, accounts: row.accounts.slice(1) }, null);
    const company = {
      name: 'ACME', category: null, categoryConfirmed: true,
      categoriesByBank: { hdfc_bank: 'CAT A', icici: 'Preferred' }, confirmedByBank: {},
    };
    const profile = { ...d, netSalary: 150000, salaryAccountBank: 'ICICI Bank', company };
    const h = evaluateBank(hdfc, profile);
    const i = evaluateBank(icici, profile);
    expect(['ELIGIBLE', 'DEVIATION']).toContain(h.status);
    expect(i.status).toBe('DEVIATION'); // 8 enquiries in 90 days > ICICI max 6
    expect(i.deviations.join(' ')).toMatch(/8 enquiries in 90 days/);
    expect(Object.values(i.best.multiplier).some(Boolean)).toBe(false); // FOIR only
    expect(evaluateBank(icici, { ...profile, company: { ...company, confirmedByBank: { icici: false } } }).status).toBe('NEEDS_INPUT');
  });
});

describe('HL joint toggle and EMI payer', () => {
  const apply = (loan, patch) => ({ ...loan, ...patch });
  const hl = { id: 'h', productType: 'HL', emi: 30000, isJoint: false, coApplicantIncomeOk: null, hlEmiPaidBy: null };

  test('choosing a payer never changes isJoint', () => {
    const joint = apply(hl, hlJointPatch(true));
    expect(apply(joint, hlPayerPatch('co_applicant'))).toMatchObject({ isJoint: true, hlEmiPaidBy: 'co_applicant' });
    expect(hlPayerPatch('co_applicant')).toEqual({ hlEmiPaidBy: 'co_applicant' });
    expect(hlPayerPatch('')).toEqual({ hlEmiPaidBy: null });
    expect(apply(hl, hlPayerPatch('applicant')).isJoint).toBe(false);
  });

  test('unticking Joint clears the payer back to null', () => {
    const paidByCo = apply(apply(hl, hlJointPatch(true)), hlPayerPatch('co_applicant'));
    expect(apply(paidByCo, hlJointPatch(false))).toMatchObject({ isJoint: false, coApplicantIncomeOk: false, hlEmiPaidBy: null });
  });
});

describe('dpdAccounts for per-bank late-payment rules', () => {
  const row = {
    report_date: '2026-10-09', cibil_score: 770, enquiries: { last90: 2 },
    accounts: [
      acc({ bankName: 'AXIS BANK', loanType: 'Credit Card', outstanding: '40000', dpds: '30', lateMonths: ['Mar 2026 (30d)'] }),
      acc({ bankName: 'SHRIRAMFIN', status: 'Closed', closedDate: '10/10/2023', dpds: '57', lateMonths: ['May 2023 (57d)'] }),
      acc({ bankName: 'ICICI BANK', openDate: '01/01/2024', emi: '9000', outstanding: '200000', tenure: '48' }),
    ],
  };

  test('one entry per late account; cards are CC; 12-month window from the report date', () => {
    expect(cibilToProfile(row).credit.dpdAccounts).toEqual([
      { lender: 'AXIS BANK', productType: 'CC', inLast12m: true },
      { lender: 'SHRIRAMFIN', productType: 'PL', inLast12m: false },
    ]);
    // An overdue amount on an open account counts as late now even without a DPD reading.
    const overdue = cibilToProfile({ ...row, accounts: [acc({ bankName: 'KOTAK', overdue: '5000', dpds: '0' })] });
    expect(overdue.credit.dpdAccounts).toEqual([{ lender: 'KOTAK', productType: 'PL', inLast12m: true }]);
  });

  test('HDFC v8: card late payment is an info note, an HDFC PL late payment rejects', () => {
    const hdfc = require('./hdfc_pl_policy.json');
    const company = { name: 'ACME', category: 'CAT A', categoryConfirmed: true, categoriesByBank: { hdfc_bank: 'CAT A' }, confirmedByBank: {} };
    const base = { ...buildProfileDraft(row, null), netSalary: 120000, salaryAccountBank: 'ICICI Bank', company };
    const r = evaluateBank(hdfc, base);
    expect(r.risk.band).toBe('better');
    expect(r.notes.join(' ')).toMatch(/AXIS BANK/);
    const hdfcPlLate = { ...base, credit: { ...base.credit, dpdAccounts: [...base.credit.dpdAccounts, { lender: 'HDFC BANK', productType: 'PL', inLast12m: false }] } };
    expect(evaluateBank(hdfc, hdfcPlLate).status).toBe('NOT_ELIGIBLE');
  });
});

describe('credit card actions and table grouping', () => {
  const card = { id: 'C1', issuer: 'SBI CARD', outstanding: 80000, paidBeforeLoginWithProof: 0, action: 'keep' };

  test('Action dropdown maps to paidBeforeLoginWithProof', () => {
    expect(cardActionPatch(card, 'keep')).toEqual({ action: 'keep', paidBeforeLoginWithProof: 0 });
    expect(cardActionPatch(card, 'paid')).toEqual({ action: 'paid', paidBeforeLoginWithProof: 80000 });
    expect(cardActionPatch(card, 'close')).toEqual({ action: 'close', paidBeforeLoginWithProof: 80000 });
    // A close plan keeps covering the whole card when the outstanding is edited.
    expect(cardOutstandingPatch({ ...card, action: 'close' }, 95000)).toEqual({ outstanding: 95000, paidBeforeLoginWithProof: 95000 });
    expect(cardOutstandingPatch(card, 95000)).toEqual({ outstanding: 95000 });
  });

  test("card's share of the counted CC obligation", () => {
    const calc = { amount: 5000, total: 100000, lines: [{ id: 'C1', remaining: 80000 }, { id: 'C2', remaining: 20000 }] };
    expect(cardCountedShare(calc, 'C1')).toBe(4000);
    expect(cardCountedShare(calc, 'C2')).toBe(1000);
    expect(cardCountedShare({ ...calc, amount: 0 }, 'C1')).toBeNull(); // exempt: not counted
  });

  test('zero-balance group and missing EMI', () => {
    expect(isZeroBalanceLoan({ outstanding: 0, emi: 0 })).toBe(true);
    expect(isZeroBalanceLoan({ outstanding: 0, emi: 0, manual: true })).toBe(false);
    expect(isZeroBalanceLoan({ outstanding: 5000, emi: 0 })).toBe(false);
    expect(loanNeedsEmi({ productType: 'PL', outstanding: 5000, emi: 0 })).toBe(true);
    expect(loanNeedsEmi({ productType: 'GOLD', outstanding: 5000, emi: 0 })).toBe(false);
    expect(loanNeedsEmi({ productType: 'PL', outstanding: 0, emi: 0 })).toBe(false);
    expect(loanNeedsEmi({ productType: 'PL', outstanding: 5000, emi: 0, closedBeforeLoginWithProof: true })).toBe(false);
  });

  test('CIBIL cards get stable ids; engine card plan refers to them (HDFC v9)', () => {
    const hdfc = require('./hdfc_pl_policy.json');
    const row = { report_date: '2026-10-09', cibil_score: 770, enquiries: { last90: 1 }, accounts: [
      acc({ bankName: 'YES BANK', loanType: 'Credit Card', outstanding: '250000' }),
      acc({ bankName: 'SBI CARD', loanType: 'Credit Card', outstanding: '148000' }),
      acc({ bankName: 'ICICI BANK', openDate: '01/01/2024', emi: '9000', outstanding: '200000', tenure: '48' }),
    ] };
    const d = buildProfileDraft(row, null);
    expect(d.cards.map((c) => [c.id, c.action])).toEqual([['C0', 'keep'], ['C1', 'keep']]);
    const company = { name: 'ACME', category: 'CAT A', categoryConfirmed: true, categoriesByBank: { hdfc_bank: 'CAT A' }, confirmedByBank: {} };
    const r = evaluateBank(hdfc, { ...d, netSalary: 150000, salaryAccountBank: 'ICICI Bank', company });
    expect(r.obligations.cards.lines.map((l) => l.id)).toEqual(['C0', 'C1']);
    expect(r.cardPlan.closeCards.every((id) => ['C0', 'C1'].includes(id))).toBe(true);
    expect(r.cardPlan.gain).toBeGreaterThan(0);
  });
});

describe('enquiryList from the CIBIL enquiry table', () => {
  const { parseCibil, parsePaisaBazaar } = require('../pages/CibilParser');
  const TODAY = new Date(2026, 9, 16); // fixed 'today' so days-ago are deterministic
  const toRow = (parsed) => ({ report_date: '2026-10-16', cibil_score: parsed.score, enquiries: parsed.enquiries, accounts: [] });

  test('CIBIL.com format: every product type, days counted to today', () => {
    const raw = [
      'Report Date : 16/10/2026',
      'ENQUIRY DETAILS',
      'Member Name HDFC BANK Date Of Enquiry 04/10/2026 Enquiry Purpose Personal Loan – Enquiry Amount ₹5,00,000',
      'Member Name BAJAJ FINANCE LTD Date Of Enquiry 20/07/2026 Enquiry Purpose Consumer Loan – Enquiry Amount ₹40,000',
      'End of report',
    ].join('\n');
    const list = cibilToProfile(toRow(parseCibil(raw)), { today: TODAY }).credit.enquiryList;
    expect(list).toEqual([
      { lender: 'HDFC BANK', product: 'Personal Loan', date: '2026-10-04', daysAgo: 12 },
      { lender: 'BAJAJ FINANCE LTD', product: 'Consumer Loan', date: '2026-07-20', daysAgo: 88 },
    ]);
  });

  test('PaisaBazaar format: non-PL enquiries are kept too', () => {
    const text = [
      'Report Date: 16 Oct 2026',
      'Financial Institution Product Type Reported Date Amount',
      'ICICI BANK Personal Loan 01 Oct 2026 ₹3,00,000',
      'KREDITBEE Credit Card 20 Jul 2026 ₹10,000',
      'Tip',
    ].join(' ');
    const list = cibilToProfile(toRow(parsePaisaBazaar(text)), { today: TODAY }).credit.enquiryList;
    expect(list).toEqual([
      { lender: 'ICICI BANK', product: 'Personal Loan', date: '2026-10-01', daysAgo: 15 },
      { lender: 'KREDITBEE', product: 'Credit Card', date: '2026-07-20', daysAgo: 88 },
    ]);
  });

  test('saved rows (JSON dates), undated entries skipped, old rows fall back to items90', () => {
    const report = new Date(2026, 9, 16);
    const savedDate = JSON.parse(JSON.stringify({ d: new Date(2026, 9, 4) })).d; // ISO timestamp after a save
    expect(buildEnquiryList({ details: [
      { institution: 'HDFC BANK', product: 'Personal Loan', date: savedDate },
      { institution: 'AXIS BANK', product: 'Personal Loan', date: null },
      { institution: 'SBI', product: 'Personal Loan', date: 'n/a' },
    ] }, report)).toEqual([{ lender: 'HDFC BANK', product: 'Personal Loan', date: '2026-10-04', daysAgo: 12 }]);
    expect(buildEnquiryList({ items90: [{ institution: 'ICICI BANK', product: 'Personal Loan', date: '01 Oct 2026' }] }, report))
      .toEqual([{ lender: 'ICICI BANK', product: 'Personal Loan', date: '2026-10-01', daysAgo: 15 }]);
    expect(buildEnquiryList(null, report)).toEqual([]);
  });

  test('own-bank enquiry within 30 days: summary chip, and the engine rejects only that bank', () => {
    const hdfc = require('./hdfc_pl_policy.json');
    const icici = require('./icici_pl_policy.json');
    const enquiryList = [
      { lender: 'HDFC BANK', product: 'Personal Loan', date: '2026-10-04', daysAgo: 12 },
      { lender: 'ICICI BANK', product: 'Credit Card', date: '2026-10-10', daysAgo: 6 },   // not PL: ignored
    ];
    const policies = [{ bank_id: 'hdfc_bank', policy: hdfc }, { bank_id: 'icici', policy: icici }];
    expect(ownBankEnquiries(enquiryList, policies)).toEqual([{ bankId: 'hdfc_bank', short: 'HDFC', daysAgo: 12 }]);

    const row = { report_date: '2026-10-16', cibil_score: 780, enquiries: { last90: 2 }, accounts: [
      acc({ bankName: 'ICICI BANK', openDate: '01/01/2024', emi: '9000', outstanding: '200000', tenure: '48' }),
    ] };
    const d = buildProfileDraft(row, null);
    const company = { name: 'ACME', category: null, categoryConfirmed: true, categoriesByBank: { hdfc_bank: 'CAT A', icici: 'Preferred' }, confirmedByBank: {} };
    const profile = { ...d, netSalary: 150000, salaryAccountBank: 'ICICI Bank', company, credit: { ...d.credit, enquiryList } };
    const h = evaluateBank(hdfc, profile);
    expect(h.status).toBe('NOT_ELIGIBLE');
    expect(h.reasons.join(' ')).toMatch(/HDFC Bank enquiry 12 day\(s\) ago .* \(18 more\)/);
    expect(evaluateBank(icici, profile).status).not.toBe('NOT_ELIGIBLE');
  });
});

describe('enquiry wait and PL count', () => {
  test('daysAgo counts to today, not the CIBIL upload date', () => {
    const row = { report_date: '2026-09-20', enquiries: { details: [{ institution: 'HDFC BANK', product: 'Personal Loan', date: '04/09/2026' }] }, accounts: [] };
    // Uploaded 16 days after the enquiry, but the case is logged in on 17 Oct: 43 days.
    expect(cibilToProfile(row, { today: new Date(2026, 9, 17) }).credit.enquiryList[0].daysAgo).toBe(43);
    expect(buildProfileDraft(row, null, { today: new Date(2026, 8, 20) }).credit.enquiryList[0].daysAgo).toBe(16);
  });

  test('PL enquiries in 90 days from the list (auto loan / credit card not counted)', () => {
    const list = [
      { lender: 'HDFC BANK', product: 'Personal Loan', daysAgo: 12 },
      { lender: 'TATA MOTORS FIN', product: 'Auto Loan (Personal)', daysAgo: 20 },
      { lender: 'SBI CARD', product: 'Credit Card', daysAgo: 30 },
      { lender: 'BAJAJ FIN', product: 'Personal Loan', daysAgo: 95 },
      { lender: 'AXIS BANK', product: 'PERSONAL LOAN', daysAgo: 90 },
    ];
    expect(plEnquiries90d(list)).toBe(2);
    expect(plEnquiries90d([])).toBeNull();
    expect(plEnquiries90d(undefined)).toBeNull();
  });

  test('own-bank enquiry is a wait: not eligible now, figures kept, eligible after N days', () => {
    const hdfc = require('./hdfc_pl_policy.json');
    const row = { report_date: '2026-10-16', cibil_score: 780, enquiries: { last90: 1 }, accounts: [
      acc({ bankName: 'ICICI BANK', openDate: '01/01/2024', emi: '9000', outstanding: '200000', tenure: '48' }),
    ] };
    const d = buildProfileDraft(row, null);
    const company = { name: 'ACME', category: 'CAT A', categoryConfirmed: true, categoriesByBank: { hdfc_bank: 'CAT A' }, confirmedByBank: {} };
    const credit = { ...d.credit, enquiryList: [{ lender: 'HDFC BANK', product: 'Personal Loan', date: '2026-10-05', daysAgo: 12 }] };
    const r = evaluateBank(hdfc, { ...d, netSalary: 150000, salaryAccountBank: 'ICICI Bank', company, credit });
    expect(r.status).toBe('NOT_ELIGIBLE');
    expect(r.eligibleAfterWait).toBe(true);
    expect(r.waitDays).toBe(18);
    expect(r.best.conservativeAmount).toBeGreaterThan(0);
    // A permanent reason still returns early with no figures.
    const settled = evaluateBank(hdfc, { ...d, netSalary: 150000, salaryAccountBank: 'ICICI Bank', company, credit: { ...credit, settledLenders: ['HDFC BANK'], settlementsOrWO: 1 } });
    expect(settled.status).toBe('NOT_ELIGIBLE');
    expect(settled.eligibleAfterWait).toBeUndefined();
    expect(settled.best).toBeUndefined();
  });
});

describe('Bank scorecard select', () => {
  const sc = kotak.scorecard;
  const kBase = {
    netSalary: 100000, salaryAccountBank: 'ICICI Bank',
    company: { category: 'CAT A', categoryConfirmed: true, categoriesByBank: { kotak: 'CAT A' } },
    loans: [{ id: 'icici', lender: 'ICICI BANK', productType: 'PL', outstanding: 150000, emi: 32000, emisPaid: 5, emisRemaining: 40 }],
    cards: [], credit: { enquiryList: [] },
  };

  test('patch sets one bank, keeps others, and — clears to null', () => {
    expect(scorecardPatch(undefined, 'kotak', 'Green')).toEqual({ scorecardByBank: { kotak: 'Green' } });
    expect(scorecardPatch({ other: 'Yellow' }, 'kotak', 'Red')).toEqual({ scorecardByBank: { other: 'Yellow', kotak: 'Red' } });
    expect(scorecardPatch({ kotak: 'Red' }, 'kotak', '')).toEqual({ scorecardByBank: { kotak: null } });
  });

  test('colour follows the value; rejected values are red', () => {
    expect(scorecardTone(sc, 'Super green')).toBe('green');
    expect(scorecardTone(sc, 'Green')).toBe('green');
    expect(scorecardTone(sc, 'Yellow')).toBe('amber');
    expect(scorecardTone(sc, 'Red')).toBe('red');
    expect(scorecardTone(sc, null)).toBeNull();
    expect(scorecardTone({ reject: ['Yellow'] }, 'Yellow')).toBe('red');
  });

  test('the selected value reaches the engine: a reject value is Not eligible', () => {
    const run = (v) => evaluateBank(kotak, { ...kBase, ...scorecardPatch(undefined, 'kotak', v) });
    expect(sc.reject).toContain('Red');
    expect(run('Red').status).toBe('NOT_ELIGIBLE');
    expect(run('Red').reasons.join()).toMatch(/Kotak scorecard: Red/);
    expect(run('Green').status).not.toBe('NOT_ELIGIBLE');
    expect(run('').status).not.toBe('NOT_ELIGIBLE');
  });
});

describe('Subject-to-closure plan', () => {
  const kBase = {
    netSalary: 100000, salaryAccountBank: 'ICICI Bank',
    company: { category: 'CAT A', categoryConfirmed: true, categoriesByBank: { kotak: 'CAT A' } },
    loans: [
      { id: 'icici', lender: 'ICICI BANK', productType: 'PL', outstanding: 150000, emi: 32000, emisPaid: 5, emisRemaining: 40 },
      { id: 'hl', lender: 'SBI', productType: 'HL', emi: 25000, emisPaid: 50, emisRemaining: 150 },
      { id: 'kb', lender: 'KRAZYBEE', productType: 'PL', outstanding: 40000, emi: 9582, emisPaid: 4, emisRemaining: 8 },
    ],
    cards: [], credit: { enquiryList: [] },
  };
  const fmts = { fmtAmount: (n) => `₹${n}`, fmtLakh: (n) => `${Math.round(n)}` };

  test('line text and closure notes are filtered from the blue notes', () => {
    const r = evaluateBank(kotak, kBase);
    const kb = r.closurePlan.find((c) => c.id === 'kb');
    expect(kb).toBeDefined();
    expect(closureLineText(kb, fmts)).toBe(
      `Subject to closure of KRAZYBEE (₹40000) → eligible ${Math.round(kb.newEligible)} (+${Math.round(kb.gain)}), in hand ${Math.round(kb.netInHandAfterClosing)} after paying it`,
    );
    expect(r.notes.some(isClosureNote)).toBe(true);
    expect(r.notes.filter((n) => !isClosureNote(n)).some((n) => /Subject to closure/.test(n))).toBe(false);
    expect(isClosureNote('Home loan counted as obligation — FOIR 75% applied')).toBe(false);
  });

  test('Mark closed sets Treatment to Closed before login, which drops the loan from the plan', () => {
    const r = evaluateBank(kotak, kBase);
    const kb = r.closurePlan.find((c) => c.id === 'kb');
    const loans = kBase.loans.map((l) => (l.id === kb.id ? { ...l, ...treatmentPatch('closed') } : l));
    expect(treatmentChoice(loans.find((l) => l.id === 'kb'))).toBe('closed');
    const after = evaluateBank(kotak, { ...kBase, loans });
    expect((after.closurePlan || []).map((c) => c.id)).not.toContain('kb');
    expect(after.best.eligibleAmount).toBeCloseTo(kb.newEligible, 0);
  });

  test('no plan when the bank declines for a permanent reason', () => {
    const r = evaluateBank(kotak, { ...kBase, scorecardByBank: { kotak: 'Red' } });
    expect(r.status).toBe('NOT_ELIGIBLE');
    expect(r.closurePlan || []).toEqual([]);
  });
});

test('closure plan is hidden on a permanent decline, kept during a wait', () => {
  const plan = [{ id: 'kb', lender: 'KRAZYBEE', outstanding: 40000, newEligible: 2000000, gain: 150000, netInHandAfterClosing: 1700000 }];
  expect(visibleClosurePlan({ status: 'ELIGIBLE', closurePlan: plan })).toBe(plan);
  expect(visibleClosurePlan({ status: 'DEVIATION', closurePlan: plan })).toBe(plan);
  expect(visibleClosurePlan({ status: 'NOT_ELIGIBLE', closurePlan: plan })).toEqual([]);
  expect(visibleClosurePlan({ status: 'NOT_ELIGIBLE', eligibleAfterWait: true, closurePlan: plan })).toBe(plan);
  expect(visibleClosurePlan({ status: 'ELIGIBLE' })).toEqual([]);
  expect(visibleClosurePlan(null)).toEqual([]);
});

describe('Company category per bank', () => {
  test('no search yet -> null; bank with no match and nothing typed -> missing category', () => {
    expect(companyForBank(null, 'kotak')).toBeNull();
    const byBank = { query: 'Acme Pvt Ltd', banks: {} };
    expect(companyForBank(byBank, 'kotak')).toEqual({ name: 'Acme Pvt Ltd', category: null, categoryConfirmed: true, incorporationYear: null });
  });

  test('a typed category for an unmatched bank is used and counts as confirmed', () => {
    const byBank = { query: 'Acme Pvt Ltd', banks: {} };
    const typed = { ...byBank, banks: { kotak: { candidates: [], ...typedCategoryPatch(undefined, byBank.query, 'CAT A') } } };
    expect(companyForBank(typed, 'kotak')).toEqual({ name: 'Acme Pvt Ltd', category: 'CAT A', categoryConfirmed: true, incorporationYear: null });
  });

  test('typing over a matched category keeps the match and uses the typed value; blank is missing', () => {
    const pick = { company_name: 'ACME PRIVATE LIMITED', category: 'CAT B', match_type: 'exact', incorporation_year: 2010 };
    const bank = { candidates: [pick], pick, category: 'CAT B', variantIdx: null };
    const patched = { ...bank, ...typedCategoryPatch(bank, 'Acme', 'CAT A') };
    expect(patched.pick).toBe(pick);
    expect(companyForBank({ query: 'Acme', banks: { hdfc_bank: patched } }, 'hdfc_bank'))
      .toEqual({ name: 'ACME PRIVATE LIMITED', category: 'CAT A', categoryConfirmed: true, incorporationYear: 2010 });
    const blank = { ...bank, ...typedCategoryPatch(bank, 'Acme', '   ') };
    expect(companyForBank({ query: 'Acme', banks: { hdfc_bank: blank } }, 'hdfc_bank').category).toBeNull();
  });

  test('a listed-twice company stays unconfirmed until a variant is picked', () => {
    const pick = { company_name: 'TWIN LTD', match_type: 'exact', variants: [{ cin: 'U1', category: 'CAT A' }, { cin: 'U2', category: 'CAT C' }] };
    const bank = { candidates: [pick], pick, category: '', variantIdx: null };
    expect(companyForBank({ query: 'Twin', banks: { hdfc_bank: bank } }, 'hdfc_bank').categoryConfirmed).toBe(false);
    expect(companyForBank({ query: 'Twin', banks: { hdfc_bank: { ...bank, variantIdx: 1, category: 'CAT C' } } }, 'hdfc_bank'))
      .toMatchObject({ category: 'CAT C', categoryConfirmed: true });
  });

  test('Kotak manual category reaches the engine through categoriesByBank (cat a = CAT A)', () => {
    const c = manualCompany({ query: 'Acme Pvt Ltd', banks: {} }, 'cat a');
    const profile = {
      netSalary: 100000, salaryAccountBank: 'ICICI Bank',
      company: { ...c, categoriesByBank: { kotak: c.category }, confirmedByBank: {} },
      loans: [], cards: [], credit: { enquiryList: [] },
    };
    const missing = evaluateBank(kotak, { ...profile, company: { ...profile.company, category: null, categoriesByBank: {} } });
    const r = evaluateBank(kotak, profile);
    expect(r.status).not.toBe('NOT_ELIGIBLE');
    expect(r.best.eligibleAmount).toBeGreaterThan(0);
    expect(missing.status).toBe('NOT_ELIGIBLE');
    expect(missing.reasons.join()).toMatch(/Enter the Kotak Mahindra Bank company category/);
  });
});

describe('Kotak v4: manual category, Amber, scorecard multiplier rows', () => {
  const policies = [{ bank_id: 'kotak', policy: kotak }, { bank_id: 'hdfc_bank', policy }];
  const profileWith = (category, scorecard) => {
    // No company search needed: Kotak's category is the agent's banker-confirmed pick.
    const c = manualCompany(null, category);
    return {
      netSalary: 200000, salaryAccountBank: 'ICICI Bank',
      company: { ...c, categoriesByBank: c.category ? { kotak: c.category } : {}, confirmedByBank: {} },
      loans: [], cards: [], credit: { enquiryList: [] },
      ...(scorecard ? scorecardPatch(undefined, 'kotak', scorecard) : {}),
    };
  };

  test('only manual-category banks get the dropdown, with the policy categories', () => {
    expect(manualCategoryBanks(policies)).toEqual({ kotak: ['CAT A', 'CAT B', 'CAT C', 'CAT D'] });
    expect(manualCategoryBanks(null)).toEqual({});
  });

  test('a picked category counts as confirmed; none picked asks for it', () => {
    expect(evaluateBank(kotak, profileWith(null)).reasons.join()).toMatch(/Enter the Kotak Mahindra Bank company category/);
    const r = evaluateBank(kotak, profileWith('CAT A'));
    expect(r.status).not.toBe('NEEDS_INPUT');
    expect(r.reasons.join()).not.toMatch(/company category/);
  });

  test('Amber is offered and coloured like Yellow', () => {
    expect(kotak.scorecard.values).toContain('Amber');
    expect(scorecardTone(kotak.scorecard, 'Amber')).toBe('amber');
    expect(scorecardTone(kotak.scorecard, 'Amber')).toBe(scorecardTone(kotak.scorecard, 'Yellow'));
  });

  test('no scorecard picked: one indicative row per scorecard, never the highest', () => {
    const best = evaluateBank(kotak, profileWith('CAT A')).best;
    const sc = best.methods.filter((m) => m.key.startsWith('multiplier_'));
    expect(sc.map((m) => m.band)).toEqual(Object.keys(kotak.multiplier_by_scorecard.values));
    sc.forEach((m) => { expect(m.indicative).toBe(true); expect(m.multiplier).toBeGreaterThan(0); });
    expect(best.eligibleBy.startsWith('multiplier_')).toBe(false);
  });

  test('scorecard picked: that row is firm and can be the highest', () => {
    // A big HL EMI shrinks FOIR; Kotak's scorecard multiplier is on gross salary, so it wins.
    const hl = { id: 'hl', lender: 'SBI', productType: 'HL', emi: 100000, emisPaid: 50, emisRemaining: 150 };
    const best = evaluateBank(kotak, { ...profileWith('CAT A', 'Super green'), loans: [hl] }).best;
    const sc = best.methods.filter((m) => m.key.startsWith('multiplier_'));
    expect(sc).toHaveLength(1);
    expect(sc[0]).toMatchObject({ band: 'Super green', multiplier: 21, indicative: false, amount: 4200000 });
    expect(best.eligibleBy).toBe(sc[0].key);
  });
});

describe('Manual category (Kotak) needs no company search and survives a new one', () => {
  test('before any search: the pick is used and counts as confirmed', () => {
    expect(manualCompany(null, 'CAT B')).toEqual({ name: null, category: 'CAT B', categoryConfirmed: true, incorporationYear: null });
    expect(manualCompany(null, '').category).toBeNull();
    expect(manualCompany(null, undefined).category).toBeNull();
  });

  test('a new company search does not change the pick', () => {
    const first = { query: 'Acme Pvt Ltd', banks: {} };
    const second = { query: 'Beta Technologies Ltd', banks: { hdfc_bank: { candidates: [], pick: null, category: '' } } };
    expect(manualCompany(first, 'CAT A').category).toBe('CAT A');
    expect(manualCompany(second, 'CAT A')).toEqual({ name: 'Beta Technologies Ltd', category: 'CAT A', categoryConfirmed: true, incorporationYear: null });
  });

  test('engine evaluates Kotak from the pick alone, before any search', () => {
    const c = manualCompany(null, 'CAT A');
    const r = evaluateBank(kotak, {
      netSalary: 100000, salaryAccountBank: 'ICICI Bank',
      company: { ...c, categoriesByBank: { kotak: c.category }, confirmedByBank: {} },
      loans: [], cards: [], credit: { enquiryList: [] },
    });
    expect(r.reasons.join()).not.toMatch(/company category/);
    expect(r.best.eligibleAmount).toBeGreaterThan(0);
  });
});
