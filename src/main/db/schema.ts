import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core'
/**
 * 数据模型（设计文档 §3）
 * projects 1—n project_tags n—1 tags
 * projects 1—n notes / ai_summaries / tasks / release_records
 * settings 为 key-value 单表
 */

export const projects = sqliteTable(
  'projects',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    owner: text('owner').notNull(),
    repo: text('repo').notNull(),
    githubUrl: text('github_url').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    starCount: integer('star_count').notNull().default(0),
    forkCount: integer('fork_count').notNull().default(0),
    language: text('language'),
    homepage: text('homepage'),
    // GitHub 官方标签（JSON 数组字符串，AI 打标的输入信号）
    topics: text('topics').notNull().default('[]'),
    // GitHub 仓库真实更新时间（pushed_at，区别于本地检查更新时间 last_checked_at）
    pushedAt: text('pushed_at'),
    readmeCache: text('readme_cache'),
    // 多语言 README 缓存（按语言检测归类；readme_cache 保留主 README 原文兼容旧数据）
    readmeEnCache: text('readme_en_cache'),
    readmeZhCache: text('readme_zh_cache'),
    // AI 翻译的中文 README（仅当无真实中文版时生成，与真实版区分）
    readmeZhAiCache: text('readme_zh_ai_cache'),
    // 最近一次 AI README 翻译使用的模型（AI 分析页「使用模型」列回退来源）
    readmeAiModel: text('readme_ai_model'),
    // AI 标签分析产出的中文摘要（3 行内，每次分析全量覆盖）
    cnSummary: text('cn_summary'),
    lastVersion: text('last_version'),
    lastCheckedAt: text('last_checked_at'),
    // 是否存在用户尚未查看的新版本（检查更新时置 1，进详情/看版本后置 0）
    hasUpdate: integer('has_update').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (t) => [uniqueIndex('projects_owner_repo_uniq').on(t.owner, t.repo)]
)

export const tags = sqliteTable(
  'tags',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // dimension: type | tech | purpose | audience | domain | capability | language | topic（设计文档 §3）
    dimension: text('dimension').notNull(),
    name: text('name').notNull(),
    // 中文展示名（AI 打标产出；专业术语/中文词表词为 NULL，界面显示 name_cn ?? name）
    nameCn: text('name_cn'),
    // 生命周期状态：official 正式标签 / candidate 候选（AI 建议待人工确认）；alias/merged/rejected/deprecated 预留
    status: text('status').notNull().default('official'),
    // 别名指向的正式标签 id（status='alias' 时使用）
    aliasOf: integer('alias_of')
  },
  (t) => [uniqueIndex('tags_name_uniq').on(t.name)]
)

export const projectTags = sqliteTable(
  'project_tags',
  {
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    // 标签来源：language 仓库语言 / topic GitHub 话题 / user 手动 / ai AI 分析（先到先得，重复来源忽略）
    source: text('source').notNull().default('user'),
    // AI 打标置信度 0-1（非 AI 来源为 NULL）
    confidence: real('confidence'),
    // 打标模型（AI 溯源）
    aiModel: text('ai_model'),
    // AI 打标理由（归一化匹配环节的 reason）
    reason: text('reason'),
    createdAt: text('created_at').notNull().default('1970-01-01T00:00:00Z')
  },
  (t) => [uniqueIndex('project_tags_uniq').on(t.projectId, t.tagId)]
)

export const notes = sqliteTable(
  'notes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    content: text('content').notNull().default(''),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (t) => [index('notes_project_idx').on(t.projectId)]
)

export const aiSummaries = sqliteTable(
  'ai_summaries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    intro: text('intro'),
    usage: text('usage'),
    techAnalysis: text('tech_analysis'),
    learningValue: text('learning_value'),
    // 五维项目画像 JSON（定位/痛点/上手/时机/效果），升级版 ai_summaries 主字段
    profile: text('profile'),
    rawJson: text('raw_json'),
    model: text('model'),
    tokensUsed: integer('tokens_used').notNull().default(0),
    createdAt: text('created_at').notNull()
  },
  (t) => [index('ai_summaries_project_idx').on(t.projectId)]
)

export const tasks = sqliteTable(
  'tasks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    // type: readme_sync（拉取 README + 无中文时 AI 翻译；原 ai_summary 摘要功能已暂停）
    type: text('type').notNull(),
    // status: pending | running | done | failed
    status: text('status').notNull().default('pending'),
    progress: integer('progress').notNull().default(0),
    error: text('error'),
    retryCount: integer('retry_count').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (t) => [index('tasks_status_idx').on(t.status), index('tasks_project_idx').on(t.projectId)]
)

export const releaseRecords = sqliteTable(
  'release_records',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    tagName: text('tag_name').notNull(),
    publishedAt: text('published_at'),
    body: text('body'),
    htmlUrl: text('html_url'),
    // 附件原始信息 JSON: ReleaseAssetInfo[]（name / url / sha256），全量入库供离线兜底
    assets: text('assets'),
    checkedAt: text('checked_at').notNull()
  },
  (t) => [
    index('release_records_project_idx').on(t.projectId),
    uniqueIndex('release_records_project_tag').on(t.projectId, t.tagName)
  ]
)

/** README AI 分析（按语言各存最新一条） */
export const readmeAnalyses = sqliteTable(
  'readme_analyses',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    // language: zh | en（分析结果的界面语言）
    language: text('language').notNull(),
    overview: text('overview').notNull(),
    keyPoints: text('key_points').notNull(),
    rawJson: text('raw_json'),
    model: text('model'),
    tokensUsed: integer('tokens_used').notNull().default(0),
    createdAt: text('created_at').notNull()
  },
  (t) => [index('readme_analyses_project_idx').on(t.projectId)]
)

/** 历史版本记录 AI 分析（每项目每版本一行;文件列表 JSON 存储） */
export const releaseAnalyses = sqliteTable(
  'release_analyses',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    version: text('version').notNull(),
    description: text('description'),
    // 发布说明的中文翻译（AI 生成;原文已是中文时原样）
    descriptionZh: text('description_zh'),
    // JSON: ReleaseFileInfo[]（name / sha256 / url / note）
    files: text('files').notNull(),
    model: text('model'),
    tokensUsed: integer('tokens_used').notNull().default(0),
    createdAt: text('created_at').notNull()
  },
  (t) => [uniqueIndex('release_analyses_project_version').on(t.projectId, t.version)]
)

/** 历史版本文件类型字典：本地规则 + AI 补全的结构化类型，去重后供全局过滤使用 */
export const releaseFileTypes = sqliteTable(
  'release_file_types',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    platform: text('platform').notNull().default('other'),
    arch: text('arch'),
    kind: text('kind').notNull().default('other'),
    // 展示标签，优先与实际 note 一致（如「Windows x64 版本」），去重键
    label: text('label').notNull(),
    // 来源：rule 本地规则 / ai AI 补全
    source: text('source').notNull().default('rule'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (t) => [uniqueIndex('release_file_types_label_uniq').on(t.label)]
)

/** AI 调用使用统计（每次 chat 请求一条;模型统计页数据源） */
export const aiUsageLogs = sqliteTable(
  'ai_usage_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    model: text('model').notNull(),
    // 功能名: readme_analyze | readme_translate | release_analyze | project_summary | test_connection
    functionName: text('function_name').notNull(),
    tokensUsed: integer('tokens_used').notNull().default(0),
    durationMs: integer('duration_ms').notNull().default(0),
    // 失败时的错误信息（成功为 null）
    error: text('error'),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at').notNull()
  },
  (t) => [
    index('ai_usage_logs_started_idx').on(t.startedAt),
    index('ai_usage_logs_model_idx').on(t.model)
  ]
)

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})

/** GitHub 账号（多 token 管理）：token 加密存储；token_status 支持过期/无效/权限不足识别 */
export const githubAccounts = sqliteTable('github_accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // 备注名（用户可改，默认 = login）
  alias: text('alias').notNull(),
  // safeStorage 加密的 token（不可回显）
  tokenEnc: text('token_enc').notNull(),
  login: text('login').notNull(),
  // 昵称（GET /user 的 name 字段，可能为空）
  name: text('name'),
  avatarUrl: text('avatar_url'),
  // 经典 token 的权限范围（X-OAuth-Scopes 响应头，fine-grained 无）
  scopes: text('scopes'),
  // 最近一次验证结果: ok | expired | invalid | permission | unknown
  tokenStatus: text('token_status').notNull().default('unknown'),
  lastCheckedAt: text('last_checked_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

/** 预约任务（定时调度）：到达开始时间后自动入队对应分析任务 */
export const scheduledTasks = sqliteTable(
  'scheduled_tasks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    // type: ai_analysis（AI 标签分析）| readme_analyze（README 分析）
    type: text('type').notNull(),
    // 开始时间（ISO 字符串），到达后自动入队
    startAt: text('start_at').notNull(),
    // 结束时间（可选，不设为 null 表示无结束）
    endAt: text('end_at'),
    // 生命周期：pending 未开始 / running 执行中 / done 已完成 / failed 失败
    status: text('status').notNull().default('pending'),
    // 触发后对应的任务 id（执行中/完成溯源）
    taskId: integer('task_id'),
    // 是否启用（预留暂停能力）
    enabled: integer('enabled').notNull().default(1),
    createdAt: text('created_at').notNull()
  },
  (t) => [
    index('scheduled_tasks_project_idx').on(t.projectId)
    // 去重改为代码层校验「active（pending/running）」：完成/失败后允许重新预约
  ]
)

// ---- 类型导出 ----
export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type Tag = typeof tags.$inferSelect
export type NewTag = typeof tags.$inferInsert
export type Note = typeof notes.$inferSelect
export type AiSummary = typeof aiSummaries.$inferSelect
export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
export type ReleaseRecord = typeof releaseRecords.$inferSelect
export type GithubAccount = typeof githubAccounts.$inferSelect
