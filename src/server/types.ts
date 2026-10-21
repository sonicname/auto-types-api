import type { AnySchema, StandardSchemaV1 } from 'endpoint-kit';
import type { HttpReply, ServerOptions } from 'endpoint-kit/server';

/** HTTP methods an API file can serve. */
export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A schema slot: any Standard Schema (Zod, Valibot, ArkType, ...) or nothing. */
export type SchemaSlot = AnySchema | undefined;

/** Path params as React Router passes them to loaders and actions. */
export type RouterParams = Record<string, string | undefined>;

/** What React Router passes to a `loader` / `action` (the part used here). */
export interface RouterArgs {
  request: Request;
  params: RouterParams;
  context?: unknown;
}

/** A React Router `loader` / `action`. */
export type RouterHandler = (args: RouterArgs) => Promise<Response>;

/**
 * Shape of the args type given to `createApi<Args>()`, typically React Router's generated
 * `Route.LoaderArgs`, which types `ctx.params` and `ctx.context`.
 */
export interface ArgsLike {
  params: object;
  context?: unknown;
}

/** How clients encode the request body. */
export type ApiBodyType = 'json' | 'multipart' | 'form';

/** How the server encodes the response: JSON, plain text, or server-sent events. */
export type ApiResponseType = 'json' | 'text' | 'sse';

/** Declared error responses: status code → schema of the error body. */
export type ErrorSchemas = Readonly<Partial<Record<number, AnySchema>>>;

/** Schemas and options of one endpoint. Every field is optional. */
export interface EndpointConfig {
  /** Whole-object schema for path params. Keys must match the `$param` segments of the file. */
  params?: AnySchema;
  query?: AnySchema;
  body?: AnySchema;
  headers?: AnySchema;
  /** Validates what the handler returns (each event for `sse`). Without it the type is inferred. */
  response?: AnySchema;
  /** Error responses the handler may send with `ctx.error(status, body)`, typed on the client. */
  errors?: ErrorSchemas;
  /** How clients encode the body. Defaults to `json`. */
  bodyType?: ApiBodyType;
  /** `text` sends a string, `sse` streams what an async iterable yields. Defaults to `json`. */
  responseType?: ApiResponseType;
  /** OpenAPI operation summary. */
  summary?: string;
  /** OpenAPI operation description. */
  description?: string;
  /** OpenAPI tags. */
  tags?: readonly string[];
  /** Marks the operation deprecated in OpenAPI. */
  deprecated?: boolean;
}

type MaybePromise<T> = T | Promise<T>;
type Empty = Record<never, never>;

type Output<S, Fallback> = S extends AnySchema ? StandardSchemaV1.InferOutput<S> : Fallback;
type Input<S, Fallback> = S extends AnySchema ? StandardSchemaV1.InferInput<S> : Fallback;

/** The schema in slot `K` of a config, or `undefined`. */
export type SlotOf<C, K extends keyof EndpointConfig> =
  C extends Readonly<Record<K, infer S>> ? (S extends AnySchema ? S : undefined) : undefined;

/** `responseType` of a config, `json` by default. */
export type ResponseTypeOf<C> = C extends { readonly responseType: infer R extends ApiResponseType }
  ? R
  : 'json';

/** `bodyType` of a config, `json` by default. */
export type BodyTypeOf<C> = C extends { readonly bodyType: infer B extends ApiBodyType }
  ? B
  : 'json';

/** Declared `errors` of a config. */
export type ErrorsOf<C> = C extends { readonly errors: infer E extends ErrorSchemas } ? E : Empty;

/** Status codes declared in an `errors` map. */
export type ErrorStatus<E> = keyof E & number;

/** `ctx.error`: sends a declared error response and stops the handler. */
export type RaiseError<E> = <S extends ErrorStatus<E>>(
  status: S,
  body: Input<E[S], undefined>,
) => never;

type ContextOf<TArgs> = TArgs extends { context: infer X } ? X : unknown;

/** What middlewares receive: the raw request, React Router's params and context. */
export interface MiddlewareContext<TArgs extends ArgsLike = RouterArgs> {
  request: Request;
  params: TArgs['params'];
  context: ContextOf<TArgs>;
}

/** What a handler receives: validated input, middleware additions and helpers. */
export type ApiContext<
  TArgs extends ArgsLike = RouterArgs,
  C = EndpointConfig,
  TExtra = unknown,
> = TExtra & {
  params: Output<SlotOf<C, 'params'>, TArgs['params']>;
  /** Parsed query string, validated when a `query` schema is set. */
  query: Output<SlotOf<C, 'query'>, Record<string, unknown>>;
  /** Parsed request body (JSON, form or text), validated when a `body` schema is set. */
  body: Output<SlotOf<C, 'body'>, unknown>;
  /** Validated headers when a `headers` schema is set, else the raw `Headers`. */
  headers: Output<SlotOf<C, 'headers'>, Headers>;
  request: Request;
  /** React Router's `context`. */
  context: ContextOf<TArgs>;
  /** Sends one of the declared `errors` and stops the handler. */
  error: RaiseError<ErrorsOf<C>>;
};

/** Anything a handler may return besides data. */
export type RawReturn = HttpReply | Response;

/** What a handler with a `response` schema must return. */
export type SchemaReturn<C> =
  | RawReturn
  | (ResponseTypeOf<C> extends 'sse'
      ? AsyncIterable<Input<SlotOf<C, 'response'>, unknown>>
      : Input<SlotOf<C, 'response'>, unknown>);

/** Response data of a handler without a `response` schema: per event for `sse`. */
export type ResponseData<TReturn, C = Empty> =
  ResponseTypeOf<C> extends 'sse'
    ? Exclude<TReturn, RawReturn> extends AsyncIterable<infer U>
      ? U
      : unknown
    : ResponseTypeOf<C> extends 'text'
      ? string
      : [Exclude<Awaited<TReturn>, RawReturn>] extends [never]
        ? unknown
        : Exclude<Awaited<TReturn>, RawReturn>;

/** Type-level description of an endpoint, read by `auto-types-api/client`. */
export interface EndpointTypes {
  method: ApiMethod;
  params: SchemaSlot;
  query: SchemaSlot;
  body: SchemaSlot;
  headers: SchemaSlot;
  /** The JSON body clients receive (each event's data for `sse`). */
  response: unknown;
  errors: ErrorSchemas;
  bodyType: ApiBodyType;
  responseType: ApiResponseType;
}

/** Endpoint types for method `M`, config `C` and response data `R`. */
export interface TypesFor<M extends ApiMethod, C, R> extends EndpointTypes {
  method: M;
  params: SlotOf<C, 'params'>;
  query: SlotOf<C, 'query'>;
  body: SlotOf<C, 'body'>;
  headers: SlotOf<C, 'headers'>;
  response: R;
  errors: ErrorsOf<C>;
  bodyType: BodyTypeOf<C>;
  responseType: ResponseTypeOf<C>;
}

/**
 * A middleware: runs before validation. The object it returns is merged into `ctx`; a returned
 * `reply()` or `Response` is sent right away.
 */
export type Middleware<TArgs extends ArgsLike = RouterArgs, TExtra = unknown, TMore = unknown> = (
  context: MiddlewareContext<TArgs> & TExtra,
) => MaybePromise<TMore | RawReturn | undefined>;

/** One endpoint, created by `api.get(...)`, `api.post(...)` and so on. */
export interface ApiEndpoint<TTypes extends EndpointTypes = EndpointTypes> {
  readonly method: TTypes['method'];
  readonly config: EndpointConfig;
  readonly middlewares: readonly Middleware<ArgsLike>[];
  readonly handler: (context: ApiContext) => unknown;
  /** Phantom field carrying the endpoint's types. Never set at runtime. */
  readonly '~types'?: TTypes;
}

/** Builds an endpoint for one HTTP method. */
export interface EndpointFactory<
  M extends ApiMethod,
  TArgs extends ArgsLike = RouterArgs,
  TExtra = unknown,
> {
  /** With a `response` schema: the handler must return its input type. */
  <const C extends EndpointConfig & { response: AnySchema }>(
    config: C,
    handler: (context: ApiContext<TArgs, C, TExtra>) => MaybePromise<SchemaReturn<C>>,
  ): ApiEndpoint<TypesFor<M, C, Output<SlotOf<C, 'response'>, unknown>>>;

  /** Without a `response` schema: the response type is inferred from the handler. */
  <const C extends EndpointConfig & { response?: undefined }, TReturn>(
    config: C,
    handler: (context: ApiContext<TArgs, C, TExtra>) => MaybePromise<TReturn>,
  ): ApiEndpoint<TypesFor<M, C, ResponseData<TReturn, C>>>;

  /** Handler only: no validation, response type inferred from the handler. */
  <TReturn>(
    handler: (context: ApiContext<TArgs, Empty, TExtra>) => MaybePromise<TReturn>,
  ): ApiEndpoint<TypesFor<M, Empty, ResponseData<TReturn>>>;
}

/** Endpoints of one API file, keyed by method. */
export type ApiEndpoints = Partial<Record<ApiMethod, ApiEndpoint>>;

/** The `loader` / `action` produced by `api.serve`, carrying its endpoints. */
export type ServedHandler<E extends ApiEndpoints = ApiEndpoints> = RouterHandler & {
  /** The served endpoints, read by `auto-types-api/openapi` and the generated client types. */
  readonly '~endpoints': E;
};

/** Methods served by a {@link ServedHandler}. */
export type ServedMethods<H extends ServedHandler> = keyof H['~endpoints'] & ApiMethod;

/**
 * Options for `api.serve`: endpoint-kit's server options (`coerce`, `errorStatus`, `onError`)
 * without the routing ones, which React Router takes care of.
 */
export interface ServeOptions extends Pick<ServerOptions, 'coerce' | 'errorStatus' | 'onError'> {
  /**
   * Validate handler return values against the `response` schema and declared error bodies
   * against their `errors` schema. Defaults to `true`.
   */
  validateResponse?: boolean;
}

/** Declares endpoints; `createApi()` / `api.use()` return one. */
export interface Api<TArgs extends ArgsLike = RouterArgs, TExtra = unknown> {
  readonly get: EndpointFactory<'GET', TArgs, TExtra>;
  readonly post: EndpointFactory<'POST', TArgs, TExtra>;
  readonly put: EndpointFactory<'PUT', TArgs, TExtra>;
  readonly patch: EndpointFactory<'PATCH', TArgs, TExtra>;
  readonly delete: EndpointFactory<'DELETE', TArgs, TExtra>;
  /**
   * Adds a middleware to endpoints declared through the returned api. It runs before input
   * validation; return an object to add fields to `ctx`, or return a `reply()` / `Response` to
   * answer right away (throwing one works too).
   */
  use<TMore extends object = Empty>(
    middleware: (
      context: MiddlewareContext<TArgs> & TExtra,
      // A middleware that only checks something returns nothing.
      // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
    ) => MaybePromise<TMore | RawReturn | undefined | void>,
  ): Api<TArgs, TExtra & Exclude<TMore, RawReturn>>;
  /** One `loader` / `action` handler for the given endpoints. */
  serve<E extends ApiEndpoints>(endpoints: E, options?: ServeOptions): ServedHandler<E>;
}
