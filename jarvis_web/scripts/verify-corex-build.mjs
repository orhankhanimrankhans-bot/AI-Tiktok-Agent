import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// No login, cookies, environment dump or workspace requests. Safe to run against a public origin.
const dist = fileURLToPath(new URL('../client/dist/', import.meta.url));
const expected = JSON.parse(await fs.readFile(new URL('../shared/buildVersion.json', import.meta.url), 'utf8'));
const origin = process.argv[2] ? new URL(process.argv[2]) : null;
if (origin && (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' || !['http:', 'https:'].includes(origin.protocol))) {
  throw new Error('Supply only the public HTTP(S) origin without credentials, paths or query parameters.');
}
const headersToReport = ['cache-control', 'etag', 'last-modified', 'age', 'via', 'x-cache', 'cf-cache-status', 'x-hcdn-cache-status', 'content-type'];
async function read(resource) {
  if (!origin) return { bytes: await fs.readFile(path.join(dist, resource.replace(/^\//, '') || 'index.html')), headers: {} };
  const url = new URL(resource, origin);
  url.searchParams.set('corex_build_check', String(Date.now()));
  const response = await fetch(url, { redirect: 'error', headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${resource}`);
  return { bytes: Buffer.from(await response.arrayBuffer()), headers: Object.fromEntries(headersToReport.map(name => [name, response.headers.get(name)])) };
}
try {
  const shell = await read('/');
  const html = shell.bytes.toString();
  const htmlVersion = html.match(/name="corex-build"\s+content="([A-Za-z0-9._-]{1,80})"/)?.[1] || 'unavailable';
  const metadata = JSON.parse((await read('/build.json')).bytes);
  const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[A-Za-z0-9._-]+\.(?:js|css))"/g)].map(match => match[1]))];
  const checked = [];
  for (const asset of assets) {
    const result = await read(asset);
    const text = result.bytes.toString();
    checked.push({ asset, sha256: createHash('sha256').update(result.bytes).digest('hex'), headers: result.headers,
      ...(asset.endsWith('.js') ? { marker: text.includes(expected.version), setupControls: ['Meta App ID / Client ID', 'Meta App Secret', 'Save & Connect Meta Account'].every(label => text.includes(label)), oldLabel: text.includes('Managed Meta OAuth2') } : {}) });
  }
  let backend;
  if (origin) {
    const result = await read('/api/system/build');
    const data = JSON.parse(result.bytes);
    backend = { versionMatches: data.version === expected.version, clientBuildMatches: data.clientBuild === expected.version, metaSetupMatches: data.metaSetupVersion === expected.metaSetupVersion, headers: result.headers };
  }
  const passed = htmlVersion === expected.version && metadata.version === expected.version && checked.some(asset => asset.marker && asset.setupControls && !asset.oldLabel)
    && (!backend || (backend.versionMatches && backend.clientBuildMatches && backend.metaSetupMatches));
  console.log(JSON.stringify({ expectedVersion: expected.version, htmlVersion, metadataMatches: metadata.version === expected.version, htmlHeaders: shell.headers, assets: checked, backend, passed }, null, 2));
  if (!passed) process.exitCode = 1;
} catch (error) {
  console.error(error.message.startsWith('HTTP ') ? error.message : 'Build verification failed: missing/unreadable artifacts, a redirect, or an unavailable endpoint. Inspect the public HTTP status and deployment path.');
  process.exitCode = 1;
}
