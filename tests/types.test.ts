import type { RouteInput, RouteOutput } from 'endpoint-kit';
import type { ActionFunction, LoaderFunction } from 'react-router';
import { describe, expectTypeOf, it } from 'vitest';
import { clientOptions } from '../src/client';
import type { routes } from './fixtures/app/api.gen';
import type * as productById from './fixtures/app/modules/shop/api/products.$id';
import type { Product } from './fixtures/app/modules/shop/schemas';

type R = typeof routes;

describe('generated routes', () => {
  it('infers the response from the handler when there is no response schema', () => {
    expectTypeOf<RouteOutput<R['getHealth']>>().toEqualTypeOf<{ ok: true; uptime: number }>();
    expectTypeOf<RouteOutput<R['getShopProducts']>>().toEqualTypeOf<Product[]>();
  });

  it('uses the response schema output, dropping reply() branches', () => {
    expectTypeOf<RouteOutput<R['postShopProducts']>>().toEqualTypeOf<Product>();
    expectTypeOf<RouteOutput<R['getShopProductsById']>>().toEqualTypeOf<Product>();
    expectTypeOf<RouteOutput<R['deleteShopProductsById']>>().toEqualTypeOf<unknown>();
  });

  it('types query, body, params and headers from the schemas', () => {
    expectTypeOf<RouteInput<R['getShopProducts']>['query']>().toEqualTypeOf<
      { q?: string | undefined; limit?: number | undefined } | undefined
    >();
    expectTypeOf<RouteInput<R['postShopProducts']>['body']>().toEqualTypeOf<{
      name: string;
      price: number;
    }>();
    expectTypeOf<RouteInput<R['getShopProductsById']>['params']>().toEqualTypeOf<{
      id: string | number;
    }>();
    expectTypeOf<RouteInput<R['deleteShopProductsById']>['headers']>().toEqualTypeOf<{
      'x-admin': '1';
    }>();
  });

  it('leaves out inputs an endpoint does not declare', () => {
    expectTypeOf<RouteInput<R['getHealth']>>().not.toHaveProperty('params');
    expectTypeOf<RouteInput<R['getHealth']>>().not.toHaveProperty('body');
  });
});

describe('server side', () => {
  it('produces a React Router loader and action', () => {
    expectTypeOf<typeof productById.loader>().toExtend<LoaderFunction>();
    expectTypeOf<typeof productById.action>().toExtend<ActionFunction>();
  });

  it('rejects methods the file does not serve', () => {
    // @ts-expect-error products.$id.ts serves GET and DELETE only
    clientOptions<typeof productById.loader, 'PUT'>();
  });
});
