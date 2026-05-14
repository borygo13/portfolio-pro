# Portfolio PRO - Stage C4.1a Market History Foundations

## Start lokalny

1. Skopiuj `.env.local` ze starszej wersji do folderu projektu albo utwórz nowy plik z danymi Supabase:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=... # wymagane dla C4.1b/C4.1c zapisów server-side
CRON_SECRET=... # wymagane dla /api/cron/prices
```

2. W Supabase SQL Editor uruchom aktualny schemat bazowy Stage C3.4, jeśli nie był jeszcze zastosowany:

```text
supabase/stage-c3-4-foundation.sql
```

3. Następnie uruchom addytywną migrację Stage C4.1a dla historii rynku:

```text
supabase/stage-c4-1-market-history.sql
```

4. Dla Stage C5 Portfolio Intelligence uruchom kolejną addytywną migrację:

```text
supabase/stage-c5-portfolio-intelligence.sql
```

`supabase/schema.sql` pozostaje kanonicznym snapshotem fundamentu C3.4. Starszy plik `supabase/stage-c3-price-engine.sql` jest oznaczony jako legacy i służy tylko projektom, które miały już wcześniejszą bazę C3 i potrzebowały samej tabeli `asset_prices`.

5. Uruchom projekt:

```bash
npm install
npm run dev
```

6. Wejdź na:

```text
http://localhost:3000
```

## Co robi Stage C3.4

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


## Stage C4.1b - Manual Refresh Dual-Write

Manualny refresh cen nadal używa tego samego przycisku i endpointu `POST /api/prices/refresh`, ale logika pobierania cen została przeniesiona do `src/lib/market`. Endpoint zwraca dotychczasowe `prices`, a po stronie serwera próbuje dodatkowo zapisać:

- latest price do `asset_prices`,
- historyczny wpis dzienny do `market_prices`,
- użyty kurs do `fx_rates`, jeśli cena wymagała przeliczenia waluty,
- run do `price_refresh_runs`,
- wynik per aktywo do `price_refresh_run_items`.

Do zapisu historii z API wymagany jest `SUPABASE_SERVICE_ROLE_KEY` ustawiony wyłącznie po stronie serwera. Bez niego endpoint nadal zwróci ceny dla obecnego UI, ale odpowiedź będzie zawierać `persistenceError`, a tabele historii/logów nie zostaną uzupełnione.


## Stage C4.1c/C4.1d - Snapshots and Cron Refresh

Po udanym manualnym albo cron refreshu aplikacja próbuje utworzyć dzienny wpis w `portfolio_snapshots`. Snapshot korzysta z aktualnych danych: `assets`, `transactions`, latest `asset_prices`, `edo_bonds` oraz istniejących silników `position-engine` i `bond-engine`. Jeśli zapis snapshotu się nie powiedzie, refresh cen nadal zwraca wynik, a odpowiedź zawiera `snapshotWarning`.

Cron endpoint:

```text
GET /api/cron/prices
Authorization: Bearer <CRON_SECRET>
```

Endpoint odświeża kwalifikujące się aktywa dla wszystkich portfeli, zapisuje `asset_prices`, `market_prices`, `fx_rates`, `price_refresh_runs`, `price_refresh_run_items` oraz tworzy dzienne snapshoty portfela. Endpoint zwraca `401 Unauthorized`, jeśli `CRON_SECRET` nie jest ustawiony albo token nie pasuje.

### Test manualnego refreshu

1. Ustaw `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` i `SUPABASE_SERVICE_ROLE_KEY`.
2. Uruchom `npm run dev`.
3. Zaloguj się, przejdź do `/long-term` i kliknij manualne odświeżenie cen.
4. Sprawdź SQL:

```sql
select * from asset_prices order by updated_at desc limit 10;
select * from market_prices order by fetched_at desc limit 10;
select * from price_refresh_runs order by started_at desc limit 10;
select * from price_refresh_run_items order by created_at desc limit 20;
select * from portfolio_snapshots order by calculated_at desc limit 10;
```

### Test crona lokalnie

1. Ustaw dodatkowo `CRON_SECRET`.
2. Uruchom `npm run dev`.
3. Wywołaj endpoint:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/prices
```

4. Sprawdź, że błędny sekret jest blokowany:

```bash
curl -i -H "Authorization: Bearer wrong" http://localhost:3000/api/cron/prices
```

5. Zweryfikuj SQL:

```sql
select status, trigger_type, requested_assets, refreshed_assets, failed_assets, started_at, finished_at
from price_refresh_runs
order by started_at desc
limit 10;

select portfolio_id, snapshot_date, total_value, positions_value, edo_value, source, calculated_at
from portfolio_snapshots
order by calculated_at desc
limit 10;
```

`vercel.json` dodaje dzienny harmonogram dla `/api/cron/prices` o 21:30 UTC.


## Stage C5 - Portfolio Intelligence Engine

Migracja `supabase/stage-c5-portfolio-intelligence.sql` dodaje warstwę analityczną bez zmiany istniejących tabel transakcji, refreshu cen ani silnika EDO.

Dodaje:

- `cash_ledger_entries` dla wpłat, wypłat, opłat, podatków i korekt gotówki,
- `dividends` dla dywidend powiązanych z aktywami,
- `portfolio_benchmarks` dla wyboru benchmarku per portfolio,
- dodatkowe pola analityczne w `portfolio_snapshots`: dywidendy, opłaty, podatki, `allocation_breakdown` i `benchmark_asset_id`,
- indeksy, RLS i jawne granty dla nowych tabel używanych z Supabase Data API.

### Test C5 lokalnie

1. Uruchom migracje C3.4, C4.1 i C5 w Supabase SQL Editor.
2. Ustaw `.env.local` jak wyżej i uruchom:

```bash
npm install
npm run dev
```

3. Wejdź do `Long-term -> Intelligence`.
4. Dodaj wpłatę/wypłatę w sekcji Cash.
5. Dodaj dywidendę dla aktywa w sekcji Dividends.
6. Wybierz benchmark w sekcji Benchmark i upewnij się, że wybrane aktywo ma wpisy w `market_prices`.
7. Zweryfikuj SQL:

```sql
select * from cash_ledger_entries order by entry_date desc limit 10;
select * from dividends order by payment_date desc limit 10;
select * from portfolio_benchmarks;
select snapshot_date, contribution, cash_value, dividends_value, fees_value, taxes_value, allocation_breakdown
from portfolio_snapshots
order by snapshot_date desc
limit 10;
```

### Ograniczenia C5

- Metryki performance są prostymi estymacjami z `portfolio_snapshots`, transakcji i ledgerów. Nie są jeszcze pełnym TWR/MWR.
- Wielowalutowy cash ledger i dywidendy są zapisywane w PLN/EUR/USD, ale performance w walucie bazowej używa tylko rekordów w walucie portfolio. Przeliczanie FX dla cashflow zostaje na kolejny etap.
- Historia alokacji korzysta z nowych snapshotów po wdrożeniu C5; starsze snapshoty nie mają `allocation_breakdown`.


## Stage C5.1 - Historical Backfill Engine

C5.1 nie dodaje migracji. Korzysta z tabel i pól wprowadzonych w C4.1: `market_prices`, `fx_rates`, `asset_prices`, `price_refresh_runs`, `price_refresh_run_items` oraz `assets.market_symbol`.

Nowy endpoint:

```text
POST /api/prices/backfill
Authorization: Bearer <user access token>
Content-Type: application/json
```

Body dla jednego aktywa:

```json
{
  "scope": "asset",
  "portfolio_id": "<portfolio_id>",
  "asset_id": "<asset_id>",
  "range": "1Y"
}
```

Body dla aktywnych aktywów:

```json
{
  "scope": "all_active",
  "portfolio_id": "<portfolio_id>",
  "range": "3Y"
}
```

Obsługiwane zakresy: `1Y`, `3Y`, `5Y`, `MAX`.

Zasady bezpieczeństwa:

- endpoint wymaga zalogowanego użytkownika i sprawdza dostęp przez Supabase RLS,
- `SUPABASE_SERVICE_ROLE_KEY` jest używany wyłącznie server-side do zapisu historii,
- tryb `all_active` przetwarza maksymalnie 5 aktywów na request i zwraca listę pozostałych aktywów,
- upsert do `market_prices`/`fx_rates` jest chunkowany,
- `MAX` jest best-effort; gdy provider zwróci zbyt dużo danych, API zapisuje najnowszy bezpieczny pakiet i raportuje `partial`.

Providerzy:

- Crypto: CoinGecko market chart range API dla zakresu 1Y; dla dłuższych publicznych zakresów używany jest bezpłatny fallback CryptoCompare, zapisywany pod stabilnym źródłem crypto, żeby nie dublować dziennych rekordów.
- ETF/akcje: Stooq daily CSV, preferuje `assets.market_symbol`, a potem normalizuje `assets.symbol`. Jeśli Stooq wymaga klucza do CSV historycznego, ustaw server-side `STOOQ_API_KEY`.
- FX: historyczne kursy NBP do PLN, zapisywane w `fx_rates`; jeśli kursu dla daty nie ma, `close_price_base` zostaje puste zamiast sztucznego przeliczenia.

Daily cron `/api/cron/prices` pozostaje mechanizmem przyszłych dziennych aktualizacji. Backfill uzupełnia przeszłość w `market_prices`, a cron dopisuje kolejne dni.

### Test backfillu w UI

1. Ustaw env vars:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
CRON_SECRET=...
STOOQ_API_KEY=... # opcjonalnie, wymagane jeśli Stooq zwraca komunikat "Get your apikey" dla historii CSV
```

2. Uruchom:

```bash
npm install
npm run dev
```

3. Wejdź do `Long-term -> Intelligence -> Backfill`.
4. Dla ETF/akcji ustaw `market_symbol`, np. `iusq.de`, `aapl.us`, `msft.us`. Dla BTC możesz użyć CoinGecko ID `bitcoin`.
5. Uruchom `Backfill selected asset` dla IUSQ.DE oraz crypto BTC/ETH/XRP.
6. Sprawdź raport per aktywo: status, zapisane wiersze, braki FX i ewentualne pozostałe rows/assets.
7. Wejdź na Dashboard i przełącz zakresy wykresów `30D/90D/1Y/3Y/5Y/MAX`.

### SQL verification

```sql
select asset_id, source_symbol, source, count(*) as rows, min(price_date), max(price_date)
from market_prices
group by asset_id, source_symbol, source
order by rows desc;

select from_currency, to_currency, count(*) as rows, min(rate_date), max(rate_date)
from fx_rates
group by from_currency, to_currency
order by rows desc;

select id, trigger_type, status, requested_assets, refreshed_assets, failed_assets, started_at, finished_at, error
from price_refresh_runs
where trigger_type = 'backfill'
order by started_at desc
limit 10;

select symbol, source, status, price_date, error
from price_refresh_run_items
where run_id in (
  select id from price_refresh_runs where trigger_type = 'backfill' order by started_at desc limit 3
)
order by created_at desc;
```
