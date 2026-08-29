import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const roomHistoryDuration = new Trend('room_history_duration_ms');
const leaderboardDuration = new Trend('leaderboard_duration_ms');
const errorRate = new Rate('http_error_rate');
const totalRequests = new Counter('total_requests');

export const options = {
    stages: [
        { duration: '15s', target: 20 },
        { duration: '60s', target: 20 },
        { duration: '15s', target: 50 },
        { duration: '30s', target: 50 },
        { duration: '10s', target: 0 },
    ],

    thresholds: {
        http_req_duration: ['p(95)<500'],
        http_error_rate: ['rate<0.05'],
        leaderboard_duration_ms: ['p(95)<300'],
    },
};

const BASE_URL = 'http://localhost:3000';

function randomRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export default function () {
    totalRequests.add(1);

    const health = http.get(`${BASE_URL}/health`);
    check(health, {
        'health: status 200': (r) => r.status === 200,
        'health: body ok': (r) => r.json('status') === 'ok',
    });
    errorRate.add(health.status !== 200);

    sleep(0.5);

    const roomCode = randomRoomCode();
    const startHistory = Date.now();
    const history = http.get(`${BASE_URL}/api/v1/games/${roomCode}/history`);
    roomHistoryDuration.add(Date.now() - startHistory);

    check(history, {
        'history: status 200': (r) => r.status === 200,
        'history: has data key': (r) => r.json('success') === true,
    });
    errorRate.add(history.status !== 200);

    sleep(0.5);

    const startLeaderboard = Date.now();
    const leaderboard = http.get(`${BASE_URL}/api/v1/leaderboard`);
    leaderboardDuration.add(Date.now() - startLeaderboard);

    check(leaderboard, {
        'leaderboard: status 200': (r) => r.status === 200,
        'leaderboard: is array': (r) => Array.isArray(r.json('data')),
    });
    errorRate.add(leaderboard.status !== 200);

    sleep(1);
}
