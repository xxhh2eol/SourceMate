/**
 * 环节一：项目结构化分析提示词（AI 打标三维词表版）
 * 让 AI 理解 GitHub 项目并按三维中文词表（type/domain/scene）产出标签与建议新词，
 * 同时产出中文摘要；不负责写库，产出作为环节二/三的输入证据。
 * 词表来源：「AI 分析标签」功能设计文档 §4。
 * type 封闭词表与程序硬校验共用 shared/types 的 TAG_TYPE_VOCABULARY，改词表只改一处。
 */

import { TAG_TYPE_VOCABULARY } from '../../../shared/types'

export interface TagAnalyzeProjectInput {
  name: string
  url: string
  description: string | null
  language: string | null
  topics: string[]
  stars: number
  forks: number
  pushedAt: string | null
  readme: string
}

/**
 * AI 产出的单个标签：
 * - name=规范名
 * - nameCn=undefined 字段缺失（英文漏给中文，视为无效丢弃）| null 显式空串（专业术语，显示英文）| string 中文
 */
export interface AiTag {
  name: string
  nameCn: string | null | undefined
}

/** domain 主干词表（提示词与程序校验同源；「AI」为唯一纯英文词表词，校验时需放行） */
export const TAG_DOMAIN_VOCABULARY = [
  'AI',
  '开发',
  '教育',
  '娱乐',
  '内容创作',
  '效率工具',
  '数据分析',
  '设计',
  '金融',
  '安全',
  '系统运维',
  '网络工具',
  '社交',
  '医疗健康',
  '电商/商业',
  '游戏',
  '科研',
  '物联网',
  '区块链/Web3',
  '法律合规'
] as const

/** scene 场景词表（抽象层级，提示词与程序校验同源） */
export const TAG_SCENE_VOCABULARY = [
  '开发提效',
  '资源检索',
  '自动化',
  '内容生成',
  '学习辅助',
  '数据分析',
  '信息抽取',
  '媒体处理',
  '网络工具',
  '个人管理',
  '协同办公',
  '监控告警',
  '安全防护',
  '知识管理',
  '代码审查',
  '测试辅助',
  '部署运维',
  '数据处理',
  '可视化',
  '流程编排'
] as const

/** 建议新词（dimension 对应提示词中的三个维度，场景走 scenario 槽位归一化到 purpose）；nameCn 语义同 AiTag */
export interface SuggestedNewTag {
  name: string
  nameCn: string | null | undefined
  dimension: 'type' | 'domain' | 'scene'
  reason: string
}

/** 解析后的环节一输出（只取标签相关字段，其余宽松丢弃） */
export interface TagAnalyzeResult {
  summaryCn: string
  type: AiTag[]
  domain: AiTag[]
  scene: AiTag[]
  suggestedNewTags: SuggestedNewTag[]
  confidence: number
}

export const TAG_ANALYZE_SYSTEM_PROMPT = `你是一名资深开源项目分析师，擅长从 README 和代码结构中提炼项目本质。
你输出的标签必须严格遵守给定的词表和分类规则，最终只输出合法 JSON。

【分类维度与词表】（严格按此选择）

维度一·形态/类型（type，封闭集，禁止自创）：
  ${TAG_TYPE_VOCABULARY.join('、')}

维度二·行业/领域（domain，主干，可建议新词）：
  ${TAG_DOMAIN_VOCABULARY.join('、')}

维度三·场景/用途（scene，按抽象层级规则推导，不视为穷举）：
  ${TAG_SCENE_VOCABULARY.join('、')}

【场景维度·抽象层级规则】
1. 只输出"解决什么普遍问题"层的抽象场景，禁止输出具体功能。
2. 反例（太细，禁止输出）：网盘搜索、简历解析、字幕下载、图片压缩、B站视频下载。
3. 正例（正确层级）：资源检索、信息抽取、媒体处理。
4. 想到一个具体功能时，先判断它属于哪个已有抽象场景；能归入就不新增，确实无归属才建议新词。

【分维规则】
- type：只能从清单选，最多 2 个；禁止自创。确无匹配则填 ["其他"]，并在 suggested_new_tags 中说明，由人工决定。
- domain：优先从主干选，最多 3 个；主干确实没有的写进 suggested_new_tags，禁止混入主标签。
- scene：按抽象层级规则推导，最多 3 个；能归入已有场景就归入，确无归属才写入 suggested_new_tags。
- suggested_new_tags 每项格式：{"name": "新词", "dimension": "type|domain|scene", "reason": "与现有标签的区别或归属"}

【防重叠硬规则】
- 同一标签不得出现在两个维度中（如"AI"只能出现在 domain）。
- 无法判断的维度留空数组，禁止硬填。
- 若 README 为英文，summary_cn 须翻译成准确中文。

【中英文规则】
- 三维标签（type/domain/scene）一律要求中文可显示：优先从中文词表选词；确需英文词（如 education）时，必须同时给出中文名 name_cn。
- 专业术语、专名、技术名词（如 go、python、agent、LLM、RAG、Docker、kubernetes）不需要翻译：必须显式输出 "name_cn": ""（空字符串），界面显示英文。
- 标签本身是中文时，name_cn 输出空字符串即可。
- 英文标签若省略 name_cn 字段（既不写中文也不写空字符串），视为无效输出，该标签会被丢弃。
- 界面将优先显示 name_cn（无则显示 name）。

【其他纪律】
1. 不要简单复制 GitHub Topics。
2. 不要仅根据项目名称猜测项目内容。
3. 如果 README、描述等信息不足，必须降低 confidence。
4. 不允许编造项目不存在的功能或使用场景。
5. 输出必须基于提供的材料。

【输出格式】只输出以下 JSON，不要任何其他文字、注释或 Markdown：
{
  "summary_cn": "一句话中文描述（50~100 字），自然成句概括项目用途与亮点，面向中文读者（不要固定以「这是一个」开头）",
  "type": [{"name": "标签名"}],
  "domain": [{"name": "标签名", "name_cn": "中文名"}],
  "scene": [{"name": "标签名"}],
  "suggested_new_tags": [{"name": "新词", "name_cn": "中文名", "dimension": "type|domain|scene", "reason": "与现有标签的区别或归属"}],
  "confidence": 0.0
}

【示例】项目：superpower，给 Claude Code 用的 Skill 集合，用于 AI 开发提效
→ {"summary_cn":"为 Claude Code 提供的一组 Skill 插件集合，通过预设能力提升 AI 编程开发效率。",
    "type":[{"name":"插件/Skill"}],"domain":[{"name":"AI"},{"name":"开发"}],"scene":[{"name":"开发提效"}],
    "suggested_new_tags":[],"confidence":0.9}

【示例】项目：pansou，基于 Docker 自托管的网盘资源搜索工具
→ {"summary_cn":"自托管网盘资源搜索工具，部署在 Docker 中，用于聚合检索各类网盘资源。",
    "type":[{"name":"应用"}],"domain":[{"name":"效率工具"}],"scene":[{"name":"资源检索"}],
    "suggested_new_tags":[],"confidence":0.9}

【示例】项目：一个面向学生的英语学习辅助命令行工具
→ {"summary_cn":"面向学生的英语学习辅助命令行工具，帮助记忆单词与练习。",
    "type":[{"name":"CLI工具"}],"domain":[{"name":"education","name_cn":"教育"}],
    "scene":[{"name":"learning-assistant","name_cn":"学习辅助"}],
    "suggested_new_tags":[],"confidence":0.85}`

export function buildTagAnalyzeUserPrompt(p: TagAnalyzeProjectInput): string {
  const topicsText = p.topics.length > 0 ? p.topics.join(', ') : '（无）'
  return `请分析以下 GitHub 项目，输出三维分类标签和中文摘要。

【项目信息】
- 项目名：${p.name}
- 仓库地址：${p.url}
- 描述：${p.description ?? '（无）'}
- 主要语言：${p.language ?? '未知'}
- GitHub topics（仅参考，不保证准确）：${topicsText}
- Stars：${p.stars}
- Forks：${p.forks}
- 最近 push 时间：${p.pushedAt ?? '未知'}
- README 内容：
${p.readme || '（无）'}

请按系统要求只输出 JSON。`
}
