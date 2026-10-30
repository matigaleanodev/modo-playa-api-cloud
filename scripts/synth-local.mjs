import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const settings = JSON.parse(
  await readFile(
    new URL('../packages/infrastructure/src/local-settings.json', import.meta.url),
    'utf8',
  ),
);
const isolated = {
  PATH: process.env.PATH,
  ...settings,
  AWS_ACCESS_KEY_ID: 'local-synth',
  AWS_SECRET_ACCESS_KEY: 'local-synth',
  AWS_EC2_METADATA_DISABLED: 'true',
  AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
  AWS_CONFIG_FILE: '/dev/null',
  CDK_DISABLE_VERSION_CHECK: 'true',
};
for (const [app, output] of [
  ['app.ts', 'cdk.out'],
  ['foundation-app.ts', 'cdk.foundation.out'],
]) {
  execFileSync(
    process.execPath,
    [
      'node_modules/aws-cdk/bin/cdk',
      'synth',
      '--app',
      `node packages/infrastructure/src/${app}`,
      '--output',
      output,
      '--no-lookups',
      '--quiet',
      '--no-notices',
    ],
    { cwd: root, stdio: 'inherit', env: isolated },
  );
  const manifest = JSON.parse(
    await readFile(new URL(`../${output}/manifest.json`, import.meta.url), 'utf8'),
  );
  assert.ok(!Object.keys(manifest.missing ?? {}).length, 'Synthesis must not need lookups.');
}
const app = JSON.parse(
  await readFile(new URL('../cdk.out/ModoPlayaCandidate.template.json', import.meta.url), 'utf8'),
);
const resources = Object.values(app.Resources);
assert.equal(resources.filter((item) => item.Type === 'AWS::Lambda::Function').length, 4);
assert.equal(resources.filter((item) => item.Type === 'AWS::Lambda::WebFunction').length, 1);
assert.equal(
  resources.filter((item) => item.Type === 'AWS::Lambda::WebFunctionRevision').length,
  1,
);
assert.equal(
  resources.find((item) => item.Type === 'AWS::CloudFront::Distribution').Properties
    .DistributionConfig.Enabled,
  false,
);
assert.ok(resources.every((item) => !/AWS::IAM::|AWS::SecretsManager::/.test(item.Type)));
console.info(
  'Application and foundation synthesized locally with fictitious prod references; no lookups or secret reads.',
);

execFileSync(process.execPath, ['scripts/review-package.mjs', 'cdk.out'], {
  cwd: root,
  stdio: 'inherit',
  env: isolated,
});
