import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as esm from '@worklouder/input-kit';

const packageName = '@worklouder/input-kit';
const options = { applicationName: 'Package Export Test' };

test('package self-reference resolves and loads the ESM import entry point', async () => {
    assert.equal(import.meta.resolve(packageName), new URL('../dist/index.js', import.meta.url).href);
    const client = new esm.InputClient(options);
    await assert.rejects(client.getDevices(), esm.InputConnectionError);
});

test('package self-reference resolves and loads the CommonJS require entry point', async () => {
    const require = createRequire(import.meta.url);
    const entry = fileURLToPath(new URL('../dist/cjs/index.js', import.meta.url));
    assert.equal(require.resolve(packageName), entry);

    const commonjs = require(packageName);
    assert.deepEqual(Object.keys(commonjs).sort(), Object.keys(esm).sort());
    const client = new commonjs.InputClient(options);
    await assert.rejects(client.getDevices(), commonjs.InputConnectionError);
});
