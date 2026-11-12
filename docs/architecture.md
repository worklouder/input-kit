# Package Architecture

InputKit has two boundaries: the public JavaScript client API and the Input WebSocket protocol. The package contains no Electron or private Input application imports and has no runtime dependencies. Source files use only standard JavaScript and web platform globals, so the package runs on Node.js 22.4 and later and on any runtime with a standard global `WebSocket`.

## Module responsibilities

- `event-emitter.ts` provides the small typed emitter (`on`, `once`, `off`, `emit`) used by `InputClient` and the transport in place of `node:events`.
- `input-client.ts` exposes the stable, user-facing `InputClient` methods. It translates typed method calls into protocol requests, validates API results, and emits the public event names.
- `transport/json-rpc-transport.ts` owns the WebSocket connection, JSON-RPC request IDs, UTF-8 framing, request queue, response timeouts, response correlation, and transport failures.
- `notifications.ts` validates and decodes server notification payloads into typed event data.
- `validation.ts` contains boundary checks for IDs, indexes, device summaries, API identifiers, and lighting parameters.
- `contracts.ts` defines the public option, request, event, and data types. `LayerDefinition` mirrors the JSON shape accepted by `addLayer` without importing private application code.
- `errors.ts` defines errors consumers can catch without depending on transport internals.
- `index.ts` is the package export barrel. Internal transport details stay private.

## Transport

The transport uses `globalThis.WebSocket`, the standard client built into Node.js 22.4+ and browsers, and fails `connect()` with a clear `InputConnectionError` when it is missing. Because the standard client has no handshake timeout option, the transport runs its own 5-second timer. When the timer fires, or `close()` is called while connecting, the transport rejects `connect()`, detaches the socket, reports `disconnected` with code `1006`, and closes the socket without waiting for a `close` event, because some runtimes never deliver one for a socket closed while connecting.

The socket uses `binaryType = 'arraybuffer'`. Text frames arrive as strings; any other message is treated as binary, reported as a `protocolError`, and the connection is closed with application code `4003`. The standard `close()` accepts only `1000` or `3000`–`4999`, so the protocol-level `1003` code cannot be used. Request size is measured with `TextEncoder`.

The standard client always offers `permessage-deflate`; Input declines it. Node.js sends no `Origin` header, while browsers always send one. Input ties authorization to the origin, so a browser needs its own pairing.

## Request lifecycle

The transport checks the serialized frame against Input's 512 KiB limit before queueing it. It holds one active request per connection and spaces sends by at least 400 ms to stay under Input's 30-request limit per rolling 10 seconds. The response timer starts at send time. `InputClient` supplies the 29-second authorization timeout and the configurable 120-second `addLayer` default. The ordinary response timeout defaults to 10 seconds.

Closing or replacing a connection clears its queued requests and any in-flight request. A timeout releases the queue for the next request and reports that the timed-out operation's outcome may be unknown. The transport ignores late responses and never retries requests automatically.

## Change guidelines

When adding a WebSocket method, add its public request and response types to `contracts.ts`, implement the wrapper in `InputClient`, validate the response shape, export the type from `index.ts`, and document the method. Keep wire encoding and request lifecycle inside the transport. See the [API reference](API.md).

When adding a server event, validate the incoming parameters in `notifications.ts`, add a typed public event contract in `contracts.ts`, forward it from `InputClient`, export the event type, and document its behavior. Keep unknown notifications available through the generic `notification` event.

Do not expose firmware RPCs, filesystem access, or arbitrary device commands through this package. The Input WebSocket API is the supported boundary. Confirm any protocol change against the Input implementation and update the docs and example in the same change.
