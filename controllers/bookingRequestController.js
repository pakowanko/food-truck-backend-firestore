// ZMIENIONE: Usunięto 'pool', dodano 'db' (Firestore) i narzędzia Firebase.
const db = require('../firestore');
const { FieldValue } = require('firebase-admin/firestore');
const sgMail = require('@sendgrid/mail');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createBrandedEmail, sendPackagingReminderEmail } = require('../utils/emailTemplate');
const { findAndSuggestAlternatives } = require('../utils/suggestionUtils');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Tworzenie nowej rezerwacji
exports.createBookingRequest = async (req, res) => {
    console.log('[Controller: createBookingRequest] Uruchomiono tworzenie rezerwacji.');
    const { 
        profile_id, event_start_date, event_end_date, event_description,
        event_type, guest_count, event_location, event_time,
        utility_costs
    } = req.body;
    
    const organizerId = req.user.userId;

    try {
        // ZMIENIONE: Operacje na Firestore
        const userDoc = await db.collection('users').doc(organizerId.toString()).get();
        const organizerPhone = userDoc.data()?.phone_number;

        const newBookingData = {
            profile_id: parseInt(profile_id, 10),
            user_id: organizerId, // Zmieniliśmy nazwę z organizer_id na spójne user_id
            event_start_date: new Date(event_start_date),
            event_end_date: new Date(event_end_date),
            event_details: event_description, // Zmieniliśmy nazwę
            status: 'pending_owner_approval',
            organizer_phone: organizerPhone,
            event_type,
            guest_count: parseInt(guest_count) || null,
            event_location,
            event_time,
            utility_costs: parseFloat(utility_costs) || null,
            created_at: FieldValue.serverTimestamp()
        };

        const newBookingRef = await db.collection('bookings').add(newBookingData);
        
        // Pobieranie danych właściciela do wysyłki e-maila
        const profileDoc = await db.collection('foodTrucks').doc(profile_id.toString()).get();
        if (profileDoc.exists) {
            const ownerId = profileDoc.data().owner_id;
            const ownerDoc = await db.collection('users').doc(ownerId.toString()).get();
            const ownerEmail = ownerDoc.data()?.email;
            const foodTruckName = profileDoc.data()?.food_truck_name;

            if (ownerEmail) {
                const title = `Nowa prośba o rezerwację dla ${foodTruckName}!`;
                const body = `<p>Otrzymałeś nowe zapytanie o rezerwację. Zaloguj się na swoje konto w BookTheFoodTruck, aby zobaczyć szczegóły.</p>`;
                const finalHtml = createBrandedEmail(title, body);
                
                const msg = {
                    to: ownerEmail,
                    from: { email: process.env.SENDER_EMAIL, name: 'BookTheFoodTruck' },
                    subject: title,
                    html: finalHtml,
                };
                await sgMail.send(msg);
            }
        }
        
        res.status(201).json({ request_id: newBookingRef.id, ...newBookingData });

    } catch (error) {
        console.error('Błąd tworzenia rezerwacji:', error);
        res.status(500).json({ message: 'Błąd serwera podczas tworzenia rezerwacji.' });
    }
};


exports.updateBookingStatus = async (req, res) => {
    const { requestId } = req.params;
    const { status } = req.body;
    const ownerId = req.user.userId;
    
    try {
        const bookingRef = db.collection('bookings').doc(requestId);
        const bookingDoc = await bookingRef.get();

        if (!bookingDoc.exists) {
            return res.status(404).json({ message: 'Nie znaleziono rezerwacji.' });
        }
        
        const bookingRequest = bookingDoc.data();
        
        const profileDoc = await db.collection('foodTrucks').doc(bookingRequest.profile_id.toString()).get();
        if (!profileDoc.exists || profileDoc.data().owner_id !== ownerId) {
            return res.status(403).json({ message: 'Nie masz uprawnień do zmiany tej rezerwacji.' });
        }
        
        await bookingRef.update({ status });
        
        const organizerDoc = await db.collection('users').doc(bookingRequest.user_id.toString()).get();
        const ownerDoc = await db.collection('users').doc(ownerId.toString()).get();
        
        const organizerEmail = organizerDoc.data()?.email;
        const ownerEmail = ownerDoc.data()?.email;
        const foodTruckName = profileDoc.data()?.food_truck_name;

        if (status === 'confirmed') {
            if (organizerEmail) {
                const title = `Twoja rezerwacja dla ${foodTruckName} została POTWIERDZONA!`;
                // ... reszta logiki email ...
                await sgMail.send(/* ... */);
            }
            if (ownerEmail) {
                const title = `Potwierdziłeś rezerwację #${requestId}!`;
                // ... reszta logiki email ...
                await sgMail.send(/* ... */);
            }
        } else if (status === 'rejected_by_owner') {
            findAndSuggestAlternatives(requestId); // Ta funkcja może wymagać dostosowania
        }

        res.json({ request_id: requestId, status });
    } catch (error) {
        console.error("Błąd aktualizacji statusu rezerwacji:", error);
        res.status(500).json({ message: error.message || 'Błąd serwera.' });
    }
};


exports.cancelBooking = async (req, res) => {
    const { requestId } = req.params;
    const { userId, user_type } = req.user;

    try {
        const bookingRef = db.collection('bookings').doc(requestId);
        const bookingDoc = await bookingRef.get();

        if (!bookingDoc.exists) {
            return res.status(404).json({ message: "Nie znaleziono rezerwacji." });
        }
        
        const booking = bookingDoc.data();
        const profileDoc = await db.collection('foodTrucks').doc(booking.profile_id.toString()).get();
        const ownerId = profileDoc.data().owner_id;

        if (userId !== booking.user_id && userId !== ownerId) {
            return res.status(403).json({ message: "Brak uprawnień do anulowania tej rezerwacji." });
        }

        const newStatus = user_type === 'organizer' ? 'cancelled_by_organizer' : 'cancelled_by_owner';
        await bookingRef.update({ status: newStatus });
        
        // Logika wysyłania e-maili pozostaje podobna, trzeba tylko pobrać dane z Firestore
        // ...

        res.json({ request_id: requestId, status: newStatus });
    } catch (error) {
        console.error("Błąd podczas anulowania rezerwacji:", error);
        res.status(500).json({ message: 'Błąd serwera.' });
    }
};

exports.getMyBookings = async (req, res) => {
    const userId = req.user.userId;
    const userRole = req.user.user_type;

    try {
        let query;
        if (userRole === 'organizer') {
            query = db.collection('bookings').where('user_id', '==', userId).orderBy('created_at', 'desc');
        } else { // food_truck_owner
            // To jest bardziej złożone, bo musimy znaleźć profile właściciela, a potem rezerwacje dla tych profili.
            const profilesSnap = await db.collection('foodTrucks').where('owner_id', '==', userId).get();
            if (profilesSnap.empty) {
                return res.json([]);
            }
            const profileIds = profilesSnap.docs.map(doc => parseInt(doc.id));
            query = db.collection('bookings').where('profile_id', 'in', profileIds).orderBy('created_at', 'desc');
        }
        
        const bookingsSnap = await query.get();
        const bookings = await Promise.all(bookingsSnap.docs.map(async doc => {
            const booking = { request_id: doc.id, ...doc.data() };
            // Dołączamy dodatkowe dane, tak jak w SQL JOIN
            const profileSnap = await db.collection('foodTrucks').doc(booking.profile_id.toString()).get();
            booking.food_truck_name = profileSnap.data()?.food_truck_name;

            if (userRole === 'food_truck_owner') {
                const organizerSnap = await db.collection('users').doc(booking.user_id.toString()).get();
                booking.organizer_email = organizerSnap.data()?.email;
                booking.organizer_first_name = organizerSnap.data()?.first_name;
                // ... etc.
            }
            return booking;
        }));

        res.json(bookings);
    } catch (error) {
        console.error("Błąd pobierania rezerwacji:", error);
        res.status(500).json({ message: 'Błąd serwera.' });
    }
};