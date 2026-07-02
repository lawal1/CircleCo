const API_BASE = 'http://localhost:5000/api'; // Update to production URL

async function apiCall(endpoint, options = {}) {
  const user = firebase.auth().currentUser;
  const token = user ? await user.getIdToken() : null;
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers,
  };
  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
async function getCurrentUser() {
  return apiCall('/users/me');
}
// Admin endpoints
async function getMembers() {
  return apiCall('/members');
}
async function createMember(data) {
  return apiCall('/members', { method: 'POST', body: JSON.stringify(data) });
}
async function bulkUploadMembers(formData) {
  const user = firebase.auth().currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(`${API_BASE}/members/bulk`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  return res.json();
}
async function getDashboardStats() {
  return apiCall('/cooperatives/dashboard');
}
async function getTransactions() {
  return apiCall('/transactions');
}

// Member endpoints
async function getVirtualAccount() {
  return apiCall('/virtual-accounts/me');
}
async function getSavingsBalance() {
  return apiCall('/savings/me');
}
async function getLoanEligibility() {
  return apiCall('/loans/eligibility');
}
async function requestLoan(data) {
  return apiCall('/loans/request', { method: 'POST', body: JSON.stringify(data) });
}