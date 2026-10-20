import { buildApiModuleRouteConfig, buildApiRouteConfig } from 'modules-page-routing';

/** Whether a path relative to the app directory is a modules-page-routing API file. */
export function isApiFile(file: string): boolean {
  return (
    file.endsWith('.ts') &&
    !file.endsWith('.d.ts') &&
    (file.startsWith('api/') || /^modules\/[^/]+\/api\//.test(file))
  );
}

/** Maps API files to URL patterns with modules-page-routing's own route builders. */
export function resolveApiPaths(
  files: readonly string[],
  prefix = '/api',
): { file: string; path: string }[] {
  const glob = Object.fromEntries(files.map((file) => [`./${file}`, null]));
  const base = `/${prefix.replace(/^\/+|\/+$/g, '')}`.replace(/^\/$/, '');
  return [...buildApiRouteConfig(glob), ...buildApiModuleRouteConfig(glob)].map((node) => ({
    file: node.file,
    path: joinApiPath(base, node.path),
  }));
}

/** Joins the prefix and a builder path; an empty path (`api/index.ts`) is the prefix itself. */
export function joinApiPath(base: string, path: string | undefined): string {
  if (!path) return base || '/';
  return `${base}/${path}`;
}

/** `get` + `/api/shop/products/:id` → `getShopProductsById`. */
export function routeName(method: string, path: string, prefix = ''): string {
  const rest = path.startsWith(prefix) ? path.slice(prefix.length) : path;
  const words = rest
    .split('/')
    .filter(Boolean)
    .flatMap((segment) => {
      if (segment === '*') return ['all'];
      if (segment.startsWith(':')) return ['by', ...segment.slice(1).split(/[^A-Za-z0-9]+/)];
      return segment.split(/[^A-Za-z0-9]+/);
    })
    .filter(Boolean);
  // The prefix itself (`api/index.ts` → `/api`) has no words of its own.
  return [method.toLowerCase(), ...(words.length ? words : ['root']).map(capitalize)].join('');
}

export function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
