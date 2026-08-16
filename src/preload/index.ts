import { contextBridge, ipcRenderer } from 'electron'
import type {
  AddProjectResult,
  AiSummaryInfo,
  AiUsageLogInfo,
  AutoBackupSettings,
  BackupDirInfo,
  CandidateTagView,
  GithubAccountView,
  ProjectWithTags,
  ReadmeAnalysisInfo,
  ReleaseAnalysisInfo,
  ReleaseFileTypeInfo,
  ReleaseInfo,
  ScheduledTaskInfo,
  ScheduledTaskType,
  StarredImportProgress,
  StarredImportResult,
  TagDimension,
  TagInfo,
  TagWithCount,
  TaskItem
} from '../shared/types'

export interface AppInfo {
  name: string
  version: string
  platform: string
  /** CPU 架构（x64 / arm64 等），与 platform 组合显示如 "win32 (x64)" */
  arch: string
  electron: string
  node: string
  chrome: string
}

/** 渲染层可见的模型配置条目（不含密钥） */
export interface ModelProfileView {
  id: string
  provider: string
  baseUrl: string
  model: string
  alias: string
  remark: string
  enabled: boolean
  isDefault: boolean
  hasKey: boolean
}

/** 渲染进程可用的白名单 API（contextBridge 桥接，不暴露 ipcRenderer 本体） */
const api = {
  ping: (): Promise<{ pong: boolean; time: number }> => ipcRenderer.invoke('app:ping'),
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),
  /** 应用自身更新检查（About 页）：对比本地版本与 GitHub Releases 最新版本 */
  checkAppUpdate: (): Promise<{
    ok: boolean
    current?: string
    latest?: string
    hasUpdate?: boolean
    error?: string
  }> => ipcRenderer.invoke('app:checkUpdate'),

  // ---- 项目（M2） ----
  addProject: (url: string): Promise<AddProjectResult> => ipcRenderer.invoke('project:add', url),
  listProjects: (): Promise<ProjectWithTags[]> => ipcRenderer.invoke('project:list'),
  /** 项目列表 + 各自最新 AI 摘要（列表页用） */
  listProjectsWithSummaries: (): Promise<
    Array<
      ProjectWithTags & {
        summary: {
          intro: string | null
          usage: string | null
          model: string | null
          createdAt: string | null
        } | null
        /** 最近一次完成的 readme_sync 任务时间（AI 分析页「上次分析」依据） */
        lastSyncAt: string | null
        /** 最近一次历史版本分析使用的模型（「使用模型」列回退来源之一） */
        lastReleaseModel: string | null
        /** 是否存在未开始的预约任务 */
        scheduled: boolean
      }
    >
  > => ipcRenderer.invoke('project:listWithSummaries'),
  getProject: (id: number): Promise<ProjectWithTags | null> =>
    ipcRenderer.invoke('project:get', id),
  deleteProject: (id: number): Promise<{ ok: boolean }> => ipcRenderer.invoke('project:delete', id),
  refreshProjectMeta: (id: number): Promise<{ ok: boolean; error: string | null }> =>
    ipcRenderer.invoke('project:refreshMeta', id),
  checkUpdate: (id: number): Promise<{ latest: string | null; hasUpdate: boolean }> =>
    ipcRenderer.invoke('project:checkUpdate', id),
  checkUpdateAll: (): Promise<{
    results: Array<{ id: number; name: string; latest: string | null; hasUpdate: boolean }>
    checked: number
  }> => ipcRenderer.invoke('project:checkUpdateAll'),
  /** 存在未查看新版本的项目列表（「可更新」列表） */
  listUpdatable: (): Promise<ProjectWithTags[]> => ipcRenderer.invoke('project:listUpdatable'),
  /** 标记项目的新版本已被查看 */
  markUpdateSeen: (projectId: number): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('project:markUpdateSeen', projectId),

  // ---- 详情（M3） ----
  /** 获取版本发布记录；24h 窗口内读库（force=true 强制请求 GitHub 刷新） */
  getReleases: (id: number, force = false): Promise<ReleaseInfo[]> =>
    ipcRenderer.invoke('repo:getReleases', id, force),
  getNote: (projectId: number): Promise<string> => ipcRenderer.invoke('notes:get', projectId),
  saveNote: (projectId: number, content: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('notes:save', projectId, content),

  // ---- 历史版本记录（AI 分析版本发布记录） ----
  listReleaseAnalyses: (projectId: number): Promise<ReleaseAnalysisInfo[]> =>
    ipcRenderer.invoke('versions:list', projectId),
  analyzeReleaseVersions: (projectId: number): Promise<ReleaseAnalysisInfo[]> =>
    ipcRenderer.invoke('versions:analyze', projectId),
  /** 只分析单个版本（版本卡片表头「分析」按钮），结果覆盖写入 */
  analyzeReleaseOne: (projectId: number, tagName: string): Promise<ReleaseAnalysisInfo[]> =>
    ipcRenderer.invoke('versions:analyzeOne', projectId, tagName),
  /** 历史版本文件类型字典（本地规则 + AI 补全，去重；全局过滤下拉用） */
  listReleaseFileTypes: (): Promise<ReleaseFileTypeInfo[]> =>
    ipcRenderer.invoke('releaseTypes:list'),

  // ---- README 分析 ----
  getReadmeAnalysis: (projectId: number, language: string): Promise<ReadmeAnalysisInfo | null> =>
    ipcRenderer.invoke('readme:getAnalysis', projectId, language),
  analyzeReadme: (projectId: number, language: 'zh' | 'en'): Promise<ReadmeAnalysisInfo | null> =>
    ipcRenderer.invoke('readme:analyze', projectId, language),
  /** AI 翻译英文 README 为中文 */
  translateReadme: (
    projectId: number
  ): Promise<{ ok: boolean; text: string; model: string; tokens: number }> =>
    ipcRenderer.invoke('readme:translate', projectId),

  // ---- 标签（M2） ----
  listTags: (): Promise<TagWithCount[]> => ipcRenderer.invoke('tag:list'),
  assignTag: (projectId: number, name: string, dimension: TagDimension): Promise<TagInfo> =>
    ipcRenderer.invoke('project:assignTag', projectId, name, dimension),
  removeTag: (projectId: number, tagId: number): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('project:removeTag', projectId, tagId),

  // ---- 候选标签审核（AI 环节三产出） ----
  listCandidateTags: (): Promise<CandidateTagView[]> => ipcRenderer.invoke('tag:candidates'),
  promoteTag: (tagId: number): Promise<TagInfo | null> => ipcRenderer.invoke('tag:promote', tagId),
  mergeTag: (tagId: number, targetTagId: number): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('tag:merge', tagId, targetTagId),
  rejectTag: (tagId: number): Promise<{ ok: boolean }> => ipcRenderer.invoke('tag:reject', tagId),

  // ---- AI 任务（M4） ----
  listTasks: (): Promise<TaskItem[]> => ipcRenderer.invoke('ai:listTasks'),
  enqueueAi: (projectId: number): Promise<TaskItem | null> =>
    ipcRenderer.invoke('ai:enqueue', projectId),
  enqueueAiAll: (): Promise<{ queued: number }> => ipcRenderer.invoke('ai:enqueueAll'),
  /** 按项目 id 列表批量入队（AI 分析页勾选管理）；taskIds 为本次实际入队的任务 id */
  enqueueAiMany: (ids: number[]): Promise<{ queued: number; taskIds: number[] }> =>
    ipcRenderer.invoke('ai:enqueueMany', ids),
  /** 按项目 id × 任务类型批量入队（「分析选中」弹窗勾选 AI 分析 / README 分析） */
  enqueueAiManyTypes: (
    ids: number[],
    types: string[]
  ): Promise<{ queued: number; taskIds: number[] }> =>
    ipcRenderer.invoke('ai:enqueueManyTypes', ids, types),
  retryTask: (taskId: number): Promise<{ ok: boolean }> => ipcRenderer.invoke('ai:retry', taskId),
  setAiPaused: (value: boolean): Promise<{ paused: boolean }> =>
    ipcRenderer.invoke('ai:setPaused', value),
  getAiPaused: (): Promise<boolean> => ipcRenderer.invoke('ai:getPaused'),
  getAiSummary: (projectId: number): Promise<AiSummaryInfo | null> =>
    ipcRenderer.invoke('ai:getSummary', projectId),
  /** 生成五维项目画像（详情页「项目画像」手动触发），返回最新摘要 */
  generateProfile: (projectId: number): Promise<AiSummaryInfo | null> =>
    ipcRenderer.invoke('ai:generateProfile', projectId),

  // ---- 预约任务（定时调度） ----
  listScheduledTasks: (): Promise<ScheduledTaskInfo[]> => ipcRenderer.invoke('schedule:list'),
  createScheduledTask: (input: {
    projectId: number
    type: ScheduledTaskType
    startAt: string
    endAt: string | null
  }): Promise<ScheduledTaskInfo[]> => ipcRenderer.invoke('schedule:create', input),
  deleteScheduledTask: (id: number): Promise<ScheduledTaskInfo[]> =>
    ipcRenderer.invoke('schedule:delete', id),
  updateScheduledTask: (input: {
    id: number
    projectId: number
    startAt: string
  }): Promise<ScheduledTaskInfo[]> => ipcRenderer.invoke('schedule:update', input),
  clearCompletedScheduledTasks: (): Promise<ScheduledTaskInfo[]> =>
    ipcRenderer.invoke('schedule:clearCompleted'),

  // ---- 设置（M4/M5） ----
  getSetting: <T>(key: string, fallback: T): Promise<T> =>
    ipcRenderer.invoke('settings:get', key, fallback),
  setSetting: <T>(key: string, value: T): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('settings:set', key, value),
  /** 用表单里用户新填写的配置测试连接（仅测试用，不落库） */
  testAi: (config: {
    provider: string
    baseUrl: string
    apiKey: string
    model: string
  }): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('settings:testAi', config),
  hasModel: (): Promise<boolean> => ipcRenderer.invoke('settings:hasModel'),

  // ---- 模型使用统计 ----
  getAiUsageStats: (
    dimension: 'year' | 'month' | 'day',
    model: string | null
  ): Promise<{
    series: Array<{ label: string; tokens: number; requests: number; durationMs: number }>
    seriesByModel: Array<{ label: string; model: string; tokens: number }>
    byModel: Array<{ model: string; tokens: number; requests: number; durationMs: number }>
    byFunction: Array<{ functionName: string; tokens: number; requests: number }>
    summary: { tokens: number; requests: number; durationMs: number }
  }> => ipcRenderer.invoke('usage:stats', dimension, model),
  /** 单次 AI 请求明细（分页，按开始时间倒序） */
  getAiUsageLogs: (
    model: string | null,
    page: number,
    pageSize: number
  ): Promise<{ rows: AiUsageLogInfo[]; total: number }> =>
    ipcRenderer.invoke('usage:logs', model, page, pageSize),

  // ---- 多模型管理 ----
  listModels: (): Promise<ModelProfileView[]> => ipcRenderer.invoke('model:list'),
  saveModel: (input: {
    id?: string
    provider: string
    baseUrl: string
    apiKey: string
    model: string
    alias: string
    remark: string
  }): Promise<ModelProfileView[]> => ipcRenderer.invoke('model:save', input),
  deleteModel: (id: string): Promise<ModelProfileView[]> => ipcRenderer.invoke('model:delete', id),
  setDefaultModel: (id: string): Promise<ModelProfileView[]> =>
    ipcRenderer.invoke('model:setDefault', id),
  toggleModel: (id: string, enabled: boolean): Promise<ModelProfileView[]> =>
    ipcRenderer.invoke('model:toggle', id, enabled),

  // ---- 凭据 / 网络 / 数据（M5） ----
  getProxy: (): Promise<{
    enabled: boolean
    protocol: 'http' | 'socks5'
    host: string
    port: number
  }> => ipcRenderer.invoke('settings:getProxy'),
  saveProxy: (proxy: {
    enabled: boolean
    protocol: string
    host: string
    port: number
  }): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('settings:saveProxy', proxy),
  /** 网络连通测试：可传表单中尚未保存的代理配置，主进程临时应用后测 GitHub + AI 并还原 */
  testConnection: (proxy?: {
    enabled: boolean
    protocol: 'http' | 'socks5'
    host: string
    port: number
  }): Promise<{
    ok: boolean
    level: 'success' | 'warning' | 'error'
    message: string
  }> => ipcRenderer.invoke('settings:testConnection', proxy),
  backupData: (): Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }> =>
    ipcRenderer.invoke('data:backup'),
  restoreData: (): Promise<{ ok: boolean; message?: string; error?: string; canceled?: boolean }> =>
    ipcRenderer.invoke('data:restore'),
  openBackupsDir: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('data:openBackupsDir'),
  getAutoBackupSettings: (): Promise<AutoBackupSettings> =>
    ipcRenderer.invoke('backup:settings:get'),
  saveAutoBackupSettings: (input: AutoBackupSettings): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('backup:settings:save', input),
  listBackupFiles: (): Promise<BackupDirInfo> => ipcRenderer.invoke('backup:files:list'),
  pickBackupDir: (): Promise<{ ok: boolean; path?: string; canceled?: boolean }> =>
    ipcRenderer.invoke('backup:dir:pick'),

  /** 订阅任务进度广播，返回取消订阅函数 */
  onTaskProgress: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('task:progress', listener)
    return () => {
      ipcRenderer.removeListener('task:progress', listener)
    }
  },

  /** 订阅批量检查更新进度（update:progress：projectId 进入/离开检查），返回取消订阅函数 */
  onUpdateProgress: (
    callback: (data: { projectId: number; status: 'checking' | 'done' }) => void
  ): (() => void) => {
    const listener = (
      _e: unknown,
      data: { projectId: number; status: 'checking' | 'done' }
    ): void => callback(data)
    ipcRenderer.on('update:progress', listener)
    return () => {
      ipcRenderer.removeListener('update:progress', listener)
    }
  },

  // ---- 导入 star 项目（设置页） ----

  /** 拉取所选账号已 star 项目：逐账号先元数据入库（拉取中），再补全 README（处理中） */
  importStarred: (accountIds: number[]): Promise<StarredImportResult> =>
    ipcRenderer.invoke('project:importStarred', accountIds),

  /** 订阅导入进度（starredImport:progress：listing 拉取中 / readme 处理中，含账号 login），返回取消订阅函数 */
  onStarredImportProgress: (callback: (data: StarredImportProgress) => void): (() => void) => {
    const listener = (_e: unknown, data: StarredImportProgress): void => callback(data)
    ipcRenderer.on('starredImport:progress', listener)
    return () => {
      ipcRenderer.removeListener('starredImport:progress', listener)
    }
  },

  // ---- GitHub 账号（M6 多 token） ----

  listAccounts: (): Promise<GithubAccountView[]> => ipcRenderer.invoke('github:listAccounts'),
  /** 添加账号：先验证 token 并取账号信息，验证通过才入库 */
  addAccount: (input: { alias?: string; token: string }): Promise<GithubAccountView> =>
    ipcRenderer.invoke('github:addAccount', input),
  /** 编辑账号：alias 可改；token 留空保留原值 */
  updateAccount: (input: {
    id: number
    alias?: string
    token?: string
  }): Promise<GithubAccountView | null> => ipcRenderer.invoke('github:updateAccount', input),
  deleteAccount: (id: number): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('github:deleteAccount', id),
  /** 批量验证全部账号状态（打开凭据页时调用） */
  verifyAccounts: (): Promise<GithubAccountView[]> => ipcRenderer.invoke('github:verifyAccounts')
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
