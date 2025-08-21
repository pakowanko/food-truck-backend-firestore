// Plik: /utils/firestoreUtils.js
const db = require('../firestore');

async function getDocByNumericId(collectionName, idField, numericId) {
    const numId = parseInt(numericId, 10);
    if (isNaN(numId)) return null;

    const collectionRef = db.collection(collectionName);
    const snapshot = await collectionRef.where(idField, '==', numId).limit(1).get();
    if (!snapshot.empty) {
        return snapshot.docs[0];
    }

    try {
        const docById = await collectionRef.doc(numId.toString()).get();
        if (docById.exists) {
            return docById;
        }
    } catch (error) {
        console.warn(`[getDocByNumericId] Fallback: Nie udało się pobrać dokumentu po ID ${numId.toString()}`);
    }
    return null;
}

module.exports = { getDocByNumericId };