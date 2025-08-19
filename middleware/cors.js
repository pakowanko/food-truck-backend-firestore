// middleware/cors.js
const cors = require('cors');

// ZMIANA: Adres URL nowej aplikacji frontendowej
const FRONTEND_URL = 'https://pakowanko-1723651322373.web.app';

const corsOptions = {
  origin: FRONTEND_URL,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
};

module.exports = cors(corsOptions);