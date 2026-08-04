const pinForm = document.querySelector("#pinForm");
const pinInput = document.querySelector("#ownerPin");
const pinMessage = document.querySelector("#pinMessage");

pinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  pinMessage.textContent = "";
  try {
    const response = await fetch("/api/owner-pin/verify", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: pinInput.value }),
    });
    if (response.status === 401) return void (window.location.href = "/login");
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw new Error(result.error || "PIN verification failed");
    const requested = new URLSearchParams(window.location.search).get("next") || "/index.html";
    window.location.href = requested.startsWith("/") ? requested : "/index.html";
  } catch (error) {
    pinMessage.textContent = error.message;
    pinInput.select();
  }
});
