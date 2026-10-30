'use strict';
/** 配置留在本机，Key 使用操作系统凭据存储加密。 */

const fs = require('node:fs');
const path = require('node:path');
const { safeStorage } = require('electron');

const DEFAULTS = {
  baseUrl: 'https://api.openapi.cn/v1',
  apiKey: '',
  chatKey: '',
  ttsKey: '',
  chatModel: 'deepseek-v4.1-flash',
  ttsModel: 'indextts2-v1',
  avatarModel: 'duix-avatar-v1',
  asrModel: 'whisper-large-v3-turbo',
  outputDir: '',
  makeSubtitles: true,
};

function filePath(userDataDir) {
  return path.join(userDataDir, 'settings.json');
}

const SECRETS = ['apiKey', 'chatKey', 'ttsKey'];

function requireEncryption() {
  if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
    throw new Error('系统安全存储不可用，无法保存或读取 API Key。请启用系统凭据存储后重试。');
  }
}

function persist(dir, settings) {
  const stored = { ...settings, encryptedKeys: {} };
  for (const field of SECRETS) {
    const value = String(settings[field] || '');
    delete stored[field];
    if (value) {
      requireEncryption();
      stored.encryptedKeys[field] = safeStorage.encryptString(value).toString('base64');
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  const temp = filePath(dir) + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(stored, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, filePath(dir));
}

function load(userDataDir) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath(userDataDir), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { ...DEFAULTS };
    throw new Error('无法读取本机设置文件，请检查 settings.json 格式与权限。');
  }
  const settings = { ...DEFAULTS };
  for (const field of Object.keys(DEFAULTS)) {
    if (Object.hasOwn(raw, field)) settings[field] = raw[field];
  }
  for (const field of SECRETS) {
    if (raw.encryptedKeys?.[field]) {
      requireEncryption();
      try { settings[field] = safeStorage.decryptString(Buffer.from(raw.encryptedKeys[field], 'base64')); }
      catch { throw new Error('无法解密本机 API Key，请使用保存设置时的系统账户。'); }
    }
  }
  if (SECRETS.some((field) => Boolean(raw[field]))) persist(userDataDir, settings);
  return settings;
}

function save(userDataDir, patch) {
  const merged = load(userDataDir);
  for (const field of Object.keys(DEFAULTS)) {
    if (Object.hasOwn(patch || {}, field)) merged[field] = patch[field];
  }
  persist(userDataDir, merged);
  return merged;
}

module.exports = { DEFAULTS, load, save };

