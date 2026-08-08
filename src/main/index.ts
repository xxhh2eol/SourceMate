import { app, shell, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { initDatabase } from './db'
import { registerIpcHandlers, startServices } from './ipc'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: 'SourceMate',
    icon: join(__dirname, '../../build/icon.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // 安全基线（设计文档 §1）：渲染进程不注入 Node 能力，IPC 走 preload 白名单
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // 诊断：渲染进程错误输出到主进程控制台（开发期排查用）
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`)
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer gone]', details.reason, details.exitCode)
  })

  // 外部链接一律交给系统浏览器，不在应用内打开
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 开发模式加载 Vite dev server，生产模式加载打包产物
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  initDatabase()
  registerIpcHandlers()
  startServices()
  // 注：系统字体读取（Local Font Access API）无需配置权限——经 Electron 43 实测，
  // queryLocalFonts 走权限 check 路径（默认放行），不经过 setPermissionRequestHandler
  createWindow()

  app.on('activate', () => {
    // macOS 点击 Dock 图标时若无窗口则重建
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
