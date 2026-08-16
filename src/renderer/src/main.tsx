import React from 'react'
import ReactDOM from 'react-dom/client'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import App from './App'
import './assets/main.css'

// 日期组件统一中文（antd DatePicker 的日历面板跟随 dayjs 语言）
dayjs.locale('zh-cn')

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
