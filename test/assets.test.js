import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import vm from 'node:vm';
const root = new URL('../dist/', import.meta.url);

test('offline cache and manifest reference real local assets', () => {
  const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', root)));
  for (const icon of manifest.icons) assert.ok(existsSync(new URL(icon.src, root)));
  const sw = readFileSync(new URL('sw.js', root), 'utf8');
  const handlers = {};
  vm.runInNewContext(sw, {self: {addEventListener: (name, fn) => {handlers[name] = fn;}}});
  for (const name of ['install', 'activate', 'fetch']) assert.equal(typeof handlers[name], 'function');
  const files = [...sw.matchAll(/'\.\/([^']+)'/g)].map(match => match[1]);
  for (const file of files) assert.ok(existsSync(new URL(file, root)), file);
});

test('HTML has labels, a Russian locale, local scripts and a restrictive CSP', () => {
  const html = readFileSync(new URL('index.html', root), 'utf8');
  assert.ok(html.includes('lang="ru"'));
  assert.ok(html.includes('Content-Security-Policy'));
  assert.ok(html.includes("object-src 'none'"));
  assert.ok(html.includes('<label for="task-title"'));
  assert.ok(html.includes('<label for="thought"'));
  for (const match of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)) assert.ok(existsSync(new URL(match[1], root)), match[1]);
  const app = readFileSync(new URL('app.js', root), 'utf8');
  assert.ok(!app.includes('innerHTML'));
  assert.ok(!app.includes('eval('));
});
