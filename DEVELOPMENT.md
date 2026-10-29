# Local development

[Español](DEVELOPMENT.es.md)

Use the Node.js version in `.nvmrc`, Python 3 and `readelf` (binutils), on Linux.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

Private workspaces share one root lockfile:

- `packages/contracts`: neutral route metadata, JSON Schema, derived types and OpenAPI.
- `packages/runtime`: Middy/AJV handlers; identity with Mongo, JWT, bcrypt and Resend.
- `packages/infrastructure`: CDK importing application contracts only.

`GET /api/health` returns 200 `{"status":"ok"}`, without a required body or external calls. Identity implements JSON auth and POST/GET/PATCH users; methods and contracts are in `dist/openapi.json`. POST returns 201. Validation rejects extra fields; `x-original-min-length` and `x-original-max-length` preserve validator's Unicode length counting. User pagination defaults to page=1/limit=10 and clamps integers above 50.

`npm run openapi` generates OpenAPI. `npm run build` creates `health.zip` and `identity.zip`, checks their allowlists and tests extracted ZIPs with simulated dependencies. Health stays separate from identity. Identity includes only the Linux x86_64/glibc bcrypt prebuild and its loader; local execution does not establish managed Lambda runtime compatibility. Installation lifecycle scripts remain disabled.

`npm run synth:local` synthesizes health only with fictional references, without lookups or secret reads. The template is for local review; it does not declare identity infrastructure.

Identity configuration, loaded when invoking the runtime:

- `IDENTITY_SECRET_ARN`: optional reference to JSON containing `MONGO_URI`, `SECRET_KEY`, `RESEND_API_KEY` and `RESEND_FROM_EMAIL`. Direct injection of those fields is also supported. There is no default example JWT key.
- `BCRYPT_ROUNDS`: defaults to 12; `SUPERADMIN_OWNER_ID`: owner determining the session role.
- `MEDIA_PUBLIC_BASE_URL`, `R2_ENDPOINT` and `R2_BUCKET`: metadata URL mapping only, without storage clients.

The Mongo connection is reused per instance with a maximum pool of 4, deadlines and autoCreate/autoIndex disabled. The `users` collection is preserved. Tests and smoke use factories with explicit configuration and simulated mail. The optional persistence test requires `LOCAL_MONGOD=/path/to/mongod`: it starts its own loopback process and removes its temporary database; it accepts no external URI. Without that variable, only that test suite is skipped.

To compare JWT/DTO behavior against a local original checkout with its dependencies installed, use `ORIGINAL_API_DIR=/path/modo-playa-api node scripts/compare-original.mjs`. This uses simulated data and keys only; it does not read private environment files.

Scripts also work directly in each workspace: `npm run openapi` in contracts, `npm run build` in runtime and `npm run synth` in infrastructure.
