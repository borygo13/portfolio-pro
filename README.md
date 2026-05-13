# Portfolio PRO - Stage C3.4 Foundation Stabilization

## Start lokalny

1. Skopiuj `.env.local` ze starszej wersji do folderu projektu albo utwórz nowy plik z danymi Supabase:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

2. W Supabase SQL Editor uruchom aktualny, kompletny zestaw migracji Stage C3.4:

```text
supabase/stage-c3-4-foundation.sql
```

`supabase/schema.sql` jest kanonicznym snapshotem tego samego schematu. Starszy plik `supabase/stage-c3-price-engine.sql` jest oznaczony jako legacy i służy tylko projektom, które miały już wcześniejszą bazę C3 i potrzebowały samej tabeli `asset_prices`.

3. Uruchom projekt:

```bash
npm install
npm run dev
```

4. Wejdź na:

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
