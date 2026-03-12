# Mock Server 模块说明

## 目录结构

```
lib/
├── config.js           # 配置和数据管理
├── utils.js            # 工具函数
├── logger.js           # 日志管理
├── admin-routes.js     # 管理接口路由
├── request-handler.js  # 请求处理逻辑
├── server-core.js      # 服务器核心逻辑
└── README.md          # 本文件
```

## 模块说明

### config.js
负责配置数据的加载、保存和管理。

**导出方法：**
- `loadData()` - 从文件加载配置
- `saveData()` - 保存配置到文件
- `getConfig()` - 获取当前配置
- `setConfig(config)` - 更新配置

**管理的配置：**
- `tempOverrides` - 临时覆盖
- `urlMappings` - URL映射
- `folderMappings` - 文件夹映射
- `localFolders` - 本地文件夹列表
- `globalServers` - 全局服务器列表
- `cookieRewrite` - Cookie重写开关

### utils.js
提供通用工具函数。

**导出方法：**
- `rewriteSetCookie(cookies, reqHost, cookieRewrite)` - 重写 Set-Cookie header
- `getAllFiles(dir, base)` - 递归获取所有 JSON 文件
- `getServerAddresses(port, httpsPort)` - 获取服务器地址列表（包含 HTTP 和 HTTPS）

### logger.js
管理访问日志。

**导出方法：**
- `addLog(req, found, mappingResponse, reqBody, proxyReqHeaders, matchedFolder)` - 添加日志
- `getLogs()` - 获取所有日志
- `clearLogs()` - 清空日志

### admin-routes.js
处理所有管理接口路由。

**导出方法：**
- `handleAdminRoutes(req, res, config, saveData, httpPort, httpsPort)` - 处理管理路由，返回 true 表示已处理

**处理的路由：**
- 静态文件：`/admin`, `/admin.css`, `/admin.js`
- 日志：`/admin/logs`
- 文件操作：`/admin/files`, `/admin/file/save`, `/admin/file/create`, `/admin/file/delete`
- 配置管理：`/admin/overrides`, `/admin/mappings`, `/admin/folder-mappings`, `/admin/local-folders`, `/admin/global-servers`
- 其他：`/admin/cookie-rewrite`, `/admin/test-mapping`, `/admin/har/save`, `/admin/public-folders`, `/admin/server-info`

### request-handler.js
处理主请求逻辑，包括优先级判断和代理转发。

**导出方法：**
- `handleRequest(req, res, config)` - 处理主请求

**处理流程：**
1. 收集所有可用的响应源（临时覆盖、URL映射、本地文件夹、文件夹映射、全局服务器）
2. 按优先级排序（数字越大优先级越高，相同优先级按类型排序）
3. 选择优先级最高的源
4. 根据源类型返回响应（本地文件或代理请求）

### server-core.js
服务器核心逻辑，统一管理 HTTP 和 HTTPS 服务器的创建和启动。

**导出方法：**
- `startHttpServer(port)` - 启动 HTTP 服务器
- `startHttpsServer(port, keyPath, certPath)` - 启动 HTTPS 服务器
- `startBothServers(httpPort, httpsPort, keyPath, certPath)` - 同时启动 HTTP 和 HTTPS 服务器

**核心功能：**
- 创建请求处理函数
- 显示配置信息（本地文件夹、全局服务器）
- 统一的服务器启动逻辑
- 证书文件检查和错误处理

## 主入口文件

### server.js
主入口文件，同时启动 HTTP 和 HTTPS（通过 .env 配置）。

### server-http.js
纯 HTTP 服务器入口，最简单，无需额外配置。

### server-https.js
纯 HTTPS 服务器入口，需要证书文件。

**代码行数对比：**
- 旧版 server.js: ~976 行
- 新版入口文件: ~10 行
- 核心模块: ~650 行

**优势：**
- 代码结构清晰，职责分明
- 避免重复代码，统一维护
- 易于维护和扩展
- 便于单元测试
- 减少主文件复杂度
- 支持按需部署（HTTP/HTTPS/Both）
