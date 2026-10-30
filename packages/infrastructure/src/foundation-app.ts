import { App } from 'aws-cdk-lib';
import { FoundationStack } from './foundation.ts';
const app = new App();
new FoundationStack(app, 'ModoPlayaFoundation');
app.synth();
