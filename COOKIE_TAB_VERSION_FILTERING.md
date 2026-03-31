# Cookie Tab 版本过滤功能

## 问题描述

### 修复前的问题

在 Cookie Tab 分组视图中，虽然路径被正确过滤，但每个路径下的所有版本都会显示，包括不符合当前 Tab 条件的版本。

**示例问题**：
- 路径：`/api/v2/trade/accumulate/save`
- 版本 1：Cookie 条件 `userId=17700001818`
- 版本 2：Cookie 条件 `userId=17700001819`
- 版本 3：无 Cookie 条件

当切换到 `userId=...1818` Tab 时：
- ❌ 修复前：显示所有 3 个版本（包括版本 2 和版本 3）
- ✅ 修复后：只显示版本 1

## 解决方案

### 实现逻辑

在渲染临时修改列表时，不仅过滤路径，还要过滤每个路径下的版本：

1. **"全部" Tab**：显示所有版本（不过滤）
2. **"无Cookie条件" Tab**：只显示没有 Cookie 条件的版本
3. **Cookie 分组 Tab**：只显示匹配当前 Cookie 条件的版本

### 代码实现

```javascript
// 根据当前 Tab 过滤版本
let versions = allVersions;
if (activeOverrideCookieTab !== 'all') {
  if (activeOverrideCookieTab === 'no-cookie') {
    // 只显示没有 Cookie 条件的版本
    versions = allVersions.filter(v => {
      const cookieConditions = (v.conditions || []).filter(c => c.source === 'cookie');
      return cookieConditions.length === 0;
    });
  } else if (activeOverrideCookieTab.startsWith('cookie:')) {
    // 只显示匹配当前 Cookie 条件的版本
    const match = activeOverrideCookieTab.match(/^cookie:(.+?)=(.+)$/);
    if (match) {
      const [, targetKey, targetValue] = match;
      versions = allVersions.filter(v => {
        const cookieConditions = (v.conditions || []).filter(c => c.source === 'cookie');
        return cookieConditions.some(cc => cc.key === targetKey && cc.value === targetValue);
      });
    }
  }
}

// 如果过滤后没有版本，不显示这个路径
if (versions.length === 0) return '';
```

## 使用场景

### 场景 1：同一路径多个账号

**路径**：`/api/user/info`

**版本**：
- 版本 1：`userId=17700001818` - 测试账号 A 的数据
- 版本 2：`userId=17700001819` - 测试账号 B 的数据
- 版本 3：无条件 - 默认数据

**Tab 切换效果**：
- **"全部" Tab**：显示 3 个版本
- **`userId=...1818` Tab**：只显示版本 1
- **`userId=...1819` Tab**：只显示版本 2
- **"无Cookie条件" Tab**：只显示版本 3

### 场景 2：混合条件

**路径**：`/api/order/list`

**版本**：
- 版本 1：`userId=17700001818` + `env=dev`
- 版本 2：`userId=17700001818` + `env=test`
- 版本 3：`userId=17700001819`

**Tab 切换效果**：
- **"全部" Tab**：显示 3 个版本
- **`userId=...1818` Tab**：显示版本 1 和版本 2（都包含 `userId=17700001818`）
- **`userId=...1819` Tab**：只显示版本 3

### 场景 3：路径完全隐藏

**路径**：`/api/v2/trade/accumulate/save`

**版本**：
- 版本 1：`userId=17700001819`
- 版本 2：`userId=17700001820`

**Tab 切换效果**：
- **"全部" Tab**：显示该路径和 2 个版本
- **`userId=...1818` Tab**：该路径完全不显示（因为没有匹配的版本）
- **`userId=...1819` Tab**：显示该路径和版本 1
- **`userId=...1820` Tab**：显示该路径和版本 2

## 过滤规则

### 规则 1："全部" Tab

**条件**：`activeOverrideCookieTab === 'all'`

**行为**：不过滤，显示所有版本

**用途**：查看所有临时修改

### 规则 2："无Cookie条件" Tab

**条件**：`activeOverrideCookieTab === 'no-cookie'`

**过滤逻辑**：
```javascript
versions = allVersions.filter(v => {
  const cookieConditions = (v.conditions || []).filter(c => c.source === 'cookie');
  return cookieConditions.length === 0;
});
```

**行为**：只显示没有任何 Cookie 条件的版本

**用途**：查看默认兜底版本

### 规则 3：Cookie 分组 Tab

**条件**：`activeOverrideCookieTab.startsWith('cookie:')`

**过滤逻辑**：
```javascript
const [, targetKey, targetValue] = match;
versions = allVersions.filter(v => {
  const cookieConditions = (v.conditions || []).filter(c => c.source === 'cookie');
  return cookieConditions.some(cc => cc.key === targetKey && cc.value === targetValue);
});
```

**行为**：只显示包含匹配 Cookie 条件的版本

**匹配条件**：
- Cookie 的 `key` 必须相同
- Cookie 的 `value` 必须相同
- 版本可以有其他条件（如 Header、Body 条件）

**用途**：查看特定账号/环境的临时修改

## 显示逻辑

### 路径显示规则

1. **有匹配版本**：显示路径和版本
2. **无匹配版本**：完全不显示该路径

### 版本计数

- **折叠模式**：显示过滤后的版本数量
  - 例如：`3 规则` → 只计算符合条件的版本
- **展开模式**：只显示符合条件的版本项

### 启用状态

- **已启用计数**：只计算符合条件且已启用的版本
  - 例如：`已启用(2)` → 只计算符合条件的启用版本

## 用户体验优化

### 1. 清晰的分组

每个 Tab 只显示相关的版本，避免混淆。

### 2. 准确的计数

Tab 标签显示的数量是实际符合条件的路径数量。

### 3. 动态隐藏

不符合条件的路径完全隐藏，界面更简洁。

### 4. 一致的行为

所有 Tab 的过滤逻辑一致，用户体验统一。

## 技术细节

### 过滤时机

在 `renderOverrides()` 函数中，渲染每个路径时进行版本过滤。

### 性能考虑

- 过滤操作在前端进行，不影响后端
- 只在渲染时过滤，不修改原始数据
- 过滤逻辑简单高效

### 数据完整性

- 原始数据（`overrides`）不受影响
- 切换 Tab 时重新过滤
- 编辑、删除操作基于原始数据

## 测试验证

### 测试用例 1：单一 Cookie 条件

**准备数据**：
- 路径：`/api/test`
- 版本 1：`userId=17700001818`
- 版本 2：`userId=17700001819`

**测试步骤**：
1. 切换到"全部" Tab → 验证显示 2 个版本
2. 切换到 `userId=...1818` Tab → 验证只显示版本 1
3. 切换到 `userId=...1819` Tab → 验证只显示版本 2

### 测试用例 2：混合条件

**准备数据**：
- 路径：`/api/test`
- 版本 1：`userId=17700001818` + `env=dev`
- 版本 2：`userId=17700001818` + `env=test`
- 版本 3：`env=dev`（无 Cookie 条件）

**测试步骤**：
1. 切换到"全部" Tab → 验证显示 3 个版本
2. 切换到 `userId=...1818` Tab → 验证显示版本 1 和版本 2
3. 切换到"无Cookie条件" Tab → 验证只显示版本 3

### 测试用例 3：路径隐藏

**准备数据**：
- 路径 A：版本 1（`userId=17700001818`）
- 路径 B：版本 1（`userId=17700001819`）

**测试步骤**：
1. 切换到 `userId=...1818` Tab → 验证只显示路径 A
2. 切换到 `userId=...1819` Tab → 验证只显示路径 B
3. 切换到"全部" Tab → 验证显示路径 A 和路径 B

## 常见问题

### Q: 为什么某个路径在 Cookie Tab 中不显示？

A: 因为该路径下没有匹配当前 Cookie 条件的版本。切换到"全部" Tab 可以查看所有版本。

### Q: 版本计数为什么和"全部" Tab 中不一样？

A: Cookie Tab 只计算符合条件的版本数量，"全部" Tab 显示所有版本数量。

### Q: 如何查看某个路径的所有版本？

A: 切换到"全部" Tab，可以看到所有版本，不受 Cookie 条件限制。

### Q: 过滤会影响版本的启用状态吗？

A: 不会。过滤只影响显示，不修改版本的任何属性。

## 总结

版本过滤功能确保了 Cookie Tab 分组的准确性：
- ✅ 只显示符合条件的版本
- ✅ 不符合条件的路径完全隐藏
- ✅ 准确的版本计数
- ✅ 清晰的分组展示
- ✅ 不影响原始数据

这使得 Cookie Tab 分组功能更加实用和直观。
