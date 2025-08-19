// ZMIENIONE: Usunięto 'pool', dodano 'db' (Firestore).
const db = require('../firestore');
const bcrypt = require('bcryptjs');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Aktualizacja danych profilowych (imię, nazwisko, firma itp.)
exports.updateMyProfile = async (req, res) => {
    const { userId } = req.user;
    const updateData = req.body;

    try {
        // ZMIENIONE: Krok 1 - Aktualizacja dokumentu w Firestore
        const userRef = db.collection('users').doc(userId.toString());
        await userRef.update(updateData);
        
        const updatedUserDoc = await userRef.get();
        const updatedUser = updatedUserDoc.data();

        // Krok 2: Logika Stripe pozostaje bez zmian, pobiera dane z `updatedUser`
        if (updatedUser.stripe_customer_id) {
            console.log(`Synchronizowanie danych dla klienta Stripe ID: ${updatedUser.stripe_customer_id}`);
            try {
                await stripe.customers.update(updatedUser.stripe_customer_id, {
                    name: updatedUser.company_name,
                    phone: updatedUser.phone_number,
                    address: {
                        line1: updatedUser.street_address,
                        postal_code: updatedUser.postal_code,
                        city: updatedUser.city,
                        country: updatedUser.country_code || 'PL',
                    },
                    tax_id_data: updatedUser.nip ? [{ type: 'eu_vat', value: updatedUser.nip }] : [],
                });
                console.log(`✅ Pomyślnie zaktualizowano dane klienta w Stripe.`);
            } catch (stripeError) {
                console.error(`❌ Błąd podczas aktualizacji klienta w Stripe:`, stripeError.message);
            }
        }

        // Usuwamy wrażliwe dane przed odesłaniem do klienta
        delete updatedUser.password_hash;
        res.json({ user_id: updatedUserDoc.id, ...updatedUser });

    } catch (error) {
        console.error("Błąd aktualizacji profilu użytkownika:", error);
        res.status(500).json({ message: "Błąd serwera." });
    }
};

// Aktualizacja hasła
exports.updateMyPassword = async (req, res) => {
    const { userId } = req.user;
    const { currentPassword, newPassword } = req.body;

    try {
        // ZMIENIONE: Pobranie użytkownika i aktualizacja hasła w Firestore
        const userRef = db.collection('users').doc(userId.toString());
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({ message: 'Nie znaleziono użytkownika.' });
        }
        
        const user = userDoc.data();

        const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
        if (!isMatch) {
            return res.status(400).json({ message: 'Obecne hasło jest nieprawidłowe.' });
        }

        const hashedNewPassword = await bcrypt.hash(newPassword, 10);
        await userRef.update({ password_hash: hashedNewPassword });

        res.json({ message: 'Hasło zostało pomyślnie zmienione.' });
    } catch (error) {
        console.error("Błąd zmiany hasła:", error);
        res.status(500).json({ message: "Błąd serwera." });
    }
};