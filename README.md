CircleCo — Cooperative Savings & Loan Management Platform
CircleCo is a complete digital platform for managing cooperative savings, member onboarding, loan applications, and automated recurring savings — all integrated with payment infrastructure (Nomba), SMS notifications (Termii), and a secure authentication system.

It consists of:

Backend: Node.js + Express + Firebase Realtime Database (admin SDK)

Frontend: Bootstrap 5, vanilla JavaScript, served statically

Integrations: Nomba (virtual accounts & webhooks), Termii (SMS), JWT auth

Features
Admin Portal
Member Management: Onboard individual members or bulk upload via Excel (.xlsx).

Loan Eligibility Rules: Set minimum savings months required for loan access.

Loan Application Processing: View, approve, reject, or request additional documents.

Dashboard: View all members and their savings status.

Member Portal
Secure Login: First-time login with a temporary password, then set a 4‑digit PIN.

Virtual Account: Each member gets a Nomba virtual account for wallet funding.

Card Linking: Securely link a debit card (tokenized).

Recurring Savings: Schedule automatic monthly deductions from the linked card.

Loan Application: Apply for loans based on eligibility rules.

Transaction History: View all wallet transactions and savings records.

Automation
Webhooks: Nomba sends transaction updates → automatically credit member wallets and send SMS alerts.

SMS Notifications: Onboarding, funding, and loan status updates via Termii.

Technology Stack
Layer	Technology
Backend	Node.js, Express, Firebase Admin SDK, JWT, Bcrypt
Database	Firebase Realtime Database
Payments	Nomba (virtual accounts, card tokenization, webhooks)
SMS	Termii API
Frontend	Bootstrap 5, vanilla JS, HTML
File Upload	Multer + XLSX (Excel parsing)
Auth	JWT (7‑day expiry) + PIN (4‑digit)
Prerequisites
Node.js (v16 or later)

Firebase project with Realtime Database enabled

Nomba account (sandbox or production)

Termii API key (optional, SMS works without it)

Installation & Setup
Clone the repository

bash
git clone https://github.com/yourusername/circleco.git
cd circleco
Install dependencies

bash
npm install
Create a .env file in the root directory (see Environment Variables).

Start the server

bash
node app.js
The server runs on http://localhost:5000 by default (or the port defined in .env).

Frontend is served from the /public folder. Ensure the public directory contains index.html, member.html, admin.html, css/, js/, etc.

Environment Variables
Create a .env file with the following keys:

env
PORT=5000
JWT_SECRET=your_jwt_secret_key

# Firebase Admin SDK
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com

# Nomba (sandbox or production)
NOMBA_BASE_URL=https://sandbox.api.nomba.com/v1
NOMBA_ACCOUNT_ID=your_account_id
NOMBA_CLIENT_ID=your_client_id
NOMBA_CLIENT_SECRET=your_client_secret
NOMBA_WEBHOOK_SECRET=your_webhook_secret

# Termii SMS
TERMII_API_KEY=your_termii_api_key
TERMII_SENDER_ID=CircleCo

# Mock mode (set to 'true' to skip real Nomba calls)
MOCK_NOMBA=true
FALLBACK_MOCK=true

# CORS origin (optional)
CORS_ORIGIN=*
Note: In development, enable MOCK_NOMBA=true and FALLBACK_MOCK=true to avoid dependency on a live Nomba account.

Running the Application
Development (with nodemon, if installed):

bash
npm run dev
Production:

bash
npm start
Access:

Admin portal: http://localhost:5000/admin.html

Member portal: http://localhost:5000/member.html

Landing page: http://localhost:5000/

API Endpoints (Summary)
All endpoints (except /health and /webhook) require a valid JWT in the Authorization: Bearer <token> header.

Public
GET /health – health check

POST /api/auth/register – register a new cooperative

POST /api/auth/login – login (admin or member)

POST /api/webhook/nomba – Nomba webhook (no auth)

Admin (requires role: admin)
GET /api/admin/members – list members (supports ?search=)

POST /api/admin/members/onboard – onboard a single member

POST /api/admin/members/bulk – bulk upload via Excel (multipart/form-data)

GET /api/admin/loan-rules – get eligibility rule

PUT /api/admin/loan-rules – update eligibility rule

GET /api/admin/loan-applications – list all loan applications

PUT /api/admin/loan-applications/:id – update application status

Member (requires role: member)
GET /api/member/profile – get profile, balance, eligibility

POST /api/member/loan-apply – submit a loan application

GET /api/member/savings – transaction history

POST /api/member/card/link – link a card (accepts cardToken)

POST /api/member/card/recurring – set up recurring savings

POST /api/auth/change-pin – set/change 4‑digit PIN (first login)

Webhooks
The endpoint /api/webhook/nomba is designed to receive transaction notifications from Nomba.
It expects a JSON payload with fields like transactionReference, phone, amount, status, virtualAccountNumber.

On a successful transaction:

Finds the corresponding member (by virtualAccountNumber or phone)

Creates a savingsTransactions record

Updates the member's totalBalance

Sends an SMS notification

Webhook signature verification is implemented as a placeholder; replace verifyNombaWebhookSignature with actual HMAC validation in production.

Folder Structure
text
circleco/
├── public/               # Static frontend
│   ├── index.html
│   ├── admin.html
│   ├── member.html
│   ├── css/
│   ├── js/
│   └── ...
├── app.js               # Main backend
├── .env                 # Environment variables (not committed)
├── package.json
└── README.md
Contributing
Fork the repository.

Create a feature branch (git checkout -b feature/amazing-feature).

Commit your changes (git commit -m 'Add some amazing feature').

Push to the branch (git push origin feature/amazing-feature).

Open a Pull Request.

Please ensure your code follows the existing style and includes appropriate comments.


