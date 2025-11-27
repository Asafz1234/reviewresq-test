import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyDdwnrO8RKn1ER5J3pyFbr69P9GjvR7CZ8",
  authDomain: "reviewresq-app.firebaseapp.com",
  projectId: "reviewresq-app",
  storageBucket: "reviewresq-app.firebasestorage.app",
  messagingSenderId: "863497920392",
  appId: "1:863497920392:web:ca99060b42a50711b9e43d"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Logout
window.logout = function () {
  signOut(auth).then(() => (window.location.href = "login.html"));
};

// Load Dashboard
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const uid = user.uid;
  const linkInput = document.getElementById("reviewLink");
  if (linkInput)
    linkInput.value = `https://reviewresq.com/review/?id=${uid}`;

  const docRef = doc(db, "businesses", uid);
  const snap = await getDoc(docRef);

  if (!snap.exists()) {
    alert("Business profile is missing in Firestore.");
    return;
  }

  const data = snap.data();

  const name = data.businessName || "Your Business";
  const welcome = document.getElementById("welcomeTitle");
  if (welcome) welcome.textContent = `Welcome back, ${name}!`;

  const reviews = data.reviews || [];
  document.getElementById("kpiTotal").innerText = reviews.length;
  document.getElementById("kpiBad").innerText = reviews.filter(r => r.rating <= 3).length;
  document.getElementById("kpiPositive").innerText = reviews.length ? 
    Math.round((reviews.filter(r => r.rating >= 4).length / reviews.length) * 100) + "%" : "0%";
  document.getElementById("kpiGrowth").innerText = "+0%";

  const tbody = document.getElementById("reviewsTableBody");
  tbody.innerHTML = "";
  reviews.forEach(r => {
    tbody.innerHTML += `
      <tr>
        <td>${r.reviewerName || "-"}</td>
        <td>${r.email || "-"}</td>
        <td>${r.rating || "-"}</td>
        <td>${r.comment || "-"}</td>
        <td>${r.date || "-"}</td>
      </tr>`;
  });

  loadCharts(reviews);
});

// Charts
function loadCharts(reviews) {
  if (typeof Chart === "undefined") return;

  const star = document.getElementById("starChart");
  const pie = document.getElementById("pieChart");
  const line = document.getElementById("lineChart");
  if (!star || !pie || !line) return;

  const stars = [0, 0, 0, 0, 0];
  reviews.forEach(r => (stars[r.rating - 1] = (stars[r.rating - 1] || 0) + 1));

  new Chart(star, {
    type: "bar",
    data: {
      labels: ["1★", "2★", "3★", "4★", "5★"],
      datasets: [{ data: stars, backgroundColor: "#3b82f6" }]
    },
    options: { scales: { y: { beginAtZero: true } } }
  });

  const pos = reviews.filter(r => r.rating >= 4).length;
  const neg = reviews.filter(r => r.rating <= 3).length;

  new Chart(pie, {
    type: "pie",
    data: {
      labels: ["Positive", "Negative"],
      datasets: [{ data: [pos, neg], backgroundColor: ["#22c55e", "#ef4444"] }]
    }
  });

  new Chart(line, {
    type: "line",
    data: {
      labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
      datasets: [{
        label: "Monthly Reviews",
        data: [2, 4, 6, 10, 8, reviews.length],
        borderColor: "#3b82f6",
        fill: true
      }]
    }
  });
}

// Copy & Share
window.copyLink = function () {
  const link = document.getElementById("reviewLink");
  if (!link) return;
  link.select();
  navigator.clipboard.writeText(link.value);
  alert("Copied!");
};

window.showQR = async function () {
  const modal = document.getElementById("qrModal");
  const canvas = document.getElementById("qrCanvas");
  const link = document.getElementById("reviewLink").value;
  modal.style.display = "flex";
  const QRCode = await import("https://cdn.jsdelivr.net/npm/qrcode@1.5.1/build/qrcode.esm.js");
  QRCode.default.toCanvas(canvas, link, { width: 200 });
};

window.closeQR = function () {
  document.getElementById("qrModal").style.display = "none";
};

window.shareWhatsapp = function () {
  const link = document.getElementById("reviewLink").value;
  window.open(`https://wa.me/?text=${encodeURIComponent(link)}`);
};

window.shareSMS = function () {
  const link = document.getElementById("reviewLink").value;
  window.location.href = `sms:?body=${encodeURIComponent(link)}`;
};

window.downloadQR = function () {
  const canvas = document.getElementById("qrCanvas");
  if (!canvas) return alert("Please show QR first.");
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = "review-qr.png";
  a.click();
};

window.downloadPDF = function () {
  if (!window.jspdf) return alert("PDF not loaded.");
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  const canvas = document.getElementById("qrCanvas");
  const img = canvas.toDataURL("image/png");
  pdf.text("ReviewResQ - Feedback QR", 20, 20);
  pdf.addImage(img, "PNG", 20, 40, 150, 150);
  pdf.save("ReviewResQ-QR.pdf");
};

window.saveBranding = async function () {
  const uid = auth.currentUser.uid;
  const ref = doc(db, "businesses", uid);
  const primary = document.getElementById("primaryColor").value;
  const button = document.getElementById("buttonColor").value;
  const bg = document.getElementById("backgroundColor").value;
  await updateDoc(ref, { branding: { primaryColor: primary, buttonColor: button, backgroundColor: bg } });
  alert("Branding saved!");
};
