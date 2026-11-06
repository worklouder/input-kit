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
  // addLayerTimeoutMs: 120_000,
});
```

`applicationName` is normalized, trimmed, and limited to 80 printable characters. It cannot contain Unicode control, format, line, or paragraph separators. `host` accepts only `127.0.0.1`, `::1`, or `localhost`. `port` defaults to `19147` and the path is `/input`. `requestTimeoutMs` defaults to 10 seconds for ordinary requests. `addLayerTimeoutMs` defaults to 120 seconds. Both options accept integer milliseconds from `1` through `2_147_483_647`. `requestAuthorization` has a fixed 29-second response timeout. Input closes an unauthenticated connection 30 seconds after opening it, so request authorization promptly after connecting.

## Connection lifecycle

### `connect(): Promise<void>`

Opens the WebSocket connection. It does not request authorization or authenticate automatically.

### `close(): Promise<void>`

Closes the connection and rejects queued and in-flight requests with `InputConnectionError`. A disconnect also rejects outstanding requests. A new connection starts with an empty queue.

### `connected: boolean`

Reports whether the WebSocket is currently open. `url: string` exposes the resolved loopback URL.

## Authorization and authentication

### `requestAuthorization(): Promise<AuthorizationCredentials>`

Requests first-time approval using the `requestAuthorization` wire method. Input returns the application ID and token and authenticates the current connection.

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

InputKit sends requests in call order, with one request awaiting a response at a time and at least 400 ms between sends. This keeps traffic below Input's limit of 30 requests per rolling 10 seconds per connection. The response timeout begins when the frame is sent, so time spent in the queue is separate. InputKit measures the entire serialized request in UTF-8 and rejects any message larger than 512 KiB before sending it. InputKit never retries requests automatically.

### `getDevices(): Promise<DeviceSummary[]>`

Returns ready devices supported by the current Input build. Device IDs are runtime IDs and can change after reconnection.

```ts
interface DeviceSummary {
  id: number;
  deviceType: string;
}
```

### `getDeviceInfo(deviceId: number): Promise<DeviceInfo>`

Returns the latest `DeviceInfo` snapshot available to Input.

```ts
interface DeviceInfo {
  portPath: string;
  devicePid: string;
  serialNumber?: string;
  connectionType: number;
  deviceType: string;
  layoutType: string;
  isUsbConnection: boolean;
  deviceStatus?: DeviceStatus;
}

interface DeviceStatus {
  firmwareVersion?: string;
  selectedProfileIndex?: number; // zero-based
  selectedLayerIndex?: number;   // one-based
  batteryPercentage?: number;    // 0–100
  isCharging?: boolean;
}
```

### `setActiveProfileLayer(options: SetActiveProfileLayerOptions): Promise<{ changed: true }>`

Selects the active profile and layer together using the `setActiveProfileLayer` wire method. `deviceId` must be a positive safe integer. `profileIndex` is zero-based and `layerIndex` is one-based. Watch `deviceInfoChanged` for updates to the reported selection.

```ts
interface SetActiveProfileLayerOptions {
  deviceId: number;
  profileIndex: number; // zero-based
  layerIndex: number;   // one-based
}
```

Input returns an error if the device, profile, or layer is unavailable, or if the device rejects the change.

### `setKeyLighting(options: SetKeyLightingOptions): Promise<{ applied: true }>`

Changes lighting for API Smart Actions matched by identifier. `deviceId` must be a positive safe integer. Provide at least one lighting property.

```ts
interface SetKeyLightingOptions {
  deviceId: number;
  identifier: string;
  isRegex: boolean;
  color?: number;      // integer from 0 to 0xFFFFFF
  brightness?: number; // 0–1
  effect?: number;     // 0, 1, 3, 4, or 6
  speed?: number;      // 0–1
}
```

When `isRegex` is false, `identifier` must be 1 to 128 UTF-16 code units with no surrounding whitespace, ASCII control characters, or Unicode line and paragraph separators. When `isRegex` is true, supply a regular expression of 1 to 256 UTF-16 code units. Requests with invalid or unsupported patterns can fail with `InputApiError`. A successful response confirms that the update was accepted. The Smart Action's visibility depends on the active layer.

### `addLayer(options: AddLayerOptions): Promise<{ added: true }>`

Adds the supplied preset and its referenced actions to an existing profile on the device.

```ts
interface AddLayerOptions {
  deviceId: number;
  profileIndex: number; // zero-based
  preset: Preset;
}
```

`preset` is JSON-compatible and includes `id`, `name`, `os`, `keyboardLayoutTypes`, `devices`, `layer`, `actions`, `actionGroups`, `multiactions`, and `multiactionGroups`. Smart Action fields and descriptive metadata are optional. The preset must be compatible with the target device and profile. The request can fail if the key layout is malformed, keycodes are unknown, the preset contains command Smart Actions, the profile already has six layers, or another configuration change conflicts with the request.

To select a profile and layer after adding a layer, call `setActiveProfileLayer` with the desired indexes.

## Events

The server broadcasts events to all authenticated clients; there is no subscription request. Filter by `deviceId` in the application when needed.

### `devicesUpdated`

Emitted with `{ devices: DeviceSummary[] }` when the ready-device list changes.

### `deviceInfoChanged`

Emitted with `{ deviceId, deviceInfo }` for the `deviceInfoChanged` wire notification. Use this complete value to replace any cached snapshot. The event can report profile and layer changes when `deviceStatus` is available.

### `keyTriggered`

Emitted for the `keyTriggered` wire notification with `{ deviceId, identifier, action }` for mapped API Smart Actions. `action` is `press`, `release`, or `click`. The identifier follows the literal identifier rules for `setKeyLighting`.

### `notification`

Emitted with `{ method, params }` for every valid server notification. This includes the three events above and unknown future notifications. It can be used while adopting newer server events before InputKit adds a typed event.

### Connection and protocol events

- `disconnected` provides `{ code, reason }` when the current connection closes.
- `transportError`: a WebSocket transport `Error`.
- `protocolError`: an `InputProtocolError` when Input sends malformed JSON-RPC or event data.

## Errors

Request promises reject with these exported error classes:

- `InputApiError`: Input returned an error code and message. The numeric protocol code is available as `code`.
- `InputConnectionError`: the socket was unavailable, closed during a request, or could not send the request.
- `InputRequestTimeoutError` reports an expired response timeout. The operation outcome may be unknown because Input could still complete it. The error exposes the wire `method` and `timeoutMs`.
- `InputProtocolError`: Input returned a response with an invalid shape.

Local request validation can also reject with `TypeError` or `RangeError`, including a `RangeError` for an oversized request.

Input's API error codes can vary by method. Preserve `InputApiError.code` and message when handling errors instead of relying only on the message text.

## Example: reconnect with saved credentials

```ts
const input = new InputClient({ applicationName: 'My Integration' });
input.on('keyTriggered', ({ identifier, action }) => handleAction(identifier, action));
await input.connect();
await input.authenticate(savedCredentials);

try {
  console.log(await input.getDevices());
} finally {
  await input.close();
}
```

See [`examples/cli.mjs`](../examples/cli.mjs) for a runnable demonstration of authorization, authentication, discovery, and event handling.
