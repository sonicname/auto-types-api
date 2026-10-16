import { TaggedError } from 'endpoint-kit';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { HttpReply, api, createApi, reply } from '../src';
import type { ApiEndpoints, ServeOptions } from '../src';

interface CallInit extends RequestInit {
  url?: string;
  params?: Record<string, string>;
}

async function call(
  endpoints: ApiEndpoints,
  init: CallInit = {},
  options?: ServeOptions,
): Promise<{ status: number; headers: Headers; body: unknown }> {
  const { url = 'http://app.test/api/x', params = {}, ...rest } = init;
  const request = new Request(url, rest);
  const response = await api.serve(
    endpoints,
    options,
  )({ request, params, context: { user: 'u1' } });
  const text = await response.text();
  const isJson = response.headers.get('content-type')?.includes('json') ?? false;
  return {
    status: response.status,
    headers: response.headers,
    body: text && isJson ? (JSON.parse(text) as unknown) : text,
  };
}

class Forbidden extends TaggedError<'Forbidden'> {
  readonly _tag = 'Forbidden';
  readonly status = 403;
  constructor(readonly data: { reason: string }) {
    super('forbidden');
  }
}

class Plain extends TaggedError<'Plain'> {
  readonly _tag = 'Plain';
}

const jsonInit = { method: 'POST', headers: { 'content-type': 'application/json' } };

describe('api.serve', () => {
  it('passes raw input and context when there are no schemas', async () => {
    const GET = api.get((ctx) => ({
      params: ctx.params,
      query: ctx.query,
      hasHeaders: ctx.headers instanceof Headers,
      context: ctx.context,
    }));
    const res = await call({ GET }, { url: 'http://app.test/x?a=1&b[]=2', params: { id: '7' } });
    expect(res).toMatchObject({
      status: 200,
      body: {
        params: { id: '7' },
        query: { a: '1', b: ['2'] },
        hasHeaders: true,
        context: { user: 'u1' },
      },
    });
  });

  it('answers HEAD with the GET endpoint', async () => {
    const GET = api.get(() => ({ ok: true }));
    expect((await call({ GET }, { method: 'HEAD' })).status).toBe(200);
  });

  it('returns 405 with Allow for unknown methods', async () => {
    const GET = api.get(() => 1);
    const POST = api.post(() => 2);
    const res = await call({ GET, POST }, { method: 'PUT' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, POST');
    expect((await call({ POST })).status).toBe(405);
  });

  it('validates params, query and headers, coercing strings', async () => {
    const GET = api.get(
      {
        params: z.object({ id: z.number() }),
        query: z.object({ flag: z.boolean() }),
        headers: z.object({ 'x-n': z.number() }),
      },
      ({ params, query, headers }) => ({ id: params.id, flag: query.flag, n: headers['x-n'] }),
    );
    const ok = await call(
      { GET },
      { url: 'http://app.test/x?flag=true', params: { id: '3' }, headers: { 'x-n': '5' } },
    );
    expect(ok.body).toEqual({ id: 3, flag: true, n: 5 });

    const bad = await call({ GET }, { url: 'http://app.test/x?flag=no', params: { id: '3' } });
    expect(bad).toMatchObject({ status: 400, body: { target: 'query' } });
  });

  it('can turn coercion off', async () => {
    const GET = api.get({ params: z.object({ id: z.number() }) }, ({ params }) => params.id);
    const res = await call({ GET }, { params: { id: '3' } }, { coerce: false });
    expect(res).toMatchObject({ status: 400, body: { target: 'params' } });
  });

  it('parses JSON, form, text and empty bodies', async () => {
    const POST = api.post(({ body }) => ({ body: body ?? null }));
    expect((await call({ POST }, { ...jsonInit, body: '{"a":1}' })).body).toEqual({
      body: { a: 1 },
    });
    expect((await call({ POST }, { ...jsonInit, body: '' })).body).toEqual({ body: null });

    const form = new URLSearchParams([
      ['tag', 'a'],
      ['tag', 'b'],
      ['tag', 'c'],
      ['name', 'x'],
    ]);
    expect((await call({ POST }, { method: 'POST', body: form })).body).toEqual({
      body: { tag: ['a', 'b', 'c'], name: 'x' },
    });
    expect((await call({ POST }, { method: 'POST', body: 'hi' })).body).toEqual({ body: 'hi' });
    expect((await call({ POST }, { method: 'POST' })).body).toEqual({ body: null });
  });

  it('validates the body and the response', async () => {
    const POST = api.post(
      { body: z.object({ n: z.number() }), response: z.object({ double: z.number() }) },
      ({ body }) => ({ double: body.n * 2 }),
    );
    expect((await call({ POST }, { ...jsonInit, body: '{"n":2}' })).body).toEqual({ double: 4 });
    expect((await call({ POST }, { ...jsonInit, body: '{}' })).status).toBe(400);

    const broken = api.get({ response: z.object({ a: z.string() }) }, () => ({ a: 1 }) as never);
    expect(await call({ GET: broken })).toMatchObject({
      status: 500,
      body: { target: 'response' },
    });
    expect((await call({ GET: broken }, {}, { validateResponse: false })).body).toEqual({ a: 1 });
  });

  it('supports reply(), thrown replies, raw responses and empty results', async () => {
    const created = api.post(() => reply(201, { id: 1 }, { 'x-id': '1' }));
    const res = await call({ POST: created }, { method: 'POST' });
    expect(res).toMatchObject({ status: 201, body: { id: 1 } });
    expect(res.headers.get('x-id')).toBe('1');

    const text = api.get(() => reply(200, 'plain'));
    expect((await call({ GET: text })).body).toBe('plain');

    const thrown = api.get(() => {
      // endpoint-kit documents throwing a reply to short-circuit a handler.
      throw new HttpReply(404);
    });
    expect((await call({ GET: thrown })).status).toBe(404);

    const raw = api.get(() => new Response('raw', { status: 202 }));
    expect(await call({ GET: raw })).toMatchObject({ status: 202, body: 'raw' });

    const empty = api.delete(() => undefined);
    expect((await call({ DELETE: empty }, { method: 'DELETE' })).status).toBe(204);
  });

  it('maps tagged errors and unexpected errors', async () => {
    const forbidden = api.get(() => {
      throw new Forbidden({ reason: 'no' });
    });
    expect(await call({ GET: forbidden })).toMatchObject({
      status: 403,
      body: { error: 'Forbidden', message: 'forbidden', data: { reason: 'no' } },
    });

    const plain = api.get(() => {
      throw new Plain('x');
    });
    expect(await call({ GET: plain })).toMatchObject({ status: 500, body: { error: 'Plain' } });

    const crash = api.get(() => {
      throw new Error('boom');
    });
    expect(await call({ GET: crash })).toMatchObject({
      status: 500,
      body: { error: 'InternalServerError' },
    });
    const onError = (): Response => new Response('x', { status: 503 });
    expect((await call({ GET: crash }, {}, { onError })).status).toBe(503);
  });

  it('requires a handler', () => {
    const put = api.put as (config: object) => unknown;
    expect(() => put({})).toThrow('api.put(): missing handler');
  });

  it('exposes the served endpoints', () => {
    const GET = api.get(() => 1);
    expect(api.serve({ GET })['~endpoints']).toEqual({ GET });
  });
});

describe('middlewares', () => {
  it('run in order before validation and add fields to ctx', async () => {
    const seen: string[] = [];
    const withUser = createApi()
      .use(({ request }) => {
        seen.push('user');
        return { user: request.headers.get('x-user') ?? 'anon' };
      })
      .use(({ user }) => {
        seen.push('noop');
        expect(user).toBe('ann');
      })
      .use(({ user }) => ({ isAnn: user === 'ann' }));
    const GET = withUser.get({ query: z.object({ n: z.number() }) }, ({ user, isAnn, query }) => ({
      user,
      isAnn,
      n: query.n,
    }));
    const res = await call({ GET }, { url: 'http://app.test/x?n=1', headers: { 'x-user': 'ann' } });
    expect(res.body).toEqual({ user: 'ann', isAnn: true, n: 1 });
    expect(seen).toEqual(['user', 'noop']);
  });

  it('can stop the request by throwing a reply', async () => {
    const guarded = api.use(() => {
      throw reply(401, { message: 'Sign in' });
    });
    const GET = guarded.get(() => 'never');
    expect(await call({ GET })).toMatchObject({ status: 401, body: { message: 'Sign in' } });
    // The base api is unaffected.
    expect((await call({ GET: api.get(() => 'ok') })).body).toBe('ok');

    const teapot = api.use(() => new Response('short', { status: 418 })).get(() => 'never');
    expect(await call({ GET: teapot })).toMatchObject({ status: 418, body: 'short' });
    const returned = api.use(() => reply(402)).get(() => 'never');
    expect((await call({ GET: returned })).status).toBe(402);
  });
});

describe('declared errors', () => {
  const Problem = z.object({ message: z.string() });

  it('sends ctx.error and replies with a declared status after validating the body', async () => {
    const GET = api.get({ errors: { 404: Problem } }, ({ error }) =>
      error(404, { message: 'gone' }),
    );
    expect(await call({ GET })).toMatchObject({ status: 404, body: { message: 'gone' } });

    const bad = api.get({ errors: { 404: Problem } }, () => reply(404, { nope: true }));
    expect(await call({ GET: bad })).toMatchObject({ status: 500, body: { target: 'response' } });
    expect(await call({ GET: bad }, {}, { validateResponse: false })).toMatchObject({
      status: 404,
      body: { nope: true },
    });

    const thrown = api.get({ errors: { 404: Problem } }, ({ error }) =>
      error(404, { wrong: 1 } as unknown as { message: string }),
    );
    expect(await call({ GET: thrown })).toMatchObject({
      status: 500,
      body: { target: 'response' },
    });
  });
});

describe('response types', () => {
  it('sends text', async () => {
    const GET = api.get({ responseType: 'text' }, () => 'plain');
    const res = await call({ GET });
    expect(res).toMatchObject({ status: 200, body: 'plain' });
    expect(res.headers.get('content-type')).toContain('text/plain');

    const checked = api.get({ responseType: 'text', response: z.string().max(2) }, () => 'long');
    expect((await call({ GET: checked })).status).toBe(500);
  });

  it('streams server-sent events and aborts the stream on invalid events', async () => {
    const GET = api.get({ response: z.number(), responseType: 'sse' }, async function* () {
      yield 1;
      yield undefined as unknown as number;
      yield 'x' as unknown as number;
    });
    const response = await api.serve({ GET })({
      request: new Request('http://app.test/x'),
      params: {},
    });
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toBe('data: 1\n\n');
    await expect(reader.read()).rejects.toThrow('Validation failed');
  });

  it('sends null for undefined events and stops the generator when cancelled', async () => {
    let finished = false;
    const GET = api.get({ responseType: 'sse' }, async function* () {
      try {
        yield undefined;
        yield 2;
      } finally {
        finished = true;
      }
    });
    const response = await api.serve({ GET })({
      request: new Request('http://app.test/x'),
      params: {},
    });
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: null\n\n');
    await reader.cancel();
    expect(finished).toBe(true);

    const done = api.get({ responseType: 'sse' }, async function* () {});
    const empty = await api.serve({ GET: done })({
      request: new Request('http://app.test/x'),
      params: {},
    });
    expect(await empty.text()).toBe('');
  });
});
