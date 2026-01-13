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
  startAfter,
  getDocs,
  where,
  arrayUnion,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
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
export const storage = getStorage(
  app,
  "gs://reviewresq-app.firebasestorage.app"
);
export const functions = getFunctions(app, "us-central1");

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
  startAfter,
  getDocs,
  where,
  arrayUnion,
  onSnapshot,
  storageRef,
  uploadBytesResumable,
  getDownloadURL,
  httpsCallable,
};

// העלאת לוגו והחזרת URL
function getSafeLogoExtension(file) {
  const type = (file?.type || "").toLowerCase();

  if (type.includes("webp")) return ".webp";
  if (type.includes("png")) return ".png";

  const ext = (file?.name || "").split(".").pop()?.toLowerCase();
  if (ext === "webp") return ".webp";
  if (ext === "png") return ".png";

  // Default to WebP for deterministic handling
  return ".webp";
}

export async function uploadLogoAndGetURL(
  file,
  userId,
  { timeoutMs = 20000, retry = true } = {}
) {
  if (!file || !userId) {
    throw new Error("File and userId are required to upload a logo.");
  }

  const extension = getSafeLogoExtension(file);
  const storagePath = `branding/${userId}/logo${extension}`;
  const logoRef = storageRef(storage, storagePath);

  const uploadTask = uploadBytesResumable(logoRef, file, {
    contentType: file.type || "image/png",
  });

  const uploadPromise = new Promise((resolve, reject) => {
    let timer = null;
    const clear = () => {
      if (timer) {
        clearTimeout(timer);
      }
    };

    timer = setTimeout(() => {
      uploadTask.cancel();
      reject(new Error("Upload timed out. Please try again."));
    }, timeoutMs);

    uploadTask.on(
      "state_changed",
      null,
      (error) => {
        clear();
        reject(error);
      },
      async () => {
        clear();
        try {
          const url = await getDownloadURL(uploadTask.snapshot.ref);
          resolve({ url, storagePath });
        } catch (err) {
          reject(err);
        }
      }
    );
  });

  try {
    return await uploadPromise;
  } catch (error) {
    if (retry) {
      return uploadLogoAndGetURL(file, userId, { timeoutMs, retry: false });
    }
    throw error;
  }
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
