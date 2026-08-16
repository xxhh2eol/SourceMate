import type { ProjectWithTags } from './types'

/**
 * README 语言判定 / 取源统一口径（主进程 + 渲染进程共用）。
 *
 * 字段语义（与 schema.ts 一致）：
 * - readmeEn     英文 README（拉取时按语言检测判 en）
 * - readmeZh     真实中文 README（拉取时按语言检测判 zh）
 * - readmeZhAi   AI 翻译的中文 README（无真实中文版时生成）
 * - readmeCache  主 README 原文（历史遗留，兼容旧数据；仅作英文源兜底）
 */

/** 是否有可展示的中文内容（真实中文 或 AI 翻译） */
export function hasChineseReadme(p: Pick<ProjectWithTags, 'readmeZh' | 'readmeZhAi'>): boolean {
  return Boolean(p.readmeZh || p.readmeZhAi)
}

/** 是否有英文源（英文缓存；历史数据无 readmeEn 时兜底 readmeCache） */
export function hasEnglishReadme(p: Pick<ProjectWithTags, 'readmeEn' | 'readmeCache'>): boolean {
  return Boolean(p.readmeEn || p.readmeCache)
}

/** 英文 README 源（翻译用）；历史数据无 readmeEn 时兜底 readmeCache */
export function getEnglishReadmeSource(
  p: Pick<ProjectWithTags, 'readmeEn' | 'readmeCache'>
): string {
  return p.readmeEn ?? p.readmeCache ?? ''
}
