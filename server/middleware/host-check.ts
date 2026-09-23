import { isIPv4, isIPv6 } from 'node:net';
import type { Context, MiddlewareHandler } from 'hono';
import { AppError } from '../errors.ts';
import type { AppDeps, AppEnv, NetUrl } from '../types.ts';
import { REQUEST_ID_HEADER } from './request-context.ts';
import { securityHeaderValues } from './security-headers.ts';

/**
 * Host check against DNS rebinding (NF-21). Rebinding always needs a host name, so every IP literal
 * and localhost pass. Names must match the configured list exactly (no suffix matching), ignoring
 * case and port. Deliberately independent of the addresses found at startup, so an IP change on
 * the server PC never locks anyone out.
 */
export function isAllowedHost(host: string, allowed: readonly string[]): boolean {
  const value = host.toLowerCase();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end < 0 || !isPortSuffix(value.slice(end + 1))) return false;
    return isIPv6(value.slice(1, end));
  }
  const colon = value.indexOf(':');
  const name = colon < 0 ? value : value.slice(0, colon);
  if (colon >= 0 && !isPortSuffix(value.slice(colon))) return false;
  if (name === '') return false;
  if (name === 'localhost' || isIPv4(name)) return true;
  return allowed.some((entry) => entry.toLowerCase() === name);
}

function isPortSuffix(rest: string): boolean {
  return rest === '' || /^:\d{1,5}$/.test(rest);
}

function requestHost(c: Context<AppEnv>): string {
  try {
    // @hono/node-server builds the request URL from the Host header, so this is the header's value.
    const host = new URL(c.req.url).host;
    if (host) return host;
  } catch {
    // fall through to the raw header
  }
  return c.req.header('host') ?? '';
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function misdirectedHtml(urls: readonly NetUrl[]): string {
  const list =
    urls.length > 0
      ? `<ul>\n${urls.map((u) => `<li><a href="${escapeHtml(u.url)}">${escapeHtml(u.url)}</a></li>`).join('\n')}\n</ul>`
      : '<p>Die richtige Adresse steht in der Konsole des Server-PCs.</p>';
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Falsche Adresse</title>
</head>
<body>
<h1>Falsche Adresse</h1>
<p>Unter dieser Adresse ist die Rezepte-App nicht erreichbar. Öffne sie über eine dieser Adressen:</p>
${list}
<p>Tipp: Speichere die richtige Adresse als Lesezeichen oder als Verknüpfung auf dem Startbildschirm.</p>
</body>
</html>
`;
}

function safeNetUrls(deps: AppDeps): NetUrl[] {
  try {
    return deps.netInfo().urls;
  } catch (err) {
    deps.log.warn('net info unavailable', { err });
    return [];
  }
}

export function hostCheck(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const host = requestHost(c);
    if (isAllowedHost(host, deps.config.allowedHosts)) return next();

    const requestId = c.get('requestId');
    deps.log.warn('host rejected', { requestId, host: host.slice(0, 255) });

    // Browser navigations get a readable German page with working links instead of JSON.
    if ((c.req.header('accept') ?? '').toLowerCase().includes('text/html')) {
      const headers: Record<string, string> = {
        ...securityHeaderValues(c.req.path, deps.state.version),
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'",
        'Cache-Control': 'no-store',
      };
      if (requestId) headers[REQUEST_ID_HEADER] = requestId;
      return c.body(misdirectedHtml(safeNetUrls(deps)), 421, headers);
    }
    throw new AppError('MISDIRECTED', 'Diese Adresse gehört nicht zur Rezepte-App');
  };
}
