const runtimeEnv = window.RUNTIME_ENV || {};

const APP_ORIGIN = window.location.origin;
const API_BASE = `${APP_ORIGIN}/api`;

function normalizeOrigin(value = "") {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch (err) {
    console.warn("[app-config] invalid origin", value, err);
    return null;
  }
}

function resolveFunctionsBaseUrl() {
  const configured =
    runtimeEnv.FUNCTIONS_BASE_URL ||
    runtimeEnv.GOOGLE_FUNCTIONS_BASE_URL ||
    runtimeEnv.GOOGLE_PLACES_PROXY_URL;
  return normalizeOrigin(configured) || APP_ORIGIN;
}

const FUNCTIONS_BASE_URL = resolveFunctionsBaseUrl();

window.REVIEWRESQ_CONFIG = {
  APP_ORIGIN,
  API_BASE,
  FUNCTIONS_BASE_URL,
};

export { APP_ORIGIN, API_BASE, FUNCTIONS_BASE_URL, resolveFunctionsBaseUrl };
