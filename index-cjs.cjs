const http = require('node:http');
const { trace, SpanKind } = require('@opentelemetry/api');

exports.handler = async () => {
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

  const clientSpans = allSpans.filter((s) => s.kind === SpanKind.CLIENT);
  if (clientSpans.length === 1) {
    console.log('\nPASS: CJS http.request produces exactly 1 client span (no double spans)');
    for (const s of clientSpans) {
      const a = s.attributes;
      console.log(`  Client span:`);
      console.log(`  ${a['http.method']} ${a['http.url']}`);
      console.log(`  ${a['http.status_code']} ${a['http.status_text']}`);
    }
  } else {
    console.log(`\nFAIL: CJS http.request produced ${clientSpans.length} client spans (expected exactly 1)`);
  }

  return {
    statusCode: clientSpans.length === 1 ? 200 : 500,
    body: JSON.stringify(result),
  };
};
