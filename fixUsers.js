// plik: fixUsers.js
const db = require('./firestore');

async function fixUserDocuments() {
  console.log('Rozpoczynam naprawę dokumentów użytkowników...');
  const usersRef = db.collection('users');
  const snapshot = await usersRef.get();

  if (snapshot.empty) {
    console.log('Nie znaleziono żadnych użytkowników do naprawy.');
    return;
  }

  const batch = db.batch();
  let fixCount = 0;

  snapshot.forEach(doc => {
    const data = doc.data();
    // Sprawdzamy, czy pole user_id istnieje
    if (data.user_id === undefined) {
      console.log(`Naprawiam dokument użytkownika o ID: ${doc.id}`);
      // Jeśli nie, dodajemy je, używając ID dokumentu
      batch.update(doc.ref, { user_id: parseInt(doc.id, 10) });
      fixCount++;
    }
  });

  if (fixCount > 0) {
    await batch.commit();
    console.log(`✅ Pomyślnie naprawiono ${fixCount} dokumentów użytkowników.`);
  } else {
    console.log('Wszystkie dokumenty użytkowników wyglądają na poprawne.');
  }
}

fixUserDocuments()
  .then(() => console.log('Zakończono.'))
  .catch(console.error);