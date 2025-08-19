// plik: utils/geoUtils.js
const axios = require('axios');
const { GeoPoint } = require('firebase-admin/firestore');
const geofire = require('geofire-common');

// Funkcja geokodowania (przeniesiona z kontrolera)
async function getGeocode(locationString) {
    if (!locationString) return { lat: null, lon: null };
    const apiKey = process.env.GEOCODING_API_KEY;
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(locationString)}&components=country:PL&key=${apiKey}`;
    try {
        const response = await axios.get(url);
        if (response.data.status === 'OK' && response.data.results.length > 0) {
            const location = response.data.results[0].geometry.location;
            return { lat: location.lat, lon: location.lng };
        } else {
            console.warn(`Nie udało się znaleźć współrzędnych dla lokalizacji: ${locationString}. Odpowiedź API: ${response.data.status}`);
            return { lat: null, lon: null };
        }
    } catch (error) {
        console.error('Błąd Geocoding API:', error.message);
        throw error;
    }
}

// Eksportujemy funkcje, aby można było ich używać w innych plikach
module.exports = {
    getGeocode,
    geofire,
    GeoPoint
};