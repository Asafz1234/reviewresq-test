if (typeof document !== "undefined") {
  document.documentElement.classList.add("rr-plan-pending");
}

import("./nav-access-versioned.js").then(({ initNavPlanFilter }) => {
  initNavPlanFilter();
});
