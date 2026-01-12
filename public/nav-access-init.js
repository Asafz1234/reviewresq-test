const isDevEnv =
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1"].includes(window.location.hostname);

if (typeof document !== "undefined") {
  document.documentElement.classList.add("rr-plan-pending");
  document.documentElement.classList.add("rr-data-pending");
  if (isDevEnv) {
    console.debug("[rr] plan pending start");
    console.debug("[rr] data pending start");
  }
  setTimeout(() => {
    if (document.documentElement.classList.contains("rr-data-pending")) {
      console.debug("[rr] data pending > 6s");
    }
  }, 6000);
}

if (typeof window !== "undefined") {
  window.__rrPageDataReady = function () {
    document.documentElement.classList.remove("rr-data-pending");
    if (isDevEnv) {
      console.debug("[rr] data pending end");
    }
  };
}

if (typeof window === "undefined" || !window.__rrNavInitRequested) {
  if (typeof window !== "undefined") {
    window.__rrNavInitRequested = true;
  }
  import("./nav-access-versioned.js").then(({ initNavPlanFilter }) => {
    initNavPlanFilter();
  });
}
