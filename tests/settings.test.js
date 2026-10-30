'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
let available = true;
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron') return { safeStorage: {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => 'test',
    encryptString: (value) => Buffer.from([...value].reverse().join('')),
    decryptString: (value) => [...value.toString()].reverse().join(''),
  } };
  return originalLoad.call(this, name, ...args);
};
const settings = require('../src/main/settings');
Module._load = originalLoad;

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'digitalhuman-settings-'));
  t.after(() => { available = true; fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

test('keys round-trip without plaintext in settings file', (t) => {
  const dir = fixture(t);
  settings.save(dir, { apiKey: 'test-only-key', baseUrl: 'https://example.invalid/v1' });
  const raw = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
  assert.ok(!raw.includes('test-only-key'));
  assert.equal(JSON.parse(raw).apiKey, undefined);
  assert.equal(settings.load(dir).apiKey, 'test-only-key');
  assert.equal(settings.load(dir).baseUrl, 'https://example.invalid/v1');
});

test('legacy plaintext keys migrate on load', (t) => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ chatKey: 'legacy-test-key' }));
  assert.equal(settings.load(dir).chatKey, 'legacy-test-key');
  assert.ok(!fs.readFileSync(path.join(dir, 'settings.json'), 'utf8').includes('legacy-test-key'));
});

test('unavailable encryption refuses key persistence', (t) => {
  const dir = fixture(t);
  available = false;
  assert.throws(() => settings.save(dir, { apiKey: 'test-only-key' }), /安全存储/);
  assert.ok(!fs.existsSync(path.join(dir, 'settings.json')));
});

test('invalid settings do not silently overwrite saved data', (t) => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'settings.json'), '{invalid');
  assert.throws(() => settings.save(dir, { apiKey: '' }), /设置文件/);
  assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), '{invalid');
});
