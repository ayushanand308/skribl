const LobbyModule = (() => {
    let roomCode = '';
    let players = [];
    let settings = { rounds: 3, drawTime: 60, maxPlayers: 8 };
    let isHost = false;
    let myPlayerId = null;
    let hostSocketId = null;

    function init() {
        document.querySelectorAll('.setting-options').forEach((group) => {
            group.querySelectorAll('.setting-btn').forEach((btn) => {
                btn.addEventListener('click', () => {
                    _onSettingClick(group, btn);
                });
            });
        });

        document.getElementById('btn-start-game').addEventListener('click', _startGame);

        document.getElementById('btn-copy-code').addEventListener('click', _copyCode);

        document.getElementById('btn-leave-lobby').addEventListener('click', _leaveRoom);

        SocketClient.on('room-joined', _onRoomState);
        SocketClient.on('player-joined', _onPlayerJoined);
        SocketClient.on('player-left', _onPlayerLeft);
        SocketClient.on('room:settings-updated', _onSettingsUpdated);
        SocketClient.on('room:host-changed', _onHostChanged);
    }


    function _onRoomState(data) {

        roomCode = data.roomCode;
        players = data.players;
        settings = data.settings || settings;
        isHost = data.hostId === SocketClient.getSocketId();
        hostSocketId = data.hostId;
        const me = data.players.find(p => p.socketId === SocketClient.getSocketId());
        myPlayerId = me ? me.id : SocketClient.getSocketId();

        document.getElementById('lobby-room-code').textContent = roomCode;
        _renderPlayers();
        _renderSettings();
        _updateStartButton();

        if (data.gameState && data.gameState !== 'LOBBY') {
            App.showScreen('game');
            GameModule.handleReconnect(data);
        }
    }

    function _onPlayerJoined(data) {
        players.push(data.player);
        _renderPlayers();
        _updateStartButton();
        App.toast(`>> ${data.player.name} JOINED! <<`, 'info');
    }

    function _onPlayerLeft(data) {
        const p = players.find((pl) => pl.id === data.playerId);
        players = players.filter((pl) => pl.id !== data.playerId);
        _renderPlayers();
        _updateStartButton();
        if (p) App.toast(`>> ${p.name} LEFT <<`, 'info');
    }

    function _onSettingsUpdated(data) {
        settings = data.settings;
        _renderSettings();
    }

    function _onHostChanged(data) {
        isHost = data.hostId === SocketClient.getSocketId();
        hostSocketId = data.hostId;
        _renderPlayers();
        _renderSettings();
        _updateStartButton();
    }


    function _renderPlayers() {
        const container = document.getElementById('lobby-player-list');
        const count = document.getElementById('lobby-player-count');
        count.textContent = `(${players.length}/${settings.maxPlayers})`;

        container.innerHTML = players
            .map((p, i) => {
                const isMe = p.id === myPlayerId;
                const isPlayerHost = p.socketId === hostSocketId;
                return `
          <div class="player-card" style="animation-delay:${i * 0.05}s" data-player-id="${p.id}">
            <div class="player-avatar">${p.avatar || '😀'}</div>
            <div class="player-name">${_escapeHtml(p.name)}${isMe ? ' (You)' : ''}</div>
            ${isPlayerHost ? '<span class="host-badge">Host</span>' : ''}
            ${isHost && !isMe ? `<button class="kick-btn" onclick="LobbyModule.kickPlayer('${p.id}')" title="Kick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}
          </div>
        `;
            })
            .join('');
    }

    function _renderSettings() {
        const settingsSection = document.getElementById('lobby-settings');
        const btns = settingsSection.querySelectorAll('.setting-btn');
        btns.forEach((btn) => {
            btn.disabled = !isHost;
            if (!isHost) btn.style.pointerEvents = 'none';
            else btn.style.pointerEvents = '';
        });

        document.querySelectorAll('.setting-options').forEach((group) => {
            const settingKey = group.dataset.setting;
            const value = String(settings[settingKey]);
            group.querySelectorAll('.setting-btn').forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.value === value);
            });
        });
    }

    function _updateStartButton() {
        const btn = document.getElementById('btn-start-game');
        btn.disabled = !isHost || players.length < 2;
        if (!isHost) {
            btn.textContent = 'WAITING FOR HOST...';
        } else if (players.length < 2) {
            btn.innerHTML = `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> NEED 2+ PLAYERS`;
        } else {
            btn.innerHTML = `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> [START GAME]`;
        }
    }


    function _onSettingClick(group, btn) {
        if (!isHost) return;
        const settingKey = group.dataset.setting;
        const value = parseInt(btn.dataset.value);
        settings[settingKey] = value;

        group.querySelectorAll('.setting-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        SocketClient.emit('room:update-settings', { [settingKey]: value });
    }

    function _startGame() {
        if (!isHost || players.length < 2) return;
        SocketClient.emit('game-start', { roomCode, userName: _escapeHtml(players.find(p => p.id === myPlayerId)?.name), settings });
    }

    function _copyCode() {
        navigator.clipboard.writeText(roomCode).then(() => {
            App.toast('ROOM CODE COPIED!', 'success');
        }).catch(() => {
            App.toast(`CODE: ${roomCode}`, 'info');
        });
    }

    function _leaveRoom() {
        SocketClient.emit('room-leave', { roomCode });
        App.showScreen('home');
        players = [];
    }

    function kickPlayer(playerId) {
        SocketClient.emit('kick-player', { playerId });
    }

    function _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function getPlayers() {
        return players;
    }

    function getSettings() {
        return settings;
    }

    function setPlayers(p) {
        players = p;
    }

    function getRoomCode() {
        return roomCode;
    }

    function getMyPlayerId() {
        return myPlayerId;
    }

    return { init, kickPlayer, getPlayers, getSettings, setPlayers, getRoomCode, getMyPlayerId };
})();
