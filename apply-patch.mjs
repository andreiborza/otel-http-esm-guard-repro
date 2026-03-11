// Apply the proposed fix to both SAM build outputs.
import { execSync } from 'node:child_process';

const patch = 'patches/@opentelemetry+instrumentation-http+0.213.0.patch';
const dirs = [
  '.aws-sam/build/OtelEsmFunction',
  '.aws-sam/build/OtelCjsFunction',
];

for (const dir of dirs) {
  console.log(`Patching ${dir}...`);
  execSync(`patch -p1 < ../../../${patch}`, { cwd: dir, stdio: 'inherit' });
}
