/**
 * Release 附件文件说明推断（历史版本记录）
 *
 * GitHub 打包应用的附件命名通常有固定规律（平台 / 架构 / 包类型），
 * 这里用本地规则生成中文说明；只有无法识别的文件名才回退给 AI 分析，
 * 从而减少 release_analyze 的输入与输出 token。
 */

const SOURCE_PATTERN =
  /(?:^|[._\-\s])(?:src|source|source-code)(?:[._\-\s]|$)/i
const CHECKSUM_PATTERN =
  /(?:^|[._\-\s])(?:sha-?256|sha-?512|md5|sha256sums?|sha512sums?|md5sums?|checksums?|hash(?:es)?|digest(?:s)?)(?:[._\-\s]|$)/i
const SIGNATURE_PATTERN = /\.(?:asc|sig)$/i

const PLATFORM_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  {
    pattern:
      /(?:^|[._\-\s])(?:windows|win)(?:[._\-\s]|$)|win32|win64|win10|win11|msvc|pc-windows/i,
    label: 'Windows'
  },
  {
    pattern:
      /(?:^|[._\-\s])(?:macosx?|mac-os|mac|darwin|osx|apple)(?:[._\-\s]|$)|mac64|macarm/i,
    label: 'macOS'
  },
  {
    pattern:
      /(?:^|[._\-\s])(?:linux|ubuntu|debian|fedora|arch|manjaro|archlinux)(?:[._\-\s]|$)|linux-gnu|linux-musl/i,
    label: 'Linux'
  },
  { pattern: /android|aosp/i, label: 'Android' },
  {
    pattern: /(?:^|[._\-\s])ios(?:[._\-\s]|$)|iphone|ipad|ipados/i,
    label: 'iOS'
  },
  { pattern: /freebsd|openbsd|netbsd|bsd/i, label: 'FreeBSD' },
  { pattern: /chromeos|chrome-os|chrome_os/i, label: 'ChromeOS' }
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
    label: '通用'
  },
  { pattern: /riscv64/i, label: 'riscv64' },
  { pattern: /loongarch64|loong64/i, label: 'loongarch64' },
  { pattern: /ppc64le|powerpc64le/i, label: 'ppc64le' },
  { pattern: /s390x/i, label: 's390x' }
]

function matchPattern(
  patterns: ReadonlyArray<{ pattern: RegExp; label: string }>,
  name: string
): string | null {
  for (const { pattern, label } of patterns) {
    if (pattern.test(name)) return label
  }
  return null
}

/** 扩展名隐含的平台（仅在文件名未显式写出平台时兜底） */
function impliedPlatform(name: string): string | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.appimage') || lower.endsWith('.deb') || lower.endsWith('.rpm')) {
    return 'Linux'
  }
  if (lower.endsWith('.snap') || lower.endsWith('.flatpak') || lower.endsWith('.pacman')) {
    return 'Linux'
  }
  if (lower.endsWith('.dmg') || lower.endsWith('.pkg')) return 'macOS'
  if (lower.endsWith('.msi') || lower.endsWith('.msix') || lower.endsWith('.appx')) {
    return 'Windows'
  }
  if (lower.endsWith('.exe')) return 'Windows'
  if (lower.endsWith('.apk')) return 'Android'
  if (lower.endsWith('.ipa')) return 'iOS'
  return null
}

/**
 * 根据文件名推断中文文件说明。
 * 能明确判断时返回说明；无法判断时返回 null，由调用方决定是否交给 AI。
 */
export function inferReleaseFileNote(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return null

  if (SOURCE_PATTERN.test(trimmed)) return '源代码压缩包'
  if (CHECKSUM_PATTERN.test(trimmed)) return '校验和文件'
  if (SIGNATURE_PATTERN.test(trimmed)) return '签名文件'

  const platform = matchPattern(PLATFORM_PATTERNS, trimmed) ?? impliedPlatform(trimmed)
  const arch = matchPattern(ARCH_PATTERNS, trimmed)

  if (platform && arch) return `${platform} ${arch} 版本`
  if (platform) return `${platform} 版本`
  return null
}
