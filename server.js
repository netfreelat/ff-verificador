const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3500;

const server = http.createServer((req, res) => {
    // Headers CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

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
            res.end(JSON.stringify({ error: 'Falta el parámetro uid' }));
            return;
        }

        // Endpoint oficial de Netfreelat redeem (igual que usa su página web)
        const apiPath = `/redeem/conexion_api/api.php?action=ValidarParametros&id=${encodeURIComponent(uid)}`;

        console.log(`[${new Date().toLocaleTimeString()}] Verificando ID: ${uid}`);

        const options = {
            hostname: 'www.netfreelat.net',
            path: apiPath,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
                'Referer': 'https://www.netfreelat.net/redeem/',
                'Accept': '*/*',
                'X-Requested-With': 'XMLHttpRequest'
            },
            timeout: 12000
        };

        const apiReq = https.request(options, (apiRes) => {
            let body = '';
            apiRes.setEncoding('utf8');
            apiRes.on('data', chunk => body += chunk);
            apiRes.on('end', () => {
                console.log(`[${new Date().toLocaleTimeString()}] Respuesta raw para ${uid}:`, body);

                try {
                    // Intentar parsear JSON directamente
                    let data;
                    try {
                        data = JSON.parse(body);
                    } catch {
                        // Buscar JSON embebido en la respuesta
                        const jsonMatch = body.match(/\{.*\}/s);
                        if (jsonMatch) {
                            data = JSON.parse(jsonMatch[0]);
                        } else {
                            throw new Error('Sin JSON en respuesta');
                        }
                    }

                    console.log(`[${new Date().toLocaleTimeString()}] Datos parseados:`, data);

                    if (data.alerta === 'green') {
                        const nombre = data.Nickname || data.perfil || data.mensaje;
                        res.writeHead(200);
                        res.end(JSON.stringify({ success: true, nombre: nombre }));
                    } else {
                        const mensaje = data.mensaje || 'ID no encontrado';
                        res.writeHead(200);
                        res.end(JSON.stringify({ success: false, mensaje }));
                    }
                } catch (e) {
                    console.error('Error parseando:', e.message, '| Body:', body);
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: false, error: 'Error al procesar respuesta', raw: body }));
                }
            });
        });

        apiReq.on('error', (e) => {
            console.error('Error de red:', e.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: e.message }));
        });

        apiReq.on('timeout', () => {
            apiReq.destroy();
            res.writeHead(504);
            res.end(JSON.stringify({ error: 'Timeout esperando respuesta de Netfreelat' }));
        });

        apiReq.end();

    } else if (parsedUrl.pathname === '/notificar') {
        const uid = parsedUrl.searchParams.get('uid');
        const name = parsedUrl.searchParams.get('name');
        const pack = parsedUrl.searchParams.get('pack');
        const method = parsedUrl.searchParams.get('method');
        const ref = parsedUrl.searchParams.get('ref');
        const price = parsedUrl.searchParams.get('price') || 'N/A';

        // --- CONFIGURACIÓN DE TELEGRAM ---
        const BOT_TOKEN = '8289162386:AAHLCDRF1OVerD95szOdWCDfQViH4CT_FGY'; 
        const CHAT_ID = '908668962';     
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
-------------------------------
⏰ _Verifica el pago y recarga pronto._
        `;

        const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage?chat_id=${CHAT_ID}&text=${encodeURIComponent(message)}&parse_mode=Markdown`;

        https.get(telegramUrl, (apiRes) => {
            let body = '';
            apiRes.on('data', chunk => body += chunk);
            apiRes.on('end', () => {
                res.writeHead(200);
                res.end(JSON.stringify({ success: true, info: 'Notificación enviada' }));
            });
        }).on('error', (e) => {
            console.error('Error enviando a Telegram:', e.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Error al enviar notificación' }));
        });

    } else if (parsedUrl.pathname === '/health') {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok' }));
    } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Ruta no encontrada. Usa /verificar?uid=TU_ID' }));
    }
});

server.listen(PORT, () => {
    console.log('=========================================');
    console.log('  Servidor de Verificación Free Fire');
    console.log(`  Corriendo en: http://localhost:${PORT}`);
    console.log(`  Prueba: http://localhost:${PORT}/verificar?uid=9583620455`);
    console.log('=========================================');
});
