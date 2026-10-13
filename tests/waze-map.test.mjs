import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../clients/mobile/node_modules/typescript/lib/typescript.js';

const module = { exports: {} };
const code = ts.transpileModule(fs.readFileSync(new URL('../clients/mobile/config/waze.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(code, { module, exports: module.exports, URL, process: { env: {} } });
const { buildWazeMapUrl, isWazeMapNavigation, wazePlaceLabel } = module.exports;

test('configured Waze map retains locale and zoom but strips identity and arbitrary parameters', () => {
  const url = new URL(buildWazeMapUrl(39.1, -76.6, 'https://embed.waze.com/fr/iframe?zoom=16&name=Keona&label=Keona&avatar=private&chatId=private&desc=1#Keona'));
  assert.equal(url.pathname, '/fr/iframe');
  assert.equal(url.hash, '');
  assert.deepEqual([...url.searchParams], [['zoom', '16'], ['lat', '39.1'], ['lon', '-76.6'], ['pin', '1']]);
});
test('Waze rejects invalid coordinates and unexpected destinations', () => {
  for (const [lat, lon] of [[NaN, 1], [91, 1], [1, -181], [Infinity, 1]]) assert.throws(() => buildWazeMapUrl(lat, lon));
  for (const url of ['https://example.com/iframe', 'http://embed.waze.com/iframe', 'https://embed.waze.com.evil.test/iframe', 'https://embed.waze.com:444/iframe', 'https://user:pass@embed.waze.com/iframe', 'https://embed.waze.com/other']) assert.throws(() => buildWazeMapUrl(0, 0, url));
  assert.equal(new URL(buildWazeMapUrl(0, 0, 'https://embed.waze.com/iframe?zoom=99')).searchParams.get('zoom'), '14');
});
test('map navigation remains in the configured Waze embed origin', () => {
  assert.equal(isWazeMapNavigation('https://embed.waze.com/iframe?pin=1'), true);
  for (const url of ['https://example.com', 'waze://', 'https://embed.waze.com.evil.test', 'http://embed.waze.com', 'https://embed.waze.com:444/iframe']) assert.equal(isWazeMapNavigation(url), false);
});

test('named pin uses the place or address and hides contact names in shared labels', () => {
  assert.equal(wazePlaceLabel('Warwickshire Ln', 'Home', 'Keona'), 'Warwickshire Ln');
  assert.equal(wazePlaceLabel(undefined, 'North gate', 'Keona'), 'North gate');
  assert.equal(wazePlaceLabel(undefined, "Keona’s home", 'Keona'), 'Shared location');
  assert.equal(wazePlaceLabel('KEONA SMITH residence', undefined, 'Keona Smith'), 'Shared location');
  assert.equal(wazePlaceLabel(undefined, undefined, 'Keona'), 'Shared location');
});
