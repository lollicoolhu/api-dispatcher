# 数组和嵌套对象参数匹配指南

## 功能概述

临时修改功能现在支持使用路径表达式来匹配 POST 请求中的数组和嵌套对象参数。

## 支持的路径格式

### 1. 简单键
```
name
age
status
```

### 2. 根级别数组访问
```
[0]              # 访问根数组的第一个元素
[0].category     # 访问根数组第一个元素的 category 属性
[1].name         # 访问根数组第二个元素的 name 属性
[*].id           # 获取根数组所有元素的 id（返回数组）
```

### 3. 嵌套对象（点号路径）
```
user.name
user.email
data.user.address.city
```

### 4. 数组索引
```
items[0]           # 访问第一个元素
items[0].id        # 访问第一个元素的 id 属性
items[1].name      # 访问第二个元素的 name 属性
tags[2]            # 访问数组的第三个元素
```

### 5. 数组通配符
```
items[*].id        # 获取所有元素的 id（返回数组）
items[*].name      # 获取所有元素的 name（返回数组）
users[*].email     # 获取所有用户的 email
```

### 6. 复杂嵌套
```
data.items[0].details.price
nested.array[1].values[2]
response.data.list[*].status
```

## 使用示例

### 示例 1: 匹配根级别数组

**POST 请求 Body:**
```json
[
  { "category": 2, "name": "Report A" },
  { "category": 1, "name": "Report B" }
]
```

**条件配置:**
- 来源: `body`
- 键: `[0].category`
- 操作: `eq` (等于)
- 值: `2`

说明: 当请求体本身就是数组时，使用 `[0]` 访问第一个元素

### 示例 2: 匹配数组中的特定元素

**POST 请求 Body:**
```json
{
  "items": [
    { "id": 1, "name": "Apple" },
    { "id": 2, "name": "Banana" },
    { "id": 3, "name": "Orange" }
  ]
}
```

**条件配置:**
- 来源: `body`
- 键: `items[0].name`
- 操作: `eq` (等于)
- 值: `Apple`

### 示例 3: 使用通配符匹配数组

**POST 请求 Body:**
```json
{
  "products": [
    { "id": 1, "status": "active" },
    { "id": 2, "status": "active" },
    { "id": 3, "status": "inactive" }
  ]
}
```

**条件配置:**
- 来源: `body`
- 键: `products[*].status`
- 操作: `eq` (等于)
- 值: `active`

说明: 这会检查数组中是否有任意元素的 status 等于 "active"

### 示例 3.1: 组合通配符条件匹配多个值

**POST 请求 Body:**
```json
[
  { "category": 2, "param": 0.05 },
  { "category": 1, "param": 5 }
]
```

**条件配置（使用 AND 逻辑）:**
- 条件1: 来源 `body`, 键 `[*].category`, 操作 `eq`, 值 `1`
- 条件2: 来源 `body`, 键 `[*].category`, 操作 `eq`, 值 `2`

说明: 这会匹配同时包含 category=1 和 category=2 的数组，无论顺序如何

### 示例 4: 嵌套对象匹配

**POST 请求 Body:**
```json
{
  "user": {
    "profile": {
      "name": "John",
      "age": 30,
      "address": {
        "city": "Beijing"
      }
    }
  }
}
```

**条件配置:**
- 来源: `body`
- 键: `user.profile.address.city`
- 操作: `eq` (等于)
- 值: `Beijing`

### 示例 5: 复杂数组嵌套

**POST 请求 Body:**
```json
{
  "data": {
    "orders": [
      {
        "id": 1,
        "items": [
          { "productId": 101, "quantity": 2 },
          { "productId": 102, "quantity": 1 }
        ]
      },
      {
        "id": 2,
        "items": [
          { "productId": 103, "quantity": 3 }
        ]
      }
    ]
  }
}
```

**条件配置:**
- 来源: `body`
- 键: `data.orders[0].items[0].productId`
- 操作: `eq` (等于)
- 值: `101`

## 操作符说明

### 对于普通值
- `eq` (等于): 精确匹配
- `neq` (不等于): 不匹配
- `contains` (包含): 值中包含指定字符串
- `exists` (存在): 检查字段是否存在且不为空

### 对于数组值
- `eq` (等于): 比较整个数组的 JSON 字符串
- `contains` (包含): 检查数组中是否有元素包含指定值
- `exists` (存在): 检查数组是否存在且不为空

### 对于通配符结果（重要！）
当使用 `[*]` 通配符路径时（如 `[*].category`），返回的是一个数组：

- `eq` (等于): **检查数组中是否有任意元素等于指定值**
  - 例如：`[*].category = 2` 会检查数组中是否有元素的 category 等于 2
  - 支持组合条件：`[*].category = 1` AND `[*].category = 2` 可以匹配同时包含 category=1 和 category=2 的数组
- `neq` (不等于): 检查数组中是否所有元素都不等于指定值
- `contains` (包含): 检查数组中是否有元素包含指定值

### 通配符 vs 索引的区别

**使用索引** `[0].category = 2`:
- 只检查第一个元素的 category 是否等于 2
- 更精确，但只能匹配特定位置

**使用通配符** `[*].category = 2`:
- 检查数组中任意元素的 category 是否等于 2
- 更灵活，可以匹配任意位置

## 配置界面

在管理界面中配置临时修改时：

1. 点击"临时修改"或"修改返回"按钮
2. 在弹出的窗口中，展开"参数条件匹配"部分
3. 点击"+ 添加条件"
4. 在"键"输入框中输入路径表达式（如 `items[0].id` 或 `user.name`）
5. 选择操作符和输入匹配值
6. 保存配置

## 注意事项

1. **路径区分大小写**: `user.Name` 和 `user.name` 是不同的
2. **数组索引从 0 开始**: `items[0]` 是第一个元素
3. **通配符返回数组**: `items[*].id` 返回的是所有 id 组成的数组
4. **不存在的路径返回 undefined**: 访问不存在的路径会返回 undefined
5. **类型转换**: 比较时会将值转换为字符串（除了 exists 操作）
6. **根级别数组**: 当请求体本身是数组时，使用 `[0]` 而不是 `item[0]` 来访问元素

## 调试技巧

1. 使用浏览器开发者工具查看实际的请求 Body
2. 在"访问日志"中查看请求详情
3. 先使用简单路径测试，再逐步增加复杂度
4. 使用 `exists` 操作符验证路径是否正确

## 常见问题

**Q: 请求体是数组时如何匹配？**
A: 当请求体本身是数组（如 `[{...}, {...}]`）时，使用 `[0].property` 来访问第一个元素的属性，而不是 `item[0].property`。

**Q: 如何匹配数组中包含多个特定值？**
A: 使用通配符 `[*]` 配合 AND 逻辑。例如：
- 条件1: `[*].category = 1`
- 条件2: `[*].category = 2`
- 逻辑: AND
这会匹配同时包含 category=1 和 category=2 的数组。

**Q: 通配符 `[*].category = 2` 和索引 `[0].category = 2` 有什么区别？**
A: 
- `[*].category = 2`: 检查数组中**任意元素**的 category 是否等于 2
- `[0].category = 2`: 只检查**第一个元素**的 category 是否等于 2

**Q: 如何匹配数组长度？**
A: 使用通配符获取整个数组，然后用 `exists` 检查是否存在，或者在未来版本中会添加 `array_length` 操作符。

**Q: 可以使用正则表达式吗？**
A: 当前版本不支持正则表达式，但可以使用 `contains` 操作符进行部分匹配。

**Q: 通配符可以嵌套使用吗？**
A: 理论上支持，但建议保持路径简单以提高可读性和性能。

## 更新日志

- 2026-03-20: 添加数组和嵌套对象路径支持
- 支持点号路径、数组索引、通配符
- 向后兼容原有的简单键匹配
