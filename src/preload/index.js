'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (handler) => {
  const listener = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  pickFile: (kind) => ipcRenderer.invoke('dialog:pickFile', kind),
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),
  generateText: (topic) => ipcRenderer.invoke('text:generate', topic),
  startJob: (options) => ipcRenderer.invoke('job:start', options),
  cancelJob: () => ipcRenderer.invoke('job:cancel'),
  openPath: (target) => ipcRenderer.invoke('shell:openPath', target),
  showItem: (target) => ipcRenderer.invoke('shell:showItem', target),
  fileExists: (target) => ipcRenderer.invoke('file:exists', target),
  onLog: on('job:log'),
  onProgress: on('job:progress'),
  onTask: on('job:task'),
  onStarted: on('job:started'),
  onDone: on('job:done'),
  onError: on('job:error'),
});
