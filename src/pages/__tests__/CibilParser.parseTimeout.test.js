import { render, screen, fireEvent, act } from '@testing-library/react'
import CibilParser, { PARSE_TIMEOUT_MS, PARSE_TIMEOUT_MSG, PARSE_TIMEOUT_MSG_NO_DOC } from '../CibilParser'

jest.mock('../../supabase', () => ({ supabase: { from: () => ({}) } }))
jest.mock('../cibilExcelExport', () => ({ downloadCibilWorkbook: jest.fn() }))

// Regression test for a report that sat on "⏳ Parsing…" forever with no error: parseFile had no
// ceiling, so any pdf.js / CDN stall that never settled left the spinner up with no way out.
describe('CibilParser parse timeout safety net', () => {
  let pdfStub
  beforeEach(() => {
    jest.useFakeTimers()
    jest.spyOn(console, 'time').mockImplementation(() => {})
    jest.spyOn(console, 'timeEnd').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
    pdfStub = { numPages: 99, getPage: () => new Promise(() => {}) } // page extraction never settles
    window['pdfjs-dist/build/pdf'] = {
      GlobalWorkerOptions: {},
      getDocument: () => ({ promise: Promise.resolve(pdfStub) }),
    }
  })
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
    delete window['pdfjs-dist/build/pdf']
  })

  const upload = () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'report.pdf', { type: 'application/pdf' })
    const input = document.getElementById('cibil-inp')
    fireEvent.change(input, { target: { files: [file] } })
  }
  // FileReader in jsdom completes asynchronously on real-ish ticks — flush it plus the awaits after.
  const flush = async () => { for (let i = 0; i < 20; i++) await act(async () => { jest.advanceTimersByTime(1) }) }

  test('a stalled text-layer parse aborts after the timeout, clears the spinner and offers OCR', async () => {
    render(<CibilParser source="cibil" />)
    upload()
    await flush()
    expect(screen.getByText('Parsing…')).toBeInTheDocument()

    await act(async () => { jest.advanceTimersByTime(PARSE_TIMEOUT_MS - 1000) })
    expect(screen.getByText('Parsing…')).toBeInTheDocument()

    await act(async () => { jest.advanceTimersByTime(1500) })
    expect(screen.queryByText('Parsing…')).not.toBeInTheDocument()
    expect(screen.getByText(PARSE_TIMEOUT_MSG)).toBeInTheDocument()
    // The PDF loaded before extraction stalled, so the OCR option the message mentions is offered —
    // as a manual button, not auto-started (the file may have a real text layer and just be huge).
    expect(screen.getByText(/OCR recovery on missing page/)).toBeInTheDocument()
    expect(screen.queryByText(/Reading page\(s\) with OCR/)).not.toBeInTheDocument()
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('aborted during: text-layer probe'))
    // Upload area is back, so the user can try another file.
    expect(document.getElementById('cibil-inp')).toBeInTheDocument()
  })

  test('a timeout before the PDF even opens says so, with no (useless) OCR button', async () => {
    window['pdfjs-dist/build/pdf'].getDocument = () => ({ promise: new Promise(() => {}) })
    render(<CibilParser source="cibil" />)
    upload()
    await flush()
    await act(async () => { jest.advanceTimersByTime(PARSE_TIMEOUT_MS + 500) })
    expect(screen.queryByText('Parsing…')).not.toBeInTheDocument()
    expect(screen.getByText(PARSE_TIMEOUT_MSG_NO_DOC)).toBeInTheDocument()
    expect(screen.queryByText(/OCR recovery on missing page/)).not.toBeInTheDocument()
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('aborted during: opening PDF'))
  })

  test('no text layer on the first pages → skips full extraction and auto-starts OCR', async () => {
    const getPage = jest.fn(() => Promise.resolve({ getTextContent: () => Promise.resolve({ items: [] }) }))
    pdfStub.getPage = getPage
    render(<CibilParser source="cibil" />)
    upload()
    await flush()
    expect(getPage).toHaveBeenCalledTimes(3) // probe only — not all 99 pages
    expect(screen.queryByText('Parsing…')).not.toBeInTheDocument()
    expect(screen.getByText(/no readable text layer \(99 pages\)/)).toBeInTheDocument()
    expect(screen.getByText(/Reading page\(s\) with OCR/)).toBeInTheDocument() // auto-started
    expect(screen.queryByText(/Parse failed|took too long/)).not.toBeInTheDocument()
  })

  test('a CDN failure loading pdf.js surfaces an error instead of hanging', async () => {
    delete window['pdfjs-dist/build/pdf']
    const realAppend = document.head.appendChild.bind(document.head)
    jest.spyOn(document.head, 'appendChild').mockImplementation(el => {
      if (el.tagName === 'SCRIPT') { setTimeout(() => el.onerror && el.onerror(new Event('error')), 0); return el }
      return realAppend(el)
    })
    render(<CibilParser source="cibil" />)
    upload()
    await flush()
    expect(screen.queryByText('Parsing…')).not.toBeInTheDocument()
    expect(screen.getByText(/Parse failed: Failed to load PDF library/)).toBeInTheDocument()
  })
})
