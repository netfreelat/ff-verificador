document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURACIÓN DE PRECIOS ---
    const DOLAR_RATE = 635.00; // CAMBIA ESTE NÚMERO PARA ACTUALIZAR PRECIOS EN BS
    // --------------------------------
    
    // Detectar si estamos en local, en el túnel o en la nube
    const hostname = window.location.hostname;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || !hostname;
    const isTunnel = hostname.includes('loca.lt');
    
    const SERVER_URL = isLocal ? 'http://localhost:3500' : window.location.origin;

    const playerInput = document.getElementById('player-id');
    const verifyBtn = document.getElementById('verify-btn');
    const loadLastIdBtn = document.getElementById('load-last-id');
    const historyBtn = document.getElementById('history-btn');
    const favoritesBtn = document.getElementById('favorites-btn');
    const addFavoriteBtn = document.getElementById('add-favorite-btn');
    const changeIdBtn = document.getElementById('change-id-btn');
    const resetUiBtn = document.getElementById('reset-ui-btn');

    // Manejar Último ID usado
    const lastId = localStorage.getItem('ff_last_id');
    if (lastId) {
        loadLastIdBtn.style.display = 'block';
        loadLastIdBtn.addEventListener('click', () => {
            playerInput.value = lastId;
        });
    }

    // Manejar Botón de Historial
    historyBtn.addEventListener('click', () => {
        const myOrders = JSON.parse(localStorage.getItem('ff_my_orders') || '[]');
        if (myOrders.length === 0) {
            Swal.fire({
                icon: 'info',
                title: 'Sin Historial',
                text: 'Aún no has realizado ninguna compra en este navegador.',
                background: 'rgba(20, 10, 35, 0.95)',
                color: '#fff',
                confirmButtonColor: '#9D00FF'
            });
            return;
        }

        let historyHtml = '<div class="history-list" style="max-height: 300px; overflow-y: auto; padding-right: 10px;">';
        [...myOrders].reverse().forEach(order => {
            const statusClass = order.status === 'approved' ? 'status-approved' : (order.status === 'rejected' ? 'status-rejected' : 'status-pending');
            const statusText = order.status === 'approved' ? 'APROBADO' : (order.status === 'rejected' ? 'RECHAZADO' : 'PENDIENTE');
            historyHtml += `
                <div class="history-item" style="border-bottom: 1px solid rgba(255,255,255,0.1); padding: 12px 0; text-align: left;">
                    <p style="margin: 0; font-size: 0.75rem; color: #aaa;">${order.date}</p>
                    <p style="margin: 5px 0; font-weight: 700; font-size: 0.9rem;">💎 ${order.pack} diamantes</p>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 0.8rem;">Ref: <code style="color: var(--secondary);">${order.ref}</code></span>
                        <span class="${statusClass}" style="font-size: 0.75rem; font-weight: 800;">${statusText}</span>
                    </div>
                </div>
            `;
        });
        historyHtml += '</div>';

        Swal.fire({
            title: '<i class="fa-solid fa-receipt"></i> Mis Compras',
            html: historyHtml,
            background: 'rgba(20, 10, 35, 0.98)',
            color: '#fff',
            confirmButtonText: 'Cerrar',
            confirmButtonColor: '#9D00FF',
            width: '400px'
        });
    });

    // --- LÓGICA DE CUENTA ---
    const loginTriggerBtn = document.getElementById('login-trigger-btn');
    const userDisplay = document.getElementById('user-display');
    const headerPointsVal = document.getElementById('header-points-val');
    const logoutBtn = document.getElementById('logout-btn');

    const updateAccountUI = (id) => {
        if (id) {
            loginTriggerBtn.style.display = 'none';
            userDisplay.style.display = 'flex';
            loadUserPoints(id).then(points => {
                headerPointsVal.innerText = points || 0;
            });
        } else {
            loginTriggerBtn.style.display = 'flex';
            userDisplay.style.display = 'none';
        }
    };

    // Auto-login al cargar
    const savedId = localStorage.getItem('ff_user_id');
    if (savedId) updateAccountUI(savedId);

    loginTriggerBtn.addEventListener('click', async () => {
        const { value: id } = await Swal.fire({
            title: 'Ingresar a mi Cuenta',
            input: 'text',
            inputLabel: 'Ingresa tu ID de Free Fire',
            inputPlaceholder: 'Ej: 12345678',
            showCancelButton: true,
            confirmButtonText: 'Entrar',
            cancelButtonText: 'Cancelar',
            background: 'rgba(20, 10, 35, 0.98)',
            color: '#fff',
            inputAttributes: {
                autocapitalize: 'off',
                autocorrect: 'off'
            }
        });

        if (id) {
            Swal.fire({
                title: 'Verificando...',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });

            const name = await checkPlayerId(id);
            if (name) {
                localStorage.setItem('ff_user_id', id);
                updateAccountUI(id);
                Swal.fire({
                    icon: 'success',
                    title: `¡Bienvenido, ${name}!`,
                    text: 'Ya puedes acumular puntos con tus recargas.',
                    timer: 2000,
                    showConfirmButton: false
                });
                playerInput.value = id;
            } else {
                Swal.fire({
                    icon: 'error',
                    title: 'ID no encontrado',
                    text: 'Asegúrate de que el ID sea correcto.'
                });
            }
        }
    });

    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('ff_user_id');
        updateAccountUI(null);
        location.reload();
    });
    // --- FIN LÓGICA DE CUENTA ---

    favoritesBtn.addEventListener('click', () => {
        const favorites = JSON.parse(localStorage.getItem('ff_favorites') || '[]');
        if (favorites.length === 0) {
            Swal.fire({
                icon: 'info',
                title: 'Favoritos Vacíos',
                text: 'No tienes IDs guardados. Verifica un ID y toca la estrella para guardarlo.',
                background: 'rgba(20, 10, 35, 0.95)',
                color: '#fff',
                confirmButtonColor: '#9D00FF'
            });
            return;
        }

        let favHtml = '<div class="fav-list" style="max-height: 300px; overflow-y: auto;">';
        favorites.forEach((fav, index) => {
            favHtml += `
                <div class="fav-item" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding: 12px 0;">
                    <div style="cursor: pointer; flex: 1;" onclick="window.loadFavorite('${fav.id}')">
                        <p style="margin: 0; font-weight: 700; color: #fff; text-align: left;">${fav.name}</p>
                        <p style="margin: 0; font-size: 0.8rem; color: var(--secondary); text-align: left;">${fav.id}</p>
                    </div>
                    <button onclick="window.removeFavorite(${index})" style="background:transparent; border:none; color:#ff4b2b; cursor:pointer; padding: 5px 10px;">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            `;
        });
        favHtml += '</div>';

        Swal.fire({
            title: '<i class="fa-solid fa-star" style="color: #ffd700;"></i> Mis Favoritos',
            html: favHtml,
            background: 'rgba(20, 10, 35, 0.98)',
            color: '#fff',
            showConfirmButton: false,
            showCloseButton: true,
            width: '400px'
        });
    });

    window.loadFavorite = (id) => {
        Swal.close();
        playerInput.value = id;
        verifyBtn.click(); // Esto llevará directo a recargas
    };

    window.removeFavorite = (index) => {
        const favorites = JSON.parse(localStorage.getItem('ff_favorites') || '[]');
        favorites.splice(index, 1);
        localStorage.setItem('ff_favorites', JSON.stringify(favorites));
        favoritesBtn.click(); // Recargar modal
    };

    addFavoriteBtn.addEventListener('click', () => {
        const currentName = document.getElementById('player-name-display').innerText;
        const currentId = playerInput.value;
        const favorites = JSON.parse(localStorage.getItem('ff_favorites') || '[]');
        
        if (favorites.some(f => f.id === currentId)) {
            Swal.fire({ icon: 'info', title: 'Ya existe', text: 'Este ID ya está en tus favoritos.', timer: 2000, showConfirmButton: false });
            return;
        }

        favorites.push({ id: currentId, name: currentName });
        localStorage.setItem('ff_favorites', JSON.stringify(favorites));
        
        addFavoriteBtn.innerHTML = '<i class="fa-solid fa-star"></i>'; // Cambiar a estrella llena
        Swal.fire({ icon: 'success', title: 'Guardado', text: 'ID añadido a favoritos.', timer: 1500, showConfirmButton: false });
    });

    // Inicializar Precios
    const updatePrices = () => {
        const rateDisplay = document.getElementById('current-rate');
        if (rateDisplay) rateDisplay.innerText = DOLAR_RATE.toFixed(2);
        document.querySelectorAll('.package-card').forEach(card => {
            const usdt = parseFloat(card.dataset.price);
            const bs = (usdt * DOLAR_RATE).toFixed(2);
            const priceBsEl = card.querySelector('.price-bs');
            if (priceBsEl) priceBsEl.innerText = `${bs} Bs`;
        });
    };
    updatePrices();

    // Cargar últimas recargas aprobadas en la marquesina
    const loadRecentReloads = async () => {
        try {
            const res = await fetch(`${SERVER_URL}/recientes`);
            const data = await res.json();
            const marquee = document.getElementById('marquee-content');
            
            if (data && data.length > 0) {
                const text = data.map(r => `✅ ${r.name} recargó ${r.pack} diamantes`).join(' | ');
                marquee.innerText = ` ÚLTIMAS RECARGAS: ${text} | ¡Únete a los miles de jugadores que confían en nosotros! `;
            } else {
                marquee.innerText = " ¡BIENVENIDOS A RECARGAS FREE FIRE! – Verifica tu ID y selecciona tu paquete de diamantes preferido. ";
            }
        } catch (e) {
            console.error('Error cargando recientes:', e);
        }
    };
    loadRecentReloads();
    setInterval(loadRecentReloads, 30000); // Actualizar cada 30 segundos

    // Permitir verificar presionando Enter
    playerInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') verifyBtn.click();
    });

    verifyBtn.addEventListener('click', async () => {
        const uid = playerInput.value.trim();

        if (!uid) {
            Swal.fire({ icon: 'warning', title: 'Campo Vacío', text: 'Ingresa un ID.', confirmButtonText: 'OK' });
            return;
        }

        Swal.fire({
            title: 'Validando ID...',
            html: `
                <div class="ff-loader-container">
                    <div class="ff-loader-text">Conectando con servidores de Garena...</div>
                    <div class="ff-progress-bar">
                        <div class="ff-progress-fill"></div>
                    </div>
                </div>
            `,
            allowOutsideClick: false,
            showConfirmButton: false,
            background: 'rgba(20, 10, 35, 0.95)',
            color: '#fff'
        });

        try {
            const playerName = await checkPlayerId(uid);

            if (playerName) {
                Swal.close();
                
                // Guardar como último ID usado
                localStorage.setItem('ff_last_id', uid);
                loadLastIdBtn.style.display = 'block';

                // Mostrar sección de paquetes
                document.getElementById('packages-section').style.display = 'block';
                document.querySelector('.main-container').classList.add('expanded');
                
                // Ocultar input y boton, mostrar bienvenida
                document.querySelector('.input-group').style.display = 'none';
                verifyBtn.style.display = 'none';
                
                const welcomeSection = document.getElementById('welcome-section');
                document.getElementById('player-name-display').innerText = playerName;
                // Auto-login si no estaba logueado
            localStorage.setItem('ff_user_id', playerInput.value);
            updateAccountUI(playerInput.value);

            welcomeSection.style.display = 'block';

                // Cargar puntos del usuario
                loadUserPoints(uid);
                
            } else {
                throw new Error('Jugador no encontrado');
            }
        } catch (error) {
            console.error('Error:', error);
            Swal.fire({ 
                icon: 'error', 
                title: 'ERROR', 
                text: 'ID NO ENCONTRADO EN GARENA. FAVOR CHEQUEAR SU ID, GRACIAS.', 
                confirmButtonText: 'Reintentar',
                background: 'rgba(20, 10, 35, 0.95)',
                color: '#fff'
            });
        }
    });

    // Lógica de selección de paquetes
    const packageCards = document.querySelectorAll('.package-card');
    const buyBtn = document.getElementById('buy-btn');
    let selectedPackage = null;

    packageCards.forEach(card => {
        card.addEventListener('click', () => {
            // Quitar selección previa
            packageCards.forEach(c => c.classList.remove('selected'));
            
            // Seleccionar actual
            card.classList.add('selected');
            selectedPackage = {
                amount: card.dataset.amount,
                bonus: card.dataset.bonus
            };
            
            // Habilitar botón de compra
            buyBtn.disabled = false;
        });
    });

    buyBtn.addEventListener('click', () => {
        if (selectedPackage) {
            // Ocultar paquetes y mostrar pagos
            document.getElementById('packages-section').style.display = 'none';
            document.getElementById('payment-section').style.display = 'block';
        }
    });

    // Lógica de Métodos de Pago
    const paymentCards = document.querySelectorAll('.payment-method-card');
    const finishBtn = document.getElementById('finish-btn');
    const backBtn = document.getElementById('back-btn');
    let selectedMethod = null;

    paymentCards.forEach(card => {
        card.addEventListener('click', () => {
            paymentCards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            selectedMethod = card.dataset.method;

            // Mostrar detalles correspondientes
            document.getElementById('details-pagomovil').style.display = selectedMethod === 'pagomovil' ? 'block' : 'none';
            document.getElementById('details-binance').style.display = selectedMethod === 'binance' ? 'block' : 'none';
            
            // Llenar montos automáticamente
            const priceUSDT = parseFloat(document.querySelector('.package-card.selected').dataset.price);
            const priceBS = (priceUSDT * DOLAR_RATE).toFixed(2);
            
            if(selectedMethod === 'pagomovil') {
                document.getElementById('amount-pagomovil').value = `${priceBS} Bs`;
            } else {
                document.getElementById('amount-binance').value = `${priceUSDT} USDT`;
            }

            checkFinishButton();
        });
    });

    const refPagoMovil = document.getElementById('ref-pagomovil');
    const refBinance = document.getElementById('ref-binance');

    [refPagoMovil, refBinance].forEach(input => {
        input.addEventListener('input', checkFinishButton);
    });

    function checkFinishButton() {
        const valPago = refPagoMovil.value.trim();
        const valBinance = refBinance.value.trim();
        
        console.log(`[DEBUG] Método: ${selectedMethod} | Ref PagoM: ${valPago} | Ref Binance: ${valBinance}`);

        if (selectedMethod === 'pagomovil' && valPago.length >= 4) {
            finishBtn.disabled = false;
        } else if (selectedMethod === 'binance' && valBinance.length >= 1) {
            finishBtn.disabled = false;
        } else {
            finishBtn.disabled = true;
        }
        
        console.log(`[DEBUG] Botón Confirmar: ${finishBtn.disabled ? 'DESACTIVADO' : 'ACTIVADO'}`);
    }

    backBtn.addEventListener('click', () => {
        document.getElementById('payment-section').style.display = 'none';
        document.getElementById('packages-section').style.display = 'block';
    });

    finishBtn.addEventListener('click', async () => {
        const ref = selectedMethod === 'pagomovil' ? refPagoMovil.value : refBinance.value;
        const name = document.getElementById('player-name-display').innerText.trim();
        const packText = `${selectedPackage.amount} + ${selectedPackage.bonus}`;
        const priceUSDT = parseFloat(document.querySelector('.package-card.selected').dataset.price);
        const priceBS = (priceUSDT * DOLAR_RATE).toFixed(2);

        Swal.fire({
            title: 'Procesando pago...',
            html: `
                <div class="ff-loader-container">
                    <div class="ff-loader-text">Notificando a la tienda...</div>
                    <div class="ff-progress-bar">
                        <div class="ff-progress-fill"></div>
                    </div>
                </div>
            `,
            allowOutsideClick: false,
            showConfirmButton: false,
            background: 'rgba(20, 10, 35, 0.95)',
            color: '#fff'
        });

        try {
            const messageParams = `uid=${playerInput.value}&name=${encodeURIComponent(name)}&pack=${encodeURIComponent(packText)}&method=${selectedMethod}&ref=${encodeURIComponent(ref)}&price=${priceUSDT}USDT/${priceBS}Bs`;
            const notifyUrl = `${SERVER_URL}/notificar?${messageParams}`;
            
            const notifyRes = await fetch(notifyUrl);
            if (!notifyRes.ok) throw new Error('Error al notificar');

            // Guardar en historial local
            const myOrders = JSON.parse(localStorage.getItem('ff_my_orders') || '[]');
            const newOrder = {
                ref: ref,
                pack: selectedPackage.amount,
                date: new Date().toLocaleString(),
                status: 'pending'
            };
            myOrders.push(newOrder);
            localStorage.setItem('ff_my_orders', JSON.stringify(myOrders));

            const approvalNum = Math.floor(Math.random() * 90000) + 10000;
            const now = new Date();
            const dateStr = now.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
            const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
            const fullDateTime = `${dateStr} ${timeStr}`;

            Swal.fire({
                html: `
                    <div class="receipt-container">
                        <div class="receipt-success-icon"><i class="fa-solid fa-check"></i></div>
                        <h2 class="receipt-title">¡Operación exitosa!</h2>
                        
                        <div class="receipt-card">
                            <div class="receipt-logo">FREE F<span>I</span>RE</div>
                            
                            <div class="receipt-info">
                                <p><strong>Plan:</strong> <span class="val">${selectedPackage.amount} diamantes</span></p>
                                <p><strong>Bonus:</strong> <span class="val">${selectedPackage.bonus} diamantes</span></p>
                                <p><strong>ID jugador:</strong> <span class="val">${playerInput.value}</span></p>
                                <p><strong>Jugador:</strong> <span class="val">${name}</span></p>
                                <p><strong>N° Aprobación:</strong> <span class="val">${approvalNum}</span></p>
                                <p><strong>Fecha:</strong> <span class="val">${fullDateTime}</span></p>
                                <p><strong>Estado:</strong> <span class="val status-pending" id="order-status">EN VERIFICACIÓN... ESPERE</span></p>
                                <div id="pin-display-container" style="display: none; margin-top: 15px; padding: 15px; background: rgba(0, 240, 255, 0.1); border: 1px dashed var(--secondary); border-radius: 10px;">
                                    <p style="margin: 0; font-size: 0.8rem; color: var(--secondary); font-weight: 700;">🔑 TU PIN DE DIAMANTES:</p>
                                    <p id="assigned-pin" style="margin: 5px 0 0 0; font-size: 1.5rem; font-family: monospace; letter-spacing: 2px; color: #fff; font-weight: 800;"></p>
                                    <button onclick="copyPin()" style="margin-top: 10px; background: transparent; border: 1px solid var(--secondary); color: var(--secondary); padding: 5px 10px; border-radius: 5px; cursor: pointer; font-size: 0.7rem;"><i class="fa-solid fa-copy"></i> Copiar PIN</button>
                                </div>
                            </div>
                            
                            <div class="receipt-ticket">
                                <i class="fa-solid fa-ticket"></i> Ticket comprobante de pago.
                            </div>
                        </div>
                        
                        <div class="receipt-actions">
                            <button class="btn-action btn-share" title="Compartir"><i class="fa-solid fa-share-nodes"></i></button>
                            <button class="btn-action btn-fav" title="Favorito"><i class="fa-solid fa-star"></i></button>
                            <button class="btn-action btn-continue-receipt" onclick="location.reload()">Continuar</button>
                        </div>
                    </div>
                `,
                showConfirmButton: false,
                background: 'transparent',
                width: window.innerWidth < 600 ? '95%' : '450px',
                allowOutsideClick: false,
                didOpen: () => {
                    const shareBtn = document.querySelector('.btn-share');
                    const favBtn = document.querySelector('.btn-fav');
                    const statusEl = document.getElementById('order-status');
                    const successIcon = document.querySelector('.receipt-success-icon');
                    
                    // Polling para el estado del pedido
                    const checkStatus = async () => {
                        try {
                            const res = await fetch(`${SERVER_URL}/status?ref=${ref}`);
                            const data = await res.json();
                            
                            if (data.status === 'approved' || data.status === 'rejected') {
                                // Actualizar localStorage
                                const myOrders = JSON.parse(localStorage.getItem('ff_my_orders') || '[]');
                                const orderIdx = myOrders.findIndex(o => o.ref === ref);
                                if (orderIdx !== -1) {
                                    myOrders[orderIdx].status = data.status;
                                    localStorage.setItem('ff_my_orders', JSON.stringify(myOrders));
                                }

                                if (data.status === 'approved') {
                                    statusEl.innerText = '✅ APROBADO';
                                    statusEl.className = 'val status-approved';
                                    successIcon.style.color = '#25D366';
                                    successIcon.style.borderColor = '#25D366';
                                    
                                    // Lanzar confeti de celebración
                                    confetti({
                                        particleCount: 150,
                                        spread: 70,
                                        origin: { y: 0.6 },
                                        colors: ['#ffd700', '#00c853', '#ffffff']
                                    });

                                    // Mostrar PIN si existe
                                    if (data.pin) {
                                        const pinContainer = document.getElementById('pin-display-container');
                                        const pinEl = document.getElementById('assigned-pin');
                                        pinEl.innerText = data.pin;
                                        pinContainer.style.display = 'block';
                                    }

                                    // Mostrar modal de éxito emocionante
                                    setTimeout(() => {
                                        Swal.fire({
                                            title: '<span style="color: #00c853; font-size: 2.2rem; font-weight: 900; text-shadow: 0 0 20px rgba(0,200,83,0.4);">¡RECIBIDO!</span>',
                                            html: `
                                                <div style="padding: 10px;">
                                                    <div style="font-size: 4rem; margin-bottom: 20px; animation: bounce 1s infinite;">💎✨</div>
                                                    <p style="font-size: 1.4rem; font-weight: 700; color: #fff; margin-bottom: 10px;">¡Tu recarga ha sido aprobada!</p>
                                                    <p style="color: #aaa; margin-bottom: 25px; font-size: 1.1rem;">Los diamantes ya están en camino a tu cuenta de <strong>Free Fire</strong>.</p>
                                                    <div style="background: linear-gradient(135deg, rgba(0,200,83,0.2) 0%, rgba(0,100,40,0.4) 100%); border: 2px solid #00c853; padding: 20px; border-radius: 15px; box-shadow: 0 0 30px rgba(0,200,83,0.2);">
                                                        <span style="display: block; font-size: 0.9rem; color: #fff; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 5px;">Estado Final</span>
                                                        <span style="font-size: 1.8rem; font-weight: 900; color: #00c853; text-shadow: 0 0 10px rgba(0,200,83,0.5);">✅ APROBADO</span>
                                                    </div>
                                                    <p style="margin-top: 20px; color: #ffd700; font-weight: 700;">¡Gracias por confiar en nosotros!</p>
                                                </div>
                                            `,
                                            background: 'rgba(15, 5, 25, 0.98)',
                                            color: '#fff',
                                            confirmButtonText: '¡EXCELENTE! 🎮',
                                            confirmButtonColor: '#00c853',
                                            backdrop: `rgba(0,0,0,0.8)`,
                                            allowOutsideClick: false
                                        });
                                    }, 500);
                                } else {
                                    statusEl.innerText = '❌ RECHAZADO: VERIFIQUE MONTO Y REFERENCIA';
                                    statusEl.className = 'val status-rejected';
                                    successIcon.innerHTML = '<i class="fa-solid fa-xmark"></i>';
                                    successIcon.style.color = '#ff4b2b';
                                    successIcon.style.borderColor = '#ff4b2b';
                                }
                                clearInterval(statusInterval);
                            }
                        } catch (e) {
                            console.error('Error verificando estado:', e);
                        }
                    };

                    const statusInterval = setInterval(checkStatus, 3000);
                    
                    shareBtn.addEventListener('click', () => {
                        const statusText = statusEl.innerText;
                        const shareText = `💎 *COMPROBANTE DE RECARGA - FREE FIRE* 💎\n` +
                                         `------------------------------------------\n` +
                                         `👤 *Jugador:* ${name}\n` +
                                         `🆔 *ID:* ${playerInput.value}\n` +
                                         `📦 *Plan:* ${selectedPackage.amount} diamantes\n` +
                                         `✨ *Bonus:* ${selectedPackage.bonus} diamantes\n` +
                                         `🔢 *Ref:* ${approvalNum}\n` +
                                         `📅 *Fecha:* ${fullDateTime}\n` +
                                         `✅ *Estado:* ${statusText}\n` +
                                         `------------------------------------------\n` +
                                         `¡Gracias por tu compra! 🎮`;

                        if (navigator.share) {
                            navigator.share({
                                title: 'Comprobante de Recarga',
                                text: shareText
                            }).catch(err => console.log('Error sharing:', err));
                        } else {
                            // Fallback a WhatsApp Web/App si no hay Web Share API
                            const encodedText = encodeURIComponent(shareText);
                            window.open(`https://wa.me/?text=${encodedText}`, '_blank');
                        }
                    });

                    favBtn.addEventListener('click', () => {
                        favBtn.style.color = favBtn.style.color === 'yellow' ? 'white' : 'yellow';
                        const Toast = Swal.mixin({
                            toast: true,
                            position: 'top-end',
                            showConfirmButton: false,
                            timer: 2000,
                            timerProgressBar: true
                        });
                        Toast.fire({ icon: 'success', title: 'Agregado a favoritos' });
                    });
                }
            });
        } catch (error) {
            console.error('Error enviando notificación:', error);
            Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo enviar la notificación, pero tu pago fue registrado.' });
        }
    });

    async function checkPlayerId(uid) {
        const localServerUrl = `${SERVER_URL}/verificar?uid=${uid}`;

        try {
            console.log('Consultando servidor local...');
            const response = await fetch(localServerUrl, { signal: AbortSignal.timeout(15000) });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            console.log('Respuesta del servidor:', data);

            if (data.success && data.nombre) {
                return data.nombre;
            }

            return null;
        } catch (e) {
            console.error('Error al consultar servidor local:', e);
            return null;
        }
    }
    
    window.copyData = function(method) {
        let textToCopy = '';
        if (method === 'pagomovil') {
            const amount = document.getElementById('amount-pagomovil').value.replace(' Bs', '').trim();
            textToCopy = `0174 04243790757 17716286 ${amount}`;
        } else if (method === 'binance') {
            const amount = document.getElementById('amount-binance').value.replace(' USDT', '').trim();
            textToCopy = `198080894 ${amount}`;
        }
        
        navigator.clipboard.writeText(textToCopy).then(() => {
            Swal.fire({
                icon: 'success',
                title: '¡Copiado!',
                text: 'Datos copiados al portapapeles.',
                timer: 1500,
                showConfirmButton: false,
                background: 'rgba(20, 10, 35, 0.95)',
                color: '#fff'
            });
        }).catch(err => {
            console.error('Error al copiar: ', err);
        });
    };

    window.copyPin = () => {
        const pinText = document.getElementById('assigned-pin').innerText;
        navigator.clipboard.writeText(pinText).then(() => {
            Swal.fire({
                icon: 'success',
                title: 'PIN Copiado',
                text: 'Ya puedes canjear tus diamantes.',
                timer: 1500,
                showConfirmButton: false,
                background: 'rgba(20, 10, 35, 0.95)',
                color: '#fff'
            });
        });
    };
    async function loadUserPoints(uid) {
        try {
            const res = await fetch(`${SERVER_URL}/perfil?uid=${uid}`);
            const data = await res.json();
            const points = (data.success && data.user) ? (data.user.points || 0) : 0;
            
            const pointsEl = document.getElementById('user-points');
            const headerPointsEl = document.getElementById('header-points-val');
            
            if (pointsEl) pointsEl.innerText = points;
            if (headerPointsEl) headerPointsEl.innerText = points;
            
            return points;
        } catch (e) {
            console.error('Error cargando puntos:', e);
            return 0;
        }
    }

    document.getElementById('redeem-btn').addEventListener('click', () => {
        const uid = playerInput.value;
        const currentPoints = parseInt(document.getElementById('user-points').innerText);

        Swal.fire({
            title: 'Canjear Puntos',
            html: `
                <p style="font-size: 0.9rem; color: #aaa; margin-bottom: 20px;">Tienes <strong>${currentPoints}</strong> puntos.</p>
                <div class="redeem-options" style="display: grid; gap: 10px;">
                    <button class="swal2-confirm swal2-styled" onclick="window.redeem('100')">100 Diamantes (500 pts)</button>
                    <button class="swal2-confirm swal2-styled" onclick="window.redeem('310')">310 Diamantes (1500 pts)</button>
                    <button class="swal2-confirm swal2-styled" onclick="window.redeem('520')">520 Diamantes (2500 pts)</button>
                </div>
            `,
            showConfirmButton: false,
            showCloseButton: true,
            background: 'rgba(20, 10, 35, 0.98)',
            color: '#fff'
        });
    });

    window.redeem = async (pack) => {
        const uid = playerInput.value;
        Swal.fire({ title: 'Procesando canje...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        try {
            const res = await fetch(`${SERVER_URL}/canjear`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid, pack })
            });
            const data = await res.json();

            if (data.success) {
                Swal.fire({
                    icon: 'success',
                    title: '¡Canje Exitoso!',
                    html: `Tu PIN es: <code style="font-size: 1.2rem; color: var(--secondary);">${data.pin}</code>`,
                    confirmButtonText: 'Copiar PIN y Cerrar'
                }).then(() => {
                    navigator.clipboard.writeText(data.pin);
                    loadUserPoints(uid);
                });
            } else {
                Swal.fire({ icon: 'error', title: 'Fallo en Canje', text: data.message });
            }
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo procesar el canje.' });
        }
    };

    function resetUI() {
        // Mostrar input y botón inicial
        document.querySelector('.input-group').style.display = 'flex';
        document.getElementById('player-id').value = '';
        verifyBtn.style.display = 'flex';

        // Ocultar secciones secundarias
        document.getElementById('welcome-section').style.display = 'none';
        document.getElementById('packages-section').style.display = 'none';
        document.getElementById('payment-section').style.display = 'none';
        document.querySelector('.main-container').classList.remove('expanded');
        
        // Resetear selección de paquetes
        selectedPackage = null;
        document.querySelectorAll('.package-card').forEach(c => c.classList.remove('selected'));
        buyBtn.disabled = true;
    }

    if (changeIdBtn) changeIdBtn.addEventListener('click', resetUI);
    if (resetUiBtn) resetUiBtn.addEventListener('click', resetUI);
});
