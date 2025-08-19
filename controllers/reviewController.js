// ZMIENIONE: Usunięto 'pool', dodano 'db' (Firestore).
const db = require('../firestore');
const { FieldValue } = require('firebase-admin/firestore');

exports.getReviewsForProfile = async (req, res) => {
    try {
        const { profileId } = req.params;

        // ZMIENIONE: Pobieranie opinii z podkolekcji jest bardzo proste i wydajne.
        const reviewsSnap = await db.collection('foodTrucks').doc(profileId).collection('reviews')
            .orderBy('created_at', 'desc')
            .get();
        
        const reviews = reviewsSnap.docs.map(doc => ({ review_id: doc.id, ...doc.data() }));
        res.json(reviews);
    } catch (error) {
        console.error("Błąd podczas pobierania opinii:", error);
        res.status(500).json({ message: "Błąd serwera." });
    }
};

exports.createReview = async (req, res) => {
    const { request_id, rating, comment } = req.body;
    const organizerId = req.user.userId;

    try {
        // ZMIENIONE: Logika transakcji dla Firestore.
        // Najpierw pobieramy potrzebne dokumenty.
        const bookingDoc = await db.collection('bookings').doc(request_id.toString()).get();

        if (!bookingDoc.exists) {
            return res.status(404).json({ message: "Nie znaleziono rezerwacji." });
        }

        const booking = bookingDoc.data();
        const profileId = booking.profile_id;

        // Sprawdzamy uprawnienia.
        if (booking.user_id !== organizerId) {
            return res.status(403).json({ message: "Nie możesz wystawić opinii dla tej rezerwacji." });
        }
        
        // UWAGA - DENORMALIZACJA: Pobieramy imię użytkownika, aby zapisać je w opinii.
        // Dzięki temu przy wyświetlaniu opinii nie musimy robić dodatkowego zapytania o dane użytkownika.
        const userDoc = await db.collection('users').doc(organizerId.toString()).get();
        const firstName = userDoc.data()?.first_name || 'Anonim';

        const newReviewData = {
            profile_id: profileId,
            user_id: organizerId, // Wciąż przechowujemy ID, na wypadek potrzeby
            request_id: parseInt(request_id, 10),
            rating: parseInt(rating, 10),
            comment,
            first_name: firstName, // <-- Zapisujemy imię bezpośrednio w dokumencie opinii
            created_at: FieldValue.serverTimestamp()
        };

        // Zapisujemy nową opinię w podkolekcji odpowiedniego food trucka.
        const reviewRef = await db.collection('foodTrucks').doc(profileId.toString()).collection('reviews').add(newReviewData);
        
        res.status(201).json({ review_id: reviewRef.id, ...newReviewData });

    } catch (error) {
        console.error("Błąd podczas tworzenia opinii:", error);
        res.status(500).json({ message: "Błąd serwera." });
    }
};