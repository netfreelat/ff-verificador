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
            Swal.fire({
                icon: 'warning',
                title: 'Campo Vacío',
                text: 'Por favor, ingresa un ID válido.',
                confirmButtonText: 'Entendido'
            });
            return;
        }

        Swal.fire({
            title: 'Validando ID...',
            html: 'Consultando servidores de Free Fire...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        try {
            const playerName = await checkPlayerId(uid);

            if (playerName) {
                Swal.fire({
                    icon: 'success',
                    title: '¡Jugador Encontrado!',
                    html: `
                        <p style="color:#B0B0B0; margin-bottom:10px;">Nombre del Jugador:</p>
                        <strong style="font-size: 1.8rem; color: #FF5A5F;">${playerName}</strong>
                        <p style="color:#B0B0B0; margin-top:12px; font-size:0.85rem;">ID: ${uid}</p>
                    `,
                    confirmButtonText: '✔ Confirmar',
                    background: '#121217',
                    color: '#fff'
                });
            } else {
                throw new Error('Jugador no encontrado');
            }
        } catch (error) {
            console.error('Error:', error);
            Swal.fire({
                icon: 'error',
                title: 'ID No Encontrado',
                text: 'No se encontró ningún jugador con ese ID. Verifica que sea correcto.',
                confirmButtonText: 'Reintentar',
                background: '#121217',
                color: '#fff'
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
