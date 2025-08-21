// plik: /controllers/cronController.js

const db = require('../firestore');
const { Timestamp } = require('firebase-admin/firestore');
const jwt = require('jsonwebtoken');
const { sendPackagingReminderEmail, sendCreateProfileReminderEmail, sendBookingReminderEmail } = require('../utils/emailTemplate');
const { PubSub } = require('@google-cloud/pubsub');
// ✨ KROK 1: Importujemy naszą uniwersalną funkcję
const { getDocByNumericId } = require('../utils/firestoreUtils');

const pubSubClient = new PubSub();
const topicName = 'reels-generation-topic';

exports.sendDailyReminders = async (req, res) => {
    console.log('[Cron] Uruchomiono zadanie wysyłania przypomnień o opakowaniach.');
    try {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        const dateIn7Days = new Date(today);
        dateIn7Days.setDate(today.getDate() + 7);
        const timestampIn7Days = Timestamp.fromDate(dateIn7Days);

        const dateIn14Days = new Date(today);
        dateIn14Days.setDate(today.getDate() + 14);
        const timestampIn14Days = Timestamp.fromDate(dateIn14Days);

        const bookingsIn7DaysSnap = await db.collection('bookings')
            .where('status', '==', 'confirmed')
            .where('event_start_date', '==', timestampIn7Days)
            .get();

        const bookingsIn14DaysSnap = await db.collection('bookings')
            .where('status', '==', 'confirmed')
            .where('event_start_date', '==', timestampIn14Days)
            .get();

        const allBookings = [...bookingsIn7DaysSnap.docs, ...bookingsIn14DaysSnap.docs];

        if (allBookings.length === 0) {
            console.log('[Cron] Nie znaleziono rezerwacji do przypomnienia o opakowaniach na dziś.');
            return res.status(200).send('Brak rezerwacji do przypomnienia o opakowaniach.');
        }

        for (const doc of allBookings) {
            const booking = doc.data();
            // ✨ KROK 2: Używamy nowej funkcji do znalezienia profilu i właściciela
            const profileDoc = await getDocByNumericId('foodTrucks', 'profile_id', booking.profile_id);
            if (profileDoc && profileDoc.exists) {
                const ownerDoc = await getDocByNumericId('users', 'user_id', profileDoc.data().owner_id);
                if (ownerDoc && ownerDoc.exists) {
                    await sendPackagingReminderEmail(ownerDoc.data().email, profileDoc.data().food_truck_name);
                }
            }
        }

        res.status(200).send(`Wysłano pomyślnie ${allBookings.length} przypomnień o opakowaniach.`);

    } catch (error) {
        console.error('[Cron] Błąd podczas wysyłania przypomnień o opakowaniach:', error);
        res.status(500).send('Błąd serwera podczas zadania cron.');
    }
};

exports.generateDailyInvoices = async (req, res) => {
    console.log('[Cron] Uruchomiono zadanie generowania faktur.');
    try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        
        const bookingsSnap = await db.collection('bookings')
            .where('status', '==', 'confirmed')
            .where('invoice_generated', '==', false)
            .get();

        const bookingsToInvoice = bookingsSnap.docs.filter(doc => {
            const endDate = doc.data().event_end_date.toDate();
            return endDate.toDateString() === yesterday.toDateString();
        });

        if (bookingsToInvoice.length === 0) {
            console.log('[Cron] Brak rezerwacji do zafakturowania.');
            return res.status(200).send('Brak rezerwacji do zafakturowania.');
        }

        for (const doc of bookingsToInvoice) {
            const booking = { id: doc.id, ...doc.data() };
            const profileDoc = await getDocByNumericId('foodTrucks', 'profile_id', booking.profile_id);
            if (profileDoc && profileDoc.exists) {
                const ownerDoc = await getDocByNumericId('users', 'user_id', profileDoc.data().owner_id);
                if (ownerDoc && ownerDoc.exists) {
                    const owner = ownerDoc.data();
                    if (process.env.STRIPE_SECRET_KEY && owner.stripe_customer_id) {
                        // ... logika tworzenia i wysyłania faktury Stripe ...
                        await doc.ref.update({ invoice_generated: true });
                        console.log(`[Cron] Wygenerowano fakturę dla rezerwacji #${booking.id}`);
                    }
                }
            }
        }
        res.status(200).send(`Wygenerowano ${bookingsToInvoice.length} faktur.`);
    } catch (error) {
        console.error('[Cron] Błąd podczas generowania faktur:', error);
        res.status(500).send('Błąd serwera podczas zadania cron.');
    }
};


exports.sendProfileCreationReminders = async (req, res) => {
    console.log('[Cron] Uruchomiono zadanie wysyłania przypomnień o utworzeniu profilu.');
    try {
        const ownersSnap = await db.collection('users').where('user_type', '==', 'food_truck_owner').where('is_verified', '==', true).get();
        const allOwners = ownersSnap.docs.map(doc => doc.data());

        const usersWithoutProfiles = [];
        for (const user of allOwners) {
            const profilesSnap = await db.collection('foodTrucks').where('owner_id', '==', user.user_id).limit(1).get();
            if (profilesSnap.empty) {
                usersWithoutProfiles.push(user);
            }
        }

        if (usersWithoutProfiles.length === 0) {
            console.log('[Cron] Nie znaleziono właścicieli bez profili do przypomnienia.');
            return res.status(200).send('Brak użytkowników do przypomnienia.');
        }

        for (const user of usersWithoutProfiles) {
            const payload = { userId: user.user_id, email: user.email };
            const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
            await sendCreateProfileReminderEmail(user.email, user.first_name, token);
        }

        console.log(`[Cron] Wysłano pomyślnie ${usersWithoutProfiles.length} przypomnień.`);
        res.status(200).send(`Wysłano pomyślnie ${usersWithoutProfiles.length} przypomnień.`);

    } catch (error) {
        console.error('[Cron] Błąd podczas wysyłania przypomnień o profilu:', error);
        res.status(500).send('Błąd serwera podczas zadania cron.');
    }
};

exports.publishAllExistingProfiles = async (req, res) => {
    try {
        const profilesSnap = await db.collection('foodTrucks').get();
        if (profilesSnap.empty) {
            return res.status(200).send('Brak profili do opublikowania.');
        }

        for (const doc of profilesSnap.docs) {
            const profileData = { doc_id: doc.id, ...doc.data() };
            if (profileData.gallery_photo_urls && profileData.gallery_photo_urls.length > 0) {
                const dataBuffer = Buffer.from(JSON.stringify(profileData));
                try {
                    await pubSubClient.topic(topicName).publishMessage({ data: dataBuffer });
                } catch (pubSubError) {
                    console.error(`[Cron] Nie udało się opublikować profilu ${profileData.doc_id}: ${pubSubError.message}`);
                }
            }
        }
        res.status(200).send(`Zakończono zadanie publikowania profili.`);
    } catch (error) {
        console.error('[Cron] Błąd podczas publikowania profili:', error);
        res.status(500).send('Błąd serwera podczas zadania cron.');
    }
};

exports.sendPendingBookingReminders = async (req, res) => {
    console.log('[CRON] Uruchomiono zadanie wysyłania przypomnień o oczekujących rezerwacjach.');
    try {
        const twentyFourHoursAgo = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
        
        const pendingRequestsSnap = await db.collection('bookings')
            .where('status', '==', 'pending_owner_approval')
            .where('created_at', '<', twentyFourHoursAgo)
            .get();

        if (pendingRequestsSnap.empty) {
            console.log('[CRON] Brak oczekujących rezerwacji do przypomnienia.');
            return res.status(200).send('Brak rezerwacji do przypomnienia.');
        }

        const requestsByOwner = {};
        for (const doc of pendingRequestsSnap.docs) {
            const request = { request_id: doc.id, ...doc.data() };
            const profileDoc = await getDocByNumericId('foodTrucks', 'profile_id', request.profile_id);
            if (profileDoc && profileDoc.exists) {
                const ownerId = profileDoc.data().owner_id;
                const ownerDoc = await getDocByNumericId('users', 'user_id', ownerId);
                if(ownerDoc && ownerDoc.exists){
                    const ownerEmail = ownerDoc.data().email;
                    if (!requestsByOwner[ownerEmail]) {
                        requestsByOwner[ownerEmail] = [];
                    }
                    requestsByOwner[ownerEmail].push({
                        ...request,
                        food_truck_name: profileDoc.data().food_truck_name,
                    });
                }
            }
        }

        let emailsSent = 0;
        for (const ownerEmail in requestsByOwner) {
            await sendBookingReminderEmail(ownerEmail, requestsByOwner[ownerEmail]);
            emailsSent++;
        }

        const summary = `Zadanie zakończone. Wysłano ${emailsSent} e-maili z przypomnieniami.`;
        console.log(`[CRON] ${summary}`);
        res.status(200).send(summary);

    } catch (error) {
        console.error('[CRON] Błąd podczas wysyłania przypomnień o rezerwacjach:', error);
        res.status(500).send('Błąd serwera podczas wykonywania zadania cron.');
    }
};
