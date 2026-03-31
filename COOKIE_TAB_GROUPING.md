# Cookie 条件 Tab 分组功能

## 功能概述

在临时修改列表中，根据不同的 Cookie 条件自动创建 Tab 分组，方便区分和管理不同用户的配置。

## 功能特性

### 1. 自动分组
系统会自动扫描所有临时修改的 Cookie 条件，并创建对应的 Tab 分组：

- **全部** - 显示所有临时修改
- **无Cookie条件** - 显示没有 Cookie 条件的临时修改
- **userId=123** - 显示包含 `userId=123` Cookie 条件的临时修改
- **sessionId=abc** - 显示包含 `sessionId=abc` Cookie 条件的临时修改
- ... 其他 Cookie 条件分组

### 2. Tab 显示规则
- 只有当存在 **3个或更多分组** 时才显示 Tab 导航
- 如果只有"全部"和"无Cookie条件"两个分组，则不显示 Tab（直接显示列表）
- 每个 Tab 显示该分组包含的路径数量

### 3. Tab 样式
- **激活状态**: 蓝色背景，白色文字，加粗
- **未激活状态**: 透明背景，灰色文字
- 鼠标悬停时有过渡动画效果
- 支持横向滚动（当 Tab 过多时）

## 使用场景

### 场景1：多用户测试
当你为不同用户配置了不同的返回数据时：

```
Tab: 全部 (10)
Tab: 无Cookie条件 (3)
Tab: userId=123 (4)
Tab: userId=456 (3)
```

点击 `userId=123` Tab，只显示包含该 Cookie 条件的临时修改。

### 场景2：会话区分
当你为不同会话配置了不同的返回数据时：

```
Tab: 全部 (8)
Tab: 无Cookie条件 (2)
Tab: sessionId=abc123 (3)
Tab: sessionId=def456 (3)
```

点击 `sessionId=abc123` Tab，只显示该会话的配置。

### 场景3：A/B测试
当你为不同实验组配置了不同的返回数据时：

```
Tab: 全部 (12)
Tab: 无Cookie条件 (4)
Tab: experiment_id=exp_a (4)
Tab: experiment_id=exp_b (4)
```

点击 `experiment_id=exp_a` Tab，只显示实验组A的配置。

## 技术实现

### 1. 分组收集逻辑

```javascript
// 收集所有 Cookie 条件分组
const cookieGroups = new Map();
cookieGroups.set('all', { label: '全部', paths: new Set() });
cookieGroups.set('no-cookie', { label: '无Cookie条件', paths: new Set() });

paths.forEach(p => {
  const versions = overrides[p] || [];
  cookieGroups.get('all').paths.add(p);
  
  let hasCookieCondition = false;
  versions.forEach(v => {
    const cookieConditions = (v.conditions || []).filter(c => c.source === 'cookie');
    if (cookieConditions.length > 0) {
      hasCookieCondition = true;
      cookieConditions.forEach(cc => {
        const groupKey = `cookie:${cc.key}=${cc.value}`;
        const groupLabel = `${cc.key}=${cc.value}`;
        if (!cookieGroups.has(groupKey)) {
          cookieGroups.set(groupKey, { label: groupLabel, paths: new Set() });
        }
        cookieGroups.get(groupKey).paths.add(p);
      });
    }
  });
  
  if (!hasCookieCondition) {
    cookieGroups.get('no-cookie').paths.add(p);
  }
});
```

### 2. Tab 渲染逻辑

```javascript
// 只在有多个分组时显示 Tab
if (cookieGroups.size > 2) {
  tabsHtml = '<div class="override-tabs" ...>';
  for (const [key, group] of cookieGroups.entries()) {
    const isActive = activeOverrideCookieTab === key;
    const count = group.paths.size;
    tabsHtml += '<button class="override-tab' + (isActive ? ' active' : '') + '" ...>';
  }
  tabsHtml += '</div>';
}
```

### 3. 路径过滤逻辑

```javascript
// 根据当前选中的 Tab 过滤路径
let filteredPaths = paths;
if (activeOverrideCookieTab !== 'all' && cookieGroups.has(activeOverrideCookieTab)) {
  filteredPaths = paths.filter(p => cookieGroups.get(activeOverrideCookieTab).paths.has(p));
}
```

### 4. Tab 切换逻辑

```javascript
function switchOverrideCookieTab(tabKey) {
  activeOverrideCookieTab = tabKey;
  renderOverrides();
}
```

## 分组规则

### 1. 一个路径可以属于多个分组
如果一个路径有多个版本，每个版本有不同的 Cookie 条件，那么这个路径会出现在多个 Tab 中。

**示例**：
```
路径: /api/user/info
- 版本1: Cookie userId=123
- 版本2: Cookie userId=456
```

这个路径会同时出现在：
- `全部` Tab
- `userId=123` Tab
- `userId=456` Tab

### 2. 无 Cookie 条件的路径
如果一个路径的所有版本都没有 Cookie 条件，它会出现在：
- `全部` Tab
- `无Cookie条件` Tab

### 3. 混合条件的路径
如果一个路径有多个版本，部分有 Cookie 条件，部分没有，它会出现在：
- `全部` Tab
- `无Cookie条件` Tab（因为有版本没有 Cookie 条件）
- 对应的 Cookie 条件 Tab（因为有版本有 Cookie 条件）

## Tab 样式定制

### 激活状态
```css
background: #007bff;
color: #fff;
font-weight: 600;
```

### 未激活状态
```css
background: transparent;
color: #495057;
```

### 悬停效果
```css
transition: all 0.2s;
```

### 布局
```css
display: flex;
gap: 8px;
margin-bottom: 15px;
border-bottom: 2px solid #e9ecef;
overflow-x: auto;
```

## 使用示例

### 示例1：查看特定用户的配置

1. 打开管理面板：http://localhost:3000/admin
2. 在"临时修改列表"区域，查看 Tab 导航
3. 点击 `userId=123` Tab
4. 只显示包含该 Cookie 条件的临时修改
5. 可以编辑、删除或添加新的配置

### 示例2：查看所有配置

1. 点击 `全部` Tab
2. 显示所有临时修改，不进行过滤

### 示例3：查看无 Cookie 条件的配置

1. 点击 `无Cookie条件` Tab
2. 只显示没有 Cookie 条件的临时修改
3. 这些配置通常是兜底配置或默认配置

## 注意事项

### 1. Tab 数量
- 如果 Cookie 条件组合过多，Tab 数量可能会很多
- 建议使用有意义的 Cookie 值，避免过多的分组
- 可以使用横向滚动查看所有 Tab

### 2. 性能考虑
- 分组逻辑在每次渲染时执行
- 对于大量临时修改（>100个），可能会有轻微的性能影响
- 建议定期清理不需要的临时修改

### 3. 分组更新
- 当添加、编辑或删除临时修改时，Tab 分组会自动更新
- 当前选中的 Tab 会保持不变（除非该 Tab 被删除）
- 如果当前 Tab 被删除，会自动切换到"全部" Tab

### 4. Cookie 条件格式
- 分组基于 Cookie 的 `key=value` 格式
- 相同的 `key=value` 会被归为一组
- 不同的操作符（eq, neq, contains, exists）不影响分组

## 优势

### 1. 清晰的用户区分
- 一目了然地看到不同用户的配置
- 快速切换不同用户的视图
- 避免混淆不同用户的配置

### 2. 高效的配置管理
- 快速定位特定用户的配置
- 批量查看同一用户的所有配置
- 方便进行用户级别的配置调整

### 3. 更好的测试体验
- 多账号测试时更加方便
- A/B测试时可以快速切换实验组
- 会话测试时可以快速切换会话

### 4. 自动化分组
- 无需手动创建分组
- 自动识别 Cookie 条件
- 动态更新分组列表

## 未来改进

### 1. 自定义分组名称
允许用户为 Cookie 条件分组设置自定义名称：
- `userId=123` → `用户A`
- `userId=456` → `用户B`

### 2. 分组排序
支持自定义 Tab 的排序顺序：
- 按字母顺序
- 按使用频率
- 按创建时间
- 手动拖拽排序

### 3. 分组折叠
当 Tab 过多时，支持折叠不常用的分组：
- 常用分组始终显示
- 不常用分组折叠到"更多"菜单中

### 4. 分组搜索
支持搜索 Cookie 条件分组：
- 输入 Cookie 键名或值
- 快速定位到对应的 Tab

### 5. 分组统计
显示每个分组的统计信息：
- 配置数量
- 启用/禁用数量
- 最后修改时间

## 总结

Cookie 条件 Tab 分组功能为临时修改列表提供了更好的组织和管理方式，特别适合多用户测试、A/B测试和会话管理等场景。

**核心优势**：
- ✅ 自动分组，无需手动配置
- ✅ 清晰的用户区分
- ✅ 快速切换视图
- ✅ 提高配置管理效率
- ✅ 更好的测试体验

**现在就可以使用这个功能了！** 🎉

访问管理面板：http://localhost:3000/admin
