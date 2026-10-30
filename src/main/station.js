'use strict';
/**
 * 中转站客户端（Node 内置 fetch，无第三方依赖）
 *
 *   POST /v1/chat/completions       写口播稿
 *   POST /v1/audio/speech           文字转语音
 *   POST /v1/audio/transcriptions   音频转文本
 *   POST /v1/videos                 形象数字人（异步任务）
 *   GET  /v1/videos/{id}            查询任务
 *   GET  /v1/videos/{id}/content    下载成片
 */

const fs = require('node:fs');
const path = require('node:path');

const STATION_HOME = 'https://api.openapi.cn';
const DEFAULT_BASE_URL = 'https://api.openapi.cn/v1';
const DEFAULT_CHAT_MODEL = 'deepseek-v4.1-flash';
const DEFAULT_TTS_MODEL = 'indextts2-v1';
const DEFAULT_AVATAR_MODEL = 'duix-avatar-v1';
const DEFAULT_ASR_MODEL = 'whisper-large-v3-turbo';

const POLL_INTERVAL_MS = 6000;
const POLL_TIMEOUT_MS = 1800 * 1000;

class StationError extends Error {
  constructor(message, status = 0, body = '') {
    super(message);
    this.name = 'StationError';
    this.status = status;
    this.body = body;
  }
}

function explain(status, body) {
  const detail = String(body || '').slice(0, 400);
  if (status === 503 && detail.includes('No available channel')) {
    return `底座返回 503：当前令牌分组没有该模型的可用渠道。请在 ${STATION_HOME} 确认令牌分组包含该模型。`;
  }
  if (status === 401) return `底座返回 401：API Key 无效或已过期。`;
  if (status === 402 || detail.toLowerCase().includes('insufficient')) {
    return `底座返回 ${status}：额度不足，请充值。`;
  }
  return `底座返回 ${status}：${detail}`;
}

class StationClient {
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.apiKey = String(options.apiKey || '').trim();
    this.chatKey = String(options.chatKey || '').trim() || this.apiKey;
    this.ttsKey = String(options.ttsKey || '').trim() || this.apiKey;
  }

  keyFor(kind) {
    const key = kind === 'chat' ? this.chatKey : kind === 'tts' ? this.ttsKey : this.apiKey;
    if (!key) {
      throw new StationError(`缺少 API Key。请到 ${STATION_HOME} 创建令牌后填入设置。`);
    }
    return key;
  }

  async request(pathname, { method = 'GET', body, headers = {}, key, raw = false, timeoutMs = 300000 } = {}) {
    const url = this.baseUrl + pathname;
    const finalHeaders = { Authorization: 'Bearer ' + this.keyFor(key), ...headers };
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: finalHeaders,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new StationError(`无法连接 ${this.baseUrl}：${error.message}`);
    }
    if (!response.ok) {
      let text = await response.text().catch(() => '');
      for (const secret of [this.apiKey, this.chatKey, this.ttsKey]) {
        if (secret) text = text.split(secret).join('[REDACTED]');
      }
      throw new StationError(explain(response.status, text), response.status, text);
    }
    if (raw) return Buffer.from(await response.arrayBuffer());
    return response.json();
  }

  async chat(messages, options = {}) {
    const payload = {
      model: options.model || DEFAULT_CHAT_MODEL,
      messages,
      temperature: options.temperature ?? 0.9,
      max_tokens: options.maxTokens ?? 1024,
    };
    const data = await this.request('/chat/completions', {
      method: 'POST',
      key: 'chat',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeoutMs: 180000,
    });
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new StationError('模型没有返回内容');
    return content;
  }

  async tts(text, voice, options = {}) {
    if (!String(text || '').trim()) throw new StationError('配音文本为空');
    const payload = {
      model: options.model || DEFAULT_TTS_MODEL,
      input: text,
      voice: await normalizeVoice(voice),
      response_format: options.responseFormat || 'mp3',
      speed: options.speed ?? 1.0,
    };
    return this.request('/audio/speech', {
      method: 'POST',
      key: 'tts',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      raw: true,
      timeoutMs: 600000,
    });
  }

  async asr(audioPath, options = {}) {
    if (!fs.existsSync(audioPath)) throw new StationError(`音频文件不存在：${audioPath}`);
    const form = new FormData();
    form.append('model', options.model || DEFAULT_ASR_MODEL);
    form.append('language', options.language || 'zh');
    form.append('response_format', options.responseFormat || 'srt');
    form.append('file', fileBlob(audioPath), path.basename(audioPath));
    const result = await this.request('/audio/transcriptions', {
      method: 'POST', key: 'tts', body: form, raw: options.responseFormat !== 'json', timeoutMs: 600000,
    });
    return Buffer.isBuffer(result) ? result.toString('utf8') : typeof result === 'string' ? result : JSON.stringify(result);
  }

  async submitAvatar(videoPath, audioPath, options = {}) {
    for (const file of [videoPath, audioPath]) {
      if (!fs.existsSync(file)) throw new StationError(`素材不存在：${file}`);
    }
    const form = new FormData();
    form.append('model', options.model || DEFAULT_AVATAR_MODEL);
    form.append('video', fileBlob(videoPath), path.basename(videoPath));
    form.append('audio', fileBlob(audioPath), path.basename(audioPath));
    // 提交接口会等 GPU 空闲（排队），耗时可能到十几分钟
    return this.request('/videos', { method: 'POST', body: form, timeoutMs: POLL_TIMEOUT_MS });
  }

  async getTask(taskId) {
    return this.request(`/videos/${encodeURIComponent(taskId)}`, { timeoutMs: 60000 });
  }

  async downloadTask(taskId, outPath) {
    const blob = await this.request(`/videos/${encodeURIComponent(taskId)}/content`, {
      raw: true, timeoutMs: 900000,
    });
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, blob);
    return outPath;
  }

  async waitAvatar(taskId, { onProgress, isCancelled } = {}) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      if (isCancelled && isCancelled()) throw new StationError('任务已取消');
      const state = await this.getTask(taskId);
      const status = String(state?.status || '').toLowerCase();
      if (onProgress) onProgress(state);
      if (['succeeded', 'success', 'completed'].includes(status)) return state;
      if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
        const detail = state?.error?.message || state?.error || state?.message || status;
        throw new StationError(`数字人任务失败：${detail}`);
      }
    }
    throw new StationError('数字人任务超时');
  }
}

function fileBlob(filePath) {
  return new Blob([fs.readFileSync(filePath)]);
}

async function normalizeVoice(voice) {
  const value = String(voice || '').trim();
  if (!value) throw new StationError('请先选择参考音频（3-10 秒人声）');
  if (/^(https?:|data:)/i.test(value)) return value;
  if (!fs.existsSync(value)) throw new StationError(`参考音频不存在：${value}`);
  const ext = path.extname(value).toLowerCase();
  const mime = ext === '.wav' ? 'audio/wav'
    : ext === '.m4a' ? 'audio/mp4'
      : ext === '.aac' ? 'audio/aac'
        : ext === '.flac' ? 'audio/flac'
          : ext === '.ogg' ? 'audio/ogg' : 'audio/mpeg';
  const base64 = fs.readFileSync(value).toString('base64');
  return `data:${mime};base64,${base64}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  StationClient,
  StationError,
  STATION_HOME,
  DEFAULT_BASE_URL,
  DEFAULT_CHAT_MODEL,
  DEFAULT_TTS_MODEL,
  DEFAULT_AVATAR_MODEL,
  DEFAULT_ASR_MODEL,
};

