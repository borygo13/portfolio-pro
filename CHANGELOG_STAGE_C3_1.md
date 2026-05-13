# Stage C3.1 Auto Prices + EDO Bonds

## Added
- Long-term → Obligacje EDO module restored.
- EDO bond form, list, delete and simplified EDO valuation engine.
- Auto Price Engine v1.
- Server route: `/api/prices/refresh`.
- Stooq/NBP based ETF and stock price fetch.
- CoinGecko based crypto price fetch.
- Manual price remains as emergency override.

## Notes
- ETF/stocks should use Stooq-compatible symbols, e.g. `iusq.de`, `aapl.us`, `pkn.pl`.
- For assets with currency EUR/USD, price is converted to PLN using NBP.
- EDO bonds are valued in the EDO module, not by market price API.
