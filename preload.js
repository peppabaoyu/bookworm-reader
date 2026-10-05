'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('bw', {
  // import & files
  selectAndImport: () => ipcRenderer.invoke('dialog:select-import'),
  importFiles: (paths) => ipcRenderer.invoke('fs:import-files', paths),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch (e) { return null; } },
  readBookFile: (p) => ipcRenderer.invoke('fs:read-book-file', p),
  readBookData: (id, name) => ipcRenderer.invoke('fs:read-book-data', id, name),
  writeBookData: (id, name, content) => ipcRenderer.invoke('fs:write-book-data', id, name, content),
  deleteBookFiles: (id) => ipcRenderer.invoke('fs:delete-book', id),

  // json stores
  loadStore: (name) => ipcRenderer.invoke('store:load', name),
  saveStore: (name, value) => ipcRenderer.invoke('store:save', name, value),

  // translation cache
  loadTranslation: (bookId) => ipcRenderer.invoke('trans:load', bookId),
  saveTranslation: (bookId, obj) => ipcRenderer.invoke('trans:save', bookId, obj),

  // network
  translate: (texts, opts) => ipcRenderer.invoke('net:translate', texts, opts),
  lookupDictionary: (word) => ipcRenderer.invoke('net:dictionary', word),

  // misc
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  saveTextFile: (opts) => ipcRenderer.invoke('dialog:save-text', opts),
  appVersion: () => ipcRenderer.invoke('app:version'),
  checkUpdate: () => ipcRenderer.invoke('updater:check'),

  // smoke
  getSmokeSamples: () => ipcRenderer.invoke('smoke:samples'),
  smokeResult: (r) => ipcRenderer.invoke('smoke:result', r)
});
