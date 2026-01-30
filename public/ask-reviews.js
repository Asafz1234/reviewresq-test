import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { httpsCallable, getFunctions } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';
import { getFirestore, collection, query, where, getDocs, orderBy, limit, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { auth } from './firebase-config.js';

let businessId = null;
let selectedChannel = 'Email';
const db = getFirestore();
const functions = getFunctions();

document.addEventListener('DOMContentLoaded', () => {
    onAuthStateChanged(auth, user => {
        if (user) {
            businessId = user.uid;
            renderPage();
            fetchHistory(); // REAL DATA ONLY
        }
    });
});

function renderPage() {
    const container = document.getElementById('ask-reviews-content');
    if (!container) return;

    container.innerHTML = `
        <div class="request-container">
            <div class="card">
                <div class="card-header">Compose Request</div>
                <div class="card-body">
                    <form id="ask-review-form">
                        <div class="form-group">
                            <label>Channel</label>
                            <div class="channel-select">
                                <div class="channel-option selected" onclick="selectChannel(this, 'Email')">Email</div>
                                <div class="channel-option" onclick="selectChannel(this, 'SMS')">SMS</div>
                                <div class="channel-option" onclick="selectChannel(this, 'WhatsApp')">WhatsApp</div>
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Customer Name</label>
                            <input type="text" id="customer-name" placeholder="John Doe" required>
                        </div>
                        <div class="form-group">
                            <label>Email Address</label>
                            <input type="email" id="customer-email" placeholder="john@example.com">
                        </div>
                        <div class="form-group">
                            <label>Phone Number</label>
                            <input type="tel" id="customer-phone" placeholder="+1 (555) 000-0000">
                        </div>
                        <div class="form-actions" style="margin-top: 24px;">
                            <button type="submit" class="btn btn-primary" id="send-request-btn" style="width:100%">Send Request</button>
                        </div>
                    </form>
                </div>
            </div>

            <div class="card">
                <div class="card-header">Bulk Import</div>
                <div class="card-body" style="text-align:center;">
                    <p style="font-size:14px; color:#6b7280; margin-bottom:20px;">Upload a CSV with Name, Email, and Phone columns.</p>
                    <div class="bulk-upload-area">
                        <p style="margin:0;">Drag CSV here</p>
                    </div>
                    <button class="btn" style="margin-top:16px; border:1px solid #e5e7eb;">Download Template</button>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-header">Recent Activity</div>
            <div class="table-wrapper">
                <table class="table">
                    <thead><tr><th>Customer</th><th>Channel</th><th>Status</th><th>Date</th></tr></thead>
                    <tbody id="history-table-body"></tbody>
                </table>
            </div>
        </div>
    `;
    
    // Attach Logic
    window.selectChannel = (el, channel) => {
        document.querySelectorAll('.channel-option').forEach(d => d.classList.remove('selected'));
        el.classList.add('selected');
        selectedChannel = channel;
    };

    document.getElementById('ask-review-form').addEventListener('submit', handleSend);
}

async function handleSend(e) {
    e.preventDefault();
    const btn = document.getElementById('send-request-btn');
    btn.textContent = 'Sending...';
    btn.disabled = true;

    const name = document.getElementById('customer-name').value;
    const email = document.getElementById('customer-email').value;
    const phone = document.getElementById('customer-phone').value;

    try {
        // 1. Save to Firestore (Real Record)
        await addDoc(collection(db, `businesses/${businessId}/outboundRequests`), {
            customerName: name,
            customerEmail: email,
            customerPhone: phone,
            channel: selectedChannel,
            status: 'Sent',
            timestamp: serverTimestamp()
        });

        // 2. Trigger Cloud Function (if email)
        if (selectedChannel === 'Email' && email) {
            const sendEmail = httpsCallable(functions, 'sendReviewRequestEmail');
            await sendEmail({ businessId, customerEmail: email, customerName: name });
        }

        alert('Request Sent Successfully!');
        e.target.reset();
        fetchHistory(); // Refresh table
    } catch (err) {
        console.error(err);
        alert('Error sending request.');
    } finally {
        btn.textContent = 'Send Request';
        btn.disabled = false;
    }
}

async function fetchHistory() {
    const tbody = document.getElementById('history-table-body');
    const q = query(collection(db, `businesses/${businessId}/outboundRequests`), orderBy('timestamp', 'desc'), limit(10));
    
    try {
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px;">No requests sent yet.</td></tr>';
            return;
        }
        tbody.innerHTML = snapshot.docs.map(doc => {
            const d = doc.data();
            const date = d.timestamp ? new Date(d.timestamp.seconds * 1000).toLocaleDateString() : 'Just now';
            return `<tr>
                <td>${d.customerName}</td>
                <td>${d.channel}</td>
                <td><span class="badge badge-success">${d.status}</span></td>
                <td>${date}</td>
            </tr>`;
        }).join('');
    } catch (err) {
        console.error(err);
    }
}
