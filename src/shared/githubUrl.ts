/**
 * GitHub URL 解析（主进程 / 渲染进程共用）：
 * 从任意混排文本中提取所有 github.com/owner/repo 链接——
 * 支持 releases/tag 等深链接、多条链接用空格/标点分隔、带说明文字的文本；
 * 自动清洗尾部标点与 .git 后缀，按 owner/repo 去重（大小写不敏感）。
 */

const GITHUB_URL_RE = /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/gi

export function extractGitHubUrls(text: string): Array<{ owner: string; repo: string }> {
  const seen = new Set<string>()
  const out: Array<{ owner: string; repo: string }> = []
  for (const m of text.matchAll(GITHUB_URL_RE)) {
    const owner = m[1]
    // 清洗：.git 后缀、尾部句点（文本复制常带句号）
    const repo = m[2].replace(/\.git$/, '').replace(/\.+$/, '')
    if (!owner || !repo) continue
    const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ owner, repo })
  }
  return out
}

export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  return extractGitHubUrls(url)[0] ?? null
}
