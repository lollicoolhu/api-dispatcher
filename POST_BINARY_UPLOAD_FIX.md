# POST 二进制数据上传修复

## 问题描述
当前映射 POST 上传图片等二进制数据时无法正常工作。

## 根本原因分析

### 问题 1: 字符串累积导致二进制数据损坏
之前的实现使用字符串累积方式收集请求体：
```javascript
let reqBody = '';
req.on('data', chunk => reqBody += chunk);
```

这种方式对二进制数据（如图片、PDF等）会导致数据损坏，因为：
1. 将 Buffer 转换为字符串会丢失二进制信息
2. 字符串拼接无法正确处理非 UTF-8 编码的字节

### 问题 2: Content-Length Header 不匹配
原始实现保留了客户端的 Content-Length header，但是：
1. 我们收集的 Buffer 长度可能与原始 header 不一致
2. 对于 multipart/form-data（文件上传），Content-Length 必须精确匹配
3. 目标服务器会严格检查 Content-Length，不匹配会导致请求失败或数据截断

### 问题 3: 空 Buffer 的处理
空 Buffer 的布尔值是 `true`，导致：
1. `if (reqBody)` 检查无法区分空 Buffer 和有数据的 Buffer
2. 可能发送空的请求体但没有正确设置 Content-Length

## 解决方案

### 1. 使用 Buffer 数组收集请求体（已完成）
在 `handleRequest()` 函数中改用 Buffer 数组：
```javascript
const chunks = [];
req.on('data', chunk => chunks.push(chunk));
req.on('end', () => {
  const reqBody = Buffer.concat(chunks);
  processRequest(req, res, urlPath, queryString, filePath, fileExists, reqBody, config);
});
```

### 2. 修复 JSON 解析逻辑（已完成）
在 `processRequest()` 函数中，处理 Buffer 类型的 reqBody：
```javascript
let bodyParams = {};
if (reqBody && reqBody.length > 0) {
  try {
    // reqBody 是 Buffer，需要转换为字符串再解析 JSON
    const bodyStr = Buffer.isBuffer(reqBody) ? reqBody.toString('utf8') : reqBody;
    bodyParams = JSON.parse(bodyStr);
  } catch {
    // 如果不是有效的 JSON，保持 bodyParams 为空对象
  }
}
```

### 3. 完全重建 Content-Length Header（本次修复）
在 `handleProxyRequest()` 函数中：

**跳过原始 Content-Length header：**
```javascript
const skipHeaders = ['if-none-match', 'if-modified-since', 'connection', 'keep-alive', 'proxy-connection', 'content-length'];
```

**基于实际 Buffer 长度重新设置：**
```javascript
// 设置正确的 Content-Length（基于实际收集的 Buffer 长度）
if (reqBody && reqBody.length > 0) {
  proxyHeaders['Content-Length'] = reqBody.length;
} else if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
  // 对于 POST/PUT/PATCH 请求，如果没有 body，显式设置 Content-Length 为 0
  proxyHeaders['Content-Length'] = 0;
}
```

这个修复很重要，因为：
- 完全移除原始 Content-Length，避免不匹配
- 基于实际收集的 Buffer 长度重新计算
- 对于空请求体，显式设置为 0
- 确保目标服务器能正确读取完整的请求体

### 4. 修复请求体发送逻辑（本次修复）
```javascript
// 发送请求体
if (reqBody && reqBody.length > 0) {
  proxyReq.write(reqBody);
}
proxyReq.end();
```

只在 Buffer 有实际数据时才发送，避免发送空 Buffer。

## 支持的数据类型
修复后支持以下所有类型的 POST 请求：
- ✅ JSON 数据（application/json）
- ✅ 表单数据（application/x-www-form-urlencoded）
- ✅ 多部分表单（multipart/form-data）
- ✅ 二进制文件（图片、PDF、ZIP 等）
- ✅ 纯文本（text/plain）
- ✅ 空请求体的 POST 请求

## 测试建议
1. 测试 JSON POST 请求（确保条件匹配仍然工作）
2. 测试图片上传（PNG、JPG、GIF）
3. 测试文件上传（PDF、ZIP、Excel）
4. 测试表单提交（带文件上传）
5. 测试大文件上传（验证 Content-Length 正确性）
6. 测试空 body 的 POST 请求

## 修改文件
- `lib/request-handler.js`
  - `handleRequest()`: 使用 Buffer 数组收集请求体
  - `processRequest()`: 修复 JSON 解析，支持 Buffer 类型
  - `handleProxyRequest()`: 
    - 跳过原始 Content-Length header
    - 基于实际 Buffer 长度重新设置 Content-Length
    - 修复空 Buffer 的处理逻辑
    - 只在有数据时才发送请求体
