
const { io } = require('socket.io-client');

const args = Object.fromEntries(
    process.argv.slice(2)
        .filter(a => a.startsWith('--'))
        .map(a => a.slice(2).split('='))
);

const ROOMS       = parseInt(args.rooms   || '20');
const PLAYERS     = parseInt(args.players || '4');   // guessers per room (excl. host)
const SERVER_URL  = args.url || 'http://127.0.0.1:3000';
const THINK_TIME  = parseInt(args.think   || '5000'); // ms each guesser stays connected

let connected = 0, failed = 0, roomsCreated = 0, errors = 0;
const connectionTimes = [];
const roomCreationTimes = [];
const startTime = Date.now();
let firstErrorPrinted = false;

function randomId() {
    return Math.random().toString(36).slice(2, 10);
}

function createSocket() {
    const s = io(SERVER_URL, {
        transports: ['websocket'],
        reconnection: false,
        timeout: 5000,
    });
    s.on('connect_error', (err) => {
        if (!firstErrorPrinted) {
            firstErrorPrinted = true;
            console.error(`[connect_error] ${err.message}`);
            if (err.description) console.error(`[connect_error] description:`, err.description);
            if (err.context)    console.error(`[connect_error] context:`,     err.context?.message ?? err.context);
        }
    });
    return s;
}

function waitFor(socket, event, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${event}"`)), timeoutMs);
        socket.once(event, (data) => {
            clearTimeout(timer);
            resolve(data);
        });
    });
}

async function runRoom(roomIndex) {
    const hostSocket = createSocket();

    const connectStart = Date.now();
    try {
        await waitFor(hostSocket, 'connect');
    } catch (e) {
        failed++;
        errors++;
        return;
    }
    connectionTimes.push(Date.now() - connectStart);
    connected++;

    const roomStart = Date.now();
    hostSocket.emit('room-create', { username: `Host_${roomIndex}`, id: randomId(), avatar: '🤖' });
    let roomData;
    try {
        roomData = await waitFor(hostSocket, 'room-joined');
    } catch (e) {
        errors++;
        hostSocket.disconnect();
        return;
    }
    roomCreationTimes.push(Date.now() - roomStart);
    roomsCreated++;

    const { roomCode } = roomData;

    const guesserSockets = [];
    for (let i = 0; i < PLAYERS; i++) {
        const g = createSocket();
        try {
            await waitFor(g, 'connect');
            connected++;
            g.emit('room-join', {
                roomCode,
                username: `Player_${roomIndex}_${i}`,
                id: randomId(),
                avatar: '⚡',
            });
            await waitFor(g, 'room-joined', 3000);
            guesserSockets.push(g);
        } catch (e) {
            errors++;
            g.disconnect();
        }
    }

    await new Promise(res => setTimeout(res, THINK_TIME));
    for (const g of guesserSockets) {
        g.emit('chat-message', { message: 'test guess', roomCode, userId: randomId() });
    }

    await new Promise(res => setTimeout(res, 500));
    hostSocket.disconnect();
    guesserSockets.forEach(g => g.disconnect());
}

function printReport() {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const totalSockets = connected + failed;
    const errorRate = ((errors / Math.max(totalSockets, 1)) * 100).toFixed(1);

    const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 'N/A';
    const p95 = arr => {
        if (!arr.length) return 'N/A';
        const sorted = [...arr].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length * 0.95)];
    };

    console.log('\n================================');
    console.log('  SOCKET.IO LOAD TEST RESULTS');
    console.log('================================');
    console.log(`Total time:            ${elapsed}s`);
    console.log(`Rooms targeted:        ${ROOMS}`);
    console.log(`Players per room:      ${PLAYERS + 1} (host + ${PLAYERS} guessers)`);
    console.log(`Total sockets:         ${totalSockets}`);
    console.log(`Connected OK:          ${connected}`);
    console.log(`Failed to connect:     ${failed}`);
    console.log(`Total errors:          ${errors}`);
    console.log(`Error rate:            ${errorRate}%`);
    console.log(`Rooms created:         ${roomsCreated}/${ROOMS}`);
    console.log(`Avg connect time:      ${avg(connectionTimes)}ms`);
    console.log(`p95 connect time:      ${p95(connectionTimes)}ms`);
    console.log(`Avg room create time:  ${avg(roomCreationTimes)}ms`);
    console.log(`p95 room create time:  ${p95(roomCreationTimes)}ms`);
    console.log('================================\n');
}

async function main() {
    console.log(`[Load Test] Starting: ${ROOMS} rooms × ${PLAYERS + 1} players @ ${SERVER_URL}`);
    console.log(`[Load Test] Total target connections: ${ROOMS * (PLAYERS + 1)}\n`);

    const promises = Array.from({ length: ROOMS }, (_, i) => runRoom(i));
    await Promise.all(promises);
    printReport();
}

main().catch(console.error);
