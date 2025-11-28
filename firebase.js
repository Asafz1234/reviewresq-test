/************************************
 *  REVIEWRESQ – Firebase Main File
 ************************************/

// IMPORT CORE FIREBASE MODULES
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

/************************************
 * 1. FIREBASE CONFIG
 ************************************/
const firebaseConfig = {
  apiKey: "AIzaSyDdwnrO8RKn1ER5J3pyFbr69P9GjvR7CZ8",
  authDomain: "reviewresq-app.firebaseapp.com",
  projectId: "reviewresq-app",
  storageBucket: "reviewresq-app.firebasestorage.app",
  messagingSenderId: "863497920392",
  appId: "1:863497920392:web:ca99060b42a50711b9e43d",
  measurementId: "G-G3P2BX845N"
};

/************************************
 * 2. INITIALIZE
 ************************************/
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

/************************************
 * 3. UPLOAD LOGO FUNCTION (new)
 ************************************/
export async function uploadLogoAndGetURL(file, uid) {
  const path = storageRef(storage, `logos/${uid}.png`);
  await uploadBytes(path, file);
  return await getDownloadURL(path);
}

/************************************
 * 4. SIGNUP WITH VALIDATION
 ************************************/
export async function signupUser({ email, password, name, phone }) {
  try {
    // VALIDATION
    if (!email.includes("@") || !email.includes(".")) {
      throw { code: "invalid-email-format" };
    }
    if (password.length < 6) {
      throw { code: "weak-password" };
    }
    if (!/^[A-Za-z ]+$/.test(name)) {
      throw { code: "invalid-name" };
    }
    if (!/^[0-9+ -]{8,15}$/.test(phone)) {
      throw { code: "invalid-phone" };
    }

    // CREATE USER
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);

    // SAVE USER DATA
    await setDoc(doc(db, "users", userCredential.user.uid), {
      email,
      name,
      phone,
      createdAt: new Date().toISOString()
    });

    return { success: true };

  } catch (error) {
    console.error("SIGNUP ERROR:", error);

    // CUSTOM ERRORS
    const customErrors = {
      "auth/email-already-in-use": "This email already has an account.",
      "invalid-email-format": "Email format is invalid.",
      "invalid-name": "Name must contain only English letters.",
      "invalid-phone": "Phone number format is invalid.",
      "weak-password": "Password must be at least 6 characters.",
    };

    return { success: false, message: customErrors[error.code] || "Something went wrong. Please try again." };
  }
}

/************************************
 * 5. LOGIN WITH CLEAR ERRORS
 ************************************/
export async function loginUser(email, password) {
  try {
    await signInWithEmailAndPassword(auth, email, password);
    return { success: true };

  } catch (error) {
    console.error("LOGIN ERROR:", error);

    const customErrors = {
      "auth/invalid-email": "Email format is invalid.",
      "auth/user-not-found": "This account does not exist.",
      "auth/wrong-password": "Incorrect password.",
      "auth/too-many-requests": "Too many attempts. Try again later."
    };

    return { success: false, message: customErrors[error.code] || "Login failed. Please try again." };
  }
}

/************************************
 * 6. SEND PASSWORD RESET EMAIL
 ************************************/
export async function resetPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email);
    return { success: true };
  } catch (error) {
    console.error("RESET ERROR:", error);

    const customErrors = {
      "auth/user-not-found": "No account found with this email.",
      "auth/invalid-email": "Email format is invalid."
    };

    return { success: false, message: customErrors[error.code] || "Cannot reset password." };
  }
}

/************************************
 * 7. LOGOUT
 ************************************/
export async function logoutUser() {
  try {
    await signOut(auth);
    return { success: true };
  } catch (error) {
    return { success: false, message: "Logout failed." };
  }
}

/************************************
 * 8. LOAD USER PROFILE
 ************************************/
export async function loadUserProfile(uid) {
  try {
    const ref = doc(db, "users", uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) return null;

    return snap.data();

  } catch (error) {
    console.error("PROFILE ERROR:", error);
    return null;
  }
}
