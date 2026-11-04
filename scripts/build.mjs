import { build } from 'esbuild';
import sharp from 'sharp';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const shared = {
  manifest_version: 3,
  name: '__MSG_extensionName__',
  version: pkg.version,
  description: '__MSG_extensionDescription__',
  permissions: ['storage'],
  default_locale: 'zh_CN',
  icons: Object.fromEntries([16, 32, 48, 128].map(size => [size, `icons/${size}.png`])),
  content_scripts: [{
    matches: ['https://www.bilibili.com/*'],
    js: ['content.js'],
    css: ['content.css'],
    run_at: 'document_idle',
    all_frames: false,
  }],
};

const bundle = await build({
  absWorkingDir: root,
  entryPoints: ['src/entry.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  target: ['chrome120', 'edge120', 'firefox140'],
  // Keep readable code for store reviewers; there are no runtime dependencies.
  minify: false,
  legalComments: 'inline',
  charset: 'utf8',
});

await rm(join(root, 'dist'), { recursive: true, force: true });
for (const browser of ['chromium', 'firefox']) {
  const output = join(root, 'dist', browser);
  await mkdir(join(output, 'icons'), { recursive: true });
  await mkdir(join(output, '_locales/zh_CN'), { recursive: true });
  await writeFile(join(output, '_locales/zh_CN/messages.json'), `${JSON.stringify({
    extensionName: { message: '超好用B站倍速助手' },
    extensionDescription: { message: '看视频，随你的节奏。原生菜单快捷选择 2.5× / 3×，滑动自定义 0.25–10×，星标收藏常用倍速，图钉固定跨视频默认速度，长按右箭头临时加速、松手恢复。轻巧、无广告、不收集数据的非官方 B 站倍速助手。' },
  }, null, 2)}\n`);
  const manifest = browser === 'firefox' ? {
    ...shared,
    browser_specific_settings: {
      gecko: {
        id: 'bili-speed-four@yfk.extensions',
        strict_min_version: '142.0',
        data_collection_permissions: { required: ['none'] },
      },
    },
  } : { ...shared, minimum_chrome_version: '120' };
  await writeFile(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(output, 'content.js'), bundle.outputFiles[0].contents);
  await writeFile(join(output, 'content.css'), await readFile(join(root, 'src/content.css')));
  await writeFile(join(output, 'LICENSE'), await readFile(join(root, 'LICENSE')));
  for (const size of [16, 32, 48, 128]) {
    await sharp(join(root, 'assets/icons/icon.svg')).resize(size, size).png().toFile(join(output, `icons/${size}.png`));
  }
  console.log(`Built dist/${browser} (${bundle.outputFiles[0].contents.length} bytes JS)`);
}
