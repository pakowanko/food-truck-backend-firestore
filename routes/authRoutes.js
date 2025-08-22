// plik: /routes/authRoutes.js

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authenticateToken = require('../middleware/authenticateToken');

// --- Standardowe trasy autoryzacji ---
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/google-login', authController.googleLogin);

// --- Trasy związane z weryfikacją i resetem hasła ---
router.get('/verify-email', authController.verifyEmail);
router.post('/request-password-reset', authController.requestPasswordReset);
router.post('/reset-password', authController.resetPassword);

// --- Trasa do logowania za pomocą "magicznego linku" z maila ---
router.post('/login-with-token', authController.loginWithReminderToken);

// --- Trasy wymagające uwierzytelnienia (tokenu) ---
router.get('/profile', authenticateToken, authController.getProfile);

module.exports = router;
