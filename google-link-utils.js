const ALLOWED_GOOGLE_HOSTS = [
  "google.com",
  "www.google.com",
  "maps.app.goo.gl",
  "goo.gl",
  "goo.gl/maps",
  "g.page",
  "search.google.com",
];

export function buildReviewUrlFromPlaceId(placeId) {
  if (!placeId) return "";
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
}

export function extractPlaceIdFromUrl(raw = "") {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const direct =
      url.searchParams.get("placeid") || url.searchParams.get("place_id") || url.searchParams.get("pid");
    if (direct) return direct;

    const pathParts = url.pathname.split("/").filter(Boolean);
    const placeIndex = pathParts.findIndex((part) => part.toLowerCase() === "place");
    if (placeIndex >= 0 && pathParts[placeIndex + 1]) {
      return decodeURIComponent(pathParts[placeIndex + 1]);
    }
  } catch (err) {
    return null;
  }
  return null;
}

export function normalizeGoogleBusinessInputUrl(raw = "") {
  const trimmed = (raw || "").trim();
  if (!trimmed) return { ok: false };

  let url;
  try {
    url = new URL(trimmed);
  } catch (err) {
    return { ok: false };
  }

  if (!url.protocol || !["http:", "https:"].includes(url.protocol.toLowerCase())) {
    return { ok: false };
  }

  const host = url.host.toLowerCase();
  const baseHost = host.startsWith("www.") ? host.slice(4) : host;
  const normalizedHost = baseHost.startsWith("goo.gl/maps") ? "goo.gl/maps" : baseHost;

  const hostAllowed = ALLOWED_GOOGLE_HOSTS.some((allowed) =>
    normalizedHost === allowed || normalizedHost.endsWith(`.${allowed}`)
  );
  if (!hostAllowed) return { ok: false };

  const path = (url.pathname || "").toLowerCase();
  const hasMapsPath =
    path.includes("/maps") ||
    path.includes("/search") ||
    path.includes("/local/") ||
    path.includes("/url");
  if (!hasMapsPath && normalizedHost !== "g.page" && normalizedHost !== "goo.gl" && normalizedHost !== "goo.gl/maps") {
    return { ok: false };
  }

  const normalizedUrl = url.toString();
  const placeId = extractPlaceIdFromUrl(normalizedUrl);
  const reviewUrl = placeId ? buildReviewUrlFromPlaceId(placeId) : null;

  return {
    ok: true,
    normalizedUrl,
    normalizedHost,
    placeId,
    reviewUrl,
    kind: normalizedHost,
  };
}

export function resolveCanonicalReviewUrl(payload = {}) {
  const preferred = (payload.googleReviewUrl || "").trim();
  if (preferred) return preferred;

  const placeId = payload.googlePlaceId || extractPlaceIdFromUrl(payload.googleManualLink);
  if (placeId) {
    return buildReviewUrlFromPlaceId(placeId);
  }

  const fallbackLinks = [
    payload.googleManualLink,
    payload.googleProfileUrl,
    payload.googleSearchUrl,
    payload.googleLink,
    payload.googleReviewLink,
  ];

  for (const link of fallbackLinks) {
    if (!link) continue;
    const normalized = normalizeGoogleBusinessInputUrl(link);
    if (normalized?.reviewUrl) return normalized.reviewUrl;
    if (normalized?.ok) return normalized.normalizedUrl;
  }

  return "";
}
