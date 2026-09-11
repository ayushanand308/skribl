
const CanvasModule = (() => {
    let canvas, ctx;
    let isDrawing = false;
    let isDrawer = false; 
    let currentColor = '#000000';
    let currentSize = 6;
    let isErasing = false;
    let currentStroke = [];
    let strokeHistory = [];
    let lastPoint = null;
    let isPingMode = false;
    let lastReactionTime = 0;
    let timelapseAnimId = null;

    function init() {
        canvas = document.getElementById('draw-canvas');
        ctx = canvas.getContext('2d');
        _resizeCanvas();

        canvas.addEventListener('pointerdown', _onPointerDown);
        canvas.addEventListener('pointermove', _onPointerMove);
        canvas.addEventListener('pointerup', _onPointerUp);
        canvas.addEventListener('pointerleave', _onPointerUp);

        document.querySelectorAll('.color-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                _setColor(btn.dataset.color);
                isErasing = false;
                document.getElementById('btn-eraser').classList.remove('active');
            });
        });

        document.querySelectorAll('.size-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                _setSize(parseInt(btn.dataset.size));
            });
        });

        document.getElementById('btn-eraser').addEventListener('click', _toggleEraser);
        document.getElementById('btn-undo').addEventListener('click', _undo);
        document.getElementById('btn-clear').addEventListener('click', _clearCanvas);
        document.getElementById('btn-fill').addEventListener('click', _fill);

        const hotBtn = document.getElementById('btn-react-hot');
        const coldBtn = document.getElementById('btn-react-cold');
        const pingBtn = document.getElementById('btn-react-ping');
        if (hotBtn) hotBtn.addEventListener('click', () => _sendReaction('HOT'));
        if (coldBtn) coldBtn.addEventListener('click', () => _sendReaction('COLD'));
        if (pingBtn) pingBtn.addEventListener('click', _togglePingMode);

        const reactionOverlay = document.getElementById('reaction-overlay');
        if (reactionOverlay) {
            reactionOverlay.addEventListener('click', _onReactionOverlayClick);
        }

        SocketClient.on('stroke-draw', _onRemoteStroke);
        SocketClient.on('stroke-clear', _onRemoteClear);
        SocketClient.on('stroke-fill', _onRemoteFill);
        SocketClient.on('stroke-undo', _onRemoteUndo);
        SocketClient.on('drawer:reaction', _onRemoteReaction);

        window.addEventListener('resize', _resizeCanvas);
    }

    function _resizeCanvas() {
        const wrapper = document.getElementById('canvas-wrapper');
        if (!wrapper || !canvas) return;

        const wrapperW = wrapper.clientWidth - 24;
        const wrapperH = wrapper.clientHeight - 24;
        const aspectRatio = 4 / 3;

        let w = wrapperW;
        let h = w / aspectRatio;

        if (h > wrapperH) {
            h = wrapperH;
            w = h * aspectRatio;
        }

        canvas.style.width = Math.floor(w) + 'px';
        canvas.style.height = Math.floor(h) + 'px';

        const reactionOverlay = document.getElementById('reaction-overlay');
        if (reactionOverlay) {
            reactionOverlay.style.width = canvas.style.width;
            reactionOverlay.style.height = canvas.style.height;
        }

        canvas.width = 800;
        canvas.height = 600;

        _redrawAll();
    }


    function _getCanvasPoint(e) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: ((e.clientX - rect.left) / rect.width) * canvas.width,
            y: ((e.clientY - rect.top) / rect.height) * canvas.height,
        };
    }

    function _onPointerDown(e) {
        console.log('[Canvas] pointerdown, isDrawer:', isDrawer);
        if (!isDrawer) return;
        if (isPingMode) {
            _handlePingAtEvent(e);
            return;
        }
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        isDrawing = true;
        lastPoint = _getCanvasPoint(e);
        currentStroke = [lastPoint];

        ctx.beginPath();
        ctx.arc(lastPoint.x, lastPoint.y, _getEffectiveSize() / 2, 0, Math.PI * 2);
        ctx.fillStyle = _getEffectiveColor();
        ctx.fill();
    }

    function _onPointerMove(e) {
        if (!isDrawer || !isDrawing) return;
        e.preventDefault();
        const point = _getCanvasPoint(e);
        currentStroke.push(point);
        _drawLine(lastPoint, point, _getEffectiveColor(), _getEffectiveSize());
        lastPoint = point;
    }

    function _onPointerUp(e) {
        if (!isDrawer || !isDrawing) return;
        e.preventDefault();
        isDrawing = false;

        if (currentStroke.length > 0) {
            const stroke = {
                points: _normalizePoints(currentStroke),
                color: _getEffectiveColor(),
                width: _getEffectiveSize() / canvas.width, 
                isEraser: isErasing,
            };

            strokeHistory.push(stroke);
            console.log('[Canvas] Emitting stroke, roomCode:', LobbyModule.getRoomCode(), 'stroke:', stroke);
            SocketClient.emit('stroke', { roomCode: LobbyModule.getRoomCode(), strokeType: 'draw', ...stroke });
        }
        currentStroke = [];
        lastPoint = null;
    }


    function _drawLine(from, to, color, width) {
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (color === '#FFFFFF' || color === 'white') {
            ctx.globalCompositeOperation = 'destination-out';
        } else {
            ctx.globalCompositeOperation = 'source-over';
        }
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
    }

    function _replayStroke(stroke) {
        const points = _denormalizePoints(stroke.points);
        const width = stroke.width * canvas.width;
        const color = stroke.isEraser ? '#FFFFFF' : stroke.color;

        if (points.length === 0) return;

        if (points.length === 1) {
            ctx.beginPath();
            ctx.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
            ctx.fillStyle = color;
            if (stroke.isEraser) {
                ctx.globalCompositeOperation = 'destination-out';
            }
            ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
            return;
        }

        for (let i = 1; i < points.length; i++) {
            _drawLine(points[i - 1], points[i], color, width);
        }
    }

    function _redrawAll() {
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        strokeHistory.forEach((stroke) => {
            if (stroke.type === 'fill') {
                ctx.fillStyle = stroke.color;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            } else {
                _replayStroke(stroke);
            }
        });
    }


    function _normalizePoints(points) {
        return points.map((p) => ({
            x: p.x / canvas.width,
            y: p.y / canvas.height,
        }));
    }

    function _denormalizePoints(points) {
        return points.map((p) => ({
            x: p.x * canvas.width,
            y: p.y * canvas.height,
        }));
    }


    function _getEffectiveColor() {
        return isErasing ? '#FFFFFF' : currentColor;
    }

    function _getEffectiveSize() {
        return isErasing ? currentSize * 3 : currentSize;
    }

    function _setColor(color) {
        currentColor = color;
        document.querySelectorAll('.color-btn').forEach((b) => b.classList.remove('active'));
        const btn = document.querySelector(`.color-btn[data-color="${color}"]`);
        if (btn) btn.classList.add('active');
    }

    function _setSize(size) {
        currentSize = size;
        document.querySelectorAll('.size-btn').forEach((b) => b.classList.remove('active'));
        const btn = document.querySelector(`.size-btn[data-size="${size}"]`);
        if (btn) btn.classList.add('active');
    }

    function _toggleEraser() {
        isErasing = !isErasing;
        document.getElementById('btn-eraser').classList.toggle('active', isErasing);
    }

    function _undo() {
        if (!isDrawer) return;
        if (strokeHistory.length === 0) return;
        strokeHistory.pop();
        _redrawAll();
        SocketClient.emit('stroke', { roomCode: LobbyModule.getRoomCode(), strokeType: 'undo' });
    }

    function _clearCanvas() {
        if (!isDrawer) return;
        strokeHistory = [];
        _redrawAll();
        SocketClient.emit('stroke', { roomCode: LobbyModule.getRoomCode(), strokeType: 'clear' });
    }

    function _fill() {
        if (!isDrawer) return;
        const fillColor = currentColor;
        ctx.fillStyle = fillColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const fillStroke = { type: 'fill', color: fillColor };
        strokeHistory.push(fillStroke);
        SocketClient.emit('stroke', { roomCode: LobbyModule.getRoomCode(), strokeType: 'fill', color: fillColor });
    }


    function _onRemoteStroke(payload) {
        console.log('[Canvas] Received remote stroke:', payload);
        const stroke = {
            points: payload.points,
            color: payload.color,
            width: payload.width,
            isEraser: payload.isEraser,
        };
        strokeHistory.push(stroke);
        _replayStroke(stroke);
    }

    function _onRemoteClear() {
        strokeHistory = [];
        _redrawAll();
    }

    function _onRemoteUndo() {
        if (strokeHistory.length === 0) return;
        strokeHistory.pop();
        _redrawAll();
    }

    function _onRemoteFill(data) {
        const fillStroke = { type: 'fill', color: data.color };
        strokeHistory.push(fillStroke);
        // Redraw all to keep compositing correct (fills can be painted over by subsequent strokes)
        _redrawAll();
    }

    function _sendReaction(type) {
        if (!isDrawer) return;
        const now = Date.now();
        if (now - lastReactionTime < 1200) {
            App.toast('WAIT BEFORE SENDING ANOTHER REACTION', 'warning');
            return;
        }
        lastReactionTime = now;
        SocketClient.emit('drawer:reaction', {
            roomCode: LobbyModule.getRoomCode(),
            type,
        });
    }

    function _togglePingMode() {
        if (!isDrawer) return;
        isPingMode = !isPingMode;
        const btn = document.getElementById('btn-react-ping');
        const overlay = document.getElementById('reaction-overlay');
        if (btn) btn.classList.toggle('active', isPingMode);
        if (overlay) overlay.classList.toggle('ping-active', isPingMode);
        if (isPingMode) {
            App.toast('CLICK THE CANVAS TO PING A CLUE!', 'info');
        }
    }

    function _onReactionOverlayClick(e) {
        if (isPingMode && isDrawer) {
            _handlePingAtEvent(e);
        }
    }

    function _handlePingAtEvent(e) {
        const rect = canvas.getBoundingClientRect();
        const normX = (e.clientX - rect.left) / rect.width;
        const normY = (e.clientY - rect.top) / rect.height;
        isPingMode = false;
        const btn = document.getElementById('btn-react-ping');
        const overlay = document.getElementById('reaction-overlay');
        if (btn) btn.classList.remove('active');
        if (overlay) overlay.classList.remove('ping-active');

        SocketClient.emit('drawer:reaction', {
            roomCode: LobbyModule.getRoomCode(),
            type: 'PING',
            x: normX,
            y: normY,
        });
    }

    function _onRemoteReaction(data) {
        const overlay = document.getElementById('reaction-overlay');
        if (!overlay) return;

        if (data.type === 'HOT') {
            const banner = document.createElement('div');
            banner.className = 'reaction-banner hot';
            banner.innerHTML = '🔥 DRAWER SAYS: GETTING HOT!';
            overlay.appendChild(banner);
            setTimeout(() => banner.remove(), 2300);
            ChatModule.addSystemMessage("🔥 [DRAWER]: Someone is getting hot/close!");
        } else if (data.type === 'COLD') {
            const banner = document.createElement('div');
            banner.className = 'reaction-banner cold';
            banner.innerHTML = '❄️ DRAWER SAYS: FREEZING COLD!';
            overlay.appendChild(banner);
            setTimeout(() => banner.remove(), 2300);
            ChatModule.addSystemMessage("❄️ [DRAWER]: Freezing cold / way off!");
        } else if (data.type === 'PING') {
            const pingEl = document.createElement('div');
            pingEl.className = 'radar-ping';
            const pctX = (data.x != null ? data.x : 0.5) * 100;
            const pctY = (data.y != null ? data.y : 0.5) * 100;
            pingEl.style.left = pctX + '%';
            pingEl.style.top = pctY + '%';
            pingEl.innerHTML = `
                <div class="radar-ring"></div>
                <div class="radar-ring"></div>
                <div class="radar-center"></div>
                <div class="radar-text">LOOK HERE!</div>
            `;
            overlay.appendChild(pingEl);
            setTimeout(() => pingEl.remove(), 2000);
            ChatModule.addSystemMessage("🎯 [DRAWER]: Look here!");
        }
    }

    function playTimelapse(canvasId, onComplete) {
        stopTimelapse();
        const targetCanvas = document.getElementById(canvasId);
        if (!targetCanvas) return;
        const tCtx = targetCanvas.getContext('2d');
        if (!tCtx) return;

        tCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
        tCtx.fillStyle = '#FFFFFF';
        tCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);

        if (!strokeHistory || strokeHistory.length === 0) {
            return;
        }

        const strokesToReplay = JSON.parse(JSON.stringify(strokeHistory));
        let strokeIdx = 0;
        let pointIdx = 1;

        function drawNextFrame() {
            const stepsPerFrame = Math.max(3, Math.ceil(strokesToReplay.length / 25));

            for (let s = 0; s < stepsPerFrame; s++) {
                if (strokeIdx >= strokesToReplay.length) {
                    stopTimelapse();
                    if (onComplete) onComplete();
                    return;
                }

                const stroke = strokesToReplay[strokeIdx];
                if (stroke.type === 'fill') {
                    tCtx.fillStyle = stroke.color;
                    tCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
                    strokeIdx++;
                    pointIdx = 1;
                    continue;
                }

                const points = stroke.points || [];
                const width = (stroke.width || 0.01) * targetCanvas.width;
                const color = stroke.isEraser ? '#FFFFFF' : stroke.color;

                if (points.length <= 1) {
                    if (points.length === 1) {
                        const pt = { x: points[0].x * targetCanvas.width, y: points[0].y * targetCanvas.height };
                        tCtx.beginPath();
                        tCtx.arc(pt.x, pt.y, width / 2, 0, Math.PI * 2);
                        tCtx.fillStyle = color;
                        if (stroke.isEraser) {
                            tCtx.globalCompositeOperation = 'destination-out';
                        }
                        tCtx.fill();
                        tCtx.globalCompositeOperation = 'source-over';
                    }
                    strokeIdx++;
                    pointIdx = 1;
                    continue;
                }

                if (pointIdx < points.length) {
                    const p1 = { x: points[pointIdx - 1].x * targetCanvas.width, y: points[pointIdx - 1].y * targetCanvas.height };
                    const p2 = { x: points[pointIdx].x * targetCanvas.width, y: points[pointIdx].y * targetCanvas.height };

                    tCtx.beginPath();
                    tCtx.moveTo(p1.x, p1.y);
                    tCtx.lineTo(p2.x, p2.y);
                    tCtx.strokeStyle = color;
                    tCtx.lineWidth = width;
                    tCtx.lineCap = 'round';
                    tCtx.lineJoin = 'round';
                    if (stroke.isEraser || color === '#FFFFFF' || color === 'white') {
                        tCtx.globalCompositeOperation = 'destination-out';
                    } else {
                        tCtx.globalCompositeOperation = 'source-over';
                    }
                    tCtx.stroke();
                    tCtx.globalCompositeOperation = 'source-over';

                    pointIdx++;
                } else {
                    strokeIdx++;
                    pointIdx = 1;
                }
            }

            timelapseAnimId = requestAnimationFrame(drawNextFrame);
        }

        timelapseAnimId = requestAnimationFrame(drawNextFrame);
    }

    function stopTimelapse() {
        if (timelapseAnimId) {
            cancelAnimationFrame(timelapseAnimId);
            timelapseAnimId = null;
        }
    }

    function enableDrawing() {
        console.log('[Canvas] enableDrawing called');
        isDrawer = true;
        canvas.style.cursor = 'crosshair';
        document.getElementById('draw-tools').classList.remove('hidden');
    }

    function disableDrawing() {
        isDrawer = false;
        isDrawing = false;
        canvas.style.cursor = 'default';
        document.getElementById('draw-tools').classList.add('hidden');
    }

    function reset() {
        stopTimelapse();
        isPingMode = false;
        const pingBtn = document.getElementById('btn-react-ping');
        const overlay = document.getElementById('reaction-overlay');
        if (pingBtn) pingBtn.classList.remove('active');
        if (overlay) {
            overlay.classList.remove('ping-active');
            overlay.innerHTML = '';
        }

        strokeHistory = [];
        currentStroke = [];
        isDrawing = false;
        isErasing = false;
        _setColor('#000000');
        _setSize(6);
        document.getElementById('btn-eraser').classList.remove('active');
        _redrawAll();
    }

    function loadStrokes(strokes) {
        strokeHistory = strokes || [];
        _redrawAll();
    }

    return { init, enableDrawing, disableDrawing, reset, loadStrokes, playTimelapse, stopTimelapse };
})();
