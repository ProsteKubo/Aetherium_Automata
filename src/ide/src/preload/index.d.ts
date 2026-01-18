import { ElectronAPI } from '@electron-toolkit/preload'

// ============================================================================
// File Operation Types
// ============================================================================

interface SaveResult {
  success: boolean
  filePath?: string
  error?: string
}

interface LoadResult<T> {
  success: boolean
  data?: T
  filePath?: string
  error?: string
}

interface RecentProject {
  name: string
  filePath: string
  lastOpened: number
}

// ============================================================================
// API Interface
// ============================================================================

interface ProjectAPI {
  create: (defaultName?: string) => Promise<SaveResult>
  open: () => Promise<LoadResult<unknown>>
  openPath: (filePath: string) => Promise<LoadResult<unknown>>
  save: (project: unknown, filePath?: string) => Promise<SaveResult>
  getRecent: () => Promise<RecentProject[]>
  clearRecent: () => Promise<void>
}

interface AutomataAPI {
  saveYaml: (automata: unknown, suggestedPath?: string) => Promise<SaveResult>
  loadYaml: () => Promise<LoadResult<unknown>>
  import: (filePath: string) => Promise<LoadResult<unknown>>
}

interface FileAPI {
  watch: (filePath: string) => Promise<boolean>
  unwatch: (filePath: string) => Promise<boolean>
}

interface AetheriumAPI {
  project: ProjectAPI
  automata: AutomataAPI
  file: FileAPI
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AetheriumAPI
  }
}
