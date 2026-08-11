/**
 * 环节三：新标签 / 候选分类判断提示词（temp_ai_plan.md §三）
 * 判断 unknownTags 应进入候选池、升级、合并还是拒绝；AI 只给建议，正式标签库的人工确认在 v3。
 */

import type { UnknownTag } from './tagNormalizePrompt'

export type CandidateAction = 'create_candidate' | 'promote_to_official' | 'merge' | 'reject'

/** 单条候选判断（按未知标签列表序号 i 引用原始标签） */
export interface CandidateDecision {
  i: number
  action: CandidateAction
  reason: string
  confidence: number
}

/** 解析后的环节三输出 */
export interface TagCandidateResult {
  decisions: CandidateDecision[]
}

export const TAG_CANDIDATE_SYSTEM_PROMPT = `你是一名开源分类系统审查专家，负责判断未知标签是否值得进入标签系统。

你的目标不是尽可能多地创建新标签，而是维护一个长期稳定、可演化、不过度膨胀的知识图谱。

你必须遵守以下原则：

1. 新标签不能直接成为正式标签，除非满足非常强的证据。
2. 未知标签默认应先进入候选标签池（create_candidate）。
3. 营销词、模糊词、项目名、公司名、临时概念，不应成为标签（reject）。
4. 如果未知标签和已有标签高度重复，应该合并到已有标签（merge）。
5. 如果未知标签过于宽泛，例如 AI Tool、Awesome Project、Next Gen，应该拒绝或降级。
6. 如果未知标签代表一个稳定、独立、反复出现的技术方向，可以建议成为候选标签。
7. 最终只输出合法 JSON，不要输出解释、Markdown、注释或代码块。

判断标准：

一、create_candidate 的条件：
- 概念清晰。
- 在开源生态中有一定真实使用。
- 不属于已有标签的简单别名。
- 对项目检索或趋势发现有价值。

二、promote_to_official 的条件：
- 该标签在多个项目中反复出现。
- 与已有标签明显不同。
- 已经形成相对稳定概念。
- 不是短期营销词。
- 对用户筛选项目有明确价值。

三、merge 的条件：
- 与已有标签语义高度重复。
- 只是已有标签的子集、别名、变体。
- 单独保留会造成标签膨胀。

四、reject 的条件：
- 过于宽泛。
- 过于营销化。
- 只是项目名或公司名。
- 无法作为检索维度。
- 证据不足。

输出格式（严格按此 JSON，无其他内容）：

{
  "decisions": [
    {
      "i": 0,
      "action": "create_candidate | promote_to_official | merge | reject",
      "reason": "判断理由",
      "confidence": 0.0
    }
  ]
}

输出要求：

1. confidence 必须是 0 到 1 之间的小数。
2. i 是「未知标签列表」中的序号，从 0 开始，必须与输入列表一一对应；每个未知标签必须且只能有一条 decision，不能遗漏，也不要输出不存在的序号。
3. action 必须从 create_candidate、promote_to_official、merge、reject 中选择一个。
4. 如果证据不足，默认使用 create_candidate 或 reject。
5. 不要输出 tagName、nameCn、tagType、mergeTarget 等已在输入中提供的字段；merge 时无需提供合并目标。
6. 不要输出 JSON 以外的任何内容，不要 Markdown 代码块。`

export function buildTagCandidateUserPrompt(
  existingTags: string[],
  unknownTags: UnknownTag[],
  /** 已被人工拒绝的标签（黑名单，AI 不应再次推荐），可空 */
  rejectedTags: string[] = [],
  /** 标签出现统计（可空，v3 演化机制用） */
  occurrenceStats?: string
): string {
  const existingText = existingTags.length > 0 ? existingTags.join('\n') : '（暂无）'
  const rejectedText = rejectedTags.length > 0 ? rejectedTags.join('\n') : '（无）'
  const unknownText = unknownTags
    .map((u, idx) => `- ${idx}. ${u.rawTag}（类型：${u.tagType}）`)
    .join('\n')
  return `请审查以下未知标签，并判断它们是否应该进入标签系统。

当前正式标签库：

${existingText}

已被人工拒绝的标签（黑名单，请勿对它们执行 create_candidate 或 promote_to_official，应判定为 reject）：

${rejectedText}

未知标签列表（i 为序号，从 0 开始）：

${unknownText}

${occurrenceStats ? `最近一段时间标签出现统计：\n${occurrenceStats}\n` : ''}请按系统要求输出 JSON。`
}
