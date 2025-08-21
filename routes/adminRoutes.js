const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

// --- Import Middleware ---
const authenticateToken = require('../middleware/authenticateToken');
// Używamy poprawnej nazwy pliku, którą mi wysłałeś
const authorizeAdmin = require('../middleware/isAdmin'); 

// --- Trasy Publiczne (lub z osobną logiką) ---

// WAŻNE: Trasa dla webhooka Stripe MUSI być PRZED autoryzacją,
// ponieważ jest wywoływana przez zewnętrzny system (Stripe), a nie zalogowanego admina.
router.post('/stripe-webhook', express.raw({type: 'application/json'}), adminController.handleStripeWebhook);


// --- Zabezpieczenie Pozostałych Tras Admina ---
// Wszystkie trasy zdefiniowane PONIŻEJ będą wymagały tokenu i uprawnień admina.
router.use(authenticateToken, authorizeAdmin);


// --- Trasy Chronione ---

// Trasy do pobierania danych (GET)
router.get('/stats', adminController.getDashboardStats);
router.get('/users', adminController.getAllUsers);
router.get('/bookings', adminController.getAllBookings);
router.get('/bookings/:requestId', adminController.getBookingById);
router.get('/conversations', adminController.getAllConversations);
router.get('/conversations/:conversationId/messages', adminController.getConversationMessages);
router.get('/users/:userId/profiles', adminController.getUserProfiles);
router.get('/profiles/:profileId', adminController.getProfileForAdmin);

// Trasy do aktualizacji danych (PUT)
router.put('/users/:userId/toggle-block', adminController.toggleUserBlock);
router.put('/users/:userId', adminController.updateUser);
router.put('/bookings/:requestId/packaging-status', adminController.updatePackagingStatus);
router.put('/bookings/:requestId/commission-status', adminController.updateCommissionStatus);
router.put('/profiles/:profileId/details', adminController.updateProfileDetails);

// Trasy do usuwania danych (DELETE)
router.delete('/profiles/:profileId/photo', adminController.deleteProfilePhoto);
router.delete('/users/:userId', adminController.deleteUser);
router.delete('/profiles/:profileId', adminController.deleteProfile);

// Trasy do zadań specjalnych (POST)
router.post('/sync-stripe', adminController.syncAllUsersWithStripe);

// Trasa diagnostyczna (jest już chroniona przez router.use)
router.get('/diagnose-users', adminController.listAllUsersForDiagnosis);


module.exports = router;