
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

        SocketClient.on('stroke-draw', _onRemoteStroke);
        SocketClient.on('stroke-clear', _onRemoteClear);
        SocketClient.on('stroke-fill', _onRemoteFill);
        SocketClient.on('stroke-undo', _onRemoteUndo);

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

    return { init, enableDrawing, disableDrawing, reset, loadStrokes };
})();
