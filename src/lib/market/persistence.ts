import { createClient, type SupabaseClient } from '@supabase/supabase-js'
 codex/analyze-portfolio-pro-repository-twrrob
import { createPortfolioSnapshot } from './snapshots'
import type { AssetForPricing, MarketPriceResult, RefreshRunSummary, RefreshTrigger } from './types'

export type ServerSupabase = SupabaseClient<any, 'public', any>

export function getServerSupabase(): ServerSupabase | null {

import type { AssetForPricing, MarketPriceResult, RefreshRunSummary } from './types'

type ServerSupabase = SupabaseClient<any, 'public', any>

function getServerSupabase(): ServerSupabase | null {
main
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) return null
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } })
}

function priceDate(result: MarketPriceResult) {
  return result.priceDate ?? result.fetchedAt.slice(0, 10)
}

function portfolioIdFrom(assets: AssetForPricing[], prices: MarketPriceResult[]) {
  return prices.find((item) => item.portfolioId)?.portfolioId ?? assets.find((asset) => asset.portfolio_id)?.portfolio_id ?? null
}

async function upsertLatestPrice(supabase: ServerSupabase, portfolioId: string, result: MarketPriceResult) {
  if (!result.price || result.price <= 0) return

  const { error } = await supabase.from('asset_prices').upsert({
    portfolio_id: portfolioId,
    asset_id: result.assetId,
    price: result.price,
    currency: result.currency,
    priced_at: result.fetchedAt,
    updated_at: result.fetchedAt,
  }, { onConflict: 'portfolio_id,asset_id' })

  if (error) throw new Error(`asset_prices: ${error.message}`)
}

async function upsertMarketPrice(supabase: ServerSupabase, portfolioId: string, result: MarketPriceResult) {
  if (!result.price || result.price <= 0) return

  const sourceCurrency = result.sourceCurrency ?? result.currency
  const closePrice = result.closePrice ?? result.sourcePrice ?? result.price
  const closePriceBase = result.currency === 'PLN' ? result.price : null

  const { error } = await supabase.from('market_prices').upsert({
    portfolio_id: portfolioId,
    asset_id: result.assetId,
    source: result.source,
    source_symbol: result.sourceSymbol ?? result.symbol,
    price_date: priceDate(result),
    open_price: result.openPrice ?? null,
    high_price: result.highPrice ?? null,
    low_price: result.lowPrice ?? null,
    close_price: closePrice,
    adjusted_close_price: result.adjustedClosePrice ?? closePrice,
    source_currency: sourceCurrency,
    base_currency: result.currency,
    fx_rate_to_base: result.fxRateToBase ?? (sourceCurrency === result.currency ? 1 : null),
    close_price_base: closePriceBase,
    fetched_at: result.fetchedAt,
  }, { onConflict: 'asset_id,source,price_date' })

  if (error) throw new Error(`market_prices: ${error.message}`)
}

async function upsertFxRate(supabase: ServerSupabase, result: MarketPriceResult) {
  if (!result.fxRate || result.fxRate.rate <= 0) return

  const { error } = await supabase.from('fx_rates').upsert({
    from_currency: result.fxRate.fromCurrency,
    to_currency: result.fxRate.toCurrency,
    rate_date: result.fxRate.rateDate,
    rate: result.fxRate.rate,
    source: result.fxRate.source.toLowerCase(),
    fetched_at: result.fxRate.fetchedAt,
  }, { onConflict: 'from_currency,to_currency,rate_date,source' })

  if (error) throw new Error(`fx_rates: ${error.message}`)
}

async function updateAssetRefreshStatus(supabase: ServerSupabase, result: MarketPriceResult) {
  const { error } = await supabase
    .from('assets')
    .update({
      last_price_refresh_at: result.fetchedAt,
      last_price_refresh_error: result.error ?? null,
    })
    .eq('id', result.assetId)

  if (error) throw new Error(`assets: ${error.message}`)
}

codex/analyze-portfolio-pro-repository-twrrob
export async function persistRefresh(
  assets: AssetForPricing[],
  prices: MarketPriceResult[],
  triggerType: RefreshTrigger,
  options: { enabled?: boolean; createSnapshot?: boolean; snapshotSource?: string } = {},
): Promise<RefreshRunSummary> {
  if (options.enabled === false) return { persistenceError: 'Brak zweryfikowanej sesji użytkownika; ceny zwrócono bez zapisu historii.' }

export async function persistManualRefresh(assets: AssetForPricing[], prices: MarketPriceResult[], enabled = true): Promise<RefreshRunSummary> {
  if (!enabled) return { persistenceError: 'Brak zweryfikowanej sesji użytkownika; ceny zwrócono bez zapisu historii.' }
main

  const supabase = getServerSupabase()
  const portfolioId = portfolioIdFrom(assets, prices)
  if (!supabase || !portfolioId) return { persistenceError: 'Brak SUPABASE_SERVICE_ROLE_KEY albo portfolio_id; ceny zwrócono bez zapisu historii.' }

codex/analyze-portfolio-pro-repository-twrrob
  const { data: run, error: runError } = await supabase
    .from('price_refresh_runs')
    .insert({ portfolio_id: portfolioId, trigger_type: triggerType, status: 'running', requested_assets: assets.length })

  const requestedAssets = assets.length
  const initialStatus = 'running'
  const { data: run, error: runError } = await supabase
    .from('price_refresh_runs')
    .insert({ portfolio_id: portfolioId, trigger_type: 'manual', status: initialStatus, requested_assets: requestedAssets })
main
    .select('id')
    .single()

  if (runError) return { persistenceError: `price_refresh_runs: ${runError.message}` }
  const runId = String(run.id)
  let refreshedAssets = 0
  let failedAssets = 0
  let persistenceError: string | undefined

  for (const result of prices) {
    const initialItemStatus = result.error ? 'failed' : result.price && result.price > 0 ? 'success' : 'skipped'
    let itemStatus = initialItemStatus
    let itemPersistenceError: string | undefined

    try {
      await upsertFxRate(supabase, result)
      await upsertMarketPrice(supabase, portfolioId, result)
      await upsertLatestPrice(supabase, portfolioId, result)
      await updateAssetRefreshStatus(supabase, result)
    } catch (err: any) {
      itemStatus = 'failed'
      itemPersistenceError = err?.message ?? 'Nie udało się zapisać wyniku odświeżenia.'
      if (!persistenceError) persistenceError = itemPersistenceError
    }

    if (itemStatus === 'success') refreshedAssets += 1
    if (itemStatus === 'failed') failedAssets += 1

    const { error: itemError } = await supabase.from('price_refresh_run_items').insert({
      run_id: runId,
      portfolio_id: portfolioId,
      asset_id: result.assetId,
      symbol: result.symbol,
      source: result.source,
      status: itemStatus,
      price_date: result.price ? priceDate(result) : null,
      price: result.price,
      currency: result.currency,
      error: result.error ?? itemPersistenceError ?? null,
    })

    if (itemError && !persistenceError) persistenceError = `price_refresh_run_items: ${itemError.message}`
  }

  const status = persistenceError
    ? refreshedAssets > 0 ? 'partial_success' : 'failed'
    : failedAssets > 0 ? refreshedAssets > 0 ? 'partial_success' : 'failed'
      : 'success'

  const { error: finishError } = await supabase
    .from('price_refresh_runs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      refreshed_assets: refreshedAssets,
      failed_assets: failedAssets,
      error: persistenceError ?? null,
    })
    .eq('id', runId)

  if (finishError && !persistenceError) persistenceError = `price_refresh_runs update: ${finishError.message}`
codex/analyze-portfolio-pro-repository-twrrob

  let snapshotWarning: string | undefined
  let snapshotDate: string | undefined
  if (options.createSnapshot !== false && refreshedAssets > 0) {
    try {
      const snapshot = await createPortfolioSnapshot(supabase, portfolioId, options.snapshotSource ?? triggerType)
      snapshotDate = snapshot.snapshotDate
    } catch (err: any) {
      snapshotWarning = err?.message ?? 'Nie udało się utworzyć snapshotu portfolio.'
    }
  }

  return { runId, persistenceError, snapshotWarning, snapshotDate }
}

export async function persistManualRefresh(assets: AssetForPricing[], prices: MarketPriceResult[], enabled = true): Promise<RefreshRunSummary> {
  return persistRefresh(assets, prices, 'manual', { enabled, createSnapshot: true, snapshotSource: 'manual' })
=======
  return { runId, persistenceError }
main
}
