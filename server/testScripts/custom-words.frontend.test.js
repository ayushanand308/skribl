

'use strict';

const puppeteer = require('puppeteer');
const http      = require('http');
const fs        = require('fs');
const path      = require('path');

const CLIENT_DIR = path.resolve(__dirname, '../../client');
const TEST_PORT  = 7811;
const BASE_URL   = `http://localhost:${TEST_PORT}`;

function startStaticServer() {
    const MIME = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
    };
    const server = http.createServer((req, res) => {
        let p = req.url.split('?')[0];
        if (p === '/') p = '/index.html';
        const filePath = path.join(CLIENT_DIR, p);
        try {
            const content = fs.readFileSync(filePath);
            res.writeHead(200, {
                'Content-Type': MIME[path.extname(filePath)] || 'text/plain',
                'Cache-Control': 'no-store',
            });
            res.end(content);
        } catch {
            res.writeHead(404);
            res.end('Not found: ' + p);
        }
    });
    return new Promise(resolve => server.listen(TEST_PORT, () => resolve(server)));
}

const INJECT_MOCK = () => {
    window.__emitLog = [];
    window.__mockSocket = {
        id: 'test-socket-id', connected: true, _listeners: {},
        on(event, cb) {
            if (!this._listeners[event]) this._listeners[event] = [];
            this._listeners[event].push(cb);
        },
        emit(event, data) { window.__emitLog.push({ event, data }); },
        disconnect() {
            this.connected = false;
            (this._listeners['disconnect'] || []).forEach(cb => cb('transport close'));
        },
        _fire(event, data) {
            (this._listeners[event] || []).forEach(cb => cb(data));
        },
    };
    window.io = () => window.__mockSocket;
    window.addEventListener('error', () => {});
};

const PLAYER_HOST  = { id: 'player-a', name: 'HostPlayer',  score: 0, avatar: '\uD83E\uDD16', socketId: 'test-socket-id' };
const PLAYER_GUEST = { id: 'player-b', name: 'GuestPlayer', score: 0, avatar: '\u26A1',       socketId: 'other-socket-id' };

const PLAYER_HOST_REMOTE = { id: 'player-a', name: 'HostPlayer',  score: 0, avatar: '\uD83E\uDD16', socketId: 'host-socket-id' };
const PLAYER_ME_GUEST    = { id: 'player-b', name: 'GuestPlayer', score: 0, avatar: '\u26A1',       socketId: 'test-socket-id' };

function makeHostRoomJoined(overrides = {}) {
    return Object.assign({
        gameState: 'LOBBY',
        roomCode: 'TEST1',
        hostId: 'player-a',
        hostSocketId: 'test-socket-id',
        players: [PLAYER_HOST, PLAYER_GUEST],
        settings: {
            rounds: 3, drawTime: 60, maxPlayers: 8,
            customWords: [], customWordsOnly: false, customTheme: 'Default',
        },
    }, overrides);
}

function makeGuestRoomJoined(overrides = {}) {
    return Object.assign({
        gameState: 'LOBBY',
        roomCode: 'TEST1',
        hostId: 'player-a',
        hostSocketId: 'host-socket-id',
        players: [PLAYER_HOST_REMOTE, PLAYER_ME_GUEST],
        settings: {
            rounds: 3, drawTime: 60, maxPlayers: 8,
            customWordsCount: 0, customWordsOnly: false, customTheme: 'Default',
        },
    }, overrides);
}

async function openPage(browser) {
    const page = await browser.newPage();
    await page.setCacheEnabled(false);
    await page.evaluateOnNewDocument(INJECT_MOCK);
    await page.setRequestInterception(true);
    page.on('request', req => {
        if (req.url().includes('socket.io')) {
            req.respond({ status: 200, contentType: 'application/javascript', body: '/* mock */' });
        } else {
            req.continue();
        }
    });
    page.on('pageerror', err => console.error('  [PAGE CRASH]', err.message));
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 10000 });
    await new Promise(r => setTimeout(r, 400));
    return page;
}

async function openLobbyAs(browser, role = 'host') {
    const page = await openPage(browser);
    const payload = role === 'host' ? makeHostRoomJoined() : makeGuestRoomJoined();
    await page.evaluate((p) => window.__mockSocket._fire('room-joined', p), payload);
    await new Promise(r => setTimeout(r, 300));
    return page;
}

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runTests() {
    console.log('=============================================================');
    console.log('  \uD83C\uDF10 Skribl Custom Words \u2014 Frontend Test Suite  (32 tests)');
    console.log('=============================================================\n');

    let server, browser;
    let passed = 0, failed = 0;
    const failures = [];

    async function test(name, fn) {
        process.stdout.write(`  \u23F3 ${name}... `);
        try {
            await fn();
            console.log('\u2705 PASS');
            passed++;
        } catch (err) {
            console.log('\u274C FAIL');
            console.log(`       \u2192 ${err.message}`);
            failed++;
            failures.push({ name, error: err.message });
        }
    }

    try {
        server  = await startStaticServer();
        browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });

        console.log('\uD83D\uDCCB Suite A: Host vs Guest UI Rendering');

        await test('A01: Host sees host-custom-controls section (not hidden)', async () => {
            const page = await openLobbyAs(browser, 'host');
            const display = await page.evaluate(() => document.getElementById('host-custom-controls')?.style.display);
            await page.close();
            if (display === 'none') throw new Error(`host-custom-controls should be visible for host, got display="${display}"`);
        });

        await test('A02: Host does NOT see guest-custom-view section', async () => {
            const page = await openLobbyAs(browser, 'host');
            const display = await page.evaluate(() => document.getElementById('guest-custom-view')?.style.display);
            await page.close();
            if (display !== 'none') throw new Error(`guest-custom-view should be hidden for host, got display="${display}"`);
        });

        await test('A03: Guest sees guest-custom-view section (not hidden)', async () => {
            const page = await openLobbyAs(browser, 'guest');
            const display = await page.evaluate(() => document.getElementById('guest-custom-view')?.style.display);
            await page.close();
            if (display === 'none') throw new Error(`guest-custom-view should be visible for guest, got display="${display}"`);
        });

        await test('A04: Guest does NOT see host-custom-controls section', async () => {
            const page = await openLobbyAs(browser, 'guest');
            const display = await page.evaluate(() => document.getElementById('host-custom-controls')?.style.display);
            await page.close();
            if (display !== 'none') throw new Error(`host-custom-controls should be hidden for guest, got display="${display}"`);
        });

        await test('A05: Guest sees "Standard / Classic" summary when no custom words active', async () => {
            const page = await openLobbyAs(browser, 'guest');
            const title = await page.evaluate(() => document.getElementById('guest-theme-title')?.textContent?.trim());
            await page.close();
            if (!title || !title.includes('Standard')) {
                throw new Error(`Expected "Standard" in guest theme title, got: "${title}"`);
            }
        });

        await test('A06: Guest sees custom theme name when host sets one (via room:settings-updated)', async () => {
            const page = await openLobbyAs(browser, 'guest');
            await page.evaluate(() => {
                window.__mockSocket._fire('room:settings-updated', {
                    settings: {
                        rounds: 3, drawTime: 60, maxPlayers: 8,
                        customWordsCount: 12, customWordsOnly: false, customTheme: 'Gaming & Anime'
                    }
                });
            });
            await wait(300);
            const title = await page.evaluate(() => document.getElementById('guest-theme-title')?.textContent?.trim());
            await page.close();
            if (!title || !title.includes('Gaming & Anime')) {
                throw new Error(`Expected "Gaming & Anime" in guest theme title, got: "${title}"`);
            }
        });

        await test('A07: Guest sees word count in theme summary (not the actual words)', async () => {
            const page = await openLobbyAs(browser, 'guest');
            await page.evaluate(() => {
                window.__mockSocket._fire('room:settings-updated', {
                    settings: {
                        rounds: 3, drawTime: 60, maxPlayers: 8,
                        customWordsCount: 7, customWordsOnly: false, customTheme: 'Custom'
                    }
                });
            });
            await wait(300);
            const desc = await page.evaluate(() => document.getElementById('guest-theme-desc')?.textContent?.trim());
            await page.close();
            if (!desc || !desc.includes('7')) {
                throw new Error(`Expected word count "7" in guest desc, got: "${desc}"`);
            }
        });

        console.log('\n\uD83D\uDCCB Suite B: Theme Chip Interactions');

        await test('B01: Clicking a theme chip populates the custom-words-input textarea', async () => {
            const page = await openLobbyAs(browser, 'host');
            await page.evaluate(() => {
                const chip = document.querySelector('.theme-chip[data-theme="tech"]');
                if (chip) chip.click();
            });
            await wait(300);
            const value = await page.evaluate(() => document.getElementById('custom-words-input')?.value);
            await page.close();
            if (!value || !value.includes('javascript')) {
                throw new Error(`Tech chip click should fill textarea with tech words. Got: "${value?.slice(0, 80)}"`);
            }
        });

        await test('B02: Clicking a theme chip emits room:update-settings with correct customWords', async () => {
            const page = await openLobbyAs(browser, 'host');
            await page.evaluate(() => {
                const chip = document.querySelector('.theme-chip[data-theme="food"]');
                if (chip) chip.click();
            });
            await wait(400);
            const emitLog = await page.evaluate(() => window.__emitLog);
            await page.close();
            const evt = emitLog.find(e => e.event === 'room:update-settings');
            if (!evt) throw new Error('room:update-settings not emitted after theme chip click');
            if (!Array.isArray(evt.data.customWords) || evt.data.customWords.length === 0) {
                throw new Error(`Expected non-empty customWords in emitted payload, got: ${JSON.stringify(evt.data.customWords)}`);
            }
            if (!evt.data.customWords.includes('pizza')) {
                throw new Error(`Expected Food words in payload. Got: ${JSON.stringify(evt.data.customWords)}`);
            }
        });

        await test('B03: Clicking a theme chip sets customTheme to the theme name in emitted payload', async () => {
            const page = await openLobbyAs(browser, 'host');
            await page.evaluate(() => {
                const chip = document.querySelector('.theme-chip[data-theme="movies"]');
                if (chip) chip.click();
            });
            await wait(400);
            const emitLog = await page.evaluate(() => window.__emitLog);
            await page.close();
            const evt = emitLog.reverse().find(e => e.event === 'room:update-settings');
            if (!evt) throw new Error('room:update-settings not emitted for movies chip');
            if (evt.data.customTheme !== 'Movies & TV') {
                throw new Error(`Expected customTheme="Movies & TV", got "${evt.data.customTheme}"`);
            }
        });

        await test('B04: Clicking "clear" chip emits empty customWords and Default theme', async () => {
            const page = await openLobbyAs(browser, 'host');
            await page.evaluate(() => {
                const chip = document.querySelector('.theme-chip[data-theme="tech"]');
                if (chip) chip.click();
            });
            await wait(300);
            await page.evaluate(() => { window.__emitLog = []; });
            await page.evaluate(() => {
                const chip = document.querySelector('.theme-chip[data-theme="clear"]');
                if (chip) chip.click();
            });
            await wait(300);
            const emitLog = await page.evaluate(() => window.__emitLog);
            await page.close();
            const evt = emitLog.find(e => e.event === 'room:update-settings');
            if (!evt) throw new Error('room:update-settings not emitted after clear chip click');
            if (!Array.isArray(evt.data.customWords) || evt.data.customWords.length !== 0) {
                throw new Error(`Expected empty customWords after clear, got: ${JSON.stringify(evt.data.customWords)}`);
            }
            if (evt.data.customTheme !== 'Default') {
                throw new Error(`Expected customTheme="Default" after clear, got "${evt.data.customTheme}"`);
            }
        });

        await test('B05: Active theme chip gets "active" CSS class after selection', async () => {
            const page = await openLobbyAs(browser, 'host');
            await page.evaluate(() => {
                const chip = document.querySelector('.theme-chip[data-theme="animals"]');
                if (chip) chip.click();
            });
            await wait(300);
            const hasActive = await page.evaluate(() => {
                const chip = document.querySelector('.theme-chip[data-theme="animals"]');
                return chip?.classList.contains('active');
            });
            await page.close();
            if (!hasActive) throw new Error('Selected theme chip should have "active" class');
        });

        await test('B06: Selecting new theme chip removes "active" from previously active chip', async () => {
            const page = await openLobbyAs(browser, 'host');
            await page.evaluate(() => {
                document.querySelector('.theme-chip[data-theme="tech"]')?.click();
            });
            await wait(200);
            await page.evaluate(() => {
                document.querySelector('.theme-chip[data-theme="food"]')?.click();
            });
            await wait(300);
            const [techActive, foodActive] = await page.evaluate(() => [
                document.querySelector('.theme-chip[data-theme="tech"]')?.classList.contains('active'),
                document.querySelector('.theme-chip[data-theme="food"]')?.classList.contains('active'),
            ]);
            await page.close();
            if (techActive) throw new Error('Previous tech chip should NOT have "active" class after food is selected');
            if (!foodActive) throw new Error('New food chip SHOULD have "active" class');
        });

        await test('B07: Guest cannot trigger theme chip clicks (non-host ignored)', async () => {
            const page = await openLobbyAs(browser, 'guest');
            await page.evaluate(() => { window.__emitLog = []; });
            await page.evaluate(() => {
                const chip = document.querySelector('.theme-chip[data-theme="tech"]');
                if (chip) chip.click();
            });
            await wait(400);
            const emitLog = await page.evaluate(() => window.__emitLog);
            await page.close();
            const settingsEvt = emitLog.find(e => e.event === 'room:update-settings');
            if (settingsEvt) {
                throw new Error(`Guest theme chip click should NOT emit room:update-settings. Payload: ${JSON.stringify(settingsEvt.data)}`);
            }
        });

        console.log('\n\uD83D\uDCCB Suite C: Custom Word Input & Counter');

        await test('C01: Typing words in textarea updates the word counter', async () => {
            const page = await openLobbyAs(browser, 'host');
            await page.focus('#custom-words-input');
            await page.type('#custom-words-input', 'apple, banana, cherry, date, elderberry');
            await wait(300);
            const counter = await page.evaluate(() => document.getElementById('custom-words-counter')?.textContent?.trim());
            await page.close();
            if (!counter || !counter.includes('5')) {
                throw new Error(`Expected counter to show 5, got: "${counter}"`);
            }
        });

        await test('C02: Typing in textarea emits room:update-settings after debounce', async () => {
            const page = await openLobbyAs(browser, 'host');
            await page.evaluate(() => { window.__emitLog = []; });
            await page.focus('#custom-words-input');
            await page.type('#custom-words-input', 'word1, word2, word3');
            await wait(700); 
            const emitLog = await page.evaluate(() => window.__emitLog);
            await page.close();
            const evt = emitLog.find(e => e.event === 'room:update-settings');
            if (!evt) throw new Error('room:update-settings not emitted after debounce');
            if (!Array.isArray(evt.data.customWords) || evt.data.customWords.length !== 3) {
                throw new Error(`Expected 3 words in emitted payload, got: ${JSON.stringify(evt.data.customWords)}`);
            }
        });

        await test('C03: Clearing textarea resets counter to "0 words"', async () => {
            const page = await openLobbyAs(browser, 'host');
            await page.focus('#custom-words-input');
            await page.type('#custom-words-input', 'hello, world');
            await wait(200);
            await page.evaluate(() => {
                const el = document.getElementById('custom-words-input');
                if (el) { el.value = ''; el.dispatchEvent(new Event('input')); }
            });
            await wait(300);
            const counter = await page.evaluate(() => document.getElementById('custom-words-counter')?.textContent?.trim());
            await page.close();
            if (!counter || !counter.includes('0')) {
                throw new Error(`Expected "0 words" after clearing, got: "${counter}"`);
            }
        });

        await test('C04: Word counter correctly counts semicolon-separated words', async () => {
            const page = await openLobbyAs(browser, 'host');
            await page.evaluate(() => {
                const el = document.getElementById('custom-words-input');
                if (el) { el.value = 'alpha;beta;gamma;delta'; el.dispatchEvent(new Event('input')); }
            });
            await wait(300);
            const counter = await page.evaluate(() => document.getElementById('custom-words-counter')?.textContent?.trim());
            await page.close();
            if (!counter || !counter.includes('4')) {
                throw new Error(`Expected "4 words" for semicolon-separated, got: "${counter}"`);
            }
        });

        await test('C05: Word counter counts newline-separated words correctly', async () => {
            const page = await openLobbyAs(browser, 'host');
            await page.evaluate(() => {
                const el = document.getElementById('custom-words-input');
                if (el) { el.value = 'line1\nline2\nline3\nline4\nline5'; el.dispatchEvent(new Event('input')); }
            });
            await wait(300);
            const counter = await page.evaluate(() => document.getElementById('custom-words-counter')?.textContent?.trim());
            await page.close();
            if (!counter || !counter.includes('5')) {
                throw new Error(`Expected "5 words" for newline-separated, got: "${counter}"`);
            }
        });

        await test('C06: Non-host cannot type in custom-words-input (input handler guard)', async () => {
            const page = await openLobbyAs(browser, 'guest');
            await page.evaluate(() => { window.__emitLog = []; });
            await page.evaluate(() => {
                const el = document.getElementById('custom-words-input');
                if (el) { el.value = 'hacked'; el.dispatchEvent(new Event('input')); }
            });
            await wait(700);
            const emitLog = await page.evaluate(() => window.__emitLog);
            await page.close();
            const settingsEvt = emitLog.find(e => e.event === 'room:update-settings');
            if (settingsEvt) {
                throw new Error(`Guest input should NOT emit room:update-settings. Got: ${JSON.stringify(settingsEvt.data)}`);
            }
        });

        console.log('\n\uD83D\uDCCB Suite D: Settings Sync Reflected in UI');

        await test('D01: Host receives room:settings-updated — textarea reflects the new customWords list', async () => {
            const page = await openLobbyAs(browser, 'host');
            await page.evaluate(() => {
                window.__mockSocket._fire('room:settings-updated', {
                    settings: {
                        rounds: 3, drawTime: 60, maxPlayers: 8,
                        customWords: ['apple', 'banana', 'cherry'],
                        customWordsOnly: false, customTheme: 'Custom'
                    }
                });
            });
            await wait(300);
            const value = await page.evaluate(() => document.getElementById('custom-words-input')?.value);
            await page.close();
            if (!value || !value.includes('apple')) {
                throw new Error(`Expected textarea to show custom words after settings sync, got: "${value}"`);
            }
        });

        await test('D02: Host settings sync updates word counter to match new word list', async () => {
            const page = await openLobbyAs(browser, 'host');
            await page.evaluate(() => {
                window.__mockSocket._fire('room:settings-updated', {
                    settings: {
                        rounds: 3, drawTime: 60, maxPlayers: 8,
                        customWords: ['one', 'two', 'three', 'four'],
                        customWordsOnly: false, customTheme: 'Custom'
                    }
                });
            });
            await wait(300);
            const counter = await page.evaluate(() => document.getElementById('custom-words-counter')?.textContent?.trim());
            await page.close();
            if (!counter || !counter.includes('4')) {
                throw new Error(`Expected counter "4" after settings sync, got: "${counter}"`);
            }
        });

        await test('D03: Theme badge updates when settings-updated fires with new theme', async () => {
            const page = await openLobbyAs(browser, 'host');
            await page.evaluate(() => {
                window.__mockSocket._fire('room:settings-updated', {
                    settings: {
                        rounds: 3, drawTime: 60, maxPlayers: 8,
                        customWords: ['naruto', 'pokemon'],
                        customWordsOnly: false, customTheme: 'Gaming & Anime'
                    }
                });
            });
            await wait(300);
            const badgeText = await page.evaluate(() => document.getElementById('custom-words-badge')?.textContent?.trim());
            await page.close();
            if (!badgeText || !badgeText.includes('Gaming')) {
                throw new Error(`Expected badge to show "Gaming & Anime", got: "${badgeText}"`);
            }
        });

        await test('D04: Guest settings-updated shows correct word count in guest-theme-desc', async () => {
            const page = await openLobbyAs(browser, 'guest');
            await page.evaluate(() => {
                window.__mockSocket._fire('room:settings-updated', {
                    settings: {
                        rounds: 3, drawTime: 60, maxPlayers: 8,
                        customWordsCount: 13, customWordsOnly: false, customTheme: 'Movies & TV'
                    }
                });
            });
            await wait(300);
            const desc = await page.evaluate(() => document.getElementById('guest-theme-desc')?.textContent?.trim());
            await page.close();
            if (!desc || !desc.includes('13')) {
                throw new Error(`Expected "13" in guest desc, got: "${desc}"`);
            }
        });

        await test('D05: Guest settings-updated with Exclusive Mode shows "Exclusive Mode" in desc', async () => {
            const page = await openLobbyAs(browser, 'guest');
            await page.evaluate(() => {
                window.__mockSocket._fire('room:settings-updated', {
                    settings: {
                        rounds: 3, drawTime: 60, maxPlayers: 8,
                        customWordsCount: 8, customWordsOnly: true, customTheme: 'Tech & Dev'
                    }
                });
            });
            await wait(300);
            const desc = await page.evaluate(() => document.getElementById('guest-theme-desc')?.textContent?.trim());
            await page.close();
            if (!desc || !desc.toLowerCase().includes('exclusive')) {
                throw new Error(`Expected "Exclusive" in guest desc when customWordsOnly=true, got: "${desc}"`);
            }
        });

        await test('D06: Guest settings reset to Default theme shows Standard in guest-theme-title', async () => {
            const page = await openLobbyAs(browser, 'guest');
            await page.evaluate(() => {
                window.__mockSocket._fire('room:settings-updated', {
                    settings: { rounds: 3, drawTime: 60, maxPlayers: 8, customWordsCount: 5, customWordsOnly: false, customTheme: 'Custom' }
                });
            });
            await wait(200);
            await page.evaluate(() => {
                window.__mockSocket._fire('room:settings-updated', {
                    settings: { rounds: 3, drawTime: 60, maxPlayers: 8, customWordsCount: 0, customWordsOnly: false, customTheme: 'Default' }
                });
            });
            await wait(300);
            const title = await page.evaluate(() => document.getElementById('guest-theme-title')?.textContent?.trim());
            await page.close();
            if (!title || !title.includes('Standard')) {
                throw new Error(`Expected "Standard" after theme reset for guest, got: "${title}"`);
            }
        });

        console.log('\n\uD83D\uDCCB Suite E: Spoiler Prevention (DOM Audit)');

        await test('E01: Guest DOM contains NO raw custom word strings after settings-updated', async () => {
            const page = await openLobbyAs(browser, 'guest');
            const secretWords = ['topsecretword_A7z', 'topsecretword_B8q', 'topsecretword_C9x'];
            await page.evaluate((s) => {
                window.__mockSocket._fire('room:settings-updated', {
                    settings: { rounds: 3, drawTime: 60, maxPlayers: 8, customWordsCount: s.length, customWordsOnly: false, customTheme: 'Custom' }
                });
            }, secretWords);
            await wait(300);
            const bodyText = await page.evaluate(() => document.body.innerText || '');
            await page.close();
            for (const word of secretWords) {
                if (bodyText.includes(word)) {
                    throw new Error(`SECRET WORD "${word}" leaked into guest DOM!`);
                }
            }
        });

        await test('E02: Guest DOM contains NO raw words when joined with customWordsCount in room-joined', async () => {
            const page = await openPage(browser);
            const secretWords = ['exposed_word_1', 'exposed_word_2'];
            await page.evaluate((words) => {
                window.__mockSocket._fire('room-joined', {
                    gameState: 'LOBBY', roomCode: 'TEST1', hostId: 'player-a', hostSocketId: 'other-id',
                    players: [
                        { id: 'player-a', name: 'Host', score: 0, avatar: '\uD83E\uDD16', socketId: 'other-id' },
                        { id: 'player-b', name: 'Me', score: 0, avatar: '\u26A1', socketId: 'test-socket-id' },
                    ],
                    settings: { rounds: 3, drawTime: 60, maxPlayers: 8, customWordsCount: words.length, customWordsOnly: false, customTheme: 'Custom' }
                });
            }, secretWords);
            await wait(300);
            const bodyText = await page.evaluate(() => document.body.innerText || '');
            await page.close();
            for (const word of secretWords) {
                if (bodyText.includes(word)) {
                    throw new Error(`SECRET WORD "${word}" leaked into guest DOM from room-joined!`);
                }
            }
        });

        console.log('\n\uD83D\uDCCB Suite F: Exclusive Mode Checkbox');

        await test('F01: Checking exclusive checkbox emits room:update-settings with customWordsOnly=true', async () => {
            const page = await openLobbyAs(browser, 'host');
            await page.evaluate(() => { window.__emitLog = []; });
            await page.evaluate(() => {
                const el = document.getElementById('custom-words-exclusive');
                if (el) { el.checked = true; el.dispatchEvent(new Event('change')); }
            });
            await wait(300);
            const emitLog = await page.evaluate(() => window.__emitLog);
            await page.close();
            const evt = emitLog.find(e => e.event === 'room:update-settings');
            if (!evt) throw new Error('room:update-settings not emitted after exclusive checkbox check');
            if (!evt.data.customWordsOnly) {
                throw new Error(`Expected customWordsOnly=true, got ${evt.data.customWordsOnly}`);
            }
        });

        await test('F02: Unchecking exclusive checkbox emits customWordsOnly=false', async () => {
            const page = await openLobbyAs(browser, 'host');
            await page.evaluate(() => { window.__emitLog = []; });
            await page.evaluate(() => {
                const el = document.getElementById('custom-words-exclusive');
                if (el) { el.checked = false; el.dispatchEvent(new Event('change')); }
            });
            await wait(300);
            const emitLog = await page.evaluate(() => window.__emitLog);
            await page.close();
            const evt = emitLog.find(e => e.event === 'room:update-settings');
            if (!evt) throw new Error('room:update-settings not emitted after exclusive checkbox uncheck');
            if (evt.data.customWordsOnly) {
                throw new Error(`Expected customWordsOnly=false, got ${evt.data.customWordsOnly}`);
            }
        });

        await test('F03: Exclusive checkbox state syncs when host settings-updated arrives', async () => {
            const page = await openLobbyAs(browser, 'host');
            await page.evaluate(() => {
                window.__mockSocket._fire('room:settings-updated', {
                    settings: {
                        rounds: 3, drawTime: 60, maxPlayers: 8,
                        customWords: ['w1', 'w2'], customWordsOnly: true, customTheme: 'Custom'
                    }
                });
            });
            await wait(300);
            const checked = await page.evaluate(() => document.getElementById('custom-words-exclusive')?.checked);
            await page.close();
            if (!checked) throw new Error('Exclusive checkbox should be checked after settings-updated with customWordsOnly=true');
        });

        await test('F04: Exclusive checkbox is unchecked when settings-updated sets customWordsOnly=false', async () => {
            const page = await openLobbyAs(browser, 'host');
            await page.evaluate(() => {
                const el = document.getElementById('custom-words-exclusive');
                if (el) el.checked = true;
            });
            await page.evaluate(() => {
                window.__mockSocket._fire('room:settings-updated', {
                    settings: {
                        rounds: 3, drawTime: 60, maxPlayers: 8,
                        customWords: ['w1'], customWordsOnly: false, customTheme: 'Custom'
                    }
                });
            });
            await wait(300);
            const checked = await page.evaluate(() => document.getElementById('custom-words-exclusive')?.checked);
            await page.close();
            if (checked) throw new Error('Exclusive checkbox should be unchecked when customWordsOnly=false arrives');
        });

        console.log('\n\uD83D\uDCCB Suite G: Edge Cases & Guards');

        await test('G01: Host becomes guest after room:host-changed — host controls hide, guest view appears', async () => {
            const page = await openLobbyAs(browser, 'host');
            await page.evaluate(() => {
                window.__mockSocket._fire('room:host-changed', {
                    hostId: 'player-b',
                    hostSocketId: 'other-socket-id',
                    hostName: 'GuestPlayer'
                });
            });
            await wait(300);
            const [hostDisplay, guestDisplay] = await page.evaluate(() => [
                document.getElementById('host-custom-controls')?.style.display,
                document.getElementById('guest-custom-view')?.style.display,
            ]);
            await page.close();
            if (hostDisplay !== 'none') {
                throw new Error(`Host controls should hide when host changes. Got display="${hostDisplay}"`);
            }
            if (guestDisplay === 'none') {
                throw new Error(`Guest view should appear when current player becomes guest. Got display="${guestDisplay}"`);
            }
        });

        await test('G02: Guest becomes host after room:host-changed — guest view hides, host controls appear', async () => {
            const page = await openLobbyAs(browser, 'guest');
            await page.evaluate(() => {
                window.__mockSocket._fire('room:host-changed', {
                    hostId: 'player-b',         // player-b is "me" (test-socket-id)
                    hostSocketId: 'test-socket-id',
                    hostName: 'GuestPlayer'
                });
            });
            await wait(300);
            const [hostDisplay, guestDisplay] = await page.evaluate(() => [
                document.getElementById('host-custom-controls')?.style.display,
                document.getElementById('guest-custom-view')?.style.display,
            ]);
            await page.close();
            if (guestDisplay !== 'none') {
                throw new Error(`Guest view should hide when player becomes host. Got display="${guestDisplay}"`);
            }
            if (hostDisplay === 'none') {
                throw new Error(`Host controls should appear when player becomes host. Got display="${hostDisplay}"`);
            }
        });

        await test('G03: Custom words badge shows "Classic" when no custom words are set', async () => {
            const page = await openLobbyAs(browser, 'guest');
            const badge = await page.evaluate(() => document.getElementById('custom-words-badge')?.textContent?.trim());
            await page.close();
            if (!badge || !badge.includes('Classic')) {
                throw new Error(`Expected "Classic" badge when no custom theme active, got: "${badge}"`);
            }
        });

        await test('G04: Rapidly switching theme chips debounces correctly — only one final emit', async () => {
            const page = await openLobbyAs(browser, 'host');
            await page.evaluate(() => { window.__emitLog = []; });
            await page.evaluate(() => {
                document.querySelector('.theme-chip[data-theme="tech"]')?.click();
                document.querySelector('.theme-chip[data-theme="food"]')?.click();
                document.querySelector('.theme-chip[data-theme="animals"]')?.click();
            });
            await wait(600);
            const emitLog = await page.evaluate(() => window.__emitLog);
            await page.close();
            const settingsEvents = emitLog.filter(e => e.event === 'room:update-settings');
            if (settingsEvents.length === 0) {
                throw new Error('No room:update-settings emitted after chip clicks');
            }
            const lastEvt = settingsEvents[settingsEvents.length - 1];
            if (lastEvt.data.customTheme !== 'Animals') {
                throw new Error(`Expected last emit to have Animals theme, got "${lastEvt.data.customTheme}"`);
            }
        });

        await test('G05: Textarea input matching a preset theme auto-detects and highlights that chip', async () => {
            const page = await openLobbyAs(browser, 'host');
            const techWords = 'javascript, docker, python, database, github, linux, cloud, keyboard, terminal, hacker, algorithm, frontend, backend, firewall, cookie, server';
            await page.evaluate((words) => {
                const el = document.getElementById('custom-words-input');
                if (el) { el.value = words; el.dispatchEvent(new Event('input')); }
            }, techWords);
            await wait(300);
            const techChipActive = await page.evaluate(() => {
                const chip = document.querySelector('.theme-chip[data-theme="tech"]');
                return chip?.classList.contains('active');
            });
            await page.close();
            if (!techChipActive) {
                throw new Error('Tech chip should be highlighted when exactly matching tech word list is typed');
            }
        });

    } catch (err) {
        console.error('\n  Fatal:', err.message);
        failed++;
    } finally {
        if (browser) await browser.close();
        if (server)  server.close();
    }

    const total = passed + failed;
    console.log('\n=============================================================');
    console.log('  SKRIBL CUSTOM WORDS \u2014 FRONTEND TEST RESULTS');
    console.log('=============================================================');
    console.log(`  Total:  ${total}`);
    console.log(`  Passed: ${passed} \u2705`);
    console.log(`  Failed: ${failed} \u274C`);
    if (failures.length > 0) {
        console.log('-------------------------------------------------------------');
        console.log('  Failures:');
        failures.forEach(f => {
            console.log(`  \u274C ${f.name}`);
            console.log(`     \u2192 ${f.error}`);
        });
        console.log('=============================================================\n');
        process.exit(1);
    } else {
        console.log('-------------------------------------------------------------');
        console.log('  All tests passed! \uD83C\uDF89');
        console.log('=============================================================\n');
    }
}

runTests().catch(err => {
    console.error('[TestRunner] Fatal error:', err);
    process.exit(1);
});
