'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StationClient } = require('../src/main/station');

test('avatar uses default key while chat and speech retain separate keys', () => {
  const client = new StationClient({ apiKey: 'default-test', chatKey: 'chat-test', ttsKey: 'tts-test' });
  assert.equal(client.keyFor(), 'default-test');
  assert.equal(client.keyFor('chat'), 'chat-test');
  assert.equal(client.keyFor('tts'), 'tts-test');
});

test('SRT transcription reads text response without JSON parsing', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'digitalhuman-asr-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const audio = path.join(dir, 'test.wav');
  fs.writeFileSync(audio, Buffer.from('test-fixture'));
  const srt = '1\n00:00:00,000 --> 00:00:01,000\n测试字幕\n';
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer tts-test');
    return new Response(srt, { headers: { 'Content-Type': 'text/plain' } });
  });
  const client = new StationClient({ apiKey: 'default-test', ttsKey: 'tts-test' });
  assert.equal(await client.asr(audio), srt);
});

test('HTTP error never includes any configured key', async (t) => {
  const keys = ['default-test', 'chat-test', 'tts-test'];
  t.mock.method(globalThis, 'fetch', async () => new Response(keys.join(' '), { status: 400 }));
  const client = new StationClient({ apiKey: keys[0], chatKey: keys[1], ttsKey: keys[2] });
  await assert.rejects(client.request('/test'), (error) => {
    for (const key of keys) {
      assert.ok(!error.message.includes(key));
      assert.ok(!error.body.includes(key));
    }
    return true;
  });
});
