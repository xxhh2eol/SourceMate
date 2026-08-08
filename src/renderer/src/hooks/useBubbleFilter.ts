import { useMemo } from 'react'
import type { ProjectWithTags, TagWithCount } from '@shared/types'

/**
 * 气泡筛选算法（设计文档 §5）
 * - 倒排索引 tag → projectIds
 * - 已选集合求交集 → 未选标签与交集非空则存活，否则破灭
 * - 气泡尺寸与项目数成正比，sqrt 压缩避免单标签独大
 */

export interface BubbleState {
  /** 当前筛选命中的项目 */
  filteredProjects: ProjectWithTags[]
  /** 存活标签（可点击） */
  aliveTagIds: Set<number>
  /** 破灭标签（不可点击） */
  burstTagIds: Set<number>
  /** 气泡尺寸（px，仅对存活/已选有意义） */
  sizeOf: (tagId: number) => number
}

/** 气泡尺寸固定为紧凑档：[最小, 最大] = [10, 20]px */
const BUBBLE_MIN_SIZE = 10
const BUBBLE_MAX_SIZE = 20

export function useBubbleFilter(
  projects: ProjectWithTags[],
  tags: TagWithCount[],
  selectedTagIds: number[]
): BubbleState {
  return useMemo(() => {
    // 倒排索引：tagId → projectIds
    const tagToProjects = new Map<number, Set<number>>()
    for (const p of projects) {
      for (const t of p.tags) {
        let set = tagToProjects.get(t.id)
        if (!set) {
          set = new Set()
          tagToProjects.set(t.id, set)
        }
        set.add(p.id)
      }
    }

    // 已选组合求交集
    let activeIds: Set<number> | null = null
    if (selectedTagIds.length > 0) {
      activeIds = new Set(projects.map((p) => p.id))
      for (const tagId of selectedTagIds) {
        const set = tagToProjects.get(tagId)
        if (!set) {
          activeIds = new Set()
          break
        }
        activeIds = new Set([...activeIds].filter((id) => set.has(id)))
      }
    }

    const aliveTagIds = new Set<number>()
    const burstTagIds = new Set<number>()
    for (const tag of tags) {
      if (selectedTagIds.includes(tag.id)) {
        aliveTagIds.add(tag.id)
        continue
      }
      if (activeIds === null) {
        aliveTagIds.add(tag.id) // 未筛选时全部存活
        continue
      }
      const set = tagToProjects.get(tag.id)
      const hasMatch = set && [...set].some((id) => activeIds!.has(id))
      if (hasMatch) aliveTagIds.add(tag.id)
      else burstTagIds.add(tag.id)
    }

    const filteredProjects =
      activeIds === null ? projects : projects.filter((p) => activeIds.has(p.id))

    // 尺寸：紧凑固定范围 + sqrt 归一化
    const maxCount = Math.max(1, ...tags.map((t) => t.count))
    const sizeOf = (tagId: number): number => {
      const count = tagToProjects.get(tagId)?.size ?? 0
      return Math.round(
        BUBBLE_MIN_SIZE + (BUBBLE_MAX_SIZE - BUBBLE_MIN_SIZE) * Math.sqrt(count / maxCount)
      )
    }

    return { filteredProjects, aliveTagIds, burstTagIds, sizeOf }
  }, [projects, tags, selectedTagIds])
}
