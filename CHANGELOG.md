# Stage C3 Position Engine

Dodane:
- silnik pozycji liczony z transakcji BUY/SELL,
- quantity, średnia cena, koszt otwarty, realized P/L, unrealized P/L, total P/L,
- ręczne ceny aktywów w tabeli `asset_prices`,
- live dashboard z danych Supabase zamiast demo dla long-term,
- alokacja i rebalancing z realnych pozycji,
- migracja SQL: `supabase/stage-c3-price-engine.sql`.

Przed uruchomieniem Stage C3 wklej migrację SQL w Supabase SQL Editor.
