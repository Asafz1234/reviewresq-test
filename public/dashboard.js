
window.addEventListener('load', () => {
    // LEVEL 1: GLOBAL PROTECTION
    try {
        const auth = firebase.auth();
        const db = firebase.firestore();

        console.log("🛡️ MAXIMUM SECURITY DASHBOARD ACTIVE");

        // UTILITY: ISOLATED RENDERING
        const safeRender = (componentName, renderFn) => {
            try {
                renderFn();
            } catch (e) {
                console.error(`⚠️ UI PARTIAL FAILURE: [${componentName}] crashed.`, e);
            }
        };

        window.app = {
            showSection: (id) => {
                safeRender("Navigation", () => {
                    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
                    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
                    const sec = document.getElementById('sec-' + id);
                    const nav = document.getElementById('nav-' + id);
                    if(sec) sec.classList.add('active');
                    if(nav) nav.classList.add('active');

                    // Load tracking table when its section is shown
                    if (id === 'ask-reviews') {
                        window.app.loadTrackingTable();
                    }
                });
            },
            logout: () => auth.signOut().then(() => window.location.href = "index.html"),
            refreshData: () => {
                try {
                    console.log("🔄 Triggering manual state refresh...");
                    location.reload();
                } catch(e) { 
                    console.error("Refresh Module Failure:", e);
                    alert("Unable to refresh: " + e.message);
                }
            },
            
            // --- ASK REVIEWS MODULE ---
            
            switchTab: (mode) => {
                safeRender('Tab Switch', () => {
                    document.getElementById('mode-single').style.display = mode === 'single' ? 'block' : 'none';
                    document.getElementById('mode-bulk').style.display = mode === 'bulk' ? 'block' : 'none';
                    
                    const btnSingle = document.getElementById('tab-single');
                    const btnBulk = document.getElementById('tab-bulk');
                    
                    if(mode === 'single') {
                        btnSingle.style.background = '#2563eb'; btnSingle.style.color = 'white';
                        btnBulk.style.background = '#cbd5e1'; btnBulk.style.color = '#334155';
                    } else {
                        btnBulk.style.background = '#2563eb'; btnBulk.style.color = 'white';
                        btnSingle.style.background = '#cbd5e1'; btnSingle.style.color = '#334155';
                    }
                });
            },

            downloadTemplate: () => {
                const csvContent = "data:text/csv;charset=utf-8,Full Name,Email Address\\nJohn Doe,john@example.com\\nJane Smith,jane@test.com";
                const encodedUri = encodeURI(csvContent);
                const link = document.createElement("a");
                link.setAttribute("href", encodedUri);
                link.setAttribute("download", "review_request_template.csv");
                document.body.appendChild(link);
                link.click();
            },

            processBulk: () => {
                alert("Bulk Upload Logic ready! (Backend integration pending)");
            },

            // --- DATA FETCHING ---
            loadTrackingTable: async () => {
                const tableBody = document.getElementById('tracking-table');
                if(!tableBody || !auth.currentUser) return;

                try {
                    tableBody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:20px;">Refreshing data...</td></tr>';
                    
                    const snapshot = await db.collection('businesses').doc(auth.currentUser.uid)
                                           .collection('invites')
                                           .orderBy('dateSent', 'desc')
                                           .limit(5)
                                           .get();

                    if(snapshot.empty) {
                        tableBody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:20px; color:#94a3b8;">No requests sent yet. Try sending one!</td></tr>';
                        return;
                    }

                    let html = '';
                    snapshot.forEach(doc => {
                        const data = doc.data();
                        let badgeColor = '#94a3b8'; // default gray

                        if(data.status === 'pending') badgeColor = '#f59e0b'; // Yellow - "Awaiting Server"
                        if(data.status === 'sent') badgeColor = '#3b82f6'; // Blue - "Out for Delivery"
                        if(data.status === 'error') badgeColor = '#ef4444'; // Red - "Invalid Email/Failed"

                        // Keep existing statuses for later in the funnel
                        if(data.status === 'opened') badgeColor = '#3b82f6'; 
                        if(data.status === 'clicked') badgeColor = '#f59e0b';
                        if(data.status === 'reviewed') badgeColor = '#10b981';

                        const dateStr = data.dateSent ? new Date(data.dateSent.seconds * 1000).toLocaleDateString() : 'N/A';

                        html += `
                            <tr style="border-bottom:1px solid #f1f5f9;">
                                <td style="padding:12px;">${data.name || 'Unknown'}<br><span style="font-size:0.8em; color:#64748b;">${data.email}</span></td>
                                <td style="padding:12px;">${dateStr}</td>
                                <td style="padding:12px;"><span style="background:${badgeColor}; color:white; padding:2px 8px; border-radius:12px; font-size:0.75rem; text-transform:uppercase;">${data.status}</span></td>
                            </tr>
                        `;
                    });
                    tableBody.innerHTML = html;

                } catch(e) {
                    console.error("Table Load Error:", e);
                    tableBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:red; padding:20px;">Sync Error: ${e.message}</td></tr>`;
                }
            },

            updatePlan: async () => {
                try {
                    const plan = document.getElementById('set-plan-selector').value;
                    if(auth.currentUser) {
                        await db.collection("businesses").doc(auth.currentUser.uid).update({ plan: plan });
                        alert("✅ Success! Plan updated to: " + plan.toUpperCase());
                        location.reload(); 
                    }
                } catch(e) { 
                    console.error("Plan Update Error:", e);
                    alert("Update failed: " + e.message); 
                }
            },

            connectGoogle: () => {
                document.getElementById('google-status').style.display = 'block';
                setTimeout(() => alert("Google Connected!"), 1000);
            },

            // IRON DOME: Send & Save Logic (With Validation)
            sendInvite: async () => {
                const nameInp = document.getElementById('inp-name');
                const emailInp = document.getElementById('inp-email');
                
                const name = nameInp.value.trim();
                const email = emailInp.value.trim();
                
                // 1. Strict Validation Logic
                if(!name || !email) {
                    alert("⚠️ Please fill in both Name and Email.");
                    return;
                }

                // Email Regex Check (Must have @, domain, and extension)
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(email)) {
                    alert("❌ Error: Invalid email format.\\nPlease check for typos or missing '@'.");
                    emailInp.style.border = "2px solid red";
                    return;
                } else {
                    emailInp.style.border = "1px solid #ddd"; // Reset style
                }
                
                // TODO: Integration required with Firebase Cloud Functions + SendGrid API 
                // to transition status from 'pending' -> 'sent' -> 'delivered'.
                try {
                    const btn = document.querySelector('button[onclick*="sendInvite"]');
                    const originalText = btn ? btn.innerText : 'Send';
                    if(btn) btn.innerText = "Processing...";

                    // 2. Save to Firestore
                    await db.collection('businesses').doc(auth.currentUser.uid).collection('invites').add({
                        name: name,
                        email: email,
                        dateSent: firebase.firestore.FieldValue.serverTimestamp(),
                        status: 'pending' // This reflects that it's waiting for the backend to send it
                    });

                    // 3. User Feedback
                    // Note: Real email sending requires a backend trigger (Cloud Functions + SendGrid)
                    alert(`✅ Request Saved for: ${name}\\n(Note: Real email delivery pending backend integration)`);
                    
                    nameInp.value = '';
                    emailInp.value = '';
                    
                    // Reload table
                    if(window.app.loadTrackingTable) {
                        window.app.loadTrackingTable();
                    }
                    
                    if(btn) btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send';

                } catch(e) {
                    console.error("Save Error:", e);
                    alert("❌ System Error: " + e.message);
                }
            },
        };

        // --- REALTIME LISTENER ---
        auth.onAuthStateChanged((user) => {
            if (user) {
                if(document.getElementById('user-display')) document.getElementById('user-display').innerText = user.email;

                // Initial Load for Tracking
                window.app.loadTrackingTable();

                db.collection("businesses").doc(user.uid).onSnapshot((doc) => {
                    if (!doc.exists) return;
                    
                    let data = {};
                    try { data = doc.data(); } catch(e) { console.error("Data fetch error", e); return; }

                    const customers = data.customers || [];
                    const plan = data.plan || 'starter';

                    // --- ISOLATED RENDER BLOCKS ---
                    safeRender("Stats Module", () => {
                        const reviews = customers.filter(c => c.rating !== undefined && c.rating !== null);
                        let avg = "0.0";
                        if (reviews.length > 0) {
                            const sum = reviews.reduce((acc, curr) => acc + Number(curr.rating || 0), 0);
                            avg = (sum / reviews.length).toFixed(1);
                        }
                        
                        if(document.getElementById('stat-total')) document.getElementById('stat-total').innerText = reviews.length;
                        if(document.getElementById('stat-rating')) document.getElementById('stat-rating').innerText = avg;
                        if(document.getElementById('stat-invites')) document.getElementById('stat-invites').innerText = customers.length;
                    });

                    safeRender("Overview Table", () => {
                        const crmTable = document.getElementById('crm-table');
                        if(crmTable) {
                            if (customers.length === 0) {
                                crmTable.innerHTML = "<tbody><tr><td colspan='3' style='padding:15px; color:#aaa;'>No activity yet.</td></tr></tbody>";
                            } else {
                                const recent = [...customers].reverse().slice(0, 5);
                                crmTable.innerHTML = `
                                    <thead><tr><th>NAME</th><th>STATUS</th><th>DATE</th></tr></thead>
                                    <tbody>${recent.map(c => `
                                        <tr>
                                            <td><b>${c.name}</b></td>
                                            <td><span class="badge badge-starter">${c.status}</span></td>
                                            <td>${c.date || '-'}</td>
                                        </tr>`).join('')}
                                    </tbody>`;
                            }
                        }
                    });

                    safeRender("Customer List", () => {
                        const fullList = document.getElementById('full-cust-list');
                        if(fullList) {
                            if (customers.length === 0) {
                                fullList.innerHTML = "<tr><td colspan='5' style='text-align:center;'>No customers.</td></tr>";
                            } else {
                                fullList.innerHTML = customers.map(c => `
                                    <tr>
                                        <td><b>${c.name}</b></td>
                                        <td>${c.email || '-'}</td>
                                        <td><span class="badge badge-starter">${c.status}</span></td>
                                        <td>${c.rating ? '⭐ ' + c.rating : '-'}</td>
                                        <td>${c.date || '-'}</td>
                                    </tr>
                                `).join('');
                            }
                        }
                    });

                    safeRender("Plan UI", () => {
                        const badge = document.getElementById('plan-badge');
                        if(badge) {
                            badge.innerText = plan.toUpperCase();
                            badge.className = `badge badge-${plan}`;
                        }
                        
                        const growthMenu = document.getElementById('growth-menu');
                        if(growthMenu) {
                            if (plan === 'growth') {
                                growthMenu.style.display = 'block';
                            } else {
                                growthMenu.style.display = 'none';
                            }
                        }

                        const planSelector = document.getElementById('set-plan-selector');
                        if(planSelector) {
                            planSelector.value = plan;
                        }
                    });

                }, (error) => {
                    console.error("Firestore Sync Error:", error);
                });

            } else {
                if(!window.location.href.includes('index.html')) window.location.href = "index.html";
            }
        });

    } catch (criticalError) {
        console.error("CRITICAL APP FAILURE:", criticalError);
        alert("Critical Init Error. Check console.");
    }
});

// --- STUDIO LOGIC ---

// 1. Live Preview Update
window.updatePreview = function() {
    const name = document.getElementById('studio-name').value || "Business Name";
    const color = document.getElementById('studio-color').value;
    const msg = document.getElementById('studio-msg').value;

    document.getElementById('preview-business-name').innerText = name;
    document.getElementById('preview-header').style.backgroundColor = color;
    document.getElementById('preview-msg-text').innerText = msg;
}

// 2. Save Function
window.saveStudioSettings = async function() {
    const user = firebase.auth().currentUser;
    if (!user) return alert("Please login.");

    const settings = {
        name: document.getElementById('studio-name').value,
        color: document.getElementById('studio-color').value,
        googleLink: document.getElementById('studio-link').value,
        welcomeMessage: document.getElementById('studio-msg').value
    };

    try {
        await db.collection('businesses').doc(user.uid).set({ funnel: settings }, { merge: true });
        alert("✅ Funnel Saved & Published!");
    } catch (e) {
        console.error(e);
        alert("Error: " + e.message);
    }
}

// 3. Load Function (Call this when opening the section)
window.loadFunnelSettings = async function() {
    const user = firebase.auth().currentUser;
    if (!user) return;
    
    const doc = await db.collection('businesses').doc(user.uid).get();
    if (doc.exists && doc.data().funnel) {
        const f = doc.data().funnel;
        document.getElementById('studio-name').value = f.name || "";
        document.getElementById('studio-color').value = f.color || "#000000";
        document.getElementById('studio-link').value = f.googleLink || "";
        document.getElementById('studio-msg').value = f.welcomeMessage || "How was your experience?";
        
        // Trigger update to show saved state
        updatePreview();
    }
}
