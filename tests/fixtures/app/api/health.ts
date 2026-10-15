import { api } from 'auto-types-api';

export const GET = api.get(() => ({ ok: true as const, uptime: 1 }));

export const { loader, action } = api.serve({ GET });
