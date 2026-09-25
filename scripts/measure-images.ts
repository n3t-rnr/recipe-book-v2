/**
 * NF-05 / F-15 measurement against a running server (M3 DoD): uploads photos one after another and
 * then two at a time, prints the round-trip time of every upload, the sizes of the three variants
 * and the /api/v1/health latency while images are being processed. Starts nothing itself.
 *
 *   node scripts/measure-images.ts --url http://localhost:8080 [--profile 1] [--fixture png60] [--count 6]
 *
 * --url      base URL of the running server (default http://localhost:8080)
 * --profile  X-Profile-Id for the uploads (default: the first profile of GET /api/v1/profiles)
 * --file     photo to upload; a real phone photo gives the meaningful sizes
 * --fixture  without --file, a synthetic input generated with sharp (tests/helpers/images.ts):
 *              portrait12        12-MP portrait JPEG, EXIF orientation 6, GPS (default)
 *              progressive10     progressive 4:4:4 JPEG 4000×2500, at the limit: runs alone
 *              progressive-over  progressive 4:4:4 JPEG 4001×2500: refused with 413 (NF-05)
 *              png60             RGBA PNG 9000×6600: runs alone
 *              png8              RGBA PNG 4000×2000: the largest PNG that shares the queue
 * --count    uploads per phase (default 6; the parallel phase runs count/2 pairs)
 *
 * Processing time and RSS come from the server log (NF-25): every job writes one line
 *   {"msg":"image processed","imageId":…,"inputBytes":…,"outputBytes":{"s":…,"m":…,"l":…},
 *    "width":…,"height":…,"exclusive":…,"durationMs":…,"waitMs":…,"rssMb":…,"maxRssMb":…}
 * durationMs is the sharp work of that job (target ≤ 2000), waitMs the time in the queue.
 * rssMb is the highest RSS of the process, sampled every 5 ms while the job ran (a parallel job
 * included; target ≤ 250 with two parallel uploads). maxRssMb is the peak working set of the whole
 * process since its start as Windows reports it (process.resourceUsage().maxRSS): it also catches
 * spikes shorter than 5 ms, but includes everything before the job. exclusive: the input is
 * expensive to decode (progressive JPEG, interlaced PNG or lossless WebP above 32 MB of buffer,
 * PNG/WebP above 8 MP, 16-bit PNG) and ran alone; see IMAGE_DECODE in shared/constants.ts.
 * In PowerShell:
 *   Select-String -Path data\logs\app.log -Pattern '"image processed"' | Select-Object -Last 20
 * Idle RSS (target ≤ 100 MB, user decision of 2026-09-24; 10 min after the last upload): Task
 * Manager → Details → node.exe → column "Working set (memory)" (German: „Arbeitssatz
 * (Arbeitsspeicher)“), or
 *   Get-Process node | Select-Object Id, @{ n = 'RSS MB'; e = { [math]::Round($_.WorkingSet64 / 1MB) } }
 *
 * Reference, dev PC (Windows 11, Node 24.14, sharp 0.35.4) on 2026-09-24: idle 100 MB in the
 * first seconds, 86 MB after 10 s; RSS drifts up by up to 45 MB over repeated jobs. rssMb per job
 * (maxRssMb): portrait12 123–144 alone, 161–164 as a pair; progressive10 181–228 (230); png60
 * 191–233 (236); 16-bit RGBA PNG 60 MP 221–242 (243); png8 as a pair 181–211 (212); two
 * progressive 5.3-MP JPEGs (shared) 185–204 (210). Without the limits a 60-MP progressive JPEG
 * needed 456 MB and two 60-MP RGBA PNGs 288 MB.
 * The uploaded images stay unassigned and are removed by the maintenance after 7 days (F-16).
 */
import fs from 'node:fs';
import { parseArgs } from 'node:util';

interface UploadResult {
  imageId: number;
  urls: { s: string; m: string; l: string };
  width: number;
  height: number;
}

interface Measured {
  ms: number;
  status: number;
  image: UploadResult | null;
  sizes: { s: number; m: number; l: number } | null;
  error: string | null;
}

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:8080' },
    profile: { type: 'string' },
    file: { type: 'string' },
    fixture: { type: 'string', default: 'portrait12' },
    count: { type: 'string', default: '6' },
  },
});

const base = (values.url ?? 'http://localhost:8080').replace(/\/+$/, '');
const count = Math.max(1, Number.parseInt(values.count ?? '6', 10) || 6);

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function stats(list: number[]): string {
  if (list.length === 0) return '–';
  const sorted = [...list].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return `median ${median.toFixed(0)} ms, max ${(sorted[sorted.length - 1] ?? 0).toFixed(0)} ms`;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function resolveProfile(): Promise<string> {
  if (values.profile) return values.profile;
  const { profiles } = await getJson<{ profiles: Array<{ id: number; name: string }> }>('/api/v1/profiles');
  const first = profiles[0];
  if (!first)
    throw new Error(
      'Kein Profil vorhanden – bitte zuerst in der App ein Profil anlegen oder --profile angeben.',
    );
  console.log(`Profil: ${first.name} (id ${first.id})`);
  return String(first.id);
}

async function loadPhoto(): Promise<{ data: Uint8Array; label: string; type: string }> {
  if (values.file) {
    // The server decides by the magic bytes, not by the Content-Type (Kap. 4.6).
    const data = new Uint8Array(fs.readFileSync(values.file));
    return { data, label: values.file, type: 'application/octet-stream' };
  }
  // Dev tool: the same generators as the tests (only sharp and node:zlib, no test framework).
  const fixtures = await import('../tests/helpers/images.ts');
  const make: Record<string, { label: string; type: string; data: () => Promise<Buffer> }> = {
    portrait12: {
      label: 'synthetisches 12-MP-Hochkantfoto (EXIF 6, GPS)',
      type: 'image/jpeg',
      data: fixtures.portraitPhoto12mp,
    },
    progressive10: {
      label: 'progressives JPEG 4:4:4, 4000×2500 (Grenze, läuft allein)',
      type: 'image/jpeg',
      data: () => fixtures.progressiveJpeg(4000, 2500),
    },
    'progressive-over': {
      label: 'progressives JPEG 4:4:4, 4001×2500 (über der Grenze, 413 erwartet)',
      type: 'image/jpeg',
      data: () => fixtures.progressiveJpeg(4001, 2500),
    },
    png60: {
      label: 'RGBA-PNG 9000×6600 (läuft allein)',
      type: 'image/png',
      data: () => fixtures.photoPng(9000, 6600),
    },
    png8: {
      label: 'RGBA-PNG 4000×2000 (größtes PNG, das die Warteschlange teilt)',
      type: 'image/png',
      data: () => fixtures.photoPng(4000, 2000),
    },
  };
  const name = values.fixture ?? 'portrait12';
  const fixture = make[name];
  if (!fixture) throw new Error(`Unbekannte --fixture „${name}“: ${Object.keys(make).join(', ')}`);
  return { data: new Uint8Array(await fixture.data()), label: fixture.label, type: fixture.type };
}

async function variantSize(url: string): Promise<number> {
  const res = await fetch(`${base}${url}`, { method: 'HEAD' });
  return Number(res.headers.get('content-length') ?? 0);
}

async function uploadOnce(photo: { data: Uint8Array; type: string }, profileId: string): Promise<Measured> {
  const started = performance.now();
  const res = await fetch(`${base}/api/v1/images`, {
    method: 'POST',
    headers: { 'X-Rezepte-Client': '1', 'X-Profile-Id': profileId, 'Content-Type': photo.type },
    body: photo.data,
  });
  const ms = performance.now() - started;
  const text = await res.text();
  if (res.status !== 201) return { ms, status: res.status, image: null, sizes: null, error: text };
  const image = JSON.parse(text) as UploadResult;
  const [s, m, l] = await Promise.all([
    variantSize(image.urls.s),
    variantSize(image.urls.m),
    variantSize(image.urls.l),
  ]);
  return { ms, status: res.status, image, sizes: { s, m, l }, error: null };
}

function report(label: string, result: Measured): void {
  if (!result.image || !result.sizes) {
    console.log(`  ${label}: ${result.status} nach ${result.ms.toFixed(0)} ms – ${result.error ?? ''}`);
    return;
  }
  const { image, sizes } = result;
  console.log(
    `  ${label}: ${result.ms.toFixed(0)} ms · Bild ${image.imageId} ${image.width}×${image.height} · ` +
      `s ${kb(sizes.s)} · m ${kb(sizes.m)} · l ${kb(sizes.l)}`,
  );
}

/** Polls /api/v1/health every 100 ms until stop() and records the response times (NF-05: ≤ 200 ms). */
function pollHealth(): { stop: () => Promise<number[]> } {
  const times: number[] = [];
  let running = true;
  const loop = (async () => {
    while (running) {
      const started = performance.now();
      await fetch(`${base}/api/v1/health`).then((r) => r.arrayBuffer());
      times.push(performance.now() - started);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  })();
  return {
    stop: async () => {
      running = false;
      await loop;
      return times;
    },
  };
}

async function main(): Promise<void> {
  const health = await getJson<{
    status: string;
    images: string;
    freeDiskBytes: number | null;
    version: string;
  }>('/api/v1/health');
  console.log(`Server ${base}: Version ${health.version}, Status ${health.status}, Bilder ${health.images}`);
  if (health.images !== 'ok') throw new Error('Bildverarbeitung ist auf dem Server nicht verfügbar.');

  const profileId = await resolveProfile();
  const photo = await loadPhoto();
  console.log(`Foto: ${photo.label}, ${(photo.data.byteLength / 1_048_576).toFixed(2)} MiB\n`);

  const sequential: number[] = [];
  console.log(`Nacheinander (${count} Uploads):`);
  for (let i = 1; i <= count; i++) {
    const result = await uploadOnce(photo, profileId);
    report(`#${i}`, result);
    if (result.image) sequential.push(result.ms);
  }

  const parallel: number[] = [];
  const pairs = Math.max(1, Math.floor(count / 2));
  console.log(`\nZwei gleichzeitig (${pairs} Paare), /health wird dabei alle 100 ms abgefragt:`);
  const poll = pollHealth();
  for (let i = 1; i <= pairs; i++) {
    const results = await Promise.all([uploadOnce(photo, profileId), uploadOnce(photo, profileId)]);
    results.forEach((result, j) => {
      report(`Paar ${i}/${j + 1}`, result);
      if (result.image) parallel.push(result.ms);
    });
  }
  const healthTimes = await poll.stop();

  console.log('\nZusammenfassung (Rundlaufzeit am Client, inkl. Übertragung):');
  console.log(`  nacheinander:  ${stats(sequential)}`);
  console.log(`  zu zweit:      ${stats(parallel)}`);
  console.log(`  /health:       ${stats(healthTimes)} (${healthTimes.length} Abfragen, Ziel ≤ 200 ms)`);
  console.log(
    '\nVerarbeitungszeit (durationMs) und RSS-Spitze (rssMb, Ziel ≤ 250 MB; maxRssMb) stehen je Upload im Server-Log:',
  );
  console.log(
    `  Select-String -Path data\\logs\\app.log -Pattern '"image processed"' | Select-Object -Last ${count * 2}`,
  );
  console.log(
    'Leerlauf-RSS (Ziel ≤ 100 MB) 10 min nach dem letzten Upload: Task-Manager → Details → node.exe → Spalte „Arbeitssatz (Arbeitsspeicher)“',
  );
  console.log(
    "  oder: Get-Process node | Select-Object Id, @{ n = 'RSS MB'; e = { [math]::Round($_.WorkingSet64 / 1MB) } }",
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
