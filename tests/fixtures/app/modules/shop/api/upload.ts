import { api } from 'auto-types-api';
import { z } from 'zod';

const POST = api.post(
  { body: z.object({ file: z.instanceof(File), note: z.string() }), bodyType: 'multipart' },
  async ({ body }) => ({
    name: body.file.name,
    size: (await body.file.text()).length,
    note: body.note,
  }),
);

// Endpoints declared as a variable are detected too.
const endpoints = { POST };

export const action = api.serve(endpoints);
