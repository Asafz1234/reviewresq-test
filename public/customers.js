import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, onSnapshot, addDoc, doc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth } from "./firebase-config.js";

const db = getFirestore();
let currentUser = null;

document.addEventListener("DOMContentLoaded", () => {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            currentUser = user;
            loadCustomers();
        } else {
            document.getElementById('customers-content').innerHTML = `<p>Please log in to see customers.</p>`;
        }
    });

    const addCustomerForm = document.getElementById('add-customer-form');
    addCustomerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('customerName').value;
        const email = document.getElementById('customerEmail').value;
        const phone = document.getElementById('customerPhone').value;
        
        if (currentUser && name && (email || phone)) {
            await addDoc(collection(db, "users", currentUser.uid, "customers"), {
                name,
                email,
                phone,
                status: "Pending",
                addedDate: serverTimestamp()
            });
            addCustomerForm.reset();
            const modal = bootstrap.Modal.getInstance(document.getElementById('addCustomerModal'));
            modal.hide();
        }
    });
});

function loadCustomers() {
    const customersCollection = collection(db, "users", currentUser.uid, "customers");
    onSnapshot(customersCollection, (snapshot) => {
        const container = document.getElementById('customers-content');
        if (snapshot.empty) {
            renderEmptyState(container);
        } else {
            renderCustomerTable(container, snapshot.docs);
        }
    });
}

function renderEmptyState(container) {
    container.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-users fa-4x text-light mb-3"></i>
            <h5 class="fw-bold">Add your first customer</h5>
            <p class="text-muted">Manually add customers to send them review requests.</p>
            <button class="btn btn-primary mt-2" data-bs-toggle="modal" data-bs-target="#addCustomerModal">
                Add Customer
            </button>
        </div>
    `;
}

function renderCustomerTable(container, docs) {
    const tableRows = docs.map(doc => {
        const data = doc.data();
        const id = doc.id;
        const addedDate = data.addedDate?.toDate().toLocaleDateString() || 'N/A';
        const statusBadge = data.status === 'Review Sent' ? 
            `<span class="badge bg-success bg-opacity-10 text-success">Review Sent</span>` :
            `<span class="badge bg-warning bg-opacity-10 text-warning">Pending</span>`;

        return `
            <tr>
                <td class="fw-bold">${data.name}</td>
                <td>${data.email || data.phone}</td>
                <td>${addedDate}</td>
                <td>${statusBadge}</td>
                <td>
                    <button class="btn btn-sm btn-outline-secondary" onclick="window.deleteCustomer('${id}')">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <div class="card border-0 shadow-sm">
            <div class="card-body">
                <table class="table table-hover align-middle">
                    <thead class="bg-light">
                        <tr>
                            <th>Name</th>
                            <th>Contact</th>
                            <th>Added Date</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>
        </div>
    `;
}

window.deleteCustomer = async (id) => {
    if (confirm("Are you sure you want to delete this customer?")) {
        await deleteDoc(doc(db, "users", currentUser.uid, "customers", id));
    }
};