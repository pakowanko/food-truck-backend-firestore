// plik: migrate.js - WERSJA Z POPRAWIONYM KLUCZEM DLA REZERWACJI

const { Pool } = require('pg');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, GeoPoint } = require('firebase-admin/firestore');

// --- UZUPEŁNIJ DANE DO STAREJ BAZY POSTGRESQL ---
const pgPool = new Pool({
  connectionString: 'postgresql://postgres:SuperNoweTajneHasloDoBazy2025@34.140.118.233/postgres'
});

// --- Konfiguracja Firestore ---
const serviceAccount = require('./serviceAccountKey.json');
try {
  initializeApp({ credential: cert(serviceAccount) });
} catch (e) {
  // Ignoruj błąd, jeśli aplikacja jest już zainicjalizowana
}
const db = getFirestore();

// --- FUNKCJE MIGRACYJNE ---

async function migrateCollection(pgTable, firestoreCollection, pkColumn, transformFn = (row) => row) {
  console.log(`\n--- Rozpoczynam migrację: ${pgTable} -> ${firestoreCollection} ---`);
  const { rows } = await pgPool.query(`SELECT * FROM ${pgTable}`);
  console.log(`Znaleziono ${rows.length} rekordów do migracji.`);

  if (rows.length === 0) return;

  const batches = [];
  let currentBatch = db.batch();
  let operationCount = 0;

  for (const row of rows) {
    if (!row[pkColumn]) {
        console.warn(`Pominięto wiersz w tabeli ${pgTable}, ponieważ brakuje klucza głównego (ID). Dane wiersza:`, row);
        continue;
    }

    const docId = row[pkColumn].toString();
    const data = transformFn(row);
    const docRef = db.collection(firestoreCollection).doc(docId);
    currentBatch.set(docRef, data);
    operationCount++;

    if (operationCount >= 400) {
      batches.push(currentBatch);
      currentBatch = db.batch();
      operationCount = 0;
    }
  }
  batches.push(currentBatch);

  if (batches.length > 0 && operationCount > 0) {
    console.log(`Dane zostaną zapisane w ${batches.length} paczkach.`);
    for (let i = 0; i < batches.length; i++) {
        await batches[i].commit();
        console.log(`Paczka ${i + 1}/${batches.length} została zapisana.`);
    }
  }
  console.log(`✅ Migracja ${pgTable} zakończona!`);
}

async function migrateSubCollection(pgTable, parentCollection, childCollection, parentFkColumn, pkColumn, transformFn = (row) => row) {
    console.log(`\n--- Rozpoczynam migrację podkolekcji: ${pgTable} -> ${parentCollection}/.../${childCollection} ---`);
    const { rows } = await pgPool.query(`SELECT * FROM ${pgTable}`);
    console.log(`Znaleziono ${rows.length} rekordów do migracji.`);

    if (rows.length === 0) return;
    
    let batch = db.batch();
    let operationCount = 0;
    for (const row of rows) {
        if (!row[pkColumn] || !row[parentFkColumn]) {
            console.warn(`Pominięto wiersz w tabeli ${pgTable}, ponieważ brakuje klucza głównego (ID) lub klucza obcego. Dane wiersza:`, row);
            continue;
        }
        
        const parentId = row[parentFkColumn].toString();
        const docId = row[pkColumn].toString();
        const data = transformFn(row);
        const docRef = db.collection(parentCollection).doc(parentId).collection(childCollection).doc(docId);
        batch.set(docRef, data);
        operationCount++;

        if (operationCount >= 400) {
            await batch.commit();
            console.log(`Zapisano paczkę ${operationCount} rekordów.`);
            batch = db.batch();
            operationCount = 0;
        }
    }
    if (operationCount > 0) {
        await batch.commit();
        console.log(`Zapisano ostatnią paczkę ${operationCount} rekordów.`);
    }
    console.log(`✅ Migracja podkolekcji ${pgTable} zakończona!`);
}

// --- Główna funkcja uruchamiająca ---
async function main() {
  console.log('Uruchamiam tylko migrację rezerwacji...');

  // Migrujemy tylko rezerwacje, używając poprawnego klucza 'request_id'
  await migrateCollection('booking_requests', 'bookings', 'request_id', booking => ({
    profile_id: booking.profile_id,
    user_id: booking.organizer_id, // Używamy organizer_id jako user_id
    event_details: booking.event_description,
    event_start_date: booking.event_start_date,
    event_end_date: booking.event_end_date,
    status: booking.status,
    created_at: booking.created_at || new Date(),
    // Mapowanie dodatkowych pól
    event_time: booking.event_time,
    event_location: booking.event_location,
    guest_count: booking.guest_count,
    utility_costs: booking.utility_costs,
    organizer_phone: booking.organizer_phone,
    event_type: booking.event_type,
    commission_paid: booking.commission_paid,
    packaging_ordered: booking.packaging_ordered,
    invoice_generated: booking.invoice_generated,
  }));

  console.log('\n\nMigracja rezerwacji zakończona!');
}

main()
  .catch(err => console.error("WYSTĄPIŁ KRYTYCZNY BŁĄD MIGRACJI:", err))
  .finally(() => {
    console.log("Zamykanie połączenia z PostgreSQL.");
    pgPool.end();
  });