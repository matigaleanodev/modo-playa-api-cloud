import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const cache = join(root, 'node_modules/.cache/modo-playa-media-arm64');
for (const name of ['@img/sharp-linux-arm64', '@img/sharp-libvips-linux-arm64']) {
  const locked = lock.packages['node_modules/' + name];
  assert.ok(locked?.version && locked.integrity);
  const target = join(cache, name);
  try {
    const installed = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
    if (installed.version === locked.version) continue;
  } catch {}
  const temporary = await mkdtemp(join(tmpdir(), 'modo-playa-native-'));
  try {
    const packed = JSON.parse(
      execFileSync(
        'npm',
        [
          'pack',
          name + '@' + locked.version,
          '--ignore-scripts',
          '--json',
          '--pack-destination',
          temporary,
        ],
        { encoding: 'utf8', cwd: root },
      ),
    )[0];
    assert.equal(
      packed.integrity,
      locked.integrity,
      'Native package integrity differs from lockfile.',
    );
    const tar = await readFile(join(temporary, packed.filename));
    assert.ok(tar.length < 128 * 1024 * 1024);
    assert.equal('sha512-' + createHash('sha512').update(tar).digest('base64'), locked.integrity);
    await mkdir(target, { recursive: true });
    execFileSync(
      'python3',
      [
        '-c',
        [
          'import pathlib,tarfile,sys',
          'target=pathlib.Path(sys.argv[2]).resolve()',
          'with tarfile.open(sys.argv[1]) as archive:',
          ' members=archive.getmembers(); assert len(members)<1000 and sum(m.size for m in members)<256*1024*1024',
          ' for member in members:',
          '  parts=pathlib.PurePosixPath(member.name).parts',
          '  assert parts and parts[0]=="package" and ".." not in parts',
          '  dest=target.joinpath(*parts[1:]).resolve(); assert dest.is_relative_to(target)',
          '  assert member.isdir() or member.isfile()',
          '  if member.isdir(): dest.mkdir(parents=True,exist_ok=True)',
          '  else:',
          '   dest.parent.mkdir(parents=True,exist_ok=True)',
          '   dest.write_bytes(archive.extractfile(member).read())',
        ].join('\n'),
        join(temporary, packed.filename),
        target,
      ],
      { stdio: 'inherit' },
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
console.info('Sharp Linux ARM64 prebuilds prepared from lockfile; no lifecycle scripts.');
