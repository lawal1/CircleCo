(async function loadMember() {
  if (!getToken()) return;

  // Check first login
  const params = new URLSearchParams(window.location.search);
  if (params.get('first') === 'true') {
    document.getElementById('pinSetup').style.display = 'block';
  }

  // PIN setup
  document.getElementById('pinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = document.getElementById('pinInput').value;
    if (!/^\d{4}$/.test(pin)) {
      document.getElementById('pinResult').innerHTML = '<div class="alert alert-danger">PIN must be 4 digits</div>';
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/auth/change-pin`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      document.getElementById('pinSetup').style.display = 'none';
      document.getElementById('pinResult').innerHTML = '<div class="alert alert-success">PIN set! Reloading...</div>';
      setTimeout(() => window.location.href = '/member.html', 1000);
    } catch (err) {
      document.getElementById('pinResult').innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
  });

  // Load profile & transactions
  await loadProfile();
  await loadTransactions();

  // ---- Card Linking ----
  document.getElementById('cardForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const cardNumber = document.getElementById('cardNumber').value.trim();
    const expiry = document.getElementById('cardExpiry').value.trim();
    const cvv = document.getElementById('cardCvv').value.trim();
    const resultEl = document.getElementById('cardResult');

    if (!cardNumber || !expiry || !cvv) {
      resultEl.innerHTML = '<div class="alert alert-danger">Please fill all fields</div>';
      return;
    }

    // Simulate tokenization (in production, use Nomba's JS SDK)
    const mockToken = `mock_token_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    try {
      const res = await fetch(`${API_BASE}/member/card/link`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ cardToken: mockToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      resultEl.innerHTML = '<div class="alert alert-success">Card linked successfully!</div>';
      setTimeout(() => {
        document.querySelector('#cardModal .btn-close').click();
        loadProfile();
      }, 1500);
    } catch (err) {
      resultEl.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
  });

  // ---- Recurring Savings ----
  document.getElementById('recurringForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = document.getElementById('recAmount').value;
    const day = document.getElementById('recDay').value;
    const resultEl = document.getElementById('recResult');

    try {
      const res = await fetch(`${API_BASE}/member/card/recurring`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ amount: parseFloat(amount), dayOfMonth: parseInt(day) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      resultEl.innerHTML = `<div class="alert alert-success">Recurring savings set! ₦${amount} on day ${day} each month.</div>`;
    } catch (err) {
      resultEl.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
  });

  // ---- Loan Apply ----
  document.getElementById('loanApplyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = document.getElementById('loanAmount').value;
    const resultEl = document.getElementById('loanApplyResult');
    try {
      const res = await fetch(`${API_BASE}/member/loan-apply`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ amountRequested: parseFloat(amount) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      resultEl.innerHTML = `<div class="alert alert-success">Application submitted!</div>`;
    } catch (err) {
      resultEl.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
    }
  });

  // ---- Logout ----
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);
})();

async function loadProfile() {
  try {
    const res = await fetch(`${API_BASE}/member/profile`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to load profile');
    const data = await res.json();

    document.getElementById('memberName').textContent = `${data.firstName} ${data.lastName}`;
    document.getElementById('memberPhone').textContent = data.phone;
    document.getElementById('memberVirtualAccount').textContent = `Account: ${data.virtualAccountNumber || 'Not available'}`;
    document.getElementById('memberBalance').textContent = (data.totalBalance || 0).toFixed(2);
    document.getElementById('memberMonths').textContent = `${data.monthsSaved || 0} months`;

    // Eligibility
    const eligEl = document.getElementById('memberEligibility');
    if (data.isEligible) {
      eligEl.textContent = '✅ Eligible for Loan';
      eligEl.className = 'badge bg-success mt-2';
      document.getElementById('loanEligibilityMsg').innerHTML = '<div class="alert alert-success">You are eligible! Apply below.</div>';
      document.getElementById('applyLoanBtn').disabled = false;
    } else {
      eligEl.textContent = '❌ Not Eligible';
      eligEl.className = 'badge bg-danger mt-2';
      document.getElementById('loanEligibilityMsg').innerHTML = '<div class="alert alert-danger">You need more savings months to be eligible.</div>';
      document.getElementById('applyLoanBtn').disabled = true;
    }

    // Card status
    const cardStatusEl = document.getElementById('cardStatus');
    if (data.linkedCardToken) {
      cardStatusEl.innerHTML = '<span class="badge bg-success">Card linked</span>';
      document.getElementById('setRecurringBtn').disabled = false;
    } else {
      cardStatusEl.innerHTML = '<span class="badge bg-secondary">No card linked</span>';
      document.getElementById('setRecurringBtn').disabled = true;
    }

    // If there's already a recurring setup, show it
    if (data.recurringSavingsAmount && data.recurringSavingsDayOfMonth) {
      document.getElementById('recAmount').value = data.recurringSavingsAmount;
      document.getElementById('recDay').value = data.recurringSavingsDayOfMonth;
    }
  } catch (err) {
    console.error(err);
  }
}

async function loadTransactions() {
  try {
    const res = await fetch(`${API_BASE}/member/savings`, { headers: getHeaders() });
    if (!res.ok) return;
    const txns = await res.json();
    const tbody = document.getElementById('txnBody');
    tbody.innerHTML = txns.slice(-10).reverse().map(t => `
      <tr>
        <td>₦${t.amount}</td>
        <td>${t.type}</td>
        <td><span class="badge bg-${t.status === 'successful' ? 'success' : 'warning'}">${t.status}</span></td>
        <td>${new Date(t.createdAt).toLocaleDateString()}</td>
      </tr>
    `).join('');
  } catch (err) {}
}