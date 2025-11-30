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

  const ext = (file.name || "").split(".").pop();
  const safeExt = ext && ext.length < 8 ? `.${ext}` : "";
  const logoRef = storageRef(storage, `logos/${userId}/portal-logo${safeExt}`);
  const snapshot = await uploadBytes(logoRef, file);
  return getDownloadURL(snapshot.ref);
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read the image file"));
    reader.readAsDataURL(file);
  });
}

export function fileToOptimizedDataUrl(file, { maxSize = 640, quality = 0.85 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = () => {
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        // Preserve aspect ratio while constraining the longest edge
        let { width, height } = img;
        if (width > height && width > maxSize) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else if (height > maxSize) {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
        const dataUrl = canvas.toDataURL(mime, quality);
        resolve(dataUrl);
      };

      img.onerror = () => reject(new Error("Failed to process the image file"));
      img.src = reader.result;
    };

    reader.onerror = () => reject(new Error("Failed to read the image file"));
    reader.readAsDataURL(file);
  });
}

// Compress a logo to a data URL while keeping the payload small enough for Firestore
// documents (1MB limit). We gradually decrease dimensions and quality until the
// encoded size is within the target threshold.
export async function fileToCappedDataUrl(
  file,
  {
    maxSize = 640,
    quality = 0.82,
    targetBytes = 900_000,
    minSize = 240,
    qualityStep = 0.08,
    minQuality = 0.5,
  } = {}
) {
  let currentSize = maxSize;
  let currentQuality = quality;

  // Attempt a few times with smaller settings until the data URL fits comfortably
  for (let i = 0; i < 5; i += 1) {
    const dataUrl = await fileToOptimizedDataUrl(file, {
      maxSize: currentSize,
      quality: currentQuality,
    });

    // Roughly estimate the byte size of the base64 payload
    const approxBytes = Math.round((dataUrl.length * 3) / 4);
    if (approxBytes <= targetBytes) {
      return dataUrl;
    }

    currentSize = Math.max(minSize, Math.round(currentSize * 0.85));
    currentQuality = Math.max(minQuality, Number((currentQuality - qualityStep).toFixed(2)));
  }

  // Final attempt with the smallest allowed settings
  return fileToOptimizedDataUrl(file, {
    maxSize: minSize,
    quality: minQuality,
  });
}

// Attempt to upload a logo to Firebase Storage. If Storage is blocked (e.g., CORS
// or permission issues) we fall back to an inlined, optimized data URL so the UI
// can still persist and render the logo.
export async function uploadLogoWithFallback(
  file,
  userId,
  { maxSize = 640, quality = 0.82, targetBytes = 900_000 } = {}
) {
  if (!file || !userId) {
    throw new Error("File and userId are required to upload a logo.");
  }

  try {
    const url = await uploadLogoAndGetURL(file, userId);
    return { url, storedInStorage: true };
  } catch (storageError) {
    console.error("Storage upload failed, falling back to data URL:", storageError);

    const dataUrl = await fileToCappedDataUrl(file, {
      maxSize,
      quality,
      targetBytes,
    });
    return { url: dataUrl, storedInStorage: false, originalError: storageError };
  }
}
