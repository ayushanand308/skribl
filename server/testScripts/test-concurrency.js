const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';
const ITERATIONS = 100;

function createSocket() {
    return io(SERVER_URL, { transports: ['websocket'] });
}

function waitFor(socket, event) {
    return new Promise((resolve) => socket.once(event, resolve));
}

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function setupRoom(word, numGuessers = 1) {
    const creator = createSocket();
    const creatorId = `creator-${Math.random().toString(36).slice(2)}`;
    await waitFor(creator, 'connect');
    creator.emit('room-create', { username: 'Drawer', id: creatorId });
    const { roomCode } = await waitFor(creator, 'room-joined');

    const guessers = [];
    for (let i = 0; i < numGuessers; i++) {
        const socket = createSocket();
        const id = `guesser-${i}-${Math.random().toString(36).slice(2)}`;
        await waitFor(socket, 'connect');
        socket.emit('room-join', { username: `Guesser-${i}`, roomCode, id });
        await waitFor(socket, 'room-joined');
        guessers.push({ socket, id });
    }

    creator.emit('game-start', { roomCode, settings: { rounds: 1, drawTime: 60 } });
    await waitFor(creator, 'game-started');
    creator.emit('word-choosen', { choosenWord: word, roomCode });
    await waitFor(creator, 'round-started');

    return { roomCode, creator, guessers };
}

async function cleanup(...sockets) {
    sockets.flat().forEach(s => s?.disconnect?.() || s?.socket?.disconnect?.());
    await sleep(50);
}

async function testDoubleSubmit() {
    const word = 'banana';
    const { roomCode, creator, guessers } = await setupRoom(word, 1);
    const { socket, id } = guessers[0];

    let events = 0;
    socket.on('round-end', () => events++);

    await Promise.all([
        socket.emit('chat-message', { message: word, roomCode, userId: id }),
        socket.emit('chat-message', { message: word, roomCode, userId: id })
    ]);
    await sleep(300);

    await cleanup(creator, guessers);
    return events === 1;
}

async function testTwoSimultaneousGuessers() {
    const word = 'banana';
    const { roomCode, creator, guessers } = await setupRoom(word, 2);

    let roundEndCount = 0;
    guessers.forEach(({ socket }) => socket.on('round-end', () => roundEndCount++));

    await Promise.all(guessers.map(({ socket, id }) =>
        socket.emit('chat-message', { message: word, roomCode, userId: id })
    ));
    await sleep(300);

    await cleanup(creator, guessers);
    return roundEndCount === 2; 
}

async function testLateGuess() {
    const word = 'banana';
    const { roomCode, creator, guessers } = await setupRoom(word, 1);
    const { socket, id } = guessers[0];

    let roundEndCount = 0;
    socket.on('round-end', () => roundEndCount++);

    socket.emit('chat-message', { message: word, roomCode, userId: id });
    await sleep(300);
    socket.emit('chat-message', { message: word, roomCode, userId: id });
    await sleep(300);

    await cleanup(creator, guessers);
    return roundEndCount === 1;
}

async function run() {
    console.log(`[INFO] Running minimal concurrency test: ${ITERATIONS} iterations`);
    let passed = 0;

    for (let i = 0; i < ITERATIONS; i++) {
        const t1 = await testDoubleSubmit();
        const t2 = await testTwoSimultaneousGuessers();
        const t3 = await testLateGuess();

        if (t1 && t2 && t3) {
            passed++;
        } else {
            console.log(`[FAIL] Failed at iteration ${i + 1}`);
            process.exit(1);
        }
    }
    console.log(`[PASS] Passed all tests! (${passed}/${ITERATIONS} iterations)`);
    process.exit(0);
}

run();
