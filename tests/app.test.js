const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');

const baseUrl = new URL(
    process.env.TEST_BASE_URL || 'http://127.0.0.1:8080'
);

const agent = new http.Agent({
    keepAlive: true,
    maxSockets: 1,
});


function get(path) {
    return new Promise((resolve, reject) => {
        const req = http.get(
            new URL(path, baseUrl),
            { agent },
            (res) => {
                let body = '';
                res.setEncoding('utf8');

                res.on('data', (chunk) => {
                    body += chunk;
                });

                res.on('end', () => {
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body,
                    });
                });

                res.on('error', reject);
            }
        );

        req.setTimeout(3000, () => {
            req.destroy(new Error(`Timeout: GET ${path}`));
        });

        req.on('error', reject);
    });
}


function metricValue(text, name) {
    const line = text
        .split('\n')
        .find((line) => line.startsWith(`${name} `));

    assert.ok(line, `Metric "${name}" is missing`);

    const value = Number(line.slice(name.length + 1));
    assert.ok(Number.isFinite(value), `Invalid value for "${name}"`);

    return value;
}

async function readMetric(name) {
    const response = await get('/metrics');
    assert.equal(response.status, 200);
    return metricValue(response.body, name);
}


async function waitForConnections(expected) {
    const deadline = Date.now() + 3000;
    let actual;

    do {
        actual = await readMetric('active_connections');

        if (actual === expected) {
            return;
        }

        await delay(50);
    } while (Date.now() < deadline);

    assert.equal(actual, expected, 'Unexpected active_connections');
}

test('Running application', { timeout: 30000 }, async (t) => {
    t.after(() => agent.destroy());

   
    const routes = [
        ['/my-app', 'Hello, World!'],
        [
            '/about',
            'This is a sample Node.js application for Kubernetes deployment testing.',
        ],
        ['/ready', 'Ready'],
        ['/live', 'Alive'],
        ['/classified', 'You should not be here!!!'],
    ];

    for (const [path, expectedBody] of routes) {
        await t.test(`GET ${path}: status and body`, async () => {
            const response = await get(path);

            assert.equal(response.status, 200);
            assert.equal(response.body, expectedBody);
        });
    }

    await t.test('Unknown route returns 404', async () => {
        const response = await get('/does-not-exist');
        assert.equal(response.status, 404);
    });

    await t.test('GET /metrics exposes application and default metrics', async () => {
        const response = await get('/metrics');

        assert.equal(response.status, 200);
        assert.match(response.headers['content-type'], /^text\/plain\b/);

        assert.match(
            response.body,
            /^# TYPE root_access_total counter$/m
        );

        assert.match(
            response.body,
            /^# TYPE active_connections gauge$/m
        );

        assert.ok(
            metricValue(response.body, 'root_access_total') >= 0
        );

        assert.ok(
            metricValue(response.body, 'active_connections') >= 1
        );

        assert.ok(
            metricValue(response.body, 'process_resident_memory_bytes') > 0
        );
    });

    await t.test('/my-app increments the counter by one', async () => {
        const before = await readMetric('root_access_total');

        const response = await get('/my-app');
        assert.equal(response.status, 200);

        const after = await readMetric('root_access_total');
        assert.equal(after, before + 1);
    });

    await t.test('Other routes do not increment root_access_total', async () => {
        const before = await readMetric('root_access_total');

        for (const path of [
            '/about',
            '/ready',
            '/live',
            '/classified',
            '/metrics',
        ]) {
            const response = await get(path);
            assert.equal(response.status, 200);
        }

        const after = await readMetric('root_access_total');
        assert.equal(after, before);
    });

    await t.test('TCP connection increments and decrements the gauge', async () => {
        const before = await readMetric('active_connections');

        
        const socket = net.createConnection({
            host: baseUrl.hostname,
            port: Number(baseUrl.port || 80),
        });

        socket.setTimeout(3000, () => {
            socket.destroy(new Error('TCP connection timeout'));
        });

        t.after(() => socket.destroy());

        await once(socket, 'connect');
        await waitForConnections(before + 1);

        
        const closed = once(socket, 'close');
        socket.destroy();
        await closed;

        await waitForConnections(before);
    });
});