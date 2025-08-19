// routes/reviewRoutes.js
const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const authenticateToken = require('../middleware/authenticateToken');

// ZMIANA: Zaktualizowano komentarz
// Trasa do tworzenia nowej opinii (dla zalogowanych organizatorów)
router.post('/', authenticateToken, reviewController.createReview);

// ZMIANA: Zaktualizowano komentarz
// Trasa do pobierania opinii dla konkretnego profilu food trucka (publiczna)
router.get('/profile/:profileId', reviewController.getReviewsForProfile);

module.exports = router;