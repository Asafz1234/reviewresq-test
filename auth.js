// auth.js – לוגיקה של Login / Create Account / Forgot Password

import {
  auth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from "./firebase.js";

/* ---------------------------
   עזרת UI – הודעה כללית למעלה
---------------------------- */
const globalMsg = document.getElementById("global-message");

function showGlobalError(msg) {
  globalMsg.textContent = msg;
  globalMsg.className = "global-message visible error";
}

function showGlobalSuccess(msg) {
  globalMsg.textContent = msg;
  globalMsg.className = "global-message visible success";
}

function clearGlobalMessage() {
  globalMsg.textContent = "";
  globalMsg.className = "global-message";
}

/* ---------------------------
   עזרת UI – שגיאות בשדות
---------------------------- */
function clearAllErrors() {
  document.querySelectorAll(".field-error").forEach((el) => (el.textContent = ""));
  document.querySelectorAll("input").forEach((i) => i.classList.remove("error"));
}

// Password strength validator
function isStrongPassword(password) {
  const strongPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$/;
  return strongPattern.test(password);
}

function fieldError(id, msg) {
  const input = document.getElementById(id);
  const errorDiv = document.getElementById(id + "-error");
  if (input) input.classList.add("error");
  if (errorDiv) errorDiv.textContent = msg;
}

/* ---------------------------
   TAB SWITCHING (Login / Signup / Forgot)
---------------------------- */
const tabs = document.querySelectorAll(".auth-tab");
const panels = document.querySelectorAll(".auth-panel");

function clearTabState() {
  tabs.forEach((t) => t.classList.remove("active"));
  panels.forEach((p) => p.classList.remove("active"));
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    clearTabState();
    clearAllErrors();
    clearGlobalMessage();

    tab.classList.add("active");
    const target = tab.dataset.target;
    const panel = document.getElementById(target + "-panel");
    if (panel) panel.classList.add("active");
  });
});

/* ---------------------------
   LOGIN
---------------------------- */
const loginForm = document.getElementById("login-form");
const loginSubmitBtn = document.getElementById("login-submit");

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAllErrors();
    clearGlobalMessage();

    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value.trim();

    if (!email) {
      return fieldError("login-email", "Email is required.");
    }
    if (!password) {
      return fieldError("login-password", "Password is required.");
    }

    try {
      loginSubmitBtn.disabled = true;

      await signInWithEmailAndPassword(auth, email, password);

      showGlobalSuccess("Logged in! Redirecting…");
      setTimeout(() => {
        window.location.href = "/dashboard.html";
      }, 700);
    } catch (err) {
      console.error("Login error:", err);

      switch (err.code) {
        case "auth/invalid-credential":
        case "auth/wrong-password":
          showGlobalError("Incorrect email or password.");
          break;
        case "auth/user-not-found":
          showGlobalError("No account found with this email.");
          break;
        case "auth/too-many-requests":
          showGlobalError(
            "Too many attempts. Please wait a minute and try again."
          );
          break;
        case "auth/invalid-email":
          fieldError("login-email", "Please enter a valid email address.");
          break;
        default:
          showGlobalError("Login failed. Please try again.");
      }
    } finally {
      loginSubmitBtn.disabled = false;
    }
  });
}

/* ---------------------------
   SIGNUP (Create Account)
---------------------------- */
const signupForm = document.getElementById("signup-form");
const signupSubmitBtn = document.getElementById("signup-submit");

if (signupForm) {
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAllErrors();
    clearGlobalMessage();

    const name = document.getElementById("signup-name").value.trim();
    const email = document.getElementById("signup-email").value.trim();
    const phone = document.getElementById("signup-phone").value.trim();
    const password = document.getElementById("signup-password").value.trim();

    // ולידציה בסיסית בצד לקוח
    if (!name) return fieldError("signup-name", "Full name is required.");
    if (!email) return fieldError("signup-email", "Email is required.");
    if (!phone) return fieldError("signup-phone", "Phone is required.");
    if (!isStrongPassword(password)) {
      alert(
        "Password must be at least 8 characters and include uppercase, lowercase, number, and special character."
      );
      return fieldError(
        "signup-password",
        "Enter a strong password (8+ chars, upper+lowercase, number, special)."
      );
    }

    try {
      signupSubmitBtn.disabled = true;

      // יצירת המשתמש ב-Auth בלבד
      await createUserWithEmailAndPassword(auth, email, password);

      // אם הצליח – הודעה ברורה והפניה לאונבורדינג
      showGlobalSuccess("Account created! Let’s set up your business…");
      setTimeout(() => {
        window.location.href = "/onboarding.html";
      }, 800);
    } catch (err) {
      console.error("Signup error:", err);

      // פה אנחנו מטפלים בשגיאות של הלקוח – כדי שהוא יבין מה לתקן
      switch (err.code) {
        case "auth/email-already-in-use":
          showGlobalError("This email already has an account. Try logging in.");
          fieldError("signup-email", "This email is already in use.");
          break;
        case "auth/invalid-email":
          fieldError("signup-email", "Please enter a valid email address.");
          break;
        case "auth/weak-password":
          fieldError(
            "signup-password",
            "Password must be at least 6 characters."
          );
          break;
        case "auth/operation-not-allowed":
          showGlobalError(
            "Email/password sign-up is disabled for this project. Please contact support."
          );
          break;
        default:
          // כל שגיאה לא צפויה אחרת
          showGlobalError("Something went wrong. Please try again.");
      }
    } finally {
      signupSubmitBtn.disabled = false;
    }
  });
}

/* ---------------------------
   FORGOT PASSWORD
---------------------------- */
const forgotForm = document.getElementById("forgot-form");
const forgotSubmitBtn = document.getElementById("forgot-submit");

if (forgotForm) {
  forgotForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAllErrors();
    clearGlobalMessage();

    const email = document.getElementById("forgot-email").value.trim();

    if (!email) {
      return fieldError("forgot-email", "Email is required.");
    }

    try {
      forgotSubmitBtn.disabled = true;

      await sendPasswordResetEmail(auth, email);

      showGlobalSuccess(
        "Reset link sent! Check your inbox (and spam folder)."
      );
    } catch (err) {
      console.error("Forgot password error:", err);

      switch (err.code) {
        case "auth/user-not-found":
          showGlobalError(
            "No account found with this email. Did you sign up with a different address?"
          );
          break;
        case "auth/invalid-email":
          fieldError("forgot-email", "Please enter a valid email address.");
          break;
        default:
          showGlobalError("Couldn't send reset link. Please try again.");
      }
    } finally {
      forgotSubmitBtn.disabled = false;
    }
  });
}
