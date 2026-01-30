import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { collection, query, where, getDocs, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

document.addEventListener("DOMContentLoaded", () => {
    onAuthStateChanged(auth, user => {
        if (user) {
            const businessId = user.uid; // Use direct UID for security
            renderFeedbackContent(businessId);
        }
    });
});

function renderFeedbackContent(businessId) {
    const feedbackContent = document.getElementById("feedback-content");
    if (!feedbackContent) return;

    const debugBanner = `<div class="debug-banner">Current Business ID: ${businessId || 'NULL'}</div>`;

    feedbackContent.innerHTML = `
        ${debugBanner}
        <div class="card">
            <div class="table-wrapper">
              <table class="table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Rating</th>
                    <th>Message</th>
                    <th>Date</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody id="feedback-table-body"></tbody>
              </table>
            </div>
            <div class="empty-state" id="feedback-empty-state" style="display: none;">
              <p>No feedback received yet.</p>
            </div>
        </div>
    `;

    loadFeedbackData(businessId);
}

async function loadFeedbackData(businessId) {
    if (!businessId) return;
    // Corrected query to use the businessId for filtering
    const feedbackQuery = query(
        collection(db, "feedback"), 
        where("businessId", "==", businessId), 
        orderBy("createdAt", "desc")
    );

    onSnapshot(feedbackQuery, (snapshot) => {
        const feedback = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderFeedbackTable(feedback);
    }, (error) => {
        console.error("Error loading feedback data:", error);
        const tableBody = document.getElementById("feedback-table-body");
        tableBody.innerHTML = `<tr><td colspan="5">Error loading data. Check console.</td></tr>`;
    });
}

function renderFeedbackTable(feedback) {
    const tableBody = document.getElementById("feedback-table-body");
    const emptyState = document.getElementById("feedback-empty-state");

    if (feedback.length === 0) {
        tableBody.innerHTML = "";
        if(emptyState) emptyState.style.display = "block";
        return;
    }

    if(emptyState) emptyState.style.display = "none";
    tableBody.innerHTML = feedback.map(item => `
        <tr>
            <td>${item.customerName || 'Anonymous'}</td>
            <td>${item.rating}</td>
            <td>${item.message || '--'}</td>
            <td>${item.createdAt ? item.createdAt.toDate().toLocaleDateString() : 'N/A'}</td>
            <td><span class="pill">${item.status || 'New'}</span></td>
        </tr>
    `).join('');
}
