# Cookie 条件匹配功能

## 功能概述
支持基于请求 Cookie 的条件匹配，可以根据不同的 Cookie 值（如 sessionId、userId、token 等）返回不同的响应结果。

## Cookie 解析

### 自动解析
系统会自动解析 `cookie` header 中的所有 Cookie 键值对：
```
Cookie: sessionId=abc123; userId=456; token=xyz789
```
解析后：
- `sessionId` = `abc123`
- `userId` = `456`
- `token` = `xyz789`

### 支持特殊字符
- 支持值中包含 `=` 号（如 Base64 编码的值）
- 自动去除首尾空格
- 支持多个 Cookie 用 `;` 分隔

## 使用场景

### 场景1：区分不同用户会话
根据 `sessionId` 返回不同用户的数据：
- 会话A (sessionId: abc123) → 返回用户A的数据
- 会话B (sessionId: def456) → 返回用户B的数据

### 场景2：区分登录状态
根据 `token` 是否存在返回不同数据：
- 有 token → 返回登录用户数据
- 无 token → 返回游客数据

### 场景3：A/B测试
根据 `experiment_id` Cookie 返回不同的实验版本

### 场景4：多账号测试
根据 `userId` Cookie 返回不同账号的数据

## 配置方法

### 1. 在临时修改中添加条件

1. 在日志中点击"修改返回"或"临时修改"
2. 查看"当前请求 Cookies"区域，找到需要匹配的 Cookie 键名
3. 在"参数条件匹配"区域点击"+ 添加条件"
4. 选择来源为 **Cookie**
5. 输入 Cookie 键名（如 `sessionId`、`userId`）
6. 选择操作符（等于、不等于、包含、存在）
7. 输入匹配值

### 2. 支持的操作符

- **等于 (eq)**：Cookie 值完全匹配
- **不等于 (neq)**：Cookie 值不匹配
- **包含 (contains)**：Cookie 值包含指定字符串
- **存在 (exists)**：Cookie 存在（不需要填写值）

### 3. 条件逻辑

- **满足所有条件 (且)**：所有条件都必须满足
- **满足任一条件 (或)**：任意一个条件满足即可

## 示例配置

### 示例1：根据会话ID返回不同数据

**版本1**（会话abc123）：
- 来源：Cookie
- 键：`sessionId`
- 操作符：等于
- 值：`abc123`
- 返回：用户A的数据

**版本2**（会话def456）：
- 来源：Cookie
- 键：`sessionId`
- 操作符：等于
- 值：`def456`
- 返回：用户B的数据

**版本3**（兜底）：
- 无条件
- 返回：默认数据

### 示例2：根据用户ID区分

**版本1**（用户123）：
- 来源：Cookie
- 键：`userId`
- 操作符：等于
- 值：`123`
- 返回：用户123的数据

**版本2**（用户456）：
- 来源：Cookie
- 键：`userId`
- 操作符：等于
- 值：`456`
- 返回：用户456的数据

### 示例3：检查登录状态

**版本1**（已登录）：
- 来源：Cookie
- 键：`token`
- 操作符：存在
- 返回：登录用户数据

**版本2**（未登录）：
- 无条件
- 返回：游客数据

### 示例4：组合条件（Cookie + Body）

**版本1**（特定用户的特定操作）：
- 条件1：Cookie `userId` 等于 `123`
- 条件2：Body `action` 等于 `buy`
- 逻辑：满足所有条件 (且)
- 返回：用户123购买操作的数据

## Cookie 显示

### 在弹窗中查看
当从日志打开临时修改弹窗时，会显示：
- **当前请求 Body**（如果是POST请求）
- **当前请求 Headers**
- **当前请求 Cookies** ← 新增
- **参数条件匹配**

### 显示格式
Cookies 以表格形式显示：

```
┌─────────────────────┬──────────────────────────────────┐
│ Cookie 键名         │ Cookie 值                        │
├─────────────────────┼──────────────────────────────────┤
│ sessionId           │ abc123def456                     │
│ userId              │ 123456                           │
│ token               │ eyJhbGciOiJIUzI1NiIs...          │
│ ...                 │ ...                              │
└─────────────────────┴──────────────────────────────────┘
```

## 常见 Cookie 键名

### 会话相关
- `sessionId` / `SESSIONID` - 会话ID
- `JSESSIONID` - Java 会话ID
- `PHPSESSID` - PHP 会话ID
- `connect.sid` - Express 会话ID

### 用户标识
- `userId` / `uid` - 用户ID
- `username` - 用户名
- `accountId` - 账号ID

### 认证相关
- `token` / `auth_token` - 认证令牌
- `access_token` - 访问令牌
- `refresh_token` - 刷新令牌

### 其他
- `lang` / `language` - 语言偏好
- `theme` - 主题偏好
- `experiment_id` - 实验ID（A/B测试）

## 技术实现

### 后端 (lib/request-handler.js)
- 从 `req.headers.cookie` 中提取 Cookie 字符串
- 解析 Cookie 字符串为键值对对象
- 支持 `source: 'cookie'` 的条件匹配
- 使用相同的路径解析逻辑（支持简单键访问）

### 前端 (admin.js, admin.html)
- 在条件来源下拉框中添加 "Cookie" 选项
- 添加 `modalRequestCookieDiv` 显示 Cookie 信息
- 在 `editLogOverride` 中解析 Cookie
- 在 `openModal` 中显示 Cookie 表格
- 更新提示信息，添加 Cookie 示例

### Cookie 解析逻辑
```javascript
// 后端解析
const cookieParams = {};
const cookieHeader = req.headers.cookie || '';
if (cookieHeader) {
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.trim().split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const value = parts.slice(1).join('=').trim(); // 支持值中包含 =
      cookieParams[key] = value;
    }
  });
}

// 前端解析（在 editLogOverride 中）
const cookieHeader = l.headers.cookie || l.headers.Cookie || '';
if (cookieHeader) {
  requestCookies = {};
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.trim().split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const value = parts.slice(1).join('=').trim();
      requestCookies[key] = value;
    }
  });
}
```

## 测试方法

### 使用 curl 测试
```bash
# 测试会话A
curl -H "Cookie: sessionId=abc123" http://localhost:3000/api/test

# 测试会话B
curl -H "Cookie: sessionId=def456" http://localhost:3000/api/test

# 测试多个 Cookie
curl -H "Cookie: sessionId=abc123; userId=123; token=xyz" http://localhost:3000/api/test
```

### 使用 Postman 测试
1. 在 Headers 标签页添加 `Cookie` header
2. 值格式：`key1=value1; key2=value2`
3. 发送请求
4. 查看返回的不同结果

### 使用浏览器测试
1. 打开浏览器开发者工具
2. 在 Application/Storage 标签页设置 Cookie
3. 刷新页面发送请求
4. 查看返回的不同结果

## 注意事项

1. **Cookie 键名区分大小写**：`sessionId` 和 `SessionId` 是不同的键
2. **特殊字符**：Cookie 值中的特殊字符会被自动处理
3. **安全性**：Cookie 中可能包含敏感信息（如 token），请谨慎处理
4. **HttpOnly Cookie**：某些 Cookie 可能设置了 HttpOnly 标志，JavaScript 无法访问，但服务器端可以读取

## 优先级规则

当多个版本都匹配时，按以下规则选择：
1. 优先选择**有条件且匹配**的版本
2. 在匹配的版本中，按**优先级数字**降序排列（数字越大优先级越高）
3. 如果没有匹配的条件版本，使用**无条件的兜底版本**

## 完成状态
✅ 后端支持 Cookie 解析和条件匹配
✅ 前端添加 Cookie 选项
✅ 弹窗显示 Cookie 信息
✅ 更新提示信息
✅ 文档完善
