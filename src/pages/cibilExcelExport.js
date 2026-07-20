/* eslint-disable */
// Excel export for CIBIL / PaisaBazaar reports parsed by CibilParser.js.
// Produces the same 3-sheet workbook (CIBIL Accounts / Summary / Enquiries)
// regardless of source — both parsers normalise into the same `accounts`
// and `enquiries` shape, so this file never needs to know which site the
// PDF came from.
import ExcelJS from 'exceljs'

const num = (v) => {
  const n = parseInt(String(v || '0').replace(/[^0-9]/g, ''))
  return isNaN(n) ? 0 : n
}

// Accounts carry dates in two shapes depending on source:
//  - CIBIL.com:    DD/MM/YYYY
//  - PaisaBazaar:  "DD Mon YYYY"
// This normalises either into a real Date for min/max comparisons, or null.
function parseAnyDate(s) {
  if (!s) return null
  const slash = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (slash) return new Date(+slash[3], +slash[2] - 1, +slash[1])
  const worded = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/)
  if (worded) {
    const MON = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 }
    const mi = MON[worded[2].toLowerCase()]
    if (mi != null) return new Date(+worded[3], mi, +worded[1])
  }
  const d = new Date(s)
  return isNaN(d) ? null : d
}

const fmtDMY = (d) => d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 11 }
const BODY_FONT = { name: 'Arial', size: 10 }

const ACC_HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9C0006' } }
const ACC_HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 11 }
const ROW_FILL_OVERDUE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } }
const ROW_FILL_CURRENT = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } }

function styleHeaderRow(row, fill = HEADER_FILL, font = HEADER_FONT) {
  row.eachCell((cell) => {
    cell.fill = fill
    cell.font = font
    cell.alignment = { vertical: 'middle' }
  })
  row.height = 20
}

export async function downloadCibilWorkbook({ customerName, score, format, reportDate, accounts = [], enquiries, fileLabel }) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CALL-Q PRO'
  wb.created = new Date()

  // ── Sheet 1: CIBIL Accounts ────────────────────────────────────────────
  const wsAcc = wb.addWorksheet('CIBIL Accounts')
  wsAcc.columns = [
    { header: 'Bank Name',          key: 'bankName',      width: 24 },
    { header: 'Loan Type',          key: 'loanType',       width: 26 },
    { header: 'Loan Amount',        key: 'loanAmount',     width: 14 },
    { header: 'Outstanding',        key: 'outstanding',    width: 14 },
    { header: 'EMI/Obligation',     key: 'emi',             width: 14 },
    { header: 'Open Date',          key: 'openDate',       width: 14 },
    { header: 'Closed Date',        key: 'closedDate',     width: 14 },
    { header: 'Tenure (mo)',        key: 'tenure',          width: 12 },
    { header: 'Interest Rate (%)',  key: 'interestRate',   width: 16 },
    { header: 'DPD (days)',         key: 'dpds',            width: 14 },
    { header: 'Overdue',            key: 'overdue',        width: 12 },
    { header: 'Status',             key: 'status',         width: 18 },
  ]
  styleHeaderRow(wsAcc.getRow(1), ACC_HEADER_FILL, ACC_HEADER_FONT)
  accounts.forEach((a) => {
    const row = wsAcc.addRow({
      bankName: a.bankName || '',
      loanType: a.loanType || '',
      loanAmount: num(a.loanAmount),
      outstanding: num(a.outstanding),
      emi: num(a.emi),
      openDate: a.openDate || '',
      closedDate: a.closedDate || '',
      tenure: a.tenure ? num(a.tenure) : '',
      interestRate: a.interestRate ? parseFloat(a.interestRate) : '',
      dpds: a.dpds && a.dpds !== '0' ? a.dpds : '',
      overdue: a.overdue ? num(a.overdue) : '',
      status: a.status || '',
    })
    const rowFill = /overdue/i.test(a.status || '') ? ROW_FILL_OVERDUE : ROW_FILL_CURRENT
    row.eachCell((cell) => { cell.fill = rowFill })
  })
  wsAcc.getColumn('loanAmount').numFmt = '#,##0'
  wsAcc.getColumn('outstanding').numFmt = '#,##0'
  wsAcc.getColumn('emi').numFmt = '#,##0'
  wsAcc.getColumn('overdue').numFmt = '#,##0'
  wsAcc.getColumn('interestRate').numFmt = '0.00'
  wsAcc.eachRow((row, i) => { if (i > 1) row.font = BODY_FONT })
  wsAcc.views = [{ state: 'frozen', ySplit: 1 }]

  // ── Derived summary stats ──────────────────────────────────────────────
  const totalHighCredit = accounts.reduce((s, a) => s + num(a.loanAmount), 0)
  const currentBalance  = accounts.reduce((s, a) => s + num(a.outstanding), 0)
  const overdueAmount   = accounts.reduce((s, a) => s + (a.overdue ? num(a.overdue) : 0), 0)
  const overdueAccounts = accounts.filter(a => a.overdue && num(a.overdue) > 0).length
  const zeroBalance     = accounts.filter(a => num(a.outstanding) === 0).length
  const openDates       = accounts.map(a => parseAnyDate(a.openDate)).filter(Boolean)
  const oldestOpened    = openDates.length ? new Date(Math.min(...openDates)) : null
  const mostRecentOpened= openDates.length ? new Date(Math.max(...openDates)) : null

  const enqDetails = enquiries?.details || []
  const anchor = reportDate ? new Date(reportDate) : new Date()
  const inWindow = (days) => enqDetails.filter(e => {
    const x = (anchor - new Date(e.date)) / 86400000
    return x >= 0 && x <= days
  }).length
  const mostRecentEnquiry = enqDetails.length
    ? new Date(Math.max(...enqDetails.map(e => new Date(e.date))))
    : null

  // ── Sheet 2: Summary ────────────────────────────────────────────────────
  const wsSum = wb.addWorksheet('Summary')
  wsSum.columns = [{ key: 'label', width: 34 }, { key: 'value', width: 30 }]
  wsSum.addRow([`CIBIL Summary - ${customerName || 'Customer'}`, '']).font = { bold: true, size: 13, name: 'Arial' }
  wsSum.addRow([])
  const rows = [
    ['Report Date', reportDate ? fmtDMY(new Date(reportDate)) : ''],
    ['Credit Score', score ?? ''],
    ['Report Source', format === 'cibil' ? 'CIBIL.com' : format === 'paisabazaar' ? 'PaisaBazaar' : format || ''],
    ['Total Accounts (parsed)', accounts.length],
    ['Total High Credit/Sanctioned Amount', totalHighCredit],
    ['Current Balance (all accounts)', currentBalance],
    ['Overdue Amount', overdueAmount],
    ['Overdue Accounts', overdueAccounts],
    ['Zero Balance Accounts', zeroBalance],
    ['Oldest Account Opened', oldestOpened ? fmtDMY(oldestOpened) : ''],
    ['Most Recent Account Opened', mostRecentOpened ? fmtDMY(mostRecentOpened) : ''],
    ['Total Enquiries', enquiries?.total ?? 0],
    ['Enquiries - Past 30 Days', inWindow(30)],
    ['Enquiries - Past 12 Months', inWindow(365)],
    ['Enquiries - Past 24 Months', inWindow(730)],
    ['Most Recent Enquiry', mostRecentEnquiry ? fmtDMY(mostRecentEnquiry) : ''],
    ['Note', '"Total Accounts (parsed)" reflects accounts the parser could extract from the itemised section — it may be lower than a total the report states elsewhere if the source PDF only lists a subset in detail.'],
  ]
  rows.forEach(r => { const row = wsSum.addRow(r); row.font = BODY_FONT; row.getCell(1).font = { ...BODY_FONT, bold: true } })
  wsSum.getColumn(1).alignment = { wrapText: false, vertical: 'top' }
  wsSum.getColumn(2).alignment = { wrapText: true, vertical: 'top' }

  // ── Sheet 3: Enquiries ───────────────────────────────────────────────────
  const wsEnq = wb.addWorksheet('Enquiries')
  wsEnq.columns = [
    { header: 'Member',           key: 'member',  width: 26 },
    { header: 'Enquiry Date',     key: 'date',    width: 16 },
    { header: 'Enquiry Purpose',  key: 'purpose', width: 22 },
    { header: 'Enquiry Amount',   key: 'amount',  width: 16 },
  ]
  styleHeaderRow(wsEnq.getRow(1))
  ;[...enqDetails]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .forEach(e => {
      wsEnq.addRow({
        member: e.institution || '',
        date: fmtDMY(new Date(e.date)),
        purpose: e.product || '',
        amount: e.amount ? num(e.amount) : '',
      })
    })
  wsEnq.getColumn('amount').numFmt = '#,##0'
  wsEnq.eachRow((row, i) => { if (i > 1) row.font = BODY_FONT })
  wsEnq.views = [{ state: 'frozen', ySplit: 1 }]

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const el = document.createElement('a')
  el.href = url
  el.download = `CIBIL_${fileLabel || 'Report'}.xlsx`
  el.click()
  URL.revokeObjectURL(url)
}
