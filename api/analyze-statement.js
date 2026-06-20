export const config = { maxDuration: 60 }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    // Now accepts statementText (extracted client-side) instead of the raw PDF.
    // Falls back to pdfBase64 for backward compatibility.
    const { statementText, pdfBase64, phase } = req.body
    if (!statementText && !pdfBase64) return res.status(400).json({ error: 'No statement data provided' })

    const phase1Prompt = `You are an expert Indian bank statement analyzer. Below is the extracted text of a bank statement. Analyze it and return ONLY a valid JSON object with no markdown, no backticks, no explanation. Return exactly this structure:
{
  "summary": {
    "account_holder": "",
    "bank_name": "",
    "account_number": "",
    "statement_period": "",
    "total_credits": 0,
    "total_debits": 0,
    "average_monthly_balance": 0,
    "closing_balance": 0,
    "opening_balance": 0
  },
  "credit_assessment": {
    "overall_risk": "LOW/MEDIUM/HIGH",
    "income_stability": "STABLE/UNSTABLE/IRREGULAR",
    "estimated_monthly_income": 0,
    "total_emi_burden": 0,
    "foir_estimate": 0,
    "recommendation": "PROCEED/CAUTION/REJECT",
    "summary_notes": ""
  },
  "risk_flags": [
    { "type": "", "date": "", "description": "", "amount": 0, "severity": "HIGH/MEDIUM/LOW" }
  ],
  "emi_obligations": [
    { "party": "", "amount": 0, "type": "EMI/ECS/NACH", "first_seen": "", "last_seen": "", "count": 0 }
  ],
  "cc_vendor_funding": [
    { "vendor": "", "date": "", "amount": 0, "description": "" }
  ],
  "monthly_cashflow": [
    { "month": "", "total_credit": 0, "total_debit": 0, "closing_balance": 0, "bounce_count": 0 }
  ]
}
Known CC/Fintech vendors: Slice, Kreditbee, Navi, LazyPay, ZestMoney, EarlySalary, Kissht, CASHe, PaySense, Fibe, SmartCoin, StashFin, Bajaj Finserv, HDB, Tata Capital, CRED, Poonawalla, Lendingkart, Capital Float, Indifi, IIFL, Fullerton, HomeCredit, L&T Finance, Cholamandalam, Manappuram, Muthoot.
Bounces: RETURN, BOUNCE, DISHONOUR, UNPAID, INSUFFICIENT, INWARD RTN, ECS RTN, NACH RTN, CHQ RTN.
Gambling: Dream11, MPL, My11Circle, Betway, 1xBet, Rummy, PokerBaazi, Adda52.
IMPORTANT: total_emi_burden MUST equal the sum of the monthly amount of every recurring EMI/ECS/NACH obligation in emi_obligations. Never 0 if obligations exist. foir_estimate = (total_emi_burden / estimated_monthly_income) * 100.
Return ONLY raw JSON.

STATEMENT TEXT:
${statementText || ''}`

    const phase2Prompt = `You are an expert Indian bank statement analyzer. Below is the extracted text of a bank statement. Analyze it and return ONLY a valid JSON object with no markdown, no backticks, no explanation. Return exactly this structure:
{
  "watchlist": [
    { "type": "ROUND_FIGURE/UPI_LARGE/SALARY_ADVANCE/FREQUENT_ATM/INWARD_CHEQUE_RETURN", "date": "", "description": "", "amount": 0 }
  ],
  "positive_signals": [
    { "type": "REGULAR_SALARY/GST_PAYMENT/INSURANCE_PREMIUM/CONSISTENT_BALANCE/EPF", "date": "", "description": "", "amount": 0 }
  ],
  "repeat_parties": [
    { "party": "", "total_debit": 0, "total_credit": 0, "transaction_count": 0, "flag": "NORMAL/SUSPICIOUS" }
  ]
}
Keep repeat_parties to TOP 10 only. Keep watchlist to max 15 items. Keep positive_signals to max 10 items.
Return ONLY raw JSON. No transactions list needed.

STATEMENT TEXT:
${statementText || ''}`

    const prompt = phase === 2 ? phase2Prompt : phase1Prompt

    // If text was provided, send text-only (cheap, no 200k limit). Otherwise fall
    // back to the old PDF document mode.
    const content = statementText
      ? [{ type: 'text', text: prompt }]
      : [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: prompt }
        ]

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8000,
        messages: [{ role: 'user', content }]
      })
    })

    const data = await response.json()
    if (!response.ok) return res.status(500).json({ error: data.error?.message || 'API error' })

    const text = data.content?.map(c => c.text || '').join('') || ''
    const clean = text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)
    return res.status(200).json(parsed)

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
