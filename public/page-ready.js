const signalPageDataReady = () => {
  window.__rrPageDataReady?.();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", signalPageDataReady, { once: true });
} else {
  signalPageDataReady();
}
