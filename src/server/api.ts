import { serve } from './serve';
import type {
  Api,
  ApiEndpoint,
  ApiMethod,
  ArgsLike,
  EndpointConfig,
  EndpointFactory,
  Middleware,
  RouterArgs,
} from './types';

type AnyMiddleware = Middleware<ArgsLike>;

function factory<M extends ApiMethod>(
  method: M,
  middlewares: readonly AnyMiddleware[],
): EndpointFactory<M> {
  return ((
    configOrHandler: EndpointConfig | ApiEndpoint['handler'],
    handler?: ApiEndpoint['handler'],
  ): ApiEndpoint => {
    if (typeof configOrHandler === 'function') {
      return { method, config: {}, middlewares, handler: configOrHandler };
    }
    if (!handler) throw new TypeError(`api.${method.toLowerCase()}(): missing handler`);
    return { method, config: configOrHandler, middlewares, handler };
  }) as EndpointFactory<M>;
}

function build(middlewares: readonly AnyMiddleware[]): Api {
  return {
    get: factory('GET', middlewares),
    post: factory('POST', middlewares),
    put: factory('PUT', middlewares),
    patch: factory('PATCH', middlewares),
    delete: factory('DELETE', middlewares),
    use: (middleware) => build([...middlewares, middleware as AnyMiddleware]),
    serve,
  } as Api;
}

/**
 * Creates an `api` whose handlers get `ctx.params` and `ctx.context` typed from `TArgs`,
 * usually React Router's generated `Route.LoaderArgs` for the file.
 *
 * @example
 * ```ts
 * import type { Route } from './+types/products.$id';
 * const api = createApi<Route.LoaderArgs>();
 * const GET = api.get(({ params }) => db.products.find(params.id)); // params.id: string
 * ```
 */
export function createApi<TArgs extends ArgsLike = RouterArgs>(): Api<TArgs> {
  return build([]) as unknown as Api<TArgs>;
}

/**
 * Declares typed endpoints inside a modules-page-routing API file.
 *
 * Keep the endpoints unexported and serve them as the route's `loader` and `action`: React
 * Router strips both from client bundles, along with everything only they reference.
 *
 * @example
 * ```ts
 * // app/modules/shop/api/products.$id.ts
 * import { api } from 'auto-types-api';
 * import { z } from 'zod';
 *
 * const GET = api.get({ response: Product }, ({ params }) => db.products.find(params.id));
 * const PATCH = api.patch(
 *   { body: z.object({ name: z.string() }), response: Product },
 *   ({ params, body }) => db.products.update(params.id, body),
 * );
 *
 * export const loader = api.serve({ GET, PATCH });
 * export const action = loader;
 * ```
 */
export const api: Api = createApi();
