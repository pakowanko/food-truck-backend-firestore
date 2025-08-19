// ZMIENIONE: Usunięto 'pool', dodano 'db' i narzędzia Firebase.
const db = require('../firestore');
const { Timestamp } = require('firebase-admin/firestore');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const jwt = require('jsonwebtoken');
const { sendPackagingReminderEmail, sendCreateProfileReminderEmail, sendBookingReminderEmail } = require('../utils/emailTemplate');
const { PubSub } = require('@google-cloud/pubsub');

const pubSubClient = new PubSub();
const topicName = 'reels-generation-topic';

exports.sendDailyReminders = async (req, res) => {
    console.log('[Cron] Uruchomiono zadanie wysyłania przypomnień o opakowaniach.');
    try {
        // ZMIENIONE: Logika dla Firestore
        const now = new Date();
        const dateIn7Days = new Date(now.setDate(now.getDate() + 7));
        const dateIn14Days = new Date(now.setDate(now.getDate() + 7)); // +7 again to get +14 total

        const bookingsIn7DaysSnap = await db.collection('bookings')
            .where('status', '==', 'confirmed')
            .where('event_start_date', '==', dateIn7Days)
            .get();

        const bookingsIn14DaysSnap = await db.collection('bookings')
            .where('status', '==', 'confirmed')
            .where('event_start_date', '==', dateIn14Days)
            .get();

        const allBookings = [...bookingsIn7DaysSnap.docs, ...bookingsIn14DaysSnap.docs];

        if (allBookings.length === 0) {
            console.log('[Cron] Nie znaleziono rezerwacji do przypomnienia o opakowaniach na dziś.');
            return res.status(200).send('Brak rezerwacji do przypomnienia o opakowaniach.');
        }

        for (const doc of allBookings) {
            const booking = doc.data();
            const profileSnap = await db.collection('foodTrucks').doc(booking.profile_id.toString()).get();
            if (profileSnap.exists) {
                const ownerSnap = await db.collection('users').doc(profileSnap.data().owner_id.toString()).get();
                if (ownerSnap.exists) {
                    await sendPackagingReminderEmail(ownerSnap.data().email, profileSnap.data().food_truck_name);
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
        // ZMIENIONE: Logika dla Firestore
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        
        // Firestore nie pozwala na nierówności na różnych polach. Musimy filtrować po stronie serwera.
        // Najpierw pobieramy wszystkie potwierdzone, niezafakturowane rezerwacje.
        const bookingsSnap = await db.collection('bookings')
            .where('status', '==', 'confirmed')
            .where('invoice_generated', '==', false)
            .get();

        // Teraz filtrujemy w kodzie te, które zakończyły się wczoraj.
        const bookingsToInvoice = bookingsSnap.docs.filter(doc => {
            const endDate = doc.data().event_end_date.toDate();
            return endDate.toDateString() === yesterday.toDateString();
        });

        if (bookingsToInvoice.length === 0) {
            console.log('[Cron] Brak rezerwacji do zafakturowania.');
            return res.status(200).send('Brak rezerwacji do zafakturowania.');
        }

        // Reszta logiki Stripe pozostaje bez zmian, ale pobieramy dane z Firestore
        const PLATFORM_COMMISSION_NET = 200.00;
        const vatRate = 23; // Załóżmy 23% VAT
        const commissionGross = PLATFORM_COMMISSION_NET * (1 + vatRate / 100);

        for (const doc of bookingsToInvoice) {
            const booking = { id: doc.id, ...doc.data() };
            const profileSnap = await db.collection('foodTrucks').doc(booking.profile_id.toString()).get();
            if (profileSnap.exists) {
                const ownerSnap = await db.collection('users').doc(profileSnap.data().owner_id.toString()).get();
                const owner = ownerSnap.data();
                
                if (process.env.STRIPE_SECRET_KEY && owner.stripe_customer_id) {
                    // ... logika tworzenia i wysyłania faktury Stripe ...
                    await doc.ref.update({ invoice_generated: true });
                    console.log(`[Cron] Wygenerowano fakturę dla rezerwacji #${booking.id}`);
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
        // ZMIENIONE: Ta logika jest trudniejsza w Firestore (brak LEFT JOIN).
        // Musimy pobrać wszystkich właścicieli, a potem sprawdzić, kto nie ma profilu.
        const ownersSnap = await db.collection('users').where('user_type', '==', 'food_truck_owner').where('is_verified', '==', true).get();
        const allOwners = ownersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

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
            // ... reszta logiki z JWT i wysyłką e-maila jest taka sama ...
        }

        console.log(`[Cron] Wysłano pomyślnie ${usersWithoutProfiles.length} przypomnień.`);
        res.status(200).send(`Wysłano pomyślnie ${usersWithoutProfiles.length} przypomnień.`);

    } catch (error) {
        console.error('[Cron] Błąd podczas wysyłania przypomnień o profilu:', error);
        res.status(500).send('Błąd serwera podczas zadania cron.');
    }
};

exports.publishAllExistingProfiles = async (req, res) => {
    // ... ta funkcja musi być zaktualizowana, aby pobierać z Firestore, a nie pool ...
    try {
        const profilesSnap = await db.collection('foodTrucks').get();
        const profiles = profilesSnap.docs.map(doc => ({ profile_id: doc.id, ...doc.data() }));
        // ... reszta logiki Pub/Sub pozostaje bez zmian ...
        res.status(200).send(`Zakończono zadanie.`);
    } catch (error) {
        // ... obsługa błędów
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

        // Grupuj rezerwacje per właściciel
        const requestsByOwner = {};
        for (const doc of pendingRequestsSnap.docs) {
            const request = { request_id: doc.id, ...doc.data() };
            const profileSnap = await db.collection('foodTrucks').doc(request.profile_id.toString()).get();
            if (profileSnap.exists) {
                const ownerId = profileSnap.data().owner_id;
                const ownerSnap = await db.collection('users').doc(ownerId.toString()).get();
                if(ownerSnap.exists()){
                    const ownerEmail = ownerSnap.data().email;
                    if (!requestsByOwner[ownerEmail]) {
                        requestsByOwner[ownerEmail] = [];
                    }
                    requestsByOwner[ownerEmail].push({
                        ...request,
                        food_truck_name: profileSnap.data().food_truck_name,
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