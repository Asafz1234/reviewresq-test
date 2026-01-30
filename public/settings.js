
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { auth } from "./firebase-config.js";

const db = getFirestore();
const storage = getStorage();
let currentUser;

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        loadSettings(user.uid);
    } else {
        console.log("No user is logged in.");
    }
});

async function loadSettings(userId) {
    const docRef = doc(db, "businesses", userId);
    try {
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const settings = docSnap.data();
            document.getElementById('settings-business-name').value = settings.businessName || '';
            document.getElementById('settings-google-link').value = settings.googleLink || '';
            document.getElementById('settings-current-plan').textContent = settings.plan || 'Starter';
            if (settings.logoUrl) {
                document.getElementById('settings-logo-preview').innerHTML = `<img src="${settings.logoUrl}" style="width:100%; height:100%; object-fit:cover;">`;
            }
        } else {
            console.log("No settings document found for user.");
        }
    } catch (error) {
        console.error("Error loading settings:", error);
    }
}

window.handleLogoSelect = function() {
    const input = document.getElementById('settings-logo-input');
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('settings-logo-preview').innerHTML = `<img src="${e.target.result}" style="width:100%; height:100%; object-fit:cover;">`;
        };
        reader.readAsDataURL(input.files[0]);
    }
}

window.saveSettings = async function() {
    if (!currentUser) {
        alert("You must be logged in to save settings.");
        return;
    }
    const businessName = document.getElementById('settings-business-name').value;
    const googleLink = document.getElementById('settings-google-link').value;
    const logoFile = document.getElementById('settings-logo-input').files[0];

    const settingsData = {
        businessName: businessName,
        googleLink: googleLink,
        ownerId: currentUser.uid
    };

    if (logoFile) {
        const logoRef = ref(storage, `logos/${currentUser.uid}/${logoFile.name}`);
        try {
            const snapshot = await uploadBytes(logoRef, logoFile);
            const downloadURL = await getDownloadURL(snapshot.ref);
            settingsData.logoUrl = downloadURL;
        } catch (error) {
            console.error("Error uploading logo:", error);
            alert("Failed to upload logo. Please try again.");
            return;
        }
    }

    const docRef = doc(db, "businesses", currentUser.uid);
    try {
        await setDoc(docRef, settingsData, { merge: true });
        alert("Settings saved successfully!");
    } catch (error) {
        console.error("Error saving settings:", error);
        alert("Failed to save settings. Please try again.");
    }
}

window.switchPlan = async function(planName) {
    if (!currentUser) {
        alert("You must be logged in to switch plans.");
        return;
    }
    const docRef = doc(db, "businesses", currentUser.uid);
    try {
        await updateDoc(docRef, {
            plan: planName
        });
        document.getElementById('settings-current-plan').textContent = planName;
        alert(`Plan switched to ${planName}!`);
    } catch (error) {
        console.error("Error switching plan:", error);
        alert("Failed to switch plan.");
    }
}
