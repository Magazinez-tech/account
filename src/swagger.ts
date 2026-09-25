import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

const DESCRIPTION = `Multi-tenant double-entry accounting API.

**Auth:** sign up with \`POST /api/v1/tenants\` or sign in with \`POST /api/v1/auth/login\`, then click
**Authorize** and paste the \`accessToken\`. Every request is scoped to the token's tenant (PostgreSQL RLS).

**Money** is sent and returned in baht as numbers with up to 2 decimals; the server sums in satang.

**Errors** use Nest's shape \`{ statusCode, message, error }\`; validation errors return \`message\` as an array.
402 means the subscription is inactive (trial over or unpaid): reads work, writes are refused except billing.`;

/** Builds the OpenAPI document from the controllers, DTOs (via the Nest CLI swagger plugin) and JSDoc. */
export function buildOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Accounting SaaS API')
    .setDescription(DESCRIPTION)
    .setVersion('v1')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'accessToken from /auth/login or signup' })
    .build();
  return SwaggerModule.createDocument(app, config);
}

/** On by default outside production; SWAGGER_ENABLED=true|false overrides either way. */
export function swaggerEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.SWAGGER_ENABLED ? env.SWAGGER_ENABLED === 'true' : env.NODE_ENV !== 'production';
}

/** Swagger UI at /api/docs, raw OpenAPI JSON at /api/docs-json. */
export function setupSwagger(app: INestApplication, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!swaggerEnabled(env)) return false;

  SwaggerModule.setup('api/docs', app, () => buildOpenApiDocument(app), {
    jsonDocumentUrl: 'api/docs-json',
    customSiteTitle: 'Accounting SaaS API',
    swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha', operationsSorter: 'method' },
  });
  return true;
}
