// ZMIENIONE: Usunięto 'pool', dodano 'db' (Firestore) i narzędzia Firebase.
const db = require('../firestore');
const { GeoPoint, FieldValue } = require('firebase-admin/firestore');
const { getGeocode, geofire } = require('../utils/geoUtils'); // Założenie: przeniosłeś geocode do osobnego pliku
const { Storage } = require('@google-cloud/storage');
const { PubSub } = require('@google-cloud/pubsub');

const pubSubClient = new PubSub();
const reelsTopicName = 'reels-generation-topic';
const postsTopicName = 'post-publication-topic';

const storage = new Storage();
const bucketName = process.env.GCS_BUCKET_NAME;

const uploadFileToGCS = (file) => {
  // ... ta funkcja pozostaje bez zmian ...
};

exports.getAllProfiles = async (req, res) => {
    const { cuisine, postal_code, event_start_date, event_end_date, long_term_rental } = req.query;
    
    try {
        let query = db.collection('foodTrucks');
        
        // --- ZMIENIONE: Filtrowanie dla Firestore ---

        // Filtr po kuchni (używa pola 'offer.dishes', które musi być tablicą w Firestore)
        if (cuisine) {
            query = query.where('offer.dishes', 'array-contains', cuisine);
        }

        // Filtr po wynajmie długoterminowym
        if (long_term_rental === 'true') {
            query = query.where('long_term_rental_available', '==', true);
        }
        
        let profiles = [];
        
        // Jeśli nie ma kodu pocztowego, wykonujemy proste zapytanie
        if (!postal_code) {
            const snapshot = await query.orderBy('food_truck_name').get();
            profiles = snapshot.docs.map(doc => ({ profile_id: doc.id, ...doc.data() }));
        } else {
        // --- ZMIENIONE: Logika wyszukiwania geograficznego z GeoFire ---
            const { lat, lon } = await getGeocode(postal_code);
            if (!lat || !lon) return res.json([]);
            
            const center = new GeoPoint(lat, lon);
            // GeoFire wymaga, aby w dokumentach pole 'location' było typu GeoPoint
            // GeoFireX (lub podobna biblioteka) jest potrzebna do złożonych zapytań geo + inne warunki
            const radiusInKm = 500; // Przykładowy duży promień do wstępnego filtrowania
            const nearbyQuery = geofire.query(query).within(center, radiusInKm);
            
            const snapshot = await geofire.get(nearbyQuery);
            profiles = snapshot.docs
                .map(doc => {
                    const data = doc.data();
                    const distance = geofire.distanceBetween(doc.data().location, center).km;
                    return { profile_id: doc.id, ...data, distance };
                })
                .filter(p => p.distance <= p.operation_radius_km)
                .sort((a, b) => a.distance - b.distance);
        }

        // Filtr po dostępności (daty) - musi być wykonany po pobraniu danych
        if (event_start_date && event_end_date) {
            const bookingsSnap = await db.collection('bookings')
                .where('status', '==', 'confirmed')
                .where('event_start_date', '<=', new Date(event_end_date))
                .get();

            const unavailableProfileIds = new Set();
            bookingsSnap.forEach(doc => {
                const booking = doc.data();
                const bookingStart = booking.event_start_date.toDate();
                const bookingEnd = booking.event_end_date.toDate();
                const eventStart = new Date(event_start_date);
                // Prosta logika OVERLAPS
                if (eventStart < bookingEnd && new Date(event_end_date) > bookingStart) {
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
    // ... walidacja i logika uploadu plików bez zmian ...
    const ownerId = parseInt(req.user.userId, 10);
    let { food_truck_name, food_truck_description, base_location, operation_radius_km, offer, long_term_rental_available } = req.body;
    
    try {
        // ... upload plików ...
        if (offer && typeof offer === 'string') offer = JSON.parse(offer);
        const isLongTerm = /true/i.test(long_term_rental_available);

        const { lat, lon } = await getGeocode(base_location);
        
        const newProfileData = {
            owner_id: ownerId,
            food_truck_name,
            food_truck_description,
            base_location,
            operation_radius_km: parseInt(operation_radius_km) || null,
            gallery_photo_urls: [], // zostanie dodane po uploadzie
            profile_image_url: null,
            offer,
            long_term_rental_available: isLongTerm,
            location: (lat && lon) ? new GeoPoint(lat, lon) : null,
            created_at: FieldValue.serverTimestamp()
        };

        // Dodaj pliki, jeśli istnieją
        if (req.files && req.files.length > 0) {
            const uploadPromises = req.files.map(uploadFileToGCS);
            newProfileData.gallery_photo_urls = await Promise.all(uploadPromises);
            newProfileData.profile_image_url = newProfileData.gallery_photo_urls[0] || null;
        }

        const newProfileRef = await db.collection('foodTrucks').add(newProfileData);
        
        // ... logika Pub/Sub bez zmian ...

        res.status(201).json({ profile_id: newProfileRef.id, ...newProfileData });
    } catch (error) {
        console.error('Błąd dodawania profilu food trucka:', error);
        res.status(500).json({ message: 'Błąd serwera lub nieprawidłowa lokalizacja.' });
    }
};

exports.updateProfile = async (req, res) => {
    const { profileId } = req.params;
    // ... walidacja ...
    
    try {
        // ... logika sprawdzania uprawnień ...
        const { lat, lon } = await getGeocode(req.body.base_location);
        const updateData = {
            // ... mapowanie pól z req.body ...
            location: (lat && lon) ? new GeoPoint(lat, lon) : null,
        };
        
        const profileRef = db.collection('foodTrucks').doc(profileId);
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