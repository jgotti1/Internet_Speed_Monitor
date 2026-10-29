const TEST_URL = "https://speed.cloudflare.com/__down";
const TEST_BYTES = 10_000_000;
const TEST_TIMEOUT_MS = 30_000;

const elements = {
  themeToggle: document.querySelector("#themeToggle"),
  intervalValue: document.querySelector("#intervalValue"),
  intervalUnit: document.querySelector("#intervalUnit"),
  startButton: document.querySelector("#startButton"),
  endButton: document.querySelector("#endButton"),
  statusDot: document.querySelector("#statusDot"),
  statusText: document.querySelector("#statusText"),
  currentSpeed: document.querySelector("#currentSpeed"),
  lastChecked: document.querySelector("#lastChecked"),
  meterFill: document.querySelector("#meterFill"),
  testingMessage: document.querySelector("#testingMessage"),
  offlineCount: document.querySelector("#offlineCount"),
  lowestSpeed: document.querySelector("#lowestSpeed"),
  averageSpeed: document.querySelector("#averageSpeed"),
  highestSpeed: document.querySelector("#highestSpeed"),
  checkCount: document.querySelector("#checkCount"),
  historyEmpty: document.querySelector("#historyEmpty"),
  historyList: document.querySelector("#historyList")
};

let monitoring = false;
let testing = false;
let timerId = null;
let activeController = null;
let offlineEvents = 0;
let results = [];

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
  elements.historyList.prepend(row);
}

function recordOffline(message = "Connection unavailable") {
  offlineEvents += 1;
  updateStatistics();
  setStatus(message, "offline");
  elements.lastChecked.textContent = `Failed check at ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
}

async function measureDownloadSpeed() {
  activeController = new AbortController();
  const timeoutId = setTimeout(() => activeController.abort(), TEST_TIMEOUT_MS);
  const start = performance.now();
  let receivedBytes = 0;

  try {
    const url = `${TEST_URL}?bytes=${TEST_BYTES}&cacheBust=${Date.now()}`;
    const response = await fetch(url, { cache: "no-store", signal: activeController.signal });
    if (!response.ok) throw new Error(`Test server returned ${response.status}`);

    if (response.body?.getReader) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        receivedBytes += value.byteLength;
      }
    } else {
      receivedBytes = (await response.arrayBuffer()).byteLength;
    }

    const seconds = (performance.now() - start) / 1000;
    if (!receivedBytes || seconds <= 0) throw new Error("No test data received");
    return (receivedBytes * 8) / seconds / 1_000_000;
  } finally {
    clearTimeout(timeoutId);
    activeController = null;
  }
}

async function runCheck() {
  if (!monitoring || testing) return;
  if (!navigator.onLine) {
    recordOffline();
    scheduleNextCheck();
    return;
  }

  testing = true;
  setStatus("Testing connection", "active");
  elements.testingMessage.hidden = false;
  elements.startButton.disabled = true;

  try {
    const speed = await measureDownloadSpeed();
    if (!monitoring) return;
    const result = { speed, date: new Date() };
    results.push(result);
    elements.currentSpeed.textContent = formatSpeed(speed);
    elements.lastChecked.textContent = `Last checked ${result.date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
    elements.meterFill.style.width = `${Math.min(100, Math.max(1, speed / 5))}%`;
    setStatus("Monitoring active", "active");
    addHistory(result);
    updateStatistics();
  } catch (error) {
    if (monitoring && error.name !== "AbortError") recordOffline("Speed check failed");
  } finally {
    testing = false;
    elements.testingMessage.hidden = true;
    if (monitoring) scheduleNextCheck();
  }
}

function scheduleNextCheck() {
  clearTimeout(timerId);
  if (monitoring) timerId = setTimeout(runCheck, getIntervalMs());
}

function startMonitoring() {
  if (monitoring) return;
  monitoring = true;
  elements.startButton.disabled = true;
  elements.endButton.disabled = false;
  runCheck();
}

function stopMonitoring() {
  monitoring = false;
  clearTimeout(timerId);
  activeController?.abort();
  elements.startButton.disabled = false;
  elements.endButton.disabled = true;
  elements.testingMessage.hidden = true;
  setStatus("Test ended", "idle");
  elements.lastChecked.textContent = results.length ? `Session ended after ${results.length} ${results.length === 1 ? "check" : "checks"}` : "No completed checks";
}

elements.themeToggle.addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
elements.startButton.addEventListener("click", startMonitoring);
elements.endButton.addEventListener("click", stopMonitoring);
elements.intervalValue.addEventListener("change", () => { if (monitoring && !testing) scheduleNextCheck(); });
elements.intervalUnit.addEventListener("change", () => { if (monitoring && !testing) scheduleNextCheck(); });
window.addEventListener("offline", () => { if (monitoring) recordOffline("Device went offline"); });
window.addEventListener("online", () => { if (monitoring) { setStatus("Connection restored", "active"); runCheck(); } });

loadTheme();
updateStatistics();
