// firebase.js – מודול מרכזי לכל האפליקציה

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

const firebaseConfig = {
  apiKey: "AIzaSyDdwnrO8RKn1ER5J3pyFbr69P9GjvR7CZ8",
  authDomain: "reviewresq-app.firebaseapp.com",
  projectId: "reviewresq-app",
  storageBucket: "reviewresq-app.appspot.com",
  messagingSenderId: "863497920392",
  appId: "1:863497920392:web:ca99060b42a50711b9e43d",
  measurementId: "G-G3P2BX845N"
};

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);

export {
  app,
  auth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
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
