// smart_fix_user_types.js (wersja 2 - synchronizująca)
const db = require('./firestore'); // Upewnij się, że ścieżka do inicjalizacji Firestore jest poprawna

async function syncUserRoles() {
    console.log('🤖 Rozpoczynam pełną synchronizację ról użytkowników...');

    // --- Krok 1: Znajdź ID wszystkich właścicieli food trucków ---
    console.log('1/3: Pobieranie listy właścicieli z kolekcji "foodTrucks"...');
    const foodTrucksSnap = await db.collection('foodTrucks').get();
    const ownerIds = new Set();
    
    foodTrucksSnap.forEach(doc => {
        const ownerId = doc.data().owner_id;
        if (ownerId) {
            ownerIds.add(ownerId);
        }
    });

    console.log(`Znaleziono ${ownerIds.size} unikalnych właścicieli food trucków.`);

    // --- Krok 2: Przejdź przez wszystkich użytkowników i zweryfikuj ich role ---
    console.log('2/3: Pobieranie wszystkich użytkowników do weryfikacji...');
    const usersSnap = await db.collection('users').get();
    
    if (usersSnap.empty) {
        console.log('Nie znaleziono żadnych użytkowników. Kończę pracę.');
        return;
    }

    const updates = [];
    let updatedCount = 0;

    usersSnap.forEach(doc => {
        const userData = doc.data();
        const userId = userData.user_id;
        const currentType = userData.user_type;

        // Określ, jaka powinna być prawidłowa rola tego użytkownika
        const correctType = ownerIds.has(userId) ? 'food_truck_owner' : 'organizer';

        //  <<<<< KLUCZOWA ZMIANA LOGIKI  >>>>>
        // Zaktualizuj tylko, jeśli obecna rola jest inna niż prawidłowa
        if (currentType !== correctType) {
            console.log(`-> Niezgodność! Użytkownik ID ${userId} (${userData.email}) ma rolę "${currentType}", a powinien mieć "${correctType}". Poprawiam...`);
            
            const updatePromise = doc.ref.update({ user_type: correctType });
            updates.push(updatePromise);
            updatedCount++;
        }
    });

    if (updates.length === 0) {
        console.log('Wszyscy użytkownicy mają już prawidłowe role. Nic do zrobienia.');
        return;
    }

    // --- Krok 3: Zapisz wszystkie zmiany w bazie danych ---
    console.log(`\n3/3: Aktualizowanie ${updatedCount} użytkowników w bazie danych...`);
    await Promise.all(updates);
    console.log('Synchronizacja ról zakończona pomyślnie! ✅');
}

syncUserRoles().catch(console.error);