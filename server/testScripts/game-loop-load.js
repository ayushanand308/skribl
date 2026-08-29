const { io } = require('socket.io-client');

const args = Object.fromEntries(
    process.argv.slice(2)
        .filter(a => a.startsWith('--'))
        .map(a => a.slice(2).split('='))
);

const ROOMS        = parseInt(args.rooms        || '10');
const PLAYERS      = parseInt(args.players      || '4');    // guessers per room (excl. host)
const ROUNDS       = parseInt(args.rounds       || '1');
const DRAW_TIME    = parseInt(args.drawTime     || '10');   // draw time in seconds
const SERVER_URL   = args.url                   || 'http://127.0.0.1:3000';

let roomsCompleted = 0;
let roomsFailed = 0;
let strokesSent = 0;
let strokesReceived = 0;
let correctGuesses = 0;
let totalGuesses = 0;

const strokeLatencies = [];
const guessLatencies = [];
const startTime = Date.now();

function randomId() {
    return Math.random().toString(36).slice(2, 10);
}

function createSocket() {
    return io(SERVER_URL, {
        transports: ['websocket'],
        reconnection: false,
        timeout: 10000,
    });
}

function waitFor(socket, event, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout waiting for event "${event}"`)), timeoutMs);
        socket.once(event, (data) => {
            clearTimeout(timer);
            resolve(data);
        });
    });
}

async function runGameLoopRoom(roomIndex) {
    const hostUserId = `user_host_${roomIndex}_${randomId()}`;
    const hostSocket = createSocket();

    try {
        await waitFor(hostSocket, 'connect');
    } catch (e) {
        roomsFailed++;
        return;
    }

    hostSocket.emit('room-create', { username: `Host_${roomIndex}`, id: hostUserId, avatar: '🤖' });
    let roomData;
    try {
        roomData = await waitFor(hostSocket, 'room-joined');
    } catch (e) {
        roomsFailed++;
        hostSocket.disconnect();
        return;
    }

    const { roomCode } = roomData;

    const guesserSockets = [];
    const guesserUserIds = [];

    for (let i = 0; i < PLAYERS; i++) {
        const gUserId = `user_player_${roomIndex}_${i}_${randomId()}`;
        const gSocket = createSocket();
        try {
            await waitFor(gSocket, 'connect');
            gSocket.emit('room-join', {
                roomCode,
                username: `Player_${roomIndex}_${i}`,
                id: gUserId,
                avatar: '⚡',
            });
            await waitFor(gSocket, 'room-joined');
            guesserSockets.push(gSocket);
            guesserUserIds.push(gUserId);
        } catch (e) {
            gSocket.disconnect();
        }
    }

    if (guesserSockets.length === 0) {
        roomsFailed++;
        hostSocket.disconnect();
        return;
    }

    const allSockets = [hostSocket, ...guesserSockets];

    guesserSockets.forEach(g => {
        g.on('stroke-draw', (payload) => {
            strokesReceived++;
            if (payload._sentAt) {
                strokeLatencies.push(Date.now() - payload._sentAt);
            }
        });
    });

    hostSocket.emit('game-start', {
        userName: `Host_${roomIndex}`,
        roomCode,
        settings: { rounds: ROUNDS, drawTime: DRAW_TIME }
    });

    let targetWord = 'CAT'; 

    const wordChoicePromises = allSockets.map(s => {
        return new Promise((resolve) => {
            s.once('choose-word', (payload) => {
                const choosenWord = (payload.words && payload.words[0]) ? payload.words[0] : 'CAT';
                targetWord = choosenWord;
                s.emit('word-choosen', { choosenWord, roomCode });
                resolve(true);
            });
        });
    });

    try {
        await Promise.race([
            Promise.all(wordChoicePromises),
            waitFor(hostSocket, 'round-started', 5000)
        ]);
    } catch (e) {
    }

    const strokeInterval = setInterval(() => {
        strokesSent++;
        hostSocket.emit('stroke', {
            roomCode,
            strokeType: 'draw',
            x: Math.floor(Math.random() * 500),
            y: Math.floor(Math.random() * 500),
            color: '#000000',
            size: 5,
            _sentAt: Date.now()
        });
    }, 50);

    await new Promise(r => setTimeout(r, 500));

    for (let i = 0; i < guesserSockets.length; i++) {
        const gSocket = guesserSockets[i];
        const gUserId = guesserUserIds[i];

        totalGuesses++;
        gSocket.emit('chat-message', {
            message: 'WRONG_GUESS',
            roomCode,
            userId: gUserId
        });
    }

    await new Promise(r => setTimeout(r, 300));

    const guessPromises = guesserSockets.map((gSocket, i) => {
        const gUserId = guesserUserIds[i];
        const sentAt = Date.now();

        return new Promise((resolve) => {
            const timer = setTimeout(() => resolve(false), 4000);
            gSocket.once('game:player-guessed', (data) => {
                clearTimeout(timer);
                guessLatencies.push(Date.now() - sentAt);
                correctGuesses++;
                resolve(true);
            });

            totalGuesses++;
            gSocket.emit('chat-message', {
                message: targetWord,
                roomCode,
                userId: gUserId
            });
        });
    });

    await Promise.all(guessPromises);
    clearInterval(strokeInterval);

    await new Promise(r => setTimeout(r, 1000));
    allSockets.forEach(s => s.disconnect());
    roomsCompleted++;
}

function printReport() {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 'N/A';
    const p95 = arr => {
        if (!arr.length) return 'N/A';
        const sorted = [...arr].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length * 0.95)];
    };

    console.log('\n=================================================');
    console.log('  SKRIBL GAME LOOP MECHANICS STRESS TEST RESULTS  ');
    console.log('=================================================');
    console.log(`Total Execution Time:    ${elapsed}s`);
    console.log(`Target Game Rooms:       ${ROOMS}`);
    console.log(`Players per Room:        ${PLAYERS + 1} (1 Host + ${PLAYERS} Guessers)`);
    console.log(`Rooms Completed:         ${roomsCompleted}/${ROOMS}`);
    console.log(`Rooms Failed:            ${roomsFailed}/${ROOMS}`);
    console.log('-------------------------------------------------');
    console.log(`Canvas Strokes Sent:     ${strokesSent}`);
    console.log(`Canvas Strokes Broadcast:${strokesReceived}`);
    console.log(`Avg Stroke Broadcast Latency: ${avg(strokeLatencies)}ms`);
    console.log(`p95 Stroke Broadcast Latency: ${p95(strokeLatencies)}ms`);
    console.log('-------------------------------------------------');
    console.log(`Total Guesses Submitted: ${totalGuesses}`);
    console.log(`Correct Guesses Processed:${correctGuesses}`);
    console.log(`Avg Guess Check & Score Latency: ${avg(guessLatencies)}ms`);
    console.log(`p95 Guess Check & Score Latency: ${p95(guessLatencies)}ms`);
    console.log('=================================================\n');
}

async function main() {
    console.log(`[Game Loop Test] Starting: ${ROOMS} active rooms @ ${SERVER_URL}`);
    console.log(`[Game Loop Test] Simulating Game Start, Drawer Word Pick, Stroke Stream & Lua Redis Scoring...\n`);

    const promises = Array.from({ length: ROOMS }, (_, i) => runGameLoopRoom(i));
    await Promise.all(promises);
    printReport();
}

main().catch(console.error);
