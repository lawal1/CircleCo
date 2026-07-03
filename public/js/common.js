const API_BASE =
  window.location.hostname === 'localhost'
    ? 'http://localhost:5000/api'
    : '/api';

function getToken() {
  return localStorage.getItem('token');
}

function getHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getToken()}`,
  };
}

function handleLogout() {
  localStorage.clear();
  window.location.href = '/auth.html';   // also redirect to login on logout
}

// Auto‑redirect if no token, but skip on login pages
document.addEventListener('DOMContentLoaded', () => {
  const logoutBtns = document.querySelectorAll('#logoutBtn');
  logoutBtns.forEach((btn) => btn.addEventListener('click', handleLogout));

  // 🔁 Include auth.html as a safe page
  const isLoginPage =
    window.location.pathname === '/' ||
    window.location.pathname === '/index.html' ||
    window.location.pathname === '/auth.html';

  if (!getToken() && !isLoginPage) {
    window.location.href = '/auth.html';   // 👈 now redirects to the login page
  }
});