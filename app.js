const TEST_BYTES = 10_000_000;
const STREAMS_PER_SITE = 4;
const STREAM_BYTES = TEST_BYTES / 2;
const SKEW_RATIO = 0.5;
const TEST_SITES = [
  { name: "Cloudflare", url: n => `https://speed.cloudflare.com/__down?bytes=${STREAM_BYTES}&cacheBust=${Date.now()}-${n}` },
  { name: "CacheFly", url: n => `https://cachefly.cachefly.net/10mb.test?cacheBust=${Date.now()}-${n}` },
  { name: "Wikimedia", url: n => `https://upload.wikimedia.org/wikipedia/commons/3/3f/Fronalpstock_big.jpg?cacheBust=${Date.now()}-${n}` }
];
const TEST_TIMEOUT_MS = 30_000;
const SESSION_STORAGE_KEY = "signal-watch-session-v1";

const elements = {
  themeToggle: document.querySelector("#themeToggle"),
  intervalValue: document.querySelector("#intervalValue"),
  intervalUnit: document.querySelector("#intervalUnit"),
  startButton: document.querySelector("#startButton"),
  freshButton: document.querySelector("#freshButton"),
  endButton: document.querySelector("#endButton"),
  statusDot: document.querySelector("#statusDot"),
  statusText: document.querySelector("#statusText"),
  currentSpeed: document.querySelector("#currentSpeed"),
  lastChecked: document.querySelector("#lastChecked"),
  meterFill: document.querySelector("#meterFill"),
  testingMessage: document.querySelector("#testingMessage"),
  countdown: document.querySelector("#countdown"),
  siteList: document.querySelector("#siteList"),
  currentSite: document.querySelector("#currentSite"),
  testCount: document.querySelector("#testCount"),
  offlineCount: document.querySelector("#offlineCount"),
  lowestSpeed: document.querySelector("#lowestSpeed"),
  averageSpeed: document.querySelector("#averageSpeed"),
  highestSpeed: document.querySelector("#highestSpeed"),
  checkCount: document.querySelector("#checkCount"),
  historyEmpty: document.querySelector("#historyEmpty"),
  historyList: document.querySelector("#historyList"),
  sessionDialog: document.querySelector("#sessionDialog"),
  sessionDialogSummary: document.querySelector("#sessionDialogSummary"),
  continueButton: document.querySelector("#continueButton"),
  newSessionButton: document.querySelector("#newSessionButton")
};

let monitoring = false;
let testing = false;
let timerId = null;
let countdownId = null;
let nextCheckAt = 0;
let activeController = null;
let offlineEvents = 0;
let results = [];

function saveSession() {
  const session = {
    monitoring,
    offlineEvents,
    intervalValue: elements.intervalValue.value,
    intervalUnit: elements.intervalUnit.value,
    results: results.map(result => ({ speed: result.speed, sites: result.sites, date: result.date.toISOString() }))
  };
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function getSavedSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY));
    if (!session || !Array.isArray(session.results)) return null;
    return session;
  } catch {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

function restoreSession(session) {
  offlineEvents = Number.isFinite(session.offlineEvents) ? session.offlineEvents : 0;
  results = session.results
    .filter(result => Number.isFinite(result.speed) && !Number.isNaN(Date.parse(result.date)))
    .map(result => ({ speed: result.speed, sites: Array.isArray(result.sites) ? result.sites : undefined, date: new Date(result.date) }));
  elements.intervalValue.value = session.intervalValue || "2";
  elements.intervalUnit.value = session.intervalUnit === "seconds" ? "seconds" : "minutes";
  elements.historyList.replaceChildren();
  elements.historyEmpty.hidden = results.length > 0;
  results.forEach(addHistory);
  updateStatistics();

  const latest = results.at(-1);
  if (latest) {
    elements.currentSpeed.textContent = formatSpeed(latest.speed);
    elements.currentSite.textContent = medianLabel(latest);
    renderSiteList(latest);
    elements.meterFill.style.width = `${Math.min(100, Math.max(1, latest.speed / 5))}%`;
    elements.lastChecked.textContent = `Last checked ${latest.date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
  }
}

function clearSession() {
  monitoring = false;
  testing = false;
  clearTimeout(timerId);
  stopCountdown();
  activeController?.abort();
  activeController = null;
  offlineEvents = 0;
  results = [];
  localStorage.removeItem(SESSION_STORAGE_KEY);
  elements.historyList.replaceChildren();
  elements.historyEmpty.hidden = false;
  elements.currentSpeed.textContent = "—";
  elements.lowestSpeed.textContent = "—";
  elements.averageSpeed.textContent = "—";
  elements.highestSpeed.textContent = "—";
  elements.meterFill.style.width = "0";
  elements.lastChecked.textContent = "Start monitoring to run your first test";
  elements.testingMessage.hidden = true;
  elements.currentSite.textContent = "";
  renderSiteList();
  elements.startButton.disabled = false;
  elements.endButton.disabled = true;
  setStatus("Ready to monitor");
  updateStatistics();
}

function loadTheme() {
  const saved = localStorage.getItem("signal-watch-theme");
  const preferred = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  setTheme(saved || preferred);
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  elements.themeToggle.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} mode`);
  localStorage.setItem("signal-watch-theme", theme);
}

function getIntervalMs() {
  const raw = Number(elements.intervalValue.value);
  const safeValue = Number.isFinite(raw) && raw > 0 ? raw : 2;
  elements.intervalValue.value = String(safeValue);
  return safeValue * (elements.intervalUnit.value === "seconds" ? 1000 : 60_000);
}

function setStatus(text, state = "idle") {
  elements.statusText.textContent = text;
  elements.statusDot.className = `status-dot ${state === "idle" ? "" : state}`.trim();
}

function formatSpeed(value) {
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function updateStatistics() {
  elements.testCount.textContent = String(results.length);
  elements.offlineCount.textContent = String(offlineEvents);
  elements.checkCount.textContent = `${results.length} ${results.length === 1 ? "check" : "checks"}`;
  if (!results.length) return;

  const speeds = results.map(item => item.speed);
  elements.lowestSpeed.textContent = formatSpeed(Math.min(...speeds));
  elements.highestSpeed.textContent = formatSpeed(Math.max(...speeds));
  elements.averageSpeed.textContent = formatSpeed(speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length);
}

function addHistory(result) {
  elements.historyEmpty.hidden = true;
  const row = document.createElement("div");
  row.className = "history-row";
  const meterWidth = Math.min(100, Math.max(2, result.speed / 5));
  row.innerHTML = `
    <time datetime="${result.date.toISOString()}">${result.date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</time>
    <div class="history-bar"><span style="width:${meterWidth}%"></span></div>
    <strong>${formatSpeed(result.speed)} <small>Mbps</small></strong>`;
  if (result.sites?.length) {
    const detail = document.createElement("div");
    detail.className = "history-sites";
    result.sites.forEach(site => {
      const item = document.createElement("span");
      item.textContent = `${site.name} ${site.speed === null ? "failed" : formatSpeed(site.speed)}`;
      if (site.speed === null || isSkewed(result, site)) item.className = "site-low";
      detail.append(item);
    });
    row.append(detail);
  }
  elements.historyList.prepend(row);
}

function recordOffline(message = "Connection unavailable") {
  offlineEvents += 1;
  updateStatistics();
  setStatus(message, "offline");
  elements.lastChecked.textContent = `Failed check at ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
  saveSession();
}

async function readStream(site, n, signal) {
  const response = await fetch(site.url(n), { cache: "no-store", signal });
  if (!response.ok) throw new Error(`${site.name} returned ${response.status}`);
  let bytes = 0;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    while (bytes < STREAM_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
    }
    reader.cancel().catch(() => {});
  } else {
    bytes = (await response.arrayBuffer()).byteLength;
  }
  return bytes;
}

// Downloads from one site over several parallel connections and returns the combined Mbps.
async function measureSite(site) {
  activeController = new AbortController();
  const { signal } = activeController;
  const timeoutId = setTimeout(() => activeController.abort(), TEST_TIMEOUT_MS);
  const start = performance.now();

  try {
    const sizes = await Promise.all(Array.from({ length: STREAMS_PER_SITE }, (_, n) => readStream(site, n, signal)));
    const receivedBytes = sizes.reduce((sum, size) => sum + size, 0);
    const seconds = (performance.now() - start) / 1000;
    if (!receivedBytes || seconds <= 0) throw new Error("No test data received");
    return (receivedBytes * 8) / seconds / 1_000_000;
  } finally {
    clearTimeout(timeoutId);
    activeController = null;
  }
}

function median(values) {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Tests each site one after another (so they don't compete for bandwidth) and returns the median plus every site's speed.
async function measureDownloadSpeed() {
  const sites = [];
  for (const [index, site] of TEST_SITES.entries()) {
    if (!monitoring) return null;
    renderSiteList(lastResult(), site.name);
    elements.testingMessage.textContent = `Measuring your connection… (${site.name}, ${index + 1} of ${TEST_SITES.length})`;
    try {
      sites.push({ name: site.name, speed: await measureSite(site) });
    } catch {
      sites.push({ name: site.name, speed: null });
    }
  }
  const speeds = sites.filter(site => site.speed !== null).map(site => site.speed);
  if (!speeds.length) throw new Error("All test sites failed");
  return { speed: median(speeds), sites };
}

// Shows all test sites under the speed number: last result per site, and which one is being tested right now.
function lastResult() {
  return results.at(-1) ?? null;
}

function renderSiteList(result = null, activeName = null) {
  elements.siteList.replaceChildren(...TEST_SITES.map(site => {
    const entry = result?.sites?.find(item => item.name === site.name);
    const item = document.createElement("span");
    item.className = "site-chip";
    if (site.name === activeName) item.classList.add("testing");
    else if (entry && (entry.speed === null || isSkewed(result, entry))) item.classList.add("site-low");
    const value = site.name === activeName ? "testing…" : entry ? (entry.speed === null ? "failed" : `${formatSpeed(entry.speed)} Mbps`) : "—";
    item.textContent = `${site.name} · ${value}`;
    return item;
  }));
}

function medianLabel(result) {
  const ok = result.sites?.filter(site => site.speed !== null).length;
  return ok ? `median of ${ok} ${ok === 1 ? "site" : "sites"}` : "";
}

function isSkewed(result, site) {
  return site.speed !== null && result.sites.filter(item => item.speed !== null).length > 1 && site.speed < result.speed * SKEW_RATIO;
}

function startCountdown(ms) {
  stopCountdown();
  nextCheckAt = Date.now() + ms;
  updateCountdown();
  countdownId = setInterval(updateCountdown, 250);
}

function stopCountdown() {
  clearInterval(countdownId);
  countdownId = null;
  elements.countdown.hidden = true;
}

function updateCountdown() {
  const remaining = Math.max(0, Math.ceil((nextCheckAt - Date.now()) / 1000));
  const minutes = Math.floor(remaining / 60);
  const seconds = String(remaining % 60).padStart(2, "0");
  elements.countdown.textContent = `Next check in ${minutes}:${seconds}`;
  elements.countdown.hidden = false;
}

async function runCheck() {
  if (!monitoring || testing) return;
  if (!navigator.onLine) {
    recordOffline();
    scheduleNextCheck();
    return;
  }

  testing = true;
  stopCountdown();
  setStatus("Testing connection", "active");
  elements.testingMessage.hidden = false;
  elements.startButton.disabled = true;

  try {
    const best = await measureDownloadSpeed();
    if (!monitoring || !best) return;
    const { speed, sites } = best;
    const result = { speed, sites, date: new Date() };
    elements.currentSite.textContent = medianLabel(result);
    renderSiteList(result);
    results.push(result);
    elements.currentSpeed.textContent = formatSpeed(speed);
    elements.lastChecked.textContent = `Last checked ${result.date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
    elements.meterFill.style.width = `${Math.min(100, Math.max(1, speed / 5))}%`;
    setStatus("Monitoring active", "active");
    addHistory(result);
    updateStatistics();
    saveSession();
  } catch (error) {
    if (monitoring && error.name !== "AbortError") recordOffline("Speed check failed");
  } finally {
    testing = false;
    elements.testingMessage.hidden = true;
    renderSiteList(lastResult());
    if (monitoring) scheduleNextCheck();
  }
}

function scheduleNextCheck() {
  clearTimeout(timerId);
  if (!monitoring) return;
  const ms = getIntervalMs();
  timerId = setTimeout(runCheck, ms);
  startCountdown(ms);
}

function startMonitoring() {
  if (monitoring) return;
  monitoring = true;
  elements.startButton.disabled = true;
  elements.endButton.disabled = false;
  saveSession();
  runCheck();
}

function stopMonitoring() {
  monitoring = false;
  clearTimeout(timerId);
  stopCountdown();
  activeController?.abort();
  elements.startButton.disabled = false;
  elements.endButton.disabled = true;
  elements.testingMessage.hidden = true;
  setStatus("Test ended", "idle");
  elements.lastChecked.textContent = results.length ? `Session ended after ${results.length} ${results.length === 1 ? "check" : "checks"}` : "No completed checks";
  saveSession();
}

function startFresh() {
  const hasSession = results.length > 0 || offlineEvents > 0;
  if (hasSession && !window.confirm("Clear the saved session and start fresh?")) return;
  clearSession();
  elements.sessionDialog.hidden = true;
  startMonitoring();
}

function initializeSession() {
  const session = getSavedSession();
  if (!session || (!session.results.length && !session.offlineEvents)) return;
  restoreSession(session);
  const lastCheck = results.at(-1)?.date;
  elements.sessionDialogSummary.textContent = `${results.length} ${results.length === 1 ? "check" : "checks"} and ${offlineEvents} offline ${offlineEvents === 1 ? "event" : "events"} saved${lastCheck ? `, last updated ${lastCheck.toLocaleString()}` : ""}.`;
  elements.sessionDialog.hidden = false;
  elements.continueButton.focus();
}

elements.themeToggle.addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
elements.startButton.addEventListener("click", startMonitoring);
elements.freshButton.addEventListener("click", startFresh);
elements.endButton.addEventListener("click", stopMonitoring);
elements.continueButton.addEventListener("click", () => { elements.sessionDialog.hidden = true; startMonitoring(); });
elements.newSessionButton.addEventListener("click", () => { clearSession(); elements.sessionDialog.hidden = true; startMonitoring(); });
elements.intervalValue.addEventListener("change", () => { saveSession(); if (monitoring && !testing) scheduleNextCheck(); });
elements.intervalUnit.addEventListener("change", () => { saveSession(); if (monitoring && !testing) scheduleNextCheck(); });
window.addEventListener("offline", () => { if (monitoring) recordOffline("Device went offline"); });
window.addEventListener("online", () => { if (monitoring) { setStatus("Connection restored", "active"); runCheck(); } });

loadTheme();
renderSiteList();
updateStatistics();
initializeSession();
