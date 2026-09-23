import type { NetworkInterfaceInfo } from 'node:os';
import qrcode from 'qrcode-generator';
import { describe, expect, it } from 'vitest';
import { buildNetInfo, qrAscii, selectLanAddresses } from '../../server/services/net-info.ts';

function v4(address: string, internal = false): NetworkInterfaceInfo {
  return {
    address,
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:11:22:33:44:55',
    internal,
    cidr: null,
  };
}

function v6(address: string): NetworkInterfaceInfo {
  return {
    address,
    netmask: 'ffff:ffff:ffff:ffff::',
    family: 'IPv6',
    mac: '00:11:22:33:44:55',
    internal: false,
    cidr: null,
    scopeid: 0,
  };
}

/** A typical Windows 11 PC with WSL, VirtualBox, Wi-Fi and a mobile hotspot adapter. */
const WINDOWS_PC: NodeJS.Dict<NetworkInterfaceInfo[]> = {
  'vEthernet (WSL)': [v4('172.29.16.1'), v6('fe80::a1')],
  WLAN: [v6('fe80::1'), v6('fd00::5'), v4('10.0.0.7')],
  'VirtualBox Host-Only Network': [v4('192.168.56.1')],
  'Loopback Pseudo-Interface 1': [v4('127.0.0.1', true)],
  Ethernet: [v6('fe80::1'), v4('169.254.10.10'), v4('192.168.178.20')],
  Mobilfunk: [v4('100.64.1.2')],
  'LAN-Verbindung* 2': [v4('192.168.137.1')],
};

describe('selectLanAddresses', () => {
  it('keeps only private IPv4 addresses of physical adapters, Ethernet 192.168 first', () => {
    expect(selectLanAddresses(WINDOWS_PC)).toEqual(['192.168.178.20', '10.0.0.7']);
  });

  it('drops loopback, link-local, CGNAT and all IPv6 addresses', () => {
    const result = selectLanAddresses(WINDOWS_PC);
    for (const dropped of ['127.0.0.1', '169.254.10.10', '100.64.1.2', 'fe80::1', 'fd00::5']) {
      expect(result).not.toContain(dropped);
    }
  });

  it('drops virtual adapters by name', () => {
    const result = selectLanAddresses(WINDOWS_PC);
    expect(result).not.toContain('172.29.16.1'); // vEthernet (WSL)
    expect(result).not.toContain('192.168.56.1'); // VirtualBox
    expect(result).not.toContain('192.168.137.1'); // Windows hotspot miniport

    const more = selectLanAddresses({
      'VMware Network Adapter VMnet8': [v4('192.168.80.1')],
      'vEthernet (Default Switch)': [v4('172.18.0.1')],
      'Ethernet 3 (Hyper-V)': [v4('192.168.10.2')],
      'OpenVPN TAP-Windows6': [v4('10.8.0.2')],
      Tailscale: [v4('100.101.1.1')],
      'Bluetooth-Netzwerkverbindung': [v4('192.168.44.1')],
      'Npcap Loopback Adapter': [v4('169.254.1.1')],
    });
    expect(more).toEqual([]);
  });

  it('ignores internal addresses even in private ranges', () => {
    expect(selectLanAddresses({ Ethernet: [v4('192.168.1.5', true)] })).toEqual([]);
  });

  it('applies the 172.16/12 boundaries exactly', () => {
    const result = selectLanAddresses({
      Ethernet: [v4('172.15.255.1'), v4('172.16.0.1'), v4('172.31.255.1'), v4('172.32.0.1')],
    });
    expect(result).toEqual(['172.16.0.1', '172.31.255.1']);
  });

  it('orders physical adapters first, then 192.168 before 10 before 172', () => {
    const result = selectLanAddresses({
      'USB-Adapter': [v4('192.168.1.9')],
      'Ethernet 2': [v4('172.20.0.5')],
      'Wi-Fi': [v4('10.0.0.7')],
      Ethernet: [v4('192.168.178.20')],
    });
    expect(result).toEqual(['192.168.178.20', '10.0.0.7', '172.20.0.5', '192.168.1.9']);
  });

  it('lists an address only once', () => {
    const result = selectLanAddresses({
      Adapter: [v4('192.168.178.20')],
      Ethernet: [v4('192.168.178.20'), v4('192.168.178.20')],
    });
    expect(result).toEqual(['192.168.178.20']);
  });

  it('copes with missing adapter lists', () => {
    expect(selectLanAddresses({ Ethernet: undefined })).toEqual([]);
  });
});

const BASE = { port: 8080, publicUrl: null, hostname: 'kueche-pc' };

/** Reads the dark modules back out of the SVG path (runs of "M x y h n v1 h-n z"). */
function svgModules(svg: string): Set<string> {
  const dark = new Set<string>();
  for (const m of svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const x = Number(m[1]);
    const y = Number(m[2]);
    for (let i = 0; i < Number(m[3]); i++) dark.add(`${x + i},${y}`);
  }
  return dark;
}

/** Dark modules of the reference encoding, shifted by the 4-module quiet zone. */
function referenceModules(payload: string): { size: number; dark: Set<string> } {
  const qr = qrcode(0, 'M');
  qr.addData(payload);
  qr.make();
  const count = qr.getModuleCount();
  const dark = new Set<string>();
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) dark.add(`${col + 4},${row + 4}`);
    }
  }
  return { size: count + 8, dark };
}

describe('buildNetInfo', () => {
  it('orders urls public -> ip -> mdns and puts PUBLIC_URL into the QR code', () => {
    const info = buildNetInfo({ ...BASE, publicUrl: 'http://rezepte.fritz.box:8080/' }, [
      '192.168.178.20',
      '10.0.0.7',
    ]);
    expect(info.hostname).toBe('kueche-pc');
    expect(info.urls).toEqual([
      { url: 'http://rezepte.fritz.box:8080', kind: 'public' },
      { url: 'http://192.168.178.20:8080', kind: 'ip' },
      { url: 'http://10.0.0.7:8080', kind: 'ip' },
      { url: 'http://kueche-pc.local:8080', kind: 'mdns' },
    ]);
    expect(info.qrUrl).toBe('http://rezepte.fritz.box:8080');
  });

  it('uses the first IP url for the QR code without PUBLIC_URL', () => {
    const info = buildNetInfo(BASE, ['192.168.178.20', '10.0.0.7']);
    expect(info.qrUrl).toBe('http://192.168.178.20:8080');
    expect(info.urls[0]).toEqual({ url: 'http://192.168.178.20:8080', kind: 'ip' });
  });

  it('falls back to the mDNS url when no LAN address exists', () => {
    const info = buildNetInfo(BASE, []);
    expect(info.urls).toEqual([{ url: 'http://kueche-pc.local:8080', kind: 'mdns' }]);
    expect(info.qrUrl).toBe('http://kueche-pc.local:8080');
  });

  it('omits the default port 80', () => {
    const info = buildNetInfo({ ...BASE, port: 80 }, ['192.168.178.20']);
    expect(info.urls.map((u) => u.url)).toEqual(['http://192.168.178.20', 'http://kueche-pc.local']);
    expect(info.qrUrl).toBe('http://192.168.178.20');
  });

  it('never lists the bare NetBIOS name and always writes out http://', () => {
    const info = buildNetInfo(BASE, ['192.168.178.20']);
    for (const { url } of info.urls) {
      expect(url.startsWith('http://')).toBe(true);
      expect(new URL(url).hostname).not.toBe('kueche-pc');
    }
    expect(info.qrUrl.startsWith('http://')).toBe(true);
  });

  it('does not double a .local host name', () => {
    const info = buildNetInfo({ ...BASE, hostname: 'macbook.local' }, []);
    expect(info.urls).toEqual([{ url: 'http://macbook.local:8080', kind: 'mdns' }]);
  });

  it('does not list PUBLIC_URL twice when it names a LAN address', () => {
    const info = buildNetInfo({ ...BASE, publicUrl: 'http://192.168.178.20:8080' }, ['192.168.178.20']);
    expect(info.urls.map((u) => u.kind)).toEqual(['public', 'mdns']);
  });

  it('renders a CSP-safe SVG QR code with a 4-module quiet zone', () => {
    const info = buildNetInfo(BASE, ['192.168.178.20']);
    const svg = info.qrSvg;
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).not.toContain('style=');
    expect(svg).not.toContain('<script');
    expect(svg).toContain('aria-label="QR-Code: http://192.168.178.20:8080"');
    expect(svg).toContain('fill="#FFFFFF"');
    expect(svg).toContain('fill="#000000"');

    const reference = referenceModules(info.qrUrl);
    expect(svg).toContain(`viewBox="0 0 ${reference.size} ${reference.size}"`);
    expect(svgModules(svg)).toEqual(reference.dark);
  });

  it('escapes the url in the aria-label', () => {
    const info = buildNetInfo({ ...BASE, publicUrl: 'http://rezepte.fritz.box/?a=1&b="2"' }, []);
    expect(info.qrSvg).toContain('aria-label="QR-Code: http://rezepte.fritz.box/?a=1&amp;b=&quot;2&quot;"');
  });

  it('encodes an umlaut PUBLIC_URL in its ASCII form, but lists it as configured', () => {
    const info = buildNetInfo({ ...BASE, publicUrl: 'http://rezepte.küche.box:8080' }, []);
    expect(info.qrUrl).toBe('http://rezepte.küche.box:8080');
    expect(svgModules(info.qrSvg)).toEqual(referenceModules('http://rezepte.xn--kche-0ra.box:8080/').dark);
  });
});

describe('qrAscii', () => {
  it('renders a multi-line block QR code', () => {
    const ascii = qrAscii('http://192.168.178.20:8080');
    const lines = ascii.split('\n');
    expect(lines.length).toBeGreaterThan(10);
    expect(new Set(lines.map((l) => l.length)).size).toBe(1);
    expect(ascii).toMatch(/^[█▀▄ \n]+$/);
  });
});
