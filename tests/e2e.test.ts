import { createRepository, fetchAdapter } from 'endpoint-kit';
import { matchRoute } from 'endpoint-kit/server';
import { describe, expect, it } from 'vitest';
import type { RouterHandler } from '../src';
import { routes } from './fixtures/app/api.gen';
import * as health from './fixtures/app/api/health';
import * as products from './fixtures/app/modules/shop/api/products';
import * as productById from './fixtures/app/modules/shop/api/products.$id';

const modules: Record<string, { loader: RouterHandler }> = {
  getHealth: health,
  getShopProducts: products,
  postShopProducts: products,
  getShopProductsById: productById,
  deleteShopProductsById: productById,
};

/** Stands in for React Router: match the URL, then call the module's served handler. */
const router: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const match = matchRoute(routes, request.method, new URL(request.url).pathname);
  if (!match) return new Response(null, { status: 404 });
  return modules[match.name]!.loader({ request, params: match.params, context: {} });
};

const client = createRepository({
  baseUrl: 'http://app.test',
  adapter: fetchAdapter({ fetch: router }),
})
  .mergeAll(routes)
  .build();

describe('endpoint-kit client → React Router API files', () => {
  it('calls a handler-only endpoint', async () => {
    expect(await client.getHealth.orThrow()).toEqual({ ok: true, uptime: 1 });
  });

  it('sends query params, coerced on the server', async () => {
    const list = await client.getShopProducts.orThrow({ query: { q: 'Wid', limit: 1 } });
    expect(list).toEqual([{ id: 1, name: 'Widget', price: 9.99 }]);
  });

  it('creates, reads and deletes', async () => {
    const created = await client.postShopProducts.orThrow({ body: { name: 'Gadget', price: 5 } });
    expect(created).toEqual({ id: 2, name: 'Gadget', price: 5 });

    const found = await client.getShopProductsById.orThrow({ params: { id: created.id } });
    expect(found.name).toBe('Gadget');

    const removed = await client.deleteShopProductsById({
      params: { id: 2 },
      headers: { 'x-admin': '1' },
    });
    expect(removed.ok).toBe(true);

    const missing = await client.getShopProductsById({ params: { id: 2 } });
    expect(missing.ok).toBe(false);
    expect(missing.error).toMatchObject({ status: 404 });
  });

  it('rejects invalid input on the server', async () => {
    const result = await client.postShopProducts({
      body: { name: 'Bad', price: 'free' as unknown as number },
    });
    expect(result.error).toMatchObject({
      status: 400,
      data: { error: 'ValidationError', target: 'body' },
    });
  });
});
