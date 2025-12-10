import { onSession } from "./dashboard-data.js";

const googleInput = document.querySelector("[data-google-link]");
const funnelInput = document.querySelector("[data-funnel-link]");

function setValue(input, value) {
  if (!input) return;
  input.value = value || "—";
}

onSession(({ user, profile }) => {
  if (!user) return;
  const googleLink =
    profile?.googleReviewUrl || profile?.googleLink || profile?.googleReviewLink || "";
  const funnelLink =
    profile?.publicFunnelUrl ||
    profile?.funnelLink ||
    profile?.portalUrl ||
    (profile?.shareKey ? `https://reviewresq.com/portal.html?shareKey=${profile.shareKey}` : "") ||
    (user?.uid ? `https://reviewresq.com/portal.html?businessId=${user.uid}` : "");

  setValue(googleInput, googleLink || "—");
  setValue(funnelInput, funnelLink || "—");
});
