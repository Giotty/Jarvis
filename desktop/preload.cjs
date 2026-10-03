const { contextBridge, ipcRenderer } = require('electron');
const methods = [
  'snapshot',
  'workspaceControl',
  'workspaceGesture',
  'researchFolders',
  'createResearchFolder',
  'moveResearch',
  'openResearchFolder',
  'workspaceComplete',
  'researchLibrary',
  'saveResearch',
  'openResearch',
  'renameResearch',
  'requestResearchDelete',
  'confirmResearchDelete',
  'researchImage',
  'openResearchSource',
  'command',
  'confirm',
  'cancel',
  'cancelTask',
  'interrupt',
  'settings',
  'models',
  'providerModels',
  'providerCapabilities',
  'credentials',
  'setCredential',
  'plugins',
  'connectPlugin',
  'disconnectPlugin',
  'vision',
  'locate',
  'memories',
  'remember',
  'forget',
  'clearMemory',
  'logs',
  'tasks',
  'transcribe',
  'synthesize',
  'diagnostics',
  'browserState',
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
