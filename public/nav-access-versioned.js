export const NAV_ACCESS_VERSION = "20260105b";

if (typeof window !== "undefined") {
  window.__NAV_ACCESS_VERSION = NAV_ACCESS_VERSION;
}

export * from "./nav-access.js";
