const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeAdmin = require('../middleware/authorizeAdmin');

// Używamy middleware do autoryzacji i sprawdzania uprawnień admina dla wszystkich tras w tym pliku
router.use(authenticateToken);
router.use(authorizeAdmin);

// Trasy do pobierania danych
router.get('/stats', adminController.getDashboardStats);
router.get('/users', adminController.getAllUsers);
router.get('/bookings', adminController.getAllBookings);
router.get('/conversations', adminController.getAllConversations);
router.get('/conversations/:conversationId/messages', adminController.getConversationMessages);
router.get('/users/:userId/profiles', adminController.getUserProfiles);
router.get('/profiles/:profileId', adminController.getProfileForAdmin);

// <<< POPRAWIONA LINIA PONIŻEJ
// NOWA TRASA DO POBIERANIA SZCZEGÓŁÓW REZERWACJI
router.get('/bookings/:requestId', adminController.getBookingById);

// Trasy do aktualizacji i modyfikacji danych
router.put('/users/:userId/toggle-block', adminController.toggleUserBlock);
router.put('/users/:userId', adminController.updateUser);
router.put('/bookings/:requestId/packaging-status', adminController.updatePackagingStatus);
router.put('/bookings/:requestId/commission-status', adminController.updateCommissionStatus);
router.put('/profiles/:profileId/details', adminController.updateProfileDetails);

// Trasy do usuwania danych
router.delete('/profiles/:profileId/photo', adminController.deleteProfilePhoto);
router.delete('/users/:userId', adminController.deleteUser);
router.delete('/profiles/:profileId', adminController.deleteProfile);

// Trasa do webhooka Stripe
router.post('/stripe-webhook', express.raw({type: 'application/json'}), adminController.handleStripeWebhook);

// Trasa do jednorazowej synchronizacji
router.post('/sync-stripe', adminController.syncAllUsersWithStripe);

module.exports = router;