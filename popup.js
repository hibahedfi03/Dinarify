// Popup controller for TND Price Converter.
// Saves user choices in chrome.storage through the background service worker.

const enabledEl = document.getElementById("enabled");
const roundingEl = document.getElementById("rounding");
const refreshButton = document.getElementById("refreshRates");
const rateSummaryEl = document.getElementById("rateSummary");
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

function selectedDisplayMode() {
  const checked = document.querySelector('input[name="displayMode"]:checked');
  return checked ? checked.value : "append";
}

function setDisplayMode(value) {
  const input = document.querySelector(`input[name="displayMode"][value="${value}"]`);
  if (input) {
    input.checked = true;
  }
}

function setStatus(message, tone = "neutral") {
  statusMessageEl.textContent = message;
  statusMessageEl.dataset.tone = tone;
}

function formatShortDate(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function updateRateSummary(rateCache, rateError) {
  if (!rateCache || !rateCache.rates) {
    rateSummaryEl.textContent = rateError ? "Rates unavailable" : "Rates not loaded yet";
    return;
  }

  const usdRate = rateCache.rates.USD;
  const usdToTnd = usdRate ? 1 / usdRate : null;
  const fetchedText = rateCache.fetchedAt ? formatShortDate(rateCache.fetchedAt) : "recently";

  if (usdToTnd) {
    rateSummaryEl.textContent = `USD 1 ≈ ${usdToTnd.toFixed(3)} TND · ${fetchedText}`;
  } else {
    rateSummaryEl.textContent = `Updated ${fetchedText}`;
  }
}

function applyStateToControls(state) {
  const settings = state.settings || {};

  enabledEl.checked = Boolean(settings.enabled);
  setDisplayMode(settings.displayMode || "append");
  roundingEl.value = settings.rounding || "1";
  updateRateSummary(state.rateCache, state.rateError);

  if (state.rateError) {
    setStatus(`Last refresh failed: ${state.rateError.message}`, "warning");
  } else {
    setStatus("Ready");
  }
}

async function loadState() {
  try {
    const response = await sendMessage({ type: "GET_STATE" });
    applyStateToControls(response.state);
  } catch (error) {
    setStatus(error.message, "danger");
    rateSummaryEl.textContent = "Could not load extension state";
  }
}

async function saveSettings() {
  const settings = {
    enabled: enabledEl.checked,
    displayMode: selectedDisplayMode(),
    rounding: roundingEl.value
  };

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

  try {
    const response = await sendMessage({ type: "REFRESH_RATES" });
    updateRateSummary(response.rateCache, null);
    setStatus("Rates refreshed");
  } catch (error) {
    setStatus(error.message, "danger");
  } finally {
    refreshButton.disabled = false;
  }
}

enabledEl.addEventListener("change", saveSettings);
roundingEl.addEventListener("change", saveSettings);
refreshButton.addEventListener("click", refreshRates);

for (const input of document.querySelectorAll('input[name="displayMode"]')) {
  input.addEventListener("change", saveSettings);
}

loadState();
