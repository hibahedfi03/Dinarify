// TND Price Converter background service worker.
// It owns settings, daily exchange-rate refreshes, and the cached rate payload.

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

function isRateCacheFresh(rateCache) {
  if (!rateCache || !rateCache.rates || !rateCache.fetchedAt) {
    return false;
  }

  return Date.now() - rateCache.fetchedAt < ONE_DAY_MS;
}

async function fetchRates() {
  const response = await fetch(RATE_API_URL, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Exchange-rate API returned HTTP ${response.status}`);
  }

  const data = await response.json();

  if (data.result !== "success" || !data.rates || data.base_code !== TARGET_CURRENCY) {
    throw new Error("Exchange-rate API returned an unexpected response");
  }

  const rateCache = {
    base: TARGET_CURRENCY,
    rates: data.rates,
    provider: data.provider || "ExchangeRate-API",
    documentation: data.documentation || "https://www.exchangerate-api.com/docs/free",
    termsOfUse: data.terms_of_use || "https://www.exchangerate-api.com/terms",
    sourceUrl: RATE_API_URL,
    fetchedAt: Date.now(),
    lastUpdateUtc: data.time_last_update_utc || null,
    nextUpdateUtc: data.time_next_update_utc || null
  };

  await storageSet({
    [RATE_CACHE_KEY]: rateCache,
    [RATE_ERROR_KEY]: null
  });

  return rateCache;
}

async function getState({ refreshIfStale = true } = {}) {
  const stored = await storageGet([SETTINGS_KEY, RATE_CACHE_KEY, RATE_ERROR_KEY]);
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(stored[SETTINGS_KEY] || {})
  };

  let rateCache = stored[RATE_CACHE_KEY] || null;
  let rateError = stored[RATE_ERROR_KEY] || null;

  if (refreshIfStale && !isRateCacheFresh(rateCache)) {
    try {
      rateCache = await fetchRates();
      rateError = null;
    } catch (error) {
      // Keep stale rates if they exist, but expose the error to the popup.
      rateError = {
        message: error.message,
        at: Date.now()
      };
      await storageSet({ [RATE_ERROR_KEY]: rateError });
    }
  }

  return { settings, rateCache, rateError };
}

async function initializeExtension() {
  const settings = await getSettings();
  await storageSet({ [SETTINGS_KEY]: settings });
  createDailyAlarm();

  try {
    await fetchRates();
  } catch (error) {
    await storageSet({
      [RATE_ERROR_KEY]: {
        message: error.message,
        at: Date.now()
      }
    });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  initializeExtension().catch((error) => {
    console.warn("TND Price Converter setup failed:", error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  createDailyAlarm();
  getState({ refreshIfStale: true }).catch((error) => {
    console.warn("TND Price Converter startup refresh failed:", error);
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === DAILY_ALARM_NAME) {
    fetchRates().catch((error) => {
      storageSet({
        [RATE_ERROR_KEY]: {
          message: error.message,
          at: Date.now()
        }
      });
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
      sendResponse({ ok: true, rateCache: await fetchRates() });
      return;
    }

    sendResponse({ ok: false, error: `Unsupported message type: ${message.type}` });
  })().catch((error) => {
    sendResponse({ ok: false, error: error.message });
  });

  // Keep the message channel open for async work.
  return true;
});
