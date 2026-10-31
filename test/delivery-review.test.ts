import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { stackFixture } from './infra-fixtures.ts';

const revision = 'a'.repeat(40);
const python = (...args: string[]) => spawnSync('python3', args, { encoding: 'utf8' });

describe('Artifact revisado entre preparación y ejecución', () => {
  it('conserva metadata referenciada, excluye archivos obsoletos y detecta cambios o faltantes', async () => {
    const { directory, app } = await stackFixture();
    const output = await mkdtemp(join(tmpdir(), 'modo-playa-delivery-'));
    try {
      const assembly = app.synth();
      await cp(assembly.directory, join(directory, 'cdk.out'), { recursive: true });
      await cp('package-lock.json', join(directory, 'package-lock.json'));
      await cp('.nvmrc', join(directory, '.nvmrc'));
      await writeFile(join(directory, 'cdk.out', 'obsolete.json'), '{}');
      const bundle = join(output, 'reviewed');
      const created = python(
        'scripts/review_bundle.py',
        'create',
        directory,
        bundle,
        revision,
        process.version,
      );
      expect(created.status, created.stderr).toBe(0);
      const verify = () => python('scripts/review_bundle.py', 'verify', bundle, revision);
      expect(verify().status).toBe(0);
      const checksums = JSON.parse(await readFile(join(bundle, 'checksums.json'), 'utf8'));
      expect(checksums['cdk.out/obsolete.json']).toBeUndefined();
      const manifest = JSON.parse(await readFile(join(bundle, 'cdk.out/manifest.json'), 'utf8'));
      const stack = manifest.artifacts.ModoPlayaCandidate;
      if (stack.additionalMetadataFile) {
        expect(checksums[`cdk.out/${stack.additionalMetadataFile}`]).toBeTypeOf('string');
      }
      await writeFile(join(bundle, 'unexpected.txt'), 'extra');
      expect(verify().status).toBe(1);
      await rm(join(bundle, 'unexpected.txt'));
      expect(verify().status).toBe(0);
      await writeFile(join(bundle, 'context.md'), 'private');
      expect(verify().status).toBe(1);
      await rm(join(bundle, 'context.md'));
      await symlink('/etc/passwd', join(bundle, 'escape'));
      expect(verify().status).toBe(1);
      await rm(join(bundle, 'escape'));
      const lock = join(bundle, 'package-lock.json');
      await writeFile(lock, '{}');
      expect(verify().status).toBe(1);
      await cp('package-lock.json', lock);
      expect(python('scripts/review_bundle.py', 'verify', bundle, 'b'.repeat(40)).status).toBe(1);
      await rm(join(bundle, 'cdk.out', stack.properties.templateFile));
      expect(verify().status).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(output, { recursive: true, force: true });
    }
  });

  it('rechaza cambios destructivos y admite actualización después de rollback completado', () => {
    const source = `
import sys
sys.path.insert(0, 'scripts')
from review_changeset import validate, PREFIX, STACK, ROLE
stack = PREFIX + 'stack/' + STACK + '/id'
name = STACK + '-' + 'a' * 40 + '-1-1'
changeset = PREFIX + 'changeSet/' + name + '/id'
change = {'StackId': stack, 'ChangeSetId': changeset, 'StackName': STACK, 'ChangeSetName': name, 'Status': 'CREATE_COMPLETE', 'ExecutionStatus': 'AVAILABLE', 'Parameters': [{'ParameterKey': 'OriginVerifyToken', 'ParameterValue': '****'}], 'Changes': [{'ResourceChange': {'ResourceType': 'AWS::Lambda::Function', 'Action': 'Modify', 'Replacement': 'False'}}]}
state = {'StackId': stack, 'RoleARN': ROLE, 'StackStatus': 'UPDATE_ROLLBACK_COMPLETE'}
template = {'Resources': {'Function': {'Type': 'AWS::Lambda::Function'}}}
validate(change, state, template, stack, changeset)
def rejected():
    try:
        validate(change, state, template, stack, changeset)
    except ValueError:
        return
    raise AssertionError('Cambio inválido aceptado')
state['StackStatus'] = 'ROLLBACK_COMPLETE'
rejected()
state['StackStatus'] = 'CREATE_COMPLETE'
change['Changes'][0]['ResourceChange']['Replacement'] = 'True'
rejected()
change['Changes'][0]['ResourceChange']['Replacement'] = 'False'
change['Changes'][0]['ResourceChange']['Action'] = 'Remove'
rejected()
change['Changes'][0]['ResourceChange']['Action'] = 'Modify'
validate(change, state, template, stack, changeset)
for parameters in ([], [{'ParameterKey': 'OriginVerifyToken', 'ParameterValue': 'visible-token'}], change['Parameters'] + [{'ParameterKey': 'Other', 'ParameterValue': 'x'}]):
    change['Parameters'] = parameters
    rejected()
`;
    const result = python('-c', source);
    expect(result.status, result.stderr).toBe(0);
  });
  it('admite solo el permiso idéntico cuyo ARN depende de una actualización de código sin recreación', () => {
    const source = `
import copy, sys
sys.path.insert(0, 'scripts')
from review_changeset import stable_permission, STACK
name = STACK + '-health'
function = {'Type': 'AWS::Lambda::Function', 'Properties': {'FunctionName': name, 'Role': 'same-role', 'Code': {'S3Key': 'new.zip'}}}
permission = {'Type': 'AWS::Lambda::Permission', 'Properties': {'FunctionName': {'Fn::GetAtt': ['healthFunction', 'Arn']}, 'Action': 'lambda:InvokeFunction', 'Principal': 'apigateway.amazonaws.com', 'SourceArn': 'same-api'}}
template = {'Resources': {'healthFunction': function, 'healthPermission': permission}}
prior = copy.deepcopy(template)
prior['Resources']['healthFunction']['Properties']['Code']['S3Key'] = 'old.zip'
function_change = {'ResourceChange': {'LogicalResourceId': 'healthFunction', 'Action': 'Modify', 'Replacement': 'False', 'PhysicalResourceId': name, 'Details': [{'Target': {'Attribute': 'Properties', 'Name': 'Code', 'RequiresRecreation': 'Never'}, 'Evaluation': 'Static', 'ChangeSource': 'DirectModification'}]}}
resource = {'LogicalResourceId': 'healthPermission', 'ResourceType': 'AWS::Lambda::Permission', 'Action': 'Modify', 'Replacement': 'Conditional', 'Scope': ['Properties'], 'Details': [{'Target': {'Attribute': 'Properties', 'Name': 'FunctionName', 'RequiresRecreation': 'Always'}, 'Evaluation': 'Dynamic', 'ChangeSource': 'ResourceAttribute', 'CausingEntity': 'healthFunction.Arn'}]}
assert stable_permission(resource, [function_change], template, prior)
assert not stable_permission(resource, [function_change], template, None)
function['Properties']['Environment'] = {'Variables': {'PUBLIC_ACCESS_ENABLED': 'true', 'CORS_ORIGIN': '*'}}
function_change['ResourceChange']['Details'].append({'Target': {'Attribute': 'Properties', 'Name': 'Environment', 'RequiresRecreation': 'Never'}, 'Evaluation': 'Static', 'ChangeSource': 'DirectModification'})
assert not stable_permission(resource, [function_change], template, prior)
prior['Resources']['healthFunction']['Properties']['Environment'] = copy.deepcopy(function['Properties']['Environment'])
assert stable_permission(resource, [function_change], template, prior)
for key, value in [('MONGO_SECRET_ARN', 'another-secret'), ('CORS_ORIGIN', 'https://other.example'), ('PUBLIC_ACCESS_ENABLED', 'false')]:
    variables = function['Properties']['Environment']['Variables']
    old = variables.get(key)
    variables[key] = value
    assert not stable_permission(resource, [function_change], template, prior)
    if old is None: del variables[key]
    else: variables[key] = old
# Referencias de configuración: retiro de Secrets Manager, parámetros del proyecto y reciclado.
prior['Resources']['healthFunction']['Properties']['Environment']['Variables']['ORIGIN_SECRET_ARN'] = 'old-secret'
variables = function['Properties']['Environment']['Variables']
variables['ORIGIN_PARAMETER_NAME'] = '/modo-playa/prod/ingress'
variables['CONFIGURATION_GENERATION'] = '2'
assert stable_permission(resource, [function_change], template, prior)
for key, value in [('ORIGIN_PARAMETER_NAME', '/other/prod/ingress'), ('CONFIGURATION_GENERATION', '0'), ('ORIGIN_SECRET_ARN', 'new-secret')]:
    old = variables.get(key)
    variables[key] = value
    assert not stable_permission(resource, [function_change], template, prior), key
    if old is None: del variables[key]
    else: variables[key] = old
function['Properties']['Environment']['Other'] = 'x'
assert not stable_permission(resource, [function_change], template, prior)
del function['Properties']['Environment']['Other']

for target, field, value in [(resource, 'Replacement', 'True'), (resource, 'Action', 'Remove'), (resource['Details'][0], 'CausingEntity', 'other.Arn'), (function_change['ResourceChange'], 'Replacement', 'Conditional'), (function['Properties'], 'FunctionName', STACK + '-other'), (function['Properties'], 'Role', 'another-role'), (permission['Properties'], 'SourceArn', 'another-api')]:
    old = target[field]
    target[field] = value
    assert not stable_permission(resource, [function_change], template, prior), (field, value)
    target[field] = old
`;
    const result = python('-c', source);
    expect(result.status, result.stderr).toBe(0);
  });
  it('permite sólo rotación de revisión retenida con endpoint estable y sin reemplazar otros recursos', () => {
    const source = `
import copy, sys
sys.path.insert(0, 'scripts')
from review_changeset import validate, PREFIX, STACK, ROLE
stack = PREFIX + 'stack/' + STACK + '/id'
name = STACK + '-' + 'a' * 40 + '-1-1'
changeset = PREFIX + 'changeSet/' + name + '/id'
old, new = 'MediaRevision' + 'a'*64, 'MediaRevision' + 'b'*64
revision = {'Type':'AWS::Lambda::WebFunctionRevision','DeletionPolicy':'Retain','UpdateReplacePolicy':'Retain','Properties':{'FunctionName':{'Ref':'MediaWebFunction'},'BuildConfig':{'RuntimeConfig':{'Runtime':'nodejs24.x'},'CodeConfig':{'S3Object':{'Bucket':'bucket','Key':'old.zip'}}},'ServiceConfig':{'ExecutionRoleArn':'same-role','MaxConcurrencyPerEnvironment':1}}}
prior = {'Resources': {'MediaWebFunction':{'Type':'AWS::Lambda::WebFunction','Properties':{'FunctionName':STACK+'-media'}},old:revision,'MediaEndpoint':{'Type':'AWS::Lambda::WebFunctionEndpoint','Properties':{'FunctionName':{'Ref':'MediaWebFunction'},'AuthType':'IamAuth','RevisionWeights':[{'RevisionId':{'Fn::GetAtt':[old,'RevisionId']},'Weight':100}]}}}}
template=copy.deepcopy(prior)
template['Resources'][new]=template['Resources'].pop(old)
template['Resources'][new]['Properties']['BuildConfig']['CodeConfig']['S3Object']['Key']='new.zip'
template['Resources']['MediaEndpoint']['Properties']['RevisionWeights'][0]['RevisionId']['Fn::GetAtt'][0]=new
changes=[{'ResourceChange':{'LogicalResourceId':old,'ResourceType':'AWS::Lambda::WebFunctionRevision','Action':'Remove'}},{'ResourceChange':{'LogicalResourceId':new,'ResourceType':'AWS::Lambda::WebFunctionRevision','Action':'Add'}},{'ResourceChange':{'LogicalResourceId':'MediaEndpoint','ResourceType':'AWS::Lambda::WebFunctionEndpoint','Action':'Modify','Replacement':'False'}}]
change={'StackId':stack,'ChangeSetId':changeset,'StackName':STACK,'ChangeSetName':name,'Status':'CREATE_COMPLETE','ExecutionStatus':'AVAILABLE','Parameters':[{'ParameterKey':'OriginVerifyToken','ParameterValue':'****'}],'Changes':changes}
state={'StackId':stack,'RoleARN':ROLE,'StackStatus':'UPDATE_COMPLETE'}
validate(change,state,template,stack,changeset,prior)
def rejected():
    try: validate(change,state,template,stack,changeset,prior)
    except ValueError: return
    raise AssertionError('Ciclo inseguro aceptado')
template['Resources']['MediaEndpoint']['Properties']['AuthType']='None'
rejected()
template['Resources']['MediaEndpoint']['Properties']['AuthType']='IamAuth'
for replacement in ('True','Conditional'):
    changes[2]['ResourceChange']['Replacement']=replacement
    rejected()
changes[2]['ResourceChange']['Replacement']='False'
template['Resources'][new]['Properties']['ServiceConfig']['ExecutionRoleArn']='different-role'
rejected()
template['Resources'][new]['Properties']['ServiceConfig']['ExecutionRoleArn']='same-role'
prior['Resources'][old]['DeletionPolicy']='Delete'
rejected()
`;
    const result = python('-c', source);
    expect(result.status, result.stderr).toBe(0);
  });
});
