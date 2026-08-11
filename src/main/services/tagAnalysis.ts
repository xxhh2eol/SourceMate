/**
 * AI 标签分析三环节编排（temp_ai_plan.md）：
 * 环节一 项目结构化分析 → 环节二 标签归一化匹配（工程规则优先，规则未命中走 AI 语义匹配）
 * → 环节三 新标签候选判断（create_candidate 写入候选池，不挂项目）
 * 调用链：aiQueue 的 tag_analysis 任务 → runTagAnalysis(projectId)
 * 埋点：tag_analyze / tag_normalize / tag_candidate（模型统计页可追踪）
 */

import { chat, extractJson, getModelConfig, hasModelConfig } from './ai'
import { normalizeTagName } from './tagNormalize'
import {
  appendProjectTag,
  createCandidateTag,
  getProjectById,
  listTags,
  replaceProjectTags,
  updateProjectMeta
} from '../db/dao'
import { msg } from '../msg'
import type { ProjectWithTags, TagDimension, TagInfo } from '../../shared/types'
import { TAG_TYPE_VOCABULARY } from '../../shared/types'
import { truncateReadme } from './readmeTruncate'
import {
  TAG_ANALYZE_SYSTEM_PROMPT,
  TAG_DOMAIN_VOCABULARY,
  TAG_SCENE_VOCABULARY,
  buildTagAnalyzeUserPrompt,
  type AiTag,
  type SuggestedNewTag,
  type TagAnalyzeResult
} from './prompts/tagAnalyzePrompt'
import {
  TAG_NORMALIZE_SYSTEM_PROMPT,
  buildTagNormalizeUserPrompt,
  type NormalizedTag,
  type TagNormalizeItem,
  type TagType,
  type UnknownTag
} from './prompts/tagNormalizePrompt'
import {
  TAG_CANDIDATE_SYSTEM_PROMPT,
  buildTagCandidateUserPrompt,
  type CandidateAction
} from './prompts/tagCandidatePrompt'

/** 标签类型 → 维度映射（环节一 tagType 与 schema dimension 对齐；scene 走 scenario 槽位归入 purpose） */
const TAG_TYPE_DIMENSION: Record<TagType, TagDimension> = {
  type: 'type',
  domain: 'domain',
  technology: 'tech',
  capability: 'capability',
  scenario: 'purpose',
  targetUser: 'audience'
}

// ---- 环节一：项目结构化分析 ----

/** type 维度的「其他」占位符：不落库，由 suggested_new_tags 走候选人工决定 */
const TYPE_OTHER = '其他'

/** 解析标签数组：优先对象 {name, name_cn}，兼容纯字符串（旧格式）。
 * name_cn 三分语义：字段缺失 → undefined（英文漏给中文，丢弃）；空字符串 → null（专业术语，显示英文）；非空 → 中文。 */
function parseTags(v: unknown): AiTag[] {
  if (!Array.isArray(v)) return []
  const out: AiTag[] = []
  for (const x of v) {
    if (typeof x === 'string') {
      const s = x.trim()
      if (s) out.push({ name: s, nameCn: undefined })
    } else if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>
      const name = String(o.name ?? '').trim()
      if (!name) continue
      // 字段缺失 → undefined；字段存在（含空串）→ null 或中文
      const nameCn = typeof o.name_cn === 'string' ? o.name_cn.trim() || null : undefined
      out.push({ name, nameCn })
    }
  }
  return out
}

/** 标签名是否含中文字符（中文词直接可显示；英文词必须带 name_cn） */
function hasChinese(s: string): boolean {
  return /[\u4e00-\u9fff]/.test(s)
}

/**
 * 三维标签硬规则（需求：type/domain/scene 全部翻译）——
 * 英文词必须有 name_cn 声明：中文（string）或显式空串（null，专业术语显示英文）都放行；
 * 字段缺失（undefined，漏给中文）丢弃。词表词（含纯英文「AI」）恒放行。
 */
function filterTranslatable(tags: AiTag[]): AiTag[] {
  return tags.filter(
    (t) =>
      hasChinese(t.name) ||
      t.nameCn !== undefined ||
      (TAG_DOMAIN_VOCABULARY as readonly string[]).includes(t.name) ||
      (TAG_SCENE_VOCABULARY as readonly string[]).includes(t.name)
  )
}

/** 是否词表词（type/domain/scene 三个词表之一）：词表词由环节一命中即进候选，不经环节三 AI 判断。
 * 双向 normalize 比较（大小写不敏感）：normalizeTagName 会把「Agent/工作流」「AI」小写化，
 * 直接 includes 词表原词会漏判。 */
function isVocabTag(name: string): boolean {
  const n = normalizeTagName(name)
  return (
    (TAG_TYPE_VOCABULARY as readonly string[]).some((w) => normalizeTagName(w) === n) ||
    (TAG_DOMAIN_VOCABULARY as readonly string[]).some((w) => normalizeTagName(w) === n) ||
    (TAG_SCENE_VOCABULARY as readonly string[]).some((w) => normalizeTagName(w) === n)
  )
}

/** 词表词的规范写法：按 normalize 匹配返回词表原始词（"ai"→"AI"、"agent/工作流"→"Agent/工作流"），
 * 保证候选/正式标签永远使用词表规范形式，不随 AI 输出的大小写变化。 */
function vocabCanonicalName(raw: string): string {
  const n = normalizeTagName(raw)
  return (
    (TAG_TYPE_VOCABULARY as readonly string[]).find((w) => normalizeTagName(w) === n) ??
    (TAG_DOMAIN_VOCABULARY as readonly string[]).find((w) => normalizeTagName(w) === n) ??
    (TAG_SCENE_VOCABULARY as readonly string[]).find((w) => normalizeTagName(w) === n) ??
    raw
  )
}

function normalizeAnalyzeResult(raw: unknown): TagAnalyzeResult {
  const j = (raw ?? {}) as Record<string, unknown>
  const sug = Array.isArray(j.suggested_new_tags) ? j.suggested_new_tags : []
  const suggestedNewTags: SuggestedNewTag[] = []
  for (const s of sug) {
    const o = (s ?? {}) as Record<string, unknown>
    const dimension = String(o.dimension ?? '')
    if (!['type', 'domain', 'scene'].includes(dimension)) continue
    const name = String(o.name ?? '').trim()
    if (!name) continue
    // 英文建议词必须带 name_cn 声明：字段缺失（undefined）丢弃；显式空串（专业术语）或中文放行
    const nameCn = typeof o.name_cn === 'string' ? o.name_cn.trim() || null : undefined
    if (!hasChinese(name) && nameCn === undefined) continue
    suggestedNewTags.push({
      name,
      nameCn,
      dimension: dimension as SuggestedNewTag['dimension'],
      reason: String(o.reason ?? '')
    })
  }
  // type 封闭集硬校验（设计文档 §5.2「防模型撒谎，程序强制」）：
  // 词表外 type 强制移入建议词走候选人工决定，主标签只保留词表内词；「其他」占位符不落库。
  const typeArr = filterTranslatable(parseTags(j.type)).filter((t) => t.name !== TYPE_OTHER)
  for (const t of typeArr) {
    if (TAG_TYPE_VOCABULARY.includes(t.name)) continue
    if (!suggestedNewTags.some((x) => x.name === t.name)) {
      suggestedNewTags.push({
        name: t.name,
        nameCn: t.nameCn,
        dimension: 'type',
        reason: 'AI 输出的 type 不在封闭词表内，由人工决定'
      })
    }
  }
  return {
    summaryCn: typeof j.summary_cn === 'string' ? j.summary_cn.trim() : '',
    type: typeArr.filter((t) => TAG_TYPE_VOCABULARY.includes(t.name)),
    // 三维标签全部翻译：英文词缺中文名已在上层丢弃
    domain: filterTranslatable(parseTags(j.domain)),
    scene: filterTranslatable(parseTags(j.scene)),
    suggestedNewTags,
    confidence: typeof j.confidence === 'number' ? j.confidence : 0
  }
}

/** 收集全部待归一化标签（带类型与中文名；仅三维：type/domain/scene） */
function collectRawTags(result: TagAnalyzeResult): TagNormalizeItem[] {
  const items: TagNormalizeItem[] = []
  const push = (arr: AiTag[], tagType: TagType): void => {
    for (const t of arr) items.push({ rawTag: t.name, nameCn: t.nameCn, tagType })
  }
  push(result.type, 'type')
  push(result.domain, 'domain')
  push(result.scene, 'scenario')
  return items
}

async function analyzeProject(project: ProjectWithTags): Promise<TagAnalyzeResult> {
  const config = getModelConfig()
  if (!hasModelConfig(config)) {
    throw new Error(
      msg(
        '未配置 AI 模型，请先在 设置 → 模型配置 中配置',
        'AI model not configured. Please configure it in Settings → Model Configuration.'
      )
    )
  }
  const readme = truncateReadme(project.readmeCache ?? project.readmeEn ?? project.readmeZh ?? '')
  const userPrompt = buildTagAnalyzeUserPrompt({
    name: project.name,
    url: project.githubUrl,
    description: project.description,
    language: project.language,
    topics: project.topics,
    stars: project.starCount,
    forks: project.forkCount,
    pushedAt: project.pushedAt,
    readme
  })
  const { content } = await chat(
    config,
    [
      { role: 'system', content: TAG_ANALYZE_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    true,
    'tag_analyze',
    120_000,
    0.1
  )
  return normalizeAnalyzeResult(extractJson(content))
}

// ---- 环节二：归一化匹配（规则优先 + AI 语义匹配兜底） ----

interface NormalizeMatchDraft {
  index?: number
  rawTag?: string
  normalizedTag?: string
  matchedExistingTag?: string
  confidence: number
  reason: string
}

interface NormalizeUnknownDraft {
  index?: number
  rawTag?: string
  suggestedTagName?: string
  confidence: number
  reason: string
}

function toIndex(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim())
  return undefined
}

function normalizeNormalizeResult(raw: unknown): {
  matches: NormalizeMatchDraft[]
  unknowns: NormalizeUnknownDraft[]
} {
  const j = (raw ?? {}) as Record<string, unknown>
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  const matches = arr<Record<string, unknown>>(j.matches ?? j.matchedTags)
    .map((m) => ({
      index: toIndex(m.i),
      rawTag: typeof m.rawTag === 'string' ? m.rawTag : '',
      normalizedTag: typeof m.normalizedTag === 'string' ? m.normalizedTag : '',
      matchedExistingTag:
        typeof m.matchedExistingTag === 'string'
          ? m.matchedExistingTag
          : typeof m.normalizedTag === 'string'
            ? m.normalizedTag
            : '',
      confidence: typeof m.confidence === 'number' ? m.confidence : 0,
      reason: String(m.reason ?? '')
    }))
    .filter((m) => m.index !== undefined || m.rawTag)
  const unknowns = arr<Record<string, unknown>>(j.unknowns ?? j.unknownTags)
    .map((u) => ({
      index: toIndex(u.i),
      rawTag: typeof u.rawTag === 'string' ? u.rawTag : '',
      suggestedTagName: typeof u.suggestedTagName === 'string' ? u.suggestedTagName : '',
      confidence: typeof u.confidence === 'number' ? u.confidence : 0,
      reason: String(u.reason ?? '')
    }))
    .filter((u) => u.index !== undefined || u.rawTag)
  return { matches, unknowns }
}

/**
 * 环节二：规则层双向比对 + AI 语义匹配兜底。
 * tagIndex 以「规范名/中文名（normalize 后）」为键索引正式标签，AI 产出的 name 或 nameCn
 * 任一击中即匹配（避免 "education" 与已入库的 "教育" 建重复标签）；AI 兜底返回的
 * matchedExistingTag 也解析回库中规范名，解析失败视为 unknown。
 */
async function normalizeAndMatch(
  items: TagNormalizeItem[],
  tagIndex: Map<string, TagInfo>,
  existingNamesForPrompt: string[]
): Promise<{ matched: NormalizedTag[]; unknown: UnknownTag[] }> {
  // 规则层：归一化后与正式标签精确比对（skills→skill、React.js→react 等，tagNormalize）
  const ruleMatched: NormalizedTag[] = []
  const unresolved: TagNormalizeItem[] = []
  for (const item of items) {
    const hit =
      tagIndex.get(normalizeTagName(item.rawTag)) ??
      (item.nameCn ? tagIndex.get(normalizeTagName(item.nameCn)) : undefined)
    if (hit) {
      ruleMatched.push({
        rawTag: item.rawTag,
        normalizedTag: hit.name,
        matchedExistingTag: hit.name,
        // 中文名：AI 产出优先，否则用库中已有（写库时供已存在标签回填）
        nameCn: item.nameCn ?? hit.nameCn,
        tagType: item.tagType,
        confidence: 1,
        reason: '规则归一化精确匹配'
      })
    } else {
      unresolved.push(item)
    }
  }
  if (unresolved.length === 0) return { matched: ruleMatched, unknown: [] }

  // AI 兜底：语义匹配（如 Large Language Model ↔ LLM），temperature 0 保持确定性
  const config = getModelConfig()
  const userPrompt = buildTagNormalizeUserPrompt(existingNamesForPrompt, unresolved)
  const { content } = await chat(
    config,
    [
      { role: 'system', content: TAG_NORMALIZE_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    true,
    'tag_normalize',
    120_000,
    0
  )
  const aiResult = normalizeNormalizeResult(extractJson(content))
  // AI 的 matchedExistingTag 可能命中中文名/变体，统一解析回库中规范名；解析失败降级为 unknown
  const aiMatched: NormalizedTag[] = []
  for (const m of aiResult.matches) {
    const item =
      m.index !== undefined
        ? unresolved[m.index]
        : unresolved.find((i) => i.rawTag === m.rawTag)
    if (!item) continue
    const hit =
      tagIndex.get(normalizeTagName(m.matchedExistingTag ?? '')) ??
      tagIndex.get(normalizeTagName(m.normalizedTag ?? ''))
    if (hit) {
      aiMatched.push({
        rawTag: item.rawTag,
        normalizedTag: hit.name,
        matchedExistingTag: hit.name,
        nameCn: item.nameCn ?? null,
        tagType: item.tagType,
        confidence: m.confidence,
        reason: m.reason
      })
    }
  }
  // unknown 的中文名：优先 AI 输出，否则取环节一透传（unresolved 同 rawTag 的 nameCn）
  const aiUnknown: UnknownTag[] = []
  for (const u of aiResult.unknowns) {
    const item =
      u.index !== undefined
        ? unresolved[u.index]
        : unresolved.find((i) => i.rawTag === u.rawTag)
    if (!item) continue
    aiUnknown.push({
      rawTag: item.rawTag,
      suggestedTagName: u.suggestedTagName || item.rawTag,
      nameCn: item.nameCn ?? null,
      tagType: item.tagType,
      confidence: u.confidence,
      reason: u.reason
    })
  }
  return { matched: [...ruleMatched, ...aiMatched], unknown: aiUnknown }
}

// ---- 环节三：候选判断 ----

interface CandidateDecisionDraft {
  index?: number
  tagName?: string
  nameCn?: string | null
  action: CandidateAction
  reason: string
  confidence: number
}

function normalizeCandidateResult(raw: unknown): CandidateDecisionDraft[] {
  const j = (raw ?? {}) as Record<string, unknown>
  const arr = Array.isArray(j.decisions) ? (j.decisions as Record<string, unknown>[]) : []
  const decisions: CandidateDecisionDraft[] = []
  for (const d of arr) {
    const action = String(d.action ?? '')
    if (!['create_candidate', 'promote_to_official', 'merge', 'reject'].includes(action)) continue
    const index = toIndex(d.i)
    const tagName = typeof d.tagName === 'string' ? d.tagName : ''
    if (index === undefined && !tagName) continue
    const nameCnRaw =
      typeof d.nameCn === 'string' ? d.nameCn : typeof d.name_cn === 'string' ? d.name_cn : ''
    decisions.push({
      index,
      tagName,
      nameCn: nameCnRaw.trim() || null,
      action: action as CandidateAction,
      reason: String(d.reason ?? ''),
      confidence: typeof d.confidence === 'number' ? d.confidence : 0
    })
  }
  return decisions
}

async function judgeCandidates(
  projectId: number,
  unknownTags: UnknownTag[],
  existingNames: string[],
  rejectedNames: Set<string>,
  aiModel: string
): Promise<{ created: number; merged: number; rejected: number }> {
  if (unknownTags.length === 0) return { created: 0, merged: 0, rejected: 0 }
  const config = getModelConfig()
  const userPrompt = buildTagCandidateUserPrompt(existingNames, unknownTags, [...rejectedNames])
  const { content } = await chat(
    config,
    [
      { role: 'system', content: TAG_CANDIDATE_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    true,
    'tag_candidate',
    120_000,
    0
  )
  const decisions = normalizeCandidateResult(extractJson(content))

  // 候选标签的中文名：优先 AI 输出，否则取环节一透传的 nameCn（按规范名关联）
  const nameCnByTag = new Map<string, string | null>()
  // 原始词兜底：环节二 AI 曾把中文词改写为英文建议名（application←应用），
  // 创建候选时若原始词是中文则强制用原名，避免中文词被"翻译"回英文
  const rawTagByNorm = new Map<string, UnknownTag>()
  for (const u of unknownTags) {
    const key = normalizeTagName(u.suggestedTagName || u.rawTag)
    if (u.nameCn) nameCnByTag.set(key, u.nameCn)
    if (!rawTagByNorm.has(key)) rawTagByNorm.set(key, u)
  }

  let created = 0
  let merged = 0
  let rejected = 0
  for (const d of decisions) {
    const u =
      d.index !== undefined
        ? unknownTags[d.index]
        : rawTagByNorm.get(normalizeTagName(d.tagName ?? ''))
    if (!u) continue
    const name = normalizeTagName(d.tagName || u.rawTag)
    if (!name) continue
    // 黑名单兜底：被人工拒绝过的标签不复活（即使 AI 忽略提示仍推荐）
    if (rejectedNames.has(name)) {
      rejected++
      continue
    }
    if (d.action === 'create_candidate' || d.action === 'promote_to_official') {
      const dimension = TAG_TYPE_DIMENSION[u.tagType] ?? 'capability'
      // 中文原始词兜底：环节三若返回英文改写（如 application），回退为原始中文词（应用）
      const finalName = u && hasChinese(u.rawTag) ? normalizeTagName(u.rawTag) : name
      const nameCn = d.nameCn ?? u?.nameCn ?? nameCnByTag.get(name) ?? null
      createCandidateTag(finalName, dimension, nameCn)
      // 候选标签同时挂到当前项目（source='ai'），项目标签立即可见；promote 机制不变
      appendProjectTag(projectId, finalName, dimension, 'ai', d.confidence, aiModel, d.reason, nameCn)
      created++
    } else if (d.action === 'merge') {
      merged++
    } else {
      rejected++
    }
  }
  return { created, merged, rejected }
}

// ---- 主流程 ----

export interface TagAnalysisResult {
  /** 环节一输出标签总数 */
  rawCount: number
  /** 写入项目的 AI 标签数（含规则命中与 AI 语义命中，重复已去重） */
  writtenCount: number
  /** 新增候选标签数 */
  candidateCount: number
  mergedCount: number
  rejectedCount: number
}

/**
 * 完整三环节标签分析：读项目 → 结构化分析 → 归一化匹配写库（source='ai'）→ 候选判断。
 * 由 aiQueue 的 tag_analysis 任务调用；调用前应已执行 syncProjectReadme（材料最新 + language/topics 物化）。
 */
export async function runTagAnalysis(projectId: number): Promise<TagAnalysisResult> {
  const project = getProjectById(projectId)
  if (!project) throw new Error(msg('项目不存在', 'Project not found'))

  const config = getModelConfig()
  if (!hasModelConfig(config)) {
    throw new Error(
      msg(
        '未配置 AI 模型，请先在 设置 → 模型配置 中配置',
        'AI model not configured. Please configure it in Settings → Model Configuration.'
      )
    )
  }

  // 环节一
  const analysis = await analyzeProject(project)
  const rawItems = collectRawTags(analysis)

  // 中文摘要写库（独立于标签，AI 产出即写；下次分析全量覆盖）
  if (analysis.summaryCn) {
    updateProjectMeta(project.id, { cnSummary: analysis.summaryCn })
  }

  // 环节二（正式标签库：规范名/中文名双索引，供规则层双向比对；提示词传双语列表）
  const allTags = listTags()
  const officialTags = allTags.filter((t) => t.status === 'official')
  const tagIndex = new Map<string, TagInfo>()
  for (const t of officialTags) {
    tagIndex.set(normalizeTagName(t.name), t)
    if (t.nameCn) tagIndex.set(normalizeTagName(t.nameCn), t)
  }
  const existingNamesForPrompt = officialTags.map((t) => (t.nameCn ? `${t.name}（${t.nameCn}）` : t.name))
  // 人工拒绝黑名单（normalize 后比对，防被拒标签复活）
  const rejectedNames = new Set(
    allTags.filter((t) => t.status === 'rejected').map((t) => normalizeTagName(t.name))
  )

  // 词表词提前分流：词表词（type/domain/scene 词表）是规范词，无需归一化匹配——
  // 不经过环节二（避免归一化 AI 把「Agent/工作流」「AI」改写成英文/小写），
  // 只在库里规则命中（有→matched 写库），无则直接进候选池（保留原始写法）。
  const vocabItems = rawItems.filter((i) => isVocabTag(i.rawTag))
  const novelItems = rawItems.filter((i) => !isVocabTag(i.rawTag))
  const vocabMatched: NormalizedTag[] = []
  const vocabNew: UnknownTag[] = []
  for (const item of vocabItems) {
    const hit =
      tagIndex.get(normalizeTagName(item.rawTag)) ??
      (item.nameCn ? tagIndex.get(normalizeTagName(item.nameCn)) : undefined)
    if (hit) {
      vocabMatched.push({
        rawTag: item.rawTag,
        normalizedTag: hit.name,
        matchedExistingTag: hit.name,
        nameCn: item.nameCn ?? hit.nameCn,
        tagType: item.tagType,
        confidence: 1,
        reason: '词表词规则命中'
      })
    } else {
      vocabNew.push({
        rawTag: item.rawTag,
        suggestedTagName: item.rawTag,
        nameCn: item.nameCn,
        tagType: item.tagType,
        confidence: 1,
        reason: '词表词，由环节一直接命中'
      })
    }
  }

  // 非词表词走环节二（规则层 + AI 语义匹配）
  const { matched: novelMatched, unknown: novelUnknown } =
    novelItems.length > 0
      ? await normalizeAndMatch(novelItems, tagIndex, existingNamesForPrompt)
      : { matched: [] as NormalizedTag[], unknown: [] as UnknownTag[] }
  const matched = [...vocabMatched, ...novelMatched]

  // 写库：source='ai'（先删旧 AI 关联再写；其他来源先占的同名标签跳过；
  // nameCn 透传供已存在标签回填中文名——三维标签全部翻译的收敛路径）。
  // matched 的 normalizedTag 已统一为库中规范名（hit.name），此处不再 normalizeTagName：
  // 再小写化会让「插件/Skill」变成「插件/skill」，精确查找建出大小写变体重复行。
  if (matched.length > 0) {
    replaceProjectTags(
      projectId,
      'ai',
      matched.map((m) => ({
        name: m.normalizedTag,
        dimension: TAG_TYPE_DIMENSION[m.tagType] ?? 'capability',
        nameCn: m.nameCn,
        confidence: m.confidence,
        aiModel: config.model,
        reason: m.reason
      }))
    )
  }

  // 环节三：词表词直接进候选（程序信任词表，保留人工审核 promote，不交给环节三 AI 判断——
  // flash 模型会按「过于宽泛」误 reject）；非词表词（新词建议）走环节三 AI 判断。
  const suggestionUnknowns: UnknownTag[] = analysis.suggestedNewTags.map((s) => ({
    rawTag: s.name,
    suggestedTagName: s.name,
    nameCn: s.nameCn,
    tagType: s.dimension === 'type' ? 'type' : s.dimension === 'domain' ? 'domain' : 'scenario',
    confidence: analysis.confidence,
    reason: `AI 建议（${s.dimension}）：${s.reason}`
  }))
  const allUnknowns = [...vocabNew, ...novelUnknown, ...suggestionUnknowns]
  const vocabUnknowns = allUnknowns.filter((u) => isVocabTag(u.rawTag))
  const novelUnknowns = allUnknowns.filter((u) => !isVocabTag(u.rawTag))

  let created = 0
  let merged = 0
  let rejected = 0
  // 词表词直接进候选：候选名用词表规范写法（vocabCanonicalName——「ai」→「AI」，
  // 不随 AI 输出大小写变化；「Agent/工作流」等保持词表原始形式）
  for (const u of vocabUnknowns) {
    const name = vocabCanonicalName(u.rawTag)
    if (!name) continue
    if (rejectedNames.has(normalizeTagName(name))) {
      rejected++
      continue
    }
    const dimension = TAG_TYPE_DIMENSION[u.tagType] ?? 'capability'
    createCandidateTag(name, dimension, u.nameCn)
    appendProjectTag(
      projectId,
      name,
      dimension,
      'ai',
      u.confidence,
      config.model,
      '词表词，由环节一直接命中，待人工确认',
      u.nameCn
    )
    created++
  }
  if (novelUnknowns.length > 0) {
    const r = await judgeCandidates(
      projectId,
      novelUnknowns,
      existingNamesForPrompt,
      rejectedNames,
      config.model
    )
    created += r.created
    merged += r.merged
    rejected += r.rejected
  }

  return {
    rawCount: rawItems.length,
    writtenCount: matched.length,
    candidateCount: created,
    mergedCount: merged,
    rejectedCount: rejected
  }
}
