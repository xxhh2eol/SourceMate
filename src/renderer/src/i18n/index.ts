import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zhCN from './locales/zh-CN.json'
import enUS from './locales/en-US.json'

export const SUPPORTED_LANGUAGES = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' }
] as const

/**
 * 语言切换已隐藏，应用专注中文：把历史保存的非中文语言重置为 zh-CN。
 * 直接改写 localStorage 中的持久化 state（store 随后 rehydrate 时读到的是中文，
 * App.tsx 的 effect 会自动把 zh-CN 同步给主进程，AI 输出语言规则跟随中文）。
 */
function forceChinese(): void {
  try {
    const raw = localStorage.getItem('app-settings')
    if (!raw) return
    const parsed = JSON.parse(raw) as { state?: { language?: string } }
    if (parsed.state && parsed.state.language !== 'zh-CN') {
      parsed.state.language = 'zh-CN'
      localStorage.setItem('app-settings', JSON.stringify(parsed))
    }
  } catch {
    // 存储损坏时忽略，直接按默认中文初始化
  }
}
forceChinese()

void i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    'en-US': { translation: enUS }
  },
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  interpolation: {
    escapeValue: false // React 已做 XSS 转义
  }
})

export default i18n
