import { ValidationError } from 'endpoint-kit';
import type { AnyRoute } from 'endpoint-kit';
import { HttpReply, errorToResponse, handleRoute } from 'endpoint-kit/server';
import type {
  ApiContext,
  ApiEndpoint,
  ApiEndpoints,
  ApiMethod,
  RouterArgs,
  ServeOptions,
  ServedHandler,
} from './types';

/**
 * Turns the endpoints of an API file into one handler for React Router's `loader` and `action`.
 * It dispatches on the request method (`HEAD` uses `GET`); unknown methods get a 405 with an
 * `Allow` header. The handler carries the endpoints for the generated client and OpenAPI.
 *
 * Validation, body parsing and error mapping are endpoint-kit's (`handleRoute`): React Router
 * matched the path, so each endpoint is served as a route at that path.
 *
 * Keep the endpoints unexported: React Router strips `loader` / `action` from client bundles,
 * and anything only they reference goes with them.
 *
 * @example
 * ```ts
 * const GET = api.get({ response: Product }, ({ params }) => db.find(params.id));
 *
 * export const loader = api.serve({ GET });
 * export const action = loader;
 * ```
 */
export function serve<E extends ApiEndpoints>(
  endpoints: E,
  options: ServeOptions = {},
): ServedHandler<E> {
  const allowed = (Object.keys(endpoints) as ApiMethod[]).filter((m) => endpoints[m]);
  const handler = (args: RouterArgs): Promise<Response> => {
    const method = args.request.method.toUpperCase();
    const endpoint = endpoints[(method === 'HEAD' ? 'GET' : method) as ApiMethod];
    if (!endpoint) {
      const notAllowed = new HttpReply(
        405,
        { error: 'MethodNotAllowed' },
        { allow: allowed.join(', ') },
      );
      return Promise.resolve(notAllowed.toResponse());
    }
    return handle(endpoint, args, options);
  };
  return Object.defineProperty(handler, '~endpoints', { value: endpoints }) as ServedHandler<E>;
}

async function handle(
  endpoint: ApiEndpoint,
  { request, params, context }: RouterArgs,
  options: ServeOptions,
): Promise<Response> {
  const { method, config } = endpoint;
  const where = { route: method, request };

  /** A reply with a declared `errors` status is validated against that status' schema. */
  const checked = async (answer: HttpReply): Promise<HttpReply> => {
    const schema = options.validateResponse === false ? undefined : config.errors?.[answer.status];
    if (!schema) return answer;
    const outcome = await schema['~standard'].validate(answer.body);
    if (outcome.issues) throw new ValidationError('response', outcome.issues, method);
    return new HttpReply(answer.status, outcome.value, answer.headers);
  };
  const answer = async (reply: HttpReply): Promise<Response> => {
    try {
      return (await checked(reply)).toResponse();
    } catch (error) {
      return errorToResponse(error, where, options);
    }
  };

  // Middlewares run before input validation, so a 401 beats a 400.
  const extras: Record<string, unknown> = {};
  try {
    for (const middleware of endpoint.middlewares) {
      const added = await middleware({ ...extras, request, params, context });
      if (added instanceof Response) return added;
      if (HttpReply.is(added)) return await answer(added);
      if (typeof added === 'object' && added !== null) Object.assign(extras, added);
    }
  } catch (error) {
    return HttpReply.is(error) ? answer(error) : errorToResponse(error, where, options);
  }

  const raise = (status: number, body: unknown): never => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- caught below
    throw new HttpReply(status, body);
  };

  return handleRoute(
    method,
    toRoute(endpoint),
    async ({ params, query, body, headers }) => {
      const ctx = { ...extras, params, query, body, headers, request, context, error: raise };
      try {
        const result = await endpoint.handler(ctx as unknown as ApiContext);
        return HttpReply.is(result) ? await checked(result) : result;
      } catch (error) {
        if (HttpReply.is(error)) return await checked(error);
        throw error;
      }
    },
    { request, params },
    options,
  );
}

/** The endpoint as an endpoint-kit route. The path is irrelevant: React Router matched it. */
function toRoute({ method, config }: ApiEndpoint): AnyRoute {
  const route: AnyRoute = { method, path: '/' };
  if (config.params) route.params = config.params;
  if (config.query) route.query = config.query;
  if (config.body) route.body = config.body;
  if (config.headers) route.headers = config.headers;
  if (config.response) route.response = config.response;
  if (config.bodyType) route.bodyType = config.bodyType;
  if (config.responseType) route.responseType = config.responseType;
  return route;
}
