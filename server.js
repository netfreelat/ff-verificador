require('dotenv').config();
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 3500;

// --- Supabase ---
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

const BDV_TOKEN = process.env.BDV_TOKEN;
const BDV_PASSWORD = process.env.BDV_PASSWORD;
const BDV_API_URL = 'https://apicentral.pro/apis/movimientos_bdv.jsp';

async function verifyBDVPayment(montoReportado, referencia4) {
    try {
        const urlStr = `${BDV_API_URL}?token=${BDV_TOKEN}&password=${encodeURIComponent(BDV_PASSWORD)}`;
        const response = await new Promise((resolve, reject) => {
            https.get(urlStr, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(JSON.parse(data)));
            }).on('error', reject);
        });

        if (response.alerta !== 'green' || !Array.isArray(response.movimientos)) return { success: false, pending: true };

        const match = response.movimientos.find(m => {
            if (m.tipo !== 'credito') return false;
            const montoMov = parseFloat(m.monto.replace(/\./g, '').replace(',', '.'));
            const refMov = String(m.referencia || '').slice(-4);
            return Math.abs(montoMov - montoReportado) < 1 && refMov === referencia4;
        });

        return match ? { success: true, movimiento: match } : { success: false, pending: true };
    } catch (e) {
        console.error('[BDV] Error:', e);
        return { success: false, pending: true };
    }
}

// --- Estado en memoria (cache) ---
let recentReloads = [];
let orders = {};
let pines = { "100": [], "310": [], "520": [], "1060": [], "2180": [], "5600": [] };
let whatsappQueue = [];
let waBotStatus = 'Desconectado';
let waBotQR = '';
let pagosValidados = {};
let users = {};
let settings = {
    tasa_del_dia: 635.00,
    barra_informativa: "🔥 ¡Bienvenidos a Diamond Center! 💎",
    precios: {
        "100":  { "usdt": 1.00,  "label": "100 + 10 Diamantes" },
        "310":  { "usdt": 3.10,  "label": "310 + 31 Diamantes" },
        "520":  { "usdt": 5.20,  "label": "520 + 52 Diamantes" },
        "1060": { "usdt": 10.60, "label": "1060 + 106 Diamantes" },
        "2180": { "usdt": 21.80, "label": "2180 + 218 Diamantes" },
        "5600": { "usdt": 56.00, "label": "5600 + 560 Diamantes" }
    },
    admin: { username: "admin", password: "123" },
    metodos_pago: { pagomovil: { banco: "", telefono: "", cedula: "" }, binance: { id: "", nombre: "" } },
    whatsapp: { soporte: "", canal: "" }
};

// --- Carga inicial desde Supabase ---
async function loadFromSupabase() {
    try {
        // Usuarios
        const { data: usersData } = await supabase.from('ff_users').select('*');
        if (usersData) {
            usersData.forEach(u => { users[u.uid] = { name: u.name, points: u.points, password: u.password, registered: u.registered, referred_by: u.referred_by }; });
        }

        // Pedidos
        const { data: ordersData } = await supabase.from('ff_orders').select('*');
        if (ordersData) {
            ordersData.forEach(o => { orders[o.ref] = { uid: o.uid, login_uid: o.login_uid, name: o.name, pack: o.pack, method: o.method, price: o.price, status: o.status, time: o.time, wa: o.wa, pin: o.pin, telegram_msg_id: o.telegram_msg_id }; });
        }

        // Pines
        const { data: pinesData } = await supabase.from('ff_pines').select('*').eq('used', false);
        if (pinesData) {
            pines = { "100": [], "310": [], "520": [], "1060": [], "2180": [], "5600": [] };
            pinesData.forEach(p => { if (pines[p.amount]) pines[p.amount].push(p.code); });
        }

        // Recientes
        const { data: recData } = await supabase.from('ff_recientes').select('*').order('created_at', { ascending: false }).limit(10);
        if (recData) recentReloads = recData.map(r => ({ name: r.name, pack: r.pack, type: r.type, time: r.time }));

        // Cola WA
        const { data: waData } = await supabase.from('ff_wa_queue').select('*').eq('sent', false);
        if (waData) whatsappQueue = waData.map(w => ({ id: w.id, number: w.number, message: w.message }));

        // Pagos validados
        const { data: pagosData } = await supabase.from('ff_pagos_recibidos').select('*');
        if (pagosData) pagosData.forEach(p => { pagosValidados[p.ref] = { amount: p.amount, date: p.date, used: p.used }; });

        // Settings
        const { data: settData } = await supabase.from('ff_settings').select('*').eq('id', 1).single();
        if (settData) {
            settings = {
                tasa_del_dia: settData.tasa_del_dia,
                barra_informativa: settData.barra_informativa,
                precios: settData.precios || settings.precios,
                admin: { username: settData.admin_username, password: settData.admin_password },
                metodos_pago: settData.metodos_pago || settings.metodos_pago,
                whatsapp: settData.whatsapp_config || settings.whatsapp
            };
        }

        console.log('[SUPABASE] ✅ Datos cargados:', Object.keys(users).length, 'usuarios,', Object.keys(orders).length, 'pedidos');
    } catch (e) {
        console.error('[SUPABASE] ❌ Error cargando datos:', e.message);
    }
}





function savePagos() {
    supabase.from('ff_pagos_recibidos').upsert(
        Object.entries(pagosValidados).map(([ref, p]) => ({ ref, amount: p.amount, date: p.date, used: p.used }))
    ).then(({ error }) => { if (error) console.error('[SUPABASE] Error guardando pagos:', error.message); });
}

function saveWaQueue() {
    // La cola WA se maneja individualmente al agregar/marcar como enviado
}

function queueWhatsAppMessage(order, isAccepted, pin = null) {
    if (!order.wa || order.wa === 'No provisto') return;
    
    let msg = '';
    if (isAccepted) {
        msg = `🔥 *¡BOOYAH! RECARGA EXITOSA* 🔥\n\n` +
              `¡Hola, *${order.name}*! Tu pedido de diamantes ha sido procesado con éxito. 🚀\n\n` +
              `━━━━━━━━━━━━━━━\n` +
              `👤 *Jugador:* ${order.name}\n` +
              `🆔 *ID Garena:* ${order.uid}\n` +
              `💎 *Paquete:* ${order.pack}\n` +
              `━━━━━━━━━━━━━━━\n\n` +
              `✅ *Estado:* ¡Diamantes Enviados! ✨`;
        if (pin) msg += `\n\n🔑 *Tu Código PIN:* \`${pin}\`\n_(Canjéalo en el juego o nuestra web)_`;
        msg += `\n\n¡Gracias por confiar en *Diamond Center*! 🎯🛡️`;
    } else {
        msg = `⚠️ *AVISO DE TU RECARGA* ⚠️\n\n` +
              `Hola *${order.name}*, no pudimos procesar tu recarga de *${order.pack}*.\n\n` +
              `❌ *Motivo:* Error en la verificación del pago.\n\n` +
              `Envía captura de tu pago a soporte. 🛠️\n🆔 *ID:* ${order.uid}\n\n¡Estamos aquí para ayudarte! 🤝`;
    }

    const waItem = { id: Date.now().toString(), number: order.wa, message: msg };
    whatsappQueue.push(waItem);
    supabase.from('ff_wa_queue').insert(waItem)
        .then(({ error }) => { if (error) console.error('[SUPABASE] Error guardando WA queue:', error.message); });
}

function saveUsers() {
    // No-op: se usa saveUser(uid) para guardar usuario individual
}

async function saveUser(uid) {
    const u = users[uid];
    if (!u) return;
    const { error } = await supabase.from('ff_users').upsert({
        uid, name: u.name, points: u.points, password: u.password || null,
        registered: u.registered, referred_by: u.referred_by || null
    });
    if (error) console.error('[SUPABASE] Error guardando usuario:', error.message);
}

function addPoints(uid, amountUsdt, name = null) {
    if (!users[uid]) {
        users[uid] = { name: name || 'Jugador', points: 0, registered: new Date().toISOString() };
    }
    const pointsToAdd = Math.floor(amountUsdt * 10);
    users[uid].points += pointsToAdd;
    if (name) users[uid].name = name;
    saveUser(uid);
    console.log(`[PUNTOS] Se añadieron ${pointsToAdd} puntos a ID: ${uid}. Total: ${users[uid].points}`);
    return pointsToAdd;
}

function saveRecent(name, pack, type = 'recarga') {
    const entry = { name, pack, type, time: new Date().toLocaleTimeString() };
    recentReloads.unshift(entry);
    if (recentReloads.length > 10) recentReloads.pop();
    supabase.from('ff_recientes').insert(entry)
        .then(({ error }) => { if (error) console.error('[SUPABASE] Error guardando reciente:', error.message); });
}

function updateOrderStatus(ref, status, pin = null) {
    if (orders[ref]) {
        orders[ref].status = status;
        if (pin) orders[ref].pin = pin;
        const update = { status };
        if (pin) update.pin = pin;
        supabase.from('ff_orders').update(update).eq('ref', ref)
            .then(({ error }) => { if (error) console.error('[SUPABASE] Error actualizando pedido:', error.message); });
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

function updateTelegramStatus(ref) {
    const order = orders[ref];
    if (!order || !order.tg_message_id || !order.tg_chat_id) return;

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (!BOT_TOKEN) return;

    let newText = '';
    if (order.status === 'approved') {
        if (order.pin) {
            newText = `🎟️ *RECARGA VÍA PIN (ADMIN)*\n\n👤 *Jugador:* ${order.name}\n🆔 *ID:* ${order.uid}\n🔑 *PIN:* \`${order.pin}\`\n\n✅ _Aprobado desde el panel administrativo._`;
        } else {
            newText = `✅ *RECARGA EXITOSA (ADMIN)*\n\n👤 *Jugador:* ${order.name}\n🆔 *ID:* ${order.uid}\n💎 *Paquete:* ${order.pack}\n\n✨ _Aprobado desde el panel administrativo._`;
        }
    } else if (order.status === 'rejected') {
        newText = `❌ *PEDIDO RECHAZADO (ADMIN)*\n\n👤 *Jugador:* ${order.name}\n🆔 *ID:* ${order.uid}\n\n⚠️ _Rechazado desde el panel administrativo._`;
    } else {
        return; 
    }

    const editPayload = JSON.stringify({
        chat_id: order.tg_chat_id,
        message_id: order.tg_message_id,
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
    });
    editReq.on('error', (e) => console.error('[TG-EDIT] Error:', e.message));
    editReq.write(editPayload);
    editReq.end();
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

    // Si encontramos ambos, procedemos a validar el monto y aprobar
    if (targetFullRef && targetShortRef && orders[targetShortRef] && orders[targetShortRef].status === 'pending') {
        const order = orders[targetShortRef];
        const pago = pagosValidados[targetFullRef];
        
        if (pago && !pago.used) {
            // Extraer precio esperado en Bs: "1.00USDT/635.00Bs" -> 635.00
            let expectedBs = 0;
            try {
                const parts = order.price.split('/');
                if (parts[1]) {
                    expectedBs = parseFloat(parts[1].replace('Bs', '').trim());
                }
            } catch (e) {
                console.error('[AUTO-APPROVE] Error extrayendo precio esperado:', e.message);
            }

            console.log(`[AUTO-APPROVE] Validando monto -> Recibido: ${pago.amount} Bs | Esperado: ${expectedBs} Bs`);

            // Validación de seguridad: El pago debe ser igual o mayor al esperado (con margen de 0.50 Bs)
            if (pago.amount >= (expectedBs - 0.50)) {
                console.log(`[AUTO-APPROVE] ✅ MONTO CORRECTO. Procediendo...`);
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
                updateTelegramStatus(targetShortRef);
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
                    updateTelegramStatus(targetShortRef);
                    console.log(`[AUTO-APPROVE] Recarga exitosa (PIN) para ${order.uid}`);
                } else {
                    console.error(`[AUTO-APPROVE] Error en recarga automática.`);
                }
            }
        });
                return true;
            } else {
                console.log(`[AUTO-APPROVE] ❌ MONTO INSUFICIENTE. El pago de ${pago.amount} Bs es menor a lo esperado (${expectedBs} Bs).`);
                // No marcamos como usado para que el admin pueda decidir qué hacer
                return false;
            }
        }
    }
    return false;
}

// --- LIMPIADOR AUTOMÁTICO DE PEDIDOS (Cada 1 minuto) ---
setInterval(() => {
    const NOW = new Date();
    let changed = false;

    for (let ref in orders) {
        if (orders[ref].status === 'pending') {
            const orderTime = new Date(orders[ref].time);
            const diffMinutes = (NOW - orderTime) / (1000 * 60);

            if (diffMinutes > 5) {
                console.log(`[AUTO-CLEAN] Rechazando pedido ${ref} por inactividad (5+ min).`);
                orders[ref].status = 'rejected';
                changed = true;
            }
        }
    }

    if (changed) {
        try {
            fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders), 'utf8');
        } catch (e) {
            console.error('Error al guardar limpieza:', e);
        }
    }
}, 60000); // Se ejecuta cada 60 segundos
// ------------------------------------------------------

const server = http.createServer(async (req, res) => {
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
        const login_uid = parsedUrl.searchParams.get('login_uid') || uid;
        const name = parsedUrl.searchParams.get('name');
        const pack = parsedUrl.searchParams.get('pack');
        const method = parsedUrl.searchParams.get('method');
        const ref = parsedUrl.searchParams.get('ref');
        const price = parsedUrl.searchParams.get('price') || 'N/A';
        const wa = parsedUrl.searchParams.get('wa') || 'No provisto';

        console.log(`\n[NOTIFICACIÓN] Recibida solicitud de pago de: ${name} (ID: ${uid})`);
        console.log(`[NOTIFICACIÓN] Referencia: ${ref} | Paquete: ${pack} | WA: ${wa}\n`);

        // Guardar pedido como pendiente
        orders[ref] = { uid, login_uid, name, pack, method, price, status: 'pending', time: new Date().toISOString(), wa: wa };
        supabase.from('ff_orders').insert({
            ref, uid, login_uid, name, pack, method, price, status: 'pending', time: new Date().toISOString(), wa
        }).then(({ error }) => { if (error) console.error('[SUPABASE] Error guardando pedido:', error.message); });

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
                try {
                    const result = JSON.parse(body);
                    if (result.ok && result.result) {
                        orders[ref].tg_message_id = result.result.message_id;
                        orders[ref].tg_chat_id = result.result.chat.id;
                        fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders), 'utf8');
                    }
                } catch (e) {
                    console.error('[TG-NOTIF] Error guardando ID de mensaje:', e.message);
                }
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

                            // Sumar puntos al que inició sesión
                            const usdtPrice = parseFloat(order.price.split('USDT')[0]);
                            if (!isNaN(usdtPrice)) {
                                addPoints(order.login_uid || order.uid, usdtPrice, order.name);
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
                                    addPoints(order.login_uid || order.uid, usdtPrice, order.name);
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
            // Responder de inmediato para evitar reintentos de Macrodroid
            res.writeHead(200);
            res.end(JSON.stringify({ success: true }));

            try {
                const data = JSON.parse(body);
                const text = data.text || '';
                
                if (!text) return;

                // Evitar procesar el mismo mensaje en menos de 10 segundos
                if (global.lastProcessedWebhooks && global.lastProcessedWebhooks[text]) {
                    const diff = Date.now() - global.lastProcessedWebhooks[text];
                    if (diff < 10000) {
                        console.log('[DEBUG-WEBHOOK] ⏩ Ignorando duplicado reciente.');
                        return;
                    }
                }
                if (!global.lastProcessedWebhooks) global.lastProcessedWebhooks = {};
                global.lastProcessedWebhooks[text] = Date.now();

                console.log(`[DEBUG-WEBHOOK] Procesando: "${text}"`);
                
                let refMatch = text.match(/(?:Ref|Referencia)\s*:?\s*(\d+)/i);
                let amountMatch = text.match(/Bs\.?\s*([\d,.]+)/i);

                if (refMatch && amountMatch) {
                    const ref = refMatch[1];
                    let amountStr = amountMatch[1].replace(/\./g, '').replace(',', '.');
                    const amount = parseFloat(amountStr);

                    console.log(`[DEBUG-WEBHOOK] ✅ ÉXITO EXTRAYENDO -> Ref: ${ref}, Monto: ${amount}`);

                    if (!pagosValidados[ref]) {
                        pagosValidados[ref] = { amount, time: new Date().toISOString(), used: false };
                        savePagos();
                    }
                    processPendingOrder(ref, null);
                }
            } catch (e) {
                console.error('[DEBUG-WEBHOOK] ❌ Error:', e.message);
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
                const newCodes = data.codes.filter(c => c.length > 0);
                if (newCodes.length === 0) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Sin códigos válidos' })); }
                if (pines[data.amount]) {
                    pines[data.amount] = [...pines[data.amount], ...newCodes];
                    const rows = newCodes.map(code => ({ amount: data.amount, code, used: false }));
                    supabase.from('ff_pines').insert(rows)
                        .then(({ error }) => { if (error) console.error('[SUPABASE] Error guardando pines:', error.message); });
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
    } else if (parsedUrl.pathname === '/admin/stats' && req.method === 'GET') {
        const stats = {
            pending: Object.values(orders).filter(o => o.status === 'pending').length,
            approved: Object.values(orders).filter(o => o.status === 'approved').length,
            rejected: Object.values(orders).filter(o => o.status === 'rejected').length,
            total_users: Object.keys(users).length,
            total_pines: Object.values(pines).reduce((acc, curr) => acc + curr.length, 0)
        };
        res.writeHead(200);
        res.end(JSON.stringify(stats));
    } else if (parsedUrl.pathname === '/admin/pedidos' && req.method === 'GET') {
        res.writeHead(200);
        res.end(JSON.stringify(Object.entries(orders).map(([ref, data]) => ({ ref, ...data }))));
    } else if (parsedUrl.pathname === '/admin/aprobar' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { ref } = JSON.parse(body);
                const order = orders[ref];
                if (order && order.status === 'pending') {
                    const result = await rechargeViaNetfreelat(order, ref);
                    if (result.success) {
                        orders[ref].status = 'approved';
                        fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders), 'utf8');
                        saveRecent(order.name, order.pack);
                        const usdtPrice = parseFloat(order.price.split('USDT')[0]);
                        if (!isNaN(usdtPrice)) addPoints(order.login_uid || order.uid, usdtPrice, order.name);
                        queueWhatsAppMessage(order, true);
                        updateTelegramStatus(ref);
                        res.writeHead(200);
                        res.end(JSON.stringify({ success: true }));
                    } else {
                        const pin = getFallbackPin(order.pack);
                        if (pin) {
                            orders[ref].status = 'approved';
                            orders[ref].pin = pin;
                            fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders), 'utf8');
                            saveRecent(order.name, order.pack);
                            const usdtPrice = parseFloat(order.price.split('USDT')[0]);
                            if (!isNaN(usdtPrice)) addPoints(order.login_uid || order.uid, usdtPrice, order.name);
                            queueWhatsAppMessage(order, true, pin);
                            updateTelegramStatus(ref);
                            res.writeHead(200);
                            res.end(JSON.stringify({ success: true, message: 'Aprobado vía PIN' }));
                        } else {
                            res.writeHead(200);
                            res.end(JSON.stringify({ success: false, message: 'Fallo recarga y no hay pines: ' + result.message }));
                        }
                    }
                } else {
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: 'Pedido no encontrado' }));
                }
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Error' }));
            }
        });
    } else if (parsedUrl.pathname === '/admin/rechazar' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { ref } = JSON.parse(body);
                if (orders[ref]) {
                    orders[ref].status = 'rejected';
                    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders), 'utf8');
                    queueWhatsAppMessage(orders[ref], false);
                    updateTelegramStatus(ref);
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true }));
                }
            } catch (e) { res.writeHead(400); res.end('Error'); }
        });
    } else if (parsedUrl.pathname === '/admin/usuarios' && req.method === 'GET') {
        res.writeHead(200);
        res.end(JSON.stringify(users));
    } else if (parsedUrl.pathname === '/admin/usuarios/update_points' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { uid, points } = JSON.parse(body);
                if (users[uid]) {
                    users[uid].points = parseInt(points);
                    saveUser(uid);
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true }));
                }
            } catch (e) { res.writeHead(400); res.end('Error'); }
        });
    } else if (parsedUrl.pathname === '/admin/usuarios/set_password' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { uid, password } = JSON.parse(body);
                if (users[uid]) {
                    users[uid].password = password || null;
                    saveUser(uid);
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true }));
                } else {
                    res.writeHead(404);
                    res.end(JSON.stringify({ success: false, message: 'Usuario no encontrado' }));
                }
            } catch (e) { res.writeHead(400); res.end('Error'); }
        });
    } else if (parsedUrl.pathname === '/api/check_password') {
        const uid = parsedUrl.searchParams.get('uid');
        const pass = parsedUrl.searchParams.get('pass');
        if (!uid || !users[uid]) {
            res.writeHead(404);
            return res.end(JSON.stringify({ success: false, message: 'Usuario no encontrado' }));
        }
        const user = users[uid];
        const hasPassword = !!user.password;
        if (!hasPassword) {
            // No tiene contraseña, puede entrar libre
            res.writeHead(200);
            return res.end(JSON.stringify({ success: true, hasPassword: false, name: user.name }));
        }
        if (pass && user.password === pass) {
            res.writeHead(200);
            return res.end(JSON.stringify({ success: true, hasPassword: true, name: user.name }));
        }
        // Solo verificar si tiene contraseña (sin pass en la query)
        if (!pass) {
            res.writeHead(200);
            return res.end(JSON.stringify({ success: false, hasPassword: true }));
        }
        res.writeHead(200);
        return res.end(JSON.stringify({ success: false, hasPassword: true, message: 'Contraseña incorrecta' }));
    } else if (parsedUrl.pathname === '/admin/settings' && req.method === 'GET') {
        res.writeHead(200);
        res.end(JSON.stringify(settings));
    } else if (parsedUrl.pathname === '/admin/settings' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const newSettings = JSON.parse(body);
                settings = { ...settings, ...newSettings };
                // Guardar en Supabase
                const dbUpdate = {};
                if (newSettings.tasa_del_dia !== undefined) dbUpdate.tasa_del_dia = newSettings.tasa_del_dia;
                if (newSettings.barra_informativa !== undefined) dbUpdate.barra_informativa = newSettings.barra_informativa;
                if (newSettings.metodos_pago !== undefined) dbUpdate.metodos_pago = newSettings.metodos_pago;
                if (newSettings.whatsapp !== undefined) dbUpdate.whatsapp_config = newSettings.whatsapp;
                if (newSettings.precios !== undefined) dbUpdate.precios = newSettings.precios;
                if (newSettings.admin) {
                    dbUpdate.admin_username = newSettings.admin.username;
                    dbUpdate.admin_password = newSettings.admin.password;
                }
                supabase.from('ff_settings').update(dbUpdate).eq('id', 1)
                    .then(({ error }) => { if (error) console.error('[SUPABASE] Error guardando settings:', error.message); });
                res.writeHead(200);
                res.end(JSON.stringify({ success: true }));
            } catch (e) { res.writeHead(400); res.end('Error'); }
        });
    } else if (parsedUrl.pathname === '/api/config' && req.method === 'GET') {
        const publicConfig = {
            tasa_del_dia: settings.tasa_del_dia,
            barra_informativa: settings.barra_informativa,
            precios: settings.precios,
            metodos_pago: settings.metodos_pago,
            whatsapp: settings.whatsapp
        };
        res.writeHead(200);
        res.end(JSON.stringify(publicConfig));
    } else if (parsedUrl.pathname === '/perfil') {
        const uid = parsedUrl.searchParams.get('uid');
        const ref = parsedUrl.searchParams.get('ref'); // referido por
        if (uid && users[uid]) {
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, user: users[uid], isNew: false }));
        } else if (uid) {
            // Registrar si no existe (con bono de bienvenida)
            users[uid] = { name: 'Jugador', points: 50, registered: new Date().toISOString() };
            saveUsers();
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, user: users[uid], isNew: true }));
        } else {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Falta uid' }));
        }
    } else if (parsedUrl.pathname === '/api/referral' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { referrer_uid, new_uid } = JSON.parse(body);
                // Validar que el nuevo usuario existe y que el referido también
                if (!users[referrer_uid] || !users[new_uid]) {
                    res.writeHead(404);
                    return res.end(JSON.stringify({ success: false, message: 'Usuario no encontrado' }));
                }
                // Evitar auto-referido
                if (referrer_uid === new_uid) {
                    res.writeHead(400);
                    return res.end(JSON.stringify({ success: false, message: 'No puedes referirte a ti mismo' }));
                }
                // Evitar doble referido: marcar al nuevo usuario como ya referido
                if (users[new_uid].referred_by) {
                    res.writeHead(200);
                    return res.end(JSON.stringify({ success: false, message: 'Ya fue referido anteriormente' }));
                }
                // Acreditar 10 puntos al referidor
                users[referrer_uid].points = (users[referrer_uid].points || 0) + 10;
                users[new_uid].referred_by = referrer_uid;
                saveUsers();
                console.log(`[REFERRAL] ${referrer_uid} gana 10 pts por referir a ${new_uid}`);
                res.writeHead(200);
                res.end(JSON.stringify({ success: true, message: '10 puntos acreditados al referidor' }));
            } catch (e) { res.writeHead(400); res.end('Error'); }
        });
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
                console.log(`[WA-STATUS] ${waBotStatus} ${waBotQR ? '(Con QR)' : ''}`);
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

server.listen(PORT, async () => {
    console.log('=========================================');
    console.log('  Diamond Center FF - Servidor');
    console.log(`  Corriendo en: http://localhost:${PORT}`);
    console.log('  Cargando datos desde Supabase...');
    console.log('=========================================');
    await loadFromSupabase();
    console.log('[SERVER] ✅ Listo para recibir solicitudes.');
});
