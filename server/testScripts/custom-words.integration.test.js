'use strict';

const { io } = require('socket.io-client');

const args = Object.fromEntries(
    process.argv.slice(2)
        .filter(a => a.startsWith('--'))
        .map(a => a.slice(2).split('='))
);
const SERVER_URL = args.url || 'http://127.0.0.1:3000';
const TEARDOWN_DELAY = 500;

let passed = 0;
let failed = 0;
const failures = [];

function pass(name) {
    passed++;
    console.log(`  \u2705 PASS \u2014 ${name}`);
}

function fail(name, reason) {
    failed++;
    failures.push({ name, reason });
    console.log(`  \u274C FAIL \u2014 ${name}`);
    console.log(`         \u2192 ${reason}`);
}

async function test(name, fn) {
    try {
        await fn();
        pass(name);
    } catch (err) {
        fail(name, err.message || String(err));
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
        socket.once(event, data => {
            clearTimeout(timer);
            resolve(data);
        });
    });
}

function waitForNot(socket, event, windowMs = 1500) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve('NOT_FIRED'), windowMs);
        socket.once(event, data => {
            clearTimeout(timer);
            reject(new Error(`Event "${event}" fired unexpectedly: ${JSON.stringify(data)}`));
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

function teardown(sockets) {
    for (const s of sockets) {
        try {
            const sock = (s && s.socket) ? s.socket : s;
            if (sock && sock.connected) sock.disconnect();
        } catch (_) {}
    }
}


async function setupRoom({
    numGuessers = 1,
    rounds = 1,
    drawTime = 10,
    customWords = [],
    customWordsOnly = false,
    customTheme = 'Default'
} = {}) {
    const hostId = randomId();
    const host = await connectSocket();
    host.emit('room-create', { username: 'TestHost', id: hostId, avatar: '\uD83E\uDD16' });
    const roomData = await waitFor(host, 'room-joined');
    const { roomCode } = roomData;

    host.emit('room:update-settings', { rounds, drawTime, maxPlayers: 8 });
    await waitFor(host, 'room:settings-updated', 4000);

    if (customWords.length > 0 || customWordsOnly || customTheme !== 'Default') {
        host.emit('room:update-settings', { customWords, customWordsOnly, customTheme });
        await waitFor(host, 'room:settings-updated', 4000);
    }

    const guessers = [];
    for (let i = 0; i < numGuessers; i++) {
        const gId = randomId();
        const g = await connectSocket();
        g.emit('room-join', { roomCode, username: `Guesser${i}`, id: gId, avatar: '\u26A1' });
        await waitFor(g, 'room-joined');
        guessers.push({ socket: g, id: gId });
    }

    return {
        roomCode,
        host: { socket: host, id: hostId },
        guessers,
        allSockets: [host, ...guessers.map(g => g.socket)],
    };
}

async function advanceToDraw(allSockets, roomCode) {
    const chooseWordData = await Promise.race(
        allSockets.map(s => waitFor(s, 'choose-word', 10000))
    );
    const word = chooseWordData.words[0];
    for (const s of allSockets) {
        s.emit('word-choosen', { choosenWord: word, roomCode });
    }
    await Promise.race(allSockets.map(s => waitFor(s, 'round-started', 8000)));
    return { word, chosenWords: chooseWordData.words };
}


async function testSettingsSync() {
    console.log('\n\uD83D\uDCCB Suite 1: Settings Sync & Spoiler Prevention');

    await test('SS1: Host receives full customWords array in room:settings-updated', async () => {
        const { host, guessers, allSockets } = await setupRoom({ numGuessers: 1 });
        const customWords = ['pizza', 'sushi', 'burger', 'taco', 'pasta'];
        host.socket.emit('room:update-settings', { customWords, customTheme: 'Food', customWordsOnly: false });
        const data = await waitFor(host.socket, 'room:settings-updated', 5000);
        teardown(allSockets);
        if (!Array.isArray(data.settings.customWords)) {
            throw new Error(`Host settings.customWords must be an array, got: ${JSON.stringify(data.settings.customWords)}`);
        }
        if (data.settings.customWords.length !== 5) {
            throw new Error(`Expected 5 custom words for host, got ${data.settings.customWords.length}`);
        }
        for (const w of customWords) {
            if (!data.settings.customWords.includes(w)) {
                throw new Error(`Word "${w}" missing from host customWords`);
            }
        }
    });

    await test('SS2: Guest receives only a count (NOT the raw word list) in room:settings-updated', async () => {
        const { host, guessers, allSockets } = await setupRoom({ numGuessers: 1 });
        const customWords = ['javascript', 'docker', 'linux', 'git', 'cloud'];
        const guestUpdated = waitFor(guessers[0].socket, 'room:settings-updated', 5000);
        host.socket.emit('room:update-settings', { customWords, customTheme: 'Tech & Dev', customWordsOnly: false });
        const data = await guestUpdated;
        teardown(allSockets);
        if ('customWords' in data.settings) {
            throw new Error(`Guest MUST NOT receive customWords array. Got: ${JSON.stringify(data.settings.customWords)}`);
        }
        if (typeof data.settings.customWordsCount !== 'number') {
            throw new Error(`Guest must receive customWordsCount (number), got: ${JSON.stringify(data.settings)}`);
        }
        if (data.settings.customWordsCount !== 5) {
            throw new Error(`Expected customWordsCount=5, got ${data.settings.customWordsCount}`);
        }
    });

    await test('SS3: Guest receives correct theme name and customWordsOnly flag without raw words', async () => {
        const { host, guessers, allSockets } = await setupRoom({ numGuessers: 1 });
        const guestUpdated = waitFor(guessers[0].socket, 'room:settings-updated', 5000);
        host.socket.emit('room:update-settings', {
            customWords: ['naruto', 'pokemon', 'sonic'],
            customTheme: 'Gaming & Anime',
            customWordsOnly: true
        });
        const data = await guestUpdated;
        teardown(allSockets);
        if (data.settings.customTheme !== 'Gaming & Anime') {
            throw new Error(`Expected theme "Gaming & Anime", got "${data.settings.customTheme}"`);
        }
        if (!data.settings.customWordsOnly) {
            throw new Error('Expected customWordsOnly=true in guest settings');
        }
        if ('customWords' in data.settings) {
            throw new Error('Guest MUST NOT receive customWords array');
        }
    });

    await test('SS4: Non-host emitting room:update-settings is silently ignored (no host update emitted)', async () => {
        const { host, guessers, allSockets } = await setupRoom({ numGuessers: 1 });
        const hostGotUpdate = waitForNot(host.socket, 'room:settings-updated', 1800);
        guessers[0].socket.emit('room:update-settings', {
            customWords: ['hacked', 'injected'],
            customTheme: 'Hacked',
            customWordsOnly: true
        });
        await hostGotUpdate; 
        teardown(allSockets);
    });

    await test('SS5: Reconnecting player receives correct custom-words settings (host=full array, guest=count)', async () => {

        const customWords = ['alpha', 'beta', 'gamma'];

        const { host, guessers, allSockets, roomCode } = await setupRoom({
            numGuessers: 2, drawTime: 30,
            customWords, customWordsOnly: false
        });

        host.socket.emit('game-start', {
            userName: 'TestHost', roomCode,
            settings: { rounds: 1, drawTime: 30, customWords, customWordsOnly: false, customTheme: 'Custom' }
        });
        await Promise.race(allSockets.map(s => waitFor(s, 'choose-word', 10000)));

        host.socket.disconnect();
        await sleep(500);

        const reconnected = await connectSocket();
        reconnected.emit('room-reconnect', { roomCode, id: host.id });
        const rejoined = await waitFor(reconnected, 'room-joined', 6000);
        teardown([reconnected, ...guessers.map(g => g.socket)]);

        const s = rejoined.settings;
        const wordCount = Array.isArray(s.customWords)
            ? s.customWords.length
            : (typeof s.customWordsCount === 'number' ? s.customWordsCount : -1);

        if (wordCount !== customWords.length) {
            throw new Error(
                `Custom word info wrong after reconnect. Expected count=${customWords.length}, ` +
                `got wordCount=${wordCount}. Full settings: ${JSON.stringify(s)}`
            );
        }
        if (Array.isArray(s.customWords)) {
            for (const w of customWords) {
                if (!s.customWords.includes(w)) {
                    throw new Error(`Missing word "${w}" from host's customWords after reconnect`);
                }
            }
        }
    });

    await test('SS6: Late-joining guest does NOT see raw customWords in room-joined', async () => {
        const { host, guessers, allSockets, roomCode } = await setupRoom({ numGuessers: 1 });
        host.socket.emit('room:update-settings', {
            customWords: ['secret1', 'secret2', 'secret3'],
            customTheme: 'Custom'
        });
        await waitFor(host.socket, 'room:settings-updated', 4000);

        const gId = randomId();
        const g2 = await connectSocket();
        g2.emit('room-join', { roomCode, username: 'LateJoiner', id: gId, avatar: '\uD83D\uDC31' });
        const joined = await waitFor(g2, 'room-joined', 5000);
        teardown([...allSockets, g2]);

        if ('customWords' in (joined.settings || {})) {
            throw new Error(`Late-joining guest received raw customWords: ${JSON.stringify(joined.settings.customWords)}`);
        }
        if (joined.settings.customWordsCount !== 3) {
            throw new Error(`Expected customWordsCount=3 for late joiner, got ${joined.settings.customWordsCount}`);
        }
    });
}


async function testCustomWordsHappyPath() {
    console.log('\n\uD83D\uDCCB Suite 2: Happy Path \u2014 Custom Words in Game');

    await test('CW1: Blended mode offers at least 1 custom word in the choose-word payload', async () => {
        const customWords = ['quantum', 'nebula', 'vortex', 'axiom', 'zenith', 'pulsar'];
        const { host, guessers, allSockets, roomCode } = await setupRoom({
            numGuessers: 1, drawTime: 15, customWords, customWordsOnly: false,
        });
        host.socket.emit('game-start', {
            userName: 'TestHost', roomCode,
            settings: { rounds: 1, drawTime: 15, customWords, customWordsOnly: false, customTheme: 'Custom' }
        });

        const chooseWordData = await Promise.race(
            allSockets.map(s => waitFor(s, 'choose-word', 10000))
        );
        teardown(allSockets);

        if (!chooseWordData.words || chooseWordData.words.length !== 3) {
            throw new Error(`Expected 3 words in choose-word, got: ${JSON.stringify(chooseWordData.words)}`);
        }
        const hasCustom = chooseWordData.words.some(w => customWords.includes(w));
        if (!hasCustom) {
            throw new Error(`Blended mode: none of [${chooseWordData.words}] came from custom list [${customWords}]`);
        }
    });

    await test('CW2: Exclusive mode — ALL 3 words in choose-word come from custom list', async () => {
        const customWords = [
            'photon', 'quasar', 'nebula', 'pulsar', 'meteor',
            'comet', 'galaxy', 'orbit', 'cosmos', 'nova'
        ];
        const { host, guessers, allSockets, roomCode } = await setupRoom({
            numGuessers: 1, drawTime: 15, customWords, customWordsOnly: true,
        });
        host.socket.emit('game-start', {
            userName: 'TestHost', roomCode,
            settings: { rounds: 1, drawTime: 15, customWords, customWordsOnly: true, customTheme: 'Space' }
        });

        const chooseWordData = await Promise.race(
            allSockets.map(s => waitFor(s, 'choose-word', 10000))
        );
        teardown(allSockets);

        if (!chooseWordData.words || chooseWordData.words.length !== 3) {
            throw new Error(`Expected 3 words, got: ${JSON.stringify(chooseWordData.words)}`);
        }
        for (const w of chooseWordData.words) {
            if (!customWords.includes(w)) {
                throw new Error(`Exclusive mode: word "${w}" NOT in custom list ${JSON.stringify(customWords)}`);
            }
        }
    });

    await test('CW3: choose-word payload has NO duplicate words within a single turn', async () => {
        const customWords = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];
        const { host, guessers, allSockets, roomCode } = await setupRoom({
            numGuessers: 1, drawTime: 15, customWords, customWordsOnly: true
        });
        host.socket.emit('game-start', {
            userName: 'TestHost', roomCode,
            settings: { rounds: 1, drawTime: 15, customWords, customWordsOnly: true }
        });
        const data = await Promise.race(allSockets.map(s => waitFor(s, 'choose-word', 10000)));
        teardown(allSockets);
        const unique = new Set(data.words);
        if (unique.size !== data.words.length) {
            throw new Error(`Duplicate words in choose-word payload: ${JSON.stringify(data.words)}`);
        }
    });

    await test('CW4: Guesser correctly guesses a custom word and earns a positive score', async () => {
        const customWords = [
            'xtremeuniqueword1', 'xtremeuniqueword2', 'xtremeuniqueword3',
            'xtremeuniqueword4', 'xtremeuniqueword5', 'xtremeuniqueword6'
        ];
        const { host, guessers, allSockets, roomCode } = await setupRoom({
            numGuessers: 1, drawTime: 30, customWords, customWordsOnly: true
        });
        host.socket.emit('game-start', {
            userName: 'TestHost', roomCode,
            settings: { rounds: 1, drawTime: 30, customWords, customWordsOnly: true }
        });

        const chooseData = await Promise.race(allSockets.map(s => waitFor(s, 'choose-word', 10000)));
        const word = chooseData.words[0];
        for (const s of allSockets) s.emit('word-choosen', { choosenWord: word, roomCode });
        const roundData = await Promise.race(allSockets.map(s => waitFor(s, 'round-started', 8000)));
        const drawerId = roundData.drawerId;

        const guesserObj = [{ socket: host.socket, id: host.id }, ...guessers].find(p => p.id !== drawerId);
        if (!guesserObj) throw new Error('Could not find non-drawer guesser');

        const guessedPromise = waitFor(guesserObj.socket, 'game:player-guessed', 6000);
        guesserObj.socket.emit('chat-message', { message: word, roomCode, userId: guesserObj.id });
        const guessedData = await guessedPromise;
        teardown(allSockets);

        if (!guessedData.playerId) throw new Error('game:player-guessed missing playerId');
        if (typeof guessedData.score !== 'number' || guessedData.score <= 0) {
            throw new Error(`Expected positive score, got: ${guessedData.score}`);
        }
        if (!customWords.includes(word)) {
            throw new Error(`Picked word "${word}" was not in custom list`);
        }
    });

    await test('CW5: Drawer picks word from choose-word — only THAT word is accepted as correct guess', async () => {
        const customWords = ['uniquewordA1', 'uniquewordB2', 'uniquewordC3', 'uniquewordD4', 'uniquewordE5', 'uniquewordF6'];
        const { host, guessers, allSockets, roomCode } = await setupRoom({
            numGuessers: 1, drawTime: 30, customWords, customWordsOnly: true
        });
        host.socket.emit('game-start', {
            userName: 'TestHost', roomCode,
            settings: { rounds: 1, drawTime: 30, customWords, customWordsOnly: true }
        });

        const chooseData = await Promise.race(allSockets.map(s => waitFor(s, 'choose-word', 10000)));
        const correctWord = chooseData.words[0];
        const wrongWord = chooseData.words[1];
        for (const s of allSockets) s.emit('word-choosen', { choosenWord: correctWord, roomCode });
        const roundData = await Promise.race(allSockets.map(s => waitFor(s, 'round-started', 8000)));
        const drawerId = roundData.drawerId;

        const guesserObj = [{ socket: host.socket, id: host.id }, ...guessers].find(p => p.id !== drawerId);
        if (!guesserObj) throw new Error('Could not find non-drawer guesser');

        let wrongFired = false;
        guesserObj.socket.once('game:player-guessed', () => { wrongFired = true; });
        guesserObj.socket.emit('chat-message', { message: wrongWord, roomCode, userId: guesserObj.id });
        await sleep(1200);
        teardown(allSockets);
        if (wrongFired) throw new Error(`game:player-guessed fired for WRONG word "${wrongWord}" (correct was "${correctWord}")`);
    });

    await test('CW6: No word repeats across consecutive turns in multi-round game (exclusive mode)', async () => {
        const customWords = [
            'xwA', 'xwB', 'xwC', 'xwD', 'xwE', 'xwF', 'xwG',
            'xwH', 'xwI', 'xwJ', 'xwK', 'xwL', 'xwM', 'xwN', 'xwO'
        ];
        const { host, guessers, allSockets, roomCode } = await setupRoom({
            numGuessers: 1, rounds: 2, drawTime: 12, customWords, customWordsOnly: true
        });
        host.socket.emit('game-start', {
            userName: 'TestHost', roomCode,
            settings: { rounds: 2, drawTime: 12, customWords, customWordsOnly: true }
        });

        const usedWords = [];
        for (let turn = 0; turn < 6; turn++) { // 2 players * 2 rounds = 4 turns max
            let chooseData;
            try {
                chooseData = await Promise.race([
                    ...allSockets.map(s => waitFor(s, 'choose-word', 15000)),
                    waitFor(allSockets[0], 'game:over', 6000).then(() => null)
                ]);
            } catch (_) { break; }
            if (!chooseData || !chooseData.words) break;

            const picked = chooseData.words[0];
            usedWords.push(picked);
            for (const s of allSockets) s.emit('word-choosen', { choosenWord: picked, roomCode });
            try {
                await Promise.race(allSockets.map(s => waitFor(s, 'round-started', 8000)));
            } catch (_) { break; }
        }
        teardown(allSockets);

        const unique = new Set(usedWords);
        if (unique.size < usedWords.length) {
            throw new Error(`Word repeated across turns! Used: ${JSON.stringify(usedWords)}`);
        }
    });

    await test('CW7: Gaming themed preset — exclusive mode only serves Gaming pack words', async () => {
        const gamingWords = [
            'pokemon', 'minecraft', 'super mario', 'naruto', 'sonic', 'fortnite',
            'among us', 'dragon ball', 'zelda', 'pacman', 'roblox', 'one piece', 'cyberpunk'
        ];
        const { host, guessers, allSockets, roomCode } = await setupRoom({
            numGuessers: 1, drawTime: 15, customWords: gamingWords, customWordsOnly: true, customTheme: 'Gaming & Anime'
        });
        host.socket.emit('game-start', {
            userName: 'TestHost', roomCode,
            settings: { rounds: 1, drawTime: 15, customWords: gamingWords, customWordsOnly: true, customTheme: 'Gaming & Anime' }
        });

        const data = await Promise.race(allSockets.map(s => waitFor(s, 'choose-word', 10000)));
        teardown(allSockets);
        for (const w of data.words) {
            if (!gamingWords.includes(w)) {
                throw new Error(`Exclusive Gaming mode: word "${w}" is NOT in Gaming pack`);
            }
        }
    });
}



async function testWordBankEdgeCases() {
    console.log('\n\uD83D\uDCCB Suite 3: Edge Cases \u2014 Word Sanitization & Fallback');

    await test('EC-W1: HTML/script injection in word list is sanitized — no raw HTML in word choices', async () => {
        const dirtyWords = ['<script>alert(1)</script>', 'valid-word', 'another', 'good-one', 'testword', 'extra'];
        const { host, guessers, allSockets, roomCode } = await setupRoom({
            numGuessers: 1, drawTime: 15, customWords: dirtyWords, customWordsOnly: true
        });
        host.socket.emit('game-start', {
            userName: 'TestHost', roomCode,
            settings: { rounds: 1, drawTime: 15, customWords: dirtyWords, customWordsOnly: true }
        });

        const data = await Promise.race(allSockets.map(s => waitFor(s, 'choose-word', 10000)));
        teardown(allSockets);
        for (const w of data.words) {
            if (/<|>/.test(w)) {
                throw new Error(`Sanitization FAILED \u2014 HTML tag in word: "${w}"`);
            }
        }
    });

    await test('EC-W2: Special chars (!@#$%) stripped — game still starts with valid fallback words', async () => {
        const dirtyWords = ['hello!', '@@bad@@', '#hash', 'good-word', 'valid', 'safe-one'];
        const { host, guessers, allSockets, roomCode } = await setupRoom({
            numGuessers: 1, drawTime: 15, customWords: dirtyWords, customWordsOnly: false
        });
        host.socket.emit('game-start', {
            userName: 'TestHost', roomCode,
            settings: { rounds: 1, drawTime: 15, customWords: dirtyWords, customWordsOnly: false }
        });

        const data = await Promise.race(allSockets.map(s => waitFor(s, 'choose-word', 10000)));
        teardown(allSockets);
        if (!data.words || data.words.length !== 3) {
            throw new Error(`Expected 3 words (with standard fill), got: ${JSON.stringify(data.words)}`);
        }
    });

    await test('EC-W3: Empty custom list in exclusive mode falls back to standard word bank', async () => {
        const { host, guessers, allSockets, roomCode } = await setupRoom({
            numGuessers: 1, drawTime: 15, customWords: [], customWordsOnly: true
        });
        host.socket.emit('game-start', {
            userName: 'TestHost', roomCode,
            settings: { rounds: 1, drawTime: 15, customWords: [], customWordsOnly: true }
        });
        const data = await Promise.race(allSockets.map(s => waitFor(s, 'choose-word', 10000)));
        teardown(allSockets);
        if (!data.words || data.words.length !== 3) {
            throw new Error(`Expected fallback to 3 standard words, got: ${JSON.stringify(data.words)}`);
        }
    });

    await test('EC-W4: Only 1 valid custom word in list — blended mode fills the rest from standard bank', async () => {
        const { host, guessers, allSockets, roomCode } = await setupRoom({
            numGuessers: 1, drawTime: 15,
            customWords: ['only-one-valid!!!', '   ', '<bad>', 'z-o-k'],
            customWordsOnly: false
        });
        host.socket.emit('game-start', {
            userName: 'TestHost', roomCode,
            settings: { rounds: 1, drawTime: 15, customWords: ['only-one-valid!!!', '   ', '<bad>', 'z-o-k'], customWordsOnly: false }
        });
        const data = await Promise.race(allSockets.map(s => waitFor(s, 'choose-word', 10000)));
        teardown(allSockets);
        if (!data.words || data.words.length !== 3) {
            throw new Error(`Expected 3 words (standard fill), got: ${JSON.stringify(data.words)}`);
        }
    });

    await test('EC-W5: Whitespace-only strings are rejected — no blank words in word choices', async () => {
        const { host, guessers, allSockets, roomCode } = await setupRoom({
            numGuessers: 1, drawTime: 15,
            customWords: ['   ', '\t', '\n', '\r\n', 'valid-word', 'also-valid', 'and-this'],
            customWordsOnly: true
        });
        host.socket.emit('game-start', {
            userName: 'TestHost', roomCode,
            settings: {
                rounds: 1, drawTime: 15,
                customWords: ['   ', '\t', '\n', '\r\n', 'valid-word', 'also-valid', 'and-this'],
                customWordsOnly: true
            }
        });
        const data = await Promise.race(allSockets.map(s => waitFor(s, 'choose-word', 10000)));
        teardown(allSockets);
        for (const w of data.words) {
            if (!w || w.trim() === '') {
                throw new Error(`Whitespace word passed sanitization: "${w}"`);
            }
        }
    });

    await test('EC-W6: Word longer than 32 chars is rejected — shorter words still appear', async () => {
        const longWord = 'a'.repeat(33);
        const { host, guessers, allSockets, roomCode } = await setupRoom({
            numGuessers: 1, drawTime: 15,
            customWords: [longWord, 'legit-word', 'also-fine', 'short', 'one-more', 'extra-one'],
            customWordsOnly: true
        });
        host.socket.emit('game-start', {
            userName: 'TestHost', roomCode,
            settings: {
                rounds: 1, drawTime: 15,
                customWords: [longWord, 'legit-word', 'also-fine', 'short', 'one-more', 'extra-one'],
                customWordsOnly: true
            }
        });
        const data = await Promise.race(allSockets.map(s => waitFor(s, 'choose-word', 10000)));
        teardown(allSockets);
        if (data.words.includes(longWord)) {
            throw new Error(`Word with ${longWord.length} chars should be rejected but appeared in word list`);
        }
    });

    await test('EC-W7: Single-char words (length < 2) are rejected by sanitizeWords', async () => {
        const { host, guessers, allSockets, roomCode } = await setupRoom({
            numGuessers: 1, drawTime: 15,
            customWords: ['a', 'b', 'c', 'ok', 'yes', 'cat'],
            customWordsOnly: true
        });
        host.socket.emit('game-start', {
            userName: 'TestHost', roomCode,
            settings: { rounds: 1, drawTime: 15, customWords: ['a', 'b', 'c', 'ok', 'yes', 'cat'], customWordsOnly: true }
        });
        const data = await Promise.race(allSockets.map(s => waitFor(s, 'choose-word', 10000)));
        teardown(allSockets);
        for (const w of data.words) {
            if (w.length < 2) {
                throw new Error(`Single-char word "${w}" passed sanitization`);
            }
        }
    });

    await test('EC-W8: Duplicate custom words are deduplicated before being stored (host count is reduced)', async () => {
        const { host, guessers, allSockets } = await setupRoom({ numGuessers: 1 });
        const dupeWords = ['cat', 'cat', 'dog', 'dog', 'bird', 'bird', 'cat', 'dog'];
        const hostUpdate = waitFor(host.socket, 'room:settings-updated', 5000);
        host.socket.emit('room:update-settings', { customWords: dupeWords, customTheme: 'Custom' });
        const data = await hostUpdate;
        teardown(allSockets);
        const count = (data.settings.customWords || []).length;
        if (count >= dupeWords.length) {
            throw new Error(`Dedup failed: got ${count} words from ${dupeWords.length} input with dupes`);
        }
        if (count !== 3) {
            throw new Error(`Expected 3 unique words after dedup (cat, dog, bird), got ${count}: ${JSON.stringify(data.settings.customWords)}`);
        }
    });

    await test('EC-W9: Words with uppercase are lowercased and still sanitized correctly', async () => {
        const mixedCase = ['HELLO', 'World', 'PIZZA', 'Sushi', 'TACO'];
        const { host, guessers, allSockets } = await setupRoom({ numGuessers: 1 });
        const hostUpdate = waitFor(host.socket, 'room:settings-updated', 5000);
        host.socket.emit('room:update-settings', { customWords: mixedCase, customTheme: 'Case Test' });
        const data = await hostUpdate;
        teardown(allSockets);
        for (const w of (data.settings.customWords || [])) {
            if (w !== w.toLowerCase()) {
                throw new Error(`Word "${w}" was not lowercased during sanitization`);
            }
        }
    });

    await test('EC-W10: Custom word list survives game:over — available again on game:play-again (back-to-lobby + re-start)', async () => {
        const customWords = ['rv1', 'rv2', 'rv3', 'rv4', 'rv5', 'rv6', 'rv7', 'rv8', 'rv9', 'rv10'];
        const { host, guessers, allSockets, roomCode } = await setupRoom({
            numGuessers: 1, rounds: 1, drawTime: 10, customWords, customWordsOnly: true
        });
        host.socket.emit('game-start', {
            userName: 'TestHost', roomCode,
            settings: { rounds: 1, drawTime: 10, customWords, customWordsOnly: true }
        });

        for (let turn = 0; turn < 8; turn++) {
            let chooseData;
            try {
                chooseData = await Promise.race([
                    ...allSockets.map(s => waitFor(s, 'choose-word', 12000)),
                    waitFor(allSockets[0], 'game:over', 3000).then(() => null)
                ]);
            } catch (_) { break; }
            if (!chooseData || !chooseData.words) break;
            const word = chooseData.words[0];
            for (const s of allSockets) s.emit('word-choosen', { choosenWord: word, roomCode });
            try {
                await Promise.race(allSockets.map(s => waitFor(s, 'round-started', 8000)));
            } catch (_) { break; }
        }

        const gameOver = await waitFor(allSockets[0], 'game:over', 30000);
        if (!gameOver.finalScores) throw new Error('game:over missing finalScores');

        host.socket.emit('game:play-again', { roomCode });
        await waitFor(host.socket, 'game:back-to-lobby', 5000);

        host.socket.emit('game-start', {
            userName: 'TestHost', roomCode,
            settings: { rounds: 1, drawTime: 10, customWords, customWordsOnly: true }
        });
        const chooseData2 = await Promise.race(allSockets.map(s => waitFor(s, 'choose-word', 12000)));
        teardown(allSockets);

        if (!chooseData2.words || chooseData2.words.length !== 3) {
            throw new Error(`Expected 3 words after play-again + restart, got: ${JSON.stringify(chooseData2.words)}`);
        }
        for (const w of chooseData2.words) {
            if (!customWords.includes(w)) {
                throw new Error(`After play-again, word "${w}" not from custom list`);
            }
        }
    });
}

async function testSettingsUpdateEdgeCases() {
    console.log('\n\uD83D\uDCCB Suite 4: Settings Update Edge Cases');

    await test('SU1: Multiple sequential updates — last update wins, no stale words from earlier', async () => {
        const { host, guessers, allSockets } = await setupRoom({ numGuessers: 1 });

        host.socket.emit('room:update-settings', { customWords: ['first', 'batch', 'of', 'words'] });
        await waitFor(host.socket, 'room:settings-updated', 4000);

        const secondWords = ['final', 'words', 'set', 'here', 'xyz'];
        host.socket.emit('room:update-settings', { customWords: secondWords, customTheme: 'Custom' });
        const data = await waitFor(host.socket, 'room:settings-updated', 4000);
        teardown(allSockets);

        const count = (data.settings.customWords || []).length;
        if (count !== secondWords.length) {
            throw new Error(`Expected ${secondWords.length} words after second update, got ${count}: ${JSON.stringify(data.settings.customWords)}`);
        }
        for (const stale of ['first', 'batch', 'of']) {
            if ((data.settings.customWords || []).includes(stale)) {
                throw new Error(`Stale word "${stale}" from first update still present after second update`);
            }
        }
    });

    await test('SU2: Clearing custom words resets count to 0 and theme to Default', async () => {
        const { host, guessers, allSockets } = await setupRoom({ numGuessers: 1 });

        host.socket.emit('room:update-settings', { customWords: ['abc', 'def', 'ghi'], customTheme: 'Custom' });
        await waitFor(host.socket, 'room:settings-updated', 4000);

        host.socket.emit('room:update-settings', { customWords: [], customTheme: 'Default' });
        const data = await waitFor(host.socket, 'room:settings-updated', 4000);
        teardown(allSockets);

        const count = (data.settings.customWords || []).length;
        if (count !== 0) {
            throw new Error(`Expected 0 customWords after clear, got ${count}`);
        }
        if (data.settings.customTheme !== 'Default') {
            throw new Error(`Expected theme "Default" after clear, got "${data.settings.customTheme}"`);
        }
    });

    await test('SU3: customWordsOnly toggle — turns on then off, both states are persisted', async () => {
        const { host, guessers, allSockets } = await setupRoom({ numGuessers: 1 });

        host.socket.emit('room:update-settings', { customWordsOnly: true });
        const d1 = await waitFor(host.socket, 'room:settings-updated', 4000);
        if (!d1.settings.customWordsOnly) throw new Error('customWordsOnly should be true after enabling');

        host.socket.emit('room:update-settings', { customWordsOnly: false });
        const d2 = await waitFor(host.socket, 'room:settings-updated', 4000);
        teardown(allSockets);
        if (d2.settings.customWordsOnly) throw new Error('customWordsOnly should be false after disabling');
    });

    await test('SU4: customTheme string preserved exactly including spaces and ampersands', async () => {
        const { host, guessers, allSockets } = await setupRoom({ numGuessers: 1 });
        const themeName = 'Tech & Dev 2024!@#special';
        host.socket.emit('room:update-settings', { customTheme: themeName });
        const data = await waitFor(host.socket, 'room:settings-updated', 4000);
        teardown(allSockets);
        if (data.settings.customTheme !== themeName) {
            throw new Error(`Expected customTheme "${themeName}", got "${data.settings.customTheme}"`);
        }
    });

    await test('SU5: Large word list (200 words) stored without crash or truncation', async () => {
        const { host, guessers, allSockets } = await setupRoom({ numGuessers: 1 });
        const bigList = Array.from({ length: 200 }, (_, i) => `word${i}`);
        host.socket.emit('room:update-settings', { customWords: bigList, customTheme: 'Bulk' });
        const data = await waitFor(host.socket, 'room:settings-updated', 8000);
        teardown(allSockets);
        if (!Array.isArray(data.settings.customWords)) {
            throw new Error('Expected customWords array for large list');
        }
        if (data.settings.customWords.length !== 200) {
            throw new Error(`Expected 200 words stored, got ${data.settings.customWords.length}`);
        }
    });

    await test('SU6: game-start customWords override lobby customWords for the game session', async () => {
        const lobbyWords = ['lobby1', 'lobby2', 'lobby3', 'lobby4', 'lobby5', 'lobby6'];
        const startWords = ['start1', 'start2', 'start3', 'start4', 'start5', 'start6'];

        const { host, guessers, allSockets, roomCode } = await setupRoom({
            numGuessers: 1, drawTime: 12, customWords: lobbyWords, customWordsOnly: true
        });

        host.socket.emit('game-start', {
            userName: 'TestHost', roomCode,
            settings: { rounds: 1, drawTime: 12, customWords: startWords, customWordsOnly: true }
        });

        const data = await Promise.race(allSockets.map(s => waitFor(s, 'choose-word', 10000)));
        teardown(allSockets);

        for (const w of data.words) {
            if (!startWords.includes(w)) {
                throw new Error(`game-start override failed \u2014 word "${w}" from lobby list instead of start list`);
            }
        }
    });
}


async function testConcurrencyEdgeCases() {
    console.log('\n\uD83D\uDCCB Suite 5: Concurrency & Race Conditions');

    await test('CC1: Two rapid room:update-settings — final state is consistent (not interleaved)', async () => {
        const { host, guessers, allSockets } = await setupRoom({ numGuessers: 1 });
        const firstWords = ['first1', 'first2', 'first3'];
        const secondWords = ['second1', 'second2', 'second3', 'second4', 'second5'];

        host.socket.emit('room:update-settings', { customWords: firstWords });
        host.socket.emit('room:update-settings', { customWords: secondWords, customTheme: 'Final' });

        const updates = [];
        for (let i = 0; i < 2; i++) {
            try {
                const d = await waitFor(host.socket, 'room:settings-updated', 4000);
                updates.push(d);
            } catch (_) { break; }
        }
        teardown(allSockets);

        const lastUpdate = updates[updates.length - 1];
        if (!lastUpdate || !lastUpdate.settings.customWords) {
            throw new Error('No settings-updated received');
        }
        const finalWords = lastUpdate.settings.customWords;
        const isFirst  = firstWords.every(w => finalWords.includes(w))  && finalWords.length === firstWords.length;
        const isSecond = secondWords.every(w => finalWords.includes(w)) && finalWords.length === secondWords.length;
        if (!isFirst && !isSecond) {
            throw new Error(`Final word list is neither first nor second set \u2014 possible corruption: ${JSON.stringify(finalWords)}`);
        }
    });

    await test('CC2: customWordsOnly persists even after other settings (rounds, drawTime) change', async () => {
        const { host, guessers, allSockets } = await setupRoom({ numGuessers: 1 });

        host.socket.emit('room:update-settings', { customWordsOnly: true, customWords: ['w1', 'w2', 'w3'] });
        await waitFor(host.socket, 'room:settings-updated', 4000);

        host.socket.emit('room:update-settings', { rounds: 5, drawTime: 45 });
        const data = await waitFor(host.socket, 'room:settings-updated', 4000);
        teardown(allSockets);

        if (!data.settings.customWordsOnly) {
            throw new Error('customWordsOnly was reset to false after updating numeric settings');
        }
        if (data.settings.rounds !== 5 || data.settings.drawTime !== 45) {
            throw new Error(`Expected rounds=5,drawTime=45, got ${JSON.stringify(data.settings)}`);
        }
    });

    await test('CC3: Custom words persist after interleaved settings updates during game start race', async () => {
        const customWords = ['persist1', 'persist2', 'persist3', 'persist4', 'persist5', 'persist6'];
        const { host, guessers, allSockets, roomCode } = await setupRoom({ numGuessers: 1 });

        host.socket.emit('room:update-settings', { customWords, customTheme: 'Persist', customWordsOnly: true });
        host.socket.emit('game-start', {
            userName: 'TestHost', roomCode,
            settings: { rounds: 1, drawTime: 12, customWords, customWordsOnly: true, customTheme: 'Persist' }
        });

        const chooseData = await Promise.race(allSockets.map(s => waitFor(s, 'choose-word', 12000)));
        teardown(allSockets);

        if (!chooseData.words || chooseData.words.length !== 3) {
            throw new Error(`Expected 3 words despite race, got: ${JSON.stringify(chooseData.words)}`);
        }
        for (const w of chooseData.words) {
            if (!customWords.includes(w)) {
                throw new Error(`Race condition leaked standard word "${w}" into exclusive custom game`);
            }
        }
    });
}


function printReport() {
    const total = passed + failed;
    console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
    console.log('  SKRIBL CUSTOM WORDS \u2014 INTEGRATION TEST RESULTS');
    console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
    console.log(`  Total:  ${total}`);
    console.log(`  Passed: ${passed} \u2705`);
    console.log(`  Failed: ${failed} \u274C`);
    console.log('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
    if (failures.length > 0) {
        console.log('  Failures:');
        for (const f of failures) {
            console.log(`  \u274C ${f.name}`);
            console.log(`     \u2192 ${f.reason}`);
        }
    } else {
        console.log('  All tests passed! \uD83C\uDF89');
    }
    console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');
    process.exit(failed > 0 ? 1 : 0);
}

async function main() {
    console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
    console.log('  \uD83C\uDFAE Skribl Custom Words \u2014 Integration Test Suite  (28 tests)');
    console.log(`  Target: ${SERVER_URL}`);
    console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

    try {
        const probe = await connectSocket();
        probe.disconnect();
    } catch (_) {
        console.error(`\n\u274C Cannot connect to ${SERVER_URL}. Is the stack running?\n`);
        process.exit(1);
    }

    await testSettingsSync();
    await testCustomWordsHappyPath();
    await testWordBankEdgeCases();
    await testSettingsUpdateEdgeCases();
    await testConcurrencyEdgeCases();

    printReport();
}

main().catch(err => {
    console.error('[TestRunner] Fatal error:', err);
    process.exit(1);
});
