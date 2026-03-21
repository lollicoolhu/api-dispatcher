# 临时修改匹配条件日志功能

## 功能概述

在访问日志中显示临时修改命中了哪条条件，帮助用户了解为什么某个临时修改版本被选中。

## 实现内容

### 1. 后端修改 (`lib/request-handler.js`)

在选择临时修改版本时，记录匹配信息：

```javascript
const matchInfo = {
  versionName: selectedVersion.name || '未命名版本',
  hasConditions: !!(selectedVersion.conditions && selectedVersion.conditions.length > 0),
  conditions: selectedVersion.conditions || [],
  conditionLogic: selectedVersion.conditionLogic || 'and'
};
```

将匹配信息添加到响应对象中：

```javascript
const mappingResponse = {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
  body: selected.data.content,
  time: 0,
  size: selected.data.content.length,
  sourceType: 'override',
  matchInfo: selected.matchInfo // 添加匹配信息
};
```

### 2. 前端显示 (`admin.js`)

在日志详情面板中添加"临时修改匹配信息"部分，显示：

- **版本名称**: 命中的临时修改版本名称
- **匹配类型**: 
  - 条件匹配（绿色徽章）
  - 无条件/兜底（灰色徽章）
- **条件逻辑**: 且（AND）或 或（OR）
- **匹配条件列表**: 显示所有匹配的条件
  - 格式：`来源.键 操作符 值`
  - 例如：`body.[0].category 等于 2`

## 显示效果

### 有条件匹配的情况

```
临时修改匹配信息
┌─────────────┬────────────────────────────┐
│ 版本名称    │ 分类2的报告                │
│ 匹配类型    │ [条件匹配]                 │
│ 条件逻辑    │ 且                         │
│ 匹配条件    │ • body.[0].category 等于 2 │
│             │ • query.type 包含 report   │
└─────────────┴────────────────────────────┘
```

### 无条件（兜底）的情况

```
临时修改匹配信息
┌─────────────┬────────────────────────────┐
│ 版本名称    │ 默认响应                   │
│ 匹配类型    │ [无条件（兜底）]           │
└─────────────┴────────────────────────────┘
```

## 操作符显示

- `eq` → 等于
- `neq` → 不等于
- `contains` → 包含
- `exists` → 存在

## 使用场景

1. **调试条件匹配**: 查看为什么某个版本被选中
2. **验证配置**: 确认条件配置是否正确
3. **问题排查**: 当临时修改没有按预期工作时，查看实际匹配的条件
4. **学习参考**: 了解如何配置复杂的条件匹配

## 注意事项

1. 只有临时修改的请求才会显示匹配信息
2. 匹配信息显示在日志详情的"Response"部分之后
3. 条件中的键支持路径表达式（如 `[0].category`、`items[*].id`）
4. 无条件的临时修改会显示为"无条件（兜底）"

## 相关功能

- [数组和嵌套对象参数匹配](./ARRAY_MATCHING_GUIDE.md)
- [根级别数组匹配修复](./ROOT_ARRAY_FIX.md)

## 更新日期

2026-03-20
