import { parseDate, mapProductType, cibilToProfile, bankStatementToProfile, buildCibilRow, buildBsaRow, passwordErrorKind, detectPayslipMonth, averageNetPay, buildProfileDraft, normalizeMobile, extractEmployerName, companyNameVariants, summarizeEmployer, normalizePersonName, treatmentPatch, treatmentChoice, loanStatus, hlJointPatch, hlPayerPatch } from './underwritingAdapters';
import { parseSalaryText } from '../pages/TaxCalculator';
import { evaluateBank } from './underwritingEngine';
import policy from './hdfc_pl_policy.json';

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
  expect(p.cards).toEqual([{ id: 'C1', issuer: 'HDFC BANK', outstanding: 45000, paidBeforeLoginWithProof: 0 }]);
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

  test('status pill per loan from the best scenario', () => {
    const best = { bt: ['a'] };
    const line = (amount) => ({ obligation: { amount } });
    expect(loanStatus({ id: 'a' }, line(9000), best)).toBe('bt');
    expect(loanStatus({ id: 'b' }, line(9000), best)).toBe('obligated');
    expect(loanStatus({ id: 'c' }, line(0), best)).toBe('not_counted');
    expect(loanStatus({ id: 'd', closedBeforeLoginWithProof: true }, null, null)).toBe('closed');
    expect(loanStatus({ id: 'e' }, null, null)).toBeNull();
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
