const db = require('../firestore');

async function unifyProfileIds() {
    console.log('🚀 Rozpoczynam ujednolicanie ID profili...');
    const profilesRef = db.collection('foodTrucks');
    const snapshot = await profilesRef.get();

    if (snapshot.empty) {
        console.log('Brak profili do przetworzenia.');
        return;
    }

    const updates = [];
    let counter = 2000; // Zaczynamy od wysokiej liczby dla nowych ID

    snapshot.forEach(doc => {
        const data = doc.data();
        const docId = doc.id;

        // Sprawdzamy, czy pole `profile_id` już istnieje i jest numerem
        if (typeof data.profile_id === 'number') {
            console.log(`✅ Profil ${docId} ma już poprawne ID: ${data.profile_id}. Pomijam.`);
            return;
        }

        // Próbujemy przekonwertować ID dokumentu na liczbę
        const numericId = parseInt(docId, 10);

        if (!isNaN(numericId)) {
            // Jeśli ID dokumentu jest numeryczne, używamy go
            console.log(`🔧 Profil ${docId} otrzymuje numeryczne ID: ${numericId}`);
            updates.push(doc.ref.update({ profile_id: numericId }));
        } else {
            // Jeśli ID dokumentu to tekst, przypisujemy nowe, unikalne ID
            console.log(`🔧 Profil ${docId} (tekstowe ID) otrzymuje nowe numeryczne ID: ${counter}`);
            updates.push(doc.ref.update({ profile_id: counter }));
            counter++;
        }
    });

    if (updates.length > 0) {
        console.log(`\nZapisywanie ${updates.length} aktualizacji w bazie...`);
        await Promise.all(updates);
        console.log('✅ Ujednolicanie zakończone!');
    } else {
        console.log('Wszystkie profile były już spójne.');
    }
}

unifyProfileIds().catch(console.error);