# InputKit API Reference

InputKit is a Node.js wrapper around the current Input WebSocket API. Input must be running, and each client must request authorization once before it can authenticate on later connections. The API is pre-production and follows the protocol documented by the Input application.

## Create a client

```ts
import { InputClient } from '@worklouder/input-kit';

const input = new InputClient({
  applicationName: 'My Integration',
  // host: '127.0.0.1',
  // port: 19147,
  // requestTimeoutMs: 10_000,
});
```

`applicationName` is required, trimmed, and limited to 80 printable characters. `host` accepts only `127.0.0.1`, `::1`, or `localhost`. `port` defaults to `19147`; the path is `/input`. `requestTimeoutMs` applies to normal API requests and defaults to 10 seconds. The authorization request has a 35-second timeout to allow for the approval prompt.

## Connection lifecycle

### `connect(): Promise<void>`

Opens the WebSocket connection. It does not request authorization or authenticate automatically.

### `close(): Promise<void>`

Closes the connection and rejects outstanding requests with `InputConnectionError`.

### `connected: boolean`

Reports whether the WebSocket is currently open. `url: string` exposes the resolved loopback URL.

## Authorization and authentication

### `requestAuthorization(): Promise<AuthorizationCredentials>`

Requests first-time approval in Input. InputKit exposes this as `requestAuthorization()`. The current Input WebSocket server spells the wire method `requestAutorization`; InputKit sends that exact method name for compatibility. The result is:

```ts
interface AuthorizationCredentials {
  applicationId: string;
  token: string;
}
```

Store these credentials in the calling application's secure storage. InputKit does not write credentials to disk.

### `authenticate(credentials: AuthorizationCredentials): Promise<void>`

Authenticates a previously authorized application. The saved permission must allow the connection origin used by the client.

## Requests

All request methods require an open, authenticated connection, except `requestAuthorization` and `authenticate`.

### `getDevices(): Promise<DeviceSummary[]>`

Returns ready devices supported by the current Input build. Device IDs are runtime IDs and can change after reconnection.

```ts
interface DeviceSummary {
  id: number;
  deviceType: string;
}
```

### `getDeviceInfo(deviceId: number): Promise<DeviceInfo>`

Returns Input's cached device information snapshot. It can include `deviceStatus.selectedProfileIndex` and `deviceStatus.selectedLayerIndex` when Input knows the values. The method does not query the device for fresh state.

`DeviceInfo` is `Record<string, unknown>` because fields vary by device and firmware version.

### `changeProfileLayer(options: ChangeProfileLayerOptions): Promise<{ changed: true }>`

Selects the active profile and layer together. Both indexes are zero-based and checked against Input's cached device configuration before Input sends the change to the device. A successful response means the request was accepted; the device's later profile/layer notification is the authoritative state update.

```ts
interface ChangeProfileLayerOptions {
  deviceId: number;
  profileIndex: number;
  layerIndex: number;
}
```

Input returns an error if the device, profile, or layer is unavailable, or if the device rejects the change.

### `changeKeyLighting(options: ChangeKeyLightingOptions): Promise<{ applied: true }>`

Changes lighting for API Smart Actions matched by identifier. At least one lighting property must be provided.

```ts
interface ChangeKeyLightingOptions {
  deviceId: number;
  identifier: string;
  isRegex: boolean;
  color?: number;      // 0–0xFFFFFF
  brightness?: number; // 0–1
  effect?: number;     // 0, 1, 3, 4, or 6
  speed?: number;      // 0–1
}
```

When `isRegex` is true, `identifier` is treated as a regular expression by Input. A successful response means Input's device layer acknowledged the request; it does not guarantee that the Smart Action is visible on the active layer.

### `addLayer(options: AddLayerOptions): Promise<{ added: true }>`

Adds the supplied preset layer and its referenced actions to an existing profile, then writes and verifies the device keymap.

```ts
interface AddLayerOptions {
  deviceId: number;
  profileIndex: number; // zero-based
  preset: Preset;
}
```

`Preset` is a JSON-compatible representation of Input's `PresetDTO` and includes `id`, `name`, `os`, `keyboardLayoutTypes`, `devices`, `layer`, `actions`, `actionGroups`, `multiactions`, and `multiactionGroups`; Smart Action fields and descriptive metadata are optional. Input validates that the preset matches the target device and profile. It rejects malformed key layouts, unknown keycodes, command Smart Actions, profiles with six layers, and writes that conflict with another configuration write.

Adding a layer does not select it. The current WebSocket API has no method for selecting an active profile or layer.

## Events

The server broadcasts events to all authenticated clients; there is no subscription request. Filter by `deviceId` in the application when needed.

### `devicesUpdated`

Emitted with `{ devices: DeviceSummary[] }` when the ready-device list changes.

### `deviceInfoChanged`

Emitted with `{ deviceId, deviceInfo }` when Input publishes a device information snapshot. Replace any cached snapshot with this complete value rather than merging it. Current firmware forwarding includes profile/layer notifications when the notification reaches Input and an initial `deviceStatus` is available.

### `apiKey`

Emitted with `{ deviceId, identifier, action }`, where `action` is `press`, `release`, or `click`, for mapped API Smart Actions.

### `notification`

Emitted with `{ method, params }` for every valid server notification. This includes the three events above and unknown future notifications. It can be used while adopting newer server events before InputKit adds a typed event.

### Connection and protocol events

- `disconnected`: `{ code, reason }` after the socket closes.
- `transportError`: a WebSocket transport `Error`.
- `protocolError`: an `InputProtocolError` when Input sends malformed JSON-RPC or event data.

## Errors

Request promises reject with these exported error classes:

- `InputApiError`: Input returned an error code and message. The numeric protocol code is available as `code`.
- `InputConnectionError`: the socket was unavailable, closed during a request, or could not send the request.
- `InputRequestTimeoutError`: a request exceeded its timeout; `method` and `timeoutMs` are available.
- `InputProtocolError`: Input returned a response with an invalid shape.

Input's API error codes can vary by method. Preserve `InputApiError.code` and message when handling errors instead of relying only on the message text.

## Example: reconnect with saved credentials

```ts
const input = new InputClient({ applicationName: 'My Integration' });
input.on('apiKey', ({ identifier, action }) => handleAction(identifier, action));
await input.connect();
await input.authenticate(savedCredentials);

try {
  console.log(await input.getDevices());
} finally {
  await input.close();
}
```

See [`examples/cli.mjs`](../examples/cli.mjs) for a runnable demonstration of authorization, authentication, discovery, and event handling.
