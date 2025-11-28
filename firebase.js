// firebase.js
// קובץ מרכזי אחד לכל האפליקציה

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// *** שים לב: זה ה-config שנתת לי מה-Firebase שלך ***
const firebaseConfig = {
  apiKey: "AIzaSyDdwnrO8RKn1ER5J3pyFbr69P9GjvR7CZ8",
  authDomain: "reviewresq-app.firebaseapp.com",
  projectId: "reviewresq-app",
  storageBucket: "reviewresq-app.firebasestorage.app",
  messagingSenderId: "863497920392",
  appId: "1:863497920392:web:ca99060b42a50711b9e43d",
  measurementId: "G-G3P2BX845N"
};

// מאתחלים אפליקציה אחת בלבד
const app = initializeApp(firebaseConfig);

// מודולים עיקריים
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// פונקציה להעלאת לוגו והחזרת URL ציבורי
async function uploadLogoAndGetURL(file, userId) {
  if (!file) return null;

  const safeName = file.name.replace(/\s+/g, "-");
  const path = `logos/${userId}/${Date.now()}-${safeName}`;

  const logoRef = ref(storage, path);
  await uploadBytes(logoRef, file);
  const url = await getDownloadURL(logoRef);
  return url;
}

// פונקציה קטנה להבטיח שיש משתמש מחובר – אופציונלי
function waitForAuthUser() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

// מייצאים – כל קובץ אחר יכול להשתמש בזה
export {
  app,
  auth,
  db,
  storage,
  uploadLogoAndGetURL,
  waitForAuthUser,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signOut,
  doc,
  getDoc,
  setDoc
};
