// bankBehaviour.js - client-side bank-statement behaviour detector (no API).
import * as pdfjsLib from 'pdfjs-dist';
pdfjsLib.GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL}/pdf.worker.min.mjs`;

const DICT = {
  brokers: ['ZERODHA','GROWW','UPSTOX','ANGEL ONE','ANGEL BROKING','ANGELONE','ICICI DIRECT','ICICIDIRECT','IDIRECT','I DIRECT','HDFC SEC','HDFC SECURITIES','HDFCSEC','KOTAK SEC','KOTAK SECURITIES','MOTILAL','SHAREKHAN','5PAISA','IIFL SEC','IIFL SECURITIES','PAYTM MONEY','DHAN','FYERS','ALICEBLUE','EDELWEISS','NUVAMA','SAMCO','NSE CLEARING','NSCCL','ICCL','INDIAN CLEARING','NSE CM','NSE FO','BSE LTD',
    // Broader consumer/full-service trading platform coverage - SEBI's
    // registered-broker list runs into the thousands, so this can never be
    // complete on its own (see BROKER_FALLBACK_HINTS below for the catch-all).
    'CHOICE BROKING','ANAND RATHI','GEOJIT','VENTURA','MASTERTRUST','JAINAM','TRADESMART','DEFINEDGE','FINVASIA','SHOONYA','M.STOCK','MSTOCK','INDMONEY','SHARE.MARKET','JM FINANCIAL','PRABHUDAS LILLADHER','RELIGARE','SMC GLOBAL','ASHIKA','MARWADI','TRUSTLINE'],
  // GROWW, PAYTM MONEY and INDMONEY are dual-purpose - already in
  // DICT.brokers because the same platform does both equity trading and
  // MF/SIP investing. That overlap is deliberate (see isMutualFundTxn()
  // below for how a transaction on one of those platforms gets
  // disambiguated) - don't remove them from DICT.brokers. AMC names
  // (HDFC MUTUAL FUND, SBI MF, etc.) are MF-only and always tag as mutual
  // fund activity.
  mutualFundPlatforms: ['ZERODHA COIN', 'COIN BY ZERODHA', 'GROWW', 'KUVERA', 'ETMONEY', 'PAYTM MONEY', 'INDMONEY', 'SCRIPBOX', 'FUNDSINDIA', 'ANGEL BEE', 'MFCENTRAL', 'CAMS', 'KFINTECH', 'KARVY MF',
    'HDFC MUTUAL FUND', 'HDFC MF', 'SBI MUTUAL FUND', 'SBI MF', 'ICICI PRUDENTIAL MF', 'ICICI PRU MF', 'AXIS MUTUAL FUND', 'AXIS MF', 'NIPPON INDIA MF', 'KOTAK MF', 'ADITYA BIRLA SUN LIFE', 'UTI MUTUAL FUND', 'UTI MF', 'FRANKLIN TEMPLETON', 'MIRAE ASSET MF', 'DSP MUTUAL FUND', 'TATA MUTUAL FUND', 'QUANT MUTUAL FUND', 'PPFAS', 'PARAG PARIKH'],
  posAggregators: ['RAZORPAY','PINE LABS','PINELABS','MSWIPE','EZETAP','BHARATPE','BHARAT PE','PAYTM POS','PHONEPE MERCHANT','INNOVITI','MOSAMBEE','WORLDLINE','POS SETTLEMENT','MERCHANT SETTLEMENT','CARD SETTLEMENT','CASH @ POS','CC FUNDING','PAYU','CCAVENUE','CASHFREE','BILLDESK MERCHANT'],
  returnWords: ['ECS RTN','ECS RETURN','NACH RTN','NACH RETURN','INWARD RTN','INW RTN','I/W RETURN','O/W RETURN','CHQ RETURN','CHEQUE RETURN','CHQ RTN','DISHONOUR','DISHONOR','INSUFFICIENT','UNPAID','RETURN UNPAID','BOUNCE','ACH RTN','ACH RETURN','MANDATE FAIL'],
  chargeWords: ['RETURN CHARGES','RETURN CHARGE','RTN CHRG','RTN CHARGES','RET CHRG','RET CHARGES','RETURN CHG','RTN CHG','INW CHQ RTN','ECS RET','NACH RET','ACH RET CHRG','PENAL CHARGES','CHEQUE RETURN CHARGE','I/W CHQ RTN CHG'],
  lenders: ['KREDITBEE','KREDIT BEE','KRAZYBEE','NAVI','LAZYPAY','LAZY PAY','MONEYTAP','MONEY TAP','CASHE','EARLYSALARY','EARLY SALARY','FIBE','KISSHT','PAYSENSE','PAY SENSE','SMARTCOIN','SMART COIN','STASHFIN','STASH FIN','MPOKKET','M POKKET','SLICE','BRANCH','DHANI','RUPEEREDEE','TRUEBALANCE','TRUE BALANCE','AVAIL FINANCE','BHARAT LOAN','LOANTAP','LOAN TAP','POCKETCASH','KREDITONE','ZESTMONEY','ZEST MONEY','KISETSU','KISETSU SAISON','RESPO FINANCIAL','RESPO','INCRED FINANCE','INCRED','AMAZON PAY LATER',
    // Mainstream traditional NBFCs - previously missing, which left every
    // recurring EMI auto-debit to one of these completely undetected (see
    // BAJAJ FINANCE confirmed bug: neither "BAJAJ_AUTO_CD" nor
    // "AD~1ADBAJAJFINNEW~" matched anything here before this list existed).
    // NOTE for whoever next edits this list: any entry whose first word is
    // ALSO a private-sector bank name (see DICT.banks) needs that word added
    // to GENERIC_ROOT_STOPWORDS below - see the MAHINDRA FINANCE / "Kotak
    // Mahindra Bank" collision comment there. A hypothetical future "KOTAK
    // ..." lender entry would carry the exact same risk (KOTAK is already a
    // bank name) - no such entry exists today, so no stopword is needed yet.
    'BAJAJ FINANCE','BAJAJ FINSERV','HDB FINANCIAL','TATA CAPITAL','L&T FINANCE','LNT FINANCE','MAHINDRA FINANCE','CHOLAMANDALAM','CHOLA FINANCE','SUNDARAM FINANCE','MUTHOOT FINANCE','IIFL FINANCE','POONAWALLA FINCORP','AU FINANCE','PIRAMAL FINANCE','HERO FINCORP','SBI CARD'],
  wallets: ['PAYTM WALLET','PHONEPE WALLET','AMAZON PAY','AMAZONPAY','MOBIKWIK','FREECHARGE','OLA MONEY','OLAMONEY','AIRTEL MONEY','JIO MONEY','JIOMONEY','SLICE WALLET'],
  // Apps customers route a credit-card bill payment through rather than
  // paying the bank/card-issuer directly. Distinct category from
  // DICT.wallets (top-ups/reversals) even though some app names overlap -
  // categorizeTxn() tags these CREDIT_CARD_BILL_PAYMENT specifically.
  // 'CRED' is deliberately NOT in this list as a bare substring - see
  // CRED_APP_RE below for why.
  billPaymentApps: ['PAYZAPP', 'MOBIKWIK', 'AMAZON PAY', 'FREECHARGE'],
  // Wallet/fintech platforms relevant to the card-cash-out detector
  // (detectCardCashoutPatterns) specifically - overlaps DICT.wallets and
  // DICT.lenders/billPaymentApps by design (e.g. SLICE, AMAZON PAY): a
  // lender-disbursal match and a wallet-cashout match are different
  // findings from the same narration, and both are meant to fire. 'CRED'
  // is deliberately NOT in this list either - see CRED_APP_RE below.
  walletPlatforms: ['PAYZAPP', 'MOBIKWIK', 'PAYTM', 'PHONEPE', 'AMAZON PAY', 'FREECHARGE', 'AIRTEL PAYMENTS BANK', 'JIOFINANCE', 'TATA NEU', 'SLICE'],
  // Services that specifically move money between a card and a bank
  // account (e.g. ESYCASH loads a bank account from a credit card for a
  // fee) - narrower and more direct a signal than the general wallet list
  // above. Generic "CASH"+"CARD"/"CARD TO BANK"/"CC TO BANK" phrasing is
  // matched separately in isCardCashTransferTxn() since it isn't a single
  // fixed keyword.
  cardCashTransferServices: ['ESYCASH'],
  forex: ['OCTAFX','OCTA FX','EXNESS','IQ OPTION','IQOPTION','OLYMP TRADE','OLYMPTRADE','BINOMO','ETORO','XM GLOBAL','FXTM','AVATRADE','AVA TRADE','FBS','FOREX','FX TRADING','CFD TRADING'],
  transferRails: ['IMPS','NEFT','RTGS','UPI','TFR','MMT','P2A','INFT'],
  gambling: ['DREAM11','DREAM 11','MPL','MY11CIRCLE','MY 11 CIRCLE','PAYTM FIRST GAMES','BALLEBAAZI','BETWAY','1XBET','RUMMY','POKERBAAZI','ADDA52','ADDA 52','JUNGLEE RUMMY','RUMMYCIRCLE'],
  gst: ['GST ', 'GSTN', 'GOODS AND SERVICE TAX', 'GST PAYMENT', 'GSTIN'],
  insurance: ['LIC ', 'LIC PREMIUM', 'HDFC LIFE', 'ICICI PRU', 'ICICI PRUDENTIAL', 'SBI LIFE', 'MAX LIFE', 'BAJAJ ALLIANZ', 'TATA AIA', 'STAR HEALTH', 'HDFC ERGO', 'RELIANCE GENERAL', 'PREMIUM PAYMENT'],
  epf: ['EPFO', 'EPF CONTRIBUTION', 'PROVIDENT FUND', 'PF CONTRIBUTION', 'PF TRF'],
  // 'EMI' and 'PLA' are deliberately NOT in this list as bare substrings -
  // see EMI_BARE_RE below for why (they collide with "PREMIUM" and
  // "MARKETPLACE" respectively).
  emiKeywords: ['ACH D', 'ACH DEBIT', 'ACH-DR', 'ACH DR', 'NACH DEBIT', 'NACH TRXN', 'NACH TRANSACTION', 'ECS DEBIT', 'LOAN INSTALLMENT', 'LOAN INSTALMENT', 'INSTALLMENT', 'INSTALMENT', 'PDC', 'STANDING INSTRUCTION', 'SI DEBIT',
    // 'AUTO_CD'/'AUTO CD' catch CMS-style auto-debit narrations
    // ("BAJAJ_AUTO_CD"); 'AD~' catches ICICI's "AD~1AD<LENDER>~<date>~<bank>"
    // standing-instruction format; 'LNPY' is literally in ICICI's own
    // statement legend ("LNPY - Linked loan payment") and was never added.
    'AUTO_CD', 'AUTO CD', 'AD~', 'LNPY'],
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

// ICICI Direct's own narration ("iDirect trxn ... EBA/F&O Trade ...",
// "EBA//20260805181744") never contains "ICICI" anywhere - DICT.brokers'
// 'ICICI DIRECT'/'ICICIDIRECT' entries never match it, only the added
// 'IDIRECT' entry does. But some legs print as a BARE "EBA//..." rail code
// with no "iDirect" text at all - EBA is ICICI's own legend code for
// "Transaction on ICICI Direct". A bare 3-letter 'EBA' substring would be
// too promiscuous to add to DICT.brokers directly (risks matching
// unrelated narrations), so it's gated here to require the "/" that always
// follows it in every real EBA narration (EBA/F&O, EBA/EQ, EBA//<ref>).
const EBA_RAIL_RE = /EBA\//i;
// SEBI's registered-broker list runs into the thousands - DICT.brokers will
// never name all of them. Any narration containing one of these generic
// broker-industry words that ISN'T already a named match still counts as
// broker activity, tagged 'UNLISTED BROKER' rather than falling through to
// OTHER/UPI uncategorized. 'STOCK' is deliberately NOT in this list - it's
// too dangerous a bare substring on its own (see STOCK_HINT_RE below for
// why) and needs its own, stricter check.
const BROKER_FALLBACK_HINTS = ['SECURITIES', 'BROKING', 'CAPITAL MARKETS'];
// A plain substring match on 'STOCK' (the same style as the hints above)
// would false-positive on STOCKIST, LIVESTOCK, or a merchant/place name
// like "WOODSTOCK CAFE" - the same class of risk the INF transfer-rail fix
// addressed last session (INF inside INFY/CONFIRM). A word-boundary check
// alone (matching the INF_RAIL_RE pattern) already rules those three out,
// since "STOCK" there is glued inside a longer word with no boundary
// before it at all.
const STOCK_HINT_RE = /\bSTOCK\b/;
// Even word-bounded, a lone "STOCK" with nothing else around it ("STOCK",
// or "STOCK 500.00" once amounts are stripped) isn't company-name context -
// real broker narrations always pair it with other words ("XYZ STOCK
// BROKING", "ABC STOCK MARKETS"). Rather than try to enumerate every
// ordinary (non-broker) word that could legitimately sit next to "stock" -
// an unwinnable list, since real narrations are free text - this just
// requires STOCK to be part of a two-or-more-word phrase, matching what was
// asked: not a precise test, just enough to rule out a bare isolated hit.
function hasStockBrokerHint(desc) {
  const u = up(desc);
  if (!STOCK_HINT_RE.test(u)) return false;
  const words = u.split(/[^A-Z&]+/).filter(Boolean);
  return words.length > 1;
}
// isMutualFundTxn is defined further below, but referenced here safely -
// it's only ever CALLED later (once real transactions are being analyzed),
// never at module-evaluation time, so its declaration position doesn't
// matter. A dual-purpose platform (GROWW/PAYTM MONEY/INDMONEY) that
// disambiguates to mutual-fund activity is excluded from isBrokerTxn so
// the same transaction never double-counts in both stock_market_activity
// and mutual_fund_activity.
const isBrokerTxn = desc => (!!has(desc, DICT.brokers) || EBA_RAIL_RE.test(desc || '') || !!has(desc, BROKER_FALLBACK_HINTS) || hasStockBrokerHint(desc || '')) && !isMutualFundTxn(desc);
const brokerLabel = desc => has(desc, DICT.brokers) || (EBA_RAIL_RE.test(desc || '') ? 'ICICI DIRECT (EBA)' : null) || (has(desc, BROKER_FALLBACK_HINTS) ? 'UNLISTED BROKER' : null) || (hasStockBrokerHint(desc || '') ? 'UNLISTED BROKER' : null);
// Splits ICICI Direct activity into risk-relevant sub-types: F&O trades are
// a leveraged/derivatives signal, EQ margin calls are a distinct risk
// signal from a plain equity trade, and a bare "EBA//<ref>" with no
// trade-type suffix is just a net settlement transfer to/from the trading
// account, not a trade itself.
function detectBrokerSubType(desc) {
  const u = up(desc);
  if (u.includes('EBA/F&O') || u.includes('EBA/FNO')) return 'F&O';
  if (u.includes('EBA/EQ') && u.includes('MARGIN')) return 'MARGIN_CALL';
  if (u.includes('EBA/EQ')) return 'EQUITY';
  if (u.includes('EBA//')) return 'NET_SETTLEMENT';
  return 'OTHER';
}

// Mutual fund / SIP detection - a separate category from stock brokers.
// GROWW/PAYTM MONEY/INDMONEY are "dual-purpose": the same platform legally
// does both equity trading and MF/SIP investing, so a plain platform-name
// match alone can't tell which. Narration sub-text ("SIP"/"MF"/"MUTUAL
// FUND"/"COIN") disambiguates those, the same way detectBrokerSubType()
// splits F&O/EQUITY/MARGIN for ICICI Direct. AMC-only names (HDFC MUTUAL
// FUND, SBI MF, etc. - not present in DICT.brokers at all) always count as
// mutual fund activity regardless of sub-text.
const MF_SUBTEXT_RE = /\bSIP\b|\bMF\b|MUTUAL\s*FUND|\bCOIN\b/i;
// Confirmed real: ICICI's own NEFT settlement narration prints "ICICI
// PRUDENTIAL M F REDEMPTION POOL A/C..." - a space between every letter of
// the abbreviation, not "MF" as one token. That defeats BOTH the plain
// substring DICT.mutualFundPlatforms check (no entry there has a space in
// the middle of "MF") and the MF_SUBTEXT_RE word-boundary regex above,
// since neither ever expected the abbreviation itself to be spaced out.
// "S I P" is the same risk for SIP debits, per the same real-statement
// audit. Collapsed once here, called from every match site below, rather
// than duplicating the same regex three times and risking them drifting
// out of sync.
const SPACED_ABBREV_RE = /\bM\s+F\b|\bS\s+I\s+P\b/gi;
const normalizeSpacedAbbrev = desc => (desc || '').replace(SPACED_ABBREV_RE, m => m.replace(/\s+/g, ''));
function isMutualFundTxn(desc) {
  const d = normalizeSpacedAbbrev(desc);
  if (!has(d, DICT.mutualFundPlatforms)) return false;
  const isDualPurposePlatform = !!has(d, DICT.brokers);
  return isDualPurposePlatform ? MF_SUBTEXT_RE.test(d) : true;
}
const mutualFundLabel = desc => has(normalizeSpacedAbbrev(desc), DICT.mutualFundPlatforms) || null;
// Direction is the primary signal (a credit on a recognized MF platform is
// redemption proceeds - there's no other reason money flows FROM a mutual
// fund platform back to a bank account), narration text only distinguishes
// SIP from a one-off lumpsum purchase among debits.
function detectMfSubType(desc, isCredit) {
  if (isCredit) return 'REDEMPTION';
  return /\bSIP\b/i.test(normalizeSpacedAbbrev(desc)) ? 'SIP' : 'LUMPSUM';
}

// ICICI's own legend defines INFT ("Internal Fund Transfer (Within ICICI
// Bank)") as a DIFFERENT rail code from NEFT - self-transfer narrations
// using it were previously invisible to every transferRails-gated
// detector. INF ("Internet fund transfer in linked accounts") is also a
// distinct real code, but bare "INF" is a dangerous 3-letter substring to
// add to the plain includes()-based DICT.transferRails list (it would
// false-positive on "INFY"/"INFOSYS" as a transfer counterparty, or
// "CONFIRM"), so it's matched only as a whole word here instead.
const INF_RAIL_RE = /\bINF\b/;
const hasTransferRail = desc => has(desc, DICT.transferRails) || (INF_RAIL_RE.test(up(desc)) ? 'INF' : undefined);

// Shared self-transfer signal - originally local to runBehaviourDetectors'
// frequent_transfers grouping (as `selfRe`), hoisted here so detectSalary()
// and detectSecondaryIncome() can reuse the EXACT same check rather than a
// second, possibly-inconsistent one. Confirmed real: 7 credits narrated
// "Fund transfer INF/INFT/000081245209/Self" (varying amounts, Rs.29,697.58
// to Rs.1,00,000) were adopted as "salary" - partyKey() strips the literal
// word SELF as a stopword before grouping, so a holderTokens-name check
// alone (already used elsewhere) can't catch this shape: there's no
// account-holder name anywhere in the narration to match against, only the
// generic word "Self". Must be tested against the RAW description, before
// partyKey() has a chance to strip it away.
const SELF_TRANSFER_RE = /\b(SELF|OWN\s*A\/?C|OWN\s*ACCOUNT)\b/i;
const isSelfTransferTxn = desc => SELF_TRANSFER_RE.test(desc || '');

// The English word "Credit" contains "CRED" as a substring - a bare
// includes()-based match (the same style as the other billPaymentApps/
// walletPlatforms entries) would mistag any generic "Credit trxn ..."
// narration (extremely common across Indian bank statements, e.g. a plain
// self-transfer credit) as a CRED-app transaction. Same class of risk as
// INF_RAIL_RE/STOCK_HINT_RE above - gated to a whole word. The other app
// names (PAYZAPP, MOBIKWIK, etc.) are distinctive enough as bare
// substrings and don't need this.
const CRED_APP_RE = /\bCRED\b/;
const hasBillPaymentApp = desc => has(desc, DICT.billPaymentApps) || (CRED_APP_RE.test(up(desc)) ? 'CRED' : undefined);
const hasWalletPlatform = desc => has(desc, DICT.walletPlatforms) || (CRED_APP_RE.test(up(desc)) ? 'CRED' : undefined);

// Same class of risk again, this time inside DICT.emiKeywords: a bare
// 'PLA' includes()-match collides with "...MARKETPLACE..." - confirmed
// real statement where 9 recurring Zepto grocery debits ("ZEPTO
// MARKETPLACE PRI") were misclassified as an EMI obligation purely because
// "MARKETPLACE" contains "PLA", with no actual lender or loan signal
// anywhere in the narration. Auditing the same list turned up a second,
// latent instance of the identical bug: bare 'EMI' matches "...PREMIUM..."
// (LIC/insurance premium debits, already their own DICT.insurance
// category) - not yet evidenced in a real statement, but the exact same
// substring-collision shape, fixed here alongside PLA rather than left for
// the next real-PDF round to rediscover separately.
const EMI_BARE_RE = /\b(?:EMI|PLA)\b/;
const hasEmiKeyword = desc => has(desc, DICT.emiKeywords) || (up(desc).match(EMI_BARE_RE) || [])[0];

// Canonicalizes a lender name across the different narration styles the
// SAME lender prints under. Beyond the exact DICT.lenders phrase match,
// this also recognizes: (a) ICICI's "AD~1AD<LENDER>~<date>~<bank>" standing
// -instruction format via regex extraction, and (b) any known lender's
// first significant word appearing as a whole word elsewhere (so
// "BAJAJ_AUTO_CD" and "AD~1ADBAJAJFINNEW~06AUG26~ICIC" - two genuinely
// different narration styles for the same BAJAJ FINANCE auto-debit - group
// into ONE obligation instead of two separate under-threshold ones). Only
// used to canonicalize transactions that have ALREADY passed an EMI/lender
// keyword gate, so the broader word-root match doesn't risk pulling in
// unrelated transactions.
const AD_SI_RE = /AD~1AD([A-Z]+)~/;
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&');
// A plain \b word-boundary regex does NOT fire between a letter and an
// underscore or tilde (both count as "word" characters in JS regex), so it
// would silently fail to match "BAJAJ" inside "BAJAJ_AUTO_CD" - real bank
// narrations glue lender names to adjoining tokens with exactly these
// characters, not just spaces. Treat any non-A-Z character as a boundary
// instead.
const rootBoundaryRe = root => new RegExp(`(?:^|[^A-Z])${escapeRe(root)}(?:[^A-Z]|$)`);
// A first-word root that is itself a common English word (not a distinctive
// brand token) is too dangerous to fuzzy-match on regardless of length -
// confirmed via "LOAN TAP" -> root "LOAN": ANY personal/home/business loan
// EMI narration contains the word "loan" somewhere, so without this
// exclusion virtually every non-fintech-app EMI in the country would get
// miscategorized as the "Loan Tap" BNPL app specifically. Same shape of
// risk for the other two-word entries below (a common adjective/noun paired
// with a finance suffix, e.g. "Money Tap", "Zest Money").
// AMAZON (root of "AMAZON PAY LATER") and BHARAT (root of "BHARAT LOAN")
// carry the same risk as the original eight: AMAZON.in shopping-merchant
// debits are far more common in a real account than Amazon Pay Later EMI
// debits, and BHARAT collides with Bharat Petroleum/Bharat Gas/BharatPe
// merchant-settlement narrations - all common, all unrelated to the
// "Bharat Loan" fintech lender.
// TATA is a closer call - it isn't itself a DICT.lenders root directly
// (BAJAJ FINANCE etc. added it as "TATA CAPITAL" in an earlier session,
// making TATA a root there too). Included here anyway: Tata Sky/Tata Play
// DTH recharges and Tata AIA insurance premiums are common recurring
// consumer debits sharing the same root, and any genuine Tata Capital EMI
// narration almost always spells out the full phrase (matched directly via
// DICT.lenders, untouched by this exclusion) or the AD~ standing
// -instruction format (handled by its own extractor) - so the fuzzy root
// match's added recall here is low relative to its false-positive risk.
// MAHINDRA (root of "MAHINDRA FINANCE") is the highest-impact of these:
// confirmed real statement where ordinary Zepto grocery debits routed
// "...Paymen/KOTAK MAHINDRA BANK" (the payee's own bank, not a lender) got
// folded into a fictitious MAHINDRA FINANCE EMI obligation. Kotak Mahindra
// Bank is one of India's largest private banks, so its name routinely
// appears as a payee's bank in UPI narrations across a large fraction of
// all statements - this isn't a rare edge case like the others above. The
// real "MAHINDRA FINANCE" lender phrase still matches directly via the
// exact-phrase DICT.lenders check in detectLenderName() (untouched by this
// exclusion) - only the fuzzy root fallback is affected.
const GENERIC_ROOT_STOPWORDS = new Set(['LOAN', 'MONEY', 'SMART', 'TRUE', 'EARLY', 'ZEST', 'LAZY', 'AVAIL', 'STASH', 'AMAZON', 'BHARAT', 'TATA', 'MAHINDRA']);
const LENDER_ROOTS = DICT.lenders.map(l => ({ full: l, root: l.split(/\s+/)[0] })).filter(r => r.root.length >= 4 && !GENERIC_ROOT_STOPWORDS.has(r.root));
function detectLenderName(desc) {
  const known = has(desc, DICT.lenders);
  if (known) return known;
  const u = up(desc);
  // ICICI's "AD~1AD<LENDER><date>~<bank>" format glues the lender token
  // directly onto "AD" with no separator at all (e.g. "AD~1ADBAJAJFINNEW~"
  // has no boundary before "BAJAJ" either), so it's checked via extraction
  // + substring match BEFORE the generic root-boundary scan below, which
  // wouldn't find a boundary there.
  const adMatch = u.match(AD_SI_RE);
  if (adMatch) {
    const extracted = adMatch[1];
    const rootHit = LENDER_ROOTS.find(({ root }) => extracted.includes(root));
    return rootHit ? rootHit.full : extracted;
  }
  const rootHit = LENDER_ROOTS.find(({ root }) => rootBoundaryRe(root).test(u));
  if (rootHit) return rootHit.full;
  return null;
}

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

function isCardCashTransferTxn(desc) {
  if (has(desc, DICT.cardCashTransferServices)) return true;
  const u = up(desc);
  if (u.includes('CARD TO BANK') || u.includes('CC TO BANK')) return true;
  return u.includes('CASH') && u.includes('CARD');
}

// Card-to-bank cash-out / wallet round-trip detector. A bank statement
// never shows the actual credit-card leg of a cash-out scheme - only its
// bank-side footprints: a wallet/merchant credit or debit, and a bank
// credit/debit that correlates with it in timing and amount. Each
// sub-pattern below infers ONE such footprint shape. Confidence is
// deliberately conservative (see the notes on each branch) because several
// of these shapes - especially CREDIT_FUNDS_CC_REPAYMENT - are also
// completely normal, legal liquidity management that most customers do
// routinely; over-flagging those would make the whole sheet noise.
function detectCardCashoutPatterns(txns) {
  const findings = [];
  const credits = txns.filter(t => num(t.credit) > 0).map(t => ({ ...t, _amt: num(t.credit) }));
  const debits = txns.filter(t => num(t.debit) > 0).map(t => ({ ...t, _amt: num(t.debit) }));
  const txDesc = t => ({ date: t.date, amount: t._amt !== undefined ? t._amt : (num(t.debit) || num(t.credit)), description: t.description });
  const afterOrSame = (a, b) => { const da = parseDateFlexible(a), db = parseDateFlexible(b); return !!(da && db && db >= da); };

  // (a) CARD_CASHOUT_SUSPECTED - a wallet/merchant/bill-payment-app/
  // card-cash-service leg (either direction) followed same-day or
  // next-day by a bank credit landing at 90-99% of it. The card charge
  // itself is never visible in a bank statement - this only infers from
  // the wallet/merchant leg plus the bank credit that follows it.
  const cashoutLegs = txns.filter(t => hasWalletPlatform(t.description) || hasBillPaymentApp(t.description) || isCardCashTransferTxn(t.description));
  cashoutLegs.forEach(leg => {
    const legAmt = num(leg.debit) || num(leg.credit);
    if (!legAmt) return;
    const followUp = credits.find(c => afterOrSame(leg.date, c.date) && daysBetween(leg.date, c.date) <= 1 && (c._amt / legAmt) >= 0.90 && (c._amt / legAmt) <= 0.99);
    if (followUp) {
      const gap = round2(daysBetween(leg.date, followUp.date));
      findings.push({
        pattern_type: 'CARD_CASHOUT_SUSPECTED',
        confidence: 'MEDIUM',
        transactions: [txDesc({ date: leg.date, description: leg.description, _amt: legAmt }), txDesc(followUp)],
        gap_days: gap,
        notes: `A bank credit of Rs.${followUp._amt.toLocaleString('en-IN')} (${Math.round((followUp._amt / legAmt) * 100)}% of the Rs.${legAmt.toLocaleString('en-IN')} wallet/card-service leg) lands ${gap === 0 ? 'the same day' : `${gap} day(s) later`} - the card charge itself isn't visible in a bank statement, so this is inferred only from the two legs that are.`,
      });
    }
  });

  // (b) MATCHED_ROUND_TRIP - a credit followed within 1-2 days by a
  // non-ATM debit at 97-99% of the same amount (shrinkage consistent with
  // a fee). Ratio is strictly < 1 by design: an EXACT amount-in ->
  // amount-out pair is excluded entirely per the confidence rules (treated
  // as a likely genuine transfer, not flagged at all) rather than
  // down-ranked. ATM/cash debits are excluded here and handled below under
  // CREDIT_THEN_CASH_WITHDRAWAL instead, so the same pair is never
  // double-counted under two pattern types.
  credits.forEach(c => {
    const match = debits.find(d => !has(d.description, DICT.atm) && afterOrSame(c.date, d.date) && daysBetween(c.date, d.date) <= 2 && (d._amt / c._amt) >= 0.97 && (d._amt / c._amt) < 1);
    if (match) {
      const gap = round2(daysBetween(c.date, match.date));
      findings.push({
        pattern_type: 'MATCHED_ROUND_TRIP',
        confidence: 'MEDIUM',
        transactions: [txDesc(c), txDesc(match)],
        gap_days: gap,
        notes: `Credit of Rs.${c._amt.toLocaleString('en-IN')} offset by a debit of Rs.${match._amt.toLocaleString('en-IN')} (${(100 * match._amt / c._amt).toFixed(1)}%) ${gap} day(s) later - shrinkage consistent with a small fee, but no cash-withdrawal leg follows to raise this further.`,
      });
    }
  });

  // (c) CREDIT_THEN_CASH_WITHDRAWAL - the strongest signal: a credit
  // almost entirely pulled out as cash within 1-2 days.
  credits.forEach(c => {
    const atmMatch = debits.find(d => has(d.description, DICT.atm) && afterOrSame(c.date, d.date) && daysBetween(c.date, d.date) <= 2 && (d._amt / c._amt) >= 0.97 && (d._amt / c._amt) <= 0.99);
    if (atmMatch) {
      const gap = round2(daysBetween(c.date, atmMatch.date));
      findings.push({
        pattern_type: 'CREDIT_THEN_CASH_WITHDRAWAL',
        confidence: 'HIGH',
        transactions: [txDesc(c), txDesc(atmMatch)],
        gap_days: gap,
        notes: `Credit fully offset by an ATM/cash withdrawal ${gap} day(s) later, ${(100 * atmMatch._amt / c._amt).toFixed(1)}% of the original amount - consistent with a card-to-cash pattern.`,
      });
    }
  });

  // (d) REPEATED_SAME_PARTY_CREDITS - 3+ credits from the same UPI
  // VPA/party within a 30-day window. Weak signal alone (could just be a
  // recurring family transfer), kept at LOW.
  const partyGroups = {};
  credits.forEach(c => { const k = partyKey(c.description); if (!k) return; (partyGroups[k] = partyGroups[k] || []).push(c); });
  Object.entries(partyGroups).forEach(([party, list]) => {
    if (list.length < 3) return;
    const sorted = [...list].sort((a, b) => (parseDateFlexible(a.date) || 0) - (parseDateFlexible(b.date) || 0));
    for (let i = 0; i + 2 < sorted.length; i++) {
      const windowTxns = sorted.slice(i).filter(t => daysBetween(sorted[i].date, t.date) <= 30);
      if (windowTxns.length >= 3) {
        const gap = round2(daysBetween(windowTxns[0].date, windowTxns[windowTxns.length - 1].date));
        findings.push({
          pattern_type: 'REPEATED_SAME_PARTY_CREDITS',
          confidence: 'LOW',
          transactions: windowTxns.map(txDesc),
          gap_days: gap,
          notes: `${windowTxns.length} credits from the same counterparty ("${party}") within ${gap} day(s) - repeated same-party funding, informational rather than inherently suspicious.`,
        });
        break;
      }
    }
  });

  // (e) POST_MERCHANT_CREDIT - a credit landing same/next-day after a
  // large (>= Rs.10,000) merchant/wallet-platform debit. Timing
  // correlation only, no amount match - weak/ambiguous alone, kept at LOW.
  const LARGE_MERCHANT_DEBIT = 10000;
  debits.filter(d => d._amt >= LARGE_MERCHANT_DEBIT && (hasWalletPlatform(d.description) || has(d.description, DICT.posAggregators))).forEach(d => {
    const followUp = credits.find(c => afterOrSame(d.date, c.date) && daysBetween(d.date, c.date) <= 1);
    if (followUp) {
      const gap = round2(daysBetween(d.date, followUp.date));
      findings.push({
        pattern_type: 'POST_MERCHANT_CREDIT',
        confidence: 'LOW',
        transactions: [txDesc(d), txDesc(followUp)],
        gap_days: gap,
        notes: `A bank credit of Rs.${followUp._amt.toLocaleString('en-IN')} lands ${gap === 0 ? 'the same day as' : `${gap} day(s) after`} a large (Rs.${d._amt.toLocaleString('en-IN')}) merchant/wallet-platform debit - timing correlation only, no amount match required for this pattern.`,
      });
    }
  });

  // (f) AGGREGATED_LIMIT_MATCH - 2+ credits within a 7-day window summing
  // to within +/-5% of a round card-limit figure.
  const ROUND_LIMITS = [50000, 100000, 200000, 500000, 1000000];
  // Takes the running sum as an explicit parameter rather than closing over
  // the loop-scoped `sum` below - a closure that both reads AND is defined
  // inside a loop where the captured variable keeps mutating is exactly
  // what eslint's no-loop-func rule (correctly) flags as unsafe.
  const findRoundLimit = s => ROUND_LIMITS.find(l => Math.abs(s - l) / l <= 0.05);
  const sortedCredits = [...credits].sort((a, b) => (parseDateFlexible(a.date) || 0) - (parseDateFlexible(b.date) || 0));
  const usedInLimitMatch = new Set();
  for (let i = 0; i < sortedCredits.length; i++) {
    if (usedInLimitMatch.has(i)) continue;
    let sum = sortedCredits[i]._amt;
    const groupIdx = [i];
    for (let j = i + 1; j < sortedCredits.length && daysBetween(sortedCredits[i].date, sortedCredits[j].date) <= 7; j++) {
      if (usedInLimitMatch.has(j)) continue;
      sum += sortedCredits[j]._amt;
      groupIdx.push(j);
      const hitLimit = findRoundLimit(sum);
      if (hitLimit && groupIdx.length >= 2) {
        groupIdx.forEach(gi => usedInLimitMatch.add(gi));
        const group = groupIdx.map(gi => sortedCredits[gi]);
        const matchGap = round2(daysBetween(group[0].date, group[group.length - 1].date));
        findings.push({
          pattern_type: 'AGGREGATED_LIMIT_MATCH',
          confidence: 'MEDIUM',
          transactions: group.map(txDesc),
          gap_days: matchGap,
          notes: `${group.length} credits within ${matchGap} day(s) sum to Rs.${round2(sum).toLocaleString('en-IN')}, within 5% of a round Rs.${hitLimit.toLocaleString('en-IN')} figure - a common card-limit denomination, worth checking against a specific card limit.`,
        });
        break;
      }
    }
  }

  // (g) CREDIT_FUNDS_CC_REPAYMENT - a credit followed by a bill-payment-app
  // debit of similar size. Always LOW/INFORMATIONAL - routing money
  // through CRED/PayZapp etc. to pay a card bill shortly after receiving a
  // credit is completely normal, legal liquidity rotation. Must NOT weigh
  // into risk_flags/overall_risk the way a HIGH finding does - see the
  // `confidence !== 'LOW'` filters in detectRiskFlagsWatchlistPositive and
  // computeCreditAssessment.
  credits.forEach(c => {
    const match = debits.find(d => hasBillPaymentApp(d.description) && afterOrSame(c.date, d.date) && daysBetween(c.date, d.date) <= 3 && (d._amt / c._amt) >= 0.85 && (d._amt / c._amt) <= 1.05);
    if (match) {
      const gap = round2(daysBetween(c.date, match.date));
      findings.push({
        pattern_type: 'CREDIT_FUNDS_CC_REPAYMENT',
        confidence: 'LOW',
        transactions: [txDesc(c), txDesc(match)],
        gap_days: gap,
        notes: `Credit of Rs.${c._amt.toLocaleString('en-IN')} followed by a credit-card bill payment of Rs.${match._amt.toLocaleString('en-IN')} via ${hasBillPaymentApp(match.description)} ${gap} day(s) later - plausible normal liquidity rotation, not treated as a risk signal on its own.`,
      });
    }
  });

  return findings.slice(0, 40);
}

// Mutual fund / SIP / redemption activity - mirrors stock_market_activity's
// shape (detected/transaction_count/total_invested/total_withdrawn-style
// totals, a per-platform rollup, per-transaction sub_type). SIP obligations
// are grouped the same way detectEmiObligations groups lender debits: same
// platform + same (rounded) amount, >=2 occurrences - a real SIP is a fixed
// amount debited on a recurring cadence, so amount+platform is a reliable
// grouping key without needing to separately verify monthly spacing.
function detectMutualFundActivity(txns) {
  const mfTxns = txns.filter(t => isMutualFundTxn(t.description));
  const platformRollup = {};
  const transactions = mfTxns.map(t => {
    const isCredit = num(t.credit) > 0;
    const amount = num(t.debit) || num(t.credit);
    const platform = mutualFundLabel(t.description);
    const sub_type = detectMfSubType(t.description, isCredit);
    if (!platformRollup[platform]) platformRollup[platform] = { platform, transaction_count: 0, total_invested: 0, total_redeemed: 0 };
    platformRollup[platform].transaction_count += 1;
    if (isCredit) platformRollup[platform].total_redeemed += amount; else platformRollup[platform].total_invested += amount;
    return { platform, sub_type, date: t.date, amount, direction: isCredit ? 'CREDIT' : 'DEBIT', description: t.description };
  });

  const sipGroups = {};
  mfTxns.filter(t => num(t.debit) > 0 && detectMfSubType(t.description, false) === 'SIP').forEach(t => {
    const platform = mutualFundLabel(t.description) || 'UNKNOWN';
    const k = `${platform}::${Math.round(num(t.debit))}`;
    (sipGroups[k] = sipGroups[k] || []).push(t);
  });
  const sip_obligations = Object.values(sipGroups).filter(list => list.length >= 2).map(list => {
    const dates = sortDateStrings(list.map(t => t.date).filter(Boolean));
    return { platform: mutualFundLabel(list[0].description), amount: round2(num(list[0].debit)), count: list.length, first_seen: dates[0] || '', last_seen: dates[dates.length - 1] || '' };
  });

  return {
    detected: mfTxns.length > 0,
    transaction_count: mfTxns.length,
    total_invested: round2(mfTxns.reduce((s, t) => s + num(t.debit), 0)),
    total_redeemed: round2(mfTxns.reduce((s, t) => s + num(t.credit), 0)),
    platforms_seen: [...new Set(mfTxns.map(t => mutualFundLabel(t.description)))],
    platform_summary: Object.values(platformRollup).map(r => ({ ...r, total_invested: round2(r.total_invested), total_redeemed: round2(r.total_redeemed) })),
    sip_obligations,
    transactions,
  };
}

// Low-balance-day banking behaviour - a thin buffer against upcoming
// debits is a real underwriting signal distinct from an actual bounce
// (which ecs_returns already covers): this flags days the balance merely
// got uncomfortably close to zero, whether or not anything actually
// failed. thresholds is a parameter (not hardcoded once) so a caller can
// tune it per lending product instead of editing this function.
function detectLowBalanceDays(txns, thresholds = [1000, 5000]) {
  // Sort defensively into chronological order - PDF row order and
  // statement date order usually agree, but "longest consecutive streak"
  // is meaningless if they don't.
  const sorted = [...txns]
    .filter(t => t.balance !== undefined && t.balance !== null && parseDateFlexible(t.date))
    .sort((a, b) => parseDateFlexible(a.date) - parseDateFlexible(b.date));

  const low_balance_days = thresholds.map(threshold => {
    const days = sorted.filter(t => num(t.balance) < threshold).map(t => ({ date: t.date, balance: num(t.balance) }));
    let longest_streak = 0, current = 0;
    sorted.forEach(t => { if (num(t.balance) < threshold) { current += 1; longest_streak = Math.max(longest_streak, current); } else current = 0; });
    return { threshold, count: days.length, days, longest_streak };
  });

  // Frequent ATM/cash withdrawals per month, flagged once a month's count
  // OR total is meaningfully (>1.5x) above the statement's own per-month
  // average - relative to the account's own pattern, not a fixed figure,
  // since a "normal" withdrawal cadence varies enormously person to person.
  const byMonth = {};
  sorted.filter(t => has(t.description, DICT.atm) && num(t.debit) > 0).forEach(t => {
    const d = parseDateFlexible(t.date);
    const key = monthSortKey(d);
    if (!byMonth[key]) byMonth[key] = { key, label: monthLabel(d), count: 0, total: 0 };
    byMonth[key].count += 1;
    byMonth[key].total += num(t.debit);
  });
  const monthList = Object.values(byMonth).sort((a, b) => a.key - b.key).map(m => ({ ...m, total: round2(m.total) }));
  const FREQUENT_MULTIPLIER = 1.5;
  const avgCount = monthList.length ? monthList.reduce((s, m) => s + m.count, 0) / monthList.length : 0;
  const avgTotal = monthList.length ? monthList.reduce((s, m) => s + m.total, 0) / monthList.length : 0;
  const frequent_withdrawals = monthList.map(({ key, ...m }) => ({
    ...m,
    frequent_withdrawal_month: (avgCount > 0 && m.count > avgCount * FREQUENT_MULTIPLIER) || (avgTotal > 0 && m.total > avgTotal * FREQUENT_MULTIPLIER),
  }));

  return { low_balance_days, frequent_withdrawals };
}

// Recurring credit-card bill payments via a bill-payment app (CRED,
// PayZapp, etc.) or an explicit "PAVC"/"CREDIT CARD"/"CC PAYMENT"
// narration - grouped the same way detectEmiObligations groups lender
// debits (by app/party, >=2 occurrences). Kept as its OWN list rather than
// merged into emi_obligations: detectEmiObligations' own gate
// (emiKeywords/DICT.lenders/literal "EMI") essentially never matches a
// bill-payment-app debit, so there's no natural overlap to double-count -
// keeping this separate avoids having to reconcile the two lists' distinct
// grouping keys.
function detectCreditCardObligations(txns) {
  const debits = txns.filter(t => num(t.debit) > 0 && (hasBillPaymentApp(t.description) || /\bPAVC\b/i.test(t.description) || /CREDIT\s*CARD|CC\s*PAYMENT/i.test(t.description)));
  const groups = {};
  debits.forEach(t => {
    const k = hasBillPaymentApp(t.description) || partyKey(t.description) || 'CREDIT CARD';
    (groups[k] = groups[k] || []).push(t);
  });
  return Object.entries(groups).filter(([, list]) => list.length >= 2).map(([party, list]) => {
    const amounts = list.map(t => num(t.debit));
    const dates = sortDateStrings(list.map(t => t.date).filter(Boolean));
    return {
      party,
      loan_type: 'CREDIT_CARD',
      average_monthly_amount: round2(amounts.reduce((a, b) => a + b, 0) / amounts.length),
      count: list.length,
      first_seen: dates[0] || '',
      last_seen: dates[dates.length - 1] || '',
      transactions: list.map(t => ({ date: t.date, amount: num(t.debit) })),
    };
  });
}

// Top-line ATM/cash withdrawal total across the whole statement - the same
// DICT.atm tag already used inside detectLowBalanceDays' frequent-withdrawal
// logic and in categorizeTxn(), just rolled up into one simple summary
// rather than only living inside a per-month breakdown.
function detectCashWithdrawalSummary(txns) {
  const withdrawals = txns.filter(t => has(t.description, DICT.atm) && num(t.debit) > 0);
  const total_amount = round2(withdrawals.reduce((s, t) => s + num(t.debit), 0));
  return {
    total_count: withdrawals.length,
    total_amount,
    average_amount: withdrawals.length ? round2(total_amount / withdrawals.length) : 0,
  };
}

export function runBehaviourDetectors(txns, accountHolder = '') {
  const holderTokens = up(accountHolder).split(/\s+/).filter(w => w.length > 2);
  const stock = txns.filter(t => isBrokerTxn(t.description));
  const stockSubRollup = {};
  const stockTransactions = stock.map(t => {
    const sub_type = detectBrokerSubType(t.description);
    const amount = num(t.debit) || num(t.credit);
    if (!stockSubRollup[sub_type]) stockSubRollup[sub_type] = { sub_type, transaction_count: 0, total_amount: 0 };
    stockSubRollup[sub_type].transaction_count += 1;
    stockSubRollup[sub_type].total_amount += amount;
    return { broker: brokerLabel(t.description), sub_type, date: t.date, amount, direction: num(t.debit) ? 'DEBIT' : 'CREDIT', description: t.description };
  });
  const stock_market_activity = { detected: stock.length > 0, transaction_count: stock.length, total_invested: stock.reduce((s, t) => s + num(t.debit), 0), total_withdrawn: stock.reduce((s, t) => s + num(t.credit), 0), brokers_seen: [...new Set(stock.map(t => brokerLabel(t.description)))], sub_type_summary: Object.values(stockSubRollup).map(r => ({ ...r, total_amount: round2(r.total_amount) })), transactions: stockTransactions };
  const rot = txns.filter(t => num(t.credit) > 0 && has(t.description, DICT.posAggregators));
  const cc_card_rotation = { detected: rot.length > 0, transaction_count: rot.length, total_amount: rot.reduce((s, t) => s + num(t.credit), 0), transactions: rot.map(t => ({ vendor: has(t.description, DICT.posAggregators), date: t.date, amount: num(t.credit), description: t.description })) };
  const returns = txns.filter(t => has(t.description, DICT.returnWords) && !has(t.description, DICT.chargeWords));
  const charges = txns.filter(t => has(t.description, DICT.chargeWords));
  const usedCharge = new Set();
  // balance_before/balance_after - the account balance immediately
  // preceding the bounce attempt vs. after it, so an underwriter can see
  // whether the account genuinely lacked funds. txns is already in
  // statement (chronological) order (every other detector in this file
  // makes the same assumption, e.g. buildEmiPaymentGrid/
  // detectMonthlyCashflow), so the transaction at r's own index minus one
  // is "immediately before it" - a plain O(n) reference lookup since r is
  // the SAME object instance found in txns (returns is a filter() of txns,
  // which preserves object identity).
  const ecs_returns = returns.map(r => {
    let match = null; charges.forEach((c, i) => { if (!usedCharge.has(i) && daysBetween(r.date, c.date) <= 3 && !match) { match = c; usedCharge.add(i); } });
    const idx = txns.indexOf(r);
    const prevTxn = idx > 0 ? txns[idx - 1] : null;
    return { party: partyKey(r.description) || 'UNKNOWN', return_type: up(r.description).includes('NACH') ? 'NACH' : up(r.description).includes('ECS') ? 'ECS' : (up(r.description).includes('CHQ') || up(r.description).includes('CHEQUE')) ? 'CHEQUE' : 'AUTO_DEBIT', return_date: r.date, return_amount: num(r.debit) || num(r.credit), balance_before: prevTxn ? num(prevTxn.balance) : null, balance_after: num(r.balance), charge_date: match ? match.date : '', charge_amount: match ? num(match.debit) : 0, charge_description: match ? match.description : '' };
  });
  charges.forEach((c, i) => { if (!usedCharge.has(i)) ecs_returns.push({ party: 'UNMATCHED', return_type: 'AUTO_DEBIT', return_date: '', return_amount: 0, balance_before: null, balance_after: num(c.balance), charge_date: c.date, charge_amount: num(c.debit), charge_description: c.description }); });
  const disb = txns.filter(t => num(t.credit) > 0 && has(t.description, DICT.lenders));
  const lendersSeen = [...new Set(disb.map(t => has(t.description, DICT.lenders)))];
  const small_loan_disbursals = { detected: disb.length > 0, frequent: disb.length >= 2 || lendersSeen.length >= 3, disbursal_count: disb.length, total_disbursed: disb.reduce((s, t) => s + num(t.credit), 0), lenders_seen: lendersSeen, disbursals: disb.map(t => ({ lender: has(t.description, DICT.lenders), date: t.date, amount: num(t.credit), description: t.description })) };
  const wallet_to_bank = txns.filter(t => has(t.description, DICT.wallets)).map(t => ({ wallet: has(t.description, DICT.wallets), date: t.date, amount: num(t.debit) || num(t.credit), direction: num(t.credit) ? 'WALLET_TO_BANK' : 'BANK_TO_WALLET' }));
  const groups = {};
  txns.filter(t => hasTransferRail(t.description)).forEach(t => { const k = partyKey(t.description); if (!k) return; if (!groups[k]) groups[k] = { beneficiary: k, total_amount: 0, transfer_count: 0, dates: [], self_hint: false }; groups[k].total_amount += num(t.debit) || num(t.credit); groups[k].transfer_count += 1; groups[k].dates.push(t.date); if (isSelfTransferTxn(t.description)) groups[k].self_hint = true; });
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
  txns.filter(t => hasTransferRail(t.description)).forEach(t => {
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

  const cashout_patterns = detectCardCashoutPatterns(txns);
  const mutual_fund_activity = detectMutualFundActivity(txns);
  const banking_behaviour = detectLowBalanceDays(txns);
  const credit_card_obligations = detectCreditCardObligations(txns);
  const cash_withdrawal_summary = detectCashWithdrawalSummary(txns);

  // Irregular credits - the leftover credits that don't fall into ANY known
  // bucket (salary, secondary income, broker/MF activity, wallet top-ups,
  // lender disbursals). Purely informational, by exclusion - never summed
  // into any income figure since nothing here is established as recurring.
  // detectSalary/detectSecondaryIncome are defined further below in this
  // file but safe to call here (same hoisting reasoning as isMutualFundTxn
  // above) - computeCreditAssessment() calls them again independently for
  // the actual income assessment, so this is a small amount of redundant
  // work, but it keeps this self-contained within runBehaviourDetectors
  // rather than threading extra state through computeCreditAssessment.
  const salaryForIrregular = detectSalary(txns, holderTokens);
  const secondaryForIrregular = detectSecondaryIncome(txns, holderTokens, salaryForIrregular ? salaryForIrregular.key : null);
  const salaryCreditSet = new Set(salaryForIrregular ? salaryForIrregular.list : []);
  const secondarySources = new Set(secondaryForIrregular.map(s => s.source));
  const irregular_credits = txns.filter(t => {
    if (num(t.credit) <= 0) return false;
    if (salaryCreditSet.has(t)) return false;
    if (isBrokerTxn(t.description)) return false;
    if (isMutualFundTxn(t.description)) return false;
    if (has(t.description, DICT.wallets)) return false;
    if (has(t.description, DICT.lenders)) return false;
    const key = partyKey(t.description);
    if (key && secondarySources.has(key)) return false;
    return true;
  }).map(t => ({ date: t.date, amount: num(t.credit), description: t.description }));

  return { stock_market_activity, cc_card_rotation, ecs_returns, small_loan_disbursals, wallet_to_bank, frequent_transfers, forex_trading, cash_deposits, circular_transactions, cashout_patterns, mutual_fund_activity, banking_behaviour, credit_card_obligations, cash_withdrawal_summary, irregular_credits };
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
      // Final, lower-confidence fallback: some statements (ICICI included)
      // print the holder's name a few lines into the header/address block
      // with NO preceding label at all AND not on line 1 either (e.g.
      // after the bank's own letterhead lines) - neither check above
      // catches this layout. Scans a small window near the top of the
      // document (tried last, deliberately conservative) for a line that
      // looks like a name and ISN'T itself generic statement/address
      // boilerplate - without the BANNER_WORDS exclusion, a line like
      // "Statement of Account" would otherwise coincidentally match the
      // same short/title-case shape as a real name.
      if (!account_holder) {
        const BANNER_WORDS = ['STATEMENT', 'ACCOUNT', 'PERIOD', 'ADDRESS', 'BRANCH', 'IFSC', 'MICR', 'PAGE', 'SUMMARY', 'BALANCE', 'REGISTERED', 'OFFICE', 'CUSTOMER', 'PRIVILEGE', 'BANKING', 'LIMITED', 'CIN'];
        const nameLike = rawLines.slice(0, 15).find(l =>
          /^[A-Z][A-Za-z.\s]{2,40}$/.test(l) &&
          l.split(/\s+/).length <= 5 &&
          !DICT.banks.some(b => up(l).includes(b)) &&
          !BANNER_WORDS.some(w => up(l).includes(w))
        );
        if (nameLike) account_holder = nameLike;
      }
    }
  }
  const dates = transactions.map(t2 => parseDateFlexible(t2.date)).filter(Boolean).sort((a, b) => a - b);
  const statement_period = dates.length ? `${dates[0].toLocaleDateString('en-GB')} - ${dates[dates.length - 1].toLocaleDateString('en-GB')}` : '';
  return { bank_name, account_number, account_holder, statement_period };
}

// Ordinal-suffixed day-of-month label ("1st", "28th") for salary-date
// display.
function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}
// Modal (most common) day-of-month across a salary group's transaction
// dates. Salary near month-end sometimes lands the 1st-3rd of the
// following month instead (weekends/holidays push the credit), so a mix
// of "high" (>=28) and "low" (<=3) days is treated as one wraparound
// cluster ("28th-1st") rather than reported as a wide, unclustered spread.
// A tight (<=3 day) non-wraparound spread is also reported as a window;
// anything wider/noisier falls back to just the single modal day rather
// than forcing a misleading exact date.
function computeSalaryDate(list) {
  const days = list.map(t => { const d = parseDateFlexible(t.date); return d ? d.getDate() : null; }).filter(Boolean);
  if (!days.length) return '';
  const uniqueDays = [...new Set(days)];
  if (uniqueDays.length === 1) return ordinal(uniqueDays[0]);
  const freq = {};
  days.forEach(d => { freq[d] = (freq[d] || 0) + 1; });
  const modal = Number(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]);
  const isMonthEndCluster = uniqueDays.every(d => d >= 28 || d <= 3) && uniqueDays.some(d => d >= 28) && uniqueDays.some(d => d <= 3);
  if (isMonthEndCluster) {
    const high = Math.min(...uniqueDays.filter(d => d >= 28));
    const low = Math.max(...uniqueDays.filter(d => d <= 3));
    return `${ordinal(high)}-${ordinal(low)}`;
  }
  const spread = Math.max(...uniqueDays) - Math.min(...uniqueDays);
  if (spread <= 3) return `${ordinal(Math.min(...uniqueDays))}-${ordinal(Math.max(...uniqueDays))}`;
  return ordinal(modal);
}

function detectSalary(txns, holderTokens) {
  // Broker settlement credits (iDirect/EBA trade proceeds), mutual-fund
  // redemptions, wallet top-ups/reversals, lender disbursals, and
  // self-transfers can all recur monthly at plausible-looking amounts, but
  // none of them are salary - without this exclusion the highest-scoring
  // recurring-credit group could be built entirely out of e.g. ICICI Direct
  // trade settlements (or MF redemptions, or a customer moving money
  // between their own accounts) and get reported as "Monthly Salary
  // Credits", inflating estimated income and understating FOIR. Confirmed
  // real: 7 credits narrated "Fund transfer INF/INFT/000081245209/Self"
  // (varying amounts) were adopted as salary, with employer_name surfacing
  // as the nonsense "FUND INF INFT" once partyKey() stripped the transfer-
  // rail codes and the word SELF out of the grouping key - the same tell
  // seen in the broker/MF false positives before those got excluded here.
  // isSelfTransferTxn() is the SAME check frequent_transfers uses for its
  // own is_self flag - tested against the raw description, since partyKey()
  // strips the word SELF before grouping and a holderTokens-name check
  // alone can't catch a narration that never prints the holder's name at
  // all. Mirrors the same exclusion detectSecondaryIncome uses below.
  const credits = txns.filter(t => num(t.credit) > 0 && !isBrokerTxn(t.description) && !isMutualFundTxn(t.description) && !has(t.description, DICT.wallets) && !has(t.description, DICT.lenders) && !isSelfTransferTxn(t.description));
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
  if (best) {
    // Best-effort only - employer_name is just the same canonical party
    // key already used for grouping, surfaced under a clearer name rather
    // than recomputed. If the narration is a personal name or generic
    // ("SAL CR"), this legitimately comes back looking unclear - that's
    // partyKey()'s existing behavior, not something to paper over here.
    best.employer_name = best.key;
    best.salary_date = computeSalaryDate(best.list);
  }
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
    // and would double-count as "income" here otherwise. Two DIFFERENT
    // self-transfer shapes, both needed: holderTokens catches a narration
    // that prints the account holder's own name as the beneficiary;
    // isSelfTransferTxn() (the same check frequent_transfers/detectSalary
    // use) catches the generic ".../Self" narration shape that never prints
    // the holder's name at all and would otherwise sail through this first
    // check untouched.
    if (holderTokens.some(tok => key.includes(tok))) return;
    if (has(t.description, DICT.lenders) || has(t.description, DICT.wallets) || isBrokerTxn(t.description) || isMutualFundTxn(t.description) || isSelfTransferTxn(t.description)) return;
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

// The original fintech/BNPL-app lender list, BEFORE the mainstream NBFC
// additions (Bajaj Finance, Tata Capital, etc. fund consumer/auto loans,
// not BNPL/app-based small loans, so they're deliberately excluded here).
const BNPL_APP_LENDERS = ['KREDITBEE', 'KREDIT BEE', 'KRAZYBEE', 'NAVI', 'LAZYPAY', 'LAZY PAY', 'MONEYTAP', 'MONEY TAP', 'CASHE', 'EARLYSALARY', 'EARLY SALARY', 'FIBE', 'KISSHT', 'PAYSENSE', 'PAY SENSE', 'SMARTCOIN', 'SMART COIN', 'STASHFIN', 'STASH FIN', 'MPOKKET', 'M POKKET', 'SLICE', 'BRANCH', 'DHANI', 'RUPEEREDEE', 'TRUEBALANCE', 'TRUE BALANCE', 'AVAIL FINANCE', 'BHARAT LOAN', 'LOANTAP', 'LOAN TAP', 'POCKETCASH', 'KREDITONE', 'ZESTMONEY', 'ZEST MONEY', 'KISETSU', 'KISETSU SAISON', 'RESPO FINANCIAL', 'RESPO', 'INCRED FINANCE', 'INCRED', 'AMAZON PAY LATER'];
const HOME_LOAN_HINTS = ['HOME LOAN', 'HOUSING LOAN', 'HL '];
const HOME_LOAN_LENDERS = ['LIC HOUSING', 'PNB HOUSING', 'INDIABULLS HOUSING', 'HDFC LTD'];
// 'CC LIMIT' requires the word LIMIT alongside it - bare 'CC' alone is too
// ambiguous with "credit card" to use as a business-loan signal on its own.
const BUSINESS_LOAN_HINTS = ['BUSINESS LOAN', 'MSME', 'WORKING CAPITAL', 'OD LIMIT', 'CC LIMIT'];
// Classifies a recognized EMI/lender debit into a loan-type bucket for
// underwriting. Order matters: CREDIT_CARD and the other specific-narration
// buckets are checked before the generic BNPL-app-lender/PERSONAL fallback,
// so a narration matching more than one hint resolves to its most specific
// bucket rather than always falling through to PERSONAL.
function classifyLoanType(party, description) {
  const p = up(party || '');
  if (hasBillPaymentApp(description) || /\bPAVC\b/i.test(description) || /CREDIT\s*CARD|CC\s*PAYMENT/i.test(description)) return 'CREDIT_CARD';
  if (has(description, HOME_LOAN_HINTS) || HOME_LOAN_LENDERS.some(l => p.includes(l))) return 'HOME';
  if (has(description, BUSINESS_LOAN_HINTS)) return 'BUSINESS';
  // Only an EXPLICIT auto/vehicle-loan phrase counts - the generic AUTO_CD/
  // AUTO CD autodebit-marker keywords (still in DICT.emiKeywords, kept
  // there for detecting that a debit is EMI-like AT ALL) are NOT a
  // vehicle-loan signal on their own. Confirmed real: a Bajaj Finance
  // PERSONAL loan auto-debited via "CMS/.../BAJAJ_AUTO_CD__ICIC..." was
  // wrongly classified AUTO purely because the narration contains the bare
  // substring "AUTO" - "AUTO_CD" here is almost certainly generic NACH
  // terminology ("Automatic Clearing Debit"), not "auto/vehicle loan". No
  // lender in DICT.lenders is unambiguously auto-loan-specific today - if
  // one is ever added (e.g. a manufacturer-captive auto-finance arm with
  // its own distinct brand name), add it as a lender-name check here
  // rather than loosening this description match back to a bare 'AUTO'.
  if (has(description, ['VEHICLE LOAN', 'CAR LOAN', 'AUTO LOAN'])) return 'AUTO';
  if (BNPL_APP_LENDERS.some(l => p.includes(l))) return 'BNPL';
  return 'PERSONAL';
}

// Splits a list of debits that already share the same lender/party
// grouping key into amount-consistent clusters, using the SAME Rs.500
// -or-15% tolerance style reconcileCibilVsBank() (cibilReconciliation.js)
// already uses to match CIBIL obligations to bank-statement EMIs.
// detectLenderName() only confirms WHO the lender is, not that every debit
// under that name is the SAME loan/product - a customer can genuinely have
// two obligations with the same NBFC (e.g. a large personal loan and a
// small BNPL-style purchase EMI). Confirmed real-world failure: 5 "Bajaj
// Finance" debits (~Rs.22,198, ~Rs.590, ~Rs.1,212, ~Rs.365, ~Rs.225) - two
// financially distinct obligations sharing a lender name - were previously
// collapsed into ONE obligation at the median (~Rs.590), silently
// discarding the ~Rs.22,198 figure entirely and understating FOIR. Sorted
// ascending first so nearby amounts cluster together in order rather than
// by chance transaction sequence; each new amount is compared only against
// the MOST RECENT cluster's running mean (sufficient for the small, mostly
// -monotonic amount sets a single lender's debits form in one statement).
function clusterByAmount(list) {
  const sorted = [...list].sort((a, b) => num(a.debit) - num(b.debit));
  const clusters = [];
  sorted.forEach(t => {
    const amt = num(t.debit);
    const last = clusters[clusters.length - 1];
    const tol = last ? Math.max(500, last.refAmount * 0.15) : 0;
    if (last && Math.abs(amt - last.refAmount) <= tol) {
      last.items.push(t);
      last.refAmount = last.items.reduce((s, x) => s + num(x.debit), 0) / last.items.length;
    } else {
      clusters.push({ refAmount: amt, items: [t] });
    }
  });
  return clusters.map(c => c.items);
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
  const debits = txns.filter(t => num(t.debit) > 0 && !isBrokerTxn(t.description) && (hasEmiKeyword(t.description) || has(t.description, DICT.lenders)));
  const groups = {};
  debits.forEach(t => {
    // Group by the canonical lender name when one is recognized, so the
    // same lender printed under different description wording across
    // months (e.g. "Navi Finserv Limited" vs "Navi Loans", or "BAJAJ_AUTO_CD"
    // vs "AD~1ADBAJAJFINNEW~...") is counted as one obligation instead of
    // splitting into separate under-threshold groups. Falls back to the
    // free-text party parser for EMI-labeled debits with no recognized
    // lender name (e.g. bank ACH-DR auto-debits).
    const lenderMatch = detectLenderName(t.description);
    const k = lenderMatch || partyKey(t.description) || 'EMI';
    if (!groups[k]) groups[k] = [];
    groups[k].push(t);
  });
  const obligations = [];
  Object.entries(groups).filter(([, list]) => list.length >= 2).forEach(([party, list]) => {
    // Every amount cluster becomes its OWN obligation row - never merged
    // or arbitrarily picked - so a genuine second product with the same
    // lender surfaces distinctly instead of corrupting one blended figure.
    // The >=2-occurrence filter above (unchanged from before this fix)
    // already establishes this lender/party is a real recurring
    // counterparty, not a coincidental one-off match, so an individual
    // cluster is trusted even if it itself only has one payment in this
    // statement window (e.g. a second loan taken out late in the period) -
    // dropping it would silently understate the obligation again, exactly
    // the bug being fixed here.
    clusterByAmount(list).forEach(clusterList => {
      const amounts = clusterList.map(t => num(t.debit)).sort((a, b) => a - b);
      const median = amounts[Math.floor(amounts.length / 2)];
      const dates = sortDateStrings(clusterList.map(t => t.date).filter(Boolean));
      // Individual transaction dates/amounts kept alongside the aggregate
      // stats - buildEmiPaymentGrid() needs these to know WHICH months
      // this obligation was actually paid in, not just the overall count.
      obligations.push({ party, amount: median, type: has(clusterList[0].description, ['NACH']) ? 'NACH' : has(clusterList[0].description, ['ECS']) ? 'ECS' : 'EMI', loan_type: classifyLoanType(party, clusterList[0].description), first_seen: dates[0] || '', last_seen: dates[dates.length - 1] || '', count: clusterList.length, transactions: clusterList.map(t => ({ date: t.date, amount: num(t.debit) })) });
    });
  });
  return obligations;
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

// Inferred bounce via EMI due-date drift. The keyword-driven ecs_returns
// detector (see runBehaviourDetectors above) can only catch a bounce the
// bank itself printed an explicit RETURN/BOUNCE/INSUFFICIENT-FUNDS/charge
// line for - but a real NACH first-presentment failure very often retries
// automatically the next business day with NO separate "returned" line at
// all. Confirmed real: a Bajaj Finance EMI that debits on the 2nd of the
// month in 7 of its 8 occurrences debited on the 3rd exactly once, with
// zero explicit bounce/charge text anywhere in the statement for that
// month - the ONLY evidence is the date itself landing later than usual.
// This can NEVER be a confirmed bounce from bank-statement text alone (a
// due date landing on a weekend/bank holiday can also shift a genuinely
// healthy payment by a day or two) - every finding here is a MEDIUM
// -confidence inference for manual verification, not folded into the
// HIGH-confidence bank-confirmed ecs_returns list at the same weight (see
// how computeCreditAssessment() merges the two below).
function detectEmiDateDrift(emiObligations, txns) {
  const findings = [];
  (emiObligations || []).forEach(ob => {
    const dated = (ob.transactions || [])
      .map(t => ({ ...t, d: parseDateFlexible(t.date) }))
      .filter(t => t.d)
      .sort((a, b) => a.d - b.d);
    // Needs enough occurrences to establish a real "usual day" pattern - a
    // 2-payment obligation has nothing meaningful to drift away from.
    if (dated.length < 3) return;
    const dayCounts = {};
    dated.forEach(t => { const day = t.d.getDate(); dayCounts[day] = (dayCounts[day] || 0) + 1; });
    // Most frequent day-of-month wins; ties broken toward the earlier day
    // (arbitrary but deterministic - a genuine tie is rare in practice).
    const modal_day = +Object.entries(dayCounts).sort(([dayA, cA], [dayB, cB]) => cB - cA || dayA - dayB)[0][0];
    dated.forEach(t => {
      const actual_day = t.d.getDate();
      const drift_days = actual_day - modal_day;
      // Only LATER-than-usual counts - paid early is never a bounce signal.
      if (drift_days <= 0) return;
      findings.push({
        pattern_type: 'EMI_DATE_DRIFT_SUSPECTED',
        confidence: 'MEDIUM',
        party: ob.party,
        date: t.date,
        amount: t.amount,
        modal_day,
        actual_day,
        drift_days,
        notes: `Inferred from date drift - usual due date is the ${ordinal(modal_day)}, this month's debit landed on the ${ordinal(actual_day)}. Not an explicit bank-reported return; verify manually before treating as a confirmed bounce.`,
      });
    });
  });
  return findings;
}

function detectCcVendorFunding(txns) {
  return txns.filter(t => num(t.credit) > 0 && has(t.description, DICT.lenders)).map(t => ({ vendor: has(t.description, DICT.lenders), date: t.date, amount: num(t.credit), description: t.description }));
}

function detectMonthlyCashflow(txns, ecsReturns) {
  const byMonth = {};
  txns.forEach(t => {
    const d = parseDateFlexible(t.date);
    const key = d ? monthSortKey(d) : -1;
    if (!byMonth[key]) byMonth[key] = { key, label: monthLabel(d), total_credit: 0, total_debit: 0, closing_balance: 0, minimum_balance: Infinity, lastDate: d, bounce_count: 0 };
    byMonth[key].total_credit += num(t.credit);
    byMonth[key].total_debit += num(t.debit);
    if (!byMonth[key].lastDate || (d && d >= byMonth[key].lastDate)) { byMonth[key].closing_balance = num(t.balance); byMonth[key].lastDate = d; }
    // Lowest point this account touched during the month - distinct from
    // (and complements) detectLowBalanceDays, which flags specific days
    // crossing a FIXED threshold; this is useful even for an account that
    // never crosses any threshold at all.
    byMonth[key].minimum_balance = Math.min(byMonth[key].minimum_balance, num(t.balance));
  });
  ecsReturns.forEach(r => {
    const d = parseDateFlexible(r.return_date);
    if (!d) return;
    const key = monthSortKey(d);
    if (byMonth[key]) byMonth[key].bounce_count += 1;
  });
  return Object.values(byMonth).filter(m => m.key >= 0).sort((a, b) => a.key - b.key).map(m => ({ month: m.label, total_credit: round2(m.total_credit), total_debit: round2(m.total_debit), closing_balance: round2(m.closing_balance), minimum_balance: round2(m.minimum_balance === Infinity ? 0 : m.minimum_balance), bounce_count: m.bounce_count }));
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

  // Card-to-bank cash-out / wallet round-trip findings - LOW-confidence
  // findings (e.g. CREDIT_FUNDS_CC_REPAYMENT) are genuinely ambiguous,
  // ordinary liquidity rotation and deliberately excluded from risk_flags
  // entirely so they can't inflate overall_risk the way a real finding
  // would; they still surface in cashout_patterns/the Excel sheet as
  // informational only.
  (detectors.cashout_patterns || []).filter(f => f.confidence !== 'LOW').forEach(f => {
    risk_flags.push({ type: 'CASHOUT_PATTERN', date: f.transactions[0]?.date || '', description: `${f.pattern_type}: ${f.notes}`, amount: f.transactions.reduce((s, t) => s + (t.amount || 0), 0), severity: f.confidence === 'HIGH' ? 'HIGH' : 'MEDIUM' });
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
  const emi_date_drift = detectEmiDateDrift(emi_obligations, transactions);
  // Merges the bank-confirmed (keyword-matched) bounces with the new
  // inferred-from-date-drift ones into ONE list, tagged so an underwriter
  // can tell them apart (bounce_type: 'CONFIRMED' vs
  // 'INFERRED_DATE_DRIFT') - this is what feeds the Bounce Detail sheet and
  // its TOTAL BOUNCES count in bsaExcelExport.js. Deliberately does NOT
  // replace detectors.ecs_returns for bounceCount/risk_flags/
  // monthly_cashflow below - an unverified date-drift inference must not
  // silently escalate overall_risk to HIGH/REJECT the same way an explicit,
  // bank-confirmed return does.
  const ecs_returns = [
    ...detectors.ecs_returns.map(r => ({ ...r, bounce_type: 'CONFIRMED' })),
    ...emi_date_drift.map(f => {
      const idx = transactions.findIndex(x => x.date === f.date && round2(num(x.debit)) === round2(f.amount));
      const src = idx >= 0 ? transactions[idx] : null;
      const prev = idx > 0 ? transactions[idx - 1] : null;
      return {
        party: f.party,
        return_type: 'EMI_DATE_DRIFT',
        return_date: f.date,
        return_amount: f.amount,
        balance_before: prev ? num(prev.balance) : null,
        balance_after: src ? num(src.balance) : null,
        charge_date: '',
        charge_amount: 0,
        charge_description: f.notes,
        bounce_type: 'INFERRED_DATE_DRIFT',
      };
    }),
  ];

  const cc_vendor_funding = detectCcVendorFunding(transactions);
  const monthly_cashflow = detectMonthlyCashflow(transactions, detectors.ecs_returns);
  const repeat_parties = detectRepeatParties(transactions);
  const { risk_flags, watchlist, positive_signals } = detectRiskFlagsWatchlistPositive(transactions, detectors, salary, emi_payment_grid);

  const bounceCount = detectors.ecs_returns.filter(r => r.return_date).length;
  // LOW-confidence cashout_patterns findings (e.g. CREDIT_FUNDS_CC_REPAYMENT)
  // deliberately do NOT factor in here - they're genuinely ambiguous,
  // ordinary liquidity rotation, not a risk signal on their own.
  const hasHighCashout = (detectors.cashout_patterns || []).some(f => f.confidence === 'HIGH');
  const hasMediumCashout = (detectors.cashout_patterns || []).some(f => f.confidence === 'MEDIUM');
  let overall_risk = 'LOW', recommendation = 'PROCEED';
  if (foir_estimate >= 50 || bounceCount >= 2 || detectors.small_loan_disbursals.frequent || hasHighCashout) { overall_risk = 'HIGH'; recommendation = 'REJECT'; }
  else if (foir_estimate >= 30 || bounceCount === 1 || detectors.cc_card_rotation.detected || hasMediumCashout) { overall_risk = 'MEDIUM'; recommendation = 'CAUTION'; }

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
      employer_name: salary ? salary.employer_name : '',
      salary_date: salary ? salary.salary_date : '',
    },
    risk_flags, watchlist, positive_signals, emi_obligations, emi_payment_grid, emi_date_drift, ecs_returns, cc_vendor_funding, monthly_cashflow, repeat_parties, secondary_income,
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
  // ICICI's PDF table renders the S.No. column at a slightly different
  // baseline than the rest of its own row often enough that pdfToLines()'s
  // row-bucketing keeps it on the SAME reconstructed line as the date, but
  // the S.No. is otherwise indistinguishable from real narration text - a
  // bare "9 04.08.2026 ... EBA//20260804183025 1300.00 279940.65" row would
  // otherwise leave a stray "9" in the parsed description. Only strips a
  // short (1-3 digit) leading token when it's immediately followed by
  // something date-shaped, so this can't eat a legitimate narration that
  // happens to start with a number. Scoped to HEADER_AND_TRAILING
  // (ICICI/PNB) since that's the only observed layout with this artifact.
  const SNO_PREFIX_RE = /^(\d{1,3})\s+(?=\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\d{1,2}[-\s][A-Za-z]{3}\b)/;
  // Confirmed real (not a rendering artifact): some ICICI statement export
  // templates embed literal `<style fontName='...' fontSize='...'>text
  // </style>` markup directly in the extracted PDF text layer around each
  // narration fragment. Stripped as early as possible - right when `line`
  // is first built from the raw row text, before ANY keyword matching,
  // partyKey(), or display - so every downstream consumer benefits, not
  // just this function. Keeps the inner text, drops only the tags
  // themselves.
  const STYLE_TAG_RE = /<\/?style[^>]*>/gi;
  // Pre-pass: find the index of the LAST line that will actually parse as
  // a real transaction row (has both a date and an amount). Anything AFTER
  // it, if it never becomes part of a LATER transaction (there is none by
  // definition), is trailing text at the TRUE end of the document - a
  // bank's own sign-off/footer boilerplate ("Sincerly, Team ICICI Bank" -
  // the bank's own wording, typo included, confirmed real) rather than a
  // continuation of the last real transaction's narration. Every bank's
  // exact sign-off wording differs, so this is positional (before vs.
  // after the last real row), not a keyword list to maintain - the same
  // root problem class as the S.No. leak above, just at the other end of
  // the document.
  let lastTxnLineIndex = -1;
  lines.forEach((raw, i) => {
    const cleaned = raw.replace(STYLE_TAG_RE, ' ').replace(/\s+/g, ' ').trim();
    if (!cleaned || NON_TXN_LABELS.some(l => cleaned.toUpperCase().includes(l))) return;
    const hasDate = DATE.test(cleaned) || (defaultYear && MONTH_DAY_NO_YEAR.test(cleaned));
    const hasAmount = !!cleaned.match(AMT);
    if (hasDate && hasAmount) lastTxnLineIndex = i;
  });
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const raw = lines[lineIdx];
    let line = raw.replace(STYLE_TAG_RE, ' ').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (NON_TXN_LABELS.some(l => line.toUpperCase().includes(l))) { heldLine = null; pending = ''; trailingTarget = null; continue; }
    if (mergeStrategy === 'HEADER_AND_TRAILING') {
      const snoMatch = line.match(SNO_PREFIX_RE);
      if (snoMatch) line = line.slice(snoMatch[0].length);
    }
    let dm = line.match(DATE);
    let resolvedDate = dm ? dm[0] : '';
    if (!dm && defaultYear) {
      const mdm = line.match(MONTH_DAY_NO_YEAR);
      if (mdm) { dm = mdm; resolvedDate = `${mdm[2]}-${mdm[1]}-${defaultYear}`; }
    }
    const amounts = line.match(AMT);
    if (!dm || !amounts) {
      // Nothing left to attach to at the true end of the document -
      // discard rather than merging into the last transaction's
      // description or holding it for a "next" header that will never come.
      if (lastTxnLineIndex >= 0 && lineIdx > lastTxnLineIndex) { heldLine = null; continue; }
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
      else if (/\bDR\b|DEBIT/.test(u) || has(desc, DICT.returnWords) || hasEmiKeyword(desc)) debit = amount;
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
  if (num(t.debit) > 0 && hasEmiKeyword(d)) return 'EMI';
  if (has(d, DICT.atm)) return 'ATM';
  if (has(d, DICT.gst)) return 'GST';
  if (has(d, DICT.insurance)) return 'INSURANCE';
  if (has(d, DICT.epf)) return 'EPF';
  if (isMutualFundTxn(d)) return 'MUTUAL_FUND';
  if (isBrokerTxn(d)) return 'STOCK';
  if (has(d, DICT.forex)) return 'FOREX';
  if (hasBillPaymentApp(d)) return 'CREDIT_CARD_BILL_PAYMENT';
  if (/UPI/i.test(d)) return 'UPI';
  if (hasTransferRail(d)) return 'TRANSFER';
  return 'OTHER';
}
// Exported (unlike most helpers in this file) specifically so external
// tooling - e.g. scripts/smoke-test-bsa.js - can build a complete,
// analyzeBankStatement()-shaped result object from a synthetic/pre-parsed
// transaction list without duplicating this mapping logic.
export function buildAllTransactions(transactions) {
  return transactions.map(t => {
    const category = categorizeTxn(t);
    // Same partyKey() every other detector in this file already uses for
    // internal grouping, just surfaced directly here rather than only
    // computed and discarded - empty string (partyKey()'s own existing
    // behavior) when nothing distinctive is left after stripping, never a
    // fabricated fallback.
    return { date: t.date, description: t.description, debit: t.debit, credit: t.credit, balance: t.balance, category, flag: (category === 'BOUNCE' || category === 'GAMBLING') ? category : '', entity: partyKey(t.description) };
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
  // Resolve the account holder the SAME way computeCreditAssessment()
  // resolves it internally (override, falling back to the statement's own
  // detected header) before handing it to runBehaviourDetectors(). Without
  // this, runBehaviourDetectors()'s internal detectSalary/
  // detectSecondaryIncome calls (used only to build irregular_credits) see
  // an empty holderTokens whenever accountHolderOverride is '' - which is
  // every real call site (Dashboard.js, Admin.js both always pass '') -
  // while computeCreditAssessment()'s OWN calls correctly use the
  // statement-detected name. That mismatch let detectSecondaryIncome's
  // self-transfer exclusion (`holderTokens.some(tok => key.includes(tok))`)
  // disagree between the two call sites: a self-transfer-to-own-account
  // credit group could get silently swallowed into BOTH functions'
  // "claimed" sets for different reasons, vanishing from secondary_income
  // AND irregular_credits at once instead of correctly surfacing in
  // irregular_credits.
  const resolvedAccountHolder = accountHolderOverride || detectHeader(fullText, transactions).account_holder;
  const detectors = runBehaviourDetectors(transactions, resolvedAccountHolder);
  const assessment = computeCreditAssessment(transactions, fullText, detectors, accountHolderOverride);
  return {
    transactionCount: transactions.length,
    transactions,
    all_transactions: buildAllTransactions(transactions),
    ...detectors,
    ...assessment,
  };
}