// Loaded via NODE_OPTIONS='--import ./setup.mjs' before the Lambda runtime.
//
// The static `import 'node:http'` is the key precondition. ESM static imports
// are resolved before any module code executes, so Node.js creates and caches
// the ESM namespace for `http` with the ORIGINAL (unpatched) CJS exports —
// before module.register() or registerInstrumentations() run.
//
// In real APM tools, this happens because dependencies in the --import chain
// (SDK core, HTTP transports, etc.) import 'node:http' statically.
import 'node:http';

import { register } from 'node:module';
import { createAddHookMessageChannel } from 'import-in-the-middle';

const { addHookMessagePort, waitForAllMessagesAcknowledged } = createAddHookMessageChannel();
register('import-in-the-middle/hook.mjs', import.meta.url, {
  data: { addHookMessagePort, include: [] },
  transferList: [addHookMessagePort],
});

import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SimpleSpanProcessor, InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
provider.register();

registerInstrumentations({
  instrumentations: [new HttpInstrumentation()],
});

await waitForAllMessagesAcknowledged();

globalThis.__otelExporter = exporter;
