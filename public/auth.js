// Import specific auth functions directly from the Firebase SDK
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail,
    onAuthStateChanged,
    updateProfile
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
// Import the initialized auth instance from our config
import { auth } from "./firebase-config.js";

// --- UI Helper Functions ---
const globalMsg = document.getElementById("global-message");

function showGlobalError(message) {
  globalMsg.textContent = message;
  globalMsg.className = "block my-4 text-center text-sm p-3 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20";
}

function showGlobalSuccess(message) {
  globalMsg.textContent = message;
  globalMsg.className = "block my-4 text-center text-sm p-3 rounded-lg bg-green-500/10 text-green-400 border border-green-500/20";
}

function setFieldError(fieldId, message) {
    const errorEl = document.getElementById(`${fieldId}-error`);
    if (errorEl) {
        errorEl.textContent = message;
    }
}

function clearMessages() {
    globalMsg.textContent = '';
    globalMsg.className = 'hidden my-4 text-center text-sm p-3 rounded-lg';
    document.querySelectorAll('.text-red-400').forEach(el => el.textContent = '');
}

// --- Auth State Observer ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        // If user is logged in and on the auth page, redirect to dashboard
        if (window.location.pathname.includes('auth.html') || window.location.pathname === '/') {
            console.log("User is already logged in. Redirecting to dashboard.");
            window.location.href = "/dashboard.html";
        }
    } else {
        // User is signed out
        console.log("User is signed out.");
    }
});

// --- Login Logic ---
const loginForm = document.getElementById("login-form");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMessages();
    const loginSubmitBtn = document.getElementById("login-submit");
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value.trim();

    if (!email) {
        setFieldError('login-email', 'Email address is required.');
        return;
    }
    if (!password) {
        setFieldError('login-password', 'Password is required.');
        return;
    }

    loginSubmitBtn.disabled = true;
    loginSubmitBtn.textContent = 'Logging in...';

    try {
      await signInWithEmailAndPassword(auth, email, password);
      showGlobalSuccess("Success! Redirecting to your dashboard...");
      setTimeout(() => {
        window.location.href = "/dashboard.html";
      }, 1000);
    } catch (error) {
      console.error("Authentication Error:", error.code, error.message);
      if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
          showGlobalError("Invalid email or password. Please try again.");
      } else if (error.code === 'auth/invalid-email') {
          setFieldError('login-email', 'Please enter a valid email address.');
      } else if (error.code === 'auth/too-many-requests') {
          showGlobalError("Access to this account has been temporarily disabled due to many failed login attempts. You can immediately restore it by resetting your password or you can try again later.");
      } else {
          showGlobalError("An unexpected error occurred. Please try again later.");
      }
    } finally {
      loginSubmitBtn.disabled = false;
      loginSubmitBtn.textContent = 'Log In';
    }
  });
}

// --- Signup Logic ---
const signupForm = document.getElementById("signup-form");
if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearMessages();
        const signupSubmitBtn = document.getElementById("signup-submit");
        const name = document.getElementById('signup-name').value.trim();
        const email = document.getElementById('signup-email').value.trim();
        const password = document.getElementById('signup-password').value.trim();

        if (!name) {
            setFieldError('signup-name', 'Your name is required.');
            return;
        }
        if (!email) {
            setFieldError('signup-email', 'A valid email is required.');
            return;
        }
        if (password.length < 8) {
            setFieldError('signup-password', 'Password must be at least 8 characters.');
            return;
        }

        signupSubmitBtn.disabled = true;
        signupSubmitBtn.textContent = 'Creating Account...';

        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            // After creating the user, update their profile with the name
            await updateProfile(userCredential.user, {
                displayName: name
            });
            
            showGlobalSuccess("Account created! Redirecting...");
            // Redirect to onboarding or dashboard, wherever the business setup happens.
            // For now, let's assume dashboard handles it if the business doc doesn't exist.
            setTimeout(() => {
                window.location.href = "/dashboard.html"; 
            }, 1000);

        } catch (error) {
            console.error("Signup Error:", error.code, error.message);
            if (error.code === 'auth/email-already-in-use') {
                showGlobalError("An account with this email already exists. Please log in.");
                setFieldError('signup-email', 'Email already in use.');
            } else if (error.code === 'auth/invalid-email') {
                setFieldError('signup-email', 'Please provide a valid email address.');
            } else if (error.code === 'auth/weak-password') {
                setFieldError('signup-password', 'Password is too weak. Please choose a stronger one.');
            } else {
                showGlobalError("Couldn't create an account. Please try again.");
            }
        } finally {
            signupSubmitBtn.disabled = false;
            signupSubmitBtn.textContent = 'Create Account';
        }
    });
}


// --- Forgot Password Logic ---
const forgotForm = document.getElementById("forgot-form");
if (forgotForm) {
    forgotForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearMessages();
        const forgotSubmitBtn = document.getElementById("forgot-submit");
        const email = document.getElementById('forgot-email').value.trim();

        if (!email) {
            setFieldError('forgot-email', 'Please enter your email address.');
            return;
        }

        forgotSubmitBtn.disabled = true;
        forgotSubmitBtn.textContent = 'Sending...';

        try {
            await sendPasswordResetEmail(auth, email);
            showGlobalSuccess("Password reset email sent! Check your inbox.");
        } catch (error) {
            console.error("Password Reset Error:", error.code, error.message);
            if (error.code === 'auth/user-not-found') {
                showGlobalError("No account found with this email address.");
            } else if (error.code === 'auth/invalid-email') {
                setFieldError('forgot-email', 'The email address is not valid.');
            } else {
                showGlobalError("An error occurred while trying to send the reset email.");
            }
        } finally {
            forgotSubmitBtn.disabled = false;
            forgotSubmitBtn.textContent = 'Send Reset Link';
        }
    });
}
