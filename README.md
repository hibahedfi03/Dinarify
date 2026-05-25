# Dinarify

Dinarify is a Chrome Extension Manifest V3 project that detects prices on webpages and shows their approximate value in Tunisian dinar.

It is built as a small portfolio-ready browser extension: plain JavaScript, no framework, a clean popup UI, a background service worker for exchange rates, and a content script that scans real webpages without touching form fields or code blocks.

## Project Overview

When browsing shopping, travel, booking, or marketplace websites, prices often appear in foreign currencies. This extension detects common currency formats in page text and converts them to `TND`, either beside the original price or as a replacement.

Default display example:

```text
$19.99 (approx 61.2 TND)
```

The target currency is always Tunisian dinar (`TND`).

## Features

- Detects common price formats, including `$19.99`, `19,99 EUR`, `USD 120`, `A$50`, `EGP 300`, `GBP 45`, `AED 100`, `SAR 80`, `CAD 25`, `AUD 40`, `MAD 200`, `DZD 1500`, and `TRY 350`.
- Converts detected prices to `TND`.
- Supports two display modes: append the conversion or replace the original price.
- Includes rounding options: exact, 1 decimal, and 2 decimals.
- Provides a popup toggle to enable or pause conversions.
- Shows exchange-rate status and last updated date in the popup.
- Fetches rates in a Manifest V3 background service worker.
- Caches rates in `chrome.storage.local`.
- Refreshes exchange rates automatically once per day using `chrome.alarms`.
- Uses `TreeWalker` for page text scanning.
- Uses `MutationObserver` to handle dynamic sites.
- Avoids editing `input`, `textarea`, `script`, `style`, `code`, `pre`, `select`, `option`, and editable content.

## Tech Stack

- Chrome Extension Manifest V3
- Plain JavaScript
- HTML
- CSS
- `chrome.storage.local`
- `chrome.alarms`
- `TreeWalker`
- `MutationObserver`
- Free ExchangeRate-API endpoint

## Installation Guide

Clone or download this project, then load it as an unpacked Chrome extension.

```bash
git clone <your-repo-url>
cd tnd-convert
```

No build step is required.

## Load Unpacked in Chrome

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Turn on `Developer mode`.
4. Click `Load unpacked`.
5. Select the project folder.
6. Pin `Dinarify` from Chrome's extensions menu.
7. Open the popup and click `Refresh rates` if rates are not loaded yet.

## Usage Examples

Open a page that contains prices like:

```text
$19.99
19,99 EUR
USD 120
A$50
EGP 300
AED 100
SAR 80
MAD 200
DZD 1500
TRY 350
```

Append mode keeps the original text and adds the conversion:

```text
$19.99 (approx 61.2 TND)
```

Replace mode swaps the detected price for the converted value:

```text
61.2 TND
```

For local test files, open the extension details page in Chrome and enable `Allow access to file URLs`.


## Testing Checklist

- Load the extension through `chrome://extensions`.
- Confirm the popup opens without console errors.
- Click `Refresh rates` and confirm rate status updates.
- Toggle the extension off and confirm conversions are removed or no longer added.
- Toggle the extension on and confirm conversions return.
- Test append mode.
- Test replace mode.
- Test exact, 1 decimal, and 2 decimals rounding.
- Test dynamic content by opening a page that loads prices after initial page load.
- Confirm form fields and code blocks are not modified.
- Confirm the same price is not converted twice after scrolling or DOM updates.

## Exchange Rates

Rates are fetched from the free open-access ExchangeRate-API endpoint:

```text
https://open.er-api.com/v6/latest/TND
```

The API URL is stored in `background.js` as `RATE_API_URL`, making it easy to replace later.

The API response uses `TND` as the base currency. If `rates.USD` means `1 TND = 0.32 USD`, then `20 USD` converts to `20 / 0.32 = 62.5 TND`.

## Limitations

- Currency detection is approximate. Some symbols are ambiguous, especially `$`, which is treated as `USD`.
- Exchange rates are approximate and refresh daily.
- Prices inside images, canvas, closed shadow DOM, or inaccessible cross-origin frames cannot be converted.
- Some websites frequently rewrite their DOM, so conversions may appear shortly after the original price.
- The extension does not cover every global currency format or language convention.


## Credits

- Exchange rates: [ExchangeRate-API](https://www.exchangerate-api.com)
- Built with Chrome Extension Manifest V3 APIs.

## Project Files

- `manifest.json` - Manifest V3 configuration.
- `dinarify.png` - Original Dinarify logo source.
- `assets/brand/dinarify-logo.png` - Cropped Dinarify wordmark for the popup.
- `assets/icons/` - Chrome extension icons generated from the Dinarify mark.
- `background.js` - Service worker for settings, exchange rates, cache, and alarms.
- `content.js` - Website scanner and price converter.
- `popup.html` - Popup markup.
- `popup.js` - Popup behavior and settings handling.
- `styles.css` - Popup styles.
- `README.md` - Portfolio documentation.
