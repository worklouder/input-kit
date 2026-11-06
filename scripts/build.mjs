import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
const require = createRequire(import.meta.url);
const tsc = require.resolve('typescript/bin/tsc');

rmSync(dist, { recursive: true, force: true });
for (const config of ['tsconfig.json', 'tsconfig.cjs.json']) {
    execFileSync(process.execPath, [tsc, '-p', config], { cwd: root, stdio: 'inherit' });
}
writeFileSync(new URL('cjs/package.json', dist), '{ "type": "commonjs" }\n');
