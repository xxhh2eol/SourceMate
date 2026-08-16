import { BrowserWindow } from 'electron'
import { enqueueTask, listDueScheduledTasks, markScheduledTaskRunning } from '../db/dao'

const SCHEDULE_CHECK_INTERVAL_MS = 30 * 1000 // 每 30 秒检查一次

let timer: ReturnType<typeof setInterval> | null = null

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('task:progress', { time: Date.now() })
  }
}

/** 检查并执行到期的未开始预约任务：入队对应分析并置 running（记录留存，不删除） */
async function tick(): Promise<void> {
  const now = new Date().toISOString()
  const due = listDueScheduledTasks(now)
  let fired = false
  for (const t of due) {
    // 预约「AI 分析」→ tag_analysis；「README 分析」→ readme_analyze
    const taskType = t.type === 'ai_analysis' ? 'tag_analysis' : 'readme_analyze'
    const task = enqueueTask(t.projectId, taskType)
    if (task) {
      markScheduledTaskRunning(t.id, task.id)
      fired = true
    }
  }
  if (fired) broadcast()
}

export function startScheduledTaskScheduler(): void {
  if (timer) return
  void tick()
  timer = setInterval(() => void tick(), SCHEDULE_CHECK_INTERVAL_MS)
}

export function stopScheduledTaskScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
