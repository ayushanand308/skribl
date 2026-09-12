const LobbyModule = (() => {
    let roomCode = '';
    let players = [];
    let settings = {
        rounds: 3,
        drawTime: 60,
        maxPlayers: 8,
        customWords: [],
        customWordsOnly: false,
        customTheme: 'Default'
    };
    let isHost = false;
    let myPlayerId = null;
    let hostId = null;
    let hostSocketId = null;

    const THEME_PACKS = {
        tech: {
            name: 'Tech & Dev',
            icon: '💻',
            words: [
                'javascript', 'docker', 'python', 'database', 'github', 'linux', 'cloud', 'keyboard',
                'terminal', 'hacker', 'algorithm', 'frontend', 'backend', 'firewall', 'cookie', 'server'
            ]
        },
        movies: {
            name: 'Movies & TV',
            icon: '🍿',
            words: [
                'star wars', 'harry potter', 'batman', 'spiderman', 'the matrix', 'avatar', 'titanic',
                'jurassic park', 'shrek', 'iron man', 'inception', 'joker', 'lord of the rings'
            ]
        },
        gaming: {
            name: 'Gaming & Anime',
            icon: '🎮',
            words: [
                'pokemon', 'minecraft', 'super mario', 'naruto', 'sonic', 'fortnite', 'among us',
                'dragon ball', 'zelda', 'pacman', 'roblox', 'one piece', 'cyberpunk'
            ]
        },
        food: {
            name: 'Food & Snacks',
            icon: '🍕',
            words: [
                'pizza', 'sushi', 'hamburger', 'burrito', 'cheesecake', 'donut', 'hotdog',
                'ice cream', 'popcorn', 'taco', 'waffle', 'pancake', 'chocolate'
            ]
        },
        animals: {
            name: 'Animals',
            icon: '🐾',
            words: [
                'chameleon', 'flamingo', 'jellyfish', 'kangaroo', 'octopus', 'platypus',
                'rhinoceros', 'squirrel', 'sunflower', 'volcano', 'elephant', 'hedgehog'
            ]
        }
    };

    let customWordsDebounceTimeout = null;
    let customWordsInput = null;
    let customWordsCounter = null;
    let customWordsBadge = null;
    let customWordsExclusive = null;
    let hostCustomControls = null;
    let guestCustomView = null;
    let guestThemeTitle = null;
    let guestThemeDesc = null;
    let guestThemeIcon = null;

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

        customWordsInput = document.getElementById('custom-words-input');
        customWordsCounter = document.getElementById('custom-words-counter');
        customWordsBadge = document.getElementById('custom-words-badge');
        customWordsExclusive = document.getElementById('custom-words-exclusive');
        hostCustomControls = document.getElementById('host-custom-controls');
        guestCustomView = document.getElementById('guest-custom-view');
        guestThemeTitle = document.getElementById('guest-theme-title');
        guestThemeDesc = document.getElementById('guest-theme-desc');
        guestThemeIcon = document.getElementById('guest-theme-icon');

        if (customWordsInput) {
            customWordsInput.addEventListener('input', _onCustomWordsInput);
        }
        if (customWordsExclusive) {
            customWordsExclusive.addEventListener('change', _onCustomWordsExclusiveChange);
        }
        document.querySelectorAll('.theme-chip').forEach(btn => {
            btn.addEventListener('click', () => _onThemeChipClick(btn.dataset.theme));
        });

        SocketClient.on('room-joined', _onRoomState);
        SocketClient.on('player-joined', _onPlayerJoined);
        SocketClient.on('player-left', _onPlayerLeft);
        SocketClient.on('room:settings-updated', _onSettingsUpdated);
        SocketClient.on('room:host-changed', _onHostChanged);
    }

    function _onRoomState(data) {
        roomCode = data.roomCode;
        players = data.players;
        settings = Object.assign({}, settings, data.settings || {});
        hostId = data.hostId;
        hostSocketId = data.hostSocketId || data.hostId;
        const me = data.players.find(p => p.socketId === SocketClient.getSocketId());
        myPlayerId = (me && me.id) || sessionStorage.getItem('skribl_player_id') || myPlayerId || SocketClient.getSocketId();
        isHost = Boolean((data.hostId && data.hostId === myPlayerId) ||
                 (data.hostSocketId && data.hostSocketId === SocketClient.getSocketId()));

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
        settings = Object.assign({}, settings, data.settings || {});
        _renderSettings();
    }

    function _onHostChanged(data) {
        hostId = data.hostId;
        hostSocketId = data.hostSocketId || data.hostId;
        myPlayerId = myPlayerId || sessionStorage.getItem('skribl_player_id') || SocketClient.getSocketId();
        isHost = Boolean((data.hostId && data.hostId === myPlayerId) ||
                 (data.hostSocketId && data.hostSocketId === SocketClient.getSocketId()));
        _renderPlayers();
        _renderSettings();
        _updateStartButton();
        App.toast(`>> ${data.hostName || 'Player'} IS NOW THE HOST! <<`, 'success');
    }

    function _renderPlayers() {
        const container = document.getElementById('lobby-player-list');
        const count = document.getElementById('lobby-player-count');
        count.textContent = `(${players.length}/${settings.maxPlayers || 8})`;

        container.innerHTML = players
            .map((p) => {
                const isMe = p.id === myPlayerId;
                const isPlayerHost = p.id === hostId;
                return `
          <div class="player-card ${isPlayerHost ? 'is-host' : ''}" data-player-id="${p.id}">
            <div class="player-avatar">${p.avatar || '😀'}</div>
            <div class="player-name">${_escapeHtml(p.name)}${isMe ? ' (You)' : ''}</div>
            ${isPlayerHost ? '<span class="host-badge">Host</span>' : ''}
            ${isHost && !isMe ? `<button class="kick-btn" onclick="LobbyModule.kickPlayer('${p.id}')" title="Kick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}
          </div>
        `;
            })
            .join('');
    }

    function _parseCustomWords(text) {
        if (!text) return [];
        return text
            .split(/[,;\n\r]+/)
            .map(w => w.trim().toLowerCase().replace(/\s+/g, ' '))
            .filter(w => w.length >= 2 && w.length <= 32);
    }

    function _onCustomWordsInput() {
        if (!isHost) return;
        const words = _parseCustomWords(customWordsInput.value);
        if (customWordsCounter) {
            customWordsCounter.textContent = `${words.length} word${words.length === 1 ? '' : 's'}`;
        }
        settings.customWords = words;

        let matchedTheme = 'Custom';
        if (words.length === 0) {
            matchedTheme = 'Default';
        } else {
            for (const pack of Object.values(THEME_PACKS)) {
                if (pack.words.length === words.length && pack.words.every(w => words.includes(w))) {
                    matchedTheme = pack.name;
                    break;
                }
            }
        }
        settings.customTheme = matchedTheme;
        _updateThemeBadge();
        _highlightActivePresetChip();

        clearTimeout(customWordsDebounceTimeout);
        customWordsDebounceTimeout = setTimeout(() => {
            SocketClient.emit('room:update-settings', {
                customWords: settings.customWords,
                customTheme: settings.customTheme,
                customWordsOnly: !!settings.customWordsOnly
            });
        }, 400);
    }

    function _onCustomWordsExclusiveChange() {
        if (!isHost) return;
        settings.customWordsOnly = customWordsExclusive.checked;
        SocketClient.emit('room:update-settings', {
            customWordsOnly: settings.customWordsOnly
        });
    }

    function _onThemeChipClick(themeKey) {
        if (!isHost) return;
        if (themeKey === 'clear') {
            settings.customWords = [];
            settings.customTheme = 'Default';
            if (customWordsInput) customWordsInput.value = '';
            if (customWordsCounter) customWordsCounter.textContent = '0 words';
            App.toast('Reset to default word bank', 'info');
        } else if (THEME_PACKS[themeKey]) {
            const pack = THEME_PACKS[themeKey];
            settings.customWords = [...pack.words];
            settings.customTheme = pack.name;
            if (customWordsInput) customWordsInput.value = pack.words.join(', ');
            if (customWordsCounter) customWordsCounter.textContent = `${pack.words.length} words`;
            App.toast(`Loaded theme: ${pack.name}`, 'success');
        }
        _updateThemeBadge();
        _highlightActivePresetChip();

        SocketClient.emit('room:update-settings', {
            customWords: settings.customWords,
            customTheme: settings.customTheme,
            customWordsOnly: !!settings.customWordsOnly
        });
    }

    function _updateThemeBadge() {
        if (!customWordsBadge) return;
        const theme = settings.customTheme || 'Default';
        customWordsBadge.textContent = theme;
        if (theme !== 'Default') {
            customWordsBadge.classList.add('custom-active');
        } else {
            customWordsBadge.classList.remove('custom-active');
        }
    }

    function _highlightActivePresetChip() {
        const theme = settings.customTheme || 'Default';
        document.querySelectorAll('.theme-chip').forEach(btn => {
            const key = btn.dataset.theme;
            if (key === 'clear') {
                btn.classList.toggle('active', theme === 'Default');
            } else if (THEME_PACKS[key]) {
                btn.classList.toggle('active', THEME_PACKS[key].name === theme);
            } else {
                btn.classList.remove('active');
            }
        });
    }

    function _renderGuestThemeSummary() {
        if (!guestCustomView) return;
        const theme = settings.customTheme || 'Default';
        const count = settings.customWordsCount || (settings.customWords ? settings.customWords.length : 0);
        const isExclusive = !!settings.customWordsOnly;

        if (count > 0 || (theme && theme !== 'Default')) {
            let icon = '🎯';
            for (const pack of Object.values(THEME_PACKS)) {
                if (pack.name === theme) {
                    icon = pack.icon;
                    break;
                }
            }
            if (guestThemeIcon) guestThemeIcon.textContent = icon;
            if (guestThemeTitle) guestThemeTitle.textContent = `Theme: ${theme}`;
            if (guestThemeDesc) guestThemeDesc.textContent = `${count} custom word${count === 1 ? '' : 's'} • ${isExclusive ? 'Exclusive Mode (100%)' : 'Mixed with standard words'}`;
            if (customWordsBadge) {
                customWordsBadge.textContent = theme;
                customWordsBadge.classList.add('custom-active');
            }
        } else {
            if (guestThemeIcon) guestThemeIcon.textContent = '🎨';
            if (guestThemeTitle) guestThemeTitle.textContent = 'Theme: Standard / Classic';
            if (guestThemeDesc) guestThemeDesc.textContent = 'Playing with default dictionary';
            if (customWordsBadge) {
                customWordsBadge.textContent = 'Classic';
                customWordsBadge.classList.remove('custom-active');
            }
        }
    }

    function _renderSettings() {
        const settingsSection = document.getElementById('lobby-settings');
        if (!settingsSection) return;

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

        if (isHost) {
            if (hostCustomControls) hostCustomControls.style.display = 'block';
            if (guestCustomView) guestCustomView.style.display = 'none';

            if (customWordsInput && document.activeElement !== customWordsInput) {
                const wordsList = settings.customWords || [];
                customWordsInput.value = wordsList.join(', ');
                if (customWordsCounter) customWordsCounter.textContent = `${wordsList.length} word${wordsList.length === 1 ? '' : 's'}`;
            }
            if (customWordsExclusive) {
                customWordsExclusive.checked = !!settings.customWordsOnly;
            }
            _updateThemeBadge();
            _highlightActivePresetChip();
        } else {
            if (hostCustomControls) hostCustomControls.style.display = 'none';
            if (guestCustomView) guestCustomView.style.display = 'block';
            _renderGuestThemeSummary();
        }
    }

    function _updateStartButton() {
        const btn = document.getElementById('btn-start-game');
        if (!btn) return;
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
        SocketClient.emit('kick-player', { playerId, roomCode });
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

    function resetForNewGame() {
        players.forEach(p => p.score = 0);
        _renderPlayers();
        _updateStartButton();
    }

    function getHostId() {
        return hostId;
    }

    return { init, kickPlayer, getPlayers, getSettings, setPlayers, getRoomCode, getMyPlayerId, getHostId, resetForNewGame };
})();
