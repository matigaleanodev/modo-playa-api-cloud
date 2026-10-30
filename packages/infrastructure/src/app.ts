import { App } from 'aws-cdk-lib';
import { deploymentConfiguration } from './config.ts';
import { ModoPlayaStack } from './stack.ts';
const app = new App();
new ModoPlayaStack(app, 'ModoPlayaCandidate', {
  configuration: deploymentConfiguration(process.env),
});
app.synth();
