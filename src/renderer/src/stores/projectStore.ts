import { create } from 'zustand'
import type { ProjectWithTags, TagDimension, TagWithCount, TaskItem } from '@shared/types'

interface ProjectState {
  projects: ProjectWithTags[]
  tags: TagWithCount[]
  tasks: TaskItem[]
  loading: boolean
  load: () => Promise<void>
  addProject: (url: string) => Promise<{ project: ProjectWithTags; duplicate: boolean; metaError: string | null }>
  deleteProject: (id: number) => Promise<void>
  assignTag: (projectId: number, name: string, dimension: TagDimension) => Promise<void>
  removeTag: (projectId: number, tagId: number) => Promise<void>
}

/** 项目与标签数据（设计文档 §8）：加载自主进程，本地变更后同步刷新 */
export const useProjectStore = create<ProjectState>()((set, get) => ({
  projects: [],
  tags: [],
  tasks: [],
  loading: false,

  load: async () => {
    set({ loading: true })
    try {
      const [projects, tags, tasks] = await Promise.all([
        window.api.listProjects(),
        window.api.listTags(),
        window.api.listTasks()
      ])
      set({ projects, tags, tasks })
    } finally {
      set({ loading: false })
    }
  },

  addProject: async (url) => {
    const result = await window.api.addProject(url)
    return { project: result.project, duplicate: result.duplicate, metaError: result.metaError }
  },

  deleteProject: async (id) => {
    await window.api.deleteProject(id)
    await get().load()
  },

  assignTag: async (projectId, name, dimension) => {
    await window.api.assignTag(projectId, name, dimension)
    await get().load()
  },

  removeTag: async (projectId, tagId) => {
    await window.api.removeTag(projectId, tagId)
    await get().load()
  }
}))
