let activeShift = null;
const clockInButton = document.querySelector("#clockInButton");
const clockOutButton = document.querySelector("#clockOutButton");

setInterval(() => { document.querySelector("#currentTime").textContent = new Date().toLocaleString(); }, 1000);
document.querySelector("#currentTime").textContent = new Date().toLocaleString();
clockInButton.addEventListener("click", () => punch("in"));
clockOutButton.addEventListener("click", () => punch("out"));
loadClock();

async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, { credentials:"same-origin",
    headers:{ "Content-Type":"application/json" }, ...options });
  if (response.status === 401) { window.location.href = "/login"; throw new Error("Login required"); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.error || "Time clock request failed");
  return result;
}

async function loadClock() {
  try { render(await request("/time-clock")); }
  catch (error) { showMessage(error.message, true); }
}

async function punch(action) {
  clockInButton.disabled = true; clockOutButton.disabled = true;
  try {
    await request(`/time-clock/${action}`, { method:"POST", body:"{}" });
    showMessage(action === "out" ? "Clocked out successfully." : "Clocked in successfully.", false);
    await loadClock();
  } catch (error) { showMessage(error.message, true); renderButtons(); }
}

function render(data) {
  activeShift = data.activeShift;
  document.querySelector("#employeeName").textContent = data.user.username;
  document.querySelector("#clockStatus").textContent = activeShift ? "Clocked in" : "Clocked out";
  document.querySelector("#shiftStarted").textContent = activeShift ? `Started ${dateTime(activeShift.clockIn)}` : "You have no open shift.";
  window.deviceApproved = data.deviceApproved;
  if (data.canViewTeam) loadOwnerControls();
  renderButtons();
  document.querySelector("#ownRows").innerHTML = rows(data.ownEntries, false);
  const totals = new Map();
  data.ownEntries.filter(entry => !entry.paidAt && entry.clockOut).forEach(entry => {
    const label = payPeriod(entry.clockIn);
    totals.set(label, (totals.get(label) || 0) + Number(duration(entry)));
  });
  document.querySelector("#timeCardTotals").innerHTML = [...totals]
    .map(([label,total]) => `<span>${label}: ${total.toFixed(2)} hours</span>`).join("")
    || "No completed hours in an open pay period.";
}

function loadOwnerControls() {
  const section = document.querySelector("#adminSection");
  section.hidden = false;
  if (location.hash === "#admin") requestAnimationFrame(() => section.scrollIntoView({ behavior: "smooth" }));
  if (window.timeClockAdminLoaded) return;
  window.timeClockAdminLoaded = true;
  const script = document.createElement("script");
  script.src = "/time-clock-admin.js?v=20260901";
  script.onerror = () => showMessage("Employee management could not be loaded. Refresh and try again.", true);
  document.body.appendChild(script);
}

function renderButtons() {
  clockInButton.disabled = !window.deviceApproved || Boolean(activeShift);
  clockOutButton.disabled = !window.deviceApproved || !activeShift;
  if (!window.deviceApproved) showMessage("This device is not a registered store tablet. Ask the owner to register it under Store tablets below.", true);
}

function rows(entries, showEmployee) {
  return entries.map((entry) => `<tr>${showEmployee ? `<td><strong>${escapeHtml(entry.employeeName || entry.username)}</strong></td>` : ""}<td>${new Date(entry.clockIn).toLocaleDateString()}</td><td>${new Date(entry.clockIn).toLocaleTimeString()}</td><td class="${entry.clockOut ? "" : "open"}">${entry.clockOut ? new Date(entry.clockOut).toLocaleTimeString() : "Clocked in"}</td><td>${duration(entry)}</td></tr>`).join("") || `<tr><td class="empty" colspan="${showEmployee ? 5 : 4}">No time records yet.</td></tr>`;
}
function duration(entry) { if (!entry.clockOut) return "—"; const hours=(new Date(entry.clockOut)-new Date(entry.clockIn))/3600000; return hours.toFixed(2); }
function payPeriod(value) { const date=new Date(value),anchor=new Date("2024-01-01T00:00:00"),days=Math.floor((date-anchor)/86400000),start=new Date(anchor);start.setDate(start.getDate()+Math.floor(days/14)*14);const end=new Date(start);end.setDate(end.getDate()+13);return `${start.toLocaleDateString()} – ${end.toLocaleDateString()}`; }
function dateTime(value) { return new Date(value).toLocaleString(); }
function showMessage(value, error) { const target=document.querySelector("#clockMessage"); target.hidden=false; target.textContent=value; target.classList.toggle("error",error); }
function escapeHtml(value) { return String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }
