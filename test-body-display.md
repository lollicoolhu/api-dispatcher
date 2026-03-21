# 测试POST请求Body显示

## 问题排查

当前配置没有显示请求body，可能的原因：

### 1. 检查日志中是否有body字段
在浏览器控制台中运行：
```javascript
// 查看最新的日志
fetch('/admin/logs').then(r => r.json()).then(logs => {
  const postLogs = logs.filter(l => l.method === 'POST');
  console.log('POST请求数量:', postLogs.length);
  if (postLogs.length > 0) {
    console.log('最新POST请求:', postLogs[0]);
    console.log('body字段:', postLogs[0].body);
    console.log('body类型:', typeof postLogs[0].body);
    console.log('body长度:', postLogs[0].body ? postLogs[0].body.length : 0);
  }
});
```

### 2. 检查editLogOverride是否正确提取body
在 `editLogOverride` 函数中添加调试：
```javascript
// 在 editLogOverride 函数开始处添加
console.log('editLogOverride called with logId:', logId);
if (logId !== undefined) {
  const l = logs.find(log => log.id === logId);
  console.log('Found log:', l);
  console.log('Log method:', l?.method);
  console.log('Log body:', l?.body);
  console.log('requestBody will be:', l?.method === 'POST' && l?.body ? l.body : null);
}
```

### 3. 检查openModal是否收到requestBody
在 `openModal` 函数中添加调试：
```javascript
// 在 openModal 函数开始处添加
console.log('openModal called with requestBody:', requestBody);
console.log('requestBody type:', typeof requestBody);
console.log('requestBody length:', requestBody ? requestBody.length : 0);
```

### 4. 可能的问题

#### 问题A：请求体为空字符串
如果 `l.body` 是空字符串 `""`，条件 `l.body && l.body.length > 0` 会失败。

#### 问题B：请求体是对象而不是字符串
如果后端保存的是解析后的对象，需要先转换为字符串。

#### 问题C：Content-Type不是JSON
如果请求的 Content-Type 不是 `application/json`，可能需要特殊处理。

## 建议的修复

### 修复1：在editLogOverride中添加调试日志
```javascript
function editLogOverride(path, isLocalFile = false, logId) {
  // ... 现有代码 ...
  
  if (logId !== undefined) {
    const l = logs.find(log => log.id === logId);
    if (l) {
      // 添加调试
      console.log('=== editLogOverride Debug ===');
      console.log('Method:', l.method);
      console.log('Body:', l.body);
      console.log('Body type:', typeof l.body);
      console.log('Body length:', l.body ? l.body.length : 0);
      
      // ... 现有代码 ...
      
      // 保存请求body（如果是POST请求且有body）
      if (l.method === 'POST' && l.body) {
        requestBody = l.body;
        console.log('Setting requestBody:', requestBody);
      }
    }
  }
  
  console.log('Calling setTempOverride with requestBody:', requestBody);
  setTimeout(() => { setTempOverride(path, initialContent, isLocalFile, force, initialConditions, requestBody); }, 100);
}
```

### 修复2：在openModal中添加调试日志
```javascript
function openModal(title, path, content, onSave, showFileActions = false, showPriority = false, currentPriority = 1, currentRemark = '', showFolderSelect = false, saveBtnText = '', showConditions = false, currentConditions = [], currentConditionLogic = 'and', currentDelay = 0, requestBody = null) {
  console.log('=== openModal Debug ===');
  console.log('requestBody:', requestBody);
  console.log('requestBody type:', typeof requestBody);
  
  // ... 现有代码 ...
  
  // 显示/隐藏请求Body
  const requestBodyDiv = document.getElementById('modalRequestBodyDiv');
  const requestBodyPre = document.getElementById('modalRequestBody');
  console.log('requestBodyDiv:', requestBodyDiv);
  console.log('requestBodyPre:', requestBodyPre);
  
  if (requestBodyDiv && requestBodyPre) {
    if (requestBody) {
      console.log('Showing request body');
      requestBodyDiv.style.display = 'block';
      // ... 现有代码 ...
    } else {
      console.log('Hiding request body (requestBody is:', requestBody, ')');
      requestBodyDiv.style.display = 'none';
      window.currentModalRequestBody = null;
    }
  }
}
```

## 测试步骤

1. 在浏览器中打开开发者工具（F12）
2. 发送一个POST请求（带JSON body）
3. 在日志中找到该请求
4. 点击"修改返回"或"临时修改"
5. 查看控制台输出的调试信息
6. 根据调试信息确定问题所在
