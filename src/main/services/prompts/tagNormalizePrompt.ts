/**
 * 环节二：标签归一化与已有标签匹配提示词（temp_ai_plan.md §二）
 * 工程规则优先（tagNormalize：小写/单复数/去版本/别名表），规则未命中才调用本提示词做 AI 语义匹配。
 */

/** 标签类型（对应 TagDimension 映射：type→type、domain→domain、technology→tech、capability→capability、scenario→purpose、targetUser→audience） */
export type TagType = 'type' | 'domain' | 'technology' | 'capability' | 'scenario' | 'targetUser'

export interface TagNormalizeItem {
  rawTag: string
  /** 中文名（环节一产出；可空） */
  nameCn?: string | null
  tagType: TagType
}

export interface NormalizedTag {
  rawTag: string
  normalizedTag: string
  /** 匹配到的已有正式标签名 */
  matchedExistingTag: string
  /** 中文名（AI 产出透传，写库时供已存在标签回填；可空） */
  nameCn?: string | null
  tagType: TagType
  confidence: number
  reason: string
}

export interface UnknownTag {
  rawTag: string
  suggestedTagName: string
  /** 中文名（环节一产出透传，候选创建用；可空） */
  nameCn?: string | null
  tagType: TagType
  confidence: number
  reason: string
}

/** 解析后的环节二输出（按输入列表序号 i 引用原始标签） */
export interface TagNormalizeResult {
  matches: Array<{
    i: number
    matchedExistingTag: string
    confidence: number
    reason: string
  }>
  unknowns: Array<{
    i: number
    suggestedTagName?: string
    confidence: number
    reason: string
  }>
}

export const TAG_NORMALIZE_SYSTEM_PROMPT = `你是一名标签系统归一化专家，负责将 AI 分析出的项目标签映射到已有标签库。

你的任务不是重新分析项目，也不是创造新标签，而是判断这些标签是否已经存在于当前标签库中。

你必须遵守以下规则：

1. 优先匹配已有正式标签。
2. 如果标签只是写法不同、单复数不同、大小写不同、缩写不同，应判断为已有标签。
3. 如果标签语义相同但表达不同，应归一化到已有标签。
4. 如果不能确定是否匹配，应标记为 unknown，而不是强行匹配。
5. 不允许直接创建正式标签。
6. 未知标签只能作为 unknowns 输出。
7. 最终只输出合法 JSON，不要输出解释、Markdown、注释或代码块。

匹配优先级：

1. 完全相同。
2. 大小写不同。
3. 单复数不同。
4. 常见缩写。
5. 别名。
6. 语义高度一致。

例如：

- LLMs 应匹配 LLM
- React.js 应匹配 React
- JS 应匹配 JavaScript
- Model Context Protocol 应匹配 MCP，如果已有标签中存在 MCP
- Vector Database 和 Vector Store 可根据已有标签库选择归一化或标记未知

输出格式（严格按此 JSON，无其他内容）：

{
  "matches": [
    {
      "i": 0,
      "matchedExistingTag": "匹配到的已有正式标签名",
      "confidence": 0.0,
      "reason": "匹配理由"
    }
  ],
  "unknowns": [
    {
      "i": 1,
      "suggestedTagName": "建议候选标签名",
      "confidence": 0.0,
      "reason": "为什么它暂时不能匹配已有标签"
    }
  ]
}

输出要求：

1. i 是「需要处理的标签」列表中的序号，从 0 开始，必须与输入列表一一对应。
2. 每个输入标签必须且只能出现在 matches 或 unknowns 中，不能遗漏，也不要输出不存在的序号。
3. matches 中的 matchedExistingTag 必须使用已有正式标签库中的规范名。
4. unknowns 中的 suggestedTagName 仅在建议名与原始标签不同时输出，相同则省略。
5. confidence 必须是 0 到 1 之间的小数。
6. 不要输出 rawTag、tagType、name_cn 等已在输入中提供的字段。
7. 不要输出 JSON 以外的任何内容，不要 Markdown 代码块。`

export function buildTagNormalizeUserPrompt(
  existingTags: string[],
  items: TagNormalizeItem[]
): string {
  const existingText = existingTags.length > 0 ? existingTags.join('\n') : '（暂无）'
  const itemsText = items
    .map((i, idx) =>
      i.nameCn
        ? `${idx}. ${i.rawTag}（中文：${i.nameCn}，类型：${i.tagType}）`
        : `${idx}. ${i.rawTag}（类型：${i.tagType}）`
    )
    .join('\n')
  return `请根据已有标签库，对以下 AI 分析结果中的标签进行归一化和匹配。

已有正式标签库（括号内为中文名，输出 matchedExistingTag 时必须使用括号前的规范名）：

${existingText}

需要处理的标签（i 为序号，从 0 开始）：

${itemsText}

请按系统要求输出 JSON。`
}
