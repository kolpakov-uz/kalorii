import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const html = read('index.html');
let count = 0;
for (const [, attributes, code] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/\bsrc\s*=|\btype\s*=\s*["'](?:module|application\/ld\+json)["']/i.test(attributes)) continue;
  new Script(code, { filename: `index.html (script ${++count})` });
}
if (!count) throw new Error('No application script found');
for (const [, attributes, code] of read('keyboard-test.html').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (!/\bsrc\s*=/.test(attributes)) new Script(code, {filename: 'keyboard-test.html'});
}
new Script(read('sw.js'), { filename: 'sw.js' });
new Script(read('voice.js'), { filename: 'voice.js' });
new Script(read('notifications.js'), { filename: 'notifications.js' });
for (const file of ['telegram.js','telegram-access.js','diary-backup.js','diary-transfer.js','goal-progress.js','goal-ui.js']) new Script(read(file), {filename: file});
const manifest = JSON.parse(read('manifest.webmanifest'));
for (const { src } of manifest.icons) {
  if (!existsSync(fileURLToPath(new URL(src, root)))) throw new Error(`Missing icon: ${src}`);
}
for (const file of ['assets/branding/logo.svg','assets/branding/logo-dark.svg','favicon.ico','favicon.svg','favicon-32.png','apple-touch-icon.png','badge-96.png']) {
  if (!existsSync(fileURLToPath(new URL(file, root)))) throw new Error(`Missing branding asset: ${file}`);
}
if (!html.includes('https://kalorii-ai.crytime04.workers.dev')) throw new Error('Unexpected Worker endpoint');
console.log('Application JavaScript, service worker, manifest and icons: OK');
