# POST 二进制数据上传修复

## 问题描述
当前映射 POST 上传图片等二进制数据时无法正常工作。

## 根本原因
之前的实现使用字符串累积方式收集请求体：
```javascript
let reqBody = '';
req.on('data', chunk => reqBody += chunk);
```

这种方式对二进制数据（如图片、PDF等）会导致数据损坏，因为：
1. 将 Buffer 转换为字符串会丢失二进制信息
2. 字符串拼接无法正确处理非 UTF-8 编码的字节

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

### 3. 修复 Content-Length Header（本次修复）
在 `handleProxyRequest()` 函数中，确保 Content-Length 与实际 Buffer 长度一致：
```javascript
// 如果有请求体，确保 Content-Length 正确
if (reqBody && reqBody.length > 0) {
  proxyHeaders['Content-Length'] = reqBody.length;
}
```

这个修复很重要，因为：
- 原始请求的 Content-Length 可能与我们收集的 Buffer 长度不匹配
- 如果 Content-Length 不正确，目标服务器可能会拒绝请求或读取不完整的数据
- 对于 multipart/form-data（文件上传），Content-Length 必须精确匹配

### 4. 代理请求处理（已正确）
在 `handleProxyRequest()` 函数中，Buffer 类型的 reqBody 可以直接写入代理请求：
```javascript
if (reqBody) {
  proxyReq.write(reqBody);  // Buffer 可以直接写入
}
```

## 支持的数据类型
修复后支持以下所有类型的 POST 请求：
- ✅ JSON 数据（application/json）
- ✅ 表单数据（application/x-www-form-urlencoded）
- ✅ 多部分表单（multipart/form-data）
- ✅ 二进制文件（图片、PDF、ZIP 等）
- ✅ 纯文本（text/plain）

## 测试建议
1. 测试 JSON POST 请求（确保条件匹配仍然工作）
2. 测试图片上传（PNG、JPG、GIF）
3. 测试文件上传（PDF、ZIP、Excel）
4. 测试表单提交（带文件上传）
5. 测试大文件上传（验证 Content-Length 正确性）

## 修改文件
- `lib/request-handler.js`
  - `handleRequest()`: 使用 Buffer 数组收集请求体
  - `processRequest()`: 修复 JSON 解析，支持 Buffer 类型
  - `handleProxyRequest()`: 
    - 修复 Content-Length header 确保与 Buffer 长度一致
    - Buffer 直接写入代理请求
