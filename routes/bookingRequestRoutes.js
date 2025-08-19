const express = require('express');
const router = express.Router();
const bookingRequestController = require('../controllers/bookingRequestController');
const authenticateToken = require('../middleware/authenticateToken');

router.post('/', authenticateToken, bookingRequestController.createBookingRequest);
router.get('/my-bookings', authenticateToken, bookingRequestController.getMyBookings);
router.put('/:requestId/status', authenticateToken, bookingRequestController.updateBookingStatus);
// --- NOWA ŚCIEŻKA ---
router.put('/:requestId/cancel', authenticateToken, bookingRequestController.cancelBooking);

module.exports = router;