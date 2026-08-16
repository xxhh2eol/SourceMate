import { useEffect, useMemo } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { App as AntApp, ConfigProvider, Layout, theme as antdTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import enUS from 'antd/locale/en_US'
import './i18n'
import Sidebar from './components/Sidebar'
import ErrorBoundary from './components/ErrorBoundary'
import { useSettingsStore } from './stores/settingsStore'
import Dashboard from './pages/Dashboard'
import ProjectList from './pages/ProjectList'
import Repository from './pages/Repository'
import AICenter from './pages/AICenter'
import UsageLogs from './pages/UsageLogs'
import Settings from './pages/Settings'
import About from './pages/About'

export default function App(): React.JSX.Element {
  const themeMode = useSettingsStore((s) => s.themeMode)
  const language = useSettingsStore((s) => s.language)
  const primaryColor = useSettingsStore((s) => s.primaryColor)
  const uiFontFamily = useSettingsStore((s) => s.uiFontFamily)

  // 同步 i18n 语言；同时写入主进程 settings（AI 分析输出语言规则读取）
  useEffect(() => {
    void import('i18next').then((i18n) => i18n.default.changeLanguage(language))
    void window.api.setSetting('app.language', language)
  }, [language])

  // UI 字体全局生效：自定义字体置于系统字体栈前；设为系统默认时还原（清空内联样式）
  useEffect(() => {
    document.body.style.fontFamily = uiFontFamily
      ? `"${uiFontFamily}", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`
      : ''
  }, [uiFontFamily])

  const isDark = useMemo(() => {
    if (themeMode === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    return themeMode === 'dark'
  }, [themeMode])

  return (
    <ConfigProvider
      locale={language === 'zh-CN' ? zhCN : enUS}
      theme={{
        cssVar: {},
        algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: primaryColor,
          // antd 组件字体不继承 body，需经 token 注入（null 时回落到 antd 默认字体栈）
          fontFamily: uiFontFamily
            ? `"${uiFontFamily}", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`
            : undefined
        }
      }}
    >
      <AntApp>
        <ErrorBoundary>
          <HashRouter>
            <Layout style={{ height: '100vh' }}>
              <Sidebar />
              <Layout.Content style={{ minWidth: 0 }}>
                <Routes>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  {/* 项目列表页：全部 / 维度组 / 具体标签（侧栏「我的分类」目标页）；:index 为旧类型枚举路由，兼容保留 */}
                  <Route path="/projects" element={<ProjectList />} />
                  <Route path="/projects/dim/:dim" element={<ProjectList />} />
                  <Route path="/projects/tag/:tagId" element={<ProjectList />} />
                  <Route path="/projects/:index" element={<ProjectList />} />
                  {/* 旧「项目库」入口重定向：项目列表统一在首页（卡片/表格视图） */}
                  <Route path="/repository" element={<Navigate to="/dashboard" replace />} />
                  {/* /repository/:id 默认进 README；项目卡片跳 /summary 进「项目画像」 */}
                  <Route path="/repository/:id" element={<Repository />} />
                  <Route path="/repository/:id/:tab" element={<Repository />} />
                  <Route path="/ai-center" element={<AICenter />} />
                  <Route path="/ai-center/:tab" element={<AICenter />} />
                  <Route path="/usage-logs" element={<UsageLogs />} />
                  <Route path="/usage-logs/:model" element={<UsageLogs />} />
                  <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
                  <Route path="/settings/:tab" element={<Settings />} />
                  <Route path="/about" element={<About />} />
                </Routes>
              </Layout.Content>
            </Layout>
          </HashRouter>
        </ErrorBoundary>
      </AntApp>
    </ConfigProvider>
  )
}
