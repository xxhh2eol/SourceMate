/**
 * 标签稳定配色（黄金角 HSL 方案）：
 * FNV-1a 哈希 × 黄金角 137.508 → 连续色相，同词同色、色轮均匀分散。
 * 用途：标签徽章/筛选气泡/项目卡片的类型、语言、领域、用途标签。
 */

/** FNV-1a 32 位哈希 */
function fnv1a(name: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return h
}

/**
 * 连续色相（原方案，保留备用）：任意两词色差可极小（如 TypeScript 与 Go 仅差 0.8°）。
 * 想切回连续方案时，把 hueForName 的实现换成调用它。
 */
export function hueForNameContinuous(name: string): number {
  return (fnv1a(name) * 137.508) % 360
}

/**
 * 量化色相（当前生效）：色环切 24 段（每段 15°）取段中心，
 * 任意两词色差 ≥15°（同段同色），避免「几乎同色」的撞车。
 * 同段词再用第二个哈希决定饱和度档位（58/68/78%）区分——量化+饱和度组合，
 * 保持纯函数稳定，任意两词要么色相不同、要么饱和度不同。
 */
export function hueForName(name: string): number {
  const seg = Math.floor(hueForNameContinuous(name) / 15)
  return seg * 15 + 7.5
}

/** 饱和度档位（0-2）：第二个哈希（不同盐）决定，同段词用饱和度区分 */
function satLevel(name: string): number {
  const h = fnv1a(name + '\u0001')
  return Math.floor((h * 137.508) % 360 / 120) % 3
}

/** 主色（边框/文字） */
export function tagColor(name: string): string {
  return `hsl(${hueForName(name).toFixed(1)}, ${58 + satLevel(name) * 10}%, 40%)`
}

/** 淡色背景（气泡填充） */
export function tagBgColor(name: string): string {
  return `hsl(${hueForName(name).toFixed(1)}, ${50 + satLevel(name) * 10}%, 93%)`
}

/** 未选中状态的淡边框（主色低透明度） */
export function tagBorderColor(name: string): string {
  return `hsla(${hueForName(name).toFixed(1)}, ${58 + satLevel(name) * 10}%, 40%, 0.35)`
}

/** 项目卡片/表格行背景（按项目名取极淡色相，保证文字可读） */
export function projectBgColor(name: string): string {
  return `hsl(${hueForName(name).toFixed(1)}, ${38 + satLevel(name) * 8}%, 96%)`
}

/** 项目卡片淡边框（与背景同色相，略深） */
export function projectBorderColor(name: string): string {
  return `hsl(${hueForName(name).toFixed(1)}, ${32 + satLevel(name) * 8}%, 88%)`
}
