async function login(email, password) {
  try {
    const cred = await firebase.auth().signInWithEmailAndPassword(email, password);
    return cred.user;
  } catch (error) {
    throw new Error(error.message);
  }
}

async function registerCooperative(data) {
  const res = await fetch('/api/cooperatives', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'Registration failed');
  if (result.token) {
    await firebase.auth().signInWithCustomToken(result.token);
  }
  return result;
}

async function logout() {
  await firebase.auth().signOut();
  window.location.href = 'login.html';
}

async function checkAuth() {
  return new Promise((resolve, reject) => {
    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) {
        window.location.href = 'login.html';
        reject();
      } else {
        resolve(user);
      }
    });
  });
}