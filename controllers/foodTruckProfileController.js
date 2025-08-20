const db = require('../firestore');
const { GeoPoint, FieldValue } = require('firebase-admin/firestore');
const { getGeocode, geofire } = require('../utils/geoUtils'); // Upewnij się, że ten plik pomocniczy istnieje i jest poprawny
const { Storage } = require('@google-cloud/storage');
const { PubSub } = require('@google-cloud/pubsub');

const pubSubClient = new PubSub();
const reelsTopicName = 'reels-generation-topic';
const postsTopicName = 'post-publication-topic';

const storage = new Storage();
const bucketName = process.env.GCS_BUCKET_NAME;

// Funkcja pomocnicza do pobierania następnego unikalnego, numerycznego ID dla profilu
async function getNextProfileId() {
    const counterRef = db.collection('counters').doc('profileCounter');
    
    return db.runTransaction(async (transaction) => {
        const counterDoc = await transaction.get(counterRef);
        if (!counterDoc.exists) {
            // Jeśli licznik nie istnieje, zaczynamy od bezpiecznej, wysokiej liczby
            const startId = 1000;
            transaction.set(counterRef, { currentId: startId });
            return startId;
        }
        const newId = counterDoc.data().currentId + 1;
        transaction.update(counterRef, { currentId: newId });
        return newId;
    });
}

const uploadFileToGCS = (file) => {
  return new Promise((resolve, reject) => {
    if (!file || !file.originalname || !file.buffer) {
        return reject('Nieprawidłowy plik do przesłania.');
    }
    const blob = storage.bucket(bucketName).file(Date.now() + "_" + file.originalname.replace(/ /g, "_"));
    const blobStream = blob.createWriteStream({ resumable: false });
    blobStream.on('finish', () => {
      const publicUrl = `https://storage.googleapis.com/${bucketName}/${blob.name}`;
      resolve(publicUrl);
    }).on('error', (err) => {
      reject(`Nie udało się wysłać obrazka: ${err}`);
    }).end(file.buffer);
  });
};

exports.getAllProfiles = async (req, res) => {
    const { cuisine, postal_code, event_start_date, event_end_date, long_term_rental } = req.query;
    
    try {
        let query = db.collection('foodTrucks');
        
        if (cuisine) {
            query = query.where('offer.dishes', 'array-contains', cuisine);
        }
        if (long_term_rental === 'true') {
            query = query.where('long_term_rental_available', '==', true);
        }
        
        let profiles = [];
        
        if (!postal_code) {
            const snapshot = await query.orderBy('food_truck_name').get();
            // ✨ POPRAWKA: Używamy 'doc_id', aby nie nadpisać numerycznego 'profile_id'
            profiles = snapshot.docs.map(doc => ({ doc_id: doc.id, ...doc.data() }));
        } else {
            // ... (logika geofire) ...
            snapshots.forEach(snap => {
                snap.forEach(doc => {
                    if (doc.data().location && !potentialMatches.some(p => p.doc_id === doc.id)) {
                        // ✨ POPRAWKA: Używamy 'doc_id' również tutaj
                        potentialMatches.push({ doc_id: doc.id, ...doc.data() });
                    }
                });
            });
            // ... (reszta logiki geofire) ...
        }

        if (event_start_date && event_end_date) {
            // ... (logika sprawdzania dostępności) ...
            // ✨ POPRAWKA: Porównujemy z numerycznym profile_id, a nie z doc_id
             unavailableProfileIds.add(booking.profile_id); // Usunięto .toString()
            // ...
            // ✨ POPRAWKA: Filtrujemy po numerycznym profile_id
            profiles = profiles.filter(p => !unavailableProfileIds.has(p.profile_id));
        }
        res.json(profiles);
    } catch (error) {
        console.error('BŁĄD ZAPYTANIA W getAllProfiles:', error);
        res.status(500).json({ message: 'Błąd serwera podczas wyszukiwania profili.' });
    }
};

exports.createProfile = async (req, res) => {
    const ownerId = parseInt(req.user.userId, 10);
    let { food_truck_name, food_truck_description, base_location, operation_radius_km, offer, long_term_rental_available } = req.body;
    
    try {
        if (!ownerId) return res.status(403).json({ message: 'Brak autoryzacji.' });

        if (offer && typeof offer === 'string') offer = JSON.parse(offer);
        const isLongTerm = /true/i.test(long_term_rental_available);

        const { lat, lon } = await getGeocode(base_location);
        
        // ✨ KLUCZOWY DODATEK: Pobierz nowe, unikalne numeryczne ID dla profilu
        const newProfileId = await getNextProfileId();

        const newProfileData = {
            profile_id: newProfileId, // ✨ ZAPISUJEMY NOWE, NUMERYCZNE ID
            owner_id: ownerId,
            food_truck_name,
            food_truck_description,
            base_location,
            operation_radius_km: parseInt(operation_radius_km) || null,
            gallery_photo_urls: [],
            profile_image_url: null,
            offer,
            long_term_rental_available: isLongTerm,
            location: (lat && lon) ? new GeoPoint(lat, lon) : null,
            geohash: (lat && lon) ? geofire.geohashForLocation([lat, lon]) : null,
            created_at: FieldValue.serverTimestamp()
        };

        if (req.files && req.files.length > 0) {
            const uploadPromises = req.files.map(uploadFileToGCS);
            newProfileData.gallery_photo_urls = await Promise.all(uploadPromises);
            newProfileData.profile_image_url = newProfileData.gallery_photo_urls[0] || null;
        }

        const newProfileRef = await db.collection('foodTrucks').add(newProfileData);
        
        const fullProfileData = { doc_id: newProfileRef.id, ...newProfileData };
        
        if (fullProfileData.gallery_photo_urls && fullProfileData.gallery_photo_urls.length > 0) {
            const dataBuffer = Buffer.from(JSON.stringify(fullProfileData));
            try {
                await pubSubClient.topic(reelsTopicName).publishMessage({ data: dataBuffer });
                await pubSubClient.topic(postsTopicName).publishMessage({ data: dataBuffer });
            } catch (error) {
                console.error(`Nie udało się wysłać zlecenia do Pub/Sub: ${error.message}`);
            }
        }
        res.status(201).json(fullProfileData);
    } catch (error) {
        console.error('Błąd dodawania profilu food trucka:', error);
        res.status(500).json({ message: 'Błąd serwera lub nieprawidłowa lokalizacja.' });
    }
};
exports.updateProfile = async (req, res) => {
    const { profileId } = req.params;
    // Upewnij się, że userId jest poprawnie parsowany do liczby, jeśli tak jest przechowywany w Firestore
    const ownerId = parseInt(req.user.userId, 10); 
    let { food_truck_name, food_truck_description, base_location, operation_radius_km, offer, long_term_rental_available } = req.body;

    try {
        const profileRef = db.collection('foodTrucks').doc(profileId);
        const profileDoc = await profileRef.get();

        if (!profileDoc.exists) {
            return res.status(404).json({ message: 'Profil nie istnieje.' });
        }
        if (profileDoc.data().owner_id !== ownerId) {
            return res.status(403).json({ message: 'Nie masz uprawnień do edycji tego profilu.' });
        }

        const existingData = profileDoc.data();
        
        // ✨ KLUCZOWA POPRAWKA ✨
        let galleryPhotoUrls;
        if (req.files && req.files.length > 0) {
            // Jeśli są nowe pliki, prześlij je i one zastąpią starą galerię
            const uploadPromises = req.files.map(uploadFileToGCS);
            galleryPhotoUrls = await Promise.all(uploadPromises);
        } else {
            // Jeśli nie ma nowych plików, zachowaj istniejącą galerię
            galleryPhotoUrls = existingData.gallery_photo_urls || [];
        }
        
        if (offer && typeof offer === 'string') offer = JSON.parse(offer);
        const isLongTerm = /true/i.test(long_term_rental_available);
        const new_base_location = base_location || existingData.base_location;
        const { lat, lon } = await getGeocode(new_base_location);

        const updateData = {
            food_truck_name: food_truck_name || existingData.food_truck_name,
            food_truck_description: food_truck_description || existingData.food_truck_description,
            base_location: new_base_location,
            operation_radius_km: parseInt(operation_radius_km) || existingData.operation_radius_km,
            offer: offer || existingData.offer,
            long_term_rental_available: isLongTerm,
            gallery_photo_urls: galleryPhotoUrls, // ✅ Zmienna zawsze istnieje
            profile_image_url: galleryPhotoUrls[0] || existingData.profile_image_url || null, // Ustawia pierwsze zdjęcie z galerii jako profilowe
            location: (lat && lon) ? new GeoPoint(lat, lon) : existingData.location,
            geohash: (lat && lon) ? geofire.geohashForLocation([lat, lon]) : existingData.geohash,
        };
        
        await profileRef.update(updateData);
        
        const updatedDoc = await profileRef.get();
        res.json({ profile_id: updatedDoc.id, ...updatedDoc.data() });
    } catch (error) {
        console.error("Błąd podczas aktualizacji profilu:", error);
        res.status(500).json({ message: 'Błąd serwera lub nieprawidłowa lokalizacja.' });
    }
};


exports.getMyProfiles = async (req, res) => {
    const { userId } = req.user;
    if (!userId) {
        return res.status(403).json({ message: 'Brak autoryzacji.' });
    }
    try {
        const profilesSnap = await db.collection('foodTrucks')
            .where('owner_id', '==', userId)
            .orderBy('food_truck_name')
            .get();
            
        const profiles = profilesSnap.docs.map(doc => ({ profile_id: doc.id, ...doc.data() }));
        res.json(profiles);
    } catch (error) {
        console.error("Błąd w /api/profiles/my-profiles:", error);
        res.status(500).json({ message: 'Błąd serwera.' });
    }
};

exports.getProfileById = async (req, res) => {
  try {
    const { profileId } = req.params; // profileId to ID dokumentu (string)
    const profileDoc = await db.collection('foodTrucks').doc(profileId).get();

    if (profileDoc.exists) {
      // ✨ POPRAWKA: Używamy 'doc_id', aby nie nadpisać numerycznego 'profile_id'
      res.json({ doc_id: profileDoc.id, ...profileDoc.data() });
    } else {
      res.status(404).json({ message: 'Nie znaleziono profilu o podanym ID.' });
    }
  } catch (error) {
    console.error("Błąd podczas pobierania pojedynczego profilu:", error);
    res.status(500).json({ message: 'Błąd serwera.' });
  }
};