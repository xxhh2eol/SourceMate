import { Button, Space, Tag, Tooltip } from 'antd'
import { ClearOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { TAG_DIMENSIONS } from '@shared/types'
import type { TagWithCount } from '@shared/types'
import type { BubbleState } from '../hooks/useBubbleFilter'
import { tagBgColor, tagBorderColor, tagColor } from '../utils/color'

/**
 * 气泡标签筛选器（设计文档 §5 / 项目简介）
 * - 按维度分色：类型=蓝 / 技术栈=绿 / 用途=橙
 * - 气泡大小 ∝ 关联项目数（sqrt 归一化）
 * - 点击选中 → 不兼容气泡破灭（动效 + 置灰），取消选中自动恢复
 * - 展开开关已上提到 Dashboard 命令栏左侧，本组件只负责已选标签条 + 气泡云
 */

interface Props {
  tags: TagWithCount[]
  selectedTagIds: number[]
  onToggle: (tagId: number) => void
  onClear: () => void
  bubble: BubbleState
  /** 气泡标签云是否展开 */
  expanded: boolean
}

export default function BubbleFilter({
  tags,
  selectedTagIds,
  onToggle,
  onClear,
  bubble,
  expanded
}: Props): React.JSX.Element | null {
  const { t } = useTranslation()
  const selectedTags = tags.filter(
    (tag) => selectedTagIds.includes(tag.id) && tag.dimension !== 'topic'
  )

  // 未展开且无已选标签时不渲染（不占垂直空间）
  if (!expanded && selectedTags.length === 0) return null

  return (
    <div style={{ marginBottom: 12 }}>
      {selectedTags.length > 0 && (
        <Space size={4} wrap>
          {selectedTags.map((t) => (
            <Tag
              key={t.id}
              closable
              color={tagColor(t.nameCn ?? t.name)}
              onClose={() => onToggle(t.id)}
            >
              {t.nameCn ?? t.name}
            </Tag>
          ))}
          <Tooltip title={t('common.clear')}>
            <Button size="small" type="text" icon={<ClearOutlined />} onClick={onClear}>
              {t('common.clear')}
            </Button>
          </Tooltip>
        </Space>
      )}

      {expanded && (
        <div style={{ marginTop: selectedTags.length > 0 ? 8 : 0 }}>
          {TAG_DIMENSIONS.map((dim) => {
            // topic 标签仅入库暂不展示（后续统一处理），筛选气泡不显示该分组
            if (dim === 'topic') return null
            const dimTags = tags.filter((t) => t.dimension === dim)
            if (dimTags.length === 0) return null
            return (
              <div key={dim} style={{ marginBottom: 6 }}>
                <span
                  style={{
                    fontSize: 12,
                    marginRight: 8,
                    // 维度标题固定黑色；组内气泡按标签名取多彩色
                    color: 'rgba(0, 0, 0, 0.88)',
                    fontWeight: 600
                  }}
                >
                  {t(`filter.${dim}`)}
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {dimTags.map((t) => {
                    const selected = selectedTagIds.includes(t.id)
                    const burst = bubble.burstTagIds.has(t.id)
                    const size = bubble.sizeOf(t.id)
                    const label = t.nameCn ?? t.name
                    // 主色文字 + 淡色填充 + 淡边框；选中时边框加深加粗
                    const color = tagColor(label)
                    const bg = tagBgColor(label)
                    const border = selected
                      ? `1.5px solid ${color}`
                      : `1px solid ${tagBorderColor(label)}`
                    return (
                      <span
                        key={t.id}
                        className={[
                          'bubble',
                          selected ? 'bubble-selected' : '',
                          burst ? 'bubble-burst' : ''
                        ].join(' ')}
                        style={{
                          padding: `4px ${Math.max(8, Math.round(size / 3))}px`,
                          fontSize: Math.max(11, Math.round(size / 3.2)),
                          background: burst ? '#f0f0f0' : bg,
                          color: burst ? '#999' : color,
                          border
                        }}
                        onClick={() => {
                          if (!burst) onToggle(t.id)
                        }}
                      >
                        {label}
                      </span>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
