import { create } from 'zustand'

/**
 * Dashboard 筛选状态（气泡选中 + 搜索关键词）
 * 独立 store 以便侧栏「我的分类」互斥切换时显式清空（点击「全部」= 恢复默认列表）
 */
interface FilterState {
  keyword: string
  selectedTagIds: number[]
  setKeyword: (keyword: string) => void
  toggleTag: (tagId: number) => void
  clearFilters: () => void
}

export const useFilterStore = create<FilterState>()((set, get) => ({
  keyword: '',
  selectedTagIds: [],
  setKeyword: (keyword) => set({ keyword }),
  toggleTag: (tagId) =>
    set({
      selectedTagIds: get().selectedTagIds.includes(tagId)
        ? get().selectedTagIds.filter((id) => id !== tagId)
        : [...get().selectedTagIds, tagId]
    }),
  clearFilters: () => set({ keyword: '', selectedTagIds: [] })
}))
