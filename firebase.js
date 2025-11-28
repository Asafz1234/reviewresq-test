// firebase.js – מודול מרכזי לכל האפליקציה

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


// --- חשוב: הדבק כאן את ה-config שלך מהקובץ הישן ---
// const firebaseConfig = { ... }
const firebaseConfig = {
  // TODO: הדבק כאן את ההגדרות מפיירבייס (apiKey, authDomain וכו')
};


// --- INIT ---
const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);


// --- EXPORTS מרכזיים לכל שאר הקבצים ---
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
