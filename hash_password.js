const bcrypt = require('bcryptjs');

// 👇 TUTAJ WPISZ SWOJE NOWE, PROSTE HASŁO
const newPassword = '123456'; 
const saltRounds = 10;

bcrypt.hash(newPassword, saltRounds, function(err, hash) {
    if (err) {
        console.error("Wystąpił błąd podczas hashowania:", err);
        return;
    }
    console.log("Twoje nowe, zaszyfrowane hasło (hash):");
    console.log(hash);
    console.log("\nSkopiuj ten hash i wklej go do pola 'password' w dokumencie użytkownika w Firestore.");
});