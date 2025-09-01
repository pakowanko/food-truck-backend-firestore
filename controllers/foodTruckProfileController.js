// plik: /controllers/foodTruckProfileController.js

const db = require('../firestore');
const { GeoPoint, FieldValue } = require('firebase-admin/firestore');
const { getGeocode, geofire } = require('../utils/geoUtils');
const { Storage } = require('@google-cloud/storage');
const { PubSub } = require('@google-cloud/pubsub');
const { getDocByNumericId } = require('../utils/firestoreUtils');

const pubSubClient = new PubSub();
const reelsTopicName = 'reels-generation-topic';
const postsTopicName = 'post-publication-topic';

const storage = new Storage();
const bucketName = process.env.GCS_BUCKET_NAME;

async function getNextProfileId() {
    const counterRef = db.collection('counters').doc('profileCounter');
    
    return db.runTransaction(async (transaction) => {
        const counterDoc = await transaction.get(counterRef);
        if (!counterDoc.exists) {
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
            profiles = snapshot.docs.map(doc => ({ doc_id: doc.id, ...doc.data() }));
        } else {
            const { lat, lon } = await getGeocode(postal_code);
            if (!lat || !lon) return res.json([]);
            
            const center = [lat, lon];
            const radiusInM = 500 * 1000;
            
            const queryBounds = geofire.geohashQueryBounds(center, radiusInM);
            const promises = queryBounds.map((b) => {
                const q = query.orderBy('geohash').startAt(b[0]).endAt(b[1]);
                return q.get();
            });

            const snapshots = await Promise.all(promises);
            let potentialMatches = [];
            snapshots.forEach(snap => {
                snap.forEach(doc => {
                    if (doc.data().location && !potentialMatches.some(p => p.doc_id === doc.id)) {
                        potentialMatches.push({ doc_id: doc.id, ...doc.data() });
                    }
                });
            });
            
            profiles = potentialMatches
                .map(p => {
                    const docLocation = [p.location.latitude, p.location.longitude];
                    const distanceInKm = geofire.distanceBetween(docLocation, center);
                    return { ...p, distance: distanceInKm };
                })
                .filter(p => p.distance <= p.operation_radius_km)
                .sort((a, b) => a.distance - b.distance);
        }

        // ✨ NOWA, ULEPSZONA LOGIKA FILTROWANIA PO DACIE ✨
        if (event_start_date && event_end_date) {
            const eventStart = new Date(event_start_date);
            const eventEnd = new Date(event_end_date);
            
            // 1. Filtrujemy po rezerwacjach z Twojego systemu
            const bookingsSnap = await db.collection('bookings')
                .where('status', '==', 'confirmed')
                .where('event_start_date', '<=', eventEnd)
                .get();

            const unavailableByBooking = new Set();
            bookingsSnap.forEach(doc => {
                const booking = doc.data();
                const bookingStart = booking.event_start_date.toDate();
                if (eventStart < booking.event_end_date.toDate() && eventEnd > bookingStart) {
                    unavailableByBooking.add(booking.profile_id);
                }
            });

            // 2. Sprawdzamy niedostępność zaznaczoną w nowym kalendarzu
            const availableProfiles = [];
            for (const profile of profiles) {
                let isAvailable = true;
                
                // Sprawdź, czy nie jest zajęty przez rezerwację w systemie
                if (unavailableByBooking.has(profile.profile_id)) {
                    isAvailable = false;
                } else {
                    // Sprawdź niedostępność w kalendarzu manualnym
                    const availabilityRef = db.collection('foodTrucks').doc(profile.doc_id).collection('availability');
                    const datesToCheck = [];
                    let currentDate = new Date(eventStart);
                    
                    // Firestore nie pozwala na pętlę dłuższą niż na 10 zapytań 'in', więc iterujemy
                    while (currentDate <= eventEnd) {
                        const dateString = currentDate.toISOString().split('T')[0];
                        const availabilityDoc = await availabilityRef.doc(dateString).get();
                        if (availabilityDoc.exists) {
                            isAvailable = false;
                            break; 
                        }
                        currentDate.setDate(currentDate.getDate() + 1);
                    }
                }
                
                if (isAvailable) {
                    availableProfiles.push(profile);
                }
            }
            profiles = availableProfiles;
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
        
        const newProfileId = await getNextProfileId();

        const newProfileRef = db.collection('foodTrucks').doc();

        const newProfileData = {
            doc_id: newProfileRef.id,
            profile_id: newProfileId,
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

        await newProfileRef.set(newProfileData);
        
        if (newProfileData.gallery_photo_urls && newProfileData.gallery_photo_urls.length > 0) {
            const dataBuffer = Buffer.from(JSON.stringify(newProfileData));
            try {
                await pubSubClient.topic(reelsTopicName).publishMessage({ data: dataBuffer });
                await pubSubClient.topic(postsTopicName).publishMessage({ data: dataBuffer });
            } catch (error) {
                console.error(`Nie udało się wysłać zlecenia do Pub/Sub: ${error.message}`);
            }
        }
        res.status(201).json(newProfileData);
    } catch (error) {
        console.error('Błąd dodawania profilu food trucka:', error);
        res.status(500).json({ message: 'Błąd serwera lub nieprawidłowa lokalizacja.' });
    }
};

exports.updateProfile = async (req, res) => {
    const { profileId } = req.params;
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
        
        let galleryPhotoUrls;
        if (req.files && req.files.length > 0) {
            const uploadPromises = req.files.map(uploadFileToGCS);
            galleryPhotoUrls = await Promise.all(uploadPromises);
        } else {
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
            gallery_photo_urls: galleryPhotoUrls,
            profile_image_url: galleryPhotoUrls[0] || existingData.profile_image_url || null,
            location: (lat && lon) ? new GeoPoint(lat, lon) : existingData.location,
            geohash: (lat && lon) ? geofire.geohashForLocation([lat, lon]) : existingData.geohash,
        };
        
        await profileRef.update(updateData);
        
        const updatedDoc = await profileRef.get();
        res.json({ doc_id: updatedDoc.id, ...updatedDoc.data() });
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
            
        const profiles = profilesSnap.docs.map(doc => ({ doc_id: doc.id, ...doc.data() }));
        res.json(profiles);
    } catch (error) {
        console.error("Błąd w /api/profiles/my-profiles:", error);
        res.status(500).json({ message: 'Błąd serwera.' });
    }
};

exports.getProfileById = async (req, res) => {
  try {
    const { profileId } = req.params;
    const profileDoc = await db.collection('foodTrucks').doc(profileId).get();

    if (profileDoc.exists) {
      res.json({ doc_id: profileDoc.id, ...profileDoc.data() });
    } else {
      res.status(404).json({ message: 'Nie znaleziono profilu o podanym ID.' });
    }
  } catch (error) {
    console.error("Błąd podczas pobierania pojedynczego profilu:", error);
    res.status(500).json({ message: 'Błąd serwera.' });
  }
};

// --- ✨ NOWE FUNKCJE DO OBSŁUGI KALENDARZA ---

exports.getAvailability = async (req, res) => {
    const { profileId } = req.params; // To jest doc_id
    const { year, month } = req.query;

    if (!year || !month) {
        return res.status(400).json({ message: "Rok i miesiąc są wymagane." });
    }

    try {
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const nextMonth = parseInt(month, 10) === 12 ? 1 : parseInt(month, 10) + 1;
        const nextYear = parseInt(month, 10) === 12 ? parseInt(year, 10) + 1 : parseInt(year, 10);
        const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

        const snapshot = await db.collection('foodTrucks').doc(profileId).collection('availability')
            .where(FieldValue.documentId(), '>=', startDate)
            .where(FieldValue.documentId(), '<', endDate)
            .get();
        
        const unavailableDates = snapshot.docs.map(doc => doc.id);
        res.json(unavailableDates);

    } catch (error) {
        console.error('Błąd pobierania dostępności:', error);
        res.status(500).json({ message: 'Błąd serwera.' });
    }
};

exports.updateAvailability = async (req, res) => {
    const { profileId } = req.params; // To jest doc_id
    const { date, available } = req.body;
    const ownerId = req.user.userId;

    try {
        const profileRef = db.collection('foodTrucks').doc(profileId);
        const profileDoc = await profileRef.get();

        if (!profileDoc.exists || profileDoc.data().owner_id !== ownerId) {
            return res.status(403).json({ message: "Brak uprawnień do edycji tego kalendarza." });
        }

        const availabilityDocRef = profileRef.collection('availability').doc(date);

        if (available) {
            await availabilityDocRef.delete();
            res.status(200).json({ message: `Data ${date} została oznaczona jako dostępna.` });
        } else {
            await availabilityDocRef.set({ status: 'unavailable' });
            res.status(200).json({ message: `Data ${date} została oznaczona jako niedostępna.` });
        }
    } catch (error) {
        console.error('Błąd aktualizacji dostępności:', error);
        res.status(500).json({ message: 'Błąd serwera.' });
    }
};
