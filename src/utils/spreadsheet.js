/* eslint-disable */
import * as XLSX from 'xlsx'

// Download a 2D array (first row = headers) as a .xlsx file
export function exportToExcel(filename, aoa, sheetName = 'Sheet1') {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const name = String(filename).replace(/\.(csv|xlsx|xls)$/i, '') + '.xlsx'
  XLSX.writeFile(wb, name)
}

// Read .xlsx/.xls/.csv/.txt (first sheet) into { headers:[], rows:[{header:value}] }
export function parseSpreadsheet(file) {
  return new Promise((resolve, reject) => {
    const ext = (file.name.split('.').pop() || '').toLowerCase()
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read file'))
    reader.onload = (ev) => {
      try {
        let wb
        if (ext === 'csv' || ext === 'txt') {
          wb = XLSX.read(String(ev.target.result).replace(/^﻿/, ''), { type: 'string' })
        } else {
          wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' })
        }
        const ws = wb.Sheets[wb.SheetNames[0]]
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' })
        if (!aoa.length) { resolve({ headers: [], rows: [] }); return }
        const headers = aoa[0].map(h => String(h).trim())
        const rows = aoa.slice(1)
          .map(r => { const o = {}; headers.forEach((h, i) => { o[h] = r[i] != null ? String(r[i]).trim() : '' }); return o })
          .filter(o => Object.values(o).some(v => v !== ''))
        resolve({ headers, rows })
      } catch (e) { reject(e) }
    }
    if (ext === 'csv' || ext === 'txt') reader.readAsText(file, 'UTF-8')
    else reader.readAsArrayBuffer(file)
  })
}

// Auto-map arbitrary headers to lead fields → { field: headerName | null }
const FIELD_ALIASES = {
  full_name: ['name','fullname','customername','custname','applicantname','leadname','borrower'],
  mobile: ['mobile','mobileno','mobilenumber','phone','phoneno','phonenumber','contact','contactnumber','number','mob','cell','whatsapp','whatsappnumber'],
  loan_amount: ['loanamount','amount','loanamt','requiredamount','reqamount','loan'],
  application_id: ['applicationid','appid','appno','applicationno','appnumber','leadid'],
  lead_date: ['date','leaddate','dateadded','createddate','entrydate'],
  sheet_number: ['sheetnumber','sheetno','sheet','srno','serialno','slno','refno','referenceno'],
  agent_name: ['agent','agentname','existingagent','assignedagent','assignedto','telecaller','caller'],
  city: ['city','location','place','area'],
  notes: ['notes','remark','remarks','comment','comments','note'],
}
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
export function autoMapHeaders(headers) {
  const map = {}
  const normed = headers.map(h => ({ h, n: norm(h) }))
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    let f = normed.find(x => aliases.includes(x.n)) || normed.find(x => aliases.some(a => x.n.includes(a)))
    map[field] = f ? f.h : null
  }
  return map
}
