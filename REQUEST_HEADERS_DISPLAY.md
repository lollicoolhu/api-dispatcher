# 请求 Headers 显示功能

## 功能概述
在日志详情中点击"修改返回"或"临时修改"时，弹窗会显示当前请求的所有 Headers 信息，方便查看和手动添加 Header 条件。

## 功能特点

### 1. 自动显示
- 当从日志中打开临时修改弹窗时，自动显示当前请求的所有 Headers
- 以表格形式展示，清晰易读
- 包含所有 HTTP Headers（包括自定义 Headers）

### 2. 默认不添加条件
- **重要**：Headers 仅用于展示，默认不会自动添加任何 Header 条件
- 用户需要手动点击"+ 添加条件"并选择需要的 Header 键名
- 这样可以避免不必要的条件污染

### 3. 显示位置
Headers 显示在以下位置：
- 优先级
- 备注/延迟
- 当前请求 Body（如果是POST请求）
- **当前请求 Headers** ← 新增
- 参数条件匹配
- 编辑器

## 使用场景

### 场景1：查看用户认证信息
查看 `authorization` 或 `x-user-id` header，了解当前请求的用户身份

### 场景2：查看设备信息
查看 `user-agent`、`x-device-id` 等 header，了解请求来源

### 场景3：查看自定义 Headers
查看应用自定义的 Headers（如 `x-app-version`、`x-platform` 等）

### 场景4：手动添加 Header 条件
1. 查看 Headers 列表
2. 找到需要匹配的 Header 键名
3. 点击"+ 添加条件"
4. 选择来源为 "Header"
5. 输入键名（从显示的列表中复制）
6. 输入匹配值

## 显示格式

Headers 以表格形式显示：

```
┌─────────────────────┬──────────────────────────────────┐
│ Header 键名         │ Header 值                        │
├─────────────────────┼──────────────────────────────────┤
│ authorization       │ Bearer eyJhbGciOiJIUzI1NiIs...  │
│ x-user-id           │ 123456                           │
│ user-agent          │ Mozilla/5.0 (Windows NT 10.0...) │
│ accept-language     │ zh-CN,zh;q=0.9,en;q=0.8          │
│ ...                 │ ...                              │
└─────────────────────┴──────────────────────────────────┘
```

## 常见 Headers 说明

### 认证相关
- `authorization` - 认证令牌（通常是 Bearer token）
- `cookie` - Cookie 信息

### 用户标识
- `x-user-id` - 用户ID（自定义）
- `x-session-id` - 会话ID（自定义）
- `x-device-id` - 设备ID（自定义）

### 客户端信息
- `user-agent` - 用户代理（浏览器/设备信息）
- `accept-language` - 语言偏好
- `accept` - 接受的内容类型

### 应用信息
- `x-app-version` - 应用版本（自定义）
- `x-platform` - 平台（ios/android/web）（自定义）
- `x-build-number` - 构建号（自定义）

### 请求信息
- `content-type` - 请求内容类型
- `content-length` - 请求内容长度
- `referer` - 来源页面
- `origin` - 请求源

## 技术实现

### 前端 (admin.html)
- 添加 `modalRequestHeaderDiv` 区域
- 使用表格布局显示 Headers
- 样式与请求 Body 保持一致

### 前端 (admin.js)
- `openModal()` 函数添加 `requestHeaders` 参数
- 生成 HTML 表格显示所有 Headers
- `editLogOverride()` 函数提取日志中的 headers
- `setTempOverride()` 函数传递 headers 到 openModal

### 样式 (admin.css)
- 将 `modalRequestHeaderDiv` 添加到 grid 布局
- 确保在版本布局中正确显示

## 注意事项

1. **不自动添加条件**：Headers 仅用于展示，不会自动添加到条件列表
2. **大小写不敏感**：HTTP Headers 键名不区分大小写
3. **敏感信息**：注意 Headers 中可能包含敏感信息（如 token），请谨慎处理
4. **长度限制**：某些 Headers 值可能很长（如 user-agent），表格会自动换行

## 完成状态
✅ HTML 添加 Headers 显示区域
✅ CSS 添加到 grid 布局
✅ openModal 支持 requestHeaders 参数
✅ editLogOverride 提取 headers
✅ setTempOverride 传递 headers
✅ 表格样式优化
✅ 文档完善
