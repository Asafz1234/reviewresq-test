import { listenForUser, isStarterPlan } from "./session-data.js";

const signalPageDataReady = (() => {
  let sent = false;
  return () => {
    if (sent) return;
    sent = true;
    window.__rrPageDataReady?.();
  };
})();

function removeAiNavTabs() {
  const tabs = Array.from(document.querySelectorAll('.nav-tab[data-route="ai-agent"]'));
  tabs.forEach((tab) => tab.remove());
}

function renderAiUpgradeGate() {
  const main =
    document.querySelector("main.page-container") ||
    document.querySelector("main") ||
    document.querySelector(".page-shell");

  if (!main) return;

  main.innerHTML = `
    <section class="section">
      <div class="card">
        <h1 class="page-title">Upgrade required</h1>
        <p class="card-sub">AI Phone Agent and the Pro AI Suite are not available on the Starter plan. Upgrade to unlock call handling and advanced automation.</p>
        <div class="button-row" style="margin-top: 12px; justify-content:flex-start;">
          <a class="btn btn-primary" href="/account.html">Upgrade plan</a>
          <a class="btn btn-secondary" href="/overview.html">Return to overview</a>
        </div>
      </div>
    </section>
  `;
}

function guardAiPages() {
  listenForUser(({ subscription }) => {
    const planId = subscription?.planId;
    if (isStarterPlan(planId)) {
      removeAiNavTabs();
      renderAiUpgradeGate();
    }
    signalPageDataReady();
  });
}

guardAiPages();
