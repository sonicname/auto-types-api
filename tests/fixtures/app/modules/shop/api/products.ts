import { api } from 'auto-types-api';
import { z } from 'zod';
import { Problem, Product, db } from '../schemas';

export const loader = api.serve({
  GET: api.get(
    {
      query: z.object({ q: z.string().optional(), limit: z.number().int().positive().optional() }),
      tags: ['products'],
    },
    ({ query }) =>
      db.filter((p) => !query.q || p.name.includes(query.q)).slice(0, query.limit ?? db.length),
  ),
  POST: api.post(
    { body: Product.omit({ id: true }), response: Product, errors: { 409: Problem } },
    ({ body, error }) => {
      if (db.some((p) => p.name === body.name)) error(409, { message: 'Name taken' });
      const product = { id: db.length + 1, ...body };
      db.push(product);
      return product;
    },
  ),
});
export const action = loader;
