import { getSetting } from '../db/dao'

/**
 * 标签名归一化（v1 工程规则层；v2 规则未命中时由 AI 语义匹配兜底，见 temp_ai_plan.md 环节二）。
 * 目的：同一概念的不同写法落库后合并为一条（skills/skill、React.js/react），
 * 配合 project_tags 的「先到先得」去重语义，防止标签膨胀。
 * 别名映射表存 settings（key: ai.tagAliases，JSON 对象，如 {"skills": "skill", "react.js": "react"}），
 * 用户可配置，不写死。
 */

interface TagAliasMap {
  [raw: string]: string
}

function readAliases(): TagAliasMap {
  const raw = getSetting('ai.tagAliases', '{}')
  try {
    const obj = JSON.parse(raw) as unknown
    return obj && typeof obj === 'object' ? (obj as TagAliasMap) : {}
  } catch {
    return {}
  }
}

/** 常见编程语言文件扩展名（React.js → react；node.js → node） */
const EXTENSION_RE = /\.(js|ts|py|rb|go|rs|java|php|sh|c|h|cpp|cs)$/i

/**
 * 归一化标签名：
 * 1. 别名映射精确匹配（最高优先级，大小写不敏感）
 * 2. 统一小写
 * 3. 去语言扩展名（react.js → react）
 * 4. 复数 → 单数（skills → skill；ss 结尾不处理，如 analysis）
 */
export function normalizeTagName(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed

  const lower = trimmed.toLowerCase()
  const aliases = readAliases()
  const mapped = aliases[lower]
  if (mapped) return mapped

  let name = lower.replace(EXTENSION_RE, '')
  if (/s$/i.test(name) && !/ss$/i.test(name) && name.length > 3) {
    name = name.slice(0, -1)
  }
  return name
}
