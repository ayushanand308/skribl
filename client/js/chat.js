const ChatModule = (() => {
    let chatMessages;
    let chatInput;
    let btnSend;
    let btnDoubleDown;
    let lockoutBadge;
    let lockoutTimer;
    let chatActionsBar;
    let isDisabled = false;
    let isDoubleDownActive = false;
    let hasUsedDoubleDownThisTurn = false;
    let lockoutTimerInterval = null;

    function init() {
        chatMessages = document.getElementById('chat-messages');
        chatInput = document.getElementById('chat-input');
        btnSend = document.getElementById('btn-send-chat');
        btnDoubleDown = document.getElementById('btn-double-down');
        lockoutBadge = document.getElementById('lockout-badge');
        lockoutTimer = document.getElementById('lockout-timer');
        chatActionsBar = document.getElementById('chat-actions-bar');

        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                _sendMessage();
            }
        });

        btnSend.addEventListener('click', _sendMessage);

        if (btnDoubleDown) {
            btnDoubleDown.addEventListener('click', _toggleDoubleDown);
        }

        SocketClient.on('chat-message', _onChatMessage);
        SocketClient.on('game:player-guessed', _onPlayerGuessed);
        SocketClient.on('game:lockout', _onLockout);
        SocketClient.on('chat:locked', (data) => _onLockout({ duration: data.timeLeft }));
    }

    function _toggleDoubleDown() {
        if (isDisabled || hasUsedDoubleDownThisTurn) return;
        isDoubleDownActive = !isDoubleDownActive;
        _updateDoubleDownButton();
        if (isDoubleDownActive) {
            App.toast('⚡ DOUBLE DOWN ACTIVE: 2X Points if right, 5s lockout if wrong!', 'warning');
        }
    }

    function _updateDoubleDownButton() {
        if (!btnDoubleDown) return;
        btnDoubleDown.classList.toggle('active', isDoubleDownActive);
        if (hasUsedDoubleDownThisTurn) {
            btnDoubleDown.disabled = true;
            btnDoubleDown.classList.remove('active');
            btnDoubleDown.innerHTML = '<span class="dd-icon">🔒</span><span class="dd-label">USED (THIS TURN)</span>';
        } else if (isDoubleDownActive) {
            btnDoubleDown.disabled = false;
            btnDoubleDown.innerHTML = '<span class="dd-icon">🔥</span><span class="dd-label">2X ACTIVE (WAGER)</span>';
        } else {
            btnDoubleDown.disabled = false;
            btnDoubleDown.innerHTML = '<span class="dd-icon">⚡</span><span class="dd-label">DOUBLE DOWN</span><span class="dd-multiplier">2X</span>';
        }
    }

    function _onLockout(data) {
        let remaining = data.duration || 5;
        if (lockoutTimerInterval) clearInterval(lockoutTimerInterval);

        isDisabled = true;
        chatInput.disabled = true;
        chatInput.classList.add('locked-out');
        chatInput.placeholder = `🔒 LOCKED (${remaining}s)...`;

        if (lockoutBadge) {
            lockoutBadge.style.display = 'inline-flex';
            if (lockoutTimer) lockoutTimer.textContent = remaining;
        }

        isDoubleDownActive = false;
        _updateDoubleDownButton();
        App.toast(`>> DOUBLE DOWN FAILED! ${remaining}s LOCKOUT! <<`, 'error');

        lockoutTimerInterval = setInterval(() => {
            remaining--;
            if (lockoutTimer) lockoutTimer.textContent = remaining;
            chatInput.placeholder = `🔒 LOCKED (${remaining}s)...`;

            if (remaining <= 0) {
                clearInterval(lockoutTimerInterval);
                lockoutTimerInterval = null;
                if (lockoutBadge) lockoutBadge.style.display = 'none';
                chatInput.classList.remove('locked-out');
                isDisabled = false;
                chatInput.disabled = false;
                chatInput.placeholder = 'Type your guess...';
                chatInput.focus();
                App.toast('>> LOCKOUT EXPIRED: GUESSING RESTORED! <<', 'info');
            }
        }, 1000);
    }

    function _sendMessage() {
        if (isDisabled) return;
        const text = chatInput.value.trim();
        if (!text) return;

        const dd = isDoubleDownActive;
        if (dd) {
            isDoubleDownActive = false;
            hasUsedDoubleDownThisTurn = true;
            _updateDoubleDownButton();
        }

        SocketClient.emit('chat-message', {
            message: text,
            roomCode: LobbyModule.getRoomCode(),
            userId: LobbyModule.getMyPlayerId(),
            isDoubleDown: dd
        });

        chatInput.value = '';
        chatInput.focus();
    }

    function _onChatMessage(data) {
        const sender = data.sender || data.playerName || '';
        const text = data.message || data.text || '';

        if (sender === 'System') {
            if (text.includes('DOUBLE DOWN SUCCESS')) {
                _addMessage(`>> ${text} <<`, 'double-down-success');
            } else if (text.includes('DOUBLE DOWN FAILED')) {
                _addMessage(`>> ${text} <<`, 'double-down-failed');
            } else if (text.includes('guessed the word')) {
                const playerName = text.replace(/ guessed the word!$/, '');
                _addMessage(`>> ${playerName.toUpperCase()} GUESSED THE WORD! <<`, 'correct');
            } else if (text.includes('is close') || text.includes('is close!')) {
                _addMessage(">> YOU'RE CLOSE! <<", 'close-guess');
            } else if (text.includes('is picking a word')) {
                _addMessage(`>> ${text.toUpperCase()} <<`, 'system');
            } else {
                _addMessage(`>> ${text.toUpperCase()} <<`, 'system');
            }
        } else {
            _addPlayerMessage(sender, text);
        }
    }

    function _onPlayerGuessed(data) {
        if (data.isDoubleDown) {
            _addMessage(`>> 🔥 [2X DOUBLE DOWN] ${data.playerName} GUESSED IT! (+${data.score}) <<`, 'double-down-success');
        } else {
            _addMessage(`>> ${data.playerName} GUESSED IT! (+${data.score}) <<`, 'correct');
        }
    }

    function _addPlayerMessage(name, text) {
        const el = document.createElement('div');
        el.className = 'chat-msg';
        el.innerHTML = `<span class="msg-author">${_escapeHtml(name)}:</span><span class="guess-text">${_escapeHtml(text)}</span>`;
        _append(el);
    }

    function _addMessage(text, cssClass = 'system') {
        const el = document.createElement('div');
        el.className = `chat-msg ${cssClass}`;
        el.textContent = text;
        _append(el);
    }

    function _append(el) {
        chatMessages.appendChild(el);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function addSystemMessage(text) {
        _addMessage(text, 'system');
    }

    function disable(placeholder = "You're drawing!") {
        isDisabled = true;
        chatInput.disabled = true;
        chatInput.placeholder = placeholder;
        if (chatActionsBar) chatActionsBar.classList.add('hidden');
    }

    function enable(placeholder = 'Type your guess...') {
        isDisabled = false;
        chatInput.disabled = false;
        chatInput.placeholder = placeholder;
        if (chatActionsBar) chatActionsBar.classList.remove('hidden');
        chatInput.focus();
    }

    function resetForNewTurn() {
        if (lockoutTimerInterval) {
            clearInterval(lockoutTimerInterval);
            lockoutTimerInterval = null;
        }
        if (lockoutBadge) lockoutBadge.style.display = 'none';
        if (chatInput) chatInput.classList.remove('locked-out');
        isDoubleDownActive = false;
        hasUsedDoubleDownThisTurn = false;
        _updateDoubleDownButton();
    }

    function clear() {
        resetForNewTurn();
        chatMessages.innerHTML = '';
        _addMessage('> WELCOME TO SKRIBL! <', 'system');
    }

    return { init, addSystemMessage, disable, enable, resetForNewTurn, clear };
})();
