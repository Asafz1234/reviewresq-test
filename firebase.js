// ---------------------------------------------
// ReviewResQ - Firebase Connection & Auth Logic
// ---------------------------------------------

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ---------------------------------------------
// Firebase Configuration (YOUR REAL CONFIG)
// ---------------------------------------------
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
const auth = getAuth(app);

// ---------------------------------------------
// Error Translator – Friendly messages for users
// ---------------------------------------------

function translateError(error) {
  const code = error?.code || "";

  switch (code) {
    case "auth/invalid-email":
      return "Your email address is invalid. Please check for mistakes.";

    case "auth/email-already-in-use":
      return "This email already has an account. Try logging in instead.";

    case "auth/weak-password":
      return "Password is too weak. Use at least 6 characters.";

    case "auth/user-not-found":
      return "No account found with this email.";

    case "auth/wrong-password":
      return "Incorrect password. Please try again.";

    case "auth/network-request-failed":
      return "Network error. Please check your internet connection.";

    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";

    case "auth/api-key-not-valid":
    case "auth/argument-error":
    case "auth/invalid-api-key":
      return "We’re experiencing a technical issue. Please try again shortly.";

    default:
      console.error("DEBUG ERROR:", error);
      return "Something went wrong. Please try again.";
  }
}

// ---------------------------------------------
// Validation helpers BEFORE Firebase is used
// ---------------------------------------------

function validateName(name) {
  const englishRegex = /^[A-Za-z\s'-]+$/;
  if (!englishRegex.test(name)) {
    return "Full name must contain English letters only.";
  }
  return null;
}

function validatePhone(phone) {
  const phoneRegex = /^[0-9]{9,15}$/;
  if (!phoneRegex.test(phone)) {
    return "Mobile phone must contain numbers only (9–15 digits).";
  }
  return null;
}

function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return "Please enter a valid email address.";
  }
  return null;
}

function validatePassword(password) {
  if (password.length < 6) {
    return "Password must be at least 6 characters.";
  }
  return null;
}

// ---------------------------------------------
// SIGNUP
// ---------------------------------------------
window.reviewResQSignup = async function (name, email, phone, password) {
  // Frontend validation:
  const nameError = validateName(name);
  if (nameError) return { ok: false, message: nameError };

  const emailError = validateEmail(email);
  if (emailError) return { ok: false, message: emailError };

  const phoneError = validatePhone(phone);
  if (phoneError) return { ok: false, message: phoneError };

  const passwordError = validatePassword(password);
  if (passwordError) return { ok: false, message: passwordError };

  // Firebase signup:
  try {
    const userCred = await createUserWithEmailAndPassword(auth, email, password);
    return { ok: true, user: userCred.user };
  } catch (error) {
    return { ok: false, message: translateError(error) };
  }
};

// ---------------------------------------------
// LOGIN
// ---------------------------------------------
window.reviewResQLogin = async function (email, password) {
  try {
    const userCred = await signInWithEmailAndPassword(auth, email, password);
    return { ok: true, user: userCred.user };
  } catch (error) {
    return { ok: false, message: translateError(error) };
  }
};

// ---------------------------------------------
// RESET PASSWORD
// ---------------------------------------------
window.reviewResQResetPassword = async function (email) {
  const emailError = validateEmail(email);
  if (emailError) return { ok: false, message: emailError };

  try {
    await sendPasswordResetEmail(auth, email);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: translateError(error) };
  }
};

// ---------------------------------------------
// LOGOUT
// ---------------------------------------------
window.reviewResQLogout = async function () {
  try {
    await signOut(auth);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: "Failed to log out. Try again." };
  }
};
