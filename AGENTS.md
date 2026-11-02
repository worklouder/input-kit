# Repository guidance for AI coding agents

## Project purpose

InputKit is a public Node.js client library for connecting JavaScript and TypeScript projects to Work Louder Input through Input's WebSocket interface. It is maintained separately from the Input desktop application and the app-building SDK.

The intended npm package name is `@worklouder/input-kit`.

## Naming and documentation

- Call this project **InputKit** and describe it as a **Node.js client library**.
- Call the remote interface the **Input WebSocket API**.
- Use **WebSocket API** for the wire-level contract and **InputKit** for this package.
- Avoid using “Input SDK” by itself because it can be confused with the app-building SDK.

## Project conventions

- Use Yarn for dependency management and project scripts. Keep the Yarn lockfile committed once package metadata is added; do not introduce npm or pnpm lockfiles.
- Treat this as an independently installable public package. Do not depend on private modules, build output, or Electron internals from the Input application.
- Keep the package focused on Node.js consumers. Avoid adding runtime dependencies unless they materially improve the public client experience.
- Do not invent or silently change the WebSocket message format. Confirm protocol behavior against its authoritative implementation or specification, and document compatibility assumptions.
- Treat WebSocket messages and connection failures as external input: validate data at the boundary and provide actionable errors to library users.
- Keep examples safe to publish. Never include credentials, private endpoints, personal data, or machine-specific paths; use clearly fake placeholders.
- Use Conventional Commits: `<type>(<optional scope>): <imperative summary>`.

## Contribution guidance

Prefer small, focused changes with clear public behavior. When changing exported APIs or protocol compatibility, update the user-facing documentation and examples in the same change.
