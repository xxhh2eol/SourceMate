import { ipcMain, app, session, dialog } from 'electron'
import { msg } from './msg'
import { normalizeTagName } from './services/tagNormalize'
import {
  assignTag,
  clearCompletedScheduledTasks,
  createGithubAccount,
  createProject,
  createScheduledTask,
  deleteGithubAccount,
  deleteOrphanTags,
  deleteProject,
  deleteScheduledTask,
  enqueueTask,
  getGithubAccountById,
  getGithubTokenEnc,
  getNote,
  getOrCreateTag,
  listCandidateTags,
  mergeTag,
  promoteTag,
  rejectTag,
  getProjectById,
  getProjectByOwnerRepo,
  getReadmeAnalysis,
  getLastReleaseCheck,
  getAiUsageByFunction,
  getAiUsageByModel,
  getAiUsageLogPage,
  getAiUsageSeries,
  getAiUsageSeriesByModel,
  getAiUsageSummary,
  listGithubAccounts,
  listReleaseFileTypes,
  listProjectsWithSummaries,
  listProjectsWithTags,
  listReleaseAnalyses,
  listReleases,
  listScheduledTasks,
  listTags,
  listTasks,
  listUpdatableProjects,
  markUpdateSeen,
  migrateLegacyGithubToken,
  removeTag,
  saveNote,
  saveProjectProfile,
  saveReadmeAnalysis,
  saveReleaseAnalysis,
  syncReleaseFileTypes,
  updateGithubAccount,
  updateProjectMeta,
  updateScheduledTask,
  upsertReleases
} from './db/dao'
import {
  compareVersions,
  fetchCurrentUser,
  fetchLatestVersion,
  fetchReadmes,
  fetchReleases,
  fetchRepoMeta,
  fetchStarredPage,
  GithubAuthError,
  parseGitHubUrl,
  syncProjectReadme
} from './services/github'
import type { ReleaseData } from './services/github'
import { checkAllProjectsUpdates } from './services/updateChecker'
import {
  analyzeProjectProfile,
  analyzeReadme,
  analyzeReleaseVersions,
  deleteModelProfile,
  translateReadme,
  hasModelConfig,
  listModelProfiles,
  saveModelProfile,
  setDefaultModelProfile,
  testAiConnection,
  toggleModelProfile,
  type ModelProfile,
  type ModelProfileView
} from './services/ai'
import { getLatestSummary, isQueuePaused, setQueuePaused, startQueue } from './services/aiQueue'
import { getSetting, setSetting, updateTask } from './db/dao'
import { httpFetch, toProxyRules, type ProxyConfig } from './services/network'
import { decryptSecret, encryptSecret } from './services/secret'
import {
  backupDatabase,
  getBackupSettings,
  listBackupFiles,
  openBackupsDir,
  restartAutoBackupScheduler,
  saveBackupSettings,
  startAutoBackupScheduler,
  restoreDatabase
} from './services/dataManager'
import {
  AI_TAG_ANALYSIS_ENABLED,
  type AddProjectResult,
  type AutoBackupSettings,
  type GithubAccountView,
  type ProjectWithTags,
  type ReleaseFileInfo,
  type ReleaseInfo,
  type ScheduledTaskType,
  type StarredImportAccountResult,
  type StarredImportProgress,
  type TagDimension
} from '../shared/types'

/**
 * IPC 通道注册（设计文档 §2）
 * M1：app:* 探测通道
 * M2：project:*（入库/列表/删除/刷新）+ tag:*
 * M3+：repo:*（README/Releases）、ai:*（任务队列）、settings:*
 */

/** 最近一次显式应用到 defaultSession 的代理配置（测试后还原用；null = 未配置过，回落到系统代理） */
type AppliedProxy = { mode: 'direct' } | { proxyRules: string }
let appliedProxy: AppliedProxy | null = null

/** 入库流程：解析 URL → API 元数据（失败降级）→ README 缓存 → 落库 */
async function handleAddProject(url: string): Promise<AddProjectResult> {
  const parsed = parseGitHubUrl(url)
  if (!parsed) {
    throw new Error(
      msg(
        '无效的 GitHub 链接，请确认格式：https://github.com/owner/repo',
        'Invalid GitHub URL. Expected format: https://github.com/owner/repo'
      )
    )
  }

  const existing = getProjectByOwnerRepo(parsed.owner, parsed.repo)
  if (existing) return { project: existing, duplicate: true, metaError: null }

  let metaError: string | null = null
  let name = parsed.repo
  let description: string | null = null
  let starCount = 0
  let forkCount = 0
  let language: string | null = null
  let homepage: string | null = null
  let defaultBranch = 'main'
  let topics: string[] = []
  let pushedAt: string | null = null
  let readmeCache: string | null = null
  let readmeEn: string | null = null
  let readmeZh: string | null = null

  try {
    const meta = await fetchRepoMeta(parsed.owner, parsed.repo)
    name = meta.name
    description = meta.description
    starCount = meta.starCount
    forkCount = meta.forkCount
    language = meta.language
    homepage = meta.homepage
    defaultBranch = meta.defaultBranch
    topics = meta.topics
    pushedAt = meta.pushedAt
  } catch (err) {
    metaError =
      err instanceof Error ? err.message : msg('元数据获取失败', 'Failed to fetch metadata')
    // 404（仓库不存在）时不入库；其余网络问题降级入库
    if (/不存在|not found/i.test(metaError)) throw err
  }

  if (!metaError) {
    try {
      const readmes = await fetchReadmes(parsed.owner, parsed.repo, defaultBranch)
      readmeCache = readmes.en ?? readmes.zh
      readmeEn = readmes.en
      readmeZh = readmes.zh
    } catch {
      readmeCache = null
    }
  }

  const project = createProject({
    owner: parsed.owner,
    repo: parsed.repo,
    githubUrl: `https://github.com/${parsed.owner}/${parsed.repo}`,
    name,
    description,
    starCount,
    forkCount,
    language,
    homepage,
    topics,
    pushedAt,
    readmeCache,
    readmeEn,
    readmeZh,
    readmeZhAi: null
  })
  return { project, duplicate: false, metaError }
}

export function registerIpcHandlers(): void {
  ipcMain.handle('app:ping', () => ({ pong: true, time: Date.now() }))

  ipcMain.handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome
  }))

  // ---- 项目 ----

  ipcMain.handle('project:add', (_e, url: string) => handleAddProject(url))

  ipcMain.handle('project:list', () => listProjectsWithTags())

  // 列表页专用：项目 + 最新 AI 摘要联查
  ipcMain.handle('project:listWithSummaries', () => listProjectsWithSummaries())

  ipcMain.handle('project:get', (_e, id: number) => {
    const all = listProjectsWithTags()
    return all.find((p) => p.id === id) ?? null
  })

  ipcMain.handle('project:delete', (_e, id: number) => {
    deleteProject(id)
    deleteOrphanTags()
    return { ok: true }
  })

  ipcMain.handle('project:refreshMeta', async (_e, id: number) => {
    const all = listProjectsWithTags()
    const project = all.find((p) => p.id === id)
    if (!project) throw new Error(msg('项目不存在', 'Project not found'))

    let metaError: string | null = null
    try {
      await syncProjectReadme(project)
    } catch (err) {
      metaError = err instanceof Error ? err.message : msg('刷新失败', 'Refresh failed')
    }
    return { ok: !metaError, error: metaError }
  })

  // ---- 检查更新 ----

  ipcMain.handle('project:checkUpdate', async (_e, id: number) => {
    const project = getProjectById(id)
    if (!project) throw new Error(msg('项目不存在', 'Project not found'))

    const latest = await fetchLatestVersion(project.owner, project.repo)
    const hasUpdate = latest !== null && latest !== project.lastVersion
    updateProjectMeta(id, {
      lastVersion: latest,
      lastCheckedAt: new Date().toISOString(),
      ...(hasUpdate ? { hasUpdate: 1 } : {})
    })
    return { latest, hasUpdate }
  })

  // 批量检查：并发 5，结果汇总；逐项目广播进度（渲染层驱动边框流光动效）
  ipcMain.handle('project:checkUpdateAll', async (event) => {
    const send = (projectId: number, status: 'checking' | 'done'): void => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('update:progress', { projectId, status })
      }
    }
    const results = await checkAllProjectsUpdates(send)
    return { results, checked: results.length }
  })

  // 「可更新」列表 + 标记已查看
  ipcMain.handle('project:listUpdatable', () => listUpdatableProjects())

  ipcMain.handle('project:markUpdateSeen', (_e, projectId: number) => {
    markUpdateSeen(projectId)
    return { ok: true }
  })

  // 导入所选账号的 star 项目（设置页触发）：逐账号两步——元数据落库（拉取中）→ 补全 README（处理中）
  // 防重复点击：模块级标志，进行中再次调用直接抛错
  let starredImporting = false
  ipcMain.handle('project:importStarred', async (event, accountIds: number[]) => {
    if (starredImporting) {
      throw new Error(msg('导入正在进行中，请等待完成', 'Import already in progress. Please wait.'))
    }
    if (!Array.isArray(accountIds) || accountIds.length === 0) {
      throw new Error(msg('请至少选择一个账号', 'Select at least one account.'))
    }
    // 校验账号存在并解密各账号 token（一次取齐，避免后续重复查询）
    const accounts = accountIds.map((id) => {
      const view = getGithubAccountById(id)
      if (!view) throw new Error(msg('账号不存在', 'Account not found.'))
      const tokenEnc = getGithubTokenEnc(id)
      if (!tokenEnc) throw new Error(msg('账号 Token 缺失', 'Account token missing.'))
      return { view, token: decryptSecret(tokenEnc) }
    })

    const send = (data: StarredImportProgress): void => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('starredImport:progress', data)
      }
    }

    starredImporting = true
    try {
      const results: StarredImportAccountResult[] = []
      for (const { view, token } of accounts) {
        // 第一步「拉取中」：分页拉取 star 列表，元数据直接落库（列表条目含完整仓库信息，零额外请求）。
        // 同时收集第二步工作集：本次新增的项目 + star 列表中 README 全空的既有项目。
        // 不处理库里的历史遗留项目——避免「没有 star 却补全旧项目 README」的意外长任务；中断后重跑可续
        const pendingReadme: ProjectWithTags[] = []
        let added = 0
        let duplicates = 0
        let fetched = 0
        let page = 1
        for (;;) {
          const { repos, hasNext } = await fetchStarredPage(page, token)
          for (const r of repos) {
            fetched++
            const existing = getProjectByOwnerRepo(r.owner, r.repo)
            if (existing) {
              duplicates++
              if (!existing.readmeCache && !existing.readmeEn && !existing.readmeZh) {
                pendingReadme.push(existing)
              }
            } else {
              const project = createProject({
                owner: r.owner,
                repo: r.repo,
                githubUrl: `https://github.com/${r.owner}/${r.repo}`,
                name: r.name,
                description: r.description,
                starCount: r.starCount,
                forkCount: r.forkCount,
                language: r.language,
                homepage: r.homepage,
                topics: r.topics,
                pushedAt: r.pushedAt,
                readmeCache: null,
                readmeEn: null,
                readmeZh: null,
                readmeZhAi: null
              })
              added++
              pendingReadme.push(project)
            }
          }
          send({ phase: 'listing', account: view.login, fetched, added, duplicates })
          if (!hasNext) break
          page++
        }

        // 第二步「处理中」：为本次涉及的项目补全 README（0 star 时工作集为空，直接完成）
        const total = pendingReadme.length
        const workers = Math.min(5, total)
        let cursor = 0
        let done = 0
        let failed = 0

        const work = async (): Promise<void> => {
          while (true) {
            const idx = cursor++
            if (idx >= total) return
            const p = pendingReadme[idx]
            try {
              await syncProjectReadme(p, token)
            } catch {
              failed++
            }
            done++
            send({ phase: 'readme', account: view.login, total, done, failed })
          }
        }
        await Promise.all(Array.from({ length: workers }, () => work()))

        results.push({
          login: view.login,
          total: fetched,
          added,
          duplicates,
          readmeTotal: total,
          readmeDone: done,
          readmeFailed: failed
        })
      }
      return { accounts: results }
    } finally {
      starredImporting = false
    }
  })

  // ---- 详情（M3） ----

  // ReleaseData → upsert 入参（附件转 ReleaseAssetInfo 全量入库，供离线兜底）
  const toReleaseUpsert = (fetched: ReleaseData[]) =>
    fetched.map((r) => ({
      tagName: r.tagName,
      publishedAt: r.publishedAt,
      body: r.body,
      htmlUrl: r.htmlUrl,
      assets: r.assets.map((a) => ({ name: a.name, url: a.downloadUrl, sha256: a.sha256 }))
    }))

  // 本地缓存 → ReleaseData（网络失败时的降级输入）
  const fromReleaseCache = (cached: ReleaseInfo[]): ReleaseData[] =>
    cached.map((r) => ({
      tagName: r.tagName,
      publishedAt: r.publishedAt,
      body: r.body,
      htmlUrl: r.htmlUrl,
      assets: r.assets.map((a) => ({ name: a.name, downloadUrl: a.url, sha256: a.sha256 }))
    }))

  ipcMain.handle('repo:getReleases', async (_e, id: number, force = false) => {
    const project = getProjectById(id)
    if (!project) throw new Error(msg('项目不存在', 'Project not found'))

    // 24 小时新鲜度窗口：窗口内直接读库，不请求 GitHub（「刷新」按钮传 force 绕过）
    if (!force) {
      const lastCheck = getLastReleaseCheck(id)
      if (lastCheck && Date.now() - new Date(lastCheck).getTime() < 24 * 3600 * 1000) {
        return listReleases(id)
      }
    }

    // 按需拉取并缓存（设计文档 §7：API 按需）；失败时返回本地缓存
    const fetched = await fetchReleases(project.owner, project.repo)
    if (fetched) upsertReleases(id, toReleaseUpsert(fetched))
    return listReleases(id)
  })

  ipcMain.handle('notes:get', (_e, projectId: number) => getNote(projectId))

  ipcMain.handle('notes:save', (_e, projectId: number, content: string) => {
    saveNote(projectId, content)
    return { ok: true }
  })

  // ---- README 分析 ----

  ipcMain.handle('readme:getAnalysis', (_e, projectId: number, language: string) =>
    getReadmeAnalysis(projectId, language)
  )

  // AI 翻译英文 README 为中文（存入 readme_zh_ai_cache，与真实中文版区分）
  ipcMain.handle('readme:translate', async (_e, projectId: number) => {
    const project = getProjectById(projectId)
    if (!project) throw new Error(msg('项目不存在', 'Project not found'))
    const { text, tokens, model } = await translateReadme(project)
    updateProjectMeta(projectId, { readmeZhAi: text, readmeAiModel: model })
    return { ok: true, text, model, tokens }
  })

  ipcMain.handle('readme:analyze', async (_e, projectId: number, language: 'zh' | 'en') => {
    const project = getProjectById(projectId)
    if (!project) throw new Error(msg('项目不存在', 'Project not found'))
    const { overview, keyPoints, tokens, model } = await analyzeReadme(project, language)
    saveReadmeAnalysis({
      projectId,
      language,
      overview,
      keyPoints: JSON.stringify(keyPoints),
      rawJson: null,
      model,
      tokensUsed: tokens
    })
    return getReadmeAnalysis(projectId, language)
  })

  // ---- 历史版本记录（AI 分析版本发布记录，每项目每版本一行） ----

  ipcMain.handle('versions:list', (_e, projectId: number) => listReleaseAnalyses(projectId))

  ipcMain.handle('versions:analyze', async (_e, projectId: number) => {
    const project = getProjectById(projectId)
    if (!project) throw new Error(msg('项目不存在', 'Project not found'))

    // 1. 拉取最新 Releases（含附件）并全量入库；网络失败时降级读库（离线仍可分析本地记录）
    let fetched = await fetchReleases(project.owner, project.repo)
    if (fetched) {
      upsertReleases(projectId, toReleaseUpsert(fetched))
    } else {
      const cached = listReleases(projectId)
      if (cached.length === 0) {
        throw new Error(
          msg(
            '版本发布记录拉取失败（网络不可达）',
            'Failed to fetch releases (network unreachable)'
          )
        )
      }
      fetched = fromReleaseCache(cached)
    }

    // 2. 增量：跳过已分析过的版本（版本号差集），只对新版本走 AI
    const analyzedVersions = new Set(listReleaseAnalyses(projectId).map((a) => a.version))
    const newReleases = fetched.filter((r) => !analyzedVersions.has(r.tagName))

    // 3. AI 分析差集：翻译版本说明，并按需补全 sha256 / 文件说明（本地规则优先），逐版本写回
    if (newReleases.length > 0) {
      try {
        const { result, tokens, model } = await analyzeReleaseVersions(newReleases)
        for (const v of result) {
          saveReleaseAnalysis({
            projectId,
            version: v.version,
            description: newReleases.find((r) => r.tagName === v.version)?.body ?? null,
            descriptionZh: v.descriptionZh,
            files: v.files,
            model,
            tokensUsed: tokens
          })
          syncReleaseFileTypes(v.files)
        }
      } catch (err) {
        // AI 超时（版本较多或模型响应慢）：版本记录已落库，重试只分析未完成的版本
        if (err instanceof Error && err.name === 'AbortError') {
          throw new Error(
            msg(
              'AI 分析超时（版本较多或模型响应慢），版本记录已保存，请重试',
              'AI analysis timed out (many releases or slow model). Release data is saved; please retry.'
            ),
            { cause: err }
          )
        }
        throw err
      }
    }
    return listReleaseAnalyses(projectId)
  })

  // 单版本分析（版本卡片表头「分析」按钮）：只获取并分析这一个版本，结果 upsert 覆盖
  ipcMain.handle('versions:analyzeOne', async (_e, projectId: number, tagName: string) => {
    const project = getProjectById(projectId)
    if (!project) throw new Error(msg('项目不存在', 'Project not found'))

    // 1. 只取该版本：API 优先（最近 20 个内命中则更新本地库），失败降级本地缓存（页面展示的数据源）
    let releaseData: ReleaseData | null = null
    const fetched = await fetchReleases(project.owner, project.repo)
    if (fetched) {
      const fresh = fetched.find((r) => r.tagName === tagName)
      if (fresh) {
        releaseData = fresh
        upsertReleases(projectId, toReleaseUpsert(fetched))
      }
    }
    if (!releaseData) {
      const cached = listReleases(projectId).find((r) => r.tagName === tagName)
      if (cached) releaseData = fromReleaseCache([cached])[0] ?? null
    }
    if (!releaseData) {
      throw new Error(msg(`未找到版本 ${tagName}`, `Release ${tagName} not found`))
    }
    if (releaseData.assets.length === 0) {
      throw new Error(msg('该版本没有附件文件', 'This release has no asset files'))
    }

    // 2. AI 分析单个版本（单条入参，走同一分析函数；超时给友好提示）
    // try 内必赋值、catch 必抛出，无需初始值
    let result: { version: string; descriptionZh: string | null; files: ReleaseFileInfo[] } | null
    let tokens: number
    let model: string | null
    try {
      const r = await analyzeReleaseVersions([releaseData])
      result = r.result[0] ?? null
      tokens = r.tokens
      model = r.model
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(
          msg(
            'AI 分析超时（模型响应慢），请重试',
            'AI analysis timed out (slow model). Please retry.'
          ),
          { cause: err }
        )
      }
      throw err
    }
    if (!result) {
      throw new Error(msg('AI 分析未返回有效结果', 'AI analysis returned no valid result'))
    }

    // 3. upsert 写回（同版本重复分析自动覆盖）
    saveReleaseAnalysis({
      projectId,
      version: result.version,
      description: releaseData.body ?? null,
      descriptionZh: result.descriptionZh,
      files: result.files,
      model,
      tokensUsed: tokens
    })
    syncReleaseFileTypes(result.files)
    return listReleaseAnalyses(projectId)
  })

  // ---- 历史版本文件类型字典（全局过滤下拉） ----

  ipcMain.handle('releaseTypes:list', () => {
    return listReleaseFileTypes()
  })

  // ---- 标签 ----

  ipcMain.handle('tag:list', () => listTags())

  ipcMain.handle(
    'project:assignTag',
    (_e, projectId: number, name: string, dimension: TagDimension) => {
      const normalized = normalizeTagName(name)
      if (!normalized) throw new Error(msg('标签名不能为空', 'Tag name cannot be empty'))
      const tag = getOrCreateTag(normalized, dimension)
      assignTag(projectId, tag.id, 'user')
      return tag
    }
  )

  ipcMain.handle('project:removeTag', (_e, projectId: number, tagId: number) => {
    removeTag(projectId, tagId)
    deleteOrphanTags()
    return { ok: true }
  })

  // ---- 候选标签审核（AI 环节三产出，人工 promote/merge/reject） ----

  ipcMain.handle('tag:candidates', () => listCandidateTags())
  ipcMain.handle('tag:promote', (_e, tagId: number) => promoteTag(tagId))
  ipcMain.handle('tag:merge', (_e, tagId: number, targetTagId: number) =>
    mergeTag(tagId, targetTagId)
  )
  ipcMain.handle('tag:reject', (_e, tagId: number) => {
    rejectTag(tagId)
    deleteOrphanTags()
    return { ok: true }
  })

  // ---- AI 任务（M4） ----

  ipcMain.handle('ai:listTasks', () => listTasks())

  ipcMain.handle('ai:enqueue', (_e, projectId: number) =>
    enqueueTask(projectId, AI_TAG_ANALYSIS_ENABLED ? 'tag_analysis' : 'readme_sync')
  )

  ipcMain.handle('ai:enqueueAll', () => {
    const queued: number[] = []
    for (const p of listProjectsWithTags()) {
      const task = enqueueTask(p.id, AI_TAG_ANALYSIS_ENABLED ? 'tag_analysis' : 'readme_sync')
      if (task) queued.push(task.id)
    }
    return { queued: queued.length }
  })

  // 按勾选的项目 id 列表批量入队（AI 分析页勾选管理）
  ipcMain.handle('ai:enqueueMany', (_e, ids: number[]) => {
    let queued = 0
    const taskIds: number[] = []
    for (const id of ids) {
      const task = enqueueTask(id, AI_TAG_ANALYSIS_ENABLED ? 'tag_analysis' : 'readme_sync')
      if (task) {
        queued++
        // 返回本次实际入队的任务 id（供前端跟踪批次完成）
        taskIds.push(task.id)
      }
    }
    return { queued, taskIds }
  })

  // 按项目 id × 任务类型批量入队（AI 分析页「分析选中」弹窗可勾选 AI 分析 / README 分析）
  ipcMain.handle('ai:enqueueManyTypes', (_e, ids: number[], types: string[]) => {
    let queued = 0
    const taskIds: number[] = []
    for (const id of ids) {
      for (const type of types) {
        const task = enqueueTask(id, type)
        if (task) {
          queued++
          taskIds.push(task.id)
        }
      }
    }
    return { queued, taskIds }
  })

  ipcMain.handle('ai:retry', (_e, taskId: number) => {
    // 手动重试 = 全新一次尝试：清错误与自动重试计数（retryCount 仅统计自动重试）
    updateTask(taskId, { status: 'pending', error: null, retryCount: 0 })
    return { ok: true }
  })

  ipcMain.handle('ai:setPaused', (_e, value: boolean) => {
    setQueuePaused(value)
    return { paused: value }
  })

  ipcMain.handle('ai:getPaused', () => isQueuePaused())

  ipcMain.handle('ai:getSummary', (_e, projectId: number) => getLatestSummary(projectId))

  // 生成五维项目画像（详情页「项目画像」手动触发）
  ipcMain.handle('ai:generateProfile', async (_e, projectId: number) => {
    const project = getProjectById(projectId)
    if (!project) throw new Error(msg('项目不存在', 'Project not found'))
    const { profile, tokens, model } = await analyzeProjectProfile(project)
    saveProjectProfile(projectId, profile, model, tokens)
    return getLatestSummary(projectId)
  })

  // ---- 预约任务（定时调度） ----

  ipcMain.handle('schedule:list', () => listScheduledTasks())

  ipcMain.handle(
    'schedule:create',
    (
      _e,
      input: { projectId: number; type: ScheduledTaskType; startAt: string; endAt: string | null }
    ) => {
      createScheduledTask(input.projectId, input.type, input.startAt, input.endAt)
      return listScheduledTasks()
    }
  )

  ipcMain.handle('schedule:delete', (_e, id: number) => {
    deleteScheduledTask(id)
    return listScheduledTasks()
  })

  ipcMain.handle(
    'schedule:update',
    (_e, input: { id: number; projectId: number; startAt: string }) => {
      updateScheduledTask(input.id, input.projectId, input.startAt)
      return listScheduledTasks()
    }
  )

  ipcMain.handle('schedule:clearCompleted', () => {
    clearCompletedScheduledTasks()
    return listScheduledTasks()
  })

  // ---- 应用自身更新检查（About 页）：对比本地版本与 GitHub Releases 最新版本 ----

  ipcMain.handle('app:checkUpdate', async () => {
    const current = app.getVersion()
    try {
      const latest = await fetchLatestVersion('xxhh2eol', 'SourceMate')
      if (!latest) {
        return {
          ok: false,
          error: msg(
            '查询失败：仓库尚未发布或网络不可达，请稍后再试',
            'Query failed: repository not released yet or unreachable. Please try again later.'
          )
        }
      }
      return { ok: true, current, latest, hasUpdate: compareVersions(current, latest) < 0 }
    } catch {
      return {
        ok: false,
        error: msg('查询失败，请稍后再试', 'Query failed. Please try again later.')
      }
    }
  })

  // ---- 设置（M4/M5） ----

  ipcMain.handle('settings:get', (_e, key: string, fallback: unknown) => getSetting(key, fallback))

  ipcMain.handle('settings:set', (_e, key: string, value: unknown) => {
    setSetting(key, value)
    return { ok: true }
  })

  ipcMain.handle('settings:testAi', (_e, config: Parameters<typeof testAiConnection>[0]) =>
    testAiConnection(config)
  )

  ipcMain.handle('settings:hasModel', () => hasModelConfig())

  // ---- 模型使用统计（模型统计页） ----

  /** usage 统计时间维度白名单校验（防非法值拼入 SQL） */
  const USAGE_DIMENSIONS = ['year', 'month', 'day'] as const
  const validateUsageDimension = (dimension: string): 'year' | 'month' | 'day' => {
    if (!USAGE_DIMENSIONS.includes(dimension as (typeof USAGE_DIMENSIONS)[number])) {
      throw new Error(msg('无效的统计维度', 'Invalid usage dimension'))
    }
    return dimension as 'year' | 'month' | 'day'
  }

  ipcMain.handle('usage:stats', (_e, dimension: string, model: string | null) => {
    const valid = validateUsageDimension(dimension)
    return {
      series: getAiUsageSeries(valid, model),
      seriesByModel: getAiUsageSeriesByModel(valid),
      byModel: getAiUsageByModel(),
      byFunction: getAiUsageByFunction(),
      summary: getAiUsageSummary(model)
    }
  })

  // 单次请求明细（分页，默认按开始时间倒序）
  ipcMain.handle('usage:logs', (_e, model: string | null, page: number, pageSize: number) =>
    getAiUsageLogPage(model, page, pageSize)
  )

  // ---- 多模型管理（M5+）：列表 / 保存 / 删除 / 默认 / 开关 ----
  const toModelView = (p: ModelProfile): ModelProfileView => ({
    id: p.id,
    provider: p.provider,
    baseUrl: p.baseUrl,
    model: p.model,
    alias: p.alias,
    remark: p.remark,
    enabled: p.enabled,
    isDefault: p.isDefault,
    hasKey: Boolean(p.apiKeyEnc)
  })
  ipcMain.handle('model:list', () => listModelProfiles().map(toModelView))
  ipcMain.handle('model:save', (_e, input: Parameters<typeof saveModelProfile>[0]) =>
    saveModelProfile(input).map(toModelView)
  )
  ipcMain.handle('model:delete', (_e, id: string) => deleteModelProfile(id).map(toModelView))
  ipcMain.handle('model:setDefault', (_e, id: string) =>
    setDefaultModelProfile(id).map(toModelView)
  )
  ipcMain.handle('model:toggle', (_e, id: string, enabled: boolean) =>
    toggleModelProfile(id, enabled).map(toModelView)
  )

  // ---- GitHub 账号（M6 多 token，验证/CRUD/状态） ----

  ipcMain.handle('github:listAccounts', () => {
    migrateLegacyGithubToken()
    return listGithubAccounts()
  })

  /** 添加账号：先用 /user 验证 token 并取账号信息，验证通过才加密入库 */
  ipcMain.handle(
    'github:addAccount',
    async (_e, input: { alias?: string; token: string }): Promise<GithubAccountView> => {
      const token = input.token.trim()
      if (!token) throw new Error(msg('请输入 GitHub Token', 'Please enter a GitHub Token.'))
      let info: {
        login: string
        name: string | null
        avatarUrl: string | null
        scopes: string | null
      }
      try {
        info = await fetchCurrentUser(token)
      } catch (err) {
        if (err instanceof GithubAuthError) throw new Error(err.message, { cause: err })
        throw err
      }
      const now = new Date().toISOString()
      return createGithubAccount({
        alias: input.alias?.trim() || info.login || '未命名账号',
        tokenEnc: encryptSecret(token),
        login: info.login,
        name: info.name,
        avatarUrl: info.avatarUrl,
        scopes: info.scopes,
        tokenStatus: 'ok',
        lastCheckedAt: now
      })
    }
  )

  /** 编辑账号：alias 可改；token 留空保留原值，提供则重新验证并更新账号信息 */
  ipcMain.handle(
    'github:updateAccount',
    async (
      _e,
      input: { id: number; alias?: string; token?: string }
    ): Promise<GithubAccountView | null> => {
      const existing = getGithubAccountById(input.id)
      if (!existing) throw new Error(msg('账号不存在', 'Account not found.'))
      const now = new Date().toISOString()
      const patch: Parameters<typeof updateGithubAccount>[1] = { updatedAt: now }
      if (input.alias !== undefined) patch.alias = input.alias.trim() || existing.login
      if (input.token && input.token.trim()) {
        try {
          const info = await fetchCurrentUser(input.token.trim())
          patch.tokenEnc = encryptSecret(input.token.trim())
          patch.login = info.login
          patch.name = info.name
          patch.avatarUrl = info.avatarUrl
          patch.scopes = info.scopes
          patch.tokenStatus = 'ok'
          patch.lastCheckedAt = now
        } catch (err) {
          if (err instanceof GithubAuthError) throw new Error(err.message, { cause: err })
          throw err
        }
      }
      updateGithubAccount(input.id, patch)
      return getGithubAccountById(input.id)
    }
  )

  ipcMain.handle('github:deleteAccount', (_e, id: number) => {
    deleteGithubAccount(id)
    return { ok: true }
  })

  /** 批量验证全部账号（打开凭据页时调用）：按 /user 结果刷新状态与账号信息，非认证错误保持原状态 */
  ipcMain.handle('github:verifyAccounts', async () => {
    const now = new Date().toISOString()
    return Promise.all(
      listGithubAccounts().map(async (view) => {
        const tokenEnc = getGithubTokenEnc(view.id)
        if (!tokenEnc) return view
        try {
          const info = await fetchCurrentUser(decryptSecret(tokenEnc))
          updateGithubAccount(view.id, {
            login: info.login,
            name: info.name,
            avatarUrl: info.avatarUrl,
            scopes: info.scopes,
            tokenStatus: 'ok',
            lastCheckedAt: now
          })
          return { ...view, ...info, tokenStatus: 'ok' as const, lastCheckedAt: now }
        } catch (err) {
          const status = err instanceof GithubAuthError ? err.status : view.tokenStatus
          updateGithubAccount(view.id, { tokenStatus: status, lastCheckedAt: now })
          return { ...view, tokenStatus: status, lastCheckedAt: now }
        }
      })
    )
  })

  // ---- 网络代理（M5） ----

  ipcMain.handle('settings:getProxy', () =>
    getSetting<ProxyConfig>('network.proxy', {
      enabled: false,
      protocol: 'http',
      host: '',
      port: 0
    })
  )

  ipcMain.handle('settings:saveProxy', async (_e, proxy: ProxyConfig) => {
    const trimmed = { ...proxy, host: proxy.host.trim() }
    if (trimmed.enabled && (!trimmed.host || !trimmed.port)) {
      return { ok: false, error: msg('请填写代理地址和端口', 'Enter proxy host and port') }
    }
    const rules = toProxyRules(trimmed)
    const next: AppliedProxy = rules ? { proxyRules: rules } : { mode: 'direct' }
    // 先应用会话代理，成功后才落库，避免「设置已保存但未生效」的不一致
    try {
      await session.defaultSession.setProxy(next)
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : msg('代理应用失败', 'Failed to apply proxy')
      }
    }
    appliedProxy = next
    setSetting('network.proxy', trimmed)
    return { ok: true }
  })

  /**
   * 检查 GitHub 连通性，结果分三档：
   * - success：2xx，链路与目标均正常
   * - warning：收到 HTTP 响应但非 2xx（如 403/429 限流）——链路是通的，只是目标返回异常
   * - error：完全没有响应（代理不可达 / 网络断开）
   * 双探针：github.com（主站，不限流）+ api.github.com/rate_limit（API，官方说明不消耗配额），
   * 避免只测 API 域名被限流/被区别对待造成误报，也避免测试本身消耗 API 配额。
   */
  const checkGithubReachability = async (): Promise<{
    ok: boolean
    level: 'success' | 'warning' | 'error'
    message: string
  }> => {
    const probe = async (url: string): Promise<{ status: number | null; error: string | null }> => {
      try {
        const res = await httpFetch(url, {
          headers: { 'User-Agent': 'sourcemate-network-test' },
          signal: AbortSignal.timeout(10000)
        })
        return { status: res.status, error: null }
      } catch (err) {
        return {
          status: null,
          error: err instanceof Error ? err.message : msg('连接失败', 'Connection failed')
        }
      }
    }

    const [web, api] = await Promise.all([
      probe('https://github.com'),
      probe('https://api.github.com/rate_limit')
    ])
    const webOk = web.status !== null && web.status >= 200 && web.status < 300
    const apiOk = api.status !== null && api.status >= 200 && api.status < 300

    if (webOk && apiOk) {
      return {
        ok: true,
        level: 'success',
        message: msg(
          `GitHub 连通（主站 HTTP ${web.status}，API HTTP ${api.status}）`,
          `GitHub reachable (web HTTP ${web.status}, API HTTP ${api.status})`
        )
      }
    }
    if (web.status === null && api.status === null) {
      const message = web.error ?? api.error ?? msg('GitHub 连接失败', 'GitHub connection failed')
      return { ok: false, level: 'error', message }
    }
    // 至少一端有响应：链路是通的，只是目标返回异常
    const details = [
      web.status !== null ? `主站 HTTP ${web.status}` : '主站无响应',
      api.status !== null ? `API HTTP ${api.status}` : 'API 无响应'
    ].join('，')
    return {
      ok: true,
      level: 'warning',
      message: msg(
        `链路连通，但 GitHub 部分异常（${details}，可能被限流或拦截）`,
        `Link is up, but GitHub returned anomalies (${details}; possibly rate-limited or blocked)`
      )
    }
  }

  /**
   * 网络连通测试（设置页网络面板用，只测 GitHub，AI 连通性在模型配置页单独测）：
   * 可传入表单中尚未保存的代理配置，临时应用到会话后测 GitHub，测完还原原代理。
   * 代理关闭时按直连测试。
   */
  ipcMain.handle(
    'settings:testConnection',
    async (
      _e,
      testProxy?: ProxyConfig
    ): Promise<{
      ok: boolean
      level: 'success' | 'warning' | 'error'
      message: string
    }> => {
      const proxy = testProxy ? { ...testProxy, host: (testProxy.host ?? '').trim() } : undefined
      if (proxy?.enabled && (!proxy.host || !proxy.port)) {
        const invalid = msg('请填写代理地址和端口', 'Enter proxy host and port')
        return { ok: false, level: 'warning', message: invalid }
      }
      const prev = appliedProxy
      try {
        const rules = proxy?.enabled ? toProxyRules(proxy) : ''
        if (rules) {
          await session.defaultSession.setProxy({ proxyRules: rules })
        } else {
          await session.defaultSession.setProxy({ mode: 'direct' })
        }
        return checkGithubReachability()
      } catch (err) {
        const message = err instanceof Error ? err.message : msg('连接失败', 'Connection failed')
        return { ok: false, level: 'error', message }
      } finally {
        try {
          if (prev) {
            await session.defaultSession.setProxy(prev)
          } else {
            await session.defaultSession.setProxy({ mode: 'system' })
          }
        } catch {
          // 还原失败不影响测试结果
        }
      }
    }
  )

  // ---- 数据管理（M5） ----

  ipcMain.handle('data:backup', async () => {
    const result = await dialog.showSaveDialog({
      title: '备份数据库',
      defaultPath: `sourcemate-backup-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: 'SQLite 数据库', extensions: ['db'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    const r = backupDatabase(result.filePath)
    return r.ok ? { ok: true, path: result.filePath } : { ok: false, error: r.error }
  })

  ipcMain.handle('data:restore', async () => {
    const result = await dialog.showOpenDialog({
      title: '从备份恢复',
      properties: ['openFile'],
      filters: [{ name: 'SQLite 数据库', extensions: ['db'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true }
    const r = restoreDatabase(result.filePaths[0])
    return r.ok ? { ok: true, message: '恢复成功' } : { ok: false, error: r.error }
  })

  ipcMain.handle('data:openBackupsDir', () => openBackupsDir())

  // ---- 自动备份任务（设置 / 备份文件列表 / 目录选择） ----

  ipcMain.handle('backup:settings:get', () => getBackupSettings())

  ipcMain.handle('backup:settings:save', (_e, input: AutoBackupSettings) => {
    const r = saveBackupSettings(input)
    if (r.ok) restartAutoBackupScheduler()
    return r
  })

  ipcMain.handle('backup:files:list', () => listBackupFiles())

  ipcMain.handle('backup:dir:pick', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择备份目录',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true }
    return { ok: true, path: result.filePaths[0] }
  })
}

/** 启动时：应用代理配置 + 自动备份 + 启动 AI 任务队列 */
export function startServices(): void {
  const proxy = getSetting<ProxyConfig>('network.proxy', {
    enabled: false,
    protocol: 'http',
    host: '',
    port: 0
  })
  if (proxy.enabled && proxy.host && proxy.port) {
    appliedProxy = { proxyRules: toProxyRules(proxy) }
    void session.defaultSession.setProxy(appliedProxy).catch(() => undefined)
  }
  startAutoBackupScheduler()
  startQueue()
}
