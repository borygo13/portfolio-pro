import { projectEdoBond, summarizeEdoBonds } from '@/lib/bond-engine'
import { summarizeIncomeEvents } from '@/lib/income-engine'
import { buildAllocationBreakdown, summarizeCashLedger, summarizeDividends } from '@/lib/portfolio-intelligence'
import { buildPositions, portfolioSummary } from '@/lib/position-engine'
import type { Asset, CashLedgerEntry, DividendRecord, EdoBond, IncomeEvent, Portfolio, PortfolioBenchmark, Transaction } from '@/lib/supabase/portfolio'
import { transactionFeeBase } from '@/lib/transaction-math'
import type { AssetPrice } from '@/lib/position-engine'
import type { ServerSupabase } from './persistence'

const SNAPSHOT_TRANSACTION_SELECT = 'id,portfolio_id,asset_id,transaction_type,quantity,price,fees,source_currency,price_source,fees_source,fx_rate_to_base,base_currency,price_base,fees_base,gross_amount_source,gross_amount_base,fx_rate_date,fx_rate_source,transaction_date,notes,created_at'

function today() {
  return new Date().toISOString().slice(0, 10)
}

async function fetchPortfolioSnapshotInputs(supabase: ServerSupabase, portfolioId: string) {
  const [portfolioRes, assetsRes, transactionsRes, pricesRes, bondsRes, cashRes, dividendsRes, incomeRes, benchmarkRes] = await Promise.all([
    supabase.from('portfolios').select('id,user_id,name,currency').eq('id', portfolioId).single(),
    supabase.from('assets').select('id,portfolio_id,symbol,name,asset_type,currency,target_allocation,created_at').eq('portfolio_id', portfolioId),
    supabase.from('transactions').select(SNAPSHOT_TRANSACTION_SELECT).eq('portfolio_id', portfolioId),
    supabase.from('asset_prices').select('id,portfolio_id,asset_id,price,currency,priced_at,created_at,updated_at').eq('portfolio_id', portfolioId),
    supabase.from('edo_bonds').select('id,portfolio_id,series,quantity,purchase_price,purchase_date,interest_first_year,inflation_margin,maturity_date,created_at').eq('portfolio_id', portfolioId),
    supabase.from('cash_ledger_entries').select('id,portfolio_id,entry_type,amount,currency,entry_date,note,created_at,updated_at').eq('portfolio_id', portfolioId),
    supabase.from('dividends').select('id,portfolio_id,asset_id,payment_date,gross_amount,tax_amount,net_amount,currency,note,created_at,updated_at').eq('portfolio_id', portfolioId),
    supabase.from('income_events').select('id,user_id,portfolio_id,asset_id,income_type,broker,source,currency,gross_amount,withholding_tax,local_tax,other_fees,net_amount,fx_rate_to_base,fx_rate_date,fx_rate_source,base_currency,gross_amount_base,withholding_tax_base,local_tax_base,other_fees_base,net_amount_base,payment_date,ex_date,record_date,notes,created_at,updated_at').eq('portfolio_id', portfolioId),
    supabase.from('portfolio_benchmarks').select('portfolio_id,benchmark_asset_id,created_at,updated_at').eq('portfolio_id', portfolioId).maybeSingle(),
  ])

  if (portfolioRes.error) throw new Error(`portfolio_snapshots portfolio: ${portfolioRes.error.message}`)
  if (assetsRes.error) throw new Error(`portfolio_snapshots assets: ${assetsRes.error.message}`)
  if (transactionsRes.error) throw new Error(`portfolio_snapshots transactions: ${transactionsRes.error.message}`)
  if (pricesRes.error) throw new Error(`portfolio_snapshots asset_prices: ${pricesRes.error.message}`)
  if (bondsRes.error) throw new Error(`portfolio_snapshots edo_bonds: ${bondsRes.error.message}`)
  if (cashRes.error) throw new Error(`portfolio_snapshots cash_ledger_entries: ${cashRes.error.message}`)
  if (dividendsRes.error) throw new Error(`portfolio_snapshots dividends: ${dividendsRes.error.message}`)
  if (incomeRes.error) throw new Error(`portfolio_snapshots income_events: ${incomeRes.error.message}`)
  if (benchmarkRes.error) throw new Error(`portfolio_snapshots portfolio_benchmarks: ${benchmarkRes.error.message}`)

  return {
    portfolio: portfolioRes.data as Portfolio,
    assets: (assetsRes.data ?? []) as Asset[],
    transactions: (transactionsRes.data ?? []) as Transaction[],
    prices: (pricesRes.data ?? []) as AssetPrice[],
    bonds: (bondsRes.data ?? []) as EdoBond[],
    cashEntries: (cashRes.data ?? []) as CashLedgerEntry[],
    dividends: (dividendsRes.data ?? []) as DividendRecord[],
    incomeEvents: (incomeRes.data ?? []) as IncomeEvent[],
    benchmark: benchmarkRes.data as PortfolioBenchmark | null,
  }
}

export async function createPortfolioSnapshot(supabase: ServerSupabase, portfolioId: string, source = 'system', snapshotDate = today()) {
  const { portfolio, assets, transactions, prices, bonds, cashEntries, dividends, incomeEvents, benchmark } = await fetchPortfolioSnapshotInputs(supabase, portfolioId)
  const positions = buildPositions(assets, transactions, prices)
  const summary = portfolioSummary(positions)
  const edoSummary = summarizeEdoBonds(bonds.map((bond) => projectEdoBond(bond)))
  const baseCurrency = portfolio.currency ?? 'PLN'
  const cashSummary = summarizeCashLedger(cashEntries, baseCurrency)
  const dividendSummary = summarizeDividends(dividends, baseCurrency)
  const incomeSummary = summarizeIncomeEvents(incomeEvents, baseCurrency)
  const transactionFees = transactions.reduce((sum, transaction) => sum + transactionFeeBase(transaction), 0)

  const positionsValue = summary.totalValue
  const edoValue = edoSummary.currentValueAfterTax
  const cashValue = cashSummary.cashBalanceBase
  const totalValue = positionsValue + edoValue + cashValue
  const feesValue = cashSummary.feesBase + transactionFees
  const taxesValue = cashSummary.taxesBase + dividendSummary.taxBase + incomeSummary.taxBase
  const realizedPnl = summary.realizedPnl + dividendSummary.netBase + incomeSummary.netBase - cashSummary.feesBase - cashSummary.taxesBase
  const unrealizedPnl = summary.unrealizedPnl + (edoValue - edoSummary.principal)
  const totalPnl = realizedPnl + unrealizedPnl
  const allocationBreakdown = buildAllocationBreakdown(positions, edoValue, cashValue, totalValue)

  const payload = {
    portfolio_id: portfolioId,
    snapshot_date: snapshotDate,
    base_currency: baseCurrency,
    total_value: totalValue,
    positions_value: positionsValue,
    edo_value: edoValue,
    cash_value: cashValue,
    invested_cost: summary.investedCost + edoSummary.principal,
    remaining_cost: summary.remainingCost + edoSummary.principal,
    realized_pnl: realizedPnl,
    unrealized_pnl: unrealizedPnl,
    total_pnl: totalPnl,
    net_cash_flow: cashSummary.netCashFlowBase,
    contribution: cashSummary.contributionBase,
    dividends_value: dividendSummary.netBase + incomeSummary.netBase,
    fees_value: feesValue,
    taxes_value: taxesValue,
    allocation_breakdown: allocationBreakdown,
    benchmark_asset_id: benchmark?.benchmark_asset_id ?? null,
    source,
    calculated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('portfolio_snapshots')
    .upsert(payload, { onConflict: 'portfolio_id,snapshot_date' })

  if (error) throw new Error(`portfolio_snapshots upsert: ${error.message}`)
  return { snapshotDate, totalValue }
}
