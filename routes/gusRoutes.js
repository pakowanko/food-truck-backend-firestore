// routes/gusRoutes.js
const express = require('express');
const router = express.Router();
const gusController = require('../controllers/gusController');
// Usunęliśmy import 'authenticateToken', bo nie będzie już tu potrzebny

// W tej ścieżce nie wymagamy już zalogowania
router.get('/company-data/:nip', gusController.getCompanyDataByNip);

module.exports = router;