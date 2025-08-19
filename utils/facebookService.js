// -----------------------------------------------------------------
// PLIK 1: Zaktualizowany i rozbudowany serwis
// Plik: /utils/facebookService.js
// -----------------------------------------------------------------
// To jest teraz nasze centrum dowodzenia dla wszystkich publikacji.
// -----------------------------------------------------------------

const axios = require('axios');

/**
 * Publikuje post ze zdjęciem na STRONIE firmowej na Facebooku.
 * @param {string} caption - Treść posta.
 * @param {string} photoUrl - Publicznie dostępny URL do zdjęcia.
 */
async function publishToFacebookPage(caption, photoUrl) {
    const pageId = process.env.FACEBOOK_PAGE_ID;
    const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

    if (!pageId || !accessToken) throw new Error('Brak konfiguracji dla Strony FB.');
    if (!photoUrl) {
        console.warn('Pominięto publikację na Stronie FB (brak zdjęcia).');
        return;
    }

    const url = `https://graph.facebook.com/v20.0/${pageId}/photos`;
    try {
        console.log(`Publikowanie na Stronie FB (${pageId})...`);
        const response = await axios.post(url, { caption, url: photoUrl, access_token: accessToken });
        console.log('Sukces! Opublikowano na Stronie FB. ID posta:', response.data.post_id);
        return { platform: 'Facebook Page', status: 'success', data: response.data };
    } catch (error) {
        console.error('Błąd publikacji na Stronie FB:', error.response?.data?.error || error.message);
        throw new Error('Nie udało się opublikować na Stronie FB.');
    }
}

/**
 * Publikuje post ze zdjęciem na GRUPIE na Facebooku.
 * @param {string} caption - Treść posta.
 * @param {string} photoUrl - Publicznie dostępny URL do zdjęcia.
 */
async function publishToFacebookGroup(caption, photoUrl) {
    const groupId = process.env.FACEBOOK_GROUP_ID;
    const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

    if (!groupId) {
        console.warn('Brak konfiguracji dla Grupy FB (FACEBOOK_GROUP_ID). Pomijam publikację w grupie.');
        return;
    }
    if (!photoUrl) {
        console.warn('Pominięto publikację w Grupie FB (brak zdjęcia).');
        return;
    }

    const url = `https://graph.facebook.com/v20.0/${groupId}/feed`;
    try {
        console.log(`Publikowanie w Grupie FB (${groupId})...`);
        const response = await axios.post(url, { message: caption, link: photoUrl, access_token: accessToken });
        console.log('Sukces! Opublikowano w Grupie FB. ID posta:', response.data.id);
        return { platform: 'Facebook Group', status: 'success', data: response.data };
    } catch (error) {
        console.error('Błąd publikacji w Grupie FB:', error.response?.data?.error || error.message);
        throw new Error('Nie udało się opublikować w Grupie FB.');
    }
}

// --- FUNKCJA DLA INSTAGRAMA - TERAZ AKTYWNA ---
async function publishToInstagram(caption, photoUrl) {
    const instagramId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
    const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

    if (!instagramId) {
        console.warn('Brak konfiguracji dla Instagrama (INSTAGRAM_BUSINESS_ACCOUNT_ID). Pomijam publikację na Instagramie.');
        return;
    }
    if (!photoUrl) {
        console.warn('Pominięto publikację na Instagramie (brak zdjęcia).');
        return;
    }

    try {
        console.log(`Publikowanie na Instagramie (${instagramId})...`);
        // Krok 1: Utworzenie kontenera z medium (zdjęciem)
        const creationUrl = `https://graph.facebook.com/v20.0/${instagramId}/media`;
        const creationResponse = await axios.post(creationUrl, {
            image_url: photoUrl,
            caption: caption,
            access_token: accessToken
        });
        const creationId = creationResponse.data.id;

        // Krok 2: Opublikowanie kontenera
        const publishUrl = `https://graph.facebook.com/v20.0/${instagramId}/media_publish`;
        const publishResponse = await axios.post(publishUrl, {
            creation_id: creationId,
            access_token: accessToken
        });
        console.log('Sukces! Opublikowano na Instagramie. ID posta:', publishResponse.data.id);
        return { platform: 'Instagram', status: 'success', data: publishResponse.data };
    } catch (error) {
        console.error('Błąd publikacji na Instagramie:', error.response?.data?.error || error.message);
        throw new Error('Nie udało się opublikować na Instagramie.');
    }
}

module.exports = { 
    publishToFacebookPage,
    publishToFacebookGroup,
    publishToInstagram
};


// -----------------------------------------------------------------
// PLIK 2: Zaktualizowana funkcja w chmurze
// Plik: /post-publisher-function/index.js
// -----------------------------------------------------------------
// Teraz funkcja wywołuje wszystkie trzy metody publikacji.
// -----------------------------------------------------------------

const functions = require('@google-cloud/functions-framework');
const { 
    publishToFacebookPage,
    publishToFacebookGroup,
    publishToInstagram
} = require('./facebookService'); 

functions.cloudEvent('publishPost', async cloudEvent => {
    try {
        const profileData = JSON.parse(Buffer.from(cloudEvent.data.message.data, 'base64').toString());
        console.log(`Odebrano zlecenie publikacji posta dla: ${profileData.food_truck_name}`);

        const photoUrl = profileData.profile_image_url;
        if (!photoUrl) {
            console.log('Brak zdjęcia profilowego do opublikowania. Zakończono.');
            return;
        }

        const profileUrl = `https://app.bookthefoodtruck.eu/profile/${profileData.profile_id}`;
        const descriptionSnippet = profileData.food_truck_description 
            ? `\n\n"${profileData.food_truck_description.substring(0, 150)}..."`
            : "";
        
        // --- ZMIANA: Tworzymy osobny, krótszy opis dla Instagrama ---
        const instagramCaption = `👋 Witajcie na pokładzie! Do naszej platformy dołączył ${profileData.food_truck_name}!\n\nSprawdź jego profil i zarezerwuj na swoją imprezę 👉 link w bio!\n\n#foodtruck #nowość #bookthefoodtruck #gastronomia #jedzenie #impreza`;
        const facebookCaption = `👋 Witajcie na pokładzie! Do naszej platformy dołączył ${profileData.food_truck_name}!${descriptionSnippet}\n\nSprawdźcie jego profil i zarezerwujcie na swoją imprezę 👉 ${profileUrl}\n\n🚚 #foodtruck #nowość #bookthefoodtruck #gastronomia #jedzenie #impreza`;
        
        // Wywołujemy wszystkie trzy funkcje publikacji
        const results = await Promise.allSettled([
            publishToFacebookPage(facebookCaption, photoUrl),
            publishToFacebookGroup(facebookCaption, photoUrl),
            publishToInstagram(instagramCaption, photoUrl)
        ]);

        console.log('Zakończono wszystkie próby publikacji. Wyniki:');
        results.forEach(result => {
            if (result.status === 'fulfilled' && result.value) {
                console.log(`- Sukces: ${result.value.platform}`);
            } else if (result.status === 'rejected') {
                console.error(`- Błąd: ${result.reason.message}`);
            }
        });

    } catch (error) {
        console.error('Wystąpił nieoczekiwany błąd w funkcji publishPost:', error);
        throw error;
    }
});
