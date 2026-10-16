import { TaggedError, ValidationError } from 'endpoint-kit';
import type { AnySchema } from 'endpoint-kit';
import { HttpReply, coercePrimitives, parseQuery } from 'endpoint-kit/server';
import type {
  ApiContext,
  ApiEndpoint,
  ApiEndpoints,
  ApiMethod,
  EndpointConfig,
  RouterArgs,
  ServeOptions,
  ServedHandler,
} from './types';

type Target = 'params' | 'query' | 'body' | 'headers';

/**
 * Turns the endpoints of an API file into one handler for React Router's `loader` and `action`.
 * It dispatches on the request method (`HEAD` uses `GET`); unknown methods get a 405 with an
 * `Allow` header. The handler carries the endpoints for the generated client and OpenAPI.
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
      return Promise.resolve(
        json(405, { error: 'MethodNotAllowed' }, { allow: allowed.join(', ') }),
      );
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
  const { config } = endpoint;
  const coerce = options.coerce !== false;
  const validateOutput = options.validateResponse !== false;
  try {
    const extras: Record<string, unknown> = {};
    for (const middleware of endpoint.middlewares) {
      const added = await middleware({ ...extras, request, params, context });
      if (added instanceof Response) return added;
      if (added instanceof HttpReply) return await replyResponse(added, config, validateOutput);
      if (typeof added === 'object' && added !== null) Object.assign(extras, added);
    }

    const ctx = {
      ...extras,
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
      error: (status: number, body: unknown): never => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- caught below
        throw new HttpReply(status, body);
      },
    } as ApiContext;

    const result = await endpoint.handler(ctx);
    if (result instanceof Response) return result;
    if (result instanceof HttpReply) return await replyResponse(result, config, validateOutput);
    return await successResponse(result, config, validateOutput);
  } catch (error) {
    if (error instanceof HttpReply) {
      try {
        return await replyResponse(error, config, validateOutput);
      } catch (invalid) {
        return errorResponse(invalid, request, options);
      }
    }
    return errorResponse(error, request, options);
  }
}

async function successResponse(
  result: unknown,
  config: EndpointConfig,
  validateOutput: boolean,
): Promise<Response> {
  const schema = validateOutput ? config.response : undefined;
  switch (config.responseType) {
    case 'sse':
      return sseResponse(result as AsyncIterable<unknown>, schema);
    case 'text': {
      const body = await check(schema, result);
      return new Response(String(body), {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    default: {
      const body = await check(schema, result);
      return body === undefined ? new Response(null, { status: 204 }) : json(200, body);
    }
  }
}

/** A reply with a declared `errors` status is validated against that status' schema. */
async function replyResponse(
  answer: HttpReply,
  config: EndpointConfig,
  validateOutput: boolean,
): Promise<Response> {
  const { status, headers } = answer;
  const schema = validateOutput ? config.errors?.[status] : undefined;
  const body = await check(schema, answer.body);
  if (body === undefined || body === null) return new Response(null, { status, headers });
  if (typeof body === 'string') return new Response(body, { status, headers });
  return json(status, body, headers);
}

function errorResponse(error: unknown, request: Request, options: ServeOptions): Promise<Response> {
  if (error instanceof ValidationError) {
    return Promise.resolve(
      json(error.target === 'response' ? 500 : 400, {
        error: 'ValidationError',
        target: error.target,
        issues: error.issues,
      }),
    );
  }
  if (error instanceof TaggedError) {
    const { _tag, message, status, data } = error as TaggedError & {
      status?: unknown;
      data?: unknown;
    };
    return Promise.resolve(
      json(typeof status === 'number' ? status : 500, {
        error: _tag,
        message,
        ...(data === undefined ? {} : { data }),
      }),
    );
  }
  if (options.onError) return Promise.resolve(options.onError(error, request));
  return Promise.resolve(json(500, { error: 'InternalServerError' }));
}

/** Streams what `events` yields as server-sent events, one JSON `data` line per event. */
function sseResponse(events: AsyncIterable<unknown>, schema: AnySchema | undefined): Response {
  const iterator = events[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          controller.close();
          return;
        }
        const data = await check(schema, next.value);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data ?? null)}\n\n`));
      } catch (error) {
        // Abort the stream so the client's iteration fails instead of ending normally.
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
  });
}

/** Validates an outgoing value against `schema`, if any. */
async function check(schema: AnySchema | undefined, value: unknown): Promise<unknown> {
  if (!schema) return value;
  const outcome = await schema['~standard'].validate(value);
  if (outcome.issues) throw new ValidationError('response', outcome.issues, 'response');
  return outcome.value;
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

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
