// firebase.js
// מודול מרכזי לכל האפליקציה (Auth + Firestore)

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---------------------------
// Firebase config (שלך)
// ---------------------------
const firebaseConfig = {
  apiKey: "AIzaSyDdwnrO8RKn1ER5J3pyFbr69P9GjvR7CZ8",
  authDomain: "reviewresq-app.firebaseapp.com",
  projectId: "reviewresq-app",
  storageBucket: "reviewresq-app.firebasestorage.app",
  messagingSenderId: "863497920392",
  appId: "1:863497920392:web:ca99060b42a50711b9e43d",
  measurementId: "G-G3P2BX845N"
};

// כדי שלא ייזרק "app already exists" אם נטען פעמיים
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

// ---------------------------
//  ולידציות בסיסיות ל־Signup
// ---------------------------
function validateFullName(fullName) {
  if (!fullName || fullName.trim().length < 2) {
    throw new Error("Please enter your full name (at least 2 characters).");
  }
}

function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!re.test(email)) {
    throw new Error("Please enter a valid email address.");
  }
}

function validatePhone(phone) {
  const re = /^[0-9]{7,15}$/; // ספרות בלבד, 7–15
  if (!re.test(phone)) {
    throw new Error("Phone number must contain digits only (7–15 digits).");
  }
}

function validatePassword(password) {
  if (!password || password.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }
}

// ---------------------------
//  Signup – יצירת משתמש + Business
// ---------------------------
export async function signUpBusiness({ fullName, email, phone, password }) {
  // ולידציות בצד לקוח
  validateFullName(fullName);
  validateEmail(email);
  validatePhone(phone);
  validatePassword(password);

  // יצירת משתמש ב־Auth
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const user = cred.user;

  // יצירת מסמך Business ב־Firestore
  const businessRef = doc(db, "businesses", user.uid);
  await setDoc(businessRef, {
    ownerUid: user.uid,
    fullName,
    email,
    phone,
    plan: "basic", // כרגע ברירת מחדל – אפשר לעדכן בעתיד לפי בחירה
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return user;
}

// ---------------------------
// Login
// ---------------------------
export async function loginWithEmailPassword(email, password) {
  validateEmail(email);
  if (!password) {
    throw new Error("Please enter your password.");
  }

  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

// ---------------------------
// Forgot Password – שליחת מייל
// ---------------------------
export async function sendPasswordResetLink(email) {
  validateEmail(email);
  await sendPasswordResetEmail(auth, email);
}

// ---------------------------
// Helper לטעינת business של משתמש מחובר (לשימוש בדשבורד בעתיד)
// ---------------------------
export async function getCurrentBusinessProfile(uid) {
  const ref = doc(db, "businesses", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data();
}
