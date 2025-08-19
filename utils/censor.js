// utils/censor.js

function censorContactInfo(text) {
    if (typeof text !== 'string') {
        return text;
    }

    let censoredText = text;

    // Prosty Regex do wykrywania adresów e-mail
    const emailRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

    // Prosty Regex do wykrywania polskich numerów telefonów (9 cyfr, z opcjonalnymi spacjami/myślnikami)
    const phoneRegex = /(?:\+?48)?\s?(\d{3}[-.\s]?\d{3}[-.\s]?\d{3}|\d{2}[-.\s]?\d{3}[-.\s]?\d{2}[-.\s]?\d{2})\b/g;

    const replacement = " [DANE KONTAKTOWE UKRYTE] ";

    censoredText = censoredText.replace(emailRegex, replacement);
    censoredText = censoredText.replace(phoneRegex, replacement);

    return censoredText;
}

module.exports = { censorContactInfo };