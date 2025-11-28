// =============================
//  ReviewResQ AUTH MODULE
//  Handles login, signup, reset
//  Author: ChatGPT
// =============================

import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js";

import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";

import {
  getFirestore,
  setDoc,
  doc
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";

// =============================
//   FIREBASE CONFIG
// =============================

const firebaseConfig = {
  apiKey: "AIzaSyDdwnrO8RKn1ER5J3pyFbr69P9GjvR7CZ8",
  authDomain: "reviewresq-app.firebaseapp.com",
  projectId: "reviewresq-app",
  storageBucket: "reviewresq-app.firebasestorage.app",
  messagingSenderId: "863497920392",
  appId: "1:863497920392:web:ca99060b42a50711b9e43d",
  measurementId: "G-G3P2BX845N"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// =============================
// Email Validation Helper
// =============================
export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// =============================
// Signup function (exported)
// =============================
export async function handleSignup(fullName, email, phone, password) {
  if (!isValidEmail(email)) {
    throw { code: "invalid-email" };
  }
  if (password.length < 6) {
    throw { code: "weak-password" };
  }

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;

    // Create empty business profile (filled in onboarding)
    await setDoc(doc(db, "businessProfiles", uid), {
      fullName,
      email,
      phone,
      createdAt: Date.now(),
      onboardingCompleted: false
    });

    return uid;
  } catch (error) {
    throw error;
  }
}

// =============================
// Login function (exported)
// =============================
export async function handleLogin(email, password) {
  try {
    const res = await signInWithEmailAndPassword(auth, email, password);
    return res.user.uid;
  } catch (err) {
    throw err;
  }
}

// =============================
// Password Reset function
// =============================
export async function handlePasswordReset(email) {
  try {
    return await sendPasswordResetEmail(auth, email);
  } catch (err) {
    throw err;
  }
}

// =============================
// Auth state helper
// =============================
export function watchAuth(callback) {
  return auth.onAuthStateChanged(callback);
}
