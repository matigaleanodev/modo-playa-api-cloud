import { App } from 'aws-cdk-lib';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModoPlayaStack } from '../packages/infrastructure/src/stack.ts';
import { deploymentConfiguration } from '../packages/infrastructure/src/config.ts';

export function stackFixture(overrides: NodeJS.ProcessEnv = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'modo-playa-infra-'));
  for (const group of ['health', 'identity', 'catalog', 'management', 'media']) {
    const archive = Buffer.alloc(22);
    archive.writeUInt32LE(0x06054b50, 0);
    archive.writeUInt16LE(group.length, 20);
    writeFileSync(join(directory, `${group}.zip`), Buffer.concat([archive, Buffer.from(group)]));
  }
  const settings = JSON.parse(
    readFileSync(
      new URL('../packages/infrastructure/src/local-settings.json', import.meta.url),
      'utf8',
    ),
  );
  const app = new App({ outdir: join(directory, 'assembly') });
  const stack = new ModoPlayaStack(app, 'ModoPlayaCandidate', {
    configuration: deploymentConfiguration({ ...settings, ...overrides }),
    assetDirectory: directory,
  });
  return { directory, app, stack };
}
