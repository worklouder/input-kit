import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocketServer } from 'ws';
import {
    InputApiError,
    InputClient,
    InputConnectionError,
    InputProtocolError,
    InputRequestTimeoutError,
} from '../dist/index.js';

const maxPayload = 512 * 1024;
const credentials = { applicationId: 'example-app-id', token: 'example-token' };
const device = { id: 7, deviceType: 'creator_micro_v2' };
const deviceInfo = {
    portPath: '/dev/input-example',
    devicePid: 'example-device-pid',
    serialNumber: 'example-serial-number',
    connectionType: 1,
    deviceType: device.deviceType,
    layoutType: 'ansi',
    isUsbConnection: true,
    deviceStatus: {
        firmwareVersion: '1.2.3',
        selectedProfileIndex: 0,
        selectedLayerIndex: 1,
        batteryPercentage: 75,
        isCharging: false,
    },
};
const selection = { deviceId: 7, profileIndex: 0, layerIndex: 1 };
const lighting = { deviceId: 7, identifier: 'example-key', isRegex: false, color: 0xffffff };
const addLayerOptions = {
    deviceId: 7,
    profileIndex: 0,
    definition: {
        id: 1,
        name: 'Example',
        os: [],
        keyboardLayoutTypes: [],
        devices: [],
        layer: { name: 'Example', keys: [] },
        actionGroups: [],
        multiactionGroups: [],
        actions: [],
        multiactions: [],
    },
};

async function connect(t, options = {}) {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0, path: '/input', maxPayload });
    await once(server, 'listening');
    const client = new InputClient({ applicationName: 'Example Integration', port: server.address().port, ...options });
    const requests = [];
    server.on('connection', (peer) => {
        peer.on('message', (data, binary) => {
            const frame = { peer, bytes: data.length, binary, request: JSON.parse(data), receivedAt: performance.now() };
            requests.push(frame);
            server.emit('request', frame);
        });
    });
    t.after(async () => {
        for (const peer of server.clients) peer.terminate();
        await Promise.all([client.close(), new Promise((resolve) => server.close(resolve))]);
    });
    const [peer] = await Promise.all([once(server, 'connection').then(([socket]) => socket), client.connect()]);
    return { client, server, peer, requests };
}

async function nextRequest(server) {
    const [frame] = await once(server, 'request');
    return frame;
}

function respond({ peer, request }, result) {
    peer.send(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
}

test('sends the current request literals and parameter shapes through the public API', { timeout: 10_000 }, async (t) => {
    const { client, server } = await connect(t, { requestTimeoutMs: 1_000 });
    const definitionWithMetadata = {
        ...addLayerOptions,
        definition: { ...addLayerOptions.definition, metadata: { example: true } },
    };
    const cases = [
        ['requestAuthorization', { applicationName: 'Example Integration' }, credentials, () => client.requestAuthorization()],
        [
            'authenticate', credentials, { authenticated: true },
            () => client.authenticate({ ...credentials, extra: true }),
        ],
        ['getDevices', undefined, [device], () => client.getDevices()],
        ['getDeviceInfo', { deviceId: 7 }, deviceInfo, () => client.getDeviceInfo(7)],
        [
            'setActiveProfileLayer', selection, { changed: true },
            () => client.setActiveProfileLayer({ ...selection, extra: true }),
        ],
        [
            'setKeyLighting', lighting, { applied: true },
            () => client.setKeyLighting({ ...lighting, brightness: undefined, extra: true }),
        ],
        [
            'addLayer',
            {
                deviceId: definitionWithMetadata.deviceId,
                profileIndex: definitionWithMetadata.profileIndex,
                definition: definitionWithMetadata.definition,
            },
            { added: true },
            () => client.addLayer({ ...definitionWithMetadata, extra: true }),
        ],
    ];
    for (const [index, [method, params, result, call]] of cases.entries()) {
        const incoming = nextRequest(server);
        const response = call();
        const frame = await incoming;
        assert.equal(frame.binary, false);
        const expected = { jsonrpc: '2.0', id: index + 1, method };
        if (params !== undefined) expected.params = params;
        assert.deepEqual(frame.request, expected);
        respond(frame, result);
        assert.deepEqual(await response, method === 'authenticate' ? undefined : result);
    }
});

test('normalizes application names and rejects unsupported Unicode characters', { timeout: 5_000 }, async (t) => {
    const { client, server } = await connect(t, { applicationName: '  Example\u00a0Integration  ' });
    const incoming = nextRequest(server);
    const authorization = client.requestAuthorization();
    const frame = await incoming;
    assert.deepEqual(frame.request.params, { applicationName: 'Example Integration' });
    respond(frame, credentials);
    await authorization;

    for (const applicationName of ['Input\u0085Kit', 'Input\u200bKit']) {
        assert.throws(
            () => new InputClient({ applicationName }),
            /applicationName must be 1 to 80 printable characters/,
        );
    }
});

test('decodes typed notifications and forwards valid wire notifications', { timeout: 5_000 }, async (t) => {
    const { client, peer } = await connect(t);
    async function notify(method, params, eventName) {
        const generic = once(client, 'notification');
        const typed = eventName && once(client, eventName);
        peer.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
        assert.deepEqual(await generic, [{ method, params }]);
        if (typed) assert.deepEqual(await typed, [params]);
    }

    await notify('devicesUpdated', { devices: [device] }, 'devicesUpdated');
    await notify('deviceInfoChanged', { deviceId: 7, deviceInfo }, 'deviceInfoChanged');
    for (const action of ['press', 'release', 'click']) {
        await notify(
            'keyTriggered',
            { deviceId: 7, identifier: 'a'.repeat(128), action },
            'keyTriggered',
        );
    }
    await notify('futureEvent', { example: true });

    const invalid = [
        ['deviceInfoChanged', { deviceId: 0, deviceInfo }],
        ...['', ' padded', 'a'.repeat(129), 'line\u2028break', 'a\u007fb', 4].map((identifier) => [
            'keyTriggered', { deviceId: 7, identifier, action: 'press' },
        ]),
    ];
    for (const [method, params] of invalid) {
        const protocolError = once(client, 'protocolError');
        peer.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
        const [error] = await protocolError;
        assert.ok(error instanceof InputProtocolError);
        assert.ok(error.message.includes(method));
    }
});

test('validates profile, layer, and lighting bounds before sending', { timeout: 5_000 }, async (t) => {
    const { client, server, requests } = await connect(t);
    await assert.rejects(client.setActiveProfileLayer({ ...selection, profileIndex: -1 }), /profileIndex/);
    for (const layerIndex of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        await assert.rejects(client.setActiveProfileLayer({ ...selection, layerIndex }), /layerIndex/);
    }
    await assert.rejects(client.addLayer({ ...addLayerOptions, profileIndex: -1 }), /profileIndex/);

    const invalidLighting = [
        [{ deviceId: 0 }, /deviceId/],
        [{ deviceId: Number.MAX_SAFE_INTEGER + 1 }, /deviceId/],
        [{ isRegex: 'false' }, /isRegex/],
        [{ identifier: '' }, /identifier/],
        [{ identifier: ' padded ' }, /identifier/],
        [{ identifier: 'line\nbreak' }, /identifier/],
        [{ identifier: 'a'.repeat(129) }, /identifier/],
        [{ isRegex: true, identifier: '' }, /pattern/],
        [{ isRegex: true, identifier: 'a'.repeat(257) }, /pattern/],
        [{ color: undefined }, /at least one/],
        ...[-1, 0x1000000, 0.5, null].map((color) => [{ color }, /color/]),
        ...[-0.1, 1.1, NaN, '0.5'].map((brightness) => [{ brightness }, /brightness/]),
        ...[2, 5, '1'].map((effect) => [{ effect }, /effect/]),
        ...[-0.1, 1.1, Infinity].map((speed) => [{ speed }, /speed/]),
    ];
    for (const [options, error] of invalidLighting) {
        await assert.rejects(client.setKeyLighting({ ...lighting, ...options }), error);
    }
    assert.equal(requests.length, 0);

    const validLighting = [
        { ...lighting, identifier: 'a'.repeat(128), brightness: 1, effect: 6, speed: 0.5 },
        { ...lighting, identifier: 'a'.repeat(256), isRegex: true, color: 0, brightness: 0, effect: 0, speed: 1 },
    ];
    for (const options of validLighting) {
        const incoming = nextRequest(server);
        const result = client.setKeyLighting(options);
        const frame = await incoming;
        assert.deepEqual(frame.request.params, options);
        respond(frame, { applied: true });
        assert.deepEqual(await result, { applied: true });
    }
});

test('serializes requests and starts response timers after queueing', { timeout: 5_000 }, async (t) => {
    const { client, server, requests } = await connect(t, { requestTimeoutMs: 150 });
    const incoming = nextRequest(server);
    const write = client.addLayer(addLayerOptions);
    const devices = client.getDevices();
    const devicesResult = assert.doesNotReject(devices);
    const first = await incoming;
    assert.equal(first.request.method, 'addLayer');
    await delay(525);
    assert.equal(requests.length, 1);

    const secondIncoming = nextRequest(server);
    respond(first, { added: true });
    assert.deepEqual(await write, { added: true });
    const second = await secondIncoming;
    assert.equal(second.request.method, 'getDevices');
    respond(second, [device]);
    await devicesResult;
    assert.deepEqual(await devices, [device]);

    const thirdIncoming = nextRequest(server);
    const info = client.getDeviceInfo(7);
    const third = await thirdIncoming;
    assert.ok(third.receivedAt - second.receivedAt >= 380, 'requests should be spaced about 400 ms apart');
    respond(third, deviceInfo);
    assert.deepEqual(await info, deviceInfo);
});

test('limits the entire outbound JSON frame to 512 KiB measured in UTF-8', { timeout: 5_000 }, async (t) => {
    const { client, server, requests } = await connect(t);
    const options = {
        ...addLayerOptions,
        definition: { ...addLayerOptions.definition, name: '' },
    };
    const emptyFrame = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'addLayer',
        params: {
            deviceId: options.deviceId,
            profileIndex: options.profileIndex,
            definition: options.definition,
        },
    });
    const budget = maxPayload - Buffer.byteLength(emptyFrame);
    options.definition.name = 'é'.repeat(Math.floor(budget / 2)) + 'a'.repeat(budget % 2);

    const incoming = nextRequest(server);
    const result = client.addLayer(options);
    const frame = await incoming;
    assert.equal(frame.bytes, maxPayload);
    assert.deepEqual(frame.request.params, {
        deviceId: options.deviceId,
        profileIndex: options.profileIndex,
        definition: options.definition,
    });
    respond(frame, { added: true });
    await result;

    options.definition.name += 'a';
    await assert.rejects(client.addLayer(options), { name: 'RangeError', message: /512 KiB/ });
    options.definition.name = 'a'.repeat(budget + 1);
    await assert.rejects(client.addLayer(options), { name: 'RangeError', message: /512 KiB/ });
    assert.equal(requests.length, 1);
});

test('reports timeouts with an unknown outcome, ignores late replies, and never retries', { timeout: 5_000 }, async (t) => {
    const { client, server, requests } = await connect(t, { addLayerTimeoutMs: 50 });
    const incoming = nextRequest(server);
    const timeout = assert.rejects(client.addLayer(addLayerOptions), (error) => {
        assert.ok(error instanceof InputRequestTimeoutError);
        assert.equal(error.method, 'addLayer');
        assert.equal(error.timeoutMs, 50);
        assert.match(error.message, /outcome may be unknown/i);
        return true;
    });
    const first = await incoming;
    const secondIncoming = nextRequest(server);
    const devices = client.getDevices();
    await timeout;
    const second = await secondIncoming;
    assert.equal(second.request.method, 'getDevices');
    respond(first, { added: true });
    respond(second, [device]);
    assert.deepEqual(await devices, [device]);
    await delay(450);
    assert.deepEqual(requests.map(({ request }) => request.method), ['addLayer', 'getDevices']);
});

test('preserves the server API error code and message', { timeout: 5_000 }, async (t) => {
    const { client, server } = await connect(t);
    const incoming = nextRequest(server);
    const failure = assert.rejects(client.setKeyLighting(lighting), (error) => {
        assert.ok(error instanceof InputApiError);
        assert.equal(error.code, -32009);
        assert.equal(error.message, 'Identifier not found');
        return true;
    });
    const { peer, request } = await incoming;
    peer.send(JSON.stringify({
        jsonrpc: '2.0', id: request.id, error: { code: -32009, message: 'Identifier not found' },
    }));
    await failure;
});

test('rejects malformed JSON-RPC errors and missing results with InputProtocolError', { timeout: 5_000 }, async (t) => {
    const { client, server } = await connect(t);
    const responses = [
        { error: { code: '-32009', message: 'Identifier not found' } },
        { error: { code: -32009 } },
        { error: { code: -32009, message: null } },
        {},
    ];
    for (const response of responses) {
        const incoming = nextRequest(server);
        const failure = assert.rejects(client.getDevices(), InputProtocolError);
        const { peer, request } = await incoming;
        peer.send(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...response }));
        await failure;
    }
});

test('rejects malformed DeviceInfo results and notifications with InputProtocolError', { timeout: 5_000 }, async (t) => {
    const { client, server, peer } = await connect(t);
    const invalidDeviceInfoResults = [
        { ...deviceInfo, connectionType: 'hid' },
        {
            ...deviceInfo,
            deviceStatus: { ...deviceInfo.deviceStatus, selectedLayerIndex: 0 },
        },
    ];
    for (const invalidDeviceInfo of invalidDeviceInfoResults) {
        const incoming = nextRequest(server);
        const failure = assert.rejects(client.getDeviceInfo(7), InputProtocolError);
        respond(await incoming, invalidDeviceInfo);
        await failure;
    }

    const protocolError = once(client, 'protocolError');
    peer.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'deviceInfoChanged',
        params: { deviceId: 7, deviceInfo: { ...deviceInfo, deviceStatus: { selectedLayerIndex: 0 } } },
    }));
    assert.ok((await protocolError)[0] instanceof InputProtocolError);
});

test('rejects invalid success results with InputProtocolError', { timeout: 5_000 }, async (t) => {
    const { client, server } = await connect(t);
    const cases = [
        [() => client.setActiveProfileLayer(selection), { changed: false }],
        [() => client.setKeyLighting(lighting), { applied: false }],
        [() => client.addLayer(addLayerOptions), { added: false }],
    ];
    for (const [call, result] of cases) {
        const incoming = nextRequest(server);
        const failure = assert.rejects(call(), InputProtocolError);
        respond(await incoming, result);
        await failure;
    }
});

test('rejects in-flight and queued requests on disconnect', { timeout: 5_000 }, async (t) => {
    const { client, server, peer, requests } = await connect(t);
    const incoming = nextRequest(server);
    const inFlight = assert.rejects(client.getDevices(), InputConnectionError);
    const queued = assert.rejects(client.setKeyLighting(lighting), InputConnectionError);
    await incoming;
    const disconnected = once(client, 'disconnected');
    peer.close(1008, 'Test disconnect');
    assert.deepEqual(await disconnected, [{ code: 1008, reason: 'Test disconnect' }]);
    await Promise.all([inFlight, queued]);
    assert.equal(client.connected, false);
    assert.equal(requests.length, 1);
});

test('discards a scheduled send on close and isolates requests on the replacement socket', { timeout: 5_000 }, async (t) => {
    const { client, server, peer, requests } = await connect(t);
    const incoming = nextRequest(server);
    const devices = client.getDevices();
    respond(await incoming, [device]);
    await devices;

    const queued = assert.rejects(client.setKeyLighting(lighting), InputConnectionError);
    peer.pause();
    const closed = client.close();
    const newPeer = once(server, 'connection');
    await client.connect();
    const [replacement] = await newPeer;
    await queued;

    const freshIncoming = nextRequest(server);
    const fresh = client.getDeviceInfo(7);
    const freshFrame = await freshIncoming;
    assert.equal(freshFrame.peer, replacement);
    assert.equal(freshFrame.request.method, 'getDeviceInfo');
    peer.terminate();
    await closed;
    respond(freshFrame, deviceInfo);
    assert.deepEqual(await fresh, deviceInfo);
    await delay(450);
    assert.deepEqual(requests.map(({ request }) => request.method), ['getDevices', 'getDeviceInfo']);
});
