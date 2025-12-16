import { auth } from "./firebase-config.js";
import { getCachedSubscription } from "./session-data.js";

const runtimeEnv = window.RUNTIME_ENV || {};
export const functionsBaseUrl =
  runtimeEnv.FUNCTIONS_BASE_URL ||
  runtimeEnv.GOOGLE_FUNCTIONS_BASE_URL ||
  "https://us-central1-reviewresq-app.cloudfunctions.net";

const toastId = "feedback-toast";

function showToast(message, isError = false) {
  let toast = document.getElementById(toastId);
  if (!toast) {
    toast = document.createElement("div");
    toast.id = toastId;
    toast.className = "toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.toggle("toast-error", isError);
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), 2400);
}

function resolveOAuthButton(container) {
  return container?.querySelector("#connectWithGoogleBtn") || document.getElementById("connectWithGoogleBtn");
}

async function getIdTokenOrThrow() {
  const user = auth.currentUser;
  if (!user) {
    const error = new Error("You need to be signed in.");
    error.code = "AUTH_REQUIRED";
    throw error;
  }
  return user.getIdToken();
}

export async function startGoogleOAuth({ returnTo = "/dashboard.html" } = {}) {
  const btn = resolveOAuthButton();
  const statusEl = document.querySelector("[data-google-oauth-status]");
  const originalText = btn ? btn.textContent : "";

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Redirecting…';
    }

    const idToken = await getIdTokenOrThrow();
    const params = new URLSearchParams();
    params.set("returnTo", returnTo);
    params.set("idToken", idToken);

    statusEl && (statusEl.textContent = "Opening Google sign-in…");
    window.location.href = `${functionsBaseUrl}/googleAuthStart?${params.toString()}`;
  } catch (err) {
    console.error("[google-oauth] start failed", err);
    const message = err?.message || "Unable to start Google OAuth.";
    statusEl && (statusEl.textContent = message);
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText || "Connect with Google";
    }
    showToast(message, true);
  }
}

export function renderGoogleConnect(container, options = {}) {
  if (!container) return;
  const { title = "Connect your Google Reviews", subtitle = "Securely connect businesses you own or manage on Google.", returnTo = "/dashboard.html" } = options;

  container.innerHTML = `
    <section class="card connect-card">
      <div class="card-header">
        <div>
          <p class="card-title">${title}</p>
          <p class="card-subtitle">${subtitle}</p>
        </div>
      </div>
      <div class="stacked">
        <div class="stacked">
          <div class="input-row">
            <button
              class="btn btn-primary"
              type="button"
              data-google-oauth
              id="connectWithGoogleBtn"
            >
              Connect with Google
            </button>
          </div>
          <p class="card-subtitle" data-google-oauth-status id="googleOauthUnavailableMsg"></p>
        </div>
      </div>
    </section>
  `;

  const oauthBtn = resolveOAuthButton(container);
  if (oauthBtn) {
    oauthBtn.addEventListener("click", () => startGoogleOAuth({ returnTo }));
  }
}

export function renderOAuthConnectedState(container, profile = {}) {
  if (!container) return;
  const subscription = getCachedSubscription?.();
  const planLabel = subscription?.planId ? String(subscription.planId).toUpperCase() : "STARTER";
  const businessName = profile?.googleProfile?.name || profile?.businessName || profile?.name || "Business";

  container.innerHTML = `
    <section class="card connect-card">
      <div class="card-header">
        <div>
          <p class="card-title">Google connected</p>
          <p class="card-subtitle">${businessName} is linked to Google Business Profile.</p>
        </div>
        <span class="badge">${planLabel}</span>
      </div>
    </section>
  `;
}
