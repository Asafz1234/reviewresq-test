import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, collection, getDocs, query, where, orderBy, getDoc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

let tokenClient;
let currentUID;

document.addEventListener('DOMContentLoaded', () => {
    onAuthStateChanged(auth, user => {
        if (user) {
            currentUID = user.uid;
            initGoogleTokenClient();
            checkConnectionStatus();
            loadGoogleReviewsDashboard(user.uid);
            
            document.getElementById('sync-google-btn').addEventListener('click', () => syncGoogleReviews(user.uid));
            document.getElementById('connect-gbp-btn').addEventListener('click', () => tokenClient.requestAccessToken());
            document.getElementById('disconnect-gbp-btn').addEventListener('click', disconnectGoogle);

        } else {
            window.location.href = '/index.html';
        }
    });
});

function initGoogleTokenClient() {
    if (typeof google === 'undefined' || !google.accounts) {
        console.log("Google library not loaded yet. Retrying in 500ms...");
        setTimeout(initGoogleTokenClient, 500);
        return;
    }
    try {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: '863497920392-f3nlicjmee2lomrrh9oihglc0a7tlsq2.apps.googleusercontent.com',
            scope: 'https://www.googleapis.com/auth/business.manage',
            callback: handleGoogleTokenResponse,
        });
        console.log("Google Token Client initialized successfully.");
    } catch (error) {
        console.error("Error initializing Google Token Client:", error);
    }
}

async function handleGoogleTokenResponse(tokenResponse) {
    if (tokenResponse && tokenResponse.access_token) {
        localStorage.setItem('google_access_token', tokenResponse.access_token);
        
        // Show temporary state
        updateConnectionUI(true, { 
            name: "🔍 Connecting...", 
            email: "Scanning for business profile...", 
            picture: localStorage.getItem('google_user_avatar') 
        });

        // Fetch Business Profile Data
        await fetchBusinessLocations(tokenResponse.access_token);
    }
}

async function fetchBusinessLocations(accessToken) {
    try {
        console.log("Step 1: Fetching Accounts...");
        const accountsResp = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const accountsData = await accountsResp.json();
        
        if (!accountsData.accounts || accountsData.accounts.length === 0) {
            throw new Error("No Google Business accounts found.");
        }

        let foundLocation = null;

        // Loop through ALL accounts to find a location
        for (const account of accountsData.accounts) {
            console.log(`Checking account: ${account.name}`);
            const locResp = await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title,metadata`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            const locData = await locResp.json();

            if (locData.locations && locData.locations.length > 0) {
                // Filter for verified or first available
                foundLocation = locData.locations.find(l => l.metadata?.locationState?.isVerified) || locData.locations[0];
                if (foundLocation) break; // Stop if we found one
            }
        }

        if (foundLocation) {
            console.log("SUCCESS! Found Location:", foundLocation);
            
            // Save to Firestore
            const businessDocRef = doc(db, "businesses", currentUID);
            await updateDoc(businessDocRef, {
                businessName: foundLocation.title,
                googleLocationId: foundLocation.name,
                isGoogleConnected: true
            });

            // Update UI with REAL Business Name
            document.getElementById('business-name').textContent = `Managing: ${foundLocation.title}`;
            document.getElementById('user-email').textContent = "Business Profile Connected";
            
        } else {
            console.warn("No locations found in any account.");
            alert("Connected to Google, but no Business Profiles were found in this account.");
            // Fallback to user info
            const email = localStorage.getItem('google_user_email');
            document.getElementById('business-name').textContent = "Connected (No Business Found)";
            document.getElementById('user-email').textContent = email;
        }

    } catch (error) {
        console.error("Error fetching business:", error);
        document.getElementById('user-email').textContent = "Error: " + error.message;
    }
}

function checkConnectionStatus() {
    const accessToken = localStorage.getItem('google_access_token');
    const userEmail = localStorage.getItem('google_user_email');
    if (accessToken && userEmail) {
        const userInfo = {
            name: localStorage.getItem('google_user_name'),
            email: userEmail,
            picture: localStorage.getItem('google_user_avatar')
        };
        updateConnectionUI(true, userInfo);
        // If connected, also try to fetch and display the linked business name
        getDoc(doc(db, "businesses", currentUID)).then(docSnap => {
            if (docSnap.exists() && docSnap.data().googleBusinessProfile) {
                document.getElementById('business-name').textContent = `Managing: ${docSnap.data().googleBusinessProfile.businessName}`;
            }
        });

    } else {
        updateConnectionUI(false);
    }
}

function disconnectGoogle() {
    const token = localStorage.getItem('google_access_token');
    if (token) {
        google.accounts.oauth2.revoke(token, () => {
            console.log('Google token revoked.');
        });
    }
    
    localStorage.removeItem('google_access_token');
    localStorage.removeItem('google_user_email');
    localStorage.removeItem('google_user_name');
    localStorage.removeItem('google_user_avatar');

    if (currentUID) {
        const businessDocRef = doc(db, "businesses", currentUID);
        updateDoc(businessDocRef, {
            isGoogleConnected: false,
            googleAccount: {},
            googleBusinessProfile: {} // Clear business profile data
        });
    }

    updateConnectionUI(false);
}

function updateConnectionUI(isConnected, userInfo = {}) {
    const disconnectedView = document.getElementById('disconnected-view');
    const connectedView = document.getElementById('connected-view');

    if (isConnected) {
        disconnectedView.classList.add('d-none');
        connectedView.classList.remove('d-none');
        document.getElementById('business-name').textContent = userInfo.name || 'Business Profile';
        document.getElementById('user-email').textContent = userInfo.email;
        document.getElementById('user-avatar').src = userInfo.picture || '';
    } else {
        disconnectedView.classList.remove('d-none');
        connectedView.classList.add('d-none');
    }
}

async function loadGoogleReviewsDashboard(uid) {
    const contentArea = document.getElementById('google-reviews-content');
    contentArea.innerHTML = renderLoadingSpinner();

    try {
        if (!db || !auth) throw new Error("Firebase not initialized");

        const [interceptedResult, generatedResult, googleReviewsResult] = await Promise.all([
            getDocs(query(collection(db, "feedback"), where("businessId", "==", uid), where("rating", "<=", 3))),
            getDocs(query(collection(db, "feedback"), where("businessId", "==", uid), where("rating", ">=", 4))),
            getDocs(query(collection(db, "businesses", uid, "google_reviews"), orderBy("review_creation_timestamp", "desc")))
        ]);

        const interceptedCount = interceptedResult.size;
        const generatedCount = generatedResult.size;
        
        let googleReviews = [];
        googleReviewsResult.forEach(doc => googleReviews.push(doc.data()));

        const totalReviews = googleReviews.length;
        const totalRating = googleReviews.reduce((acc, r) => acc + (r.rating || 0), 0);
        const avgRating = totalReviews > 0 ? (totalRating / totalReviews).toFixed(1) : "N/A";

        const stats = {
            totalReviews,
            generatedCount,
            interceptedCount,
            avgRating
        };
        
        contentArea.innerHTML = `
            ${renderRoiMetrics(stats)}
            ${renderReviewsTable(googleReviews)}
        `;

    } catch (error) {
        console.error("CRITICAL LOAD ERROR:", error);
        const container = document.getElementById('google-reviews-content') || document.body;
        if (error.message.includes("index") || error.code === "failed-precondition") {
            container.innerHTML = `<div class="alert alert-warning m-4">...</div>`;
        } else {
            container.innerHTML = `<div class="alert alert-danger m-4">...</div>`;
        }
    }
}

async function syncGoogleReviews(uid) {
    console.log("Simulating Google Business Profile Sync...");
    alert("Fetching latest reviews from Google...");
    await loadGoogleReviewsDashboard(uid);
    console.log("Sync simulation complete.");
}

function renderRoiMetrics(stats) {
    return `
    <div class="row mb-4">...</div>
    `;
}

function renderReviewsTable(reviews) {
    const tableBody = reviews.map(r => {
        return `<tr>...</tr>`;
    }).join('');

    return `
    <div class="card border-0 shadow-sm">...</div>`;
}

function renderLoadingSpinner() {
    return `<div class="d-flex justify-content-center align-items-center p-5"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div></div>`;
}
