import { createRepository, fetchAdapter } from 'endpoint-kit';
import { describe, expect, it } from 'vitest';
import { EndpointError } from '../src/client';
import type { LocalFetchOptions } from '../src';
import { routes } from './fixtures/app/api.gen';
import { localFetch } from './fixtures/app/api.gen.server';

/** The generated client, calling the fixture's API handlers in-process. */
const clientFor = (options: LocalFetchOptions = {}) =>
  createRepository({ baseUrl: '', adapter: fetchAdapter({ fetch: localFetch(options) }) })
    .mergeAll(routes)
    .build();

const client = clientFor({ context: { tenant: 'acme' } });

describe('generated client → API files', () => {
  it('returns JSON as JSON: dates arrive as strings', async () => {
    expect(await client.getHealth.orThrow()).toEqual({
      ok: true,
      startedAt: '1970-01-01T00:00:00.000Z',
    });
  });

  it('returns text responses', async () => {
    expect(await client.getVersion.orThrow()).toBe('1.0.0');
  });

  it('streams server-sent events as parsed JSON', async () => {
    const events = await client.getShopEvents.orThrow({ query: { count: 3 } });
    const received: { n: number }[] = [];
    for await (const event of events) received.push(event);
    expect(received).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it('sends query params, coerced on the server', async () => {
    const list = await client.getShopProducts.orThrow({ query: { q: 'Wid', limit: 1 } });
    expect(list).toEqual([{ id: 1, name: 'Widget', price: 9.99 }]);
  });

  it('creates and reports declared errors with their status and body', async () => {
    const created = await client.postShopProducts.orThrow({ body: { name: 'Gadget', price: 5 } });
    expect(created).toEqual({ id: 2, name: 'Gadget', price: 5 });

    const duplicate = await client.postShopProducts({ body: { name: 'Gadget', price: 5 } });
    expect(duplicate.error).toBeInstanceOf(EndpointError);
    expect(duplicate.error).toMatchObject({ status: 409, data: { message: 'Name taken' } });
  });

  it('passes React Router context and typed params to handlers', async () => {
    expect(await client.getShopProductsById.orThrow({ params: { id: 2 } })).toMatchObject({
      name: 'Gadget',
    });
    const missing = await client.getShopProductsById({ params: { id: 99 } });
    expect(missing.error).toMatchObject({
      _tag: 'EndpointError',
      status: 404,
      data: { message: 'No product 99 in acme' },
    });
  });

  it('runs middlewares and forwards headers from the incoming request', async () => {
    const denied = await client.deleteShopProductsById({ params: { id: 2 } });
    expect(denied.error).toMatchObject({ _tag: 'ApiError', status: 403 });

    const admin = clientFor({
      request: new Request('http://app.test/page', { headers: { 'x-admin': '1' } }),
      forwardHeaders: ['x-admin'],
    });
    expect(await admin.deleteShopProductsById.orThrow({ params: { id: 2 } })).toEqual({
      deletedBy: 'admin',
    });
  });

  it('uploads multipart bodies', async () => {
    const file = new File(['hello'], 'hello.txt');
    expect(await client.postShopUpload.orThrow({ body: { file, note: 'hi' } })).toEqual({
      name: 'hello.txt',
      size: 5,
      note: 'hi',
    });
  });

  it('rejects invalid input on the server', async () => {
    const result = await client.postShopProducts({
      body: { name: 'Bad', price: 'free' as unknown as number },
    });
    expect(result.error).toMatchObject({
      _tag: 'ApiError',
      status: 400,
      data: { error: 'ValidationError', target: 'body' },
    });
  });

  it('answers unknown routes with 404', async () => {
    const response = await localFetch()('/api/nope');
    expect(response.status).toBe(404);
    const viaRequest = await localFetch()(
      new Request('http://app.test/api/health', { method: 'HEAD' }),
    );
    expect(viaRequest.status).toBe(200);
  });
});
