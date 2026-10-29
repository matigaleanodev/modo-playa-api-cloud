import assert from 'node:assert/strict';
import { isBuiltin } from 'node:module';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isPrivatePath } from './check-privacy.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = new URL('../dist/', import.meta.url);
await mkdir(output, { recursive: true });
// Son requires opcionales protegidos por try/catch del driver; tampoco están instalados en el origen.
const optionalMongo = new Set([
  'kerberos',
  '@mongodb-js/zstd',
  '@aws-sdk/credential-providers',
  'gcp-metadata',
  'snappy',
  'socks',
  'mongodb-client-encryption',
]);
const nativeFiles = [
  'node_modules/bcrypt/bcrypt.js',
  'node_modules/bcrypt/promises.js',
  'node_modules/bcrypt/package.json',
  'node_modules/bcrypt/LICENSE',
  'node_modules/bcrypt/prebuilds/linux-x64/bcrypt.glibc.node',
  'node_modules/node-gyp-build/index.js',
  'node_modules/node-gyp-build/node-gyp-build.js',
  'node_modules/node-gyp-build/package.json',
  'node_modules/node-gyp-build/LICENSE',
];
for (const group of ['health', 'identity', 'catalog', 'management']) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [`packages/runtime/src/${group}/handler.ts`],
    outfile: `dist/${group}.mjs`,
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    external: group === 'identity' ? ['bcrypt'] : [],
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    metafile: true,
    legalComments: 'none',
  });
  const inputs = Object.keys(result.metafile.inputs);
  for (const entry of Object.values(result.metafile.outputs).flatMap((value) => value.imports))
    assert.ok(
      isBuiltin(entry.path) ||
        (group === 'catalog' &&
          entry.path === 'supports-color' &&
          entry.kind === 'require-call' &&
          result.metafile.inputs['node_modules/debug/src/node.js']?.imports.some(
            (value) => value.path === entry.path && value.external,
          )) ||
        ((group === 'identity' || group === 'catalog' || group === 'management') &&
          ((group === 'identity' && entry.path === 'bcrypt') ||
            (optionalMongo.has(entry.path) &&
              entry.kind === 'require-call' &&
              result.metafile.inputs['node_modules/mongodb/lib/deps.js']?.imports.some(
                (value) => value.path === entry.path && value.external,
              )) ||
            (group === 'identity' &&
              entry.path === '@react-email/render' &&
              entry.kind === 'dynamic-import' &&
              result.metafile.inputs['node_modules/resend/dist/index.mjs']?.imports.some(
                (value) => value.path === entry.path && value.external,
              )))),
      `Import externo inesperado: ${entry.path}`,
    );
  for (const input of inputs) {
    assert.ok(!isPrivatePath(input), `Entrada privada: ${input}`);
    assert.ok(
      ['packages/runtime/src/', 'packages/contracts/src/', 'node_modules/'].some((prefix) =>
        input.startsWith(prefix),
      ),
    );
    if (group === 'catalog' || group === 'management') {
      assert.doesNotMatch(
        input,
        /node_modules\/(bcrypt|resend)\/|runtime\/src\/identity\/(application|auth.service|mail|handler|runtime)\.ts/,
      );
      if (group === 'catalog')
        assert.doesNotMatch(
          input,
          /node_modules\/jsonwebtoken\/|runtime\/src\/identity\/tokens\.ts/,
        );
    }
    if (group === 'health')
      assert.doesNotMatch(
        input,
        /runtime\/src\/identity\/|node_modules\/(bcrypt|mongoose|mongodb|jsonwebtoken|resend|@aws-sdk)\//,
      );
  }
  const bundle = await readFile(new URL(`${group}.mjs`, output), 'utf8');
  assert.ok(
    !/mongodb(?:\+srv)?:\/\/[^'"\s]+@|AKIA[0-9A-Z]{16}/.test(bundle),
    'Configuración sensible en bundle.',
  );
  await writeFile(new URL(`${group}.inputs.json`, output), JSON.stringify(inputs, null, 2) + '\n');
  const files = group === 'identity' ? nativeFiles : [];
  files.forEach((file) => assert.ok(!isPrivatePath(file)));
  // Allowlist cerrada, sin copiar node_modules completo ni binarios de otras plataformas.
  execFileSync(
    'python3',
    [
      '-c',
      [
        'import json, pathlib, sys, zipfile',
        'root = pathlib.Path(sys.argv[1]); group = sys.argv[2]',
        'files = {group + ".mjs": root / "dist" / (group + ".mjs")}',
        'files.update({name: root / name for name in json.loads(sys.argv[3])})',
        'for name, path in files.items():',
        '    assert not path.is_symlink() and path.is_file()',
        'with zipfile.ZipFile(root / "dist" / (group + ".zip"), "w") as archive:',
        '    for name, path in sorted(files.items()):',
        '        info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))',
        '        info.compress_type = zipfile.ZIP_DEFLATED; info.external_attr = 0o100644 << 16',
        '        archive.writestr(info, path.read_bytes())',
        'with zipfile.ZipFile(root / "dist" / (group + ".zip")) as archive:',
        '    assert sorted(archive.namelist()) == sorted(files)',
        '    for name, path in files.items(): assert archive.read(name) == path.read_bytes()',
      ].join('\n'),
      root,
      group,
      JSON.stringify(files),
    ],
    { cwd: root, stdio: 'inherit' },
  );
}
const native = fileURLToPath(
  new URL('../node_modules/bcrypt/prebuilds/linux-x64/bcrypt.glibc.node', import.meta.url),
);
assert.match(
  execFileSync('readelf', ['-h', native], { encoding: 'utf8' }),
  /Advanced Micro Devices X86-64/,
);
const versions = execFileSync('readelf', ['--version-info', native], { encoding: 'utf8' });
for (const [, major, minor] of versions.matchAll(/GLIBC_(\d+)\.(\d+)/g))
  assert.ok(Number(major) < 2 || (Number(major) === 2 && Number(minor) <= 34));
execFileSync(process.execPath, ['scripts/smoke.mjs'], {
  cwd: root,
  stdio: 'inherit',
  env: { PATH: process.env.PATH },
});
console.info(
  'ZIP health, identity, catalog y management revisados por allowlist; bcrypt ELF x86_64/glibc y smoke desde extracción aprobados.',
);
