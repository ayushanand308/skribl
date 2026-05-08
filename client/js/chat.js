const ChatModule = (() => {
    let chatMessages;
    let chatInput;
    let btnSend;
    let isDisabled = false;

    function init() {
        chatMessages = document.getElementById('chat-messages');
        chatInput = document.getElementById('chat-input');
        btnSend = document.getElementById('btn-send-chat');

        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                _sendMessage();
            }
        });

        btnSend.addEventListener('click', _sendMessage);

        SocketClient.on('chat-message', _onChatMessage);
        SocketClient.on('game:player-guessed', _onPlayerGuessed);
    }

    function _sendMessage() {
        if (isDisabled) return;
        const text = chatInput.value.trim();
        if (!text) return;

        SocketClient.emit('chat-message', { message: text, roomCode: LobbyModule.getRoomCode(), userId: LobbyModule.getMyPlayerId() });
        chatInput.value = '';
        chatInput.focus();
    }

    function _onChatMessage(data) {
        const sender = data.sender || data.playerName || '';
        const text = data.message || data.text || '';

        if (sender === 'System') {
            if (text.includes('guessed the word')) {
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
        _addMessage(`>> ${data.playerName} GUESSED IT! (+${data.score}) <<`, 'correct');
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
    }


    function enable(placeholder = 'Type your guess...') {
        isDisabled = false;
        chatInput.disabled = false;
        chatInput.placeholder = placeholder;
        chatInput.focus();
    }

    function clear() {
        chatMessages.innerHTML = '';
        _addMessage('> WELCOME TO SKRIBL! <', 'system');
    }

    return { init, addSystemMessage, disable, enable, clear };
})();
