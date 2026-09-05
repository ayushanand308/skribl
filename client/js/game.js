var GameModule = (() => {
    let currentRound = 0;
    let maxRounds = 3;
    let drawTime = 60;
    let timeLeft = 0;
    let timerInterval = null;
    let myPlayerId = null;
    let isDrawer = false;
    let players = [];
    let currentDrawerId = null;
    let chosenWord = null;
    let roundEndTimeout = null;

    function init() {
        SocketClient.on('choose-word', _onPickWord);
        SocketClient.on('round-started', _onRoundStart);
        SocketClient.on('game:hint', _onHint);
        SocketClient.on('round-end', _onRoundEnd);
        SocketClient.on('game:over', _onGameOver);
        SocketClient.on('game:player-guessed', _onPlayerGuessed);
        SocketClient.on('player-left', _onPlayerLeft);

        document.getElementById('btn-play-again').addEventListener('click', _playAgain);
    }

    function _onPickWord(data) {
        myPlayerId = LobbyModule.getMyPlayerId();
        isDrawer = true;

        const overlay = document.getElementById('overlay-word-picker');
        const buttons = overlay.querySelectorAll('.word-btn');
        const timerFill = document.getElementById('word-timer-fill');

        data.words.forEach((word, i) => {
            buttons[i].textContent = word;
            buttons[i].onclick = () => {
                chosenWord = word;
                SocketClient.emit('word-choosen', { choosenWord: word, roomCode: LobbyModule.getRoomCode() });
                overlay.style.display = 'none';
                _clearWordPickerTimer();
            };
        });

        overlay.style.display = '';

        let elapsed = 0;
        const totalTime = 15;
        timerFill.style.width = '100%';
        _wordPickerTimerId = setInterval(() => {
            elapsed += 0.1;
            const pct = Math.max(0, 100 - (elapsed / totalTime) * 100);
            timerFill.style.width = pct + '%';
            if (elapsed >= totalTime) {
                _clearWordPickerTimer();
                chosenWord = data.words[0];
                SocketClient.emit('word-choosen', { choosenWord: data.words[0], roomCode: LobbyModule.getRoomCode() });
                overlay.style.display = 'none';
            }
        }, 100);
    }

    let _wordPickerTimerId = null;
    function _clearWordPickerTimer() {
        if (_wordPickerTimerId) {
            clearInterval(_wordPickerTimerId);
            _wordPickerTimerId = null;
        }
    }

    function _onRoundStart(data) {
        myPlayerId = LobbyModule.getMyPlayerId();
        currentDrawerId = data.drawerId;
        isDrawer = data.drawerId === myPlayerId;
        console.log('[Game] _onRoundStart — drawerId:', data.drawerId, 'myPlayerId:', myPlayerId, 'isDrawer:', isDrawer);
        currentRound = data.round || currentRound;
        maxRounds = data.maxRounds || maxRounds;
        drawTime = (data.settings && data.settings.drawTime) || drawTime;
        timeLeft = data.timeLeft !== undefined ? data.timeLeft : drawTime;
        players = data.players || players;

        document.getElementById('game-round').textContent = `${currentRound} / ${maxRounds}`;

        _renderWordHint(data.wordHint);

        CanvasModule.reset();
        
        _clearWordPickerTimer();

        if (isDrawer) {
            CanvasModule.enableDrawing();
            ChatModule.disable("YOU'RE DRAWING! NO CHAT.");
            ChatModule.addSystemMessage(">> IT'S YOUR TURN TO DRAW! <<");
            if (chosenWord) {
                _renderWordHint(chosenWord.split('').map(ch => ch === ' ' ? ' ' : ch).join(''), true);
                ChatModule.addSystemMessage(`>> YOUR WORD: ${chosenWord.toUpperCase()} <<`);
            }
        } else {
            CanvasModule.disableDrawing();
            ChatModule.enable('Type your guess...');
            const drawerName = _getPlayerName(data.drawerId);
            ChatModule.addSystemMessage(`>> ${drawerName} IS DRAWING! <<`);
        }

        _renderSidebar();

        _startTimer(timeLeft);

        if (roundEndTimeout) { clearTimeout(roundEndTimeout); roundEndTimeout = null; }
        document.getElementById('overlay-word-picker').style.display = 'none';
        document.getElementById('overlay-round-end').style.display = 'none';
        document.getElementById('overlay-game-over').style.display = 'none';

        App.showScreen('game');
    }


    function _onHint(data) {
        if (isDrawer && chosenWord) return;
        _renderWordHint(data.hint);
    }


    function _onPlayerGuessed(data) {
        const player = players.find((p) => p.id === data.playerId);
        if (player) {
            player.guessed = true;
            player.score = (player.score || 0) + (data.score || 0);
        }
        _renderSidebar();
    }

    function _onPlayerLeft(data) {
        const p = players.find((pl) => pl.id === data.playerId);
        const wasDrawer = data.playerId === currentDrawerId;
        players = players.filter((pl) => pl.id !== data.playerId);
        _renderSidebar();
        if (p) ChatModule.addSystemMessage(`>> ${p.name} LEFT THE GAME <<`);
        if (wasDrawer) {
            _stopTimer();
            CanvasModule.disableDrawing();
            _renderWordHint('');
            ChatModule.disable('WAITING FOR NEXT TURN...');
        }
    }

    function _onRoundEnd(data) {
        _stopTimer();
        _clearWordPickerTimer();
        isDrawer = false;
        chosenWord = null;
        timeLeft = 0;
        _updateTimerDisplay();

        console.log('[Game] _onRoundEnd — data:', data);

        document.getElementById('round-end-word').textContent = data.word;

        const scoreList = data.scores || data.score || [];

        const container = document.getElementById('round-end-scores');
        container.innerHTML = scoreList
            .sort((a, b) => (b.scoreDelta || b.score || 0) - (a.scoreDelta || a.score || 0))
            .map((s) => {
                const delta = s.scoreDelta != null ? s.scoreDelta : s.score || 0;
                const deltaClass = delta > 0 ? 'positive' : 'zero';
                const deltaText = delta > 0 ? `+${delta}` : '0';
                const name = s.playerName || _getPlayerName(s.playerId || s.id) || '???';
                return `
          <div class="round-score-row">
            <span class="rs-avatar">${s.avatar || '😀'}</span>
            <span class="rs-name">${_escapeHtml(name)}</span>
            <span class="rs-delta ${deltaClass}">${deltaText}</span>
          </div>
        `;
            })
            .join('');

        scoreList.forEach((s) => {
            const pId = s.playerId || s.id;
            const p = players.find((pl) => pl.id === pId);
            if (p) {
                p.score = s.totalScore != null ? s.totalScore : s.score || 0;
                p.guessed = false; 
            }
        });

        document.getElementById('overlay-round-end').style.display = '';

        if (roundEndTimeout) clearTimeout(roundEndTimeout);
        roundEndTimeout = setTimeout(() => {
            document.getElementById('overlay-round-end').style.display = 'none';
            roundEndTimeout = null;
        }, 5000);
    }


    function _onGameOver(data) {
        _stopTimer();
        _clearWordPickerTimer();
        isDrawer = false;
        chosenWord = null;
        currentDrawerId = null;

        console.log('[Game] _onGameOver — data:', data);

        // Backend sends { finalScores: [{id, score}] } — enrich from local players
        const rawScores = data.finalScores || [];
        const enriched = rawScores.map((s) => {
            const p = players.find((pl) => pl.id === (s.playerId || s.id));
            return {
                id: s.playerId || s.id,
                playerName: s.playerName || (p ? p.name : '???'),
                avatar: s.avatar || (p ? p.avatar : '😀'),
                totalScore: s.totalScore != null ? s.totalScore : (s.score || 0),
            };
        });

        const sorted = enriched.sort((a, b) => b.totalScore - a.totalScore);

        const podiumContainer = document.getElementById('final-podium');
        const podiumOrder = [1, 0, 2];
        podiumContainer.innerHTML = podiumOrder
            .map((idx) => {
                const p = sorted[idx];
                if (!p) return '';
                const place = idx + 1;
                const placeLabel = ['1st', '2nd', '3rd'][idx];
                return `
          <div class="podium-item podium-${placeLabel}">
            <span class="podium-avatar">${p.avatar}</span>
            <span class="podium-name">${_escapeHtml(p.playerName)}</span>
            <span class="podium-score">${p.totalScore}</span>
            <div class="podium-bar">${placeLabel}</div>
          </div>
        `;
            })
            .join('');

        const scoresContainer = document.getElementById('final-scores');
        scoresContainer.innerHTML = sorted
            .map((s, i) => `
        <div class="round-score-row">
          <span class="rs-avatar">${s.avatar}</span>
          <span class="rs-name">#${i + 1} ${_escapeHtml(s.playerName)}</span>
          <span class="rs-delta positive">${s.totalScore}</span>
        </div>
      `)
            .join('');

        document.getElementById('overlay-round-end').style.display = 'none';
        document.getElementById('overlay-word-picker').style.display = 'none';
        document.getElementById('overlay-game-over').style.display = '';
    }


    function _renderWordHint(hint, isDrawerWord = false) {
        const container = document.getElementById('game-word-hint');
        if (!hint) {
            container.innerHTML = '';
            return;
        }

        const charClass = isDrawerWord ? 'drawer-word' : 'revealed';
        container.innerHTML = hint
            .split('')
            .map((ch) => {
                if (ch === ' ') return '<span class="hint-char space"></span>';
                if (ch === '_') return '<span class="hint-char hidden">_</span>';
                return `<span class="hint-char ${charClass}">${ch}</span>`;
            })
            .join('');
    }

    function _renderSidebar() {
        const container = document.getElementById('game-player-list');
        const sorted = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));

        container.innerHTML = sorted
            .map((p, i) => {
                const isCurrentDrawer = p.id === currentDrawerId;
                const hasGuessed = p.guessed;
                const isMe = p.id === myPlayerId;
                let classes = 'sidebar-player';
                if (isCurrentDrawer) classes += ' drawing';
                if (hasGuessed) classes += ' guessed';

                return `
          <div class="${classes}">
            ${isCurrentDrawer ? '<div class="drawing-indicator"></div>' : ''}
            <span class="rank">#${i + 1}</span>
            <span class="sp-avatar">${p.avatar || '😀'}</span>
            <span class="sp-name">${_escapeHtml(p.name)}${isMe ? ' (You)' : ''}</span>
            ${hasGuessed ? '<span class="guessed-check">✓</span>' : ''}
            <span class="sp-score">${p.score || 0}</span>
          </div>
        `;
            })
            .join('');
    }

    function _startTimer(seconds) {
        _stopTimer();
        timeLeft = seconds;
        _updateTimerDisplay();

        timerInterval = setInterval(() => {
            timeLeft--;
            _updateTimerDisplay();
            if (timeLeft <= 0) {
                _stopTimer();
            }
        }, 1000);
    }

    function _stopTimer() {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
    }

    function _updateTimerDisplay() {
        const el = document.getElementById('game-timer-value');
        const wrapper = document.getElementById('game-timer');
        el.textContent = Math.max(0, timeLeft);

        wrapper.classList.remove('warning', 'danger');
        if (timeLeft <= 10) {
            wrapper.classList.add('danger');
        } else if (timeLeft <= 20) {
            wrapper.classList.add('warning');
        }
    }

    function _playAgain() {
        SocketClient.emit('game:play-again', { roomCode: LobbyModule.getRoomCode() });
        document.getElementById('overlay-game-over').style.display = 'none';
    }

    function _getPlayerName(playerId) {
        const p = players.find((pl) => pl.id === playerId);
        return p ? p.name : 'Someone';
    }

    function _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }


    function handleReconnect(data) {
        players = data.players || [];
        currentRound = data.round || 1;
        maxRounds = data.maxRounds || 3;
        myPlayerId = LobbyModule.getMyPlayerId();
        
        CanvasModule.reset();
        if (data.strokes && data.strokes.length > 0) {
            CanvasModule.loadStrokes(data.strokes);
        }
        _renderSidebar();

        if (data.gameState === 'DRAW') {
            currentDrawerId = data.drawerId;
            isDrawer = data.drawerId === myPlayerId;
            
            if (data.fullWord && isDrawer) {
                chosenWord = data.fullWord;
                _renderWordHint(data.fullWord, true);
                ChatModule.addSystemMessage(`>> YOUR WORD: ${chosenWord.toUpperCase()} <<`);
            } else if (data.wordHint) {
                _renderWordHint(data.wordHint, false);
            }

            if (isDrawer) {
                CanvasModule.enableDrawing();
                ChatModule.disable("YOU'RE DRAWING! NO CHAT.");
            } else {
                CanvasModule.disableDrawing();
                ChatModule.enable('Type your guess...');
                const drawerName = _getPlayerName(data.drawerId);
                ChatModule.addSystemMessage(`>> ${drawerName} IS DRAWING! <<`);
            }

            if (data.timeLeft !== undefined) {
                _startTimer(data.timeLeft);
            }
        }
        
        document.getElementById('overlay-word-picker').style.display = 'none';
        document.getElementById('overlay-round-end').style.display = 'none';
        document.getElementById('overlay-game-over').style.display = 'none';
        if (roundEndTimeout) {
            clearTimeout(roundEndTimeout);
            roundEndTimeout = null;
        }
    }

    function setPlayers(p) {
        players = p;
    }

    return { init, handleReconnect, setPlayers, _onPickWord, _onRoundStart };
})();
