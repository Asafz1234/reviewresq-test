// Firebase connection file

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzAsyDw0nnO8Rkn1ER5J3pyFbr6GPPGjvR7CzB",
  authDomain: "reviewresq-app.firebaseapp.com",
  projectId: "reviewresq-app",
  storageBucket: "reviewresq-app.appspot.com",
  messagingSenderId: "863497920392",
  appId: "1:863497920392:web:ca99060b42a50711b9e43d"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

console.log("Firebase Connected!");
