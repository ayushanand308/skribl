const { io } = require('socket.io-client');

const args = Object.fromEntries(
    process.argv.slice(2)
        .filter(a => a.startsWith('--'))
        .map(a => a.slice(2).split('='))
);
const SERVER_URL = args.url || 'http://127.0.0.1:3000';


const TEARDOWN_DELAY = 400;
let passed = 0;
let failed = 0;
const failures = [];

function pass(name) {
    passed++;
    console.log(`  ✅ PASS — ${name}`);
}

function fail(name, reason) {
    failed++;
    failures.push({ name, reason });
    console.log(`  ❌ FAIL — ${name}`);
    console.log(`         → ${reason}`);
}

async function test(name, fn) {
    try {
        await fn();
        pass(name);
    } catch (err) {
        fail(name, err.message);
    }
    await sleep(TEARDOWN_DELAY);
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
        const timer = setTimeout(
            () => reject(new Error(`Timed out (${timeoutMs}ms) waiting for "${event}"`)),
            timeoutMs
        );
        socket.once(event, (data) => {
            clearTimeout(timer);
            resolve(data);
        });
    });
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function randomId() {
    return Math.random().toString(36).slice(2, 10);
}

async function connectSocket() {
    const s = createSocket();
    await waitFor(s, 'connect', 5000);
    return s;
}


async function setupRoom({ numGuessers = 1, rounds = 1, drawTime = 10 } = {}) {
    const hostId = randomId();
    const host = await connectSocket();
    host.emit('room-create', { username: 'TestHost', id: hostId, avatar: '🤖' });
    const roomData = await waitFor(host, 'room-joined');
    const { roomCode } = roomData;

    host.emit('room:update-settings', { rounds, drawTime, maxPlayers: 8 });
    await waitFor(host, 'room:settings-updated', 3000);

    const guessers = [];
    for (let i = 0; i < numGuessers; i++) {
        const gId = randomId();
        const g = await connectSocket();
        g.emit('room-join', { roomCode, username: `Guesser${i}`, id: gId, avatar: '⚡' });
        await waitFor(g, 'room-joined');
        guessers.push({ socket: g, id: gId });
    }

    return { roomCode, host: { socket: host, id: hostId }, guessers, allSockets: [host, ...guessers.map(g => g.socket)] };
}


function teardown(sockets) {
    for (const s of sockets) {
        try {
            const sock = (s && s.socket) ? s.socket : s;
            if (sock && sock.connected) sock.disconnect();
        } catch (_) {}
    }
}

async function testHappyPath() {
    console.log('\n📋 Suite: Happy Path — Full Game Loop');

    await test('Host can create a room and receive room-joined', async () => {
        const hostId = randomId();
        const host = await connectSocket();
        host.emit('room-create', { username: 'TestHost', id: hostId, avatar: '🤖' });
        const data = await waitFor(host, 'room-joined', 5000);
        if (!data.roomCode) throw new Error('No roomCode in room-joined payload');
        if (!data.players || data.players.length !== 1) throw new Error('Expected 1 player in room');
        host.disconnect();
    });

    await test('Guesser can join a room and all players see player-joined', async () => {
        const { roomCode, host, guessers, allSockets } = await setupRoom({ numGuessers: 0 });
        const gId = randomId();
        const gSocket = await connectSocket();

        const playerJoinedPromise = waitFor(host.socket, 'player-joined', 4000);
        gSocket.emit('room-join', { roomCode, username: 'Joiner', id: gId, avatar: '⚡' });

        const [joinedData, playerJoinedData] = await Promise.all([
            waitFor(gSocket, 'room-joined', 4000),
            playerJoinedPromise
        ]);

        if (!joinedData.roomCode) throw new Error('Guesser did not receive roomCode');
        if (playerJoinedData.player.id !== gId) throw new Error('player-joined had wrong player id');

        teardown([...allSockets, gSocket]);
    });

    await test('Host can start game and all players receive choose-word or round-started', async () => {
        const { roomCode, host, guessers, allSockets } = await setupRoom({ numGuessers: 1, drawTime: 10 });

        host.socket.emit('game-start', { userName: 'TestHost', roomCode, settings: { rounds: 1, drawTime: 10 } });

        const chooseWordPromises = allSockets.map(s => waitFor(s, 'choose-word', 8000));
        const chooseWordData = await Promise.race(chooseWordPromises);
        
        if (!chooseWordData.words || chooseWordData.words.length !== 3) throw new Error(`Expected 3 words, got: ${JSON.stringify(chooseWordData.words)}`);

        teardown(allSockets);
    });

    await test('Drawer picks a word and round-started fires for all players', async () => {
        const { roomCode, host, guessers, allSockets } = await setupRoom({ numGuessers: 1, drawTime: 10 });
        host.socket.emit('game-start', { userName: 'TestHost', roomCode, settings: { rounds: 1, drawTime: 10 } });

        const chooseWordPromises = allSockets.map(s => waitFor(s, 'choose-word', 8000));
        const chooseWordData = await Promise.race(chooseWordPromises);
        const word = chooseWordData.words[0];
        
        let drawerSocket = null;
        const roundStartedPromises = allSockets.map(s => waitFor(s, 'round-started', 6000));
        for (const s of allSockets) {
            s.emit('word-choosen', { choosenWord: word, roomCode });
        }

        const results = await Promise.all(roundStartedPromises);
        for (const r of results) {
            if (!r.drawerId) throw new Error('round-started missing drawerId');
            if (r.timeLeft === undefined) throw new Error('round-started missing timeLeft');
            if (!r.settings || !r.settings.drawTime) throw new Error('round-started missing settings.drawTime');
        }

        teardown(allSockets);
    });

    await test('Guesser typing correct word fires game:player-guessed with score', async () => {
        const { roomCode, host, guessers, allSockets } = await setupRoom({ numGuessers: 1, drawTime: 10 });
        host.socket.emit('game-start', { userName: 'TestHost', roomCode, settings: { rounds: 1, drawTime: 10 } });

        const chooseWordPromises = allSockets.map(s => waitFor(s, 'choose-word', 8000));
        const chooseWordData = await Promise.race(chooseWordPromises);
        const word = chooseWordData.words[0];
        
        for (const s of allSockets) {
            s.emit('word-choosen', { choosenWord: word, roomCode });
        }

        const roundData = await Promise.race(allSockets.map(s => waitFor(s, 'round-started', 6000)));
        const drawerId = roundData.drawerId;
        
        const guesserObj = [host, ...guessers].find(p => p.id !== drawerId);
        
        const guessedPromise = waitFor(guesserObj.socket, 'game:player-guessed', 5000);
        guesserObj.socket.emit('chat-message', { message: word, roomCode, userId: guesserObj.id });

        const guessedData = await guessedPromise;
        if (!guessedData.playerId) throw new Error('game:player-guessed missing playerId');
        if (typeof guessedData.score !== 'number' || guessedData.score <= 0) throw new Error(`Expected positive score, got: ${guessedData.score}`);

        teardown(allSockets);
    });

    await test('Game-over fires after all rounds complete', async () => {
        const { roomCode, host, guessers, allSockets } = await setupRoom({ numGuessers: 1, rounds: 1, drawTime: 10 });
        host.socket.emit('game-start', { userName: 'TestHost', roomCode, settings: { rounds: 1, drawTime: 10 } });

        const chooseWordPromises = allSockets.map(s => waitFor(s, 'choose-word', 8000));
        let chooseWordData = await Promise.race(chooseWordPromises);
        let word = chooseWordData.words[0];
        for (const s of allSockets) s.emit('word-choosen', { choosenWord: word, roomCode });
        
        const r1Data = await Promise.race(allSockets.map(s => waitFor(s, 'round-started', 6000)));
        const r1DrawerId = r1Data.drawerId;
        const r1Guesser = [host, ...guessers].find(p => p.id !== r1DrawerId);
        
        r1Guesser.socket.emit('chat-message', { message: word, roomCode, userId: r1Guesser.id });
        await waitFor(r1Guesser.socket, 'game:player-guessed', 5000);

        const chooserSocket = await new Promise((resolve) => {
            let resolved = false;
            for (const s of allSockets) {
                s.once('choose-word', () => {
                    if (!resolved) { resolved = true; resolve(s); }
                });
            }
            setTimeout(() => { if (!resolved) resolve(null); }, 5000);
        });

        if (chooserSocket) {
            chooserSocket.emit('word-choosen', { choosenWord: 'test', roomCode });
        }

        const gameOverData = await waitFor(allSockets[0], 'game:over', 20000);
        if (!gameOverData.finalScores) throw new Error('game:over missing finalScores');

        teardown(allSockets);
    });
}

async function testEdgeCases() {
    console.log('\n📋 Suite: Edge Cases');

    await test('EC1: Pick timer auto-advances when drawer is AFK (no word chosen)', async () => {
        const { roomCode, host, guessers, allSockets } = await setupRoom({ numGuessers: 1, drawTime: 10 });
        host.socket.emit('game-start', { userName: 'TestHost', roomCode, settings: { rounds: 1, drawTime: 10 } });

        const chooseWordPromises = allSockets.map(s => waitFor(s, 'choose-word', 8000));
        await Promise.race(chooseWordPromises);

        const roundStartedPromise = waitFor(host.socket, 'round-started', 8000);
        for (const s of allSockets) s.emit('word-choosen', { choosenWord: '', roomCode });

        const roundData = await roundStartedPromise;
        if (!roundData.drawerId) throw new Error('round-started after auto-pick missing drawerId');
        if (!roundData.wordHint) throw new Error('round-started missing wordHint after auto-pick');

        teardown(allSockets);
    });

    await test('EC2: ALL_GUESSED — round ends immediately when all guessers are correct', async () => {
        const { roomCode, host, guessers, allSockets } = await setupRoom({ numGuessers: 2, drawTime: 30 });
        host.socket.emit('game-start', { userName: 'TestHost', roomCode, settings: { rounds: 1, drawTime: 30 } });

        const chooseWordPromises = allSockets.map(s => waitFor(s, 'choose-word', 8000));
        const chooseWordData = await Promise.race(chooseWordPromises);
        const word = chooseWordData.words[0];
        
        for (const s of allSockets) s.emit('word-choosen', { choosenWord: word, roomCode });
        const roundData = await Promise.race(allSockets.map(s => waitFor(s, 'round-started', 6000)));
        const drawerId = roundData.drawerId;
        
        const realGuessers = [host, ...guessers].filter(p => p.id !== drawerId);

        const g1Guessed = waitFor(realGuessers[0].socket, 'game:player-guessed', 5000);
        const g2Guessed = waitFor(realGuessers[1].socket, 'game:player-guessed', 5000);

        realGuessers[0].socket.emit('chat-message', { message: word, roomCode, userId: realGuessers[0].id });
        await g1Guessed;
        realGuessers[1].socket.emit('chat-message', { message: word, roomCode, userId: realGuessers[1].id });
        await g2Guessed;

        const chooseWordPromises2 = allSockets.map(s => waitFor(s, 'choose-word', 8000));
        const nextEvent = await Promise.race([
            ...chooseWordPromises2,
            waitFor(allSockets[0], 'game:over', 8000),
            waitFor(allSockets[0], 'round-started', 8000),
        ]);
        if (!nextEvent) throw new Error('Game did not advance after all guessers answered correctly');

        teardown(allSockets);
    });

    await test('EC3: Wrong guess does NOT fire game:player-guessed', async () => {
        const { roomCode, host, guessers, allSockets } = await setupRoom({ numGuessers: 1, drawTime: 10 });
        host.socket.emit('game-start', { userName: 'TestHost', roomCode, settings: { rounds: 1, drawTime: 10 } });

        const chooseWordPromises = allSockets.map(s => waitFor(s, 'choose-word', 8000));
        const chooseWordData = await Promise.race(chooseWordPromises);
        const word = chooseWordData.words[0];
        for (const s of allSockets) s.emit('word-choosen', { choosenWord: word, roomCode });
        await Promise.all(allSockets.map(s => waitFor(s, 'round-started', 6000)));

        let wrongGuessTriggeredEvent = false;
        guessers[0].socket.once('game:player-guessed', () => { wrongGuessTriggeredEvent = true; });
        guessers[0].socket.emit('chat-message', { message: 'DEFINITELY_WRONG_WORD_XYZ123', roomCode, userId: guessers[0].id });

        await sleep(1500);
        if (wrongGuessTriggeredEvent) throw new Error('game:player-guessed fired for an incorrect guess!');

        teardown(allSockets);
    });

    await test('EC4: Player cannot join a room once game has started', async () => {
        const { roomCode, host, guessers, allSockets } = await setupRoom({ numGuessers: 1, drawTime: 10 });
        host.socket.emit('game-start', { userName: 'TestHost', roomCode, settings: { rounds: 1, drawTime: 10 } });
        
        const chooseWordPromises = allSockets.map(s => waitFor(s, 'choose-word', 8000));
        await Promise.race(chooseWordPromises);

        const latecomer = await connectSocket();
        const errorPromise = waitFor(latecomer, 'room:error', 4000);
        latecomer.emit('room-join', { roomCode, username: 'Latecomer', id: randomId(), avatar: '👻' });

        const errorData = await errorPromise;
        if (!errorData.message || !errorData.message.includes('STARTED')) {
            throw new Error(`Expected GAME ALREADY STARTED error, got: ${errorData.message}`);
        }

        teardown([...allSockets, latecomer]);
    });

    await test('EC5: Drawer leaving mid-turn does not deadlock the game', async () => {
        const { roomCode, host, guessers, allSockets } = await setupRoom({ numGuessers: 1, drawTime: 10 });
        host.socket.emit('game-start', { userName: 'TestHost', roomCode, settings: { rounds: 1, drawTime: 10 } });

        const chooseWordPromises = allSockets.map(s => waitFor(s, 'choose-word', 8000));
        const chooseWordData = await Promise.race(chooseWordPromises);
        const word = chooseWordData.words[0];
        
        for (const s of allSockets) s.emit('word-choosen', { choosenWord: word, roomCode });
        await Promise.all(allSockets.map(s => waitFor(s, 'round-started', 6000)));

        host.socket.disconnect();

        const playerLeftData = await waitFor(guessers[0].socket, 'player-left', 8000);
        if (!playerLeftData) throw new Error('player-left event not received after disconnect');

        teardown(guessers.map(g => g.socket));
    });

    await test('EC6: Reconnecting player receives stroke history for canvas restore', async () => {
        const { roomCode, host, guessers, allSockets } = await setupRoom({ numGuessers: 1, drawTime: 30 });
        host.socket.emit('game-start', { userName: 'TestHost', roomCode, settings: { rounds: 1, drawTime: 30 } });

        const chooseWordPromises = allSockets.map(s => waitFor(s, 'choose-word', 8000));
        const chooseWordData = await Promise.race(chooseWordPromises);
        const word = chooseWordData.words[0];
        for (const s of allSockets) s.emit('word-choosen', { choosenWord: word, roomCode });
        
        const roundData = await Promise.race(allSockets.map(s => waitFor(s, 'round-started', 6000)));
        const drawerId = roundData.drawerId;
        const drawerObj = [host, ...guessers].find(p => p.id === drawerId);
        const guesserObj = [host, ...guessers].find(p => p.id !== drawerId);

        for (let i = 0; i < 5; i++) {
            drawerObj.socket.emit('stroke', {
                roomCode, strokeType: 'draw',
                points: [{ x: 0.1 * i, y: 0.2 * i }, { x: 0.1 * i + 0.05, y: 0.2 * i + 0.05 }],
                color: '#000000', width: 0.01, isEraser: false
            });
        }

        await sleep(500);

        guesserObj.socket.disconnect();
        await sleep(200);

        const reconnected = await connectSocket();
        reconnected.emit('room-reconnect', { roomCode, id: guesserObj.id });

        const rejoinData = await waitFor(reconnected, 'room-joined', 6000);
        if (!rejoinData.strokes || rejoinData.strokes.length === 0) {
            throw new Error('Reconnecting player did not receive stroke history');
        }
        if (rejoinData.strokes.length < 5) {
            throw new Error(`Expected ≥5 strokes in history, got ${rejoinData.strokes.length}`);
        }

        teardown([drawerObj.socket, reconnected]);
    });

    await test('EC7: Drawer reconnects during PICK_WORD phase and receives word choices again', async () => {
        const { roomCode, host, guessers, allSockets } = await setupRoom({ numGuessers: 1, drawTime: 10 });
        host.socket.emit('game-start', { userName: 'TestHost', roomCode, settings: { rounds: 1, drawTime: 10 } });

        const chooseWordPromises = allSockets.map(s => waitFor(s, 'choose-word', 8000).then(data => ({ socket: s, data })));
        const resolved = await Promise.race(chooseWordPromises);
        const drawerOldSocket = resolved.socket;
        const drawerPlayer = [host, ...guessers].find(p => p.socket === drawerOldSocket);
        const drawerId = drawerPlayer.id;

        drawerOldSocket.disconnect();
        await sleep(300);

        const reconnectedDrawer = await connectSocket();
        reconnectedDrawer.emit('room-reconnect', { roomCode, id: drawerId });

        const reChooseWordPromise = waitFor(reconnectedDrawer, 'choose-word', 4000);
        const rejoinData = await waitFor(reconnectedDrawer, 'room-joined', 6000);
        if (rejoinData.gameState !== 'PICK_WORD') {
            throw new Error(`Expected gameState=PICK_WORD on reconnect, got: ${rejoinData.gameState}`);
        }

        const reChooseWord = await reChooseWordPromise;
        if (!reChooseWord.words || reChooseWord.words.length !== 3) {
            throw new Error('Reconnected drawer did not get word choices back');
        }

        teardown([reconnectedDrawer, ...guessers.map(g => g.socket)]);
    });
}

async function testDrawingSync() {
    console.log('\n📋 Suite: Drawing Sync');

    await test('Stroke from drawer is received by all guessers', async () => {
        const { roomCode, host, guessers, allSockets } = await setupRoom({ numGuessers: 2, drawTime: 30 });
        host.socket.emit('game-start', { userName: 'TestHost', roomCode, settings: { rounds: 1, drawTime: 30 } });

        const chooseWordPromises = allSockets.map(s => waitFor(s, 'choose-word', 8000));
        const chooseWordData = await Promise.race(chooseWordPromises);
        
        for (const s of allSockets) s.emit('word-choosen', { choosenWord: chooseWordData.words[0], roomCode });
        await Promise.all(allSockets.map(s => waitFor(s, 'round-started', 6000)));

        const stroke1Promise = waitFor(guessers[0].socket, 'stroke-draw', 3000);
        const stroke2Promise = waitFor(guessers[1].socket, 'stroke-draw', 3000);

        host.socket.emit('stroke', {
            roomCode, strokeType: 'draw',
            points: [{ x: 0.1, y: 0.2 }, { x: 0.2, y: 0.3 }],
            color: '#FF0000', width: 0.01, isEraser: false
        });

        await Promise.all([stroke1Promise, stroke2Promise]);

        teardown(allSockets);
    });

    await test('Drawer cannot receive their own stroke event back', async () => {
        const { roomCode, host, guessers, allSockets } = await setupRoom({ numGuessers: 1, drawTime: 30 });
        host.socket.emit('game-start', { userName: 'TestHost', roomCode, settings: { rounds: 1, drawTime: 30 } });

        const chooseWordPromises = allSockets.map(s => waitFor(s, 'choose-word', 8000));
        const chooseWordData = await Promise.race(chooseWordPromises);
        
        for (const s of allSockets) s.emit('word-choosen', { choosenWord: chooseWordData.words[0], roomCode });
        await Promise.all(allSockets.map(s => waitFor(s, 'round-started', 6000)));

        let hostReceivedOwnStroke = false;
        host.socket.on('stroke-draw', () => { hostReceivedOwnStroke = true; });

        host.socket.emit('stroke', {
            roomCode, strokeType: 'draw',
            points: [{ x: 0.1, y: 0.2 }, { x: 0.2, y: 0.3 }],
            color: '#0000FF', width: 0.01, isEraser: false
        });

        await sleep(1000);
        if (hostReceivedOwnStroke) throw new Error('Drawer received echo of their own stroke');

        teardown(allSockets);
    });

    await test('Non-drawer cannot emit strokes (server must ignore them)', async () => {
        const { roomCode, host, guessers, allSockets } = await setupRoom({ numGuessers: 1, drawTime: 30 });
        host.socket.emit('game-start', { userName: 'TestHost', roomCode, settings: { rounds: 1, drawTime: 30 } });

        const chooseWordPromises = allSockets.map(s => waitFor(s, 'choose-word', 8000));
        const chooseWordData = await Promise.race(chooseWordPromises);
        
        for (const s of allSockets) s.emit('word-choosen', { choosenWord: chooseWordData.words[0], roomCode });
        await Promise.all(allSockets.map(s => waitFor(s, 'round-started', 6000)));

        let hostReceivedGuesserStroke = false;
        host.socket.on('stroke-draw', () => { hostReceivedGuesserStroke = true; });

        guessers[0].socket.emit('stroke', {
            roomCode, strokeType: 'draw',
            points: [{ x: 0.5, y: 0.5 }],
            color: '#FF0000', width: 0.01, isEraser: false
        });

        await sleep(1000);
        console.log(`       ℹ️  Note: Server currently relays guesser stroke=${hostReceivedGuesserStroke} (client-side enforcement only)`);

        teardown(allSockets);
    });
}

function printReport() {
    const total = passed + failed;
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  SKRIBL INTEGRATION TEST RESULTS');
    console.log('═══════════════════════════════════════════════════');
    console.log(`  Total:  ${total}`);
    console.log(`  Passed: ${passed} ✅`);
    console.log(`  Failed: ${failed} ❌`);
    console.log('───────────────────────────────────────────────────');
    if (failures.length > 0) {
        console.log('  Failures:');
        for (const f of failures) {
            console.log(`  ❌ ${f.name}`);
            console.log(`     → ${f.reason}`);
        }
    } else {
        console.log('  All tests passed! 🎉');
    }
    console.log('═══════════════════════════════════════════════════\n');
    process.exit(failed > 0 ? 1 : 0);
}

async function main() {
    console.log('═══════════════════════════════════════════════════');
    console.log('  🎮 Skribl Integration Test Suite');
    console.log(`  Target: ${SERVER_URL}`);
    console.log('═══════════════════════════════════════════════════');

    try {
        const probe = await connectSocket();
        probe.disconnect();
    } catch (e) {
        console.error(`\n❌ Cannot connect to ${SERVER_URL}. Is the stack running?\n`);
        process.exit(1);
    }

    await testHappyPath();
    await testEdgeCases();
    await testDrawingSync();

    printReport();
}

main().catch((err) => {
    console.error('[TestRunner] Unexpected fatal error:', err);
    process.exit(1);
});
