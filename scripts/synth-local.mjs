import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { routes } from '@modo-playa/contracts/routes';

const root = fileURLToPath(new URL('..', import.meta.url));
// Entorno aislado: no hereda perfiles, credenciales, configuración CDK ni valores secretos.
execFileSync(
  process.execPath,
  ['node_modules/aws-cdk/bin/cdk', 'synth', '--no-lookups', '--quiet', '--no-notices'],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      PATH: process.env.PATH,
      AWS_ACCESS_KEY_ID: 'local-synth',
      AWS_SECRET_ACCESS_KEY: 'local-synth',
      AWS_EC2_METADATA_DISABLED: 'true',
      AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
      AWS_CONFIG_FILE: '/dev/null',
      CDK_DISABLE_VERSION_CHECK: 'true',
    },
  },
);
const template = JSON.parse(
  await readFile(new URL('../cdk.out/ModoPlayaLocalHealth.template.json', import.meta.url), 'utf8'),
);
const resources = Object.values(template.Resources);
assert.deepEqual(
  resources
    .filter((resource) => resource.Type === 'AWS::ApiGatewayV2::Route')
    .map((resource) => resource.Properties.RouteKey),
  Object.values(routes).map((route) => `${route.method} ${route.path}`),
);
assert.equal(resources.filter((resource) => resource.Type === 'AWS::Lambda::Function').length, 1);
assert.ok(resources.every((resource) => !/AWS::IAM::|AWS::SecretsManager::/.test(resource.Type)));
assert.equal(
  resources.some(
    (resource) => resource.Type === 'AWS::ApiGatewayV2::Api' && resource.Properties.Body,
  ),
  false,
);
const manifest = JSON.parse(
  await readFile(new URL('../cdk.out/manifest.json', import.meta.url), 'utf8'),
);
assert.ok(!Object.keys(manifest.missing ?? {}).length, 'La síntesis no puede necesitar lookups.');
const assets = JSON.parse(
  await readFile(new URL('../cdk.out/ModoPlayaLocalHealth.assets.json', import.meta.url), 'utf8'),
);
assert.equal(Object.keys(assets.files).length, 2);
assert.deepEqual(assets.dockerImages, {});
for (const asset of Object.values(assets.files)) {
  const source = new URL(asset.source.path, new URL('../cdk.out/', import.meta.url));
  const expected =
    asset.source.path === 'ModoPlayaLocalHealth.template.json'
      ? new URL('../cdk.out/ModoPlayaLocalHealth.template.json', import.meta.url)
      : new URL('../dist/health.zip', import.meta.url);
  assert.equal(asset.source.packaging, 'file');
  assert.match(
    asset.source.path,
    /^(ModoPlayaLocalHealth\.template\.json|asset\.[a-f0-9]{64}\.zip)$/,
  );
  assert.deepEqual(await readFile(source), await readFile(expected));
}
console.info(
  'Síntesis local aprobada: health explícito, asset revisado, sin lookups, roles nuevos ni secretos.',
);
