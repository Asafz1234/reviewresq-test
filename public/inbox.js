
import { db } from "./firebase-config.js";
import { collection, query, getDocs, orderBy, doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- Toast Notification ---
function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast visible';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => document.body.removeChild(toast), 300);
    }, 2500);
}


// --- State Management ---
let allFeedback = [];
let currentFilter = 'all';
let searchTerm = '';

// --- DOM Elements ---
const listContainer = document.getElementById('feedback-list-container');
const detailContainer = document.getElementById('feedback-detail-container');
const searchInput = document.getElementById('search-input');
const filterBar = document.getElementById('filter-bar');

// --- Stat Elements ---
const statsAvgRating = document.getElementById('stats-avg-rating');
const statsUnresolved = document.getElementById('stats-unresolved');
const statsTotal = document.getElementById('stats-total');

async function loadInbox() {
    if (!listContainer) return;

    try {
        const feedbackRef = collection(db, "feedback");
        const q = query(feedbackRef, orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        
        allFeedback = snap.docs.map((doc, i) => ({
            id: doc.id,
            ...doc.data(),
        }));
        
        setupControls();
        updateStats();
        filterAndRender();
        
        if (allFeedback.length > 0) {
            showDetail(allFeedback[0].id);
        }

    } catch (e) {
        console.error("Error loading feedback:", e);
        if(listContainer) listContainer.innerHTML = '<div class="p-4 text-danger">Error loading data.</div>';
    }
}

function setupControls() {
    filterBar.innerHTML = `
        <button class="btn btn-subtle btn-sm active" data-filter="all">All</button>
        <button class="btn btn-subtle btn-sm" data-filter="positive">Positive</button>
        <button class="btn btn-subtle btn-sm" data-filter="negative">Negative</button>
    `;
    filterBar.addEventListener('click', (e) => {
        if (e.target.matches('[data-filter]')) {
            currentFilter = e.target.dataset.filter;
            filterBar.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');
            filterAndRender();
        }
    });

    searchInput.addEventListener('input', (e) => {
        searchTerm = e.target.value.toLowerCase();
        filterAndRender();
    });
}

function updateStats() {
    const total = allFeedback.length;
    const unresolved = allFeedback.filter(f => f.status !== 'resolved').length;
    const avgRating = total > 0 ? (allFeedback.reduce((sum, f) => sum + f.rating, 0) / total).toFixed(2) : '0.00';

    if(statsTotal) statsTotal.textContent = total;
    if(statsUnresolved) statsUnresolved.textContent = unresolved;
    if(statsAvgRating) statsAvgRating.innerHTML = `${avgRating} <span class="text-warning">★</span>`;
}

function filterAndRender() {
    let filtered = allFeedback;

    if (currentFilter === 'positive') filtered = filtered.filter(f => f.rating >= 4);
    if (currentFilter === 'negative') filtered = filtered.filter(f => f.rating <= 3);

    if (searchTerm) {
        filtered = filtered.filter(f => 
            (f.customerName || '').toLowerCase().includes(searchTerm) || 
            (f.comment || '').toLowerCase().includes(searchTerm)
        );
    }
    
    renderList(filtered);
}

function renderList(data) {
    if (!listContainer) return;
    listContainer.innerHTML = '';
    
    if (data.length === 0) {
        listContainer.innerHTML = '<div class="p-4 text-muted text-center">No feedback matches your criteria.</div>';
        return;
    }

    data.forEach(item => {
        const date = item.createdAt?.toDate ? item.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Recent';
        const el = document.createElement('div');
        el.className = 'feedback-item';
        el.id = `item-${item.id}`;
        el.dataset.id = item.id;
        el.innerHTML = `
            <div class="d-flex justify-content-between">
                <span class="font-weight-bold">${item.customerName || 'Anonymous'}</span>
                <span class="badge badge-light">${item.source || 'via Web'}</span>
            </div>
            <div class="small text-muted mt-1">${'★'.repeat(item.rating)}${'☆'.repeat(5 - item.rating)} · ${date}</div>
            <p class="comment-preview mt-2 mb-0">${(item.comment || '').substring(0, 75)}...</p>
        `;
        el.addEventListener('click', () => showDetail(item.id));
        listContainer.appendChild(el);
    });
}

function showDetail(id) {
    const item = allFeedback.find(f => f.id === id);
    if (!detailContainer) return;

    document.querySelectorAll('.feedback-item').forEach(el => el.classList.remove('active'));
    const activeItem = document.getElementById(`item-${id}`);
    if (activeItem) {
        activeItem.classList.add('active');
    }

    if (!item) {
        detailContainer.innerHTML = '<div class="empty-detail-state">...</div>';
        return;
    }

    detailContainer.innerHTML = `
        <div class="detail-view" data-id="${id}">
            <div class="d-flex align-items-center mb-4">
                <div class="avatar large">${item.customerName?.charAt(0) || 'A'}</div>
                <div class="ml-3 flex-grow-1">
                    <h4 class="mb-0">${item.customerName || 'Anonymous'}</h4>
                    <p class="text-muted mb-0">${item.customerEmail || 'No email'}</p>
                </div>
            </div>

            <h6 class="text-muted font-weight-bold">Feedback</h6>
            <div class="speech-bubble mb-4">
                <p class="mb-0">${item.comment || 'No comment provided.'}</p>
                <div class="text-muted small mt-2">Rating: ${item.rating}/5 ★</div>
            </div>

            <h6 class="text-muted font-weight-bold">Internal Notes</h6>
            <div class="internal-notes mb-4">
                <textarea id="internal-notes-textarea" placeholder="Add a note for your team...">${item.internalNotes || ''}</textarea>
            </div>

            <div class="detail-actions mt-auto">
                <button class="btn btn-primary" id="reply-btn"><span>✍️</span> Reply</button>
                <button class="btn btn-outline ml-2" id="resolve-btn"><span>✅</span> Mark Resolved</button>
            </div>
        </div>
    `;

    // Add event listeners for actions
    document.getElementById('resolve-btn').addEventListener('click', () => markAsResolved(id));
    document.getElementById('internal-notes-textarea').addEventListener('blur', (e) => saveInternalNote(id, e.target.value));
    document.getElementById('reply-btn').addEventListener('click', () => showReplyModal(id));
}

async function markAsResolved(id) {
    const feedbackRef = doc(db, 'feedback', id);
    await updateDoc(feedbackRef, { status: 'resolved', updatedAt: serverTimestamp() });

    const item = allFeedback.find(f => f.id === id);
    if(item) item.status = 'resolved';
    
    updateStats();
    showToast('Feedback marked as resolved.');
}

async function saveInternalNote(id, text) {
    if (!id) return;
    const feedbackRef = doc(db, 'feedback', id);
    await updateDoc(feedbackRef, { internalNotes: text, updatedAt: serverTimestamp() });

    const item = allFeedback.find(f => f.id === id);
    if(item) item.internalNotes = text;

    showToast('Internal note saved.');
}

function showReplyModal(id) {
    const item = allFeedback.find(f => f.id === id);
    if (!item) return;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <h4 class="mb-2">Reply to ${item.customerName}</h4>
            <textarea class="modal-textarea" placeholder="Type your message..."></textarea>
            <div class="modal-actions">
                <button class="btn btn-primary" id="send-reply">Send</button>
                <button class="btn btn-outline" id="cancel-reply">Cancel</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('send-reply').addEventListener('click', () => {
        const message = modal.querySelector('.modal-textarea').value;
        console.log(`Replying to ${item.id}: ${message}`);
        showToast('Reply sent (logged to console).');
        document.body.removeChild(modal);
    });

    document.getElementById('cancel-reply').addEventListener('click', () => {
        document.body.removeChild(modal);
    });
}

document.addEventListener('DOMContentLoaded', loadInbox);
