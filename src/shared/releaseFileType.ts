/**
 * Release 附件类型识别（历史版本记录）
 *
 * 本地规则优先根据文件名/后缀识别平台、架构与包类型；
 * AI 补全时也会输出结构化字段（platform / arch / kind），
 * 这里统一做归一化，保证类型表去重时不会出现同义重复项。
 */

export interface ReleaseFileClassification {
  platform: string | null
  arch: string | null
  kind: string | null
}

export interface ReleaseFileCategory {
  key: string
  label: string
}

const SOURCE_PATTERN =
  /(?:^|[._\-\s])(?:src|source|source-code)(?:[._\-\s]|$)/i
const CHECKSUM_PATTERN =
  /(?:^|[._\-\s])(?:sha-?256|sha-?512|md5|sha256sums?|sha512sums?|md5sums?|checksums?|hash(?:es)?|digest(?:s)?)(?:[._\-\s]|$)/i
const SIGNATURE_PATTERN = /\.(?:asc|sig)$/i
const INSTALLER_PATTERN =
  /(?:^|[._\-\s])(?:setup|install(?:er)?)(?:[._\-\s]|$)|\.(?:exe|msi|msix|appx|dmg|pkg|deb|rpm|appimage|snap|flatpak|apk|ipa)$/i

const PLATFORM_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  {
    pattern:
      /(?:^|[._\-\s])(?:windows|win)(?:[._\-\s]|$)|win32|win64|win10|win11|msvc|pc-windows/i,
    label: 'windows'
  },
  {
    pattern:
      /(?:^|[._\-\s])(?:macosx?|mac-os|mac|darwin|osx|apple)(?:[._\-\s]|$)|mac64|macarm/i,
    label: 'macos'
  },
  {
    pattern:
      /(?:^|[._\-\s])(?:linux|ubuntu|debian|fedora|arch|manjaro|archlinux)(?:[._\-\s]|$)|linux-gnu|linux-musl/i,
    label: 'linux'
  },
  { pattern: /android|aosp/i, label: 'android' },
  {
    pattern: /(?:^|[._\-\s])ios(?:[._\-\s]|$)|iphone|ipad|ipados/i,
    label: 'ios'
  },
  { pattern: /freebsd|openbsd|netbsd|bsd/i, label: 'freebsd' },
  { pattern: /chromeos|chrome-os|chrome_os/i, label: 'chromeos' }
]

const ARCH_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  {
    pattern: /x86_?64|amd64|(?:^|[._\-\s])x64(?:[._\-\s]|$)|64-?bit/i,
    label: 'x64'
  },
  { pattern: /aarch64|arm64|armv8/i, label: 'arm64' },
  {
    pattern: /(?:^|[._\-\s])x86(?:[._\-\s]|$)|i386|i686|ia32|32-?bit/i,
    label: 'x86'
  },
  { pattern: /armv7|armhf|arm-?32|arm32/i, label: 'arm32' },
  {
    pattern: /universal|all-arch|fat-binary|multi-?arch/i,
    label: 'universal'
  },
  { pattern: /riscv64/i, label: 'riscv64' },
  { pattern: /loongarch64|loong64/i, label: 'loongarch64' },
  { pattern: /ppc64le|powerpc64le/i, label: 'ppc64le' },
  { pattern: /s390x/i, label: 's390x' }
]

function matchPattern(
  patterns: ReadonlyArray<{ pattern: RegExp; label: string }>,
  text: string
): string | null {
  for (const { pattern, label } of patterns) {
    if (pattern.test(text)) return label
  }
  return null
}

/** 扩展名隐含的平台（仅在文件名未显式写出平台时兜底） */
function impliedPlatform(name: string): string | null {
  const lower = name.toLowerCase()
  if (
    lower.endsWith('.appimage') ||
    lower.endsWith('.deb') ||
    lower.endsWith('.rpm') ||
    lower.endsWith('.snap') ||
    lower.endsWith('.flatpak') ||
    lower.endsWith('.pacman')
  ) {
    return 'linux'
  }
  if (lower.endsWith('.dmg') || lower.endsWith('.pkg')) return 'macos'
  if (lower.endsWith('.msi') || lower.endsWith('.msix') || lower.endsWith('.appx')) {
    return 'windows'
  }
  if (lower.endsWith('.exe')) return 'windows'
  if (lower.endsWith('.apk')) return 'android'
  if (lower.endsWith('.ipa')) return 'ios'
  return null
}

/** 把 AI/note 里的平台写法归一化成小写键（未知值保留原样，便于动态收集） */
export function normalizePlatform(value: string | null | undefined): string | null {
  if (!value) return null
  const v = value.trim().toLowerCase()
  if (!v || v === 'unknown' || v === '其他' || v === '其他平台') return null
  const matched = matchPattern(PLATFORM_PATTERNS, v) ?? impliedPlatform(v)
  if (matched) return matched
  return v.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || null
}

/** 把 AI/note 里的包类型写法归一化成小写键（未知值保留原样，便于动态收集） */
export function normalizeKind(value: string | null | undefined): string | null {
  if (!value) return null
  const v = value.trim().toLowerCase()
  if (!v || v === 'unknown' || v === '其他' || v === '其他类型') return null
  if (/installer|install|setup|安装包|安装程序|安装/.test(v)) return 'installer'
  if (/source|源码|源代码/.test(v)) return 'source'
  if (/checksum|hash|sha-?256|sha-?512|md5|校验和|校验/.test(v)) return 'checksum'
  if (/signature|sig\b|签名/.test(v)) return 'signature'
  if (/other|附件|文件/.test(v)) return 'other'
  return v.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || null
}

/** 把 AI/note 里的架构写法归一化成小写键（未知值保留原样，便于动态收集） */
export function normalizeArch(value: string | null | undefined): string | null {
  if (!value) return null
  const v = value.trim().toLowerCase()
  if (!v || v === 'unknown' || v === '其他' || v === '其他架构') return null
  const matched = matchPattern(ARCH_PATTERNS, v)
  if (matched) return matched
  return v.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || null
}

/** 根据文件名 + note 推断结构化类型；AI 输出可单独用 normalize* 归一化 */
export function classifyReleaseFile(
  name: string,
  note?: string | null
): ReleaseFileClassification {
  const source = `${name} ${note ?? ''}`
  let kind: string | null = null
  if (SOURCE_PATTERN.test(name)) kind = 'source'
  else if (CHECKSUM_PATTERN.test(name)) kind = 'checksum'
  else if (SIGNATURE_PATTERN.test(name)) kind = 'signature'
  else if (INSTALLER_PATTERN.test(name)) kind = 'installer'
  else if (note && /安装包|安装程序|installer|install|setup/i.test(note)) kind = 'installer'
  else if (note && /源码|源代码|source/i.test(note)) kind = 'source'
  else if (note && /校验和|checksum|sha-?256/i.test(note)) kind = 'checksum'
  else if (note && /签名|signature|\.sig/i.test(note)) kind = 'signature'

  const platform = matchPattern(PLATFORM_PATTERNS, source) ?? impliedPlatform(name)
  const arch = matchPattern(ARCH_PATTERNS, source)

  return {
    platform: normalizePlatform(platform),
    arch: normalizeArch(arch),
    kind: kind ? normalizeKind(kind) : null
  }
}

/** 类型过滤键：platform:kind（未知值统一为 other） */
export function releaseFileTypeKey(
  platform: string | null | undefined,
  kind: string | null | undefined
): string {
  const p = normalizePlatform(platform) ?? 'other'
  const k = normalizeKind(kind) ?? 'other'
  return `${p}:${k}`
}

const PLATFORM_LABELS: Record<string, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  android: 'Android',
  ios: 'iOS',
  freebsd: 'FreeBSD',
  chromeos: 'ChromeOS',
  other: '其他'
}

const KIND_LABELS: Record<string, string> = {
  installer: '安装包',
  source: '源代码',
  checksum: '校验和',
  signature: '签名文件',
  other: '附件'
}

const ARCH_LABELS: Record<string, string> = {
  x64: 'x64',
  arm64: 'arm64',
  x86: 'x86',
  arm32: 'arm32',
  universal: '通用',
  riscv64: 'riscv64',
  loongarch64: 'loongarch64',
  ppc64le: 'ppc64le',
  s390x: 's390x'
}

/** 类型表/过滤下拉展示用中文标签 */
export function releaseFileTypeLabel(
  platform: string | null | undefined,
  kind: string | null | undefined
): string {
  const p = normalizePlatform(platform) ?? 'other'
  const k = normalizeKind(kind) ?? 'other'
  const platformLabel = PLATFORM_LABELS[p] ?? p
  const kindLabel = KIND_LABELS[k] ?? k
  if (p === 'other' && k === 'other') return '其他附件'
  if (p === 'other') return kindLabel
  if (k === 'other') return `${platformLabel} 附件`
  return `${platformLabel} ${kindLabel}`
}

/** 未分析/无 note 时，按文件名生成与本地说明一致的标签（如「Windows x64 版本」） */
export function inferReleaseFileNoteLabel(name: string): string | null {
  const type = classifyReleaseFile(name)
  if (type.kind === 'source') return '源代码压缩包'
  if (type.kind === 'checksum') return '校验和文件'
  if (type.kind === 'signature') return '签名文件'

  const platform = type.platform ? PLATFORM_LABELS[type.platform] ?? type.platform : null
  const arch = type.arch ? ARCH_LABELS[type.arch] ?? type.arch : null
  if (platform && arch) return `${platform} ${arch} 版本`
  if (platform) return `${platform} 版本`
  if (type.kind === 'installer') return '安装包'
  return null
}

/** 过滤下拉/类型表使用的展示标签：优先用实际 note，保证和列表里看到的一致 */
export function releaseFileDisplayLabel(file: {
  name: string
  note?: string | null
  platform?: string | null
  kind?: string | null
}): string {
  const note = file.note?.trim()
  if (note) return note
  return (
    inferReleaseFileNoteLabel(file.name) ??
    releaseFileTypeLabel(file.platform, file.kind)
  )
}

/** 按后缀/文件名把附件归到少数几个过滤类别，避免下拉被具体说明撑爆 */
export function releaseFileCategory(name: string): ReleaseFileCategory {
  const lower = name.toLowerCase()
  if (SOURCE_PATTERN.test(name)) return { key: 'source', label: '源代码' }
  if (CHECKSUM_PATTERN.test(name)) return { key: 'checksum', label: '校验和' }
  if (SIGNATURE_PATTERN.test(name)) return { key: 'signature', label: '签名文件' }
  if (lower.endsWith('.exe')) return { key: 'exe', label: 'EXE 应用' }
  if (lower.endsWith('.msi')) return { key: 'msi', label: 'MSI 安装包' }
  if (lower.endsWith('.msix') || lower.endsWith('.appx')) {
    return { key: 'msix-appx', label: 'MSIX/APPX' }
  }
  if (lower.endsWith('.dmg')) return { key: 'dmg', label: 'DMG 镜像' }
  if (lower.endsWith('.pkg')) return { key: 'pkg', label: 'PKG 安装包' }
  if (lower.endsWith('.deb')) return { key: 'deb', label: 'DEB 安装包' }
  if (lower.endsWith('.rpm')) return { key: 'rpm', label: 'RPM 安装包' }
  if (lower.endsWith('.appimage')) return { key: 'appimage', label: 'AppImage' }
  if (lower.endsWith('.snap')) return { key: 'snap', label: 'Snap' }
  if (lower.endsWith('.flatpak')) return { key: 'flatpak', label: 'Flatpak' }
  if (lower.endsWith('.apk')) return { key: 'apk', label: 'APK' }
  if (lower.endsWith('.ipa')) return { key: 'ipa', label: 'IPA' }
  if (lower.endsWith('.zip')) return { key: 'zip', label: 'ZIP 压缩包' }
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    return { key: 'tar-gz', label: 'TAR.GZ 压缩包' }
  }
  if (lower.endsWith('.tar.xz') || lower.endsWith('.tar.bz2') || lower.endsWith('.tar')) {
    return { key: 'tar', label: 'TAR 压缩包' }
  }
  if (lower.endsWith('.7z') || lower.endsWith('.rar')) {
    return { key: 'archive', label: '压缩包' }
  }
  if (INSTALLER_PATTERN.test(name)) return { key: 'installer', label: '安装包' }
  return { key: 'other', label: '其他附件' }
}

/**
 * 过滤下拉使用的标签：优先按文件名/备注里的平台 + 架构归类，
 * 例如 javboss-...-linux-x86_64.zip → 「Linux x64 版本」；
 * 源代码/校验和/签名仍用独立类别，无法识别时回退到后缀类别。
 */
export function releaseFileFilterLabel(file: {
  name: string
  note?: string | null
  platform?: string | null
  arch?: string | null
  kind?: string | null
}): string {
  const detected = classifyReleaseFile(file.name, file.note)
  const platform = normalizePlatform(file.platform) ?? detected.platform
  const arch = normalizeArch(file.arch) ?? detected.arch
  const kind = normalizeKind(file.kind) ?? detected.kind

  if (kind === 'source') return '源代码'
  if (kind === 'checksum') return '校验和'
  if (kind === 'signature') return '签名文件'

  const platformLabel = platform ? PLATFORM_LABELS[platform] ?? platform : null
  const archLabel = arch ? ARCH_LABELS[arch] ?? arch : null
  if (platformLabel && archLabel) return `${platformLabel} ${archLabel} 版本`
  if (platformLabel) return `${platformLabel} 版本`
  if (archLabel) return `${archLabel} 版本`
  if (kind === 'installer') return '安装包'
  return releaseFileCategory(file.name).label
}
