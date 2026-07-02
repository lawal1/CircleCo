async function loadMemberDashboard() {
  const user = firebase.auth().currentUser;
  const name = user.displayName || 'Member';
  document.getElementById('memberName').textContent = name;

  const va = await getVirtualAccount();
  document.getElementById('bankName').textContent = va.bankName || '-';
  document.getElementById('accountNumber').textContent = va.accountNumber || '-';
  document.getElementById('memberId').textContent = va.memberId || '-';

  const savings = await getSavingsBalance();
  document.getElementById('balance').textContent = `₦${savings.balance || 0}`;

  const eligibility = await getLoanEligibility();
  document.getElementById('eligibilityStatus').textContent = eligibility.eligible ? '✅ Eligible' : '❌ Not Eligible';

  const tx = await getTransactions();
  const list = document.getElementById('recentTx');
  list.innerHTML = tx.slice(0, 5).map(t =>
    `<li class="list-group-item">${t.type} - ₦${t.amount}</li>`
  ).join('');
}

function copyAccountNumber() {
  const num = document.getElementById('accountNumber').textContent;
  if (num && num !== '-') {
    navigator.clipboard.writeText(num);
    alert('Account number copied!');
  }
}

async function loadVirtualAccount() {
  const va = await getVirtualAccount();
  document.getElementById('vaBank').textContent = va.bankName || '-';
  document.getElementById('vaNumber').textContent = va.accountNumber || '-';
  document.getElementById('vaName').textContent = va.accountName || '-';
}

async function checkLoanEligibility() {
  const eligibility = await getLoanEligibility();
  const msg = document.getElementById('eligibilityMessage');
  if (eligibility.eligible) {
    msg.className = 'alert alert-success';
    msg.textContent = 'You are eligible for a loan!';
  } else {
    msg.className = 'alert alert-danger';
    msg.textContent = 'You are not eligible. Reason: ' + (eligibility.reason || '');
  }
}
async function checkMemberRole() {
  try {
    const user = await getCurrentUser();
    if (user.role === 'admin' || user.role === 'superadmin') {
      window.location.href = 'admin-dashboard.html';
    }
  } catch (error) {
    window.location.href = 'login.html';
  }
}