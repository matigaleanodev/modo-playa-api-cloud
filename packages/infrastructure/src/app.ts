import { App } from 'aws-cdk-lib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HealthStack } from './stack.ts';

const settings = JSON.parse(
  readFileSync(new URL('./local-settings.json', import.meta.url), 'utf8'),
);
const app = new App();
new HealthStack(app, 'ModoPlayaLocalHealth', {
  env: { account: settings.account, region: settings.region },
  assetPath: fileURLToPath(new URL('../../../dist/health.zip', import.meta.url)),
  deploymentBucket: settings.deploymentBucket,
  healthRoleArn: settings.healthRoleArn,
});
app.synth();
