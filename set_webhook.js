require('dotenv').config();
const https = require('https');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SERVER_URL = process.env.SERVER_URL;

if (!BOT_TOKEN || !SERVER_URL) {
    console.error('ERROR: Falta TELEGRAM_BOT_TOKEN o SERVER_URL en el archivo .env');
    process.exit(1);
}

const WEBHOOK_URL = `${SERVER_URL}/webhook`;

console.log(`Configurando webhook en: ${WEBHOOK_URL}...`);

https.get(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${WEBHOOK_URL}`, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        const result = JSON.parse(data);
        if (result.ok) {
            console.log('✅ Webhook configurado con éxito!');
            console.log('Respuesta:', result.description);
        } else {
            console.error('❌ Error al configurar webhook:', result.description);
        }
    });
}).on('error', (err) => {
    console.error('Error de red:', err.message);
});
