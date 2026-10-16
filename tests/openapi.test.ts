import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { api } from '../src';
import { createOpenApiDocument } from '../src/openapi';
import * as health from './fixtures/app/api/health';
import * as version from './fixtures/app/api/version';
import * as events from './fixtures/app/modules/shop/api/events';
import * as legacy from './fixtures/app/modules/shop/api/legacy';
import * as products from './fixtures/app/modules/shop/api/products';
import * as productById from './fixtures/app/modules/shop/api/products.$id';
import * as upload from './fixtures/app/modules/shop/api/upload';

// Keys as `import.meta.glob` returns them from the app directory.
const modules = {
  './api/health.ts': health,
  './api/version.ts': version,
  './modules/shop/api/events.ts': events,
  './modules/shop/api/legacy.ts': legacy,
  './modules/shop/api/products.ts': products,
  './modules/shop/api/products.$id.ts': productById,
  './modules/shop/api/upload.ts': upload,
  './routes.ts': { default: {} },
  './api/empty.ts': null,
};

describe('createOpenApiDocument', () => {
  const doc = createOpenApiDocument({
    modules,
    info: { title: 'Shop', version: '2.0.0' },
    servers: [{ url: 'https://shop.test' }],
  });

  it('lists every served endpoint under its URL', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info).toEqual({ title: 'Shop', version: '2.0.0' });
    expect(doc.servers).toEqual([{ url: 'https://shop.test' }]);
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/api/health',
      '/api/shop/events',
      '/api/shop/products',
      '/api/shop/products/{id}',
      '/api/shop/upload',
      '/api/version',
    ]);
  });

  it('documents query params, bodies, responses and declared errors', () => {
    expect(doc.paths['/api/shop/products']?.get).toMatchObject({
      operationId: 'getShopProducts',
      tags: ['products'],
      parameters: [
        { name: 'q', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'limit', in: 'query', required: false },
      ],
      responses: { 200: { description: expect.stringContaining('inferred') }, 400: {} },
    });
    expect(doc.paths['/api/shop/products']?.post).toMatchObject({
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { required: ['name', 'price'] } } },
      },
      responses: {
        200: { content: { 'application/json': { schema: { type: 'object' } } } },
        409: { content: { 'application/json': { schema: { required: ['message'] } } } },
      },
    });
  });

  it('documents path params, text, events and multipart bodies', () => {
    expect(doc.paths['/api/shop/products/{id}']?.delete?.parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'number' } },
    ]);
    expect(doc.paths['/api/shop/products/{id}']?.get?.parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ]);
    expect(doc.paths['/api/version']?.get).toMatchObject({
      summary: 'API version',
      responses: { 200: { content: { 'text/plain': { schema: { type: 'string' } } } } },
    });
    expect(doc.paths['/api/shop/events']?.get?.responses[200]).toMatchObject({
      content: { 'text/event-stream': { schema: { type: 'object' } } },
    });
    expect(doc.paths['/api/shop/upload']?.post?.requestBody?.content).toHaveProperty([
      'multipart/form-data',
    ]);
  });

  it('resolves glob keys from a nested file and warns about unconvertible schemas', () => {
    const onWarning = vi.fn();
    const noJsonSchema = {
      '~standard': {
        version: 1 as const,
        vendor: 'custom',
        validate: (value: unknown) => ({ value }),
      },
    };
    const odd = api.serve({
      GET: api.get(
        {
          response: z.object({ at: z.date() }),
          query: noJsonSchema,
          description: 'Old',
          deprecated: true,
        },
        () => ({ at: new Date() }),
      ),
      PUT: api.put({ body: noJsonSchema }, () => null),
    });
    const nested = createOpenApiDocument({
      modules: { '../modules/shop/api/odd.$.ts': { action: odd }, './self.ts': {} },
      from: 'api',
      prefix: '/rest/',
      onWarning,
    });
    expect(nested.info).toEqual({ title: 'API', version: '1.0.0' });
    expect(nested.paths['/rest/shop/odd/{wildcard}']?.get).toMatchObject({
      operationId: 'getShopOddAll',
      description: 'Old',
      deprecated: true,
      parameters: [{ name: 'wildcard', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: { description: expect.stringContaining('inferred') } },
    });
    expect(nested.paths['/rest/shop/odd/{wildcard}']?.put?.requestBody).toEqual({
      required: true,
      content: { 'application/json': { schema: {} } },
    });
    expect(onWarning).toHaveBeenCalledWith(
      'GET /rest/shop/odd/*: schema from "custom" has no JSON Schema support',
    );
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('Date cannot be represented'));
    expect(() =>
      createOpenApiDocument({ modules: { './api/x.ts': { loader: odd } } }),
    ).not.toThrow();
  });
});
