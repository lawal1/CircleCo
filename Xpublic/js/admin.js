async function loadAdminDashboard() {
  const stats = await getDashboardStats();
  document.getElementById('totalMembers').textContent = stats.totalMembers || 0;
  document.getElementById('totalSavings').textContent = `₦${stats.totalSavings || 0}`;
  document.getElementById('pendingLoans').textContent = stats.pendingLoans || 0;
  document.getElementById('activeLoans').textContent = stats.activeLoans || 0;
  const list = document.getElementById('recentTransactions');
  if (stats.recentTransactions) {
    list.innerHTML = stats.recentTransactions.slice(0, 5).map(t =>
      `<li class="list-group-item">${t.type} - ₦${t.amount} (${t.status})</li>`
    ).join('');
  }
}
async function checkAdminRole() {
  try {
    const user = await getCurrentUser();
    if (user.role !== 'admin' && user.role !== 'superadmin') {
      window.location.href = 'member-dashboard.html';
    }
  } catch (error) {
    window.location.href = 'login.html';
  }
}

async function loadMembers() {
  const members = await getMembers();
  const tbody = document.getElementById('membersBody');
  tbody.innerHTML = members.map(m => `
    <tr>
      <td>${m.memberId || '-'}</td>
      <td>${m.fullName}</td>
      <td>${m.phone}</td>
      <td>${m.email || '-'}</td>
      <td>₦${m.balance || 0}</td>
      <td><button class="btn btn-sm btn-outline-secondary">View</button></td>
    </tr>
  `).join('');
}

async function loadTransactions() {
  const tx = await getTransactions();
  const tbody = document.getElementById('txBody');
  tbody.innerHTML = tx.map(t => `
    <tr>
      <td>${t.createdAt ? new Date(t.createdAt.seconds * 1000).toLocaleDateString() : '-'}</td>
      <td>${t.type}</td>
      <td>₦${t.amount}</td>
      <td>${t.status}</td>
      <td>${t.reference || '-'}</td>
    </tr>
  `).join('');
}