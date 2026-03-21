# 通配符条件匹配逻辑更新

## 更新概述

优化了通配符 `[*]` 在条件匹配中的行为，使其更符合直觉和实际使用场景。

## 问题场景

### 之前的行为

当使用通配符路径 `[*].category` 时：
- 返回值：`[2, 1, 3]`（所有元素的 category 组成的数组）
- 使用 `eq` 操作符：比较整个数组的 JSON 字符串
- 问题：无法方便地检查"数组中是否包含某个值"

### 实际需求

用户希望能够：
1. 检查数组中是否有元素的 category 等于某个值
2. 组合多个条件来匹配包含多个特定值的数组

例如：
```json
[
  { "category": 2, "param": 0.05 },
  { "category": 1, "param": 5 }
]
```

希望能配置：
- 条件1: `[*].category = 1`
- 条件2: `[*].category = 2`
- 逻辑: AND

来匹配同时包含 category=1 和 category=2 的数组。

## 新的行为

### 通配符路径 + eq 操作符

当路径包含 `[*]` 且使用 `eq` 操作符时：
- **检查数组中是否有任意元素等于指定值**
- 支持数字和字符串的智能比较

### 示例

**请求体:**
```json
[
  { "category": 2 },
  { "category": 1 }
]
```

**条件配置:**

| 条件 | 结果 | 说明 |
|------|------|------|
| `[*].category = 1` | ✓ 匹配 | 数组中有元素的 category 等于 1 |
| `[*].category = 2` | ✓ 匹配 | 数组中有元素的 category 等于 2 |
| `[*].category = 3` | ✗ 不匹配 | 数组中没有元素的 category 等于 3 |
| `[0].category = 2` | ✓ 匹配 | 第一个元素的 category 等于 2 |
| `[0].category = 1` | ✗ 不匹配 | 第一个元素的 category 不等于 1 |

**组合条件（AND 逻辑）:**

| 条件组合 | 结果 | 说明 |
|----------|------|------|
| `[*].category = 1` AND `[*].category = 2` | ✓ 匹配 | 数组同时包含 category=1 和 category=2 |
| `[0].category = 2` | ✓ 匹配 | 第一个元素的 category 等于 2 |

## 实现细节

### 代码修改 (`lib/request-handler.js`)

```javascript
if (c.op === 'eq') {
  // 如果路径包含通配符 [*]，检查数组中是否有元素等于指定值
  if (c.key.includes('[*]')) {
    // 尝试将 c.value 转换为数字或保持字符串
    let compareValue = c.value;
    const numValue = Number(c.value);
    if (!isNaN(numValue) && String(numValue) === String(c.value)) {
      compareValue = numValue;
    }
    return val.some(item => item === compareValue || String(item) === String(compareValue));
  }
  // 否则比较整个数组的 JSON 字符串
  // ...
}
```

### 类型转换

- 自动检测数字类型：`"2"` 会被转换为 `2` 进行比较
- 同时支持严格相等和字符串相等：`item === compareValue || String(item) === String(compareValue)`

## 使用场景

### 场景1: 匹配包含特定值的数组

**需求**: 当数组中有任意元素的 status 为 "active" 时返回特定响应

**配置**:
- 键: `[*].status`
- 操作: `eq`
- 值: `active`

### 场景2: 匹配同时包含多个值的数组

**需求**: 当数组同时包含 category=1 和 category=2 时返回特定响应

**配置**:
- 条件1: 键 `[*].category`, 操作 `eq`, 值 `1`
- 条件2: 键 `[*].category`, 操作 `eq`, 值 `2`
- 逻辑: `AND`

### 场景3: 精确匹配特定位置

**需求**: 只有第一个元素的 category 为 2 时返回特定响应

**配置**:
- 键: `[0].category`
- 操作: `eq`
- 值: `2`

## 向后兼容性

- 不使用通配符的路径行为不变
- 索引访问（如 `[0]`、`[1]`）行为不变
- 其他操作符（`contains`、`exists`、`neq`）行为不变

## 测试结果

所有 35 个测试用例通过：
- 19 个路径解析测试
- 9 个根级别数组测试
- 7 个条件匹配逻辑测试

```
✓ 通配符 eq: [*].category = 1
✓ 通配符 eq: [*].category = 2
✓ 通配符 eq: [*].category = 3
✓ 索引 eq: [0].category = 2
✓ 索引 eq: [0].category = 1
✓ 组合条件: [*].category = 1 AND [*].category = 2
✓ 组合条件: [0].category = 2
```

## 更新日期

2026-03-20
