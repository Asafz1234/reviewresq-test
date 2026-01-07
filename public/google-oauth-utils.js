const EXCHANGE_GOOGLE_AUTH_CODE_PATH = "exchangeGoogleAuthCodeV2";
const CLOUD_RUN_EXCHANGE_URL =
  "https://exchangegoogleauthcodev2-n4zh2svtxa-uc.a.run.app";
const LEGACY_EXCHANGE_URL =
  "https://us-central1-reviewresq-app.cloudfunctions.net/exchangeGoogleAuthCodeV2";

function isGoogleOAuthDebugEnabled() {
  const runtimeEnv = window.RUNTIME_ENV || {};
  if (runtimeEnv.GOOGLE_OAUTH_DEBUG === true || runtimeEnv.GOOGLE_OAUTH_DEBUG === "1") {
    return true;
  }
  if (runtimeEnv.DEBUG === true || runtimeEnv.DEBUG === "1") {
    return true;
  }
  const queryParams = new URLSearchParams(window.location.search || "");
  return queryParams.get("debug") === "1";
}

function normalizeExchangeUrl(candidate) {
  if (!candidate) return null;
  try {
    const url = new URL(candidate, window.location.origin);
    const normalizedPath = url.pathname.replace(/\/$/, "");
    if (normalizedPath.endsWith(`/${EXCHANGE_GOOGLE_AUTH_CODE_PATH}`)) {
      url.pathname = normalizedPath;
      url.search = "";
      url.hash = "";
      return url.toString();
    }
    url.pathname = `${normalizedPath}/${EXCHANGE_GOOGLE_AUTH_CODE_PATH}`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (err) {
    return null;
  }
}

export function getExchangeGoogleAuthCodeUrl() {
  const runtimeEnv = window.RUNTIME_ENV || {};
  const explicitOverride =
    window.__EXCHANGE_GOOGLE_AUTH_CODE_URL ||
    runtimeEnv.EXCHANGE_GOOGLE_AUTH_CODE_URL ||
    runtimeEnv.GOOGLE_OAUTH_EXCHANGE_URL ||
    runtimeEnv.GOOGLE_AUTH_EXCHANGE_URL ||
    null;
  const legacyRequired =
    window.__USE_LEGACY_GOOGLE_OAUTH_EXCHANGE === true ||
    window.__USE_LEGACY_GOOGLE_OAUTH_EXCHANGE === "1" ||
    runtimeEnv.USE_LEGACY_GOOGLE_OAUTH_EXCHANGE === true ||
    runtimeEnv.USE_LEGACY_GOOGLE_OAUTH_EXCHANGE === "1";

  let resolvedUrl = CLOUD_RUN_EXCHANGE_URL;
  let reason = "cloud-run-default";

  if (explicitOverride) {
    resolvedUrl = normalizeExchangeUrl(explicitOverride) || explicitOverride;
    reason = "explicit-override";
  } else if (legacyRequired) {
    resolvedUrl = LEGACY_EXCHANGE_URL;
    reason = "legacy-fallback";
  }

  if (isGoogleOAuthDebugEnabled()) {
    console.debug("[google-oauth][debug] using exchange endpoint", resolvedUrl, {
      reason,
    });
  }

  return resolvedUrl;
}
