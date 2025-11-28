// firebase.js

// ייבוא Firebase App
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

// ייבוא Firebase Authentication
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
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
  measurementId: "G-G3P2BX848M"
};

// אתחול אפליקציית Firebase
const app = initializeApp(firebaseConfig);

// יצירת מופע של Authentication
const auth = getAuth(app);

// ----------------------------
//  פונקציות Signup / Login
// ----------------------------

// יצירת חשבון חדש
window.reviewResQSignup = async function (name, email, password) {
  try {
    const userCred = await createUserWithEmailAndPassword(auth, email, password);
    console.log("Signup Success:", userCred.user.uid);
    return { ok: true, user: userCred.user };
  } catch (error) {
    console.error("Signup Error:", error);
    return { ok: false, error };
  }
};

// התחברות למערכת
window.reviewResQLogin = async function (email, password) {
  try {
    const userCred = await signInWithEmailAndPassword(auth, email, password);
    console.log("Login Success:", userCred.user.uid);
    return { ok: true, user: userCred.user };
  } catch (error) {
    console.error("Login Error:", error);
    return { ok: false, error };
  }
};

// התנתקות
window.reviewResQLogout = async function () {
  try {
    await signOut(auth);
    return { ok: true };
  } catch (error) {
    console.error("Logout Error:", error);
    return { ok: false, error };
  }
};
