// ZMIENIONE: Usunięto 'pool', dodano 'db' (Firestore).
const db = require('../firestore');
const { sendSuggestionEmail } = require('./emailTemplate');
const { Timestamp } = require('firebase-admin/firestore');

/**
 * Główna funkcja orkiestrująca. Znajduje alternatywy i zleca wysyłkę maila.
 * @param {string} bookingRequestId - ID odrzuconej rezerwacji.
 */
exports.findAndSuggestAlternatives = async (bookingRequestId) => {
    try {
        // 1. Pobierz szczegóły odrzuconej rezerwacji
        const bookingDetails = await getRejectedBookingInfo(bookingRequestId);
        if (!bookingDetails) {
            console.log(`[Sugestie] Nie znaleziono rezerwacji o ID: ${bookingRequestId}`);
            return;
        }

        const { mainCuisine, rejectedProfileId, event_start_date, event_end_date } = bookingDetails;
        if (!mainCuisine) {
            console.log(`[Sugestie] Brak głównej kuchni dla profilu: ${rejectedProfileId}. Przerywam.`);
            return;
        }

        // 2. Znajdź do 3 alternatywnych food trucków
        const alternatives = await findAvailableTrucks(mainCuisine, rejectedProfileId, event_start_date, event_end_date);
        if (alternatives.length === 0) {
            console.log(`[Sugestie] Nie znaleziono alternatyw dla kuchni "${mainCuisine}".`);
            return;
        }

        // 3. Wyślij email do organizatora
        await sendSuggestionEmail(bookingDetails, alternatives);
        console.log(`[Sugestie] Pomyślnie wysłano email z sugestiami do ${bookingDetails.organizer_email}`);

    } catch (error) {
        console.error(`[Sugestie] Wystąpił błąd dla rezerwacji ${bookingRequestId}:`, error);
    }
};

// --- Funkcje pomocnicze ---

async function getRejectedBookingInfo(requestId) {
    // ZMIENIONE: Pobieranie danych z Firestore
    const bookingDoc = await db.collection('bookings').doc(requestId.toString()).get();
    if (!bookingDoc.exists) return null;

    const booking = bookingDoc.data();
    
    const profileDoc = await db.collection('foodTrucks').doc(booking.profile_id.toString()).get();
    const organizerDoc = await db.collection('users').doc(booking.user_id.toString()).get();

    if (!profileDoc.exists || !organizerDoc.exists) return null;

    const profile = profileDoc.data();
    const organizer = organizerDoc.data();

    return {
        request_id: bookingDoc.id,
        rejectedProfileId: booking.profile_id,
        event_start_date: booking.event_start_date,
        event_end_date: booking.event_end_date,
        rejectedTruckName: profile.food_truck_name,
        mainCuisine: profile.offer?.dishes?.[0], // Bierzemy pierwszą potrawę jako główną kuchnię
        organizer_email: organizer.email,
        organizer_firstName: organizer.first_name
    };
}

async function findAvailableTrucks(cuisine, rejectedProfileId, startDate, endDate) {
    // ZMIENIONE: Logika wyszukiwania alternatyw w Firestore
    
    // 1. Znajdź wszystkich kandydatów z tą samą kuchnią (i nie tego odrzuconego)
    const candidatesSnap = await db.collection('foodTrucks')
        .where('offer.dishes', 'array-contains', cuisine)
        .get();

    let allTrucksWithCuisine = [];
    candidatesSnap.forEach(doc => {
        if (doc.id !== rejectedProfileId.toString()) {
            allTrucksWithCuisine.push({ profile_id: doc.id, ...doc.data() });
        }
    });

    // 2. Znajdź ID wszystkich niedostępnych food trucków w danym terminie
    const unavailableBookingsSnap = await db.collection('bookings')
        .where('status', '==', 'confirmed')
        .where('event_start_date', '<=', endDate) // Wstępne filtrowanie
        .get();
        
    const unavailableProfileIds = new Set();
    unavailableBookingsSnap.forEach(doc => {
        const booking = doc.data();
        const bookingStart = booking.event_start_date; // Timestampy można porównywać bezpośrednio
        const bookingEnd = booking.event_end_date;
        // Sprawdzanie, czy okresy się nakładają (OVERLAPS)
        if (startDate < bookingEnd && endDate > bookingStart) {
            unavailableProfileIds.add(booking.profile_id.toString());
        }
    });

    // 3. Odfiltruj niedostępne food trucki i weź pierwsze 3
    const availableTrucks = allTrucksWithCuisine
        .filter(truck => !unavailableProfileIds.has(truck.profile_id))
        .slice(0, 3);
        
    return availableTrucks.map(truck => ({
        profile_id: truck.profile_id,
        food_truck_name: truck.food_truck_name,
        profile_image_url: truck.profile_image_url,
        food_truck_description: truck.food_truck_description
    }));
}