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
        let profilesCollectionRef = db.collection('foodTrucks');
        let query = profilesCollectionRef;
        
        if (cuisine) {
            query = query.where('offer.dishes', 'array-contains', cuisine);
        }
        if (long_term_rental === 'true') {
            query = query.where('long_term_rental_available', '==', true);
        }
        
        let profiles = [];
        
        if (!postal_code) {
            const snapshot = await query.orderBy('food_truck_name').get();
            profiles = snapshot.docs.map(doc => ({ profile_id: doc.id, ...doc.data() }));
        } else {
            const { lat, lon } = await getGeocode(postal_code);
            if (!lat || !lon) return res.json([]);
            
            const center = [lat, lon];
            const radiusInM = 500 * 1000; // 500km w metrach
            
            const queryBounds = geofire.geohashQueryBounds(center, radiusInM);
            const promises = queryBounds.map((b) => {
                const q = query.orderBy('geohash').startAt(b[0]).endAt(b[1]);
                return q.get();
            });

            const snapshots = await Promise.all(promises);
            let potentialMatches = [];
            snapshots.forEach(snap => {
                snap.forEach(doc => {
                    if (doc.data().location && !potentialMatches.some(p => p.profile_id === doc.id)) {
                        potentialMatches.push({ profile_id: doc.id, ...doc.data() });
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

        if (event_start_date && event_end_date) {
            const eventStart = new Date(event_start_date);
            const eventEnd = new Date(event_end_date);
            
            const bookingsSnap = await db.collection('bookings')
                .where('status', '==', 'confirmed')
                .where('event_start_date', '<=', eventEnd)
                .get();

            const unavailableProfileIds = new Set();
            bookingsSnap.forEach(doc => {
                const booking = doc.data();
                const bookingStart = booking.event_start_date.toDate();
                if (eventStart < booking.event_end_date.toDate() && eventEnd > bookingStart) {
                    unavailableProfileIds.add(booking.profile_id.toString());
                }
            });

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
        
        const newProfileData = {
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
        
        const fullProfileData = { profile_id: newProfileRef.id, ...newProfileData };
        
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
    const ownerId = req.user.userId;
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
        
        // --- POPRAWKA TUTAJ ---
        let galleryPhotoUrls;
        if (req.files && req.files.length > 0) {
            // Jeśli są nowe pliki, prześlij je i zastąp starą galerię
            const uploadPromises = req.files.map(uploadFileToGCS);
            galleryPhotoUrls = await Promise.all(uploadPromises);
        } else {
            // Jeśli nie ma nowych plików, użyj istniejącej galerii z bazy
            galleryPhotoUrls = existingData.gallery_photo_urls || [];
        }
        // --- KONIEC POPRAWKI ---
        
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
            gallery_photo_urls, // Teraz ta zmienna zawsze istnieje
            profile_image_url: galleryPhotoUrls[0] || null,
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
    const { profileId } = req.params;
    const profileDoc = await db.collection('foodTrucks').doc(profileId).get();

    if (profileDoc.exists) {
      res.json({ profile_id: profileDoc.id, ...profileDoc.data() });
    } else {
      res.status(404).json({ message: 'Nie znaleziono profilu o podanym ID.' });
    }
  } catch (error) {
    console.error("Błąd podczas pobierania pojedynczego profilu:", error);
    res.status(500).json({ message: 'Błąd serwera.' });
  }
};