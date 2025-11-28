// ---------------------------------------------
//  FIREBASE IMPORTS
// ---------------------------------------------
import {
  auth,
  db,
  doc,
  setDoc,
  getDoc,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from "./firebase.js";

// ---------------------------------------------
//  GLOBAL HELPERS
// ---------------------------------------------
function showGlobalMessage(type, text) {
  const msg = document.getElementById("global-message");
  msg.textContent = text;
  msg.className = `global-message visible ${type}`;
}

function clearFieldErrors() {
  document.querySelectorAll(".field-error").forEach((e) => (e.textContent = ""));
  document.querySelectorAll("input").forEach((i) => i.classList.remove("error"));
}

function fieldError(id, message) {
  const input = document.getElementById(id);
  const errorDiv = document.getElementById(id + "-error");

  input.classList.add("error");
  errorDiv.textContent = message;
}

function loadingButton(btn, isLoading) {
  if (!btn) return;

  if (isLoading) {
    btn.disabled = true;
    btn.textContent = "Please wait...";
  } else {
    btn.disabled = false;
    btn.textContent = btn.dataset.label;
  }
}

// ---------------------------------------------
//  SIGN UP LOGIC
// ---------------------------------------------
const signupForm = document.getElementById("signup-form");

if (signupForm) {
  const signupBtn = document.getElementById("signup-submit");
  signupBtn.dataset.label = "Create account";

  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors();
    showGlobalMessage("", "");

    const name = document.getElementById("signup-name").value.trim();
    const email = document.getElementById("signup-email").value.trim();
    const phone = document.getElementById("signup-phone").value.trim();
    const password = document.getElementById("signup-password").value.trim();

    if (!name) return fieldError("signup-name", "Full name is required.");
    if (!email) return fieldError("signup-email", "Email is required.");
    if (!phone) return fieldError("signup-phone", "Phone is required.");
    if (password.length < 6)
      return fieldError(
        "signup-password",
        "Password must be at least 6 characters."
      );

    loadingButton(signupBtn, true);

    try {
      // Create Firebase user
      const userCred = await createUserWithEmailAndPassword(auth, email, password);
      const uid = userCred.user.uid;

      // Create initial Firestore profile
      await setDoc(doc(db, "users", uid), {
        name,
        email,
        phone,
        createdAt: Date.now(),
        onboardingComplete: false,
      });

      showGlobalMessage("success", "Account created! Redirecting...");

      // Redirect to onboarding
      setTimeout(() => {
        window.location.href = "/onboarding.html";
      }, 800);
    } catch (err) {
      console.error("Signup error:", err);

      if (err.code === "auth/email-already-in-use") {
        showGlobalMessage("error", "This email already has an account.");
      } else if (err.code === "auth/invalid-email") {
        showGlobalMessage("error", "Invalid email format.");
      } else {
        showGlobalMessage("error", "Something went wrong. Try again.");
      }
    }

    loadingButton(signupBtn, false);
  });
}

// ---------------------------------------------
//  LOGIN LOGIC
// ---------------------------------------------
const loginForm = document.getElementById("login-form");

if (loginForm) {
  const loginBtn = document.getElementById("login-submit");
  loginBtn.dataset.label = "Log In";

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors();
    showGlobalMessage("", "");

    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value.trim();

    if (!email) return fieldError("login-email", "Email is required.");
    if (!password) return fieldError("login-password", "Password is required.");

    loadingButton(loginBtn, true);

    try {
      const userCred = await signInWithEmailAndPassword(auth, email, password);
      const uid = userCred.user.uid;

      // Check onboarding completion
      const profile = await getDoc(doc(db, "users", uid));

      if (!profile.exists()) {
        // Shouldn't happen, but just in case
        return window.location.href = "/onboarding.html";
      }

      const data = profile.data();

      if (data.onboardingComplete) {
        showGlobalMessage("success", "Login successful, redirecting...");
        setTimeout(() => {
          window.location.href = "/dashboard.html";
        }, 600);
      } else {
        showGlobalMessage("success", "Continue your setup...");
        setTimeout(() => {
          window.location.href = "/onboarding.html";
        }, 600);
      }
    } catch (err) {
      console.error("Login error:", err);

      if (err.code === "auth/invalid-credential") {
        showGlobalMessage("error", "Wrong email or password.");
      } else {
        showGlobalMessage("error", "Login failed. Try again.");
      }
    }

    loadingButton(loginBtn, false);
  });
}

// ---------------------------------------------
//  FORGOT PASSWORD
// ---------------------------------------------
const forgotForm = document.getElementById("forgot-form");

if (forgotForm) {
  const forgotBtn = document.getElementById("forgot-submit");
  forgotBtn.dataset.label = "Send reset link";

  forgotForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors();
    showGlobalMessage("", "");

    const email = document.getElementById("forgot-email").value.trim();
    if (!email) return fieldError("forgot-email", "Email is required.");

    loadingButton(forgotBtn, true);

    try {
      await sendPasswordResetEmail(auth, email);
      showGlobalMessage("success", "Reset link sent! Check your inbox.");
    } catch (err) {
      console.log(err);

      if (err.code === "auth/user-not-found") {
        showGlobalMessage("error", "No account found for this email.");
      } else {
        showGlobalMessage("error", "Could not send reset email.");
      }
    }

    loadingButton(forgotBtn, false);
  });
}
