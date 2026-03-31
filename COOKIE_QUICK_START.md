# Cookie 条件匹配 - 快速开始

## 🚀 5分钟快速上手

### 1. 访问管理面板
打开浏览器访问：http://localhost:3000/admin

### 2. 查看访问日志
点击顶部的"访问日志"标签

### 3. 添加 Cookie 条件

#### 步骤：
1. 在日志列表中找到需要修改的请求
2. 点击"修改返回"按钮
3. 在弹窗中查看"当前请求 Cookies"区域（查看所有 Cookie）
4. 滚动到"参数条件匹配"区域
5. 点击"+ 添加条件"按钮
6. 在新增的条件行中：
   - **来源**: 选择 `Cookie`
   - **键**: 输入 Cookie 名称（如 `userId`、`sessionId`、`token`）
   - **操作符**: 选择匹配方式
     - `等于`: Cookie 值完全匹配
     - `不等于`: Cookie 值不匹配
     - `包含`: Cookie 值包含指定字符串
     - `存在`: Cookie 存在（不需要填写值）
   - **值**: 输入要匹配的值（如果操作符是"存在"则不需要）
7. 编辑下方的响应内容
8. 点击"临时保存"

### 4. 测试效果

使用 curl 测试：
```bash
# 测试匹配的 Cookie
curl -H "Cookie: userId=123" http://localhost:3000/api/your-path

# 测试不匹配的 Cookie
curl -H "Cookie: userId=456" http://localhost:3000/api/your-path

# 测试无 Cookie
curl http://localhost:3000/api/your-path
```

## 📋 常见场景

### 场景1: 多账号测试
**需求**: 不同用户ID返回不同数据

**配置**:
- 版本1: Cookie `userId` 等于 `123` → 用户123的数据
- 版本2: Cookie `userId` 等于 `456` → 用户456的数据
- 版本3: 无条件 → 默认数据

**测试**:
```bash
curl -H "Cookie: userId=123" http://localhost:3000/api/user/info
curl -H "Cookie: userId=456" http://localhost:3000/api/user/info
```

### 场景2: 会话区分
**需求**: 不同会话返回不同数据

**配置**:
- 版本1: Cookie `sessionId` 等于 `abc123` → 会话A数据
- 版本2: Cookie `sessionId` 等于 `def456` → 会话B数据

**测试**:
```bash
curl -H "Cookie: sessionId=abc123" http://localhost:3000/api/data
curl -H "Cookie: sessionId=def456" http://localhost:3000/api/data
```

### 场景3: 登录状态
**需求**: 根据是否登录返回不同数据

**配置**:
- 版本1: Cookie `token` 存在 → 登录用户数据
- 版本2: 无条件 → 游客数据

**测试**:
```bash
curl -H "Cookie: token=xyz789" http://localhost:3000/api/profile
curl http://localhost:3000/api/profile
```

### 场景4: A/B测试
**需求**: 不同实验组返回不同数据

**配置**:
- 版本1: Cookie `experiment_id` 等于 `exp_a` → 实验A数据
- 版本2: Cookie `experiment_id` 等于 `exp_b` → 实验B数据
- 版本3: 无条件 → 默认数据

**测试**:
```bash
curl -H "Cookie: experiment_id=exp_a" http://localhost:3000/api/feature
curl -H "Cookie: experiment_id=exp_b" http://localhost:3000/api/feature
```

## 🔧 高级用法

### 组合条件
可以同时使用多个条件，支持"且"和"或"逻辑：

**示例**: 特定用户的特定操作
- 条件1: Cookie `userId` 等于 `123`
- 条件2: Body `action` 等于 `buy`
- 逻辑: 满足所有条件 (且)

**测试**:
```bash
curl -X POST \
  -H "Cookie: userId=123" \
  -H "Content-Type: application/json" \
  -d '{"action":"buy"}' \
  http://localhost:3000/api/order
```

### 多个 Cookie
可以在一个请求中发送多个 Cookie：

```bash
curl -H "Cookie: userId=123; sessionId=abc; token=xyz" \
  http://localhost:3000/api/test
```

### 包含特殊字符的 Cookie
Cookie 值可以包含 `=` 号（如 Base64 编码）：

```bash
curl -H "Cookie: token=eyJhbGciOiJIUzI1NiIs=" \
  http://localhost:3000/api/test
```

## 💡 提示

### 查看 Cookie
在弹窗的"当前请求 Cookies"区域可以看到：
- 所有 Cookie 的键名
- 所有 Cookie 的值
- 以表格形式清晰展示

### 条件逻辑
- **满足所有条件 (且)**: 所有条件都必须满足才匹配
- **满足任一条件 (或)**: 任意一个条件满足就匹配

### 优先级
- 有条件且匹配的版本优先级最高
- 在匹配的版本中，优先级数字越大越优先
- 无条件的版本作为兜底

### 常见 Cookie 名称
- `sessionId` / `SESSIONID` - 会话ID
- `userId` / `uid` - 用户ID
- `token` / `auth_token` - 认证令牌
- `username` - 用户名
- `accountId` - 账号ID
- `experiment_id` - 实验ID

## ⚠️ 注意事项

1. **大小写敏感**: `userId` 和 `UserId` 是不同的键
2. **特殊字符**: 分号 `;` 用于分隔多个 Cookie
3. **安全性**: Cookie 可能包含敏感信息，请谨慎处理
4. **浏览器限制**: 单个 Cookie 通常限制在 4KB

## 📚 更多文档

- **完整文档**: COOKIE_CONDITION_MATCHING.md
- **实现总结**: COOKIE_FEATURE_SUMMARY.md
- **验证报告**: COOKIE_VERIFICATION.md

## 🆘 需要帮助？

如果遇到问题：
1. 检查服务器是否正常运行
2. 查看访问日志中的请求详情
3. 确认 Cookie 名称和值是否正确
4. 检查条件逻辑是否正确设置

## ✅ 功能状态

- ✅ 服务器运行中: http://localhost:3000
- ✅ 管理面板: http://localhost:3000/admin
- ✅ Cookie 功能已就绪
- ✅ 已加载 17 个临时修改配置

**现在就开始使用 Cookie 条件匹配功能吧！** 🎉
