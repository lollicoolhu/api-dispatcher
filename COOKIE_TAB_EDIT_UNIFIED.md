# Cookie Tab 统一编辑功能

## 功能概述

双击 Cookie Tab 可以打开统一编辑弹窗，提供两个选项：
1. 修改 Tab 显示标签（自定义名称）
2. 批量修改 Cookie 值（更新所有临时修改的 Cookie 条件）

## 使用方式

### 触发方式

**双击 Cookie Tab**（除了"全部"和"无Cookie条件"）

提示文字：鼠标悬停显示"双击编辑"

### 弹窗内容

#### 顶部信息区域

- **Cookie 条件**：显示完整的 `key=value`
- **影响数量**：显示有多少个临时修改使用此条件
- **版本列表**：可滚动查看所有受影响的临时修改

#### 选项 1：修改 Tab 显示标签

**用途**：为 Tab 设置有意义的自定义名称

**区域样式**：灰色背景，蓝色标签

**内容**：
- 自定义标签输入框（可留空使用默认）
- 默认显示格式提示
- "保存标签"按钮

**示例**：
- 输入：`测试账号A`
- 效果：Tab 显示从 `userId=...1818` 变为 `测试账号A`

#### 选项 2：批量修改 Cookie 值

**用途**：批量更新所有临时修改的 Cookie 条件值

**区域样式**：黄色背景，黄色标签

**内容**：
- Cookie Key（只读，灰色背景）
- 当前 Cookie Value（只读，灰色背景）
- 新的 Cookie Value（输入框，黄色边框）
- "批量修改值"按钮

**示例**：
- Cookie Key：`userId`
- 当前值：`17700001818`
- 新值：`17700001819`
- 效果：所有临时修改的 `userId` 条件从 `17700001818` 改为 `17700001819`

## 操作流程

### 流程 1：修改 Tab 标签

1. 双击 Cookie Tab（如 `userId=...1818`）
2. 在"选项 1"区域输入自定义标签（如 `测试账号A`）
3. 点击"保存标签"
4. Tab 显示更新为自定义标签
5. 点击"关闭"退出弹窗

### 流程 2：批量修改 Cookie 值

1. 双击 Cookie Tab（如 `userId=...1818`）
2. 查看受影响的版本列表
3. 在"选项 2"区域输入新的 Cookie 值（如 `17700001819`）
4. 点击"批量修改值"
5. 确认对话框中点击"确定"
6. 等待批量更新完成
7. 显示成功提示
8. 原 Tab 消失，新 Tab 出现（`userId=...1819`）

### 流程 3：同时修改标签和值

1. 双击 Cookie Tab
2. 先在"选项 1"区域保存自定义标签
3. 再在"选项 2"区域批量修改 Cookie 值
4. 两个操作独立完成

**注意**：如果先修改 Cookie 值，原 Tab 会消失，自定义标签会丢失。建议先保存标签，再修改值。

## 典型应用场景

### 场景 1：快速切换测试账号

**需求**：从测试账号 A 切换到测试账号 B

**操作**：
1. 双击 `userId=...1818` Tab
2. 在"选项 2"输入 `17700001819`
3. 批量修改值

**结果**：所有接口自动切换到账号 B

### 场景 2：为账号设置有意义的名称

**需求**：将 `userId=...1818` 显示为 `测试账号A`

**操作**：
1. 双击 `userId=...1818` Tab
2. 在"选项 1"输入 `测试账号A`
3. 保存标签

**结果**：Tab 显示为 `测试账号A`

### 场景 3：更新 Token 并命名

**需求**：Token 过期，更新为新 Token 并设置名称

**操作**：
1. 双击 `token=...abc123` Tab
2. 在"选项 1"输入 `管理员Token`，保存标签
3. 在"选项 2"输入新的 Token 值
4. 批量修改值

**结果**：
- 所有接口的 Token 已更新
- 新 Tab 显示为 `管理员Token`（需要重新设置标签）

## 界面设计

### 视觉层次

1. **顶部信息区域**（蓝色）
   - 显示当前 Cookie 条件
   - 显示影响的版本数量
   - 版本列表

2. **选项 1 区域**（灰色背景）
   - 蓝色标签："选项 1"
   - 修改 Tab 标签功能
   - 蓝色"保存标签"按钮

3. **选项 2 区域**（黄色背景）
   - 黄色标签："选项 2"
   - 批量修改 Cookie 值功能
   - 黄色"批量修改值"按钮

4. **底部操作区域**
   - 灰色"关闭"按钮

### 颜色说明

- **蓝色**：信息展示、Tab 标签功能
- **黄色**：警告色、批量修改功能（影响多个临时修改）
- **灰色**：只读字段、次要操作

## 技术实现

### 核心函数

#### 1. `editCookieTabLabel(key, value)`

**功能**：双击 Tab 时触发，收集受影响的版本并打开弹窗

**逻辑**：
```javascript
// 遍历所有临时修改
paths.forEach(p => {
  versions.forEach(v => {
    // 查找匹配的 Cookie 条件
    const cookieConditions = (v.conditions || []).filter(c => c.source === 'cookie');
    cookieConditions.forEach(cc => {
      if (cc.key === key && cc.value === value) {
        affectedVersions.push({ path: p, version: v });
      }
    });
  });
});

// 打开编辑弹窗
openCookieTabEditModal(key, value, affectedVersions);
```

#### 2. `openCookieTabEditModal(key, value, affectedVersions)`

**功能**：打开统一编辑弹窗，初始化表单

**内容**：
- 显示 Cookie 条件和影响数量
- 生成版本列表
- 设置 Tab 标签输入框（当前自定义标签或空）
- 设置 Cookie 值输入框（Key 和当前 Value 只读）

#### 3. `saveCookieTabLabel()`

**功能**：保存 Tab 自定义标签

**逻辑**：
```javascript
const customLabel = document.getElementById('cookieEditTabLabel').value.trim();
setCookieTabLabel(data.key, data.value, customLabel);
closeCookieTabEditModal();
```

#### 4. `saveCookieValue()`

**功能**：批量修改 Cookie 值

**逻辑**：
```javascript
// 验证输入
if (!newValue || newValue === oldValue) {
  alert('...');
  return;
}

// 确认操作
const confirmed = await showConfirm('...');
if (!confirmed) return;

// 批量更新
for (const { path, version } of affectedVersions) {
  const updatedConditions = conditions.map(c => {
    if (c.source === 'cookie' && c.key === key && c.value === oldValue) {
      return { ...c, value: newValue };
    }
    return c;
  });
  
  await fetch('/admin/overrides', {
    method: 'POST',
    body: JSON.stringify({ path, versionId, conditions: updatedConditions })
  });
}

// 刷新列表
await loadOverrides();
renderOverrides();
```

## 注意事项

### 1. 操作独立性

两个选项是独立的操作：
- 修改标签不影响 Cookie 值
- 修改 Cookie 值不影响标签（但会导致 Tab 重新创建）

### 2. 标签持久化

- 标签存储在 localStorage 中
- 基于完整的 `key=value` 存储
- 修改 Cookie 值后，需要重新设置标签

### 3. 批量修改不可撤销

- 批量修改 Cookie 值会立即生效
- 操作不可撤销
- 建议修改前仔细检查版本列表

### 4. Tab 变化

批量修改 Cookie 值后：
- 原 Tab 消失（没有临时修改使用旧值了）
- 新 Tab 出现（使用新值）
- 自定义标签需要重新设置

## 用户体验优化

### 1. 统一入口

- 只需双击 Tab 即可访问所有编辑功能
- 无需额外按钮，界面更简洁

### 2. 清晰分区

- 两个选项用不同颜色区分
- 每个选项有独立的保存按钮
- 避免误操作

### 3. 即时反馈

- 保存标签后立即更新 Tab 显示
- 批量修改后显示成功提示
- 列表自动刷新

### 4. 灵活操作

- 可以只修改标签
- 可以只修改 Cookie 值
- 可以先后修改两者

## 相关功能

- **Cookie Tab 分组**：自动按 Cookie 条件分组
- **Tab 标签自定义**：为每个分组设置名称
- **Cookie 条件匹配**：支持 Cookie 条件的临时修改

## 快速测试

### 测试 1：修改标签

1. 创建临时修改，Cookie 条件：`userId=17700001818`
2. 双击 `userId=...1818` Tab
3. 输入标签：`测试账号A`
4. 点击"保存标签"
5. 验证 Tab 显示为 `测试账号A`

### 测试 2：批量修改值

1. 使用测试 1 的数据
2. 双击 `测试账号A` Tab
3. 输入新值：`17700001819`
4. 点击"批量修改值"并确认
5. 验证原 Tab 消失，新 Tab 出现

### 测试 3：同时修改

1. 创建临时修改，Cookie 条件：`token=abc123`
2. 双击 `token=...c123` Tab
3. 输入标签：`管理员Token`，保存
4. 输入新值：`xyz789`，批量修改
5. 验证新 Tab 出现，但标签需要重新设置

## 常见问题

### Q: 为什么修改 Cookie 值后标签消失了？

A: 因为 Tab 是基于 Cookie 值创建的，修改值后会创建新的 Tab。标签是基于完整的 `key=value` 存储的，所以需要重新设置。

**建议**：如果需要保留标签，先修改标签，再修改值，然后为新 Tab 重新设置标签。

### Q: 可以只修改 Cookie Key 吗？

A: 不可以。目前只支持修改 Cookie Value。如需修改 Key，请逐个编辑临时修改。

### Q: 批量修改会影响其他 Cookie 条件吗？

A: 不会。只修改匹配当前 Cookie 条件的临时修改，其他条件不受影响。

### Q: 如何撤销批量修改？

A: 批量修改不可撤销。如需恢复，可以再次批量修改回原来的值。

## 总结

统一编辑弹窗提供了便捷的 Cookie Tab 管理功能：
- 双击即可访问所有编辑选项
- 清晰的视觉分区避免误操作
- 灵活的操作方式满足不同需求
- 批量修改功能大幅提高效率
