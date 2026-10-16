import type { RouteMap } from 'endpoint-kit';
import { matchRoute } from 'endpoint-kit/server';
import type { RouterHandler } from './types';

/** Options for the `fetch` returned by {@link createLocalFetch}. */
export interface LocalFetchOptions {
  /**
   * The incoming request (e.g. a page loader's `request`). Relative URLs resolve against it and
   * {@link LocalFetchOptions.forwardHeaders} are copied from it.
   */
  request?: Request;
  /** React Router `context` passed to the API handlers. */
  context?: unknown;
  /** Headers copied from `request` when the call does not set them. Defaults to cookie and authorization. */
  forwardHeaders?: readonly string[];
}

/**
 * Builds a `fetch` that calls API handlers in-process instead of over HTTP, for server-side
 * code such as page loaders. The generated `api.gen.server.ts` wires it to every route.
 *
 * @example
 * ```ts
 * import { createRepository, fetchAdapter } from 'endpoint-kit';
 * import { routes } from '~/api.gen';
 * import { localFetch } from '~/api.gen.server';
 *
 * export async function loader({ request, context }: Route.LoaderArgs) {
 *   const api = createRepository({
 *     baseUrl: '',
 *     adapter: fetchAdapter({ fetch: localFetch({ request, context }) }),
 *   }).mergeAll(routes).build();
 *   return api.getShopProducts.orThrow();
 * }
 * ```
 */
export function createLocalFetch(
  routes: RouteMap,
  handlers: Readonly<Record<string, RouterHandler>>,
): (options?: LocalFetchOptions) => typeof fetch {
  return (options = {}) =>
    async (input, init) => {
      const href = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      const url = new URL(href, options.request?.url ?? 'http://localhost');
      const request = new Request(url, input instanceof Request ? input : init);
      for (const name of options.forwardHeaders ?? ['cookie', 'authorization']) {
        const value = options.request?.headers.get(name);
        if (value != null && !request.headers.has(name)) request.headers.set(name, value);
      }

      const method = request.method === 'HEAD' ? 'GET' : request.method;
      const match = matchRoute(routes, method, url.pathname);
      const handler = match && handlers[match.name];
      if (!match || !handler) {
        return new Response(JSON.stringify({ error: 'NotFound' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      return handler({ request, params: match.params, context: options.context });
    };
}
