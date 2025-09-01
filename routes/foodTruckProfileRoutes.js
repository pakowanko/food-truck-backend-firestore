// plik: /routes/foodTruckProfileRoutes.js

const express = require('express');
const router = express.Router();
const foodTruckProfileController = require('../controllers/foodTruckProfileController');
const authenticateToken = require('../middleware/authenticateToken');
const multer = require('multer');

const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// --- TRASY PUBLICZNE (nie wymagają logowania) ---

// Pobiera listę wszystkich profili, z opcjonalnym filtrowaniem
// Ta trasa musi być przed trasami z parametrem /:profileId
router.get('/', foodTruckProfileController.getAllProfiles);


// --- TRASY DLA ZALOGOWANYCH UŻYTKOWNIKÓW ---

// Pobiera listę profili należących do zalogowanego użytkownika
router.get('/my-profiles', authenticateToken, foodTruckProfileController.getMyProfiles);

// Tworzy nowy profil food trucka
router.post('/', authenticateToken, upload.array('gallery_photos', 10), foodTruckProfileController.createProfile);


// --- TRASY DOTYCZĄCE KONKRETNEGO PROFILU ---
// WAŻNE: Trasy bardziej szczegółowe (np. z '/availability') muszą być zdefiniowane
// PRZED trasami bardziej ogólnymi (np. sama końcówka '/:profileId').

// Pobiera niedostępne daty dla kalendarza profilu
router.get('/:profileId/availability', authenticateToken, foodTruckProfileController.getAvailability);

// Aktualizuje dostępność w kalendarzu (ustawia datę jako zajętą lub wolną)
router.post('/:profileId/availability', authenticateToken, foodTruckProfileController.updateAvailability);

// Pobiera publiczne dane konkretnego profilu
router.get('/:profileId', foodTruckProfileController.getProfileById);

// Aktualizuje konkretny profil (może to zrobić tylko jego właściciel)
router.put('/:profileId', authenticateToken, upload.array('gallery_photos', 10), foodTruckProfileController.updateProfile);


module.exports = router;

