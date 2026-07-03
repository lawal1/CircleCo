// api/index.js
try {
  const app = require('../app');
  module.exports = app;
} catch (err) {
  console.error('❌ Failed to load app:', err);
  // Return a 500 response manually to avoid crash
  module.exports = (req, res) => {
    res.status(500).json({ error: 'Initialization failed', detail: err.message });
  };
}