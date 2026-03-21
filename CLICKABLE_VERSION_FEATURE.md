# 日志中可点击版本名称功能

## 功能概述

在访问日志详情中，临时修改匹配信息的版本名称现在可以点击，点击后会打开临时修改弹窗并高亮显示命中的版本，方便快速查看和编辑。

## 功能特性

### 1. 可点击的版本名称

在日志详情的"临时修改匹配信息"部分，版本名称显示为蓝色下划线链接，鼠标悬停时显示"点击编辑此版本"提示。

### 2. 自动打开弹窗

点击版本名称后：
- 自动打开该路径的临时修改管理弹窗
- 显示所有版本的列表
- 弹窗宽度更宽（1100px），方便查看更多内容

### 3. 持续高亮显示命中版本

- 自动展开命中的版本
- 添加绿色阴影和边框高亮效果
- 自动滚动到该版本位置（居中显示）
- **持续高亮显示**，直到关闭弹窗或点击其他版本
- 高亮效果清晰明显，易于识别

### 4. 可直接编辑

在弹窗中可以：
- 查看版本的完整信息（优先级、延迟、备注、条件、内容）
- 点击"编辑"按钮修改版本
- 启用/禁用版本
- 删除版本
- 创建新版本

## 实现细节

### 后端修改 (`lib/request-handler.js`)

在匹配信息中添加版本索引，并优先使用备注作为版本名称：

```javascript
// 找到选中版本在原始数组中的索引
const versionIndex = overrideVersions.findIndex(v => v === selectedVersion);

// 记录匹配信息，优先使用备注作为版本名称
const versionName = selectedVersion.remark || selectedVersion.name || '未命名版本';

const matchInfo = {
  versionName: versionName,
  versionIndex: versionIndex, // 版本在数组中的索引
  hasConditions: !!(selectedVersion.conditions && selectedVersion.conditions.length > 0),
  conditions: selectedVersion.conditions || [],
  conditionLogic: selectedVersion.conditionLogic || 'and'
};
```

**版本名称优先级**：
1. 备注（remark）- 如果有备注，优先显示备注
2. 名称（name）- 如果没有备注但有名称，显示名称
3. "未命名版本" - 如果都没有，显示默认文本

### 前端修改

#### 1. 弹窗宽度优化 (`admin.css`)

```css
/* 普通弹窗宽度 */
.modal-content { width: 1100px; max-width: 95%; }

/* 版本管理布局弹窗宽度 */
#jsonModal.version-layout .modal-content { max-width: 1400px; }

/* 命中版本的持续高亮样式 */
.version-highlighted {
  box-shadow: 0 0 15px rgba(40, 167, 69, 0.6) !important;
  border: 2px solid #28a745 !important;
  transition: all 0.3s ease;
}
```

#### 2. 版本名称链接化 (`admin.js`)

```javascript
const versionNameHtml = '<a href="javascript:void(0)" onclick="openOverrideModalAndHighlight(\'' + 
  l.path.replace(/'/g, "\\'") + '\', ' + mi.versionIndex + ')" 
  style="color:#007bff;text-decoration:underline;cursor:pointer" 
  title="点击编辑此版本">' + 
  escapeHtml(mi.versionName) + '</a>';
```

#### 3. 高亮逻辑优化 (`admin.js`)

功能：
- 验证版本索引有效性
- 打开临时修改管理弹窗
- 延迟100ms后执行高亮和滚动（确保DOM已渲染）
- 展开目标版本
- **移除所有旧的高亮**
- **添加CSS类实现持续高亮**（不自动移除）
- 滚动到目标版本（平滑滚动，居中显示）

#### 4. 清理高亮 (`admin.js`)

在关闭弹窗时自动清除所有版本的高亮：

```javascript
function closeOverrideVersionModal() {
  // 清除所有版本的高亮
  document.querySelectorAll('.version-highlighted').forEach(el => {
    el.classList.remove('version-highlighted');
  });
  resetOverrideVersionModalView();
  closeModal();
}
```

## 使用流程

1. **添加备注**: 在创建或编辑临时修改版本时，建议填写备注字段，这样在日志中会显示有意义的名称
2. **查看日志**: 在访问日志中找到使用了临时修改的请求
3. **点击日志**: 点击日志条目查看详情
4. **查看匹配信息**: 在详情面板中找到"临时修改匹配信息"部分
5. **点击版本名称**: 点击蓝色的版本名称链接（显示备注或"未命名版本"）
6. **查看/编辑版本**: 在弹出的窗口中查看高亮的版本，可以直接编辑

## 版本名称显示规则

版本名称按以下优先级显示：
1. **备注（推荐）**: 如果版本有备注，显示备注内容
2. **名称**: 如果没有备注但有名称字段，显示名称
3. **未命名版本**: 如果都没有，显示"未命名版本"

**建议**: 为每个临时修改版本添加有意义的备注，例如：
- "测试环境数据"
- "category=2的报告"
- "错误响应模拟"
- "延迟5秒测试"

这样在日志中可以快速识别命中的是哪个版本。

## 视觉效果

### 弹窗宽度
- 普通弹窗：1100px（原900px）
- 版本管理布局：1400px（原1200px）
- 最大宽度：95%（响应式）

### 版本名称样式
- 颜色：蓝色 (#007bff)
- 样式：下划线
- 鼠标：指针
- 提示：点击编辑此版本

### 高亮效果
- 阴影：`0 0 15px rgba(40, 167, 69, 0.6)` （绿色发光）
- 边框：`2px solid #28a745` （绿色实线）
- 动画：0.3秒过渡效果
- **持续时间：持续显示，直到关闭弹窗**

### 滚动行为
- 平滑滚动（`behavior: 'smooth'`）
- 居中显示（`block: 'center'`)

## 错误处理

- 如果路径没有临时修改版本，显示提示："该路径没有临时修改版本"
- 如果版本索引无效，显示提示："版本索引无效"
- 如果DOM元素未找到，静默失败（不影响其他功能）

## 使用场景

### 场景1: 调试条件匹配
当发现某个请求命中了意外的版本时，可以快速点击版本名称查看该版本的完整配置。

### 场景2: 快速修改
发现命中的版本需要调整时，点击版本名称直接进入编辑界面，无需在列表中查找。

### 场景3: 学习参考
查看实际命中的版本配置，学习如何配置条件匹配。

## 相关功能

- [临时修改匹配条件日志](./MATCH_INFO_LOGGING.md)
- [通配符条件匹配](./WILDCARD_MATCHING_UPDATE.md)
- [数组和嵌套对象参数匹配](./ARRAY_MATCHING_GUIDE.md)

## 更新日期

2026-03-20
