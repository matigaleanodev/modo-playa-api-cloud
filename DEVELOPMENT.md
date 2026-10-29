# Local development

[Español](DEVELOPMENT.es.md)

Use the Node.js version in `.nvmrc` and Python 3 for ZIP packaging.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

The private npm workspaces share one root lockfile:

- `packages/contracts`: neutral route metadata, JSON Schema, derived types and OpenAPI.
- `packages/runtime`: Middy handlers and AJV validation of the HTTP API event envelope.
- `packages/infrastructure`: CDK declarations importing only contracts from the application.

`GET /api/health` returns HTTP 200 with `{"status":"ok"}`. It has no required body or query parameters and does not check external dependencies.

`npm run openapi` writes `dist/openapi.json`. `npm run build` bundles health, creates `dist/health.zip` and runs a smoke with explicitly simulated configuration. `npm run synth:local` synthesizes `cdk.out` using fictitious account, bucket and role references, without lookups or secret reads. The template is for local review.

The same scripts are available through `npm run openapi --workspace=@modo-playa/contracts`, `npm run build --workspace=@modo-playa/runtime` and `npm run synth --workspace=@modo-playa/infrastructure`.
