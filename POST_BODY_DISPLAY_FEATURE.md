# POST请求Body显示功能

## 功能概述
在访问日志中点击"修改返回"或"临时修改"按钮时，如果是POST请求，弹窗中会显示当前请求的body内容，方便用户查看和复制。

**注意**：此功能仅在访问日志中使用，设置页面新建版本时不显示body。

## 实现细节

### 1. HTML结构 (admin.html)
在弹窗中添加了 `modalRequestBodyDiv` 区域：
- 显示"当前请求 Body"标题
- 显示格式化的JSON内容（只读）
- 提供"复制到编辑器"按钮

### 2. 前端逻辑 (admin.js)

#### 2.1 openModal() 函数
- 新增 `requestBody` 参数（最后一个参数）
- 当 `requestBody` 存在时，显示请求body区域
- 格式化JSON并显示在只读文本框中

#### 2.2 copyRequestBodyToEditor() 函数
- 将请求body复制到编辑器中
- 自动格式化JSON
- 提供用户反馈

#### 2.3 setTempOverride() 函数
- 新增 `requestBody` 参数
- 直接传递给 `openModal()`（不缓存）

#### 2.4 editLogOverride() 函数
- 从日志记录中提取POST请求的body
- 传递给 `setTempOverride()`

## 使用场景

### 场景1：从日志修改返回
1. 用户发送POST请求
2. 在日志中点击"修改返回"
3. 弹窗显示当前请求的body
4. 用户可以查看或复制body到编辑器

### 场景2：从日志创建临时修改
1. 用户发送POST请求
2. 在日志中点击"临时修改"
3. 弹窗显示当前请求的body
4. 用户可以基于请求body创建条件匹配

### 不支持的场景
- 设置页面新建版本：不显示body（因为没有关联的请求上下文）

## 技术要点

### 数据流
```
日志记录 (log.requestBody)
  ↓
editLogOverride() 提取body
  ↓
setTempOverride() 传递requestBody参数
  ↓
openModal() 显示body
```

### 无缓存设计
- 不使用全局缓存变量
- body仅在日志点击时传递
- 设置页面新建版本不涉及body显示

## 修改文件
- `admin.html` - 添加请求body显示区域
- `admin.js` - 修改相关函数支持请求body传递和显示
  - `openModal()` - 显示请求body
  - `copyRequestBodyToEditor()` - 复制功能
  - `setTempOverride()` - 接收并传递请求body
  - `editLogOverride()` - 提取请求body

## 测试步骤
1. 重启服务器
2. 发送一个POST请求（带body）
3. 在日志中找到该请求
4. 点击"修改返回"或"临时修改"
5. 验证弹窗中显示请求body
6. 点击"复制到编辑器"验证复制功能
7. 在设置页面新建版本时，验证不显示body区域

## 完成状态
✅ 所有功能已实现并测试通过

