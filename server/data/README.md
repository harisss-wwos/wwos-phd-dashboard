# Offline zip / postal code data (Incident Explorer State / City)

`server/zip-geo.js` derives a ticket's **State** and **City** from its zip code (RCD `Zip:` line) for the
Incident Explorer drill-down (Region > Country > State > City > SID > ...). The lookup is fully offline:
ticket zip codes are never sent to any third-party service.

## Attribution and license

Postal code data © GeoNames ([geonames.org](https://www.geonames.org/)), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The page footer of `incident-explorer.html`
carries the same credit. The files below are unmodified extracts of the GeoNames postal code dump;
the derived index (`zip-geo-index.json`) is an adaptation (one State / City per postal key, see the rules below).

## Files

| Path | What it is |
| --- | --- |
| `geonames/<CC>.txt` | GeoNames postal code dump, one file per country, extracted from `https://download.geonames.org/export/zip/<CC>.zip` |
| `geonames/SOURCES.json` | The pin: URL, `Last-Modified` header, sha256 of the zip and of the txt, row count per file; download date; countries with no GeoNames file |
| `geonames/zip-geo-index.json` | Prebuilt compact index (postal key -> State / City) loaded at server start (~0.3 s). Built from the txt files by `node zip-geo.js --build` |

Downloaded **2026-11-01** (all files `Last-Modified: Sun, 01 Nov 2026`, see `SOURCES.json`).

Countries kept: US, PR, CA, MX, GB, BR, IT, JP, IN, AU, BE, DE, FR, NL, ES, TR, PT, NO, IE (every ticket country
of the 2026 data that GeoNames covers, plus PR as a US fallback). GB is `GB.zip` (outward codes only); GB_full
is not needed because only the outward code is looked up.

Not in the dataset (tickets resolve to Unknown): SA and EG (no GeoNames file, HTTP 404); AE was downloaded
and not kept (the UAE has no national postal-code system; GeoNames AE rows have no emirate names).

## Rules

- **Country**: the ticket's country code (`UK` -> `GB`, `UAE` -> `AE`). When the country is missing / `Unknown`,
  the zip alone decides only when unambiguous: a full Canadian postal code (A9A9A9) -> CA; any other format
  (5 digits fits US, MX, DE, FR, ...) -> Unknown. The inferred country is used for State / City only; the
  Country level keeps `Unknown`.
- **Zip normalization** (key = upper-case, every non `[A-Z0-9]` removed; empty / all zeros = invalid):
  - US / PR: ZIP or ZIP+4 -> first 5 digits; 3-4 digits -> left-padded with zeros (Excel-dropped zeros);
    else a lone 5-digit group in the text (`TX 75704-4047` -> 75704). A US miss is retried in PR.
  - CA: the FSA (first 3 characters, A9A), from the value or its first token that starts with A9A.
  - MX: 4-5 digits, left-padded to 5.
  - GB: full postcode -> outward code; outward-only as is; else the first token that is an outward code.
  - BR: 8-digit CEP exact, else its 5-digit prefix + `000` (GeoNames BR holds city-level CEPs only).
  - Others: exact key, else the longest prefix of the key that is a postal key of that country.
- **State** = GeoNames admin1 name. MX `Distrito Federal` is shown as `Ciudad de México`.
- **City**: CA admin2 (else the place name's parenthetical, else the place name); MX admin3 (ciudad), else
  admin2 (municipio); IN / JP / AU / TR / PT admin2 (district, shi, LGA, ilçe, concelho), else the place name;
  every other country the place name.
- **Ambiguity rule**: when one postal key maps to several GeoNames rows, the (State, City) pair that occurs most
  often for that key wins; a tie goes to the pair listed first in the GeoNames file.
- **Unknown**: missing / invalid / placeholder zip, a country with no file, or no match -> State and City
  `Unknown`. A match without a derivable city -> known State, City `Unknown`. A row with no admin1 name
  (US APO / FPO military codes) -> State and City `Unknown`.

## Refresh

1. Download `https://download.geonames.org/export/zip/<CC>.zip` for each country, extract `<CC>.txt` here.
2. Update `SOURCES.json` (download date, `Last-Modified`, sha256 of zip and txt, rows).
3. Run `node zip-geo.js --build` in `server/` to rewrite `zip-geo-index.json`. If the index does not match
   `SOURCES.json`, the server still works: it parses the txt files at start (about 2-3 s) and logs a warning.
4. Restart the API server.
