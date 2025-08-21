// plik: /routes/conversationRoutes.js

const express = require('express');
const router = express.Router();
const conversationController = require('../controllers/conversationController');
// Importujemy tylko jeden, właściwy middleware
const authenticateToken = require('../middleware/authenticateToken');

// Pobiera wszystkie konwersacje zalogowanego użytkownika
router.get('/', authenticateToken, conversationController.getMyConversations);

// Pobiera wiadomości z konkretnej konwersacji
router.get('/:id/messages', authenticateToken, conversationController.getMessages);

// Wysyła nową wiadomość do konkretnej konwersacji
router.post('/:id/messages', authenticateToken, conversationController.postMessage);

// Trasa do inicjowania rozmowy ogólnej
router.post('/initiate/user', authenticateToken, conversationController.initiateUserConversation);

// Trasa do inicjowania rozmowy o konkretnej rezerwacji
router.post('/initiate/booking', authenticateToken, conversationController.initiateBookingConversation);

module.exports = router;
