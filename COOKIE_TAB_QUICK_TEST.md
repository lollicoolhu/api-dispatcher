# Cookie Tab 标签自定义 - 快速测试指南

## 前提条件

确保服务器正在运行：
```bash
node lib/server-core.js
```

## 测试步骤

### 1. 访问管理页面

打开浏览器访问：`http://localhost:3000/admin`（或你的服务器地址）

### 2. 创建测试数据

在"设置"标签页中，为同一个接口创建多个带有不同 Cookie 条件的临时修改：

#### 测试用例 A：短值 Cookie
- 路径：`/api/test`
- 条件来源：Cookie
- Cookie Key：`env`
- Cookie Value：`prod`
- 操作符：等于
- 响应内容：`{"user": "production"}`

#### 测试用例 B：长值 Cookie
- 路径：`/api/test`
- 条件来源：Cookie
- Cookie Key：`userId`
- Cookie Value：`17700001818`
- 操作符：等于
- 响应内容：`{"user": "test-user-a"}`

#### 测试用例 C：另一个长值 Cookie
- 路径：`/api/test`
- 条件来源：Cookie
- Cookie Key：`token`
- Cookie Value：`abc123def456a8f3`
- 操作符：等于
- 响应内容：`{"user": "test-user-b"}`

### 3. 验证默认显示

创建完成后，临时修改列表应该显示 Cookie Tab 分组：

**预期结果：**
- Tab 1：`全部 (1)` - 显示所有路径
- Tab 2：`无Cookie条件 (0)` - 无内容
- Tab 3：`env=prod (1)` - 短值，显示完整
- Tab 4：`userId=...1818 (1)` - 长值，显示后四位
- Tab 5：`token=...a8f3 (1)` - 长值，显示后四位

### 4. 测试自定义标签

#### 4.1 设置自定义标签

1. 双击 `userId=...1818` Tab
2. 在弹出的对话框中输入：`测试账号A`
3. 点击"确定"

**预期结果：**
- Tab 显示变为：`测试账号A (1)`
- 其他 Tab 不受影响

#### 4.2 设置另一个自定义标签

1. 双击 `token=...a8f3` Tab
2. 输入：`管理员Token`
3. 点击"确定"

**预期结果：**
- Tab 显示变为：`管理员Token (1)`

### 5. 测试持久化

1. 刷新页面（F5 或 Ctrl+R）
2. 检查 Cookie Tab 是否仍然显示自定义标签

**预期结果：**
- `测试账号A (1)` - 保持自定义标签
- `管理员Token (1)` - 保持自定义标签
- `env=prod (1)` - 保持默认显示

### 6. 测试清除标签

1. 双击 `测试账号A` Tab
2. 清空输入框（删除所有文字）
3. 点击"确定"

**预期结果：**
- Tab 显示恢复为：`userId=...1818 (1)`

### 7. 测试取消编辑

1. 双击 `管理员Token` Tab
2. 修改输入框内容
3. 点击"取消"

**预期结果：**
- Tab 显示保持不变：`管理员Token (1)`

## 验证点总结

| 测试项 | 验证内容 | 预期结果 |
|--------|----------|----------|
| 默认显示 - 短值 | `env=prod` | 显示完整值 |
| 默认显示 - 长值 | `userId=17700001818` | 显示 `userId=...1818` |
| 自定义标签 | 双击编辑 | 显示自定义标签 |
| 持久化 | 刷新页面 | 自定义标签保持 |
| 清除标签 | 清空输入 | 恢复默认显示 |
| 取消编辑 | 点击取消 | 保持原标签 |
| Tab 提示 | 鼠标悬停 | 显示"双击编辑标签" |

## 调试技巧

### 查看 localStorage

在浏览器控制台中执行：
```javascript
console.log(localStorage.getItem('cookieTabLabels'));
```

**预期输出：**
```json
{"userId=17700001818":"测试账号A","token=abc123def456a8f3":"管理员Token"}
```

### 手动清除所有自定义标签

在浏览器控制台中执行：
```javascript
localStorage.removeItem('cookieTabLabels');
location.reload();
```

## 常见问题

### Q: Tab 没有显示出来？
A: 确保至少有 3 个分组（除了"全部"和"无Cookie条件"，还需要至少 1 个 Cookie 条件分组）

### Q: 双击没有反应？
A: 检查浏览器控制台是否有 JavaScript 错误

### Q: 刷新后自定义标签丢失？
A: 检查浏览器是否禁用了 localStorage，或者是否在隐私模式下

### Q: 如何批量设置标签？
A: 目前只支持逐个设置，可以在浏览器控制台中手动编辑 localStorage
