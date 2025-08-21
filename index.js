// plik: index.js

require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs');

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

// ✨ KLUCZOWA ZMIANA: Udostępniamy instancję `io` w każdym zapytaniu
app.use((req, res, next) => {
  req.io = io;
  next();
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

app.get('/health', (req, res) => {
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

  // ✨ USUNIĘTO: Logika `socket.on('send_message', ...)` została przeniesiona do kontrolera
  
  socket.on('disconnect', () => { 
      console.log('❌ Użytkownik rozłączył się:', socket.id); 
  });
});

server.listen(PORT, () => {
    console.log(`🚀 Serwer (z komunikatorem) uruchomiony na porcie ${PORT} i gotowy na przyjmowanie zapytań!`);
});

module.exports = server;
