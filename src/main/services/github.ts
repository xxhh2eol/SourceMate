import { httpFetch } from './network'
import { getDefaultGithubTokenEnc, replaceProjectTags, updateProjectMeta } from '../db/dao'
import { normalizeTagName } from './tagNormalize'
import { decryptSecret } from './secret'
import { msg } from '../msg'
import { extractGitHubUrls } from '../../shared/githubUrl'
import type { GithubTokenStatus } from '../../shared/types'

/**
 * GitHub 数据服务（设计文档 §7 数据获取策略）
 * - 元数据 / README：走 GitHub API（当前网络环境 api.github.com 可达）
 * - 检查更新：git 协议优先（ls-remote），失败降级 API
 * - 所有请求带超时与降级处理；代理经 net.fetch / git 环境变量生效
 */

const API_BASE = 'https://api.github.com'
const RAW_BASE = 'https://raw.githubusercontent.com'

const DEFAULT_TIMEOUT = 15000

export interface RepoMeta {
  name: string
  description: string | null
  starCount: number
  forkCount: number
  language: string | null
  homepage: string | null
  defaultBranch: string
  topics: string[]
  /** GitHub 仓库真实更新时间（pushed_at） */
  pushedAt: string | null
}

export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  return extractGitHubUrls(url)[0] ?? null
}

/** 读取默认账号的 GitHub Token（最早插入的账号；safeStorage 加密存储） */
function getGithubToken(): string {
  const stored = getDefaultGithubTokenEnc()
  if (!stored) return ''
  return decryptSecret(stored)
}

async function request(path: string, token?: string): Promise<Response> {
  const effectiveToken = token ?? getGithubToken()
  return httpFetch(`${API_BASE}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ai-github-manager',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(effectiveToken ? { Authorization: `Bearer ${effectiveToken}` } : {})
    },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT)
  })
}

/** 认证失败且已分类（expired / invalid / permission），message 面向用户可直接展示 */
export class GithubAuthError extends Error {
  constructor(
    public readonly status: Exclude<GithubTokenStatus, 'ok' | 'unknown'>,
    message: string
  ) {
    super(message)
    this.name = 'GithubAuthError'
  }
}

/**
 * 解析认证失败（401/403）的响应 body，按错误类型抛 GithubAuthError：
 * fine-grained token 过期 → expired；403「Resource not accessible」→ permission；其余 401 → invalid。
 */
async function throwAuthError(res: Response): Promise<never> {
  let message = ''
  try {
    message = ((await res.json()) as { message?: string }).message ?? ''
  } catch {
    // 忽略 body 解析失败
  }
  if (message.includes('Token has expired')) {
    throw new GithubAuthError(
      'expired',
      msg(
        'GitHub Token 已过期，请到 GitHub 重新生成',
        'GitHub Token has expired. Regenerate it on GitHub.'
      )
    )
  }
  if (res.status === 403 && message.includes('Resource not accessible')) {
    throw new GithubAuthError(
      'permission',
      msg(
        'Token 权限不足（fine-grained token 需开启 Account → Profile: Read）',
        'Token lacks permission (fine-grained tokens need Account → Profile: Read).'
      )
    )
  }
  // 限流不是账号问题，抛普通错误，不标记账号状态
  if (res.status === 403 && message.includes('rate limit')) {
    throw new Error(
      msg(
        'GitHub API 限流（5000 次/小时），请稍后重试',
        'GitHub API rate limited (5000/hour). Retry later.'
      )
    )
  }
  throw new GithubAuthError(
    'invalid',
    msg(
      'GitHub Token 无效或已过期，请检查后重新配置',
      'GitHub Token is invalid or expired. Check and reconfigure it.'
    )
  )
}

/** 验证 token 并获取账号信息（GET /user，200 = token 有效） */
export async function fetchCurrentUser(
  token?: string
): Promise<{
  login: string
  name: string | null
  avatarUrl: string | null
  scopes: string | null
}> {
  const res = await request('/user', token)
  if (res.status === 401 || res.status === 403) {
    await throwAuthError(res)
  }
  if (!res.ok) {
    throw new Error(
      msg(`GitHub API 错误：HTTP ${res.status}`, `GitHub API error: HTTP ${res.status}`)
    )
  }
  const j = (await res.json()) as {
    login?: string
    name?: string | null
    avatar_url?: string | null
  }
  return {
    login: j.login ?? '',
    name: j.name ?? null,
    avatarUrl: j.avatar_url ?? null,
    // 经典 token 的权限范围（fine-grained token 无此响应头）
    scopes: res.headers.get('x-oauth-scopes') ?? null
  }
}

/** 拉取仓库元数据；网络/限流失败时抛错（由调用方决定是否降级） */
export async function fetchRepoMeta(
  owner: string,
  repo: string,
  token?: string
): Promise<RepoMeta> {
  const res = await request(`/repos/${owner}/${repo}`, token)
  if (res.status === 404) {
    throw new Error(
      msg(
        `仓库 ${owner}/${repo} 不存在或不可访问`,
        `Repository ${owner}/${repo} not found or inaccessible`
      )
    )
  }
  if (res.status === 403) {
    throw new Error(
      msg(
        'GitHub API 限流（未认证 60 次/小时），请稍后重试或在设置中配置 Token',
        'GitHub API rate limited (60/hour unauthenticated). Retry later or configure a Token in Settings.'
      )
    )
  }
  if (!res.ok) {
    throw new Error(
      msg(`GitHub API 错误：HTTP ${res.status}`, `GitHub API error: HTTP ${res.status}`)
    )
  }

  const j = (await res.json()) as {
    name?: string
    full_name?: string
    description?: string | null
    stargazers_count?: number
    forks_count?: number
    language?: string | null
    homepage?: string | null
    default_branch?: string
    topics?: string[]
    pushed_at?: string | null
  }
  return {
    name: j.name ?? j.full_name ?? repo,
    description: j.description ?? null,
    starCount: j.stargazers_count ?? 0,
    forkCount: j.forks_count ?? 0,
    language: j.language ?? null,
    homepage: j.homepage ?? null,
    defaultBranch: j.default_branch ?? 'main',
    topics: Array.isArray(j.topics)
      ? j.topics.filter((t): t is string => typeof t === 'string')
      : [],
    pushedAt: j.pushed_at ?? null
  }
}

/** 当前账号 star 列表中的单条仓库（/user/starred 返回完整仓库对象，字段与 RepoMeta 对齐） */
export interface StarredRepo {
  owner: string
  repo: string
  name: string
  description: string | null
  starCount: number
  forkCount: number
  language: string | null
  homepage: string | null
  defaultBranch: string
  topics: string[]
  pushedAt: string | null
}

/**
 * 拉取指定账号一页 star 仓库（per_page=100，私有接口必须传该账号 token）。
 * 401/403 按错误类型抛 GithubAuthError；按 Link 头判断是否还有下一页。
 */
export async function fetchStarredPage(
  page: number,
  token?: string
): Promise<{
  repos: StarredRepo[]
  hasNext: boolean
}> {
  const res = await request(`/user/starred?per_page=100&page=${page}`, token)
  if (res.status === 401 || res.status === 403) {
    await throwAuthError(res)
  }
  if (!res.ok) {
    throw new Error(
      msg(`GitHub API 错误：HTTP ${res.status}`, `GitHub API error: HTTP ${res.status}`)
    )
  }

  const j = (await res.json()) as Array<{
    full_name?: string
    name?: string
    description?: string | null
    stargazers_count?: number
    forks_count?: number
    language?: string | null
    homepage?: string | null
    default_branch?: string
    topics?: string[]
    pushed_at?: string | null
  }>

  const repos: StarredRepo[] = j
    .map((r) => {
      const [owner, repo] = (r.full_name ?? '/').split('/')
      return {
        owner,
        repo: repo || r.name || '',
        name: r.name ?? repo ?? '',
        description: r.description ?? null,
        starCount: r.stargazers_count ?? 0,
        forkCount: r.forks_count ?? 0,
        language: r.language ?? null,
        homepage: r.homepage ?? null,
        defaultBranch: r.default_branch ?? 'main',
        topics: Array.isArray(r.topics)
          ? r.topics.filter((t): t is string => typeof t === 'string')
          : [],
        pushedAt: r.pushed_at ?? null
      }
    })
    .filter((r) => r.owner && r.repo)

  // Link: <https://api.github.com/user/starred?per_page=100&page=2>; rel="next"
  const link = res.headers.get('link') ?? ''
  const hasNext = repos.length === 100 && /rel="?next"?/.test(link)
  return { repos, hasNext }
}

/** 常见主 README 文件名（按优先级，含 GitHub 官方回退位置） */
const README_PRIMARY_CANDIDATES = [
  'README.md',
  'readme.md',
  'README.MD',
  'Readme.md',
  'README.markdown',
  'README.rst',
  'README.txt',
  'README',
  // GitHub 在根目录无 README 时按顺序回退到以下位置
  '.github/README.md',
  'docs/README.md'
]

/** 常见双语变体文件名（README-zh.md / README-en.md 等） */
const README_LANG_CANDIDATES = [
  'README-zh.md',
  'README_zh.md',
  'README.zh.md',
  'README-zh-CN.md',
  'README_zh-CN.md',
  'README-cn.md',
  'README_CN.md',
  'README.zh-CN.md',
  'README-en.md',
  'README_en.md',
  'README.en.md',
  'README-en-US.md',
  'README_EN.md',
  'README-EN.md'
]

/**
 * 启发式语言检测：剔除 HTML 标签 / markdown 链接 / 代码块 / 表格符号等噪声后，
 * 中文字符 + 中文标点加权占比 > 15% 且中文字符数达到最小阈值时视为中文
 * （纯字符占比会被双语混杂 README 稀释，如 HTML 头部 + 中文正文；最小阈值避免
 * 「本文档见英文版」这类一句占位 README 被当作完整中文版）。
 *
 * 清洗顺序固定为「代码块 → HTML → 链接」：顺序不能反——代码块里的 heredoc
 * （如 `python - <<'PY'`）会被 HTML 正则误判为标签起始，一路匹配到正文中下一个 `>`，
 * 把代码块闭合围栏和大段中文一并吞掉；HTML 正则也限定为 `<` 后紧跟字母/斜杠的真实标签，避免 `<<` 误伤。
 */
const MIN_ZH_CHARS = 20

function detectReadmeLang(text: string): 'zh' | 'en' {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<\/?[a-zA-Z][^>]*>/gi, '')
    .replace(/\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[#*|`>\-=_\s]/g, '')
  const zhChars = (cleaned.match(/[\u4e00-\u9fff]/g) ?? []).length
  const zhPunct = (cleaned.match(/[，。、；：？！「」『』]/g) ?? []).length
  const ratio = (zhChars + zhPunct * 2) / Math.max(cleaned.length, 1)
  return ratio > 0.15 && zhChars >= MIN_ZH_CHARS ? 'zh' : 'en'
}

/**
 * 拉取 README 并按语言归类：主 README（探测语言）+ 常见双语变体。
 * 每组取内容最长的一份，返回 { en, zh }（可能只有一份）。
 * 全部候选都失败且出现过网络/服务端错误（非 404，即仓库确实无 README）时抛错，
 * 让调用方保留已有缓存，避免拉取失败清空历史数据。
 */
export async function fetchReadmes(
  owner: string,
  repo: string,
  branch: string,
  token?: string
): Promise<{ en: string | null; zh: string | null }> {
  const result: { en: string | null; zh: string | null } = { en: null, zh: null }
  // 是否出现过网络/服务端错误（区别于 404「文件确实不存在」）
  let sawError = false
  const tryFetch = async (name: string): Promise<string | null> => {
    try {
      const res = await httpFetch(`${RAW_BASE}/${owner}/${repo}/${branch}/${name}`, {
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
        headers: token
          ? {
              Accept: 'application/vnd.github+json',
              'User-Agent': 'ai-github-manager',
              'X-GitHub-Api-Version': '2022-11-28',
              Authorization: `Bearer ${token}`
            }
          : undefined
      })
      if (res.ok) {
        const text = await res.text()
        return text.length > 0 ? text : null
      }
      if (res.status !== 404) sawError = true
    } catch {
      sawError = true
    }
    return null
  }
  const absorb = (text: string): void => {
    const lang = detectReadmeLang(text)
    if (!result[lang] || text.length > (result[lang]?.length ?? 0)) result[lang] = text
  }

  // 主 README：命中首个存在文件即停
  let primaryText: string | null = null
  for (const name of README_PRIMARY_CANDIDATES) {
    const text = await tryFetch(name)
    if (text) {
      absorb(text)
      primaryText = text
      break
    }
  }
  // 从主 README 的语言切换链接中提取中文/英文版路径（如 [简体中文](README-zh.md) /
  // [English](docs/en/README.md)），确定性解析，不依赖 AI；覆盖固定命名之外的各种变体
  if (primaryText) {
    const linked = extractLangReadmeLinks(primaryText)
    for (const path of [...linked.zh, ...linked.en]) {
      const text = await tryFetch(path)
      if (text) absorb(text)
    }
  }
  // 常见双语变体：全部尝试，按语言归组
  for (const name of README_LANG_CANDIDATES) {
    const text = await tryFetch(name)
    if (text) absorb(text)
  }
  // 全空且出现过网络/服务端错误：视为拉取失败（而非仓库无 README），交由调用方决定是否保留缓存
  if (!result.en && !result.zh && sawError) {
    throw new Error(
      msg('README 拉取失败（网络或服务端错误）', 'Failed to fetch README (network or server error)')
    )
  }
  return result
}

/** 链接文字中出现这些词即视为「指向中文文档」的语言切换链接 */
const CHINESE_LINK_TEXT =
  /(中文|简体|繁体|簡體|繁體|汉语|漢語|中文版|中文文档|中文文檔|国语|國語|国文|國文)/i
/** 链接文字中出现这些词即视为「指向英文文档」的语言切换链接 */
const ENGLISH_LINK_TEXT = /(English|英文|英語|英文版|英文文档|英文文檔)/i

/**
 * 从 README 的语言切换链接中提取中文 / 英文 README 相对路径。
 * 同时解析 Markdown 链接 [text](path) 与 HTML <a href="path">text</a>（GitHub 双语 README 常用）。
 * 判定优先级：链接文字（中文词 / 英文词）→ 路径关键词（zh/cn/hans 或 en）；
 * 其他语言（ja/ko/ru/...）路径排除。
 */
function extractLangReadmeLinks(readme: string): { zh: string[]; en: string[] } {
  const result: { zh: string[]; en: string[] } = { zh: [], en: [] }
  const pairs: Array<[string, string]> = []
  // Markdown 链接
  const mdRe = /\[([^\]]*)\]\(([^)\s]+)\)/g
  let m: RegExpExecArray | null
  while ((m = mdRe.exec(readme))) pairs.push([m[1], m[2]])
  // HTML 链接
  const htmlRe = /<a[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g
  while ((m = htmlRe.exec(readme))) pairs.push([m[2], m[1]])

  // 其他常见语言的路径提示（排除日文汉字等误判）
  const OTHER_LANG = /[-_.](ja|ko|ru|de|fr|es|pt|ar|hi|it|nl|pl|tr|vi|th|id|uk|fa|he|jp)\b/i
  for (const [text, rawPath] of pairs) {
    const path = rawPath.split('#')[0]
    if (!/\.(md|markdown)$/i.test(path)) continue // 只看文档链接
    if (/^https?:\/\//i.test(path)) continue // 跳过绝对 URL
    if (OTHER_LANG.test(path)) continue // 跳过其他语言版本
    const isChineseText = CHINESE_LINK_TEXT.test(text)
    const isEnglishText = ENGLISH_LINK_TEXT.test(text)
    const isChinesePath = /(^|\/)[^/]*(zh|cn|hans)[^/]*\.(md|markdown)$/i.test(path)
    const isEnglishPath = /(^|\/)[^/]*\ben[^/]*\.(md|markdown)$/i.test(path)
    // 文字判定优先；文字无明确语言时退回路径关键词
    const lang =
      isChineseText && !isEnglishText
        ? 'zh'
        : isEnglishText && !isChineseText
          ? 'en'
          : isChinesePath && !isEnglishPath
            ? 'zh'
            : isEnglishPath
              ? 'en'
              : null
    if (lang && !result[lang].includes(path)) result[lang].push(path)
  }
  return result
}

/**
 * 拉取仓库元数据 + 多语言 README 并落库（手动刷新 / AI 任务共用）。
 * README 拉取失败（网络/服务端错误导致全部为空）时抛错，不写任何 README 字段，
 * 保留已有缓存避免数据丢失；仓库确实无 README（全部 404）时才清空语言缓存。
 */
export async function syncProjectReadme(
  project: {
    id: number
    owner: string
    repo: string
    readmeCache: string | null
  },
  token?: string
): Promise<void> {
  const meta = await fetchRepoMeta(project.owner, project.repo, token)
  updateProjectMeta(project.id, {
    name: meta.name,
    description: meta.description,
    starCount: meta.starCount,
    forkCount: meta.forkCount,
    language: meta.language,
    homepage: meta.homepage,
    topics: meta.topics,
    pushedAt: meta.pushedAt,
    readmeCache: project.readmeCache
  })
  // 物化标签：语言（替换式，GitHub 官方标准写法如 TypeScript/Python，不做小写归一化）+ GitHub 话题（替换式，其他来源已占的同名标签跳过）
  if (meta.language) {
    replaceProjectTags(project.id, 'language', [{ name: meta.language, dimension: 'language' }])
  }
  if (meta.topics.length > 0) {
    replaceProjectTags(
      project.id,
      'topic',
      meta.topics.map((n) => ({ name: normalizeTagName(n), dimension: 'topic' }))
    )
  }
  const readmes = await fetchReadmes(project.owner, project.repo, meta.defaultBranch, token)
  const readmePatch: {
    readmeCache?: string | null
    readmeEn?: string | null
    readmeZh?: string | null
    readmeZhAi?: string | null
    readmeAiModel?: string | null
  } = {
    // 显式写入（含 null），修正语言分类后清掉旧字段残留
    readmeEn: readmes.en,
    readmeZh: readmes.zh
  }
  if (readmes.en) {
    readmePatch.readmeCache = readmes.en
  } else if (readmes.zh) {
    readmePatch.readmeCache = readmes.zh
  }
  // 已有真实中文版时，清理历史 AI 翻译残留（页面优先展示真实中文；旧翻译可能基于误判内容）
  if (readmes.zh) {
    readmePatch.readmeZhAi = null
    readmePatch.readmeAiModel = null
  }
  if (Object.keys(readmePatch).length > 0) updateProjectMeta(project.id, readmePatch)
}

/** 版本发布记录中的单个文件 */
interface ReleaseAssetData {
  name: string
  downloadUrl: string
  /** SHA-256（GitHub digest 字段，仅部分上传方式提供） */
  sha256: string | null
}

export interface ReleaseData {
  tagName: string
  publishedAt: string | null
  body: string | null
  htmlUrl: string | null
  /** 版本附带的文件列表（历史版本记录用） */
  assets: ReleaseAssetData[]
}

/** 拉取 Releases 列表（API，按需触发），失败返回 null */
export async function fetchReleases(
  owner: string,
  repo: string,
  token?: string
): Promise<ReleaseData[] | null> {
  try {
    const res = await request(`/repos/${owner}/${repo}/releases?per_page=20`, token)
    if (!res.ok) return null
    const j = (await res.json()) as Array<{
      tag_name?: string
      published_at?: string | null
      body?: string | null
      html_url?: string
      assets?: Array<{
        name?: string
        browser_download_url?: string
        digest?: string
      }>
    }>
    return j.map((r) => ({
      tagName: r.tag_name ?? 'unknown',
      publishedAt: r.published_at ?? null,
      body: r.body ?? null,
      htmlUrl: r.html_url ?? null,
      // digest 格式形如 "sha256:xxxx"，剥离前缀
      assets: (r.assets ?? []).map((a) => ({
        name: a.name ?? 'unknown',
        downloadUrl: a.browser_download_url ?? '',
        sha256: a.digest?.startsWith('sha256:') ? a.digest.slice('sha256:'.length) : null
      }))
    }))
  } catch {
    return null
  }
}

/** 获取最新版本（git 协议优先，失败降级 API tags） */
export async function fetchLatestVersion(owner: string, repo: string): Promise<string | null> {
  // 1) git 协议：零 API 消耗（设计文档 §7 首选）
  try {
    const { execFileSync } = await import('node:child_process')
    const { getSetting } = await import('../db/dao')
    const { gitProxyEnv } = await import('./network')
    const proxy = getSetting<{
      enabled: boolean
      protocol: 'http' | 'socks5'
      host: string
      port: number
    }>('network.proxy', { enabled: false, protocol: 'http', host: '', port: 0 })
    const out = execFileSync(
      'git',
      ['ls-remote', '--tags', `https://github.com/${owner}/${repo}.git`],
      {
        timeout: DEFAULT_TIMEOUT,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
        env: { ...process.env, ...gitProxyEnv(proxy) }
      }
    ).toString()
    const tags = out
      .split('\n')
      .map((l) => l.split('refs/tags/')[1])
      .filter((t): t is string => !!t && !t.includes('^{}'))
      .sort(compareVersions)
    if (tags.length > 0) return tags[tags.length - 1]
  } catch {
    // git 不可达 → 降级 API
  }

  // 2) API 降级：latest release 或 tags 列表
  try {
    const res = await request(`/repos/${owner}/${repo}/releases/latest`)
    if (res.ok) {
      const j = (await res.json()) as { tag_name?: string }
      if (j.tag_name) return j.tag_name
    }
    const tagsRes = await request(`/repos/${owner}/${repo}/tags?per_page=5`)
    if (tagsRes.ok) {
      const j = (await tagsRes.json()) as Array<{ name?: string }>
      if (j.length > 0 && j[0].name) return j[0].name
    }
  } catch {
    // 全部失败
  }
  return null
}

/**
 * 版本标签语义比较（semver 自然排序）：
 * - 忽略前导 v/V；主/次/补丁按数值比较（v1.10.0 > v1.9.0）
 * - 预发布（-beta/-rc 等）排在对应正式版之后；无法解析的标签回退字典序
 */
function parseVersion(tag: string): { nums: number[]; prerelease: string | null } | null {
  const s = tag.trim().replace(/^[vV]/, '')
  const [mainPart, prerelease] = s.split('-', 2)
  const nums = mainPart.split('.').map((p) => Number.parseInt(p, 10))
  if (nums.length === 0 || nums.some((n) => Number.isNaN(n))) return null
  return { nums, prerelease: prerelease ? prerelease.toLowerCase() : null }
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return a.localeCompare(b)
  const len = Math.max(pa.nums.length, pb.nums.length)
  for (let i = 0; i < len; i++) {
    const na = pa.nums[i] ?? 0
    const nb = pb.nums[i] ?? 0
    if (na !== nb) return na - nb
  }
  if (pa.prerelease === pb.prerelease) return 0
  if (pa.prerelease === null) return 1
  if (pb.prerelease === null) return -1
  return pa.prerelease.localeCompare(pb.prerelease)
}
