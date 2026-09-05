const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CLIENT_DIR = path.resolve(__dirname, '../../client');
const TEST_PORT = 7799;
const BASE_URL = `http://localhost:${TEST_PORT}`;

function startStaticServer() {
    const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
    const server = http.createServer((req, res) => {
        let p = req.url.split('?')[0];
        if (p === '/') p = '/index.html';
        const filePath = path.join(CLIENT_DIR, p);
        try {
            const content = fs.readFileSync(filePath);
            res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'text/plain', 'Cache-Control': 'no-store' });
            res.end(content);
        } catch { res.writeHead(404); res.end('Not found: ' + p); }
    });
    return new Promise(resolve => server.listen(TEST_PORT, () => resolve(server)));
}

const INJECT_MOCK = () => {
    window.__emitLog = [];
    window.__mockSocket = {
        id: 'test-socket-id', connected: true, _listeners: {},
        on(event, cb) { if (!this._listeners[event]) this._listeners[event] = []; this._listeners[event].push(cb); },
        emit(event, data) { window.__emitLog.push({ event, data }); },
        disconnect() { this.connected = false; (this._listeners['disconnect'] || []).forEach(cb => cb('transport close')); },
        _fire(event, data) { (this._listeners[event] || []).forEach(cb => cb(data)); }
    };
    window.io = () => window.__mockSocket;
    window.addEventListener('error', () => {});
};

const TWO_PLAYERS = [
    { id: 'player-a', name: 'Me',    score: 0, avatar: '😀', socketId: 'test-socket-id' },
    { id: 'player-b', name: 'Other', score: 0, avatar: '🎮', socketId: 'other-socket-id' },
];

async function openPage(browser) {
    const page = await browser.newPage();
    await page.setCacheEnabled(false);
    await page.evaluateOnNewDocument(INJECT_MOCK);
    await page.setRequestInterception(true);
    page.on('request', req => {
        if (req.url().includes('socket.io')) req.respond({ status: 200, contentType: 'application/javascript', body: '/* mock */' });
        else req.continue();
    });
    page.on('pageerror', err => console.error('  [PAGE CRASH]', err.message));
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 10000 });
    await new Promise(r => setTimeout(r, 400));
    return page;
}
async function openGamePage(browser, drawerId) {
    const page = await openPage(browser);
    await page.evaluate((players, drawerId) => {
        window.__mockSocket._fire('room-joined', {
            gameState: 'LOBBY', roomCode: 'TEST1', hostId: 'player-a',
            players, settings: { rounds: 3, drawTime: 60, maxPlayers: 8 }
        });
    }, TWO_PLAYERS, drawerId);
    await new Promise(r => setTimeout(r, 200));
    return page;
}

function isVisible(display) { return display !== 'none'; }
function isHidden(display)  { return display === 'none'; }

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runTests() {
    console.log('═══════════════════════════════════════════════════');
    console.log('  🌐 Skribl Frontend Resilience Test Suite (E2E)');
    console.log('═══════════════════════════════════════════════════\n');

    let server, browser;
    let passed = 0, failed = 0;
    const failures = [];

    async function test(name, fn) {
        process.stdout.write(`  ⏳ ${name}... `);
        try { await fn(); console.log('✅ PASS'); passed++; }
        catch (err) { console.log('❌ FAIL'); console.log(`       → ${err.message}`); failed++; failures.push({ name, error: err.message }); }
    }

    const GUESSER_ROUND = { drawerId: 'player-b', round: 1, maxRounds: 3, wordHint: '_ _ _ _ _', timeLeft: 60, players: TWO_PLAYERS, settings: { drawTime: 60 } };
    const DRAWER_ROUND  = { ...GUESSER_ROUND, drawerId: 'player-a' }; // player-a = "Me"

    try {
        server  = await startStaticServer();
        browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });

        console.log('📋 Suite: Disconnect / Reconnect UX');

        await test('FE01: Reconnect overlay appears when socket disconnects', async () => {
            const page = await openPage(browser);
            await page.evaluate(() => window.__mockSocket.disconnect());
            await wait(400);
            const d = await page.evaluate(() => document.getElementById('overlay-reconnecting')?.style.display);
            await page.close();
            if (!isVisible(d)) throw new Error(`Expected overlay visible, got "${d}"`);
        });

        await test('FE02: Reconnect overlay appears during reconnect_attempt', async () => {
            const page = await openPage(browser);
            await page.evaluate(() => window.__mockSocket._fire('reconnect_attempt', 1));
            await wait(300);
            const d = await page.evaluate(() => document.getElementById('overlay-reconnecting')?.style.display);
            await page.close();
            if (!isVisible(d)) throw new Error(`Expected overlay visible on attempt, got "${d}"`);
        });

        await test('FE03: Reconnect overlay hides after socket reconnects', async () => {
            const page = await openPage(browser);
            await page.evaluate(() => window.__mockSocket.disconnect());
            await wait(200);
            await page.evaluate(() => { window.__mockSocket.connected = true; window.__mockSocket._fire('reconnect', {}); });
            await wait(300);
            const d = await page.evaluate(() => document.getElementById('overlay-reconnecting')?.style.display);
            await page.close();
            if (!isHidden(d)) throw new Error(`Expected overlay hidden, got "${d}"`);
        });

        await test('FE04: room-joined event always dismisses reconnect overlay', async () => {
            const page = await openPage(browser);
            await page.evaluate(() => window.__mockSocket.disconnect());
            await wait(200);
            await page.evaluate((players) => window.__mockSocket._fire('room-joined', {
                gameState: 'LOBBY', players, roomCode: 'TEST1', hostId: 'player-a',
                settings: { rounds: 3, drawTime: 60, maxPlayers: 8 }
            }), TWO_PLAYERS);
            await wait(300);
            const d = await page.evaluate(() => document.getElementById('overlay-reconnecting')?.style.display);
            await page.close();
            if (!isHidden(d)) throw new Error(`Expected overlay hidden after room-joined, got "${d}"`);
        });

        console.log('\n📋 Suite: Word Picker');

        await test('FE05: Word picker overlay appears when choose-word fires', async () => {
            const page = await openPage(browser);
            await page.evaluate(() => window.__mockSocket._fire('choose-word', { words: ['Elephant', 'Banana', 'Guitar'] }));
            await wait(300);
            const d = await page.evaluate(() => document.getElementById('overlay-word-picker')?.style.display);
            await page.close();
            if (!isVisible(d)) throw new Error(`Expected word picker visible, got "${d}"`);
        });

        await test('FE06: Word picker renders exactly the 3 correct word choices', async () => {
            const page = await openPage(browser);
            const words = ['Helicopter', 'Volcano', 'Submarine'];
            await page.evaluate((w) => window.__mockSocket._fire('choose-word', { words: w }), words);
            await wait(300);
            const btnTexts = await page.evaluate(() => Array.from(document.querySelectorAll('.word-btn')).map(b => b.textContent.trim()));
            await page.close();
            for (const w of words) {
                if (!btnTexts.includes(w)) throw new Error(`Word "${w}" missing. Found: ${JSON.stringify(btnTexts)}`);
            }
        });

        await test('FE07: Clicking a word choice emits word-choosen event', async () => {
            const page = await openPage(browser);
            await page.evaluate(() => window.__mockSocket._fire('choose-word', { words: ['Fire', 'Water', 'Earth'] }));
            await wait(300);
            await page.click('.word-btn');
            await wait(200);
            const emitLog = await page.evaluate(() => window.__emitLog);
            await page.close();
            const evt = emitLog.find(e => e.event === 'word-choosen');
            if (!evt) throw new Error(`word-choosen not emitted. Log: ${JSON.stringify(emitLog)}`);
            if (!evt.data.choosenWord) throw new Error('word-choosen payload missing choosenWord');
        });

        await test('FE08 (Ghost Timer): Word picker dismissed when round-started fires before user picks', async () => {
            const page = await openPage(browser);
            await page.evaluate(() => window.__mockSocket._fire('choose-word', { words: ['Alpha', 'Beta', 'Gamma'] }));
            await wait(200);
            await page.evaluate((data) => window.__mockSocket._fire('round-started', data), GUESSER_ROUND);
            await wait(300);
            const d = await page.evaluate(() => document.getElementById('overlay-word-picker')?.style.display);
            await page.close();
            if (!isHidden(d)) throw new Error(`Ghost timer: word picker still visible (display="${d}")`);
        });

        await test('FE09: Word picker dismissed by game:over', async () => {
            const page = await openPage(browser);
            await page.evaluate(() => window.__mockSocket._fire('choose-word', { words: ['A', 'B', 'C'] }));
            await wait(200);
            await page.evaluate((players) => window.__mockSocket._fire('game:over', {
                finalScores: [{ id: 'player-a', score: 100 }, { id: 'player-b', score: 50 }]
            }), TWO_PLAYERS);
            await wait(300);
            const d = await page.evaluate(() => document.getElementById('overlay-word-picker')?.style.display);
            await page.close();
            if (!isHidden(d)) throw new Error(`Word picker not hidden by game:over (display="${d}")`);
        });

        console.log('\n📋 Suite: Canvas & Drawing State');

        await test('FE10: Canvas cursor set to "default" for non-drawer', async () => {
            const page = await openGamePage(browser, 'player-b');
            await page.evaluate((data) => window.__mockSocket._fire('round-started', data), GUESSER_ROUND);
            await wait(300);
            const cursor = await page.evaluate(() => document.getElementById('draw-canvas')?.style.cursor);
            await page.close();
            if (cursor !== 'default') throw new Error(`Expected cursor="default", got "${cursor}"`);
        });

        await test('FE11: Canvas cursor set to "crosshair" for drawer', async () => {
            const page = await openGamePage(browser, 'player-a');
            await page.evaluate(() => window.__mockSocket._fire('choose-word', { words: ['A', 'B', 'C'] }));
            await wait(100);
            await page.evaluate((data) => window.__mockSocket._fire('round-started', data), DRAWER_ROUND);
            await wait(300);
            const cursor = await page.evaluate(() => document.getElementById('draw-canvas')?.style.cursor);
            await page.close();
            if (cursor !== 'crosshair') throw new Error(`Expected cursor="crosshair" for drawer, got "${cursor}"`);
        });

        await test('FE12: Draw tools toolbar hidden for non-drawer', async () => {
            const page = await openGamePage(browser, 'player-b');
            await page.evaluate((data) => window.__mockSocket._fire('round-started', data), GUESSER_ROUND);
            await wait(300);
            const hasHidden = await page.evaluate(() => document.getElementById('draw-tools')?.classList.contains('hidden'));
            await page.close();
            if (!hasHidden) throw new Error('draw-tools should be hidden for non-drawer');
        });

        await test('FE13: Draw tools toolbar visible for drawer', async () => {
            const page = await openGamePage(browser, 'player-a');
            await page.evaluate(() => window.__mockSocket._fire('choose-word', { words: ['A', 'B', 'C'] }));
            await wait(100);
            await page.evaluate((data) => window.__mockSocket._fire('round-started', data), DRAWER_ROUND);
            await wait(300);
            const hasHidden = await page.evaluate(() => document.getElementById('draw-tools')?.classList.contains('hidden'));
            await page.close();
            if (hasHidden) throw new Error('draw-tools should NOT be hidden for drawer');
        });

        console.log('\n📋 Suite: Chat State');

        await test('FE14: Chat input disabled for drawer', async () => {
            const page = await openGamePage(browser, 'player-a');
            await page.evaluate(() => window.__mockSocket._fire('choose-word', { words: ['A', 'B', 'C'] }));
            await wait(100);
            await page.evaluate((data) => window.__mockSocket._fire('round-started', data), DRAWER_ROUND);
            await wait(300);
            const disabled = await page.evaluate(() => document.getElementById('chat-input')?.disabled);
            await page.close();
            if (!disabled) throw new Error('chat-input should be disabled for drawer');
        });

        await test('FE15: Chat input enabled for guesser', async () => {
            const page = await openGamePage(browser, 'player-b');
            await page.evaluate((data) => window.__mockSocket._fire('round-started', data), GUESSER_ROUND);
            await wait(300);
            const disabled = await page.evaluate(() => document.getElementById('chat-input')?.disabled);
            await page.close();
            if (disabled) throw new Error('chat-input should be enabled for guesser');
        });

        console.log('\n📋 Suite: Timer');

        await test('FE16: Timer reflects timeLeft from server', async () => {
            const page = await openPage(browser);
            await page.evaluate((data) => window.__mockSocket._fire('round-started', data), { ...GUESSER_ROUND, timeLeft: 47 });
            await wait(300);
            const val = parseInt(await page.evaluate(() => document.getElementById('game-timer-value')?.textContent?.trim()), 10);
            await page.close();
            if (isNaN(val) || val < 45 || val > 48) throw new Error(`Expected timer ~47, got ${val}`);
        });

        await test('FE17: Timer gets "danger" class when timeLeft ≤ 10', async () => {
            const page = await openPage(browser);
            await page.evaluate((data) => window.__mockSocket._fire('round-started', data), { ...GUESSER_ROUND, timeLeft: 8 });
            await wait(300);
            const has = await page.evaluate(() => document.getElementById('game-timer')?.classList.contains('danger'));
            await page.close();
            if (!has) throw new Error('Expected "danger" class when timeLeft=8');
        });

        await test('FE18: Timer gets "warning" class when timeLeft ≤ 20', async () => {
            const page = await openPage(browser);
            await page.evaluate((data) => window.__mockSocket._fire('round-started', data), { ...GUESSER_ROUND, timeLeft: 15 });
            await wait(300);
            const has = await page.evaluate(() => document.getElementById('game-timer')?.classList.contains('warning'));
            await page.close();
            if (!has) throw new Error('Expected "warning" class when timeLeft=15');
        });

        console.log('\n📋 Suite: Sidebar & Scoring');

        await test('FE19: Sidebar renders all players after round-started', async () => {
            const page = await openPage(browser);
            await page.evaluate((data) => window.__mockSocket._fire('round-started', data), GUESSER_ROUND);
            await wait(300);
            const count = await page.evaluate(() => document.querySelectorAll('.sidebar-player').length);
            await page.close();
            if (count !== 2) throw new Error(`Expected 2 sidebar players, got ${count}`);
        });

        await test('FE20: Player removed from sidebar when player-left fires', async () => {
            const page = await openPage(browser);
            await page.evaluate((data) => window.__mockSocket._fire('round-started', data), GUESSER_ROUND);
            await wait(200);
            await page.evaluate(() => window.__mockSocket._fire('player-left', { playerId: 'player-b' }));
            await wait(200);
            const count = await page.evaluate(() => document.querySelectorAll('.sidebar-player').length);
            await page.close();
            if (count !== 1) throw new Error(`Expected 1 player after player-left, got ${count}`);
        });

        await test('FE21: Score updates in sidebar after game:player-guessed', async () => {
            const page = await openPage(browser);
            await page.evaluate((data) => window.__mockSocket._fire('round-started', data), GUESSER_ROUND);
            await wait(200);
            await page.evaluate(() => window.__mockSocket._fire('game:player-guessed', { playerId: 'player-a', playerName: 'Me', score: 350 }));
            await wait(200);
            const scores = await page.evaluate(() => Array.from(document.querySelectorAll('.sp-score')).map(el => parseInt(el.textContent)));
            await page.close();
            if (!scores.some(s => s > 0)) throw new Error(`Expected a score > 0 in sidebar, got [${scores}]`);
        });

        await test('FE22: Guessed player gets a checkmark in the sidebar', async () => {
            const page = await openPage(browser);
            await page.evaluate((data) => window.__mockSocket._fire('round-started', data), GUESSER_ROUND);
            await wait(200);
            await page.evaluate(() => window.__mockSocket._fire('game:player-guessed', { playerId: 'player-a', playerName: 'Me', score: 350 }));
            await wait(200);
            const hasCheck = await page.evaluate(() => !!document.querySelector('.guessed-check'));
            await page.close();
            if (!hasCheck) throw new Error('Expected .guessed-check element in sidebar');
        });

        console.log('\n📋 Suite: Overlays & Game Flow');

        await test('FE23: Round-end overlay appears with the correct word', async () => {
            const page = await openPage(browser);
            await page.evaluate(() => window.__mockSocket._fire('round-end', {
                word: 'SPACESHIP',
                scores: [{ playerId: 'player-a', playerName: 'Me', scoreDelta: 200, totalScore: 200, avatar: '😀' }]
            }));
            await wait(300);
            const [d, word] = await page.evaluate(() => [
                document.getElementById('overlay-round-end')?.style.display,
                document.getElementById('round-end-word')?.textContent
            ]);
            await page.close();
            if (!isVisible(d)) throw new Error(`round-end overlay not visible (display="${d}")`);
            if (word !== 'SPACESHIP') throw new Error(`Expected word "SPACESHIP", got "${word}"`);
        });

        await test('FE24: Game-over overlay appears after game:over', async () => {
            const page = await openPage(browser);
            await page.evaluate((players) => window.__mockSocket._fire('game:over', {
                finalScores: [{ id: 'player-a', score: 400 }, { id: 'player-b', score: 200 }]
            }), TWO_PLAYERS);
            await wait(300);
            const d = await page.evaluate(() => document.getElementById('overlay-game-over')?.style.display);
            await page.close();
            if (!isVisible(d)) throw new Error(`game-over overlay not visible (display="${d}")`);
        });

        await test('FE25: New round-started clears the round-end overlay', async () => {
            const page = await openPage(browser);
            await page.evaluate(() => window.__mockSocket._fire('round-end', { word: 'FOG', scores: [] }));
            await wait(200);
            await page.evaluate((data) => window.__mockSocket._fire('round-started', data), GUESSER_ROUND);
            await wait(300);
            const d = await page.evaluate(() => document.getElementById('overlay-round-end')?.style.display);
            await page.close();
            if (!isHidden(d)) throw new Error(`round-end overlay should be hidden after new round starts`);
        });

        await test('FE26: Word hint renders underscores for guesser', async () => {
            const page = await openPage(browser);
            await page.evaluate((data) => window.__mockSocket._fire('round-started', data), { ...GUESSER_ROUND, wordHint: '_ _ _ _ _' });
            await wait(300);
            const count = await page.evaluate(() => document.querySelectorAll('.hint-char.hidden').length);
            await page.close();
            if (count !== 5) throw new Error(`Expected 5 hidden hint chars, got ${count}`);
        });

        await test('FE27: game:hint event updates word hint display', async () => {
            const page = await openPage(browser);
            await page.evaluate((data) => window.__mockSocket._fire('round-started', data), { ...GUESSER_ROUND, wordHint: '_ _ _ _ _' });
            await wait(200);
            await page.evaluate(() => window.__mockSocket._fire('game:hint', { hint: 'D _ _ _ _' }));
            await wait(200);
            const count = await page.evaluate(() => document.querySelectorAll('.hint-char.revealed').length);
            await page.close();
            if (count < 1) throw new Error(`Expected ≥1 revealed hint char after game:hint, got ${count}`);
        });

        await test('FE28: Chat message from server appears in chat log', async () => {
            const page = await openPage(browser);
            await page.evaluate(() => window.__mockSocket._fire('chat-message', { sender: 'Alice', message: 'Hello world!' }));
            await wait(200);
            const msgs = await page.evaluate(() => Array.from(document.querySelectorAll('.chat-msg')).map(el => el.textContent));
            await page.close();
            if (!msgs.some(m => m.includes('Hello world!'))) throw new Error(`Chat message not found. Found: ${JSON.stringify(msgs)}`);
        });

        await test('FE29: handleReconnect during DRAW restores word hint', async () => {
            const page = await openPage(browser);
            await page.evaluate((players) => window.__mockSocket._fire('room-joined', {
                gameState: 'DRAW', drawerId: 'player-b', round: 2, maxRounds: 3,
                players, wordHint: 'D _ _ G _ _', timeLeft: 30,
                settings: { rounds: 3, drawTime: 60, maxPlayers: 8 },
                hostId: 'player-a', roomCode: 'TEST1'
            }), TWO_PLAYERS);
            await wait(300);
            const html = await page.evaluate(() => document.getElementById('game-word-hint')?.innerHTML);
            await page.close();
            if (!html || html === '') throw new Error('Word hint empty after reconnect during DRAW');
        });

        await test('FE30: handleReconnect clears stale overlays from previous state', async () => {
            const page = await openPage(browser);
            await page.evaluate(() => { document.getElementById('overlay-game-over').style.display = ''; });
            await wait(100);
            await page.evaluate((players) => window.__mockSocket._fire('room-joined', {
                gameState: 'DRAW', drawerId: 'player-b', round: 1, maxRounds: 3,
                players, wordHint: '_ _ _ _ _', timeLeft: 30,
                settings: { rounds: 3, drawTime: 60, maxPlayers: 8 },
                hostId: 'player-a', roomCode: 'TEST1'
            }), TWO_PLAYERS);
            await wait(300);
            const [go, wp, re] = await page.evaluate(() => [
                document.getElementById('overlay-game-over')?.style.display,
                document.getElementById('overlay-word-picker')?.style.display,
                document.getElementById('overlay-round-end')?.style.display,
            ]);
            await page.close();
            if (!isHidden(go)) throw new Error(`Stale game-over overlay not cleared (display="${go}")`);
            if (!isHidden(wp)) throw new Error(`Stale word-picker not cleared (display="${wp}")`);
            if (!isHidden(re)) throw new Error(`Stale round-end overlay not cleared (display="${re}")`);
        });

    } catch (err) {
        console.error('\n  Fatal:', err.message);
        failed++;
    } finally {
        if (browser) await browser.close();
        if (server)  server.close();
    }

    const total = passed + failed;
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  SKRIBL FRONTEND TEST RESULTS');
    console.log('═══════════════════════════════════════════════════');
    console.log(`  Total:  ${total}`);
    console.log(`  Passed: ${passed} ✅`);
    console.log(`  Failed: ${failed} ❌`);
    if (failures.length > 0) {
        console.log('─────────────────────────────────────────────────────');
        console.log('  Failures:');
        failures.forEach(f => console.log(`  ❌ ${f.name}\n     → ${f.error}`));
        console.log('═══════════════════════════════════════════════════\n');
        process.exit(1);
    } else {
        console.log('─────────────────────────────────────────────────────');
        console.log('  All tests passed! 🎉');
        console.log('═══════════════════════════════════════════════════\n');
    }
}

runTests();
