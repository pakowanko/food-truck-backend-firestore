const express = require('express');
const router = express.Router();
const cronController = require('../controllers/cronController');

const authenticateToken = require('../middleware/authenticateToken'); 
const isAdmin = require('../middleware/isAdmin'); 

// Trasy dla Cloud Scheduler (zabezpieczone tokenem OIDC w Google Cloud)
router.post('/send-reminders', cronController.sendDailyReminders);
router.post('/generate-invoices', cronController.generateDailyInvoices);
router.post('/send-profile-reminders', cronController.sendProfileCreationReminders);

// <<< NOWA TRASA DO WYSYŁANIA PRZYPOMNIEŃ O REZERWACJACH
router.post('/send-booking-reminders', cronController.sendPendingBookingReminders);

// Trasa dla administratora do ręcznego uruchomienia
router.post(
    '/publish-all-existing', 
    authenticateToken, 
    isAdmin, 
    cronController.publishAllExistingProfiles
);

module.exports = router;
