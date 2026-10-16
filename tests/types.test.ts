import type { RouteErrors, RouteInput, RouteOutput } from 'endpoint-kit';
import type { ActionFunction, LoaderFunction } from 'react-router';
import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { api, createApi } from '../src';
import type { ApiContext, Jsonify } from '../src';
import { clientOptions } from '../src/client';
import type { EndpointError } from '../src/client';
import type { routes } from './fixtures/app/api.gen';
import type * as productById from './fixtures/app/modules/shop/api/products.$id';
import type * as products from './fixtures/app/modules/shop/api/products';
import type { Product } from './fixtures/app/modules/shop/schemas';

type R = typeof routes;

describe('generated routes', () => {
  it('types responses as they arrive over JSON', () => {
    expectTypeOf<RouteOutput<R['getHealth']>>().toEqualTypeOf<{ ok: true; startedAt: string }>();
    expectTypeOf<RouteOutput<R['getShopProducts']>>().toEqualTypeOf<Product[]>();
    expectTypeOf<RouteOutput<R['postShopProducts']>>().toEqualTypeOf<Product>();
    expectTypeOf<RouteOutput<R['deleteShopProductsById']>>().toEqualTypeOf<{
      deletedBy: 'admin';
    }>();
  });

  it('types text and server-sent event responses', () => {
    expectTypeOf<RouteOutput<R['getVersion']>>().toEqualTypeOf<string>();
    expectTypeOf<RouteOutput<R['getShopEvents']>>().toEqualTypeOf<AsyncIterable<{ n: number }>>();
  });

  it('types query, body, params and multipart bodies from the schemas', () => {
    expectTypeOf<RouteInput<R['getShopProducts']>['query']>().toEqualTypeOf<
      { q?: string | undefined; limit?: number | undefined } | undefined
    >();
    expectTypeOf<RouteInput<R['postShopProducts']>['body']>().toEqualTypeOf<{
      name: string;
      price: number;
    }>();
    expectTypeOf<RouteInput<R['deleteShopProductsById']>['params']>().toEqualTypeOf<{
      id: string | number;
    }>();
    expectTypeOf<RouteInput<R['postShopUpload']>['body']>().toEqualTypeOf<{
      file: File;
      note: string;
    }>();
  });

  it('types declared errors', () => {
    expectTypeOf<RouteErrors<R['getShopProductsById']>>().toEqualTypeOf<
      EndpointError<404, { message: string }>
    >();
    expectTypeOf<RouteErrors<R['postShopProducts']>>().toEqualTypeOf<
      EndpointError<409, { message: string }>
    >();
    expectTypeOf<RouteErrors<R['getHealth']>>().toBeNever();
  });

  it('falls back to path params when the endpoint has no params schema', () => {
    expectTypeOf<RouteInput<R['getShopProductsById']>['params']>().toEqualTypeOf<{
      id: string | number;
    }>();
    expectTypeOf<RouteInput<R['getHealth']>>().not.toHaveProperty('params');
    expectTypeOf<RouteInput<R['getHealth']>>().not.toHaveProperty('body');
  });
});

describe('clientOptions', () => {
  it('rejects methods the file does not serve', () => {
    // @ts-expect-error products.$id.ts serves GET and DELETE only
    clientOptions<typeof productById.loader, 'PUT'>();
  });

  it('requires options matching the wire format', () => {
    // @ts-expect-error the endpoint declares errors: { 409 }
    clientOptions<typeof products.loader, 'POST'>();
    // @ts-expect-error 404 is not declared
    clientOptions<typeof products.loader, 'POST'>({ errors: [404] });
    // @ts-expect-error GET is plain JSON
    clientOptions<typeof products.loader, 'GET'>({ responseType: 'sse' });
    clientOptions<typeof products.loader, 'POST'>({ errors: [409] });
  });
});

describe('server side', () => {
  it('produces a React Router loader and action', () => {
    expectTypeOf<typeof productById.loader>().toExtend<LoaderFunction>();
    expectTypeOf<typeof productById.action>().toExtend<ActionFunction>();
  });

  it('types the handler context', () => {
    const typed = createApi<{ params: { id: string }; context: { user: string } }>().use(() => ({
      role: 'admin' as const,
    }));
    typed.post(
      {
        query: z.object({ page: z.number() }),
        body: z.object({ name: z.string() }),
        errors: { 404: z.object({ message: z.string() }) },
      },
      (ctx) => {
        expectTypeOf(ctx.params).toEqualTypeOf<{ id: string }>();
        expectTypeOf(ctx.context).toEqualTypeOf<{ user: string }>();
        expectTypeOf(ctx.role).toEqualTypeOf<'admin'>();
        expectTypeOf(ctx.query).toEqualTypeOf<{ page: number }>();
        expectTypeOf(ctx.body).toEqualTypeOf<{ name: string }>();
        expectTypeOf(ctx.headers).toEqualTypeOf<Headers>();
        // @ts-expect-error 500 is not declared
        ctx.error(500, { message: 'x' });
        // @ts-expect-error wrong body for 404
        ctx.error(404, { reason: 'x' });
        return ctx.error(404, { message: 'missing' });
      },
    );
  });

  it('checks handler returns against the response schema', () => {
    api.get({ response: z.object({ a: z.string() }) }, () => ({ a: 'x' }));
    // @ts-expect-error a must be a string
    api.get({ response: z.object({ a: z.string() }) }, () => ({ a: 1 }));
    api.get({ response: z.number(), responseType: 'sse' }, async function* () {
      yield 1;
    });
  });

  it('defaults to React Router params and unknown context', () => {
    api.get((ctx: ApiContext) => {
      expectTypeOf(ctx.params).toEqualTypeOf<Record<string, string | undefined>>();
      expectTypeOf(ctx.context).toEqualTypeOf<unknown>();
    });
  });
});

describe('Jsonify', () => {
  it('converts what JSON converts', () => {
    expectTypeOf<
      Jsonify<{ at: Date; f: () => void; u: undefined; o?: number; list: (Date | undefined)[] }>
    >().toEqualTypeOf<{ at: string; o?: number; list: (string | null)[] }>();
    expectTypeOf<Jsonify<unknown>>().toEqualTypeOf<unknown>();
    expectTypeOf<Jsonify<[1, Date]>>().toEqualTypeOf<[1, string]>();
  });
});
