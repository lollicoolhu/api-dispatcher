// 状态变量
let entries = [], groups = {}, selectedIds = new Set(), expandedGroups = new Set(), activeId = null, activeTab = 'response';
let logs = [], expandedLogGroups = new Set(), activeLogIdx = null, logDetailTab = 'response', logRefreshTimer = null;
let localFiles = [], activeFilePath = null, overrides = {}, mappings = {}, folderMappings = {}, globalServer = {}, currentParseFolder = '';
let modalCallback = null, mappingTestTab = 'response';
let logBatchGroups = {}, logBatchSelectedIds = new Set(), logBatchExpandedGroups = new Set();
let publicFolders = [];

// 初始化
fetch('/admin/folder').then(r => r.json()).then(d => {
  document.getElementById('current').textContent = d.folder;
  loadPublicFolders(d.folder);
});
fetch('/admin/server-info').then(r => r.json()).then(d => {
  document.getElementById('serverAddrs').innerHTML = d.addresses.map(a => 
    '<a href="' + a + '/admin" target="_blank" style="margin-right:10px">' + a + '</a>'
  ).join('');
});
loadOverrides();
loadMappings();
loadFolderMappings();
loadGlobalServer();
loadCookieRewrite();

// 加载 public 文件夹列表
async function loadPublicFolders(currentFolder) {
  const res = await fetch('/admin/public-folders');
  const data = await res.json();
  publicFolders = data.folders || [];
  
  // 更新设置页面的文件夹下拉框
  const select = document.getElementById('folderSelect');
  select.innerHTML = publicFolders.map(f => 
    '<option value="' + f.path + '"' + (f.path === currentFolder ? ' selected' : '') + '>' + f.name + '</option>'
  ).join('');
  
  if (publicFolders.length === 0) {
    select.innerHTML = '<option value="">无可用文件夹</option>';
  }
  
  // 更新 HAR 解析页面的输出文件夹下拉框
  const harSelect = document.getElementById('outputFolder');
  if (harSelect) {
    harSelect.innerHTML = publicFolders.map(f => 
      '<option value="' + f.path + '"' + (f.path === currentFolder ? ' selected' : '') + '>' + f.name + '</option>'
    ).join('');
    if (publicFolders.length === 0) {
      harSelect.innerHTML = '<option value="public/mock">mock</option>';
    }
  }
  
  // 更新服务器页面的文件夹下拉框
  const serverSelect = document.getElementById('serverFolderSelect');
  if (serverSelect) {
    serverSelect.innerHTML = publicFolders.map(f => 
      '<option value="' + f.path + '"' + (f.path === currentFolder ? ' selected' : '') + '>' + f.name + '</option>'
    ).join('');
    if (publicFolders.length === 0) {
      serverSelect.innerHTML = '<option value="">无可用服务器</option>';
    }
  }
}

// 刷新文件夹列表
async function refreshFolderList() {
  const res = await fetch('/admin/folder');
  const data = await res.json();
  await loadPublicFolders(data.folder);
}

// 切换文件夹
async function switchFolder() {
  const folder = document.getElementById('folderSelect').value;
  if (!folder) return;
  
  const res = await fetch('/admin/folder', { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ folder }) 
  });
  const data = await res.json();
  
  if (data.success) {
    document.getElementById('current').textContent = data.folder;
    alert('切换成功');
  } else {
    alert(data.error || '切换失败');
  }
}

// Tab切换
function showTab(name) {
  document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelector('.tabs .tab[onclick*="' + name + '"]').classList.add('active');
  document.getElementById(name).classList.add('active');
  if (name === 'logs') { refreshLogs(); startAutoRefresh(); }
  else { stopAutoRefresh(); }
}

// 自动刷新
function startAutoRefresh() {
  if (logRefreshTimer) return;
  if (document.getElementById('logAutoRefresh').checked) {
    const interval = parseInt(document.getElementById('logRefreshInterval').value) || 1000;
    logRefreshTimer = setInterval(refreshLogs, interval);
  }
}
function stopAutoRefresh() {
  if (logRefreshTimer) { clearInterval(logRefreshTimer); logRefreshTimer = null; }
  document.getElementById('logAutoRefresh').checked = false;
}
function toggleAutoRefresh() {
  if (document.getElementById('logAutoRefresh').checked) startAutoRefresh();
  else stopAutoRefresh();
}
function updateRefreshInterval() {
  stopAutoRefresh();
  document.getElementById('logAutoRefresh').checked = true;
  startAutoRefresh();
}
document.getElementById('logList').addEventListener('scroll', function() {
  if (this.scrollTop > 50) stopAutoRefresh();
});

// ========== 全局服务器 ==========
async function loadGlobalServer() {
  const res = await fetch('/admin/global-server');
  globalServer = await res.json();
  document.getElementById('globalServerEnabled').checked = globalServer.enabled || false;
  document.getElementById('globalServerUrl').value = globalServer.url || '';
  document.getElementById('globalServerPriority').value = globalServer.priority ?? 100;
}

async function updateGlobalServer() {
  const enabled = document.getElementById('globalServerEnabled').checked;
  const url = document.getElementById('globalServerUrl').value.trim();
  const priority = parseInt(document.getElementById('globalServerPriority').value) || 100;
  await fetch('/admin/global-server', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled, url, priority }) });
  globalServer = { enabled, url, priority };
}

// ========== Cookie重写 ==========
async function loadCookieRewrite() {
  const res = await fetch('/admin/cookie-rewrite');
  const data = await res.json();
  document.getElementById('cookieRewriteEnabled').checked = data.enabled !== false;
}

async function updateCookieRewrite() {
  const enabled = document.getElementById('cookieRewriteEnabled').checked;
  await fetch('/admin/cookie-rewrite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
}

// ========== 映射管理 ==========
let mappingTestData = null; // 缓存测试结果

async function loadMappings() {
  const res = await fetch('/admin/mappings');
  mappings = await res.json();
  renderMappings();
}

function renderMappings() {
  const list = document.getElementById('mappingList');
  const paths = Object.keys(mappings);
  document.getElementById('mappingCount').textContent = '(' + paths.length + ')';
  if (paths.length === 0) { list.innerHTML = '<em>无URL映射</em>'; return; }
  list.innerHTML = paths.map(p => {
    const m = mappings[p];
    const isWildcard = p.endsWith('*');
    const disabled = !m.enabled;
    const remarkHtml = m.remark ? '<span class="remark-tag" data-remark="' + escapeHtml(m.remark) + '">' + escapeHtml(m.remark) + '</span>' : '';
    return '<div class="mapping-item' + (disabled ? ' disabled' : '') + '">' +
    '<input type="checkbox" ' + (m.enabled ? 'checked' : '') + ' onchange="toggleMappingEnabled(\'' + p.replace(/'/g, "\\'") + '\', this.checked)" title="启用/禁用">' +
    '<span class="path">' + p + (isWildcard ? ' <span style="color:#17a2b8;font-size:10px">(前缀)</span>' : '') + '</span>' +
    '<span class="target">→ ' + m.target + '</span>' +
    remarkHtml +
    '<label style="display:flex;align-items:center;gap:3px"><span style="font-size:10px;color:#666">优先级:</span><input type="number" value="' + (m.priority ?? 1) + '" style="width:50px;padding:2px 4px;font-size:11px" onchange="updateMappingPriority(\'' + p.replace(/'/g, "\\'") + '\', this.value)" title="数字越大优先级越高"></label>' +
    '<button class="btn btn-sm btn-info" onclick="openMappingModal(\'' + p.replace(/'/g, "\\'") + '\')">编辑</button>' +
    '<button class="btn btn-sm btn-danger" onclick="removeMapping(\'' + p.replace(/'/g, "\\'") + '\')">删除</button></div>';
  }).join('');
}

async function toggleMappingEnabled(apiPath, enabled) {
  await fetch('/admin/mappings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: apiPath, enabled }) });
  mappings[apiPath].enabled = enabled;
  renderMappings();
}

async function updateMappingPriority(apiPath, priority) {
  const p = parseInt(priority) || 1;
  await fetch('/admin/mappings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: apiPath, priority: p }) });
  mappings[apiPath].priority = p;
  renderMappings();
}

async function removeMapping(apiPath) {
  await fetch('/admin/mappings', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: apiPath }) });
  loadMappings();
}

function openMappingModal(apiPath) {
  document.getElementById('mappingPath').value = apiPath || '';
  const m = mappings[apiPath] || {};
  document.getElementById('mappingTarget').value = m.target || '';
  document.getElementById('mappingPriority').value = m.priority ?? 1;
  document.getElementById('mappingRemark').value = m.remark || '';
  document.getElementById('mappingTestPath').value = apiPath && !apiPath.endsWith('*') ? apiPath : '';
  document.getElementById('mappingTestResult').classList.add('hidden');
  mappingTestData = null;
  document.getElementById('mappingModal').classList.add('active');
}

function closeMappingModal() {
  document.getElementById('mappingModal').classList.remove('active');
  mappingTestData = null;
}

async function saveMappingFromModal() {
  const apiPath = document.getElementById('mappingPath').value.trim();
  const target = document.getElementById('mappingTarget').value.trim();
  const priority = parseInt(document.getElementById('mappingPriority').value) || 1;
  const remark = document.getElementById('mappingRemark').value.trim();
  if (!apiPath) return alert('请输入接口路径');
  if (!target) return alert('请输入映射目标地址');
  await fetch('/admin/mappings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: apiPath, target, enabled: true, priority, remark }) });
  loadMappings();
  closeMappingModal();
  if (activeLogIdx !== null) showLogDetail(activeLogIdx);
}

async function testMapping() {
  const testPath = document.getElementById('mappingTestPath').value.trim();
  const target = document.getElementById('mappingTarget').value.trim();
  if (!target) return alert('请输入映射目标地址');
  if (!testPath) return alert('请输入测试路径');
  const resultDiv = document.getElementById('mappingTestResult');
  resultDiv.innerHTML = '<em>测试中...</em>';
  resultDiv.classList.remove('hidden');
  try {
    const res = await fetch('/admin/test-mapping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: testPath, target }) });
    mappingTestData = await res.json();
    renderMappingTestResult();
  } catch (e) {
    resultDiv.innerHTML = '<span style="color:#dc3545">测试失败: ' + e.message + '</span>';
    mappingTestData = null;
  }
}

function renderMappingTestResult() {
  if (!mappingTestData) return;
  const data = mappingTestData;
  const resultDiv = document.getElementById('mappingTestResult');
  const tabBtn = (name, label) => '<button class="detail-tab' + (mappingTestTab === name ? ' active' : '') + '" onclick="switchMappingTestTab(\'' + name + '\')">' + label + '</button>';
  const headerTable = (headers) => {
    if (!headers || Object.keys(headers).length === 0) return '<em>无</em>';
    return '<table>' + Object.entries(headers).map(([k, v]) => '<tr><td>' + k + '</td><td>' + v + '</td></tr>').join('') + '</table>';
  };
  let body = data.body || '';
  try { body = JSON.stringify(JSON.parse(body), null, 2); } catch { }
  const statusClass = data.status >= 200 && data.status < 300 ? 'status-2xx' : data.status >= 400 && data.status < 500 ? 'status-4xx' : 'status-5xx';
  
  // Request tab 内容
  const requestContent = 
    '<div style="margin-bottom:10px"><strong>请求信息</strong></div>' +
    '<div class="detail-content" style="max-height:80px;margin-bottom:10px"><table>' +
    '<tr><td>方法</td><td>GET</td></tr>' +
    '<tr><td>目标URL</td><td>' + data.url + '</td></tr>' +
    '</table></div>' +
    '<div style="margin-bottom:10px"><strong>请求 Headers</strong></div>' +
    '<div class="detail-content" style="max-height:120px">' + headerTable(data.reqHeaders || {}) + '</div>';
  
  // Response tab 内容
  const responseContent = 
    '<div class="detail-content" style="max-height:180px;margin-bottom:10px"><pre>' + escapeHtml(body) + '</pre></div>' +
    '<div style="margin-bottom:10px"><strong>响应 Headers (' + (data.headers ? Object.keys(data.headers).length : 0) + ')</strong></div>' +
    '<div class="detail-content" style="max-height:120px">' + headerTable(data.headers) + '</div>';
  
  resultDiv.innerHTML =
    '<div class="meta-row"><div class="meta-item">状态: <span class="status-code ' + statusClass + '">' + data.status + '</span></div><div class="meta-item">耗时: ' + data.time + 'ms</div><div class="meta-item">大小: ' + formatSize(data.size) + '</div></div>' +
    '<div style="font-family:monospace;font-size:11px;margin-bottom:10px;color:#666;word-break:break-all">' + data.url + '</div>' +
    '<div class="detail-tabs">' + tabBtn('response', 'Response') + tabBtn('request', 'Request') + '</div>' +
    '<div class="tab-content' + (mappingTestTab === 'response' ? ' active' : '') + '">' + responseContent + '</div>' +
    '<div class="tab-content' + (mappingTestTab === 'request' ? ' active' : '') + '">' + requestContent + '</div>';
}

function switchMappingTestTab(tab) { 
  mappingTestTab = tab; 
  renderMappingTestResult(); // 只重新渲染，不重新请求
}


// ========== 文件夹映射管理 ==========
async function loadFolderMappings() {
  const res = await fetch('/admin/folder-mappings');
  folderMappings = await res.json();
  renderFolderMappings();
}

function renderFolderMappings() {
  const list = document.getElementById('folderMappingList');
  const patterns = Object.keys(folderMappings);
  document.getElementById('folderMappingCount').textContent = '(' + patterns.length + ')';
  if (patterns.length === 0) { list.innerHTML = '<em>无文件夹映射</em>'; return; }
  list.innerHTML = patterns.map(p => {
    const m = folderMappings[p];
    const isWildcard = p.endsWith('*');
    const disabled = !m.enabled;
    // 检查文件夹是否存在
    const folderExists = publicFolders.some(f => f.path === m.folder);
    const unreachable = m.enabled && !folderExists;
    const remarkHtml = m.remark ? '<span class="remark-tag" data-remark="' + escapeHtml(m.remark) + '">' + escapeHtml(m.remark) + '</span>' : '';
    return '<div class="mapping-item' + (disabled ? ' disabled' : '') + (unreachable ? ' unreachable' : '') + '">' +
    '<input type="checkbox" ' + (m.enabled ? 'checked' : '') + ' onchange="toggleFolderMappingEnabled(\'' + p.replace(/'/g, "\\'") + '\', this.checked)" title="启用/禁用">' +
    '<span class="path">' + p + (isWildcard ? ' <span style="color:#17a2b8;font-size:10px">(前缀)</span>' : '') + '</span>' +
    '<span class="target">→ ' + m.folder + (unreachable ? ' <span style="color:#dc3545;font-size:10px">(不可达)</span>' : '') + '</span>' +
    remarkHtml +
    '<label style="display:flex;align-items:center;gap:3px"><span style="font-size:10px;color:#666">优先级:</span><input type="number" value="' + (m.priority ?? 1) + '" style="width:50px;padding:2px 4px;font-size:11px" onchange="updateFolderMappingPriority(\'' + p.replace(/'/g, "\\'") + '\', this.value)" title="数字越大优先级越高"></label>' +
    '<button class="btn btn-sm btn-info" onclick="openFolderMappingModal(\'' + p.replace(/'/g, "\\'") + '\')">编辑</button>' +
    '<button class="btn btn-sm btn-danger" onclick="removeFolderMapping(\'' + p.replace(/'/g, "\\'") + '\')">删除</button></div>';
  }).join('');
}

async function toggleFolderMappingEnabled(pattern, enabled) {
  await fetch('/admin/folder-mappings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pattern, enabled }) });
  folderMappings[pattern].enabled = enabled;
  renderFolderMappings();
}

async function updateFolderMappingPriority(pattern, priority) {
  const p = parseInt(priority) || 1;
  await fetch('/admin/folder-mappings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pattern, priority: p }) });
  folderMappings[pattern].priority = p;
}

async function removeFolderMapping(pattern) {
  await fetch('/admin/folder-mappings', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pattern }) });
  loadFolderMappings();
}

function openFolderMappingModal(pattern) {
  document.getElementById('folderMappingPattern').value = pattern || '';
  const m = folderMappings[pattern] || {};
  document.getElementById('folderMappingPriority').value = m.priority ?? 1;
  document.getElementById('folderMappingRemark').value = m.remark || '';
  
  // 填充文件夹下拉框
  const select = document.getElementById('folderMappingFolder');
  select.innerHTML = publicFolders.map(f => 
    '<option value="' + f.path + '"' + (f.path === m.folder ? ' selected' : '') + '>' + f.name + ' (' + f.path + ')</option>'
  ).join('');
  
  document.getElementById('folderMappingModal').classList.add('active');
}

function closeFolderMappingModal() {
  document.getElementById('folderMappingModal').classList.remove('active');
}

async function saveFolderMappingFromModal() {
  const pattern = document.getElementById('folderMappingPattern').value.trim();
  const folder = document.getElementById('folderMappingFolder').value;
  const priority = parseInt(document.getElementById('folderMappingPriority').value) || 1;
  const remark = document.getElementById('folderMappingRemark').value.trim();
  if (!pattern) return alert('请输入匹配路径');
  if (!folder) return alert('请选择映射文件夹');
  await fetch('/admin/folder-mappings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pattern, folder, enabled: true, priority, remark }) });
  loadFolderMappings();
  closeFolderMappingModal();
}


// ========== Confirm Modal ==========
let confirmResolveCallback = null;

function showConfirm(message, title = '确认', okText = '确定', isDanger = true) {
  return new Promise(resolve => {
    confirmResolveCallback = resolve;
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').innerHTML = message;
    const okBtn = document.getElementById('confirmOkBtn');
    okBtn.textContent = okText;
    okBtn.className = 'btn ' + (isDanger ? 'btn-danger' : 'btn-primary');
    document.getElementById('confirmModal').classList.add('active');
  });
}

function confirmResolve(result) {
  document.getElementById('confirmModal').classList.remove('active');
  if (confirmResolveCallback) {
    confirmResolveCallback(result);
    confirmResolveCallback = null;
  }
}

// ========== JSON Editor Modal ==========
let currentModalPath = '';

function openModal(title, path, content, onSave, showFileActions = false, showPriority = false, currentPriority = 1, currentRemark = '') {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalPath').textContent = path;
  document.getElementById('jsonEditor').value = content;
  document.getElementById('jsonError').textContent = '';
  currentModalPath = path;
  modalCallback = onSave;
  
  // 显示/隐藏永久保存和删除按钮
  document.getElementById('modalPermanentBtn').style.display = showFileActions ? 'inline-block' : 'none';
  document.getElementById('modalDeleteBtn').style.display = showFileActions ? 'inline-block' : 'none';
  
  // 显示/隐藏优先级输入
  const priorityDiv = document.getElementById('modalPriorityDiv');
  if (showPriority) {
    priorityDiv.style.display = 'flex';
    document.getElementById('modalPriority').value = currentPriority;
  } else {
    priorityDiv.style.display = 'none';
  }
  
  // 显示/隐藏备注输入
  const remarkDiv = document.getElementById('modalRemarkDiv');
  if (showPriority) {
    remarkDiv.style.display = 'block';
    document.getElementById('modalRemark').value = currentRemark || '';
  } else {
    remarkDiv.style.display = 'none';
  }
  
  document.getElementById('jsonModal').classList.add('active');
}

function closeModal() {
  document.getElementById('jsonModal').classList.remove('active');
  modalCallback = null;
  currentModalPath = '';
}

function formatJson() {
  // 只对 JSON 路径格式化
  if (!isJsonPath(currentModalPath)) {
    document.getElementById('jsonError').textContent = '非 JSON 文件，无需格式化';
    return;
  }
  const editor = document.getElementById('jsonEditor');
  try {
    editor.value = JSON.stringify(JSON.parse(editor.value), null, 2);
    document.getElementById('jsonError').textContent = '';
  } catch (e) {
    document.getElementById('jsonError').textContent = 'JSON 格式错误: ' + e.message;
  }
}

// 判断路径是否需要 JSON 格式
function isJsonPath(path) {
  if (!path) return true;
  const ext = path.split('.').pop().toLowerCase();
  const nonJsonExts = ['html', 'htm', 'js', 'css', 'txt', 'xml', 'svg', 'md'];
  return !nonJsonExts.includes(ext);
}

document.getElementById('modalSaveBtn').onclick = async function() {
  const content = document.getElementById('jsonEditor').value;
  // 只对 JSON 路径校验格式
  if (isJsonPath(currentModalPath)) {
    try {
      JSON.parse(content);
    } catch (e) {
      document.getElementById('jsonError').textContent = 'JSON 格式错误: ' + e.message;
      return;
    }
  }
  if (modalCallback) await modalCallback(content);
  closeModal();
};

async function savePermanentFromModal() {
  const content = document.getElementById('jsonEditor').value;
  // 只对 JSON 路径校验格式
  if (isJsonPath(currentModalPath)) {
    try {
      JSON.parse(content);
    } catch (e) {
      document.getElementById('jsonError').textContent = 'JSON 格式错误: ' + e.message;
      return;
    }
  }
  const confirmed = await showConfirm('确定永久保存到本地文件？<br><br><span style="color:#666;font-size:12px">' + currentModalPath + '</span>', '永久保存', '保存', false);
  if (!confirmed) return;
  const res = await fetch('/admin/file/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: currentModalPath, content }) });
  const result = await res.json();
  if (result.success) {
    alert('永久保存成功');
    closeModal();
    if (activeLogIdx !== null) refreshLogs();
  } else {
    alert('保存失败: ' + result.error);
  }
}

async function deleteFileFromModal() {
  const confirmed1 = await showConfirm('确定删除本地文件？<br><br><span style="color:#666;font-size:12px">' + currentModalPath + '</span>', '删除文件', '删除');
  if (!confirmed1) return;
  const confirmed2 = await showConfirm('<strong style="color:#dc3545">删除后无法恢复！</strong><br><br>再次确认删除？', '二次确认', '确认删除');
  if (!confirmed2) return;
  const res = await fetch('/admin/file/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: currentModalPath }) });
  const result = await res.json();
  if (result.success) {
    alert('删除成功');
    closeModal();
    if (activeLogIdx !== null) refreshLogs();
  } else {
    alert('删除失败: ' + result.error);
  }
}

// ========== 临时覆盖管理 ==========
async function loadOverrides() {
  const res = await fetch('/admin/overrides');
  overrides = await res.json();
  renderOverrides();
}

function renderOverrides() {
  const list = document.getElementById('overrideList');
  const paths = Object.keys(overrides);
  document.getElementById('overrideCount').textContent = '(' + paths.length + ')';
  if (paths.length === 0) { list.innerHTML = '<em>无临时修改</em>'; return; }
  list.innerHTML = paths.map(p => {
    const o = overrides[p];
    const disabled = !o.enabled;
    // 检查 JSON 是否有效（仅对 JSON 路径）
    let jsonInvalid = false;
    if (o.enabled && isJsonPath(p)) {
      try { JSON.parse(o.content || ''); } catch { jsonInvalid = true; }
    }
    const remarkHtml = o.remark ? '<span class="remark-tag" data-remark="' + escapeHtml(o.remark) + '">' + escapeHtml(o.remark) + '</span>' : '';
    return '<div class="override-item' + (disabled ? ' disabled' : '') + (jsonInvalid ? ' unreachable' : '') + '">' +
    '<input type="checkbox" ' + (o.enabled ? 'checked' : '') + ' onchange="toggleOverrideEnabled(\'' + p.replace(/'/g, "\\'") + '\', this.checked)" title="启用/禁用">' +
    '<span class="path">' + p + (jsonInvalid ? ' <span style="color:#dc3545;font-size:10px">(JSON无效)</span>' : '') + '</span>' +
    remarkHtml +
    '<label style="display:flex;align-items:center;gap:3px"><span style="font-size:10px;color:#666">优先级:</span><input type="number" value="' + (o.priority ?? 1) + '" style="width:50px;padding:2px 4px;font-size:11px" onchange="updateOverridePriority(\'' + p.replace(/'/g, "\\'") + '\', this.value)" title="数字越大优先级越高"></label>' +
    '<button class="btn btn-sm btn-primary" onclick="editOverride(\'' + p.replace(/'/g, "\\'") + '\')">编辑</button>' +
    '<button class="btn btn-sm btn-danger" onclick="removeOverride(\'' + p.replace(/'/g, "\\'") + '\')">删除</button></div>';
  }).join('');
}

async function toggleOverrideEnabled(path, enabled) {
  await fetch('/admin/overrides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, enabled }) });
  overrides[path].enabled = enabled;
  renderOverrides();
}

async function updateOverridePriority(path, priority) {
  const p = parseInt(priority) || 1;
  await fetch('/admin/overrides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, priority: p }) });
  overrides[path].priority = p;
  renderOverrides();
}

async function removeOverride(path) {
  await fetch('/admin/overrides', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
  loadOverrides();
}

async function editOverride(path) {
  const o = overrides[path] || {};
  let content = o.content || '';
  const currentPriority = o.priority ?? 1;
  const currentRemark = o.remark || '';
  try { content = JSON.stringify(JSON.parse(content), null, 2); } catch { }
  openModal('编辑临时返回值', path, content, async (newContent) => {
    const priority = parseInt(document.getElementById('modalPriority').value) || 1;
    const remark = document.getElementById('modalRemark').value.trim();
    await fetch('/admin/overrides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, content: newContent, priority, remark }) });
    loadOverrides();
  }, false, true, currentPriority, currentRemark);
}

async function setTempOverride(path, originalContent, showFileActions = false) {
  const o = overrides[path] || {};
  let content = o.content || originalContent;
  const currentPriority = o.priority ?? 1;
  const currentRemark = o.remark || '';
  try { content = JSON.stringify(JSON.parse(content), null, 2); } catch { }
  openModal('修改返回值', path, content, async (newContent) => {
    const priority = parseInt(document.getElementById('modalPriority').value) || 1;
    const remark = document.getElementById('modalRemark').value.trim();
    await fetch('/admin/overrides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, content: newContent, enabled: true, priority, remark }) });
    loadOverrides();
    if (activeLogIdx !== null) showLogDetail(activeLogIdx);
  }, showFileActions, true, currentPriority, currentRemark);
}

// ========== 服务器文件管理 ==========
function initServerFolderSelect() {
  const select = document.getElementById('serverFolderSelect');
  const currentFolder = document.getElementById('folderSelect')?.value || '';
  select.innerHTML = publicFolders.map(f => 
    '<option value="' + f.path + '"' + (f.path === currentFolder ? ' selected' : '') + '>' + f.name + '</option>'
  ).join('');
  if (publicFolders.length === 0) {
    select.innerHTML = '<option value="">无可用服务器</option>';
  }
}

async function refreshServerList() {
  await refreshFolderList();
  initServerFolderSelect();
}

async function parseSelectedServer() {
  const folder = document.getElementById('serverFolderSelect').value;
  if (!folder) return;
  currentParseFolder = folder;
  const res = await fetch('/admin/files?folder=' + encodeURIComponent(folder));
  const data = await res.json();
  if (data.error) { alert(data.error); return; }
  localFiles = data.files || [];
  document.getElementById('fileCount').textContent = localFiles.length;
  document.getElementById('parseFolderInfo').textContent = '当前: ' + folder;
  document.getElementById('fileDetailPanel').classList.remove('active');
  activeFilePath = null;
  filterFiles();
}

function filterFiles() {
  const search = document.getElementById('fileSearch').value.toLowerCase();
  const filtered = localFiles.filter(f => !search || f.path.toLowerCase().includes(search));
  document.getElementById('fileList').innerHTML = filtered.map(f =>
    '<div class="file-item' + (activeFilePath === f.path ? ' active' : '') + '" onclick="showFileDetail(\'' + f.path.replace(/'/g, "\\'") + '\')">' + f.path + '</div>'
  ).join('');
}

async function showFileDetail(filePath) {
  activeFilePath = filePath;
  filterFiles();
  const panel = document.getElementById('fileDetailPanel');
  const file = localFiles.find(f => f.path === filePath);
  if (!file) return;
  let content = file.content;
  try { content = JSON.stringify(JSON.parse(content), null, 2); } catch { }
  const hasOverride = overrides[filePath];
  const hasMapping = mappings[filePath];
  panel.innerHTML =
    '<div class="meta-row"><div class="meta-item">' + filePath + '</div>' +
    (hasOverride ? '<div class="meta-item"><span class="badge badge-override">已临时修改</span></div>' : '') +
    (hasMapping ? '<div class="meta-item"><span class="badge badge-mapping">已映射</span></div>' : '') + '</div>' +
    '<div class="detail-content" style="max-height:380px"><pre>' + escapeHtml(content) + '</pre></div>' +
    '<div style="margin-top:10px"><button class="btn btn-primary" onclick="editLocalFile(\'' + filePath.replace(/'/g, "\\'") + '\')">永久修改</button> ' +
    '<button class="btn btn-warning" onclick="setTempOverrideFromFile(\'' + filePath.replace(/'/g, "\\'") + '\')">临时修改</button>' +
    (hasOverride ? ' <button class="btn btn-danger" onclick="removeOverrideAndRefresh(\'' + filePath.replace(/'/g, "\\'") + '\')">取消临时</button>' : '') + '</div>';
  panel.classList.add('active');
}

function editLocalFile(filePath) {
  const file = localFiles.find(f => f.path === filePath);
  if (!file) return;
  let content = file.content;
  try { content = JSON.stringify(JSON.parse(content), null, 2); } catch { }
  openModal('永久修改文件', filePath, content, async (newContent) => {
    const res = await fetch('/admin/file/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: currentParseFolder, path: filePath, content: newContent }) });
    const result = await res.json();
    if (result.success) { alert('保存成功'); parseSelectedServer(); }
    else alert('保存失败: ' + result.error);
  });
}

function setTempOverrideFromFile(filePath) {
  const file = localFiles.find(f => f.path === filePath);
  if (file) setTempOverride(filePath, file.content);
}

async function removeOverrideAndRefresh(path) {
  await removeOverride(path);
  showFileDetail(path);
}

// ========== 工具函数 ==========
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatSize(b) {
  return b < 1024 ? b + 'B' : b < 1048576 ? (b / 1024).toFixed(1) + 'K' : (b / 1048576).toFixed(1) + 'M';
}

// 判断 content-type 是否可以直接展示
function isDisplayableContentType(contentType) {
  if (!contentType) return true;
  const type = contentType.toLowerCase();
  const displayable = [
    'text/', 'application/json', 'application/xml', 'application/javascript',
    'application/x-www-form-urlencoded', 'image/svg+xml'
  ];
  return displayable.some(t => type.includes(t));
}

// 判断是否是图片类型
function isImageContentType(contentType) {
  if (!contentType) return false;
  const type = contentType.toLowerCase();
  return type.includes('image/');
}

// 渲染响应内容（支持展示或下载）
function renderResponseContent(body, headers, id, isBase64) {
  const contentType = headers && (headers['content-type'] || headers['Content-Type']) || '';
  const size = body ? body.length : 0;
  
  // 图片类型，直接展示
  if (isImageContentType(contentType)) {
    const base64Data = isBase64 ? body : btoa(body);
    return '<div style="text-align:center;padding:10px">' +
      '<img src="data:' + contentType.split(';')[0] + ';base64,' + base64Data + '" style="max-width:100%;max-height:400px" />' +
      '<div style="color:#666;margin-top:10px;font-size:11px">' + escapeHtml(contentType) + ' · ' + formatSize(size) + '</div>' +
      '</div>';
  }
  
  if (!isDisplayableContentType(contentType)) {
    // 不可展示的类型，显示下载按钮
    return '<div style="text-align:center;padding:20px">' +
      '<div style="color:#666;margin-bottom:10px">内容类型: ' + escapeHtml(contentType) + '</div>' +
      '<div style="color:#666;margin-bottom:15px">大小: ' + formatSize(size) + '</div>' +
      '<button class="btn btn-primary" onclick="downloadResponseContent(\'' + id + '\')">下载内容</button>' +
      '</div>';
  }
  
  // 可展示的类型
  let formatted = body || '';
  try { formatted = JSON.stringify(JSON.parse(formatted), null, 2); } catch { }
  return '<pre>' + escapeHtml(formatted) + '</pre>';
}

// 下载响应内容
function downloadResponseContent(logIdx) {
  const l = logs[logIdx];
  if (!l) return;
  const body = l.mappingResponse ? l.mappingResponse.body : window.currentLogResponse;
  const contentType = l.mappingResponse ? 
    (l.mappingResponse.headers['content-type'] || l.mappingResponse.headers['Content-Type'] || 'application/octet-stream') :
    'application/octet-stream';
  
  // 根据 content-type 确定文件扩展名
  let ext = '.bin';
  if (contentType.includes('image/png')) ext = '.png';
  else if (contentType.includes('image/jpeg')) ext = '.jpg';
  else if (contentType.includes('image/gif')) ext = '.gif';
  else if (contentType.includes('image/webp')) ext = '.webp';
  else if (contentType.includes('application/pdf')) ext = '.pdf';
  else if (contentType.includes('application/zip')) ext = '.zip';
  
  const filename = l.path.replace(/\//g, '_').substring(1) + ext;
  const blob = new Blob([body], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// 解析 x-bbae-page header
// 格式: Activity>Fragment#层数*可见,Fragment#层数...
function parsePageInfo(pageHeader) {
  if (!pageHeader) return null;
  try {
    const parts = pageHeader.split('>');
    const activity = parts[0] || '';
    const fragments = [];
    if (parts.length > 1) {
      const fragParts = parts.slice(1).join('>').split(',');
      fragParts.forEach(frag => {
        if (!frag.trim()) return;
        const visible = frag.includes('*');
        const cleanFrag = frag.replace('*', '');
        const match = cleanFrag.match(/^(.+?)#(\d+)$/);
        if (match) {
          fragments.push({ name: match[1], depth: parseInt(match[2]), visible });
        } else {
          fragments.push({ name: cleanFrag, depth: 0, visible });
        }
      });
    }
    return { activity, fragments };
  } catch (e) {
    return null;
  }
}

function renderPageInfo(pageHeader) {
  const info = parsePageInfo(pageHeader);
  if (!info) return '<em>无页面信息</em>';
  
  let html = '<div style="margin-bottom:12px"><strong>Activity</strong></div>';
  html += '<div class="detail-content" style="padding:10px;margin-bottom:15px"><span style="color:#007bff;font-weight:bold">' + escapeHtml(info.activity) + '</span></div>';
  
  if (info.fragments.length > 0) {
    html += '<div style="margin-bottom:10px"><strong>Fragments</strong></div>';
    html += '<div class="detail-content" style="padding:10px;font-family:monospace;font-size:12px">';
    info.fragments.forEach((f) => {
      const tabs = '\t'.repeat(f.depth);
      const color = f.visible ? '#28a745' : '#666';
      const weight = f.visible ? 'bold' : 'normal';
      html += '<pre style="margin:0;color:' + color + ';font-weight:' + weight + '">' + tabs + escapeHtml(f.name) + '</pre>';
    });
    html += '</div>';
  }
  
  html += '<div style="margin-top:15px;margin-bottom:10px"><strong>原始数据</strong></div>';
  html += '<div class="detail-content" style="padding:10px;font-size:11px;word-break:break-all;color:#666">' + escapeHtml(pageHeader) + '</div>';
  
  return html;
}


// ========== 访问日志 ==========
async function refreshLogs() {
  const res = await fetch('/admin/logs');
  logs = await res.json();
  document.getElementById('logCount').textContent = logs.length;
  renderLogs();
}

async function clearLogs() {
  const confirmed = await showConfirm('确定清空所有日志?', '清空日志', '清空');
  if (!confirmed) return;
  await fetch('/admin/logs', { method: 'DELETE' });
  activeLogIdx = null;
  document.getElementById('logDetailPanel').classList.remove('active');
  refreshLogs();
}

function renderLogs() {
  const search = document.getElementById('logSearch').value.toLowerCase();
  const statusFilter = document.getElementById('logStatusFilter').value;
  const groupSame = document.getElementById('logGroupSame').checked;
  const groupByParent = document.getElementById('logGroupByParent').checked;
  let filtered = logs.map((l, i) => ({ ...l, idx: i })).filter(l => {
    if (search && !l.path.toLowerCase().includes(search)) return false;
    if (statusFilter === 'found' && l.found !== true) return false;
    if (statusFilter === 'mapping' && l.found !== 'mapping') return false;
    if (statusFilter === 'missing' && (l.found === true || l.found === 'mapping')) return false;
    return true;
  });
  const container = document.getElementById('logList');
  const getStatusClass = (found) => found === true ? 'found' : found === 'mapping' ? 'mapping' : 'missing';
  const getStatusText = (found) => found === true ? '✓' : found === 'mapping' ? '⇄' : '404';
  
  // 计算时间差
  const formatTimeAgo = (timeStr) => {
    const now = new Date();
    const time = new Date(timeStr.replace(/\//g, '-'));
    const diff = Math.floor((now - time) / 1000);
    if (diff < 60) return diff + '秒前';
    if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
    return Math.floor(diff / 86400) + '天前';
  };
  
  // 获取文件类型标签
  const getFileTypeTag = (path) => {
    const ext = path.split('.').pop().toLowerCase();
    const types = { js: 'JS', css: 'CSS', html: 'HTML', htm: 'HTML', json: 'JSON', png: 'IMG', jpg: 'IMG', jpeg: 'IMG', gif: 'IMG', svg: 'SVG', woff: 'FONT', woff2: 'FONT', ttf: 'FONT' };
    return types[ext] || '';
  };

  // 按父请求分组（HTML页面及其资源）
  if (groupByParent) {
    // 找出所有 HTML 请求作为父请求
    const parentLogs = [];
    const childrenMap = {}; // parentPath -> children[]
    
    filtered.forEach(l => {
      const isHtml = l.path.endsWith('.html') || l.path.endsWith('.htm') || 
                     (l.mappingResponse && l.mappingResponse.headers && 
                      (l.mappingResponse.headers['content-type'] || '').includes('text/html'));
      
      if (l.parentPath && !isHtml) {
        // 有父请求的子资源
        if (!childrenMap[l.parentPath]) childrenMap[l.parentPath] = [];
        childrenMap[l.parentPath].push(l);
      } else {
        // 父请求或无父请求的独立请求
        parentLogs.push(l);
      }
    });
    
    let html = '';
    parentLogs.forEach(l => {
      const children = childrenMap[l.path] || [];
      const hasChildren = children.length > 0;
      const expanded = expandedLogGroups.has('parent:' + l.idx);
      const fileType = getFileTypeTag(l.path);
      
      if (hasChildren) {
        html += '<div class="group-header" onclick="toggleLogGroup(\'parent:' + l.idx + '\')">' +
          '<span class="arrow ' + (expanded ? 'expanded' : '') + '">▶</span>' +
          '<span class="log-status ' + getStatusClass(l.found) + '">' + getStatusText(l.found) + '</span>' +
          (fileType ? '<span class="file-type-tag">' + fileType + '</span>' : '') +
          '<span class="path">' + l.path + '</span>' +
          '<span class="badge badge-count">' + children.length + '个资源</span>' +
          '<span style="color:#666;font-size:11px">' + formatTimeAgo(l.time) + '</span></div>';
        html += '<div class="group-items ' + (expanded ? 'expanded' : '') + '">';
        // 父请求本身
        html += '<div class="log-item parent-item' + (activeLogIdx === l.idx ? ' active' : '') + '" onclick="showLogDetail(' + l.idx + ')"><span class="log-time">' + l.time + '</span><span class="log-ip">' + l.ip + '</span><span style="color:#007bff">主请求</span><span class="log-status ' + getStatusClass(l.found) + '">' + getStatusText(l.found) + '</span></div>';
        // 子资源
        children.forEach(c => {
          const cFileType = getFileTypeTag(c.path);
          html += '<div class="log-item child-item' + (activeLogIdx === c.idx ? ' active' : '') + '" onclick="showLogDetail(' + c.idx + ')"><span class="log-time">' + c.time + '</span>' + (cFileType ? '<span class="file-type-tag">' + cFileType + '</span>' : '') + '<span class="log-path">' + c.path + '</span><span class="log-status ' + getStatusClass(c.found) + '">' + getStatusText(c.found) + '</span></div>';
        });
        html += '</div>';
      } else {
        html += '<div class="log-item' + (activeLogIdx === l.idx ? ' active' : '') + '" onclick="showLogDetail(' + l.idx + ')"><span class="log-time">' + l.time + '</span><span class="log-ip">' + l.ip + '</span>' + (fileType ? '<span class="file-type-tag">' + fileType + '</span>' : '') + '<span class="log-path">' + l.path + '</span><span class="log-status ' + getStatusClass(l.found) + '">' + getStatusText(l.found) + '</span></div>';
      }
    });
    container.innerHTML = html;
    return;
  }

  if (groupSame) {
    // 按路径分组
    const pathGroups = {};
    filtered.forEach(l => {
      if (!pathGroups[l.path]) pathGroups[l.path] = [];
      pathGroups[l.path].push(l);
    });
    let html = '';
    for (const [path, items] of Object.entries(pathGroups)) {
      const expanded = expandedLogGroups.has(path);
      const latest = items[0];
      const timeAgo = formatTimeAgo(latest.time);
      const fileType = getFileTypeTag(path);
      html += '<div class="group-header" onclick="toggleLogGroup(\'' + path.replace(/'/g, "\\'") + '\')">' +
        '<span class="arrow ' + (expanded ? 'expanded' : '') + '">▶</span>' +
        '<span class="log-status ' + getStatusClass(latest.found) + '">' + getStatusText(latest.found) + '</span>' +
        (fileType ? '<span class="file-type-tag">' + fileType + '</span>' : '') +
        '<span class="path">' + path + '</span>' +
        '<span class="badge badge-count">' + items.length + '次</span>' +
        '<span style="color:#666;font-size:11px">' + timeAgo + '</span></div>';
      html += '<div class="group-items ' + (expanded ? 'expanded' : '') + '">';
      items.forEach(l => {
        html += '<div class="log-item' + (activeLogIdx === l.idx ? ' active' : '') + '" onclick="showLogDetail(' + l.idx + ')"><span class="log-time">' + l.time + '</span><span class="log-ip">' + l.ip + '</span><span class="log-status ' + getStatusClass(l.found) + '">' + getStatusText(l.found) + '</span></div>';
      });
      html += '</div>';
    }
    container.innerHTML = html;
  } else {
    container.innerHTML = filtered.map(l => {
      const fileType = getFileTypeTag(l.path);
      return '<div class="log-item' + (activeLogIdx === l.idx ? ' active' : '') + '" onclick="showLogDetail(' + l.idx + ')"><span class="log-time">' + l.time + '</span><span class="log-ip">' + l.ip + '</span>' + (fileType ? '<span class="file-type-tag">' + fileType + '</span>' : '') + '<span class="log-path">' + l.path + '</span><span class="log-status ' + getStatusClass(l.found) + '">' + getStatusText(l.found) + '</span></div>';
    }).join('');
  }
}

function toggleLogGroup(path) {
  expandedLogGroups.has(path) ? expandedLogGroups.delete(path) : expandedLogGroups.add(path);
  renderLogs();
}

function switchLogDetailTab(tab) {
  logDetailTab = tab;
  if (activeLogIdx !== null) showLogDetail(activeLogIdx);
}

let logHeadersCollapsed = { req: false, res: true };
function toggleLogHeaders(type) {
  logHeadersCollapsed[type] = !logHeadersCollapsed[type];
  if (activeLogIdx !== null) showLogDetail(activeLogIdx);
}

function showLogDetail(idx) {
  activeLogIdx = idx;
  const l = logs[idx];
  const panel = document.getElementById('logDetailPanel');
  const tabBtn = (name, label) => '<button class="detail-tab' + (logDetailTab === name ? ' active' : '') + '" onclick="switchLogDetailTab(\'' + name + '\')">' + label + '</button>';
  const headerTable = (headers) => {
    if (!headers || Object.keys(headers).length === 0) return '<em>无</em>';
    return '<table>' + Object.entries(headers).map(([k, v]) => '<tr><td>' + k + '</td><td>' + v + '</td></tr>').join('') + '</table>';
  };
  const queryTable = (query) => {
    if (!query || Object.keys(query).length === 0) return '<em>无</em>';
    return '<table>' + Object.entries(query).map(([k, v]) => '<tr><td>' + k + '</td><td>' + v + '</td></tr>').join('') + '</table>';
  };
  const collapsible = (title, content, type) => {
    const collapsed = logHeadersCollapsed[type];
    return '<div style="margin-top:10px"><strong style="cursor:pointer" onclick="toggleLogHeaders(\'' + type + '\')">' + title + ' ' + (collapsed ? '▶' : '▼') + '</strong></div><div class="detail-content" style="' + (collapsed ? 'display:none;' : '') + 'max-height:150px">' + content + '</div>';
  };

  const hasOverride = overrides[l.path] && overrides[l.path].enabled;
  const hasMapping = mappings[l.path] && mappings[l.path].enabled;
  const isMissing = l.found !== true && l.found !== 'mapping';
  const isMapping = l.found === 'mapping';
  const statusText = l.found === true ? '本地' : l.found === 'mapping' ? '映射' : '404';
  const statusClass = l.found === true ? 'found' : l.found === 'mapping' ? 'mapping' : 'missing';

  // 映射请求显示服务器返回的详细信息
  if (isMapping && l.mappingResponse) {
    const mr = l.mappingResponse;
    let proxyBody = mr.body || '';
    try { proxyBody = JSON.stringify(JSON.parse(proxyBody), null, 2); } catch { }
    const mrStatusClass = mr.status >= 200 && mr.status < 300 ? 'status-2xx' : mr.status >= 400 && mr.status < 500 ? 'status-4xx' : 'status-5xx';
    const pageHeader = l.headers && (l.headers['x-bbae-page'] || l.headers['X-Bbae-Page']);
    const hasPage = !!pageHeader;
    
    // 访问请求 Tab（客户端 -> 本地服务器）
    let reqBodyFormatted = l.body || '';
    try { reqBodyFormatted = JSON.stringify(JSON.parse(reqBodyFormatted), null, 2); } catch { }
    const hasReqBody = l.body && l.body.length > 0;
    
    // 根据 content-type 判断是否可展示
    const responseContentHtml = renderResponseContent(mr.body, mr.headers, idx, mr.isBase64);
    
    const accessTabHtml = 
      '<div class="section-title">Response <span class="section-tag">来自映射服务器</span></div>' +
      '<div class="detail-content">' + responseContentHtml + '</div>' +
      (hasReqBody ? '<div class="section-title">Request Body</div><div class="detail-content"><pre>' + escapeHtml(reqBodyFormatted) + '</pre></div>' : '') +
      '<div class="section-title">Request</div>' +
      '<div class="detail-content"><table>' +
      '<tr><td>方法</td><td>' + (l.method || 'GET') + '</td></tr>' +
      '<tr><td>路径</td><td>' + l.path + '</td></tr>' +
      '<tr><td>完整URL</td><td>' + (l.fullUrl || l.path) + '</td></tr>' +
      '<tr><td>访问时间</td><td>' + l.time + '</td></tr>' +
      '<tr><td>客户端IP</td><td>' + l.ip + '</td></tr>' +
      '</table></div>' +
      '<div class="section-title">Query 参数</div>' +
      '<div class="detail-content">' + queryTable(l.query) + '</div>' +
      '<div class="section-title">Response Headers <span class="section-tag">来自映射服务器</span></div>' +
      '<div class="detail-content">' + headerTable(mr.headers) + '</div>' +
      '<div class="section-title">Request Headers (' + (l.headers ? Object.keys(l.headers).length : 0) + ')</div>' +
      '<div class="detail-content">' + headerTable(l.headers) + '</div>';
    
    // 映射请求 Tab（本地服务器 -> 代理服务器）
    const proxyReqHeaders = l.proxyReqHeaders || {};
    const proxyTabHtml = 
      '<div class="section-title">Response</div>' +
      '<div class="detail-content">' + responseContentHtml + '</div>' +
      (hasReqBody ? '<div class="section-title">Request Body <span class="section-tag">透传访问请求</span></div><div class="detail-content"><pre>' + escapeHtml(reqBodyFormatted) + '</pre></div>' : '') +
      '<div class="section-title">Request</div>' +
      '<div class="detail-content"><table>' +
      '<tr><td>目标URL</td><td style="word-break:break-all">' + mr.url + '</td></tr>' +
      '<tr><td>响应状态</td><td><span class="status-code ' + mrStatusClass + '">' + mr.status + '</span></td></tr>' +
      '<tr><td>耗时</td><td>' + mr.time + 'ms</td></tr>' +
      '<tr><td>响应大小</td><td>' + formatSize(mr.size) + '</td></tr>' +
      '</table></div>' +
      '<div class="section-title">Response Headers (' + (mr.headers ? Object.keys(mr.headers).length : 0) + ')</div>' +
      '<div class="detail-content">' + headerTable(mr.headers) + '</div>' +
      '<div class="section-title">Request Headers <span class="section-tag">实际发送</span> (' + Object.keys(proxyReqHeaders).length + ')</div>' +
      '<div class="detail-content">' + headerTable(proxyReqHeaders) + '</div>';
    
    panel.innerHTML =
      '<div class="meta-row"><div class="meta-item"><span class="method method-' + (l.method || 'GET') + '">' + (l.method || 'GET') + '</span></div><div class="meta-item">时间: ' + l.time + '</div><div class="meta-item">IP: ' + l.ip + '</div><div class="meta-item">状态: <span class="log-status mapping">映射</span></div><div class="meta-item">响应: <span class="status-code ' + mrStatusClass + '">' + mr.status + '</span></div><div class="meta-item">耗时: ' + mr.time + 'ms</div></div>' +
      (l.parentPath ? '<div style="font-family:monospace;font-size:11px;margin-bottom:5px;word-break:break-all;color:#6c757d">来源页面: ' + l.parentPath + '</div>' : '') +
      '<div style="font-family:monospace;font-size:11px;margin-bottom:5px;word-break:break-all;color:#666">本地: ' + l.path + '</div>' +
      '<div style="font-family:monospace;font-size:11px;margin-bottom:10px;word-break:break-all;color:#17a2b8">代理: ' + mr.url + '</div>' +
      '<div style="margin-bottom:10px"><button class="btn btn-success btn-sm" onclick="createMissingFile(\'' + l.path.replace(/'/g, "\\'") + '\')">永久保存</button> <button class="btn btn-warning btn-sm" onclick="editLogOverride(\'' + l.path.replace(/'/g, "\\'") + '\')">临时修改</button> <button class="btn btn-info btn-sm" onclick="openMappingModal(\'' + l.path.replace(/'/g, "\\'") + '\')">编辑映射</button> <button class="btn btn-danger btn-sm" onclick="removeMappingAndRefreshLog(\'' + l.path.replace(/'/g, "\\'") + '\')">取消映射</button></div>' +
      '<div class="detail-tabs">' + tabBtn('access', '访问请求') + tabBtn('proxy', '映射请求') + (hasPage ? tabBtn('page', 'Page') : '') + '</div>' +
      '<div class="tab-content' + (logDetailTab === 'access' || logDetailTab === 'response' || logDetailTab === 'request' ? ' active' : '') + '">' + accessTabHtml + '</div>' +
      '<div class="tab-content' + (logDetailTab === 'proxy' ? ' active' : '') + '">' + proxyTabHtml + '</div>' +
      (hasPage ? '<div class="tab-content' + (logDetailTab === 'page' ? ' active' : '') + '">' + renderPageInfo(pageHeader) + '</div>' : '');
    panel.classList.add('active');
    renderLogs();
    return;
  }

  // 普通请求
  const pageHeader = l.headers && (l.headers['x-bbae-page'] || l.headers['X-Bbae-Page']);
  const hasPage = !!pageHeader;
  
  // 异步获取响应内容
  fetch(l.path).then(r => {
    const resHeaders = {};
    r.headers.forEach((v, k) => resHeaders[k] = v);
    return r.text().then(text => ({ text, resHeaders }));
  }).then(({ text, resHeaders }) => {
    let responseBody;
    try { responseBody = JSON.stringify(JSON.parse(text), null, 2); } catch { responseBody = text; }
    const respContent = document.getElementById('logResponseContent');
    if (respContent) respContent.innerHTML = '<pre>' + escapeHtml(responseBody) + '</pre>';
    const resHeadersEl = document.getElementById('logResHeaders');
    if (resHeadersEl) resHeadersEl.innerHTML = headerTable(resHeaders);
    window.currentLogResponse = text;
    window.currentLogResHeaders = resHeaders;
  }).catch(() => {
    const respContent = document.getElementById('logResponseContent');
    if (respContent) respContent.innerHTML = '<em>无法加载</em>';
    window.currentLogResponse = '{}';
  });

  // 本地请求详情 - 和映射详情的访问请求格式一致
  let reqBodyFormatted = l.body || '';
  try { reqBodyFormatted = JSON.stringify(JSON.parse(reqBodyFormatted), null, 2); } catch { }
  const hasReqBody = l.body && l.body.length > 0;
  
  const localDetailHtml = 
    '<div class="section-title">Response</div>' +
    '<div class="detail-content" id="logResponseContent"><em>加载中...</em></div>' +
    (hasReqBody ? '<div class="section-title">Request Body</div><div class="detail-content"><pre>' + escapeHtml(reqBodyFormatted) + '</pre></div>' : '') +
    '<div class="section-title">Request</div>' +
    '<div class="detail-content"><table>' +
    '<tr><td>方法</td><td>' + (l.method || 'GET') + '</td></tr>' +
    '<tr><td>路径</td><td>' + l.path + '</td></tr>' +
    '<tr><td>完整URL</td><td>' + (l.fullUrl || l.path) + '</td></tr>' +
    '<tr><td>访问时间</td><td>' + l.time + '</td></tr>' +
    '<tr><td>客户端IP</td><td>' + l.ip + '</td></tr>' +
    '</table></div>' +
    '<div class="section-title">Query 参数</div>' +
    '<div class="detail-content">' + queryTable(l.query) + '</div>' +
    '<div class="section-title">Response Headers</div>' +
    '<div class="detail-content" id="logResHeaders"><em>加载中...</em></div>' +
    '<div class="section-title">Request Headers (' + (l.headers ? Object.keys(l.headers).length : 0) + ')</div>' +
    '<div class="detail-content">' + headerTable(l.headers) + '</div>';

  panel.innerHTML =
    '<div class="meta-row"><div class="meta-item"><span class="method method-' + (l.method || 'GET') + '">' + (l.method || 'GET') + '</span></div><div class="meta-item">时间: ' + l.time + '</div><div class="meta-item">IP: ' + l.ip + '</div><div class="meta-item">状态: <span class="log-status ' + statusClass + '">' + statusText + '</span></div>' + (hasOverride ? '<div class="meta-item"><span class="badge badge-override">已临时修改</span></div>' : '') + (hasMapping ? '<div class="meta-item"><span class="badge badge-mapping">已映射</span></div>' : '') + '</div>' +
    (l.parentPath ? '<div style="font-family:monospace;font-size:11px;margin-bottom:5px;word-break:break-all;color:#6c757d">来源页面: ' + l.parentPath + '</div>' : '') +
    '<div style="font-family:monospace;font-size:11px;margin-bottom:10px;word-break:break-all;color:#666">' + (l.fullUrl || l.path) + '</div>' +
    '<div style="margin-bottom:10px">' + 
    (isMissing ? '<button class="btn btn-success btn-sm" onclick="createMissingFile(\'' + l.path.replace(/'/g, "\\'") + '\')">创建文件</button> ' : '') + 
    '<button class="btn btn-warning btn-sm" onclick="editLogOverride(\'' + l.path.replace(/'/g, "\\'") + '\', ' + (!isMissing) + ')">修改返回</button> ' +
    '<button class="btn btn-info btn-sm" onclick="openMappingModal(\'' + l.path.replace(/'/g, "\\'") + '\')">设置映射</button>' + 
    (hasOverride ? ' <button class="btn btn-danger btn-sm" onclick="removeOverrideAndRefreshLog(\'' + l.path.replace(/'/g, "\\'") + '\')">取消临时</button>' : '') + 
    (hasMapping ? ' <button class="btn btn-danger btn-sm" onclick="removeMappingAndRefreshLog(\'' + l.path.replace(/'/g, "\\'") + '\')">取消映射</button>' : '') + 
    '</div>' +
    (hasPage ? '<div class="detail-tabs">' + tabBtn('response', '详情') + tabBtn('page', 'Page') + '</div>' +
    '<div class="tab-content' + (logDetailTab !== 'page' ? ' active' : '') + '">' + localDetailHtml + '</div>' +
    '<div class="tab-content' + (logDetailTab === 'page' ? ' active' : '') + '">' + renderPageInfo(pageHeader) + '</div>'
    : localDetailHtml);
  panel.classList.add('active');
  renderLogs();
}

async function removeMappingAndRefreshLog(apiPath) {
  await removeMapping(apiPath);
  showLogDetail(activeLogIdx);
}

function createMissingFile(apiPath) {
  const defaultContent = JSON.stringify({ Outcome: "Success", Message: "Success", Data: {} }, null, 2);
  openModal('创建接口文件 (永久保存)', apiPath, defaultContent, async (content) => {
    const res = await fetch('/admin/file/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: apiPath, content }) });
    const result = await res.json();
    if (result.success) { alert('创建成功'); refreshLogs(); }
    else alert('创建失败: ' + result.error);
  });
}

function editLocalFileFromLog(apiPath) {
  const content = window.currentLogResponse || '{}';
  let formatted = content;
  try { formatted = JSON.stringify(JSON.parse(content), null, 2); } catch {}
  openModal('永久修改文件', apiPath, formatted, async (newContent) => {
    const res = await fetch('/admin/file/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: apiPath, content: newContent }) });
    const result = await res.json();
    if (result.success) { alert('保存成功'); refreshLogs(); }
    else alert('保存失败: ' + result.error);
  });
}

async function deleteLocalFileFromLog(apiPath) {
  if (!confirm('确定删除本地文件 ' + apiPath + ' ?')) return;
  const res = await fetch('/admin/file/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: apiPath }) });
  const result = await res.json();
  if (result.success) { alert('删除成功'); refreshLogs(); }
  else alert('删除失败: ' + result.error);
}

function editLogOverride(path, isLocalFile = false) {
  setTimeout(() => { setTempOverride(path, window.currentLogResponse || '{}', isLocalFile); }, 100);
}

async function removeOverrideAndRefreshLog(path) {
  await removeOverride(path);
  showLogDetail(activeLogIdx);
}


// ========== HAR 解析 ==========
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
uploadArea.onclick = () => fileInput.click();
uploadArea.ondragover = e => { e.preventDefault(); uploadArea.classList.add('dragover'); };
uploadArea.ondragleave = () => uploadArea.classList.remove('dragover');
uploadArea.ondrop = e => { e.preventDefault(); uploadArea.classList.remove('dragover'); if (e.dataTransfer.files[0]) loadHarFile(e.dataTransfer.files[0]); };
fileInput.onchange = e => { if (e.target.files[0]) loadHarFile(e.target.files[0]); };

function loadHarFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const har = JSON.parse(e.target.result);
      entries = har.log.entries.map((entry, i) => {
        const url = new URL(entry.request.url);
        let dataHash = '';
        try {
          const json = JSON.parse(entry.response.content?.text || '{}');
          dataHash = JSON.stringify(json.Data || json.data || json);
        } catch { dataHash = entry.response.content?.text || ''; }
        return {
          id: i,
          method: entry.request.method,
          path: url.pathname,
          fullUrl: entry.request.url,
          status: entry.response.status,
          statusText: entry.response.statusText,
          contentType: entry.response.content?.mimeType || '',
          size: entry.response.content?.size || 0,
          body: entry.response.content?.text || '',
          time: entry.startedDateTime,
          reqHeaders: entry.request.headers,
          resHeaders: entry.response.headers,
          queryString: entry.request.queryString,
          postData: entry.request.postData,
          timings: entry.timings,
          totalTime: entry.time,
          dataHash
        };
      });
      document.getElementById('harContent').classList.remove('hidden');
      uploadArea.innerHTML = '<p>已加载: ' + file.name + ' (' + entries.length + ' 条)</p>';
      document.getElementById('totalCount').textContent = entries.length;
      applyFilters();
    } catch (err) { alert('解析失败: ' + err.message); }
  };
  reader.readAsText(file);
}

['searchInput', 'methodFilter', 'statusFilter', 'mergeData'].forEach(id => {
  document.getElementById(id).addEventListener('change', applyFilters);
  document.getElementById(id).addEventListener('input', applyFilters);
});

function applyFilters() {
  const search = document.getElementById('searchInput').value.toLowerCase();
  const method = document.getElementById('methodFilter').value;
  const status = document.getElementById('statusFilter').value;
  const merge = document.getElementById('mergeData').checked;
  const filtered = entries.filter(e => {
    if (search && !e.path.toLowerCase().includes(search)) return false;
    if (method && e.method !== method) return false;
    if (status === '2xx' && (e.status < 200 || e.status >= 300)) return false;
    if (status === '4xx' && (e.status < 400 || e.status >= 500)) return false;
    if (status === '5xx' && e.status < 500) return false;
    return true;
  });
  groups = {};
  filtered.forEach(e => {
    const key = e.method + ':' + e.path;
    if (!groups[key]) groups[key] = { items: [], merged: false, seenHashes: new Set() };
    if (merge && groups[key].seenHashes.has(e.dataHash)) { groups[key].merged = true; return; }
    groups[key].seenHashes.add(e.dataHash);
    groups[key].items.push(e);
  });
  document.getElementById('groupCount').textContent = Object.keys(groups).length;
  renderGroups();
}

function renderGroups() {
  const container = document.getElementById('groupList');
  let html = '';
  for (const [key, group] of Object.entries(groups)) {
    const items = group.items;
    const [method, ...pathParts] = key.split(':');
    const path = pathParts.join(':');
    const expanded = expandedGroups.has(key);
    const allSelected = items.every(e => selectedIds.has(e.id));
    const someSelected = items.some(e => selectedIds.has(e.id));
    html += '<div class="group"><div class="group-header" onclick="toggleGroup(\'' + key.replace(/'/g, "\\'") + '\')">' +
      '<input type="checkbox" ' + (allSelected ? 'checked' : '') + (someSelected && !allSelected ? ' style="opacity:0.5"' : '') + ' onclick="event.stopPropagation();toggleGroupSelect(\'' + key.replace(/'/g, "\\'") + '\', this.checked)">' +
      '<span class="arrow ' + (expanded ? 'expanded' : '') + '">▶</span>' +
      '<span class="method method-' + method + '">' + method + '</span>' +
      '<span class="path">' + path + '</span>' +
      '<span class="badge badge-count">' + items.length + '</span>' +
      (group.merged ? '<span class="badge badge-merged">已合并</span>' : '') + '</div>';
    html += '<div class="group-items ' + (expanded ? 'expanded' : '') + '">';
    items.forEach((e, idx) => {
      html += '<div class="item-row ' + (activeId === e.id ? 'active' : '') + '" onclick="showDetail(' + e.id + ')">' +
        '<input type="checkbox" ' + (selectedIds.has(e.id) ? 'checked' : '') + ' onclick="event.stopPropagation();toggleSelect(' + e.id + ')">' +
        '<span class="status-code status-' + Math.floor(e.status / 100) + 'xx">' + e.status + '</span>' +
        '<span style="color:#666">#' + (idx + 1) + ' · ' + formatSize(e.size) + ' · ' + (e.totalTime || 0) + 'ms</span></div>';
    });
    html += '</div></div>';
  }
  container.innerHTML = html;
  document.getElementById('selectedCount').textContent = selectedIds.size;
}

function toggleGroup(key) {
  expandedGroups.has(key) ? expandedGroups.delete(key) : expandedGroups.add(key);
  renderGroups();
}

function toggleGroupSelect(key, checked) {
  groups[key].items.forEach(e => checked ? selectedIds.add(e.id) : selectedIds.delete(e.id));
  renderGroups();
}

function toggleSelect(id) {
  selectedIds.has(id) ? selectedIds.delete(id) : selectedIds.add(id);
  renderGroups();
}

function selectAll() {
  Object.values(groups).forEach(g => {
    if (g.items.length === 1) {
      selectedIds.add(g.items[0].id);
    } else {
      const latest = g.items.reduce((a, b) => getDataTime(a) > getDataTime(b) ? a : b);
      selectedIds.add(latest.id);
    }
  });
  renderGroups();
}

function getDataTime(entry) {
  try {
    const json = JSON.parse(entry.body);
    const dt = json.DataTime || json.dataTime || json.timestamp || entry.time || '';
    return new Date(dt).getTime() || 0;
  } catch { return new Date(entry.time).getTime() || 0; }
}

function selectNone() { selectedIds.clear(); renderGroups(); }
function expandAll() { Object.keys(groups).forEach(k => expandedGroups.add(k)); renderGroups(); }
function collapseAll() { expandedGroups.clear(); renderGroups(); }
function switchDetailTab(tab) { activeTab = tab; if (activeId !== null) showDetail(activeId); }

function showDetail(id) {
  activeId = id;
  const e = entries.find(x => x.id === id);
  const panel = document.getElementById('detailPanel');
  let body = e.body;
  try { body = JSON.stringify(JSON.parse(body), null, 2); } catch { }
  const headerTable = (headers) => {
    if (!headers || !headers.length) return '<em>无</em>';
    return '<table>' + headers.map(h => '<tr><td>' + h.name + '</td><td>' + h.value + '</td></tr>').join('') + '</table>';
  };
  const timings = e.timings || {};
  const timingHtml = '<table><tr><td>等待</td><td>' + (timings.wait || 0) + 'ms</td></tr><tr><td>连接</td><td>' + (timings.connect || 0) + 'ms</td></tr><tr><td>发送</td><td>' + (timings.send || 0) + 'ms</td></tr><tr><td>接收</td><td>' + (timings.receive || 0) + 'ms</td></tr><tr><td><strong>总计</strong></td><td><strong>' + (e.totalTime || 0) + 'ms</strong></td></tr></table>';
  let queryHtml = '<em>无</em>';
  if (e.queryString && e.queryString.length) {
    queryHtml = '<table>' + e.queryString.map(q => '<tr><td>' + q.name + '</td><td>' + q.value + '</td></tr>').join('') + '</table>';
  }
  let postHtml = '<em>无</em>';
  if (e.postData) {
    let postBody = e.postData.text || '';
    try { postBody = JSON.stringify(JSON.parse(postBody), null, 2); } catch { }
    postHtml = '<div style="margin-bottom:5px"><strong>' + e.postData.mimeType + '</strong></div><pre>' + escapeHtml(postBody) + '</pre>';
  }
  const tabBtn = (name, label) => '<button class="detail-tab' + (activeTab === name ? ' active' : '') + '" onclick="switchDetailTab(\'' + name + '\')">' + label + '</button>';
  panel.innerHTML =
    '<div class="meta-row"><div class="meta-item"><span class="method method-' + e.method + '">' + e.method + '</span></div><div class="meta-item">状态: <span class="status-code status-' + Math.floor(e.status / 100) + 'xx">' + e.status + '</span></div><div class="meta-item">大小: ' + formatSize(e.size) + '</div><div class="meta-item">耗时: ' + (e.totalTime || 0) + 'ms</div></div>' +
    '<div style="font-family:monospace;font-size:11px;margin-bottom:10px;word-break:break-all;color:#666">' + e.fullUrl + '</div>' +
    '<div class="detail-tabs">' + tabBtn('response', 'Response') + tabBtn('request', 'Request') + tabBtn('headers', 'Headers') + tabBtn('timing', 'Timing') + '</div>' +
    '<div class="tab-content' + (activeTab === 'response' ? ' active' : '') + '"><div class="detail-content"><pre>' + escapeHtml(body) + '</pre></div></div>' +
    '<div class="tab-content' + (activeTab === 'request' ? ' active' : '') + '"><div style="margin-bottom:10px"><strong>Query 参数</strong></div><div class="detail-content" style="max-height:150px;margin-bottom:10px">' + queryHtml + '</div><div style="margin-bottom:10px"><strong>Request Body</strong></div><div class="detail-content">' + postHtml + '</div></div>' +
    '<div class="tab-content' + (activeTab === 'headers' ? ' active' : '') + '"><div style="margin-bottom:10px"><strong>Request Headers (' + ((e.reqHeaders || []).length) + ')</strong></div><div class="detail-content" style="max-height:150px;margin-bottom:10px">' + headerTable(e.reqHeaders) + '</div><div style="margin-bottom:10px"><strong>Response Headers (' + ((e.resHeaders || []).length) + ')</strong></div><div class="detail-content" style="max-height:150px">' + headerTable(e.resHeaders) + '</div></div>' +
    '<div class="tab-content' + (activeTab === 'timing' ? ' active' : '') + '"><div class="detail-content">' + timingHtml + '</div></div>';
  panel.classList.add('active');
  renderGroups();
}

function getSelectedFiles() {
  const folder = document.getElementById('outputFolder').value || 'public/mock';
  const keepLast = document.getElementById('keepLast').checked;
  const pretty = document.getElementById('prettyJson').checked;
  const selected = entries.filter(e => selectedIds.has(e.id));
  const fileMap = new Map();
  selected.forEach(e => {
    const fp = folder + e.path + '.json';
    if (!keepLast && fileMap.has(fp)) return;
    let c = e.body;
    if (pretty) { try { c = JSON.stringify(JSON.parse(c), null, 2); } catch { } }
    fileMap.set(fp, c);
  });
  return fileMap;
}

async function saveToServer() {
  const files = getSelectedFiles();
  if (files.size === 0) { alert('请先选择要保存的请求'); return; }
  const data = {};
  files.forEach((content, path) => data[path] = content);
  const res = await fetch('/admin/har/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await res.json();
  if (result.success) alert('保存成功: ' + result.count + ' 个文件');
  else alert('保存失败: ' + result.error);
}

// ========== 日志批量保存 ==========
function openLogBatchSave() {
  // 填充文件夹下拉框
  const folderSelect = document.getElementById('logBatchFolder');
  const currentFolder = document.getElementById('folderSelect').value;
  folderSelect.innerHTML = publicFolders.map(f => 
    '<option value="' + f.path + '"' + (f.path === currentFolder ? ' selected' : '') + '>' + f.name + '</option>'
  ).join('');
  
  if (publicFolders.length === 0) {
    folderSelect.innerHTML = '<option value="mock">mock</option>';
  }
  
  // 按路径分组日志
  logBatchGroups = {};
  logs.forEach((l, idx) => {
    const key = l.path;
    if (!logBatchGroups[key]) {
      logBatchGroups[key] = [];
    }
    logBatchGroups[key].push({ ...l, idx });
  });
  
  // 默认选中映射接口的最新一条
  logBatchSelectedIds.clear();
  for (const [path, items] of Object.entries(logBatchGroups)) {
    // 找到映射接口的最新一条
    const mappingItems = items.filter(l => l.found === 'mapping');
    if (mappingItems.length > 0) {
      logBatchSelectedIds.add(mappingItems[0].idx);
    } else if (items.length > 0) {
      // 如果没有映射接口，选择最新一条
      logBatchSelectedIds.add(items[0].idx);
    }
  }
  
  document.getElementById('logBatchGroupCount').textContent = Object.keys(logBatchGroups).length;
  document.getElementById('logBatchSelectedCount').textContent = logBatchSelectedIds.size;
  renderLogBatchList();
  document.getElementById('logBatchSaveModal').classList.add('active');
}

function closeLogBatchSave() {
  document.getElementById('logBatchSaveModal').classList.remove('active');
}

function renderLogBatchList() {
  const container = document.getElementById('logBatchList');
  const getStatusClass = (found) => found === true ? 'found' : found === 'mapping' ? 'mapping' : 'missing';
  const getStatusText = (found) => found === true ? '本地' : found === 'mapping' ? '映射' : '404';
  
  let html = '';
  for (const [path, items] of Object.entries(logBatchGroups)) {
    const expanded = logBatchExpandedGroups.has(path);
    const allSelected = items.every(l => logBatchSelectedIds.has(l.idx));
    const someSelected = items.some(l => logBatchSelectedIds.has(l.idx));
    const latest = items[0];
    
    html += '<div class="group"><div class="group-header" onclick="toggleLogBatchGroup(\'' + path.replace(/'/g, "\\'") + '\')">' +
      '<input type="checkbox" ' + (allSelected ? 'checked' : '') + (someSelected && !allSelected ? ' style="opacity:0.5"' : '') + ' onclick="event.stopPropagation();toggleLogBatchGroupSelect(\'' + path.replace(/'/g, "\\'") + '\', this.checked)">' +
      '<span class="arrow ' + (expanded ? 'expanded' : '') + '">▶</span>' +
      '<span class="log-status ' + getStatusClass(latest.found) + '">' + getStatusText(latest.found) + '</span>' +
      '<span class="path">' + path + '</span>' +
      '<span class="badge badge-count">' + items.length + '</span></div>';
    
    html += '<div class="group-items ' + (expanded ? 'expanded' : '') + '">';
    items.forEach((l, idx) => {
      html += '<div class="item-row ' + (logBatchSelectedIds.has(l.idx) ? 'active' : '') + '" onclick="toggleLogBatchSelect(' + l.idx + ')">' +
        '<input type="checkbox" ' + (logBatchSelectedIds.has(l.idx) ? 'checked' : '') + ' onclick="event.stopPropagation();toggleLogBatchSelect(' + l.idx + ')">' +
        '<span class="log-status ' + getStatusClass(l.found) + '">' + getStatusText(l.found) + '</span>' +
        '<span style="color:#666">#' + (idx + 1) + ' · ' + l.time + '</span></div>';
    });
    html += '</div></div>';
  }
  
  container.innerHTML = html;
  document.getElementById('logBatchSelectedCount').textContent = logBatchSelectedIds.size;
}

function toggleLogBatchGroup(path) {
  logBatchExpandedGroups.has(path) ? logBatchExpandedGroups.delete(path) : logBatchExpandedGroups.add(path);
  renderLogBatchList();
}

function toggleLogBatchGroupSelect(path, checked) {
  logBatchGroups[path].forEach(l => checked ? logBatchSelectedIds.add(l.idx) : logBatchSelectedIds.delete(l.idx));
  renderLogBatchList();
}

function toggleLogBatchSelect(idx) {
  logBatchSelectedIds.has(idx) ? logBatchSelectedIds.delete(idx) : logBatchSelectedIds.add(idx);
  renderLogBatchList();
}

function selectAllLogBatch() {
  // 每组选择最新的映射接口，如果没有则选择最新的
  logBatchSelectedIds.clear();
  for (const [path, items] of Object.entries(logBatchGroups)) {
    const mappingItems = items.filter(l => l.found === 'mapping');
    if (mappingItems.length > 0) {
      logBatchSelectedIds.add(mappingItems[0].idx);
    } else if (items.length > 0) {
      logBatchSelectedIds.add(items[0].idx);
    }
  }
  renderLogBatchList();
}

function selectNoneLogBatch() {
  logBatchSelectedIds.clear();
  renderLogBatchList();
}

function expandAllLogBatch() {
  Object.keys(logBatchGroups).forEach(k => logBatchExpandedGroups.add(k));
  renderLogBatchList();
}

function collapseAllLogBatch() {
  logBatchExpandedGroups.clear();
  renderLogBatchList();
}

async function saveLogBatchToServer() {
  const folder = document.getElementById('logBatchFolder').value || 'public/mock';
  const pretty = document.getElementById('logBatchPretty').checked;
  
  if (logBatchSelectedIds.size === 0) {
    alert('请先选择要保存的日志');
    return;
  }
  
  const data = {};
  logBatchSelectedIds.forEach(idx => {
    const l = logs[idx];
    if (!l) return;
    
    let content = '';
    if (l.found === 'mapping' && l.mappingResponse) {
      content = l.mappingResponse.body || '{}';
    } else {
      // 本地文件，需要异步获取，这里先用空对象
      content = '{}';
    }
    
    // 格式化
    if (pretty) {
      try {
        content = JSON.stringify(JSON.parse(content), null, 2);
      } catch {}
    }
    
    const filePath = folder + l.path + '.json';
    data[filePath] = content;
  });
  
  const res = await fetch('/admin/har/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await res.json();
  if (result.success) {
    alert('保存成功: ' + result.count + ' 个文件');
    closeLogBatchSave();
  } else {
    alert('保存失败: ' + result.error);
  }
}
