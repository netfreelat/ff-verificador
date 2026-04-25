document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURACIÓN DE PRECIOS ---
    const DOLAR_RATE = 635.00; // CAMBIA ESTE NÚMERO PARA ACTUALIZAR PRECIOS EN BS
    // --------------------------------
    
    // Detectar si estamos en local o en la nube
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || !window.location.hostname;
    const SERVER_URL = isLocal ? 'http://localhost:3500' : 'https://ff-verificador.onrender.com';

    const verifyBtn = document.getElementById('verify-btn');
    const playerInput = document.getElementById('player-id');

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
                
                // Mostrar sección de paquetes
                document.getElementById('packages-section').style.display = 'block';
                document.querySelector('.main-container').classList.add('expanded');
                
                // Ocultar input y boton, mostrar bienvenida
                document.querySelector('.input-group').style.display = 'none';
                verifyBtn.style.display = 'none';
                
                const welcomeSection = document.getElementById('welcome-section');
                document.getElementById('player-name-display').innerText = playerName;
                welcomeSection.style.display = 'block';
                
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
        if (selectedMethod === 'pagomovil' && refPagoMovil.value.trim().length >= 4) {
            finishBtn.disabled = false;
        } else if (selectedMethod === 'binance' && refBinance.value.trim().length >= 5) {
            finishBtn.disabled = false;
        } else {
            finishBtn.disabled = true;
        }
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
            const notifyUrl = `${SERVER_URL}/notificar?${messageParams}`;
            
            const notifyRes = await fetch(notifyUrl);
            if (!notifyRes.ok) throw new Error('Error al notificar');

            Swal.fire({
                icon: 'success',
                title: '¡Pedido Recibido!',
                html: `
                    <p>Tu pago está siendo verificado.</p>
                    <div style="text-align: left; background: rgba(0,0,0,0.1); padding: 15px; border-radius: 10px; margin-top: 15px;">
                        <p><strong>ID:</strong> ${playerInput.value}</p>
                        <p><strong>Paquete:</strong> ${packText} diamantes</p>
                        <p><strong>Total:</strong> ${priceUSDT} USDT (${priceBS} Bs)</p>
                        <p><strong>Referencia:</strong> ${ref}</p>
                    </div>
                    <p style="margin-top: 15px; font-size: 0.9rem; color: #888;">Recibirás tus diamantes en máximo 15 minutos.</p>
                `,
                confirmButtonText: 'Finalizar'
            }).then(() => {
                location.reload();
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
});
