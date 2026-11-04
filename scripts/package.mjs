import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const release = join(root, 'release');
await mkdir(release, { recursive: true });
const artifacts = [];
function zip(name, cwd, files) {
  const path = join(release, name);
  const result = spawnSync('zip', ['-X', '-q', '-r', path, ...files], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'zip failed; install the zip command first');
  artifacts.push(name);
}
for (const browser of ['chrome', 'edge', 'firefox']) {
  const name = `${pkg.name}-${browser}-${pkg.version}.zip`;
  await rm(join(release, name), { force: true });
  zip(name, join(root, 'dist', browser === 'firefox' ? 'firefox' : 'chromium'),
    ['manifest.json', 'content.js', 'content.css', 'icons', '_locales', 'LICENSE']);
}
const staging = join(release, '.source');
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
// Publish only reviewed documentation; local store receipts and browsing logs
// remain on the developer's machine even when packaging from that checkout.
for (const file of ['src', 'assets', 'scripts', 'tests',
  'docs/PUBLISHING.md', 'docs/TESTING.md',
  'docs/screenshots/menu-footer-single.png', 'docs/screenshots/menu-footer-pair.png',
  'docs/screenshots/menu-compact.png', 'docs/screenshots/custom-editor.png',
  'docs/screenshots/custom-editor-saved.png', 'package.json', 'package-lock.json',
  'tsconfig.json', 'playwright.config.ts', 'README.md', 'LICENSE', 'PRIVACY.md', '.gitignore']) {
  await mkdir(dirname(join(staging, file)), { recursive: true });
  await cp(join(root, file), join(staging, file), {
    recursive: true,
    filter: source => !source.endsWith('/.DS_Store'),
  });
}
const sourceName = `${pkg.name}-source-${pkg.version}.zip`;
await rm(join(release, sourceName), { force: true });
zip(sourceName, staging, ['.']);
await rm(staging, { recursive: true, force: true });
const sums = await Promise.all(artifacts.map(async name =>
  `${createHash('sha256').update(await readFile(join(release, name))).digest('hex')}  ${name}`));
await writeFile(join(release, 'SHA256SUMS'), `${sums.join('\n')}\n`);
console.log(artifacts.map(name => `release/${name}`).join('\n'));
