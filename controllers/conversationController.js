// ZMIENIONE: Usunięto 'pool', dodano 'db' (Firestore) i narzędzia Firebase.
const db = require('../firestore');
const { FieldValue } = require('firebase-admin/firestore');

exports.getMyConversations = async (req, res) => {
    const { userId } = req.user;
    try {
        // ZMIENIONE: Zapytanie do Firestore o konwersacje, w których bierze udział użytkownik.
        const conversationsSnap = await db.collection('conversations')
            .where('participant_ids', 'array-contains', userId)
            .orderBy('last_message_at', 'desc')
            .get();

        // UWAGA: Kolejny przykład "joinu" po stronie aplikacji.
        const conversations = await Promise.all(conversationsSnap.docs.map(async (doc) => {
            const convo = { conversation_id: doc.id, ...doc.data() };
            
            // Znajdź ID drugiego uczestnika
            const recipientId = convo.participant_ids.find(id => id !== userId);
            let title = 'Konwersacja';

            if (convo.request_id) {
                // Jeśli to konwersacja o rezerwację, pobierz nazwę food trucka
                const bookingSnap = await db.collection('bookings').doc(convo.request_id.toString()).get();
                if (bookingSnap.exists) {
                    const profileSnap = await db.collection('foodTrucks').doc(bookingSnap.data().profile_id.toString()).get();
                    if (profileSnap.exists) {
                        title = profileSnap.data().food_truck_name;
                    }
                }
            } else if (recipientId) {
                // Jeśli to zwykła konwersacja, pobierz nazwę drugiego użytkownika
                const recipientSnap = await db.collection('users').doc(recipientId.toString()).get();
                if (recipientSnap.exists) {
                    const recipientData = recipientSnap.data();
                    title = recipientData.company_name || `${recipientData.first_name} ${recipientData.last_name}`;
                }
            }
            
            return {
                conversation_id: convo.conversation_id,
                request_id: convo.request_id || null,
                title: title
            };
        }));
        
        res.json(conversations);
    } catch (error) {
        console.error("Błąd pobierania konwersacji:", error);
        res.status(500).json({ message: "Błąd serwera." });
    }
};

exports.initiateUserConversation = async (req, res) => {
    try {
        const { recipientId } = req.body;
        const senderId = req.user.userId;
        const recipientIdInt = parseInt(recipientId, 10);

        if (!recipientIdInt || recipientIdInt === senderId) {
            return res.status(400).json({ message: "Błędne dane." });
        }
        
        // ZMIENIONE: Sprawdzanie istnienia konwersacji w Firestore
        const participants = [senderId, recipientIdInt].sort(); // Sortujemy, aby zawsze mieć tę samą kolejność
        const existingConvSnap = await db.collection('conversations')
            .where('participant_ids', '==', participants)
            .where('request_id', '==', null)
            .limit(1)
            .get();

        if (!existingConvSnap.empty) {
            const existingConv = existingConvSnap.docs[0];
            return res.status(200).json({ conversation_id: existingConv.id, ...existingConv.data() });
        }
        
        const recipientDoc = await db.collection('users').doc(recipientIdInt.toString()).get();
        const recipientData = recipientDoc.data();
        const title = recipientData.company_name || `${recipientData.first_name} ${recipientData.last_name}`;
        
        const newConvData = {
            participant_ids: participants,
            title,
            request_id: null,
            created_at: FieldValue.serverTimestamp(),
            last_message_at: FieldValue.serverTimestamp()
        };
        
        const newConvRef = await db.collection('conversations').add(newConvData);
        res.status(201).json({ conversation_id: newConvRef.id, ...newConvData });

    } catch (error) {
        console.error("Błąd inicjowania konwersacji ogólnej:", error);
        res.status(500).json({ message: "Błąd serwera." });
    }
};

exports.initiateBookingConversation = async (req, res) => {
    try {
        const { requestId } = req.body;
        const senderId = req.user.userId;

        // ZMIENIONE: Pobieranie rezerwacji z Firestore
        const bookingDoc = await db.collection('bookings').doc(requestId.toString()).get();
        if (!bookingDoc.exists) {
            return res.status(404).json({ message: "Nie znaleziono rezerwacji." });
        }
        
        const booking = bookingDoc.data();
        const profileDoc = await db.collection('foodTrucks').doc(booking.profile_id.toString()).get();
        
        const organizer_id = booking.user_id;
        const owner_id = profileDoc.data().owner_id;

        if (senderId !== organizer_id && senderId !== owner_id) {
            return res.status(403).json({ message: "Brak uprawnień."});
        }
        
        const existingConvSnap = await db.collection('conversations').where('request_id', '==', parseInt(requestId, 10)).limit(1).get();
        if (!existingConvSnap.empty) {
            const existingConv = existingConvSnap.docs[0];
            return res.status(200).json({ conversation_id: existingConv.id, ...existingConv.data() });
        }
        
        const title = `Rezerwacja #${requestId}`;
        const newConvData = {
            participant_ids: [organizer_id, owner_id].sort(),
            title,
            request_id: parseInt(requestId, 10),
            created_at: FieldValue.serverTimestamp(),
            last_message_at: FieldValue.serverTimestamp()
        };

        const newConvRef = await db.collection('conversations').add(newConvData);
        res.status(201).json({ conversation_id: newConvRef.id, ...newConvData });

    } catch (error) {
        console.error("Błąd inicjowania konwersacji o rezerwację:", error);
        res.status(500).json({ message: "Błąd serwera." });
    }
};

exports.getMessages = async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.user;

        // ZMIENIONE: Sprawdzanie dostępu
        const convDoc = await db.collection('conversations').doc(id).get();
        if (!convDoc.exists || !convDoc.data().participant_ids.includes(userId)) {
            return res.status(403).json({ message: "Brak dostępu do tej konwersacji." });
        }
        
        // ZMIENIONE: Pobieranie wiadomości z podkolekcji - o wiele prostsze!
        const messagesSnap = await db.collection('conversations').doc(id).collection('messages').orderBy('created_at', 'asc').get();
        const messages = messagesSnap.docs.map(doc => ({ message_id: doc.id, ...doc.data() }));
        
        res.status(200).json(messages);
    } catch (error) { 
        console.error("Błąd pobierania wiadomości:", error); 
        res.status(500).json({ message: "Błąd serwera." }); 
    }
};