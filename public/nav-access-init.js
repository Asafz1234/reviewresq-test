if (typeof document !== "undefined") {
  document.documentElement.classList.add("rr-plan-pending");
  document.documentElement.classList.add("rr-data-pending");
  setTimeout(() => {
    if (document.documentElement.classList.contains("rr-data-pending")) {
      console.debug("[rr] data pending > 6s");
    }
  }, 6000);
}

if (typeof window !== "undefined") {
  window.__rrPageDataReady = function () {
    document.documentElement.classList.remove("rr-data-pending");
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
