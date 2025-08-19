// routes/foodTruckProfileRoutes.js
const express = require('express');
const router = express.Router();
const foodTruckProfileController = require('../controllers/foodTruckProfileController'); 
const authenticateToken = require('../middleware/authenticateToken');
const multer = require('multer');

const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }
});

router.post('/', authenticateToken, upload.array('gallery_photos', 10), foodTruckProfileController.createProfile);

// ---- ZMIANA TUTAJ ----
// Zmieniamy ścieżkę na '/my-profiles' i funkcję na 'getMyProfiles'
router.get('/my-profiles', authenticateToken, foodTruckProfileController.getMyProfiles);

// Pozostałe ścieżki bez zmian
router.get('/', foodTruckProfileController.getAllProfiles); 
router.get('/:profileId', foodTruckProfileController.getProfileById);
router.put('/:profileId', authenticateToken, upload.array('gallery_photos', 10), foodTruckProfileController.updateProfile);

module.exports = router;