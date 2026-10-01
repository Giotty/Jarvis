const { contextBridge, ipcRenderer } = require('electron');
const methods = [
  'snapshot',
  'command',
  'confirm',
  'cancel',
  'settings',
  'models',
  'vision',
  'locate',
  'memories',
  'remember',
  'forget',
  'clearMemory',
  'logs',
  'tasks',
  'transcribe',
  'diagnostics',
  'selectRoot',
  'window',
];
const api = {};
for (const name of methods) api[name] = (...args) => ipcRenderer.invoke('jarvis:' + name, ...args);
api.on = (callback) => {
  const listener = (_event, data) => callback(data);
  ipcRenderer.on('jarvis:event', listener);
  return () => ipcRenderer.removeListener('jarvis:event', listener);
};
contextBridge.exposeInMainWorld('jarvis', api);
