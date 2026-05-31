export type CsvDelimiter = ',' | ';' | '\t'
export type CsvImportKind = 'assets' | 'transactions' | 'income_events' | 'cash_ledger_entries' | 'edo_bonds' | 'unknown'
export type CsvDryRunStatus = 'valid' | 'warning' | 'invalid'

export type CsvDryRunMessage = {
  code: string
  message: string
}

export type CsvParseResult = {
  delimiter: CsvDelimiter
  headers: string[]
  normalizedHeaders: string[]
  rows: string[][]
  errors: CsvDryRunMessage[]
  warnings: CsvDryRunMessage[]
}

export type CsvColumnMapping = {
  targetField: string
  sourceHeader: string | null
  present: boolean
  sampleValue: string | null
}

export type CsvSampleRow = {
  rowNumber: number
  cells: string[]
  normalized: Record<string, string>
}

export type CsvDryRunSummary = {
  status: CsvDryRunStatus
  delimiter: CsvDelimiter | null
  importKind: CsvImportKind
  importKindLabel: string
  brokerHint: string | null
  headers: string[]
  normalizedHeaders: string[]
  rowCount: number
  sampleRows: CsvSampleRow[]
  mapping: CsvColumnMapping[]
  errors: CsvDryRunMessage[]
  warnings: CsvDryRunMessage[]
}

const MAX_PREVIEW_ROWS = 8
const VALIDATION_SAMPLE_ROWS = 100
const CSV_DRY_RUN_ROW_WARNING_LIMIT = 20000
const SUPPORTED_CURRENCIES = new Set(['PLN', 'EUR', 'USD', 'GBP', 'CHF'])
const DELIMITERS: CsvDelimiter[] = [',', ';', '\t']

const IMPORT_KIND_LABELS: Record<CsvImportKind, string> = {
  assets: 'Aktywa',
  transactions: 'Transakcje',
  income_events: 'Dochody / dywidendy',
  cash_ledger_entries: 'Cash ledger',
  edo_bonds: 'Obligacje EDO',
  unknown: 'Nieznany format CSV',
}

const KIND_FIELD_HINTS: Record<CsvImportKind, string[]> = {
  assets: ['symbol', 'name', 'asset_type', 'currency', 'market_symbol', 'price_source'],
  transactions: ['transaction_date', 'transaction_type', 'asset_id', 'quantity', 'source_currency', 'price_source', 'fees_source', 'fx_rate_to_base', 'base_currency'],
  income_events: ['payment_date', 'income_type', 'asset_id', 'currency', 'gross_amount', 'withholding_tax', 'local_tax', 'net_amount', 'net_amount_base'],
  cash_ledger_entries: ['entry_date', 'entry_type', 'amount', 'currency', 'note'],
  edo_bonds: ['series', 'quantity', 'purchase_price', 'purchase_date', 'maturity_date'],
  unknown: [],
}

const REQUIRED_BY_KIND: Record<Exclude<CsvImportKind, 'unknown'>, string[]> = {
  assets: ['symbol', 'name', 'asset_type', 'currency'],
  transactions: ['transaction_type', 'quantity', 'transaction_date'],
  income_events: ['income_type', 'gross_amount', 'net_amount', 'payment_date', 'currency'],
  cash_ledger_entries: ['entry_type', 'amount', 'currency', 'entry_date'],
  edo_bonds: ['series', 'quantity', 'purchase_price', 'purchase_date'],
}

const DATE_FIELDS = new Set([
  'transaction_date',
  'payment_date',
  'entry_date',
  'purchase_date',
  'maturity_date',
  'fx_rate_date',
  'ex_date',
  'record_date',
  'created_at',
  'updated_at',
])

const NUMERIC_FIELDS = new Set([
  'quantity',
  'price',
  'fees',
  'price_source',
  'fees_source',
  'price_base',
  'fees_base',
  'gross_amount',
  'withholding_tax',
  'local_tax',
  'other_fees',
  'net_amount',
  'gross_amount_base',
  'withholding_tax_base',
  'local_tax_base',
  'other_fees_base',
  'net_amount_base',
  'amount',
  'purchase_price',
  'interest_first_year',
  'inflation_margin',
  'fx_rate_to_base',
  'gross_amount_source',
  'gross_amount_base',
  'target_allocation',
])

function message(code: string, text: string): CsvDryRunMessage {
  return { code, message: text }
}

function stripBom(text: string) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function delimiterLabel(delimiter: CsvDelimiter) {
  return delimiter === '\t' ? 'tab' : delimiter
}

function countDelimiterOutsideQuotes(line: string, delimiter: CsvDelimiter) {
  let count = 0
  let inQuotes = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        index += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (!inQuotes && char === delimiter) {
      count += 1
    }
  }
  return count
}

export function detectDelimiter(text: string): CsvDelimiter {
  const sample = stripBom(text)
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, 20)

  const scores = DELIMITERS.map((delimiter) => {
    const counts = sample.map((line) => countDelimiterOutsideQuotes(line, delimiter)).filter((count) => count > 0)
    const total = counts.reduce((sum, count) => sum + count, 0)
    const first = counts[0] ?? 0
    const consistent = counts.filter((count) => count === first).length
    return { delimiter, score: total + consistent }
  })

  return scores.sort((a, b) => b.score - a.score)[0]?.delimiter ?? ','
}

export function normalizeCsvHeaders(headers: string[]) {
  return headers.map((header) => normalizeHeader(header))
}

function normalizeHeader(header: string) {
  return header
    .replace(/^\uFEFF/, '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}

export function parseCsvText(text: string): CsvParseResult {
  const errors: CsvDryRunMessage[] = []
  const warnings: CsvDryRunMessage[] = []
  const normalizedText = stripBom(text)
  const delimiter = detectDelimiter(normalizedText)

  if (!normalizedText.trim()) {
    return {
      delimiter,
      headers: [],
      normalizedHeaders: [],
      rows: [],
      errors: [message('empty-file', 'Plik CSV jest pusty.')],
      warnings,
    }
  }

  const parsedRows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  const pushCell = () => {
    row.push(cell.trim())
    cell = ''
  }

  const pushRow = () => {
    pushCell()
    if (row.some((value) => value.trim().length > 0)) parsedRows.push(row)
    row = []
  }

  for (let index = 0; index < normalizedText.length; index += 1) {
    const char = normalizedText[index]

    if (inQuotes) {
      if (char === '"') {
        if (normalizedText[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        cell += char
      }
      continue
    }

    if (char === '"') {
      if (cell.trim().length === 0) {
        inQuotes = true
      } else {
        cell += char
      }
      continue
    }

    if (char === delimiter) {
      pushCell()
      continue
    }

    if (char === '\r') {
      if (normalizedText[index + 1] === '\n') index += 1
      pushRow()
      continue
    }

    if (char === '\n') {
      pushRow()
      continue
    }

    cell += char
  }

  if (inQuotes) errors.push(message('unclosed-quote', 'CSV zawiera niedomknięty cudzysłów. Podgląd może być niepełny.'))
  if (cell.length > 0 || row.length > 0) pushRow()

  const headers = parsedRows[0] ?? []
  const rows = parsedRows.slice(1)

  if (headers.length === 0 || headers.every((header) => !header.trim())) {
    errors.push(message('missing-headers', 'CSV nie ma wiersza nagłówków.'))
  }

  const expectedLength = headers.length
  const unevenRows = rows.filter((item) => item.length !== expectedLength).length
  if (expectedLength > 0 && unevenRows > 0) {
    warnings.push(message('uneven-row-length', `${unevenRows} wierszy ma inną liczbę kolumn niż nagłówek.`))
  }

  return {
    delimiter,
    headers,
    normalizedHeaders: normalizeCsvHeaders(headers),
    rows,
    errors,
    warnings,
  }
}

function hasAll(headers: Set<string>, fields: string[]) {
  return fields.every((field) => headers.has(field))
}

function scoreKind(headers: Set<string>, kind: Exclude<CsvImportKind, 'unknown'>) {
  const required = REQUIRED_BY_KIND[kind]
  const hints = KIND_FIELD_HINTS[kind]
  const requiredScore = required.filter((field) => headers.has(field)).length * 3
  const hintScore = hints.filter((field) => headers.has(field)).length
  return requiredScore + hintScore
}

export function detectCsvImportKind(headers: string[], rows: string[][] = []): CsvImportKind {
  const normalized = new Set(normalizeCsvHeaders(headers))
  if (hasAll(normalized, REQUIRED_BY_KIND.transactions) || normalized.has('transaction_type')) return 'transactions'
  if (hasAll(normalized, REQUIRED_BY_KIND.income_events) || normalized.has('income_type')) return 'income_events'
  if (hasAll(normalized, REQUIRED_BY_KIND.cash_ledger_entries) || normalized.has('entry_type')) return 'cash_ledger_entries'
  if (hasAll(normalized, REQUIRED_BY_KIND.edo_bonds) || normalized.has('purchase_price')) return 'edo_bonds'
  if (hasAll(normalized, REQUIRED_BY_KIND.assets) || (normalized.has('symbol') && normalized.has('asset_type'))) return 'assets'

  const candidates: Exclude<CsvImportKind, 'unknown'>[] = ['transactions', 'income_events', 'cash_ledger_entries', 'edo_bonds', 'assets']
  const best = candidates
    .map((kind) => ({ kind, score: scoreKind(normalized, kind) }))
    .sort((a, b) => b.score - a.score)[0]

  if ((best?.score ?? 0) >= 5) return best.kind
  if (rows.length === 0) return 'unknown'
  return 'unknown'
}

function headerIndex(headers: string[], field: string) {
  return normalizeCsvHeaders(headers).findIndex((header) => header === field)
}

function cellFor(row: string[], headers: string[], field: string) {
  const index = headerIndex(headers, field)
  return index >= 0 ? row[index] ?? '' : ''
}

function isValidDateLike(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return true
  if (/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(trimmed)) return !Number.isNaN(Date.parse(trimmed))
  if (/^\d{2}[./-]\d{2}[./-]\d{4}$/.test(trimmed)) return true
  return !Number.isNaN(Date.parse(trimmed))
}

function normalizeNumericString(value: string) {
  const trimmed = value.trim().replace(/\s/g, '')
  if (!trimmed) return ''
  const commaCount = (trimmed.match(/,/g) ?? []).length
  const dotCount = (trimmed.match(/\./g) ?? []).length
  if (commaCount === 1 && dotCount === 0) return trimmed.replace(',', '.')
  if (commaCount > 0 && dotCount > 0 && trimmed.lastIndexOf(',') > trimmed.lastIndexOf('.')) {
    return trimmed.replace(/\./g, '').replace(',', '.')
  }
  return trimmed.replace(/,/g, '')
}

function isValidNumberLike(value: string) {
  const normalized = normalizeNumericString(value)
  if (!normalized) return true
  return /^[-+]?\d+(\.\d+)?$/.test(normalized) && Number.isFinite(Number(normalized))
}

function detectBrokerHint(headers: string[]) {
  const joined = normalizeCsvHeaders(headers).join(' ')
  const original = headers.join(' ').toLowerCase()
  if (/\bxtb\b/.test(original) || joined.includes('id_pozycji') || joined.includes('czas_otwarcia') || joined.includes('typ_zlecenia')) {
    return 'Wygląda jak eksport brokera XTB, ale importer XTB będzie dodany w kolejnym etapie. Ten ekran pokazuje tylko podgląd.'
  }
  if (/\bibkr\b/.test(original) || original.includes('interactive brokers') || joined.includes('clientaccountid') || joined.includes('assetclass') || joined.includes('comm_fee')) {
    return 'Wygląda jak eksport brokera IBKR, ale importer IBKR będzie dodany w kolejnym etapie. Ten ekran pokazuje tylko podgląd.'
  }
  return null
}

export function validateCsvRows(headers: string[], rows: string[][], importKind = detectCsvImportKind(headers, rows)): CsvDryRunMessage[] {
  const warnings: CsvDryRunMessage[] = []
  const normalizedHeaders = normalizeCsvHeaders(headers)
  const normalizedHeaderSet = new Set(normalizedHeaders.filter(Boolean))
  const duplicateHeaders = normalizedHeaders.filter((header, index) => header && normalizedHeaders.indexOf(header) !== index)

  if (rows.length === 0) warnings.push(message('no-data-rows', 'CSV nie zawiera wierszy danych.'))
  if (rows.length > CSV_DRY_RUN_ROW_WARNING_LIMIT) {
    warnings.push(message('too-many-rows', `CSV ma ${rows.length.toLocaleString('pl-PL')} wierszy. Przyszły importer powinien przetwarzać go partiami.`))
  }
  if (duplicateHeaders.length > 0) {
    warnings.push(message('duplicate-headers', `Wykryto zduplikowane nagłówki po normalizacji: ${Array.from(new Set(duplicateHeaders)).join(', ')}.`))
  }

  if (importKind !== 'unknown') {
    const missing = REQUIRED_BY_KIND[importKind].filter((field) => !normalizedHeaderSet.has(field))
    if (missing.length > 0) warnings.push(message('missing-required-columns', `Brakuje kolumn wymaganych dla ${IMPORT_KIND_LABELS[importKind]}: ${missing.join(', ')}.`))
  } else {
    warnings.push(message('unknown-format', 'Nieznany format CSV. Pokazuję nagłówki i próbkę, ale przyszły importer będzie wymagał ręcznego mapowania.'))
  }

  const brokerHint = detectBrokerHint(headers)
  if (brokerHint) warnings.push(message('broker-csv-detected', brokerHint))

  const sampledRows = rows.slice(0, VALIDATION_SAMPLE_ROWS)
  const invalidDateFields = new Map<string, number>()
  const invalidNumberFields = new Map<string, number>()
  const unsupportedCurrencies = new Set<string>()
  let decimalCommaRows = 0
  let transactionsWithoutAsset = 0
  let incomeWithoutDate = 0

  sampledRows.forEach((row) => {
    for (const header of normalizedHeaders) {
      const value = cellFor(row, headers, header)
      if (!value) continue
      if (DATE_FIELDS.has(header) && !isValidDateLike(value)) invalidDateFields.set(header, (invalidDateFields.get(header) ?? 0) + 1)
      if (NUMERIC_FIELDS.has(header) && !isValidNumberLike(value)) invalidNumberFields.set(header, (invalidNumberFields.get(header) ?? 0) + 1)
      if (NUMERIC_FIELDS.has(header) && /^\d+,\d+$/.test(value.trim())) decimalCommaRows += 1
      if ((header === 'currency' || header === 'source_currency' || header === 'base_currency') && value.trim() && !SUPPORTED_CURRENCIES.has(value.trim().toUpperCase())) {
        unsupportedCurrencies.add(value.trim().toUpperCase())
      }
    }

    if (importKind === 'transactions' && !cellFor(row, headers, 'asset_id') && !cellFor(row, headers, 'symbol')) transactionsWithoutAsset += 1
    if (importKind === 'income_events' && !cellFor(row, headers, 'payment_date')) incomeWithoutDate += 1
  })

  if (invalidDateFields.size > 0) {
    warnings.push(message('invalid-dates', `Próbka zawiera podejrzane daty: ${Array.from(invalidDateFields.entries()).map(([field, count]) => `${field} (${count})`).join(', ')}.`))
  }
  if (invalidNumberFields.size > 0) {
    warnings.push(message('invalid-numbers', `Próbka zawiera podejrzane liczby: ${Array.from(invalidNumberFields.entries()).map(([field, count]) => `${field} (${count})`).join(', ')}.`))
  }
  if (unsupportedCurrencies.size > 0) {
    warnings.push(message('unsupported-currencies', `Wykryto waluty poza aktualnym podstawowym zakresem: ${Array.from(unsupportedCurrencies).join(', ')}.`))
  }
  if (decimalCommaRows > 0) {
    warnings.push(message('decimal-comma', `Wykryto liczby z przecinkiem dziesiętnym w próbce (${decimalCommaRows}). Przyszły importer powinien jawnie potwierdzić interpretację.`))
  }
  if (transactionsWithoutAsset > 0) {
    warnings.push(message('transaction-asset-missing', `${transactionsWithoutAsset} transakcji w próbce nie ma asset_id ani symbolu.`))
  }
  if (incomeWithoutDate > 0) {
    warnings.push(message('income-payment-date-missing', `${incomeWithoutDate} rekordów dochodu w próbce nie ma payment_date.`))
  }

  return warnings
}

export function previewCsvRows(rows: string[][], limit = MAX_PREVIEW_ROWS, headers: string[] = []): CsvSampleRow[] {
  const normalizedHeaders = normalizeCsvHeaders(headers)
  return rows.slice(0, limit).map((row, index) => {
    const normalized: Record<string, string> = {}
    normalizedHeaders.forEach((header, cellIndex) => {
      if (header) normalized[header] = row[cellIndex] ?? ''
    })
    return { rowNumber: index + 2, cells: row, normalized }
  })
}

function buildMapping(headers: string[], rows: string[][], kind: CsvImportKind): CsvColumnMapping[] {
  const fields = KIND_FIELD_HINTS[kind]
  const normalizedHeaders = normalizeCsvHeaders(headers)
  const firstRow = rows[0] ?? []

  return fields.map((field) => {
    const index = normalizedHeaders.findIndex((header) => header === field)
    return {
      targetField: field,
      sourceHeader: index >= 0 ? headers[index] : null,
      present: index >= 0,
      sampleValue: index >= 0 ? firstRow[index] ?? null : null,
    }
  })
}

export function buildCsvDryRunSummary(parsedCsv: CsvParseResult): CsvDryRunSummary {
  const importKind = parsedCsv.errors.length > 0 && parsedCsv.headers.length === 0
    ? 'unknown'
    : detectCsvImportKind(parsedCsv.headers, parsedCsv.rows)
  const validationWarnings = parsedCsv.headers.length > 0
    ? validateCsvRows(parsedCsv.headers, parsedCsv.rows, importKind)
    : []
  const brokerHint = detectBrokerHint(parsedCsv.headers)
  const errors = parsedCsv.errors
  const warnings = [...parsedCsv.warnings, ...validationWarnings]
  const status: CsvDryRunStatus = errors.length > 0 ? 'invalid' : warnings.length > 0 ? 'warning' : 'valid'

  return {
    status,
    delimiter: parsedCsv.delimiter,
    importKind,
    importKindLabel: IMPORT_KIND_LABELS[importKind],
    brokerHint,
    headers: parsedCsv.headers,
    normalizedHeaders: parsedCsv.normalizedHeaders,
    rowCount: parsedCsv.rows.length,
    sampleRows: previewCsvRows(parsedCsv.rows, MAX_PREVIEW_ROWS, parsedCsv.headers),
    mapping: buildMapping(parsedCsv.headers, parsedCsv.rows, importKind),
    errors,
    warnings,
  }
}

export function describeCsvDelimiter(delimiter: CsvDelimiter | null) {
  return delimiter ? delimiterLabel(delimiter) : '—'
}
