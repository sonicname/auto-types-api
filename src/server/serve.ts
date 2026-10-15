import { TaggedError, ValidationError } from 'endpoint-kit';
import type { AnySchema } from 'endpoint-kit';
import { HttpReply, coercePrimitives, parseQuery } from 'endpoint-kit/server';
import type {
  ApiContext,
  ApiEndpoint,
  ApiEndpoints,
  ApiMethod,
  RouterArgs,
  RouterHandler,
  ServeOptions,
} from './types';

type Target = 'params' | 'query' | 'body' | 'headers';

/**
 * Turns the endpoints of an API file into React Router's `loader` and `action`.
 *
 * `loader` answers `GET` (and `HEAD`); `action` dispatches every other method. Unknown methods
 * get a 405 with an `Allow` header.
 *
 * @example
 * ```ts
 * export const GET = api.get({ response: Product }, ({ params }) => db.find(params.id));
 * export const { loader, action } = api.serve({ GET });
 * ```
 */
export function serve(
  endpoints: ApiEndpoints,
  options: ServeOptions = {},
): { loader: RouterHandler; action: RouterHandler } {
  const allowed = (Object.keys(endpoints) as ApiMethod[]).filter((m) => endpoints[m]);
  const dispatch = (method: string, args: RouterArgs): Promise<Response> => {
    const endpoint = endpoints[(method === 'HEAD' ? 'GET' : method) as ApiMethod];
    if (!endpoint) {
      return Promise.resolve(
        json(405, { error: 'MethodNotAllowed' }, { allow: allowed.join(', ') }),
      );
    }
    return handle(endpoint, args, options);
  };

  return {
    loader: (args) => dispatch('GET', args),
    action: (args) => dispatch(args.request.method.toUpperCase(), args),
  };
}

async function handle(
  endpoint: ApiEndpoint,
  { request, params, context }: RouterArgs,
  options: ServeOptions,
): Promise<Response> {
  const { config } = endpoint;
  const coerce = options.coerce !== false;
  try {
    const ctx: ApiContext = {
      params: await validate('params', config.params, params, coerce),
      query: await validate(
        'query',
        config.query,
        parseQuery(new URL(request.url).searchParams),
        coerce,
      ),
      body: await validate('body', config.body, await readBody(request), coerce),
      headers: config.headers
        ? await validate('headers', config.headers, Object.fromEntries(request.headers), coerce)
        : request.headers,
      request,
      context,
    };

    const result = await endpoint.handler(ctx);
    if (result instanceof Response) return result;
    if (result instanceof HttpReply) return replyResponse(result);

    let body = result;
    if (config.response && options.validateResponse !== false) {
      const outcome = await config.response['~standard'].validate(result);
      if (outcome.issues) throw new ValidationError('response', outcome.issues, endpoint.method);
      body = outcome.value;
    }
    return body === undefined ? new Response(null, { status: 204 }) : json(200, body);
  } catch (error) {
    if (error instanceof HttpReply) return replyResponse(error);
    if (error instanceof ValidationError) {
      return json(error.target === 'response' ? 500 : 400, {
        error: 'ValidationError',
        target: error.target,
        issues: error.issues,
      });
    }
    if (error instanceof TaggedError) {
      const { _tag, message, status, data } = error as TaggedError & {
        status?: unknown;
        data?: unknown;
      };
      return json(typeof status === 'number' ? status : 500, {
        error: _tag,
        message,
        ...(data === undefined ? {} : { data }),
      });
    }
    if (options.onError) return options.onError(error, request);
    return json(500, { error: 'InternalServerError' });
  }
}

/**
 * Validates `value`. Values parsed from strings (params, query, form bodies) are retried with
 * numbers and booleans coerced, so `z.number()` schemas shared with clients accept `"12"`.
 */
async function validate(
  target: Target,
  schema: AnySchema | undefined,
  value: unknown,
  coerce: boolean,
): Promise<unknown> {
  if (!schema) return value;
  const subject = value ?? {};
  const first = await schema['~standard'].validate(subject);
  if (!first.issues) return first.value;
  const coerced = coerce ? coercePrimitives(subject) : subject;
  if (coerced !== subject) {
    const second = await schema['~standard'].validate(coerced);
    if (!second.issues) return second.value;
  }
  throw new ValidationError(target, first.issues, target);
}

async function readBody(request: Request): Promise<unknown> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const text = await request.text();
    return text === '' ? undefined : (JSON.parse(text) as unknown);
  }
  if (type.includes('multipart/form-data') || type.includes('application/x-www-form-urlencoded')) {
    const body: Record<string, unknown> = {};
    // Same parsing React Router uses for actions; body size limits belong to the HTTP server.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    for (const [key, value] of await request.formData()) {
      const current = body[key];
      if (current === undefined) body[key] = value;
      else if (Array.isArray(current)) current.push(value);
      else body[key] = [current, value];
    }
    return body;
  }
  const text = await request.text();
  return text === '' ? undefined : text;
}

function replyResponse({ status, body, headers }: HttpReply): Response {
  if (body === undefined || body === null) return new Response(null, { status, headers });
  if (typeof body === 'string') return new Response(body, { status, headers });
  return json(status, body, headers);
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
