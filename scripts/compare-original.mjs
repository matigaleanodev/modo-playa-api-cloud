import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import * as schemas from '@modo-playa/contracts/identity';

const root = fileURLToPath(new URL('..', import.meta.url));
assert.ok(process.env.ORIGINAL_API_DIR, 'Indicar ORIGINAL_API_DIR explícito; nunca se carga .env.');
const original = resolve(process.env.ORIGINAL_API_DIR);
const requireOriginal = createRequire(resolve(original, 'package.json'));
requireOriginal('reflect-metadata');
const { JwtService } = requireOriginal('@nestjs/jwt');
const work = resolve(root, '.tmp/original-comparison');
await mkdir(work, { recursive: true });
const entries = {
  JwtStrategy: 'auth/strategies/jwt.strategy.ts',
  createAppValidationPipe: 'common/pipes/app-validation.pipe.ts',
  LoginDto: 'auth/dto/login.dto.ts',
  ActivateDto: 'auth/dto/activate.dto.ts',
  PasswordDto: 'auth/dto/password.dto.ts',
  AuthIdentifierDto: 'auth/dto/auth-identifier.dto.ts',
  ChangePasswordDto: 'auth/dto/change-password.dto.ts',
  UpdateMyProfileDto: 'auth/dto/update-my-profile.dto.ts',
  CreateUserDto: 'users/dto/create-user.dto.ts',
  UpdateUserDto: 'users/dto/update-user.dto.ts',
  UsersQueryDto: 'users/dto/users-query.dto.ts',
};
const entry = resolve(work, 'entry.ts');
await writeFile(
  entry,
  Object.entries(entries)
    .map(
      ([name, path]) =>
        `export { ${name} } from ${JSON.stringify(resolve(original, 'src', path))};`,
    )
    .join('\n'),
);
await build({
  absWorkingDir: root,
  entryPoints: [entry],
  outfile: resolve(work, 'original.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  tsconfig: resolve(original, 'tsconfig.json'),
  plugins: [
    {
      name: 'original-dependencies',
      setup(build) {
        build.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.path.startsWith('@common/') || args.path.startsWith('@auth/')) return;
          if (args.path.startsWith('node:')) return { path: args.path, external: true };
          return { path: requireOriginal.resolve(args.path), external: true };
        });
      },
    },
  ],
});
const source = await import(pathToFileURL(resolve(work, 'original.mjs')).href);
await build({
  absWorkingDir: root,
  stdin: {
    contents:
      "export { TokenService } from './packages/runtime/src/identity/tokens.ts'; export { validate, normalizeBody, normalizeUsersQuery } from './packages/runtime/src/identity/validation.ts';",
    resolveDir: root,
    loader: 'ts',
  },
  outfile: resolve(work, 'cloud.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
const { TokenService, validate, normalizeBody, normalizeUsersQuery } = await import(
  pathToFileURL(resolve(work, 'cloud.mjs')).href
);

const key = 'simulated-only-jwt-comparison-key';
const jwt = new JwtService({ secret: key, signOptions: { expiresIn: '15m' } });
const strategy = new source.JwtStrategy({ get: (_name, fallback) => key ?? fallback });
const cloud = new TokenService(key);
const user = { sub: '507f1f77bcf86cd799439013', ownerId: '507f1f77bcf86cd799439011' };
for (const purpose of [undefined, 'ACCESS', 'REFRESH', 'PASSWORD_SETUP']) {
  const payload = { ...user, ...(purpose ? { purpose, role: 'SUPERADMIN' } : {}) };
  const originalToken = jwt.sign(payload, { expiresIn: '15m' });
  const accepted = cloud.authenticate('Bearer ' + originalToken);
  assert.equal(accepted.purpose, purpose ?? 'ACCESS');
  const cloudToken = cloud.sign(payload, { expiresIn: '15m' });
  const originalAccepted = strategy.validate(jwt.verify(cloudToken));
  assert.deepEqual(originalAccepted, accepted);
  // También pasa por la verificación real de PassportStrategy, con defaults de algoritmos originales.
  const passport = new (requireOriginal('passport-jwt').Strategy)(
    {
      jwtFromRequest: requireOriginal('passport-jwt').ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: key,
    },
    (payload, done) => done(null, strategy.validate(payload)),
  );
  await new Promise((resolve, reject) => {
    passport.success = (actual) => {
      try {
        assert.deepEqual(actual, accepted);
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    passport.fail = () => reject(new Error('Original Passport rejected simulated cloud token.'));
    passport.error = reject;
    passport.authenticate({ headers: { authorization: 'Bearer ' + cloudToken } });
  });
}

const pipe = source.createAppValidationPipe();
const cases = [
  ['LoginDto', schemas.loginSchema, 'login', { identifier: ' OWNER ', password: 'Password123' }],
  ['LoginDto', schemas.loginSchema, 'login', { identifier: 'owner' }],
  ['LoginDto', schemas.loginSchema, 'login', { identifier: 'ab', password: 3 }],
  ['AuthIdentifierDto', schemas.identifierSchema, '', { identifier: 'ab' }],
  ['AuthIdentifierDto', schemas.identifierSchema, '', { identifier: null }],
  ['ActivateDto', schemas.codeSchema, '', { identifier: 'owner', code: 'bad' }],
  ['ActivateDto', schemas.codeSchema, '', {}],
  ['PasswordDto', schemas.passwordSchema, '', { password: 'a'.repeat(71) + '❤\uFE0F' }],
  ['PasswordDto', schemas.passwordSchema, '', { password: '❤\uFE0F'.repeat(7) }],
  [
    'ChangePasswordDto',
    schemas.changePasswordSchema,
    '',
    { currentPassword: 'too short', newPassword: '' },
  ],
  ['CreateUserDto', schemas.createUserSchema, '', { email: 'bad', username: 'ab' }],
  [
    'CreateUserDto',
    schemas.createUserSchema,
    '',
    { email: 'a@example.test', username: '   ', targetOwnerId: null },
  ],
  [
    'CreateUserDto',
    schemas.createUserSchema,
    '',
    { email: 'a@example.test', username: 'abc', targetOwnerId: 'bad' },
  ],
  [
    'CreateUserDto',
    schemas.createUserSchema,
    '',
    { email: 'a@example.test', username: 'abc', extra: true },
  ],
  ['UpdateUserDto', schemas.updateUserSchema, '', { firstName: null, avatarUrl: 'example.com' }],
  ['UpdateUserDto', schemas.updateUserSchema, '', { avatarUrl: 'bad' }],
  ['UpdateMyProfileDto', schemas.updateMeSchema, 'updateMe', { firstName: ' Ana ', phone: null }],
  ['UpdateMyProfileDto', schemas.updateMeSchema, 'updateMe', { firstName: 123 }],
  ['UsersQueryDto', schemas.usersQuerySchema, '', {}],
  ['UsersQueryDto', schemas.usersQuerySchema, '', { page: '2', limit: '100' }],
  ['UsersQueryDto', schemas.usersQuerySchema, '', { page: '1.5', limit: '1' }],
  ['UsersQueryDto', schemas.usersQuerySchema, '', { page: 'bad', limit: '1' }],
  ['UsersQueryDto', schemas.usersQuerySchema, '', { limit: '' }],
  ['UsersQueryDto', schemas.usersQuerySchema, '', { limit: ['5', '8'] }],
  ['UsersQueryDto', schemas.usersQuerySchema, '', { page: null, limit: null }],
];
cases.push(
  ['LoginDto', schemas.loginSchema, 'login', []],
  ['LoginDto', schemas.loginSchema, 'login', null],
  ['UpdateMyProfileDto', schemas.updateMeSchema, 'updateMe', []],
  ['UsersQueryDto', schemas.usersQuerySchema, '', { page: 'Infinity', limit: '1' }],
  ['UsersQueryDto', schemas.usersQuerySchema, '', { page: '2', limit: '50.5' }],
  [
    'CreateUserDto',
    schemas.createUserSchema,
    '',
    JSON.parse('{"email":"a@example.test","username":"abc","constructor":"discarded"}'),
  ],
);
for (const [name, schema, operation, input] of cases) {
  let expected;
  try {
    expected = {
      value: await pipe.transform(structuredClone(input), {
        type: name === 'UsersQueryDto' ? 'query' : 'body',
        metatype: source[name],
      }),
    };
  } catch (error) {
    expected = { error: error.getResponse() };
  }
  let actual;
  try {
    actual = {
      value: validate(
        schema,
        name === 'UsersQueryDto'
          ? normalizeUsersQuery(structuredClone(input))
          : normalizeBody(structuredClone(input), operation),
      ),
    };
  } catch (error) {
    actual = { error: { message: error.message, code: error.code } };
  }
  assert.deepEqual(
    JSON.parse(JSON.stringify(actual)),
    JSON.parse(JSON.stringify(expected)),
    `Contrato original ${name}: ${JSON.stringify(input)}`,
  );
}
assert.doesNotMatch(
  await readFile(resolve(root, 'packages/runtime/package.json'), 'utf8'),
  /@nestjs/,
);
console.info(
  'Compatibilidad bidireccional con JwtService/Passport originales y validaciones DTO comparadas, solo claves/datos simulados.',
);
