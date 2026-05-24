# TND Price Converter

A Chrome Extension Manifest V3 project that detects prices on webpages and shows the approximate Tunisian dinar value next to them.

## Features

- Detects common price formats such as `$19.99`, `19,99 €`, `USD 120`, `A$50`, `EGP 300`, `AED 200`, `SAR 75`, `TRY 500`, `MAD 99`, `DZD 1200`, and more.
- Converts detected prices to Tunisian dinar (`TND`).
- Popup settings for enabling/disabling conversion, choosing append or replace display mode, choosing rounding, and refreshing rates.
- Background service worker fetches rates, caches them in `chrome.storage.local`, and refreshes them once per day with `chrome.alarms`.
- Content script uses `TreeWalker` for text scanning and `MutationObserver` for dynamic websites.
- Avoids editing `input`, `textarea`, `script`, `style`, `code`, and `pre` content.

## Exchange Rates

Rates are fetched from the free open-access ExchangeRate-API endpoint:

```text
https://open.er-api.com/v6/latest/TND
```

The URL is stored in `background.js` as `RATE_API_URL`, so it is easy to replace later. The API returns rates with `TND` as the base currency. For example, if `rates.USD` means `1 TND = 0.32 USD`, then `20 USD` converts to `20 / 0.32 = 62.5 TND`.

The popup includes attribution for Exchange Rate API.

## Load the Extension in Chrome

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select this project folder: `tnd-convert`.
6. Pin `TND Price Converter` from the extensions menu if you want quick access to the popup.

## Test It

Open any normal website that shows prices. You should see conversions like:

```text
$19.99 (≈ 61.2 TND)
19,99 € (≈ 67.4 TND)
EGP 300 (≈ 18.9 TND)
```

You can also create a quick local test page:

```html
<!doctype html>
<html>
  <body>
    <p>Product A: $19.99</p>
    <p>Product B: 19,99 €</p>
    <p>Hotel: USD 120</p>
    <p>Bag: A$50</p>
    <p>Tour: EGP 300</p>
  </body>
</html>
```

If testing local files, open the extension details page in Chrome and enable `Allow access to file URLs`.

## Publish Later

1. Create extension icons and add them to `manifest.json`.
2. Test the extension on several shopping, travel, and booking websites.
3. Zip the extension files, excluding development-only files.
4. Create a Chrome Web Store developer account.
5. Upload the zip file in the Chrome Web Store Developer Dashboard.
6. Fill in the listing, screenshots, privacy details, and support information.
7. Submit for review.

## Limitations

- Currency detection is not perfect. Some symbols are ambiguous, especially `$`, which this extension treats as `USD`.
- Exchange rates are approximate and update daily, not every second.
- Some websites heavily rewrite their DOM, so conversion may appear a moment after the original price.
- Prices rendered inside images, canvas, closed shadow DOM, or cross-origin frames cannot be converted by this basic content script.
- The extension does not handle every local currency symbol or language format.

## Files

- `manifest.json` - Manifest V3 configuration.
- `background.js` - Service worker for settings, exchange rates, cache, and alarms.
- `content.js` - Website scanner and price converter.
- `popup.html` - Extension popup markup.
- `popup.js` - Popup behavior and settings saves.
- `styles.css` - Popup styling.
- `README.md` - Setup, testing, publishing, and limitations.
