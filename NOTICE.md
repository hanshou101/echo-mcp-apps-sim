# Attribution

This project is MIT licensed (see `LICENSE`). Parts of it are adapted from
other open-source projects, listed here with their original license.

## modelcontextprotocol/ext-apps

- Source: https://github.com/modelcontextprotocol/ext-apps
- License: MIT
- Files adapted:
  - `server.ts` — the two-origin split (page origin + sandbox origin), the CSP
    header builder, and the sandbox-only 404 handler, from
    `examples/basic-host/serve.ts`.
  - `sandbox.html`, `src/sandbox.ts` — the sandbox proxy page and the relay
    between the host window and the App iframe, from `examples/basic-host/`.
  - `src/app-host.ts` — the AppBridge host sequence (resource read → sandbox →
    `sendToolInput` / `sendToolResult`), from
    `examples/basic-host/src/implementation.ts`.
- The `@modelcontextprotocol/ext-apps` package itself is used as a dependency.

Each adapted file starts with a comment saying where it came from.

## MCP SDK packages

The MCP client and server used here and in the example server are the official
`@modelcontextprotocol/*` packages, MIT licensed:
https://github.com/modelcontextprotocol/typescript-sdk

## Trademarks

Echo Show and Alexa are trademarks of Amazon.com, Inc. or its affiliates. This
project is not affiliated with, endorsed by, or sponsored by Amazon. The page
shows a generic smart-display frame with no Amazon logos, and labels itself
"Simulated Alexa+ experience · unofficial demo" so nobody mistakes it for the
official simulator.
