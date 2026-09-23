import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { probeIPv4Port } from '../../server/services/port.ts';

function listen(host: string, port = 0): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen({ port, host, exclusive: true }, () => resolve(server));
  });
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('probeIPv4Port (NF-24)', () => {
  it('returns null for a free port and releases it again', async () => {
    const holder = await listen('0.0.0.0');
    const port = (holder.address() as net.AddressInfo).port;
    await close(holder);
    expect(await probeIPv4Port(port)).toBeNull();
    // released: binding again works
    const again = await listen('0.0.0.0', port);
    await close(again);
  });

  it('reports EADDRINUSE while another program holds 0.0.0.0:<port>', async () => {
    const holder = await listen('0.0.0.0');
    const port = (holder.address() as net.AddressInfo).port;
    try {
      expect(await probeIPv4Port(port)).toBe('EADDRINUSE');
    } finally {
      await close(holder);
    }
  });
});
