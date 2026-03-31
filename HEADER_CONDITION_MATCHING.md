# Header 条件匹配功能

## 功能概述
支持基于请求 Header 的条件匹配，可以根据不同的 Header 值（如用户token、账号ID等）返回不同的响应结果。

## 使用场景

### 场景1：区分不同账号
根据 `x-user-id` 或 `authorization` header 返回不同用户的数据：
- 用户A (x-user-id: 123) → 返回用户A的数据
- 用户B (x-user-id: 456) → 返回用户B的数据

### 场景2：区分不同环境
根据 `x-env` header 返回不同环境的数据：
- 测试环境 (x-env: test) → 返回测试数据
- 生产环境 (x-env: prod) → 返回生产数据

### 场景3：A/B测试
根据 `x-experiment-id` header 返回不同的实验版本

## 配置方法

### 1. 在临时修改中添加条件

1. 在日志中点击"修改返回"或"临时修改"
2. 在"参数条件匹配"区域点击"+ 添加条件"
3. 选择来源为 **Header**
4. 输入 Header 键名（如 `x-user-id`、`authorization`）
5. 选择操作符（等于、不等于、包含、存在）
6. 输入匹配值

### 2. 支持的操作符

- **等于 (eq)**：Header 值完全匹配
- **不等于 (neq)**：Header 值不匹配
- **包含 (contains)**：Header 值包含指定字符串
- **存在 (exists)**：Header 存在（不需要填写值）

### 3. 条件逻辑

- **满足所有条件 (且)**：所有条件都必须满足
- **满足任一条件 (或)**：任意一个条件满足即可

## 示例配置

### 示例1：根据用户ID返回不同数据

**版本1**（用户123）：
- 来源：Header
- 键：`x-user-id`
- 操作符：等于
- 值：`123`
- 返回：用户123的数据

**版本2**（用户456）：
- 来源：Header
- 键：`x-user-id`
- 操作符：等于
- 值：`456`
- 返回：用户456的数据

**版本3**（兜底）：
- 无条件
- 返回：默认数据

### 示例2：根据Token前缀区分账号

**版本1**（账号A）：
- 来源：Header
- 键：`authorization`
- 操作符：包含
- 值：`Bearer token_a`
- 返回：账号A的数据

**版本2**（账号B）：
- 来源：Header
- 键：`authorization`
- 操作符：包含
- 值：`Bearer token_b`
- 返回：账号B的数据

### 示例3：组合条件（Header + Body）

**版本1**（特定用户的特定操作）：
- 条件1：Header `x-user-id` 等于 `123`
- 条件2：Body `action` 等于 `buy`
- 逻辑：满足所有条件 (且)
- 返回：用户123购买操作的数据

## Header 键名说明

### 常用 Header 键名
- `authorization` - 认证令牌
- `x-user-id` - 用户ID
- `x-session-id` - 会话ID
- `x-device-id` - 设备ID
- `x-app-version` - 应用版本
- `x-platform` - 平台（ios/android/web）
- `user-agent` - 用户代理
- `accept-language` - 语言偏好

### 注意事项
1. Header 键名**不区分大小写**（HTTP标准）
2. 建议使用小写字母和连字符（如 `x-user-id`）
3. 自定义 Header 建议以 `x-` 开头

## 优先级规则

当多个版本都匹配时，按以下规则选择：
1. 优先选择**有条件且匹配**的版本
2. 在匹配的版本中，按**优先级数字**降序排列（数字越大优先级越高）
3. 如果没有匹配的条件版本，使用**无条件的兜底版本**

## 技术实现

### 后端 (lib/request-handler.js)
- 从 `req.headers` 中提取所有 header
- 支持 `source: 'header'` 的条件匹配
- 使用相同的路径解析逻辑（支持简单键访问）

### 前端 (admin.js, admin.html)
- 在条件来源下拉框中添加 "Header" 选项
- 更新提示信息，添加 Header 示例
- 条件保存和读取逻辑自动支持 header 来源

## 测试方法

### 使用 curl 测试
```bash
# 测试用户123
curl -H "x-user-id: 123" http://localhost:3000/api/test

# 测试用户456
curl -H "x-user-id: 456" http://localhost:3000/api/test

# 测试带 Authorization
curl -H "Authorization: Bearer token_a" http://localhost:3000/api/test
```

### 使用 Postman 测试
1. 在 Headers 标签页添加自定义 header
2. 发送请求
3. 查看返回的不同结果

## 完成状态
✅ 后端支持 header 条件匹配
✅ 前端添加 Header 选项
✅ 更新提示信息
✅ 文档完善
