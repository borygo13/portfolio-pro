codex/analyze-portfolio-pro-repository-7wms0h
# Portfolio PRO - Stage C4.1a Market History Foundations
=======
# Portfolio PRO - Stage C3.4 Foundation Stabilization
main

## Start lokalny

1. Skopiuj `.env.local` ze starszej wersji do folderu projektu albo utwórz nowy plik z danymi Supabase:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

codex/analyze-portfolio-pro-repository-7wms0h
2. W Supabase SQL Editor uruchom aktualny schemat bazowy Stage C3.4, jeśli nie był jeszcze zastosowany:

```text
supabase/stage-c3-4-foundation.sql
```

3. Następnie uruchom addytywną migrację Stage C4.1a dla historii rynku:

```text
supabase/stage-c4-1-market-history.sql
```

`supabase/schema.sql` pozostaje kanonicznym snapshotem fundamentu C3.4. Starszy plik `supabase/stage-c3-price-engine.sql` jest oznaczony jako legacy i służy tylko projektom, które miały już wcześniejszą bazę C3 i potrzebowały samej tabeli `asset_prices`.

4. Uruchom projekt:
=======
2. W Supabase SQL Editor uruchom aktualny, kompletny zestaw migracji Stage C3.4:

```text
supabase/stage-c3-4-foundation.sql
```

`supabase/schema.sql` jest kanonicznym snapshotem tego samego schematu. Starszy plik `supabase/stage-c3-price-engine.sql` jest oznaczony jako legacy i służy tylko projektom, które miały już wcześniejszą bazę C3 i potrzebowały samej tabeli `asset_prices`.

3. Uruchom projekt:
main

```bash
npm install
npm run dev
```

5. Wejdź na:

```text
http://localhost:3000
```

## Co robi Stage C3.4
codex/analyze-portfolio-pro-repository-7wms0h

- porządkuje schemat Supabase zgodnie z aktualnym kodem aplikacji,
- dodaje tabele używane przez appkę: `profiles`, `portfolios`, `assets`, `transactions`, `asset_prices`, `edo_bonds`,
- zachowuje obecny model UI/UX i folderów,
- utrzymuje ręczne ceny jako fallback/override,
- dodaje DB-level ochronę przed sprzedażą większej ilości niż posiadana przez RPC `create_transaction_checked`,
- zostawia client-side walidację sprzedaży jako szybki feedback UX,
- usuwa demo balance CFD z łącznej wartości majątku na dashboardzie,
- nie zmienia jeszcze EDO engine, price engine ani analytics/history engine.

## Ważne decyzje migracyjne

- Aktywny model C3.4 używa `portfolio_id` jako klucza separującego dane portfela użytkownika.
- Legacy elementy z wcześniejszego szkicu schematu (`accounts`, `bonds_edo`, `tx_type`, `amount`, `fee`, `executed_at`, user-level `assets`) nie są częścią aktywnego schematu C3.4.
- RLS opiera się o relację `portfolios.user_id = auth.uid()`.
- Wstawianie transakcji z aplikacji przechodzi przez RPC `create_transaction_checked`, żeby walidacja oversell działała również na poziomie bazy.


## Stage C4.1a - Market History Foundations

Migracja `supabase/stage-c4-1-market-history.sql` jest addytywna i nie zmienia aktualnego UI, API routes ani logiki odświeżania cen. Jej celem jest przygotowanie bazy pod Stage C4 Historical Market Engine.

Dodaje:

- metadane aktywów pod przyszłe odświeżanie cen: `market_symbol`, `price_source`, `auto_refresh_enabled`, `last_price_refresh_at`, `last_price_refresh_error`,
- `market_prices` jako historyczne ceny instrumentów,
- `fx_rates` jako historię kursów walut,
- `portfolio_snapshots` jako dzienne snapshoty portfela pod przyszłe wykresy i analitykę,
- `price_refresh_runs` i `price_refresh_run_items` jako przyszły log manualnych/cron/backfill odświeżeń,
- indeksy i RLS dla nowych tabel,
- jednorazowy, idempotentny seed `market_prices` z obecnej tabeli `asset_prices`.

### Bezpieczne zastosowanie na istniejącej lokalnej bazie

1. Zrób backup przed migracją, np.:

```bash
supabase db dump --local -f backups/before-c4-1-market-history.sql
```

2. Upewnij się, że baza ma już zastosowany fundament C3.4 (`portfolios`, `assets.portfolio_id`, `transactions.transaction_type`, `asset_prices`).
3. Uruchom `supabase/stage-c4-1-market-history.sql` w Supabase SQL Editor.
4. Sprawdź, czy dane z `asset_prices` zostały zseedowane do `market_prices`:

```sql
select count(*) from asset_prices;
select count(*) from market_prices where source = 'asset_prices_seed';
```

Migracja nie usuwa ani nie modyfikuje istniejących rekordów `asset_prices`, więc obecne ekrany nadal korzystają z dotychczasowego latest-price modelu. Nowe tabele pozostają przygotowaniem pod kolejne etapy C4.1b/C4.1c.
=======

- porządkuje schemat Supabase zgodnie z aktualnym kodem aplikacji,
- dodaje tabele używane przez appkę: `profiles`, `portfolios`, `assets`, `transactions`, `asset_prices`, `edo_bonds`,
- zachowuje obecny model UI/UX i folderów,
- utrzymuje ręczne ceny jako fallback/override,
- dodaje DB-level ochronę przed sprzedażą większej ilości niż posiadana przez RPC `create_transaction_checked`,
- zostawia client-side walidację sprzedaży jako szybki feedback UX,
- usuwa demo balance CFD z łącznej wartości majątku na dashboardzie,
- nie zmienia jeszcze EDO engine, price engine ani analytics/history engine.

## Ważne decyzje migracyjne

- Aktywny model C3.4 używa `portfolio_id` jako klucza separującego dane portfela użytkownika.
- Legacy elementy z wcześniejszego szkicu schematu (`accounts`, `bonds_edo`, `tx_type`, `amount`, `fee`, `executed_at`, user-level `assets`) nie są częścią aktywnego schematu C3.4.
- RLS opiera się o relację `portfolios.user_id = auth.uid()`.
- Wstawianie transakcji z aplikacji przechodzi przez RPC `create_transaction_checked`, żeby walidacja oversell działała również na poziomie bazy.
main
