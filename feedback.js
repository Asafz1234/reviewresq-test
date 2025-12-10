import { onSession, fetchAllReviews, describeReview } from "./dashboard-data.js";
import { formatDate } from "./session-data.js";

const tbody = document.querySelector("[data-feedback-table]");

function badgeClass(rating) {
  if (rating >= 4) return "badge badge-success";
  if (rating <= 2) return "badge badge-danger";
  return "badge";
}

function sentimentLabel(rating) {
  if (rating >= 4) return "Positive";
  if (rating <= 2) return "Negative";
  return "Neutral";
}

function renderFeedback(rows = []) {
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "No feedback yet";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const date = row.createdAt ? formatDate(row.createdAt) : "—";
    tr.innerHTML = `
      <td>${row.displayName}</td>
      <td>${row.email || row.phone || "—"}</td>
      <td><span class="${badgeClass(row.rating || 0)}">${sentimentLabel(row.rating || 0)}</span></td>
      <td>${row.message || "—"}</td>
      <td>${date}</td>
      <td><button class="btn btn-link" type="button">Reply</button></td>
    `;
    tbody.appendChild(tr);
  });
}

onSession(async ({ user }) => {
  if (!user) return;
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="6">Loading...</td></tr>`;
  }
  const reviews = await fetchAllReviews(user.uid);
  const feedbackOnly = reviews.filter((r) => r.source !== "google").map(describeReview);
  renderFeedback(feedbackOnly);
});
