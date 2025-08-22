// plik: /utils/emailTemplate.js

const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const APP_URL = 'https://app.bookthefoodtruck.eu';
const PAKOWANKO_URL = 'https://www.pakowanko.com';
const SENDER_EMAIL = process.env.SENDER_EMAIL || 'info@bookthefoodtruck.eu';
const LOGO_URL = 'https://storage.googleapis.com/foodtruck_storage/Logo%20BookTheFoodTruck.jpeg';

const createBrandedEmail = (title, body, button = null) => {
  let buttonHtml = '';
  if (button && button.url && button.text) {
    buttonHtml = `
      <tr>
        <td align="center" style="padding: 20px 0;">
          <table border="0" cellspacing="0" cellpadding="0">
            <tr>
              <td align="center" style="border-radius: 5px;" bgcolor="#D9534F">
                <a href="${button.url}" target="_blank" style="font-size: 16px; font-family: Helvetica, Arial, sans-serif; color: #ffffff; text-decoration: none; border-radius: 5px; padding: 12px 25px; border: 1px solid #D9534F; display: inline-block; font-weight: bold;">
                  ${button.text}
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `;
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${title}</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f4f4f4;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td style="padding: 20px 0;">
            <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="border-collapse: collapse; background-color: #ffffff; border: 1px solid #dddddd;">
              <tr>
                <td align="center" style="padding: 40px 0 30px 0; background-color: #333333;">
                  {/* ✨ POPRAWKA: Używamy zmiennej LOGO_URL */}
                  <img src="${LOGO_URL}" alt="Book The Food Truck Logo" width="200" style="display: block;" />
                </td>
              </tr>
              <tr>
                <td style="padding: 40px 30px;">
                  <table border="0" cellpadding="0" cellspacing="0" width="100%">
                    <tr>
                      <td style="color: #333333; font-family: Arial, sans-serif; font-size: 24px; font-weight: bold;">
                        ${title}
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 20px 0; color: #555555; font-family: Arial, sans-serif; font-size: 16px; line-height: 1.5;">
                        ${body}
                      </td>
                    </tr>
                    ${buttonHtml}
                  </table>
                </td>
              </tr>
              <tr>
                <td align="center" style="padding: 20px; background-color: #f4f4f4; color: #888888; font-family: Arial, sans-serif; font-size: 12px; border-top: 1px solid #dddddd;">
                  Potrzebujesz opakowań na swoje wydarzenie? Sprawdź ofertę naszego partnera <a href="${PAKOWANKO_URL}" target="_blank" style="color: #333333; text-decoration: underline;">pakowanko.com</a>!
                  <br><br>
                  &copy; ${new Date().getFullYear()} BookTheFoodTruck.eu. Wszelkie prawa zastrzeżone.
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
};

// --- Ulepszone funkcje wysyłające maile ---

// ✨ NOWA FUNKCJA: Mail z sugestiami po odrzuceniu rezerwacji
exports.sendSuggestionEmail = async (organizerEmail, originalFoodTruckName, suggestions) => {
    const title = `Twoja rezerwacja dla ${originalFoodTruckName} została odrzucona`;
    
    let suggestionsHtml = '<p>Ale nie martw się! Znaleźliśmy dla Ciebie inne, dostępne food trucki, które mogą Cię zainteresować:</p>';
    
    suggestions.forEach(truck => {
        suggestionsHtml += `
            <div style="border-top: 1px solid #eee; padding-top: 20px; margin-top: 20px;">
                <h3 style="margin-top: 0;">${truck.food_truck_name}</h3>
                <p>${truck.food_truck_description.substring(0, 150)}...</p>
                ${createBrandedEmail('', '', { text: 'Zobacz profil i zarezerwuj', url: `${APP_URL}/profile/${truck.doc_id}` })}
            </div>
        `;
    });

    const body = `<p>Cześć,</p><p>Niestety, właściciel food trucka <strong>${originalFoodTruckName}</strong> nie mógł przyjąć Twojej rezerwacji.</p>${suggestionsHtml}`;
    
    const finalHtml = createBrandedEmail(title, body); // Główny przycisk nie jest tu potrzebny
    const msg = {
        to: organizerEmail,
        from: { email: SENDER_EMAIL, name: 'BookTheFoodTruck' },
        subject: title,
        html: finalHtml
    };
    await sgMail.send(msg);
};


exports.sendNewMessageEmail = async (recipientEmail, senderName, conversationId) => {
    const title = `Masz nową wiadomość od ${senderName}`;
    const body = `<p>Cześć,</p><p><strong>${senderName}</strong> napisał do Ciebie na czacie.</p><p>Kliknij przycisk poniżej, aby odczytać wiadomość i kontynuować rozmowę.</p>`;
    const button = { text: 'Zobacz wiadomość', url: `${APP_URL}/chat/${conversationId}` };
    const finalHtml = createBrandedEmail(title, body, button);
    const msg = { to: recipientEmail, from: { email: SENDER_EMAIL, name: 'BookTheFoodTruck' }, subject: title, html: finalHtml };
    await sgMail.send(msg);
};

exports.sendNewBookingRequestEmail = async (ownerEmail, foodTruckName) => {
    const title = `Nowa prośba o rezerwację dla ${foodTruckName}!`;
    const body = `<p>Gratulacje!</p><p>Otrzymałeś nowe zapytanie o rezerwację. Przejdź do swojego panelu, aby zobaczyć szczegóły i odpowiedzieć organizatorowi.</p>`;
    const button = { text: 'Zobacz rezerwację', url: `${APP_URL}/dashboard` };
    const finalHtml = createBrandedEmail(title, body, button);
    const msg = { to: ownerEmail, from: { email: SENDER_EMAIL, name: 'BookTheFoodTruck' }, subject: title, html: finalHtml };
    await sgMail.send(msg);
};

exports.sendBookingConfirmedEmail = async (ownerEmail, bookingId) => {
    const title = `Potwierdziłeś rezerwację #${bookingId}!`;
    const body = `
      <p>Dziękujemy za potwierdzenie rezerwacji. Wszystkie szczegóły znajdziesz w swoim panelu.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
      <h3 style="color: #D9534F;">Ważne: Pamiętaj o opakowaniach!</h3>
      <p>Zgodnie z regulaminem, jesteś zobowiązany do zakupu ekologicznych opakowań na to wydarzenie w naszym partnerskim sklepie.</p>
    `;
    const button = { text: 'Przejdź do sklepu Pakowanko.com', url: PAKOWANKO_URL };
    const finalHtml = createBrandedEmail(title, body, button);
    const msg = { to: ownerEmail, from: { email: SENDER_EMAIL, name: 'BookTheFoodTruck' }, subject: title, html: finalHtml };
    await sgMail.send(msg);
};

exports.sendCreateProfileReminderEmail = async (email, firstName, token) => {
    const title = 'Dokończ tworzenie swojego profilu Food Trucka!';
    const body = `<p>Cześć ${firstName},</p><p>Zauważyliśmy, że nie dokończyłeś jeszcze tworzenia swojego profilu food trucka. Uzupełnij go, aby organizatorzy mogli Cię znaleźć i wysyłać zapytania!</p>`;
    const button = { text: 'Uzupełnij profil teraz', url: `${APP_URL}/login-with-token?token=${token}` };
    const finalHtml = createBrandedEmail(title, body, button);
    const msg = { to: email, from: { email: SENDER_EMAIL, name: 'BookTheFoodTruck' }, subject: title, html: finalHtml };
    await sgMail.send(msg);
};

exports.sendVerificationEmail = async (email, token) => {
    const verificationLink = `${APP_URL}/verify-email?token=${token}`;
    const title = 'Aktywuj swoje konto w BookTheFoodTruck';
    const body = `<p>Witaj!</p><p>Dziękujemy za rejestrację. Kliknij poniższy przycisk, aby aktywować swoje konto:</p>`;
    const button = { text: 'Aktywuj konto', url: verificationLink };
    const finalHtml = createBrandedEmail(title, body, button);
    const msg = { to: email, from: { email: SENDER_EMAIL, name: 'BookTheFoodTruck' }, subject: title, html: finalHtml };
    await sgMail.send(msg);
};

exports.sendPasswordResetEmail = async (email, token) => {
    const resetLink = `${APP_URL}/reset-password?token=${token}`;
    const title = 'Reset hasła w BookTheFoodTruck';
    const body = `<p>Otrzymaliśmy prośbę o zresetowanie hasła dla Twojego konta.</p><p>Kliknij poniższy przycisk, aby ustawić nowe hasło. Jeśli nie prosiłeś o zmianę, zignoruj tę wiadomość.</p>`;
    const button = { text: 'Zresetuj hasło', url: resetLink };
    const finalHtml = createBrandedEmail(title, body, button);
    const msg = { to: email, from: { email: SENDER_EMAIL, name: 'BookTheFoodTruck' }, subject: title, html: finalHtml };
    await sgMail.send(msg);
};

exports.sendGoogleWelcomeEmail = async (email, firstName) => {
    const title = `Witaj w BookTheFoodTruck, ${firstName}!`;
    const body = `<p>Twoje konto zostało pomyślnie utworzone za pomocą logowania przez Google.</p><p>Możesz teraz w pełni korzystać z naszej platformy.</p>`;
    const button = { text: 'Przejdź do aplikacji', url: APP_URL };
    const finalHtml = createBrandedEmail(title, body, button);
    const msg = { to: email, from: { email: SENDER_EMAIL, name: 'BookTheFoodTruck' }, subject: title, html: finalHtml };
    await sgMail.send(msg);
};

exports.sendNewUserAdminNotification = async (userData) => {
    const adminEmail = process.env.ADMIN_EMAIL || 'pakowanko.info@gmail.com';
    const { email, first_name, last_name, user_type, company_name } = userData;
    const msg = {
        to: adminEmail,
        from: { email: SENDER_EMAIL, name: 'System BookTheFoodTruck' },
        subject: `Nowa rejestracja: ${email}`,
        html: `<h2>Nowy użytkownik!</h2><p><strong>Email:</strong> ${email}</p><p><strong>Typ konta:</strong> ${user_type}</p><p><strong>Imię:</strong> ${first_name}</p><p><strong>Nazwisko:</strong> ${last_name}</p><p><strong>Firma:</strong> ${company_name || 'Brak'}</p>`
    };
    await sgMail.send(msg);
};

exports.sendPackagingReminderEmail = async (email, foodTruckName) => {
    const title = `Przypomnienie: Zamów opakowania dla ${foodTruckName}`;
    const body = `<p>Cześć,</p><p>Chcielibyśmy przypomnieć, że zbliża się termin Twojej potwierdzonej rezerwacji. To idealny moment, aby zaopatrzyć się w ekologiczne opakowania i naczynia jednorazowe.</p><p>Zapewnij swoim klientom najlepszą jakość, serwując dania w profesjonalnych opakowaniach.</p>`;
    const button = { text: 'Zobacz ofertę i zamów teraz!', url: PAKOWANKO_URL };
    const finalHtml = createBrandedEmail(title, body, button);
    const msg = { to: email, from: { email: SENDER_EMAIL, name: 'BookTheFoodTruck' }, subject: title, html: finalHtml };
    await sgMail.send(msg);
};

exports.sendBookingReminderEmail = async (ownerEmail, requests) => {
    const title = 'Masz oczekujące prośby o rezerwację!';
    let requestsHtml = '<ul>';
    requests.forEach(req => {
        requestsHtml += `<li>Food Truck: <strong>${req.food_truck_name}</strong>, Data: ${new Date(req.event_start_date.seconds * 1000).toLocaleDateString()}</li>`;
    });
    requestsHtml += '</ul>';
    const body = `<p>Zauważyliśmy, że masz zapytania o rezerwację, na które jeszcze nie odpowiedziałeś:</p>${requestsHtml}<p>Nie pozwól, aby klienci czekali! Zaloguj się na swoje konto, aby jak najszybciej na nie odpowiedzieć.</p>`;
    const button = { text: 'Przejdź do panelu', url: `${APP_URL}/dashboard` };
    const finalHtml = createBrandedEmail(title, body, button);
    const msg = { to: ownerEmail, from: { email: SENDER_EMAIL, name: 'BookTheFoodTruck' }, subject: title, html: finalHtml };
    await sgMail.send(msg);
};

// Dodajemy tę funkcję, aby była dostępna dla innych plików
module.exports.createBrandedEmail = createBrandedEmail;
