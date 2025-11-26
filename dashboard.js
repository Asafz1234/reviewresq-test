import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDdwnrO8RKn1ER5J3pyFbr69P9GjvR7CZ8",
  authDomain: "reviewresq-app.firebaseapp.com",
  projectId: "reviewresq-app",
  storageBucket: "reviewresq-app.firebasestorage.app",
  messagingSenderId: "863497920392",
  appId: "1:863497920392:web:ca99060b42a50711b9e43d",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

window.logout = function () {
  signOut(auth).then(() => {
    window.location.href = "login.html";
  });
};

// Load dashboard
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const uid = user.uid;

  const docRef = doc(db, "businesses", uid);
  const snap = await getDoc(docRef);

  if (!snap.exists()) {
    alert("Business profile missing.");
    return;
  }

  const data = snap.data();
  document.getElementById("welcomeTitle").innerHTML = `Welcome back, ${data.businessName}`;

  const reviews = data.reviews || [];

  document.getElementById("kpiTotal").innerText = reviews.length;

  const bad = reviews.filter(r => r.rating <= 3).length;
  document.getElementById("kpiBad").innerText = bad;

  const positive = reviews.filter(r => r.rating >= 4).length;
  const positiveRate = reviews.length ? Math.round((positive / reviews.length) * 100) : 0;
  document.getElementById("kpiPositive").innerText = positiveRate + "%";

  // Fill table
  const tbody = document.getElementById("reviewsTableBody");
  tbody.innerHTML = "";

  reviews.forEach(r => {
    const row = `
      <tr>
        <td>${r.reviewerName}</td>
        <td>${r.email || "-"}</td>
        <td>${r.rating}</td>
        <td>${r.comment}</td>
        <td>${r.date}</td>
      </tr>`;
    tbody.innerHTML += row;
  });

  // Load charts
  loadCharts(reviews);
});

// Charts
function loadCharts(reviews) {
  const starCounts = [0,0,0,0,0];
  reviews.forEach(r => starCounts[r.rating - 1]++);

  new Chart(document.getElementById("starChart"), {
    type: "bar",
    data: {
      labels: ["1★", "2★", "3★", "4★", "5★"],
      datasets: [{
        label: "Ratings",
        backgroundColor: "#1a73e8",
        data: starCounts
      }]
    }
  });

  const pos = reviews.filter(r => r.rating >= 4).length;
  const neg = reviews.filter(r => r.rating <= 3).length;

  new Chart(document.getElementById("pieChart"), {
    type: "pie",
    data: {
      labels: ["Positive", "Negative"],
      datasets: [{
        data: [pos, neg],
        backgroundColor: ["#43a047", "#e53935"]
      }]
    }
  });

  // fake monthly growth example
  new Chart(document.getElementById("lineChart"), {
    type: "line",
    data: {
      labels: ["Jan","Feb","Mar","Apr","May","Jun"],
      datasets: [{
        label: "Monthly Reviews",
        borderColor: "#1a73e8",
        data: [5, 8, 12, 18, 14, reviews.length]
      }]
    }
  });
}

feather.replace();

import QRCode from "https://cdn.jsdelivr.net/npm/qrcode@1.5.1/build/qrcode.esm.js";

window.copyLink = function () {
  const link = document.getElementById("reviewLink");
  link.select();
  navigator.clipboard.writeText(link.value);
  alert("Link copied!");
};

window.showQR = function () {
  document.getElementById("qrModal").style.display = "block";

  const canvas = document.getElementById("qrCanvas");
  const link = document.getElementById("reviewLink").value;

  QRCode.toCanvas(canvas, link, { width: 250 });
};

window.closeQR = function () {
  document.getElementById("qrModal").style.display = "none";
};

window.shareWhatsapp = function () {
  const link = document.getElementById("reviewLink").value;
  window.open("https://wa.me/?text=" + encodeURIComponent(link));
};

window.shareSMS = function () {
  const link = document.getElementById("reviewLink").value;
  window.location.href = "sms:?body=" + encodeURIComponent(link);
};
