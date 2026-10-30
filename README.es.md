# Modo Playa API Cloud

[English](README.md)

![Node.js 24](https://img.shields.io/badge/Node.js-24-5FA04E?logo=nodedotjs&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white) ![AWS Lambda](https://img.shields.io/badge/AWS-Lambda-FF9900) ![AWS CDK](https://img.shields.io/badge/IaC-AWS_CDK-FF9900) ![Vitest](https://img.shields.io/badge/tests-Vitest-6E9F18?logo=vitest&logoColor=white)

API serverless de Modo Playa, escrita en TypeScript con handlers para AWS Lambda. Ofrece catálogo público de alojamientos, destinos, autenticación y gestión por propietario, conservando los contratos de la implementación NestJS.

## Stack y arquitectura

Node.js 24, TypeScript estricto y ESM; CloudFront, HTTP API Gateway v2, Middy, AJV, MongoDB mediante Mongoose y Secrets Manager. Tres npm workspaces privados separan infraestructura, runtime y contratos neutrales, con un único lockfile raíz. AWS CDK y GitHub Actions resuelven empaquetado y entrega mediante OIDC y artifacts verificados.

Cinco grupos runtime tienen ZIP independientes: health, identity, catalog, management y media. Cuatro Event Functions usan x86_64; media utiliza una Lambda Web Function Node24 ARM64 con HTTP nativo. CloudFront selecciona un origen por ruta, conserva Bearer y deshabilita caché. El origen JSON exige un header secreto; el origen Web usa IAM y OAC de CloudFront. Los roles JWT y el aislamiento por propietario se controlan en la aplicación.

R2 almacena imágenes procesadas por Sharp; Resend gestiona los correos de autenticación. El contexto de destinos utiliza datos de Open-Meteo y sunrise-sunset. La app pública Angular/Ionic y el panel de administración consumen la API por separado.

## Endpoints

Rutas representativas:

| Método        | Ruta                               | Función                                  |
| ------------- | ---------------------------------- | ---------------------------------------- |
| GET           | `/api/health`                      | 200 · `{"status":"ok"}`                  |
| GET           | `/api/lodgings`                    | Catálogo público de alojamientos         |
| GET           | `/api/lodgings/{id}`               | Detalle público de alojamiento           |
| GET           | `/api/destinations`                | Destinos disponibles                     |
| GET           | `/api/destinations/{id}/context`   | Clima, sol y puntos de interés           |
| POST          | `/api/auth/login`                  | Autenticación y sesión JWT               |
| GET / PATCH   | `/api/auth/me`                     | Perfil del usuario actual                |
| GET / POST    | `/api/admin/lodgings`              | Listado y alta con scope por propietario |
| POST          | `/api/admin/lodging-image-uploads` | Carga de imagen borrador de alojamiento  |
| POST / DELETE | `/api/auth/me/profile-image`       | Imagen de perfil del usuario actual      |
| GET           | `/docs`                            | Swagger UI                               |
| GET           | `/openapi.json`                    | Contrato OpenAPI vigente                 |

Las rutas GET también admiten HEAD sin body; el backend seleccionado resuelve CORS/preflight. JSON Schema y AJV validan las entradas de aplicación. Los métodos, rutas, schemas y requisitos Bearer completos están definidos en los [contratos compartidos](packages/contracts/src/routes.ts) y el documento OpenAPI generado. Las rutas de documentación se publican fuera del prefijo `/api`.

Media conserva multipart procesado en el backend: hasta 10 MiB por imagen de alojamiento y 5 MiB por imagen de perfil. El grupo media también gestiona alojamientos, asociación de borradores, selección de imágenes y limpieza. DELETE de disponibilidad conserva su body JSON. El catálogo público excluye datos de propietarios y keys internas de almacenamiento.

## Desarrollo local

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

Node 24.22.1 según `.nvmrc`, Python 3 para crear ZIP y `readelf` de binutils, en Linux. `check` verifica límites de paquetes, privacidad, lint, formato, tipos, pruebas, OpenAPI, bundles, síntesis CDK local y preparación de políticas de acceso. Los controles locales utilizan fixtures y proveedores simulados; `LOCAL_MONGOD` habilita pruebas de persistencia aisladas.

## Documentación

- [Desarrollo, configuración y contratos](DEVELOPMENT.es.md)
- [Entrega y recuperación](DEPLOYMENT.es.md)
