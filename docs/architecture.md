# Package Architecture

InputKit has two boundaries: the public Node.js client API and the Input WebSocket protocol. The package contains no Electron or private Input application imports.

## Module responsibilities

- `input-client.ts` exposes the stable, user-facing `InputClient` methods. It translates typed method calls into protocol requests, validates API results, and emits the public event names.
- `transport/json-rpc-transport.ts` owns the WebSocket connection, JSON-RPC request IDs, timeouts, response correlation, and transport failures. It knows about JSON-RPC framing but not device or authorization semantics.
- `notifications.ts` validates and decodes server notification payloads into typed event data.
- `validation.ts` contains shared boundary checks for IDs and device summaries.
- `contracts.ts` defines the public option, request, event, and data types. `Preset` mirrors the JSON shape accepted by `addLayer` without importing private application code.
- `errors.ts` defines errors consumers can catch without depending on transport internals.
- `index.ts` is the package export barrel. Internal transport details stay private.

## Change guidelines

When adding a WebSocket method (including `changeProfileLayer`), add its public request/response types to `contracts.ts`, implement the wrapper in `InputClient`, validate the response shape, export the type from `index.ts`, and document the method in [`API.md`](API.md). Keep wire encoding and request lifecycle inside the transport.

When adding a server event, validate the incoming parameters in `notifications.ts`, add a typed public event contract in `contracts.ts`, forward it from `InputClient`, export the event type, and document its behavior. Keep unknown notifications available through the generic `notification` event.

Do not expose firmware RPCs, filesystem access, or arbitrary device commands through this package. The Input WebSocket API is the supported boundary. Confirm any protocol change against the Input implementation and update the docs and example in the same change.
