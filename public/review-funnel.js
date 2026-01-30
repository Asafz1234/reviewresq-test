import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth } from "./firebase-config.js";

const db = getFirestore();
let currentUser = null;

document.addEventListener("DOMContentLoaded", () => {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUser = user;
            loadSettings();
        } else {
            window.location.href = '/';
        }
    });

    document.getElementById('funnel-form').addEventListener('submit', saveSettings);
});

async function loadSettings() {
    try {
        const docSnap = await getDoc(doc(db, "businesses", currentUser.uid, "settings", "funnel"));
        if (docSnap.exists()) {
            const data = docSnap.data();
            document.getElementById('minRating').value = data.minRating || "4";
            document.getElementById('positiveMsg').value = data.positiveMsg || "";
            document.getElementById('negativeMsg').value = data.negativeMsg || "";
        }
    } catch (error) {
        console.error("Error loading settings:", error);
    }
}

async function saveSettings(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    btn.disabled = true;

    const settings = {
        minRating: document.getElementById('minRating').value,
        positiveMsg: document.getElementById('positiveMsg').value,
        negativeMsg: document.getElementById('negativeMsg').value,
        updatedAt: new Date().toISOString()
    };

    try {
        await setDoc(doc(db, "businesses", currentUser.uid, "settings", "funnel"), settings, { merge: true });
        // Visual feedback
        btn.innerHTML = '<i class="fas fa-check"></i> Saved!';
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-success');
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.classList.add('btn-primary');
            btn.classList.remove('btn-success');
            btn.disabled = false;
        }, 2000);
    } catch (error) {
        alert("Error saving: " + error.message);
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}