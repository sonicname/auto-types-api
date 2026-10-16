import { createApi, reply } from 'auto-types-api';
import { z } from 'zod';
import { Problem, Product, db } from '../schemas';

// Stands in for React Router's generated `Route.LoaderArgs`.
interface Args {
  params: { id: string };
  context: { tenant: string };
}

const api = createApi<Args>();

// Typed from Args: no params schema needed to read params.id / context.tenant.
const GET = api.get(
  { response: Product, errors: { 404: Problem } },
  ({ params, context, error }) => {
    const product = db.find((p) => String(p.id) === params.id);
    return product ?? error(404, { message: `No product ${params.id} in ${context.tenant}` });
  },
);

const admin = api.use(({ request }) => {
  if (request.headers.get('x-admin') !== '1') return reply(403, { message: 'Admins only' });
  return { role: 'admin' as const };
});

const DELETE = admin.delete(
  { params: z.object({ id: z.coerce.number<string | number>() }) },
  ({ params, role }) => {
    const index = db.findIndex((p) => p.id === params.id);
    if (index === -1) return reply(404);
    db.splice(index, 1);
    return { deletedBy: role };
  },
);

export const action = api.serve({ GET, DELETE });
export const loader = action;
