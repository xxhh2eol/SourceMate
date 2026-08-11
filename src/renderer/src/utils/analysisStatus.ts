import type { TaskItem } from '@shared/types'

/** AI 分析状态（Dashboard 筛选与 AI 分析页共用同一套口径） */
export type AnalysisStatus = 'analyzing' | 'analyzed' | 'failed' | 'none'

export function analysisStatusOf(
  p: { id: number; cnSummary: string | null },
  tasks: TaskItem[]
): AnalysisStatus {
  const ts = tasks.filter((x) => x.projectId === p.id && x.type === 'tag_analysis')
  if (ts.some((x) => x.status === 'pending' || x.status === 'running')) return 'analyzing'
  if (ts.some((x) => x.status === 'done') || !!p.cnSummary) return 'analyzed'
  if (ts.some((x) => x.status === 'failed')) return 'failed'
  return 'none'
}
