const db = require('../firestore');
const { GeoPoint } = require('firebase-admin/firestore'); 
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Storage } = require('@google-cloud/storage');
const axios = require('axios');

const storage = new Storage();
const bucketName = process.env.GCS_BUCKET_NAME;

// --- Funkcje Pomocnicze ---

async function geocode(locationString) {
    if (!locationString) return { lat: null, lon: null };
    const apiKey = process.env.GEOCODING_API_KEY;
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(locationString)}&components=country:PL&key=${apiKey}`;
    try {
        const response = await axios.get(url);
        if (response.data.status === 'OK' && response.data.results.length > 0) {
            const location = response.data.results[0].geometry.location;
            return { lat: location.lat, lon: location.lng };
        } else {
            return { lat: null, lon: null };
        }
    } catch (error) {
        console.error('Błąd Geocoding API w adminController:', error.message);
        return { lat: null, lon: null };
    }
}

async function deleteCollection(collectionPath, batchSize = 100) {
    const collectionRef = db.collection(collectionPath);
    const query = collectionRef.orderBy('__name__').limit(batchSize);
  
    return new Promise((resolve, reject) => {
      deleteQueryBatch(query, resolve).catch(reject);
    });
  
    async function deleteQueryBatch(query, resolve) {
      const snapshot = await query.get();
  
      if (snapshot.size === 0) {
        return resolve();
      }
  
      const batch = db.batch();
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
  
      process.nextTick(() => {
        deleteQueryBatch(query, resolve);
      });
    }
}

// --- Kontrolery ---

exports.getDashboardStats = async (req, res) => {
    try {
        const usersSnap = await db.collection('users').get();
        const profilesSnap = await db.collection('foodTrucks').get();
        const bookingsSnap = await db.collection('bookings').get();
        const commissionSnap = await db.collection('bookings').where('commission_paid', '==', true).get();

        res.json({
            users: usersSnap.size.toString(),
            profiles: profilesSnap.size.toString(),
            bookings: bookingsSnap.size.toString(),
            commission: (commissionSnap.size * 200).toString()
        });
    } catch (error) {
        console.error("Błąd pobierania statystyk (admin):", error);
        res.status(500).json({ message: "Błąd serwera." });
    }
};

exports.getAllUsers = async (req, res) => {
    try {
        const usersSnap = await db.collection('users').orderBy('user_id').get();
        // Zwracamy ID dokumentu jako `doc_id`, a numeryczne `user_id` pozostaje nienaruszone.
        const users = usersSnap.docs.map(doc => ({ doc_id: doc.id, ...doc.data() }));

        const usersWithProfileCount = await Promise.all(users.map(async user => {
            // Używamy numerycznego user.user_id, a nie doc.id
            const profilesSnap = await db.collection('foodTrucks').where('owner_id', '==', user.user_id).get();
            return { ...user, profile_count: profilesSnap.size };
        }));

        res.json(usersWithProfileCount);
    } catch (error) {
        console.error("Błąd pobierania użytkowników (admin):", error);
        res.status(500).json({ message: "Błąd serwera." });
    }
};

exports.updateProfileDetails = async (req, res) => {
    const { profileId } = req.params;
    const { operation_radius_km, food_truck_description, base_location } = req.body;

    try {
        const { lat, lon } = await geocode(base_location);
        const updateData = {
            operation_radius_km: parseInt(operation_radius_km, 10),
            food_truck_description,
            base_location,
        };

        if (lat && lon) {
            updateData.location = new GeoPoint(lat, lon);
        }

        const profileRef = db.collection('foodTrucks').doc(profileId);
        await profileRef.update(updateData);
        
        const updatedDoc = await profileRef.get();
        if (!updatedDoc.exists) {
            return res.status(404).json({ message: 'Nie znaleziono profilu.' });
        }
        res.json({ profile_id: updatedDoc.id, ...updatedDoc.data() });
    } catch (error) {
        console.error("Błąd aktualizacji profilu przez admina:", error);
        res.status(500).json({ message: "Błąd serwera." });
    }
};

exports.getAllBookings = async (req, res) => {
    try {
        const bookingsSnap = await db.collection('bookings').orderBy('created_at', 'desc').get();
        
        const bookingsData = await Promise.all(bookingsSnap.docs.map(async (doc) => {
            const booking = { request_id: doc.id, ...doc.data() };
            
            let profileInfo = { food_truck_name: 'Brak danych (usunięty profil)' };
            let ownerInfo = { owner_email: 'Brak danych', owner_phone: 'Brak danych', company_name: '' };
            let organizerInfo = { organizer_first_name: 'Brak', organizer_last_name: 'danych', organizer_email: 'Brak danych' };

            if (booking.profile_id) {
                const profileSnap = await db.collection('foodTrucks').where('profile_id', '==', booking.profile_id).limit(1).get();
                if (!profileSnap.empty) {
                    const profileDoc = profileSnap.docs[0];
                    const profileData = profileDoc.data();
                    profileInfo.food_truck_name = profileData.food_truck_name || 'Brak nazwy';
                    
                    if (profileData.owner_id) {
                        const ownerSnap = await db.collection('users').where('user_id', '==', profileData.owner_id).limit(1).get();
                        if (!ownerSnap.empty) {
                            const ownerData = ownerSnap.docs[0].data();
                            ownerInfo.owner_email = ownerData.email;
                            ownerInfo.owner_phone = ownerData.phone_number;
                            ownerInfo.company_name = ownerData.company_name;
                        }
                    }
                }
            }

            if (booking.user_id) {
                const organizerSnap = await db.collection('users').where('user_id', '==', booking.user_id).limit(1).get();
                if (!organizerSnap.empty) {
                    const orgData = organizerSnap.docs[0].data();
                    organizerInfo.organizer_first_name = orgData.first_name;
                    organizerInfo.organizer_last_name = orgData.last_name;
                    organizerInfo.organizer_email = orgData.email;
                }
            }

            return { ...booking, ...profileInfo, ...ownerInfo, ...organizerInfo };
        }));

        res.json(bookingsData);
    } catch (error) {
        console.error("Błąd pobierania rezerwacji (admin):", error);
        res.status(500).json({ message: "Błąd serwera." });
    }
};


exports.toggleUserBlock = async (req, res) => {
    const { userId } = req.params; // userId to ID dokumentu (string)
    try {
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        if (!userDoc.exists) { return res.status(404).json({ message: 'Nie znaleziono użytkownika.' }); }
        
        const currentStatus = userDoc.data().is_blocked || false;
        await userRef.update({ is_blocked: !currentStatus });

        res.json({ doc_id: userId, is_blocked: !currentStatus });
    } catch (error) {
        console.error("Błąd zmiany statusu blokady użytkownika:", error);
        res.status(500).json({ message: "Błąd serwera." });
    }
};

exports.updateUser = async (req, res) => {
    const { userId } = req.params; // userId to ID dokumentu (string)
    const updateData = req.body;
    try {
        const userRef = db.collection('users').doc(userId);
        await userRef.update(updateData);
        
        const updatedDoc = await userRef.get();
        if (!updatedDoc.exists) {
            return res.status(404).json({ message: 'Nie znaleziono użytkownika.' });
        }
        res.json({ doc_id: updatedDoc.id, ...updatedDoc.data() });
    } catch (error) {
        console.error("Błąd aktualizacji użytkownika przez admina:", error);
        res.status(500).json({ message: "Błąd serwera." });
    }
};

exports.deleteUser = async (req, res) => {
    const { userId } = req.params; // userId to ID dokumentu (string)
    
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) return res.status(404).json({ message: 'Użytkownik nie istnieje.' });
    const numericUserId = userDoc.data().user_id;

    if (numericUserId === req.user.userId) {
        return res.status(400).json({ message: "Nie możesz usunąć własnego konta administratora." });
    }

    try {
        const batch = db.batch();

        const profilesSnap = await db.collection('foodTrucks').where('owner_id', '==', numericUserId).get();
        const profileIds = [];
        for (const doc of profilesSnap.docs) {
            await deleteCollection(`foodTrucks/${doc.id}/reviews`);
            if (doc.data().profile_id) profileIds.push(doc.data().profile_id);
            batch.delete(doc.ref);
        }

        if (profileIds.length > 0) {
            const bookingsAsOwnerSnap = await db.collection('bookings').where('profile_id', 'in', profileIds).get();
            bookingsAsOwnerSnap.forEach(doc => batch.delete(doc.ref));
        }

        const bookingsAsOrganizerSnap = await db.collection('bookings').where('user_id', '==', numericUserId).get();
        bookingsAsOrganizerSnap.forEach(doc => batch.delete(doc.ref));

        const userRef = db.collection('users').doc(userId);
        batch.delete(userRef);
        
        await batch.commit();
        res.status(200).json({ message: 'Użytkownik i powiązane dane zostały pomyślnie usunięte.' });
    } catch (error) {
        console.error("Błąd podczas usuwania użytkownika przez admina:", error);
        res.status(500).json({ message: "Błąd serwera." });
    }
};

exports.updatePackagingStatus = async (req, res) => {
    const { requestId } = req.params;
    const { packaging_ordered } = req.body;
    try {
        const bookingRef = db.collection('bookings').doc(requestId);
        await bookingRef.update({ packaging_ordered });
        res.json({ request_id: requestId, packaging_ordered });
    } catch (error) {
        console.error("Błąd zmiany statusu opakowań:", error);
        res.status(500).json({ message: "Błąd serwera." });
    }
};

exports.updateCommissionStatus = async (req, res) => {
    const { requestId } = req.params;
    const { commission_paid } = req.body;
    try {
        const bookingRef = db.collection('bookings').doc(requestId);
        await bookingRef.update({ commission_paid });
        res.json({ request_id: requestId, commission_paid });
    } catch (error) {
        console.error("Błąd zmiany statusu prowizji:", error);
        res.status(500).json({ message: "Błąd serwera." });
    }
};

exports.getAllConversations = async (req, res) => {
    try {
        const conversationsSnap = await db.collection('conversations').orderBy('last_message_at', 'desc').get();
        if (conversationsSnap.empty) return res.json([]);

        const conversations = await Promise.all(conversationsSnap.docs.map(async (doc) => {
            const conversationData = doc.data();
            const participantDetails = [];

            if (Array.isArray(conversationData.participant_ids)) {
                const participantPromises = conversationData.participant_ids.map(async (id) => {
                    if (id) { 
                        const userSnap = await db.collection('users').where('user_id', '==', id).limit(1).get();
                        if (!userSnap.empty) {
                            const userData = userSnap.docs[0].data();
                            return {
                                user_id: userData.user_id,
                                email: userData.email, // Dodajemy email
                                name: userData.company_name || `${userData.first_name} ${userData.last_name}`
                            };
                        }
                    }
                    return null;
                });
                const results = await Promise.all(participantPromises);
                participantDetails.push(...results.filter(p => p !== null));
            }
            return {
                conversation_id: doc.id,
                ...conversationData,
                participants: participantDetails
            };
        }));
        res.json(conversations);
    } catch (error) {
        console.error('Błąd pobierania rozmów (admin):', error);
        res.status(500).json({ message: 'Błąd serwera podczas pobierania rozmów.' });
    }
};

exports.getConversationMessages = async (req, res) => {
    const { conversationId } = req.params;
    try {
        const messagesSnap = await db.collection('conversations').doc(conversationId).collection('messages').orderBy('created_at', 'asc').get();
        const messages = await Promise.all(messagesSnap.docs.map(async (doc) => {
            const message = { message_id: doc.id, ...doc.data() };
            const senderSnap = await db.collection('users').where('user_id', '==', message.sender_id).limit(1).get();
            return {
                ...message,
                sender_email: !senderSnap.empty ? senderSnap.docs[0].data().email : 'Nieznany',
            }
        }));
        res.status(200).json(messages);
    } catch (error) { 
        console.error("Błąd pobierania wiadomości (admin):", error); 
        res.status(500).json({ message: "Błąd serwera." }); 
    }
};

exports.getUserProfiles = async (req, res) => {
    const { userId } = req.params; // userId to ID dokumentu (string)
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) return res.status(404).json({ message: 'Użytkownik nie istnieje.' });
    const numericUserId = userDoc.data().user_id;

    try {
        const profilesSnap = await db.collection('foodTrucks').where('owner_id', '==', numericUserId).get();
        const profiles = profilesSnap.docs.map(doc => ({ profile_id: doc.id, ...doc.data() }));
        res.json(profiles);
    } catch (error) {
        console.error("Błąd pobierania profili użytkownika (admin):", error);
        res.status(500).json({ message: "Błąd serwera." });
    }
};

exports.getProfileForAdmin = async (req, res) => {
    const { profileId } = req.params;
    try {
        const profileDoc = await db.collection('foodTrucks').doc(profileId).get();
        if (!profileDoc.exists) { return res.status(404).json({ message: 'Nie znaleziono profilu.' }); }
        res.json({ profile_id: profileDoc.id, ...profileDoc.data() });
    } catch (error) {
        console.error(`Błąd podczas pobierania profilu o ID ${profileId}:`, error);
        res.status(500).json({ message: "Błąd serwera." });
    }
};

exports.deleteProfilePhoto = async (req, res) => {
    const { profileId } = req.params;
    const { photoUrl } = req.body;
    try {
        const profileRef = db.collection('foodTrucks').doc(profileId);
        await db.runTransaction(async (transaction) => {
            const profileDoc = await transaction.get(profileRef);
            if (!profileDoc.exists) { throw new Error("Nie znaleziono profilu."); }
            const data = profileDoc.data();
            const newGallery = data.gallery_photo_urls.filter(url => url !== photoUrl);
            transaction.update(profileRef, { gallery_photo_urls: newGallery });
            if (data.profile_image_url === photoUrl) {
                transaction.update(profileRef, { profile_image_url: newGallery.length > 0 ? newGallery[0] : null });
            }
        });
        const fileName = photoUrl.split(`/${bucketName}/`)[1];
        if (fileName) await storage.bucket(bucketName).file(fileName).delete();
        res.status(200).json({ message: 'Zdjęcie zostało usunięte.' });
    } catch (error) {
        console.error("Błąd podczas usuwania zdjęcia przez admina:", error);
        res.status(500).json({ message: "Błąd serwera." });
    }
};

exports.deleteProfile = async (req, res) => {
    const { profileId } = req.params;
    try {
        const batch = db.batch();
        const profileRef = db.collection('foodTrucks').doc(profileId);
        
        const profileDoc = await profileRef.get();
        if (!profileDoc.exists) return res.status(404).json({ message: "Profil nie istnieje" });
        const numericProfileId = profileDoc.data().profile_id; 

        await deleteCollection(`foodTrucks/${profileId}/reviews`);

        if (numericProfileId) {
            const bookingsSnap = await db.collection('bookings').where('profile_id', '==', numericProfileId).get();
            bookingsSnap.forEach(doc => batch.delete(doc.ref));
        }

        batch.delete(profileRef);
        await batch.commit();
        res.status(200).json({ message: 'Profil został pomyślnie usunięty.' });
    } catch (error) {
        console.error("Błąd podczas usuwania profilu (admin):", error);
        res.status(500).json({ message: "Błąd serwera." });
    }
};

exports.handleStripeWebhook = async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    if (event.type === 'invoice.paid') {
        const invoice = event.data.object;
        const description = invoice.lines.data[0]?.description;
        const match = description?.match(/Rezerwacja #(\w+)/);
        if (match && match[1]) {
            const requestId = match[1];
            try {
                const bookingRef = db.collection('bookings').doc(requestId);
                await bookingRef.update({ commission_paid: true });
                console.log(`✅ Pomyślnie zaktualizowano status prowizji dla rezerwacji #${requestId}.`);
            } catch (dbError) {
                console.error(`❌ Błąd podczas aktualizacji bazy danych dla rezerwacji #${requestId}:`, dbError);
            }
        }
    }
    res.json({ received: true });
};

exports.syncAllUsersWithStripe = async (req, res) => {
    try {
        const usersSnap = await db.collection('users')
            .where('user_type', '==', 'food_truck_owner')
            .where('stripe_customer_id', '!=', null)
            .get();
        if (usersSnap.empty) return res.status(200).send('Brak użytkowników do synchronizacji.');
        
        const users = usersSnap.docs.map(doc => doc.data());
        for (const user of users) {
            try {
                await stripe.customers.update(user.stripe_customer_id, {
                    email: user.email,
                    name: user.company_name || `${user.first_name} ${user.last_name}`,
                    phone: user.phone_number,
                    address: { line1: user.street_address, postal_code: user.postal_code, city: user.city, country: user.country_code || 'PL' },
                    metadata: { nip: user.nip || '', internal_id: user.user_id }
                });
            } catch (stripeError) {
                console.warn(`[SYNC] Nie udało się zaktualizować klienta ${user.email} w Stripe: ${stripeError.message}`);
            }
        }
        res.status(200).send(`Synchronizacja zakończona.`);
    } catch (error) {
        console.error('[SYNC] Krytyczny błąd podczas synchronizacji:', error);
        res.status(500).send('Wystąpił krytyczny błąd serwera.');
    }
};

exports.getBookingById = async (req, res) => {
    const { requestId } = req.params;
    try {
        const bookingDoc = await db.collection('bookings').doc(requestId).get();
        if (!bookingDoc.exists) {
            return res.status(404).json({ message: 'Nie znaleziono rezerwacji o podanym ID.' });
        }
        const booking = { request_id: bookingDoc.id, ...bookingDoc.data() };

        let profileInfo = { food_truck_name: 'Brak danych' };
        let ownerInfo = { owner_email: 'Brak danych', owner_phone: 'Brak danych' };
        let organizerInfo = { organizer_first_name: 'Brak', organizer_last_name: 'danych', organizer_email: 'Brak danych', organizer_phone: 'Brak danych' };

        if (booking.profile_id) {
            const profileSnap = await db.collection('foodTrucks').where('profile_id', '==', booking.profile_id).limit(1).get();
            if (!profileSnap.empty) {
                const profileDoc = profileSnap.docs[0];
                const profileData = profileDoc.data();
                profileInfo.food_truck_name = profileData.food_truck_name;
                if (profileData.owner_id) {
                    const ownerSnap = await db.collection('users').where('user_id', '==', profileData.owner_id).limit(1).get();
                    if (!ownerSnap.empty) {
                        const ownerData = ownerSnap.docs[0].data();
                        ownerInfo.owner_email = ownerData.email;
                        ownerInfo.owner_phone = ownerData.phone_number;
                    }
                }
            }
        }
        if (booking.user_id) {
            const organizerSnap = await db.collection('users').where('user_id', '==', booking.user_id).limit(1).get();
            if (!organizerSnap.empty) {
                const orgData = organizerSnap.docs[0].data();
                organizerInfo.organizer_first_name = orgData.first_name;
                organizerInfo.organizer_last_name = orgData.last_name;
                organizerInfo.organizer_email = orgData.email;
                organizerInfo.organizer_phone = orgData.phone_number;
            }
        }

        res.json({ ...booking, ...profileInfo, ...ownerInfo, ...organizerInfo });
    } catch (error) {
        console.error("Błąd pobierania szczegółów rezerwacji (admin):", error);
        res.status(500).json({ message: "Błąd serwera." });
    }
};