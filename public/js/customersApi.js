import {
  db,
  collection,
  query,
  onSnapshot,
  orderBy,
  functions,
  httpsCallable,
} from "../firebase-config.js";

const createCustomerManualCallable = httpsCallable(functions, "createCustomerManual");
const bulkCreateCustomersCallable = httpsCallable(functions, "bulkCreateCustomersAndSend");

export function subscribeCustomers({ businessId, onChange }) {
  if (!businessId) throw new Error("Missing business id for customers");
  const q = query(collection(db, "businesses", businessId, "customers"), orderBy("createdAt", "desc"));
  return onSnapshot(q, onChange);
}

export async function createCustomer({ businessId, name, email, phone, notes, reviewStatus = "none" }) {
  if (!businessId) throw new Error("Missing business id for customer create");
  const response = await createCustomerManualCallable({
    businessId,
    name,
    email,
    phone,
    notes,
    reviewStatus,
  });
  if (!response?.data?.ok) {
    throw new Error(response?.data?.error || "Unable to create customer");
  }
  return response.data;
}

export async function bulkCreateCustomersAndSend({
  businessId,
  rows = [],
  channel = "email",
  excludeInvalid = true,
  source = "bulk_upload",
}) {
  if (!businessId) throw new Error("Missing business id for bulk send");
  const response = await bulkCreateCustomersCallable({
    businessId,
    rows,
    channel,
    excludeInvalid,
    source,
  });
  if (!response?.data?.ok) {
    throw new Error(response?.data?.error || "Unable to process bulk send");
  }
  return response.data;
}
