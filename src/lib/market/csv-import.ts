export const CSV_IMPORT_MAX_ROWS = 10000
export const CSV_IMPORT_SOURCE_LABELS = ['manual_csv', 'stooq_csv', 'yahoo_csv', 'other'] as const
export type CsvImportSourceLabel = typeof CSV_IMPORT_SOURCE_LABELS[number]

export type ParsedCsvPriceRow = {
  rowNumber: number
  priceDate: string
  openPrice: number | null
  highPrice: number | null
  lowPrice: number | null
  closePrice: number
  adjustedClosePrice: number | null
}

export type CsvImportRowError = {
  rowNumber: number
  raw: string
  errors: string[]
}

export type CsvImportPreview = {
  delimiter: ',' | ';'
  parsedRows: number
  validRows: number
  invalidRows: number
  skippedRows: number
  minDate: string | null
  maxDate: string | null
  rows: ParsedCsvPriceRow[]
  errors: CsvImportRowError[]
}

type HeaderMap = {
  date: number
  open: number
  high: number
  low: number
  close: number
  adjustedClose: number
}

const missingHeader: HeaderMap = {
  date: -1,
  open: -1,
  high: -1,
  low: -1,
  close: -1,
  adjustedClose: -1,
}

function normalizeHeader(value: string) {
  return value
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function countDelimiter(line: string, delimiter: ',' | ';') {
  let count = 0
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"' && line[i + 1] === '"') {
      i += 1
      continue
    }
    if (char === '"') quoted = !quoted
    if (!quoted && char === delimiter) count += 1
  }
  return count
}

function detectDelimiter(lines: string[]): ',' | ';' {
  const sample = lines.slice(0, 8).join('\n')
  return countDelimiter(sample, ';') > countDelimiter(sample, ',') ? ';' : ','
}

export function splitCsvLine(line: string, delimiter: ',' | ';') {
  const cells: string[] = []
  let current = ''
  let quoted = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"' && line[i + 1] === '"') {
      current += '"'
      i += 1
      continue
    }
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && char === delimiter) {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += char
  }

  cells.push(current.trim())
  return cells
}

function headerMap(headers: string[]): HeaderMap {
  const map = { ...missingHeader }
  headers.forEach((header, index) => {
    const key = normalizeHeader(header)
    if (['date', 'data', 'datetime', 'time'].includes(key)) map.date = index
    if (['open', 'otwarcie'].includes(key)) map.open = index
    if (['high', 'najwyzszy', 'max'].includes(key)) map.high = index
    if (['low', 'najnizszy', 'min'].includes(key)) map.low = index
    if (['close', 'zamkniecie', 'price', 'cena', 'last'].includes(key)) map.close = index
    if (['adjustedclose', 'adjclose', 'adjusted', 'adj'].includes(key)) map.adjustedClose = index
  })
  return map
}

function validDateParts(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function toDateString(year: number, month: number, day: number) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function parseCsvDate(value: string) {
  const raw = value.trim()
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) {
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    return validDateParts(year, month, day) ? toDateString(year, month, day) : null
  }

  match = raw.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (match) {
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    return validDateParts(year, month, day) ? toDateString(year, month, day) : null
  }

  match = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/)
  if (match) {
    const day = Number(match[1])
    const month = Number(match[2])
    const year = Number(match[3])
    return validDateParts(year, month, day) ? toDateString(year, month, day) : null
  }

  return null
}

export function parseCsvNumber(value: string) {
  const raw = value.trim().replace(/\s|\u00a0/g, '')
  if (!raw) return null

  const hasComma = raw.includes(',')
  const hasDot = raw.includes('.')
  const normalized = hasComma && hasDot
    ? raw.lastIndexOf(',') > raw.lastIndexOf('.')
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '')
    : hasComma
      ? raw.replace(',', '.')
      : raw

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function optionalPrice(cells: string[], index: number, label: string, errors: string[]) {
  if (index < 0 || cells[index] == null || cells[index].trim() === '') return null
  const parsed = parseCsvNumber(cells[index])
  if (parsed == null || parsed < 0) {
    errors.push(`${label} must be a non-negative number.`)
    return null
  }
  return parsed
}

export function parseHistoricalPriceCsv(csvText: string): CsvImportPreview {
  const lines = csvText.split(/\r?\n/)
  const nonEmptyLines = lines.map((line, index) => ({ line, rowNumber: index + 1 })).filter((item) => item.line.trim())
  const delimiter = detectDelimiter(nonEmptyLines.map((item) => item.line))

  if (nonEmptyLines.length === 0) {
    return { delimiter, parsedRows: 0, validRows: 0, invalidRows: 0, skippedRows: 0, minDate: null, maxDate: null, rows: [], errors: [] }
  }

  const header = splitCsvLine(nonEmptyLines[0].line, delimiter)
  const headers = headerMap(header)
  if (headers.date < 0 || headers.close < 0) {
    return {
      delimiter,
      parsedRows: 0,
      validRows: 0,
      invalidRows: 1,
      skippedRows: Math.max(0, lines.length - 1),
      minDate: null,
      maxDate: null,
      rows: [],
      errors: [{
        rowNumber: nonEmptyLines[0].rowNumber,
        raw: nonEmptyLines[0].line,
        errors: ['CSV header must include date/Data and close/Zamkniecie columns.'],
      }],
    }
  }

  const rows: ParsedCsvPriceRow[] = []
  const errors: CsvImportRowError[] = []
  const seenDates = new Set<string>()
  let skippedRows = lines.length - nonEmptyLines.length

  for (const item of nonEmptyLines.slice(1)) {
    if (rows.length + errors.length >= CSV_IMPORT_MAX_ROWS) {
      skippedRows += 1
      continue
    }

    const cells = splitCsvLine(item.line, delimiter)
    const rowErrors: string[] = []
    const priceDate = parseCsvDate(cells[headers.date] ?? '')
    if (!priceDate) rowErrors.push('Invalid date.')

    const closePrice = parseCsvNumber(cells[headers.close] ?? '')
    if (closePrice == null || closePrice < 0) rowErrors.push('Close price must be a non-negative number.')

    const openPrice = optionalPrice(cells, headers.open, 'Open price', rowErrors)
    const highPrice = optionalPrice(cells, headers.high, 'High price', rowErrors)
    const lowPrice = optionalPrice(cells, headers.low, 'Low price', rowErrors)
    const adjustedClosePrice = optionalPrice(cells, headers.adjustedClose, 'Adjusted close price', rowErrors)

    if (priceDate && seenDates.has(priceDate)) rowErrors.push(`Duplicate date ${priceDate}.`)

    if (rowErrors.length > 0 || !priceDate || closePrice == null) {
      errors.push({ rowNumber: item.rowNumber, raw: item.line, errors: rowErrors })
      continue
    }

    seenDates.add(priceDate)
    rows.push({
      rowNumber: item.rowNumber,
      priceDate,
      openPrice,
      highPrice,
      lowPrice,
      closePrice,
      adjustedClosePrice,
    })
  }

  const sortedDates = rows.map((row) => row.priceDate).sort()
  return {
    delimiter,
    parsedRows: rows.length + errors.length,
    validRows: rows.length,
    invalidRows: errors.length,
    skippedRows,
    minDate: sortedDates[0] ?? null,
    maxDate: sortedDates[sortedDates.length - 1] ?? null,
    rows,
    errors,
  }
}

export function isCsvImportSourceLabel(value: unknown): value is CsvImportSourceLabel {
  return CSV_IMPORT_SOURCE_LABELS.includes(value as CsvImportSourceLabel)
}
