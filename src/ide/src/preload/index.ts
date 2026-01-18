import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer - File operations
const api = {
  // Project operations
  project: {
    create: (defaultName?: string) => ipcRenderer.invoke('project:create', defaultName),
    open: () => ipcRenderer.invoke('project:open'),
    openPath: (filePath: string) => ipcRenderer.invoke('project:openPath', filePath),
    save: (project: unknown, filePath?: string) => ipcRenderer.invoke('project:save', project, filePath),
    getRecent: () => ipcRenderer.invoke('project:getRecent'),
    clearRecent: () => ipcRenderer.invoke('project:clearRecent'),
  },
  
  // Automata operations
  automata: {
    saveYaml: (automata: unknown, suggestedPath?: string) => 
      ipcRenderer.invoke('automata:saveYaml', automata, suggestedPath),
    loadYaml: () => ipcRenderer.invoke('automata:loadYaml'),
    import: (filePath: string) => ipcRenderer.invoke('automata:import', filePath),
  },
  
  // File watching
  file: {
    watch: (filePath: string) => ipcRenderer.invoke('file:watch', filePath),
    unwatch: (filePath: string) => ipcRenderer.invoke('file:unwatch', filePath),
  },
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
