// ------------------------------------------------------
// firebase.js – הגרסה המלאה, הנקייה והמעודכנת (2025)
// ------------------------------------------------------

// --- IMPORTS מה-CDN של Firebase v10 (מודולרי) ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";


// ------------------------------------------------------
//       🔥 CONFIG — הוכנסו הערכים האמיתיים שלך 🔥
// ------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyOdwmrO8R1n1ER5J3pyFbr69PPGjvr7CZ8",
  authDomain: "reviewresq-app.firebaseapp.com",
  projectId: "reviewresq-app",
  storageBucket: "reviewresq-app.firebasestorage.app",
  messagingSenderId: "863497920392",
  appId: "1:863497920392:web:ca9960b42a50711b9e43d",
  measurementId: "G-3GP2XB845N"
};


// ------------------------------------------------------
// INIT
// ------------------------------------------------------

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);


// ------------------------------------------------------
// EXPORTS – כל שאר הקבצים משתמשים בזה
// ------------------------------------------------------

// Auth
export {
  app,
  auth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,

  // Firestore
  db,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  getDocs,
};
