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
    path: `${base}/${node.path ?? ''}`,
  }));
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
  return [method.toLowerCase(), ...words.map(capitalize)].join('');
}

export function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
