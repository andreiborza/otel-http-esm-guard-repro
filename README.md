# `_httpPatched` guard breaks ESM instrumentation in AWS Lambda

Minimal reproduction for [`@opentelemetry/instrumentation-http` >=0.213.0](https://www.npmjs.com/package/@opentelemetry/instrumentation-http) where the `_httpPatched` / `_httpsPatched` double-instrumentation guards prevent `import-in-the-middle` (IITM) from patching the ESM proxy for `http`/`https` when `require-in-the-middle` (RITM) has already patched them via CJS.

## Prerequisites

- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
- Docker

## Reproduce

```bash
npm install

# @opentelemetry/instrumentation-http@0.213.0 — FAIL (no client span)
npm run start:213

# @opentelemetry/instrumentation-http@0.212.0 — PASS (client span created)
npm run start:212
```

**0.213.0 output (broken):**
```
Total spans: 1
  [INTERNAL] test-invoke

FAIL: ESM http.request is NOT instrumented — no client span
  http.request.name: request (expected: outgoingRequest)
  http.request.__wrapped: false (expected: true)
  The _httpPatched guard blocked IITM from patching the ESM proxy.
```

**0.212.0 output (working):**
```
Total spans: 2
  [CLIENT] GET
  [INTERNAL] test-invoke

PASS: ESM http.request is instrumented — client span created
  Client span:
  GET http://example.com/
  200 OK
```

## The problem

In AWS Lambda with an ESM handler:

1. `--import ./setup.mjs` runs — static `import 'node:http'` pre-caches the ESM namespace with **unpatched** CJS exports, then `module.register()` and `registerInstrumentations()` set up the hooks
2. Lambda runtime (CJS) calls requires `node:http` — RITM fires, patches the CJS module, sets `_httpPatched = true`
3. Lambda runtime imports the ESM handler — handler does `import * as http from 'node:http'`
4. IITM intercepts, creates a proxy wrapping `node:http` — but the cached ESM namespace has **unpatched** snapshot values
5. IITM calls the `HttpInstrumentation` hook — `_httpPatched` is `true` → early return → proxy is **not** patched
6. Handler's `http.request(...)` uses the unpatched snapshot → **no client span**

## Why the Lambda runtime triggers CJS `require('http')`

The Lambda Node.js runtime uses [`RAPIDClient`](https://github.com/aws/aws-lambda-nodejs-runtime-interface-client/blob/90b5b5bce1fd429f02d37e97acef436c1a331c81/src/client/rapid-client.ts#L27) to communicate with the [Lambda Runtime API](https://docs.aws.amazon.com/lambda/latest/dg/runtimes-api.html). It loads `http` via [`cjsRequire("node:http")`](https://github.com/aws/aws-lambda-nodejs-runtime-interface-client/blob/90b5b5bce1fd429f02d37e97acef436c1a331c81/src/utils/cjs-require.ts), which uses `createRequire(import.meta.url)` — this goes through `Module.prototype.require`, which RITM wraps:

```ts
// src/client/rapid-client.ts
import { cjsRequire } from "../utils/cjs-require.js";

const { Agent, request } = cjsRequire("node:http");  // <-- triggers RITM
```

So the CJS `http` module gets patched and `_httpPatched` is set to `true` before the user's ESM handler is ever imported.

## Why it worked before 0.213.0

In versions before 0.213.0, there was no `_httpPatched` guard. Both RITM and IITM patched independently:

- RITM patched the CJS `http` module (for CJS consumers)
- IITM patched the ESM proxy (for ESM consumers)

This "double patching" was harmless and ensured ESM consumers always got instrumented exports regardless of snapshot timing.

## Suggested fix

The guard should either be removed, or CJS and ESM patching should be tracked independently (e.g. separate `_httpPatchedCjs` / `_httpPatchedEsm` flags), since they operate on different objects:

- CJS: patches the `module.exports` object directly
- ESM: patches the IITM proxy namespace (a separate object with snapshot values)

## Environment

- Node.js 22 (Lambda `nodejs22.x` runtime)
- `@opentelemetry/instrumentation-http` 0.213.0
- `import-in-the-middle` 1.13.1 (via `@opentelemetry/instrumentation` 0.213.0)
