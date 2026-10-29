# Local development

[Español](DEVELOPMENT.es.md)

Use the Node.js version in `.nvmrc`, Python 3 and `readelf` (binutils), on Linux.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

Private workspaces share one root lockfile: `contracts` contains neutral metadata, JSON Schema, derived types and OpenAPI; `runtime`, Middy/AJV handlers, services and persistence; `infrastructure`, CDK importing contracts only.

Runtime groups are `health`, `identity`, `catalog` and `management`. Health returns 200 `{"status":"ok"}` without external queries. Identity implements JSON auth and users; catalog, public lodgings and destinations; management, contacts, lodgings, availability and dashboard. Methods, schemas, Bearer and responses are in `dist/openapi.json`. POST returns 201; availability DELETE retains its JSON body. Validation rejects extra fields and preserves optional/null values, transformations and contract messages. `x-original-min-length`/`x-original-max-length` retain validator's Unicode counting.

Contacts defaults to `includeInactive=false`; admin lodgings defaults to `true` and applies pagination/visibility, while accepting the declared public filters. The public catalog applies its filters, includes legacy documents without `isPubliclyVisible` and excludes hidden ones; its mapper omits owner, notes, keys and internal data. OWNER retains scope; SUPERADMIN widens reads and supports targetOwnerId/fallback on creation. Lodging PATCH validates the contact against the requesting owner. Dashboard retains aggregations over legacy `active` and timestamp-derived activity.

Lodging creation and deletion require a real `LodgingMedia` integration: attaching/processing drafts after saving, compensating on failure, and cleaning objects before deleting the document. Without that dependency the runtime returns 503 before writing. Local contracts and factories with doubles do not enable publishing those routes. There is no multipart, image processing or real storage. `uploadSessionId` and `pendingImageIds` are preserved.

Destinations retains parallel Open-Meteo and sunrise-sunset requests, timezone and points of interest. Axios uses 10 seconds per provider under the request deadline, response limits of 64 KiB for weather and 16 KiB for solar, without redirects/retries. Weather uses a 30-minute memory cache per destination; solar is uncached. Failures become 503 without serializing Axios data.

`npm run openapi` generates local OpenAPI; `/docs` and `/openapi.json` are not published runtime routes. `npm run build` creates four independent ZIPs, checks inputs/allowlists and smoke-tests extracted artifacts with explicit configuration and doubles. Catalog/management exclude bcrypt and Resend; catalog excludes JWT. Identity includes only the Linux x86_64/glibc bcrypt prebuild and loader; local loading does not validate managed Lambda. Installation lifecycle scripts remain disabled.

`npm run synth:local` synthesizes health only using fictitious references, without lookups or secret reads. It declares no business infrastructure or deployment pipeline.

Deferred configuration by group:

- `IDENTITY_SECRET_ARN`: optional JSON containing `MONGO_URI`, `SECRET_KEY`, `RESEND_API_KEY` and `RESEND_FROM_EMAIL`; direct injection is also supported. `BCRYPT_ROUNDS` defaults to 12; `SUPERADMIN_OWNER_ID` determines the session role. There is no example JWT key fallback.
- `CATALOG_SECRET_ARN`: optional JSON containing `MONGO_URI`. `MANAGEMENT_SECRET_ARN`: optional JSON containing `MONGO_URI` and `SECRET_KEY`. Direct injection is also supported, without email or bcrypt credentials.
- `MEDIA_PUBLIC_BASE_URL`, `R2_ENDPOINT` and `R2_BUCKET`: pure existing-image mapping, without storage clients.

Mongo reuses one connection per instance, a maximum pool of 4 and bounded operations, without autoCreate/autoIndex. It retains `users`, `contacts`, `lodgings`, ObjectId, timestamps, declared indexes and legacy fields. Dashboard reuses identity's User model.

Tests and smoke use factories and simulated dependencies; external HTTP is tested with doubles/a loopback server. `LOCAL_MONGOD=/path/to/mongod` enables real persistence in a dedicated temporary process/database, with cleanup and loopback binding; it accepts no external URI. Without it, only that suite is skipped. `ORIGINAL_API_DIR=/path/to/modo-playa-api node scripts/compare-original.mjs` compares JWT and specific DTOs against a local checkout with installed dependencies, without reading `.env`.

Workspace scripts also work directly: `npm run openapi` in contracts, `npm run build` in runtime and `npm run synth` in infrastructure.
