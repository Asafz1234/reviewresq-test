// firebase.js
// All auth + onboarding logic for ReviewResQ

// ----- Firebase INIT -----
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// YOUR CONFIG (ממה שנתת לי)
const firebaseConfig = {
  apiKey: "AIzaSyDdwnrO8RKn1ER5J3pyFbr69P9GjvR7CZ8",
  authDomain: "reviewresq-app.firebaseapp.com",
  projectId: "reviewresq-app",
  storageBucket: "reviewresq-app.firebasestorage.app",
  messagingSenderId: "863497920392",
  appId: "1:863497920392:web:ca99060b42a50711b9e43d",
  measurementId: "G-G3P2BX845N",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ----- UI HELPERS -----
function $(id) {
  return document.getElementById(id);
}

function clearFieldErrors() {
  const errorEls = document.querySelectorAll(".field-error");
  errorEls.forEach((el) => (el.textContent = ""));
  const inputs = document.querySelectorAll("input");
  inputs.forEach((inp) => inp.classList.remove("error"));
}

function showFieldError(inputId, message) {
  const input = $(inputId);
  if (input) input.classList.add("error");
  const errorEl = $(`${inputId}-error`);
  if (errorEl) errorEl.textContent = message;
}

function showGlobalMessage(type, message) {
  const box = $("global-message");
  if (!box) return;
  box.className = "global-message visible " + type;
  box.textContent = message;
}

function setLoading(buttonId, isLoading) {
  const btn = $(buttonId);
  if (!btn) return;
  btn.disabled = isLoading;
}

// ----- TABS (login / signup / forgot) -----
function activateTab(target) {
  const tabs = document.querySelectorAll(".auth-tab");
  const panels = document.querySelectorAll(".auth-panel");

  tabs.forEach((tab) => {
    const isActive = tab.dataset.target === target;
    tab.classList.toggle("active", isActive);
  });

  panels.forEach((panel) => {
    const isActive = panel.id === `${target}-panel`;
    panel.classList.toggle("active", isActive);
  });
}

// ----- VALIDATION -----
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isDigitsOnly(str) {
  return /^[0-9]+$/.test(str);
}

function validateSignup({ name, email, phone, password }) {
  clearFieldErrors();
  let ok = true;

  if (!name || name.trim().length < 2) {
    showFieldError("signup-name", "Please enter your full name.");
    ok = false;
  }

  if (!email || !isValidEmail(email)) {
    showFieldError("signup-email", "Please enter a valid email address.");
    ok = false;
  }

  if (!phone || !isDigitsOnly(phone) || phone.length < 7) {
    showFieldError(
      "signup-phone",
      "Phone should contain digits only and be at least 7 numbers."
    );
    ok = false;
  }

  if (!password || password.length < 6) {
    showFieldError(
      "signup-password",
      "Password must be at least 6 characters."
    );
    ok = false;
  }

  return ok;
}

function validateLogin({ email, password }) {
  clearFieldErrors();
  let ok = true;

  if (!email || !isValidEmail(email)) {
    showFieldError("login-email", "Please enter a valid email.");
    ok = false;
  }

  if (!password) {
    showFieldError("login-password", "Please enter your password.");
    ok = false;
  }

  return ok;
}

function validateForgot({ email }) {
  clearFieldErrors();
  let ok = true;

  if (!email || !isValidEmail(email)) {
    showFieldError("forgot-email", "Please enter a valid email address.");
    ok = false;
  }

  return ok;
}

// ----- FIREBASE ERROR MAPPING -----
function mapAuthError(error) {
  if (!error || !error.code) return "Something went wrong. Please try again.";

  switch (error.code) {
    case "auth/email-already-in-use":
      return "This email already has an account. Try logging in instead.";
    case "auth/invalid-email":
      return "The email address is not valid.";
    case "auth/weak-password":
      return "Password is too weak. Use at least 6 characters.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Email or password is incorrect.";
    case "auth/network-request-failed":
      return "Network problem. Check your internet connection and try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}

// ----- SIGNUP -----
async function handleSignup(event) {
  event.preventDefault();
  showGlobalMessage("error", "");
  clearFieldErrors();

  const name = $("signup-name").value.trim();
  const email = $("signup-email").value.trim();
  const phone = $("signup-phone").value.trim();
  const password = $("signup-password").value;

  if (!validateSignup({ name, email, phone, password })) {
    return;
  }

  try {
    setLoading("signup-submit", true);
    const cred = await createUserWithEmailAndPassword(auth, email, password);

    // Create business profile in Firestore
    const businessRef = doc(db, "businesses", cred.user.uid);
    await setDoc(businessRef, {
      ownerName: name,
      email,
      phone,
      plan: "basic",
      createdAt: serverTimestamp(),
      status: "trial",
    });

    showGlobalMessage(
      "success",
      "Account created successfully. Redirecting to dashboard..."
    );

    // TODO: change /dashboard.html if יש לך מסלול אחר
    setTimeout(() => {
      window.location.href = "/dashboard.html";
    }, 1200);
  } catch (error) {
    console.error("Signup error:", error);
    const msg = mapAuthError(error);
    showGlobalMessage("error", msg);
  } finally {
    setLoading("signup-submit", false);
  }
}

// ----- LOGIN -----
async function handleLogin(event) {
  event.preventDefault();
  showGlobalMessage("error", "");
  clearFieldErrors();

  const email = $("login-email").value.trim();
  const password = $("login-password").value;

  if (!validateLogin({ email, password })) {
    return;
  }

  try {
    setLoading("login-submit", true);
    await signInWithEmailAndPassword(auth, email, password);

    showGlobalMessage(
      "success",
      "Logged in successfully. Redirecting to dashboard..."
    );
    setTimeout(() => {
      window.location.href = "/dashboard.html";
    }, 800);
  } catch (error) {
    console.error("Login error:", error);
    const msg = mapAuthError(error);
    showGlobalMessage("error", msg);
  } finally {
    setLoading("login-submit", false);
  }
}

// ----- FORGOT PASSWORD -----
async function handleForgot(event) {
  event.preventDefault();
  showGlobalMessage("error", "");
  clearFieldErrors();

  const email = $("forgot-email").value.trim();

  if (!validateForgot({ email })) {
    return;
  }

  try {
    setLoading("forgot-submit", true);
    await sendPasswordResetEmail(auth, email);
    showGlobalMessage(
      "success",
      "If that email has an account, a reset link has been sent."
    );
  } catch (error) {
    console.error("Forgot error:", error);
    const msg = mapAuthError(error);
    showGlobalMessage("error", msg);
  } finally {
    setLoading("forgot-submit", false);
  }
}

// ----- INIT LISTENERS -----
document.addEventListener("DOMContentLoaded", () => {
  // Tabs clicks
  const tabs = document.querySelectorAll(".auth-tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.target;
      activateTab(target);
      showGlobalMessage("error", "");
      clearFieldErrors();
    });
  });

  // Forms
  const signupForm = $("signup-form");
  const loginForm = $("login-form");
  const forgotForm = $("forgot-form");

  if (signupForm) signupForm.addEventListener("submit", handleSignup);
  if (loginForm) loginForm.addEventListener("submit", handleLogin);
  if (forgotForm) forgotForm.addEventListener("submit", handleForgot);

  // Allow direct link via hash (#login / #signup / #forgot)
  const hash = window.location.hash.replace("#", "");
  if (["login", "signup", "forgot"].includes(hash)) {
    activateTab(hash);
  }
});
