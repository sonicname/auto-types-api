/**
 * Builds an OpenAPI 3.1 document from the API files themselves, at runtime: every endpoint's
 * schemas become parameters, request bodies and responses.
 *
 * ```ts
 * // app/api/openapi.ts  →  GET /api/openapi
 * import { api } from 'auto-types-api';
 * import { createOpenApiDocument } from 'auto-types-api/openapi';
 *
 * const modules = import.meta.glob(['./**\/*.ts', '../modules/*\/api/**\/*.ts', '!./openapi.ts'], {
 *   eager: true,
 * });
 *
 * export const loader = api.serve({
 *   GET: api.get(() => createOpenApiDocument({ modules, from: 'api', info: { title: 'Shop', version: '1.0.0' } })),
 * });
 * ```
 *
 * Schemas are converted through Standard JSON Schema (`schema['~standard'].jsonSchema`, built
 * into Zod 4.2+, Valibot and ArkType adapters). Endpoints without a schema are listed without one.
 *
 * @packageDocumentation
 */
import type { AnySchema } from 'endpoint-kit';
import { isApiFile, resolveApiPaths, routeName } from './paths';
import type { ApiEndpoints, ApiMethod, EndpointConfig } from './server/types';

/** A JSON Schema object. */
export type JsonSchema = Record<string, unknown>;

/** The OpenAPI 3.1 document produced by {@link createOpenApiDocument}. */
export interface OpenApiDocument {
  openapi: '3.1.0';
  info: OpenApiInfo;
  servers?: { url: string; description?: string }[];
  paths: Record<string, Partial<Record<Lowercase<ApiMethod>, OpenApiOperation>>>;
}

export interface OpenApiInfo {
  title: string;
  version: string;
  description?: string;
}

export interface OpenApiParameter {
  name: string;
  in: 'path' | 'query' | 'header';
  required: boolean;
  schema: JsonSchema;
}

export interface OpenApiOperation {
  operationId: string;
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  parameters?: OpenApiParameter[];
  requestBody?: { required: boolean; content: Record<string, { schema: JsonSchema }> };
  responses: Record<
    string,
    { description: string; content?: Record<string, { schema: JsonSchema }> }
  >;
}

/** Options for {@link createOpenApiDocument}. */
export interface OpenApiOptions {
  /** API modules, typically `import.meta.glob([...], { eager: true })`. */
  modules: Record<string, unknown>;
  /**
   * Directory of the file calling `import.meta.glob`, relative to the app directory, so glob
   * keys can be resolved (`'api'` for `app/api/openapi.ts`). Defaults to the app directory.
   */
  from?: string;
  /** URL prefix the API routes are mounted under. Defaults to `/api`. */
  prefix?: string;
  info?: OpenApiInfo;
  servers?: OpenApiDocument['servers'];
  /** Called for schemas that cannot be converted to JSON Schema. */
  onWarning?: (message: string) => void;
}

const METHODS: readonly ApiMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const VALIDATION_ERROR: JsonSchema = {
  type: 'object',
  properties: {
    error: { const: 'ValidationError' },
    target: { type: 'string' },
    issues: { type: 'array', items: { type: 'object' } },
  },
  required: ['error', 'target', 'issues'],
};

const BODY_MEDIA = {
  json: 'application/json',
  multipart: 'multipart/form-data',
  form: 'application/x-www-form-urlencoded',
} as const;

/** Builds an OpenAPI 3.1 document from the endpoints served by API modules. */
export function createOpenApiDocument(options: OpenApiOptions): OpenApiDocument {
  const prefix = options.prefix ?? '/api';
  const warn = options.onWarning ?? (() => undefined);
  const byFile = new Map<string, ApiEndpoints>();
  for (const [key, module] of Object.entries(options.modules)) {
    const file = joinPath(options.from ?? '', key);
    const endpoints = servedEndpoints(module);
    if (isApiFile(file) && endpoints) byFile.set(file, endpoints);
  }

  const paths: OpenApiDocument['paths'] = {};
  for (const { file, path } of resolveApiPaths([...byFile.keys()], prefix)) {
    const endpoints = byFile.get(file) ?? {};
    const item: OpenApiDocument['paths'][string] = {};
    for (const method of METHODS) {
      const endpoint = endpoints[method];
      if (!endpoint) continue;
      const where = `${method} ${path}`;
      item[method.toLowerCase() as Lowercase<ApiMethod>] = operation(
        routeName(method, path, prefix),
        path,
        endpoint.config,
        (schema, io) =>
          toJsonSchema(schema, io, (message) => {
            warn(`${where}: ${message}`);
          }),
      );
    }
    paths[toOpenApiPath(path)] = item;
  }

  return {
    openapi: '3.1.0',
    info: options.info ?? { title: 'API', version: '1.0.0' },
    ...(options.servers ? { servers: options.servers } : {}),
    paths,
  };
}

type Convert = (schema: AnySchema | undefined, io: 'input' | 'output') => JsonSchema | undefined;

function operation(
  operationId: string,
  path: string,
  config: EndpointConfig,
  convert: Convert,
): OpenApiOperation {
  const parameters: OpenApiParameter[] = [];
  const pathSchema = convert(config.params, 'input');
  for (const name of pathParams(path)) {
    parameters.push({
      name,
      in: 'path',
      required: true,
      schema: propertySchema(pathSchema, name) ?? { type: 'string' },
    });
  }
  parameters.push(...objectParameters(convert(config.query, 'input'), 'query'));
  parameters.push(...objectParameters(convert(config.headers, 'input'), 'header'));

  const responses: OpenApiOperation['responses'] = { 200: success(config, convert) };
  if (config.params ?? config.query ?? config.body ?? config.headers) {
    responses[400] = {
      description: 'Invalid input',
      content: { 'application/json': { schema: VALIDATION_ERROR } },
    };
  }
  for (const [status, schema] of Object.entries(config.errors ?? {})) {
    const converted = convert(schema, 'output');
    responses[status] = {
      description: `Error ${status}`,
      ...(converted ? { content: { 'application/json': { schema: converted } } } : {}),
    };
  }

  const body = config.body && convert(config.body, 'input');
  return {
    operationId,
    ...(config.summary ? { summary: config.summary } : {}),
    ...(config.description ? { description: config.description } : {}),
    ...(config.tags ? { tags: [...config.tags] } : {}),
    ...(config.deprecated ? { deprecated: true } : {}),
    ...(parameters.length ? { parameters } : {}),
    ...(config.body
      ? {
          requestBody: {
            required: true,
            content: { [BODY_MEDIA[config.bodyType ?? 'json']]: { schema: body ?? {} } },
          },
        }
      : {}),
    responses,
  };
}

function success(config: EndpointConfig, convert: Convert): OpenApiOperation['responses'][string] {
  const schema = convert(config.response, 'output');
  switch (config.responseType) {
    case 'text':
      return { description: 'OK', content: { 'text/plain': { schema: { type: 'string' } } } };
    case 'sse':
      return {
        description: 'Server-sent events; each event carries JSON data matching the schema',
        content: { 'text/event-stream': { schema: schema ?? {} } },
      };
    default:
      return schema
        ? { description: 'OK', content: { 'application/json': { schema } } }
        : { description: 'OK (type inferred from the handler, no schema)' };
  }
}

function servedEndpoints(module: unknown): ApiEndpoints | undefined {
  if (typeof module !== 'object' || module === null) return undefined;
  const { loader, action } = module as { loader?: unknown; action?: unknown };
  for (const handler of [loader, action]) {
    if (typeof handler === 'function' && '~endpoints' in handler) {
      return (handler as { '~endpoints': ApiEndpoints })['~endpoints'];
    }
  }
  return undefined;
}

function toJsonSchema(
  schema: AnySchema | undefined,
  io: 'input' | 'output',
  warn: (message: string) => void,
): JsonSchema | undefined {
  if (!schema) return undefined;
  const converter = (
    schema['~standard'] as {
      jsonSchema?: Record<'input' | 'output', (options: { target: string }) => JsonSchema>;
    }
  ).jsonSchema;
  if (!converter) {
    warn(`schema from "${schema['~standard'].vendor}" has no JSON Schema support`);
    return undefined;
  }
  try {
    const { $schema: _ignored, ...rest } = converter[io]({ target: 'draft-2020-12' });
    return rest;
  } catch (error) {
    warn(error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

function objectParameters(
  schema: JsonSchema | undefined,
  location: 'query' | 'header',
): OpenApiParameter[] {
  const properties = schema?.['properties'] as Record<string, JsonSchema> | undefined;
  const required = new Set((schema?.['required'] as string[] | undefined) ?? []);
  return Object.entries(properties ?? {}).map(([name, property]) => ({
    name,
    in: location,
    required: required.has(name),
    schema: property,
  }));
}

function propertySchema(schema: JsonSchema | undefined, name: string): JsonSchema | undefined {
  return (schema?.['properties'] as Record<string, JsonSchema> | undefined)?.[name];
}

function pathParams(path: string): string[] {
  return path
    .split('/')
    .filter((segment) => segment.startsWith(':') || segment === '*')
    .map((segment) => (segment === '*' ? 'wildcard' : segment.slice(1)));
}

/** `/users/:id/*` → `/users/{id}/{wildcard}`. */
function toOpenApiPath(path: string): string {
  return path
    .split('/')
    .map((segment) =>
      segment === '*' ? '{wildcard}' : segment.startsWith(':') ? `{${segment.slice(1)}}` : segment,
    )
    .join('/');
}

/** Resolves a glob key (`./x.ts`, `../modules/...`) against `base`, POSIX style. */
function joinPath(base: string, key: string): string {
  const parts = base.split('/').filter(Boolean);
  for (const part of key.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}
