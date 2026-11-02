# InputKit

InputKit is a Node.js client library for JavaScript and TypeScript applications that connect to the local Input WebSocket API.

Input must be running for a client to connect. The first connection asks the user to authorize the application. Store the returned authorization credentials in your application's secure storage; InputKit does not persist credentials.

## Install and build locally

The npm package is not published yet. From this repository, run:

    yarn install
    yarn build

## Quick start

```ts
import { InputClient } from '@worklouder/input-kit';

const input = new InputClient({ applicationName: 'My Integration' });

input.on('devicesUpdated', ({ devices }) => {
  console.log('Available devices:', devices);
});
input.on('apiKey', ({ deviceId, identifier, action }) => {
  console.log(deviceId, identifier, action);
});

await input.connect();
const credentials = await input.requestAuthorization(); // First run only; prompts for approval.
const devices = await input.getDevices();
console.log(devices);
await input.close();
```

On later connections, call `input.authenticate(credentials)` instead of requesting authorization again.

## Example CLI

With Input running, run `yarn example` to request authorization or authenticate, print device and active profile/layer information, and watch events. Run `yarn example devices` to print the current state and exit. The CLI saves its demo token as a local plaintext JSON file; production integrations should use operating system secure credential storage.

## API and design

InputKit exposes these request methods: `requestAuthorization`, `authenticate`, `getDevices`, `getDeviceInfo`, `changeProfileLayer`, `changeKeyLighting`, and `addLayer`. It also provides typed events for `devicesUpdated`, `deviceInfoChanged`, and `apiKey`, plus a generic `notification` event for forward compatibility.

The API reference documents parameters, return values, events, errors, and the current layer behavior: [docs/API.md](docs/API.md). The package structure and module responsibilities are described in [docs/architecture.md](docs/architecture.md).

`changeProfileLayer` selects the active profile and layer together. `addLayer` adds a layer to a profile without selecting it. InputKit can also report selected indexes from device information and forward change notifications when Input receives them from firmware.

## Compatibility and security

This proof of concept follows the current pre-production Input WebSocket API. It connects only to loopback hosts, at `ws://127.0.0.1:19147/input` by default. Input supports the WebSocket API for Creator Micro V2 and Codex Micro when the device is connected and its keymap is ready. The protocol can change before production.

Authorization returns a bearer token once. Do not log it or commit it. Input binds stored permissions to the connection origin; Node.js clients connect without an Origin header by default.
