'use strict';
/** 厉影AI 数字人 开源版 —— Electron 主进程 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const settingsStore = require('./settings');
const {
  StationClient, StationError, STATION_HOME,
} = require('./station');

let mainWindow = null;
let currentJob = null;

const PRODUCT = '厉影AI 数字人';
const SCRIPT_SYSTEM = `你是口播稿撰稿人。根据用户给的主题写一段口播稿。
要求：口语化、有钩子、60-160 字，直接输出正文，不要标题、不要分镜、不要任何解释。`;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#0f1115',
    title: `${PRODUCT} 开源版`,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === STATION_HOME || url === STATION_HOME + '/') shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    if (url === STATION_HOME || url === STATION_HOME + '/') shell.openExternal(url);
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function defaultOutputDir() {
  return path.join(app.getPath('videos'), '厉影AI数字人');
}

function outputDirOf(settings) {
  const dir = settings.outputDir && settings.outputDir.trim() ? settings.outputDir.trim() : defaultOutputDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function runJob(options) {
  const settings = settingsStore.load(app.getPath('userData'));
  const dir = outputDirOf(settings);
  const client = new StationClient({
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    chatKey: settings.chatKey,
    ttsKey: settings.ttsKey,
  });
  const cancelled = () => currentJob?.cancelled === true;
  const log = (message) => send('job:log', message);
  const stage = (name, value) => send('job:progress', { stage: name, value });

  const token = stamp();
  const result = { script: '', voiceover: '', subtitle: '', video: '' };

  // 先校验素材，再执行可能消耗额度的云端请求。
  if (!options.portrait || !fs.existsSync(options.portrait)) throw new StationError('请选择有效的人像素材');
  if (options.audio ? !fs.existsSync(options.audio) : !options.voiceRef || !fs.existsSync(options.voiceRef)) {
    throw new StationError('请选择有效的现成配音或参考音频');
  }

  // 1. 文案
  let script = String(options.script || '').trim();
  if (!script && !options.audio) {
    const topic = String(options.topic || '').trim();
    if (!topic) throw new StationError('请填写主题或文案');
    log(`调用 ${settings.chatModel} 写口播稿…`);
    stage('script', 0.1);
    script = String(await client.chat(
      [{ role: 'system', content: SCRIPT_SYSTEM }, { role: 'user', content: `主题：${topic}` }],
      { model: settings.chatModel },
    )).trim();
    if (!script) throw new StationError('模型没有返回文案');
  }
  result.script = script;
  log(`文案 ${script.length} 字：${script.slice(0, 40)}…`);
  stage('script', 1);

  // 2. 配音
  let voiceover = String(options.audio || '').trim();
  if (voiceover) {
    if (!fs.existsSync(voiceover)) throw new StationError(`配音文件不存在：${voiceover}`);
    log(`使用现成配音：${voiceover}`);
  } else {
    if (!options.voiceRef) throw new StationError('生成配音需要选择参考音频（3-10 秒人声）');
    log(`调用 ${settings.ttsModel} 合成配音…`);
    stage('voice', 0.3);
    const audio = await client.tts(script, options.voiceRef, { model: settings.ttsModel });
    voiceover = path.join(dir, `voice_${token}.mp3`);
    fs.writeFileSync(voiceover, audio);
    log(`配音已保存（${Math.round(audio.length / 1024)} KB）`);
  }
  result.voiceover = voiceover;
  stage('voice', 1);
  if (cancelled()) throw new StationError('任务已取消');

  // 3. 字幕（可选）
  if (settings.makeSubtitles && options.subtitles !== false) {
    try {
      log(`调用 ${settings.asrModel} 生成字幕…`);
      stage('subtitle', 0.2);
      const srt = await client.asr(voiceover, { model: settings.asrModel, responseFormat: 'srt' });
      const subtitle = path.join(dir, `voice_${token}.srt`);
      fs.writeFileSync(subtitle, typeof srt === 'string' ? srt : String(srt), 'utf8');
      result.subtitle = subtitle;
      log('字幕已保存');
      stage('subtitle', 1);
    } catch (error) {
      log(`字幕跳过：${error.message}`);
      stage('subtitle', 1);
    }
  }

  // 4. 口型视频
  if (!options.portrait) throw new StationError('请选择人像素材');
  if (!fs.existsSync(options.portrait)) throw new StationError(`人像素材不存在：${options.portrait}`);

  log(`提交数字人任务（${settings.avatarModel}）…`);
  stage('avatar', 0.1);
  const task = await client.submitAvatar(options.portrait, voiceover, { model: settings.avatarModel });
  const taskId = task?.id || task?.task_id;
  if (!taskId) throw new StationError(`提交任务失败：${JSON.stringify(task).slice(0, 200)}`);
  log(`任务已提交：${taskId}`);
  send('job:task', { taskId });

  const finalState = await client.waitAvatar(taskId, {
    isCancelled: cancelled,
    onProgress: (state) => {
      const progress = Number(state?.progress || 0);
      log(`任务状态：${state?.status}${state?.progress !== undefined ? ` ${progress}%` : ''}`);
      stage('avatar', 0.1 + Math.min(1, progress / 100) * 0.85);
    },
  });
  log(`任务完成：${finalState?.status}`);

  // 完成后立刻下载：任务记录不长期保留
  stage('download', 0.3);
  const video = path.join(dir, `avatar_${token}.mp4`);
  await client.downloadTask(taskId, video);
  result.video = video;
  stage('download', 1);
  log(`成片已保存：${video}`);
  return result;
}

ipcMain.handle('settings:get', () => {
  const settings = settingsStore.load(app.getPath('userData'));
  return { settings, stationHome: STATION_HOME, defaultOutputDir: defaultOutputDir() };
});

ipcMain.handle('settings:save', (_event, patch) => settingsStore.save(app.getPath('userData'), patch));

// 只写稿，便于用户先看文案再决定要不要出片
ipcMain.handle('text:generate', async (_event, topic) => {
  try {
    const settings = settingsStore.load(app.getPath('userData'));
    const client = new StationClient({
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      chatKey: settings.chatKey,
      ttsKey: settings.ttsKey,
    });
    const script = String(await client.chat(
      [{ role: 'system', content: SCRIPT_SYSTEM },
        { role: 'user', content: `主题：${String(topic || '').trim()}` }],
      { model: settings.chatModel },
    )).trim();
    return { ok: true, script };
  } catch (error) {
    const message = error instanceof StationError ? error.message : `${error.name}: ${error.message}`;
    return { ok: false, error: message };
  }
});

ipcMain.handle('dialog:pickFile', async (_event, kind) => {
  const filters = kind === 'audio'
    ? [{ name: '音频', extensions: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg'] }]
    : [{ name: '人像视频', extensions: ['mp4', 'mov', 'webm', 'mkv', 'avi'] }];
  const picked = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters });
  return picked.canceled ? '' : picked.filePaths[0];
});

ipcMain.handle('dialog:pickDirectory', async () => {
  const picked = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  return picked.canceled ? '' : picked.filePaths[0];
});

ipcMain.handle('job:start', async (_event, options) => {
  if (currentJob && !currentJob.finished) {
    return { ok: false, error: '已有任务在运行' };
  }
  currentJob = { cancelled: false, finished: false };
  send('job:started', {});
  try {
    const result = await runJob(options || {});
    currentJob.finished = true;
    send('job:done', result);
    return { ok: true, result };
  } catch (error) {
    currentJob.finished = true;
    const message = error instanceof StationError ? error.message : `${error.name}: ${error.message}`;
    send('job:error', message);
    return { ok: false, error: message };
  }
});

ipcMain.handle('job:cancel', () => {
  if (currentJob) currentJob.cancelled = true;
  return true;
});

ipcMain.handle('shell:openPath', async (_event, target) => {
  if (target && fs.existsSync(target)) await shell.openPath(target);
  return true;
});

ipcMain.handle('shell:showItem', (_event, target) => {
  if (target && fs.existsSync(target)) shell.showItemInFolder(target);
  return true;
});

ipcMain.handle('file:exists', (_event, target) => Boolean(target) && fs.existsSync(target));

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
