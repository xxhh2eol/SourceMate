/**
 * README 截断（设计文档 §6.1）：前 3000 字符 + 含 Install/Usage/Features/简介 等关键段，总长 ≤ max。
 * 关键段按标题行识别，取到下一个标题为止，超出预算即停。
 * README 分析 / 标签分析共用，避免把无关的长尾内容全量发给 AI。
 */
export function truncateReadme(readme: string, max = 8000): string {
  if (readme.length <= max) return readme
  const head = readme.slice(0, 3000)
  const tail = readme.slice(3000)
  const KEY_SECTION = /^\s*#{1,6}\s*(?:Install(?:ation)?|Usage|Features|Quick Start|Getting Started|简介|安装|使用|特性|快速开始)\b/i
  const HEADING = /^\s*#{1,6}\s/
  const picked: string[] = []
  let inSection = false
  const budget = max - head.length
  for (const line of tail.split('\n')) {
    if (HEADING.test(line)) inSection = false
    if (inSection) {
      const added = line.length + 1
      if (picked.join('\n').length + added > budget) break
      picked.push(line)
      continue
    }
    if (KEY_SECTION.test(line)) {
      inSection = true
      picked.push(line)
    }
  }
  return picked.length > 0 ? `${head}\n\n【关键段落】\n${picked.join('\n')}` : head
}
