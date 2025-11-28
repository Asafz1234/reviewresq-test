// firebase.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ----------------------------
//  Firebase Configuration
// ----------------------------
const firebaseConfig = {
  apiKey: "AIzaSyDwnwrO8RKn1ER53JpyFbr69PG9jvR7Cz8",
  authDomain: "reviewresq-app.firebaseapp.com",
  projectId: "reviewresq-app",
  storageBucket: "reviewresq-app.firebasestorage.app",
  messagingSenderId: "863497920392",
  appId: "1:863497920392:web:ca9906b042a50711b9e43d",
  measurementId: "G-G3P2BX845N",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// ----------------------------
//  Error mapping – ידידותי ללקוח
// ----------------------------
function formatAuthError(error) {
  const code = error?.code || "";

  switch (code) {
    case "auth/email-already-in-use":
      return "This email is already connected to a ReviewResQ account. Try logging in instead or reset your password.";
    case "auth/invalid-email":
      return "This email address doesn’t look right. Please check for typos (example@mail.com).";
    case "auth/weak-password":
      return "Password is too weak. Use at least 6 characters.";
    case "auth/user-not-found":
      return "We couldn’t find an account with this email. Check the email or create a new account.";
    case "auth/wrong-password":
      return "The password is incorrect. Please try again or reset your password.";
    case "auth/network-request-failed":
      return "Network error. Please check your internet connection and try again.";
    case "auth/too-many-requests":
      return "Too many attempts in a short time. Please wait a moment and try again.";
    default:
      return error?.message || "Something went wrong. Please try again.";
  }
}

// ----------------------------
//  API functions on window
// ----------------------------

// Create account
window.reviewResQSignup = async function (name, email, phone, password) {
  try {
    const userCred = await createUserWithEmailAndPassword(auth, email, password);
    console.log("Signup success:", userCred.user.uid);

    // בעתיד אפשר לשמור כאן name + phone ב-Firestore

    return { ok: true, user: userCred.user };
  } catch (error) {
    console.error("Signup error:", error);
    return { ok: false, error, message: formatAuthError(error) };
  }
};

// Login
window.reviewResQLogin = async function (email, password) {
  try {
    const userCred = await signInWithEmailAndPassword(auth, email, password);
    console.log("Login success:", userCred.user.uid);
    return { ok: true, user: userCred.user };
  } catch (error) {
    console.error("Login error:", error);
    return { ok: false, error, message: formatAuthError(error) };
  }
};

// Logout
window.reviewResQLogout = async function () {
  try {
    await signOut(auth);
    return { ok: true };
  } catch (error) {
    console.error("Logout error:", error);
    return { ok: false, error, message: formatAuthError(error) };
  }
};

// Reset password by email
window.reviewResQResetPassword = async function (email) {
  try {
    await sendPasswordResetEmail(auth, email);
    return { ok: true };
  } catch (error) {
    console.error("Reset password error:", error);
    return { ok: false, error, message: formatAuthError(error) };
  }
};
