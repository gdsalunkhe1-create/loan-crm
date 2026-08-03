// bankBehaviour.js - client-side bank-statement behaviour detector (no API).
import * as pdfjsLib from 'pdfjs-dist';
pdfjsLib.GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL}/pdf.worker.min.mjs`;

const DICT = {
  brokers: ['ZERODHA','GROWW','UPSTOX','ANGEL ONE','ANGEL BROKING','ANGELONE','ICICI DIRECT','ICICIDIRECT','HDFC SEC','HDFC SECURITIES','HDFCSEC','KOTAK SEC','KOTAK SECURITIES','MOTILAL','SHAREKHAN','5PAISA','IIFL SEC','IIFL SECURITIES','PAYTM MONEY','DHAN','FYERS','ALICEBLUE','EDELWEISS','NUVAMA','SAMCO','NSE CLEARING','NSCCL','ICCL','INDIAN CLEARING','NSE CM','NSE FO','BSE LTD'],
  posAggregators: ['RAZORPAY','PINE LABS','PINELABS','MSWIPE','EZETAP','BHARATPE','BHARAT PE','PAYTM POS','PHONEPE MERCHANT','INNOVITI','MOSAMBEE','WORLDLINE','POS SETTLEMENT','MERCHANT SETTLEMENT','CARD SETTLEMENT','CASH @ POS','CC FUNDING','PAYU','CCAVENUE','CASHFREE','BILLDESK MERCHANT'],
  returnWords: ['ECS RTN','ECS RETURN','NACH RTN','NACH RETURN','INWARD RTN','INW RTN','I/W RETURN','O/W RETURN','CHQ RETURN','CHEQUE RETURN','CHQ RTN','DISHONOUR','DISHONOR','INSUFFICIENT','UNPAID','RETURN UNPAID','BOUNCE','ACH RTN','ACH RETURN','MANDATE FAIL'],
  chargeWords: ['RETURN CHARGES','RETURN CHARGE','RTN CHRG','RTN CHARGES','RET CHRG','RET CHARGES','RETURN CHG','RTN CHG','INW CHQ RTN','ECS RET','NACH RET','ACH RET CHRG','PENAL CHARGES','CHEQUE RETURN CHARGE','I/W CHQ RTN CHG'],
  lenders: ['KREDITBEE','KREDIT BEE','KRAZYBEE','NAVI','LAZYPAY','LAZY PAY','MONEYTAP','MONEY TAP','CASHE','EARLYSALARY','EARLY SALARY','FIBE','KISSHT','PAYSENSE','PAY SENSE','SMARTCOIN','SMART COIN','STASHFIN','STASH FIN','MPOKKET','M POKKET','SLICE','BRANCH','DHANI','RUPEEREDEE','TRUEBALANCE','TRUE BALANCE','AVAIL FINANCE','BHARAT LOAN','LOANTAP','LOAN TAP','POCKETCASH','KREDITONE','ZESTMONEY','ZEST MONEY','KISETSU','KISETSU SAISON','RESPO FINANCIAL','RESPO','INCRED FINANCE','INCRED','AMAZON PAY LATER'],
  wallets: ['PAYTM WALLET','PHONEPE WALLET','AMAZON PAY','AMAZONPAY','MOBIKWIK','FREECHARGE','OLA MONEY','OLAMONEY','AIRTEL MONEY','JIO MONEY','JIOMONEY','SLICE WALLET'],
  forex: ['OCTAFX','OCTA FX','EXNESS','IQ OPTION','IQOPTION','OLYMP TRADE','OLYMPTRADE','BINOMO','ETORO','XM GLOBAL','FXTM','AVATRADE','AVA TRADE','FBS','FOREX','FX TRADING','CFD TRADING'],
  transferRails: ['IMPS','NEFT','RTGS','UPI','TFR','MMT','P2A'],
  gambling: ['DREAM11','DREAM 11','MPL','MY11CIRCLE','MY 11 CIRCLE','PAYTM FIRST GAMES','BALLEBAAZI','BETWAY','1XBET','RUMMY','POKERBAAZI','ADDA52','ADDA 52','JUNGLEE RUMMY','RUMMYCIRCLE'],
  gst: ['GST ', 'GSTN', 'GOODS AND SERVICE TAX', 'GST PAYMENT', 'GSTIN'],
  insurance: ['LIC ', 'LIC PREMIUM', 'HDFC LIFE', 'ICICI PRU', 'ICICI PRUDENTIAL', 'SBI LIFE', 'MAX LIFE', 'BAJAJ ALLIANZ', 'TATA AIA', 'STAR HEALTH', 'HDFC ERGO', 'RELIANCE GENERAL', 'PREMIUM PAYMENT'],
  epf: ['EPFO', 'EPF CONTRIBUTION', 'PROVIDENT FUND', 'PF CONTRIBUTION', 'PF TRF'],
  emiKeywords: ['EMI', 'ACH D', 'ACH DEBIT', 'ACH-DR', 'ACH DR', 'NACH DEBIT', 'NACH TRXN', 'NACH TRANSACTION', 'ECS DEBIT', 'LOAN INSTALLMENT', 'LOAN INSTALMENT', 'INSTALLMENT', 'INSTALMENT', 'PLA', 'PDC', 'STANDING INSTRUCTION', 'SI DEBIT'],
  salaryKeywords: ['SALARY', 'SAL CR', 'SAL-', 'SAL/', 'PAYROLL', 'CMS', 'SAL TRF', 'MONTHLY SALARY', 'WAGES'],
  atm: ['ATM', 'CASH WDL', 'CASH WITHDRAWAL', 'ATM WDL', 'ATW'],
  // Cash-deposit narrations vary a lot by bank ("BY CASH -<branch>", "CASH
  // DEP-Other", "CDM DEP", "CASH CR") but all indicate money entering the
  // account with no traceable source - a standard underwriting red flag
  // (RBI-aligned "unexplained cash deposit" category) distinct from a
  // regular bank-transfer credit.
  cashDeposit: ['BY CASH', 'CASH DEP', 'CASH DEPOSIT', 'CDM DEP', 'CASH CR', 'DEPOSIT BY CASH', 'CASH REMIT'],
  // Full names AND common short forms are both listed - detectBankName()
  // always keeps the longest match it finds, so having both present never
  // lets an abbreviation win over a fuller name that's also there; it just
  // means the abbreviation-only statements (many PSU banks print just
  // "PNB" / "SBI" on the letterhead, not the full name) still match.
  banks: [
    // Public sector banks
    'STATE BANK OF INDIA','SBI',
    'BANK OF INDIA','BOI',
    'BANK OF MAHARASHTRA',
    'CANARA BANK',
    'CENTRAL BANK OF INDIA',
    'INDIAN BANK',
    'INDIAN OVERSEAS BANK','IOB',
    'PUNJAB AND SIND BANK','PUNJAB & SIND BANK',
    'PUNJAB NATIONAL BANK','PNB',
    'UCO BANK',
    'UNION BANK OF INDIA','UNION BANK',
    'BANK OF BARODA','BOB',
    // Private sector banks
    'AXIS BANK',
    'BANDHAN BANK',
    'CSB BANK','CATHOLIC SYRIAN BANK',
    'CITY UNION BANK',
    'DCB BANK','DEVELOPMENT CREDIT BANK',
    'DHANLAXMI BANK','DHANALAKSHMI BANK',
    'FEDERAL BANK',
    'HDFC BANK','HDFC',
    'ICICI BANK','ICICI',
    'INDUSIND BANK',
    'IDFC FIRST BANK','IDFC BANK',
    'JAMMU AND KASHMIR BANK','JAMMU & KASHMIR BANK','J&K BANK',
    'KARNATAKA BANK',
    'KARUR VYSYA BANK',
    'KOTAK MAHINDRA BANK','KOTAK MAHINDRA','KOTAK',
    'NAINITAL BANK',
    'RBL BANK',
    'SOUTH INDIAN BANK',
    'TAMILNAD MERCANTILE BANK',
    'YES BANK',
    'IDBI BANK',
    // Foreign / small-finance banks already in scope
    'CITIBANK','CITI BANK','HSBC','STANDARD CHARTERED','DBS BANK',
    'AU SMALL FINANCE BANK','EQUITAS SMALL FINANCE','UJJIVAN SMALL FINANCE',
  ],
};

const up = s => (s || '').toUpperCase();
const has = (text, list) => list.find(k => up(text).includes(k));
const num = v => Number(v) || 0;
const round2 = n => Math.round(n * 100) / 100;

function partyKey(desc) {
  let s = up(desc);
  // Some banks (e.g. HSBC) glue the rail code straight onto its reference
  // number with no separator - "UPI20260715000339403" - so the \b-bounded
  // word list below never matches (no boundary between "I" and "2"). Strip
  // that form first, then fall through to the normal bounded-word pass.
  s = s.replace(/\b(IMPS|NEFT|RTGS|UPI|TFR|MMT|P2A)\d+/g, ' ');
  // Strip UPI VPA handles wholesale ("9160870767@ybl", "sathyabandaru5@axl")
  // BEFORE digit stripping. Stripping only the digit run first leaves the
  // bare PSP-bank-code suffix ("ybl"/"axl"/"ibl") behind as a stray word,
  // and that suffix varies transaction-to-transaction for the SAME real
  // counterparty (same person routing through different banks), so the
  // same party would otherwise fragment into different keys across their
  // own transaction history - breaking self-transfer, EMI-lender, and
  // repeat-party grouping continuity.
  s = s.replace(/[A-Z0-9.]+@[A-Z0-9]+/g, ' ');
  s = s.replace(/\b(TRANSFER|CLEARING\s*CHEQUES?|IMPS|NEFT|RTGS|UPI|MMT|TFR|WDL|DEP|P2A|P2M|TO|FROM|BY|CR|DR|REF|RRN|TXN|UTR|CMS|ME|SELF|OWN|ACCOUNT|ACCT|AC|A\/C)\b/g, ' ');
  s = s.replace(/[0-9]{4,}/g, ' '); s = s.replace(/[^A-Z ]/g, ' '); s = s.replace(/\s+/g, ' ').trim();
  return s.split(' ').filter(w => w.length > 2).slice(0, 3).join(' ');
}
// MUST use parseDateFlexible, never the native Date constructor directly -
// JS's Date parser silently misreads dot-separated dates (treats
// "09.04.2026" as if it were slash-formatted and swaps day/month, and
// rejects "31.10.2025" outright as an invalid month "31"). Every bank that
// prints DD.MM.YYYY with dots (ICICI included) would silently corrupt every
// days-between comparison - bounce/charge pairing, round-trip pairing -
// without ever throwing an error to reveal it.
function daysBetween(a, b) { const da = parseDateFlexible(a), db = parseDateFlexible(b); if (!da || !db) return 999; return Math.abs((da - db) / 86400000); }

const MON = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
function parseDateFlexible(str) {
  if (!str) return null;
  const s = String(str).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
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
// Sorts an array of raw date STRINGS (whatever format the bank prints -
// DD.MM.YYYY, DD/MM/YYYY, DD-MMM-YYYY) chronologically, by parsing each
// through parseDateFlexible before comparing. A plain .sort() on the raw
// strings (what every first_seen/last_seen computation used before this)
// sorts by the DAY digit first, which is essentially arbitrary with
// respect to real chronological order - "02.01.2026" (2 Jan) string-sorts
// BEFORE "08.12.2025" (8 Dec) even though Dec 2025 is five weeks earlier.
// Found via building the EMI payment grid: an obligation's real first
// payment (Nov 2025) was being reported as starting in Jan 2026 because
// of this. Returns the ORIGINAL strings, just correctly ordered - display
// stays in whatever format the source used.
function sortDateStrings(dateStrs) {
  return [...dateStrs].sort((a, b) => {
    const da = parseDateFlexible(a), db = parseDateFlexible(b);
    if (!da || !db) return 0;
    return da - db;
  });
}
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
  const frequent_transfers = Object.values(groups).filter(g => g.transfer_count >= 3).map(g => { const sorted = sortDateStrings(g.dates.filter(Boolean)); const is_self = g.self_hint || holderTokens.some(tok => g.beneficiary.includes(tok)); return { beneficiary: g.beneficiary, is_self, total_amount: g.total_amount, transfer_count: g.transfer_count, first_date: sorted[0] || '', last_date: sorted[sorted.length - 1] || '' }; }).sort((a, b) => b.transfer_count - a.transfer_count).slice(0, 10);
  const forex_trading = txns.filter(t => has(t.description, DICT.forex)).map(t => ({ platform: has(t.description, DICT.forex), date: t.date, amount: num(t.debit) || num(t.credit), direction: num(t.debit) ? 'DEBIT' : 'CREDIT', description: t.description }));

  // Unexplained cash deposits - flags every credit whose narration matches
  // a cash-deposit pattern for ANY bank format, since the wording is not
  // standardized ("BY CASH -BRANCH", "CASH DEP-Other/date/txnid", "CDM DEP").
  const cashTxns = txns.filter(t => num(t.credit) > 0 && has(t.description, DICT.cashDeposit));
  const cash_deposits = { detected: cashTxns.length > 0, transaction_count: cashTxns.length, total_amount: round2(cashTxns.reduce((s, t) => s + num(t.credit), 0)), transactions: cashTxns.map(t => ({ date: t.date, amount: num(t.credit), description: t.description })) };

  // Circular / round-tripping transactions - the same counterparty (by
  // partyKey) receiving a debit and then sending back a credit (or vice
  // versa) within a short window, repeated more than once. This is the
  // "inflate apparent turnover" fraud pattern - distinct from a plain
  // frequent-transfer relationship, which frequent_transfers already
  // covers but doesn't specifically test the debit<->credit round-trip.
  const circGroups = {};
  txns.filter(t => has(t.description, DICT.transferRails)).forEach(t => {
    const k = partyKey(t.description);
    if (!k) return;
    if (!circGroups[k]) circGroups[k] = [];
    circGroups[k].push(t);
  });
  const ROUND_TRIP_DAYS = 5;
  const circular_transactions = Object.entries(circGroups).map(([party, list]) => {
    const debits = list.filter(t => num(t.debit) > 0).sort((a, b) => (parseDateFlexible(a.date) || 0) - (parseDateFlexible(b.date) || 0));
    const credits = list.filter(t => num(t.credit) > 0).sort((a, b) => (parseDateFlexible(a.date) || 0) - (parseDateFlexible(b.date) || 0));
    if (!debits.length || !credits.length) return null;
    const usedCredit = new Set();
    const pairs = [];
    debits.forEach(d => {
      const match = credits.find((c, i) => !usedCredit.has(i) && daysBetween(d.date, c.date) <= ROUND_TRIP_DAYS);
      if (match) { usedCredit.add(credits.indexOf(match)); pairs.push({ out_date: d.date, out_amount: num(d.debit), in_date: match.date, in_amount: num(match.credit) }); }
    });
    if (pairs.length < 2) return null;
    return { party, round_trip_count: pairs.length, total_debit: round2(list.reduce((s, t) => s + num(t.debit), 0)), total_credit: round2(list.reduce((s, t) => s + num(t.credit), 0)), pairs };
  }).filter(Boolean).sort((a, b) => b.round_trip_count - a.round_trip_count).slice(0, 10);

  return { stock_market_activity, cc_card_rotation, ecs_returns, small_loan_disbursals, wallet_to_bank, frequent_transfers, forex_trading, cash_deposits, circular_transactions };
}

// Bank name must come from the statement's own header/letterhead area, not
// the whole document - the ledger body is full of NEFT/IMPS/UPI transaction
// descriptions that reference OTHER banks as transfer counterparties, and a
// generic "first array match wins" lookup over the full text will latch onto
// whichever bank name happens to sit earliest/longest (e.g. a NEFT
// counterparty like "Canara Bank") rather than the issuing bank.
function detectBankName(headerText, fullTextUpper) {
  // Strongest signal: an explicit self-declaration such as "Statement of
  // Axis Account No: ..." or "AXIS BANK LIMITED - STATEMENT OF ACCOUNT".
  // Some banks (e.g. Axis) never print their own name as an exact "X BANK"
  // phrase anywhere in the text layer (the logo is an image, not text) -
  // only this kind of self-declaration reveals it.
  const selfDeclare = (fullTextUpper || '').match(/STATEMENT\s+OF\s+([A-Z][A-Z\s]{2,30}?)\s+(?:BANK\s+)?ACCOUNT/) || (fullTextUpper || '').match(/([A-Z][A-Z\s]{2,30}?BANK[A-Z\s]{0,20})\s*(?:LIMITED|LTD)?\s*-\s*STATEMENT/);
  if (selfDeclare) {
    const candidate = selfDeclare[1].trim();
    const known = DICT.banks.find(b => candidate.includes(b) || b.includes(candidate));
    if (known) return known;
  }
  // Fallback: longest bank name match within the header block ONLY (text
  // before the transaction ledger begins) - never the whole document, or
  // ledger-body counterparty banks win instead of the issuing bank.
  const matches = DICT.banks.filter(b => headerText.includes(b));
  if (matches.length) return matches.reduce((longest, b) => (b.length > longest.length ? b : longest), matches[0]);
  // Last resort: some banks' name appears ONLY as a logo image in the PDF
  // (confirmed for a Punjab National Bank statement - zero occurrences of
  // "PUNJAB" or "PNB" anywhere in the extracted text layer), so there is
  // literally nothing for the checks above to match. The IFSC code is
  // still real text and its 4-letter bank prefix is a reliable identifier.
  const ifscMatch = headerText.match(/IFSC\s*CODE\s*:?\s*([A-Z]{4})/);
  if (ifscMatch) {
    const prefix = ifscMatch[1];
    const IFSC_PREFIX_BANKS = { PUNB: 'PUNJAB NATIONAL BANK', HDFC: 'HDFC BANK', ICIC: 'ICICI BANK', UTIB: 'AXIS BANK', KKBK: 'KOTAK MAHINDRA BANK', SBIN: 'STATE BANK OF INDIA', BARB: 'BANK OF BARODA', SCBL: 'STANDARD CHARTERED', IDFB: 'IDFC FIRST BANK', YESB: 'YES BANK', UBIN: 'UNION BANK OF INDIA', CNRB: 'CANARA BANK', IOBA: 'INDIAN OVERSEAS BANK', IDIB: 'INDIAN BANK', PSIB: 'PUNJAB AND SIND BANK', MAHB: 'BANK OF MAHARASHTRA', UCBA: 'UCO BANK', CBIN: 'CENTRAL BANK OF INDIA' };
    if (IFSC_PREFIX_BANKS[prefix]) return IFSC_PREFIX_BANKS[prefix];
  }
  return '';
}

function detectHeader(fullText, transactions) {
  const t = up(fullText);
  // Restrict header-block matching to text before the ledger actually
  // starts (before "OPENING BALANCE" / the "Particulars ... Balance"
  // column header / "Tran Date"), so per-transaction bank mentions can't
  // be mistaken for the issuing bank.
  const ledgerStart = t.search(/OPENING BALANCE|PARTICULARS\s+DEBIT|TRAN\s+DATE|CHEQUE\s+DEPOSIT\s+WITHDRAWAL|WITHDRAWAL\s+DEPOSIT\s+BALANCE|DESCRIPTION\s+CHEQUE/);
  const headerBlock = ledgerStart > 0 ? t.slice(0, ledgerStart) : t.slice(0, 2000);
  const bank_name = detectBankName(headerBlock, t);
  let account_number = '';
  // HSBC prints "Account number: 083-360511-006" - hyphenated, not one
  // contiguous digit run, so the plain \d{9,18} branch never matches it.
  let m = t.match(/A\/?C(?:COUNT)?\s*(?:NO|NUMBER|NUM)?\.?\s*[:-]?\s*(X{2,}[\d-]{2,}|[\d]{2,}(?:-[\d]{2,}){1,3}|\d{9,18})/);
  if (m) account_number = m[1];
  let account_holder = '';
  m = fullText.match(/(?:Account\s*Name|Customer\s*Name|Name\s*of\s*(?:the\s*)?(?:Account\s*)?Holder|Dear)\s*[:-]?\s*([A-Z][A-Za-z .]{4,40})/i);
  if (m) account_holder = m[1].trim().replace(/\s{2,}/g, ' ');
  else {
    // Some statements (e.g. Axis) print the holder's name as the bare
    // first line of the document with no preceding label at all. Fall
    // back to it only when it looks like a plausible name - short,
    // letters/spaces only, and not itself a bank name or generic banner.
    const firstLine = (fullText.split('\n')[0] || '').trim();
    const looksLikeName = /^[A-Z][A-Za-z.\s]{2,40}$/.test(firstLine) && firstLine.split(/\s+/).length <= 5 && !DICT.banks.some(b => up(firstLine).includes(b));
    if (looksLikeName) account_holder = firstLine;
    else {
      // HSBC (and similar letterhead-style statements) print the holder's
      // name a few lines down, right after an account-type banner line
      // ("SAVINGS ACCOUNT - RES" / "CURRENT ACCOUNT" etc.) rather than on
      // line 1 and with no label at all - take the line immediately after
      // that banner, stripping a leading courtesy title (MR/MRS/MS/M/S).
      const rawLines = fullText.split('\n').map(l => l.trim()).filter(Boolean);
      const bannerIdx = rawLines.findIndex(l => /^(SAVINGS\s+BANK|SAVINGS|CURRENT|SALARY|NRE|NRO|SB|CASA)\s+ACCOUNT/i.test(l));
      if (bannerIdx >= 0 && rawLines[bannerIdx + 1]) {
        const candidate = rawLines[bannerIdx + 1].replace(/^(MR|MRS|MS|M\/S)\.?\s+/i, '').trim();
        if (/^[A-Z][A-Za-z.\s]{2,40}$/.test(candidate) && candidate.split(/\s+/).length <= 5 && !DICT.banks.some(b => up(candidate).includes(b))) {
          account_holder = candidate;
        }
      }
    }
  }
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

// detectSalary only ever surfaces the single best-scoring recurring credit
// group as "the" income - a genuine second income stream (a side business
// payout, a recurring commission, freelance income) that isn't the primary
// salary gets computed internally then silently discarded. This rebuilds
// the same grouping and returns every OTHER recurring, stable credit group
// so a second income source shows up as its own line instead of vanishing
// into "other credits".
function detectSecondaryIncome(txns, holderTokens, primaryKey) {
  const credits = txns.filter(t => num(t.credit) > 0);
  const groups = {};
  credits.forEach(t => {
    const key = partyKey(t.description);
    if (!key || key === primaryKey) return;
    // Exclude self/family transfers and recognized lenders/wallets - those
    // are already surfaced by frequent_transfers / small_loan_disbursals
    // and would double-count as "income" here otherwise.
    if (holderTokens.some(tok => key.includes(tok))) return;
    if (has(t.description, DICT.lenders) || has(t.description, DICT.wallets)) return;
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  });
  return Object.entries(groups)
    .filter(([, list]) => list.length >= 3)
    .map(([key, list]) => {
      const amounts = list.map(t => num(t.credit));
      const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      const variance = amounts.reduce((a, b) => a + (b - mean) ** 2, 0) / amounts.length;
      const cv = mean ? Math.sqrt(variance) / mean : 1;
      const dates = sortDateStrings(list.map(t => t.date).filter(Boolean));
      return { source: key, count: list.length, mean: round2(mean), cv: round2(cv), first_seen: dates[0] || '', last_seen: dates[dates.length - 1] || '' };
    })
    .filter(g => g.cv < 0.4)
    .sort((a, b) => (b.count * b.mean) - (a.count * a.mean))
    .slice(0, 5);
}

function detectEmiObligations(txns) {
  // A repayment debit qualifies either because the line itself is
  // EMI/ACH/NACH-labeled, OR because the counterparty is a recognized
  // fintech/NBFC lender (KreditBee, Navi, KISETSU, RESPO, INCRED, Amazon
  // Pay Later, etc.) even though the line has no literal "EMI" text at all
  // - which is the normal case for UPI-routed loan repayments in India.
  // Excludes recognized stock/mutual-fund brokers (e.g. "ACH-DR-Indian
  // Clearing Corp") - the generic ACH-DR keyword would otherwise catch
  // routine broker settlement debits as if they were loan EMIs.
  const debits = txns.filter(t => num(t.debit) > 0 && !has(t.description, DICT.brokers) && (has(t.description, DICT.emiKeywords) || has(t.description, DICT.lenders) || /\bEMI\b/i.test(t.description)));
  const groups = {};
  debits.forEach(t => {
    // Group by the canonical lender name when one is recognized, so the
    // same lender printed under different description wording across
    // months (e.g. "Navi Finserv Limited" vs "Navi Loans") is counted as
    // one obligation instead of splitting into separate under-threshold
    // groups. Falls back to the free-text party parser for EMI-labeled
    // debits with no recognized lender name (e.g. bank ACH-DR auto-debits).
    const lenderMatch = has(t.description, DICT.lenders);
    const k = lenderMatch || partyKey(t.description) || 'EMI';
    if (!groups[k]) groups[k] = [];
    groups[k].push(t);
  });
  return Object.entries(groups).filter(([, list]) => list.length >= 2).map(([party, list]) => {
    const amounts = list.map(t => num(t.debit)).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    const dates = sortDateStrings(list.map(t => t.date).filter(Boolean));
    // Individual transaction dates/amounts kept alongside the aggregate
    // stats - buildEmiPaymentGrid() needs these to know WHICH months this
    // obligation was actually paid in, not just the overall count.
    return { party, amount: median, type: has(list[0].description, ['NACH']) ? 'NACH' : has(list[0].description, ['ECS']) ? 'ECS' : 'EMI', first_seen: dates[0] || '', last_seen: dates[dates.length - 1] || '', count: list.length, transactions: list.map(t => ({ date: t.date, amount: num(t.debit) })) };
  });
}

// Turns "this obligation exists, N payments seen" into a month-by-month
// PAID/MISSED grid - the difference between a data dump and something an
// underwriter can actually act on. Grids from the obligation's own first
// payment through the LAST MONTH OF THE STATEMENT (not just its own last
// payment) deliberately, so a loan that stopped being paid partway through
// the statement shows those trailing months as MISSED rather than simply
// not appearing.
function buildEmiPaymentGrid(emiObligations, txns) {
  const allDates = txns.map(t => parseDateFlexible(t.date)).filter(Boolean);
  if (!allDates.length) return emiObligations.map(ob => ({ ...ob, monthly_grid: [], missed_count: 0, paid_count: 0 }));
  const periodEnd = new Date(Math.max(...allDates));
  return emiObligations.map(ob => {
    const firstDate = parseDateFlexible(ob.first_seen);
    if (!firstDate) return { ...ob, monthly_grid: [], missed_count: 0, paid_count: 0 };
    const grid = [];
    let cursor = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
    const endCursor = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1);
    // Safety cap: a mis-parsed date could otherwise spin this loop for
    // years. 120 months (10 years) comfortably covers any real statement
    // period this tool would ever see.
    let guard = 0;
    while (cursor <= endCursor && guard < 120) {
      const key = monthSortKey(cursor);
      const paidTxn = (ob.transactions || []).find(t => { const d = parseDateFlexible(t.date); return d && monthSortKey(d) === key; });
      grid.push({ month: monthLabel(cursor), status: paidTxn ? 'PAID' : 'MISSED', amount: paidTxn ? paidTxn.amount : 0 });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      guard++;
    }
    const missed_count = grid.filter(g => g.status === 'MISSED').length;
    return { ...ob, monthly_grid: grid, missed_count, paid_count: grid.length - missed_count };
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

function detectRiskFlagsWatchlistPositive(txns, detectors, salaryList, emiPaymentGrid) {
  const risk_flags = [];
  const watchlist = [];
  const positive_signals = [];

  detectors.ecs_returns.forEach(r => { if (r.return_date) risk_flags.push({ type: 'BOUNCE', date: r.return_date, description: `${r.return_type} return - ${r.party}`, amount: r.return_amount, severity: 'HIGH' }); });

  // Missed EMI months - >=2 missed months required (not >=1) to avoid a
  // false positive from a loan simply nearing its own natural end near
  // the statement boundary. This tool has no CIBIL closedDate context by
  // default, so it can't tell "loan ended" from "stopped paying" -
  // framed as a pattern to verify, not a confirmed default.
  (emiPaymentGrid || []).forEach(ob => {
    if (ob.missed_count >= 2) {
      const missedMonths = ob.monthly_grid.filter(g => g.status === 'MISSED').map(g => g.month).join(', ');
      risk_flags.push({ type: 'MISSED_EMI_MONTHS', date: ob.last_seen, description: `${ob.party}: ${ob.missed_count} month(s) with no matching payment (${missedMonths}) - verify against CIBIL whether this loan closed or payments stopped`, amount: ob.amount, severity: ob.missed_count >= 3 ? 'HIGH' : 'MEDIUM' });
    }
  });

  const gamble = txns.filter(t => has(t.description, DICT.gambling));
  gamble.forEach(t => risk_flags.push({ type: 'GAMBLING', date: t.date, description: t.description, amount: num(t.debit) || num(t.credit), severity: num(t.debit) > 5000 ? 'HIGH' : 'MEDIUM' }));

  if (detectors.small_loan_disbursals.frequent) risk_flags.push({ type: 'LOAN_STACKING', date: detectors.small_loan_disbursals.disbursals[0]?.date || '', description: `${detectors.small_loan_disbursals.disbursal_count} app-loan disbursals across ${detectors.small_loan_disbursals.lenders_seen.length} lender(s)`, amount: detectors.small_loan_disbursals.total_disbursed, severity: 'HIGH' });

  if (detectors.cc_card_rotation.detected) risk_flags.push({ type: 'CC_FUNDING', date: detectors.cc_card_rotation.transactions[0]?.date || '', description: `${detectors.cc_card_rotation.transaction_count} POS/aggregator settlement credit(s) - possible card-to-cash`, amount: detectors.cc_card_rotation.total_amount, severity: 'MEDIUM' });

  // Unexplained cash deposits - flagged whenever they exist at all (no
  // source is traceable by definition); severity escalates once the total
  // becomes large enough to matter to income assessment.
  if (detectors.cash_deposits.detected) {
    const cd = detectors.cash_deposits;
    risk_flags.push({ type: 'UNEXPLAINED_CASH', date: cd.transactions[0]?.date || '', description: `${cd.transaction_count} cash deposit(s) totalling Rs.${cd.total_amount.toLocaleString('en-IN')} with no traceable source`, amount: cd.total_amount, severity: cd.total_amount >= 100000 ? 'HIGH' : 'MEDIUM' });
  }

  // Circular / round-tripping transactions - same party debited then
  // credited (or vice versa) within days, repeated - classic
  // turnover-inflation pattern.
  detectors.circular_transactions.forEach(c => {
    risk_flags.push({ type: 'CIRCULAR_TRANSACTION', date: c.pairs[0]?.out_date || '', description: `${c.round_trip_count} round-trip(s) with ${c.party} - possible turnover inflation`, amount: c.total_debit + c.total_credit, severity: c.round_trip_count >= 3 ? 'HIGH' : 'MEDIUM' });
  });

  const nearZero = txns.filter(t => t.balance !== undefined && t.balance !== null && num(t.balance) >= 0 && num(t.balance) < 500);
  nearZero.forEach(t => risk_flags.push({ type: 'MIN_BAL_CHARGE', date: t.date, description: `Near-zero balance (Rs.${num(t.balance)})`, amount: num(t.balance), severity: 'MEDIUM' }));

  // Large one-time credit inflow via bank transfer (RTGS/NEFT/IMPS) that
  // isn't a recognized salary credit - a strong signal of a new loan
  // disbursal that may not have shown up in a CIBIL pull yet. Threshold is
  // deliberately conservative (>=1.5x avg salary, floor Rs.1,00,000) to
  // limit noise; self-transfers between the account holder's own accounts
  // can still trip this, so cross-check against the Self/Frequent Transfer
  // sheet before treating a hit here as confirmed new debt.
  const avgSalaryForCredit = salaryList ? salaryList.mean : 0;
  const salaryDates = new Set(salaryList ? salaryList.list.map(r => r.date) : []);
  const bigCredits = txns.filter(t => num(t.credit) > 0 && !salaryDates.has(t.date) && num(t.credit) >= Math.max(100000, avgSalaryForCredit * 1.5) && /RTGS|NEFT|IMPS/i.test(t.description));
  bigCredits.forEach(t => risk_flags.push({ type: 'LARGE_CREDIT_INFLOW', date: t.date, description: `Large one-time bank-transfer credit - possible new loan disbursal (verify against CIBIL/self-transfers): ${t.description}`, amount: num(t.credit), severity: 'HIGH' }));

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
  const secondary_income = detectSecondaryIncome(transactions, holderTokens, salary ? salary.key : null);
  const monthsInPeriod = (() => {
    const dates = transactions.map(t => parseDateFlexible(t.date)).filter(Boolean);
    if (!dates.length) return 1;
    const min = new Date(Math.min(...dates)), max = new Date(Math.max(...dates));
    return Math.max(1, Math.round((max - min) / (30 * 86400000)));
  })();
  const estimated_monthly_income = salary ? round2(salary.mean) : (total_credits > 0 ? round2(total_credits / monthsInPeriod) : 0);
  const income_stability = !salary ? 'IRREGULAR' : salary.cv < 0.15 ? 'STABLE' : salary.cv < 0.35 ? 'IRREGULAR' : 'UNSTABLE';

  const emi_obligations = detectEmiObligations(transactions);
  const emi_payment_grid = buildEmiPaymentGrid(emi_obligations, transactions);
  const total_emi_burden = round2(emi_obligations.reduce((s, e) => s + e.amount, 0));
  const foir_estimate = estimated_monthly_income > 0 ? Math.round((total_emi_burden / estimated_monthly_income) * 100) : 0;

  const cc_vendor_funding = detectCcVendorFunding(transactions);
  const monthly_cashflow = detectMonthlyCashflow(transactions, detectors.ecs_returns);
  const repeat_parties = detectRepeatParties(transactions);
  const { risk_flags, watchlist, positive_signals } = detectRiskFlagsWatchlistPositive(transactions, detectors, salary, emi_payment_grid);

  const bounceCount = detectors.ecs_returns.filter(r => r.return_date).length;
  let overall_risk = 'LOW', recommendation = 'PROCEED';
  if (foir_estimate >= 50 || bounceCount >= 2 || detectors.small_loan_disbursals.frequent) { overall_risk = 'HIGH'; recommendation = 'REJECT'; }
  else if (foir_estimate >= 30 || bounceCount === 1 || detectors.cc_card_rotation.detected) { overall_risk = 'MEDIUM'; recommendation = 'CAUTION'; }

  const summary_notes = [
    salary ? `Recurring credit pattern detected (${salary.list.length}x, avg Rs.${estimated_monthly_income.toLocaleString('en-IN')}).` : 'No clear recurring salary pattern found - income estimate uses average monthly credits.',
    bounceCount > 0 ? `${bounceCount} auto-debit bounce(s) found.` : 'No auto-debit bounces detected.',
    detectors.cc_card_rotation.detected ? 'Possible card-to-cash / POS settlement funding pattern observed.' : '',
    secondary_income.length ? `Possible secondary income source(s) detected: ${secondary_income.map(s => `${s.source} (${s.count}x, avg Rs.${s.mean.toLocaleString('en-IN')})`).join('; ')}.` : '',
    detectors.cash_deposits.detected ? `${detectors.cash_deposits.transaction_count} unexplained cash deposit(s) totalling Rs.${detectors.cash_deposits.total_amount.toLocaleString('en-IN')}.` : '',
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
    risk_flags, watchlist, positive_signals, emi_obligations, emi_payment_grid, cc_vendor_funding, monthly_cashflow, repeat_parties, secondary_income,
  };
}

const AMT = /\d{1,2}(?:,\d{2})*,\d{3}(?:\.\d{1,2})?|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{2}/g;
const DATE = /(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})|(\d{1,2}[-\s][A-Za-z]{3}[-\s]\d{2,4})|(\d{4}-\d{2}-\d{2})/;
// SCB (and possibly others) print per-row dates as "May 19" - month name
// FIRST, day SECOND, NO year at all on the row (the year only appears once,
// in the statement header block, e.g. "STATEMENT DATE : 19 May 2026"). The
// DATE regex above requires a year on every row, so these lines never
// matched at all and the whole statement silently produced zero
// transactions. Tried only as a fallback when DATE finds nothing; the
// missing year is borrowed from a defaultYear passed in from the header.
const MONTH_DAY_NO_YEAR = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})\b/i;
const toNum = s => Number(String(s).replace(/,/g, '')) || 0;
// Labeled summary/banner fields (opening balance, statement period, page
// totals, etc.) commonly repeat on every page of a statement and often sit
// right next to a date stamp - without this exclusion they get misread as
// real transaction rows, corrupting both the opening balance and any total
// derived from summing transactions.
const NON_TXN_LABELS = ['OPENING BALANCE', 'CLOSING BALANCE', 'AVAILABLE BALANCE', 'STATEMENT PERIOD', 'STATEMENT DATE', 'TOTAL DEBIT', 'TOTAL CREDIT', 'TOTAL WITHDRAWAL', 'TOTAL DEPOSIT', 'BROUGHT FORWARD', 'CARRIED FORWARD', 'PAGE NO', 'ACCOUNT SUMMARY', 'STATEMENT SUMMARY',
  // Page-footer boilerplate that repeats on every page of most Indian bank
  // statements. Harmless when trailing-narration capture was restricted to
  // a narrow set of generic-looking descriptions, but now that TRAILING_ONLY
  // and HEADER_AND_TRAILING strategies let any transaction absorb trailing
  // lines (see linesToTransactions), an unfiltered footer would otherwise
  // get silently appended to whichever transaction happens to be last on
  // that page.
  'NEVER SHARE YOUR OTP', 'DIAL YOUR BANK', 'REGISTERED OFFICE', 'COMPUTER GENERATED STATEMENT', 'SYSTEM GENERATED STATEMENT', 'DOES NOT REQUIRE ANY SIGNATURE', 'DOES NOT REQUIRE A SIGNATURE', 'END OF STATEMENT', 'END OF REPORT', 'THIS IS A COMPUTER', 'PLEASE CALL FROM YOUR REGISTERED MOBILE', 'CIN:', 'IFSC CODE:', 'TOLL FREE', 'CUSTOMER CARE', 'GSTIN', 'DISCLAIMER', 'STATEMENT GENERATED ON', 'HDFC BANK LIMITED', 'CLOSING BALANCE INCLUDES', 'CONTENTS OF THIS STATEMENT', 'ABOUT:BLANK', 'TRANSACTION CHEQUE', 'NARRATION DATE NUMBER', 'WITHDRAWAL DEPOSIT BALANCE', 'TRANSACTION REMARKS', 'S NO. TRANSACTION', 'WITHDRAWAL AMOUNT', 'DEPOSIT AMOUNT', 'CHEQUE NUMBER TRANSACTION', 'BALANCE (INR)', 'AMOUNT (INR)'];
// A description left with nothing but the bank's own transaction-type label
// after date/amount stripping ("TRANSFER", "INTEREST", "CLEARING CHEQUES
// 181208") used to be the signal for HSBC-style trailing narration. That
// heuristic was replaced by the bank-aware mergeStrategy selection above
// (see detectMergeStrategy) once it was found to corrupt other banks'
// layouts - kept only as a note here since HSBC's actual behavior (dated
// line already says "TRANSFER"/"INTEREST", detail follows after) is still
// exactly this shape, just now handled via TRAILING_ONLY instead.
const MAX_TRAILING_LINES = 8;
export function linesToTransactions(lines, defaultYear = '', mergeStrategy = 'TRAILING_ONLY') {
  const txns = []; let prevBal = null;
  // Real-world bank statement PDFs wrap the "Particulars"/description
  // column across physical lines in genuinely DIFFERENT ways depending on
  // the bank, and no single content-based rule can tell all of them apart
  // (this was tried, twice, and each fix that solved one bank's format
  // broke another's - see the comment on detectMergeStrategy() for what
  // was tried and why). Two real strategies exist, selected up front from
  // the detected bank name:
  //
  //  - HEADER_BEFORE (ICICI, Axis): a bare (no date/amount) line
  //    immediately precedes each dated line and IS that transaction's own
  //    header/particulars - merged into `pending`. ICICI additionally has
  //    MORE wrapped detail lines AFTER the dated line (multi-line UPI
  //    remarks); Axis does not. Distinguishing those two needs a second
  //    signal: whether the dated line itself, after stripping date and
  //    amounts, has any real narration left over.
  //
  //  - TRAILING_ONLY (Kotak, SCB, PNB, HDFC, HSBC, and the default for any
  //    unrecognized bank): every dated line is fully self-contained from
  //    the start (date+description+amount+balance together, nothing ever
  //    precedes it) EXCEPT the description occasionally wraps FORWARD
  //    onto a bare continuation line - which always belongs to whichever
  //    transaction most recently closed, never to the transaction after
  //    it. A bare line is therefore NEVER treated as an upcoming
  //    transaction's header in this mode - it commits straight to
  //    trailingTarget (or is discarded, if nothing has been parsed yet -
  //    that's page-header boilerplate before the first real row).
  let pending = '';
  let trailingTarget = null, trailingCount = 0;
  // Only used by HEADER_BEFORE - a 1-line lookahead buffer so a bare line
  // isn't committed until it's known whether ANOTHER bare line follows
  // (confirming it as trailing detail of the transaction before it) or a
  // dated line follows instead (confirming it as the header of the new
  // one).
  let heldLine = null;
  const flushHeld = () => {
    if (heldLine === null) return;
    if (trailingTarget && trailingCount < MAX_TRAILING_LINES) {
      trailingTarget.description = (trailingTarget.description + ' ' + heldLine).replace(/\s+/g, ' ').trim();
      trailingCount++;
    } else {
      pending = pending ? pending + ' ' + heldLine : heldLine;
    }
    heldLine = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (NON_TXN_LABELS.some(l => line.toUpperCase().includes(l))) { heldLine = null; pending = ''; trailingTarget = null; continue; }
    let dm = line.match(DATE);
    let resolvedDate = dm ? dm[0] : '';
    if (!dm && defaultYear) {
      const mdm = line.match(MONTH_DAY_NO_YEAR);
      if (mdm) { dm = mdm; resolvedDate = `${mdm[2]}-${mdm[1]}-${defaultYear}`; }
    }
    const amounts = line.match(AMT);
    if (!dm || !amounts) {
      if (mergeStrategy === 'TRAILING_ONLY') {
        if (trailingTarget && trailingCount < MAX_TRAILING_LINES) {
          trailingTarget.description = (trailingTarget.description + ' ' + line).replace(/\s+/g, ' ').trim();
          trailingCount++;
        }
        // else: boilerplate before the first real transaction - discard.
      } else {
        flushHeld();
        heldLine = line;
      }
      continue;
    }
    const nums = amounts.map(toNum).filter(n => n > 0);
    if (!nums.length) { heldLine = null; pending = ''; trailingTarget = null; continue; }
    if (mergeStrategy !== 'TRAILING_ONLY' && heldLine !== null) { pending = pending ? pending + ' ' + heldLine : heldLine; heldLine = null; }
    const balance = nums[nums.length - 1]; let debit = 0, credit = 0, amount = 0, isFirst = false;
    if (prevBal !== null) { const delta = round2(balance - prevBal); amount = Math.abs(delta); if (delta >= 0) credit = amount; else debit = amount; }
    else { amount = nums.length > 1 ? Math.max(...nums.slice(0, -1)) : 0; isFirst = true; }
    prevBal = balance;
    const fullLine = pending ? pending + ' ' + line : line;
    pending = ''; trailingTarget = null; trailingCount = 0;
    let desc = fullLine.replace(dm[0], ' '); amounts.forEach(a => { desc = desc.replace(a, ' '); });
    desc = desc.replace(/\s+/g, ' ').trim();
    if (isFirst && amount > 0) {
      const u = desc.toUpperCase();
      if (/\bCR\b|CREDIT/.test(u) || has(desc, DICT.salaryKeywords)) credit = amount;
      else if (/\bDR\b|DEBIT/.test(u) || has(desc, DICT.returnWords) || has(desc, DICT.emiKeywords)) debit = amount;
    }
    const txn = { date: resolvedDate, description: desc, debit, credit, balance };
    txns.push(txn);
    // TRAILING_ONLY and HEADER_AND_TRAILING both always capture whatever
    // bare lines follow as this transaction's own continuation.
    // HEADER_ONLY (Axis) never does - nothing ever follows a dated line
    // there, so any bare line that DOES appear is unambiguously the next
    // transaction's header, not trailing detail of this one. An earlier
    // version tried to decide this per-transaction from whether the dated
    // line's own residual text contained letters, but PNB's dated lines
    // always end in a bare "Cr."/"Dr." suffix that defeated that test
    // (looked "complete" like Axis, but PNB genuinely needs trailing
    // capture just as much as ICICI does) - a fixed per-bank strategy
    // sidesteps that false signal entirely.
    trailingTarget = (mergeStrategy === 'HEADER_ONLY') ? null : txn;
  }
  flushHeld();
  return txns;
}
// Picks which linesToTransactions() merge strategy to use, from the bank
// name detected in the header block. Tried a single universal
// content-based heuristic twice before this (see linesToTransactions'
// comment) and each attempt fixed some banks' layouts while corrupting
// others' - the layouts are genuinely incompatible, not just differently
// worded, so bank-aware selection is the actual fix.
//  - HEADER_AND_TRAILING: a bare header line precedes each dated line AND
//    more wrapped detail always follows it (ICICI, Punjab National Bank).
//  - HEADER_ONLY: a bare header line precedes each dated line and NOTHING
//    follows it (Axis).
//  - TRAILING_ONLY (default for everything else, including any
//    unrecognized bank): every dated line is self-contained from the
//    start; a bare line that appears afterward is always this same
//    transaction's description wrapping forward, never a new header
//    (Kotak, HDFC, HSBC, Standard Chartered).
const HEADER_AND_TRAILING_BANKS = ['ICICI BANK', 'ICICI', 'PUNJAB NATIONAL BANK', 'PNB'];
const HEADER_ONLY_BANKS = ['AXIS BANK'];
function detectMergeStrategy(bankName) {
  if (HEADER_AND_TRAILING_BANKS.includes(bankName)) return 'HEADER_AND_TRAILING';
  if (HEADER_ONLY_BANKS.includes(bankName)) return 'HEADER_ONLY';
  return 'TRAILING_ONLY';
}
async function pdfToLines(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise; const allLines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p); const content = await page.getTextContent(); const rows = {};
    content.items.forEach(it => { if (!it.str || !it.str.trim()) return; const y = Math.round(it.transform[5]); const key = Math.round(y / 3) * 3; (rows[key] = rows[key] || []).push({ x: it.transform[4], s: it.str }); });
    Object.keys(rows).map(Number).sort((a, b) => b - a).forEach(k => {
      const line = rows[k].sort((a, b) => a.x - b.x).map(o => o.s).join(' ').replace(/\s+/g, ' ').trim();
      // Some PDF generators (accessibility/tagged text layers, table-cell
      // rendering quirks) emit the exact same row twice in a row - without
      // this, every duplicated transaction row gets counted twice.
      if (line && line === allLines[allLines.length - 1]) return;
      allLines.push(line);
    });
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
  // Bound the header block the same way detectHeader() does - before the
  // ledger actually starts - not a fixed line count. A crude "first N
  // lines" cutoff lets transaction narration text leak in on short
  // statements (SCB's 1-page sample has its first transaction row,
  // containing "HDFC0MERUPI", within the first 30 lines) and falsely
  // matches the wrong bank.
  const fullUpperEarly = lines.join('\n').toUpperCase();
  const ledgerStartEarly = fullUpperEarly.search(/OPENING BALANCE|PARTICULARS\s+DEBIT|TRAN\s+DATE|CHEQUE\s+DEPOSIT\s+WITHDRAWAL|WITHDRAWAL\s+DEPOSIT\s+BALANCE|DESCRIPTION\s+CHEQUE/);
  const headerText = ledgerStartEarly > 0 ? fullUpperEarly.slice(0, ledgerStartEarly) : lines.slice(0, 20).join('\n').toUpperCase();
  const headerUpper = headerText.toUpperCase();
  // Statements that print rows as "May 19" (no year) always still have a
  // full year SOMEWHERE in the header block ("STATEMENT DATE : 19 May
  // 2026 To 26 May 2026") - borrow the first one found there as the
  // default year for MONTH_DAY_NO_YEAR fallback matches.
  const yearMatch = headerText.match(/\b(20\d{2})\b/);
  const defaultYear = yearMatch ? yearMatch[1] : '';
  const earlyBankName = detectBankName(headerUpper, headerUpper);
  const mergeStrategy = detectMergeStrategy(earlyBankName);
  const transactions = linesToTransactions(lines, defaultYear, mergeStrategy);
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