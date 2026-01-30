const isDevEnv = typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);

// CRITICAL: Check for Simulation override BEFORE anything else
let activePlan = null;
try {
    const sim = localStorage.getItem('rr_simulated_plan');
    const stored = localStorage.getItem('userPlanId') || localStorage.getItem('userPlanLabel');
    // Simulation wins if it exists
    activePlan = (sim || stored || 'starter').toLowerCase().replace(/"/g, '');
} catch (e) { activePlan = 'starter'; }

if (typeof document !== "undefined") {
  // Force the attribute immediately so CSS hides/shows elements correctly
  if (document.documentElement) {
      document.documentElement.setAttribute('data-user-plan', activePlan);
      
      // If we have a plan (simulated or real), remove pending state immediately
      if (activePlan) {
          document.documentElement.classList.remove("rr-plan-pending");
          document.documentElement.classList.remove("rr-data-pending");
      }
  }
}

// This function will be called by the DOM to render the plan badge
function renderPlanBadge() {
    const planBadge = document.querySelector('.plan-badge');
    if (planBadge) {
        planBadge.textContent = `${activePlan.charAt(0).toUpperCase() + activePlan.slice(1)} Plan`;
    }
}

if (typeof window !== "undefined") {
  // Expose to global scope
  window.navAccess = { plan: activePlan, planPending: false };
  
  window.__rrPageDataReady = function () {
    document.documentElement.classList.remove("rr-data-pending");
  };
  
  // Render the badge as soon as the DOM is ready
  document.addEventListener('DOMContentLoaded', renderPlanBadge);
}

// Safe Import Logic
if (typeof window === "undefined" || !window.__rrNavInitRequested) {
  if (typeof window !== "undefined") window.__rrNavInitRequested = true;
  
  import("./nav-access-versioned.js")
    .then((module) => {
      if (module && typeof module.initNavPlanFilter === 'function') {
        module.initNavPlanFilter();
      }
    })
    .catch(err => console.warn("[rr] Nav init failed", err));
}
