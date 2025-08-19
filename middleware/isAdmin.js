// middleware/isAdmin.js

// Ta funkcja sprawdza, czy użytkownik wysyłający żądanie ma rolę 'admin' w swoim tokenie.
module.exports = function(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Brak uprawnień. Dostęp tylko dla administratorów.' });
  }
  // Jeśli użytkownik jest adminem, przechodzimy do następnej funkcji (właściwego kontrolera).
  next();
};
