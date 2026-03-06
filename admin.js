// 状态变量
let entries = [], groups = {}, selectedIds = new Set(), expandedGroups = new Set(), activeId = null, activeTab = 'response';
let logs = [], expandedMissingGroups = new Set(), activeLogIdx = null, logDetailTab = 'response', logRefreshTimer = null;
let localFiles = [], activeFilePath = null, overrides = {}, mappings = {}, currentParseFolder = '';
let modalCallback = null, mappingTestTab = 'response';

// 初始化
fetch('/admin/folder').then(r => r.json()).then(d => {
  document.getElementById('current').textContent = d.folder;
  document.getElementById('folder').value = localStorage.getItem('lastFolder') || '';
  document.getElementById('parseFolder').value = localStorage.getItem('lastParseFolder') || d.folder;
});
fetch('/admin/server-info').then(r => r.json()).then(d => {
  document.getElementById('serverAddrs').innerHTML = d.addresses.map(a => 
    '<a href="' + a + '/admin" target="_blank" style="margin-right:10px">' + a + '</a>'
  ).join('');
});
loadOverrides();
loadMappings();

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

// 文件夹切换
function changeFolder() {
  const folder = document.getElementById('folder').value;
  if (!folder) return alert('请输入文件夹名称');
  fetch('/admin/folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder }) })
    .then(r => r.json()).then(d => {
      if (d.success) {
        document.getElementById('current').textContent = d.folder;
        localStorage.setItem('lastFolder', folder);
        alert('切换成功');
      } else alert(d.error);
    });
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
    const isWildcard = p.endsWith('*');
    return '<div class="mapping-item"><span class="path">' + p + (isWildcard ? ' <span style="color:#17a2b8;font-size:10px">(前缀匹配)</span>' : '') + '</span><span class="target">→ ' + mappings[p] + '</span>' +
    '<button class="btn btn-sm btn-info" onclick="openMappingModal(\'' + p.replace(/'/g, "\\'") + '\')">编辑</button>' +
    '<button class="btn btn-sm btn-danger" onclick="removeMapping(\'' + p.replace(/'/g, "\\'") + '\')">删除</button></div>';
  }).join('');
}

async function removeMapping(apiPath) {
  await fetch('/admin/mappings', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: apiPath }) });
  loadMappings();
}

function openMappingModal(apiPath) {
  document.getElementById('mappingPath').value = apiPath || '';
  document.getElementById('mappingTarget').value = mappings[apiPath] || '';
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
  if (!apiPath) return alert('请输入接口路径');
  if (!target) return alert('请输入映射目标地址');
  await fetch('/admin/mappings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: apiPath, target }) });
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


// ========== Modal ==========
function openModal(title, path, content, onSave) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalPath').textContent = path;
  document.getElementById('jsonEditor').value = content;
  document.getElementById('jsonError').textContent = '';
  modalCallback = onSave;
  document.getElementById('jsonModal').classList.add('active');
}

function closeModal() {
  document.getElementById('jsonModal').classList.remove('active');
  modalCallback = null;
}

function formatJson() {
  const editor = document.getElementById('jsonEditor');
  try {
    editor.value = JSON.stringify(JSON.parse(editor.value), null, 2);
    document.getElementById('jsonError').textContent = '';
  } catch (e) {
    document.getElementById('jsonError').textContent = 'JSON 格式错误: ' + e.message;
  }
}

document.getElementById('modalSaveBtn').onclick = function() {
  const content = document.getElementById('jsonEditor').value;
  try {
    JSON.parse(content);
    if (modalCallback) modalCallback(content);
    closeModal();
  } catch (e) {
    document.getElementById('jsonError').textContent = 'JSON 格式错误: ' + e.message;
  }
};

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
  list.innerHTML = paths.map(p =>
    '<div class="override-item"><span class="path">' + p + '</span>' +
    '<button class="btn btn-sm btn-primary" onclick="editOverride(\'' + p.replace(/'/g, "\\'") + '\')">编辑</button>' +
    '<button class="btn btn-sm btn-danger" onclick="removeOverride(\'' + p.replace(/'/g, "\\'") + '\')">删除</button></div>'
  ).join('');
}

async function removeOverride(path) {
  await fetch('/admin/overrides', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
  loadOverrides();
}

async function editOverride(path) {
  openModal('编辑临时返回值', path, overrides[path] || '', async (content) => {
    await fetch('/admin/overrides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, content }) });
    loadOverrides();
  });
}

async function setTempOverride(path, originalContent) {
  let content = overrides[path] || originalContent;
  try { content = JSON.stringify(JSON.parse(content), null, 2); } catch { }
  openModal('临时修改返回值', path, content, async (newContent) => {
    await fetch('/admin/overrides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, content: newContent }) });
    loadOverrides();
    if (activeLogIdx !== null) showLogDetail(activeLogIdx);
  });
}

// ========== 本地文件管理 ==========
async function parseLocalFolder() {
  const folder = document.getElementById('parseFolder').value.trim();
  if (!folder) return alert('请输入文件夹路径');
  localStorage.setItem('lastParseFolder', folder);
  currentParseFolder = folder;
  const res = await fetch('/admin/files?folder=' + encodeURIComponent(folder));
  const data = await res.json();
  if (data.error) { alert(data.error); return; }
  localFiles = data.files || [];
  document.getElementById('fileCount').textContent = localFiles.length;
  document.getElementById('parseFolderInfo').textContent = '当前解析: ' + folder;
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
    if (result.success) { alert('保存成功'); parseLocalFolder(); }
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
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatSize(b) {
  return b < 1024 ? b + 'B' : b < 1048576 ? (b / 1024).toFixed(1) + 'K' : (b / 1048576).toFixed(1) + 'M';
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
  
  let html = '<div style="margin-bottom:15px"><strong>Activity</strong></div>';
  html += '<div class="detail-content" style="padding:10px;margin-bottom:15px"><span style="color:#007bff;font-weight:bold">' + escapeHtml(info.activity) + '</span></div>';
  
  if (info.fragments.length > 0) {
    html += '<div style="margin-bottom:10px"><strong>Fragments (' + info.fragments.length + ')</strong></div>';
    html += '<div class="detail-content" style="padding:10px">';
    info.fragments.forEach((f, i) => {
      const indent = '&nbsp;'.repeat(f.depth * 4);
      const visibleBadge = f.visible ? ' <span style="background:#28a745;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px">可见</span>' : '';
      const depthBadge = '<span style="background:#6c757d;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;margin-left:5px">#' + f.depth + '</span>';
      html += '<div style="margin:5px 0;font-family:monospace">' + indent + (f.visible ? '▶ ' : '○ ') + '<span style="color:' + (f.visible ? '#28a745' : '#666') + '">' + escapeHtml(f.name) + '</span>' + depthBadge + visibleBadge + '</div>';
    });
    html += '</div>';
  }
  
  html += '<div style="margin-top:15px"><strong>原始值</strong></div>';
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
  if (!confirm('确定清空所有日志?')) return;
  await fetch('/admin/logs', { method: 'DELETE' });
  activeLogIdx = null;
  document.getElementById('logDetailPanel').classList.remove('active');
  refreshLogs();
}

function renderLogs() {
  const search = document.getElementById('logSearch').value.toLowerCase();
  const statusFilter = document.getElementById('logStatusFilter').value;
  const groupMissing = document.getElementById('logGroupMissing').checked;
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

  if (groupMissing && statusFilter !== 'found' && statusFilter !== 'mapping') {
    const missingGroups = {};
    filtered.forEach(l => {
      if (l.found !== true && l.found !== 'mapping') {
        if (!missingGroups[l.path]) missingGroups[l.path] = [];
        missingGroups[l.path].push(l);
      }
    });
    let html = '';
    for (const [path, items] of Object.entries(missingGroups)) {
      const expanded = expandedMissingGroups.has(path);
      html += '<div class="group-header" onclick="toggleMissingGroup(\'' + path.replace(/'/g, "\\'") + '\')"><span class="arrow ' + (expanded ? 'expanded' : '') + '">▶</span><span class="badge badge-missing">404</span><span class="path">' + path + '</span><span class="badge badge-count">' + items.length + '</span></div>';
      html += '<div class="group-items ' + (expanded ? 'expanded' : '') + '">';
      items.forEach(l => {
        html += '<div class="log-item' + (activeLogIdx === l.idx ? ' active' : '') + '" onclick="showLogDetail(' + l.idx + ')"><span class="log-time">' + l.time + '</span><span class="log-ip">' + l.ip + '</span></div>';
      });
      html += '</div>';
    }
    filtered.filter(l => l.found === true || l.found === 'mapping').forEach(l => {
      html += '<div class="log-item' + (activeLogIdx === l.idx ? ' active' : '') + '" onclick="showLogDetail(' + l.idx + ')"><span class="log-time">' + l.time + '</span><span class="log-ip">' + l.ip + '</span><span class="log-path">' + l.path + '</span><span class="log-status ' + getStatusClass(l.found) + '">' + getStatusText(l.found) + '</span></div>';
    });
    container.innerHTML = html;
  } else {
    container.innerHTML = filtered.map(l =>
      '<div class="log-item' + (activeLogIdx === l.idx ? ' active' : '') + '" onclick="showLogDetail(' + l.idx + ')"><span class="log-time">' + l.time + '</span><span class="log-ip">' + l.ip + '</span><span class="log-path">' + l.path + '</span><span class="log-status ' + getStatusClass(l.found) + '">' + getStatusText(l.found) + '</span></div>'
    ).join('');
  }
}

function toggleMissingGroup(path) {
  expandedMissingGroups.has(path) ? expandedMissingGroups.delete(path) : expandedMissingGroups.add(path);
  renderLogs();
}

function switchLogDetailTab(tab) {
  logDetailTab = tab;
  if (activeLogIdx !== null) showLogDetail(activeLogIdx);
}

let logHeadersCollapsed = { req: true, res: true };
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

  const hasOverride = overrides[l.path];
  const hasMapping = mappings[l.path];
  const isMissing = l.found !== true && l.found !== 'mapping';
  const isMapping = l.found === 'mapping';
  const statusText = l.found === true ? '本地' : l.found === 'mapping' ? '映射' : '404';
  const statusClass = l.found === true ? 'found' : l.found === 'mapping' ? 'mapping' : 'missing';

  // 映射请求显示服务器返回的详细信息
  if (isMapping && l.mappingResponse) {
    const mr = l.mappingResponse;
    let body = mr.body || '';
    try { body = JSON.stringify(JSON.parse(body), null, 2); } catch { }
    const mrStatusClass = mr.status >= 200 && mr.status < 300 ? 'status-2xx' : mr.status >= 400 && mr.status < 500 ? 'status-4xx' : 'status-5xx';
    const pageHeader = l.headers && (l.headers['x-bbae-page'] || l.headers['X-Bbae-Page']);
    const hasPage = !!pageHeader;
    panel.innerHTML =
      '<div class="meta-row"><div class="meta-item"><span class="method method-' + (l.method || 'GET') + '">' + (l.method || 'GET') + '</span></div><div class="meta-item">时间: ' + l.time + '</div><div class="meta-item">IP: ' + l.ip + '</div><div class="meta-item">状态: <span class="log-status mapping">映射</span></div></div>' +
      '<div style="font-family:monospace;font-size:11px;margin-bottom:5px;word-break:break-all;color:#666">请求: ' + l.path + '</div>' +
      '<div style="font-family:monospace;font-size:11px;margin-bottom:10px;word-break:break-all;color:#17a2b8">映射: ' + mr.url + '</div>' +
      '<div class="meta-row"><div class="meta-item">响应状态: <span class="status-code ' + mrStatusClass + '">' + mr.status + '</span></div><div class="meta-item">耗时: ' + mr.time + 'ms</div><div class="meta-item">大小: ' + formatSize(mr.size) + '</div></div>' +
      '<div class="detail-tabs">' + tabBtn('response', 'Response') + tabBtn('request', 'Request') + tabBtn('headers', 'Headers') + (hasPage ? tabBtn('page', 'Page') : '') + '</div>' +
      '<div class="tab-content' + (logDetailTab === 'response' ? ' active' : '') + '"><div class="detail-content" style="max-height:250px"><pre>' + escapeHtml(body) + '</pre></div></div>' +
      '<div class="tab-content' + (logDetailTab === 'request' ? ' active' : '') + '"><div style="margin-bottom:10px"><strong>请求信息</strong></div><div class="detail-content" style="max-height:100px;margin-bottom:10px"><table><tr><td>方法</td><td>' + (l.method || 'GET') + '</td></tr><tr><td>路径</td><td>' + l.path + '</td></tr><tr><td>映射目标</td><td>' + mr.url + '</td></tr><tr><td>访问时间</td><td>' + l.time + '</td></tr><tr><td>客户端IP</td><td>' + l.ip + '</td></tr></table></div><div style="margin-bottom:10px"><strong>Query 参数</strong></div><div class="detail-content" style="max-height:80px">' + queryTable(l.query) + '</div></div>' +
      '<div class="tab-content' + (logDetailTab === 'headers' ? ' active' : '') + '"><div style="margin-bottom:10px"><strong>请求 Headers (' + (l.headers ? Object.keys(l.headers).length : 0) + ')</strong></div><div class="detail-content" style="max-height:120px;margin-bottom:10px">' + headerTable(l.headers) + '</div><div style="margin-bottom:10px"><strong>响应 Headers (' + (mr.headers ? Object.keys(mr.headers).length : 0) + ')</strong></div><div class="detail-content" style="max-height:120px">' + headerTable(mr.headers) + '</div></div>' +
      (hasPage ? '<div class="tab-content' + (logDetailTab === 'page' ? ' active' : '') + '">' + renderPageInfo(pageHeader) + '</div>' : '') +
      '<div style="margin-top:10px"><button class="btn btn-success btn-sm" onclick="createMissingFile(\'' + l.path.replace(/'/g, "\\'") + '\')">永久保存</button> <button class="btn btn-warning btn-sm" onclick="editLogOverride(\'' + l.path.replace(/'/g, "\\'") + '\')">临时修改</button> <button class="btn btn-info btn-sm" onclick="openMappingModal(\'' + l.path.replace(/'/g, "\\'") + '\')">编辑映射</button> <button class="btn btn-danger btn-sm" onclick="removeMappingAndRefreshLog(\'' + l.path.replace(/'/g, "\\'") + '\')">取消映射</button></div>';
    panel.classList.add('active');
    renderLogs();
    return;
  }

  // 普通请求
  const pageHeader = l.headers && (l.headers['x-bbae-page'] || l.headers['X-Bbae-Page']);
  const hasPage = !!pageHeader;
  
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
  }).catch(() => {
    const respContent = document.getElementById('logResponseContent');
    if (respContent) respContent.innerHTML = '<em>无法加载</em>';
    window.currentLogResponse = '{}';
  });

  panel.innerHTML =
    '<div class="meta-row"><div class="meta-item"><span class="method method-' + (l.method || 'GET') + '">' + (l.method || 'GET') + '</span></div><div class="meta-item">时间: ' + l.time + '</div><div class="meta-item">IP: ' + l.ip + '</div><div class="meta-item">状态: <span class="log-status ' + statusClass + '">' + statusText + '</span></div>' + (hasOverride ? '<div class="meta-item"><span class="badge badge-override">已临时修改</span></div>' : '') + (hasMapping ? '<div class="meta-item"><span class="badge badge-mapping">已映射</span></div>' : '') + '</div>' +
    '<div style="font-family:monospace;font-size:11px;margin-bottom:10px;word-break:break-all;color:#666">' + (l.fullUrl || l.path) + '</div>' +
    '<div class="detail-tabs">' + tabBtn('response', 'Response') + tabBtn('request', 'Request') + (hasPage ? tabBtn('page', 'Page') : '') + '</div>' +
    '<div class="tab-content' + (logDetailTab === 'response' ? ' active' : '') + '"><div class="detail-content" id="logResponseContent" style="max-height:200px"><em>加载中...</em></div>' + collapsible('Response Headers', '<div id="logResHeaders"><em>加载中...</em></div>', 'res') +
    '<div style="margin-top:10px">' + (isMissing ? '<button class="btn btn-success btn-sm" onclick="createMissingFile(\'' + l.path.replace(/'/g, "\\'") + '\')">永久保存</button> ' : '') + '<button class="btn btn-warning btn-sm" onclick="editLogOverride(\'' + l.path.replace(/'/g, "\\'") + '\')">临时修改</button> <button class="btn btn-info btn-sm" onclick="openMappingModal(\'' + l.path.replace(/'/g, "\\'") + '\')">设置映射</button>' + (hasOverride ? ' <button class="btn btn-danger btn-sm" onclick="removeOverrideAndRefreshLog(\'' + l.path.replace(/'/g, "\\'") + '\')">取消临时</button>' : '') + (hasMapping ? ' <button class="btn btn-danger btn-sm" onclick="removeMappingAndRefreshLog(\'' + l.path.replace(/'/g, "\\'") + '\')">取消映射</button>' : '') + '</div></div>' +
    '<div class="tab-content' + (logDetailTab === 'request' ? ' active' : '') + '"><div style="margin-bottom:10px"><strong>基本信息</strong></div><div class="detail-content" style="max-height:80px;margin-bottom:10px"><table><tr><td>方法</td><td>' + (l.method || 'GET') + '</td></tr><tr><td>路径</td><td>' + l.path + '</td></tr><tr><td>访问时间</td><td>' + l.time + '</td></tr><tr><td>客户端IP</td><td>' + l.ip + '</td></tr></table></div><div style="margin-bottom:10px"><strong>Query 参数</strong></div><div class="detail-content" style="max-height:80px;margin-bottom:10px">' + queryTable(l.query) + '</div>' + collapsible('Request Headers (' + (l.headers ? Object.keys(l.headers).length : 0) + ')', headerTable(l.headers), 'req') + '</div>' +
    (hasPage ? '<div class="tab-content' + (logDetailTab === 'page' ? ' active' : '') + '">' + renderPageInfo(pageHeader) + '</div>' : '');
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

function editLogOverride(path) {
  setTimeout(() => { setTempOverride(path, window.currentLogResponse || '{}'); }, 100);
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
  const folder = document.getElementById('outputFolder').value || 'mock';
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
