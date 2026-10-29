import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const contractName = '@modo-playa/contracts';
const allowed = {
  contracts: new Set(),
  infrastructure: new Set([contractName, 'aws-cdk-lib', 'constructs']),
  runtime: new Set([
    contractName,
    '@middy/core',
    'ajv',
    'bcrypt',
    'jsonwebtoken',
    'mongoose',
    'resend',
    'validator',
    '@aws-sdk/client-secrets-manager',
  ]),
};

function checkImport(owner, manifest, file, specifier, typeOnly) {
  if (specifier.startsWith('node:')) {
    assert.notEqual(owner, 'contracts', 'Los contratos no dependen de Node.');
    return;
  }
  if (specifier.startsWith('.')) {
    const target = relative(
      resolve(root, 'packages', owner, 'src'),
      resolve(dirname(file), specifier),
    );
    assert.ok(!target.startsWith('..'), `Import relativo fuera del paquete: ${file}: ${specifier}`);
    return;
  }
  const name = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
  const declared = manifest.dependencies?.[name] ?? manifest.devDependencies?.[name];
  const typePackage = manifest.devDependencies?.[`@types/${name}`];
  assert.ok(declared || (typeOnly && typePackage), `Dependencia no declarada: ${file}: ${name}`);
  const typeDependency =
    owner === 'contracts' ? 'json-schema-to-ts' : owner === 'runtime' ? 'aws-lambda' : undefined;
  assert.ok(
    (typeOnly && (name === typeDependency || (owner === 'runtime' && typePackage))) ||
      (allowed[owner].has(name) && manifest.dependencies?.[name]),
    `Dependencia fuera del límite: ${file}: ${name}`,
  );
  if (name.startsWith('@modo-playa/')) {
    assert.equal(name, contractName, `Dependencia entre paquetes no permitida: ${file}`);
    assert.ok(specifier.startsWith(`${contractName}/`), 'Usar exports explícitos.');
  }
}

// Autocontroles negativos: el hoisting no permite imports ni escapes entre paquetes.
const fixture = resolve(root, 'packages/infrastructure/src/stack.ts');
assert.throws(() =>
  checkImport('infrastructure', { dependencies: { ajv: '8.20.0' } }, fixture, 'ajv', false),
);
assert.throws(() =>
  checkImport('infrastructure', {}, fixture, '../../runtime/src/health/handler.ts', false),
);
assert.throws(() => checkImport('contracts', {}, fixture, 'node:fs', false));
assert.throws(() => checkImport('runtime', {}, fixture, 'aws-lambda', true));

async function files(directory) {
  const entries = (await readdir(directory, { withFileTypes: true })).filter(
    (entry) => entry.name !== 'node_modules',
  );
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? files(path) : [path];
      }),
    )
  ).flat();
}

const contractManifest = JSON.parse(
  await readFile(resolve(root, 'packages/contracts/package.json'), 'utf8'),
);
for (const owner of Object.keys(allowed)) {
  const directory = resolve(root, 'packages', owner);
  const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  assert.equal(manifest.private, true);
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.version, contractManifest.version);
  assert.ok(
    manifest.exports && !manifest.exports['.'] && !manifest.exports['./*'],
    'Usar exports explícitos.',
  );
  assert.ok(!manifest.scripts?.prepare);
  for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
    assert.ok(allowed[owner].has(name), `Dependencia fuera del límite: ${owner}: ${name}`);
    assert.match(version, /^\d+\.\d+\.\d+$/, 'Conservar versiones exactas.');
    if (name.startsWith('@modo-playa/')) assert.equal(version, contractManifest.version);
  }
  assert.equal(
    (await files(directory)).some((path) => path.endsWith('package-lock.json')),
    false,
  );
  for (const file of await files(resolve(directory, 'src'))) {
    if (!file.endsWith('.ts')) continue;
    const source = await readFile(file, 'utf8');
    const imports = source.matchAll(
      /\b(?:import|export)\s+(?:(type)\s+)?(?:[^;'"()]*?\sfrom\s*)?['"]([^'"]+)['"]/g,
    );
    for (const [, type, specifier] of imports) {
      checkImport(owner, manifest, file, specifier, !!type);
      if (specifier.startsWith(`${contractName}/`)) {
        assert.ok(
          contractManifest.exports[`./${specifier.slice(contractName.length + 1)}`],
          `Export no declarado: ${specifier}`,
        );
      }
    }
    for (const [, specifier] of source.matchAll(/\b(?:import|require)\(['"]([^'"]+)['"]\)/g)) {
      checkImport(owner, manifest, file, specifier, false);
    }
  }
}
console.info('Límites de imports, dependencias y exports de los tres workspaces comprobados.');
