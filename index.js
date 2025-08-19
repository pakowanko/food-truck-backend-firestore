require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs');

// ZMIENIONE: Importujemy połączenie z Firestore zamiast PostgreSQL
const db = require('./firestore');
const { FieldValue } = require('firebase-admin/firestore');

const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Importy tras
const authRoutes = require('./routes/authRoutes');
const foodTruckProfileRoutes = require('./routes/foodTruckProfileRoutes');
const bookingRequestRoutes = require('./routes/bookingRequestRoutes');
const conversationRoutes = require('./routes/conversationRoutes');
const gusRoutes = require('./routes/gusRoutes');
const adminRoutes = require('./routes/adminRoutes');
const userRoutes = require('./routes/userRoutes');
const cronRoutes = require('./routes/cronRoutes');
const { censorContactInfo } = require('./utils/censor');
const { createBrandedEmail } = require('./utils/emailTemplate');

const app = express();

const allowedOrigins = [
  'https://pakowanko-1723651322373.web.app',
  'https://app.bookthefoodtruck.eu'
];

const corsOptions = {
  origin: allowedOrigins,
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  allowedHeaders: "Content-Type,Authorization",
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[Request Logger] Otrzymano zapytanie: ${req.method} ${req.originalUrl}`);
  next();
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"]
  },
  pingInterval: 25000, 
  pingTimeout: 20000    
});

const PORT = process.env.PORT || 8080;

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
app.use('/uploads', express.static(uploadsDir));

// Rejestracja tras
app.use('/api/auth', authRoutes);
app.use('/api/profiles', foodTruckProfileRoutes);
app.use('/api/requests', bookingRequestRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/gus', gusRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/users', userRoutes);
app.use('/api/cron', cronRoutes);

app.get('/', (req, res) => {
  res.send('Backend for Food Truck Booking Platform is running on Firestore!');
});

// ZMIENIONE: Endpoint /health nie jest już potrzebny w architekturze Firestore, ale zostawiamy go jako standardowy punkt kontrolny.
app.get('/health', async (req, res) => {
  // W architekturze serverless-Firestore, "zdrowie" aplikacji to po prostu jej działanie.
  // Nie musimy sprawdzać połączenia, bo jest zarządzane przez SDK.
  res.status(200).send('ok');
});

// Logika Socket.IO
io.on('connection', (socket) => {
  console.log('✅ Użytkownik połączył się z Socket.IO:', socket.id);

  socket.on('register_user', (userId) => {
    if (userId) {
      socket.join(userId.toString());
      console.log(`Użytkownik ${socket.id} zarejestrowany w prywatnym pokoju ${userId}`);
    } else {
      console.warn(`Ostrzeżenie: Otrzymano próbę rejestracji z pustym userId od socketu: ${socket.id}`);
    }
  });
  
  socket.on('join_room', (conversationId) => {
    if (conversationId) {
      socket.join(conversationId);
      console.log(`Użytkownik ${socket.id} dołączył do pokoju czatu ${conversationId}`);
    } else {
      console.warn(`Ostrzeżenie: Otrzymano próbę dołączenia do pokoju z pustym conversationId od socketu: ${socket.id}`);
    }
  });

  socket.on('send_message', async (data) => {
    const { conversation_id, sender_id, message_content } = data;

    if (!sender_id || !conversation_id) {
        console.error(`Błąd: Otrzymano próbę wysłania wiadomości bez sender_id lub conversation_id. Dane:`, data);
        return; 
    }

    const censoredMessage = censorContactInfo(message_content);

    try {
        const newMessageData = {
          sender_id: parseInt(sender_id),
          message_content: censoredMessage,
          created_at: FieldValue.serverTimestamp()
        };

        const messageRef = await db.collection('conversations').doc(conversation_id).collection('messages').add(newMessageData);
        
        const finalMessage = { message_id: messageRef.id, ...newMessageData, created_at: new Date() };
        io.to(conversation_id).emit('receive_message', finalMessage);

        const conversationDoc = await db.collection('conversations').doc(conversation_id).get();
        const participantIds = conversationDoc.data()?.participant_ids;
        
        if (participantIds) {
            const recipientId = participantIds.find(id => id !== parseInt(sender_id));
            if (recipientId) {
                const senderDoc = await db.collection('users').doc(sender_id.toString()).get();
                const sender = senderDoc.data();
                const senderName = sender?.company_name || sender?.first_name || 'Użytkownik';

                const notificationData = {
                    senderName: senderName,
                    messagePreview: censoredMessage.substring(0, 50) + '...',
                    conversationId: conversation_id
                };
                
                io.to(recipientId.toString()).emit('new_message_notification', notificationData);
                console.log(`Wysłano powiadomienie o wiadomości do użytkownika ${recipientId}`);
                
                // Logika wysyłki e-mail, jeśli odbiorca nie jest online
                const roomSockets = await io.in(conversation_id).allSockets();
                if (roomSockets.size <= 1) {
                    const recipientDoc = await db.collection('users').doc(recipientId.toString()).get();
                    const recipient = recipientDoc.data();
                    if (recipient?.email) {
                        const title = `Masz nową wiadomość od ${senderName}`;
                        const body = `<h1>Otrzymałeś nową wiadomość!</h1><p><strong>${senderName}</strong> napisał do Ciebie na czacie.</p><p>Zaloguj się na swoje konto, aby ją odczytać.</p>`;
                        const finalHtml = createBrandedEmail(title, body);
                        const msg = {
                            to: recipient.email,
                            from: { email: process.env.SENDER_EMAIL, name: 'BookTheFoodTruck' },
                            subject: title,
                            html: finalHtml
                        };
                        await sgMail.send(msg);
                        console.log(`Wysłano powiadomienie email o nowej wiadomości do ${recipient.email}`);
                    }
                }
            }
        }
    } catch (error) { 
        console.error("Błąd zapisu/wysyłki wiadomości:", error); 
    }
  });
  
  socket.on('disconnect', () => { 
      console.log('❌ Użytkownik rozłączył się:', socket.id); 
  });
});

server.listen(PORT, () => {
    console.log(`🚀 Serwer (z komunikatorem) uruchomiony na porcie ${PORT} i gotowy na przyjmowanie zapytań!`);
});

module.exports = server;