# Cookie Tab 标签自定义功能

## 功能概述

Cookie Tab 分组功能现在支持自定义标签，用户可以为每个 Cookie 条件分组设置有意义的名称，而不是显示完整的 Cookie 值。

## 默认显示规则

当没有设置自定义标签时，Tab 标签会自动使用以下规则：

1. **短值（≤4个字符）**：显示完整的 `key=value`
   - 例如：`uid=1234`

2. **长值（>4个字符）**：显示 `key=...后四位`
   - 例如：`token=...a8f3`（完整值为 `token=abc123def456a8f3`）

## 自定义标签

### 设置方法

1. **双击 Tab**：在临时修改列表中，双击任意 Cookie 条件的 Tab
2. **输入标签**：在弹出的对话框中输入自定义标签
3. **保存**：点击"确定"保存，或点击"取消"放弃修改

### 清除自定义标签

在编辑对话框中：
- 清空输入框并点击"确定"：恢复使用默认显示规则
- 点击"取消"：保持当前设置不变

## 使用示例

### 示例 1：用户账号标识

**Cookie 值**：`userId=17700001818`

**默认显示**：`userId=...1818`

**自定义标签**：`测试账号A`

### 示例 2：Token 标识

**Cookie 值**：`authToken=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9`

**默认显示**：`authToken=...XVCJ9`

**自定义标签**：`管理员Token`

### 示例 3：短值

**Cookie 值**：`env=prod`

**默认显示**：`env=prod`（因为值≤4个字符）

**自定义标签**：`生产环境`

## 数据持久化

- 自定义标签存储在浏览器的 `localStorage` 中
- 键名：`cookieTabLabels`
- 格式：`{ "key=value": "自定义标签", ... }`
- 数据在同一浏览器中持久保存，不会因为刷新页面而丢失

## 技术实现

### 相关函数

1. **loadCookieTabLabels()**
   - 从 localStorage 加载自定义标签
   - 在页面初始化时自动调用

2. **saveCookieTabLabels()**
   - 保存自定义标签到 localStorage
   - 在设置或删除标签时自动调用

3. **getCookieTabLabel(key, value)**
   - 获取 Tab 显示标签
   - 优先返回自定义标签，否则返回默认格式

4. **setCookieTabLabel(key, value, customLabel)**
   - 设置或删除自定义标签
   - 自动保存并重新渲染

5. **editCookieTabLabel(key, value)**
   - 打开编辑对话框
   - 处理用户输入并更新标签

### 渲染逻辑

在 `renderOverrides()` 函数中：

```javascript
// 获取显示标签（自定义标签或默认后四位）
let displayLabel = group.label;
let canEdit = false;
let cookieKey = '', cookieValue = '';
if (key.startsWith('cookie:')) {
  const match = key.match(/^cookie:(.+?)=(.+)$/);
  if (match) {
    [, cookieKey, cookieValue] = match;
    displayLabel = getCookieTabLabel(cookieKey, cookieValue);
    canEdit = true;
  }
}

// 添加双击编辑功能
const editHandler = canEdit ? 
  'ondblclick="event.stopPropagation(); editCookieTabLabel(...)" title="双击编辑标签"' : '';
```

## 注意事项

1. **唯一性**：自定义标签基于完整的 `key=value` 存储，不同的 Cookie 值可以有不同的标签
2. **浏览器限制**：标签数据存储在 localStorage 中，受浏览器存储限制
3. **不影响功能**：自定义标签仅用于显示，不影响 Cookie 条件匹配逻辑
4. **Tab 提示**：鼠标悬停在 Cookie Tab 上会显示"双击编辑标签"提示

## 用户体验优化

- **直观操作**：双击即可编辑，无需额外按钮
- **智能默认**：自动截取后四位，避免显示过长的值
- **灵活定制**：支持任意自定义标签，满足不同场景需求
- **持久保存**：标签设置在浏览器中持久保存，无需重复设置
