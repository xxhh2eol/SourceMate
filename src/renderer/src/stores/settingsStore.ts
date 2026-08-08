import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { enumerateSystemFonts, type FontEntry } from '../utils/fonts'
import type { TagDimension } from '@shared/types'

export type ThemeMode = 'light' | 'dark' | 'system'
export type AppLanguage = 'zh-CN' | 'en-US'

/** 侧栏钉住的分类项：一级 = 整个维度组（如「语言」）；二级 = 具体标签 */
export interface PinnedCategory {
  kind: 'dim' | 'tag'
  /** kind='dim' 时的维度 */
  dimension?: TagDimension
  /** kind='tag' 时的标签 id */
  tagId?: number
}

/** 预设主题色（antd colorPrimary） */
export const PRESET_COLORS = [
  '#1677ff', // 默认蓝
  '#722ed1', // 紫色
  '#13c2c2', // 青色
  '#52c41a', // 绿色
  '#fa8c16', // 橙色
  '#eb2f96', // 玫红
  '#f5222d', // 红色
  '#2f54eb' // 靛蓝
]

interface SettingsState {
  themeMode: ThemeMode
  language: AppLanguage
  primaryColor: string
  /** 侧栏钉住的分类项（维度组或具体标签，可自由增删，互不影响） */
  pinnedCategories: PinnedCategory[]
  /** 项目卡片/表格行配色模式：彩色（按项目名淡色相）| 黑白（默认白底） */
  projectColorMode: 'color' | 'mono'
  /** UI 字体（null = 系统默认） */
  uiFontFamily: string | null
  /** Markdown 正文字体（null = 系统默认） */
  markdownFontFamily: string | null
  /** 系统字体列表缓存（会话内，不持久化；null = 尚未枚举） */
  fontList: FontEntry[] | null
  fontListLoading: boolean
  setThemeMode: (mode: ThemeMode) => void
  setLanguage: (lang: AppLanguage) => void
  setPrimaryColor: (color: string) => void
  togglePinCategory: (pin: PinnedCategory) => void
  setProjectColorMode: (mode: 'color' | 'mono') => void
  setUiFontFamily: (family: string | null) => void
  setMarkdownFontFamily: (family: string | null) => void
  /** 枚举系统字体并更新缓存（懒加载：首次打开字体选择器时调用） */
  refreshFontList: () => Promise<void>
}

/** 两个钉住项是否指向同一分类（dim 比维度，tag 比 id） */
function samePin(a: PinnedCategory, b: PinnedCategory): boolean {
  return (
    (a.kind === 'dim' && b.kind === 'dim' && a.dimension === b.dimension) ||
    (a.kind === 'tag' && b.kind === 'tag' && a.tagId === b.tagId)
  )
}

/** 首版仅落地主题模式；模型配置 / 凭据 / 网络 / 数据设置随 M5 接入主进程存储 */
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      themeMode: 'system',
      language: 'zh-CN',
      primaryColor: PRESET_COLORS[0],
      pinnedCategories: [],
      projectColorMode: 'color',
      uiFontFamily: null,
      markdownFontFamily: null,
      fontList: null,
      fontListLoading: false,
      setThemeMode: (themeMode) => set({ themeMode }),
      setLanguage: (language) => set({ language }),
      setPrimaryColor: (primaryColor) => set({ primaryColor }),
      togglePinCategory: (pin) => {
        set((state) => ({
          pinnedCategories: state.pinnedCategories.some((p) => samePin(p, pin))
            ? state.pinnedCategories.filter((p) => !samePin(p, pin))
            : [...state.pinnedCategories, pin]
        }))
      },
      setProjectColorMode: (projectColorMode) => set({ projectColorMode }),
      setUiFontFamily: (uiFontFamily) => set({ uiFontFamily }),
      setMarkdownFontFamily: (markdownFontFamily) => set({ markdownFontFamily }),
      refreshFontList: async () => {
        set({ fontListLoading: true })
        try {
          set({ fontList: await enumerateSystemFonts() })
        } finally {
          set({ fontListLoading: false })
        }
      }
    }),
    {
      name: 'app-settings',
      // v0 的 pinnedCategories 为 string[]（TAG_TYPES 类型名）；标签体系重建为「维度组/标签」结构后废弃，清空
      version: 1,
      migrate: (persisted) => {
        const s = persisted as
          | {
              themeMode?: ThemeMode
              language?: AppLanguage
              primaryColor?: string
              pinnedCategories?: unknown
              projectColorMode?: 'color' | 'mono'
              uiFontFamily?: string | null
              markdownFontFamily?: string | null
            }
          | undefined
        if (
          s?.pinnedCategories &&
          Array.isArray(s.pinnedCategories) &&
          s.pinnedCategories.length > 0 &&
          typeof s.pinnedCategories[0] === 'string'
        ) {
          return { ...s, pinnedCategories: [] }
        }
        return {
          themeMode: s?.themeMode ?? 'system',
          language: s?.language ?? 'zh-CN',
          primaryColor: s?.primaryColor ?? PRESET_COLORS[0],
          pinnedCategories: Array.isArray(s?.pinnedCategories)
            ? (s.pinnedCategories as PinnedCategory[])
            : [],
          projectColorMode: s?.projectColorMode ?? 'color',
          uiFontFamily: s?.uiFontFamily ?? null,
          markdownFontFamily: s?.markdownFontFamily ?? null
        }
      },
      // 字体列表仅会话内缓存，不随设置持久化（枚举仅几十毫秒，避免陈旧数据）
      partialize: (s) => ({
        themeMode: s.themeMode,
        language: s.language,
        primaryColor: s.primaryColor,
        pinnedCategories: s.pinnedCategories,
        projectColorMode: s.projectColorMode,
        uiFontFamily: s.uiFontFamily,
        markdownFontFamily: s.markdownFontFamily
      })
    }
  )
)
