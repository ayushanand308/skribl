const App = (() => {
    const AVATARS = ['😀', '😎', '🎮', '💀', '🤖', '👽', '⚔️', '👻', '🧙', '🚀', '🌋', '⚡', '🔥', '⭐', '🎃', '👑'];
    let selectedAvatar = AVATARS[0];
    let currentScreen = 'home';

    function _generateId() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    function _getMyPlayerId() {
        let id = sessionStorage.getItem('skribl_player_id');
        if (!id) {
            id = _generateId();
            sessionStorage.setItem('skribl_player_id', id);
        }
        return id;
    }

    function init() {
        _initTheme();
        CanvasModule.init();
        ChatModule.init();
        LobbyModule.init();
        GameModule.init();

        _renderAvatars();

        document.getElementById('btn-theme-toggle').addEventListener('click', _toggleTheme);
        document.getElementById('btn-create-room').addEventListener('click', _createRoom);
        document.getElementById('btn-join-room').addEventListener('click', _joinRoom);

        document.getElementById('room-code-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') _joinRoom();
        });

        document.getElementById('username-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') document.getElementById('btn-create-room').focus();
        });

        SocketClient.on('_connected', () => {
            toast('>> CONNECTED! <<', 'success');
            const roomCode = LobbyModule.getRoomCode();
            if (roomCode) {
                SocketClient.emit('room-reconnect', {
                    roomCode,
                    id: _getMyPlayerId()
                });
            }
        });
        SocketClient.on('_disconnected', (data) => {
            toast(`DISCONNECTED: ${data.reason}`, 'warning');
            document.getElementById('overlay-reconnecting').style.display = '';
        });
        SocketClient.on('_reconnecting', (data) => {
            toast(`RECONNECTING... (${data.attempt})`, 'info');
            document.getElementById('overlay-reconnecting').style.display = '';
        });
        SocketClient.on('_reconnected', () => {
            toast('>> RECONNECTED! <<', 'success');
            document.getElementById('overlay-reconnecting').style.display = 'none';
        });
        SocketClient.on('_error', (data) => {
            toast(`ERROR: ${data.message}`, 'error');
        });

        SocketClient.on('system:degraded', (data) => {
            toast(`SYSTEM DEGRADED: ${data.message}`, 'error');
        });

        SocketClient.on('system:recovered', (data) => {
            toast(`SYSTEM RESTORED: ${data.message}`, 'success');
        });

        SocketClient.on('room:error', (data) => {
            toast(`ERROR: ${data.message || 'SOMETHING WENT WRONG'}`, 'error');
        });

        SocketClient.on('room-joined', (data) => {
            if (data.gameState === 'LOBBY' || !data.gameState) {
                showScreen('lobby');
                ChatModule.clear();
            } else {
                GameModule.handleReconnect(data);
                showScreen('game');
            }
            document.getElementById('overlay-reconnecting').style.display = 'none';
        });

        SocketClient.on('round-started', () => {
            showScreen('game');
        });

        SocketClient.on('game:back-to-lobby', () => {
            showScreen('lobby');
            ChatModule.clear();
            LobbyModule.resetForNewGame();
        });

        SocketClient.on('game-over', (data) => {
            const reason = data && data.reason === 'host_left' ? 'HOST LEFT THE GAME' : 'GAME ENDED';
            toast(`>> ${reason} <<`, 'warning');
            showScreen('home');
        });

        SocketClient.connect();

        console.log('[App] Initialized');
    }

    function _initTheme() {
        const savedTheme = localStorage.getItem('skribl_theme');
        if (savedTheme === 'dark') {
            document.body.classList.remove('light-mode');
        } else {
            document.body.classList.add('light-mode');
        }
    }

    function _toggleTheme() {
        document.body.classList.toggle('light-mode');
        const isLight = document.body.classList.contains('light-mode');
        localStorage.setItem('skribl_theme', isLight ? 'light' : 'dark');
    }

    function _renderAvatars() {
        const grid = document.getElementById('avatar-grid');
        grid.innerHTML = AVATARS
            .map((emoji, i) => `<div class="avatar-option${i === 0 ? ' selected' : ''}" data-avatar="${emoji}">${emoji}</div>`)
            .join('');

        grid.addEventListener('click', (e) => {
            const option = e.target.closest('.avatar-option');
            if (!option) return;
            grid.querySelectorAll('.avatar-option').forEach((o) => o.classList.remove('selected'));
            option.classList.add('selected');
            selectedAvatar = option.dataset.avatar;
        });
    }


    function _createRoom() {
        const name = _getUsername();
        if (!name) return;

        SocketClient.emit('room-create', {
            username: name,
            id: _getMyPlayerId(),
            avatar: selectedAvatar,
        });
    }

    function _joinRoom() {
        const name = _getUsername();
        if (!name) return;

        const codeInput = document.getElementById('room-code-input');
        const code = codeInput.value.trim().toUpperCase();
        if (!code || code.length < 4) {
            toast('ENTER A VALID ROOM CODE', 'warning');
            codeInput.focus();
            return;
        }

        SocketClient.emit('room-join', {
            roomCode: code,
            username: name,
            id: _getMyPlayerId(),
            avatar: selectedAvatar,
        });
    }

    function _getUsername() {
        const input = document.getElementById('username-input');
        const name = input.value.trim();
        if (!name) {
            toast('ENTER YOUR NAME!', 'warning');
            input.focus();
            return null;
        }
        if (name.length < 2) {
            toast('NAME MUST BE 2+ CHARS', 'warning');
            input.focus();
            return null;
        }
        return name;
    }


    function showScreen(screenId) {
        if (currentScreen === screenId) return;
        currentScreen = screenId;

        document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
        const target = document.getElementById(`screen-${screenId}`);
        if (target) {
            target.classList.add('active');
        }
    }


    function toast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.textContent = message;
        container.appendChild(el);

        setTimeout(() => {
            el.remove();
        }, 3000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Retro floating pixel particles
    (function initParticles() {
        const canvas = document.createElement('canvas');
        canvas.id = 'retro-particles';
        canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9998;opacity:0.4;';
        document.body.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        let particles = [];
        const DARK_COLORS = ['#ff00ff', '#00d4ff', '#ffff00', '#00ff41', '#ff6600', '#b400ff', '#ff0040'];
        const LIGHT_COLORS = ['#e600e6', '#009acd', '#e6e600', '#00cc33', '#e65c00', '#9900cc', '#e60039'];

        function getColors() {
            return document.body.classList.contains('light-mode') ? LIGHT_COLORS : DARK_COLORS;
        }

        function resize() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }
        resize();
        window.addEventListener('resize', resize);

        for (let i = 0; i < 40; i++) {
            particles.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                size: Math.random() * 3 + 1,
                speedY: -(Math.random() * 0.5 + 0.1),
                speedX: (Math.random() - 0.5) * 0.3,
                colorIndex: Math.floor(Math.random() * DARK_COLORS.length),
                alpha: Math.random() * 0.5 + 0.3,
            });
        }

        function animate() {
            const currentColors = getColors();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            particles.forEach((p) => {
                ctx.fillStyle = currentColors[p.colorIndex];
                ctx.globalAlpha = p.alpha;
                ctx.fillRect(Math.floor(p.x), Math.floor(p.y), p.size, p.size);
                p.y += p.speedY;
                p.x += p.speedX;
                if (p.y < -10) {
                    p.y = canvas.height + 10;
                    p.x = Math.random() * canvas.width;
                }
                if (p.x < -10) p.x = canvas.width + 10;
                if (p.x > canvas.width + 10) p.x = -10;
            });
            ctx.globalAlpha = 1;
            requestAnimationFrame(animate);
        }
        animate();
    })();

    return { showScreen, toast };
})();
