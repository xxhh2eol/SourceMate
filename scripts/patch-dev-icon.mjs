/**
 * 开发模式图标补丁:Windows 任务栏图标只认 exe 图标,
 * dev 模式跑的是 node_modules/electron/dist/electron.exe(默认 Electron 图标)。
 * 本脚本用 rcedit 把 build/icon.ico 写入 electron.exe,使 dev 模式任务栏显示应用 Logo。
 * 注意:npm install 重装 electron 后会重置,postinstall 会自动重跑本脚本。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function findRecursive(dir, name) {
  const out = []
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === name) out.push(full)
    }
  }
  walk(dir)
  return out
}

function cacheRoot() {
  return process.env.ELECTRON_BUILDER_CACHE || join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache')
}

function findSevenZip() {
  const dir = join(cacheRoot(), '7zip@1.0.0')
  if (existsSync(dir)) {
    const bins = findRecursive(dir, '7za.exe')
    if (bins.length > 0) return bins[0]
  }
  return ['C:\\Program Files\\7-Zip\\7z.exe', 'C:\\Program Files (x86)\\7-Zip\\7z.exe'].find((p) => existsSync(p)) || null
}

function findRcedit() {
  if (process.env.RCEDIT_PATH && existsSync(process.env.RCEDIT_PATH)) return process.env.RCEDIT_PATH
  const archive = join(cacheRoot(), 'winCodeSign-2.6.0', 'winCodeSign-2.6.0.7z')
  if (!existsSync(archive)) return null
  const extractDir = join(tmpdir(), 'wcs-patch-icon')
  const sevenZip = findSevenZip()
  if (!sevenZip) return null
  // winCodeSign 包内个别文件有警告(符号链接),7za 会返回非 0 退出码,但解压结果可用,忽略
  try {
    execFileSync(sevenZip, ['x', '-y', `-o${extractDir}`, archive], { stdio: 'ignore' })
  } catch {
    /* 解压已完成,继续 */
  }
  const bins = findRecursive(extractDir, 'rcedit-x64.exe')
  return bins.length > 0 ? bins[0] : null
}

function main() {
  if (process.platform !== 'win32') {
    console.log('[patch-dev-icon] 仅 Windows 需要,跳过')
    return
  }
  const electronExe = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  const icoPath = join(root, 'build', 'icon.ico')
  if (!existsSync(electronExe)) {
    console.log('[patch-dev-icon] electron.exe 不存在,跳过')
    return
  }
  if (!existsSync(icoPath)) {
    console.log('[patch-dev-icon] build/icon.ico 不存在,跳过')
    return
  }
  const rcedit = findRcedit()
  if (!rcedit) {
    console.log('[patch-dev-icon] 未找到 rcedit,跳过(任务栏图标为默认 Electron 图标)')
    return
  }
  try {
    execFileSync(rcedit, [electronExe, '--set-icon', icoPath], { stdio: 'ignore' })
    console.log('[patch-dev-icon] electron.exe 图标已替换为 SourceMate Logo')
  } catch (e) {
    console.log(`[patch-dev-icon] 失败: ${e.message}`)
  }
}

main()
