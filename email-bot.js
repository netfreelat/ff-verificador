const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const fs = require('fs');
const path = require('path');

const PAGOS_FILE = path.join(__dirname, 'pagos_recibidos.json');

// Cargar pagos guardados previamente para no repetir
let pagosValidados = {};
if (fs.existsSync(PAGOS_FILE)) {
    try {
        pagosValidados = JSON.parse(fs.readFileSync(PAGOS_FILE, 'utf8'));
    } catch (e) {
        console.error('Error leyendo pagos_recibidos.json', e);
    }
}

function savePagos() {
    fs.writeFileSync(PAGOS_FILE, JSON.stringify(pagosValidados, null, 2));
}

let connection = null;

async function procesarCorreo(mensaje, onPaymentReceived) {
    try {
        const parts = imaps.getParts(mensaje.attributes.struct);
        let part = parts.find(p => p.which === 'TEXT' || p.which === '1' || p.which === '');
        if (!part) part = parts[0];

        const messageData = await connection.getPartData(mensaje, part);
        const parsed = await simpleParser(messageData);
        const text = parsed.text || parsed.html || '';

        // Buscar Banplus
        const isBanplus = text.toLowerCase().includes('banplus');
        
        if (isBanplus) {
            const refMatch = text.match(/Referencia:\s*(\d+)/i);
            const amountMatch = text.match(/Monto:\s*Bs\.\s*([\d.,]+)/i);

            if (refMatch && amountMatch) {
                const ref = refMatch[1];
                let amountStr = amountMatch[1].replace(/\./g, '').replace(',', '.'); // "4,00" -> "4.00"
                const amount = parseFloat(amountStr);

                if (!pagosValidados[ref]) {
                    console.log(`[EMAIL] 🏦 NUEVO PAGO DETECTADO: Ref ${ref} | Monto Bs. ${amount}`);
                    pagosValidados[ref] = { amount, time: new Date().toISOString(), used: false };
                    savePagos();
                    
                    // Notificar al servidor principal
                    if (onPaymentReceived) {
                        onPaymentReceived(ref, amount);
                    }
                }
            }
        }

    } catch (err) {
        console.error('[EMAIL] Error parseando correo:', err.message);
    }
}

async function iniciarLectorCorreos(onPaymentReceived) {
    const emailUser = process.env.EMAIL_USER || '';
    const defaultHost = emailUser.includes('@gmail.com') ? 'imap.gmail.com' : 'imap-mail.outlook.com';

    const config = {
        imap: {
            user: emailUser,
            password: process.env.EMAIL_PASSWORD,
            host: process.env.EMAIL_HOST || defaultHost,
            port: process.env.EMAIL_PORT || 993,
            tls: true,
            authTimeout: 10000,
            tlsOptions: { rejectUnauthorized: false }
        }
    };

    if (!config.imap.user || !config.imap.password) {
        console.error('[EMAIL] ⚠️ No se ha configurado EMAIL_USER o EMAIL_PASSWORD en .env');
        return;
    }

    try {
        console.log('[EMAIL] 🔄 Conectando a IMAP...');
        connection = await imaps.connect(config);
        console.log('[EMAIL] ✅ Conexión IMAP exitosa.');

        // Intentar abrir la carpeta de Junk (Correo no deseado)
        let boxName = 'Junk'; // Para Outlook suele ser 'Junk'
        try {
            await connection.openBox(boxName);
            console.log(`[EMAIL] 📂 Escuchando carpeta: ${boxName}`);
        } catch (err) {
            console.log(`[EMAIL] ⚠️ No se encontró la carpeta ${boxName}, intentando INBOX...`);
            boxName = 'INBOX';
            await connection.openBox(boxName);
            console.log(`[EMAIL] 📂 Escuchando carpeta: ${boxName}`);
        }

        // Buscar correos no leídos actuales
        const searchCriteria = ['UNSEEN'];
        const fetchOptions = { bodies: ['HEADER', 'TEXT'], struct: true, markSeen: true };
        
        const results = await connection.search(searchCriteria, fetchOptions);
        for (const res of results) {
            await procesarCorreo(res, onPaymentReceived);
        }

        // Escuchar nuevos correos que lleguen en tiempo real
        connection.on('mail', async () => {
            console.log('[EMAIL] 📧 Nuevo correo detectado...');
            try {
                const newResults = await connection.search(searchCriteria, fetchOptions);
                for (const res of newResults) {
                    await procesarCorreo(res, onPaymentReceived);
                }
            } catch (err) {
                console.error('[EMAIL] Error al buscar nuevos correos:', err);
            }
        });

        // Reconexión si se cae
        connection.on('error', (err) => {
            console.error('[EMAIL] ❌ Error en conexión IMAP:', err);
        });

        connection.on('end', () => {
            console.log('[EMAIL] 🔌 Conexión IMAP cerrada. Reconectando en 10s...');
            setTimeout(() => iniciarLectorCorreos(onPaymentReceived), 10000);
        });

    } catch (err) {
        console.error('[EMAIL] ❌ Falló la conexión IMAP:', err.message);
        console.log('[EMAIL] Reintentando en 30s...');
        setTimeout(() => iniciarLectorCorreos(onPaymentReceived), 30000);
    }
}

module.exports = {
    iniciarLectorCorreos,
    getPagosValidados: () => pagosValidados,
    marcarPagoComoUsado: (ref) => {
        if (pagosValidados[ref]) {
            pagosValidados[ref].used = true;
            savePagos();
        }
    }
};
