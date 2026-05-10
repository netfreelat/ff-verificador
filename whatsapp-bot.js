require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const http = require('http');

const SERVER_URL = 'http://localhost:3500';

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu'
        ]
    }
});

function updateStatus(status, qr = '') {
    const data = JSON.stringify({ status, qr });
    const url = new URL(SERVER_URL);
    const options = {
        hostname: url.hostname,
        port: url.port || 80,
        path: '/api/wa_status_update',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        }
    };
    const req = http.request(options);
    req.on('error', () => {}); // Silenciar error si no conecta
    req.write(data);
    req.end();
}

client.on('qr', (qr) => {
    console.log('\n=========================================');
    console.log('📱 ESCANEA ESTE CÓDIGO QR CON TU WHATSAPP');
    console.log('=========================================\n');
    qrcode.generate(qr, { small: true });
    updateStatus('Esperando QR', qr);
});

client.on('ready', () => {
    console.log('\n✅ ¡Bot de WhatsApp conectado y listo!');
    console.log(`Escuchando mensajes pendientes desde: ${SERVER_URL}\n`);
    updateStatus('Conectado', '');
    
    // Iniciar el polling cada 10 segundos
    setInterval(checkQueue, 10000);
});

client.on('auth_failure', msg => {
    console.error('❌ Error de autenticación:', msg);
    updateStatus('Error de autenticación');
});

client.on('disconnected', (reason) => {
    console.log('❌ Bot desconectado:', reason);
    updateStatus('Desconectado');
});

client.initialize();

async function checkQueue() {
    try {
        const req = http.get(`${SERVER_URL}/api/whatsapp_queue`, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', async () => {
                if (res.statusCode === 200) {
                    try {
                        const data = JSON.parse(body);
                        if (data.success && data.queue && data.queue.length > 0) {
                            console.log(`[WHATSAPP] Hay ${data.queue.length} mensajes pendientes.`);
                            for (const item of data.queue) {
                                await sendMessage(item);
                            }
                        }
                    } catch(e) {
                        console.error('[WHATSAPP] Error parseando JSON de cola:', e.message);
                    }
                }
            });
        });
        req.on('error', (e) => {
            console.error('[WHATSAPP] Error conectando al servidor web:', e.message);
        });
    } catch (e) {
        console.error('[WHATSAPP] Error en checkQueue:', e.message);
    }
}

async function sendMessage(item) {
    try {
        // Formatear número (Ej. 584121234567@c.us)
        const numberId = `${item.number}@c.us`;
        
        console.log(`[WHATSAPP] Enviando mensaje a ${item.number}...`);
        
        // Verificamos si el cliente está listo
        if (!client || !client.pupPage) {
            throw new Error('El navegador de WhatsApp no está listo todavía.');
        }

        await client.sendMessage(numberId, item.message);
        console.log(`[WHATSAPP] ✅ Mensaje enviado a ${item.number}`);
        
        // Marcar como enviado en el servidor
        markAsSent(item.id);
        
        // Pausa pequeña para no saturar a WhatsApp (3 segundos)
        await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (error) {
        console.error(`[WHATSAPP] ❌ Error enviando a ${item.number}:`, error.message);
        // Si el error es crítico, podríamos intentar reiniciar el intervalo después
    }
}

function markAsSent(id) {
    const data = JSON.stringify({ id });
    const url = new URL(SERVER_URL);
    
    const options = {
        hostname: url.hostname,
        port: url.port || 80,
        path: '/api/whatsapp_sent',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        }
    };
    
    const req = http.request(options, (res) => {
        // OK
    });
    
    req.on('error', (error) => {
        console.error('[WHATSAPP] Error al marcar como enviado:', error.message);
    });
    
    req.write(data);
    req.end();
}
