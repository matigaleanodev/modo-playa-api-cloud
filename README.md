# Modo Playa API Cloud

[Español](README.es.md)

![Node.js 24](https://img.shields.io/badge/Node.js-24-5FA04E?logo=nodedotjs&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white) ![AWS Lambda](https://img.shields.io/badge/AWS-Lambda-FF9900) ![AWS CDK](https://img.shields.io/badge/IaC-AWS_CDK-FF9900) ![Vitest](https://img.shields.io/badge/tests-Vitest-6E9F18?logo=vitest&logoColor=white)

Serverless API for Modo Playa, written in TypeScript with AWS Lambda handlers. It provides a public lodging catalog, destinations, authentication and owner management, preserving the NestJS implementation contracts.

## Stack and architecture

Node.js 24, strict TypeScript and ESM; CloudFront, HTTP API Gateway v2, Middy, AJV, MongoDB through Mongoose and Secrets Manager. Three private npm workspaces separate infrastructure, runtime and neutral contracts, with one root lockfile. AWS CDK and GitHub Actions handle packaging and delivery through OIDC and verified artifacts.

Five runtime groups have independent ZIPs: health, identity, catalog, management and media. Four Event Functions use x86_64; media uses a Node24 ARM64 Lambda Web Function with native HTTP. CloudFront selects one origin per path, preserves Bearer tokens and disables caching. JSON requests require a secret origin header; the Web origin uses IAM and CloudFront OAC. JWT roles and owner isolation remain application controls.

R2 stores images processed by Sharp; Resend handles authentication emails. Destination context uses Open-Meteo and sunrise-sunset data. The Angular/Ionic public app and the administration panel consume the API separately.

## Endpoints

Representative routes:

| Method        | Path                               | Purpose                             |
| ------------- | ---------------------------------- | ----------------------------------- |
| GET           | `/api/health`                      | 200 · `{"status":"ok"}`             |
| GET           | `/api/lodgings`                    | Public lodging catalog              |
| GET           | `/api/lodgings/{id}`               | Public lodging detail               |
| GET           | `/api/destinations`                | Available destinations              |
| GET           | `/api/destinations/{id}/context`   | Weather, sun and points of interest |
| POST          | `/api/auth/login`                  | Authentication and JWT session      |
| GET / PATCH   | `/api/auth/me`                     | Current user profile                |
| GET / POST    | `/api/admin/lodgings`              | Owner-scoped listing and creation   |
| POST          | `/api/admin/lodging-image-uploads` | Draft lodging image upload          |
| POST / DELETE | `/api/auth/me/profile-image`       | Current user profile image          |
| GET           | `/docs`                            | Swagger UI                          |
| GET           | `/openapi.json`                    | Current OpenAPI contract            |

GET routes also support bodyless HEAD; the selected backend handles CORS/preflight. JSON Schema and AJV validate application inputs. The complete methods, paths, schemas and Bearer requirements are defined in [shared contracts](packages/contracts/src/routes.ts) and the generated OpenAPI document. Documentation routes live outside the `/api` prefix.

Media remains backend-only multipart: up to 10 MiB per lodging image and 5 MiB per profile image. The media group also handles lodging management, draft attachment, image selection and cleanup. Availability DELETE retains its JSON body. The public catalog excludes owner data and internal storage keys.

## Local development

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

Node 24.22.1 as pinned by `.nvmrc`, Python 3 for ZIP creation and `readelf` from binutils, on Linux. `check` verifies package boundaries, privacy, lint, formatting, types, tests, OpenAPI, bundles, local CDK synthesis and access-policy preparation. Local checks use fixtures and simulated providers; `LOCAL_MONGOD` enables isolated persistence tests.

## Documentation

- [Development, configuration and contracts](DEVELOPMENT.md)
- [Delivery and recovery](DEPLOYMENT.md)
