// routes/userRoutes.js
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authenticateToken = require('../middleware/authenticateToken');

// Endpoint do aktualizacji danych profilowych
router.put('/me', authenticateToken, userController.updateMyProfile);

// Endpoint do zmiany hasła
router.put('/me/password', authenticateToken, userController.updateMyPassword);

module.exports = router;