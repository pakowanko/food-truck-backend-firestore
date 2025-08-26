const admin = require('firebase-admin');

// --- KONFIGURACJA ---
// Musisz podać ścieżkę do swojego pliku klucza serwisowego Firebase
const serviceAccount = require('../serviceAccountKey.json');

// Dane identyfikujące zduplikowane rezerwacje
// ✅ POPRAWKA 1: Zmieniono typ z tekstu ('1002') na liczbę (1002)
const FOOD_TRUCK_DOC_ID = 1002;
const ORGANIZER_DOC_ID = 136;
const EVENT_DATE_STRING = '2025-08-30'; // Data w formacie RRRR-MM-DD
// --- KONIEC KONFIGURACJI ---

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function cleanupDuplicateBookings() {
  console.log('Rozpoczynam czyszczenie zduplikowanych rezerwacji...');

  // Ustawiamy zakres dat na cały dzień
  const startOfDay = new Date(EVENT_DATE_STRING);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(EVENT_DATE_STRING);
  endOfDay.setHours(23, 59, 59, 999);

  const bookingsRef = db.collection('bookings');
  const query = bookingsRef
    // ✅ POPRAWKA 2: Zmieniono 'food_truck_id' na 'profile_id'
    .where('profile_id', '==', FOOD_TRUCK_DOC_ID)
    // ✅ POPRAWKA 3: Zmieniono 'organizer_id' na 'user_id'
    .where('user_id', '==', ORGANIZER_DOC_ID)
    .where('event_start_date', '>=', admin.firestore.Timestamp.fromDate(startOfDay))
    .where('event_start_date', '<=', admin.firestore.Timestamp.fromDate(endOfDay))
    .orderBy('created_at', 'asc');

  try {
    const snapshot = await query.get();

    if (snapshot.empty || snapshot.size <= 1) {
      console.log('Nie znaleziono zduplikowanych rezerwacji do usunięcia.');
      return;
    }

    console.log(`Znaleziono ${snapshot.size} identycznych rezerwacji.`);
    
    const duplicatesToDelete = snapshot.docs.slice(1);
    
    console.log(`Pozostawiam jedną rezerwację. Usuwam ${duplicatesToDelete.length} duplikatów...`);

    const batch = db.batch();
    duplicatesToDelete.forEach(doc => {
      console.log(`Zaznaczono do usunięcia: ${doc.id}`);
      batch.delete(doc.ref);
    });

    await batch.commit();

    console.log('✅ Pomyślnie usunięto wszystkie zduplikowane rezerwacje.');

  } catch (error) {
    console.error('‼️ Wystąpił błąd podczas czyszczenia:', error);
  }
}

cleanupDuplicateBookings();