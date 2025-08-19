const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');

let db;

try {
  // Sprawdź, czy plik klucza istnieje (dla środowiska lokalnego)
  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = require(serviceAccountPath);
    initializeApp({ credential: cert(serviceAccount) });
    console.log('✅ Połączono z Firestore używając klucza serwisowego (lokalnie).');
  } else {
    // Jeśli pliku nie ma, jesteśmy na Cloud Run - połącz się automatycznie
    initializeApp();
    console.log('✅ Połączono z Firestore używając domyślnych uprawnień (Cloud Run).');
  }
  db = getFirestore();
} catch (e) {
    if (e.code === 'app/duplicate-app') {
        // Ignoruj błąd, jeśli aplikacja jest już zainicjalizowana (przydatne przy nodemon)
        db = getFirestore();
    } else {
        console.error("!!! KRYTYCZNY BŁĄD POŁĄCZENIA Z FIRESTORE:", e);
        throw e;
    }
}

module.exports = db;