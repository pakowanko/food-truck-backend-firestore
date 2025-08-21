/*
================================================
Poprawiony plik: /controllers/bookingRequestController.js
================================================
*/

const db = require('../firestore');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const sgMail = require('@sendgrid/mail');
const { createBrandedEmail } = require('../utils/emailTemplate');
const { findAndSuggestAlternatives } = require('../utils/suggestionUtils');
const { getDocByNumericId } = require('../utils/firestoreUtils');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

exports.createBookingRequest = async (req, res) => {
    const { 
        profile_id, event_start_date, event_end_date, event_description,
        event_type, guest_count, event_location, event_time,
        utility_costs
    } = req.body;
    
    const organizerId = req.user.userId;

    try {
        const userDoc = await getDocByNumericId('users', 'user_id', organizerId);
        if (!userDoc) {
            return res.status(404).json({ message: 'Nie znaleziono organizatora.' });
        }
        const organizerPhone = userDoc.data()?.phone_number || null;

        const newBookingData = {
            profile_id: parseInt(profile_id, 10),
            user_id: organizerId,
            event_start_date: Timestamp.fromDate(new Date(event_start_date)),
            event_end_date: Timestamp.fromDate(new Date(event_end_date)),
            event_details: event_description,
            status: 'pending_owner_approval',
            organizer_phone: organizerPhone,
            event_type,
            guest_count: parseInt(guest_count) || null,
            event_location,
            event_time,
            utility_costs: parseFloat(utility_costs) || null,
            created_at: FieldValue.serverTimestamp(),
            commission_paid: false,
            packaging_ordered: false,
            invoice_generated: false,
        };

        const newBookingRef = await db.collection('bookings').add(newBookingData);
        
        const profileDoc = await getDocByNumericId('foodTrucks', 'profile_id', parseInt(profile_id, 10));
        if (profileDoc && profileDoc.exists) {
            const ownerId = profileDoc.data().owner_id;
            const ownerDoc = await getDocByNumericId('users', 'user_id', ownerId);
            const ownerEmail = ownerDoc?.data()?.email;
            const foodTruckName = profileDoc.data()?.food_truck_name;

            if (ownerEmail) {
                const title = `Nowa prośba o rezerwację dla ${foodTruckName}!`;
                const body = `<p>Otrzymałeś nowe zapytanie o rezerwację. Zaloguj się na swoje konto, aby zobaczyć szczegóły.</p>`;
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
        
        const profileDoc = await getDocByNumericId('foodTrucks', 'profile_id', bookingRequest.profile_id);
        if (!profileDoc || !profileDoc.exists || profileDoc.data().owner_id !== ownerId) {
            return res.status(403).json({ message: 'Nie masz uprawnień do zmiany tej rezerwacji.' });
        }
        
        await bookingRef.update({ status });
        
        const organizerDoc = await getDocByNumericId('users', 'user_id', bookingRequest.user_id);
        const ownerDoc = await getDocByNumericId('users', 'user_id', ownerId);
        
        const organizerEmail = organizerDoc?.data()?.email;
        const ownerEmail = ownerDoc?.data()?.email;
        const foodTruckName = profileDoc.data()?.food_truck_name;

        if (status === 'confirmed') {
            if (organizerEmail) {
                const title = `Twoja rezerwacja dla ${foodTruckName} została POTWIERDZONA!`;
                const body = `<p>Dobra wiadomość! Twoja rezerwacja food trucka <strong>${foodTruckName}</strong> na wydarzenie w dniu ${bookingRequest.event_start_date.toDate().toLocaleDateString()} została potwierdzona przez właściciela.</p>`;
                const finalHtml = createBrandedEmail(title, body);
                const msg = { to: organizerEmail, from: { email: process.env.SENDER_EMAIL, name: 'BookTheFoodTruck' }, subject: title, html: finalHtml };
                await sgMail.send(msg);
            }

            if (ownerEmail) {
                const title = `Potwierdziłeś rezerwację #${requestId}!`;
                const body = `<p>Dziękujemy za potwierdzenie rezerwacji.</p><p><strong>Pamiętaj, że zgodnie z regulaminem, jesteś zobowiązany do zakupu opakowań na to wydarzenie w naszym sklepie: <a href="https://www.pakowanko.com">www.pakowanko.com</a>.</strong></p>`;
                const finalHtml = createBrandedEmail(title, body);
                const msg = { to: ownerEmail, from: { email: process.env.SENDER_EMAIL, name: 'BookTheFoodTruck' }, subject: title, html: finalHtml };
                await sgMail.send(msg);
            }
        
        } else if (status === 'rejected_by_owner') {
            findAndSuggestAlternatives(requestId);
        }

        const updatedBooking = await bookingRef.get();
        res.json({ request_id: updatedBooking.id, ...updatedBooking.data() });
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
        const profileDoc = await getDocByNumericId('foodTrucks', 'profile_id', booking.profile_id);
        if (!profileDoc || !profileDoc.exists) {
            return res.status(404).json({ message: "Nie znaleziono profilu powiązanego z rezerwacją." });
        }
        const ownerId = profileDoc.data().owner_id;

        if (userId !== booking.user_id && userId !== ownerId) {
            return res.status(403).json({ message: "Brak uprawnień do anulowania tej rezerwacji." });
        }

        const newStatus = user_type === 'organizer' ? 'cancelled_by_organizer' : 'cancelled_by_owner';
        await bookingRef.update({ status: newStatus });
        
        const ownerDoc = await getDocByNumericId('users', 'user_id', ownerId);
        const organizerDoc = await getDocByNumericId('users', 'user_id', booking.user_id);
        
        const foodTruckName = profileDoc.data()?.food_truck_name;
        const ownerEmail = ownerDoc?.data()?.email;
        const organizerEmail = organizerDoc?.data()?.email;
        const recipientEmail = user_type === 'organizer' ? ownerEmail : organizerEmail;
        const cancellerRole = user_type === 'organizer' ? 'Organizator' : 'Właściciel Food Trucka';

        const title = `Rezerwacja #${requestId} dla ${foodTruckName} została ANULOWANA`;
        const body = `<p>Rezerwacja na wydarzenie w dniu ${booking.event_start_date.toDate().toLocaleDateString()} została anulowana przez: <strong>${cancellerRole}</strong>.</p>`;
        const finalHtml = createBrandedEmail(title, body);
        const msg = { to: recipientEmail, from: { email: process.env.SENDER_EMAIL, name: 'BookTheFoodTruck' }, subject: title, html: finalHtml };
        await sgMail.send(msg);

        const updatedBooking = await bookingRef.get();
        res.json({ request_id: updatedBooking.id, ...updatedBooking.data() });
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
            const profilesSnap = await db.collection('foodTrucks').where('owner_id', '==', userId).get();
            if (profilesSnap.empty) {
                return res.json([]);
            }
            const profileIds = profilesSnap.docs.map(doc => doc.data().profile_id);
            if (profileIds.length === 0) return res.json([]);
            
            query = db.collection('bookings').where('profile_id', 'in', profileIds).orderBy('created_at', 'desc');
        }
        
        const bookingsSnap = await query.get();
        const bookings = await Promise.all(bookingsSnap.docs.map(async doc => {
            const booking = { request_id: doc.id, ...doc.data() };
            const profileSnap = await getDocByNumericId('foodTrucks', 'profile_id', booking.profile_id);
            booking.food_truck_name = profileSnap?.data()?.food_truck_name;

            if (userRole === 'food_truck_owner') {
                const organizerSnap = await getDocByNumericId('users', 'user_id', booking.user_id);
                booking.organizer_email = organizerSnap?.data()?.email;
                booking.organizer_first_name = organizerSnap?.data()?.first_name;
            }
            return booking;
        }));

        res.json(bookings);
    } catch (error) {
        console.error("Błąd pobierania rezerwacji:", error);
        res.status(500).json({ message: 'Błąd serwera.' });
    }
};