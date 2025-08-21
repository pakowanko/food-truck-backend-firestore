// Plik: fixDuplicateId.js
// Ten skrypt naprawia zduplikowane user_id i synchronizuje licznik.

const db = require('./firestore');

// ✨ Wpisz email użytkownika, którego ID chcemy naprawić
const emailToFix = "wloskieniebiosa@gmail.com";

async function fixDuplicateId() {
    console.log('[NAPRAWA] Uruchomiono skrypt naprawy zduplikowanego ID...');

    try {
        // Krok 1: Znajdź najwyższe istniejące user_id w całej kolekcji
        const usersSnap = await db.collection('users').get();
        if (usersSnap.empty) {
            console.log('[NAPRAWA] Kolekcja użytkowników jest pusta.');
            return;
        }

        let highestCurrentId = 0;
        usersSnap.docs.forEach(doc => {
            const userId = doc.data().user_id;
            if (userId && userId > highestCurrentId) {
                highestCurrentId = userId;
            }
        });
        console.log(`[NAPRAWA] Znaleziono najwyższe istniejące user_id: ${highestCurrentId}`);

        // Krok 2: Znajdź dokument użytkownika, którego chcemy naprawić
        const userToFixSnap = await db.collection('users').where('email', '==', emailToFix).limit(1).get();
        if (userToFixSnap.empty) {
            console.log(`[NAPRAWA] Nie znaleziono użytkownika o emailu: ${emailToFix}. Przerywam.`);
            return;
        }
        const userDoc = userToFixSnap.docs[0];
        console.log(`[NAPRAWA] Znaleziono użytkownika do naprawy: ${userDoc.id} (stare ID: ${userDoc.data().user_id})`);

        // Krok 3: Nadaj mu nowe, unikalne ID
        const newCorrectId = highestCurrentId + 1;
        await userDoc.ref.update({ user_id: newCorrectId });
        console.log(`[NAPRAWA] Pomyślnie zmieniono user_id na: ${newCorrectId}`);

        // Krok 4: Zaktualizuj licznik w kolekcji 'counters', aby zapobiec przyszłym błędom
        const counterRef = db.collection('counters').doc('userCounter');
        await counterRef.set({ currentId: newCorrectId });
        console.log(`[NAPRAWA] Pomyślnie zsynchronizowano licznik 'userCounter' do wartości: ${newCorrectId}`);

    } catch (error) {
        console.error("[NAPRAWA] Wystąpił krytyczny błąd:", error);
    } finally {
        console.log('[NAPRAWA] Proces zakończony.');
    }
}

fixDuplicateId();
