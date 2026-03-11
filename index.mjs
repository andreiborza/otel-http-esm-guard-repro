import * as http from 'node:http';
import { trace, SpanKind } from '@opentelemetry/api';

export const handler = async () => {
  const tracer = trace.getTracer('test');

  // Make an outgoing HTTP request inside a parent span
  const result = await tracer.startActiveSpan('test-invoke', async (span) => {
    await new Promise((resolve, reject) => {
      const req = http.request('http://example.com', (res) => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.end();
    });

    // Wait for spans to be exported
    await new Promise((r) => setTimeout(r, 500));

    const spans = globalThis.__otelExporter.getFinishedSpans();
    const clientSpans = spans.filter((s) => s.kind === SpanKind.CLIENT);

    span.end();

    return {
      totalSpans: spans.length,
      clientSpans: clientSpans.length,
      pass: clientSpans.length > 0,
    };
  });

  // Wait for the parent span to be exported too
  await new Promise((r) => setTimeout(r, 200));
  const allSpans = globalThis.__otelExporter.getFinishedSpans();

  console.log(`\nTotal spans: ${allSpans.length}`);
  for (const s of allSpans) {
    const kind = ['INTERNAL', 'SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER'][s.kind];
    console.log(`  [${kind}] ${s.name}`);
  }

  if (result.pass) {
    console.log('\nPASS: ESM http.request is instrumented — client span created');
    const clientSpans = allSpans.filter((s) => s.kind === SpanKind.CLIENT);
    for (const s of clientSpans) {
      const a = s.attributes;
      console.log(`  Client span:`);
      console.log(`  ${a['http.method']} ${a['http.url']}`);
      console.log(`  ${a['http.status_code']} ${a['http.status_text']}`);
    }
  } else {
    console.log('\nFAIL: ESM http.request is NOT instrumented — no client span');
    console.log('  http.request.name:', http.request.name, '(expected: outgoingRequest)');
    console.log('  http.request.__wrapped:', !!http.request.__wrapped, '(expected: true)');
    console.log('  The _httpPatched guard blocked IITM from patching the ESM proxy.');
  }

  return {
    statusCode: result.pass ? 200 : 500,
    body: JSON.stringify(result),
  };
};
