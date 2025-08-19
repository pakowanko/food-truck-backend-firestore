const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authenticateToken = require('../middleware/authenticateToken');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.get('/profile', authenticateToken, authController.getProfile);
router.get('/verify-email', authController.verifyEmail);
router.post('/request-password-reset', authController.requestPasswordReset);
router.post('/reset-password', authController.resetPassword);

// --- NOWA ŚCIEŻKA ---
router.post('/google-login', authController.googleLogin);

// w pliku z trasami (np. routes/auth.js)
router.post('/login-with-reminder-token', authController.loginWithReminderToken);

module.exports = router;