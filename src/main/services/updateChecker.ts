import { BrowserWindow } from 'electron'
import { getSetting, listProjectsWithTags, updateProjectMeta } from '../db/dao'
import { fetchLatestVersion } from './github'

export interface UpdateCheckResult {
  id: number
  name: string
  latest: string | null
  hasUpdate: boolean
}

/**
 * 批量检查全部项目更新（git ls-remote 优先，零 API 消耗）。
 * 发现新版本（latest != 上次记录）时置 has_update=1，供「可更新」列表展示；
 * 无新版本时不清除 has_update（是否已查看由用户进详情后 markUpdateSeen 决定）。
 */
export async function checkAllProjectsUpdates(
  onProgress?: (projectId: number, status: 'checking' | 'done') => void
): Promise<UpdateCheckResult[]> {
  const projects = listProjectsWithTags()
  const results: UpdateCheckResult[] = []
  const workers = Math.min(5, projects.length)
  let cursor = 0

  const work = async (): Promise<void> => {
    while (true) {
      const idx = cursor++
      if (idx >= projects.length) return
      const p = projects[idx]
      onProgress?.(p.id, 'checking')
      try {
        const latest = await fetchLatestVersion(p.owner, p.repo)
        const hasUpdate = latest !== null && latest !== p.lastVersion
        updateProjectMeta(p.id, {
          lastVersion: latest,
          lastCheckedAt: new Date().toISOString(),
          ...(hasUpdate ? { hasUpdate: 1 } : {})
        })
        results.push({ id: p.id, name: p.name, latest, hasUpdate })
      } catch {
        results.push({ id: p.id, name: p.name, latest: null, hasUpdate: false })
      }
      onProgress?.(p.id, 'done')
    }
  }
  await Promise.all(Array.from({ length: workers }, () => work()))
  return results
}

let timer: ReturnType<typeof setInterval> | null = null
const AUTO_CHECK_INTERVAL_MS = 60 * 60 * 1000 // 每小时

/** 广播数据变更，让渲染层刷新「可更新」列表（复用 task:progress 的刷新语义） */
function broadcastDataChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('task:progress', { time: Date.now() })
  }
}

/** 自动检查更新定时器（应用启动时调用；开关在 设置 → 通用） */
export function startAutoUpdateChecker(): void {
  const tick = (): void => {
    if (getSetting<boolean>('autoCheckUpdate.enabled', false)) {
      void checkAllProjectsUpdates().then((results) => {
        if (results.some((r) => r.hasUpdate)) broadcastDataChanged()
      })
    }
  }
  tick()
  if (timer) clearInterval(timer)
  timer = setInterval(tick, AUTO_CHECK_INTERVAL_MS)
}

export function stopAutoUpdateChecker(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
