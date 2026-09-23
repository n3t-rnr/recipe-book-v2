import os, { type NetworkInterfaceInfo } from 'node:os';
import qrcode from 'qrcode-generator';
import type { Config } from '../config.ts';
import type { NetInfo, NetUrl } from '../types.ts';

/**
 * Virtual adapters whose addresses a phone in the home LAN can never reach (F-39).
 * The `*` catches Windows' Wi-Fi Direct/hotspot miniports ("LAN-Verbindung* 2", 192.168.137.1),
 * which carry private addresses but belong to a separate hosted network.
 */
const VIRTUAL_ADAPTER =
  /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Docker|VPN|\bTAP\b|Tailscale|ZeroTier|Loopback|Bluetooth|Npcap|\*/i;

/** Physical LAN/Wi-Fi adapters (Windows names in German and English, plus Linux/macOS names for dev). */
const PREFERRED_ADAPTER = /ethernet|wlan|wi-?fi|\blan\b|^(eth|en|wl)/i;

/** Modules of white border around the QR code; 4 is the minimum the QR spec asks for. */
const QUIET_ZONE = 4;

/** Rank of a private IPv4 range (lower = more typical for a home LAN), or null if not private. */
function privateRangeRank(address: string): number | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(address);
  if (!match) return null;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (a === 192 && b === 168) return 0;
  if (a === 10) return 1;
  if (a === 172 && b >= 16 && b <= 31) return 2;
  // Everything else, including 127/8, 169.254/16 (APIPA) and 100.64/10 (CGNAT), is unreachable from the LAN.
  return null;
}

interface Candidate {
  address: string;
  preferred: boolean;
  range: number;
  order: number;
}

/** Physical adapters first, then 192.168 before 10 before 172, then the order the OS reported. */
function compareCandidates(a: Candidate, b: Candidate): number {
  return Number(b.preferred) - Number(a.preferred) || a.range - b.range || a.order - b.order;
}

/**
 * Private IPv4 addresses of non-virtual adapters, best guess first (F-39).
 * IPv6 is skipped entirely: link-local fe80:: must never show up, and ULA/global v6 URLs are
 * not something a family member can type or a router reliably keeps stable.
 */
export function selectLanAddresses(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string[] {
  const byAddress = new Map<string, Candidate>();
  let order = 0;
  for (const [name, infos] of Object.entries(interfaces)) {
    if (!infos || VIRTUAL_ADAPTER.test(name)) continue;
    const preferred = PREFERRED_ADAPTER.test(name);
    for (const info of infos) {
      if (info.family !== 'IPv4' || info.internal) continue;
      const range = privateRangeRank(info.address);
      if (range === null) continue;
      const candidate: Candidate = { address: info.address, preferred, range, order: order++ };
      const existing = byAddress.get(info.address);
      if (!existing || compareCandidates(candidate, existing) < 0) byAddress.set(info.address, candidate);
    }
  }
  return [...byAddress.values()].sort(compareCandidates).map((c) => c.address);
}

/** `<name>.local`; a host name that already ends in .local (macOS) is not doubled. */
function mdnsHost(hostname: string): string | null {
  const base = hostname.trim().replace(/\.local$/i, '');
  return base ? `${base}.local` : null;
}

/**
 * qrcode-generator's byte mode keeps only the low byte of each character, so an umlaut host or
 * path in PUBLIC_URL must be encoded first (punycode, percent-encoding); the URL stays equivalent.
 */
function asciiUrl(url: string): string {
  if (!/[^\x20-\x7E]/.test(url)) return url;
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function makeQr(url: string) {
  const qr = qrcode(0, 'M');
  qr.addData(asciiUrl(url));
  qr.make();
  return qr;
}

/**
 * QR code as a self-contained SVG. Colors are presentation attributes because the client inserts
 * the markup under the CSP `style-src 'self'`, which would block `style=` attributes. Black on
 * white regardless of theme: phone cameras need the standard polarity.
 */
function qrSvg(url: string): string {
  const qr = makeQr(url);
  const count = qr.getModuleCount();
  const size = count + QUIET_ZONE * 2;
  let d = '';
  for (let row = 0; row < count; row++) {
    let col = 0;
    while (col < count) {
      if (!qr.isDark(row, col)) {
        col++;
        continue;
      }
      // One rectangle per horizontal run keeps the path about 3x shorter than one per module.
      const start = col;
      while (col < count && qr.isDark(row, col)) col++;
      const run = col - start;
      d += `M${start + QUIET_ZONE} ${row + QUIET_ZONE}h${run}v1h-${run}z`;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"` +
    ` role="img" aria-label="QR-Code: ${escapeXml(url)}">` +
    `<rect width="${size}" height="${size}" fill="#FFFFFF"/>` +
    `<path fill="#000000" d="${d}"/>` +
    '</svg>'
  );
}

/**
 * QR code for the startup console. Half blocks pack two module rows into one text line; light
 * modules are drawn as blocks, which gives the correct polarity on the usual dark console.
 */
export function qrAscii(url: string): string {
  return makeQr(url).createASCII(1, QUIET_ZONE);
}

/**
 * Reachable URLs in display order: PUBLIC_URL, IP addresses, mDNS name (Kap. 10.6).
 * Never the bare NetBIOS name: it only resolves between Windows machines, not on phones.
 */
export function buildNetInfo(
  config: Pick<Config, 'port' | 'publicUrl' | 'hostname'>,
  addresses: string[],
): NetInfo {
  const origin = (host: string) => (config.port === 80 ? `http://${host}` : `http://${host}:${config.port}`);
  const urls: NetUrl[] = [];
  const add = (url: string, kind: NetUrl['kind']) => {
    // PUBLIC_URL may name one of the IPs; listing it twice would only confuse.
    if (!urls.some((u) => u.url === url)) urls.push({ url, kind });
  };

  if (config.publicUrl) add(config.publicUrl.replace(/\/+$/, ''), 'public');
  for (const address of addresses) add(origin(address), 'ip');
  const mdns = mdnsHost(config.hostname);
  if (mdns) add(origin(mdns), 'mdns');

  // urls is already ordered public -> ip -> mdns, so the first entry is the preferred QR target.
  const qrUrl = urls[0]?.url ?? origin('localhost');
  return { hostname: config.hostname, urls, qrUrl, qrSvg: qrSvg(qrUrl) };
}

/** Recomputed on every call so a new DHCP lease shows up without a restart (F-39, Kap. 10.6). */
export function getNetInfo(config: Config): NetInfo {
  return buildNetInfo(config, selectLanAddresses(os.networkInterfaces()));
}
