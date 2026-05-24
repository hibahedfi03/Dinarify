// TND Price Converter content script.
// It scans text nodes, finds visible prices, and replaces only the price text with a marked span.

const TND_CONVERTER_ATTR = "data-tnd-price-converter";
const TND_STYLE_ID = "tnd-price-converter-style";

const BLOCKED_TAGS = new Set([
  "INPUT",
  "TEXTAREA",
  "SCRIPT",
  "STYLE",
  "CODE",
  "PRE",
  "NOSCRIPT",
  "SELECT",
  "OPTION"
]);

// Symbols and ISO codes. Ambiguous "$" is treated as USD.
const CURRENCY_ALIASES = {
  USD: ["USD", "US$", "$"],
  EUR: ["EUR", "€"],
  GBP: ["GBP", "£"],
  JPY: ["JPY", "JP¥", "¥"],
  AUD: ["AUD", "A$", "AU$"],
  CAD: ["CAD", "C$", "CA$"],
  CHF: ["CHF"],
  CNY: ["CNY", "CN¥", "RMB"],
  EGP: ["EGP", "E£"],
  AED: ["AED"],
  SAR: ["SAR"],
  TRY: ["TRY", "TL", "₺"],
  MAD: ["MAD"],
  DZD: ["DZD"],
  NZD: ["NZD", "NZ$"],
  SGD: ["SGD", "S$"],
  HKD: ["HKD", "HK$"],
  INR: ["INR", "₹"],
  KRW: ["KRW", "₩"],
  BRL: ["BRL", "R$"],
  MXN: ["MXN", "MX$"],
  ZAR: ["ZAR"],
  SEK: ["SEK"],
  NOK: ["NOK"],
  DKK: ["DKK"],
  PLN: ["PLN"],
  QAR: ["QAR"],
  KWD: ["KWD"],
  BHD: ["BHD"],
  OMR: ["OMR"],
  JOD: ["JOD"],
  LYD: ["LYD"]
};

const TOKEN_TO_CURRENCY = new Map();

for (const [currency, aliases] of Object.entries(CURRENCY_ALIASES)) {
  for (const alias of aliases) {
    TOKEN_TO_CURRENCY.set(normalizeCurrencyToken(alias), currency);
  }
}

const CURRENCY_TOKENS = [...TOKEN_TO_CURRENCY.keys()]
  .sort((a, b) => b.length - a.length)
  .map(escapeRegExp)
  .join("|");

const AMOUNT_PATTERN =
  String.raw`(?:\d{1,3}(?:[\s\u00a0\u202f,'’]\d{3})+(?:[.,]\d{1,4})?|\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,4})?|\d+(?:[.,]\d{1,4})?)`;

const PRICE_PATTERN = new RegExp(
  String.raw`(?<![A-Za-z0-9_])(?:` +
    String.raw`(?<prefixCurrency>${CURRENCY_TOKENS})\s*(?<prefixAmount>${AMOUNT_PATTERN})` +
    String.raw`|(?<suffixAmount>${AMOUNT_PATTERN})\s*(?<suffixCurrency>${CURRENCY_TOKENS})` +
    String.raw`)(?![A-Za-z0-9_])`,
  "giu"
);

const HAS_CURRENCY_PATTERN = new RegExp(CURRENCY_TOKENS, "iu");

let extensionState = {
  settings: {
    enabled: true,
    displayMode: "append",
    rounding: "1"
  },
  rateCache: null
};

let scanTimer = null;
let observer = null;
const pendingRoots = new Set();

function normalizeCurrencyToken(token) {
  return token.replace(/\s+/g, "").toUpperCase();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function injectContentStyles() {
  if (document.getElementById(TND_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = TND_STYLE_ID;
  style.textContent = `
    .tnd-price-converter {
      white-space: nowrap;
    }

    .tnd-price-converter__conversion {
      opacity: 0.82;
      font-weight: inherit;
    }

    .tnd-price-converter__replacement {
      color: #b42318;
      font-weight: 600;
    }
  `;
  document.documentElement.appendChild(style);
}

function requestState() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_STATE" }, (response) => {
      if (chrome.runtime.lastError || !response || !response.ok) {
        resolve(null);
        return;
      }

      resolve(response.state);
    });
  });
}

function shouldSkipElement(element) {
  if (!element) {
    return true;
  }

  if (element.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }

  if (BLOCKED_TAGS.has(element.tagName)) {
    return true;
  }

  if (element.isContentEditable) {
    return true;
  }

  return Boolean(element.closest(`[${TND_CONVERTER_ATTR}]`));
}

function shouldScanTextNode(node) {
  if (!node || node.nodeType !== Node.TEXT_NODE) {
    return false;
  }

  const text = node.nodeValue;
  if (!text || !text.trim() || !HAS_CURRENCY_PATTERN.test(text)) {
    return false;
  }

  return !shouldSkipElement(node.parentElement);
}

function parseLocalizedNumber(rawAmount) {
  const compact = rawAmount
    .replace(/[\s\u00a0\u202f'’]/g, "")
    .trim();

  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");
  let normalized = compact;

  if (lastComma !== -1 && lastDot !== -1) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = compact
      .split(thousandsSeparator)
      .join("")
      .replace(decimalSeparator, ".");
  } else if (lastComma !== -1) {
    normalized = normalizeSingleSeparatorNumber(compact, ",");
  } else if (lastDot !== -1) {
    normalized = normalizeSingleSeparatorNumber(compact, ".");
  }

  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function normalizeSingleSeparatorNumber(value, separator) {
  const parts = value.split(separator);

  if (parts.length === 2) {
    const decimals = parts[1];

    // "19,99" is decimal, while "1,999" is more likely a thousands group.
    if (decimals.length > 0 && decimals.length <= 2) {
      return `${parts[0]}.${decimals}`;
    }
  }

  return parts.join("");
}

function getCurrencyFromMatch(match) {
  const token = match.groups.prefixCurrency || match.groups.suffixCurrency;
  return TOKEN_TO_CURRENCY.get(normalizeCurrencyToken(token));
}

function getAmountFromMatch(match) {
  return parseLocalizedNumber(match.groups.prefixAmount || match.groups.suffixAmount);
}

function convertToTnd(amount, currency) {
  if (currency === "TND") {
    return amount;
  }

  const rates = extensionState.rateCache && extensionState.rateCache.rates;
  const currencyRate = rates && rates[currency];

  if (!currencyRate || currencyRate <= 0) {
    return null;
  }

  // API base is TND, so rates[currency] means 1 TND = X currency.
  return amount / currencyRate;
}

function formatTnd(value) {
  const rounding = extensionState.settings.rounding;
  const options =
    rounding === "exact"
      ? { maximumFractionDigits: 4 }
      : {
          minimumFractionDigits: Number(rounding),
          maximumFractionDigits: Number(rounding)
        };

  return `${new Intl.NumberFormat(undefined, options).format(value)} TND`;
}

function makePriceSpan(originalText, amount, currency, convertedAmount) {
  const span = document.createElement("span");
  const convertedText = formatTnd(convertedAmount);
  const replaceMode = extensionState.settings.displayMode === "replace";

  span.setAttribute(TND_CONVERTER_ATTR, "true");
  span.className = replaceMode
    ? "tnd-price-converter tnd-price-converter__replacement"
    : "tnd-price-converter";
  span.dataset.originalText = originalText;
  span.dataset.currency = currency;
  span.dataset.amount = String(amount);
  span.title = `${originalText} converted to ${convertedText} using cached exchange rates.`;
  span.textContent = replaceMode ? convertedText : `${originalText} (≈ ${convertedText})`;

  if (!replaceMode) {
    const conversionStart = span.textContent.indexOf("(≈");
    if (conversionStart !== -1) {
      span.dataset.convertedText = span.textContent.slice(conversionStart);
    }
  }

  return span;
}

function processTextNode(node) {
  if (!shouldScanTextNode(node)) {
    return;
  }

  const text = node.nodeValue;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let changed = false;

  PRICE_PATTERN.lastIndex = 0;

  for (const match of text.matchAll(PRICE_PATTERN)) {
    const originalText = match[0];
    const currency = getCurrencyFromMatch(match);
    const amount = getAmountFromMatch(match);

    if (!currency || amount === null) {
      continue;
    }

    const convertedAmount = convertToTnd(amount, currency);
    if (convertedAmount === null) {
      continue;
    }

    if (match.index > lastIndex) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    fragment.appendChild(makePriceSpan(originalText, amount, currency, convertedAmount));
    lastIndex = match.index + originalText.length;
    changed = true;
  }

  if (!changed) {
    return;
  }

  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  node.replaceWith(fragment);
}

function scanRoot(root) {
  if (!extensionState.settings.enabled || !extensionState.rateCache) {
    return;
  }

  if (root.nodeType === Node.TEXT_NODE) {
    processTextNode(root);
    return;
  }

  if (
    root.nodeType !== Node.ELEMENT_NODE &&
    root.nodeType !== Node.DOCUMENT_NODE &&
    root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE
  ) {
    return;
  }

  if (root.nodeType === Node.ELEMENT_NODE && shouldSkipElement(root)) {
    return;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return shouldScanTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });

  const nodes = [];
  while (walker.nextNode()) {
    nodes.push(walker.currentNode);
  }

  for (const node of nodes) {
    processTextNode(node);
  }
}

function scheduleScan(root = document.body) {
  if (!root || !extensionState.settings.enabled) {
    return;
  }

  pendingRoots.add(root);
  window.clearTimeout(scanTimer);

  scanTimer = window.setTimeout(() => {
    const roots = [...pendingRoots];
    pendingRoots.clear();

    for (const pendingRoot of roots) {
      if (pendingRoot.isConnected || pendingRoot === document || pendingRoot === document.body) {
        scanRoot(pendingRoot);
      }
    }
  }, 120);
}

function restoreOriginalPrices() {
  const convertedNodes = document.querySelectorAll(`[${TND_CONVERTER_ATTR}]`);

  for (const node of convertedNodes) {
    const originalText = node.dataset.originalText || node.textContent;
    node.replaceWith(document.createTextNode(originalText));
  }

  document.body && document.body.normalize();
}

function rebuildPage() {
  restoreOriginalPrices();

  if (extensionState.settings.enabled) {
    scheduleScan(document.body);
  }
}

function observeDynamicChanges() {
  if (observer || !document.body) {
    return;
  }

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        scheduleScan(mutation.target);
        continue;
      }

      for (const addedNode of mutation.addedNodes) {
        if (
          addedNode.nodeType === Node.TEXT_NODE ||
          addedNode.nodeType === Node.ELEMENT_NODE ||
          addedNode.nodeType === Node.DOCUMENT_FRAGMENT_NODE
        ) {
          scheduleScan(addedNode);
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

async function loadAndApplyState({ rebuild = false } = {}) {
  const state = await requestState();

  if (!state) {
    return;
  }

  extensionState = state;
  injectContentStyles();

  if (rebuild) {
    rebuildPage();
  } else {
    scheduleScan(document.body);
  }
}

function boot() {
  observeDynamicChanges();
  loadAndApplyState();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (changes.settings || changes.rateCache) {
      loadAndApplyState({ rebuild: true });
    }
  });
}

if (document.body) {
  boot();
} else {
  window.addEventListener("DOMContentLoaded", boot, { once: true });
}
