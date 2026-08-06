let activeShift = null;
const clockButton = document.querySelector("#clockButton");

setInterval(() => { document.querySelector("#currentTime").textContent = new Date().toLocaleString(); }, 1000);
document.querySelector("#currentTime").textContent = new Date().toLocaleString();
clockButton.addEventListener("click", toggleClock);
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

async function toggleClock() {
  clockButton.disabled = true;
  try {
    await request(activeShift ? "/time-clock/out" : "/time-clock/in", { method:"POST", body:"{}" });
    showMessage(activeShift ? "Clocked out successfully." : "Clocked in successfully.", false);
    await loadClock();
  } catch (error) { showMessage(error.message, true); clockButton.disabled = false; }
}

function render(data) {
  activeShift = data.activeShift;
  document.querySelector("#employeeName").textContent = data.user.username;
  document.querySelector("#clockStatus").textContent = activeShift ? "Clocked in" : "Clocked out";
  document.querySelector("#shiftStarted").textContent = activeShift ? `Started ${dateTime(activeShift.clockIn)}` : "You have no open shift.";
  clockButton.textContent = activeShift ? "Clock out" : "Clock in";
  clockButton.classList.toggle("clock-out", Boolean(activeShift)); clockButton.disabled = false;
  document.querySelector("#ownRows").innerHTML = rows(data.ownEntries, false);
  document.querySelector("#teamPanel").hidden = !data.canViewTeam;
  if (data.canViewTeam) document.querySelector("#teamRows").innerHTML = rows(data.teamEntries, true);
}

function rows(entries, showEmployee) {
  return entries.map((entry) => `<tr>${showEmployee ? `<td><strong>${escapeHtml(entry.employeeName || entry.username)}</strong></td>` : ""}<td>${new Date(entry.clockIn).toLocaleDateString()}</td><td>${new Date(entry.clockIn).toLocaleTimeString()}</td><td class="${entry.clockOut ? "" : "open"}">${entry.clockOut ? new Date(entry.clockOut).toLocaleTimeString() : "Clocked in"}</td><td>${duration(entry)}</td></tr>`).join("") || `<tr><td class="empty" colspan="${showEmployee ? 5 : 4}">No time records yet.</td></tr>`;
}
function duration(entry) { if (!entry.clockOut) return "—"; const hours=(new Date(entry.clockOut)-new Date(entry.clockIn))/3600000; return hours.toFixed(2); }
function dateTime(value) { return new Date(value).toLocaleString(); }
function showMessage(value, error) { const target=document.querySelector("#clockMessage"); target.hidden=false; target.textContent=value; target.classList.toggle("error",error); }
function escapeHtml(value) { return String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }
