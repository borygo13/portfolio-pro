import { BASE_CURRENCY, normalizeCurrencyCode } from '@/lib/currency'
import { supabase } from '@/lib/supabase/client'
import { listAssets, type Asset } from '@/lib/supabase/portfolio'
import { normalizeCsvHeaders, type CsvDryRunSummary, type CsvImportKind, type CsvParseResult } from './csv-dry-run'

export const CSV_IMPORT_CONFIRMATION_TEXT = 'IMPORTUJ'

export type SupportedCsvActualImportKind = Exclude<CsvImportKind, 'unknown'>

export type CsvActualImportPlan = {
  importable: boolean
  importKind: CsvImportKind
  importKindLabel: string
  rowCount: number
  reasons: string[]
  warnings: string[]
}

export type CsvActualImportResult = {
  importKind: SupportedCsvActualImportKind
  rowCount: number
  inserted: number
  skipped: number
  failed: number
  messages: string[]
}

type CsvRecord = {
  rowNumber: number
  values: Record<string, string>
}

type AssetLookup = {
  byId: Map<string, Asset>
  bySymbol: Map<string, Asset>
  byMarketSymbol: Map<string, Asset>
}

const SUPPORTED_IMPORT_KINDS: SupportedCsvActualImportKind[] = ['assets', 'transactions', 'income_events', 'cash_ledger_entries', 'edo_bonds']
const MAX_DETAIL_MESSAGES = 30
const ASSET_TYPES = new Set(['ETF', 'Akcje', 'Obligacje', 'Gotówka', 'Crypto', 'CFD', 'Inne'])
const CASH_ENTRY_TYPES = new Set(['deposit', 'withdrawal', 'fee', 'tax', 'adjustment'])
const CASH_CURRENCIES = new Set(['PLN', 'EUR', 'USD'])
const INCOME_TYPES = new Set(['DIVIDEND', 'BOND_INTEREST', 'CASH_INTEREST', 'STAKING', 'OTHER'])

function hasHeader(headers: Set<string>, field: string) {
  return headers.has(field)
}

function hasAnyHeader(headers: Set<string>, fields: string[]) {
  return fields.some((field) => headers.has(field))
}

function actualRequiredIssues(kind: CsvImportKind, headers: Set<string>) {
  const issues: string[] = []
  if (kind === 'assets') {
    if (!hasAnyHeader(headers, ['symbol', 'name'])) issues.push('assets wymaga kolumny symbol albo name.')
    for (const field of ['asset_type', 'currency']) if (!hasHeader(headers, field)) issues.push(`assets wymaga kolumny ${field}.`)
  }
  if (kind === 'transactions') {
    for (const field of ['transaction_type', 'quantity', 'transaction_date']) if (!hasHeader(headers, field)) issues.push(`transactions wymaga kolumny ${field}.`)
    if (!hasAnyHeader(headers, ['asset_id', 'symbol', 'market_symbol'])) issues.push('transactions wymaga asset_id, symbol albo market_symbol.')
    if (!hasAnyHeader(headers, ['price', 'price_source', 'price_base'])) issues.push('transactions wymaga price, price_source albo price_base.')
  }
  if (kind === 'income_events') {
    for (const field of ['gross_amount', 'payment_date', 'currency']) if (!hasHeader(headers, field)) issues.push(`income_events wymaga kolumny ${field}.`)
  }
  if (kind === 'cash_ledger_entries') {
    for (const field of ['entry_type', 'amount', 'currency', 'entry_date']) if (!hasHeader(headers, field)) issues.push(`cash_ledger_entries wymaga kolumny ${field}.`)
  }
  if (kind === 'edo_bonds') {
    for (const field of ['series', 'quantity', 'purchase_date']) if (!hasHeader(headers, field)) issues.push(`edo_bonds wymaga kolumny ${field}.`)
  }
  return issues
}

export function buildCsvActualImportPlan(summary: CsvDryRunSummary | null, parsed: CsvParseResult | null): CsvActualImportPlan | null {
  if (!summary || !parsed) return null
  const reasons: string[] = []
  const warnings = ['Import C6.0e działa tylko w trybie append-only.', 'C6.0e nie wykonuje pełnego rozpoznawania duplikatów poza prostymi aktywami.']
  const headers = new Set(summary.normalizedHeaders.filter(Boolean))

  if (parsed.errors.length > 0 || summary.errors.length > 0) reasons.push('CSV ma błędy parsowania.')
  if (!SUPPORTED_IMPORT_KINDS.includes(summary.importKind as SupportedCsvActualImportKind)) reasons.push('Ten format jest tylko do podglądu. Import XTB/IBKR będzie w kolejnym etapie.')
  if (summary.brokerHint) reasons.push('Ten plik wygląda jak CSV brokera. Import XTB/IBKR będzie w kolejnym etapie.')
  if (summary.rowCount <= 0) reasons.push('CSV nie zawiera wierszy danych.')
  reasons.push(...actualRequiredIssues(summary.importKind, headers))

  return {
    importable: reasons.length === 0,
    importKind: summary.importKind,
    importKindLabel: summary.importKindLabel,
    rowCount: summary.rowCount,
    reasons,
    warnings,
  }
}

function toRecords(parsed: CsvParseResult): CsvRecord[] {
  const headers = normalizeCsvHeaders(parsed.headers)
  return parsed.rows.map((row, rowIndex) => {
    const values: Record<string, string> = {}
    headers.forEach((header, cellIndex) => {
      if (header) values[header] = row[cellIndex]?.trim() ?? ''
    })
    return { rowNumber: rowIndex + 2, values }
  })
}

function value(row: CsvRecord, field: string) {
  return row.values[field]?.trim() ?? ''
}

function optionalText(row: CsvRecord, field: string) {
  const text = value(row, field)
  return text ? text : null
}

function normalizeNumberString(raw: string) {
  const trimmed = raw.trim().replace(/\s/g, '')
  if (!trimmed) return ''
  const commaCount = (trimmed.match(/,/g) ?? []).length
  const dotCount = (trimmed.match(/\./g) ?? []).length
  if (commaCount === 1 && dotCount === 0) return trimmed.replace(',', '.')
  if (commaCount > 0 && dotCount > 0 && trimmed.lastIndexOf(',') > trimmed.lastIndexOf('.')) {
    return trimmed.replace(/\./g, '').replace(',', '.')
  }
  return trimmed.replace(/,/g, '')
}

function numberOrNull(row: CsvRecord, field: string) {
  const normalized = normalizeNumberString(value(row, field))
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function positiveNumber(row: CsvRecord, field: string) {
  const parsed = numberOrNull(row, field)
  return parsed != null && parsed > 0 ? parsed : null
}

function nonNegativeNumber(row: CsvRecord, field: string, fallback = 0) {
  const parsed = numberOrNull(row, field)
  return parsed != null && parsed >= 0 ? parsed : fallback
}

function dateOrNull(row: CsvRecord, field: string) {
  const raw = value(row, field)
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)
  const match = raw.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/)
  if (match) return `${match[3]}-${match[2]}-${match[1]}`
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

function boolOrDefault(row: CsvRecord, field: string, fallback: boolean) {
  const raw = value(row, field).toLowerCase()
  if (!raw) return fallback
  if (['true', '1', 'yes', 'tak', 't'].includes(raw)) return true
  if (['false', '0', 'no', 'nie', 'n'].includes(raw)) return false
  return fallback
}

function pushMessage(messages: string[], text: string) {
  if (messages.length < MAX_DETAIL_MESSAGES) messages.push(text)
}

function buildAssetLookup(assets: Asset[]): AssetLookup {
  const byId = new Map<string, Asset>()
  const bySymbol = new Map<string, Asset>()
  const byMarketSymbol = new Map<string, Asset>()
  for (const asset of assets) {
    byId.set(asset.id, asset)
    bySymbol.set(asset.symbol.trim().toUpperCase(), asset)
    if (asset.market_symbol) byMarketSymbol.set(asset.market_symbol.trim().toLowerCase(), asset)
  }
  return { byId, bySymbol, byMarketSymbol }
}

function findAsset(row: CsvRecord, lookup: AssetLookup) {
  const assetId = value(row, 'asset_id')
  if (assetId && lookup.byId.has(assetId)) return lookup.byId.get(assetId) ?? null
  const symbol = value(row, 'symbol').toUpperCase()
  if (symbol && lookup.bySymbol.has(symbol)) return lookup.bySymbol.get(symbol) ?? null
  const marketSymbol = value(row, 'market_symbol').toLowerCase()
  if (marketSymbol && lookup.byMarketSymbol.has(marketSymbol)) return lookup.byMarketSymbol.get(marketSymbol) ?? null
  return null
}

function normalizeAssetType(raw: string) {
  const value = raw.trim()
  return ASSET_TYPES.has(value) ? value : null
}

function csvKind(summary: CsvDryRunSummary): SupportedCsvActualImportKind {
  if (!SUPPORTED_IMPORT_KINDS.includes(summary.importKind as SupportedCsvActualImportKind)) {
    throw new Error('Nieobsługiwany typ CSV.')
  }
  return summary.importKind as SupportedCsvActualImportKind
}

async function importAssets(portfolioId: string, rows: CsvRecord[], messages: string[]) {
  let inserted = 0
  let skipped = 0
  let failed = 0
  const lookup = buildAssetLookup(await listAssets(portfolioId))

  for (const row of rows) {
    const symbol = (optionalText(row, 'symbol') ?? optionalText(row, 'market_symbol') ?? optionalText(row, 'name') ?? '').trim().toUpperCase()
    const name = (optionalText(row, 'name') ?? symbol).trim()
    const assetType = normalizeAssetType(value(row, 'asset_type'))
    const currency = normalizeCurrencyCode(value(row, 'currency'), BASE_CURRENCY)
    const marketSymbol = optionalText(row, 'market_symbol')

    if (!symbol || !name || !assetType || !currency) {
      skipped += 1
      pushMessage(messages, `Wiersz ${row.rowNumber}: pominięto aktywo bez symbolu/nazwy, typu albo waluty.`)
      continue
    }
    if (lookup.bySymbol.has(symbol) || (marketSymbol && lookup.byMarketSymbol.has(marketSymbol.toLowerCase()))) {
      skipped += 1
      pushMessage(messages, `Wiersz ${row.rowNumber}: pominięto duplikat aktywa ${symbol}.`)
      continue
    }

    const payload = {
      portfolio_id: portfolioId,
      symbol,
      name,
      asset_type: assetType,
      currency,
      target_allocation: nonNegativeNumber(row, 'target_allocation', 0),
      market_symbol: marketSymbol,
      price_source: optionalText(row, 'price_source') ?? 'auto',
      auto_refresh_enabled: boolOrDefault(row, 'auto_refresh_enabled', true),
    }

    const { data, error } = await supabase
      .from('assets')
      .insert(payload)
      .select('id,portfolio_id,symbol,name,asset_type,currency,target_allocation,market_symbol,price_source,auto_refresh_enabled,created_at')
      .single()

    if (error) {
      failed += 1
      pushMessage(messages, `Wiersz ${row.rowNumber}: błąd aktywa ${symbol}: ${error.message}`)
      continue
    }

    inserted += 1
    const asset = data as Asset
    lookup.byId.set(asset.id, asset)
    lookup.bySymbol.set(asset.symbol.trim().toUpperCase(), asset)
    if (asset.market_symbol) lookup.byMarketSymbol.set(asset.market_symbol.trim().toLowerCase(), asset)
  }

  return { inserted, skipped, failed }
}

async function importTransactions(portfolioId: string, baseCurrency: string, rows: CsvRecord[], messages: string[]) {
  let inserted = 0
  let skipped = 0
  let failed = 0
  const lookup = buildAssetLookup(await listAssets(portfolioId))

  for (const row of rows) {
    const asset = findAsset(row, lookup)
    const transactionType = value(row, 'transaction_type').toUpperCase()
    const quantity = positiveNumber(row, 'quantity')
    const transactionDate = dateOrNull(row, 'transaction_date')
    const sourceCurrency = normalizeCurrencyCode(value(row, 'source_currency'), asset?.currency ?? baseCurrency)
    const rowBaseCurrency = normalizeCurrencyCode(value(row, 'base_currency'), baseCurrency)
    const priceSource = positiveNumber(row, 'price_source') ?? positiveNumber(row, 'price') ?? positiveNumber(row, 'price_base')
    const feesSource = nonNegativeNumber(row, 'fees_source', nonNegativeNumber(row, 'fees', 0))
    const fxRateToBase = positiveNumber(row, 'fx_rate_to_base')
    let priceBase = positiveNumber(row, 'price_base')
    let feesBase = numberOrNull(row, 'fees_base')

    if (!asset) {
      skipped += 1
      pushMessage(messages, `Wiersz ${row.rowNumber}: brak aktywa dla transakcji.`)
      continue
    }
    if (transactionType !== 'BUY' && transactionType !== 'SELL') {
      skipped += 1
      pushMessage(messages, `Wiersz ${row.rowNumber}: nieprawidłowy typ transakcji.`)
      continue
    }
    if (!quantity || !priceSource || !transactionDate) {
      skipped += 1
      pushMessage(messages, `Wiersz ${row.rowNumber}: brakuje quantity, price/price_source albo transaction_date.`)
      continue
    }

    if (sourceCurrency === rowBaseCurrency) {
      priceBase = priceBase ?? priceSource
      feesBase = feesBase ?? feesSource
    } else if (fxRateToBase) {
      priceBase = priceBase ?? priceSource * fxRateToBase
      feesBase = feesBase ?? feesSource * fxRateToBase
    }

    if (sourceCurrency !== rowBaseCurrency && (!priceBase || (feesSource > 0 && feesBase == null))) {
      skipped += 1
      pushMessage(messages, `Wiersz ${row.rowNumber}: brak FX/base dla transakcji w ${sourceCurrency}. Nie wykonuję fikcyjnej konwersji.`)
      continue
    }

    const { data: insertedTx, error } = await supabase.rpc('create_transaction_checked', {
      p_portfolio_id: portfolioId,
      p_asset_id: asset.id,
      p_transaction_type: transactionType,
      p_quantity: quantity,
      p_price: priceBase ?? priceSource,
      p_fees: feesBase ?? 0,
      p_transaction_date: transactionDate,
      p_notes: optionalText(row, 'notes'),
    })

    if (error) {
      failed += 1
      pushMessage(messages, `Wiersz ${row.rowNumber}: nie dodano transakcji (${error.message}).`)
      continue
    }

    const insertedId = (insertedTx as { id?: string } | null)?.id
    if (!insertedId) {
      failed += 1
      pushMessage(messages, `Wiersz ${row.rowNumber}: transakcja została zapisana, ale nie udało się odczytać id.`)
      continue
    }

    const { error: updateError } = await supabase
      .from('transactions')
      .update({
        source_currency: sourceCurrency,
        price_source: priceSource,
        fees_source: feesSource,
        fx_rate_to_base: sourceCurrency === rowBaseCurrency ? 1 : fxRateToBase,
        base_currency: rowBaseCurrency,
        price_base: priceBase,
        fees_base: feesBase ?? 0,
        gross_amount_source: numberOrNull(row, 'gross_amount_source') ?? quantity * priceSource,
        gross_amount_base: numberOrNull(row, 'gross_amount_base') ?? (priceBase == null ? null : quantity * priceBase),
        fx_rate_date: dateOrNull(row, 'fx_rate_date'),
        fx_rate_source: optionalText(row, 'fx_rate_source'),
      })
      .eq('id', insertedId)

    if (updateError) {
      failed += 1
      pushMessage(messages, `Wiersz ${row.rowNumber}: transakcja dodana, ale nie zapisano pól walutowych (${updateError.message}).`)
      continue
    }

    inserted += 1
  }

  return { inserted, skipped, failed }
}

async function importIncomeEvents(portfolioId: string, baseCurrency: string, rows: CsvRecord[], messages: string[]) {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw new Error('Brak aktywnej sesji użytkownika.')

  let inserted = 0
  let skipped = 0
  let failed = 0
  const lookup = buildAssetLookup(await listAssets(portfolioId))

  for (const row of rows) {
    const incomeType = value(row, 'income_type').toUpperCase() || 'DIVIDEND'
    const currency = normalizeCurrencyCode(value(row, 'currency'), baseCurrency)
    const rowBaseCurrency = normalizeCurrencyCode(value(row, 'base_currency'), baseCurrency)
    const grossAmount = numberOrNull(row, 'gross_amount')
    const withholdingTax = nonNegativeNumber(row, 'withholding_tax', 0)
    const localTax = nonNegativeNumber(row, 'local_tax', 0)
    const otherFees = nonNegativeNumber(row, 'other_fees', 0)
    const netAmount = numberOrNull(row, 'net_amount') ?? (grossAmount == null ? null : grossAmount - withholdingTax - localTax - otherFees)
    const paymentDate = dateOrNull(row, 'payment_date')
    const fxRateToBase = currency === rowBaseCurrency ? 1 : positiveNumber(row, 'fx_rate_to_base')
    const toBase = (field: string, source: number | null) => numberOrNull(row, field) ?? (fxRateToBase && source != null ? source * fxRateToBase : null)

    if (!INCOME_TYPES.has(incomeType) || grossAmount == null || grossAmount < 0 || netAmount == null || netAmount < 0 || !paymentDate) {
      skipped += 1
      pushMessage(messages, `Wiersz ${row.rowNumber}: brakuje poprawnego typu, gross_amount, net_amount albo payment_date.`)
      continue
    }

    const asset = findAsset(row, lookup)
    const payload = {
      user_id: userData.user.id,
      portfolio_id: portfolioId,
      asset_id: asset?.id ?? null,
      income_type: incomeType,
      broker: optionalText(row, 'broker'),
      source: optionalText(row, 'source') ?? 'csv_import',
      currency,
      gross_amount: grossAmount,
      withholding_tax: withholdingTax,
      local_tax: localTax,
      other_fees: otherFees,
      net_amount: netAmount,
      fx_rate_to_base: fxRateToBase,
      fx_rate_date: dateOrNull(row, 'fx_rate_date'),
      fx_rate_source: optionalText(row, 'fx_rate_source'),
      base_currency: rowBaseCurrency,
      gross_amount_base: toBase('gross_amount_base', grossAmount),
      withholding_tax_base: toBase('withholding_tax_base', withholdingTax),
      local_tax_base: toBase('local_tax_base', localTax),
      other_fees_base: toBase('other_fees_base', otherFees),
      net_amount_base: toBase('net_amount_base', netAmount),
      payment_date: paymentDate,
      ex_date: dateOrNull(row, 'ex_date'),
      record_date: dateOrNull(row, 'record_date'),
      notes: optionalText(row, 'notes'),
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase.from('income_events').insert(payload)
    if (error) {
      failed += 1
      pushMessage(messages, `Wiersz ${row.rowNumber}: nie dodano dochodu (${error.message}).`)
      continue
    }
    inserted += 1
  }

  return { inserted, skipped, failed }
}

async function importCashLedger(portfolioId: string, rows: CsvRecord[], messages: string[]) {
  let inserted = 0
  let skipped = 0
  let failed = 0

  for (const row of rows) {
    const entryType = value(row, 'entry_type')
    const amount = positiveNumber(row, 'amount')
    const currency = normalizeCurrencyCode(value(row, 'currency'), BASE_CURRENCY)
    const entryDate = dateOrNull(row, 'entry_date')

    if (!CASH_ENTRY_TYPES.has(entryType) || !amount || !CASH_CURRENCIES.has(currency) || !entryDate) {
      skipped += 1
      pushMessage(messages, `Wiersz ${row.rowNumber}: niepoprawny cash ledger entry_type, amount, currency albo entry_date.`)
      continue
    }

    const { error } = await supabase.from('cash_ledger_entries').insert({
      portfolio_id: portfolioId,
      entry_type: entryType,
      amount,
      currency,
      entry_date: entryDate,
      note: optionalText(row, 'note'),
      updated_at: new Date().toISOString(),
    })

    if (error) {
      failed += 1
      pushMessage(messages, `Wiersz ${row.rowNumber}: nie dodano cash ledger (${error.message}).`)
      continue
    }
    inserted += 1
  }

  return { inserted, skipped, failed }
}

async function importEdoBonds(portfolioId: string, rows: CsvRecord[], messages: string[]) {
  let inserted = 0
  let skipped = 0
  let failed = 0

  for (const row of rows) {
    const series = value(row, 'series').toUpperCase()
    const quantity = positiveNumber(row, 'quantity')
    const purchasePrice = positiveNumber(row, 'purchase_price') ?? 100
    const purchaseDate = dateOrNull(row, 'purchase_date')
    const maturityDate = dateOrNull(row, 'maturity_date')

    if (!series || !quantity || !purchaseDate || !maturityDate) {
      skipped += 1
      pushMessage(messages, `Wiersz ${row.rowNumber}: brakuje series, quantity, purchase_date albo maturity_date wymaganej przez model EDO.`)
      continue
    }

    const { error } = await supabase.from('edo_bonds').insert({
      portfolio_id: portfolioId,
      series,
      quantity,
      purchase_price: purchasePrice,
      purchase_date: purchaseDate,
      interest_first_year: nonNegativeNumber(row, 'interest_first_year', 0),
      inflation_margin: nonNegativeNumber(row, 'inflation_margin', 0),
      maturity_date: maturityDate,
    })

    if (error) {
      failed += 1
      pushMessage(messages, `Wiersz ${row.rowNumber}: nie dodano obligacji EDO (${error.message}).`)
      continue
    }
    inserted += 1
  }

  return { inserted, skipped, failed }
}

export async function importPortfolioCsv(
  portfolioId: string,
  baseCurrency: string | null | undefined,
  parsed: CsvParseResult,
  summary: CsvDryRunSummary,
): Promise<CsvActualImportResult> {
  const plan = buildCsvActualImportPlan(summary, parsed)
  if (!plan?.importable) throw new Error(plan?.reasons[0] ?? 'CSV nie jest gotowy do importu.')

  const importKind = csvKind(summary)
  const rows = toRecords(parsed)
  const messages: string[] = []
  const normalizedBaseCurrency = normalizeCurrencyCode(baseCurrency, BASE_CURRENCY)
  const counts = importKind === 'assets'
    ? await importAssets(portfolioId, rows, messages)
    : importKind === 'transactions'
      ? await importTransactions(portfolioId, normalizedBaseCurrency, rows, messages)
      : importKind === 'income_events'
        ? await importIncomeEvents(portfolioId, normalizedBaseCurrency, rows, messages)
        : importKind === 'cash_ledger_entries'
          ? await importCashLedger(portfolioId, rows, messages)
          : await importEdoBonds(portfolioId, rows, messages)

  return {
    importKind,
    rowCount: rows.length,
    inserted: counts.inserted,
    skipped: counts.skipped,
    failed: counts.failed,
    messages,
  }
}
