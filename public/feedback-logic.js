import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, orderBy, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth } from "./firebase-config.js";

const db = getFirestore();

document.addEventListener("DOMContentLoaded", () => {
    onAuthStateChanged(auth, user => {
        if (user) {
            loadFeedback(user.uid);
        }
    });
    document.body.insertAdjacentHTML('beforeend', `
        <div id="reply-modal" class="modal-overlay">
            <div class="modal-card">
                <div class="modal-header">
                    <span id="modal-title">Reply to Customer</span>
                    <span class="modal-close" onclick="closeModal()">×</span>
                </div>
                <div id="modal-customer-msg" style="background:#f9fafb; padding:12px; border-radius:8px; margin-bottom:16px; font-size:14px; color:#4b5563; font-style:italic;"></div>
                
                <button class="ai-btn" onclick="useAIReply()">✨ Generate AI Reply</button>
                
                <textarea id="reply-text" rows="5" class="form-group" style="width:100%; padding:10px; border:1px solid #e5e7eb; border-radius:8px; margin-bottom:16px;" placeholder="Type your reply here..."></textarea>
                
                <div style="text-align:right; gap:10px; display:flex; justify-content:flex-end;">
                    <button class="btn" style="background:transparent; border:1px solid #e5e7eb;" onclick="closeModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="sendReply()">Send & Resolve</button>
                </div>
            </div>
        </div>
    `);
});

let currentFeedbackId = null;
let currentRating = 0;

// Make these global so HTML onClick works
window.openReplyModal = (id, customer, message, rating) => {
    currentFeedbackId = id;
    currentRating = rating;
    document.getElementById('modal-title').textContent = `Reply to ${customer}`;
    document.getElementById('modal-customer-msg').textContent = `"${message}"`;
    document.getElementById('reply-text').value = ''; // Clear
    document.getElementById('reply-modal').classList.add('open');
};

window.closeModal = () => {
    document.getElementById('reply-modal').classList.remove('open');
};

window.useAIReply = () => {
    const templates = {
        positive: ["Thank you so much for the kind words! We're thrilled to hear you had a great experience.", "We really appreciate your feedback! Can't wait to see you again soon."],
        negative: ["We're truly sorry to hear about your experience. Please contact us directly so we can make it right.", "Thank you for bringing this to our attention. We take this feedback seriously and will look into it immediately."]
    };
    const type = currentRating >= 4 ? 'positive' : 'negative';
    const text = templates[type][Math.floor(Math.random() * templates[type].length)];
    document.getElementById('reply-text').value = text;
};

window.sendReply = async () => {
    if(!currentFeedbackId) return;
    const btn = document.querySelector('.btn-primary');
    btn.textContent = "Sending...";
    
    try {
        // Update Status in Firestore
        await updateDoc(doc(db, "feedback", currentFeedbackId), {
            status: "Resolved",
            reply: document.getElementById('reply-text').value,
            repliedAt: new Date()
        });
        
        // Close and Refresh
        closeModal();
        // Re-load the table (you might need to call loadFeedback(userId) again here if scope allows, or just reload page)
        window.location.reload(); 
    } catch (e) {
        console.error(e);
        alert("Error updating status");
    }
};

async function loadFeedback(businessId) {
    const tbody = document.getElementById('feedback-table-body');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px;">Loading feedback...</td></tr>';

    try {
        const q = query(collection(db, "feedback"), where("businessId", "==", businessId), orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px;">No feedback received yet.</td></tr>';
            return;
        }

        tbody.innerHTML = snapshot.docs.map(doc => {
            const data = doc.data();
            const stars = '⭐'.repeat(data.rating || 0);
            const date = data.createdAt ? new Date(data.createdAt.seconds * 1000).toLocaleDateString() : 'N/A';
            
            let statusClass = 'badge-neutral';
            if (data.status === 'New') statusClass = 'badge-warning'; // Or success depending on preference
            if (data.status === 'Resolved') statusClass = 'badge-success';

            return `
                <tr>
                    <td style="font-weight:600;">${data.customerName || 'Anonymous'}</td>
                    <td style="color:#fbbf24; letter-spacing:2px;">${stars}</td>
                    <td style="color:#6b7280; max-width:300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                        ${data.message || ''}
                    </td>
                    <td>${date}</td>
                    <td><span class="badge ${statusClass}">${data.status || 'New'}</span></td>
                    <td><button class="btn" onclick="openReplyModal('${doc.id}', '${data.customerName}', '${data.message?.replace(/'/g, "\\'")}', ${data.rating})" style="padding:6px 12px; font-size:12px; border:1px solid #e5e7eb;">Reply</button></td>
                </tr>
            `;
        }).join('');
        
    } catch (err) {
        console.error(err);
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:red;">Error loading data.</td></tr>';
    }
}
