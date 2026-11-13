# InputKit

InputKit is a JavaScript client library for JavaScript and TypeScript applications that connect to the local Input WebSocket API. It has no runtime dependencies and uses the standard global `WebSocket`, so it runs on Node.js 22.4 and later and on any runtime with a standard `WebSocket`. It ships ESM and CommonJS builds.

Input must be running for a client to connect. On the first connection, call `requestAuthorization()` to ask the user to approve the application. Store the returned credentials in your application's secure storage.

## Installation

Install InputKit with Yarn:

    yarn add @worklouder/input-kit

Or with npm:

    npm install @worklouder/input-kit

On Node.js, InputKit requires version 22.4 or later, the first release with a stable global `WebSocket`. Other runtimes need a standard global `WebSocket` and `TextEncoder`; `connect()` rejects with `InputConnectionError` if `WebSocket` is missing.

## Local development

From this repository, run `yarn install` followed by `yarn build`. Run `yarn test` to build the package and test it against a local WebSocket server. The `ws` package is a development dependency used only by that test server.

## Quick start

```ts
import { InputClient } from '@worklouder/input-kit';

const input = new InputClient({ applicationName: 'My Integration' });

input.on('devicesUpdated', ({ devices }) => {
  console.log('Available devices:', devices);
});
input.on('keyTriggered', ({ deviceId, identifier, action }) => {
  console.log(deviceId, identifier, action);
});

await input.connect();
const credentials = await input.requestAuthorization(); // First run only; prompts for approval.
const devices = await input.getDevices();
console.log(devices);
await input.close();
```

On later connections, call `input.authenticate(credentials)` instead of requesting authorization again.

In CommonJS, load the same API with `require`.

```js
const { InputClient } = require('@worklouder/input-kit');
```

ESM and CommonJS load separate copies of the exported classes. When using `instanceof`, get the constructor from the same entry point as the value being checked.

`InputClient` uses a small built-in typed event emitter with `on`, `once`, `off`, and `emit`. It is not a Node.js `EventEmitter`, so helpers such as `events.once()` from `node:events` do not work with it; wrap `input.once()` in a promise instead.

## Example CLI

With Input running, run `yarn example` to request authorization or authenticate, print device and active profile/layer information, and watch events. Run `yarn example devices` to print the current state and exit. The CLI saves its demo token as a local plaintext JSON file; production integrations should use operating system secure credential storage.

## API and design

InputKit exposes these request methods: `requestAuthorization`, `authenticate`, `getDevices`, `getDeviceInfo`, `setActiveProfileLayer`, `setKeyLighting`, and `addLayer`. It also provides typed events for `devicesUpdated`, `deviceInfoChanged`, and `keyTriggered`, plus a generic `notification` event for forward compatibility.

The API reference documents parameters, return values, events, errors, and the current layer behavior: [docs/API.md](docs/API.md). The package structure and module responsibilities are described in [docs/architecture.md](docs/architecture.md).

`setActiveProfileLayer` selects the active profile and layer together. Profile indexes start at `0` and layer indexes start at `1`. `addLayer` adds a layer to a profile while keeping the active selection. Use `getDeviceInfo` to read the reported selection and `deviceInfoChanged` to watch for updates.

InputKit sends one request at a time with at least 400 ms between sends and caps each JSON request at 512 KiB of UTF-8. Response timeouts start at send time and default to 10 seconds for ordinary requests, 29 seconds for `requestAuthorization`, and 120 seconds for `addLayer`. A timeout can leave the operation outcome unknown. InputKit never retries requests automatically.

## Compatibility and security

InputKit connects only to loopback hosts, at `ws://127.0.0.1:19147/input` by default. Input supports the WebSocket API for Creator Micro V2 and Codex Micro when the device is connected and its keymap is ready.

Authorization returns a bearer token once. Do not log it or commit it. Authenticate with the same connection origin you used for authorization. Node.js clients connect without an `Origin` header. Browsers always send the page's origin, and Input ties authorization to the origin, so a browser application needs its own pairing; credentials from a Node.js pairing do not carry over.

The standard `WebSocket` client offers `permessage-deflate` compression and cannot be configured not to. Input declines the offer, so messages are sent uncompressed.
