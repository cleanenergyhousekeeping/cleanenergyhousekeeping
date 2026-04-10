const LIVE_APP_URL = "https://script.google.com/macros/s/AKfycbxDiNx-ab3J45CuljJ5QQ0cc1e-ZbFyWLqMfOCPa8I0niZX9A4OQNEZpWVzSkolYdCm/exec";

const statusText = document.getElementById("statusText");
const openAppBtn = document.getElementById("openAppBtn");

async function registerServiceWorker_() {
  if (!("serviceWorker" in navigator)) {
    return false;
  }

  try {
    const reg = await navigator.serviceWorker.register("/clockin/service-worker.js", {
      scope: "/clockin/"
    });

    return !!reg;
  } catch (error) {
    console.error("Service worker registration failed:", error);
    return false;
  }
}

function updateShellStatus_() {
  if (navigator.onLine) {
    statusText.textContent = "Online. The live app should open normally.";
  } else {
    statusText.textContent = "Offline. The shell is available, but full offline clock-in is the next build step.";
  }
}

function openLiveApp_() {
  window.location.href = LIVE_APP_URL;
}

window.addEventListener("online", updateShellStatus_);
window.addEventListener("offline", updateShellStatus_);

openAppBtn.addEventListener("click", openLiveApp_);

document.addEventListener("DOMContentLoaded", async function () {
  await registerServiceWorker_();
  updateShellStatus_();
});
