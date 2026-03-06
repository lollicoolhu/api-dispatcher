# Mock API Server

一个轻量级的 Mock API 服务器，支持从本地 JSON 文件返回模拟数据。

## 功能特性

- 从指定文件夹读取 JSON 文件作为 API 响应
- 管理后台支持切换数据文件夹
- HAR 文件解析，快速生成 Mock 数据
- 本地文件浏览和编辑（永久修改）
- 临时修改 API 返回值（不影响原文件）
- 访问日志记录和查看
- 支持局域网访问

## 快速开始

```bash
# 启动服务器，默认使用 mock 文件夹
node server.js

# 指定数据文件夹
node server.js cash
```

服务器启动后：
- API 地址: `http://127.0.0.1:3000`
- 管理后台: `http://127.0.0.1:3000/admin`

## 目录结构

```
mock/                    # 默认数据文件夹
  api/
    v2/
      account/
        asset.json       # 对应 /api/v2/account/asset
404.json                 # 接口不存在时返回的内容
server.js                # 服务器主文件
```

## 管理后台

访问 `/admin` 进入管理后台，包含以下功能：

### 设置
- 查看/切换当前服务文件夹
- 管理临时修改列表

### 本地文件
- 解析指定文件夹下的所有 JSON 文件
- 查看文件内容
- 永久修改：直接保存到文件
- 临时修改：仅在内存中生效，重启后失效

### HAR 解析
- 拖拽上传 HAR 文件
- 按路径分组，支持筛选和搜索
- 自动合并相同 Data 的响应
- 批量保存到服务器

### 访问日志
- 实时查看 API 访问记录
- 区分已存在/不存在的接口
- 查看请求详情（Headers、Query 参数等）
- 快速设置临时返回值

## API 说明

### Mock 接口
- 请求路径对应文件路径，如 `/api/v2/account/asset` 对应 `{folder}/api/v2/account/asset.json`
- 支持 CORS 跨域访问
- 接口不存在时返回 `404.json` 内容

### 管理接口
- `GET /admin/folder` - 获取当前文件夹
- `POST /admin/folder` - 切换文件夹
- `GET /admin/files?folder=xxx` - 获取指定文件夹的文件列表
- `POST /admin/file/save` - 保存文件
- `GET /admin/overrides` - 获取临时修改列表
- `POST /admin/overrides` - 添加临时修改
- `DELETE /admin/overrides` - 删除临时修改
- `GET /admin/logs` - 获取访问日志
- `DELETE /admin/logs` - 清空日志
- `POST /admin/har/save` - 保存 HAR 解析结果

## License

MIT
