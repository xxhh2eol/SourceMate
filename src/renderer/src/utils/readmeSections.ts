/** README 按 Markdown 标题分块：供详情页把每个章节渲染成独立 Tab */

export interface ReadmeSection {
  key: string
  /** Tab 标题；空字符串表示回退到“README”（无标题文档） */
  title: string
  content: string
  /** 标题前独立引言块（界面以「项目介绍」入口展示） */
  overview?: boolean
}

const ATX_HEADING_RE = /^ {0,3}(#{1,4})\s+(.+?)(?:\s+#+)?\s*$/

interface HeadingInfo {
  level: number
  title: string
  index: number
}

/** 提取 ATX 标题（跳过围栏代码块，避免把代码里的 # 当成标题） */
function parseHeadings(lines: string[]): HeadingInfo[] {
  const headings: HeadingInfo[] = []
  let fence: string | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      if (!fence) fence = marker
      else if (line.trim().startsWith(marker)) fence = null
      continue
    }
    if (fence) continue

    const match = line.match(ATX_HEADING_RE)
    if (match) {
      headings.push({
        level: match[1].length,
        title: cleanHeadingText(match[2]),
        index: i
      })
    }
  }

  return headings
}

/** Tab 标签去掉常见 Markdown 排版符号，只留可读文字 */
function cleanHeadingText(raw: string): string {
  return raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/\*\*|__/g, '')
    .replace(/[*_~]/g, '')
    .trim()
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
}

/** 首个分区本身就是“项目介绍/简介”类标题时，把标题前引言合并进该分区，避免出现两个介绍 Tab */
const OVERVIEW_TITLES = new Set([
  '项目介绍',
  '项目简介',
  '项目概述',
  '介绍',
  '简介',
  '概述',
  'introduction',
  'overview',
  'about',
  'aboutthisproject',
  'gettingstarted'
])

/**
 * 按标题切分 README：
 * - 优先选出现次数 >= 2 的最小标题级别作为章节层级，兼顾 ## 与 ### 两种常见写法
 * - 无标题时返回单块全文，由调用方回退为「README」Tab
 */
export function splitReadmeSections(markdown: string, overviewTitle: string): ReadmeSection[] {
  const lines = markdown.split(/\r?\n/)
  const headings = parseHeadings(lines)
  if (headings.length === 0) {
    return [{ key: 'full', title: '', content: markdown.trim() }]
  }

  const counts = [0, 0, 0, 0, 0]
  for (const h of headings) counts[h.level] += 1
  const splitLevel =
    [1, 2, 3, 4].find((level) => counts[level] >= 2) ??
    [2, 3, 4].find((level) => counts[level] > 0) ??
    headings[0].level
  const splitHeadings = headings.filter((h) => h.level === splitLevel)

  const sections: ReadmeSection[] = []
  const first = splitHeadings[0]
  const preamble = lines.slice(0, first.index).join('\n').trim()
  const hasPreambleBody = lines
    .slice(0, first.index)
    .some((line) => line.trim() !== '' && !ATX_HEADING_RE.test(line))
  const firstIsOverview = OVERVIEW_TITLES.has(normalizeTitle(first.title))

  // 标题前的独立内容：引言有实质内容时单独成 Tab；否则并入首个章节，避免丢失仓库名/徽章
  let firstPrefix = ''
  if (preamble) {
    if (firstIsOverview || !hasPreambleBody) {
      firstPrefix = `${preamble}\n\n`
    } else {
      sections.push({
        key: 'preamble',
        title: overviewTitle,
        overview: true,
        content: preamble
      })
    }
  }

  for (let i = 0; i < splitHeadings.length; i++) {
    const start = splitHeadings[i].index
    const end = i + 1 < splitHeadings.length ? splitHeadings[i + 1].index : lines.length
    const sectionContent = lines.slice(start, end).join('\n').trim()
    sections.push({
      key: `section-${i}`,
      title: splitHeadings[i].title,
      content: `${i === 0 ? firstPrefix : ''}${sectionContent}`
    })
  }

  return sections
}
