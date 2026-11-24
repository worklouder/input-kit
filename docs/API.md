# InputKit API Reference

InputKit is a dependency-free JavaScript client for the current Input WebSocket API. It runs on Node.js 22.4 and later and on any runtime with a standard global `WebSocket`. Input must be running, and each client must request authorization once before it can authenticate on later connections. It follows the protocol documented by the Input application.

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

`connect()` rejects with `InputConnectionError` when Input is not listening, when Input closes the connection before it opens, when the WebSocket handshake does not complete within 5 seconds, or when the runtime has no global `WebSocket`. Calling `close()` while connecting rejects the pending `connect()`.

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

Authenticates a previously authorized application. The saved permission must allow the connection origin used by the client. Node.js clients send no `Origin` header. Browsers always send the page's origin, so a browser application needs its own authorization rather than reusing credentials from a Node.js pairing.

## Requests

All request methods require an open, authenticated connection, except `requestAuthorization` and `authenticate`.

InputKit sends requests in call order, with one request awaiting a response at a time and at least 160 ms between sends. This keeps traffic below Input's limit of 65 requests per rolling 10 seconds per connection. Exceeding that limit makes Input close the connection with code `1008`. Every request counts, including `requestAuthorization` and `authenticate`.

Input also limits `setActiveProfileLayer`, `setKeyLighting`, and `addLayer` per device: 60 requests per rolling 10 seconds for a USB device and 40 for a BLE device. Each device has one budget shared by these three methods and by every connected client. `getDevices` and `getDeviceInfo` do not count. InputKit spaces these requests at least 250 ms apart for each device, which keeps a single client within the BLE limit. Other applications using the same device share its budget, so a request can still fail with `InputDeviceRateLimitError`. Requests that reach a device and then fail, for example because an identifier or layer is not found, still use the budget.

The response timeout begins when the frame is sent, so time spent in the queue is separate. InputKit measures the entire serialized request in UTF-8 and rejects any message larger than 512 KiB before sending it. InputKit never retries requests automatically.

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

Adds the supplied layer definition and its referenced actions to an existing profile on the device.

```ts
interface AddLayerOptions {
  deviceId: number;
  profileIndex: number; // zero-based
  definition: LayerDefinition;
}
```

`definition` is a JSON-compatible `LayerDefinition`. All of its parts are exported as types.

```ts
interface LayerDefinition {
  id: number;
  name: string;
  os: number[];                  // 0 macOS, 1 Windows
  keyboardLayoutTypes: string[];
  devices: string[];
  layer: LayerDefinitionLayer;
  actions: LayerAction[];
  actionGroups: ActionGroup[];
  multiactions: LayerMultiaction[];
  multiactionGroups: ActionGroup[];
  smartActions?: LayerSmartAction[];
  smartActionGroups?: ActionGroup[];
  tags?: string[];
  description?: string;
  author?: string;
  base64Image?: string;
  previewImg?: string;
}

interface LayerDefinitionLayer {
  id: number;           // Input assigns the added layer a new ID
  name: string;
  color: string;        // for example '#FF0000'
  os?: number;          // 0 macOS, 1 Windows; macOS when omitted
  layout: LayerLayout;
  lights?: LayerLights; // see Layer lighting
}

interface LayerLayout {
  base: LayerKey[][];     // rows of { keycode: string }
  encoders: LayerKey[][];
  buttons?: LayerKey[][];
  joystick?: { type: string; sectors?: { k: string; a1: number; a2: number }[] };
}

interface LayerAction {
  id: number;           // referenced by KA_<id> keycodes and group actionIds
  name: string;
  color?: string | null;
  icon?: string;
  keyInputs: KeyInput[];
}

interface KeyInput {
  keycode: string;
  delay: number;        // milliseconds
  actionType: number;   // 0 release, 1 press, 2 click
}

interface LayerMultiaction {
  id: number;
  name: string;
  tap: KeyInput;
  onHold: KeyInput;
  doubleTap: KeyInput;
  tapHold: KeyInput;
  tappingTerms: number;
}

interface LayerSmartAction {
  id: number;
  name: string;
  type: string;         // TEXT_STEP, APP_STEP, URL_STEP, or API
  payload: { text: string } | { url: string } | { name: string; path: string } | { id: string };
}

interface ActionGroup {
  id: number;
  name: string;
  actionIds: number[];  // IDs defined in the same definition
  tags?: string[];
  color?: string;
}
```

Fields that take a fixed set of values, such as `os`, `actionType`, and Smart Action `type`, are typed as `number` or `string` so definitions loaded from JSON files stay assignable. InputKit checks the structure and these values before sending and throws a `TypeError` or `RangeError` naming the invalid field, for example `definition.layer.layout.base[0][1].keycode must be a string`. Extra fields are passed through unchanged, except in `lights`.

Input also checks what InputKit cannot: the layout rows must match the target device's key layout, each keycode must exist, and groups may only reference IDs defined in the same definition. The request also fails if the profile already has six layers or another configuration change conflicts with the request. Input reports these as `InputApiError`.

When the device is open in Input's main window, the window adds the layer to its current configuration, including the user's unsaved edits, and saves it after its usual countdown. `{ added: true }` then means the window has the layer, not that the device has saved it. If that save fails, Input shows the error to the user rather than to your application. The profile and six-layer checks apply to the window's configuration, and the request fails with `InputApiError` code `-32013` if the window does not answer within 5 seconds. Otherwise, Input adds the layer to the configuration last saved to the device and resolves once the device has it.

#### Layer lighting

`definition.layer.lights` optionally sets the backlight and underglow of the new layer.

```ts
interface LayerLights {
  backlight?: SideLighting;
  underglow?: SideLighting;
}

interface SideLighting {
  effect: number;      // 0 off, 1 solid, 2 snake, 3 rainbow, 4 breath, 5 gradient
  color?: number;      // 0 to 0xFFFFFF
  brightness?: number; // 0 to 1
  speed?: number;      // 0 to 1
  magic?: number;      // 0 to 1
}
```

`lights` must contain at least one side, each side must contain `effect`, and unknown fields are rejected. Effect `6` is only available to `setKeyLighting`.

- When `lights` is omitted, the new layer copies the lighting of the profile's last layer, or uses the device defaults when that layer has none.
- When only one side is sent, the other side uses the device default.
- Input fills unset fields as its lighting editor does: `color` (`0xFFFFFF`) and `brightness` (`0.5`) unless the effect is off, and `speed` and `magic` (`0.5`) unless the effect is off or solid.

Devices without lighting, such as Nomad E and Knob models, reject `lights` with `InputApiError` code `-32602`. Omit `lights` for those devices.

To select a profile and layer after adding a layer, call `setActiveProfileLayer` with the desired indexes.

## Events

The server broadcasts events to all authenticated clients; there is no subscription request. Filter by `deviceId` in the application when needed.

`InputClient` provides `on(event, listener)`, `once(event, listener)`, `off(event, listener)`, and `emit(event, payload)`. Each event has a single typed payload, and each method except `emit` returns the client for chaining. `InputClient` is not a Node.js `EventEmitter`: `events.once()` and `removeListener` are not supported, and an emitted error event with no listener does not throw.

### `devicesUpdated`

Emitted with `{ devices: DeviceSummary[] }` when the ready-device list changes.

### `deviceInfoChanged`

Emitted with `{ deviceId, deviceInfo }` for the `deviceInfoChanged` wire notification. Use this complete value to replace any cached snapshot. The event can report profile and layer changes when `deviceStatus` is available.

### `keyTriggered`

Emitted for the `keyTriggered` wire notification with `{ deviceId, identifier, action }` for mapped API Smart Actions. `action` is `press`, `release`, or `click`. The identifier follows the literal identifier rules for `setKeyLighting`.

### `notification`

Emitted with `{ method, params }` for every valid server notification. This includes the three events above and unknown future notifications. It can be used while adopting newer server events before InputKit adds a typed event.

### Connection and protocol events

- `disconnected` provides `{ code, reason }` when the current connection closes. A connection that fails or is aborted before it opens reports code `1006`.
- `transportError`: a WebSocket transport `Error`. Standard WebSocket error events carry no detail, so the error message can be generic.
- `protocolError`: an `InputProtocolError` when Input sends malformed JSON-RPC or event data. If Input sends a binary frame, InputKit also closes the connection with application close code `4003` and reason `Text messages only`.

## Errors

Request promises reject with these exported error classes:

- `InputApiError`: Input returned an error code and message. The numeric protocol code is available as `code`.
- `InputDeviceRateLimitError`: a subclass of `InputApiError` with `code` `-32017`, raised when the device's shared rate-limit budget is used up. It exposes the wire `method` and `deviceId`. The connection stays open and the request is safe to retry once earlier requests leave the 10-second window. Wait at least 250 ms, back off if it repeats, and remember that retries count toward the per-connection limit.
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
