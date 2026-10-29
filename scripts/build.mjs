import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isPrivatePath } from './check-privacy.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = new URL('../dist/', import.meta.url);
await mkdir(output, { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: ['packages/runtime/src/health/handler.ts'],
  outfile: 'dist/health.mjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  metafile: true,
  legalComments: 'none',
});
const inputs = Object.keys(result.metafile.inputs);
for (const output of Object.values(result.metafile.outputs)) {
  assert.ok(
    output.imports.every((entry) => entry.path.startsWith('node:')),
    'El bundle no puede requerir paquetes externos.',
  );
}
for (const input of inputs) {
  assert.ok(!isPrivatePath(input), `Entrada privada en el bundle: ${input}`);
  assert.ok(
    ['packages/runtime/src/', 'packages/contracts/src/', 'node_modules/'].some((prefix) =>
      input.startsWith(prefix),
    ),
    `Entrada fuera del runtime: ${input}`,
  );
}
const bundle = await readFile(new URL('health.mjs', output), 'utf8');
assert.doesNotMatch(bundle, /mongodb(?:\+srv)?:\/\/|AKIA[0-9A-Z]{16}/);
await writeFile(new URL('health.inputs.json', output), JSON.stringify(inputs, null, 2) + '\n');
// Solo el bundle entra al ZIP; timestamps y permisos constantes para hacerlo reproducible.
execFileSync(
  'python3',
  [
    '-c',
    [
      'import pathlib, sys, zipfile',
      'root = pathlib.Path(sys.argv[1])',
      'info = zipfile.ZipInfo("health.mjs", (1980, 1, 1, 0, 0, 0))',
      'info.compress_type = zipfile.ZIP_DEFLATED',
      'info.external_attr = 0o100644 << 16',
      'with zipfile.ZipFile(root / "health.zip", "w") as archive:',
      '    archive.writestr(info, (root / "health.mjs").read_bytes())',
      'with zipfile.ZipFile(root / "health.zip") as archive:',
      '    assert archive.namelist() == ["health.mjs"]',
      '    assert archive.read("health.mjs") == (root / "health.mjs").read_bytes()',
    ].join('\n'),
    fileURLToPath(output),
  ],
  { cwd: root, stdio: 'inherit' },
);
execFileSync(process.execPath, ['scripts/smoke.mjs'], {
  cwd: root,
  stdio: 'inherit',
  env: { PATH: process.env.PATH },
});
console.info('health.zip: bundle único revisado, sin archivos privados.');
