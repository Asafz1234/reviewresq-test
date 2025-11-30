// firebase.js – מודול מרכזי לכל האפליקציה

import {
  initializeApp,
  setLogLevel,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";

// Quiet repeated Firebase heartbeat debug logs that clutter the console
const originalConsoleLog = console.log;
console.log = (...args) => {
  if (typeof args[0] === "string" && args[0].toLowerCase().trim() === "heartbeats") {
    return;
  }
  originalConsoleLog(...args);
};

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
  where,
  arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyDdwnrO8RKn1ER5J3pyFbr69P9GjvR7CZ8",
  authDomain: "reviewresq-app.firebaseapp.com",
  projectId: "reviewresq-app",
  storageBucket: "reviewresq-app.appspot.com",
  messagingSenderId: "863497920392",
  appId: "1:863497920392:web:ca99060b42a50711b9e43d",
  measurementId: "G-G3P2BX845N"
};

// Initialize the core Firebase services once and expose them as named exports
export const app = initializeApp(firebaseConfig);
// Silence noisy Firebase debug logs (e.g., heartbeat messages) while keeping errors visible
setLogLevel("error");
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
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
  where,
  arrayUnion,
  storageRef,
  uploadBytes,
  getDownloadURL,
};

export async function uploadLogoAndGetURL(file, userId) {
  if (!file || !userId) {
    throw new Error("File and userId are required to upload a logo.");
  }

  const logoRef = storageRef(storage, `logos/${userId}/${file.name}`);
  const snapshot = await uploadBytes(logoRef, file);
  return getDownloadURL(snapshot.ref);
}
