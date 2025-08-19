const axios = require('axios');
const { parseStringPromise } = require('xml2js');

// Adresy URL i akcje dla API GUS
const GUS_API_URL = 'https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc';
const GUS_API_LOGIN_ACTION = 'http://CIS.BIR.PUBL.2014.07.IUslugaBIRzewnPubl/Zaloguj';
const GUS_API_SEARCH_ACTION = 'http://CIS.BIR.PUBL.2014.07.IUslugaBIRzewnPubl/DaneSzukajPodmioty';

// Funkcja do logowania i pobierania ID sesji

async function getGusSessionId() {
    const apiKey = process.env.GUS_API_KEY;
    if (!apiKey) {
        console.error('Brak klucza API do GUS (GUS_API_KEY) w zmiennych środowiskowych.');
        throw new Error('Brak klucza API do GUS (GUS_API_KEY).');
    }

    const loginXml = `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="http://CIS.BIR.PUBL.2014.07"><soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing"><wsa:To>${GUS_API_URL}</wsa:To><wsa:Action>${GUS_API_LOGIN_ACTION}</wsa:Action></soap:Header><soap:Body><ns:Zaloguj><ns:pKluczUzytkownika>${apiKey}</ns:pKluczUzytkownika></ns:Zaloguj></soap:Body></soap:Envelope>`;
    
    // NOWY LOG: Informacja o rozpoczynającej się próbie połączenia
    console.log(`[GUS Login] Próba wysłania żądania logowania do ${GUS_API_URL}...`);

    try {
        const response = await axios.post(GUS_API_URL, loginXml, {
            headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
            // Ustawiamy timeout na 15 sekund, aby aplikacja nie wisiała w nieskończoność
            timeout: 15000 
        });

        const parsedResponse = await parseStringPromise(response.data);
        const sid = parsedResponse['s:Envelope']['s:Body'][0].ZalogujResponse[0].ZalogujResult[0];
        
        console.log("--- OTRZYMANO ID SESJI Z GUS ---"); // Ten log oznacza sukces
        return sid;

    } catch (error) {
        // ROZBUDOWANY BLOK CATCH: Szczegółowa analiza błędu
        console.error("--- WYSTĄPIŁ KRYTYCZNY BŁĄD PODCZAS LOGOWANIA DO GUS ---");

        if (error.response) {
            // Serwer GUS odpowiedział, ale ze statusem błędu (np. 4xx, 5xx)
            console.error(`[GUS Login Error] Serwer GUS odpowiedział błędem.`);
            console.error(`Status: ${error.response.status}`);
            console.error(`Headers: ${JSON.stringify(error.response.headers)}`);
            console.error(`Data: ${error.response.data}`);
        } else if (error.request) {
            // Zapytanie zostało wysłane, ale nie otrzymano żadnej odpowiedzi
            // TO JEST NAJBARDZIEJ PRAWDOPODOBNY SCENARIUSZ W TWOIM PRZYPADKU
            console.error('[GUS Login Error] Zapytanie zostało wysłane, ale nie otrzymano odpowiedzi. To wskazuje na problem sieciowy (firewall, brak połączenia) lub timeout.');
            console.error(`Kod błędu (jeśli dostępny): ${error.code}`);
        } else {
            // Inny błąd, np. problem z konfiguracją samego zapytania axios
            console.error('[GUS Login Error] Wystąpił błąd podczas przygotowywania zapytania.');
            console.error(`Message: ${error.message}`);
        }
        console.error("---------------------------------------------------------");
        
        // Rzuć błąd dalej, aby główny kontroler mógł go obsłużyć i wysłać odpowiedź 500 do klienta
        throw new Error('Nie udało się połączyć z serwerem GUS w celu logowania.');
    }
}

// Główny eksportowany kontroler
exports.getCompanyDataByNip = async (req, res) => {
    const { nip } = req.params;
    console.log(`[GUS Controller] Otrzymano zapytanie o dane dla NIP: ${nip}`);

    try {
        const sid = await getGusSessionId();
        if (!sid) {
            return res.status(500).json({ message: 'Nie udało się uzyskać sesji z GUS.' });
        }

        // --- TUTAJ JEST POPRAWKA ---
        // Zwróć uwagę na <ns:pParametryWyszukiwania> - ma teraz poprawny prefix.
        const searchXml = `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="http://CIS.BIR.PUBL.2014.07" xmlns:dat="http://CIS.BIR.PUBL.2014.07.DataContract"><soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing"><wsa:To>${GUS_API_URL}</wsa:To><wsa:Action>${GUS_API_SEARCH_ACTION}</wsa:Action></soap:Header><soap:Body><ns:DaneSzukajPodmioty><ns:pParametryWyszukiwania><dat:Nip>${nip}</dat:Nip></ns:pParametryWyszukiwania></ns:DaneSzukajPodmioty></soap:Body></soap:Envelope>`;

        console.log("--- WYSYŁANIE XML WYSZUKIWANIA DO GUS ---");
        // console.log(searchXml); // Można odkomentować do debugowania

        const searchResponse = await axios.post(GUS_API_URL, searchXml, {
            headers: { 
                'Content-Type': 'application/soap+xml; charset=utf-8', 
                'sid': sid 
            }
        });
        
        const parsedSearch = await parseStringPromise(searchResponse.data);
        // Sprawdzanie, czy odpowiedź nie jest błędem SOAP
        if (parsedSearch['s:Envelope']['s:Body'][0]['s:Fault']) {
            const fault = parsedSearch['s:Envelope']['s:Body'][0]['s:Fault'][0];
            const reason = fault['s:Reason'][0]['s:Text'][0]['_'];
            console.error('Błąd SOAP z GUS:', reason);
            return res.status(500).json({ message: `Błąd z API GUS: ${reason}` });
        }
        
        const searchResultXml = parsedSearch['s:Envelope']['s:Body'][0].DaneSzukajPodmiotyResponse[0].DaneSzukajPodmiotyResult[0];
        
        if (!searchResultXml || searchResultXml.trim() === '') {
            return res.status(404).json({ message: 'Nie znaleziono firmy o podanym numerze NIP.' });
        }
        
        // Parsowanie XML z danymi firmy
        const companyData = await parseStringPromise(searchResultXml, { explicitArray: false, ignoreAttrs: true, tagNameProcessors: [(name) => name.replace('fiz_', '')] });
        const data = companyData.root.dane;

        if (!data.Nazwa) {
            return res.status(404).json({ message: 'Nie znaleziono firmy o podanym numerze NIP w zwróconych danych.' });
        }
        
        const street = data.Ulica ? `${data.Ulica} ${data.NrNieruchomosci}` : (data.AdresPoczty || '');

        const formattedData = {
            company_name: data.Nazwa,
            street_address: street.trim(),
            postal_code: data.KodPocztowy,
            city: data.Miejscowosc
        };

        res.status(200).json(formattedData);

    } catch (error) {
        console.error("--- PEŁNY BŁĄD Z API GUS ---");
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Headers:', error.response.headers);
            console.error('Data (odpowiedź z serwera GUS):', error.response.data);
        } else {
            console.error('Error Message:', error.message);
        }
        console.error("-----------------------------");
        res.status(500).json({ message: "Błąd serwera podczas pobierania danych z GUS." });
    }
};