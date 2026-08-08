import { useCallback, useMemo, useState } from 'react'
import { Table } from 'antd'
import type { TableProps } from 'antd'

/** 可拖动调整列宽的表头单元格（自定义实现，零依赖、React 19 兼容；onResizeStart 由列 onHeaderCell 注入） */
function ResizableHeaderCell(
  props: React.ThHTMLAttributes<HTMLTableCellElement> & {
    onResizeStart?: (e: React.MouseEvent) => void
  }
): React.JSX.Element {
  const { children, onResizeStart, ...rest } = props
  return (
    <th {...rest} style={{ position: 'relative', ...rest.style }}>
      {children}
      <span
        className="agm-resize-handle"
        onMouseDown={onResizeStart}
        onClick={(e) => e.stopPropagation()}
      />
    </th>
  )
}

/** 未显式设置宽度的列使用该默认宽度（拖拽起始值） */
const DEFAULT_COL_WIDTH = 160

/**
 * 支持列宽拖拽的 Table 封装（替换 antd Table 即可）：
 * - 列定义保留 width（数值）作为初始宽度；未设置 width 的列默认 160px
 * - 拖拽表头右侧把手实时调整宽度（最小 60px），宽度保存在组件内部状态
 * - 其余 props 与 antd Table 完全一致
 */
export default function ResizableTable<RecordType extends object>(
  props: TableProps<RecordType>
): React.JSX.Element {
  const [widths, setWidths] = useState<Record<string, number>>({})

  /** 拖动列宽：mousedown 后监听全局 mousemove/mouseup（拖动期间给 body 加类禁用文本选中） */
  const startResize = useCallback((key: string, startWidth: number, e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const onMove = (ev: MouseEvent): void => {
      setWidths((w) => ({ ...w, [key]: Math.max(60, startWidth + (ev.clientX - startX)) }))
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('agm-col-resizing')
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.classList.add('agm-col-resizing')
  }, [])

  // 逐列注入 width 与 onHeaderCell（key 缺失的列不参与拖拽）
  const columns = useMemo(() => {
    return (props.columns ?? []).map((col) => {
      // ColumnGroupType 无 dataIndex，先取 key，再收窄到 ColumnType 取 dataIndex
      const key =
        col.key !== undefined
          ? String(col.key)
          : 'dataIndex' in col && col.dataIndex !== undefined
            ? String(col.dataIndex)
            : ''
      if (!key) return col
      const initial = typeof col.width === 'number' ? col.width : DEFAULT_COL_WIDTH
      return {
        ...col,
        width: widths[key] ?? initial,
        onHeaderCell: () =>
          ({ onResizeStart: (e: React.MouseEvent) => startResize(key, widths[key] ?? initial, e) }) as React.HTMLAttributes<HTMLTableCellElement>
      }
    })
  }, [props.columns, widths, startResize])

  return (
    <Table<RecordType>
      {...props}
      columns={columns}
      className={props.className ? `agm-resizable-table ${props.className}` : 'agm-resizable-table'}
      components={{ header: { cell: ResizableHeaderCell }, ...props.components }}
    />
  )
}
