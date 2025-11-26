// =======================
// IMPORTS
// =======================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import QRCode from "https://cdn.jsdelivr.net/npm/qrcode@1.5.1/build/qrcode.esm.js";

// =======================
// FIREBASE CONFIG
// =======================
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

// =======================
// LOGOUT
// =======================
window.logout = function () {
  signOut(auth).then(() => {
    window.location.href = "login.html";
  });
};

// =======================
// LOAD DASHBOARD
// =======================
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const uid = user.uid;

  // Set the user's personal review link in the dashboard
  const reviewLinkInput = document.getElementById("reviewLink");
  if (reviewLinkInput) {
    reviewLinkInput.value = `https://reviewresq.com/review/?id=${uid}`;
  }

  const docRef = doc(db, "businesses", uid);
  const snap = await getDoc(docRef);

  if (!snap.exists()) {
    alert("Business profile missing.");
    return;
  }

  const data = snap.data();

  // Load branding settings into the form (if exists)
  if (data.branding) {
    if (document.getElementById("primaryColor")) {
      document.getElementById("primaryColor").value =
        data.branding.primaryColor || "#2563eb";
    }

    if (document.getElementById("buttonColor")) {
      document.getElementById("buttonColor").value =
        data.branding.buttonColor || "#2563eb";
    }

    if (document.getElementById("backgroundColor")) {
      document.getElementById("backgroundColor").value =
        data.branding.backgroundColor || "#ffffff";
    }
  }

  // Welcome title
  if (document.getElementById("welcomeTitle")) {
    document.getElementById("welcomeTitle").innerHTML =
      `Welcome back, ${data.businessName}`;
  }

  const reviews = data.reviews || [];

  // KPIs
  document.getElementById("kpiTotal").innerText = reviews.length;

  const bad = reviews.filter(r => r.rating <= 3).length;
  document.getElementById("kpiBad").innerText = bad;

  const positive = reviews.filter(r => r.rating >= 4).length;
  const positiveRate = reviews.length ? Math.round((positive / reviews.length) * 100) : 0;
  document.getElementById("kpiPositive").innerText = positiveRate + "%";

  // Fill table
  const tbody = document.getElementById("reviewsTableBody");
  if (tbody) {
    tbody.innerHTML = "";

    reviews.forEach(r => {
      const row = `
        <tr>
          <td>${r.reviewerName || "-"}</td>
          <td>${r.email || "-"}</td>
          <td>${r.rating}</td>
          <td>${r.comment}</td>
          <td>${r.date}</td>
        </tr>`;
      tbody.innerHTML += row;
    });
  }

  // Load charts
  loadCharts(reviews);
});

// =======================
// CHARTS
// =======================
function loadCharts(reviews) {
  const starCounts = [0, 0, 0, 0, 0];
  reviews.forEach(r => {
    if (r.rating >= 1 && r.rating <= 5) {
      starCounts[r.rating - 1]++;
    }
  });

  // Bar: stars
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

  // Pie: positive vs negative
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

  // Line: monthly growth (demo)
  new Chart(document.getElementById("lineChart"), {
    type: "line",
    data: {
      labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
      datasets: [{
        label: "Monthly Reviews",
        borderColor: "#1a73e8",
        data: [5, 8, 12, 18, 14, reviews.length]
      }]
    }
  });
}

// =======================
// ICONS
// =======================
feather.replace();

// =======================
// QR + LINK FUNCTIONS
// =======================
window.copyLink = function () {
  const link = document.getElementById("reviewLink");
  if (!link) return;
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

window.downloadQR = function () {
  const canvas = document.getElementById("qrCanvas");
  const pngUrl = canvas.toDataURL("image/png");

  const downloadLink = document.createElement("a");
  downloadLink.href = pngUrl;
  downloadLink.download = "review-qr.png";
  downloadLink.click();
};

window.downloadPDF = async function () {
  const { jsPDF } = window.jspdf;

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "a4"
  });

  const canvas = document.getElementById("qrCanvas");
  const qrData = canvas.toDataURL("image/png");

  // Title
  pdf.setFontSize(24);
  pdf.setTextColor(30, 80, 200);
  pdf.text("ReviewResQ - Your Feedback QR", 40, 60);

  // QR Code
  pdf.addImage(qrData, "PNG", 40, 100, 200, 200);

  // Link text
  const link = document.getElementById("reviewLink").value;
  pdf.setFontSize(14);
  pdf.setTextColor(60, 60, 60);
  pdf.text("Your personal review link:", 40, 340);
  pdf.text(link, 40, 360);

  // Footer
  pdf.setFontSize(12);
  pdf.setTextColor(150, 150, 150);
  pdf.text("Powered by ReviewResQ", 40, 800);

  pdf.save("ReviewResQ-QR.pdf");
};

// =======================
// SAVE BRANDING
// =======================
window.saveBranding = async function () {
  const uid = auth.currentUser.uid;
  const docRef = doc(db, "businesses", uid);

  const primary = document.getElementById("primaryColor").value;
  const buttonColor = document.getElementById("buttonColor").value;
  const bgColor = document.getElementById("backgroundColor").value;

  try {
    await updateDoc(docRef, {
      branding: {
        primaryColor: primary,
        buttonColor: buttonColor,
        backgroundColor: bgColor
      }
    });

    alert("Branding updated successfully!");
  } catch (err) {
    console.error("Branding update error:", err);
    alert("Error saving branding");
  }
};
