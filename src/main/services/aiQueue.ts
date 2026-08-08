import { BrowserWindow } from 'electron'
import {
  getLatestSummary,
  getProjectById,
  getSetting,
  getTaskById,
  listPendingTasks,
  resetStuckRunningTasks,
  updateProjectMeta,
  updateTask
} from '../db/dao'
import { hasModelConfig, translateReadme } from './ai'
import { runTagAnalysis } from './tagAnalysis'
import { syncProjectReadme } from './github'
import { msg } from '../msg'
import type { TaskRow } from '../db/dao'

/**
 * 项目任务队列（并发可配，默认 3；失败重试最多 2 次）
 * - tasks 表持久化，应用重启后续跑
 * - 幂等入队由 DAO 层保证（同项目同类型仅一条 active）
 * - 完成/失败后广播 task:progress 供渲染进程刷新
 * - 任务类型：
 *   - readme_sync：拉取多语言 README；只有英文且无中文版时，AI 完整翻译为中文
 *   - tag_analysis：README 同步 + AI 标签三环节（结构化分析 → 归一化匹配 → 候选判断）
 *     （已暂停入队：用户暂时取消 AI 标签功能，仅保留 language/topics 物化；恢复时改回 ipc.ts 入队类型）
 */

const DEFAULT_CONCURRENCY = 3
const MAX_ATTEMPTS = 3

/** 并发数：settings ai.concurrency（1-10），设置页可调；非法值回退默认 */
function getConcurrency(): number {
  const v = Number(getSetting<unknown>('ai.concurrency', DEFAULT_CONCURRENCY))
  return Number.isInteger(v) && v >= 1 && v <= 10 ? v : DEFAULT_CONCURRENCY
}

let queueRunning = false
let paused = false
let activeCount = 0

export function setQueuePaused(value: boolean): void {
  paused = value
}

export function isQueuePaused(): boolean {
  return paused
}

function broadcastTaskUpdate(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('task:progress', { time: Date.now() })
  }
}

/** 更新任务状态并立即广播（否则渲染层直到任务结束才刷新，进度/运行态显示滞后） */
function markTask(taskId: number, patch: Parameters<typeof updateTask>[1]): void {
  updateTask(taskId, patch)
  broadcastTaskUpdate()
}

export function startQueue(): void {
  if (queueRunning) return
  // 恢复上次强制退出时卡在 running 的任务（重置为 pending，队列重新续跑）
  const stuck = resetStuckRunningTasks()
  if (stuck > 0) console.log(`[aiQueue] recovered ${stuck} stuck running task(s)`)
  queueRunning = true
  void queueLoop()
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function processTask(task: TaskRow): Promise<void> {
  markTask(task.id, { status: 'running', progress: 10 })

  const project = getProjectById(task.projectId)
  if (!project) {
    markTask(task.id, { status: 'failed', error: msg('项目不存在', 'Project not found') })
    return
  }

  try {
    // 1. 拉取仓库元数据 + 多语言 README（官方中文版优先探测）——tag_analysis 也先同步，保证材料最新 + language/topics 物化
    markTask(task.id, { status: 'running', progress: 30 })
    await syncProjectReadme(project)

    if (task.type === 'tag_analysis') {
      // 2. AI 标签三环节：结构化分析 → 归一化匹配写库 → 候选判断
      markTask(task.id, { status: 'running', progress: 60 })
      const r = await runTagAnalysis(task.projectId)
      console.log(
        `[aiQueue] tag analysis #${task.projectId}: raw=${r.rawCount} written=${r.writtenCount} candidates=${r.candidateCount} merged=${r.mergedCount} rejected=${r.rejectedCount}`
      )
    } else {
      // readme_sync：只有英文且无任何中文版（真实或已有翻译）时，AI 完整翻译为中文
      const fresh = getProjectById(task.projectId)
      if (fresh && (fresh.readmeEn || fresh.readmeCache) && !fresh.readmeZh && !fresh.readmeZhAi) {
        markTask(task.id, { status: 'running', progress: 60 })
        if (hasModelConfig()) {
          const { text, tokens, model } = await translateReadme(fresh)
          updateProjectMeta(fresh.id, { readmeZhAi: text, readmeAiModel: model })
          console.log(
            `[aiQueue] translated README for #${fresh.id} (${fresh.owner}/${fresh.repo}) ${tokens} tokens via ${model}`
          )
        } else {
          // 未配置模型：跳过翻译（拉取本身不依赖 AI）
          console.log(`[aiQueue] no model configured, skip translation for #${fresh.id}`)
        }
      }
    }

    // 成功：清空 error（避免成功行残留失败原因红字）
    markTask(task.id, { status: 'done', progress: 100, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const current = getTaskById(task.id)
    if (current && current.retryCount >= MAX_ATTEMPTS - 1) {
      markTask(task.id, { status: 'failed', error: message })
    } else {
      // 重试：重新入队（幂等由 pending 状态保证），记录失败原因
      markTask(task.id, {
        status: 'pending',
        retryCount: (current?.retryCount ?? 0) + 1,
        error: message
      })
    }
  }
}

async function queueLoop(): Promise<void> {
  while (queueRunning) {
    if (!paused && activeCount < getConcurrency()) {
      const pending = listPendingTasks()
      for (const task of pending) {
        if (activeCount >= getConcurrency()) break
        activeCount++
        void processTask(task).finally(() => {
          activeCount--
          broadcastTaskUpdate()
        })
      }
    }
    await sleep(300)
  }
}

export { getLatestSummary }
