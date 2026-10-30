# Local development

[Español](DEVELOPMENT.es.md)

Use the Node.js version in `.nvmrc`, Python 3 and `readelf` (binutils), on Linux.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

Private workspaces share one root lockfile: `contracts` contains neutral metadata, JSON Schema, derived types and OpenAPI; `runtime`, Middy/AJV handlers, services and persistence; `infrastructure`, CDK importing contracts only.

Runtime groups are `health`, `identity`, `catalog`, `management` and `media`. Health returns 200 `{"status":"ok"}` without business-provider queries. Identity implements JSON auth and users; catalog, public lodgings and destinations; management, contacts and dashboard; media, native HTTP for profiles, drafts, images and full lodging/availability management. Methods, schemas, Bearer and responses are in `dist/openapi.json`. POST returns 201; availability DELETE retains its JSON body. Validation rejects extra fields and preserves optional/null values, transformations and contract messages. `x-original-min-length`/`x-original-max-length` retain validator's Unicode counting.

Contacts defaults to `includeInactive=false`; admin lodgings defaults to `true` and applies pagination/visibility, while accepting the declared public filters. The public catalog applies its filters, includes legacy documents without `isPubliclyVisible` and excludes hidden ones; its mapper omits owner, notes, keys and internal data. OWNER retains scope; SUPERADMIN widens reads and supports targetOwnerId/fallback on creation. Lodging PATCH validates the contact against the requesting owner. Dashboard retains aggregations over legacy `active` and timestamp-derived activity.

Media preserves backend-only multipart with a `file` field: up to 10 MiB per lodging image and 5 MiB per profile, plus 128 KiB for the multipart envelope. The parser bounds parts/fields and consumes rejected bodies before responding. Processing preserves rotation, inside resize without enlargement and WebP: lodging 2560×2560/quality 82; profile 1024×1024/quality 84, configurable. Profiles use the current userId/ownerId and reject SUPERADMIN. Drafts retain PENDING/CONFIRMED, owner/session, TTL, staging/final keys and pendingImageIds order; up to five images and one default.

Creation saves and attaches drafts; failure confirms document deletion before compensating possibly referenced final objects. If deletion fails, objects remain and the error propagates, without automatic retry. Lodging deletion cleans final, pending and legacy objects before deleting the document. Best-effort cleanup keeps that behavior; Mongo TTL does not remove R2 objects. Missing required integration/configuration returns 503 before writes.

The media group listens on `AWS_LAMBDA_HTTP_ENDPOINT` through `index.js`, receiving HTTP without an event/base64 envelope. Its target model is Lambda Web Functions Node24 ARM64 with application JWT; uploads do not traverse HTTP API/Event Lambda. Ingress and its controls are declared separately. R2 uses PutObject with known ContentLength, a private temporary spool and no retries/optional aws-chunked checksums; media health only performs HeadBucket. `MEDIA_REQUEST_TIMEOUT_MS` bounds each request (90000 by default); disconnections/deadlines cancel streams and compensation uses an independent deadline.

Destinations retains parallel Open-Meteo and sunrise-sunset requests, timezone and points of interest. Axios uses 10 seconds per provider under the request deadline, response limits of 64 KiB for weather and 16 KiB for solar, without redirects/retries. Weather uses a 30-minute memory cache per destination; solar is uncached. Failures become 503 without serializing Axios data.

`npm run openapi` generates local OpenAPI. The protected health origin serves public Swagger UI at `/docs` (also `/docs/`) and the current contract at `/openapi.json`, outside the `/api` prefix. Swagger UI loads version-pinned, integrity-checked assets from jsDelivr; remote contract validation is disabled. `npm run build` creates five independent ZIPs, checks inputs/allowlists and smoke-tests extracted artifacts with explicit configuration and doubles. Catalog/management/media exclude bcrypt and Resend; catalog excludes JWT. Identity includes only the Linux x86_64/glibc bcrypt prebuild and loader; local loading does not validate managed Lambda. Installation lifecycle scripts remain disabled. Build prepares the two lockfile-pinned Sharp ARM64 prebuilds in an ignored local cache, verifying SHA-512 and bounded extraction without symlinks; registry access is needed only when missing. `npm run prepare:media-native` prepares them explicitly. The media ZIP includes only Linux ARM64 Sharp/libvips; loading on Ubuntu x64 does not validate that binary or managed ingress.

`npm run synth:local` synthesizes foundation and application with fictitious `modo-playa/prod/*` references, without lookups or secret reads, and reviews the full assembly. `npm run synth` uses environment references to prepare delivery. The [delivery procedure](DEPLOYMENT.md) describes configuration, controls and recovery.

CloudFront selects one origin per path: `/api/admin/lodgings`, `/api/admin/lodgings/*`, `/api/admin/lodging-image-uploads`, `/api/auth/me/profile-image` and `/api/admin/media/health` reach Web Functions; other operations use explicit HTTP API/Event routes. It preserves `/api`, Bearer, query, Content-Type/boundary and methods/body; HEAD and OPTIONS reach the selected backend. No cache or mutating failover. Events retain x86_64; media uses Node24 ARM64, concurrency 1 per environment, at most 2 environments, a 90 s application deadline, Web 100 s and CloudFront origin 110 s/completion 120 s. These declarations do not establish managed capacity.

Web Functions uses `IamAuth`, `always-amz-auth` OAC and an endpoint policy scoped to the distribution. The JSON origin retains execute-api and requires `x-modo-playa-origin`, overwritten by CloudFront; every Event export rejects missing/invalid configuration before effects, including HEAD/OPTIONS/health. Cloudflare IP headers are not trusted. Health does not query Mongo; it may resolve its ingress reference when an instance starts.

Sensitive configuration resolved at runtime:

| Reference                        | Sensitive JSON                                 | Readers                           |
| -------------------------------- | ---------------------------------------------- | --------------------------------- |
| `modo-playa/prod/app-properties` | `MONGO_URI`, `SECRET_KEY`                      | identity, management and media    |
| `modo-playa/prod/database`       | `MONGO_URI`                                    | catalog                           |
| `modo-playa/prod/email`          | `RESEND_API_KEY`                               | identity                          |
| `modo-playa/prod/object-storage` | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`     | media                             |
| `modo-playa/prod/ingress`        | `ORIGIN_VERIFY_TOKEN` (at least 32 characters) | Event and CloudFormation executor |

`IDENTITY_SECRET_ARN`, `MANAGEMENT_SECRET_ARN` and `MEDIA_SECRET_ARN` share the main reference; `CATALOG_SECRET_ARN`, `EMAIL_SECRET_ARN`, `STORAGE_SECRET_ARN` and `ORIGIN_SECRET_ARN` select their respective domain. Separations prevent catalog from reading JWT, or email/object credentials from reaching groups that do not need them: `GetSecretValue` returns the entire JSON. Synth creates no secrets. Authenticated Mongo retains its current mechanism.

Public variables: `RESEND_FROM_EMAIL`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_REGION` (`auto`), `MEDIA_PUBLIC_BASE_URL`, `CORS_ORIGIN` (compatible `*`), `BCRYPT_ROUNDS` (12), `SUPERADMIN_OWNER_ID`, `IMAGE_ALLOWED_MIME`, `PENDING_UPLOAD_TTL_SECONDS` and `LODGING_IMAGE_MAX_BYTES/WIDTH/HEIGHT` / `USER_PROFILE_IMAGE_MAX_BYTES/WIDTH/HEIGHT`. Direct sensitive configuration injection remains available for explicit fixtures; CDK declares references only. Configuration errors are sanitized. Ingress rotation requires coordinating CloudFront and Event instance recycling because valid configuration is cached per instance.

Mongo reuses one connection per instance, a maximum pool of 4 and bounded operations, without autoCreate/autoIndex. It retains `users`, `contacts`, `lodgings`, ObjectId, timestamps, declared indexes and legacy fields. Dashboard reuses identity's User model.

Tests and smoke use factories and simulated dependencies; external HTTP is tested with doubles/a loopback server. `LOCAL_MONGOD=/path/to/mongod` enables real persistence in a dedicated temporary process/database, with cleanup and loopback binding; it accepts no external URI. Without it, persistence suites are skipped; HTTP parser, stream errors and HEAD remain covered without Mongo. Media tests with Mongo use real Sharp, valid images near the limits and substituted storage; they do not validate managed R2/Atlas or ingress. `ORIGINAL_API_DIR=/path/to/modo-playa-api node scripts/compare-original.mjs` compares JWT and specific DTOs against a local checkout with installed dependencies, without reading `.env`.

Workspace scripts also work directly: `npm run openapi` in contracts, `npm run build` in runtime and `npm run synth` in infrastructure.
