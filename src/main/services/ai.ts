import { getSetting, hasSetting, setSetting, logAiUsage } from '../db/dao'
import { httpFetch } from './network'
import { decryptSecret, encryptSecret } from './secret'
import { msg } from '../msg'
import type { ProjectWithTags, ProjectProfile, ReleaseFileInfo } from '../../shared/types'
import { getEnglishReadmeSource } from '../../shared/readme'
import type { ReleaseData } from './github'
import { inferReleaseFileNote } from './releaseFileNote'
import { truncateReadme } from './readmeTruncate'
import {
  PROJECT_PROFILE_SYSTEM_PROMPT,
  buildProjectProfileUserPrompt
} from './prompts/projectProfilePrompt'
import {
  classifyReleaseFile,
  normalizeArch,
  normalizeKind,
  normalizePlatform
} from '../../shared/releaseFileType'

/**
 * AI 服务（设计文档 §6）
 * - OpenAI Compatible API：OpenAI / DeepSeek / Ollama
 * - JSON 结构化输出（DeepSeek/OpenAI 用 response_format，Ollama 走 prompt 约束 + 解析兜底）
 * - API Key 经 safeStorage 加密存储
 */

export interface AiModelConfig {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
}

// ---- 配置存取（多模型 Profile，safeStorage 加密 API Key） ----

/** 模型配置条目（多模型管理，存于 settings 表 'ai.models'） */
export interface ModelProfile {
  id: string
  provider: string
  baseUrl: string
  apiKeyEnc: string
  model: string
  alias: string
  remark: string
  enabled: boolean
  isDefault: boolean
}

/** 渲染层可见的模型视图（不含密钥） */
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

/** 首次读取时迁移旧版单条配置（ai.provider 等键）为多模型列表 */
export function listModelProfiles(): ModelProfile[] {
  const stored = getSetting<ModelProfile[]>('ai.models', [])
  if (stored.length > 0) {
    // 兼容旧数据：补齐 alias / remark 默认值
    return stored.map((p) => ({ ...p, alias: p.alias ?? '', remark: p.remark ?? '' }))
  }

  // 仅当旧版单条配置真实存在于 settings 表时才迁移。
  // 不能用 getSetting 的 fallback 判断：键不存在时 baseUrl 会返回默认值,
  // 导致全新安装(无任何配置)也被误判为「有旧配置」而凭空生成默认模型
  if (!hasSetting('ai.baseUrl') && !hasSetting('ai.provider') && !hasSetting('ai.model')) {
    return []
  }
  const legacy = {
    provider: getSetting('ai.provider', 'deepseek'),
    baseUrl: getSetting('ai.baseUrl', 'https://api.deepseek.com/v1'),
    apiKeyEnc: getSetting('ai.apiKeyEnc', ''),
    model: getSetting('ai.model', 'deepseek-chat')
  }
  const profiles: ModelProfile[] = [
    { id: crypto.randomUUID(), ...legacy, alias: '', remark: '', enabled: true, isDefault: true }
  ]
  setSetting('ai.models', profiles)
  return profiles
}

/** 当前生效配置：默认且启用 → 首个启用；无则空配置 */
export function getModelConfig(): AiModelConfig {
  const profiles = listModelProfiles()
  const active = profiles.find((p) => p.isDefault && p.enabled) ?? profiles.find((p) => p.enabled)
  if (!active) return { provider: '', baseUrl: '', apiKey: '', model: '' }
  return {
    provider: active.provider,
    baseUrl: active.baseUrl,
    apiKey: decryptSecret(active.apiKeyEnc),
    model: active.model
  }
}

/** 保存（新增或按 id 更新）模型；第一个模型自动设为默认 */
export function saveModelProfile(input: {
  id?: string
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  alias: string
  remark: string
}): ModelProfile[] {
  const profiles = listModelProfiles()
  const apiKeyEnc = input.apiKey ? encryptSecret(input.apiKey) : undefined
  if (input.id) {
    const idx = profiles.findIndex((p) => p.id === input.id)
    if (idx >= 0) {
      profiles[idx] = {
        ...profiles[idx],
        provider: input.provider,
        baseUrl: input.baseUrl,
        model: input.model,
        alias: input.alias,
        remark: input.remark,
        ...(apiKeyEnc !== undefined ? { apiKeyEnc } : {})
      }
    }
  } else {
    profiles.push({
      id: crypto.randomUUID(),
      provider: input.provider,
      baseUrl: input.baseUrl,
      apiKeyEnc: apiKeyEnc ?? '',
      model: input.model,
      alias: input.alias,
      remark: input.remark,
      enabled: true,
      isDefault: profiles.length === 0
    })
  }
  setSetting('ai.models', profiles)
  return profiles
}

export function deleteModelProfile(id: string): ModelProfile[] {
  let profiles = listModelProfiles().filter((p) => p.id !== id)
  // 删除默认后，首个启用的顶上
  if (profiles.length > 0 && !profiles.some((p) => p.isDefault)) {
    const next = profiles.find((p) => p.enabled) ?? profiles[0]
    profiles = profiles.map((p) => ({ ...p, isDefault: p.id === next.id }))
  }
  setSetting('ai.models', profiles)
  return profiles
}

export function setDefaultModelProfile(id: string): ModelProfile[] {
  const profiles = listModelProfiles().map((p) => ({ ...p, isDefault: p.id === id }))
  setSetting('ai.models', profiles)
  return profiles
}

export function toggleModelProfile(id: string, enabled: boolean): ModelProfile[] {
  let profiles = listModelProfiles().map((p) => (p.id === id ? { ...p, enabled } : p))
  // 禁用默认 → 默认转移给首个启用
  if (!enabled) {
    const wasDefault = profiles.find((p) => p.id === id)?.isDefault
    if (wasDefault) {
      const next = profiles.find((p) => p.enabled)
      if (next) profiles = profiles.map((p) => ({ ...p, isDefault: p.id === next.id }))
    }
  }
  setSetting('ai.models', profiles)
  return profiles
}

export function hasModelConfig(config: AiModelConfig = getModelConfig()): boolean {
  return Boolean(config.baseUrl && config.apiKey && config.model)
}

// ---- Chat 调用 ----

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatResult {
  content: string
  tokens: number
}

export async function chat(
  config: AiModelConfig,
  messages: ChatMessage[],
  jsonMode: boolean,
  // 功能名（模型统计埋点）: readme_analyze | readme_translate | release_analyze | project_summary | test_connection | tag_analyze | tag_normalize | tag_candidate
  functionName = 'unknown',
  // 超时毫秒（默认 120s；版本分析等重任务按需放宽）
  timeoutMs = 120_000,
  // 覆盖默认温度（标签分析三环节按环节用 0 / 0.2）
  temperature = 0.3
): Promise<ChatResult> {
  const base = config.baseUrl.replace(/\/+$/, '')
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature,
    stream: false
  }
  // Ollama 兼容端点不支持 response_format，走 prompt 约束（本地地址自动按 Ollama 处理）
  const isLocalBaseUrl = /localhost|127\.0\.0\.1|192\.168\.|10\.0\./.test(config.baseUrl)
  if (jsonMode && !config.provider.toLowerCase().includes('ollama') && !isLocalBaseUrl) {
    body.response_format = { type: 'json_object' }
  }

  const startedAt = new Date()
  let tokens = 0
  let error: string | null = null
  try {
    const res = await httpFetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(
        msg(
          `AI 服务错误 HTTP ${res.status}：${text.slice(0, 200)}`,
          `AI service error HTTP ${res.status}: ${text.slice(0, 200)}`
        )
      )
    }

    const j = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { total_tokens?: number }
    }
    const content = j.choices?.[0]?.message?.content ?? ''
    if (!content) throw new Error(msg('AI 服务返回为空', 'AI service returned empty content'))
    tokens = j.usage?.total_tokens ?? 0
    return { content, tokens }
  } catch (err) {
    error = err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200)
    throw err
  } finally {
    // 埋点：每次 AI 请求记录模型 / 功能 / 耗时 / token（成功或失败）
    const finishedAt = new Date()
    logAiUsage({
      model: config.model,
      functionName,
      tokensUsed: tokens,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      error,
      startedAt,
      finishedAt
    })
  }
}

// ---- 项目分析 ----

/** 输出语言规则（跟随应用设置：Settings → General → Language；标签枚举始终为中文系统标签） */
const LANGUAGE_RULES: Record<string, string> = {
  'zh-CN':
    '输出语言规则：所有文本字段（intro、usage、techAnalysis、learningValue.reason）必须使用简体中文，严禁输出英文；专有名词（README、GitHub、AI、JSON 等）除外。',
  'en-US':
    'Output language rule: All text fields (intro, usage, techAnalysis, learningValue.reason) must be written in English. Technical terms like README, GitHub, AI, JSON are allowed.'
}

export function extractJson(text: string): unknown {
  // 直接解析失败时，去除代码块围栏后提取第一个 { ... } 片段，并修复尾逗号
  const cleaned = text.replace(/```(?:json)?\s*/gi, '').trim()
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s)
    } catch {
      return undefined
    }
  }
  const direct = tryParse(cleaned)
  if (direct !== undefined) return direct
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const slice = cleaned.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1')
    const withBrace = tryParse(slice)
    if (withBrace !== undefined) return withBrace
  }
  throw new Error(msg('AI 输出无法解析为 JSON', 'AI output could not be parsed as JSON'))
}

// ---- README 分析 ----

const README_ANALYSIS_SYSTEM = `你是 GitHub 项目分析专家。根据项目信息与 README 内容，输出对该项目及 README 的总结分析。

输出必须是一个合法的 JSON 对象（不要用 markdown 代码块包裹，不要输出任何其他文字），字段如下：
{
  "overview": "项目与 README 的总结概述（150 字内）",
  "keyPoints": ["要点，最多 5 条，每条 30 字内"]
}`

function normalizeReadmeAnalysis(raw: unknown): { overview: string; keyPoints: string[] } {
  const j = (raw ?? {}) as Record<string, unknown>
  const keyPoints = Array.isArray(j.keyPoints)
    ? (j.keyPoints as unknown[])
        .map((k) => String(k).trim())
        .filter(Boolean)
        .slice(0, 5)
    : []
  return {
    overview: String(j.overview ?? '').trim() || msg('暂无概述', 'No overview'),
    keyPoints
  }
}

/** README AI 分析：总结项目与 README 内容（结果语言跟随界面语言） */
export async function analyzeReadme(
  project: ProjectWithTags,
  language: 'zh' | 'en'
): Promise<{ overview: string; keyPoints: string[]; tokens: number; model: string }> {
  const config = getModelConfig()
  if (!hasModelConfig(config)) {
    throw new Error(
      msg(
        '未配置 AI 模型，请先在 设置 → 模型配置 中配置',
        'AI model not configured. Please configure it in Settings → Model Configuration.'
      )
    )
  }

  // 与标签分析共用关键段落截断：README 很长时避免把无关长尾全量发给 AI
  const readme = truncateReadme(
    project.readmeCache ?? project.readmeEn ?? project.readmeZh ?? '',
    8000
  )
  const appLanguage = language === 'zh' ? 'zh-CN' : 'en-US'
  const langRule = LANGUAGE_RULES[appLanguage] ?? LANGUAGE_RULES['zh-CN']
  const userPrompt = `项目名称：${project.name}
项目描述：${project.description ?? '无'}
主要语言：${project.language ?? '未知'}

README 内容：
${readme || '（无）'}

请按系统要求输出 JSON 分析报告。`

  const { content, tokens } = await chat(
    config,
    [
      { role: 'system', content: `${README_ANALYSIS_SYSTEM}\n\n${langRule}` },
      { role: 'user', content: userPrompt }
    ],
    true,
    'readme_analyze'
  )
  const result = normalizeReadmeAnalysis(extractJson(content))
  return { ...result, tokens, model: config.model }
}

// ---- 五维项目画像（恢复并升级 ai_summaries） ----

/** 解析 AI 输出的五维画像 JSON，宽松兜底（字段缺失留空、评分夹到 1-5） */
export function normalizeProjectProfile(raw: unknown): ProjectProfile {
  const j = (raw ?? {}) as Record<string, unknown>
  const score = Number(j.learning_score)
  const learningScore =
    Number.isFinite(score) && score > 0 ? Math.min(5, Math.max(1, Math.round(score))) : 3
  return {
    positioning: String(j.positioning ?? '').trim(),
    painPoints: String(j.pain_points ?? '').trim(),
    gettingStarted: String(j.getting_started ?? '').trim(),
    suitableScenarios: String(j.suitable_scenarios ?? '').trim(),
    unsuitableScenarios: String(j.unsuitable_scenarios ?? '').trim(),
    effect: String(j.effect ?? '').trim(),
    learningScore,
    learningReason: String(j.learning_reason ?? '').trim()
  }
}

/** 生成五维项目画像（定位/痛点/上手/时机/效果），结果中文 */
export async function analyzeProjectProfile(
  project: ProjectWithTags
): Promise<{ profile: ProjectProfile; tokens: number; model: string }> {
  const config = getModelConfig()
  if (!hasModelConfig(config)) {
    throw new Error(
      msg(
        '未配置 AI 模型，请先在 设置 → 模型配置 中配置',
        'AI model not configured. Please configure it in Settings → Model Configuration.'
      )
    )
  }

  // 与标签/README 分析共用关键段落截断，避免长尾内容全量发给 AI
  const readme = truncateReadme(
    project.readmeCache ?? project.readmeEn ?? project.readmeZh ?? '',
    8000
  )
  const userPrompt = buildProjectProfileUserPrompt({
    name: project.name,
    url: project.githubUrl,
    description: project.description,
    language: project.language,
    topics: project.topics,
    stars: project.starCount,
    forks: project.forkCount,
    readme
  })

  const { content, tokens } = await chat(
    config,
    [
      { role: 'system', content: PROJECT_PROFILE_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    true,
    'project_summary'
  )
  const profile = normalizeProjectProfile(extractJson(content))
  return { profile, tokens, model: config.model }
}

const README_TRANSLATE_SYSTEM = `你是专业的 GitHub README 翻译。将用户提供的英文 README 翻译为简体中文。

要求：
- 忠实原文，保留 Markdown 格式（标题、列表、代码块、链接、表格等结构不变）
- 专有名词（项目名、库名、API 名、品牌名）可保留英文
- 只输出翻译结果，不要任何解释或额外文字
- 严禁将整个输出包裹在 markdown 代码块围栏（\`\`\`）中，直接输出翻译后的文档`

/** 剥离 AI 输出误加的外层 markdown 代码块围栏（如 ```markdown ... ``` 包裹全文的情况） */
function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const m = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/)
  return m ? m[1].trim() : trimmed
}

/** 同一项目同时只允许一次翻译请求，避免手动按钮、后台队列、IPC 入口并发重复调 AI */
const readmeTranslateInFlight = new Map<
  number,
  Promise<{ text: string; tokens: number; model: string }>
>()

async function doTranslateReadme(
  project: ProjectWithTags
): Promise<{ text: string; tokens: number; model: string }> {
  const config = getModelConfig()
  if (!hasModelConfig(config)) {
    throw new Error(
      msg(
        '未配置 AI 模型，请先在 设置 → 模型配置 中配置',
        'AI model not configured. Please configure it in Settings → Model Configuration.'
      )
    )
  }

  // 完整翻译：尽量覆盖整份 README（上限放宽到 2 万字符，超出部分由模型尽力处理）
  const source = getEnglishReadmeSource(project).slice(0, 20000)
  if (!source) throw new Error(msg('没有可翻译的英文 README', 'No English README to translate'))

  const { content, tokens } = await chat(
    config,
    [
      { role: 'system', content: README_TRANSLATE_SYSTEM },
      { role: 'user', content: source }
    ],
    false,
    'readme_translate'
  )
  return { text: stripCodeFence(content), tokens, model: config.model }
}

/** 将英文 README 翻译为简体中文（保留 Markdown 结构），供无中文版仓库的中文用户阅读 */
export function translateReadme(
  project: ProjectWithTags
): Promise<{ text: string; tokens: number; model: string }> {
  const existing = readmeTranslateInFlight.get(project.id)
  if (existing) return existing

  const task = doTranslateReadme(project)
  readmeTranslateInFlight.set(project.id, task)
  void task.finally(() => {
    if (readmeTranslateInFlight.get(project.id) === task) {
      readmeTranslateInFlight.delete(project.id)
    }
  })
  return task
}

/** 历史版本记录分析：AI 翻译版本说明；仅对本地规则无法推断说明或 API 缺少 SHA-256 的文件做兜底 */
const RELEASE_ANALYSIS_SYSTEM = `你是软件发布信息整理助手。下面是某个 GitHub 项目各版本（Release）的发布信息 JSON 数组。

每个版本包含：
- version：版本号
- description：发布说明（通常为英文，可能包含文件校验和）
- files：需要你补充的文件列表；每项只包含需要处理的字段：
  - name：文件名
  - sha256：值为 null 表示该文件缺少 SHA-256，需要你尝试从 description 中提取
  - note：值为 null 表示该文件没有现成说明，需要你根据文件名与发布说明推断平台说明

任务：
1. 将每个版本的发布说明 description 翻译为简体中文（若原文已是简体中文则原样保留），存入 descriptionZh；翻译要完整覆盖原文要点，保留 Markdown 结构。
2. 对 sha256 为 null 的文件，尽力从该版本的发布说明中提取其 SHA-256（通常形如 "SHA256: xxxx"、"sha256sum xxxx"、"xxxx  <文件名>"）；确实找不到则为 null。
3. 对 note 为 null 的文件，生成一行简短的中文说明 note（如 Linux x64 版本、Windows arm64 版本、macOS 安装包、源代码压缩包），并同时输出结构化字段：
   - platform：平台小写键，优先使用 windows / macos / linux / android / ios / freebsd / chromeos；遇到规则外的新平台可写简短小写英文键，无法判断写 other
   - arch：架构小写键，优先使用 x64 / arm64 / x86 / arm32 / universal / riscv64 / loongarch64；无法判断写 other
   - kind：包类型小写键，优先使用 installer / source / checksum / signature；遇到规则外的新包类型可写简短小写英文键，无法判断写 other
   文件名无法明确判断平台的 platform 写 other，严禁臆造文件名不支持的平台。
4. 输出必须包含输入中的所有版本，顺序不变，且每个版本都必须输出 version 与 descriptionZh；files 只输出需要补全的文件项（sha256 或 note 原本为 null 的文件），不需要补全的文件不要输出；没有需要补全的文件时 files 可为空数组或省略。

只输出一个合法的 JSON 数组，不要 markdown 代码块、不要任何其他文字：
[{"version": "...", "descriptionZh": "...", "files": [{"name": "...", "sha256": "..."或null, "note": "...", "platform": "windows", "arch": "x64", "kind": "installer"}]}]`

/** 解析 AI 输出的 JSON 数组（去代码块 → 直接解析 → 提取片段 → 尾逗号 / 截断修复） */
function extractJsonArray(text: string): unknown {
  // 去除 markdown 代码块围栏（```json / ```）
  const cleaned = text.replace(/```(?:json)?\s*/gi, '').trim()

  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s)
    } catch {
      return undefined
    }
  }

  const direct = tryParse(cleaned)
  if (direct !== undefined) return direct

  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start >= 0 && end > start) {
    let slice = cleaned.slice(start, end + 1)
    // 修复尾逗号（AI 常见输出习惯）
    slice = slice.replace(/,\s*([}\]])/g, '$1')
    const withBrace = tryParse(slice)
    if (withBrace !== undefined) return withBrace
    // 输出被截断（结尾缺失）：从后往前找最后一个完整对象，尝试闭合数组
    for (let i = slice.lastIndexOf('}'); i > start; i = slice.lastIndexOf('}', i - 1)) {
      const candidate = tryParse(slice.slice(0, i + 1) + ']')
      if (candidate !== undefined) return candidate
    }
  }
  // 排查用：打印输出头部，便于定位格式问题
  console.error('[ai] extractJsonArray failed, head:', cleaned.slice(0, 500))
  throw new Error(
    msg(
      'AI 输出无法解析为 JSON（可能被截断或格式异常），可重试一次',
      'AI output could not be parsed as JSON (possibly truncated). Please retry.'
    )
  )
}

/**
 * AI 分析版本发布记录：翻译版本说明为中文；本地规则无法推断说明或 API 缺少 SHA-256 的文件才交给 AI。
 * 返回与 releases 对应的版本列表（仅含至少有一个文件的版本）。
 */
export async function analyzeReleaseVersions(releases: ReleaseData[]): Promise<{
  result: Array<{ version: string; descriptionZh: string | null; files: ReleaseFileInfo[] }>
  tokens: number
  model: string
}> {
  const config = getModelConfig()
  if (!hasModelConfig(config)) {
    throw new Error(
      msg(
        '未配置 AI 模型，请先在 设置 → 模型配置 中配置',
        'AI model not configured. Please configure it in Settings → Model Configuration.'
      )
    )
  }

  // 构造输入：只分析带文件的版本；发布说明截断控制体量，文件上限 15 个/版本。
  // url 由 API 回填、已知 sha256 无需模型处理，均不发送；
  // 本地规则能推断说明的文件也不发送，进一步减少输入与输出 token。
  const input = releases
    .filter((r) => r.assets.length > 0)
    .map((r) => ({
      version: r.tagName,
      description: (r.body ?? '').slice(0, 1500),
      files: r.assets.slice(0, 15).flatMap((a) => {
        const entry: Record<string, string | null> = { name: a.name }
        if (!a.sha256) entry.sha256 = null
        if (!inferReleaseFileNote(a.name)) entry.note = null
        return Object.keys(entry).length > 1 ? [entry] : []
      })
    }))
  if (input.length === 0) {
    throw new Error(
      msg('该项目没有带附件的版本发布记录', 'This project has no releases with assets')
    )
  }

  // 分批调用 AI：版本很多时一次性生成容易超时（clash-verge-rev 这类项目几十个版本），
  // 每批 5 个版本串行分析，结果合并、tokens 累加；单批超时放宽到 5 分钟
  const BATCH_SIZE = 5
  let tokens = 0
  const merged: Array<Record<string, unknown>> = []
  for (let i = 0; i < input.length; i += BATCH_SIZE) {
    const batch = input.slice(i, i + BATCH_SIZE)
    const { content, tokens: batchTokens } = await chat(
      config,
      [
        { role: 'system', content: RELEASE_ANALYSIS_SYSTEM },
        { role: 'user', content: JSON.stringify(batch) }
      ],
      true,
      'release_analyze',
      300_000
    )
    tokens += batchTokens
    const raw = extractJsonArray(content)
    if (Array.isArray(raw)) merged.push(...raw)
  }

  // 以 API 数据为准合并 AI 结果：url 用 API 的；sha256 优先 API digest；
  // note 优先本地命名规则，规则无法识别时回退 AI 生成
  const aiByVersion = new Map<string, Record<string, unknown>>()
  for (const item of merged) {
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>).version === 'string'
    ) {
      const rec = item as Record<string, unknown>
      aiByVersion.set(String(rec.version), rec)
    }
  }

  const result: Array<{
    version: string
    descriptionZh: string | null
    files: ReleaseFileInfo[]
  }> = []
  for (const release of releases) {
    if (release.assets.length === 0) continue
    const ai = aiByVersion.get(release.tagName)
    if (!ai) continue
    const aiFiles = Array.isArray(ai.files)
      ? ai.files.filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
      : []
    const files: ReleaseFileInfo[] = release.assets.slice(0, 15).map((a) => {
      const aiFile = aiFiles.find((f) => String(f.name) === a.name)
      const localNote = inferReleaseFileNote(a.name)
      const localType = classifyReleaseFile(a.name)
      return {
        name: a.name,
        sha256: a.sha256 ?? (aiFile?.sha256 ? String(aiFile.sha256) : null),
        url: a.downloadUrl,
        note: localNote ?? (aiFile?.note ? String(aiFile.note).trim() : ''),
        platform:
          localType.platform ??
          normalizePlatform(aiFile?.platform ? String(aiFile.platform) : null) ??
          null,
        arch: localType.arch ?? normalizeArch(aiFile?.arch ? String(aiFile.arch) : null) ?? null,
        kind: localType.kind ?? normalizeKind(aiFile?.kind ? String(aiFile.kind) : null) ?? null
      }
    })
    result.push({
      version: release.tagName,
      descriptionZh: ai.descriptionZh ? String(ai.descriptionZh).trim() : null,
      files
    })
  }

  return { result, tokens, model: config.model }
}

/** 测试 AI 服务连接 */
export async function testAiConnection(
  config: AiModelConfig
): Promise<{ ok: boolean; message: string }> {
  try {
    const { content } = await chat(
      config,
      [{ role: 'user', content: '只回复 OK 两个字母' }],
      false,
      'test_connection'
    )
    return {
      ok: true,
      message: msg(
        `连接成功（${config.model}）：${content.slice(0, 60)}`,
        `Connected (${config.model}): ${content.slice(0, 60)}`
      )
    }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : msg('连接失败', 'Connection failed')
    }
  }
}
