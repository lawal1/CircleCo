(async function loadAdmin() {
  if (!getToken()) return;

  // Navigation
  document.querySelectorAll('[data-section]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const section = link.dataset.section;
      document.querySelectorAll('[id^="section-"]').forEach((el) => (el.style.display = 'none'));
      document.getElementById(`section-${section}`).style.display = 'block';
      document.querySelectorAll('[data-section]').forEach((l) => l.classList.remove('active'));
      link.classList.add('active');
    });
  });

  // Load dashboard by default
  await loadDashboard();
  await loadMembers();
  await loadLoanApps();
  await loadRule();

  // Search
  document.getElementById('memberSearch').addEventListener('input', (e) => loadMembers(e.target.value));
  document.getElementById('memberSearchFull').addEventListener('input', (e) => loadMembers(e.target.value));

  // Onboard single
  document.getElementById('onboardForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      firstName: document.getElementById('oFirstName').value.trim(),
      lastName: document.getElementById('oLastName').value.trim(),
      phone: document.getElementById('oPhone').value.trim(),
      monthsSaved: document.getElementById('oMonths').value || 0,
      currentBalance: document.getElementById('oBalance').value || 0,
    };
    try {
      const res = await fetch(`${API_BASE}/admin/members/onboard`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data),
      });
      const result = await res.json();
      document.getElementById('onboardResult').innerHTML = res.ok
        ? `<div class="alert alert-success">Login detail will be sent to member with the hour</div>`
        : `<div class="alert alert-danger">${result.error}</div>`;
      if (res.ok) { loadMembers(); loadDashboard(); }
    } catch (err) {
      document.getElementById('onboardResult').innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
  });

  // Bulk upload
  document.getElementById('bulkForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = document.getElementById('bulkFile').files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`${API_BASE}/admin/members/bulk`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: formData,
      });
      const result = await res.json();
      document.getElementById('bulkResult').innerHTML = `<pre class="alert alert-info">${JSON.stringify(result, null, 2)}</pre>`;
      if (res.ok) { loadMembers(); loadDashboard(); }
    } catch (err) {
      document.getElementById('bulkResult').innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
  });

  // Loan rules
  document.getElementById('ruleForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const minMonths = document.getElementById('minMonths').value;
    try {
      const res = await fetch(`${API_BASE}/admin/loan-rules`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ minMonthsSaved: parseInt(minMonths) }),
      });
      const data = await res.json();
      document.getElementById('ruleStatus').innerHTML = res.ok
        ? `<div class="alert alert-success">Rule updated to ${data.minMonthsSaved} months</div>`
        : `<div class="alert alert-danger">${data.error}</div>`;
    } catch (err) {
      document.getElementById('ruleStatus').innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
  });
})();

async function loadDashboard() {
  const members = await fetchMembers();
  document.getElementById('statMembers').textContent = members.length;
  const totalSavings = members.reduce((sum, m) => sum + (m.totalBalance || 0), 0);
  document.getElementById('statSavings').textContent = `₦${totalSavings.toFixed(2)}`;
  const apps = await fetchLoanApps();
  document.getElementById('statPendingLoans').textContent = apps.filter(a => a.status === 'pending').length;
  const eligible = members.filter(m => m.isEligible).length;
  document.getElementById('statEligible').textContent = eligible;
}

async function fetchMembers(search = '') {
  const res = await fetch(`${API_BASE}/admin/members?search=${encodeURIComponent(search)}`, { headers: getHeaders() });
  return res.ok ? await res.json() : [];
}

async function loadMembers(search = '') {
  const members = await fetchMembers(search);
  const render = (tbodyId) => {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = members.map(m => `
      <tr>
        <td>${m.firstName} ${m.lastName}</td>
        <td>${m.phone}</td>
        <td>₦${(m.totalBalance || 0).toFixed(2)}</td>
        <td>${m.monthsSaved || 0}</td>
        <td><span class="badge ${m.isEligible ? 'bg-success' : 'bg-danger'}">${m.isEligible ? 'Yes' : 'No'}</span></td>
      </tr>
    `).join('');
  };
  render('memberTableBody');
  render('memberTableFull');
}

async function fetchLoanApps() {
  const res = await fetch(`${API_BASE}/admin/loan-applications`, { headers: getHeaders() });
  return res.ok ? await res.json() : [];
}

async function loadLoanApps() {
  const apps = await fetchLoanApps();
  const tbody = document.getElementById('loanAppsBody');
  tbody.innerHTML = apps.map(a => `
    <tr>
      <td>${a.memberId}</td>
      <td>₦${a.amountRequested}</td>
      <td><span class="badge bg-${a.status === 'approved' ? 'success' : a.status === 'pending' ? 'warning' : 'secondary'}">${a.status}</span></td>
      <td>
        <select class="form-select form-select-sm status-update" data-id="${a.id}">
          <option value="pending" ${a.status==='pending'?'selected':''}>Pending</option>
          <option value="additional_docs_requested" ${a.status==='additional_docs_requested'?'selected':''}>Need Docs</option>
          <option value="approved" ${a.status==='approved'?'selected':''}>Approve</option>
          <option value="rejected" ${a.status==='rejected'?'selected':''}>Reject</option>
        </select>
      </td>
    </tr>
  `).join('');

  document.querySelectorAll('.status-update').forEach((sel) => {
    sel.addEventListener('change', async (e) => {
      const id = sel.dataset.id;
      const status = sel.value;
      await fetch(`${API_BASE}/admin/loan-applications/${id}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ status }),
      });
      loadLoanApps();
      loadDashboard();
    });
  });
}

async function loadRule() {
  const res = await fetch(`${API_BASE}/admin/loan-rules`, { headers: getHeaders() });
  if (res.ok) {
    const data = await res.json();
    document.getElementById('minMonths').value = data.minMonthsSaved || 0;
  }
}