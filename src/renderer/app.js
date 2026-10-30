'use strict';
/** 渲染进程：界面逻辑 */

const $ = (id) => document.getElementById(id);

const STAGE_WEIGHTS = { script: 0.10, voice: 0.25, subtitle: 0.10, avatar: 0.45, download: 0.10 };
const STAGE_LABELS = {
  script: '写口播稿', voice: '合成配音', subtitle: '生成字幕',
  avatar: '数字人渲染', download: '下载成片',
};

const state = {
  settings: null,
  stationHome: 'https://api.openapi.cn',
  portrait: '',
  voiceRef: '',
  audio: '',
  running: false,
  result: {},
  stageValues: {},
};

/* ------------------------------------------------------------ 初始化 */
async function init() {
  const info = await window.api.getSettings();
  state.settings = info.settings;
  state.stationHome = info.stationHome;
  $('station-link').href = state.stationHome;
  $('station-link').textContent = state.stationHome.replace(/^https?:\/\//, '');
  fillSettingsForm(info.settings, info.defaultOutputDir);
  bind();
  log('就绪。云端任务按所选服务的额度与规则执行。', 'ok');
  if (!info.settings.apiKey) $('settings-mask').hidden = false;
}

function fillSettingsForm(settings, defaultOutputDir) {
  $('set-base-url').value = settings.baseUrl || '';
  $('set-api-key').value = settings.apiKey || '';
  $('set-chat-key').value = settings.chatKey || '';
  $('set-tts-key').value = settings.ttsKey || '';
  $('set-chat-model').value = settings.chatModel || '';
  $('set-tts-model').value = settings.ttsModel || '';
  $('set-avatar-model').value = settings.avatarModel || '';
  $('set-asr-model').value = settings.asrModel || '';
  $('set-output').value = settings.outputDir || '';
  $('set-output').placeholder = '默认：' + defaultOutputDir;
}

/* ------------------------------------------------------------ 交互绑定 */
function bind() {
  $('btn-settings').onclick = () => { $('settings-mask').hidden = false; };
  $('btn-close').onclick = () => { $('settings-mask').hidden = true; };
  $('settings-mask').onclick = (event) => {
    if (event.target === $('settings-mask')) $('settings-mask').hidden = true;
  };

  $('btn-save').onclick = async () => {
    try {
    state.settings = await window.api.saveSettings({
      baseUrl: $('set-base-url').value.trim(),
      apiKey: $('set-api-key').value.trim(),
      chatKey: $('set-chat-key').value.trim(),
      ttsKey: $('set-tts-key').value.trim(),
      chatModel: $('set-chat-model').value.trim(),
      ttsModel: $('set-tts-model').value.trim(),
      avatarModel: $('set-avatar-model').value.trim(),
      asrModel: $('set-asr-model').value.trim(),
      outputDir: $('set-output').value.trim(),
    });
    log('设置已保存', 'ok');
    $('settings-mask').hidden = true;
    } catch (error) { log('设置未保存：' + error.message, 'err'); }
  };

  $('btn-output').onclick = async () => {
    const dir = await window.api.pickDirectory();
    if (dir) $('set-output').value = dir;
  };

  $('btn-portrait').onclick = $('portrait-drop').onclick = () => pickPortrait();
  $('btn-voice').onclick = $('voice-drop').onclick = () => pickVoice();
  $('btn-portrait-clear').onclick = () => setPortrait('');
  $('btn-voice-clear').onclick = () => setVoice('');

  $('btn-write').onclick = writeScript;
  $('script').oninput = () => {
    $('script-count').textContent = $('script').value.trim().length + ' 字';
  };

  $('btn-start').onclick = startJob;
  $('btn-cancel').onclick = () => window.api.cancelJob();

  $('btn-open-folder').onclick = () => {
    const target = state.result.video || state.result.voiceover;
    if (target) window.api.openPath(target.replace(/[\\/][^\\/]*$/, ''));
  };
  $('btn-show-item').onclick = () => {
    if (state.result.video) window.api.showItem(state.result.video);
  };
  $('btn-open-video').onclick = () => {
    if (state.result.video) window.api.openPath(state.result.video);
  };

  window.api.onLog((message) => {
    const level = /失败|错误|跳过|不可用/.test(message) ? 'err' : '';
    log(message, level);
  });
  window.api.onProgress(({ stage, value }) => {
    state.stageValues[stage] = value;
    updateProgress(stage);
  });
  window.api.onTask(({ taskId }) => log('任务号：' + taskId));
  window.api.onStarted(() => setRunning(true));
  window.api.onDone((result) => { setRunning(false); showResult(result); });
  window.api.onError((message) => {
    setRunning(false);
    log('失败：' + message, 'err');
    $('progress-label').textContent = '失败';
  });
}

/* ------------------------------------------------------------ 素材 */
async function pickPortrait() {
  const file = await window.api.pickFile('portrait');
  if (file) setPortrait(file);
}

async function pickVoice() {
  const file = await window.api.pickFile('audio');
  if (file) setVoice(file);
}

function setPortrait(file) {
  state.portrait = file || '';
  $('portrait-name').textContent = file ? file : '未选择';
  const video = $('portrait-preview');
  $('portrait-empty').hidden = Boolean(file);
  if (file) {
    video.src = 'file:///' + file.replace(/\\/g, '/');
    video.hidden = false;
  } else {
    video.removeAttribute('src');
    video.hidden = true;
  }
}

function setVoice(file) {
  state.voiceRef = file || '';
  $('voice-name').textContent = file ? file : '未选择';
  $('voice-empty').hidden = Boolean(file);
  const audio = $('voice-preview');
  if (file) {
    audio.src = 'file:///' + file.replace(/\\/g, '/');
    audio.hidden = false;
  } else {
    audio.removeAttribute('src');
    audio.hidden = true;
  }
}

/* ------------------------------------------------------------ 写稿 */
async function writeScript() {
  const topic = $('topic').value.trim();
  if (!topic) { log('请先填写主题', 'err'); return; }
  $('btn-write').disabled = true;
  log('调用模型写稿…');
  const res = await window.api.generateText(topic);
  $('btn-write').disabled = false;
  if (res.ok) {
    $('script').value = res.script;
    $('script').dispatchEvent(new Event('input'));
    log('文案已生成', 'ok');
  } else {
    log('写稿失败：' + res.error, 'err');
  }
}

/* ------------------------------------------------------------ 任务 */
async function startJob() {
  const script = $('script').value.trim();
  const topic = $('topic').value.trim();
  if (!script && !topic) { log('请填写主题或文案', 'err'); return; }
  if (!state.portrait) { log('请先选择人像素材', 'err'); return; }
  if (!state.audio && !state.voiceRef) { log('需要参考音频才能生成配音', 'err'); return; }

  state.stageValues = {};
  state.result = {};
  $('log').textContent = '';
  $('result-video').hidden = true;
  $('result-empty').hidden = false;
  $('result-actions').hidden = true;
  $('result-paths').textContent = '';
  setRunning(true);

  const res = await window.api.startJob({
    topic,
    script,
    portrait: state.portrait,
    voiceRef: state.voiceRef,
    audio: state.audio,
    subtitles: $('subtitles').checked,
  });
  if (!res.ok) {
    setRunning(false);
    log('失败：' + res.error, 'err');
  }
}

function setRunning(running) {
  state.running = running;
  $('btn-start').disabled = running;
  $('btn-cancel').disabled = !running;
  $('btn-start').textContent = running ? '生成中…' : '开始生成';
  if (running) $('progress-label').textContent = '处理中';
}

function updateProgress(currentStage) {
  const order = ['script', 'voice', 'subtitle', 'avatar', 'download'];
  let total = 0;
  for (const stage of order) {
    const weight = STAGE_WEIGHTS[stage] || 0;
    const value = state.stageValues[stage] ?? 0;
    if (stage === currentStage) {
      total += weight * Math.max(0, Math.min(1, value));
      break;
    }
    total += weight * Math.max(0, Math.min(1, value));
  }
  const percent = Math.round(Math.min(1, total) * 100);
  $('progress-bar').style.width = percent + '%';
  $('progress-label').textContent = `${STAGE_LABELS[currentStage] || '处理中'} · ${percent}%`;
}

function showResult(result) {
  state.result = result || {};
  $('progress-bar').style.width = '100%';
  $('progress-label').textContent = '完成';
  log('全部完成', 'ok');

  const paths = [];
  if (state.result.voiceover) paths.push('配音：' + state.result.voiceover);
  if (state.result.subtitle) paths.push('字幕：' + state.result.subtitle);
  if (state.result.video) paths.push('成片：' + state.result.video);
  $('result-paths').textContent = paths.join('\n');

  if (state.result.video) {
    const video = $('result-video');
    video.src = 'file:///' + state.result.video.replace(/\\/g, '/');
    video.hidden = false;
    $('result-empty').hidden = true;
    $('result-actions').hidden = false;
  }
}

/* ------------------------------------------------------------ 工具 */
function log(message, level = '') {
  const line = document.createElement('div');
  if (level) line.className = level;
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  line.textContent = `[${time}] ${message}`;
  $('log').appendChild(line);
  $('log').scrollTop = $('log').scrollHeight;
}

init().catch((error) => log('启动失败：' + error.message, 'err'));

