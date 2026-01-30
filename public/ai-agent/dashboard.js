import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Global App State
let currentUser = null;
let currentLogoData = null;

// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", () => {
    console.log("Dashboard Starting...");
    try {
        emailjs.init("Sl1qarLObRNgMRpcq");
        console.log("EmailJS Ready");
    } catch(e) { console.error("EmailJS Error:", e); }
});

// --- FIREBASE AUTH ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        console.log("User Logged In:", user.uid);
        
        // Update UI Header
        const nameEl = document.getElementById("ui-name");
        const avatarEl = document.getElementById("ui-avatar");
        if(nameEl) nameEl.innerText = user.displayName || "User";
        if(avatarEl) avatarEl.innerText = (user.displayName || "U")[0].toUpperCase();
        
        // Load Data
        loadDashboardData(user.uid);
    } else {
        window.location.href = "index.html";
    }
});

// --- CORE FUNCTIONS ---
window.app = {
    // 1. Navigation
    nav: (sectionId) => {
        document.querySelectorAll('.view-section').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        
        const target = document.getElementById(`sec-${sectionId}`);
        if(target) target.style.display = 'block';
        
        event.currentTarget.classList.add('active');
    },

    // 2. Settings Tabs
    tab: (tabName) => {
        document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.tab-link').forEach(el => el.classList.remove('active'));
        
        document.getElementById(`tab-${tabName}`).style.display = 'block';
        event.currentTarget.classList.add('active');
    },

    // 3. Logout
    logout: () => {
        signOut(auth).then(() => window.location.href = "index.html");
    },

    // 4. Logo Handling
    handleLogo: () => {
        const file = document.getElementById('inp-logo').files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                currentLogoData = e.target.result;
                document.getElementById('preview-logo').innerHTML = `<img src="${currentLogoData}">`;
            };
            reader.readAsDataURL(file);
        }
    },

    // 5. Save Settings
    saveSettings: async () => {
        if (!currentUser) return;
        const btn = document.querySelector('#tab-business .btn-primary');
        const oldText = btn.innerText;
        btn.innerText = "Saving...";

        try {
            await setDoc(doc(db, "businesses", currentUser.uid), {
                businessName: document.getElementById('inp-biz-name').value,
                googleLink: document.getElementById('inp-biz-link').value,
                logo: currentLogoData,
                uid: currentUser.uid,
                email: currentUser.email
            }, { merge: true });
            
            alert("Settings Saved!");
        } catch (e) {
            console.error("Save Error:", e);
            alert("Failed to save settings.");
        } finally {
            btn.innerText = oldText;
        }
    },

    // 6. Send Email
    sendInvite: async () => {
        if (!currentUser) return;
        
        const nameInput = document.getElementById('inp-invite-name');
        const emailInput = document.getElementById('inp-invite-email');
        const statusBox = document.getElementById('msg-invite-status');
        const btn = document.getElementById('btn-send-invite');

        if (!nameInput.value || !emailInput.value) {
            alert("Please fill in Name and Email.");
            return;
        }

        const originalBtn = btn.innerHTML;
        btn.innerHTML = 'Sending...';
        statusBox.innerText = "";

        let senderName = document.getElementById('inp-biz-name').value;
        if (!senderName) senderName = currentUser.displayName || "ReviewResQ User";

        const emailParams = {
            to_name: nameInput.value,
            to_email: emailInput.value,
            from_name: senderName,
            review_link: `https://reviewresq-app.web.app/review.html?uid=${currentUser.uid}`
        };

        try {
            await emailjs.send("service_h7067gh", "template_zeoo6ej", emailParams);
            
            statusBox.innerHTML = '<span style="color:green">✅ Invitation Sent!</span>';
            
            // Increment local and DB
            incrementStat('stat-invites');
            await addCustomerToDB(nameInput.value, emailInput.value);

            nameInput.value = "";
            emailInput.value = "";
            
            setTimeout(() => statusBox.innerHTML = "", 3000);

        } catch (error) {
            console.error("EmailJS Failed:", error);
            statusBox.innerHTML = '<span style="color:red">❌ Failed. Check console.</span>';
        } finally {
            btn.innerHTML = originalBtn;
        }
    },

    // 7. Copy Link
    copyLink: () => {
        if (!currentUser) return;
        const link = `https://reviewresq-app.web.app/review.html?uid=${currentUser.uid}`;
        navigator.clipboard.writeText(link);
        alert("Link copied!");
    }
};

// --- DATA LOADER (DEEP SEARCH VERSION) ---
async function loadDashboardData(uid) {
    try {
        const docRef = doc(db, "businesses", uid);
        const snap = await getDoc(docRef);
        
        if (snap.exists()) {
            let data = snap.data();
            console.log("Raw Data Loaded:", data);

            // --- DEEP SEARCH STRATEGY ---
            // 1. Look for stats in Root
            let total = data.totalReviews;
            let rating = data.avgRating;
            
            // 2. If missing, Look inside googleBusinessProfile
            if (total === undefined && data.googleBusinessProfile) {
                console.log("Checking Google Profile for stats...");
                total = data.googleBusinessProfile.userReviewCount || data.googleBusinessProfile.reviewCount || 0;
                rating = data.googleBusinessProfile.averageRating || data.googleBusinessProfile.rating || 0.0;
            }

            // 3. Fallback to 0
            if (total === undefined) total = 0;
            if (rating === undefined) rating = 0.0;
            let invites = data.invitesSent || 0;

            // --- UPDATE UI ---
            document.getElementById('stat-total').innerText = total;
            document.getElementById('stat-rating').innerText = rating;
            document.getElementById('stat-invites').innerText = invites;

            // Update Settings Inputs
            if(data.businessName) document.getElementById('inp-biz-name').value = data.businessName;
            if(data.googleLink) document.getElementById('inp-biz-link').value = data.googleLink;
            if(data.logo) {
                currentLogoData = data.logo;
                document.getElementById('preview-logo').innerHTML = `<img src="${data.logo}">`;
            }

            // Load Customers Table
            if(data.customers && data.customers.length > 0) {
                renderCustomers(data.customers);
            }

            // --- SYNC BACK TO DB (Fix Missing Fields) ---
            if (data.totalReviews === undefined) {
                console.log("Syncing found stats to root level...");
                await updateDoc(docRef, {
                    totalReviews: total,
                    avgRating: rating,
                    invitesSent: invites
                });
            }

        } else {
            console.log("No User Doc Found. Creating new...");
            await setDoc(docRef, {
                totalReviews: 0,
                avgRating: 0.0,
                invitesSent: 0,
                uid: uid,
                customers: []
            }, { merge: true });
            loadDashboardData(uid);
        }
    } catch (e) {
        console.error("Data Load Error:", e);
    }
}

// --- HELPERS ---
function incrementStat(id) {
    const el = document.getElementById(id);
    let val = parseInt(el.innerText) || 0;
    el.innerText = val + 1;
}

async function addCustomerToDB(name, email) {
    if(!currentUser) return;
    const newCustomer = {
        name: name,
        email: email,
        status: 'Sent',
        date: new Date().toLocaleDateString()
    };

    const tbody = document.getElementById('customers-list');
    if(tbody.innerHTML.includes("No customers")) tbody.innerHTML = "";
    
    const tr = `<tr>
        <td>${name}</td>
        <td>${email}</td>
        <td><span style="color:#10b981;">Sent</span></td>
        <td>${newCustomer.date}</td>
    </tr>`;
    tbody.innerHTML += tr;

    try {
        const docRef = doc(db, "businesses", currentUser.uid);
        await updateDoc(docRef, {
            customers: arrayUnion(newCustomer),
            invitesSent: parseInt(document.getElementById('stat-invites').innerText)
        });
    } catch(e) { console.error("Error saving customer", e); }
}

function renderCustomers(customers) {
    const tbody = document.getElementById('customers-list');
    if(!customers || customers.length === 0) return;
    
    tbody.innerHTML = "";
    customers.forEach(c => {
        const tr = `<tr>
            <td>${c.name}</td>
            <td>${c.email}</td>
            <td>${c.status || 'Sent'}</td>
            <td>${c.date || '-'}</td>
        </tr>`;
        tbody.innerHTML += tr;
    });
}