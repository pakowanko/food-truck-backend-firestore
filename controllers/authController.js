// plik: /controllers/authController.js

const db = require('../firestore');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const { 
    sendVerificationEmail, 
    sendPasswordResetEmail, 
    sendGoogleWelcomeEmail, 
    sendNewUserAdminNotification 
} = require('../utils/emailTemplate');
const sgMail = require('@sendgrid/mail');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getDocByNumericId } = require('../utils/firestoreUtils');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const GOOGLE_CLIENT_ID = '1035693089076-606q1auo4o0cb62lmj21djqeqjvor4pj.apps.googleusercontent.com';
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

async function getNextUserId() {
    const counterRef = db.collection('counters').doc('userCounter');
    return db.runTransaction(async (transaction) => {
        const counterDoc = await transaction.get(counterRef);
        if (!counterDoc.exists) {
            const startId = 200; 
            transaction.set(counterRef, { currentId: startId });
            return startId;
        }
        const newId = parseInt(counterDoc.data().currentId, 10) + 1;
        transaction.update(counterRef, { currentId: newId });
        return newId;
    });
}

// --- Funkcje register, verifyEmail, login, googleLogin, getProfile - bez zmian ---
exports.register = async (req, res) => {
    const userData = req.body;
    const { 
        email, password, user_type, first_name, last_name, 
        company_name, nip, phone_number, country_code,
        street_address, postal_code, city
    } = userData;

    try {
        const usersRef = db.collection('users');
        const existingUserSnap = await usersRef.where('email', '==', email).limit(1).get();

        if (!existingUserSnap.empty) {
            return res.status(409).json({ message: 'Użytkownik o tym adresie email już istnieje.' });
        }

        let stripeCustomerId = null;
        if (user_type === 'food_truck_owner' && process.env.STRIPE_SECRET_KEY) {
            const customer = await stripe.customers.create({
                email: email, 
                name: company_name || `${first_name} ${last_name}`, 
                phone: phone_number,
                address: { line1: street_address, postal_code, city, country: country_code || 'PL' },
                metadata: { nip: nip || '' }
            });
            stripeCustomerId = customer.id;
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const verificationToken = crypto.randomBytes(32).toString('hex');
        
        const numericUserId = await getNextUserId();
        const newUserRef = usersRef.doc();
        
        const newUserData = {
            doc_id: newUserRef.id,
            user_id: numericUserId,
            email,
            password_hash: hashedPassword,
            user_type,
            first_name,
            last_name,
            company_name,
            nip,
            phone_number,
            country_code,
            stripe_customer_id: stripeCustomerId,
            street_address,
            postal_code,
            city,
            is_verified: false,
            verification_token: verificationToken,
            created_at: FieldValue.serverTimestamp(),
            role: 'user'
        };

        await newUserRef.set(newUserData);
        
        await sendVerificationEmail(email, verificationToken);
        await sendNewUserAdminNotification(userData);
        
        res.status(201).json({ message: 'Rejestracja pomyślna. Sprawdź swój e-mail, aby aktywować konto.' });

    } catch (error) {
        console.error("!!! KRYTYCZNY BŁĄD PODCZAS REJESTRACJI:", error);
        res.status(500).json({ message: 'Wystąpił wewnętrzny błąd serwera podczas tworzenia konta.' });
    }
};
exports.verifyEmail = async (req, res) => {
    const { token } = req.query;
    try {
        const usersRef = db.collection('users');
        const userSnap = await usersRef.where('verification_token', '==', token).limit(1).get();

        if (userSnap.empty) {
            return res.status(400).json({ message: 'Nieprawidłowy lub wygasły token weryfikacyjny.' });
        }
        
        const userDoc = userSnap.docs[0];
        const user = userDoc.data();

        if (user.is_verified) {
             return res.json({ success: true, message: 'Konto jest już aktywne.', token: null, redirect: '/login' });
        }

        await userDoc.ref.update({
            is_verified: true,
            verification_token: FieldValue.delete()
        });

        const payload = { userId: user.user_id, docId: user.doc_id, email: user.email, user_type: user.user_type, role: user.role };
        const jwtToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
        const redirectPath = user.user_type === 'food_truck_owner' ? '/create-profile' : '/dashboard';

        res.json({ success: true, message: 'Konto zostało pomyślnie zweryfikowane.', token: jwtToken, redirect: redirectPath });
    } catch (error) {
        console.error('Błąd podczas weryfikacji emaila:', error);
        res.status(500).json({ message: 'Błąd serwera.' });
    }
};
exports.login = async (req, res) => {
    const { email, password } = req.body;
    try {
        const usersRef = db.collection('users');
        const userSnap = await usersRef.where('email', '==', email).limit(1).get();

        if (userSnap.empty) {
            return res.status(401).json({ message: 'Nieprawidłowy email lub hasło.' });
        }
        
        const user = userSnap.docs[0].data();

        if (!user.is_verified) {
            return res.status(403).json({ message: 'Konto nie zostało jeszcze aktywowane. Sprawdź swój e-mail.' });
        }
        if (user.is_blocked) {
            return res.status(403).json({ message: 'Twoje konto zostało zablokowane.' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ message: 'Nieprawidłowy email lub hasło.' });
        }
        
        const payload = { userId: user.user_id, docId: user.doc_id, email: user.email, user_type: user.user_type, role: user.role };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
        
        res.json({ token, userId: user.user_id, email: user.email, user_type: user.user_type, company_name: user.company_name, role: user.role, first_name: user.first_name });
    } catch (error) {
        console.error('Błąd podczas logowania:', error);
        res.status(500).json({ message: 'Błąd serwera.' });
    }
};
exports.googleLogin = async (req, res) => {
    const { credential } = req.body;
    try {
        const ticket = await client.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
        const payload = ticket.getPayload();
        const { email, given_name, family_name } = payload;

        const usersRef = db.collection('users');
        let userSnap = await usersRef.where('email', '==', email).limit(1).get();
        let user;

        if (userSnap.empty) {
            const randomPassword = crypto.randomBytes(32).toString('hex');
            const hashedPassword = await bcrypt.hash(randomPassword, 10);
            
            const numericUserId = await getNextUserId();
            const newUserRef = usersRef.doc();
            
            const newUserData = {
                doc_id: newUserRef.id,
                user_id: numericUserId,
                email,
                password_hash: hashedPassword,
                user_type: 'organizer',
                first_name: given_name,
                last_name: family_name,
                is_verified: true,
                role: 'user',
                created_at: FieldValue.serverTimestamp()
            };
            
            await newUserRef.set(newUserData);
            user = newUserData;
            
            await sendGoogleWelcomeEmail(email, given_name);
            await sendNewUserAdminNotification({ email, first_name: given_name, last_name: family_name, user_type: 'organizer' });
        } else {
            user = userSnap.docs[0].data();
        }

        if (user.is_blocked) {
            return res.status(403).json({ message: 'Twoje konto zostało zablokowane.' });
        }

        const appPayload = { userId: user.user_id, docId: user.doc_id, email: user.email, user_type: user.user_type, role: user.role };
        const token = jwt.sign(appPayload, process.env.JWT_SECRET, { expiresIn: '7d' });
        
        res.json({ token, userId: user.user_id, email: user.email, user_type: user.user_type, company_name: user.company_name, role: user.role, first_name: user.first_name });
    } catch (error) {
        console.error("Błąd podczas logowania przez Google:", error);
        res.status(500).json({ message: "Błąd serwera podczas logowania przez Google." });
    }
};
exports.getProfile = async (req, res) => {
    try {
        const userDoc = await getDocByNumericId('users', 'user_id', req.user.userId);
        
        if (userDoc && userDoc.exists) {
            const { password_hash, ...profileData } = userDoc.data();
            res.json(profileData);
        } else {
            res.status(404).json({ message: 'Nie znaleziono użytkownika.' });
        }
    } catch (error) {
        console.error('Błąd podczas pobierania profilu:', error);
        res.status(500).json({ message: 'Błąd serwera.' });
    }
};


// --- Funkcje z dodanym logowaniem diagnostycznym ---

exports.requestPasswordReset = async (req, res) => {
    const { email } = req.body;
    console.log(`[RESET HASŁA] Otrzymano prośbę o reset dla email: ${email}`);
    try {
        const userSnap = await db.collection('users').where('email', '==', email).limit(1).get();

        if (userSnap.empty) {
            console.log(`[RESET HASŁA] Nie znaleziono użytkownika. Wysyłam standardową odpowiedź.`);
            return res.json({ message: 'Jeśli konto o podanym adresie email istnieje, link do resetu hasła został wysłany.' });
        }
        
        const userDoc = userSnap.docs[0];
        console.log(`[RESET HASŁA] Znaleziono użytkownika: ${userDoc.id}`);
        const token = crypto.randomBytes(32).toString('hex');
        const expires = Timestamp.fromMillis(Date.now() + 3600000); // 1 godzina

        console.log(`[RESET HASŁA] Generowanie tokena i daty wygaśnięcia...`);
        await userDoc.ref.update({
            reset_password_token: token,
            reset_password_expires: expires
        });
        console.log(`[RESET HASŁA] Pomyślnie zaktualizowano dokument użytkownika w bazie.`);

        await sendPasswordResetEmail(email, token);
        console.log(`[RESET HASŁA] Pomyślnie wysłano email z linkiem do resetu.`);
        res.json({ message: 'Jeśli konto o podanym adresie email istnieje, link do resetu hasła został wysłany.' });
    } catch (error) {
        console.error("[RESET HASŁA] KRYTYCZNY BŁĄD w 'requestPasswordReset':", error);
        res.status(500).json({ message: "Błąd serwera." });
    }
};

exports.resetPassword = async (req, res) => {
    const { token, newPassword } = req.body;
    console.log(`[RESET HASŁA] Otrzymano próbę zmiany hasła z tokenem: ${token ? token.substring(0, 10) + '...' : 'BRAK TOKENA'}`);
    try {
        const userSnap = await db.collection('users')
            .where('reset_password_token', '==', token)
            .where('reset_password_expires', '>', Timestamp.now())
            .limit(1).get();
        console.log(`[RESET HASŁA] Wykonano zapytanie do bazy w poszukiwaniu tokena.`);

        if (userSnap.empty) {
            console.log(`[RESET HASŁA] Nie znaleziono pasującego, aktywnego tokena w bazie.`);
            return res.status(400).json({ message: 'Token do resetu hasła jest nieprawidłowy lub wygasł.' });
        }
        
        const userDoc = userSnap.docs[0];
        console.log(`[RESET HASŁA] Znaleziono użytkownika do zmiany hasła: ${userDoc.id}`);
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await userDoc.ref.update({
            password_hash: hashedPassword,
            reset_password_token: FieldValue.delete(),
            reset_password_expires: FieldValue.delete()
        });
        console.log(`[RESET HASŁA] Hasło zostało pomyślnie zmienione i tokeny usunięte.`);

        res.json({ message: 'Hasło zostało pomyślnie zmienione.' });
    } catch (error) {
        console.error("[RESET HASŁA] KRYTYCZNY BŁĄD w 'resetPassword':", error);
        // ✨ WAŻNE: Sprawdź, czy w logach nie pojawi się błąd o braku indeksu!
        if (error.message && error.message.includes('requires an index')) {
             console.error("!!! WYGLĄDA NA TO, ŻE BRAKUJE INDEKSU W FIRESTORE. Sprawdź logi powyżej, aby znaleźć link do jego utworzenia.");
        }
        res.status(500).json({ message: "Błąd serwera." });
    }
};

exports.loginWithReminderToken = async (req, res) => {
    const { token } = req.body;
    if (!token) {
        return res.status(400).json({ message: 'Brak tokena z przypomnienia.' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userDoc = await getDocByNumericId('users', 'user_id', decoded.userId);
        
        if (!userDoc || !userDoc.exists) {
            return res.status(404).json({ message: 'Użytkownik nie znaleziony.' });
        }
        const user = userDoc.data();

        if (!user.is_verified) {
            return res.status(403).json({ message: 'Konto nie zostało jeszcze aktywowane.' });
        }
        if (user.is_blocked) {
            return res.status(403).json({ message: 'Twoje konto zostało zablokowane.' });
        }
        
        const payload = { userId: user.user_id, docId: user.doc_id, email: user.email, user_type: user.user_type, role: user.role };
        const newJwtToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });

        res.json({
            success: true,
            message: 'Zalogowano pomyślnie.',
            token: newJwtToken,
            redirect: '/create-profile'
        });

    } catch (error) {
        console.error('Błąd logowania z tokenem przypomnienia:', error);
        if (error instanceof jwt.JsonWebTokenError) {
            return res.status(401).json({ message: 'Nieprawidłowy token.' });
        }
        res.status(500).json({ message: 'Błąd serwera.' });
    }
};
