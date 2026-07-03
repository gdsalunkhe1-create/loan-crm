// bankBehaviour.js - client-side bank-statement behaviour detector (no API).
import * as pdfjsLib from 'pdfjs-dist';
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

const DICT = {
  brokers: ['ZERODHA','GROWW','UPSTOX','ANGEL ONE','ANGEL BROKING','ANGELONE','ICICI DIRECT','ICICIDIRECT','HDFC SEC','HDFC SECURITIES','HDFCSEC','KOTAK SEC','KOTAK SECURITIES','MOTILAL','SHAREKHAN','5PAISA','IIFL SEC','IIFL SECURITIES','PAYTM MONEY','DHAN','FYERS','ALICEBLUE','EDELWEISS','NUVAMA','SAMCO','NSE CLEARING','NSCCL','ICCL','INDIAN CLEARING','NSE CM','NSE FO','BSE LTD'],
  posAggregators: ['RAZORPAY','PINE LABS','PINELABS','MSWIPE','EZETAP','BHARATPE','BHARAT PE','PAYTM POS','PHONEPE MERCHANT','INNOVITI','MOSAMBEE','WORLDLINE','POS SETTLEMENT','MERCHANT SETTLEMENT','CARD SETTLEMENT','CASH @ POS','CC FUNDING','PAYU','CCAVENUE','CASHFREE','BILLDESK MERCHANT'],
  returnWords: ['ECS RTN','ECS RETURN','NACH RTN','NACH RETURN','INWARD RTN','INW RTN','I/W RETURN','O/W RETURN','CHQ RETURN','CHEQUE RETURN','CHQ RTN','DISHONOUR','DISHONOR','INSUFFICIENT','UNPAID','RETURN UNPAID','BOUNCE','ACH RTN','ACH RETURN','MANDATE FAIL'],
  chargeWords: ['RETURN CHARGES','RETURN CHARGE','RTN CHRG','RTN CHARGES','RET CHRG','RET CHARGES','RETURN CHG','RTN CHG','INW CHQ RTN','ECS RET','NACH RET','ACH RET CHRG','PENAL CHARGES','CHEQUE RETURN CHARGE','I/W CHQ RTN CHG'],
  lenders: ['KREDITBEE','KREDIT BEE','NAVI','LAZYPAY','LAZY PAY','MONEYTAP','MONEY TAP','CASHE','EARLYSALARY','EARLY SALARY','FIBE','KISSHT','PAYSENSE','PAY SENSE','SMARTCOIN','SMART COIN','STASHFIN','STASH FIN','MPOKKET','M POKKET','SLICE','BRANCH','DHANI','RUPEEREDEE','TRUEBALANCE','TRUE BALANCE','AVAIL FINANCE','BHARAT LOAN','LOANTAP','LOAN TAP','POCKETCASH','KREDITONE','ZESTMONEY','ZEST MONEY'],
  wallets: ['PAYTM WALLET','PHONEPE WALLET','AMAZON PAY','AMAZONPAY','MOBIKWIK','FREECHARGE','OLA MONEY','OLAMONEY','AIRTEL MONEY','JIO MONEY','JIOMONEY','SLICE WALLET'],
  forex: ['OCTAFX','OCTA FX','EXNESS','IQ OPTION','IQOPTION','OLYMP TRADE','OLYMPTRADE','BINOMO','ETORO','XM GLOBAL','FXTM','AVATRADE','AVA TRADE','FBS','FOREX','FX TRADING','CFD TRADING'],
  transferRails: ['IMPS','NEFT','RTGS','UPI','TFR','MMT','P2A'],
  gambling: ['DREAM11','DREAM 11','MPL','MY11CIRCLE','MY 11 CIRCLE','PAYTM FIRST GAMES','BALLEBAAZI','BETWAY','1XBET','RUMMY','POKERBAAZI','ADDA52','ADDA 52','JUNGLEE RUMMY','RUMMYCIRCLE'],
  gst: ['GST ', 'GSTN', 'GOODS AND SERVICE TAX', 'GST PAYMENT', 'GSTIN'],
  insurance: ['LIC ', 'LIC PREMIUM', 'HDFC LIFE', 'ICICI PRU', 'ICICI PRUDENTIAL', 'SBI LIFE', 'MAX LIFE', 'BAJAJ ALLIANZ', 'TATA AIA', 'STAR HEALTH', 'HDFC ERGO', 'RELIANCE GENERAL', 'PREMIUM PAYMENT'],
  epf: ['EPFO', 'EPF CONTRIBUTION', 'PROVIDENT FUND', 'PF CONTRIBUTION', 'PF TRF'],
  emiKeywords: ['EMI', 'ACH D', 'ACH DEBIT', 'NACH DEBIT', 'ECS DEBIT', 'LOAN INSTALLMENT', 'LOAN INSTALMENT', 'INSTALLMENT', 'INSTALMENT', 'PLA', 'PDC', 'STANDING INSTRUCTION', 'SI DEBIT'],
  salaryKeywords: ['SALARY', 'SAL CR', 'SAL-', 'SAL/', 'PAYROLL', 'CMS', 'SAL TRF', 'MONTHLY SALARY', 'WAGES'],
  atm: ['ATM', 'CASH WDL', 'CASH WITHDRAWAL', 'ATM WDL', 'ATW'],
  banks: ['STATE BANK OF INDIA','SBI','HDFC BANK','HDFC','ICICI BANK','ICICI','AXIS BANK','KOTAK MAHINDRA','KOTAK','PUNJAB NATIONAL BANK','PNB','BANK OF BARODA','BOB','CANARA BANK','UNION BANK OF INDIA','UNION BANK','IDBI BANK','YES BANK','INDUSIND BANK','RBL BANK','FEDERAL BANK','SOUTH INDIAN BANK','KARUR VYSYA BANK','IDFC FIRST BANK','BANDHAN BANK','CITIBANK','CITI BANK','HSBC','STANDARD CHARTERED','DBS BANK','AU SMALL FINANCE BANK','EQUITAS SMALL FINANCE','UJJIVAN SMALL FINANCE','INDIAN OVERSEAS BANK','CENTRAL BANK OF INDIA','UCO BANK','BANK OF INDIA','BANK OF MAHARASHTRA','INDIAN BANK','KARNATAKA BANK','DCB BANK','JAMMU AND KASHMIR BANK'],
};

const up = s => (s || '').toUpperCase();
const has = (text, list) => list.find(k => up(text).includes(k));
const num = v => Number(v) || 0;
const round2 = n => Math.round(n * 100) / 100;

function partyKey(desc) {
  let s = up(desc);
  s = s.replace(/\b(IMPS|NEFT|RTGS|UPI|MMT|TFR|WDL|DEP|P2A|P2M|TO|FROM|BY|CR|DR|REF|RRN|TXN|UTR|CMS|ME|SELF|OWN|ACCOUNT|ACCT|AC|A\/C)\b/g, ' ');
  s = s.replace(/[0-9]{4,}/g, ' '); s = s.replace(/[^A-Z ]/g, ' '); s = s.replace(/\s+/g, ' ').trim();
  return s.split(' ').filter(w => w.length > 2).slice(0, 3).join(' ');
}
function daysBetween(a, b) { const da = new Date(a), db = new Date(b); if (isNaN(da) || isNaN(db)) return 999; return Math.abs((da - db) / 86400000); }

const MON = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
function parseDateFlexible(str) {
  if (!str) return null;
  const s = String(str).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    y = y.length === 2 ? (+y > 50 ? '19' + y : '20' + y) : y;
    return new Date(+y, +mo - 1, +d);
  }
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s]?(\d{2,4})$/);
  if (m) {
    let [, d, mon, y] = m;
    const mi = MON[mon.slice(0, 3).toLowerCase()];
    if (mi === undefined) return null;
    y = y.length === 2 ? (+y > 50 ? '19' + y : '20' + y) : y;
    return new Date(+y, mi, +d);
  }
  return null;
}
const monthLabel = d => d ? d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }).replace(' ', '-') : '';
const monthSortKey = d => d ? d.getFullYear() * 12 + d.getMonth() : -1;

export function runBehaviourDetectors(txns, accountHolder = '') {
  const holderTokens = up(accountHolder).split(/\s+/).filter(w => w.length > 2);
  const stock = txns.filter(t => has(t.description, DICT.brokers));
  const stock_market_activity = { detected: stock.length > 0, transaction_count: stock.length, total_invested: stock.reduce((s, t) => s + num(t.debit), 0), total_withdrawn: stock.reduce((s, t) => s + num(t.credit), 0), brokers_seen: [...new Set(stock.map(t => has(t.description, DICT.brokers)))], transactions: stock.map(t => ({ broker: has(t.description, DICT.brokers), date: t.date, amount: num(t.debit) || num(t.credit), direction: num(t.debit) ? 'DEBIT' : 'CREDIT', description: t.description })) };
  const rot = txns.filter(t => num(t.credit) > 0 && has(t.description, DICT.posAggregators));
  const cc_card_rotation = { detected: rot.length > 0, transaction_count: rot.length, total_amount: rot.reduce((s, t) => s + num(t.credit), 0), transactions: rot.map(t => ({ vendor: has(t.description, DICT.posAggregators), date: t.date, amount: num(t.credit), description: t.description })) };
  const returns = txns.filter(t => has(t.description, DICT.returnWords) && !has(t.description, DICT.chargeWords));
  const charges = txns.filter(t => has(t.description, DICT.chargeWords));
  const usedCharge = new Set();
  const ecs_returns = returns.map(r => { let match = null; charges.forEach((c, i) => { if (!usedCharge.has(i) && daysBetween(r.date, c.date) <= 3 && !match) { match = c; usedCharge.add(i); } }); return { party: partyKey(r.description) || 'UNKNOWN', return_type: up(r.description).includes('NACH') ? 'NACH' : up(r.description).includes('ECS') ? 'ECS' : (up(r.description).includes('CHQ') || up(r.description).includes('CHEQUE')) ? 'CHEQUE' : 'AUTO_DEBIT', return_date: r.date, return_amount: num(r.debit) || num(r.credit), charge_date: match ? match.date : '', charge_amount: match ? num(match.debit) : 0, charge_description: match ? match.description : '' }; });
  charges.forEach((c, i) => { if (!usedCharge.has(i)) ecs_returns.push({ party: 'UNMATCHED', return_type: 'AUTO_DEBIT', return_date: '', return_amount: 0, charge_date: c.date, charge_amount: num(c.debit), charge_description: c.description }); });
  const disb = txns.filter(t => num(t.credit) > 0 && has(t.description, DICT.lenders));
  const lendersSeen = [...new Set(disb.map(t => has(t.description, DICT.lenders)))];
  const small_loan_disbursals = { detected: disb.length > 0, frequent: disb.length >= 2 || lendersSeen.length >= 3, disbursal_count: disb.length, total_disbursed: disb.reduce((s, t) => s + num(t.credit), 0), lenders_seen: lendersSeen, disbursals: disb.map(t => ({ lender: has(t.description, DICT.lenders), date: t.date, amount: num(t.credit), description: t.description })) };
  const wallet_to_bank = txns.filter(t => has(t.description, DICT.wallets)).map(t => ({ wallet: has(t.description, DICT.wallets), date: t.date, amount: num(t.debit) || num(t.credit), direction: num(t.credit) ? 'WALLET_TO_BANK' : 'BANK_TO_WALLET' }));
  const groups = {}; const selfRe = /\b(SELF|OWN\s*A\/?C|OWN\s*ACCOUNT)\b/i;
  txns.filter(t => has(t.description, DICT.transferRails)).forEach(t => { const k = partyKey(t.description); if (!k) return; if (!groups[k]) groups[k] = { beneficiary: k, total_amount: 0, transfer_count: 0, dates: [], self_hint: false }; groups[k].total_amount += num(t.debit) || num(t.credit); groups[k].transfer_count += 1; groups[k].dates.push(t.date); if (selfRe.test(t.description)) groups[k].self_hint = true; });
  const frequent_transfers = Object.values(groups).filter(g => g.transfer_count >= 3).map(g => { const sorted = g.dates.filter(Boolean).sort(); const is_self = g.self_hint || holderTokens.some(tok => g.beneficiary.includes(tok)); return { beneficiary: g.beneficiary, is_self, total_amount: g.total_amount, transfer_count: g.transfer_count, first_date: sorted[0] || '', last_date: sorted[sorted.length - 1] || '' }; }).sort((a, b) => b.transfer_count - a.transfer_count).slice(0, 10);
  const forex_trading = txns.filter(t => has(t.description, DICT.forex)).map(t => ({ platform: has(t.description, DICT.forex), date: t.date, amount: num(t.debit) || num(t.credit), direction: num(t.debit) ? 'DEBIT' : 'CREDIT', description: t.description }));
  return { stock_market_activity, cc_card_rotation, ecs_returns, small_loan_disbursals, wallet_to_bank, frequent_transfers, forex_trading };
}

function detectHeader(fullText, transactions) {
  const t = up(fullText);
  const bank_name = has(t, DICT.banks) || '';
  let account_number = '';
  let m = t.match(/A\/?C(?:COUNT)?\s*(?:NO|NUMBER|NUM)?\.?\s*[:-]?\s*(X{2,}\d{2,}|\d{9,18})/);
  if (m) account_number = m[1];
  let account_holder = '';
  m = fullText.match(/(?:Account\s*Name|Customer\s*Name|Name\s*of\s*(?:the\s*)?(?:Account\s*)?Holder|Dear)\s*[:-]?\s*([A-Z][A-Za-z .]{4,40})/);
  if (m) account_holder = m[1].trim().replace(/\s{2,}/g, ' ');
  const dates = transactions.map(t2 => parseDateFlexible(t2.date)).filter(Boolean).sort((a, b) => a - b);
  const statement_period = dates.length ? `${dates[0].toLocaleDateString('en-GB')} - ${dates[dates.length - 1].toLocaleDateString('en-GB')}` : '';
  return { bank_name, account_number, account_holder, statement_period };
}

function detectSalary(txns, holderTokens) {
  const credits = txns.filter(t => num(t.credit) > 0);
  const groups = {};
  credits.forEach(t => {
    let key = has(t.description, DICT.salaryKeywords) ? 'SALARY::' + partyKey(t.description) : partyKey(t.description);
    if (!key) return;
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  });
  let best = null, bestScore = -1;
  Object.entries(groups).forEach(([key, list]) => {
    if (list.length < 2) return;
    const amounts = list.map(t => num(t.credit));
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const variance = amounts.reduce((a, b) => a + (b - mean) ** 2, 0) / amounts.length;
    const cv = mean ? Math.sqrt(variance) / mean : 1;
    const salaryHint = key.startsWith('SALARY::') ? 2 : 1;
    const score = list.length * salaryHint * (cv < 0.3 ? 1.5 : 1) * mean;
    if (score > bestScore) { bestScore = score; best = { key: key.replace('SALARY::', ''), list, mean, cv }; }
  });
  return best;
}

function detectEmiObligations(txns) {
  const debits = txns.filter(t => num(t.debit) > 0 && (has(t.description, DICT.emiKeywords) || /\bEMI\b/i.test(t.description)));
  const groups = {};
  debits.forEach(t => {
    const k = partyKey(t.description) || 'EMI';
    if (!groups[k]) groups[k] = [];
    groups[k].push(t);
  });
  return Object.entries(groups).filter(([, list]) => list.length >= 2).map(([party, list]) => {
    const amounts = list.map(t => num(t.debit)).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    const dates = list.map(t => t.date).filter(Boolean).sort();
    return { party, amount: median, type: has(list[0].description, ['NACH']) ? 'NACH' : has(list[0].description, ['ECS']) ? 'ECS' : 'EMI', first_seen: dates[0] || '', last_seen: dates[dates.length - 1] || '', count: list.length };
  });
}

function detectCcVendorFunding(txns) {
  return txns.filter(t => num(t.credit) > 0 && has(t.description, DICT.lenders)).map(t => ({ vendor: has(t.description, DICT.lenders), date: t.date, amount: num(t.credit), description: t.description }));
}

function detectMonthlyCashflow(txns, ecsReturns) {
  const byMonth = {};
  txns.forEach(t => {
    const d = parseDateFlexible(t.date);
    const key = d ? monthSortKey(d) : -1;
    if (!byMonth[key]) byMonth[key] = { key, label: monthLabel(d), total_credit: 0, total_debit: 0, closing_balance: 0, lastDate: d, bounce_count: 0 };
    byMonth[key].total_credit += num(t.credit);
    byMonth[key].total_debit += num(t.debit);
    if (!byMonth[key].lastDate || (d && d >= byMonth[key].lastDate)) { byMonth[key].closing_balance = num(t.balance); byMonth[key].lastDate = d; }
  });
  ecsReturns.forEach(r => {
    const d = parseDateFlexible(r.return_date);
    if (!d) return;
    const key = monthSortKey(d);
    if (byMonth[key]) byMonth[key].bounce_count += 1;
  });
  return Object.values(byMonth).filter(m => m.key >= 0).sort((a, b) => a.key - b.key).map(m => ({ month: m.label, total_credit: round2(m.total_credit), total_debit: round2(m.total_debit), closing_balance: round2(m.closing_balance), bounce_count: m.bounce_count }));
}

function detectRepeatParties(txns) {
  const groups = {};
  txns.forEach(t => {
    const k = partyKey(t.description);
    if (!k) return;
    if (!groups[k]) groups[k] = { party: k, total_debit: 0, total_credit: 0, transaction_count: 0 };
    groups[k].total_debit += num(t.debit);
    groups[k].total_credit += num(t.credit);
    groups[k].transaction_count += 1;
  });
  return Object.values(groups).filter(g => g.transaction_count >= 2).sort((a, b) => b.transaction_count - a.transaction_count).slice(0, 10).map(g => ({ ...g, total_debit: round2(g.total_debit), total_credit: round2(g.total_credit), flag: (g.total_debit > 0 && g.total_credit > 0 && g.transaction_count >= 4) ? 'SUSPICIOUS' : 'NORMAL' }));
}

function detectRiskFlagsWatchlistPositive(txns, detectors, salaryList) {
  const risk_flags = [];
  const watchlist = [];
  const positive_signals = [];

  detectors.ecs_returns.forEach(r => { if (r.return_date) risk_flags.push({ type: 'BOUNCE', date: r.return_date, description: `${r.return_type} return - ${r.party}`, amount: r.return_amount, severity: 'HIGH' }); });

  const gamble = txns.filter(t => has(t.description, DICT.gambling));
  gamble.forEach(t => risk_flags.push({ type: 'GAMBLING', date: t.date, description: t.description, amount: num(t.debit) || num(t.credit), severity: num(t.debit) > 5000 ? 'HIGH' : 'MEDIUM' }));

  if (detectors.small_loan_disbursals.frequent) risk_flags.push({ type: 'LOAN_STACKING', date: detectors.small_loan_disbursals.disbursals[0]?.date || '', description: `${detectors.small_loan_disbursals.disbursal_count} app-loan disbursals across ${detectors.small_loan_disbursals.lenders_seen.length} lender(s)`, amount: detectors.small_loan_disbursals.total_disbursed, severity: 'HIGH' });

  if (detectors.cc_card_rotation.detected) risk_flags.push({ type: 'CC_FUNDING', date: detectors.cc_card_rotation.transactions[0]?.date || '', description: `${detectors.cc_card_rotation.transaction_count} POS/aggregator settlement credit(s) - possible card-to-cash`, amount: detectors.cc_card_rotation.total_amount, severity: 'MEDIUM' });

  const nearZero = txns.filter(t => t.balance !== undefined && t.balance !== null && num(t.balance) >= 0 && num(t.balance) < 500);
  nearZero.forEach(t => risk_flags.push({ type: 'MIN_BAL_CHARGE', date: t.date, description: `Near-zero balance (Rs.${num(t.balance)})`, amount: num(t.balance), severity: 'MEDIUM' }));

  txns.forEach(t => {
    const amt = num(t.debit) || num(t.credit);
    if (amt >= 5000 && amt % 1000 === 0) watchlist.push({ type: 'ROUND_FIGURE', date: t.date, description: t.description, amount: amt });
    if (amt >= 20000 && /UPI/i.test(t.description)) watchlist.push({ type: 'UPI_LARGE', date: t.date, description: t.description, amount: amt });
  });
  const cheq = detectors.ecs_returns.filter(r => r.return_type === 'CHEQUE' && r.return_date);
  cheq.forEach(r => watchlist.push({ type: 'INWARD_CHEQUE_RETURN', date: r.return_date, description: r.party, amount: r.return_amount }));
  const atmTxns = txns.filter(t => has(t.description, DICT.atm) && num(t.debit) > 0);
  if (atmTxns.length >= 5) watchlist.push({ type: 'FREQUENT_ATM', date: atmTxns[atmTxns.length - 1].date, description: `${atmTxns.length} ATM withdrawals in statement period`, amount: round2(atmTxns.reduce((s, t) => s + num(t.debit), 0)) });

  if (salaryList) salaryList.list.forEach(t => positive_signals.push({ type: 'REGULAR_SALARY', date: t.date, description: t.description, amount: num(t.credit) }));
  txns.filter(t => has(t.description, DICT.gst)).forEach(t => positive_signals.push({ type: 'GST_PAYMENT', date: t.date, description: t.description, amount: num(t.debit) || num(t.credit) }));
  txns.filter(t => has(t.description, DICT.insurance)).forEach(t => positive_signals.push({ type: 'INSURANCE_PREMIUM', date: t.date, description: t.description, amount: num(t.debit) }));
  txns.filter(t => has(t.description, DICT.epf)).forEach(t => positive_signals.push({ type: 'EPF', date: t.date, description: t.description, amount: num(t.debit) || num(t.credit) }));

  return {
    risk_flags: risk_flags.slice(0, 30),
    watchlist: watchlist.slice(0, 15),
    positive_signals: positive_signals.slice(0, 10),
  };
}

export function computeCreditAssessment(transactions, fullText, detectors, accountHolderOverride = '') {
  const header = detectHeader(fullText, transactions);
  const account_holder = accountHolderOverride || header.account_holder;
  const holderTokens = up(account_holder).split(/\s+/).filter(w => w.length > 2);

  const total_credits = round2(transactions.reduce((s, t) => s + num(t.credit), 0));
  const total_debits = round2(transactions.reduce((s, t) => s + num(t.debit), 0));
  const balances = transactions.map(t => num(t.balance)).filter(b => b > 0 || b === 0);
  const average_monthly_balance = balances.length ? round2(balances.reduce((a, b) => a + b, 0) / balances.length) : 0;
  const closing_balance = transactions.length ? num(transactions[transactions.length - 1].balance) : 0;
  const first = transactions[0];
  const opening_balance = first ? round2(num(first.balance) - num(first.credit) + num(first.debit)) : 0;

  const salary = detectSalary(transactions, holderTokens);
  const monthsInPeriod = (() => {
    const dates = transactions.map(t => parseDateFlexible(t.date)).filter(Boolean);
    if (!dates.length) return 1;
    const min = new Date(Math.min(...dates)), max = new Date(Math.max(...dates));
    return Math.max(1, Math.round((max - min) / (30 * 86400000)));
  })();
  const estimated_monthly_income = salary ? round2(salary.mean) : (total_credits > 0 ? round2(total_credits / monthsInPeriod) : 0);
  const income_stability = !salary ? 'IRREGULAR' : salary.cv < 0.15 ? 'STABLE' : salary.cv < 0.35 ? 'IRREGULAR' : 'UNSTABLE';

  const emi_obligations = detectEmiObligations(transactions);
  const total_emi_burden = round2(emi_obligations.reduce((s, e) => s + e.amount, 0));
  const foir_estimate = estimated_monthly_income > 0 ? Math.round((total_emi_burden / estimated_monthly_income) * 100) : 0;

  const cc_vendor_funding = detectCcVendorFunding(transactions);
  const monthly_cashflow = detectMonthlyCashflow(transactions, detectors.ecs_returns);
  const repeat_parties = detectRepeatParties(transactions);
  const { risk_flags, watchlist, positive_signals } = detectRiskFlagsWatchlistPositive(transactions, detectors, salary);

  const bounceCount = detectors.ecs_returns.filter(r => r.return_date).length;
  let overall_risk = 'LOW', recommendation = 'PROCEED';
  if (foir_estimate >= 50 || bounceCount >= 2 || detectors.small_loan_disbursals.frequent) { overall_risk = 'HIGH'; recommendation = 'REJECT'; }
  else if (foir_estimate >= 30 || bounceCount === 1 || detectors.cc_card_rotation.detected) { overall_risk = 'MEDIUM'; recommendation = 'CAUTION'; }

  const summary_notes = [
    salary ? `Recurring credit pattern detected (${salary.list.length}x, avg Rs.${estimated_monthly_income.toLocaleString('en-IN')}).` : 'No clear recurring salary pattern found - income estimate uses average monthly credits.',
    bounceCount > 0 ? `${bounceCount} auto-debit bounce(s) found.` : 'No auto-debit bounces detected.',
    detectors.cc_card_rotation.detected ? 'Possible card-to-cash / POS settlement funding pattern observed.' : '',
    `FOIR ~ ${foir_estimate}% against total EMI burden of Rs.${total_emi_burden.toLocaleString('en-IN')}.`,
    'Heuristic local screen - verify against salary slips / CIBIL before final decision.'
  ].filter(Boolean).join(' ');

  return {
    summary: {
      account_holder,
      bank_name: header.bank_name,
      account_number: header.account_number,
      statement_period: header.statement_period,
      total_credits, total_debits, average_monthly_balance, closing_balance, opening_balance,
    },
    credit_assessment: {
      overall_risk, income_stability, estimated_monthly_income, total_emi_burden, foir_estimate, recommendation, summary_notes,
    },
    risk_flags, watchlist, positive_signals, emi_obligations, cc_vendor_funding, monthly_cashflow, repeat_parties,
  };
}

const AMT = /\d{1,2}(?:,\d{2})*,\d{3}(?:\.\d{1,2})?|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{2}|\d{3,}/g;
const DATE = /(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})|(\d{1,2}[-\s][A-Za-z]{3}[-\s]\d{2,4})|(\d{4}-\d{2}-\d{2})/;
const toNum = s => Number(String(s).replace(/,/g, '')) || 0;
export function linesToTransactions(lines) {
  const txns = []; let prevBal = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    const dm = line.match(DATE); if (!dm) continue;
    const amounts = line.match(AMT); if (!amounts) continue;
    const nums = amounts.map(toNum).filter(n => n > 0); if (!nums.length) continue;
    const balance = nums[nums.length - 1]; let debit = 0, credit = 0, amount = 0, isFirst = false;
    if (prevBal !== null) { const delta = round2(balance - prevBal); amount = Math.abs(delta); if (delta >= 0) credit = amount; else debit = amount; }
    else { amount = nums.length > 1 ? Math.max(...nums.slice(0, -1)) : 0; isFirst = true; }
    prevBal = balance;
    let desc = line.replace(dm[0], ' '); amounts.forEach(a => { desc = desc.replace(a, ' '); });
    desc = desc.replace(/\s+/g, ' ').trim();
    if (isFirst && amount > 0) {
      const u = desc.toUpperCase();
      if (/\bCR\b|CREDIT/.test(u) || has(desc, DICT.salaryKeywords)) credit = amount;
      else if (/\bDR\b|DEBIT/.test(u) || has(desc, DICT.returnWords) || has(desc, DICT.emiKeywords)) debit = amount;
    }
    txns.push({ date: dm[0], description: desc, debit, credit, balance });
  }
  return txns;
}
async function pdfToLines(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise; const allLines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p); const content = await page.getTextContent(); const rows = {};
    content.items.forEach(it => { if (!it.str || !it.str.trim()) return; const y = Math.round(it.transform[5]); const key = Math.round(y / 3) * 3; (rows[key] = rows[key] || []).push({ x: it.transform[4], s: it.str }); });
    Object.keys(rows).map(Number).sort((a, b) => b - a).forEach(k => { const line = rows[k].sort((a, b) => a.x - b.x).map(o => o.s).join(' '); allLines.push(line); });
  }
  return allLines;
}

function categorizeTxn(t) {
  const d = t.description;
  if (has(d, DICT.returnWords) || has(d, DICT.chargeWords)) return 'BOUNCE';
  if (has(d, DICT.gambling)) return 'GAMBLING';
  if (num(t.credit) > 0 && has(d, DICT.lenders)) return 'CC_FUNDING';
  if (num(t.credit) > 0 && has(d, DICT.posAggregators)) return 'CC_FUNDING';
  if (num(t.credit) > 0 && has(d, DICT.salaryKeywords)) return 'SALARY';
  if (num(t.debit) > 0 && has(d, DICT.emiKeywords)) return 'EMI';
  if (has(d, DICT.atm)) return 'ATM';
  if (has(d, DICT.gst)) return 'GST';
  if (has(d, DICT.insurance)) return 'INSURANCE';
  if (has(d, DICT.epf)) return 'EPF';
  if (has(d, DICT.brokers)) return 'STOCK';
  if (has(d, DICT.forex)) return 'FOREX';
  if (/UPI/i.test(d)) return 'UPI';
  if (has(d, DICT.transferRails)) return 'TRANSFER';
  return 'OTHER';
}
function buildAllTransactions(transactions) {
  return transactions.map(t => {
    const category = categorizeTxn(t);
    return { date: t.date, description: t.description, debit: t.debit, credit: t.credit, balance: t.balance, category, flag: (category === 'BOUNCE' || category === 'GAMBLING') ? category : '' };
  });
}

export async function analyzeBankStatement(arrayBuffer, accountHolderOverride = '') {
  const lines = await pdfToLines(arrayBuffer);
  const transactions = linesToTransactions(lines);
  const fullText = lines.join('\n');
  const detectors = runBehaviourDetectors(transactions, accountHolderOverride);
  const assessment = computeCreditAssessment(transactions, fullText, detectors, accountHolderOverride);
  return {
    transactionCount: transactions.length,
    transactions,
    all_transactions: buildAllTransactions(transactions),
    ...detectors,
    ...assessment,
  };
}