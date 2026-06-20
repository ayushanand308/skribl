const SocketClient = (() => {
    let socket = null;
    const listeners = new Map();

    function connect(serverUrl = 'http://localhost:3000') {
        if (socket && socket.connected) return;

        socket = io(serverUrl, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 10000,
        });

        socket.on('connect', () => {
            console.log('[Socket] Connected:', socket.id);
            _dispatch('_connected', { id: socket.id });
        });

        socket.on('disconnect', (reason) => {
            console.log('[Socket] Disconnected:', reason);
            _dispatch('_disconnected', { reason });
        });

        socket.on('connect_error', (err) => {
            console.error('[Socket] Connection error:', err.message);
            _dispatch('_error', { message: err.message });
        });

        socket.on('reconnect_attempt', (attempt) => {
            console.log('[Socket] Reconnecting... attempt', attempt);
            _dispatch('_reconnecting', { attempt });
        });

        socket.on('reconnect', () => {
            console.log('[Socket] Reconnected');
            _dispatch('_reconnected', {});
        });

        const serverEvents = [
            'room-joined',
            'player-joined',
            'player-left',
            'room:settings-updated',
            'room:host-changed',
            'room:error',
            'choose-word',
            'round-started',
            'game:hint',
            'round-end',
            'game:over',
            'game:player-guessed',
            'stroke-draw',
            'stroke-clear',
            'stroke-fill',
            'stroke-undo',
            'chat-message',
        ];

        serverEvents.forEach((event) => {
            socket.on(event, (data) => {
                console.log(`[Socket] ← ${event}`, data);
                _dispatch(event, data);
            });
        });
    }

    function emit(event, data = {}) {
        if (!socket || !socket.connected) {
            console.warn('[Socket] Not connected, cannot emit:', event);
            return;
        }
        console.log(`[Socket] → ${event}`, data);
        socket.emit(event, data);
    }


    function on(event, callback) {
        if (!listeners.has(event)) {
            listeners.set(event, new Set());
        }
        listeners.get(event).add(callback);
        return () => listeners.get(event).delete(callback);
    }


    function once(event, callback) {
        const unsub = on(event, (data) => {
            unsub();
            callback(data);
        });
        return unsub;
    }

    function _dispatch(event, data) {
        const cbs = listeners.get(event);
        if (cbs) {
            cbs.forEach((cb) => {
                try {
                    cb(data);
                } catch (err) {
                    console.error(`[Socket] Error in handler for "${event}":`, err);
                }
            });
        }
    }

    function isConnected() {
        return socket && socket.connected;
    }

    function getSocketId() {
        return socket ? socket.id : null;
    }

    function disconnect() {
        if (socket) {
            socket.disconnect();
            socket = null;
        }
    }

    return { connect, emit, on, once, isConnected, getSocketId, disconnect };
})();
