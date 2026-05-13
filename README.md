# Portfolio PRO - Stage C3 Position Engine

## Start lokalny

1. Skopiuj `.env.local` ze starszej wersji do folderu projektu.
2. W Supabase uruchom SQL z pliku:

```text
supabase/stage-c3-price-engine.sql
```

3. Uruchom projekt:

```bash
npm install
npm run dev
```

4. Wejdź na:

```text
http://localhost:3000
```

## Co robi Stage C3

- pobiera aktywa, transakcje i ręczne ceny z Supabase,
- liczy pozycje z transakcji,
- blokuje sprzedaż większą niż posiadana ilość w module transakcji z poprzedniego etapu,
- pokazuje live dashboard long-term,
- umożliwia wpisanie aktualnej ceny pozycji ręcznie.

## Ważne

Bez uruchomienia migracji `asset_prices` aplikacja odpali się, ale Long-term/Dashboard pokażą błąd pobierania cen.
