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
  created_at: string
}

export type CreateAssetInput = {
  symbol: string
  name: string
  asset_type: AssetType
  currency: string
  target_allocation: number
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
    .select('id,portfolio_id,symbol,name,asset_type,currency,target_allocation,created_at')
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
  }

  const { data, error } = await supabase
    .from('assets')
    .insert(payload)
    .select('id,portfolio_id,symbol,name,asset_type,currency,target_allocation,created_at')
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
  total_value: number
  invested_cost: number
  contribution: number
  calculated_at: string
}

export async function listPortfolioSnapshots(portfolioId: string): Promise<PortfolioSnapshot[]> {
  const { data, error } = await supabase
    .from('portfolio_snapshots')
    .select('id,portfolio_id,snapshot_date,total_value,invested_cost,contribution,calculated_at')
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

export async function listMarketPriceHistory(portfolioId: string, assetId: string): Promise<MarketPriceHistoryPoint[]> {
  const { data, error } = await supabase
    .from('market_prices')
    .select('id,portfolio_id,asset_id,price_date,close_price,close_price_base,base_currency,source_currency,fetched_at')
    .eq('portfolio_id', portfolioId)
    .eq('asset_id', assetId)
    .order('price_date', { ascending: false })
    .limit(180)

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
  received_date: string
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
  received_date: string
  gross_amount: number
  tax_amount: number
  currency: SupportedCashCurrency
  note?: string
}

export async function listDividends(portfolioId: string): Promise<DividendRecord[]> {
  const { data, error } = await supabase
    .from('dividends')
    .select('id,portfolio_id,asset_id,received_date,gross_amount,tax_amount,net_amount,currency,note,created_at,updated_at,assets(symbol,name,asset_type,currency)')
    .eq('portfolio_id', portfolioId)
    .order('received_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Nie udało się pobrać dywidend: ${error.message}`)
  return (data ?? []) as unknown as DividendRecord[]
}

export async function createDividend(portfolioId: string, input: CreateDividendInput): Promise<DividendRecord> {
  const gross = Math.max(0, Number(input.gross_amount) || 0)
  const tax = Math.max(0, Number(input.tax_amount) || 0)
  const payload = {
    portfolio_id: portfolioId,
    asset_id: input.asset_id,
    received_date: input.received_date,
    gross_amount: gross,
    tax_amount: tax,
    net_amount: Math.max(0, gross - tax),
    currency: input.currency,
    note: input.note?.trim() || null,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('dividends')
    .insert(payload)
    .select('id,portfolio_id,asset_id,received_date,gross_amount,tax_amount,net_amount,currency,note,created_at,updated_at,assets(symbol,name,asset_type,currency)')
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

export type UpdateAssetInput = Partial<CreateAssetInput>

export async function updateAsset(assetId: string, input: UpdateAssetInput): Promise<Asset> {
  const payload: Record<string, any> = {}
  if (input.symbol !== undefined) payload.symbol = input.symbol.trim().toUpperCase()
  if (input.name !== undefined) payload.name = input.name.trim()
  if (input.asset_type !== undefined) payload.asset_type = input.asset_type
  if (input.currency !== undefined) payload.currency = input.currency.trim().toUpperCase()
  if (input.target_allocation !== undefined) payload.target_allocation = input.target_allocation || 0

  const { data, error } = await supabase
    .from('assets')
    .update(payload)
    .eq('id', assetId)
    .select('id,portfolio_id,symbol,name,asset_type,currency,target_allocation,created_at')
    .single()

  if (error) throw new Error(`Nie udało się zaktualizować aktywa: ${error.message}`)
  return data as Asset
}
