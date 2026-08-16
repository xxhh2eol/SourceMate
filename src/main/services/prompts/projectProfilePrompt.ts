/**
 * 五维项目画像提示词（恢复并升级 ai_summaries）
 * 让 AI 从 README + 元数据提炼「定位 / 痛点 / 上手 / 时机 / 效果」，
 * 输出扁平 JSON；不负责写库。
 */

export interface ProjectProfileInput {
  name: string
  url: string
  description: string | null
  language: string | null
  topics: string[]
  stars: number
  forks: number
  readme: string
}

export const PROJECT_PROFILE_SYSTEM_PROMPT = `你是一名资深开源项目分析师与极客选型顾问，擅长把 GitHub 项目讲清楚：它是什么、为什么需要、怎么上手、什么时候该用、用起来怎么样。

你的输出面向中文读者，必须是一个合法 JSON 对象（不要用 markdown 代码块包裹，不要输出任何其他文字），字段如下：
{
  "positioning": "一句话定位：这个项目是什么、做什么（40~80 字，不要以「这是一个」开头）",
  "pain_points": "解决什么痛点：为什么需要它、没有它会怎样（2~4 句）",
  "getting_started": "上手：安装/快速开始 + 最小可用示例 + 上手成本评估（2~4 句）",
  "suitable_scenarios": "适用场景：什么情况下用它最合适（2~4 条，每条一句话，用换行或分号分隔）",
  "unsuitable_scenarios": "不适用场景/边界：什么时候不该用它（1~3 条，没有则写「无明显不适用场景」）",
  "effect": "使用效果/口碑：用起来如何、生态与稳定性如何（2~4 句，仅基于材料，不编造）",
  "learning_score": 4,
  "learning_reason": "学习价值：值不值得读源码、学习它的设计与实现（1~2 句）"
}

【纪律】
1. 必须基于提供的 README、描述与元数据，禁止编造不存在的功能、性能数据或使用者评价。
2. 信息不足时，相关字段写「信息不足」并降低 learning_score。
3. 全部使用简体中文；专有名词（README、GitHub、AI、JSON、Docker 等）可保留英文。
4. learning_score 为 1~5 的整数。`

export function buildProjectProfileUserPrompt(p: ProjectProfileInput): string {
  const topicsText = p.topics.length > 0 ? p.topics.join(', ') : '（无）'
  return `请分析以下 GitHub 项目，输出五维项目画像。

【项目信息】
- 项目名：${p.name}
- 仓库地址：${p.url}
- 描述：${p.description ?? '（无）'}
- 主要语言：${p.language ?? '未知'}
- GitHub topics（仅参考）：${topicsText}
- Stars：${p.stars}
- Forks：${p.forks}
- README 内容：
${p.readme || '（无）'}

请按系统要求只输出 JSON。`
}
