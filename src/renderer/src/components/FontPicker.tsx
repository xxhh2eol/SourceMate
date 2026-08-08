import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Select, Segmented, Space, Tooltip, message } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '../stores/settingsStore'
import type { FontEntry } from '../utils/fonts'

type FontCategory = 'all' | 'cjk' | 'latin' | 'mono'

/** 「系统默认」哨兵值（null 不可直接作 antd option value，需映射） */
const SYSTEM_VALUE = '__system__'

interface Props {
  value: string | null
  onChange: (family: string | null) => void
}

/**
 * 字体选择器（设置 → 通用设置）
 * - 懒加载系统字体列表（Local Font Access API，会话内缓存），带手动刷新按钮
 * - 分类筛选：全部 / 中文 / 英文 / 等宽（分类不互斥，启发式判断）
 * - 选项以本机字体实时预览渲染字体名
 * - 首项「系统默认」= 不设置字体，走系统字体栈
 */
export default function FontPicker({ value, onChange }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const fontList = useSettingsStore((s) => s.fontList)
  const fontListLoading = useSettingsStore((s) => s.fontListLoading)
  const refreshFontList = useSettingsStore((s) => s.refreshFontList)
  const [category, setCategory] = useState<FontCategory>('all')

  // 懒加载：首次打开选择器才枚举系统字体（缓存于 store，本会话内不再重复枚举）
  useEffect(() => {
    if (fontList === null && !fontListLoading) {
      refreshFontList().catch(() => message.error(t('settings.fontListFailed')))
    }
  }, [fontList, fontListLoading, refreshFontList, t])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      await refreshFontList()
    } catch {
      message.error(t('settings.fontListFailed'))
    }
  }, [refreshFontList, t])

  const options = useMemo(() => {
    const list: FontEntry[] = fontList ?? []
    const filtered = list.filter((f) => {
      if (category === 'cjk') return f.isCJK
      if (category === 'latin') return !f.isCJK
      if (category === 'mono') return f.isMono
      return true
    })
    return [
      { value: SYSTEM_VALUE, label: t('settings.fontSystem') },
      ...filtered.map((f) => ({ value: f.family, label: f.family }))
    ]
  }, [fontList, category, t])

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Space size={8}>
        <Segmented
          size="small"
          value={category}
          onChange={(v) => setCategory(v as FontCategory)}
          options={[
            { label: t('settings.fontAll'), value: 'all' },
            { label: t('settings.fontCJK'), value: 'cjk' },
            { label: t('settings.fontLatin'), value: 'latin' },
            { label: t('settings.fontMono'), value: 'mono' }
          ]}
        />
        <Tooltip title={t('settings.fontRefreshTip')}>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => void refresh()}
            loading={fontListLoading}
          />
        </Tooltip>
      </Space>
      <Select
        style={{ width: 320 }}
        showSearch
        placeholder={t('settings.fontPlaceholder')}
        value={value ?? SYSTEM_VALUE}
        onChange={(v) => onChange(v === SYSTEM_VALUE ? null : (v as string))}
        options={options}
        loading={fontListLoading}
        popupMatchSelectWidth={false}
        notFoundContent={t('common.none')}
        optionRender={(option) => {
          // 选项用本机字体渲染名称做实时预览；「系统默认」项保持默认样式
          if (option.value === SYSTEM_VALUE) return <span>{option.label}</span>
          return <span style={{ fontFamily: `"${option.value}"` }}>{option.label}</span>
        }}
      />
    </Space>
  )
}
