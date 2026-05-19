import type { User } from '@supabase/supabase-js'
import { supabase } from './client'
import { ensureUserWorkspace } from './bootstrap'

export type AssetType = 'ETF' | 'Akcje' | 'Obligacje' | 'Gotówka' | 'Crypto' | 'CFD' | 'Inne'

export type Portfolio = {
  id: string
  user_id: string
  name: string
  currency: string | null
}

export type Asset = {
  id: string
  portfolio_id: string
  symbol: string
  name: string
  asset_type: string
  currency: string | null
  target_allocation: number | null
  market_symbol?: string | null
  price_source?: string | null
  auto_refresh_enabled?: boolean | null
  created_at: string
}

export type CreateAssetInput = {
  symbol: string
  name: string
  asset_type: AssetType
  currency: string
  target_allocation: number
  market_symbol?: string | null
  price_source?: string | null
}

export type InstrumentCatalogRow = {
  id: string
  name: string
  symbol: string
  market_symbol: string
  provider: string
  category: string
  asset_type: string
  currency: string
  exchange: string | null
  country: string | null
  aliases: string[] | null
  benchmark_candidate: boolean
  is_active: boolean
  created_at: string
  updated_at: string | null
}

const INSTRUMENT_CATALOG_SELECT = 'id,name,symbol,market_symbol,provider,category,asset_type,currency,exchange,country,aliases,benchmark_candidate,is_active,created_at,updated_at'

function normalizeCatalogSearch(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function catalogSearchText(item: InstrumentCatalogRow) {
  return normalizeCatalogSearch([
    item.name,
    item.symbol,
    item.market_symbol,
    item.provider,
    item.category,
    item.asset_type,
    item.currency,
    item.exchange ?? '',
    item.country ?? '',
    ...(item.aliases ?? []),
  ].join(' '))
}

function filterCatalogRows(rows: InstrumentCatalogRow[], query: string) {
  const terms = normalizeCatalogSearch(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return rows
  return rows.filter((row) => {
    const haystack = catalogSearchText(row)
    return terms.every((term) => haystack.includes(term))
  })
}

export async function getDefaultPortfolio(user: User): Promise<Portfolio> {
  await ensureUserWorkspace(user)

  const { data, error } = await supabase
    .from('portfolios')
    .select('id,user_id,name,currency')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .single()

  if (error) throw new Error(`Nie udało się pobrać portfolio: ${error.message}`)
  return data as Portfolio
}

export async function listAssets(portfolioId: string): Promise<Asset[]> {
  const { data, error } = await supabase
    .from('assets')
    .select('id,portfolio_id,symbol,name,asset_type,currency,target_allocation,market_symbol,price_source,auto_refresh_enabled,created_at')
    .eq('portfolio_id', portfolioId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Nie udało się pobrać aktywów: ${error.message}`)
  return (data ?? []) as Asset[]
}

export async function createAsset(portfolioId: string, input: CreateAssetInput): Promise<Asset> {
  const payload = {
    portfolio_id: portfolioId,
    symbol: input.symbol.trim().toUpperCase(),
    name: input.name.trim(),
    asset_type: input.asset_type,
    currency: input.currency.trim().toUpperCase(),
    target_allocation: input.target_allocation || 0,
    market_symbol: input.market_symbol?.trim() || null,
    price_source: input.price_source?.trim() || 'auto',
  }

  const { data, error } = await supabase
    .from('assets')
    .insert(payload)
    .select('id,portfolio_id,symbol,name,asset_type,currency,target_allocation,market_symbol,price_source,auto_refresh_enabled,created_at')
    .single()

  if (error) throw new Error(`Nie udało się dodać aktywa: ${error.message}`)
  return data as Asset
}

export async function deleteAsset(assetId: string) {
  const { error } = await supabase.from('assets').delete().eq('id', assetId)
  if (error) throw new Error(`Nie udało się usunąć aktywa: ${error.message}`)
}


export type TransactionType = 'BUY' | 'SELL'

export type Transaction = {
  id: string
  portfolio_id: string
  asset_id: string
  transaction_type: TransactionType
  quantity: number
  price: number
  fees: number | null
  transaction_date: string
  notes: string | null
  created_at: string
  assets?: Pick<Asset, 'symbol' | 'name' | 'asset_type' | 'currency'> | null
}

export type CreateTransactionInput = {
  asset_id: string
  transaction_type: TransactionType
  quantity: number
  price: number
  fees: number
  transaction_date: string
  notes?: string
}

export async function listTransactions(portfolioId: string): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select('id,portfolio_id,asset_id,transaction_type,quantity,price,fees,transaction_date,notes,created_at,assets(symbol,name,asset_type,currency)')
    .eq('portfolio_id', portfolioId)
    .order('transaction_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Nie udało się pobrać transakcji: ${error.message}`)
  return (data ?? []) as unknown as Transaction[]
}

export async function createTransaction(portfolioId: string, input: CreateTransactionInput): Promise<Transaction> {
  const { data: inserted, error } = await supabase.rpc('create_transaction_checked', {
    p_portfolio_id: portfolioId,
    p_asset_id: input.asset_id,
    p_transaction_type: input.transaction_type,
    p_quantity: input.quantity,
    p_price: input.price,
    p_fees: input.fees || 0,
    p_transaction_date: input.transaction_date,
    p_notes: input.notes?.trim() || null,
  })

  if (error) throw new Error(`Nie udało się dodać transakcji: ${error.message}`)

  const insertedId = (inserted as { id?: string } | null)?.id
  if (!insertedId) throw new Error('Nie udało się odczytać zapisanej transakcji.')

  const { data, error: fetchError } = await supabase
    .from('transactions')
    .select('id,portfolio_id,asset_id,transaction_type,quantity,price,fees,transaction_date,notes,created_at,assets(symbol,name,asset_type,currency)')
    .eq('id', insertedId)
    .single()

  if (fetchError) throw new Error(`Nie udało się pobrać zapisanej transakcji: ${fetchError.message}`)
  return data as unknown as Transaction
}

export async function deleteTransaction(transactionId: string) {
  const { error } = await supabase.from('transactions').delete().eq('id', transactionId)
  if (error) throw new Error(`Nie udało się usunąć transakcji: ${error.message}`)
}

export type AssetPrice = {
  id: string
  portfolio_id: string
  asset_id: string
  price: number
  currency: string | null
  priced_at: string | null
  created_at: string
  updated_at: string | null
}

export async function listAssetPrices(portfolioId: string): Promise<AssetPrice[]> {
  const { data, error } = await supabase
    .from('asset_prices')
    .select('id,portfolio_id,asset_id,price,currency,priced_at,created_at,updated_at')
    .eq('portfolio_id', portfolioId)

  if (error) throw new Error(`Nie udało się pobrać cen: ${error.message}`)
  return (data ?? []) as AssetPrice[]
}

export type PortfolioSnapshot = {
  id: string
  portfolio_id: string
  snapshot_date: string
  base_currency?: string | null
  total_value: number
  cash_value?: number | null
  invested_cost: number
  remaining_cost?: number | null
  realized_pnl?: number | null
  unrealized_pnl?: number | null
  total_pnl?: number | null
  net_cash_flow?: number | null
  contribution: number
  dividends_value?: number | null
  fees_value?: number | null
  taxes_value?: number | null
  allocation_breakdown?: { name: string; type: string; value: number; pct: number }[] | null
  benchmark_asset_id?: string | null
  calculated_at: string
}

export async function listPortfolioSnapshots(portfolioId: string): Promise<PortfolioSnapshot[]> {
  const { data, error } = await supabase
    .from('portfolio_snapshots')
    .select('id,portfolio_id,snapshot_date,base_currency,total_value,cash_value,invested_cost,remaining_cost,realized_pnl,unrealized_pnl,total_pnl,net_cash_flow,contribution,dividends_value,fees_value,taxes_value,allocation_breakdown,benchmark_asset_id,calculated_at')
    .eq('portfolio_id', portfolioId)
    .order('snapshot_date', { ascending: true })

  if (error) throw new Error(`Nie udało się pobrać historii portfolio: ${error.message}`)
  return (data ?? []) as PortfolioSnapshot[]
}

export type PriceRefreshRun = {
  id: string
  portfolio_id: string
  trigger_type: 'manual' | 'cron' | 'backfill'
  status: 'running' | 'success' | 'partial_success' | 'failed'
  started_at: string
  finished_at: string | null
  requested_assets: number
  refreshed_assets: number
  failed_assets: number
  error: string | null
}

export async function getLatestPriceRefreshRun(portfolioId: string): Promise<PriceRefreshRun | null> {
  const { data, error } = await supabase
    .from('price_refresh_runs')
    .select('id,portfolio_id,trigger_type,status,started_at,finished_at,requested_assets,refreshed_assets,failed_assets,error')
    .eq('portfolio_id', portfolioId)
    .order('started_at', { ascending: false })
    .limit(1)

  if (error) throw new Error(`Nie udało się pobrać statusu refreshu cen: ${error.message}`)
  return ((data ?? [])[0] ?? null) as PriceRefreshRun | null
}

export type MarketPriceHistoryPoint = {
  id: string
  portfolio_id: string
  asset_id: string
  price_date: string
  close_price: number
  close_price_base: number | null
  base_currency: string | null
  source_currency: string | null
  fetched_at: string
}

export const CHART_RANGES = ['30D', '90D', '1Y', '3Y', '5Y', 'MAX'] as const
export type ChartRange = typeof CHART_RANGES[number]

function chartRangeStartDate(range: ChartRange) {
  if (range === 'MAX') return null
  const days = range === '30D' ? 30 : range === '90D' ? 90 : range === '1Y' ? 365 : range === '3Y' ? 365 * 3 : 365 * 5
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return date.toISOString().slice(0, 10)
}

function chartRangeLimit(range: ChartRange) {
  if (range === '30D') return 90
  if (range === '90D') return 180
  if (range === '1Y') return 420
  if (range === '3Y') return 1200
  if (range === '5Y') return 2200
  return 5000
}

export async function listMarketPriceHistory(portfolioId: string, assetId: string, range: ChartRange = '1Y'): Promise<MarketPriceHistoryPoint[]> {
  let query = supabase
    .from('market_prices')
    .select('id,portfolio_id,asset_id,price_date,close_price,close_price_base,base_currency,source_currency,fetched_at')
    .eq('portfolio_id', portfolioId)
    .eq('asset_id', assetId)

  const startDate = chartRangeStartDate(range)
  if (startDate) query = query.gte('price_date', startDate)

  const { data, error } = await query
    .order('price_date', { ascending: false })
    .limit(chartRangeLimit(range))

  if (error) throw new Error(`Nie udało się pobrać historii cen aktywa: ${error.message}`)
  return ((data ?? []) as MarketPriceHistoryPoint[]).slice().reverse()
}

export type CashLedgerEntryType = 'deposit' | 'withdrawal' | 'fee' | 'tax' | 'adjustment'
export type SupportedCashCurrency = 'PLN' | 'EUR' | 'USD'

export type CashLedgerEntry = {
  id: string
  portfolio_id: string
  entry_type: CashLedgerEntryType
  amount: number
  currency: SupportedCashCurrency
  entry_date: string
  note: string | null
  created_at: string
  updated_at: string | null
}

export type CreateCashLedgerEntryInput = {
  entry_type: CashLedgerEntryType
  amount: number
  currency: SupportedCashCurrency
  entry_date: string
  note?: string
}

export async function listCashLedgerEntries(portfolioId: string): Promise<CashLedgerEntry[]> {
  const { data, error } = await supabase
    .from('cash_ledger_entries')
    .select('id,portfolio_id,entry_type,amount,currency,entry_date,note,created_at,updated_at')
    .eq('portfolio_id', portfolioId)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Nie udało się pobrać cash ledger: ${error.message}`)
  return (data ?? []) as CashLedgerEntry[]
}

export async function createCashLedgerEntry(portfolioId: string, input: CreateCashLedgerEntryInput): Promise<CashLedgerEntry> {
  const payload = {
    portfolio_id: portfolioId,
    entry_type: input.entry_type,
    amount: input.amount,
    currency: input.currency,
    entry_date: input.entry_date,
    note: input.note?.trim() || null,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('cash_ledger_entries')
    .insert(payload)
    .select('id,portfolio_id,entry_type,amount,currency,entry_date,note,created_at,updated_at')
    .single()

  if (error) throw new Error(`Nie udało się dodać wpisu cash ledger: ${error.message}`)
  return data as CashLedgerEntry
}

export async function deleteCashLedgerEntry(id: string) {
  const { error } = await supabase.from('cash_ledger_entries').delete().eq('id', id)
  if (error) throw new Error(`Nie udało się usunąć wpisu cash ledger: ${error.message}`)
}

export type DividendRecord = {
  id: string
  portfolio_id: string
  asset_id: string
  payment_date: string
  gross_amount: number
  tax_amount: number
  net_amount: number
  currency: SupportedCashCurrency
  note: string | null
  created_at: string
  updated_at: string | null
  assets?: Pick<Asset, 'symbol' | 'name' | 'asset_type' | 'currency'> | null
}

export type CreateDividendInput = {
  asset_id: string
  payment_date: string
  gross_amount: number
  tax_amount: number
  currency: SupportedCashCurrency
  note?: string
}

export async function listDividends(portfolioId: string): Promise<DividendRecord[]> {
  const { data, error } = await supabase
    .from('dividends')
    .select('id,portfolio_id,asset_id,payment_date,gross_amount,tax_amount,net_amount,currency,note,created_at,updated_at,assets(symbol,name,asset_type,currency)')
    .eq('portfolio_id', portfolioId)
    .order('payment_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Nie udało się pobrać dywidend: ${error.message}`)
  return (data ?? []) as unknown as DividendRecord[]
}

export async function createDividend(portfolioId: string, input: CreateDividendInput): Promise<DividendRecord> {
  const gross = Number(input.gross_amount)
  const tax = Number(input.tax_amount)
  const net = gross - tax

  if (!input.asset_id) throw new Error('Wybierz aktywo dla dywidendy.')
  if (!input.payment_date) throw new Error('Wybierz datę płatności dywidendy.')
  if (!Number.isFinite(gross) || gross < 0) throw new Error('Kwota brutto dywidendy nie może być ujemna.')
  if (!Number.isFinite(tax) || tax < 0) throw new Error('Podatek od dywidendy nie może być ujemny.')
  if (!Number.isFinite(net) || net < 0) throw new Error('Kwota netto dywidendy nie może być ujemna.')

  const payload = {
    portfolio_id: portfolioId,
    asset_id: input.asset_id,
    payment_date: input.payment_date,
    gross_amount: gross,
    tax_amount: tax,
    net_amount: net,
    currency: input.currency,
    note: input.note?.trim() || null,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('dividends')
    .insert(payload)
    .select('id,portfolio_id,asset_id,payment_date,gross_amount,tax_amount,net_amount,currency,note,created_at,updated_at,assets(symbol,name,asset_type,currency)')
    .single()

  if (error) throw new Error(`Nie udało się dodać dywidendy: ${error.message}`)
  return data as unknown as DividendRecord
}

export async function deleteDividend(id: string) {
  const { error } = await supabase.from('dividends').delete().eq('id', id)
  if (error) throw new Error(`Nie udało się usunąć dywidendy: ${error.message}`)
}

export type PortfolioBenchmark = {
  portfolio_id: string
  benchmark_asset_id: string | null
  created_at: string
  updated_at: string | null
}

export async function getPortfolioBenchmark(portfolioId: string): Promise<PortfolioBenchmark | null> {
  const { data, error } = await supabase
    .from('portfolio_benchmarks')
    .select('portfolio_id,benchmark_asset_id,created_at,updated_at')
    .eq('portfolio_id', portfolioId)
    .maybeSingle()

  if (error) throw new Error(`Nie udało się pobrać benchmarku: ${error.message}`)
  return data as PortfolioBenchmark | null
}

export async function upsertPortfolioBenchmark(portfolioId: string, benchmarkAssetId: string | null): Promise<PortfolioBenchmark> {
  const payload = {
    portfolio_id: portfolioId,
    benchmark_asset_id: benchmarkAssetId || null,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('portfolio_benchmarks')
    .upsert(payload, { onConflict: 'portfolio_id' })
    .select('portfolio_id,benchmark_asset_id,created_at,updated_at')
    .single()

  if (error) throw new Error(`Nie udało się zapisać benchmarku: ${error.message}`)
  return data as PortfolioBenchmark
}

export async function upsertAssetPrice(portfolioId: string, assetId: string, price: number, currency: string) {
  const payload = {
    portfolio_id: portfolioId,
    asset_id: assetId,
    price,
    currency,
    priced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('asset_prices')
    .upsert(payload, { onConflict: 'portfolio_id,asset_id' })
    .select('id,portfolio_id,asset_id,price,currency,priced_at,created_at,updated_at')
    .single()

  if (error) throw new Error(`Nie udało się zapisać ceny: ${error.message}`)
  return data as AssetPrice
}

export type EdoBond = {
  id: string
  portfolio_id: string
  series: string | null
  quantity: number | null
  purchase_price: number | null
  purchase_date: string | null
  interest_first_year: number | null
  inflation_margin: number | null
  maturity_date: string | null
  created_at: string
}

export type CreateEdoBondInput = {
  series: string
  quantity: number
  purchase_price: number
  purchase_date: string
  interest_first_year: number
  inflation_margin: number
  maturity_date: string
}

export async function listEdoBonds(portfolioId: string): Promise<EdoBond[]> {
  const { data, error } = await supabase
    .from('edo_bonds')
    .select('id,portfolio_id,series,quantity,purchase_price,purchase_date,interest_first_year,inflation_margin,maturity_date,created_at')
    .eq('portfolio_id', portfolioId)
    .order('purchase_date', { ascending: false })

  if (error) throw new Error(`Nie udało się pobrać obligacji EDO: ${error.message}`)
  return (data ?? []) as EdoBond[]
}

export async function createEdoBond(portfolioId: string, input: CreateEdoBondInput): Promise<EdoBond> {
  const payload = {
    portfolio_id: portfolioId,
    series: input.series.trim().toUpperCase(),
    quantity: input.quantity,
    purchase_price: input.purchase_price,
    purchase_date: input.purchase_date,
    interest_first_year: input.interest_first_year,
    inflation_margin: input.inflation_margin,
    maturity_date: input.maturity_date,
  }

  const { data, error } = await supabase
    .from('edo_bonds')
    .insert(payload)
    .select('id,portfolio_id,series,quantity,purchase_price,purchase_date,interest_first_year,inflation_margin,maturity_date,created_at')
    .single()

  if (error) throw new Error(`Nie udało się dodać obligacji EDO: ${error.message}`)
  return data as EdoBond
}

export async function deleteEdoBond(id: string) {
  const { error } = await supabase.from('edo_bonds').delete().eq('id', id)
  if (error) throw new Error(`Nie udało się usunąć obligacji EDO: ${error.message}`)
}

export type UpdateAssetInput = Partial<CreateAssetInput> & { market_symbol?: string | null; price_source?: string | null }

export async function updateAsset(assetId: string, input: UpdateAssetInput): Promise<Asset> {
  const payload: Record<string, any> = {}
  if (input.symbol !== undefined) payload.symbol = input.symbol.trim().toUpperCase()
  if (input.name !== undefined) payload.name = input.name.trim()
  if (input.asset_type !== undefined) payload.asset_type = input.asset_type
  if (input.currency !== undefined) payload.currency = input.currency.trim().toUpperCase()
  if (input.target_allocation !== undefined) payload.target_allocation = input.target_allocation || 0
  if (input.market_symbol !== undefined) payload.market_symbol = input.market_symbol?.trim() || null
  if (input.price_source !== undefined) payload.price_source = input.price_source?.trim() || 'auto'

  const { data, error } = await supabase
    .from('assets')
    .update(payload)
    .eq('id', assetId)
    .select('id,portfolio_id,symbol,name,asset_type,currency,target_allocation,market_symbol,price_source,auto_refresh_enabled,created_at')
    .single()

  if (error) throw new Error(`Nie udało się zaktualizować aktywa: ${error.message}`)
  return data as Asset
}

export async function listInstrumentCatalog(limit = 300): Promise<InstrumentCatalogRow[]> {
  const { data, error } = await supabase
    .from('instrument_catalog')
    .select(INSTRUMENT_CATALOG_SELECT)
    .eq('is_active', true)
    .order('benchmark_candidate', { ascending: false })
    .order('symbol', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`Nie udało się pobrać katalogu instrumentów: ${error.message}`)
  return (data ?? []) as InstrumentCatalogRow[]
}

export async function searchInstrumentCatalog(query: string, category?: string): Promise<InstrumentCatalogRow[]> {
  let request = supabase
    .from('instrument_catalog')
    .select(INSTRUMENT_CATALOG_SELECT)
    .eq('is_active', true)
    .order('benchmark_candidate', { ascending: false })
    .order('symbol', { ascending: true })
    .limit(300)

  if (category) request = request.eq('category', category)

  const { data, error } = await request
  if (error) throw new Error(`Nie udało się wyszukać instrumentów: ${error.message}`)

  return filterCatalogRows((data ?? []) as InstrumentCatalogRow[], query).slice(0, 50)
}

export async function listBenchmarkCandidates(): Promise<InstrumentCatalogRow[]> {
  const { data, error } = await supabase
    .from('instrument_catalog')
    .select(INSTRUMENT_CATALOG_SELECT)
    .eq('is_active', true)
    .eq('benchmark_candidate', true)
    .order('category', { ascending: true })
    .order('symbol', { ascending: true })
    .limit(120)

  if (error) throw new Error(`Nie udało się pobrać kandydatów benchmarku: ${error.message}`)
  return (data ?? []) as InstrumentCatalogRow[]
}

export async function updateAssetMarketSymbol(assetId: string, marketSymbol: string | null): Promise<Asset> {
  return updateAsset(assetId, { market_symbol: marketSymbol })
}

export async function applyInstrumentPresetToAsset(assetId: string, presetId: string): Promise<Asset> {
  const { data, error } = await supabase
    .from('instrument_catalog')
    .select(INSTRUMENT_CATALOG_SELECT)
    .eq('id', presetId)
    .eq('is_active', true)
    .single()

  if (error) throw new Error(`Nie udało się pobrać presetu instrumentu: ${error.message}`)
  const preset = data as InstrumentCatalogRow

  return updateAsset(assetId, {
    symbol: preset.symbol,
    name: preset.name,
    asset_type: preset.asset_type as AssetType,
    currency: preset.currency,
    market_symbol: preset.market_symbol,
    price_source: preset.provider,
  })
}
