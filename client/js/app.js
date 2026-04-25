const App = (() => {
    const AVATARS = ['😀', '😎', '🤩', '🥳', '😺', '🐶', '🦊', '🐸', '🐵', '🦁', '🐼', '🐧', '🦄', '🐲', '🎃', '👻'];
    let selectedAvatar = AVATARS[0];
    let currentScreen = 'home';

    function init() {
        CanvasModule.init();
        ChatModule.init();
        LobbyModule.init();
        GameModule.init();

        _renderAvatars();

        document.getElementById('btn-create-room').addEventListener('click', _createRoom);
        document.getElementById('btn-join-room').addEventListener('click', _joinRoom);

        document.getElementById('room-code-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') _joinRoom();
        });

        document.getElementById('username-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') document.getElementById('btn-create-room').focus();
        });

        SocketClient.on('_connected', () => {
            toast('Connected to server!', 'success');
        });
        SocketClient.on('_disconnected', (data) => {
            toast(`Disconnected: ${data.reason}`, 'warning');
        });
        SocketClient.on('_reconnecting', (data) => {
            toast(`Reconnecting... (attempt ${data.attempt})`, 'info');
        });
        SocketClient.on('_reconnected', () => {
            toast('Reconnected!', 'success');
        });
        SocketClient.on('_error', (data) => {
            toast(`Connection error: ${data.message}`, 'error');
        });

        SocketClient.on('room:error', (data) => {
            toast(data.message || 'Something went wrong', 'error');
        });

        SocketClient.on('room-joined', (data) => {
            if (data.gameState === 'LOBBY' || !data.gameState) {
                showScreen('lobby');
            }
        });

        SocketClient.on('round-started', () => {
            showScreen('game');
        });

        SocketClient.on('game:back-to-lobby', () => {
            showScreen('lobby');
        });

        SocketClient.connect();

        console.log('[App] Initialized');
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
            id: String(Math.random()),
            avatar: selectedAvatar,
        });
    }

    function _joinRoom() {
        const name = _getUsername();
        if (!name) return;

        const codeInput = document.getElementById('room-code-input');
        const code = codeInput.value.trim().toUpperCase();
        if (!code || code.length < 4) {
            toast('Please enter a valid room code', 'warning');
            codeInput.focus();
            return;
        }

        SocketClient.emit('room-join', {
            roomCode: code,
            username: name,
            id: String(Math.random()),
            avatar: selectedAvatar,
        });
    }

    function _getUsername() {
        const input = document.getElementById('username-input');
        const name = input.value.trim();
        if (!name) {
            toast('Please enter your name!', 'warning');
            input.focus();
            return null;
        }
        if (name.length < 2) {
            toast('Name must be at least 2 characters', 'warning');
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

    return { showScreen, toast };
})();
