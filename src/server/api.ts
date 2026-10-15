import { serve } from './serve';
import type { ApiContext, ApiEndpoint, ApiMethod, EndpointConfig, EndpointFactory } from './types';

function factory<M extends ApiMethod>(method: M): EndpointFactory<M> {
  return ((
    configOrHandler: EndpointConfig | ApiEndpoint['handler'],
    handler?: (context: ApiContext) => unknown,
  ): ApiEndpoint => {
    if (typeof configOrHandler === 'function') {
      return { method, config: {}, handler: configOrHandler };
    }
    if (!handler) throw new TypeError(`api.${method.toLowerCase()}(): missing handler`);
    return { method, config: configOrHandler, handler };
  }) as EndpointFactory<M>;
}

/**
 * Declares typed endpoints inside a modules-page-routing API file.
 *
 * Export each endpoint under its method name so `auto-types-api generate` can find it, then
 * hand them to `api.serve` for React Router's `loader` and `action`.
 *
 * @example
 * ```ts
 * // app/modules/shop/api/products.$id.ts
 * import { api } from 'auto-types-api';
 * import { z } from 'zod';
 *
 * export const GET = api.get({ response: Product }, ({ params }) => db.products.find(params.id));
 *
 * export const PATCH = api.patch(
 *   { body: z.object({ name: z.string() }), response: Product },
 *   ({ params, body }) => db.products.update(params.id, body),
 * );
 *
 * export const { loader, action } = api.serve({ GET, PATCH });
 * ```
 */
export const api = {
  get: factory('GET'),
  post: factory('POST'),
  put: factory('PUT'),
  patch: factory('PATCH'),
  delete: factory('DELETE'),
  serve,
};
