// app.js - CircleCo Backend (Node.js + Express + Firebase Realtime Database)
// Run: npm install express cors helmet bcrypt jsonwebtoken firebase-admin xlsx multer axios uuid dotenv
// Then: node app.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
const XLSX = require('xlsx');
const multer = require('multer');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const path = require('path');

// ------------------------------------------------------------------
// 1. ENVIRONMENT & CONFIG
// ------------------------------------------------------------------
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_in_production';
const SALT_ROUNDS = 10;

// Firebase Admin SDK initialization
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}
const db = admin.database();

// Nomba config
const NOMBA_BASE_URL = process.env.NOMBA_BASE_URL || 'https://sandbox.api.nomba.com/v1';
const NOMBA_ACCOUNT_ID = process.env.NOMBA_ACCOUNT_ID;
const NOMBA_CLIENT_ID = process.env.NOMBA_CLIENT_ID;
const NOMBA_CLIENT_SECRET = process.env.NOMBA_CLIENT_SECRET;
const NOMBA_WEBHOOK_SECRET = process.env.NOMBA_WEBHOOK_SECRET;

// Termii config
const TERMII_API_KEY = process.env.TERMII_API_KEY;
const TERMII_SENDER_ID = process.env.TERMII_SENDER_ID || 'CircleCo';

const JWT_EXPIRY = '7d';
let nombaAccessToken = null;
let nombaTokenExpiry = 0;

// ------------------------------------------------------------------
// 2. EXPRESS APP SETUP
// ------------------------------------------------------------------
const app = express();
// Disable CSP entirely (for demo, allows inline scripts)
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));
app.use(express.urlencoded({ extended: true }));

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const upload = multer({ storage: multer.memoryStorage() });

// ------------------------------------------------------------------
// 3. UTILITY FUNCTIONS
// ------------------------------------------------------------------
const hashString = async (plain) => bcrypt.hash(plain, SALT_ROUNDS);
const compareHash = async (plain, hash) => bcrypt.compare(plain, hash);
const generateTempPassword = () => String(Math.floor(100000 + Math.random() * 900000));
const generateToken = (payload) => jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
const verifyToken = (token) => {
  try { return jwt.verify(token, JWT_SECRET); } catch (e) { return null; }
};
const normalizePhone = (phone) => phone.trim();

// Firebase helpers
const ref = (path) => db.ref(path);
const set = (path, data) => ref(path).set(data);
const update = (path, data) => ref(path).update(data);
const get = (path) => ref(path).once('value').then(snap => snap.val());
const generateId = () => ref('temp').push().key;

// ------------------------------------------------------------------
// 4. NOMBA API CLIENT (with mock support)
// ------------------------------------------------------------------
async function getNombaToken() {
  if (process.env.MOCK_NOMBA === 'true') {
    console.log('[MOCK] Returning mock Nomba token');
    return 'mock_token';
  }

  const now = Date.now();
  if (nombaAccessToken && nombaTokenExpiry > now) return nombaAccessToken;
  try {
    const response = await axios.post(
      `${NOMBA_BASE_URL}/auth/token/issue`,
      {
        grant_type: 'client_credentials',
        client_id: NOMBA_CLIENT_ID,
        client_secret: NOMBA_CLIENT_SECRET,
      },
      {
        headers: {
          'accountId': NOMBA_ACCOUNT_ID,
          'Content-Type': 'application/json',
        },
      }
    );
    const { access_token, expires_in } = response.data.data;
    nombaAccessToken = access_token;
    nombaTokenExpiry = now + (expires_in - 60) * 1000;
    return nombaAccessToken;
  } catch (error) {
    console.error('Nomba token error:', error.response?.data || error.message);
    throw new Error('Nomba authentication failed');
  }
}

async function provisionNombaWallet(accountRef, accountName) {
  if (process.env.MOCK_NOMBA === 'true') {
    console.log(`[MOCK] Provisioning wallet for ${accountName} (ref: ${accountRef})`);
    return {
      walletId: `mock_wallet_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      virtualAccountNumber: `1234567890${Math.floor(100 + Math.random() * 900)}`,
      bankName: 'Nomba Mock Bank',
    };
  }

  const token = await getNombaToken();
  try {
    const payload = {
      accountRef,
      accountName,
      currency: 'NGN',
    };
    const response = await axios.post(`${NOMBA_BASE_URL}/accounts/virtual`, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        accountId: NOMBA_ACCOUNT_ID,
        'Content-Type': 'application/json',
      },
    });
    const vaData = response.data.data;
    return {
      walletId: vaData.accountHolderId || vaData.accountRef || `va_${Date.now()}`,
      virtualAccountNumber: vaData.bankAccountNumber,
      bankName: vaData.bankName || 'Nomba Bank',
    };
  } catch (error) {
    console.error('Nomba wallet provisioning error:', error.response?.data || error.message);
    if (process.env.FALLBACK_MOCK === 'true') {
      console.warn('[FALLBACK] Using mock wallet due to Nomba error');
      return {
        walletId: `fallback_wallet_${Date.now()}`,
        virtualAccountNumber: `9999999999`,
        bankName: 'Nomba Fallback Bank',
      };
    }
    throw new Error('Failed to create virtual wallet');
  }
}

function verifyNombaWebhookSignature(req) {
  if (process.env.MOCK_NOMBA === 'true') {
    return true; // allow mock webhooks during testing
  }
  const signature = req.headers['nomba-signature'];
  if (!signature || !NOMBA_WEBHOOK_SECRET) {
    console.warn('Webhook: Missing signature header or NOMBA_WEBHOOK_SECRET');
    return false;
  }
  
  const payload = req.rawBody || JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac('sha256', NOMBA_WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'utf8'),
      Buffer.from(expectedSignature, 'utf8')
    );
  } catch (err) {
    return false;
  }
}

async function sendSms(phone, message) {
  if (!TERMII_API_KEY) {
    console.warn('Termii API key missing, SMS not sent:', message);
    return;
  }
  try {
    await axios.post('https://api.termii.com/api/sms/send', {
      api_key: TERMII_API_KEY,
      to: phone,
      from: TERMII_SENDER_ID,
      sms: message,
      type: 'plain',
      channel: 'dnd',
    });
    console.log(`SMS sent to ${phone}: ${message}`);
  } catch (error) {
    console.error('Termii SMS error:', error.response?.data || error.message);
  }
}

// ------------------------------------------------------------------
// 5. AUTH MIDDLEWARE
// ------------------------------------------------------------------
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Invalid or expired token' });
  req.user = decoded;
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}

// ------------------------------------------------------------------
// 6. DATABASE QUERY HELPERS
// ------------------------------------------------------------------
async function getMembers(cooperativeId, search = '') {
  const membersSnap = await ref('members').orderByChild('cooperativeId').equalTo(cooperativeId).once('value');
  let members = [];
  membersSnap.forEach((child) => {
    const data = child.val();
    data.id = child.key;
    members.push(data);
  });
  if (search) {
    const s = search.toLowerCase();
    members = members.filter(m =>
      (m.firstName + ' ' + m.lastName).toLowerCase().includes(s) ||
      m.phone.includes(s)
    );
  }
  return members;
}

async function getLoanApplications(cooperativeId) {
  const appsSnap = await ref('loanApplications').orderByChild('cooperativeId').equalTo(cooperativeId).once('value');
  const apps = [];
  appsSnap.forEach((child) => {
    const data = child.val();
    data.id = child.key;
    apps.push(data);
  });
  return apps;
}

// ------------------------------------------------------------------
// 7. ROUTES
// ------------------------------------------------------------------

// ---------- AUTH ----------
app.post('/api/auth/register', async (req, res) => {
  try {
    const { cooperativeName, contactEmail, contactPhone, adminFullName, adminEmail, adminPhone, password } = req.body;
    if (!cooperativeName || !adminPhone || !password)
      return res.status(400).json({ error: 'Missing required fields' });

    const existingAdmin = await ref('admins').orderByChild('phone').equalTo(adminPhone).once('value');
    if (existingAdmin.exists()) return res.status(409).json({ error: 'Admin phone already registered' });

    const coopId = generateId();
    await set(`cooperatives/${coopId}`, {
      name: cooperativeName,
      contactEmail: contactEmail || '',
      contactPhone: contactPhone || adminPhone,
      createdAt: new Date().toISOString(),
    });

    const adminId = generateId();
    const hashedPassword = await hashString(password);
    await set(`admins/${adminId}`, {
      cooperativeId: coopId,
      fullName: adminFullName || 'Admin',
      email: adminEmail || '',
      phone: adminPhone,
      passwordHash: hashedPassword,
      role: 'owner',
      createdAt: new Date().toISOString(),
    });

    const token = generateToken({ userId: adminId, role: 'admin', cooperativeId: coopId });
    res.status(201).json({ message: 'Cooperative registered successfully', token, cooperativeId: coopId, adminId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { phone, password, pin, role } = req.body;
    if (!phone || !role) return res.status(400).json({ error: 'Phone and role required' });
    const normalizedPhone = normalizePhone(phone);

    if (role === 'admin') {
      if (!password) return res.status(400).json({ error: 'Password required for admin' });
      const adminSnap = await ref('admins').orderByChild('phone').equalTo(normalizedPhone).once('value');
      if (!adminSnap.exists()) return res.status(401).json({ error: 'Invalid credentials' });
      let adminData, adminId;
      adminSnap.forEach(child => { adminData = child.val(); adminId = child.key; });
      const valid = await compareHash(password, adminData.passwordHash);
      if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
      const token = generateToken({ userId: adminId, role: 'admin', cooperativeId: adminData.cooperativeId });
      return res.json({ token, role: 'admin', cooperativeId: adminData.cooperativeId });
    } 
    else if (role === 'member') {
      const memberSnap = await ref('members').orderByChild('phone').equalTo(normalizedPhone).once('value');
      if (!memberSnap.exists()) return res.status(401).json({ error: 'Invalid credentials' });
      let memberData, memberId;
      memberSnap.forEach(child => { memberData = child.val(); memberId = child.key; });

      // ---- SMART LOGIN ----
      let valid = false;
      if (memberData.hasCompletedFirstLogin) {
        // PIN is already set – treat the input as PIN
        if (password) {
          valid = await compareHash(password, memberData.pinHash);
        } else if (pin) {
          valid = await compareHash(pin, memberData.pinHash);
        }
      } else {
        // First login – treat input as temporary password
        if (password) {
          valid = await compareHash(password, memberData.passwordHash);
        }
      }

      if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

      const token = generateToken({ userId: memberId, role: 'member', cooperativeId: memberData.cooperativeId });
      return res.json({
        token,
        role: 'member',
        cooperativeId: memberData.cooperativeId,
        hasCompletedFirstLogin: memberData.hasCompletedFirstLogin || false,
      });
    } 
    else {
      return res.status(400).json({ error: 'Invalid role' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/change-pin', requireAuth, requireRole('member'), async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin))
      return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
    const memberId = req.user.userId;
    const memberRef = ref(`members/${memberId}`);
    const snapshot = await memberRef.once('value');
    if (!snapshot.exists()) return res.status(404).json({ error: 'Member not found' });
    const member = snapshot.val();
    if (member.hasCompletedFirstLogin) return res.status(400).json({ error: 'PIN already set' });
    const pinHash = await hashString(pin);
    await memberRef.update({ pinHash, hasCompletedFirstLogin: true });
    res.json({ message: 'PIN set successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------- ADMIN ROUTES ----------
app.get('/api/admin/members', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const { search } = req.query;
    const members = await getMembers(cooperativeId, search);
    res.json(members);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/members/onboard', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const { firstName, lastName, phone, monthsSaved, currentBalance } = req.body;
    if (!firstName || !lastName || !phone)
      return res.status(400).json({ error: 'First name, last name, and phone are required' });
    const normalizedPhone = normalizePhone(phone);

    const existing = await ref('members').orderByChild('cooperativeId').equalTo(cooperativeId).once('value');
    let duplicate = false;
    existing.forEach(child => { if (child.val().phone === normalizedPhone) duplicate = true; });
    if (duplicate) return res.status(409).json({ error: 'Phone number already exists in this cooperative' });

    const fullName = `${firstName} ${lastName}`;
    const memberId = generateId();
    const accountRef = `VA-${cooperativeId}-${memberId}`;
    const wallet = await provisionNombaWallet(accountRef, fullName);
    const tempPassword = generateTempPassword();
    const hashedPassword = await hashString(tempPassword);
    const memberData = {
      cooperativeId,
      firstName,
      lastName,
      phone: normalizedPhone,
      passwordHash: hashedPassword,
      tempPassword: tempPassword, // <- Stored for admin/super admin retrieval
      pinHash: null,
      hasCompletedFirstLogin: false,
      nombaWalletId: wallet.walletId,
      virtualAccountNumber: wallet.virtualAccountNumber,
      bankName: wallet.bankName,
      monthsSaved: parseInt(monthsSaved) || 0,
      totalBalance: parseFloat(currentBalance) || 0,
      linkedCardToken: null,
      recurringSavingsAmount: null,
      recurringSavingsDayOfMonth: null,
      createdAt: new Date().toISOString(),
    };
    await set(`members/${memberId}`, memberData);
    await sendSms(normalizedPhone, `Welcome to CircleCo! Your virtual account is ${wallet.virtualAccountNumber} (${wallet.bankName}). Temporary password: ${tempPassword}. Please login and set your PIN.`);
    res.status(201).json({ message: 'Member onboarded successfully', memberId, tempPassword });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/members/bulk', requireAuth, requireRole('admin'), upload.single('file'), async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    const results = { total: rows.length, created: 0, errors: [] };

    for (const row of rows) {
      const { first_name, last_name, phone, months_saved, current_balance } = row;
      if (!first_name || !last_name || !phone) {
        results.errors.push(`Missing fields for row: ${JSON.stringify(row)}`);
        continue;
      }
      const normalizedPhone = normalizePhone(phone);
      const existing = await ref('members').orderByChild('cooperativeId').equalTo(cooperativeId).once('value');
      let duplicate = false;
      existing.forEach(child => { if (child.val().phone === normalizedPhone) duplicate = true; });
      if (duplicate) { results.errors.push(`Duplicate phone ${normalizedPhone}`); continue; }

      try {
        const fullName = `${first_name} ${last_name}`;
        const memberId = generateId();
        const accountRef = `VA-${cooperativeId}-${memberId}`;
        const wallet = await provisionNombaWallet(accountRef, fullName);
        const tempPassword = generateTempPassword();
        const hashedPassword = await hashString(tempPassword);
        await set(`members/${memberId}`, {
          cooperativeId,
          firstName: first_name,
          lastName: last_name,
          phone: normalizedPhone,
          passwordHash: hashedPassword,
          tempPassword: tempPassword, // <- Stored for admin/super admin retrieval
          pinHash: null,
          hasCompletedFirstLogin: false,
          nombaWalletId: wallet.walletId,
          virtualAccountNumber: wallet.virtualAccountNumber,
          bankName: wallet.bankName,
          monthsSaved: parseInt(months_saved) || 0,
          totalBalance: parseFloat(current_balance) || 0,
          linkedCardToken: null,
          recurringSavingsAmount: null,
          recurringSavingsDayOfMonth: null,
          createdAt: new Date().toISOString(),
        });
        results.created++;
        await sendSms(normalizedPhone, `Welcome to CircleCo! Your virtual account is ${wallet.virtualAccountNumber} (${wallet.bankName}). Temporary password: ${tempPassword}. Please login and set your PIN.`);
      } catch (err) {
        results.errors.push(`Failed to onboard ${normalizedPhone}: ${err.message}`);
      }
    }
    res.json({ message: 'Bulk onboarding completed', results });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/loan-rules', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const ruleSnap = await ref(`loanEligibilityRules/${cooperativeId}`).once('value');
    const rule = ruleSnap.val() || { minMonthsSaved: 0 };
    res.json(rule);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/admin/loan-rules', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const { minMonthsSaved } = req.body;
    if (minMonthsSaved === undefined || isNaN(minMonthsSaved) || minMonthsSaved < 0)
      return res.status(400).json({ error: 'Valid minMonthsSaved is required' });
    await set(`loanEligibilityRules/${cooperativeId}`, {
      cooperativeId,
      minMonthsSaved: parseInt(minMonthsSaved),
      updatedAt: new Date().toISOString(),
    });
    res.json({ message: 'Loan eligibility rule updated', minMonthsSaved });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/loan-applications', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const apps = await getLoanApplications(cooperativeId);
    res.json(apps);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/admin/loan-applications/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const appId = req.params.id;
    const { status, adminNotes } = req.body;
    const validStatuses = ['pending', 'additional_docs_requested', 'approved', 'rejected'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const appRef = ref(`loanApplications/${appId}`);
    const snap = await appRef.once('value');
    if (!snap.exists()) return res.status(404).json({ error: 'Application not found' });
    const app = snap.val();
    if (app.cooperativeId !== req.user.cooperativeId) return res.status(403).json({ error: 'Access denied' });
    await appRef.update({ status, adminNotes: adminNotes || app.adminNotes, updatedAt: new Date().toISOString() });
    res.json({ message: 'Loan application updated' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------- MEMBER ROUTES ----------
app.get('/api/member/profile', requireAuth, requireRole('member'), async (req, res) => {
  try {
    const memberId = req.user.userId;
    const cooperativeId = req.user.cooperativeId;
    const memberSnap = await ref(`members/${memberId}`).once('value');
    if (!memberSnap.exists()) return res.status(404).json({ error: 'Member not found' });
    const member = memberSnap.val();
    const ruleSnap = await ref(`loanEligibilityRules/${cooperativeId}`).once('value');
    const rule = ruleSnap.val() || { minMonthsSaved: 0 };
    const isEligible = member.monthsSaved >= rule.minMonthsSaved;
    const appsSnap = await ref('loanApplications').orderByChild('memberId').equalTo(memberId).once('value');
    const applications = [];
    appsSnap.forEach(child => { const data = child.val(); data.id = child.key; applications.push(data); });
    res.json({ ...member, isEligible, loanEligibilityRule: rule, applications });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/member/loan-apply', requireAuth, requireRole('member'), async (req, res) => {
  try {
    const memberId = req.user.userId;
    const cooperativeId = req.user.cooperativeId;
    const { amountRequested } = req.body;
    if (!amountRequested || isNaN(amountRequested) || amountRequested <= 0)
      return res.status(400).json({ error: 'Valid loan amount required' });
    const ruleSnap = await ref(`loanEligibilityRules/${cooperativeId}`).once('value');
    const rule = ruleSnap.val() || { minMonthsSaved: 0 };
    const memberSnap = await ref(`members/${memberId}`).once('value');
    const member = memberSnap.val();
    if (member.monthsSaved < rule.minMonthsSaved)
      return res.status(400).json({ error: 'Not eligible for loan' });
    const appId = generateId();
    await set(`loanApplications/${appId}`, {
      memberId,
      cooperativeId,
      amountRequested: parseFloat(amountRequested),
      status: 'pending',
      adminNotes: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    res.status(201).json({ message: 'Loan application submitted', applicationId: appId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/member/savings', requireAuth, requireRole('member'), async (req, res) => {
  try {
    const memberId = req.user.userId;
    const transactionsSnap = await ref('savingsTransactions').orderByChild('memberId').equalTo(memberId).once('value');
    const transactions = [];
    transactionsSnap.forEach(child => { const data = child.val(); data.id = child.key; transactions.push(data); });
    res.json(transactions);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/member/card/link', requireAuth, requireRole('member'), async (req, res) => {
  try {
    const memberId = req.user.userId;
    const { cardToken } = req.body;
    if (!cardToken) return res.status(400).json({ error: 'Card token required' });
    await ref(`members/${memberId}`).update({ linkedCardToken: cardToken });
    res.json({ message: 'Card linked successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/member/card/recurring', requireAuth, requireRole('member'), async (req, res) => {
  try {
    const memberId = req.user.userId;
    const { amount, dayOfMonth } = req.body;
    if (!amount || isNaN(amount) || amount <= 0 || !dayOfMonth || dayOfMonth < 1 || dayOfMonth > 28)
      return res.status(400).json({ error: 'Valid amount and day of month (1-28) required' });
    const memberSnap = await ref(`members/${memberId}`).once('value');
    const member = memberSnap.val();
    if (!member.linkedCardToken) return res.status(400).json({ error: 'No linked card found' });
    await ref(`members/${memberId}`).update({
      recurringSavingsAmount: parseFloat(amount),
      recurringSavingsDayOfMonth: parseInt(dayOfMonth),
    });
    res.json({ message: 'Recurring savings configured' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------- WEBHOOK ----------
app.post('/api/webhook/nomba', async (req, res) => {
  if (!verifyNombaWebhookSignature(req)) return res.status(401).json({ error: 'Invalid signature' });
  try {
    const payload = req.body;
    
    // Extract parameters from standard nested Nomba payload or direct flat payload
    const eventType = payload.event || payload.event_type || payload.status;
    const data = payload.data || payload;

    const amount = data.amount || (data.order && data.order.amount);
    const transactionReference = data.transactionReference || data.merchantTxRef || data.paymentReference || payload.transactionReference || (data.order && data.order.orderReference);
    const virtualAccountNumber = data.virtualAccountNumber || data.bankAccountNumber;
    const accountId = data.accountId || data.accountHolderId;
    const phone = data.phone || (data.customer && data.customer.phone);

    const successEvents = ['successful', 'payment_success', 'virtual_account.funded'];
    if (eventType && !successEvents.includes(eventType.toLowerCase())) {
      console.log('Webhook: non-successful funding event', eventType, payload);
      return res.sendStatus(200);
    }

    if (!amount) {
      console.warn('Webhook: Missing amount', payload);
      return res.sendStatus(200);
    }

    let memberId = null, memberData = null;

    // 1. Try to find by accountId (nombaWalletId)
    if (accountId) {
      const membersSnap = await ref('members').orderByChild('nombaWalletId').equalTo(accountId).once('value');
      if (membersSnap.exists()) {
        membersSnap.forEach(child => { memberId = child.key; memberData = child.val(); });
      }
    }

    // 2. Try to find by virtualAccountNumber
    if (!memberId && virtualAccountNumber) {
      const membersSnap = await ref('members').orderByChild('virtualAccountNumber').equalTo(virtualAccountNumber).once('value');
      if (membersSnap.exists()) {
        membersSnap.forEach(child => { memberId = child.key; memberData = child.val(); });
      }
    }

    // 3. Try to find by phone
    if (!memberId && phone) {
      const membersSnap = await ref('members').orderByChild('phone').equalTo(normalizePhone(phone)).once('value');
      if (membersSnap.exists()) {
        membersSnap.forEach(child => { memberId = child.key; memberData = child.val(); });
      }
    }

    if (!memberId) {
      console.warn('Webhook: No member found for transaction', payload);
      return res.sendStatus(200);
    }

    const txRef = transactionReference || `REF-${Date.now()}`;
    const existingTxnSnap = await ref('savingsTransactions').orderByChild('nombaTransactionReference').equalTo(txRef).once('value');
    if (existingTxnSnap.exists()) {
      console.log('Duplicate webhook ignored', txRef);
      return res.sendStatus(200);
    }

    // Record transaction
    const txnId = generateId();
    await set(`savingsTransactions/${txnId}`, {
      memberId,
      cooperativeId: memberData.cooperativeId,
      amount: parseFloat(amount),
      type: 'wallet_transfer',
      nombaTransactionReference: txRef,
      status: 'successful',
      createdAt: new Date().toISOString(),
    });

    // Atomically increment member balance to avoid race conditions
    let newBalance;
    const balanceResult = await ref(`members/${memberId}/totalBalance`).transaction((currentBalance) => {
      return (currentBalance || 0) + parseFloat(amount);
    });
    newBalance = balanceResult.snapshot.val();

    await sendSms(memberData.phone, `Your CircleCo wallet has been funded with ₦${amount}. New balance: ₦${newBalance.toFixed(2)}.`);
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.sendStatus(500);
  }
});

// ---------- HEALTH ----------
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ------------------------------------------------------------------
// 8. START SERVER
// ------------------------------------------------------------------
// app.listen(PORT, () => {
//   console.log(`CircleCo backend running on port ${PORT}`);
//   console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
//   if (process.env.MOCK_NOMBA === 'true') {
//     console.log('[INFO] MOCK_NOMBA is enabled – using fake wallet data.');
//   } else {
//     console.log('[INFO] MOCK_NOMBA is NOT set – real Nomba calls will be attempted.');
//     console.log('      Set MOCK_NOMBA=true in .env to avoid errors if Nomba is unreachable.');
//   }
// });

// In app.js, at the very bottom:

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`CircleCo backend running on port ${PORT}`);
  });
}
module.exports = app;