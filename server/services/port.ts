import net from 'node:net';

/**
 * Checks whether IPv4 0.0.0.0:<port> can be bound, returning the error code (EADDRINUSE, EACCES, …) or null.
 *
 * Why: on Windows a dual-stack listen on "::" succeeds even while another program holds
 * 0.0.0.0:<port>; IPv4 clients would then silently reach that other program. Probing IPv4 first
 * turns this into the clear start error "Port … ist bereits belegt" (NF-24).
 */
export function probeIPv4Port(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', (err: NodeJS.ErrnoException) => resolve(err.code ?? 'UNKNOWN'));
    probe.listen({ port, host: '0.0.0.0', exclusive: true }, () => {
      probe.close(() => resolve(null));
    });
  });
}
