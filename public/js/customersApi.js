import { db } from '../firebase-config.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js';
import { collection, query, onSnapshot, orderBy } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const functions = getFunctions();

const createCustomerManualCallable = httpsCallable(functions, 'createCustomerManual');
const bulkCreateCustomersCallable = httpsCallable(functions, 'bulkCreateCustomersAndSend');

export function subscribeCustomers({ businessId, onChange }) {
  if (!businessId) throw new Error('Missing business id for customers');
  const q = query(collection(db, 'businesses', businessId, 'customers'), orderBy('createdAt', 'desc'));
  return onSnapshot(q, onChange);
}

export async function createCustomer(data) {
  return createCustomerManualCallable(data);
}

export async function bulkCreateCustomers(data) {
  return bulkCreateCustomersCallable(data);
}
