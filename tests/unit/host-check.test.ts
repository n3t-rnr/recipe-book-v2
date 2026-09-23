import { describe, expect, it } from 'vitest';
import { isAllowedHost } from '../../server/middleware/host-check.ts';

const ALLOWED = ['kueche-pc', 'kueche-pc.local', 'kueche-pc.fritz.box'];

describe('isAllowedHost (NF-21)', () => {
  it.each([
    '192.168.178.99:8080',
    '192.168.178.99',
    '[fd00::5]:8080',
    '[fd00::5]',
    '[::1]:8080',
    'localhost:5173',
    'LOCALHOST',
    'kueche-pc',
    'KUECHE-PC.local',
    'kueche-pc.fritz.box',
    'kueche-pc.fritz.box:8080',
    '10.0.0.5',
  ])('allows %s', (host) => {
    expect(isAllowedHost(host, ALLOWED)).toBe(true);
  });

  it.each([
    'evil.example',
    'evil.example:8080',
    'kueche-pc.evil.example',
    '192.168.178.99.nip.io',
    'kueche-pc.local.evil',
    'localhost.evil.example',
    '',
    ':8080',
    'fd00::5',
    '[fd00::5',
    '[evil.example]:8080',
    '[fd00::5]evil',
    'kueche-pc:abc',
    'kueche-pc:',
    '999.1.1.1',
  ])('rejects %j', (host) => {
    expect(isAllowedHost(host, ALLOWED)).toBe(false);
  });

  it('matches configured names case-insensitively on both sides', () => {
    expect(isAllowedHost('rezepte.fritz.box', ['Rezepte.Fritz.Box'])).toBe(true);
  });

  it('does not depend on any startup IP list', () => {
    expect(isAllowedHost('172.16.4.2:8080', [])).toBe(true);
    expect(isAllowedHost('kueche-pc', [])).toBe(false);
  });
});
