// =========================
// Firebase imports
// =========================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// =========================
// Firebase config
// =========================
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

// =========================
// Logout
// =========================
window.logout = function () {
  signOut(auth).then(() => {
    window.location.href = "login.html";
  });
};

// =========================
// Load dashboard data
// =========================
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const uid = user.uid;

  // שים את הלינק האישי לשדה
  const linkInput = document.getElementById("reviewLink");
  if (linkInput) {
    linkInput.value = `https://reviewresq.com/demo?id=${uid}`;
  }

  const docRef = doc(db, "businesses", uid);
  const snap = await getDoc(docRef);

  if (!snap.exists()) {
    console.warn("Business profile missing in Firestore");
    return;
  }

  const data = snap.data();

  // כותרת Welcome
  const welcomeTitle = document.getElementById("welcomeTitle");
  if (welcomeTitle) {
    welcomeTitle.innerText = `Welcome back, ${data.name || "Business Owner"}`;
  }

  // Branding – טעינה לטופס (אם קיים)
  if (data.branding) {
    const { primaryColor, buttonColor, backgroundColor } = data.branding;

    const primary = document.getElementById("primaryColor");
    const btn = document.getElementById("buttonColor");
    const bg = document.getElementById("backgroundColor");

    if (primary && primaryColor) primary.value = primaryColor;
    if (btn && buttonColor) btn.value = buttonColor;
    if (bg && backgroundColor) bg.value = backgroundColor;
  }

  // Reviews
  const reviews = data.reviews || [];

  // KPI cards
  const totalEl = document.getElementById("kpiTotal");
  const badEl = document.getElementById("kpiBad");
  const positiveEl = document.getElementById("kpiPositive");
  const growthEl = document.getElementById("kpiGrowth");

  const total = reviews.length;
  const bad = reviews.filter((r) => r.rating <= 3).length;
  const positive = reviews.filter((r) => r.rating >= 4).length;
  const positiveRate = total ? Math.round((positive / total) * 100) : 0;

  if (totalEl) totalEl.innerText = total;
  if (badEl) badEl.innerText = bad;
  if (positiveEl) positiveEl.innerText = positiveRate + "%";
  if (growthEl) growthEl.innerText = "+0%"; // כרגע סטטי

  // טבלת ביקורות
  const tbody = document.getElementById("reviewsTableBody");
  if (tbody) {
    tbody.innerHTML = "";
    reviews.forEach((r) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${r.reviewerName || "-"}</td>
        <td>${r.email || "-"}</td>
        <td>${r.rating || "-"}</td>
        <td>${r.comment || "-"}</td>
        <td>${r.date || "-"}</td>
      `;
      tbody.appendChild(row);
    });
  }

  // גרפים
  loadCharts(reviews);
});

// =========================
// Charts
// =========================
function loadCharts(reviews) {
  // אם Chart.js לא נטען – לא נפליל את העמוד
  if (typeof Chart === "undefined") {
    console.warn("Chart.js not loaded – skipping charts");
    return;
  }

  const starCtx = document.getElementById("starChart");
  const pieCtx = document.getElementById("pieChart");
  const lineCtx = document.getElementById("lineChart");

  if (!starCtx || !pieCtx || !lineCtx) {
    console.warn("Chart canvas elements not found");
    return;
  }

  // בר התפלגות כוכבים
  const starCounts = [0, 0, 0, 0, 0];
  reviews.forEach((r) => {
    if (r.rating >= 1 && r.rating <= 5) {
      starCounts[r.rating - 1]++;
    }
  });

  new Chart(starCtx, {
    type: "bar",
    data: {
      labels: ["1★", "2★", "3★", "4★", "5★"],
      datasets: [
        {
          label: "Ratings",
          backgroundColor: "#38bdf8",
          borderRadius: 6,
          data: starCounts,
        },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });

  // פאי חיובי / שלילי
  const pos = reviews.filter((r) => r.rating >= 4).length;
  const neg = reviews.filter((r) => r.rating <= 3).length;

  new Chart(pieCtx, {
    type: "pie",
    data: {
      labels: ["Positive", "Negative"],
      datasets: [
        {
          data: [pos, neg],
          backgroundColor: ["#22c55e", "#ef4444"],
        },
      ],
    },
  });

  // קו – כרגע דמיוני
  new Chart(lineCtx, {
    type: "line",
    data: {
      labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
      datasets: [
        {
          label: "Monthly Reviews",
          borderColor: "#38bdf8",
          backgroundColor: "rgba(56,189,248,0.2)",
          tension: 0.3,
          fill: true,
          data: [2, 4, 8, 10, 12, reviews.length || 5],
        },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });
}

// =========================
// QR + Share + PDF
// =========================

// Copy link
window.copyLink = function () {
  const link = document.getElementById("reviewLink");
  if (!link) return;

  link.select();
  link.setSelectionRange(0, 99999);
  navigator.clipboard.writeText(link.value);
  alert("Link copied!");
};

// Show QR modal
window.showQR = function () {
  const modal = document.getElementById("qrModal");
  const canvas = document.getElementById("qrCanvas");
  const link = document.getElementById("reviewLink")?.value;

  if (!modal || !canvas || !link) return;

  modal.style.display = "flex";

  // QRCode כ-ESM
  import("https://cdn.jsdelivr.net/npm/qrcode@1.5.1/build/qrcode.esm.js").then(
    (module) => {
      module.default.toCanvas(canvas, link, { width: 220 });
    }
  );
};

window.closeQR = function () {
  const modal = document.getElementById("qrModal");
  if (modal) modal.style.display = "none";
};

// Share via WhatsApp
window.shareWhatsapp = function () {
  const link = document.getElementById("reviewLink")?.value;
  if (!link) return;
  window.open("https://wa.me/?text=" + encodeURIComponent(link));
};

// Share via SMS
window.shareSMS = function () {
  const link = document.getElementById("reviewLink")?.value;
  if (!link) return;
  window.location.href = "sms:?body=" + encodeURIComponent(link);
};

// Download QR as PNG
window.downloadQR = function () {
  const canvas = document.getElementById("qrCanvas");
  if (!canvas) {
    alert("Please click 'Show QR Code
