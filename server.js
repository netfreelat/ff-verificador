require('dotenv').config();
const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3500;
const fs = require('fs');
const path = require('path');
const url = require('url');

const PINES_FILE = path.join(__dirname, 'pines.json');
const RECIENTES_FILE = path.join(__dirname, 'recientes.json');
const ORDERS_FILE = path.join(__dirname, 'pedidos.json');
const USERS_FILE = path.join(__dirname, 'usuarios.json');
const WA_QUEUE_FILE = path.join(__dirname, 'wa_queue.json');
const PAGOS_FILE = path.join(__dirname, 'pagos_recibidos.json');

// Cargar persistencia
let recentReloads = [];
let orders = {};
let pines = { "100": [], "310": [], "520": [], "1060": [], "2180": [], "5600": [] };
let whatsappQueue = [];
let waBotStatus = 'Desconectado'; // 'Desconectado', 'Esperando QR', 'Conectado'
let waBotQR = '';
let pagosValidados = {};

try {
    if (fs.existsSync(RECIENTES_FILE)) {
        recentReloads = JSON.parse(fs.readFileSync(RECIENTES_FILE, 'utf8'));
    }
    if (fs.existsSync(ORDERS_FILE)) {
        orders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
    }
    if (fs.existsSync(PINES_FILE)) {
        pines = JSON.parse(fs.readFileSync(PINES_FILE, 'utf8'));
    }
    if (fs.existsSync(USERS_FILE)) {
        users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    }
    if (fs.existsSync(WA_QUEUE_FILE)) {
        whatsappQueue = JSON.parse(fs.readFileSync(WA_QUEUE_FILE, 'utf8'));
    }
    if (fs.existsSync(PAGOS_FILE)) {
        pagosValidados = JSON.parse(fs.readFileSync(PAGOS_FILE, 'utf8'));
    }
} catch (e) {
    console.error('Error cargando persistencia:', e);
}

function savePagos() {
    try { fs.writeFileSync(PAGOS_FILE, JSON.stringify(pagosValidados), 'utf8'); } catch (e) {}
}

function saveWaQueue() {
    try { fs.writeFileSync(WA_QUEUE_FILE, JSON.stringify(whatsappQueue), 'utf8'); } catch (e) {}
}

function queueWhatsAppMessage(order, isAccepted, pin = null) {
    if (!order.wa || order.wa === 'No provisto') return;
    
    let msg = '';
    if (isAccepted) {
        msg = `💎 *RECIBO DE RECARGA - FREE FIRE* 💎\n\n✅ ¡Tu recarga ha sido APROBADA!\n\n👤 Jugador: ${order.name}\n🆔 ID: ${order.uid}\n📦 Paquete: ${order.pack}\n\nLos diamantes ya fueron enviados a tu cuenta.`;
        if (pin) {
            msg += `\n🔑 Tu PIN es: ${pin}`;
        }
        msg += `\n\n¡Gracias por tu compra!`;
    } else {
        msg = `❌ *RECARGA RECHAZADA*\n\nEstimado ${order.name}, tu recarga por el paquete de ${order.pack} no pudo ser procesada.\n\nMotivo: Referencia o monto incorrecto.\nSi crees que es un error, contacta a soporte.\n\nID: ${order.uid}`;
    }

    whatsappQueue.push({ id: Date.now().toString(), number: order.wa, message: msg });
    saveWaQueue();
}

function saveUsers() {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users), 'utf8');
    } catch (e) {
        console.error('Error guardando usuarios:', e);
    }
}

function addPoints(uid, amountUsdt, name = null) {
    if (!users[uid]) {
        users[uid] = { name: name || 'Jugador', points: 0, registered: new Date().toISOString() };
    }
    const pointsToAdd = Math.floor(amountUsdt * 10); // 10 puntos por 1 USDT
    users[uid].points += pointsToAdd;
    if (name) users[uid].name = name;
    saveUsers();
    console.log(`[PUNTOS] Se añadieron ${pointsToAdd} puntos a ID: ${uid}. Total: ${users[uid].points}`);
    return pointsToAdd;
}

function saveRecent(name, pack, type = 'recarga') {
    recentReloads.unshift({ name, pack, type, time: new Date().toLocaleTimeString() });
    if (recentReloads.length > 10) recentReloads.pop();
    try {
        fs.writeFileSync(RECIENTES_FILE, JSON.stringify(recentReloads), 'utf8');
    } catch (e) {
        console.error('Error guardando recientes:', e);
    }
}

function updateOrderStatus(ref, status, pin = null) {
    if (orders[ref]) {
        orders[ref].status = status;
        if (pin) orders[ref].pin = pin;
        try {
            fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders), 'utf8');
        } catch (e) {
            console.error('Error actualizando pedido:', e);
        }
    }
}

async function rechargeViaNetfreelat(order, ref) {
    const packMap = {
        "100": "1",
        "310": "2",
        "520": "3",
        "1060": "4",
        "2180": "5",
        "5600": "6"
    };

    const amountKey = order.pack.split(' ')[0].replace(',', '').replace('.', '');
    const montoId = packMap[amountKey];

    if (!montoId) return { success: false, message: 'Paquete no mapeado: ' + amountKey };

    if (process.env.TEST_MODE === 'true') {
        console.log(`[TEST_MODE] Simulando recarga exitosa para ID: ${order.uid}`);
        return { success: true, message: 'Simulación de recarga exitosa (Modo Prueba)' };
    }

    const user = encodeURIComponent(process.env.NETFREELAT_USER || '');
    const pass = encodeURIComponent(process.env.NETFREELAT_PASS || '');
    const apiUrl = `https://www.netfreelat.net/conexcion_api/api.php?action=recarga&usuario=${user}&clave=${pass}&tipo=recargaFreefire&numero=${order.uid}&monto=${montoId}&modo=1&id_aprobacion=${ref}`;

    console.log(`[NETFREELAT] Intentando recarga para ID: ${order.uid} | Paquete: ${amountKey}`);

    return new Promise((resolve) => {
        console.log(`[NETFREELAT] Enviando petición a: ${apiUrl.substring(0, 100)}...`);
        
        const req = https.get(apiUrl, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                console.log(`[NETFREELAT] Respuesta recibida: ${body}`);
                const lowerBody = body.toLowerCase();
                if (lowerBody.includes('success') || lowerBody.includes('exito') || lowerBody.includes('ok') || lowerBody.includes('green')) {
                    resolve({ success: true, message: body });
                } else {
                    resolve({ success: false, message: body });
                }
            });
        });

        req.on('error', (e) => {
            console.error('[NETFREELAT] Error de conexión:', e.message);
            resolve({ success: false, message: 'Error de conexión: ' + e.message });
        });

        // Timeout de 15 segundos para no dejar colgado el servidor
        req.setTimeout(15000, () => {
            req.destroy();
            console.error('[NETFREELAT] La API tardó demasiado en responder (Timeout)');
            resolve({ success: false, message: 'Tiempo de espera agotado' });
        });
    });
}

function getFallbackPin(amount) {
    const amountKey = amount.toString().split(' ')[0].replace(',', '').replace('.', '');
    if (pines[amountKey] && pines[amountKey].length > 0) {
        const pin = pines[amountKey].shift();
        fs.writeFileSync(PINES_FILE, JSON.stringify(pines), 'utf8');
        return pin;
    }
    return null;
}

function processPendingOrder(inputFullRef, inputShortRef) {
    let targetFullRef = inputFullRef;
    let targetShortRef = inputShortRef;

    // Caso A: Viene del Banco (tenemos FullRef, buscamos ShortRef en pedidos)
    if (targetFullRef && !targetShortRef) {
        for (let sRef in orders) {
            if (orders[sRef].status === 'pending' && targetFullRef.endsWith(sRef)) {
                targetShortRef = sRef;
                break;
            }
        }
    }

    // Caso B: Viene del Usuario (tenemos ShortRef, buscamos FullRef en pagos recibidos)
    if (targetShortRef && !targetFullRef) {
        for (let fRef in pagosValidados) {
            if (!pagosValidados[fRef].used && fRef.endsWith(targetShortRef)) {
                targetFullRef = fRef;
                break;
            }
        }
    }

    // Si encontramos ambos, procedemos a aprobar
    if (targetFullRef && targetShortRef && orders[targetShortRef] && orders[targetShortRef].status === 'pending') {
        const order = orders[targetShortRef];
        const pago = pagosValidados[targetFullRef];
        
        if (pago && !pago.used) {
            console.log(`[AUTO-APPROVE] ¡CONEXIÓN EXITOSA!`);
            console.log(`[AUTO-APPROVE] Ref Banco: ${targetFullRef} <--> Ref Formulario: ${targetShortRef}`);
            
            pagosValidados[targetFullRef].used = true;
            savePagos();
            
            rechargeViaNetfreelat(order, targetShortRef).then(result => {
                if (result.success) {
                    orders[targetShortRef].status = 'approved';
                    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders), 'utf8');
                    saveRecent(order.name, order.pack);
                    const usdtPrice = parseFloat(order.price.split('USDT')[0]);
                    if (!isNaN(usdtPrice)) {
                        addPoints(order.uid, usdtPrice, order.name);
                    }
                    queueWhatsAppMessage(order, true);
                    console.log(`[AUTO-APPROVE] Recarga exitosa para ${order.uid}`);
                } else {
                    const pin = getFallbackPin(order.pack);
                    if (pin) {
                        orders[targetShortRef].status = 'approved';
                        orders[targetShortRef].pin = pin;
                        fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders), 'utf8');
                        saveRecent(order.name, order.pack);
                        const usdtPrice = parseFloat(order.price.split('USDT')[0]);
                        if (!isNaN(usdtPrice)) {
                            addPoints(order.uid, usdtPrice, order.name);
                        }
                        queueWhatsAppMessage(order, true, pin);
                        console.log(`[AUTO-APPROVE] Recarga exitosa (PIN) para ${order.uid}`);
                    } else {
                        console.error(`[AUTO-APPROVE] Error en recarga automática.`);
                    }
                }
            });
            return true;
        }
    }
    return false;
}

const server = http.createServer((req, res) => {
    // Permisos CORS para que el panel admin y la web funcionen
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    // Responder rápido a peticiones OPTIONS (preflight)
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);

    if (parsedUrl.pathname === '/verificar') {
        const uid = parsedUrl.searchParams.get('uid');

        if (!uid) {
            res.writeHead(400);
            return res.end(JSON.stringify({ error: 'Falta el parámetro uid' }));
        }

        console.log(`[VERIFICAR] Consultando ID: ${uid}`);

        const hosts = ['netfreelat.net'];
        let currentHostIndex = 0;

        const attemptRequest = (hostname) => {
            const apiPath = `/redeem/conexion_api/api.php`;
            const postData = `action=ValidarParametros&id=${encodeURIComponent(uid)}`;
            
            const options = {
                hostname: hostname,
                path: apiPath,
                method: 'POST',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Referer': `https://${hostname}/redeem/`,
                    'Accept': 'application/json, text/javascript, */*; q=0.01',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(postData)
                },
                timeout: 10000
            };

            const apiReq = https.request(options, (apiRes) => {
                let body = '';
                apiRes.setEncoding('utf8');
                apiRes.on('data', chunk => body += chunk);
                apiRes.on('end', () => {
                    try {
                        console.log(`[LOG] Respuesta de ${hostname}: ${body.substring(0, 100)}...`);
                        
                        // Intentar encontrar JSON en cualquier parte de la respuesta
                        let data = null;
                        const jsonMatch = body.match(/\{.*\}/s);
                        if (jsonMatch) {
                            try {
                                data = JSON.parse(jsonMatch[0]);
                            } catch (e) {
                                console.error('Error parseando JSON match:', e.message);
                            }
                        }

                        if (data && (data.alerta === 'green' || data.Nickname || data.perfil)) {
                            const nombre = data.Nickname || data.perfil || data.mensaje;
                            console.log(`[OK] ID ${uid} verificado como: ${nombre}`);
                            res.writeHead(200);
                            res.end(JSON.stringify({ success: true, nombre: nombre }));
                        } else if (currentHostIndex < hosts.length - 1) {
                            console.log(`[!] Falló con ${hostname}, probando con el siguiente...`);
                            currentHostIndex++;
                            attemptRequest(hosts[currentHostIndex]);
                        } else {
                            const mensaje = (data && data.mensaje) ? data.mensaje : 'ID no encontrado en Garena';
                            res.writeHead(200);
                            res.end(JSON.stringify({ success: false, mensaje }));
                        }
                    } catch (e) {
                        handleError(e, hostname);
                    }
                });
            });

            apiReq.on('error', (e) => handleError(e, hostname));
            apiReq.on('timeout', () => {
                apiReq.destroy();
                handleError(new Error('Timeout'), hostname);
            });
            apiReq.write(postData);
            apiReq.end();
        };

        const handleError = (e, hostname) => {
            console.error(`[ERROR] en ${hostname}:`, e.message);
            if (currentHostIndex < hosts.length - 1) {
                currentHostIndex++;
                attemptRequest(hosts[currentHostIndex]);
            } else {
                res.writeHead(200);
                res.end(JSON.stringify({ success: false, error: 'Error de conexión con servidores de Garena' }));
            }
        };

        attemptRequest(hosts[currentHostIndex]);

    } else if (parsedUrl.pathname === '/notificar') {
        const uid = parsedUrl.searchParams.get('uid');
        const name = parsedUrl.searchParams.get('name');
        const pack = parsedUrl.searchParams.get('pack');
        const method = parsedUrl.searchParams.get('method');
        const ref = parsedUrl.searchParams.get('ref');
        const price = parsedUrl.searchParams.get('price') || 'N/A';
        const wa = parsedUrl.searchParams.get('wa') || 'No provisto';

        console.log(`\n[NOTIFICACIÓN] Recibida solicitud de pago de: ${name} (ID: ${uid})`);
        console.log(`[NOTIFICACIÓN] Referencia: ${ref} | Paquete: ${pack} | WA: ${wa}\n`);

        // Guardar pedido como pendiente
        orders[ref] = { uid, name, pack, method, price, status: 'pending', time: new Date().toISOString(), wa: wa };
        try {
            fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders), 'utf8');
        } catch (e) {
            console.error('Error guardando pedidos:', e);
        }

        // Intentar auto-aprobar si el pago ya llegó previamente
        const autoApproved = processPendingOrder(null, ref);
        if (autoApproved) {
            console.log(`[NOTIFICACIÓN] Pedido ${ref} fue AUTO-APROBADO por correo.`);
            res.writeHead(200);
            return res.end(JSON.stringify({ success: true, info: 'Pedido auto-aprobado instantáneamente' }));
        }

        // --- CONFIGURACIÓN DE TELEGRAM ---
        const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN; 
        const CHAT_ID = process.env.TELEGRAM_CHAT_ID;     
        // ---------------------------------

        const message = `
🔥 *NUEVO PEDIDO DE DIAMANTES* 🔥
-------------------------------
👤 *Jugador:* ${name}
🆔 *ID:* ${uid}
💎 *Paquete:* ${pack}
💰 *Total:* ${price}
💳 *Método:* ${method === 'pagomovil' ? 'Pago Móvil' : 'Binance Pay'}
📝 *Referencia:* \`${ref}\`
📱 *WhatsApp:* \`+${wa}\`
-------------------------------
⏰ _Verifica el pago y presiona un botón:_
        `;

        const payload = JSON.stringify({
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "✅ ACEPTAR", callback_data: `accept|${ref}` },
                        { text: "❌ RECHAZAR", callback_data: `reject|${ref}` }
                    ]
                ]
            }
        });

        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${BOT_TOKEN}/sendMessage`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        const tgReq = https.request(options, (apiRes) => {
            let body = '';
            apiRes.on('data', chunk => body += chunk);
            apiRes.on('end', () => {
                res.writeHead(200);
                res.end(JSON.stringify({ success: true, info: 'Notificación enviada' }));
            });
        });
        
        tgReq.on('error', (e) => {
            console.error('Error enviando a Telegram:', e.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Error al enviar notificación' }));
        });

        tgReq.write(payload);
        tgReq.end();

    } else if (parsedUrl.pathname === '/webhook' && req.method === 'POST') {
        console.log('\n=========================================');
        console.log('[WEBHOOK] SE RECIBIÓ UNA PETICIÓN DE TELEGRAM');
        console.log('=========================================\n');
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const update = JSON.parse(body);
                if (update.callback_query) {
                    const callbackQuery = update.callback_query;
                    const data = callbackQuery.data;
                    const messageId = callbackQuery.message.message_id;
                    const chatId = callbackQuery.message.chat.id;
                    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
                    
                    if (!BOT_TOKEN) {
                        console.error('[WEBHOOK] ❌ ERROR: TELEGRAM_BOT_TOKEN no está configurado en las variables de entorno de Render.');
                        return res.end('Token missing');
                    }

                    const [action, ref] = data.split('|');
                    let order = orders[ref];
                    
                    console.log(`[WEBHOOK] 🖱️ CLIC RECIBIDO: Acción=${action} | Ref=${ref} | User=${callbackQuery.from.username || callbackQuery.from.id}`);

                    // 1. Responder INMEDIATAMENTE a Telegram para quitar el "relojito"
                    const answerPayload = JSON.stringify({ 
                        callback_query_id: callbackQuery.id,
                        text: action === 'accept' ? 'Procesando recarga...' : 'Cancelando pedido...'
                    });
                    const answerReq = https.request({
                        hostname: 'api.telegram.org',
                        path: `/bot${BOT_TOKEN}/answerCallbackQuery`,
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'Content-Length': Buffer.byteLength(answerPayload)
                        }
                    }, (ansRes) => {
                        console.log(`[WEBHOOK] Telegram respondió a answerCallbackQuery: ${ansRes.statusCode}`);
                    });
                    answerReq.on('error', (err) => console.error('[WEBHOOK] ❌ Error enviando answerCallbackQuery:', err.message));
                    answerReq.write(answerPayload);
                    answerReq.end();

                    // Si Render se durmió, orders[ref] estará vacío. Lo recuperamos del texto del mensaje.
                    if (!order) {
                        console.log(`[WEBHOOK] Pedido no encontrado en memoria. Intentando recuperar del texto del mensaje...`);
                        const text = callbackQuery.message.text || '';
                        
                        const uidMatch = text.match(/ID:\s*(\d+)/);
                        const nameMatch = text.match(/Jugador:\s*(.+)/);
                        const packMatch = text.match(/Paquete:\s*(.+)/);
                        const priceMatch = text.match(/Total:\s*(.+)/);
                        const waMatch = text.match(/WhatsApp:\s*\+?(\d+)/);
                        
                        if (uidMatch && packMatch) {
                            orders[ref] = {
                                uid: uidMatch[1].trim(),
                                name: nameMatch ? nameMatch[1].trim() : 'Desconocido',
                                pack: packMatch[1].trim(),
                                price: priceMatch ? priceMatch[1].trim() : '0USDT',
                                wa: waMatch ? waMatch[1].trim() : 'No provisto',
                                status: 'pending'
                            };
                            order = orders[ref];
                            console.log(`[WEBHOOK] Pedido recuperado con éxito:`, order);
                        } else {
                            console.error(`[WEBHOOK] No se pudo recuperar el pedido para ref: ${ref}`);
                            return res.end('Order not found');
                        }
                    }

                    let newText = '';
                    if (action === 'accept') {
                        const result = await rechargeViaNetfreelat(order, ref);
                        if (result.success) {
                            newText = `✅ *RECARGA EXITOSA*\n\n👤 *Jugador:* ${order.name}\n🆔 *ID:* ${order.uid}\n💎 *Paquete:* ${order.pack}\n\n✨ _Los diamantes han sido acreditados directamente._`;
                            
                            orders[ref].status = 'approved';
                            fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders), 'utf8');
                            saveRecent(order.name, order.pack);

                            // Sumar puntos
                            const usdtPrice = parseFloat(order.price.split('USDT')[0]);
                            if (!isNaN(usdtPrice)) {
                                addPoints(order.uid, usdtPrice, order.name);
                            }
                        } else {
                            // FALLBACK A PINES
                            console.log(`[FALLBACK] Intentando entrega de PIN para: ${order.pack}`);
                            const pin = getFallbackPin(order.pack);
                            
                            if (pin) {
                                newText = `🎟️ *RECARGA VÍA PIN (FALLBACK)*\n\n👤 *Jugador:* ${order.name}\n🆔 *ID:* ${order.uid}\n🔑 *PIN:* \`${pin}\`\n\n⚠️ _La recarga directa falló, se entregó un PIN para canje manual._`;
                                orders[ref].status = 'approved';
                                orders[ref].pin = pin;
                                fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders), 'utf8');
                                saveRecent(order.name, order.pack);

                                // Sumar puntos también en fallback
                                const usdtPrice = parseFloat(order.price.split('USDT')[0]);
                                if (!isNaN(usdtPrice)) {
                                    addPoints(order.uid, usdtPrice, order.name);
                                }
                            } else {
                                // Limpiamos caracteres que rompen el Markdown de Telegram en el mensaje de error
                                const safeErrorMsg = result.message.replace(/[_*[\]()~`>#+-=|{}.!]/g, ' ');
                                newText = `⚠️ *FALLÓ RECARGA Y NO HAY PINES*\n\n👤 *Jugador:* ${order.name}\n🆔 *ID:* ${order.uid}\n❌ *Error API:* ${safeErrorMsg}\n\n_Revisa el panel de Netfreelat o carga pines._`;
                            }
                        }
                    } else {
                        newText = `❌ *PEDIDO RECHAZADO*\n\n👤 *Jugador:* ${order.name}\n🆔 *ID:* ${order.uid}\n\n⚠️ _El pago no fue aprobado._`;
                        orders[ref].status = 'rejected';
                        fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders), 'utf8');
                    }

                    // Encolar mensaje de WhatsApp si corresponde (éxito o rechazo final)
                    if (action === 'reject') {
                        queueWhatsAppMessage(order, false);
                    } else if (action === 'accept' && orders[ref].status === 'approved') {
                        queueWhatsAppMessage(order, true, orders[ref].pin);
                    }

                    // 2. Editar el mensaje original con el resultado
                    const editPayload = JSON.stringify({
                        chat_id: chatId,
                        message_id: messageId,
                        text: newText,
                        parse_mode: 'Markdown'
                    });

                    const editReq = https.request({
                        hostname: 'api.telegram.org',
                        path: `/bot${BOT_TOKEN}/editMessageText`,
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Content-Length': Buffer.byteLength(editPayload)
                        }
                    }, (editRes) => {
                        editRes.on('data', () => {});
                        editRes.on('end', () => console.log('[WEBHOOK] Mensaje editado correctamente'));
                    });

                    editReq.on('error', (err) => console.error('[WEBHOOK] Error editando:', err));
                    editReq.write(editPayload);
                    editReq.end();
                }
                res.writeHead(200);
                res.end('OK');
            } catch (e) {
                console.error('[WEBHOOK] Error procesando body:', e);
                res.writeHead(400);
                res.end('Error');
            }
        });
    } else if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    } else if (parsedUrl.pathname === '/webhook/notificacion' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                console.log(`\n[DEBUG-WEBHOOK] Datos recibidos: ${body}`);
                const data = JSON.parse(body);
                const text = data.text || '';
                
                if (!text) {
                    console.log('[DEBUG-WEBHOOK] ❌ Texto vacío.');
                    res.writeHead(200);
                    return res.end('Empty');
                }

                console.log(`[DEBUG-WEBHOOK] Procesando: "${text}"`);
                
                let refMatch = text.match(/Ref\s*(\d+)/i);
                let amountMatch = text.match(/Bs\.\s*([\d,.]+)/i);

                if (refMatch && amountMatch) {
                    const ref = refMatch[1];
                    const amountStr = amountMatch[1].replace(/\./g, '').replace(',', '.');
                    const amount = parseFloat(amountStr);

                    console.log(`[DEBUG-WEBHOOK] ✅ Ref: ${ref}, Monto: ${amount}`);

                    if (!pagosValidados[ref]) {
                        pagosValidados[ref] = { amount, time: new Date().toISOString(), used: false };
                        savePagos();
                    }
                    // Intentar procesar siempre (por si acaso)
                    processPendingOrder(ref, null);
                } else {
                    console.log(`[DEBUG-WEBHOOK] ⚠️ Formato no reconocido.`);
                }
                
                res.writeHead(200);
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                console.error('[DEBUG-WEBHOOK] ❌ Error:', e.message);
                res.writeHead(400);
                res.end('Error');
            }
        });
    } else if (parsedUrl.pathname === '/status') {
        const ref = parsedUrl.searchParams.get('ref');
        const order = orders[ref];
        if (order) {
            res.writeHead(200);
            res.end(JSON.stringify({ 
                status: order.status,
                pin: order.pin || null
            }));
        } else {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Pedido no encontrado' }));
        }
    } else if (parsedUrl.pathname === '/recientes') {
        res.writeHead(200);
        res.end(JSON.stringify(recentReloads));
    } else if (parsedUrl.pathname === '/admin/pines' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(pines));
    } else if (parsedUrl.pathname === '/admin/pines/add' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (pines[data.amount]) {
                    pines[data.amount] = [...pines[data.amount], ...data.codes];
                    fs.writeFileSync(PINES_FILE, JSON.stringify(pines), 'utf8');
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, count: pines[data.amount].length }));
                } else {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Monto inválido' }));
                }
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Error procesando datos' }));
            }
        });
    } else if (parsedUrl.pathname === '/perfil') {
        const uid = parsedUrl.searchParams.get('uid');
        if (uid && users[uid]) {
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, user: users[uid] }));
        } else if (uid) {
            // Registrar si no existe (con bono de bienvenida)
            users[uid] = { name: 'Jugador', points: 50, registered: new Date().toISOString() };
            saveUsers();
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, user: users[uid] }));
        } else {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Falta uid' }));
        }
    } else if (parsedUrl.pathname === '/canjear' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const { uid, pack } = data;
                const user = users[uid];
                
                // Definir costos en puntos (ejemplo: 100 diamantes = 500 puntos)
                const pointCosts = { "100": 500, "310": 1500, "520": 2500 };
                const cost = pointCosts[pack];

                if (!user || !cost || user.points < cost) {
                    res.writeHead(400);
                    return res.end(JSON.stringify({ success: false, message: 'Puntos insuficientes o paquete inválido' }));
                }

                // Intentar recarga (prioridad pines para canje)
                const pin = getFallbackPin(pack);
                if (pin) {
                    const pointsBefore = Number(user.points);
                    user.points = pointsBefore - cost;
                    saveUsers();
                    console.log(`[CANJE] ✅ ÉXITO: Usuario ${uid} canjeó ${cost} puntos. Balance: ${pointsBefore} -> ${user.points}`);
                    
                    // Mostrar en la marquesina (usar nombre si existe o ID)
                    saveRecent(user.name || uid, pack, 'canje');
                    
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, pin: pin, message: '¡Canje exitoso!' }));
                } else {
                    console.log(`[CANJE] ❌ FALLO: No hay pines para el paquete ${pack}`);
                    res.writeHead(400);
                    res.end(JSON.stringify({ success: false, message: 'No hay pines disponibles para canje en este momento' }));
                }
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Error procesando canje' }));
            }
        });
    } else if (parsedUrl.pathname === '/api/redeem_pin') {
        const uid = parsedUrl.searchParams.get('uid');
        const pin = parsedUrl.searchParams.get('pin');
        
        if (!uid || !pin) {
            res.writeHead(400);
            return res.end(JSON.stringify({ success: false, message: 'Falta el ID o el PIN' }));
        }

        console.log(`[CANJE_PIN] Intentando canjear PIN ${pin} para ID: ${uid}`);

        const apiUrl = `https://netfreelat.net/redeem/conexion_api/api.php?action=canjefreeFire&id=${encodeURIComponent(uid)}&pin=${encodeURIComponent(pin)}`;

        https.get(apiUrl, (apiRes) => {
            let body = '';
            apiRes.on('data', chunk => body += chunk);
            apiRes.on('end', () => {
                try {
                    let data = body.trim();
                    if (data.startsWith('"') && data.endsWith('"')) {
                        data = data.substring(1, data.length - 1).replace(/\\"/g, '"');
                    }
                    const parsedData = JSON.parse(data);
                    
                    if (parsedData.alerta === 'green') {
                        // Guardar en recientes
                        saveRecent(uid, 'Diamantes', 'canje');
                        res.writeHead(200);
                        res.end(JSON.stringify({ success: true, message: parsedData.mensaje }));
                    } else {
                        let errorMsg = parsedData.mensaje;
                        // Ocultar referencias a Pago Norte / Netfreelat y hacer el mensaje más amigable
                        if (errorMsg && (errorMsg.includes('Pago Norte') || errorMsg.includes('Netfreelat'))) {
                            errorMsg = 'El PIN ingresado no es válido, ha caducado o ya fue utilizado. Por favor, verifica que lo hayas escrito correctamente e intenta de nuevo.';
                        }
                        res.writeHead(200);
                        res.end(JSON.stringify({ success: false, message: errorMsg }));
                    }
                } catch (e) {
                    console.error('[CANJE_PIN] Error parseando respuesta:', e.message, body);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, message: 'Error procesando la respuesta del proveedor.' }));
                }
            });
        }).on('error', (err) => {
            console.error('[CANJE_PIN] Error conectando a Netfreelat:', err.message);
            res.writeHead(500);
            res.end(JSON.stringify({ success: false, message: 'Error de conexión con el proveedor.' }));
        });
    } else if (parsedUrl.pathname === '/api/whatsapp_queue') {
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, queue: whatsappQueue }));
    } else if (parsedUrl.pathname === '/api/whatsapp_sent' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { id } = JSON.parse(body);
                whatsappQueue = whatsappQueue.filter(item => item.id !== id);
                saveWaQueue();
                res.writeHead(200);
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ success: false, error: 'Bad request' }));
            }
        });
    } else if (parsedUrl.pathname === '/api/wa_status') {
        res.writeHead(200);
        res.end(JSON.stringify({ status: waBotStatus, qr: waBotQR }));
    } else if (parsedUrl.pathname === '/api/wa_status_update' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (data.status !== undefined) waBotStatus = data.status;
                if (data.qr !== undefined) waBotQR = data.qr;
                res.writeHead(200);
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ success: false }));
            }
        });
    } else if (parsedUrl.pathname === '/health') {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok' }));
    } else {
        // Servir archivos estáticos (index.html, style.css, script.js, etc.)
        let filePath = '.' + parsedUrl.pathname;
        if (filePath === './') filePath = './index.html';

        const extname = String(path.extname(filePath)).toLowerCase();
        const mimeTypes = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.wav': 'audio/wav',
            '.mp4': 'video/mp4',
            '.woff': 'application/font-woff',
            '.ttf': 'application/font-ttf',
            '.eot': 'application/vnd.ms-fontobject',
            '.otf': 'application/font-otf',
            '.wasm': 'application/wasm'
        };

        const contentType = mimeTypes[extname] || 'application/octet-stream';

        fs.readFile(filePath, (error, content) => {
            if (error) {
                if(error.code == 'ENOENT') {
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: 'Ruta no encontrada' }));
                } else {
                    res.writeHead(500);
                    res.end('Lo sentimos, error en el servidor: '+error.code+' ..\n');
                }
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content, 'utf-8');
            }
        });
    }
});

server.listen(PORT, () => {
    console.log('=========================================');
    console.log('  Servidor de Verificación Free Fire');
    console.log(`  Corriendo en: http://localhost:${PORT}`);
    console.log(`  Prueba: http://localhost:${PORT}/verificar?uid=9583620455`);
    console.log('=========================================');
});
