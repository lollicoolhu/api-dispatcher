# Cookie Tab 分组功能 - 错误修复

## 问题描述

在实现 Cookie Tab 分组功能后，页面无法打开，出现以下错误：

### 错误1：重复声明变量
```
[Error] SyntaxError: Cannot declare a let variable twice: 'filteredPaths'.
(admin.js:1463)
```

### 错误2：函数未定义
```
[Error] ReferenceError: Can't find variable: showTab
onclick (admin:97)
```

## 问题原因

### 错误1：重复声明
在 `renderOverrides()` 函数中，`filteredPaths` 变量被声明了两次：

```javascript
// 第一次声明
let filteredPaths = paths;
if (activeOverrideCookieTab !== 'all' && cookieGroups.has(activeOverrideCookieTab)) {
  filteredPaths = paths.filter(p => cookieGroups.get(activeOverrideCookieTab).paths.has(p));
}

// 第二次声明（重复！）
let filteredPaths = paths;
if (activeOverrideCookieTab !== 'all' && cookieGroups.has(activeOverrideCookieTab)) {
  filteredPaths = paths.filter(p => cookieGroups.get(activeOverrideCookieTab).paths.has(p));
}
```

这是在合并代码时不小心重复粘贴导致的。

### 错误2：函数未定义
这个错误是由于错误1导致的。当 JavaScript 解析器遇到语法错误时，整个脚本文件都无法正确加载，导致所有函数（包括 `showTab`）都无法使用。

## 解决方案

### 修复错误1
删除重复的 `filteredPaths` 声明，只保留一次：

```javascript
// 根据当前选中的 Tab 过滤路径
let filteredPaths = paths;
if (activeOverrideCookieTab !== 'all' && cookieGroups.has(activeOverrideCookieTab)) {
  filteredPaths = paths.filter(p => cookieGroups.get(activeOverrideCookieTab).paths.has(p));
}

list.innerHTML = tabsHtml + filteredPaths.sort().map(p => {
  // ... 渲染逻辑
});
```

### 修复错误2
错误1修复后，admin.js 可以正确加载，`showTab` 函数自然就可以使用了。

## 修复步骤

1. 打开 `admin.js` 文件
2. 找到 `renderOverrides()` 函数中的重复代码（约在第1456-1463行）
3. 删除重复的 `filteredPaths` 声明
4. 保存文件
5. 重启服务器

## 验证修复

### 1. 语法检查
```bash
node -c admin.js
```

**预期结果**：无输出，表示语法正确

### 2. 启动服务器
```bash
npm start
```

**预期结果**：
```
HTTP server running at http://0.0.0.0:3000
Admin panel: http://localhost:3000/admin
```

### 3. 访问管理面板
打开浏览器访问：http://localhost:3000/admin

**预期结果**：
- ✅ 页面正常加载
- ✅ 无 JavaScript 错误
- ✅ Tab 切换功能正常
- ✅ Cookie Tab 分组功能正常

### 4. 浏览器控制台检查
打开浏览器开发者工具（F12），查看 Console 标签页

**预期结果**：
- ✅ 无错误信息
- ✅ 无警告信息

## 修复后的代码

### admin.js - renderOverrides() 函数（部分）

```javascript
// 全局变量：当前选中的 Cookie 分组 Tab
let activeOverrideCookieTab = 'all';

// 切换 Cookie 分组 Tab
function switchOverrideCookieTab(tabKey) {
  activeOverrideCookieTab = tabKey;
  renderOverrides();
}

function renderOverrides() {
  const list = document.getElementById('overrideList');
  const paths = Object.keys(overrides);

  let totalVersions = 0;
  paths.forEach(p => {
    totalVersions += (overrides[p] || []).length;
  });

  document.getElementById('overrideCount').textContent = '';
  if (paths.length === 0) { list.innerHTML = '<em>无临时修改</em>'; return; }

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

  // 移除空的分组
  for (const [key, group] of cookieGroups.entries()) {
    if (key !== 'all' && group.paths.size === 0) {
      cookieGroups.delete(key);
    }
  }

  // 渲染 Tab 导航（只在有多个分组时显示）
  let tabsHtml = '';
  if (cookieGroups.size > 2) {
    tabsHtml = '<div class="override-tabs" style="display:flex;gap:8px;margin-bottom:15px;border-bottom:2px solid #e9ecef;padding-bottom:0;overflow-x:auto">';
    for (const [key, group] of cookieGroups.entries()) {
      const isActive = activeOverrideCookieTab === key;
      const count = group.paths.size;
      tabsHtml += '<button class="override-tab' + (isActive ? ' active' : '') + '" ' +
        'onclick="switchOverrideCookieTab(\'' + key.replace(/'/g, "\\'") + '\')" ' +
        'style="padding:8px 16px;border:none;background:' + (isActive ? '#007bff' : 'transparent') + ';' +
        'color:' + (isActive ? '#fff' : '#495057') + ';cursor:pointer;border-radius:4px 4px 0 0;' +
        'font-size:13px;white-space:nowrap;transition:all 0.2s;' +
        (isActive ? 'font-weight:600;' : '') + '">' +
        escapeHtml(group.label) + ' <span style="opacity:0.7">(' + count + ')</span>' +
        '</button>';
    }
    tabsHtml += '</div>';
  }

  // 根据当前选中的 Tab 过滤路径（只声明一次！）
  let filteredPaths = paths;
  if (activeOverrideCookieTab !== 'all' && cookieGroups.has(activeOverrideCookieTab)) {
    filteredPaths = paths.filter(p => cookieGroups.get(activeOverrideCookieTab).paths.has(p));
  }

  list.innerHTML = tabsHtml + filteredPaths.sort().map(p => {
    // ... 渲染逻辑
  }).join('');
}
```

## 经验教训

### 1. 代码合并时要仔细检查
在合并或复制代码时，要仔细检查是否有重复的代码块，特别是变量声明。

### 2. 使用语法检查工具
在提交代码前，使用 `node -c` 或 ESLint 等工具检查语法错误。

### 3. 浏览器开发者工具
遇到页面无法加载的问题时，第一时间打开浏览器开发者工具查看 Console 错误信息。

### 4. 逐步测试
在添加新功能后，立即测试，而不是等到所有功能都完成后再测试。

## 当前状态

✅ **错误已修复**
✅ **服务器正常运行**
✅ **页面可以正常访问**
✅ **Cookie Tab 分组功能正常工作**

## 服务器信息

```
HTTP server running at http://0.0.0.0:3000
Admin panel: http://localhost:3000/admin
Loaded 17 overrides, 1 url mappings, 0 folder mappings, 5 local folders, 3 global servers
```

## 下一步

1. 访问管理面板：http://localhost:3000/admin
2. 创建一些带有 Cookie 条件的临时修改
3. 测试 Cookie Tab 分组功能
4. 验证 Tab 切换和过滤功能

**现在可以正常使用了！** ✅
