/** 主进程与渲染进程共享的类型定义（设计文档 §3 数据模型） */

export type TagDimension =
  | 'type'
  | 'tech'
  | 'purpose'
  | 'audience'
  | 'domain'
  | 'capability'
  | 'language'
  | 'topic'

export const TAG_DIMENSIONS: TagDimension[] = [
  'type',
  'tech',
  'purpose',
  'audience',
  'domain',
  'capability',
  'language',
  'topic'
]

/**
 * 编辑标签弹窗展示的维度（与 AI 打标三维对齐）：
 * 手动添加标签只在这三维里选；tech/audience/capability/language/topic 不在手动编辑范围
 * （language/topic 为同步来源专用维度，tech 等由 AI/历史数据产生，筛选仍覆盖全维度）。
 */
export const TAG_EDITOR_DIMENSIONS: TagDimension[] = ['type', 'domain', 'purpose']

export const TAG_DIMENSION_COLOR: Record<TagDimension, string> = {
  type: '#1677ff', // 蓝
  tech: '#52c41a', // 绿
  purpose: '#fa8c16', // 橙
  audience: '#722ed1', // 紫（适用人群）
  domain: '#eb2f96', // 粉（领域）
  capability: '#13c2c2', // 青（能力）
  language: '#8c8c8c', // 灰（语言）
  topic: '#d4b106' // 黄（GitHub 话题）
}

/** 标签来源：GitHub 仓库语言 / GitHub 话题 / 用户手动 / AI 分析 */
export type TagSource = 'language' | 'topic' | 'user' | 'ai'

/** 标签生命周期状态：official 正式 / candidate 候选（AI 建议待人工确认）；其余枚举预留 */
export type TagStatus = 'official' | 'candidate' | 'alias' | 'merged' | 'rejected' | 'deprecated'

/** 13 类类型词表（AI 打标 type 维度封闭集，禁自创；侧栏分类共用） */
export const TAG_TYPES = [
  '应用',
  '库',
  '框架',
  'CLI工具',
  '插件/Skill',
  '平台',
  '数据集',
  '模型',
  '文档/教程',
  '模板/脚手架',
  '主题/UI组件',
  '配置集',
  'Agent/工作流'
] as const

/**
 * type 维度封闭词表（AI 打标硬校验用，与 TAG_TYPES 同一份）：
 * 提示词与程序校验同源，词表外 type 在解析时强制移入建议词（设计文档 §5.2）。
 */
export const TAG_TYPE_VOCABULARY: readonly string[] = TAG_TYPES

/**
 * AI 标签分析功能总开关：
 * - true  = "分析选中"入队 tag_analysis（README 同步 + AI 三环节打标）
 * - false = 入队 readme_sync（只做 README 同步 + language/topics 物化）
 * 关闭时相关代码（tagAnalysis/prompts/候选审核）全部保留，随时可开，不清理。
 */
export const AI_TAG_ANALYSIS_ENABLED = true

export interface TagInfo {
  id: number
  name: string
  /** 中文展示名（AI 打标产出；专业术语/中文词表词为 null；界面显示 nameCn ?? name） */
  nameCn: string | null
  dimension: TagDimension
  status: TagStatus
  /** 别名指向的正式标签 id（status='alias' 时非空） */
  aliasOf: number | null
}

/** 项目维度上的标签（附带该关联的来源，用于 UI 徽标区分） */
export interface ProjectTagInfo extends TagInfo {
  source: TagSource
  /** AI 打标置信度 0-1（非 AI 来源为 null） */
  confidence: number | null
}

/** 候选标签（status='candidate'）+ 审核参考信息（关联项目数/名称） */
export interface CandidateTagView extends TagInfo {
  count: number
  projectNames: string[]
}

export interface TagWithCount extends TagInfo {
  count: number
}

export interface ProjectWithTags {
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
  topics: string[]
  /** GitHub 仓库真实更新时间（pushed_at） */
  pushedAt: string | null
  readmeCache: string | null
  /** 按语言检测归类的多语言 README 缓存 */
  readmeEn: string | null
  readmeZh: string | null
  /** AI 翻译的中文 README（无真实中文版时生成） */
  readmeZhAi: string | null
  /** 最近一次 AI README 翻译使用的模型（AI 分析页「使用模型」列回退来源） */
  readmeAiModel: string | null
  /** AI 标签分析产出的中文摘要（3 行内，写库于 project.cn_summary） */
  cnSummary: string | null
  lastVersion: string | null
  lastCheckedAt: string | null
  createdAt: string
  updatedAt: string
  tags: ProjectTagInfo[]
}

/** 版本附件的原始信息（GitHub API assets，随版本发布记录全量入库，供离线兜底） */
export interface ReleaseAssetInfo {
  name: string
  url: string
  sha256: string | null
}

export interface ReleaseInfo {
  id: number
  projectId: number
  tagName: string
  publishedAt: string | null
  body: string | null
  htmlUrl: string | null
  assets: ReleaseAssetInfo[]
  checkedAt: string
}

/** 版本发布记录中的单个文件（历史版本记录 AI 分析） */
export interface ReleaseFileInfo {
  name: string
  /** SHA-256（API digest 优先；缺失时由 AI 从版本描述中提取） */
  sha256: string | null
  /** 下载链接（API browser_download_url） */
  url: string
  /** 文件说明（AI 生成，如「Linux x64 版本」「Windows arm64 版本」） */
  note: string
}

/** 历史版本记录 AI 分析结果（每项目每版本一条） */
export interface ReleaseAnalysisInfo {
  projectId: number
  version: string
  description: string | null
  /** 发布说明的中文翻译（AI 生成；原文已是中文时原样） */
  descriptionZh: string | null
  files: ReleaseFileInfo[]
  model: string | null
  tokensUsed: number
  createdAt: string
}

/** 单次 AI 请求记录（模型统计明细，ai_usage_logs 表） */
export interface AiUsageLogInfo {
  id: number
  model: string
  /** 功能名: readme_analyze | readme_translate | release_analyze | project_summary | test_connection */
  functionName: string
  tokensUsed: number
  durationMs: number
  error: string | null
  startedAt: string
  finishedAt: string
}

export interface AddProjectResult {
  project: ProjectWithTags
  duplicate: boolean
  metaError: string | null
}

/** GitHub 账号状态（最近一次验证结果；expired 仅对 fine-grained token 可精确识别） */
export type GithubTokenStatus = 'ok' | 'expired' | 'invalid' | 'permission' | 'unknown'

/** GitHub 账号视图（不含 token，token 加密存储不可回显） */
export interface GithubAccountView {
  id: number
  alias: string
  login: string
  name: string | null
  avatarUrl: string | null
  scopes: string | null
  tokenStatus: GithubTokenStatus
  lastCheckedAt: string | null
  createdAt: string
  updatedAt: string
}

/** 导入 star 项目两步进度（phase: listing 拉取中 / readme 处理中；account 为当前账号 login） */
export type StarredImportProgress =
  | { phase: 'listing'; account: string; fetched: number; added: number; duplicates: number }
  | { phase: 'readme'; account: string; total: number; done: number; failed: number }

/** 单账号导入结果 */
export interface StarredImportAccountResult {
  login: string
  /** 拉取到的 star 总数 */
  total: number
  /** 本次新入库项目数 */
  added: number
  /** 已存在跳过数 */
  duplicates: number
  /** 第二阶段补全 README 工作集大小 */
  readmeTotal: number
  readmeDone: number
  readmeFailed: number
}

export interface StarredImportResult {
  accounts: StarredImportAccountResult[]
}

export interface TaskItem {
  id: number
  projectId: number
  type: string
  status: 'pending' | 'running' | 'done' | 'failed'
  progress: number
  error: string | null
  retryCount: number
  createdAt: string
  updatedAt: string
  projectName?: string
}

export interface AiSummaryInfo {
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

/** README AI 分析记录（按语言各存最新一条） */
export interface ReadmeAnalysisInfo {
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
