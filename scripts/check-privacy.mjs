import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export function isPrivatePath(name) {
  if (name === 'AGENTS.md') return false;
  const parts = name.replaceAll('\\', '/').toLowerCase().split('/');
  return parts.some(
    (part) =>
      [
        'agents.md',
        'roadmap.md',
        'context.md',
        '.agents',
        '.codex',
        '.aws',
        '.tmp',
        'mentor',
        'status',
        'secrets',
        'credentials',
      ].includes(part) || part.startsWith('.env'),
  );
}

for (const name of [
  'status/current.md',
  'agents.md',
  'src/AGENTS.md',
  'src/.env',
  '.tmp/input.json',
]) {
  assert.ok(isPrivatePath(name));
}
assert.equal(isPrivatePath('AGENTS.md'), false);
assert.equal(isPrivatePath('packages/runtime/src/health/handler.ts'), false);

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const publicFiles = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  {
    cwd: root,
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter(Boolean);
for (const name of publicFiles) {
  assert.ok(!isPrivatePath(name), `Archivo privado publicable: ${name}`);
  assert.ok(!name.split('/').includes('node_modules'), `Dependencias versionadas: ${name}`);
}
assert.ok(['README.md', 'README.es.md'].every((name) => tracked.includes(name)));
for (const name of [
  'agents.md',
  'roadmap.md',
  'context.md',
  'status/current.md',
  'mentor/note.md',
  '.tmp/probe',
  '.env',
  '.aws/config',
]) {
  assert.equal(tracked.includes(name), false, `Archivo privado versionado: ${name}`);
  execFileSync('git', ['check-ignore', '-q', name], { cwd: root });
}
console.info('Estructura pública, archivos privados y exclusiones comprobados.');
