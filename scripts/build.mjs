import assert from 'node:assert/strict';
import { isBuiltin } from 'node:module';
import { build } from 'esbuild';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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
execFileSync(process.execPath, ['scripts/prepare-media-native.mjs'], {
  cwd: root,
  stdio: 'inherit',
});
async function packageFiles(name, sourcePrefix = 'node_modules/') {
  const base = sourcePrefix + name;
  const manifest = JSON.parse(
    await readFile(new URL('../' + base + '/package.json', import.meta.url), 'utf8'),
  );
  assert.equal(manifest.name, name);
  async function walk(directory) {
    const result = {};
    for (const entry of await readdir(new URL('../' + directory + '/', import.meta.url), {
      withFileTypes: true,
    })) {
      assert.ok(!entry.isSymbolicLink(), 'Symlink in native runtime package.');
      const source = directory + '/' + entry.name;
      if (entry.isDirectory()) Object.assign(result, await walk(source));
      else {
        const relative = source.slice(base.length + 1);
        if (
          name === 'sharp' &&
          !relative.startsWith('dist/') &&
          !['package.json', 'LICENSE'].includes(relative)
        )
          continue;
        if (
          relative.endsWith('.map') ||
          relative.endsWith('.d.ts') ||
          relative.endsWith('.d.cts') ||
          relative.endsWith('.d.mts')
        )
          continue;
        result['node_modules/' + name + '/' + relative] = source;
      }
    }
    return result;
  }
  return walk(base);
}
const mediaFiles = {};
for (const name of ['sharp', '@img/colour', 'detect-libc', 'semver'])
  Object.assign(mediaFiles, await packageFiles(name));
for (const name of ['@img/sharp-linux-arm64', '@img/sharp-libvips-linux-arm64'])
  Object.assign(
    mediaFiles,
    await packageFiles(name, 'node_modules/.cache/modo-playa-media-arm64/'),
  );
await writeFile(
  new URL('media-index.js', output),
  "import('./media.mjs').then(({startMediaServer})=>startMediaServer());\n",
);
mediaFiles['index.js'] = 'dist/media-index.js';
for (const group of ['health', 'identity', 'catalog', 'management', 'media']) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [
      'packages/runtime/src/' + group + '/' + (group === 'media' ? 'server' : 'handler') + '.ts',
    ],
    outfile: `dist/${group}.mjs`,
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    external: group === 'identity' ? ['bcrypt'] : group === 'media' ? ['sharp'] : [],
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
        (group === 'media' && entry.path === 'sharp') ||
        (group === 'catalog' &&
          entry.path === 'supports-color' &&
          entry.kind === 'require-call' &&
          result.metafile.inputs['node_modules/debug/src/node.js']?.imports.some(
            (value) => value.path === entry.path && value.external,
          )) ||
        ((group === 'identity' ||
          group === 'catalog' ||
          group === 'management' ||
          group === 'media') &&
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
    if (group === 'catalog' || group === 'management' || group === 'media') {
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
  const files =
    group === 'identity'
      ? Object.fromEntries(nativeFiles.map((name) => [name, name]))
      : group === 'media'
        ? mediaFiles
        : {};
  Object.keys(files).forEach((file) => assert.ok(!isPrivatePath(file)));
  // Allowlist cerrada, sin copiar node_modules completo ni binarios de otras plataformas.
  execFileSync(
    'python3',
    [
      '-c',
      [
        'import json, pathlib, sys, zipfile',
        'root = pathlib.Path(sys.argv[1]); group = sys.argv[2]',
        'files = {group + ".mjs": root / "dist" / (group + ".mjs")}',
        'files.update({name: root / source for name,source in json.loads(sys.argv[3]).items()})',
        'assert sum(path.stat().st_size for path in files.values()) < 512*1024*1024',
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
const sharpNative = fileURLToPath(
  new URL(
    '../node_modules/.cache/modo-playa-media-arm64/@img/sharp-linux-arm64/lib/sharp-linux-arm64-0.35.5.node',
    import.meta.url,
  ),
);
assert.match(execFileSync('readelf', ['-h', sharpNative], { encoding: 'utf8' }), /AArch64/);
execFileSync(process.execPath, ['scripts/smoke.mjs'], {
  cwd: root,
  stdio: 'inherit',
  env: { PATH: process.env.PATH },
});
console.info(
  'ZIP health, identity, catalog, management y media revisados por allowlist; bcrypt ELF x86_64/glibc y smoke desde extracción aprobados.',
);
