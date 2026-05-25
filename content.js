// Dinarify content script.
// Scans safe text nodes, detects foreign-currency prices, and marks each conversion.

const TND_CONVERTER_ATTR = "data-tnd-price-converter";
const TND_STYLE_ID = "tnd-price-converter-style";
const APPROX_SIGN = "\u2248";

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

const BLOCKED_SELECTOR = [...BLOCKED_TAGS].map((tagName) => tagName.toLowerCase()).join(",");

// Ambiguous "$" is treated as USD. Two-letter word aliases are intentionally
// avoided because they create too many false positives in normal page text.
const CURRENCY_DEFINITIONS = [
  { code: "USD", codeTokens: ["USD"], symbolTokens: ["US$", "$"] },
  { code: "EUR", codeTokens: ["EUR"], symbolTokens: ["\u20ac"] },
  { code: "GBP", codeTokens: ["GBP"], symbolTokens: ["\u00a3"] },
  { code: "JPY", codeTokens: ["JPY"], symbolTokens: ["JP\u00a5", "\u00a5"] },
  { code: "AUD", codeTokens: ["AUD"], symbolTokens: ["A$", "AU$"] },
  { code: "CAD", codeTokens: ["CAD"], symbolTokens: ["C$", "CA$"] },
  { code: "CHF", codeTokens: ["CHF"], symbolTokens: [] },
  { code: "CNY", codeTokens: ["CNY", "RMB"], symbolTokens: ["CN\u00a5"] },
  { code: "EGP", codeTokens: ["EGP"], symbolTokens: ["E\u00a3"] },
  { code: "AED", codeTokens: ["AED"], symbolTokens: [] },
  { code: "SAR", codeTokens: ["SAR"], symbolTokens: [] },
  { code: "TRY", codeTokens: ["TRY"], symbolTokens: ["\u20ba"] },
  { code: "MAD", codeTokens: ["MAD"], symbolTokens: [] },
  { code: "DZD", codeTokens: ["DZD"], symbolTokens: [] },
  { code: "NZD", codeTokens: ["NZD"], symbolTokens: ["NZ$"] },
  { code: "SGD", codeTokens: ["SGD"], symbolTokens: ["S$"] },
  { code: "HKD", codeTokens: ["HKD"], symbolTokens: ["HK$"] },
  { code: "INR", codeTokens: ["INR"], symbolTokens: ["\u20b9"] },
  { code: "KRW", codeTokens: ["KRW"], symbolTokens: ["\u20a9"] },
  { code: "BRL", codeTokens: ["BRL"], symbolTokens: ["R$"] },
  { code: "MXN", codeTokens: ["MXN"], symbolTokens: ["MX$"] },
  { code: "ZAR", codeTokens: ["ZAR"], symbolTokens: [] },
  { code: "SEK", codeTokens: ["SEK"], symbolTokens: [] },
  { code: "NOK", codeTokens: ["NOK"], symbolTokens: [] },
  { code: "DKK", codeTokens: ["DKK"], symbolTokens: [] },
  { code: "PLN", codeTokens: ["PLN"], symbolTokens: [] },
  { code: "QAR", codeTokens: ["QAR"], symbolTokens: [] },
  { code: "KWD", codeTokens: ["KWD"], symbolTokens: [] },
  { code: "BHD", codeTokens: ["BHD"], symbolTokens: [] },
  { code: "OMR", codeTokens: ["OMR"], symbolTokens: [] },
  { code: "JOD", codeTokens: ["JOD"], symbolTokens: [] },
  { code: "LYD", codeTokens: ["LYD"], symbolTokens: [] }
];

const TOKEN_TO_CURRENCY = new Map();
const CODE_TOKENS = [];
const SYMBOL_TOKENS = [];

for (const definition of CURRENCY_DEFINITIONS) {
  for (const token of definition.codeTokens) {
    TOKEN_TO_CURRENCY.set(normalizeCurrencyToken(token), definition.code);
    CODE_TOKENS.push(token);
  }

  for (const token of definition.symbolTokens) {
    TOKEN_TO_CURRENCY.set(normalizeCurrencyToken(token), definition.code);
    SYMBOL_TOKENS.push(token);
  }
}

const CODE_TOKEN_PATTERN = makeTokenPattern(CODE_TOKENS);
const SYMBOL_TOKEN_PATTERN = makeTokenPattern(SYMBOL_TOKENS);
const ALL_TOKEN_PATTERN = makeTokenPattern([...CODE_TOKENS, ...SYMBOL_TOKENS]);

const AMOUNT_PATTERN =
  String.raw`(?:\d{1,3}(?:[\s\u00a0\u202f,'\u2019]\d{3})+(?:[.,]\d{1,4})?|\d{1,3}(?:,\d{3})+(?:\.\d{1,4})?|\d{1,3}(?:\.\d{3})+(?:,\d{1,4})?|\d+(?:[.,]\d{1,4})?)`;

// Codes require whitespace ("USD 120"), while symbols may touch the number ("$19.99").
const PRICE_PATTERN = new RegExp(
  String.raw`(?<![\p{L}\p{N}_])(?:` +
    String.raw`(?<prefixSymbol>${SYMBOL_TOKEN_PATTERN})\s*(?<prefixSymbolAmount>${AMOUNT_PATTERN})` +
    String.raw`|(?<prefixCode>${CODE_TOKEN_PATTERN})\s+(?<prefixCodeAmount>${AMOUNT_PATTERN})` +
    String.raw`|(?<suffixSymbolAmount>${AMOUNT_PATTERN})\s*(?<suffixSymbol>${SYMBOL_TOKEN_PATTERN})` +
    String.raw`|(?<suffixCodeAmount>${AMOUNT_PATTERN})\s+(?<suffixCode>${CODE_TOKEN_PATTERN})` +
    String.raw`)(?![\p{L}\p{N}_])`,
  "giu"
);

const HAS_CURRENCY_PATTERN = new RegExp(ALL_TOKEN_PATTERN, "iu");
const EXISTING_TND_SUFFIX_PATTERN = new RegExp(
  String.raw`^\s*\(\s*(?:\u2248|~|approx\.?|about)\s*[\d\s.,]+TND\s*\)`,
  "i"
);

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

function makeTokenPattern(tokens) {
  return tokens
    .map(normalizeCurrencyToken)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
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
  if (!element || element.nodeType !== Node.ELEMENT_NODE) {
    return true;
  }

  if (element.closest(`[${TND_CONVERTER_ATTR}]`)) {
    return true;
  }

  if (element.closest(BLOCKED_SELECTOR)) {
    return true;
  }

  // Skip editable regions, including descendants of contenteditable containers.
  return element.isContentEditable || Boolean(element.closest("[contenteditable]"));
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
    .replace(/[\s\u00a0\u202f'\u2019]/g, "")
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
  return isLikelyPriceAmount(amount) ? amount : null;
}

function normalizeSingleSeparatorNumber(value, separator) {
  const parts = value.split(separator);

  if (parts.length === 2) {
    const decimals = parts[1];

    // "19,99" is decimal, while "1,999" is more likely a thousands group.
    if (decimals.length === 3 && parts[0].length <= 3) {
      return parts.join("");
    }

    if (decimals.length > 0 && decimals.length <= 4) {
      return `${parts[0]}.${decimals}`;
    }
  }

  return parts.join("");
}

function isLikelyPriceAmount(amount) {
  return Number.isFinite(amount) && amount > 0 && amount < 1_000_000_000;
}

function getCurrencyFromMatch(match) {
  const token =
    match.groups.prefixSymbol ||
    match.groups.prefixCode ||
    match.groups.suffixSymbol ||
    match.groups.suffixCode;

  return TOKEN_TO_CURRENCY.get(normalizeCurrencyToken(token));
}

function getAmountFromMatch(match) {
  const rawAmount =
    match.groups.prefixSymbolAmount ||
    match.groups.prefixCodeAmount ||
    match.groups.suffixSymbolAmount ||
    match.groups.suffixCodeAmount;

  return parseLocalizedNumber(rawAmount);
}

function hasExistingTndSuffix(text, matchEndIndex) {
  return EXISTING_TND_SUFFIX_PATTERN.test(text.slice(matchEndIndex, matchEndIndex + 64));
}

function convertToTnd(amount, currency) {
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

  if (replaceMode) {
    span.textContent = convertedText;
    return span;
  }

  const conversion = document.createElement("span");
  conversion.className = "tnd-price-converter__conversion";
  conversion.textContent = ` (${APPROX_SIGN} ${convertedText})`;

  span.append(document.createTextNode(originalText), conversion);
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
    const matchEndIndex = match.index + originalText.length;

    if (hasExistingTndSuffix(text, matchEndIndex)) {
      continue;
    }

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
    lastIndex = matchEndIndex;
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

  // Collect first because replacing nodes while walking can confuse TreeWalker.
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

  if (document.body) {
    document.body.normalize();
  }
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
