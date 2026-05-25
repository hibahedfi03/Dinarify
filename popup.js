// Popup controller for Dinarify.
// The popup reads state from the background service worker and saves settings there.

const enabledEl = document.getElementById("enabled");
const enabledStateEl = document.getElementById("enabledState");
const enabledHintEl = document.getElementById("enabledHint");
const refreshButton = document.getElementById("refreshRates");
const rateStatusEl = document.getElementById("rateStatus");
const rateSummaryEl = document.getElementById("rateSummary");
const rateUpdatedEl = document.getElementById("rateUpdated");
const statusMessageEl = document.getElementById("statusMessage");

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response || !response.ok) {
        reject(new Error((response && response.error) || "Extension request failed"));
        return;
      }

      resolve(response);
    });
  });
}

function selectedRadioValue(name, fallback) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);
  return checked ? checked.value : fallback;
}

function setRadioValue(name, value) {
  const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (input) {
    input.checked = true;
  }
}

function setStatus(message, tone = "neutral") {
  statusMessageEl.textContent = message;
  statusMessageEl.dataset.tone = tone;
}

function setRateStatus(label, tone = "neutral") {
  rateStatusEl.textContent = label;
  rateStatusEl.dataset.tone = tone;
}

function updateEnabledCopy() {
  if (enabledEl.checked) {
    enabledStateEl.textContent = "Enabled";
    enabledHintEl.textContent = "Conversions are enabled on visited pages.";
    return;
  }

  enabledStateEl.textContent = "Paused";
  enabledHintEl.textContent = "Conversions are hidden until you turn this back on.";
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }

  const date = typeof value === "number" ? new Date(value) : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getLastUpdated(rateCache) {
  return (
    formatDateTime(rateCache && rateCache.lastUpdated) ||
    formatDateTime(rateCache && rateCache.fetchedAt) ||
    formatDateTime(rateCache && rateCache.lastUpdateUtc)
  );
}

function updateRateSummary(rateCache, rateError) {
  if (!rateCache || !rateCache.rates) {
    setRateStatus("Unavailable", "danger");
    rateSummaryEl.textContent = "Rates are not available yet.";
    rateUpdatedEl.textContent = rateError
      ? "Refresh failed. Check your connection and try again."
      : "Last updated: not available";
    return;
  }

  const usdRate = rateCache.rates.USD;
  const usdToTnd = usdRate ? 1 / usdRate : null;
  const updatedText = getLastUpdated(rateCache);

  setRateStatus(rateError ? "Cached" : "Current", rateError ? "warning" : "success");
  rateSummaryEl.textContent = usdToTnd
    ? `1 USD = ${usdToTnd.toFixed(3)} TND`
    : "Rates loaded for supported currencies.";
  rateUpdatedEl.textContent = updatedText
    ? `Last updated: ${updatedText}`
    : "Last updated: date unavailable";
}

function applyStateToControls(state) {
  const settings = state.settings || {};

  enabledEl.checked = Boolean(settings.enabled);
  setRadioValue("displayMode", settings.displayMode || "append");
  setRadioValue("rounding", settings.rounding || "1");
  updateEnabledCopy();
  updateRateSummary(state.rateCache, state.rateError);

  if (state.rateError && state.rateCache) {
    setStatus("Could not refresh. Using saved rates.", "warning");
  } else if (state.rateError) {
    setStatus("Rates unavailable. Try refresh when online.", "danger");
  } else {
    setStatus("Ready");
  }
}

async function loadState() {
  try {
    const response = await sendMessage({ type: "GET_STATE" });
    applyStateToControls(response.state);
  } catch (error) {
    setRateStatus("Unavailable", "danger");
    rateSummaryEl.textContent = "Could not load extension state.";
    rateUpdatedEl.textContent = "Last updated: not available";
    setStatus(error.message, "danger");
  }
}

async function saveSettings() {
  const settings = {
    enabled: enabledEl.checked,
    displayMode: selectedRadioValue("displayMode", "append"),
    rounding: selectedRadioValue("rounding", "1")
  };

  updateEnabledCopy();

  try {
    await sendMessage({ type: "SAVE_SETTINGS", settings });
    setStatus("Settings saved");
  } catch (error) {
    setStatus(error.message, "danger");
  }
}

async function refreshRates() {
  refreshButton.disabled = true;
  setStatus("Refreshing rates...");
  setRateStatus("Refreshing");

  try {
    const response = await sendMessage({ type: "REFRESH_RATES" });
    updateRateSummary(response.rateCache, response.rateError || null);
    setStatus(response.fromCache ? "Could not refresh. Using saved rates." : "Rates refreshed", response.fromCache ? "warning" : "neutral");
  } catch (error) {
    setRateStatus("Unavailable", "danger");
    setStatus(error.message || "Could not refresh rates. Try again later.", "danger");
  } finally {
    refreshButton.disabled = false;
  }
}

enabledEl.addEventListener("change", saveSettings);
refreshButton.addEventListener("click", refreshRates);

for (const input of document.querySelectorAll('input[name="displayMode"], input[name="rounding"]')) {
  input.addEventListener("change", saveSettings);
}

loadState();
