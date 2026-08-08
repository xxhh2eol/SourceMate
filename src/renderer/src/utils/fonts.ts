/** 系统字体条目：FontMetadata + 启发式分类（中文字形 / 等宽） */
export interface FontEntry {
  family: string
  fullName: string
  postscriptName: string
  style: string
  /** 是否包含中文字形（启发式：canvas 测宽） */
  isCJK: boolean
  /** 是否等宽字体（启发式：i 与 m 等宽） */
  isMono: boolean
}

/** 判断字体是否包含中文字形：若字体缺字形，canvas 会静默回退到 sans-serif，宽度即与兜底相同 */
function supportsCJK(family: string): boolean {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return false
  const test = '中文测试'
  ctx.font = `48px "${family}", sans-serif`
  const withFont = ctx.measureText(test).width
  ctx.font = '48px sans-serif'
  return withFont !== ctx.measureText(test).width
}

/** 判断是否等宽字体：等宽字体中 i 与 m 宽度一致 */
function isMonospace(family: string): boolean {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return false
  ctx.font = `48px "${family}"`
  return ctx.measureText('iii').width === ctx.measureText('mmm').width
}

/**
 * 枚举系统已安装字体（Local Font Access API，跨平台同一套 API），
 * 附带中文字形 / 等宽分类；同一 family 的多个样式（Regular/Bold…）合并为一项。
 * 无需额外权限配置：经实测 Electron 43 默认放行（不走 permission request handler）。
 */
export async function enumerateSystemFonts(): Promise<FontEntry[]> {
  const fonts = await window.queryLocalFonts()
  const seen = new Set<string>()
  const entries: FontEntry[] = []
  for (const f of fonts) {
    if (seen.has(f.family)) continue
    seen.add(f.family)
    entries.push({
      family: f.family,
      fullName: f.fullName,
      postscriptName: f.postscriptName,
      style: f.style,
      isCJK: supportsCJK(f.family),
      isMono: isMonospace(f.family)
    })
  }
  return entries.sort((a, b) => a.family.localeCompare(b.family))
}
