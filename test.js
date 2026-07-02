// ============================================================
// app.js – Cooperative Platform using Firebase Realtime Database
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const admin = require('firebase-admin');
const Joi = require('joi');
const axios = require('axios');
const crypto = require('crypto');
const multer = require('multer');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');

// ============================================================
// 1. Firebase Admin Initialization (Realtime Database)
// ============================================================
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
};
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});
const db = admin.database(); // Realtime Database instance
const auth = admin.auth();

// ============================================================
// 2. Express App Setup
// ============================================================
const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware (with CSP to allow CDN scripts)
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(compression());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/webhooks', express.raw({ type: 'application/json' }));
app.use(express.static('public'));

// ============================================================
// 3. Logger
// ============================================================
const logger = {
  info: (...args) => console.log('[INFO]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
};
console.log('Nomba URL:', process.env.NOMBA_BASE_URL);
// ============================================================
// 4. Nomba Service (unchanged)
// ============================================================
const NOMBA_BASE_URL = process.env.NOMBA_BASE_URL || 'https://sandbox.api.nomba.com/v1';
const NOMBA_ACCOUNT_ID = process.env.NOMBA_ACCOUNT_ID;
const NOMBA_CLIENT_ID = process.env.NOMBA_CLIENT_ID;
const NOMBA_CLIENT_SECRET = process.env.NOMBA_CLIENT_SECRET;
const NOMBA_WEBHOOK_SECRET = process.env.NOMBA_WEBHOOK_SECRET;

let accessToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry) return accessToken;
  try {
    logger.info('Requesting new Nomba access token...');
    const res = await axios.post(
      `${NOMBA_BASE_URL}/auth/token/issue`,
      { grant_type: 'client_credentials', client_id: NOMBA_CLIENT_ID, client_secret: NOMBA_CLIENT_SECRET },
      { headers: { 'accountId': NOMBA_ACCOUNT_ID, 'Content-Type': 'application/json' } }
    );
    accessToken = res.data.data.access_token;
    tokenExpiry = Date.now() + 55 * 60 * 1000;
    logger.info('Nomba token obtained successfully');
    return accessToken;
  } catch (error) {
    logger.error(`Failed to get Nomba token: ${error.message}`);
    if (error.response) {
      logger.error(`Nomba response status: ${error.response.status}`);
      logger.error(`Nomba response data: ${JSON.stringify(error.response.data)}`);
    }
    throw new Error(`Failed to get Nomba token: ${error.message}`);
  }
}

async function nombaRequest(method, path, data = null) {
  const token = await getAccessToken();
  const url = `${NOMBA_BASE_URL}${path}`;
  const headers = { 'Authorization': `Bearer ${token}`, 'accountId': NOMBA_ACCOUNT_ID, 'Content-Type': 'application/json' };
  try {
    const response = await axios({ method, url, headers, data });
    return response.data;
  } catch (error) {
    throw new Error(`Nomba API error: ${error.response?.data?.message || error.message}`);
  }
}

async function createVirtualAccount({ accountRef, accountName }) {
  // Mock Nomba for hackathon – no real API call
  logger.info(`[MOCK] Creating virtual account for ${accountName} (ref: ${accountRef})`);
  return {
    data: {
      accountNumber: '0123456789',   // you can make this dynamic if needed
      bankName: 'Nomba Mock Bank',
      accountName: accountName,
      id: 'mock_va_' + Date.now()
    }
  };
}

// ---------- Users ----------
app.get('/api/users/me', authenticate, async (req, res, next) => {
  try {
    const uid = req.user.uid;
    const userSnap = await db.ref(`users/${uid}`).once('value');
    if (!userSnap.exists()) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(userSnap.val());
  } catch (error) {
    next(error);
  }
});

async function chargeToken({ amount, currency, cardId, customerId, merchantTxRef }) {
  return nombaRequest('POST', '/tokenized-card/charge', { amount, currency, cardId, customerId, merchantTxRef });
}

async function lookupBankAccount({ bankCode, accountNumber }) {
  return nombaRequest('POST', '/transfers/bank/lookup', { bankCode, accountNumber });
}

function verifyWebhookSignature(payload, signature) {
  const expected = crypto.createHmac('sha256', NOMBA_WEBHOOK_SECRET).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// ============================================================
// 5. SMS Service (mock)
// ============================================================
async function sendSMS(phone, message) {
  logger.info(`SMS to ${phone}: ${message}`);
  return true;
}

// ============================================================
// 6. Middleware
// ============================================================
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid token' });
  }
  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await auth.verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized', details: error.message });
  }
}

function checkRole(requiredRoles) {
  return async (req, res, next) => {
    const uid = req.user.uid;
    const userSnap = await db.ref(`users/${uid}`).once('value');
    if (!userSnap.exists()) return res.status(403).json({ error: 'User not found' });
    const user = userSnap.val();
    const role = user.role;
    if (!requiredRoles.includes(role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    req.userRole = role;
    req.cooperativeId = user.cooperativeId || null;
    next();
  };
}

function validate(schema) {
  return (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({ error: 'Validation error', details: error.details.map(d => d.message) });
    }
    next();
  };
}

function errorHandler(err, req, res, next) {
  logger.error(err.stack);
  res.status(500).json({ error: err.message || 'Internal server error' });
}

// ============================================================
// 7. Validation Schemas (unchanged)
// ============================================================
const cooperativeSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  email: Joi.string().email().required(),
  phone: Joi.string().pattern(/^[0-9]{10,15}$/).required(),
  password: Joi.string().min(6).required(),
  cacNumber: Joi.string().optional(),
});

const memberCreateSchema = Joi.object({
  firstName: Joi.string().required(),
  lastName: Joi.string().required(),
  phone: Joi.string().pattern(/^[0-9]{10,15}$/).required(),
  email: Joi.string().email().optional(),
});

const loanRequestSchema = Joi.object({
  amount: Joi.number().positive().required(),
  guarantorIds: Joi.array().items(Joi.string()).min(1).required(),
  idDocument: Joi.string().uri().required(),
});

const eligibilityRulesSchema = Joi.object({
  minMonthsSaved: Joi.number().integer().min(0).required(),
  minBalance: Joi.number().min(0).required(),
  minContributions: Joi.number().integer().min(0).required(),
});

// ============================================================
// 8. Helper: get timestamp for Realtime DB
// ============================================================
function now() {
  return admin.database.ServerValue.TIMESTAMP;
}

// ============================================================
// 9. Route Handlers (adapted for Realtime DB)
// ============================================================

// ---------- Cooperatives ----------
app.post('/api/cooperatives', validate(cooperativeSchema), async (req, res, next) => {
  try {
    const { name, email, phone, password, cacNumber } = req.body;
    const userRecord = await auth.createUser({ email, password, displayName: name });
    const uid = userRecord.uid;

    // Create cooperative with auto-generated key
    const coopRef = db.ref('cooperatives').push();
    const coopId = coopRef.key;
    await coopRef.set({
      id: coopId,
      name,
      email,
      phone,
      cacNumber: cacNumber || null,
      status: 'active',
      createdAt: now(),
      eligibilityRules: { minMonthsSaved: 6, minBalance: 50000, minContributions: 6 },
      monthlyContribution: 10000,
    });

    // Create user (admin)
    await db.ref(`users/${uid}`).set({
      uid,
      cooperativeId: coopId,
      fullName: name,
      email,
      phone,
      role: 'admin',
      accountStatus: 'active',
      createdAt: now(),
    });

    const token = await auth.createCustomToken(uid);
    res.status(201).json({ message: 'Cooperative registered', uid, token });
  } catch (error) {
    next(error);
  }
});

app.get('/api/cooperatives/dashboard', authenticate, checkRole(['admin', 'superadmin']), async (req, res, next) => {
  try {
    const cooperativeId = req.cooperativeId;

    // Get all users and count members
    const usersSnap = await db.ref('users').orderByChild('cooperativeId').equalTo(cooperativeId).once('value');
    const users = usersSnap.val() || {};
    const members = Object.values(users).filter(u => u.role === 'member');
    const totalMembers = members.length;

    // Calculate total savings: sum balances of all members
    let totalSavings = 0;
    const savingsSnap = await db.ref('savings').orderByChild('cooperativeId').equalTo(cooperativeId).once('value');
    const savings = savingsSnap.val() || {};
    Object.values(savings).forEach(s => { totalSavings += s.balance || 0; });

    // Loans
    const loansSnap = await db.ref('loans').orderByChild('cooperativeId').equalTo(cooperativeId).once('value');
    const loans = loansSnap.val() || {};
    let pendingLoans = 0, activeLoans = 0;
    Object.values(loans).forEach(l => {
      if (l.status === 'pending') pendingLoans++;
      if (l.status === 'active') activeLoans++;
    });

    // Recent transactions (limit 5)
    const txSnap = await db.ref('transactions').orderByChild('cooperativeId').equalTo(cooperativeId).once('value');
    const txData = txSnap.val() || {};
    const recentTx = Object.values(txData)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 5);

    res.json({ totalMembers, totalSavings, pendingLoans, activeLoans, recentTransactions: recentTx });
  } catch (error) {
    next(error);
  }
});

app.put('/api/cooperatives/:cooperativeId/rules', authenticate, checkRole(['admin']), validate(eligibilityRulesSchema), async (req, res, next) => {
  try {
    const { cooperativeId } = req.params;
    if (req.cooperativeId !== cooperativeId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await db.ref(`cooperatives/${cooperativeId}/eligibilityRules`).update(req.body);
    res.json({ message: 'Rules updated' });
  } catch (error) {
    next(error);
  }
});

// ---------- Members ----------
app.post('/api/members', authenticate, checkRole(['admin', 'officer']), validate(memberCreateSchema), async (req, res, next) => {
  try {
    const { firstName, lastName, phone, email } = req.body;
    const cooperativeId = req.cooperativeId;

    const memberId = `MEM-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const accountRef = `VA-${cooperativeId}-${memberId}`;
    const accountName = `${firstName} ${lastName}`.substring(0, 30);

    const vaResponse = await createVirtualAccount({ accountRef, accountName });
    const vaData = vaResponse.data;

    const userEmail = email || `${memberId}@coop.local`;
    const userRecord = await auth.createUser({ email: userEmail, password: 'temporary123', displayName: `${firstName} ${lastName}` });
    const uid = userRecord.uid;

    // Save user
    await db.ref(`users/${uid}`).set({
      uid,
      cooperativeId,
      fullName: `${firstName} ${lastName}`,
      email: userEmail,
      phone,
      role: 'member',
      memberId,
      accountStatus: 'active',
      createdAt: now(),
    });

    // Save virtual account
    await db.ref(`virtualAccounts/${uid}`).set({
      userId: uid,
      cooperativeId,
      accountNumber: vaData.accountNumber,
      bankName: vaData.bankName || 'Nomba Bank',
      accountName: vaData.accountName,
      nombaAccountId: vaData.id,
      status: 'active',
      createdAt: now(),
    });

    // Initialize savings
    await db.ref(`savings/${uid}`).set({
      userId: uid,
      cooperativeId,
      balance: 0,
      totalContribution: 0,
      lastContributionDate: null,
    });

    await sendSMS(phone, `Welcome ${firstName}! Your virtual account ${vaData.accountNumber} (${vaData.bankName}) is ready. Login at https://yourapp.com`);

    res.status(201).json({
      message: 'Member created',
      memberId,
      virtualAccount: { accountNumber: vaData.accountNumber, bankName: vaData.bankName },
    });
  } catch (error) {
    next(error);
  }
});

const upload = multer({ storage: multer.memoryStorage() });
app.post('/api/members/bulk', authenticate, checkRole(['admin', 'officer']), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      logger.error('Bulk upload: No file uploaded');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    logger.info(`Bulk upload: File received: ${req.file.originalname}, size: ${req.file.size}`);

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);
    logger.info(`Bulk upload: Parsed ${rows.length} rows from Excel`);

    // Detect columns
    const headers = Object.keys(rows[0] || {});
    logger.info(`Bulk upload: Found headers: ${headers.join(', ')}`);

    const cooperativeId = req.cooperativeId;
    const results = { success: [], failed: [] };

    // Find optional columns (case-insensitive)
    const balanceCol = headers.find(h => 
      ['balance', 'initial balance', 'initialbalance', 'Balance'].includes(h.trim().toLowerCase())
    );
    const monthsCol = headers.find(h =>
      ['months saved', 'monthssaved', 'months', 'Months Saved', 'MonthsSaved'].includes(h.trim().toLowerCase())
    );

    logger.info(`Bulk upload: Balance column: ${balanceCol || 'not found'}, Months column: ${monthsCol || 'not found'}`);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      logger.info(`Processing row ${i+1}:`, row);

      try {
        // Use flexible column name matching (space vs no space)
        const firstName = row['First Name'] || row['firstName'] || row['FirstName'];
        const lastName = row['Last Name'] || row['lastName'] || row['LastName'];
        const phone = String(row['Phone'] || row['phone'] || row['PhoneNumber'] || '').trim();

        logger.info(`Row ${i+1} data: FirstName=${firstName}, LastName=${lastName}, Phone=${phone}`);

        if (!firstName || !lastName || !phone) {
          logger.error(`Row ${i+1}: Missing required fields - FirstName:${firstName}, LastName:${lastName}, Phone:${phone}`);
          throw new Error(`Missing required fields - FirstName:${firstName}, LastName:${lastName}, Phone:${phone}`);
        }

        // Parse optional fields
        let initialBalance = 0;
        if (balanceCol && row[balanceCol] !== undefined && row[balanceCol] !== '') {
          const parsed = parseFloat(row[balanceCol]);
          if (!isNaN(parsed) && parsed > 0) initialBalance = parsed;
        }

        let monthsSaved = 0;
        if (monthsCol && row[monthsCol] !== undefined && row[monthsCol] !== '') {
          const parsed = parseInt(row[monthsCol]);
          if (!isNaN(parsed) && parsed > 0) monthsSaved = parsed;
        }

        logger.info(`Row ${i+1}: Balance=${initialBalance}, MonthsSaved=${monthsSaved}`);

        const memberId = `MEM-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const accountRef = `VA-${cooperativeId}-${memberId}`;
        const accountName = `${firstName} ${lastName}`.substring(0, 30);

        // Nomba call
        logger.info(`Row ${i+1}: Creating Nomba virtual account for ${accountName}...`);
        let vaResponse;
        try {
          vaResponse = await createVirtualAccount({ accountRef, accountName });
        } catch (nombaError) {
          logger.error(`Row ${i+1}: Nomba error: ${nombaError.message}`);
          throw new Error(`Nomba API error: ${nombaError.message}`);
        }
        const vaData = vaResponse.data;
        logger.info(`Row ${i+1}: Nomba success - Account: ${vaData.accountNumber}`);

        // Create Firebase user
        const userEmail = `${memberId}@coop.local`;
        const userRecord = await auth.createUser({
          email: userEmail,
          password: 'temporary123',
          displayName: `${firstName} ${lastName}`
        });
        const uid = userRecord.uid;
        logger.info(`Row ${i+1}: Firebase user created with UID: ${uid}`);

        // Save user, virtual account, savings...
        // (existing code)
        await db.ref(`users/${uid}`).set({
          uid,
          cooperativeId,
          fullName: `${firstName} ${lastName}`,
          email: userEmail,
          phone,
          role: 'member',
          memberId,
          accountStatus: 'active',
          createdAt: now(),
        });

        await db.ref(`virtualAccounts/${uid}`).set({
          userId: uid,
          cooperativeId,
          accountNumber: vaData.accountNumber,
          bankName: vaData.bankName || 'Nomba Bank',
          accountName: vaData.accountName,
          nombaAccountId: vaData.id,
          status: 'active',
          createdAt: now(),
        });

        const savingsData = {
          userId: uid,
          cooperativeId,
          balance: initialBalance,
          totalContribution: initialBalance,
          monthsSaved: monthsSaved,
          lastContributionDate: initialBalance > 0 || monthsSaved > 0 ? now() : null,
        };
        await db.ref(`savings/${uid}`).set(savingsData);

        if (initialBalance > 0) {
          const txRef = db.ref('transactions').push();
          await txRef.set({
            userId: uid,
            cooperativeId,
            amount: initialBalance,
            type: 'initial_deposit',
            status: 'success',
            reference: `onboard_${memberId}_${Date.now()}`,
            createdAt: now(),
          });
        }

        await sendSMS(phone, `Welcome ${firstName}! Your virtual account ${vaData.accountNumber} is ready. Balance: ₦${initialBalance}`);
        results.success.push({ firstName, lastName, phone, memberId, balance: initialBalance, monthsSaved });
        logger.info(`Row ${i+1}: SUCCESS - ${firstName} ${lastName}`);
      } catch (err) {
        logger.error(`Row ${i+1}: FAILED - ${err.message}`);
        results.failed.push({ ...row, error: err.message });
      }
    }

    logger.info(`Bulk upload completed: ${results.success.length} success, ${results.failed.length} failed`);
    res.json({ results });
  } catch (error) {
    logger.error(`Bulk upload fatal error: ${error.message}`);
    next(error);
  }
});

app.get('/api/members', authenticate, checkRole(['admin', 'officer']), async (req, res, next) => {
  try {
    const cooperativeId = req.cooperativeId;
    const usersSnap = await db.ref('users').orderByChild('cooperativeId').equalTo(cooperativeId).once('value');
    const users = usersSnap.val() || {};
    const members = [];
    for (const uid of Object.keys(users)) {
      const user = users[uid];
      if (user.role !== 'member') continue;
      const savingsSnap = await db.ref(`savings/${uid}`).once('value');
      const savings = savingsSnap.val() || { balance: 0 };
      members.push({ ...user, balance: savings.balance });
    }
    res.json(members);
  } catch (error) {
    next(error);
  }
});

// ---------- Virtual Accounts ----------
app.get('/api/virtual-accounts/me', authenticate, checkRole(['member']), async (req, res, next) => {
  try {
    const uid = req.user.uid;
    const snap = await db.ref(`virtualAccounts/${uid}`).once('value');
    if (!snap.exists()) return res.status(404).json({ error: 'Virtual account not found' });
    res.json(snap.val());
  } catch (error) {
    next(error);
  }
});

// ---------- Savings ----------
app.get('/api/savings/me', authenticate, checkRole(['member']), async (req, res, next) => {
  try {
    const uid = req.user.uid;
    const snap = await db.ref(`savings/${uid}`).once('value');
    if (!snap.exists()) return res.status(404).json({ error: 'Savings not found' });
    res.json(snap.val());
  } catch (error) {
    next(error);
  }
});

app.post('/api/savings/card', authenticate, checkRole(['member']), async (req, res, next) => {
  try {
    const { cardId, last4 } = req.body;
    await db.ref(`users/${req.user.uid}`).update({
      savedCardId: cardId,
      cardLast4: last4,
      cardSavedAt: now(),
    });
    res.json({ message: 'Card saved successfully' });
  } catch (error) {
    next(error);
  }
});

app.post('/api/savings/monthly', authenticate, checkRole(['admin']), async (req, res, next) => {
  try {
    const cooperativeId = req.cooperativeId;
    const coopSnap = await db.ref(`cooperatives/${cooperativeId}`).once('value');
    const monthlyAmount = coopSnap.val()?.monthlyContribution || 10000;

    // Get all members with saved card
    const usersSnap = await db.ref('users').orderByChild('cooperativeId').equalTo(cooperativeId).once('value');
    const users = usersSnap.val() || {};
    const results = [];
    for (const uid of Object.keys(users)) {
      const user = users[uid];
      if (user.role !== 'member' || !user.savedCardId) continue;
      try {
        await chargeToken({
          amount: monthlyAmount * 100,
          currency: 'NGN',
          cardId: user.savedCardId,
          customerId: uid,
          merchantTxRef: `monthly_${uid}_${Date.now()}`,
        });
        // Update savings
        await db.ref(`savings/${uid}`).update({
          balance: admin.database.ServerValue.increment(monthlyAmount),
          totalContribution: admin.database.ServerValue.increment(monthlyAmount),
          lastContributionDate: now(),
        });
        // Record transaction
        const txRef = db.ref('transactions').push();
        await txRef.set({
          userId: uid,
          cooperativeId,
          amount: monthlyAmount,
          type: 'savings',
          status: 'success',
          reference: `monthly_${uid}_${Date.now()}`,
          createdAt: now(),
        });
        results.push({ uid, status: 'success' });
      } catch (err) {
        results.push({ uid, status: 'failed', error: err.message });
      }
    }
    res.json({ results });
  } catch (error) {
    next(error);
  }
});

// ---------- Loans ----------
app.get('/api/loans/eligibility', authenticate, checkRole(['member']), async (req, res, next) => {
  try {
    const uid = req.user.uid;
    const userSnap = await db.ref(`users/${uid}`).once('value');
    if (!userSnap.exists()) return res.status(404).json({ error: 'User not found' });
    const user = userSnap.val();
    const cooperativeId = user.cooperativeId;
    const coopSnap = await db.ref(`cooperatives/${cooperativeId}`).once('value');
    const rules = coopSnap.val()?.eligibilityRules || { minMonthsSaved: 6, minBalance: 50000, minContributions: 6 };

    const savingsSnap = await db.ref(`savings/${uid}`).once('value');
    const savings = savingsSnap.val() || { balance: 0, totalContribution: 0, lastContributionDate: null, monthsSaved: 0 };

    // Determine monthsSaved: use stored value if set, else compute from lastContributionDate
    let monthsSaved = savings.monthsSaved || 0;
    if (!monthsSaved && savings.lastContributionDate) {
      const last = new Date(savings.lastContributionDate);
      const nowDate = new Date();
      monthsSaved = (nowDate.getFullYear() - last.getFullYear()) * 12 + nowDate.getMonth() - last.getMonth();
    }

    const balance = savings.balance || 0;
    const contributionCount = Math.floor((savings.totalContribution || 0) / 1000); // approximate

    const eligible = (monthsSaved >= rules.minMonthsSaved) &&
                     (balance >= rules.minBalance) &&
                     (contributionCount >= rules.minContributions);

    let reason = '';
    if (!eligible) {
      const fails = [];
      if (monthsSaved < rules.minMonthsSaved) fails.push(`Need at least ${rules.minMonthsSaved} months (you have ${monthsSaved})`);
      if (balance < rules.minBalance) fails.push(`Need minimum balance ₦${rules.minBalance} (you have ₦${balance})`);
      if (contributionCount < rules.minContributions) fails.push(`Need at least ${rules.minContributions} contributions (you have ${contributionCount})`);
      reason = fails.join('; ');
    }
    res.json({ eligible, reason, rules, monthsSaved, balance, contributionCount });
  } catch (error) {
    next(error);
  }
});

app.post('/api/loans/request', authenticate, checkRole(['member']), validate(loanRequestSchema), async (req, res, next) => {
  try {
    const uid = req.user.uid;
    const { amount, guarantorIds, idDocument } = req.body;
    const userSnap = await db.ref(`users/${uid}`).once('value');
    const cooperativeId = userSnap.val().cooperativeId;

    // Verify guarantors exist in same cooperative
    const usersSnap = await db.ref('users').orderByChild('cooperativeId').equalTo(cooperativeId).once('value');
    const users = usersSnap.val() || {};
    const existingIds = Object.values(users).map(u => u.memberId);
    const allExist = guarantorIds.every(gid => existingIds.includes(gid));
    if (!allExist) {
      return res.status(400).json({ error: 'One or more guarantors not found in your cooperative' });
    }

    const loanRef = db.ref('loans').push();
    await loanRef.set({
      loanId: loanRef.key,
      userId: uid,
      cooperativeId,
      amount,
      guarantorIds,
      idDocument,
      status: 'pending',
      requestedAt: now(),
      approvedAt: null,
      repaid: false,
    });
    res.json({ message: 'Loan request submitted', loanId: loanRef.key });
  } catch (error) {
    next(error);
  }
});

app.put('/api/loans/:loanId/approve', authenticate, checkRole(['admin']), async (req, res, next) => {
  try {
    const { loanId } = req.params;
    const cooperativeId = req.cooperativeId;
    const loanSnap = await db.ref(`loans/${loanId}`).once('value');
    if (!loanSnap.exists()) return res.status(404).json({ error: 'Loan not found' });
    const loan = loanSnap.val();
    if (loan.cooperativeId !== cooperativeId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await db.ref(`loans/${loanId}`).update({ status: 'active', approvedAt: now() });
    res.json({ message: 'Loan approved' });
  } catch (error) {
    next(error);
  }
});

// ---------- Transactions ----------
app.get('/api/transactions', authenticate, async (req, res, next) => {
  try {
    const uid = req.user.uid;
    const userSnap = await db.ref(`users/${uid}`).once('value');
    const user = userSnap.val();
    const cooperativeId = user.cooperativeId;
    const role = user.role;

    let txSnap;
    if (role === 'member') {
      txSnap = await db.ref('transactions').orderByChild('userId').equalTo(uid).once('value');
    } else {
      txSnap = await db.ref('transactions').orderByChild('cooperativeId').equalTo(cooperativeId).once('value');
    }
    const txData = txSnap.val() || {};
    const transactions = Object.values(txData)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 50);
    res.json(transactions);
  } catch (error) {
    next(error);
  }
});

// ---------- Webhooks (unchanged) ----------
app.post('/webhooks/nomba', async (req, res) => {
  const signature = req.headers['nomba-signature'];
  const rawBody = req.body;
  if (!signature || !verifyWebhookSignature(rawBody, signature)) {
    return res.status(401).send('Invalid signature');
  }
  try {
    const event = JSON.parse(rawBody.toString());
    const requestId = event.requestId;
    const processedRef = db.ref(`processedWebhooks/${requestId}`);
    const processedSnap = await processedRef.once('value');
    if (processedSnap.exists()) {
      return res.status(200).send('Duplicate ignored');
    }
    if (event.event === 'payment_success' || event.event === 'virtual_account.funded') {
      const { accountId, amount, merchantTxRef } = event.data;
      // Find virtual account by nombaAccountId
      const vaSnap = await db.ref('virtualAccounts').orderByChild('nombaAccountId').equalTo(accountId).once('value');
      if (!vaSnap.exists()) {
        return res.status(200).send('No matching virtual account');
      }
      const vaData = vaSnap.val();
      const uid = Object.keys(vaData)[0];
      const va = vaData[uid];
      const cooperativeId = va.cooperativeId;

      await db.ref(`savings/${uid}`).update({
        balance: admin.database.ServerValue.increment(amount),
        totalContribution: admin.database.ServerValue.increment(amount),
        lastContributionDate: now(),
      });
      const txRef = db.ref('transactions').push();
      await txRef.set({
        userId: uid,
        cooperativeId,
        amount,
        type: 'deposit',
        status: 'success',
        reference: merchantTxRef || requestId,
        createdAt: now(),
      });
    }
    await processedRef.set({ processedAt: now() });
    res.sendStatus(200);
  } catch (error) {
    logger.error('Webhook error:', error);
    res.status(500).send('Webhook processing error');
  }
});

// ---------- Health Check ----------
app.get('/health', (req, res) => res.send('OK'));

// ============================================================
// 10. Global Error Handler
// ============================================================
app.use(errorHandler);

// ============================================================
// 11. Start Server
// ============================================================
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});