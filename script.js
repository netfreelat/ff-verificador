document.addEventListener('DOMContentLoaded', () => {
    const verifyBtn = document.getElementById('verify-btn');
    const playerInput = document.getElementById('player-id');

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
            html: 'Consultando servidores...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        try {
            const playerName = await checkPlayerId(uid);

            if (playerName) {
                Swal.close();
                
                // Mostrar sección de paquetes
                document.getElementById('packages-section').style.display = 'block';
                document.querySelector('.main-container').classList.add('expanded');
                
                // Cambiar el diseño del input (deshabilitarlo y mostrar nombre)
                playerInput.disabled = true;
                verifyBtn.innerHTML = `<i class="fa-solid fa-user-check"></i> ${playerName}`;
                verifyBtn.classList.remove('btn-primary');
                verifyBtn.style.background = '#4CAF50';
                verifyBtn.style.cursor = 'default';
                
            } else {
                throw new Error('Jugador no encontrado');
            }
        } catch (error) {
            console.error('Error:', error);
            Swal.fire({ icon: 'error', title: 'Error', text: 'ID no encontrado.', confirmButtonText: 'Reintentar' });
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
            Swal.fire({
                icon: 'info',
                title: 'Resumen del Pedido',
                html: `
                    ID: <b>${playerInput.value}</b><br>
                    Paquete: <b>${selectedPackage.amount} + ${selectedPackage.bonus} Diamantes</b>
                `,
                showCancelButton: true,
                confirmButtonText: 'Ir a Pagar',
                cancelButtonText: 'Cancelar'
            }).then((result) => {
                if (result.isConfirmed) {
                    Swal.fire('¡Redirigiendo!', 'Aquí conectaríamos con la pasarela de pago.', 'success');
                }
            });
        }
    });

    async function checkPlayerId(uid) {
        // URL del servidor en la nube (Render) — funciona para todos los usuarios
        const SERVER_URL = 'https://ff-verificador.onrender.com';
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
});
