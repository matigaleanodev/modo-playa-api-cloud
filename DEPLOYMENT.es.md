# Entrega y recuperación

[English](DEPLOYMENT.md)

Fundación y aplicación son stacks CDK separados. Synth requiere Node de `.nvmrc` y ZIP locales; no lee valores secretos ni hace lookups. La API original y los datos Mongo/R2 permanecen independientes de la entrega de infraestructura.

## Preparación local

```sh
npm run check
npm run prepare:access
```

`check` incluye synth aislado de aplicación/fundación y revisión de assembly. `prepare:access` genera `dist/delivery-access.json` ignorado para revisar el ceiling externo, las identidades de fundación y la de sincronización de parámetros; no instala policies. Usar `npm run prepare:access -- API_ID DISTRIBUTION_ID OAC_ID` (o `--regional-bootstrap --cloudfront-bootstrap` explícitos para preparación inicial) para acotar API, distribución y OAC después de crearlos. Los permisos iniciales de bootstrap son temporales y requieren revisión específica. El executor de fundación no puede editar su ceiling, proveedor OIDC ni identidades de fundación.

Para preparar una assembly, definir `DEPLOYMENT_BUCKET`, los roles exactos `HEALTH_ROLE_ARN`, `IDENTITY_ROLE_ARN`, `CATALOG_ROLE_ARN`, `MANAGEMENT_ROLE_ARN`, `MEDIA_ROLE_ARN` y la configuración pública de [DEVELOPMENT](DEVELOPMENT.es.md); ejecutar `npm run build` y `npm run synth`. `scripts/review-package.mjs` revisa rutas, orígenes, referencias y assets. `review_bundle.py` conserva manifest, metadata referenciada, templates, ZIP, lockfile y revisión con checksums; rechaza privados, symlinks, escapes y bytes alterados/faltantes.

## Workflows manuales

CI mantiene el nombre estable `CI`; entrega exige un run CI push aprobado del SHA completo `reviewed_sha` exacto de `dev` en este repositorio. Package no tiene OIDC ni permisos de ejecución AWS.

- `build-and-deploy.yml`: `deploy=false` por defecto; los jobs AWS también exigen la variable de repositorio `DELIVERY_ENABLED=true`, `DEPLOYMENT_APPROVED_SHA` coincidente, `NETWORK_REVIEWED=true` y `RECOVERY_REVIEWED=true` en environment `candidate`. Definir `PREPARE_ROLE_ARN`, `CLOUDFORMATION_ROLE_ARN` y las referencias no sensibles de synth como variables del repositorio; aprobación y flags de revisión pertenecen a `candidate`. Prepare publica la assembly revisada y crea changeset; execute revalida template, bytes ZIP y recibo vivo con un rol separado, sin rebuild ni synth.
- `foundation.yml`: `apply=false` por defecto; el job AWS también exige la variable de repositorio `FOUNDATION_ENABLED=true` y `FOUNDATION_APPROVED_SHA` coincidente en environment `foundation`. Package sintetiza sin OIDC y entrega el mismo template por artifact ID/checksum. El executor revisa destino, template y cambios no destructivos antes de ejecutar. Los inputs contienen IDs observados de API/distribución/OAC y flags explícitos de bootstrap temporal.

Los gates de jobs deben ser variables de repositorio: las variables de environment están disponibles recién al iniciar el job ([alcance en GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/variables#configuration-variable-precedence)).

Environments remotos, proveedor OIDC, identidades de fundación, ceilings, valores secretos y variables se instalan únicamente mediante administración explícitamente autorizada. Publicar workflows no autoriza esas acciones.

`DISTRIBUTION_ENABLED=false` por defecto. Habilitar candidata exige `CANDIDATE_IPS`, lista de IPs exactas separadas por coma que una CloudFront Function verifica mediante `event.viewer.ip`. Modo público exige además `PUBLIC_ACCESS_ENABLED=true`, `PUBLIC_DOMAIN_NAME` y `PUBLIC_CERTIFICATE_ARN` existente compatible en us-east-1; este stack no solicita certificados ni cambia DNS. Los nombres prod de secretos no habilitan tráfico ni efectos.

## Parámetros de runtime

Los GitHub Actions Secrets del environment `parameters` son la única fuente: `APP_MONGO_URI` (escritura), `JWT_SECRET_KEY`, `CATALOG_MONGO_URI` (pensada para solo lectura; hoy puede coincidir con la de escritura), `RESEND_API_KEY`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` y `ORIGIN_VERIFY_TOKEN` (mínimo 32 caracteres). Los parámetros no se editan en la consola.

[sync-parameters.yml](.github/workflows/sync-parameters.yml) corre solo por `workflow_dispatch` desde `dev`, con `PARAMETERS_SYNC_ENABLED=true` como variable de repositorio. El input `domain` elige `app-properties`, `database`, `email`, `object-storage`, `ingress` o `all`; los demás parámetros no se tocan. Valida y arma todos los JSON antes de autenticarse, verifica cuenta, región, rama y rol, y publica con `--overwrite` sin leer valores. El resumen muestra solo nombres y versiones. El rol `modo-playa-candidate-parameters` es una identidad externa generada por `prepare:access` con boundary propio: solo `ssm:PutParameter` sobre los cinco parámetros y `kms:Encrypt`/`GenerateDataKey` vía SSM con su contexto.

Para cargar o rotar un valor desde VS Code: en la extensión GitHub Actions abrir **Settings → Environments → parameters → Secrets** y crear o reemplazar el secret, o desde la terminal integrada `gh secret set NOMBRE --env parameters` (lee el valor por entrada estándar). Luego ejecutar **Sync runtime parameters** en `dev` desde la vista Workflows o con `gh workflow run sync-parameters.yml --ref dev -f domain=email`, aprobar el environment y revisar las versiones en el resumen. Si cambió `MONGO_URI`, incrementar `CONFIGURATION_GENERATION` y entregar una revisión antes de revocar la credencial anterior. Si cambió el ingreso, el runtime lo toma en hasta 5 minutos y CloudFront en la siguiente entrega: hay un intervalo de 403 entre ambos, así que conviene sincronizar y entregar seguidos.

Al preparar el changeset, `build-and-deploy.yml` lee `/modo-playa/prod/ingress` con el rol de preparación, enmascara el token y lo pasa como `OriginVerifyToken`; el revisor solo acepta ese parámetro y con su valor oculto.

## Recuperación

Leer estado/eventos reales de CloudFormation antes de reintentar. `CREATE_COMPLETE`, `UPDATE_COMPLETE` y `UPDATE_ROLLBACK_COMPLETE` admiten actualización revisada; `REVIEW_IN_PROGRESS` sólo sin recursos efectivos. Recrear `ROLLBACK_COMPLETE` exige `recover_empty_stack` explícito y confirmar que todos los recursos fueron borrados. Estados en curso o rollback fallido requieren una decisión específica; no reintentar ciegamente ni ampliar IAM tras AccessDenied.

Las revisiones Web son inmutables y se conservan. Cambios de código/configuración crean revisión identificada por digest y mueven el mismo endpoint con peso 100. El revisor de changesets admite sólo el ciclo conocido de revisiones retenidas; rechaza reemplazos de función, endpoint, roles o distribución, remociones ajenas y Conditional no demostrado. Las revisiones retenidas siguen disponibles en Lambda cuando CloudFormation deja de administrarlas; la recuperación selecciona una revisión conocida mediante otra entrega revisada de revisión/ingreso. Registrar su ID y configuración antes de habilitar tráfico.

Recuperar conjuntamente revisión e ingreso cloud. Conservar Mongo, hashes, drafts, keys y objetos R2 confirmados; no restaurar sobre base activa ni repetir escrituras inciertas. Detener nuevas mutaciones mientras se diagnostican fallas persistentes. Apagado EC2 y corte de tráfico necesitan autorización propia.

`GET /docs` (también `/docs/`) sirve Swagger UI y `GET /openapi.json` sirve el contrato generado mediante el origen protegido health/JSON. Ambas rutas están fuera de `/api`, con HEAD y OPTIONS; no requieren un recurso separado de hosting documental. La validación administrada debe acreditar OAC/Bearer, rechazo directo, máximos multipart, binarios nativos, cuotas de timeout y conectividad real antes del acceso público.
