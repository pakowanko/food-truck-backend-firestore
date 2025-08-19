// utils/facebookPublisher.js

const axios = require('axios');

/**
 * Publikuje post ze zdjęciem na firmowej stronie na Facebooku.
 * @param {string} caption - Treść posta, która pojawi się jako opis zdjęcia.
 * @param {string} photoUrl - Publicznie dostępny URL do zdjęcia, które ma zostać opublikowane.
 */
async function publishPhotoToFacebook(caption, photoUrl) {
    const pageId = process.env.FACEBOOK_PAGE_ID;
    const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

    if (!pageId || !accessToken) {
        console.error('Brak FACEBOOK_PAGE_ID lub FACEBOOK_PAGE_ACCESS_TOKEN w zmiennych środowiskowych.');
        throw new Error('Brak konfiguracji do publikacji na Facebooku.');
    }

    if (!photoUrl) {
        console.warn('Próbowano opublikować post bez zdjęcia. Anulowano.');
        return; // Nie publikujemy, jeśli nie ma zdjęcia
    }

    // Używamy punktu końcowego /photos do publikacji zdjęć
    const url = `https://graph.facebook.com/v20.0/${pageId}/photos`;

    const params = {
        caption: caption,
        url: photoUrl, // URL do zdjęcia musi być publicznie dostępny
        access_token: accessToken,
    };

    try {
        console.log(`Publikowanie zdjęcia na stronie FB (${pageId}) z opisem: "${caption}"`);
        const response = await axios.post(url, params);
        console.log('Zdjęcie opublikowane pomyślnie! ID posta:', response.data.post_id);
        return response.data;
    } catch (error) {
        const fbError = error.response ? error.response.data.error : error.message;
        console.error('Błąd podczas publikowania zdjęcia na Facebooku:', JSON.stringify(fbError, null, 2));
        throw new Error('Nie udało się opublikować zdjęcia na Facebooku.');
    }
}

module.exports = { publishPhotoToFacebook };
