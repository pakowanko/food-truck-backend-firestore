// plik: firestore.js
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
    try {
      initializeApp({ credential: cert(serviceAccount) });
      console.log('✅ Połączono z Firestore używając klucza serwisowego (lokalnie).');
    } catch (e) {
      // Ignoruj błąd, jeśli aplikacja jest już zainicjalizowana (nodemon)
      if (e.code !== 'app/duplicate-app') {
        throw e;
      }
    }
  } else {
    // Jeśli pliku nie ma, jesteśmy na Cloud Run - połącz się automatycznie
    try {
      initializeApp();
      console.log('✅ Połączono z Firestore używając domyślnych uprawnień (Cloud Run).');
    } catch (e) {
      if (e.code !== 'app/duplicate-app') {
        throw e;
      }
    }
  }
  db = getFirestore();
} catch (e) {
    console.error("!!! KRYTYCZNY BŁĄD POŁĄCZENIA Z FIRESTORE:", e);
    process.exit(1); // Zakończ proces, jeśli nie można się połączyć
}

module.exports = db;