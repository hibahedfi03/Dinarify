// Dinarify background service worker.
// It owns settings, exchange-rate caching, daily refreshes, and popup messages.

const TARGET_CURRENCY = "TND";
const SETTINGS_KEY = "settings";
const RATE_CACHE_KEY = "rateCache";
const RATE_ERROR_KEY = "rateError";
const DAILY_ALARM_NAME = "refresh-tnd-rates";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Free open-access endpoint. Replace this one constant if you switch providers later.
const RATE_API_URL = `https://open.er-api.com/v6/latest/${TARGET_CURRENCY}`;

const DEFAULT_SETTINGS = {
  enabled: true,
  displayMode: "append",
  rounding: "1"
};

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(items) {
  return new Promise((resolve) => chrome.storage.local.set(items, resolve));
}

function createDailyAlarm() {
  chrome.alarms.create(DAILY_ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: 24 * 60
  });
}

async function getSettings() {
  const stored = await storageGet(SETTINGS_KEY);
  return {
    ...DEFAULT_SETTINGS,
    ...(stored[SETTINGS_KEY] || {})
  };
}

function hasUsableRates(rateCache) {
  return Boolean(
    rateCache &&
      rateCache.rates &&
      typeof rateCache.rates === "object" &&
      Object.keys(rateCache.rates).length > 0
  );
}

function normalizeRateCache(rateCache) {
  if (!hasUsableRates(rateCache)) {
    return null;
  }

  const lastUpdated = rateCache.lastUpdated || rateCache.fetchedAt || null;

  return {
    ...rateCache,
    base: rateCache.base || TARGET_CURRENCY,
    fetchedAt: rateCache.fetchedAt || lastUpdated,
    lastUpdated
  };
}

function isRateCacheFresh(rateCache) {
  const normalized = normalizeRateCache(rateCache);
  const timestamp = normalized && (normalized.lastUpdated || normalized.fetchedAt);

  if (!timestamp) {
    return false;
  }

  return Date.now() - timestamp < ONE_DAY_MS;
}

function makeRateError(message, error) {
  return {
    message,
    detail: error && error.message ? error.message : null,
    at: Date.now()
  };
}

async function getCachedRates() {
  const stored = await storageGet(RATE_CACHE_KEY);
  return normalizeRateCache(stored[RATE_CACHE_KEY] || null);
}

async function fetchFreshRates() {
  const response = await fetch(RATE_API_URL, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Exchange-rate API returned HTTP ${response.status}`);
  }

  const data = await response.json();

  if (data.result !== "success" || !data.rates || data.base_code !== TARGET_CURRENCY) {
    throw new Error("Exchange-rate API returned an unexpected response");
  }

  const now = Date.now();

  return {
    base: TARGET_CURRENCY,
    rates: data.rates,
    provider: data.provider || "ExchangeRate-API",
    documentation: data.documentation || "https://www.exchangerate-api.com/docs/free",
    termsOfUse: data.terms_of_use || "https://www.exchangerate-api.com/terms",
    sourceUrl: RATE_API_URL,
    fetchedAt: now,
    lastUpdated: now,
    lastUpdateUtc: data.time_last_update_utc || null,
    nextUpdateUtc: data.time_next_update_utc || null
  };
}

async function saveFreshRates(rateCache) {
  await storageSet({
    [RATE_CACHE_KEY]: rateCache,
    [RATE_ERROR_KEY]: null
  });
}

async function saveRateError(rateError) {
  await storageSet({ [RATE_ERROR_KEY]: rateError });
}

async function refreshRatesWithFallback() {
  const cachedRates = await getCachedRates();

  try {
    const freshRates = await fetchFreshRates();
    await saveFreshRates(freshRates);
    return {
      rateCache: freshRates,
      rateError: null,
      fromCache: false
    };
  } catch (error) {
    // If the network/API fails, keep using the last saved rates when available.
    const rateError = cachedRates
      ? makeRateError("Could not refresh rates. Using cached rates.", error)
      : makeRateError("Exchange rates are unavailable and no cached rates exist.", error);

    await saveRateError(rateError);

    return {
      rateCache: cachedRates,
      rateError,
      fromCache: Boolean(cachedRates)
    };
  }
}

async function getState({ refreshIfStale = true } = {}) {
  const stored = await storageGet([SETTINGS_KEY, RATE_CACHE_KEY, RATE_ERROR_KEY]);
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(stored[SETTINGS_KEY] || {})
  };

  let rateCache = normalizeRateCache(stored[RATE_CACHE_KEY] || null);
  let rateError = stored[RATE_ERROR_KEY] || null;

  if (refreshIfStale && !isRateCacheFresh(rateCache)) {
    const refreshResult = await refreshRatesWithFallback();
    rateCache = refreshResult.rateCache;
    rateError = refreshResult.rateError;
  }

  return { settings, rateCache, rateError };
}

async function initializeExtension() {
  const settings = await getSettings();
  await storageSet({ [SETTINGS_KEY]: settings });
  createDailyAlarm();
  await refreshRatesWithFallback();
}

chrome.runtime.onInstalled.addListener(() => {
  initializeExtension().catch((error) => {
    console.warn("Dinarify setup failed:", error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  createDailyAlarm();
  getState({ refreshIfStale: true }).catch((error) => {
    console.warn("Dinarify startup refresh failed:", error);
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === DAILY_ALARM_NAME) {
    refreshRatesWithFallback().catch((error) => {
      console.warn("Dinarify scheduled refresh failed:", error);
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message || !message.type) {
      sendResponse({ ok: false, error: "Unknown message" });
      return;
    }

    if (message.type === "GET_STATE") {
      sendResponse({ ok: true, state: await getState() });
      return;
    }

    if (message.type === "SAVE_SETTINGS") {
      const current = await getSettings();
      const next = {
        ...current,
        ...(message.settings || {})
      };

      await storageSet({ [SETTINGS_KEY]: next });
      sendResponse({ ok: true, settings: next });
      return;
    }

    if (message.type === "REFRESH_RATES") {
      const refreshResult = await refreshRatesWithFallback();

      if (!refreshResult.rateCache) {
        sendResponse({
          ok: false,
          error: refreshResult.rateError.message,
          rateError: refreshResult.rateError
        });
        return;
      }

      sendResponse({ ok: true, ...refreshResult });
      return;
    }

    sendResponse({ ok: false, error: `Unsupported message type: ${message.type}` });
  })().catch((error) => {
    sendResponse({ ok: false, error: error.message });
  });

  // Keep the message channel open for async work.
  return true;
});
