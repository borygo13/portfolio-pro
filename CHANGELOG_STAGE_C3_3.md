# Stage C3.3 Portfolio Dashboard Upgrade

## Dodane
- Obligacje EDO są wliczane do dashboardu głównego.
- Dashboard pokazuje łączną wartość long-term: aktywne pozycje + EDO.
- Alokacja grupuje aktywne pozycje po typach i uwzględnia EDO.
- Tabela `Aktywne pozycje` pokazuje tylko aktywa z ilością > 0 oraz wiersz EDO.
- Nowa sekcja `Watchlista / targety` pokazuje aktywa dodane w Pozycjach, ale bez zakupu.
- Rebalancing uwzględnia aktywa z target allocation oraz obligacje EDO.
- Karty statystyk pokazują wkład/koszt, EDO, long-term P/L i całość majątku.

## Ważne
- Ręczne ceny nadal działają jako fallback/override.
- Auto refresh cen będzie osobnym etapem.
- Gotówka nadal korzysta z transakcji. Docelowy osobny cash ledger będzie w kolejnym etapie.
