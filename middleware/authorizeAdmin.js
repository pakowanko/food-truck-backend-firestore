// middleware/authorizeAdmin.js
const authorizeAdmin = (req, res, next) => {
    // Zakładamy, że middleware 'authenticateToken' zostało już uruchomione
    // i dodało obiekt 'user' do zapytania 'req'.
    if (req.user && req.user.role === 'admin') {
        next(); // Użytkownik jest adminem, przejdź dalej
    } else {
        res.status(403).json({ message: 'Brak uprawnień. Wymagana rola administratora.' });
    }
};

module.exports = authorizeAdmin;