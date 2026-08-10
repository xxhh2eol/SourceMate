import { getDb } from './index'
import type { DatabaseSync } from 'node:sqlite'
import type {
  AiUsageLogInfo,
  CandidateTagView,
  GithubAccountView,
  GithubTokenStatus,
  ProjectTagInfo,
  ProjectWithTags,
  ReleaseAnalysisInfo,
  ReleaseAssetInfo,
  ReleaseFileInfo,
  ReleaseInfo,
  TagDimension,
  TagInfo,
  TagSource,
  TagStatus,
  TagWithCount
} from '../../shared/types'

/**
 * 数据访问层（设计文档 §3）
 * 基于 node:sqlite 手写 SQL，表结构由 drizzle-kit 迁移维护（drizzle/ 目录）。
 */

interface ProjectRow {
  id: number
  owner: string
  repo: string
  githubUrl: string
  name: string
  description: string | null
  starCount: number
  forkCount: number
  language: string | null
  homepage: string | null
  topics: string
  pushedAt: string | null
  readmeCache: string | null
  readmeEnCache: string | null
  readmeZhCache: string | null
  readmeZhAiCache: string | null
  readmeAiModel: string | null
  cnSummary: string | null
  lastVersion: string | null
  lastCheckedAt: string | null
  createdAt: string
  updatedAt: string
}

interface TagRow {
  id: number
  name: string
  nameCn: string | null
  dimension: TagDimension
  status: TagStatus
  aliasOf: number | null
}

interface ProjectTagRow {
  projectId: number
  id: number
  name: string
  nameCn: string | null
  dimension: TagDimension
  status: TagStatus
  aliasOf: number | null
  source: TagSource
  confidence: number | null
}

const PROJECT_COLUMNS = `
  id, owner, repo, github_url AS githubUrl, name, description,
  star_count AS starCount, fork_count AS forkCount, language, homepage, topics, pushed_at AS pushedAt,
  readme_cache AS readmeCache, readme_en_cache AS readmeEnCache, readme_zh_cache AS readmeZhCache,
  readme_zh_ai_cache AS readmeZhAiCache, readme_ai_model AS readmeAiModel, cn_summary AS cnSummary,
  last_version AS lastVersion,
  last_checked_at AS lastCheckedAt, created_at AS createdAt, updated_at AS updatedAt
`

/** node:sqlite 返回 Record 行，中转 unknown 转为强类型 */
function toRows<T>(result: unknown): T[] {
  return result as T[]
}

function toRow<T>(result: unknown): T | undefined {
  return result as T | undefined
}

/** topics 以 JSON 数组字符串入库，读取时解析；异常/空值回退 [] */
function parseTopics(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw) as unknown
    return Array.isArray(arr) ? arr.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

function mapProject(row: ProjectRow): Omit<ProjectWithTags, 'tags'> {
  return {
    id: row.id,
    owner: row.owner,
    repo: row.repo,
    githubUrl: row.githubUrl,
    name: row.name,
    description: row.description,
    starCount: row.starCount,
    forkCount: row.forkCount,
    language: row.language,
    homepage: row.homepage,
    topics: parseTopics(row.topics),
    pushedAt: row.pushedAt,
    readmeCache: row.readmeCache,
    readmeEn: row.readmeEnCache,
    readmeZh: row.readmeZhCache,
    readmeZhAi: row.readmeZhAiCache,
    readmeAiModel: row.readmeAiModel,
    cnSummary: row.cnSummary,
    lastVersion: row.lastVersion,
    lastCheckedAt: row.lastCheckedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

function getProjectTags(sqlite: DatabaseSync, projectId: number): ProjectTagInfo[] {
  const tagRows = toRows<TagRow & { source: TagSource; confidence: number | null }>(
    sqlite
      .prepare(
        `SELECT t.id, t.name, t.name_cn AS nameCn, t.dimension, t.status, t.alias_of AS aliasOf,
                pt.source, pt.confidence
         FROM project_tags pt JOIN tags t ON t.id = pt.tag_id
         WHERE pt.project_id = ?`
      )
      .all(projectId)
  )
  return tagRows
}

export function getProjectByOwnerRepo(owner: string, repo: string): ProjectWithTags | null {
  const db = getDb()
  const found = toRow<ProjectRow>(
    db
      .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE owner = ? AND repo = ?`)
      .get(owner, repo)
  )
  if (!found) return null
  return { ...mapProject(found), tags: getProjectTags(db, found.id) }
}

export function listProjectsWithTags(): ProjectWithTags[] {
  const db = getDb()
  const projectRows = toRows<ProjectRow>(
    db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects ORDER BY updated_at DESC`).all()
  )

  const tagRows = toRows<ProjectTagRow>(
    db
      .prepare(
        `SELECT pt.project_id AS projectId, t.id, t.name, t.name_cn AS nameCn, t.dimension, t.status,
                t.alias_of AS aliasOf, pt.source, pt.confidence
         FROM project_tags pt JOIN tags t ON t.id = pt.tag_id
         ORDER BY t.dimension, t.id`
      )
      .all()
  )

  const tagsByProject = new Map<number, ProjectTagInfo[]>()
  for (const r of tagRows) {
    const list = tagsByProject.get(r.projectId) ?? []
    list.push({
      id: r.id,
      name: r.name,
      nameCn: r.nameCn,
      dimension: r.dimension,
      status: r.status,
      aliasOf: r.aliasOf,
      source: r.source,
      confidence: r.confidence
    })
    tagsByProject.set(r.projectId, list)
  }

  return projectRows.map((r) => ({ ...mapProject(r), tags: tagsByProject.get(r.id) ?? [] }))
}

/** 项目列表 + 各自最新 AI 摘要与最近完成的分析任务时间（AI 分析页用） */
export function listProjectsWithSummaries(): Array<
  ProjectWithTags & {
    summary: {
      intro: string | null
      usage: string | null
      model: string | null
      createdAt: string | null
    } | null
    /** 最近一次完成的分析类任务时间（readme_sync/tag_analysis，「上次分析」与勾选清除依据） */
    lastSyncAt: string | null
    /** 最近一次历史版本分析使用的模型（「使用模型」列回退来源之一） */
    lastReleaseModel: string | null
  }
> {
  const projects = listProjectsWithTags()
  const rows = toRows<{
    projectId: number
    intro: string | null
    usage: string | null
    model: string | null
    createdAt: string | null
  }>(
    getDb()
      .prepare(
        `SELECT s.project_id AS projectId, s.intro, s.usage, s.model, s.created_at AS createdAt
         FROM ai_summaries s
         WHERE s.id IN (SELECT MAX(id) FROM ai_summaries GROUP BY project_id)`
      )
      .all()
  )
  const syncRows = toRows<{ projectId: number; lastSyncAt: string }>(
    getDb()
      .prepare(
        `SELECT t.project_id AS projectId, MAX(t.updated_at) AS lastSyncAt
         FROM tasks t
         WHERE t.type IN ('readme_sync', 'tag_analysis') AND t.status = 'done'
         GROUP BY t.project_id`
      )
      .all()
  )
  const releaseRows = toRows<{ projectId: number; model: string | null }>(
    getDb()
      .prepare(
        `SELECT project_id AS projectId, model
         FROM release_analyses
         WHERE id IN (SELECT MAX(id) FROM release_analyses GROUP BY project_id)`
      )
      .all()
  )
  const byProject = new Map(rows.map((r) => [r.projectId, r]))
  const syncByProject = new Map(syncRows.map((r) => [r.projectId, r.lastSyncAt]))
  const releaseByProject = new Map(releaseRows.map((r) => [r.projectId, r.model ?? null]))
  return projects.map((p) => ({
    ...p,
    summary: byProject.get(p.id) ?? null,
    lastSyncAt: syncByProject.get(p.id) ?? null,
    lastReleaseModel: releaseByProject.get(p.id) ?? null
  }))
}

export interface NewProjectInput {
  owner: string
  repo: string
  githubUrl: string
  name: string
  description: string | null
  starCount: number
  forkCount: number
  language: string | null
  homepage: string | null
  topics: string[]
  pushedAt: string | null
  readmeCache: string | null
  readmeEn: string | null
  readmeZh: string | null
  readmeZhAi: string | null
  /** 最近一次 AI README 翻译使用的模型（创建时无；由翻译流程回写） */
  readmeAiModel?: string | null
  /** AI 标签分析产出的中文摘要（创建时无；由标签分析流程回写） */
  cnSummary?: string | null
}

export function createProject(input: NewProjectInput): ProjectWithTags {
  const db = getDb()
  const now = new Date().toISOString()
  const result = db
    .prepare(
      `INSERT INTO projects
         (owner, repo, github_url, name, description, star_count, fork_count,
          language, homepage, topics, pushed_at, readme_cache, readme_en_cache, readme_zh_cache,
          readme_zh_ai_cache, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.owner,
      input.repo,
      input.githubUrl,
      input.name,
      input.description,
      input.starCount,
      input.forkCount,
      input.language,
      input.homepage,
      JSON.stringify(input.topics ?? []),
      input.pushedAt,
      input.readmeCache,
      input.readmeEn,
      input.readmeZh,
      input.readmeZhAi,
      now,
      now
    )
  const createdRow = toRow<ProjectRow>(
    db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ?`).get(result.lastInsertRowid)
  )!
  return { ...mapProject(createdRow), tags: [] }
}

export function deleteProject(id: number): void {
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(id)
}

export function updateProjectMeta(
  id: number,
  patch: Partial<
    Pick<
      NewProjectInput,
      | 'name'
      | 'description'
      | 'starCount'
      | 'forkCount'
      | 'language'
      | 'homepage'
      | 'topics'
      | 'pushedAt'
      | 'readmeCache'
      | 'readmeEn'
      | 'readmeZh'
      | 'readmeZhAi'
      | 'readmeAiModel'
      | 'cnSummary'
    >
  > & {
    lastVersion?: string | null
    lastCheckedAt?: string | null
  }
): void {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return
  // topics 数组归一化为 JSON 字符串存储
  for (const e of entries) {
    if (e[0] === 'topics' && Array.isArray(e[1])) e[1] = JSON.stringify(e[1])
  }
  const sets = entries.map(([k]) => `${COLUMN_MAP[k] ?? snake(k)} = ?`).join(', ')
  const values: Array<string | number | null> = entries.map(([, v]) =>
    typeof v === 'string' || typeof v === 'number' || v === null ? v : String(v)
  )
  getDb()
    .prepare(`UPDATE projects SET ${sets}, updated_at = ? WHERE id = ?`)
    .run(...values, new Date().toISOString(), id)
}

/** 字段名 → 实际列名映射（snake 转换无法覆盖的多词字段） */
const COLUMN_MAP: Record<string, string> = {
  readmeCache: 'readme_cache',
  readmeEn: 'readme_en_cache',
  readmeZh: 'readme_zh_cache',
  readmeZhAi: 'readme_zh_ai_cache'
}

function snake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
}

// ---- 设置（key-value JSON） ----

export function getSetting<T>(key: string, fallback: T): T {
  const row = toRow<{ value: string }>(
    getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key)
  )
  if (!row) return fallback
  try {
    return JSON.parse(row.value) as T
  } catch {
    return fallback
  }
}

/** 键是否真实存在于 settings 表（区别于 getSetting 的 fallback 默认值，用于迁移判断） */
export function hasSetting(key: string): boolean {
  return getDb().prepare('SELECT 1 FROM settings WHERE key = ?').get(key) != null
}

export function setSetting<T>(key: string, value: T): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, JSON.stringify(value))
}

// ---- GitHub 账号（M6 多 token 管理） ----

const ACCOUNT_COLUMNS = `
  id, alias, token_enc AS tokenEnc, login, name, avatar_url AS avatarUrl, scopes,
  token_status AS tokenStatus, last_checked_at AS lastCheckedAt,
  created_at AS createdAt, updated_at AS updatedAt
`

interface AccountRow {
  id: number
  alias: string
  tokenEnc: string
  login: string
  name: string | null
  avatarUrl: string | null
  scopes: string | null
  tokenStatus: string
  lastCheckedAt: string | null
  createdAt: string
  updatedAt: string
}

function mapAccount(row: AccountRow): GithubAccountView {
  return {
    id: row.id,
    alias: row.alias,
    login: row.login,
    name: row.name,
    avatarUrl: row.avatarUrl,
    scopes: row.scopes,
    tokenStatus: row.tokenStatus as GithubTokenStatus,
    lastCheckedAt: row.lastCheckedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

export function listGithubAccounts(): GithubAccountView[] {
  const rows = toRows<AccountRow>(
    getDb().prepare(`SELECT ${ACCOUNT_COLUMNS} FROM github_accounts ORDER BY id ASC`).all()
  )
  return rows.map(mapAccount)
}

export function getGithubAccountById(id: number): GithubAccountView | null {
  const row = toRow<AccountRow>(
    getDb().prepare(`SELECT ${ACCOUNT_COLUMNS} FROM github_accounts WHERE id = ?`).get(id)
  )
  return row ? mapAccount(row) : null
}

/** 读取账号的加密 token（解密由服务层 secret.ts 负责） */
export function getGithubTokenEnc(id: number): string | null {
  const row = toRow<{ tokenEnc: string }>(
    getDb()
      .prepare('SELECT token_enc AS tokenEnc FROM github_accounts WHERE id = ?')
      .get(id)
  )
  return row?.tokenEnc ?? null
}

/** 默认账号 = 最早插入的一个（旧 API 路径自动使用其 token，其余代码零改动） */
export function getDefaultGithubTokenEnc(): string | null {
  const row = toRow<{ tokenEnc: string }>(
    getDb()
      .prepare('SELECT token_enc AS tokenEnc FROM github_accounts ORDER BY id ASC LIMIT 1')
      .get()
  )
  return row?.tokenEnc ?? null
}

export interface NewGithubAccountInput {
  alias: string
  tokenEnc: string
  login: string
  name: string | null
  avatarUrl: string | null
  scopes: string | null
  tokenStatus: GithubTokenStatus
  lastCheckedAt: string | null
}

export function createGithubAccount(input: NewGithubAccountInput): GithubAccountView {
  const now = new Date().toISOString()
  const db = getDb()
  const result = db
    .prepare(
      `INSERT INTO github_accounts
         (alias, token_enc, login, name, avatar_url, scopes, token_status, last_checked_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.alias,
      input.tokenEnc,
      input.login,
      input.name,
      input.avatarUrl,
      input.scopes,
      input.tokenStatus,
      input.lastCheckedAt,
      now,
      now
    )
  const id = Number(result.lastInsertRowid)
  const row = toRow<AccountRow>(
    db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM github_accounts WHERE id = ?`).get(id)
  )
  return mapAccount(row!)
}

/** 账号更新（alias / token 信息 / 状态），字段可选 */
export interface UpdateGithubAccountPatch {
  alias?: string
  tokenEnc?: string
  login?: string
  name?: string | null
  avatarUrl?: string | null
  scopes?: string | null
  tokenStatus?: GithubTokenStatus
  lastCheckedAt?: string | null
  updatedAt?: string
}

const ACCOUNT_UPDATE_FIELDS: Array<keyof UpdateGithubAccountPatch> = [
  'alias',
  'tokenEnc',
  'login',
  'name',
  'avatarUrl',
  'scopes',
  'tokenStatus',
  'lastCheckedAt',
  'updatedAt'
]

export function updateGithubAccount(id: number, patch: UpdateGithubAccountPatch): void {
  const sets: string[] = []
  const values: Array<string | number | null> = []
  for (const key of ACCOUNT_UPDATE_FIELDS) {
    if (key in patch && patch[key] !== undefined) {
      sets.push(`${snake(key)} = ?`)
      values.push(patch[key] as string | number | null)
    }
  }
  if (sets.length === 0) return
  values.push(id)
  getDb().prepare(`UPDATE github_accounts SET ${sets.join(', ')} WHERE id = ?`).run(...values)
}

export function deleteGithubAccount(id: number): void {
  getDb().prepare('DELETE FROM github_accounts WHERE id = ?').run(id)
}

/**
 * 旧单 token（github.tokenEnc）惰性迁移到账号表：
 * 表为空且存在旧 key 时，把加密串原样搬入占位账号（login 待打开设置页时验证补齐），并清除旧 key。幂等。
 */
export function migrateLegacyGithubToken(): void {
  const stored = getSetting('github.tokenEnc', '')
  if (!stored) return
  const db = getDb()
  const count = toRow<{ n: number }>(
    db.prepare('SELECT COUNT(*) AS n FROM github_accounts').get()
  )
  if (count && count.n > 0) {
    setSetting('github.tokenEnc', '')
    return
  }
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO github_accounts (alias, token_enc, login, token_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run('默认账号', stored, '', 'unknown', now, now)
  setSetting('github.tokenEnc', '')
}

// ---- AI 摘要（M4） ----

export interface SummaryRow {
  id: number
  projectId: number
  intro: string | null
  usage: string | null
  techAnalysis: string | null
  learningValue: string | null
  rawJson: string | null
  model: string | null
  tokensUsed: number
  createdAt: string
}

export function getLatestSummary(projectId: number): SummaryRow | null {
  const row = toRow<SummaryRow>(
    getDb()
      .prepare(
        `SELECT id, project_id AS projectId, intro, usage, tech_analysis AS techAnalysis,
                learning_value AS learningValue, raw_json AS rawJson, model,
                tokens_used AS tokensUsed, created_at AS createdAt
         FROM ai_summaries WHERE project_id = ? ORDER BY id DESC LIMIT 1`
      )
      .get(projectId)
  )
  return row ?? null
}

// ---- 任务队列（M4） ----

export interface TaskRow {
  id: number
  projectId: number
  type: string
  status: 'pending' | 'running' | 'done' | 'failed'
  progress: number
  error: string | null
  retryCount: number
  createdAt: string
  updatedAt: string
}

export function enqueueTask(projectId: number, type: string): TaskRow | null {
  const db = getDb()
  // 幂等：同项目同类型存在 active（pending/running）任务则跳过
  const active = toRow<TaskRow>(
    db
      .prepare(
        `SELECT id, project_id AS projectId, type, status, progress, error,
                retry_count AS retryCount, created_at AS createdAt, updated_at AS updatedAt
         FROM tasks WHERE project_id = ? AND type = ? AND status IN ('pending', 'running')
         LIMIT 1`
      )
      .get(projectId, type)
  )
  if (active) return null

  const now = new Date().toISOString()
  const result = db
    .prepare(
      `INSERT INTO tasks (project_id, type, status, progress, retry_count, created_at, updated_at)
       VALUES (?, ?, 'pending', 0, 0, ?, ?)`
    )
    .run(projectId, type, now, now)

  return toRow<TaskRow>(
    db
      .prepare(
        `SELECT id, project_id AS projectId, type, status, progress, error,
                retry_count AS retryCount, created_at AS createdAt, updated_at AS updatedAt
         FROM tasks WHERE id = ?`
      )
      .get(result.lastInsertRowid)
  )!
}

export function listTasks(): Array<TaskRow & { projectName: string }> {
  const rows = toRows<TaskRow & { projectName: string }>(
    getDb()
      .prepare(
        `SELECT t.id, t.project_id AS projectId, t.type, t.status, t.progress, t.error,
                t.retry_count AS retryCount, t.created_at AS createdAt, t.updated_at AS updatedAt,
                p.name AS projectName
         FROM tasks t JOIN projects p ON p.id = t.project_id
         ORDER BY t.id DESC LIMIT 100`
      )
      .all()
  )
  return rows
}

export function listPendingTasks(): TaskRow[] {
  return toRows<TaskRow>(
    getDb()
      .prepare(
        `SELECT id, project_id AS projectId, type, status, progress, error,
                retry_count AS retryCount, created_at AS createdAt, updated_at AS updatedAt
         FROM tasks WHERE status = 'pending' ORDER BY id ASC`
      )
      .all()
  )
}

export function updateTask(
  id: number,
  patch: Partial<Pick<TaskRow, 'status' | 'progress' | 'error' | 'retryCount'>>
): void {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return
  const sets = entries.map(([k]) => `${snake(k)} = ?`).join(', ')
  getDb()
    .prepare(`UPDATE tasks SET ${sets}, updated_at = ? WHERE id = ?`)
    .run(...entries.map(([, v]) => v), new Date().toISOString(), id)
}

/**
 * 启动恢复：将遗留的 running 任务批量重置为 pending。
 * 应用被强制退出时任务会卡在 running（非 done 不算「已分析」、幂等挡住重新入队），
 * 重启后由队列重新取出续跑。README 拉取与翻译均幂等，重做代价可接受。
 */
export function resetStuckRunningTasks(): number {
  const result = getDb()
    .prepare(
      `UPDATE tasks SET status = 'pending', progress = 0, error = NULL, updated_at = ?
       WHERE status = 'running'`
    )
    .run(new Date().toISOString())
  return Number(result.changes)
}

export function getTaskById(id: number): TaskRow | null {
  return (
    toRow<TaskRow>(
      getDb()
        .prepare(
          `SELECT id, project_id AS projectId, type, status, progress, error,
                  retry_count AS retryCount, created_at AS createdAt, updated_at AS updatedAt
           FROM tasks WHERE id = ?`
        )
        .get(id)
    ) ?? null
  )
}

// ---- 标签 ----

export function listTags(): TagWithCount[] {
  const tagRows = toRows<TagRow & { count: number }>(
    getDb()
      .prepare(
        `SELECT t.id, t.name, t.name_cn AS nameCn, t.dimension, t.status, t.alias_of AS aliasOf,
                COUNT(pt.project_id) AS count
         FROM tags t
         LEFT JOIN project_tags pt ON pt.tag_id = t.id
         GROUP BY t.id
         ORDER BY CASE t.dimension WHEN 'type' THEN 0 WHEN 'tech' THEN 1 ELSE 2 END, count DESC, t.name`
      )
      .all()
  )
  return tagRows
}

/** 候选标签（status='candidate'，AI 建议待人工确认）+ 审核参考：关联项目数与项目名 */
export function listCandidateTags(): CandidateTagView[] {
  const rows = toRows<TagRow & { count: number; names: string | null }>(
    getDb()
      .prepare(
        `SELECT t.id, t.name, t.name_cn AS nameCn, t.dimension, t.status, t.alias_of AS aliasOf,
                COUNT(pt.project_id) AS count,
                GROUP_CONCAT(p.name, '、') AS names
         FROM tags t
         LEFT JOIN project_tags pt ON pt.tag_id = t.id
         LEFT JOIN projects p ON p.id = pt.project_id
         WHERE t.status = 'candidate'
         GROUP BY t.id
         ORDER BY count DESC, t.id`
      )
      .all()
  )
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    nameCn: r.nameCn,
    dimension: r.dimension,
    status: r.status,
    aliasOf: r.aliasOf,
    count: r.count,
    // 项目名截断（审核参考，最多 3 个）
    projectNames: (r.names ?? '').split('、').filter(Boolean).slice(0, 3)
  }))
}

function getTagById(id: number): TagInfo | null {
  return (
    toRow<TagRow>(
      getDb()
        .prepare(
          'SELECT id, name, name_cn AS nameCn, dimension, status, alias_of AS aliasOf FROM tags WHERE id = ?'
        )
        .get(id)
    ) ?? null
  )
}

/** 候选标签升级为正式标签（仅 candidate → official 生效） */
export function promoteTag(tagId: number): TagInfo | null {
  const result = getDb()
    .prepare("UPDATE tags SET status = 'official', alias_of = NULL WHERE id = ? AND status = 'candidate'")
    .run(tagId)
  if (Number(result.changes) === 0) return null
  return getTagById(tagId)
}

/**
 * 候选标签合并到正式标签：项目关联迁移到目标标签（目标已有关联跳过）→ 删除候选关联 →
 * 候选标记 merged 并记录 alias_of 指向（审计可追溯）。
 */
export function mergeTag(tagId: number, targetTagId: number): { ok: boolean; error?: string } {
  const db = getDb()
  if (tagId === targetTagId) return { ok: false, error: '不能合并到自身' }
  const target = getTagById(targetTagId)
  if (!target || target.status !== 'official') {
    return { ok: false, error: '合并目标必须是正式标签' }
  }
  // 关联迁移：INSERT OR IGNORE 保证目标已有同名关联不重复
  db.prepare(
    `INSERT OR IGNORE INTO project_tags (project_id, tag_id, source, confidence, ai_model, reason, created_at)
     SELECT project_id, ?, source, confidence, ai_model, reason, created_at FROM project_tags WHERE tag_id = ?`
  ).run(targetTagId, tagId)
  db.prepare('DELETE FROM project_tags WHERE tag_id = ?').run(tagId)
  db.prepare("UPDATE tags SET status = 'merged', alias_of = ? WHERE id = ?").run(targetTagId, tagId)
  return { ok: true }
}

/** 拒绝候选标签：标记 rejected 并移除其项目关联（被拒标签不应残留） */
export function rejectTag(tagId: number): void {
  const db = getDb()
  db.prepare("UPDATE tags SET status = 'rejected' WHERE id = ?").run(tagId)
  db.prepare('DELETE FROM project_tags WHERE tag_id = ?').run(tagId)
}

/**
 * 创建候选标签（AI 环节三 create_candidate）：status='candidate'，不挂项目，待人工确认后 promote。
 * 名称已存在（任何状态，大小写不敏感）则复用返回——rejected 复用时会重置为 candidate（防"幽灵标签"：
 * 即使 AI 绕过黑名单，被拒标签也回到候选池可见可管理，而不是以 rejected 状态挂回项目）。
 * nameCn 为中文展示名（可空）；已存在且中文名为空、本次提供时回填（AI 首次产出英文、后续产出中文时自动补上）。
 */
export function createCandidateTag(name: string, dimension: TagDimension, nameCn?: string | null): TagInfo {
  const db = getDb()
  const existing = toRow<TagRow>(
    db
      .prepare(
        'SELECT id, name, name_cn AS nameCn, dimension, status, alias_of AS aliasOf FROM tags WHERE name COLLATE NOCASE = ?'
      )
      .get(name)
  )
  if (existing) {
    if (nameCn && !existing.nameCn) {
      db.prepare('UPDATE tags SET name_cn = ? WHERE id = ?').run(nameCn, existing.id)
      existing.nameCn = nameCn
    }
    // 被拒标签复活：重置为候选，等待人工再次审核
    if (existing.status === 'rejected') {
      db.prepare("UPDATE tags SET status = 'candidate', alias_of = NULL WHERE id = ?").run(existing.id)
      return { ...existing, status: 'candidate', aliasOf: null }
    }
    return existing
  }

  const result = db
    .prepare("INSERT INTO tags (name, name_cn, dimension, status) VALUES (?, ?, ?, 'candidate')")
    .run(name, nameCn ?? null, dimension)
  return {
    id: result.lastInsertRowid as number,
    name,
    nameCn: nameCn ?? null,
    dimension,
    status: 'candidate',
    aliasOf: null
  }
}

/**
 * 按名称获取标签（存在则返回），否则创建后返回（status 默认 official）；nameCn 规则同 createCandidateTag。
 * 名称查找大小写不敏感（COLLATE NOCASE）：AI/话题的小写形式与语言/词表的规范大小写视为同一标签，
 * 防止「插件/Skill」与「插件/skill」这类大小写变体各自建行。
 */
export function getOrCreateTag(name: string, dimension: TagDimension, nameCn?: string | null): TagInfo {
  const db = getDb()
  const existing = toRow<TagRow>(
    db
      .prepare(
        'SELECT id, name, name_cn AS nameCn, dimension, status, alias_of AS aliasOf FROM tags WHERE name COLLATE NOCASE = ?'
      )
      .get(name)
  )
  if (existing) {
    if (nameCn && !existing.nameCn) {
      db.prepare('UPDATE tags SET name_cn = ? WHERE id = ?').run(nameCn, existing.id)
      existing.nameCn = nameCn
    }
    return existing
  }

  const result = db
    .prepare('INSERT INTO tags (name, name_cn, dimension) VALUES (?, ?, ?)')
    .run(name, nameCn ?? null, dimension)
  return {
    id: result.lastInsertRowid as number,
    name,
    nameCn: nameCn ?? null,
    dimension,
    status: 'official',
    aliasOf: null
  }
}

/** 项目打标：已存在（任何来源）则忽略（先到先得），否则记录来源与时间 */
export function assignTag(projectId: number, tagId: number, source: TagSource = 'user'): void {
  const db = getDb()
  const now = new Date().toISOString()
  const existing = toRow<{ id: number }>(
    db.prepare('SELECT id FROM project_tags WHERE project_id = ? AND tag_id = ?').get(projectId, tagId)
  )
  if (existing) {
    // 已挂过（AI/同步等其他来源）：手动添加视为人工确认，升级为指定来源并清空 AI 溯源，
    // 重跑 AI 分析时不会被覆盖（非 ai 来源先占跳过）
    db.prepare(
      `UPDATE project_tags SET source = ?, confidence = NULL, ai_model = NULL, reason = NULL, created_at = ?
       WHERE project_id = ? AND tag_id = ?`
    ).run(source, now, projectId, tagId)
  } else {
    db.prepare(
      `INSERT INTO project_tags (project_id, tag_id, source, created_at) VALUES (?, ?, ?, ?)`
    ).run(projectId, tagId, source, now)
  }
}

export interface ProjectTagInput {
  name: string
  dimension: TagDimension
  /** 中文展示名（可空；已存在且中文名为空时回填） */
  nameCn?: string | null
  /** AI 置信度 0-1（非 AI 来源忽略） */
  confidence?: number | null
  /** 打标模型（AI 溯源） */
  aiModel?: string | null
  /** AI 打标理由 */
  reason?: string | null
}

/**
 * 按来源替换项目的标签集合（language/topics 同步、AI 重分析共用）：
 * 先删该来源全部关联，再逐个写入；标签已存在（其他来源先占）则跳过，实现「先到先得」去重。
 * 名称归一化由调用方完成（tagNormalize）；DAO 按大小写不敏感查找已有标签，
 * 防止归一化后的小写形式与库中规范大小写（如「插件/Skill」）各自建行。
 */
export function replaceProjectTags(
  projectId: number,
  source: TagSource,
  items: ProjectTagInput[]
): void {
  const db = getDb()
  db.prepare('DELETE FROM project_tags WHERE project_id = ? AND source = ?').run(projectId, source)

  const exists = db.prepare('SELECT 1 FROM project_tags WHERE project_id = ? AND tag_id = ?')
  const insert = db.prepare(
    `INSERT INTO project_tags (project_id, tag_id, source, confidence, ai_model, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  const now = new Date().toISOString()
  for (const item of items) {
    if (!item.name) continue
    const tag = getOrCreateTag(item.name, item.dimension, item.nameCn)
    if (exists.get(projectId, tag.id)) continue // 其他来源先占，忽略
    insert.run(projectId, tag.id, source, item.confidence ?? null, item.aiModel ?? null, item.reason ?? null, now)
  }
}

/**
 * 追加项目标签（不删除既有关联）：标签已存在（任何来源）则跳过。
 * 用于候选标签挂载（AI 环节三 create_candidate 同时挂到当前项目，不影响环节二已写的 AI 标签）。
 */
export function appendProjectTag(
  projectId: number,
  name: string,
  dimension: TagDimension,
  source: TagSource,
  confidence?: number | null,
  aiModel?: string | null,
  reason?: string | null,
  nameCn?: string | null
): void {
  const db = getDb()
  if (!name) return
  const tag = getOrCreateTag(name, dimension, nameCn)
  const exists = db.prepare('SELECT 1 FROM project_tags WHERE project_id = ? AND tag_id = ?')
  if (exists.get(projectId, tag.id)) return
  db.prepare(
    `INSERT INTO project_tags (project_id, tag_id, source, confidence, ai_model, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(projectId, tag.id, source, confidence ?? null, aiModel ?? null, reason ?? null, new Date().toISOString())
}

/**
 * 移除项目标签（仅限 user 来源；AI/同步来源的标签不在此删除——
 * AI 标签由候选区审核或重跑分析管理，同步标签由同步流程管理）
 */
export function removeTag(projectId: number, tagId: number): void {
  getDb()
    .prepare("DELETE FROM project_tags WHERE project_id = ? AND tag_id = ? AND source = 'user'")
    .run(projectId, tagId)
}

/** 清理没有任何项目使用的标签 */
export function deleteOrphanTags(): void {
  getDb().exec(
    `DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM project_tags WHERE project_tags.tag_id = tags.id)`
  )
}

// ---- 项目详情（M3） ----

export function getProjectById(id: number): ProjectWithTags | null {
  const db = getDb()
  const found = toRow<ProjectRow>(
    db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ?`).get(id)
  )
  if (!found) return null
  return { ...mapProject(found), tags: getProjectTags(db, found.id) }
}

interface ReleaseRow {
  id: number
  project_id: number
  tag_name: string
  published_at: string | null
  body: string | null
  html_url: string | null
  assets: string | null
  checked_at: string
}

export function listReleases(projectId: number): ReleaseInfo[] {
  const rows = toRows<ReleaseRow>(
    getDb()
      .prepare(
        `SELECT id, project_id, tag_name, published_at, body, html_url, assets, checked_at
         FROM release_records WHERE project_id = ? ORDER BY published_at DESC`
      )
      .all(projectId)
  )
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    tagName: r.tag_name,
    publishedAt: r.published_at,
    body: r.body,
    htmlUrl: r.html_url,
    assets: parseReleaseAssets(r.assets),
    checkedAt: r.checked_at
  }))
}

function parseReleaseAssets(json: string | null): ReleaseAssetInfo[] {
  if (!json) return []
  try {
    const arr = JSON.parse(json) as unknown
    if (!Array.isArray(arr)) return []
    return arr
      .filter(
        (a): a is ReleaseAssetInfo =>
          !!a && typeof a === 'object' && typeof (a as ReleaseAssetInfo).name === 'string'
      )
      .map((a) => ({
        name: a.name,
        url: a.url ?? '',
        sha256: a.sha256 ?? null
      }))
  } catch {
    return []
  }
}

export function upsertReleases(
  projectId: number,
  releases: Array<Omit<ReleaseInfo, 'id' | 'projectId' | 'checkedAt'>>
): void {
  const db = getDb()
  const checkedAt = new Date().toISOString()
  const insert = db.prepare(
    `INSERT INTO release_records (project_id, tag_name, published_at, body, html_url, assets, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, tag_name) DO UPDATE SET
       published_at = excluded.published_at,
       body = excluded.body,
       html_url = excluded.html_url,
       assets = excluded.assets,
       checked_at = excluded.checked_at`
  )
  for (const r of releases) {
    insert.run(
      projectId,
      r.tagName,
      r.publishedAt,
      r.body,
      r.htmlUrl,
      JSON.stringify(r.assets),
      checkedAt
    )
  }
}

export function getNote(projectId: number): string {
  const row = toRow<{ content: string }>(
    getDb().prepare('SELECT content FROM notes WHERE project_id = ?').get(projectId)
  )
  return row?.content ?? ''
}

export function saveNote(projectId: number, content: string): void {
  const db = getDb()
  const now = new Date().toISOString()
  const existing = toRow<{ id: number }>(
    db.prepare('SELECT id FROM notes WHERE project_id = ?').get(projectId)
  )
  if (existing) {
    db.prepare('UPDATE notes SET content = ?, updated_at = ? WHERE project_id = ?').run(
      content,
      now,
      projectId
    )
  } else {
    db.prepare(
      'INSERT INTO notes (project_id, content, created_at, updated_at) VALUES (?, ?, ?, ?)'
    ).run(projectId, content, now, now)
  }
}

// ---- README AI 分析 ----

export interface ReadmeAnalysisRow {
  id: number
  projectId: number
  language: string
  overview: string
  keyPoints: string
  rawJson: string | null
  model: string | null
  tokensUsed: number
  createdAt: string
}

/** 取某项目指定语言的最新 README 分析 */
export function getReadmeAnalysis(projectId: number, language: string): ReadmeAnalysisRow | null {
  const row = toRow<ReadmeAnalysisRow>(
    getDb()
      .prepare(
        `SELECT id, project_id AS projectId, language, overview, key_points AS keyPoints,
                raw_json AS rawJson, model, tokens_used AS tokensUsed, created_at AS createdAt
         FROM readme_analyses WHERE project_id = ? AND language = ? ORDER BY id DESC LIMIT 1`
      )
      .get(projectId, language)
  )
  return row ?? null
}

export function saveReadmeAnalysis(input: {
  projectId: number
  language: string
  overview: string
  keyPoints: string
  rawJson: string | null
  model: string | null
  tokensUsed: number
}): void {
  getDb()
    .prepare(
      `INSERT INTO readme_analyses
         (project_id, language, overview, key_points, raw_json, model, tokens_used, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.projectId,
      input.language,
      input.overview,
      input.keyPoints,
      input.rawJson,
      input.model,
      input.tokensUsed,
      new Date().toISOString()
    )
}

// ---- 历史版本记录 AI 分析 ----

interface ReleaseAnalysisRow {
  projectId: number
  version: string
  description: string | null
  descriptionZh: string | null
  files: string
  model: string | null
  tokensUsed: number
  createdAt: string
}

export function listReleaseAnalyses(projectId: number): ReleaseAnalysisInfo[] {
  const rows = toRows<ReleaseAnalysisRow>(
    getDb()
      .prepare(
        `SELECT project_id AS projectId, version, description, description_zh AS descriptionZh,
                files, model, tokens_used AS tokensUsed, created_at AS createdAt
         FROM release_analyses WHERE project_id = ? ORDER BY created_at DESC`
      )
      .all(projectId)
  )
  return rows.map((r) => ({
    projectId: r.projectId,
    version: r.version,
    description: r.description,
    descriptionZh: r.descriptionZh,
    files: parseReleaseFiles(r.files),
    model: r.model,
    tokensUsed: r.tokensUsed,
    createdAt: r.createdAt
  }))
}

function parseReleaseFiles(json: string): ReleaseFileInfo[] {
  try {
    const arr = JSON.parse(json) as unknown
    if (!Array.isArray(arr)) return []
    return arr
      .filter((f): f is ReleaseFileInfo => !!f && typeof f === 'object' && typeof (f as ReleaseFileInfo).name === 'string')
      .map((f) => ({
        name: f.name,
        sha256: f.sha256 ?? null,
        url: f.url ?? '',
        note: f.note ?? ''
      }))
  } catch {
    return []
  }
}

/** 每项目每版本一行（唯一键 project_id + version），重复分析覆盖更新 */
export function saveReleaseAnalysis(input: {
  projectId: number
  version: string
  description: string | null
  descriptionZh: string | null
  files: ReleaseFileInfo[]
  model: string | null
  tokensUsed: number
}): void {
  getDb()
    .prepare(
      `INSERT INTO release_analyses
         (project_id, version, description, description_zh, files, model, tokens_used, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, version) DO UPDATE SET
         description = excluded.description,
         description_zh = excluded.description_zh,
         files = excluded.files,
         model = excluded.model,
         tokens_used = excluded.tokens_used,
         created_at = excluded.created_at`
    )
    .run(
      input.projectId,
      input.version,
      input.description,
      input.descriptionZh,
      JSON.stringify(input.files),
      input.model,
      input.tokensUsed,
      new Date().toISOString()
    )
}

/** 项目最近一次成功拉取 Releases 的时间（MAX(checked_at)），无记录返回 null */
export function getLastReleaseCheck(projectId: number): string | null {
  const row = toRow<{ checked_at: string | null }>(
    getDb()
      .prepare('SELECT MAX(checked_at) AS checked_at FROM release_records WHERE project_id = ?')
      .get(projectId)
  )
  return row?.checked_at ?? null
}

// ---- AI 使用统计（模型统计页） ----

export function logAiUsage(input: {
  model: string
  functionName: string
  tokensUsed: number
  durationMs: number
  error: string | null
  startedAt: Date
  finishedAt: Date
}): void {
  getDb()
    .prepare(
      `INSERT INTO ai_usage_logs
         (model, function_name, tokens_used, duration_ms, error, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.model,
      input.functionName,
      input.tokensUsed,
      input.durationMs,
      input.error,
      input.startedAt.toISOString(),
      input.finishedAt.toISOString()
    )
}

export interface AiUsagePoint {
  label: string
  tokens: number
  requests: number
  durationMs: number
}

/** 时间维度聚合（year / month / day），可按模型过滤；返回按时间升序的点 */
export function getAiUsageSeries(
  dimension: 'year' | 'month' | 'day',
  model: string | null
): AiUsagePoint[] {
  const fmt = dimension === 'year' ? '%Y' : dimension === 'month' ? '%Y-%m' : '%Y-%m-%d'
  const rows = toRows<{ label: string; tokens: number; requests: number; durationMs: number }>(
    getDb()
      .prepare(
        `SELECT strftime('${fmt}', started_at) AS label,
                SUM(tokens_used) AS tokens, COUNT(*) AS requests, SUM(duration_ms) AS durationMs
         FROM ai_usage_logs ${model ? 'WHERE model = ?' : ''}
         GROUP BY label ORDER BY label ASC`
      )
      .all(...(model ? [model] : []))
  )
  return rows.map((r) => ({
    label: r.label,
    tokens: r.tokens ?? 0,
    requests: r.requests ?? 0,
    durationMs: r.durationMs ?? 0
  }))
}

/** 各模型累计（token 降序） */
export function getAiUsageByModel(): Array<{
  model: string
  tokens: number
  requests: number
  durationMs: number
}> {
  return toRows<{ model: string; tokens: number; requests: number; durationMs: number }>(
    getDb()
      .prepare(
        `SELECT model, SUM(tokens_used) AS tokens, COUNT(*) AS requests, SUM(duration_ms) AS durationMs
         FROM ai_usage_logs GROUP BY model ORDER BY tokens DESC`
      )
      .all()
  ).map((r) => ({ model: r.model, tokens: r.tokens ?? 0, requests: r.requests ?? 0, durationMs: r.durationMs ?? 0 }))
}

/** 各功能累计（token 降序） */
export function getAiUsageByFunction(): Array<{
  functionName: string
  tokens: number
  requests: number
}> {
  return toRows<{ functionName: string; tokens: number; requests: number }>(
    getDb()
      .prepare(
        `SELECT function_name AS functionName, SUM(tokens_used) AS tokens, COUNT(*) AS requests
         FROM ai_usage_logs GROUP BY function_name ORDER BY tokens DESC`
      )
      .all()
  ).map((r) => ({ functionName: r.functionName, tokens: r.tokens ?? 0, requests: r.requests ?? 0 }))
}

/** 汇总（可按模型过滤） */
export function getAiUsageSummary(model: string | null): {
  tokens: number
  requests: number
  durationMs: number
} {
  const row = toRow<{ tokens: number; requests: number; durationMs: number }>(
    getDb()
      .prepare(
        `SELECT SUM(tokens_used) AS tokens, COUNT(*) AS requests, SUM(duration_ms) AS durationMs
         FROM ai_usage_logs ${model ? 'WHERE model = ?' : ''}`
      )
      .get(...(model ? [model] : []))
  )
  return {
    tokens: row?.tokens ?? 0,
    requests: row?.requests ?? 0,
    durationMs: row?.durationMs ?? 0
  }
}

/** AI 使用记录分页查询（按开始时间倒序） */
export function getAiUsageLogPage(
  model: string | null,
  page: number,
  pageSize: number
): { rows: AiUsageLogInfo[]; total: number } {
  const db = getDb()
  const where = model ? 'WHERE model = ?' : ''
  const totalRow = toRow<{ total: number }>(
    db.prepare(`SELECT COUNT(*) AS total FROM ai_usage_logs ${where}`).get(...(model ? [model] : []))
  )
  const rows = toRows<{
    id: number
    model: string
    functionName: string
    tokensUsed: number
    durationMs: number
    error: string | null
    startedAt: string
    finishedAt: string
  }>(
    db
      .prepare(
        `SELECT id, model, function_name AS functionName, tokens_used AS tokensUsed,
                duration_ms AS durationMs, error, started_at AS startedAt, finished_at AS finishedAt
         FROM ai_usage_logs ${where} ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?`
      )
      .all(...(model ? [model] : []), pageSize, (page - 1) * pageSize)
  )
  return {
    rows: rows.map((r) => ({
      id: r.id,
      model: r.model,
      functionName: r.functionName,
      tokensUsed: r.tokensUsed ?? 0,
      durationMs: r.durationMs ?? 0,
      error: r.error,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt
    })),
    total: totalRow?.total ?? 0
  }
}

/** 按时间 × 模型展开的 token 序列（百分比面积图数据源） */
export function getAiUsageSeriesByModel(
  dimension: 'year' | 'month' | 'day'
): Array<{ label: string; model: string; tokens: number }> {
  const fmt = dimension === 'year' ? '%Y' : dimension === 'month' ? '%Y-%m' : '%Y-%m-%d'
  return toRows<{ label: string; model: string; tokens: number }>(
    getDb()
      .prepare(
        `SELECT strftime('${fmt}', started_at) AS label, model,
                SUM(tokens_used) AS tokens
         FROM ai_usage_logs GROUP BY label, model ORDER BY label ASC`
      )
      .all()
  ).map((r) => ({ label: r.label, model: r.model, tokens: r.tokens ?? 0 }))
}
