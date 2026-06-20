// bankBehaviour.js — client-side bank-statement behaviour detector (no API).
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
  transferRails: ['IMPS','NEFT','RTGS','UPI','TFR','MMT','P2A']
};
const up = s => (s || '').toUpperCase();
const has = (text, list) => list.find(k => up(text).includes(k));
const num = v => Number(v) || 0;
function partyKey(desc) {
  let s = up(desc);
  s = s.replace(/\b(IMPS|NEFT|RTGS|UPI|MMT|TFR|WDL|DEP|P2A|P2M|TO|FROM|BY|CR|DR|REF|RRN|TXN|UTR|CMS|ME|SELF|OWN|ACCOUNT|ACCT|AC|A\/C)\b/g, ' ');
  s = s.replace(/[0-9]{4,}/g, ' '); s = s.replace(/[^A-Z ]/g, ' '); s = s.replace(/\s+/g, ' ').trim();
  return s.split(' ').filter(w => w.length > 2).slice(0, 3).join(' ');
}
function daysBetween(a, b) { const da = new Date(a), db = new Date(b); if (isNaN(da) || isNaN(db)) return 999; return Math.abs((da - db) / 86400000); }

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

const AMT = /\d{1,2}(?:,\d{2})*,\d{3}(?:\.\d{1,2})?|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{2}|\d{3,}/g;
const DATE = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})|(\d{1,2}[\-\s][A-Za-z]{3}[\-\s]\d{2,4})|(\d{4}-\d{2}-\d{2})/;
const toNum = s => Number(String(s).replace(/,/g, '')) || 0;
const round2 = n => Math.round(n * 100) / 100;
export function linesToTransactions(lines) {
  const txns = []; let prevBal = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    const dm = line.match(DATE); if (!dm) continue;
    const amounts = line.match(AMT); if (!amounts) continue;
    const nums = amounts.map(toNum).filter(n => n > 0); if (!nums.length) continue;
    const balance = nums[nums.length - 1]; let debit = 0, credit = 0, amount = 0;
    if (prevBal !== null) { const delta = round2(balance - prevBal); amount = Math.abs(delta); if (delta >= 0) credit = amount; else debit = amount; }
    else { amount = nums.length > 1 ? Math.max(...nums.slice(0, -1)) : 0; }
    prevBal = balance;
    let desc = line.replace(dm[0], ' '); amounts.forEach(a => { desc = desc.replace(a, ' '); });
    desc = desc.replace(/\s+/g, ' ').trim();
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
export async function analyzeBankStatement(arrayBuffer, accountHolder = '') {
  const lines = await pdfToLines(arrayBuffer);
  const transactions = linesToTransactions(lines);
  const detectors = runBehaviourDetectors(transactions, accountHolder);
  return { transactionCount: transactions.length, transactions, ...detectors };
}
