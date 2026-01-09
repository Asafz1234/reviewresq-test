const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

const HEADER_ALIASES = {
  name: ["name", "customer", "customer name", "full name"],
  email: ["email", "email address"],
  phone: ["phone", "phone number", "mobile", "cell"],
  notes: ["notes", "note", "comments", "comment"],
};

function normalizeHeader(value = "") {
  return value.toString().trim().toLowerCase();
}

function resolveColumn(row, field) {
  const aliases = HEADER_ALIASES[field] || [];
  const keys = Object.keys(row || {});
  const match = keys.find((key) => aliases.includes(normalizeHeader(key)));
  return match ? row[match] : "";
}

function normalizePhone(value = "") {
  const digits = value.toString().replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }
  return digits;
}

function isValidEmail(value = "") {
  const email = value.toString().trim().toLowerCase();
  if (!email) return false;
  return EMAIL_REGEX.test(email);
}

function isValidPhone(value = "") {
  const digits = value.toString().replace(/\D+/g, "");
  if (!digits) return false;
  if (digits.length === 10) return true;
  return digits.length === 11 && digits.startsWith("1");
}

function normalizeRow(row = {}) {
  const name = (resolveColumn(row, "name") || "").toString().trim();
  const email = (resolveColumn(row, "email") || "").toString().trim().toLowerCase();
  const phone = normalizePhone(resolveColumn(row, "phone") || "");
  const notes = (resolveColumn(row, "notes") || "").toString().trim();
  return { name, email, phone, notes };
}

function validateRow(row) {
  const errors = [];
  if (!row.name) {
    errors.push("Missing name");
  }

  const hasEmail = Boolean(row.email);
  const hasPhone = Boolean(row.phone);
  const validEmail = hasEmail ? isValidEmail(row.email) : false;
  const validPhone = hasPhone ? isValidPhone(row.phone) : false;

  if (!hasEmail && !hasPhone) {
    errors.push("Missing email/phone");
  }

  if (hasEmail && !validEmail && !validPhone) {
    errors.push("Invalid email");
  }

  if (hasPhone && !validPhone && !validEmail) {
    errors.push("Invalid phone");
  }

  const isValid = errors.length === 0;
  const status = isValid ? "Ready" : errors.join("; ");

  return { ...row, isValid, status };
}

function parseCsv(file) {
  return new Promise((resolve, reject) => {
    if (!window.Papa) {
      reject(new Error("CSV parser not available"));
      return;
    }

    window.Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve(results.data || []),
      error: (err) => reject(err),
    });
  });
}

function parseXlsx(file) {
  return new Promise((resolve, reject) => {
    if (!window.XLSX) {
      reject(new Error("Excel parser not available"));
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target.result);
        const workbook = window.XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rows = window.XLSX.utils.sheet_to_json(worksheet, { defval: "" });
        resolve(rows || []);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Unable to read file"));
    reader.readAsArrayBuffer(file);
  });
}

export async function parseCustomerFile(file) {
  if (!file) return [];
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv") {
    return parseCsv(file);
  }
  if (extension === "xlsx" || extension === "xls") {
    return parseXlsx(file);
  }
  throw new Error("Unsupported file type. Please upload CSV or XLSX.");
}

export function buildPreviewRows(rows = []) {
  return rows
    .map((row) => validateRow(normalizeRow(row)))
    .filter((row) => row.name || row.email || row.phone || row.notes);
}

export function renderPreviewTable(rows, tableBody) {
  if (!tableBody) return;
  tableBody.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const nameTd = document.createElement("td");
    const emailTd = document.createElement("td");
    const phoneTd = document.createElement("td");
    const statusTd = document.createElement("td");

    nameTd.textContent = row.name || "—";
    emailTd.textContent = row.email || "—";
    phoneTd.textContent = row.phone || "—";
    statusTd.textContent = row.status;
    statusTd.style.color = row.isValid ? "#047857" : "#b91c1c";

    tr.appendChild(nameTd);
    tr.appendChild(emailTd);
    tr.appendChild(phoneTd);
    tr.appendChild(statusTd);
    tableBody.appendChild(tr);
  });
}

export function countPreviewRows(rows = []) {
  const total = rows.length;
  const valid = rows.filter((row) => row.isValid).length;
  const invalid = total - valid;
  return { total, valid, invalid };
}
