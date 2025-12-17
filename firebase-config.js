import {
  initializeApp,
  setLogLevel,
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";

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
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-storage.js";

// ✅ FIX: ייבוא נכון של Functions מה-SDK
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-functions.js";

// סינון לוגי heartbeats מיותרים בקונסול
const originalConsoleLog = console.log;
console.log = (...args) => {
  if (
    typeof args[0] === "string" &&
    args[0].toLowerCase().trim() === "heartbeats"
  ) {
    return;
  }
  originalConsoleLog(...args);
};

// 🔹 זה ה-config היחיד, בדיוק כמו ב-Firebase Console
const firebaseConfig = {
  apiKey: "AIzaSyDdwnrO8RKn1ER5J3pyFbr69P9GjvR7CZ8",
  authDomain: "reviewresq-app.firebaseapp.com",
  projectId: "reviewresq-app",
  storageBucket: "reviewresq-app.firebasestorage.app",
  messagingSenderId: "863497920392",
  appId: "1:863497920392:web:ca99060b42a50711b9e43d",
  measurementId: "G-G3P2BX845N",
};

// אתחול Firebase
export const app = initializeApp(firebaseConfig);

// משאיר רק שגיאות/אזהרות מה-SDK
setLogLevel("error");

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

// ✅ שלב 2: חשיפה ל-Console (כדי לבדוק currentUser)
window._app = app;
window._auth = auth;
window._db = db;
window._functions = functions;

// ייצוא כל הפונקציות הדרושות לשאר הקבצים
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
  onSnapshot,
  storageRef,
  uploadBytes,
  getDownloadURL,
  httpsCallable,
};

// העלאת לוגו והחזרת URL
export async function uploadLogoAndGetURL(file, userId) {
  if (!file || !userId) {
    throw new Error("File and userId are required to upload a logo.");
  }

  const ext = (file.name || "").split(".").pop();
  const safeExt = ext && ext.length < 8 ? `.${ext}` : "";
  const logoRef = storageRef(storage, `logos/${userId}/portal-logo${safeExt}`);

  const snapshot = await uploadBytes(logoRef, file);
  return getDownloadURL(snapshot.ref);
}

// המרת קובץ ל-DataURL
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read the image file"));
    reader.readAsDataURL(file);
  });
}
