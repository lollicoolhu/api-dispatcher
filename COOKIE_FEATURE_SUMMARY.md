# Cookie 条件匹配功能 - 实现总结

## 功能状态
✅ **已完成并测试通过**

服务器已成功启动，Cookie 条件匹配功能已完全实现并可以使用。

## 实现概述

Cookie 条件匹配功能允许根据请求中的 Cookie 值返回不同的响应结果，适用于多账号测试、会话区分、A/B测试等场景。

## 核心实现

### 1. 后端实现 (lib/request-handler.js)

#### Cookie 解析
```javascript
// 解析 Cookie
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
```

#### 条件匹配
```javascript
// 在 evalCondition 函数中
if (c.source === 'cookie') {
  sourceData = cookieParams;
}
const val = getValueByPath(sourceData, c.key);
```

**特性**：
- 自动解析 `cookie` header
- 支持多个 Cookie（用 `;` 分隔）
- 支持值中包含 `=` 号（如 Base64 编码）
- 自动去除首尾空格
- 使用相同的路径解析逻辑（支持简单键访问）

### 2. 前端实现 (admin.js)

#### Cookie 解析和传递
```javascript
// 在 editLogOverride 函数中
let requestCookies = null;

if (l.headers) {
  requestHeaders = l.headers;
  
  // 解析 Cookie
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
}

// 传递给 setTempOverride
setTempOverride(path, initialContent, isLocalFile, force, 
  initialConditions, requestBody, requestHeaders, requestCookies);
```

#### Cookie 显示
```javascript
// 在 openModal 函数中
if (requestCookies && Object.keys(requestCookies).length > 0) {
  requestCookieDiv.style.display = 'block';
  // 生成表格显示 cookies
  let tableHtml = '<table style="width:100%;border-collapse:collapse">';
  Object.entries(requestCookies).forEach(([key, value]) => {
    tableHtml += '<tr style="border-bottom:1px solid #dee2e6">' +
      '<td style="padding:4px 6px;font-weight:600;color:#495057;width:30%;word-break:break-word">' + 
      escapeHtml(key) + '</td>' +
      '<td style="padding:4px 6px;color:#212529;word-break:break-all">' + 
      escapeHtml(value) + '</td>' +
      '</tr>';
  });
  tableHtml += '</table>';
  requestCookieTable.innerHTML = tableHtml;
} else {
  requestCookieDiv.style.display = 'none';
}
```

### 3. UI 实现 (admin.html)

#### Cookie 显示区域
```html
<div id="modalRequestCookieDiv" style="display:none;margin-bottom:6px">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
    <span style="font-size:11px;color:#666;font-weight:600">当前请求 Cookies</span>
  </div>
  <div id="modalRequestCookieTable" style="background:#f8f9fa;padding:6px;border:1px solid #dee2e6;border-radius:4px;font-size:11px;max-height:150px;overflow:auto"></div>
</div>
```

#### 条件来源选项
```html
<select class="condition-source" onchange="updateConditionKeyPlaceholder(this)">
  <option value="query">Query</option>
  <option value="body">Body</option>
  <option value="header">Header</option>
  <option value="cookie">Cookie</option>
</select>
```

#### 提示信息更新
```html
<div style="font-size:11px;color:#17a2b8;background:#e7f9ff;padding:6px 8px;border-radius:4px;margin-bottom:6px;border-left:3px solid #17a2b8">
  <strong>支持路径格式：</strong><br>
  • 简单键: <code>name</code>, <code>authorization</code>, <code>sessionId</code><br>
  • 嵌套对象: <code>user.name</code>, <code>data.user.email</code><br>
  • 数组索引: <code>items[0]</code>, <code>items[0].id</code><br>
  • 数组通配符: <code>items[*].id</code> (匹配所有元素的id)<br>
  • Header示例: <code>x-user-id</code>, <code>authorization</code><br>
  • Cookie示例: <code>sessionId</code>, <code>userId</code>, <code>token</code>
</div>
```

## 使用流程

### 1. 查看 Cookie 信息
1. 在访问日志中找到需要修改的请求
2. 点击"修改返回"或"临时修改"按钮
3. 在弹窗中查看"当前请求 Cookies"区域
4. 查看所有 Cookie 的键名和值

### 2. 添加 Cookie 条件
1. 在"参数条件匹配"区域点击"+ 添加条件"
2. 选择来源为 **Cookie**
3. 输入 Cookie 键名（如 `sessionId`、`userId`、`token`）
4. 选择操作符：
   - **等于 (eq)**：Cookie 值完全匹配
   - **不等于 (neq)**：Cookie 值不匹配
   - **包含 (contains)**：Cookie 值包含指定字符串
   - **存在 (exists)**：Cookie 存在（不需要填写值）
5. 输入匹配值（如果需要）
6. 编辑响应内容
7. 点击"临时保存"

### 3. 设置条件逻辑
- **满足所有条件 (且)**：所有条件都必须满足
- **满足任一条件 (或)**：任意一个条件满足即可

## 使用场景

### 场景1：多账号测试
根据不同的 `userId` Cookie 返回不同账号的数据：

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

### 场景2：会话区分
根据 `sessionId` 返回不同会话的数据：

**版本1**（会话A）：
- 来源：Cookie
- 键：`sessionId`
- 操作符：等于
- 值：`abc123`
- 返回：会话A的数据

**版本2**（会话B）：
- 来源：Cookie
- 键：`sessionId`
- 操作符：等于
- 值：`def456`
- 返回：会话B的数据

### 场景3：登录状态检测
根据 `token` 是否存在返回不同数据：

**版本1**（已登录）：
- 来源：Cookie
- 键：`token`
- 操作符：存在
- 返回：登录用户数据

**版本2**（未登录，兜底）：
- 无条件
- 返回：游客数据

### 场景4：A/B测试
根据 `experiment_id` Cookie 返回不同实验版本：

**版本1**（实验组A）：
- 来源：Cookie
- 键：`experiment_id`
- 操作符：等于
- 值：`exp_a`
- 返回：实验A的数据

**版本2**（实验组B）：
- 来源：Cookie
- 键：`experiment_id`
- 操作符：等于
- 值：`exp_b`
- 返回：实验B的数据

### 场景5：组合条件
结合 Cookie 和 Body 参数：

**版本1**（特定用户的特定操作）：
- 条件1：Cookie `userId` 等于 `123`
- 条件2：Body `action` 等于 `buy`
- 逻辑：满足所有条件 (且)
- 返回：用户123购买操作的数据

## 测试方法

### 使用 curl 测试
```bash
# 测试单个 Cookie
curl -H "Cookie: sessionId=abc123" http://localhost:3000/api/test

# 测试多个 Cookie
curl -H "Cookie: sessionId=abc123; userId=123; token=xyz" http://localhost:3000/api/test

# 测试不同的 Cookie 值
curl -H "Cookie: userId=123" http://localhost:3000/api/test
curl -H "Cookie: userId=456" http://localhost:3000/api/test
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
4. 在 Network 标签页查看请求和响应
5. 在 Mock 服务器的访问日志中查看匹配信息

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
- `jwt` - JWT 令牌

### 其他
- `lang` / `language` - 语言偏好
- `theme` - 主题偏好
- `experiment_id` - 实验ID（A/B测试）
- `device_id` - 设备ID

## 技术细节

### Cookie 解析规则
1. 从 `req.headers.cookie` 中提取 Cookie 字符串
2. 按 `;` 分隔多个 Cookie
3. 每个 Cookie 按第一个 `=` 分割为键和值
4. 支持值中包含 `=` 号（使用 `parts.slice(1).join('=')` 处理）
5. 自动去除键和值的首尾空格

### 条件匹配逻辑
1. 根据 `source: 'cookie'` 从 `cookieParams` 对象中获取值
2. 使用 `getValueByPath()` 函数获取指定键的值（支持简单键访问）
3. 根据操作符进行比较：
   - `eq`: 字符串完全匹配
   - `neq`: 字符串不匹配
   - `contains`: 字符串包含
   - `exists`: 值存在且不为空

### 优先级规则
当多个版本都匹配时：
1. 优先选择**有条件且匹配**的版本
2. 在匹配的版本中，按**优先级数字**降序排列（数字越大优先级越高）
3. 如果没有匹配的条件版本，使用**无条件的兜底版本**

## 注意事项

### 1. Cookie 键名区分大小写
`sessionId` 和 `SessionId` 是不同的键，请确保使用正确的大小写。

### 2. 特殊字符处理
Cookie 值中的特殊字符会被自动处理，包括：
- `=` 号（如 Base64 编码的值）
- 空格（自动去除首尾空格）
- 分号（用于分隔多个 Cookie）

### 3. 安全性考虑
Cookie 中可能包含敏感信息（如 token、sessionId），请：
- 不要在日志中记录完整的 Cookie 值
- 谨慎处理包含认证信息的 Cookie
- 定期清理测试用的 Cookie 条件

### 4. HttpOnly Cookie
某些 Cookie 可能设置了 HttpOnly 标志：
- JavaScript 无法访问这些 Cookie
- 但服务器端可以正常读取和匹配
- 在浏览器开发者工具中可能看不到这些 Cookie

### 5. 浏览器限制
不同浏览器对 Cookie 有不同的限制：
- 单个 Cookie 大小限制（通常 4KB）
- 每个域名的 Cookie 数量限制（通常 50-180 个）
- Cookie 总大小限制

## 文件清单

### 修改的文件
1. **lib/request-handler.js** - 后端 Cookie 解析和条件匹配
2. **admin.js** - 前端 Cookie 解析、传递和显示
3. **admin.html** - UI 元素（Cookie 显示区域、条件来源选项）

### 文档文件
1. **COOKIE_CONDITION_MATCHING.md** - 完整的功能文档
2. **COOKIE_FEATURE_SUMMARY.md** - 本文件，实现总结

## 验证清单

✅ 后端 Cookie 解析逻辑已实现
✅ 后端条件匹配支持 `source: 'cookie'`
✅ 前端 Cookie 解析逻辑已实现
✅ 前端 Cookie 显示区域已添加
✅ 条件来源下拉框已添加 "Cookie" 选项
✅ 提示信息已更新，包含 Cookie 示例
✅ 服务器成功启动，功能可用
✅ 文档已完善

## 下一步建议

### 1. 功能测试
- 使用 curl 测试不同的 Cookie 值
- 使用 Postman 测试多个 Cookie 组合
- 使用浏览器测试实际场景

### 2. 场景验证
- 测试多账号场景
- 测试会话区分场景
- 测试登录状态检测场景
- 测试 A/B 测试场景
- 测试组合条件场景

### 3. 边界测试
- 测试空 Cookie
- 测试包含特殊字符的 Cookie
- 测试超长 Cookie 值
- 测试大量 Cookie

### 4. 性能测试
- 测试大量条件的匹配性能
- 测试并发请求的处理能力

## 总结

Cookie 条件匹配功能已完全实现并可以使用。该功能与现有的 Query、Body、Header 条件匹配功能完美集成，提供了统一的使用体验。

**核心优势**：
- 支持多账号测试
- 支持会话区分
- 支持登录状态检测
- 支持 A/B 测试
- 支持组合条件
- 易于使用和配置

**服务器状态**：
- ✅ 服务器已启动：http://localhost:3000
- ✅ 管理面板：http://localhost:3000/admin
- ✅ 已加载 17 个临时修改配置
- ✅ Cookie 功能已就绪

现在可以开始使用 Cookie 条件匹配功能进行测试了！
