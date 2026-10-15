import { api, reply } from 'auto-types-api';
import { z } from 'zod';
import { Product, db } from '../schemas';

const params = z.object({ id: z.coerce.number<string | number>() });

const GET = api.get({ params, response: Product }, ({ params }) => {
  return db.find((p) => p.id === params.id) ?? reply(404, { error: 'NotFound' });
});

const DELETE = api.delete(
  { params, headers: z.object({ 'x-admin': z.literal('1') }) },
  ({ params }) => {
    const index = db.findIndex((p) => p.id === params.id);
    if (index === -1) return reply(404);
    db.splice(index, 1);
    return reply(204);
  },
);

// Only an action: GET is still answered because `serve` dispatches on the request method.
export const action = api.serve({ GET, DELETE });
export const loader = action;
