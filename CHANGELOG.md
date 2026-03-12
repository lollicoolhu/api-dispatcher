# 更新日志

## 2026-03-12 - 临时修改多版本支持

### 新功能
- **临时修改支持多版本管理**
  - 每个接口可以创建多个临时修改版本
  - 同一时间只能启用一个版本
  - 每个版本独立管理优先级、备注和内容
  - 版本列表直接展示在临时修改列表中

### 界面改进
- **版本列表展示**
  - 每个接口显示为一个分组卡片
  - 卡片头部显示接口路径和版本数量
  - 每个版本单独一行，显示：
    - 启用/禁用复选框
    - 版本序号（版本1、版本2...）
    - 创建时间（月/日 时:分）
    - 备注标签
    - 优先级
    - 不可达原因（如果有）
    - 编辑和删除按钮
  - 卡片头部有"+ 新建版本"和"删除全部"按钮

- **操作按钮**
  - 每个接口卡片右上角有"+ 新建版本"按钮
  - 每个版本行有独立的"编辑"和"删除"按钮
  - 启用/禁用通过复选框直接操作
  - 删除全部按钮删除该接口的所有版本

### 用户体验优化（2026-03-12 更新）
1. **版本管理弹窗改进**
   - 默认展开已启用的版本，方便查看当前使用的内容
   - 未启用的版本默认折叠，保持界面简洁
   - 点击版本头部可展开/折叠详情

2. **日志中的临时修改**
   - 日志详情中点击"修改返回"按钮
   - 如果接口有多个版本，显示版本管理弹窗
   - 如果只有一个版本，直接编辑该版本
   - 如果没有版本，创建新版本

3. **自适应高度**
   - 日志列表高度根据窗口高度自动调整
   - 日志详情面板高度根据窗口高度自动调整
   - 版本管理弹窗中的版本列表高度自适应
   - 最小高度保证内容可见性
   - 使用 `calc(100vh - 280px)` 计算可用高度

### 数据结构变更
- `tempOverrides` 从对象格式改为数组格式
- 旧格式: `{ "/api/path": { content, enabled, priority, remark } }`
- 新格式: `{ "/api/path": [{ id, content, enabled, priority, remark, createdAt }] }`

### 前端功能
1. **版本列表管理**
   - 点击"编辑"按钮查看所有版本
   - 显示每个版本的状态、优先级、备注和创建时间
   - 支持启用/禁用、编辑、删除单个版本

2. **版本操作**
   - 创建新版本：自动生成唯一ID和时间戳
   - 启用版本：自动禁用其他版本
   - 编辑版本：修改内容、优先级、备注
   - 删除版本：可删除单个版本或全部版本

3. **界面优化**
   - 临时修改列表显示版本数量
   - 多版本接口显示"(X个版本)"标记
   - 版本管理窗口显示详细信息

### 后端API变更
- `POST /admin/overrides` 支持 `versionId` 参数
  - 不指定 `versionId`: 创建新版本
  - 指定 `versionId`: 更新现有版本
- `DELETE /admin/overrides` 支持删除单个版本或全部版本
  - 指定 `versionId`: 删除单个版本
  - 不指定 `versionId`: 删除全部版本

### 兼容性
- 自动转换旧格式数据到新格式
- 前端代码完全兼容新数组结构
- 后端请求处理逻辑支持多版本查找

### 使用示例

#### 创建新版本
```javascript
await fetch('/admin/overrides', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    path: '/api/test',
    content: '{"test": true}',
    enabled: true,
    priority: 1,
    remark: '测试版本'
  })
});
```

#### 更新现有版本
```javascript
await fetch('/admin/overrides', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    path: '/api/test',
    versionId: '1773307540545_9wwp65j4w',
    content: '{"test": false}',
    priority: 2
  })
});
```

#### 删除单个版本
```javascript
await fetch('/admin/overrides', {
  method: 'DELETE',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    path: '/api/test',
    versionId: '1773307540545_9wwp65j4w'
  })
});
```

### 注意事项
1. 每个接口同时只能有一个启用的版本
2. 启用新版本时会自动禁用其他版本
3. 版本ID由时间戳和随机字符串组成，保证唯一性
4. 删除所有版本后，接口将恢复使用本地文件或映射
