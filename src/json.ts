type JsonPrimitive = string | number | boolean | null;
type NotJson = undefined | symbol | bigint | ((...args: never[]) => unknown);

/** Array items: what JSON cannot represent becomes `null` (distributes over unions). */
type JsonItem<V> = V extends NotJson ? null : Jsonify<V>;

/**
 * The type a value has after `JSON.stringify` + `JSON.parse`: `Date` (anything with `toJSON`)
 * becomes its `toJSON()` result, `undefined` and function properties disappear, `undefined`
 * array items become `null`.
 */
export type Jsonify<T> = unknown extends T
  ? T
  : T extends { toJSON(): infer J }
    ? Jsonify<J>
    : T extends JsonPrimitive
      ? T
      : T extends NotJson
        ? never
        : T extends readonly unknown[]
          ? { [K in keyof T]: JsonItem<T[K]> }
          : T extends object
            ? {
                [
                  K in keyof T as K extends symbol ? never : T[K] extends NotJson ? never : K
                ]: Jsonify<T[K]>;
              }
            : never;
