#!/usr/bin/env python3
"""Revisa el changeset y sus ZIP publicados; no ejecuta mutaciones AWS."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

PREFIX = 'arn:aws:cloudformation:us-east-1:650387442642:'
STACK = 'modo-playa-api-cloud-candidate'
ROLE = 'arn:aws:iam::650387442642:role/modo-playa-candidate-cloudformation'


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def targets(stack, changeset):
    if not re.fullmatch(re.escape(PREFIX + 'stack/' + STACK + '/') + r'[A-Za-z0-9-]+', stack):
        raise ValueError('Stack fuera del destino previsto')
    if not re.fullmatch(re.escape(PREFIX + 'changeSet/' + STACK + '-') + r'[a-f0-9]{40}-[0-9]+-[0-9]+/[A-Za-z0-9-]+', changeset):
        raise ValueError('Changeset fuera del destino previsto')



def stable_environment(current, previous):
    # Una propagación Conditional sólo es inocua si Environment sigue idéntico, salvo referencias de
    # configuración: retirar *_SECRET_ARN, nombres de parámetros del proyecto y la generación de reciclado.
    now = current.get('Properties', {}).get('Environment', {})
    before = previous.get('Properties', {}).get('Environment', {})
    if {k: v for k, v in now.items() if k != 'Variables'} != {k: v for k, v in before.items() if k != 'Variables'}:
        return False
    variables, old = now.get('Variables', {}), before.get('Variables', {})
    for key in set(variables) | set(old):
        value = variables.get(key)
        if value == old.get(key):
            continue
        if key.endswith('_SECRET_ARN') and key not in variables:
            continue
        if key.endswith('_PARAMETER_NAME') and isinstance(value, str) and re.fullmatch(r'/modo-playa/prod/[a-z-]+', value):
            continue
        if key == 'CONFIGURATION_GENERATION' and isinstance(value, str) and re.fullmatch(r'[1-9]\d{0,9}', value):
            continue
        return False
    return True


def stable_permission(resource, changes, template, prior):
    """CF propaga el ARN como dinámico al cambiar Code; verifica que no pueda cambiar."""
    if not prior or resource.get('ResourceType') != 'AWS::Lambda::Permission' or resource.get('Action') != 'Modify' or resource.get('Replacement') != 'Conditional':
        return False
    logical = resource.get('LogicalResourceId')
    permission = template['Resources'].get(logical, {})
    props = permission.get('Properties', {})
    reference = props.get('FunctionName')
    reference = reference.get('Fn::GetAtt', []) if isinstance(reference, dict) else []
    if permission != prior['Resources'].get(logical) or props.get('Action') != 'lambda:InvokeFunction' or props.get('Principal') != 'apigateway.amazonaws.com' or not isinstance(reference, list) or len(reference) != 2 or reference[1] != 'Arn':
        return False
    function = reference[0]
    current = template['Resources'].get(function, {})
    previous = prior['Resources'].get(function, {})
    name = current.get('Properties', {}).get('FunctionName', '')
    if current.get('Type') != 'AWS::Lambda::Function' or not re.fullmatch(STACK + r'-(health|identity|catalog|management)', name):
        return False
    without_code = lambda value: {**value, 'Properties': {k: v for k, v in value.get('Properties', {}).items() if k not in ('Code', 'Environment')}}
    if without_code(current) != without_code(previous) or not stable_environment(current, previous):
        return False
    function_change = next((item['ResourceChange'] for item in changes if item['ResourceChange'].get('LogicalResourceId') == function), {})
    if function_change.get('Action') != 'Modify' or function_change.get('Replacement') != 'False' or function_change.get('PhysicalResourceId') != name or not function_change.get('Details') or any(detail != {'Target': {'Attribute': 'Properties', 'Name': detail.get('Target', {}).get('Name'), 'RequiresRecreation': 'Never'}, 'Evaluation': 'Static', 'ChangeSource': 'DirectModification'} or detail.get('Target', {}).get('Name') not in ('Code', 'Environment') for detail in function_change.get('Details', [])):
        return False
    return resource.get('Scope') == ['Properties'] and resource.get('Details') == [{'Target': {'Attribute': 'Properties', 'Name': 'FunctionName', 'RequiresRecreation': 'Always'}, 'Evaluation': 'Dynamic', 'ChangeSource': 'ResourceAttribute', 'CausingEntity': function + '.Arn'}]


ALLOWED = {'AWS::Lambda::Function', 'AWS::Lambda::Permission', 'AWS::Lambda::WebFunction', 'AWS::Lambda::WebFunctionRevision', 'AWS::Lambda::WebFunctionEndpoint', 'AWS::Lambda::ResourcePolicy', 'AWS::Logs::LogGroup', 'AWS::ApiGatewayV2::Api', 'AWS::ApiGatewayV2::Stage', 'AWS::ApiGatewayV2::Integration', 'AWS::ApiGatewayV2::Route', 'AWS::CloudFront::Distribution', 'AWS::CloudFront::OriginAccessControl', 'AWS::CloudFront::Function'}


def web_revision_cycle(changes, template, prior):
    if not prior:
        return set()
    current, previous = template['Resources'], prior['Resources']
    added = {key for key in current.keys() - previous.keys() if current[key]['Type'] == 'AWS::Lambda::WebFunctionRevision'}
    removed = {key for key in previous.keys() - current.keys() if previous[key]['Type'] == 'AWS::Lambda::WebFunctionRevision'}
    if len(added) != 1 or len(removed) != 1:
        return set()
    new, old = next(iter(added)), next(iter(removed))
    a, b = current[new], previous[old]
    if not all(re.fullmatch(r'MediaRevision[a-f0-9]{64}', key) for key in (new, old)):
        return set()
    if any(value.get('DeletionPolicy') != 'Retain' or value.get('UpdateReplacePolicy') != 'Retain' for value in (a, b)):
        return set()
    if a['Properties'].get('FunctionName') != b['Properties'].get('FunctionName'):
        return set()
    function_ref = a['Properties'].get('FunctionName')
    if not isinstance(function_ref, dict) or set(function_ref) != {'Ref'}:
        return set()
    function = function_ref['Ref']
    if current.get(function, {}).get('Type') != 'AWS::Lambda::WebFunction' or current[function] != previous.get(function):
        return set()
    # Immutable code/config revisions may change, but never the execution identity/runtime.
    for key in ('ExecutionRoleArn', 'MaxConcurrencyPerEnvironment'):
        if a['Properties']['ServiceConfig'].get(key) != b['Properties']['ServiceConfig'].get(key):
            return set()
    if a['Properties']['BuildConfig'].get('RuntimeConfig') != b['Properties']['BuildConfig'].get('RuntimeConfig'):
        return set()
    endpoints = [key for key,value in current.items() if value['Type']=='AWS::Lambda::WebFunctionEndpoint']
    if len(endpoints) != 1:
        return set()
    endpoint = endpoints[0]
    import copy
    expected = copy.deepcopy(previous.get(endpoint, {}))
    expected.get('Properties', {})['RevisionWeights'] = [{'RevisionId': {'Fn::GetAtt': [new, 'RevisionId']}, 'Weight': 100}]
    if previous.get(endpoint, {}).get('Properties', {}).get('RevisionWeights') != [{'RevisionId': {'Fn::GetAtt': [old, 'RevisionId']}, 'Weight': 100}] or current[endpoint] != expected:
        return set()
    by_id = {item['ResourceChange'].get('LogicalResourceId'): item['ResourceChange'] for item in changes}
    if by_id.get(old, {}).get('Action') != 'Remove' or by_id.get(new, {}).get('Action') != 'Add':
        return set()
    endpoint_change = by_id.get(endpoint, {})
    if endpoint_change.get('Action') != 'Modify' or endpoint_change.get('Replacement') != 'False':
        return set()
    return {old, new}


def validate(change, stack_data, template, stack, changeset, prior=None):
    targets(stack, changeset)
    if (change.get('StackId'), change.get('ChangeSetId'), change.get('StackName'), change.get('ChangeSetName')) != (stack, changeset, STACK, changeset.split('/')[-2]):
        raise ValueError('Identidad del changeset alterada')
    if change.get('Status') != 'CREATE_COMPLETE' or change.get('ExecutionStatus') != 'AVAILABLE' or change.get('NextToken'):
        raise ValueError('Changeset incompleto o no disponible')
    if change.get('ImportExistingResources') or change.get('NotificationARNs') or change.get('ParentChangeSetId') or change.get('RootChangeSetId') not in (None, changeset):
        raise ValueError('Alcance adicional no permitido')
    if stack_data.get('StackId') != stack or stack_data.get('RoleARN') != ROLE:
        raise ValueError('Ejecutor CloudFormation inesperado')
    if stack_data.get('StackStatus') not in ('REVIEW_IN_PROGRESS', 'CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE'):
        raise ValueError('Recuperación requiere revisar el estado real antes de continuar')
    # El único parámetro es el token NoEcho; CloudFormation solo devuelve su máscara.
    if change.get('Parameters') != [{'ParameterKey': 'OriginVerifyToken', 'ParameterValue': '****'}]:
        raise ValueError('Parámetros inesperados')
    changes = change.get('Changes', [])
    if not changes:
        raise ValueError('Changeset vacío')
    allowed = ALLOWED
    if any(value['Type'] not in allowed for value in template['Resources'].values()):
        raise ValueError('Recursos fuera de la aplicación')
    revision_cycle = web_revision_cycle(changes, template, prior)
    for item in changes:
        resource = item.get('ResourceChange', {})
        if resource.get('ResourceType') not in allowed or resource.get('ChangeSetId'):
            raise ValueError('Cambio fuera de alcance')
        if resource.get('Action') not in ('Add', 'Modify', 'Remove'):
            raise ValueError('Acción desconocida')
        if resource.get('LogicalResourceId') in revision_cycle:
            continue
        if resource.get('Action') == 'Remove' or (resource.get('Replacement') in ('True', 'Conditional') and not stable_permission(resource, changes, template, prior)):
            raise ValueError('Eliminación o reemplazo requiere revisión específica')
    return {key: change[key] for key in ('StackId', 'StackName', 'ChangeSetId', 'ChangeSetName', 'Changes', 'Parameters', 'Capabilities') if key in change}


def aws(*args):
    result = subprocess.run(['aws', *args, '--region', 'us-east-1', '--output', 'json', '--no-cli-pager'], check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def snapshot(assembly, stack, changeset):
    targets(stack, changeset)
    manifest = json.loads((assembly / 'manifest.json').read_text())
    source = manifest['artifacts']['ModoPlayaCandidate']['properties']['templateFile']
    expected = json.loads((assembly / source).read_text())
    change = aws('cloudformation', 'describe-change-set', '--stack-name', stack, '--change-set-name', changeset)
    stacks = aws('cloudformation', 'describe-stacks', '--stack-name', stack)['Stacks']
    if len(stacks) != 1:
        raise ValueError('Stack ambigua')
    template = aws('cloudformation', 'get-template', '--stack-name', stack, '--change-set-name', changeset, '--template-stage', 'Original')['TemplateBody']
    if isinstance(template, str):
        template = json.loads(template)
    if template != expected:
        raise ValueError('Template distinto del assembly revisado')
    prior = None
    if stacks[0].get('StackStatus') != 'REVIEW_IN_PROGRESS':
        prior = aws('cloudformation', 'get-template', '--stack-name', stack, '--template-stage', 'Original')['TemplateBody']
        if isinstance(prior, str):
            prior = json.loads(prior)
    reviewed = validate(change, stacks[0], template, stack, changeset, prior)
    assets = json.loads((assembly / manifest['artifacts']['ModoPlayaCandidate.assets']['properties']['file']).read_text())
    objects = []
    codes = set()
    for resource in template['Resources'].values():
        if resource['Type'] == 'AWS::Lambda::Function':
            codes.add(json.dumps(resource['Properties']['Code'], sort_keys=True))
        elif resource['Type'] == 'AWS::Lambda::WebFunctionRevision':
            obj = resource['Properties']['BuildConfig']['CodeConfig']['S3Object']
            codes.add(json.dumps({'S3Bucket': obj['Bucket'], 'S3Key': obj['Key']}, sort_keys=True))
    for value in sorted(codes):
        code = json.loads(value)
        matches = [asset for asset in assets['files'].values() if any(d['bucketName'] == code['S3Bucket'] and d['objectKey'] == code['S3Key'] for d in asset['destinations'].values())]
        if len(matches) != 1 or not matches[0]['source']['path'].endswith('.zip'):
            raise ValueError('ZIP sin fuente única')
        local = (assembly / matches[0]['source']['path']).read_bytes()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'asset.zip'
            metadata = aws('s3api', 'get-object', '--bucket', code['S3Bucket'], '--key', code['S3Key'], str(output))
            if output.read_bytes() != local:
                raise ValueError('Los bytes publicados no coinciden con el assembly revisado')
        objects.append({'bucket': code['S3Bucket'], 'key': code['S3Key'], 'version': metadata.get('VersionId'), 'sha256': hashlib.sha256(local).hexdigest()})
    return {'change': reviewed, 'role': stacks[0]['RoleARN'], 'templateHash': digest(template), 'priorTemplateHash': digest(prior) if prior else None, 'objects': objects}


if __name__ == '__main__':
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        raise ValueError('La lectura administrada se realiza desde Actions')
    assembly, stack, changeset, output = sys.argv[1:]
    value = snapshot(Path(assembly), stack, changeset)
    Path(output).write_text(json.dumps(value, indent=2) + '\n')
    print('sha256:' + digest(value))