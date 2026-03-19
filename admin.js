// 状态变量
let entries = [], groups = {}, selectedIds = new Set(), expandedGroups = new Set(), activeId = null, activeTab = 'response';
let logs = [], expandedLogGroups = new Set(), activeLogId = null, logDetailTab = 'response', logRefreshTimer = null;
let localFiles = [], activeFilePath = null, overrides = {}, mappings = {}, folderMappings = {}, localFolders = {}, globalServers = {}, currentParseFolder = '';
let expandedOverrides = new Set();
let pathDelays = {};
let modalCallback = null, mappingTestTab = 'response';
let logBatchGroups = {}, logBatchSelectedIds = new Set(), logBatchExpandedGroups = new Set();
let publicFolders = [];
let masterConfig = { externalFolderPath: '' };

// 辅助函数：获取路径对应的延迟配置 (含归一化逻辑)
function getPathDelay(path) {
  if (!path) return null;
  const normalized = path.replace(/\/$/, '') || '/';
  const alt = normalized.startsWith('/') ? normalized.substring(1) : '/' + normalized;
  return pathDelays[normalized] || pathDelays[alt] || null;
}

// 辅助函数：获取路径的启用版本
function getEnabledOverride(path) {
  const versions = overrides[path];
  if (!versions || !Array.isArray(versions)) return null;
  return versions.find(v => v.enabled) || null;
}

// 辅助函数：检查路径是否有临时修改
function hasOverride(path) {
  const versions = overrides[path];
  return versions && Array.isArray(versions) && versions.length > 0;
}

// ========== 浏览器存储与持久化 (Backup & Restore) ==========

// 导出配置为文件
function exportConfig() {
  const data = {
    urlMappings: mappings,
    folderMappings: folderMappings,
    localFolders: localFolders,
    globalServers: globalServers,
    pathDelays: pathDelays,
    overrides: overrides,
    exportTime: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'api-dispatcher-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

// 导入配置文件并更新服务器
async function importConfig(inputOrFile) {
  let file;
  if (inputOrFile.files) {
    file = inputOrFile.files[0];
  } else if (inputOrFile instanceof File || inputOrFile instanceof Blob) {
    file = inputOrFile;
  }
  
  if (!file) return;

  const confirmed = await showConfirm('这将覆盖当前服务器上的所有映射和修改规则，确定继续？', '导入配置');
  if (!confirmed) {
    if (inputOrFile.value !== undefined) inputOrFile.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);
      const tasks = [];
      
      if (data.urlMappings) tasks.push(fetch('/admin/mappings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data.urlMappings) }));
      if (data.folderMappings) tasks.push(fetch('/admin/folder-mappings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data.folderMappings) }));
      if (data.localFolders) tasks.push(fetch('/admin/local-folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data.localFolders) }));
      if (data.globalServers) tasks.push(fetch('/admin/global-servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data.globalServers) }));
      if (data.pathDelays) {
        for (const [p, pd] of Object.entries(data.pathDelays)) {
          tasks.push(fetch('/admin/path-delays', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: p, delay: pd.delay, enabled: pd.enabled }) }));
        }
      }
      if (data.overrides) {
        tasks.push(fetch('/admin/overrides/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data.overrides) }));
      }

      await Promise.all(tasks);
      alert('导入成功，配置已同步至服务器。即将自动刷新。');
      location.reload();
    } catch (err) {
      alert('配置文件解析失败: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// 同步到 LocalStorage (备份)
function syncToLocalStorage() {
  const data = {
    urlMappings: mappings,
    folderMappings: folderMappings,
    localFolders: localFolders,
    globalServers: globalServers,
    pathDelays: pathDelays,
    overrides: overrides,
    syncTime: Date.now()
  };
  try {
    localStorage.setItem('api_dispatcher_backup', JSON.stringify(data));
    const btn = document.getElementById('syncStatusBtn');
    if (btn) {
      btn.textContent = '已保存到浏览器 (' + new Date().toLocaleTimeString() + ')';
      btn.className = 'btn btn-sm btn-success';
    }
  } catch (e) {
    alert('保存到浏览器失败 (可能数据量过大): ' + e.message);
  }
}

// 从备份恢复
async function restoreFromLocalStorage() {
  const saved = localStorage.getItem('api_dispatcher_backup');
  if (!saved) {
    alert('未发现浏览器备份数据。');
    return;
  }
  const data = JSON.parse(saved);
  const time = new Date(data.syncTime).toLocaleString();
  const confirmed = await showConfirm('确认从浏览器缓存中恢复？ (备份时间: ' + time + ')', '确认恢复');
  if (confirmed) {
     const blob = new Blob([saved], { type: 'application/json' });
     const file = new File([blob], 'backup.json');
     importConfig(file);
  }
}

// ========== HAR IndexedDB 持久化 ==========
const HAR_DB_NAME = 'APIDispatcherHAR';
const HAR_DB_STORE = 'entries';

function initHarDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HAR_DB_NAME, 1);
    request.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(HAR_DB_STORE)) {
        db.createObjectStore(HAR_DB_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = e => resolve(e.target.result);
    request.onerror = e => reject(e.target.error);
  });
}

async function saveHarEntriesToBrowser() {
  if (!entries || entries.length === 0) return;
  const db = await initHarDB();
  const tx = db.transaction(HAR_DB_STORE, 'readwrite');
  const store = tx.objectStore(HAR_DB_STORE);
  store.clear();
  entries.forEach(entry => store.add(entry));
}

async function loadHarEntriesFromBrowser() {
  try {
    const db = await initHarDB();
    const tx = db.transaction(HAR_DB_STORE, 'readonly');
    const store = tx.objectStore(HAR_DB_STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      if (request.result && request.result.length > 0) {
        entries = request.result;
        document.getElementById('harContent').classList.remove('hidden');
        renderHar();
      }
    };
  } catch (e) {}
}

// 自动尝试加载上次 HAR 数据
loadHarEntriesFromBrowser();

// 初始化
fetch('/admin/server-info').then(r => r.json()).then(d => {
  document.getElementById('serverAddrs').innerHTML = d.addresses.map(a =>
    '<a href="' + a + '/admin" target="_blank" style="margin-right:10px">' + a + '</a>'
  ).join('');
});
// 先加载所有数据，再统一渲染（因为可达性计算需要所有数据）
Promise.all([
  loadGlobalServers(false),
  loadOverrides(false),
  loadMappings(false),
  loadFolderMappings(false),
  loadLocalFolders(false),
  loadPathDelays(false)
]).then(() => {
  // 所有数据加载完成后，统一渲染
  renderGlobalServers();
  renderLocalFolders();
  renderOverrides();
  renderMappings();
  renderFolderMappings();
  renderPathDelays();
});
loadCookieRewrite();
loadGlobalDelay();
loadMasterConfig();

async function loadMasterConfig() {
  const res = await fetch('/admin/master-config');
  const data = await res.json();
  masterConfig = data;
  const input = document.getElementById('dataRootInput');
  if (input) input.value = data.effectiveDataRoot;
}

async function updateDataRootManual() {
  const input = document.getElementById('dataRootInput');
  const path = input.value.trim();
  if (!path) return;
  
  const confirmed = await showConfirm('确定将存储目录更改为：\n' + path + ' ?', '切换存储目录', '确定', false);
  if (confirmed) {
    const saveRes = await fetch('/admin/master-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ externalFolderPath: path })
    });
    const saveResult = await saveRes.json();
    if (saveResult.success) {
      alert('存储目录已切换');
      location.reload();
    } else {
      alert('切换失败: ' + saveResult.error);
      loadMasterConfig();
    }
  } else {
    loadMasterConfig();
  }
}

// ========== 数据目录选择器 (通用) ==========
async function openDirectoryPicker() {
  const res = await fetch('/admin/system/select-folder', { method: 'POST' });
  const result = await res.json();
  if (result.success && result.path) {
    return result.path;
  } else if (result.error) {
    if (result.error !== '用户取消选择或发生系统错误') {
      alert('选择失败: ' + result.error);
    }
  }
  return null;
}

// ========== 数据目录选择器 (系统级 - 切换主数据根目录) ==========
async function selectSystemFolder() {
  const path = await openDirectoryPicker();
  if (path) {
    if (confirm('确定将存储目录切换至：\n' + path + ' ?')) {
      const saveRes = await fetch('/admin/master-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ externalFolderPath: path })
      });
      const saveResult = await saveRes.json();
      if (saveResult.success) {
        alert('存储目录已切换');
        location.reload();
      } else {
        alert('切换失败: ' + saveResult.error);
        loadMasterConfig();
      }
    } else {
      loadMasterConfig();
    }
  }
}

// ========== 各页面独立的文件夹选择函数 ==========
async function chooseServerFolder() {
  const path = await openDirectoryPicker();
  if (path) {
    document.getElementById('serverFolderInput').value = path;
  }
}

async function chooseOutputFolder() {
  const path = await openDirectoryPicker();
  if (path) {
    document.getElementById('outputFolderInput').value = path;
  }
}

async function chooseLocalFolderInModal() {
  const path = await openDirectoryPicker();
  if (path) {
    document.getElementById('localFolderInput').value = path;
  }
}

// 辅助逻辑：当输入框变化时触发解析
async function parseSelectedServerInput(silent = false) {
  const folder = document.getElementById('serverFolderInput').value.trim();
  if (!folder) return;
  currentParseFolder = folder;
  
  const res = await fetch('/admin/files?folder=' + encodeURIComponent(folder));
  const data = await res.json();
  if (data.error) {
    if (!silent) alert('解析失败: ' + data.error);
    return;
  }
  localFiles = data.files || [];
  renderFileList();
}

// 加载文件夹列表
async function loadPublicFolders(currentFolder) {
  const res = await fetch('/admin/folders');
  const data = await res.json();
  publicFolders = data.folders || [];

  // 更新 HAR 解析页面的输出文件夹
  const harInput = document.getElementById('outputFolderInput');
  if (harInput && !harInput.value) {
    harInput.value = publicFolders.length > 0 ? publicFolders[0].path : 'mock';
  }

  // 不再打开页面就自动填充路径和解析，等待用户手动操作
}

// ========== 本地文件夹管理 ==========
async function loadLocalFolders(autoRender = true) {
  // 先加载 public 文件夹列表
  await loadPublicFolders();

  const res = await fetch('/admin/local-folders');
  const data = await res.json();
  localFolders = data.folders || {};
  if (autoRender) renderLocalFolders();
}

function renderLocalFolders() {
  const list = document.getElementById('localFolderList');
  const paths = Object.keys(localFolders);
  document.getElementById('localFolderCount').textContent = '(' + paths.length + ')';
  if (paths.length === 0) { list.innerHTML = '<em>无本地文件夹</em>'; return; }

  // 按优先级分组，找出每个优先级的第一个文件夹
  const priorityGroups = {};
  paths.forEach(folderPath => {
    const f = localFolders[folderPath];
    if (f.enabled) {
      const priority = f.priority ?? 0;
      if (!priorityGroups[priority]) {
        priorityGroups[priority] = [];
      }
      priorityGroups[priority].push(folderPath);
    }
  });

  list.innerHTML = paths.map((folderPath, index) => {
    const f = localFolders[folderPath];
    const disabled = !f.enabled;
    const priority = f.priority ?? 0;
    const folderExists = publicFolders.some(pf => pf.path === folderPath);
    const folderNotExists = f.enabled && !folderExists;

    // 检查是否被同优先级的其他文件夹阻挡（不是第一个）
    let blockedBySamePriority = false;
    if (f.enabled && !folderNotExists && priorityGroups[priority]) {
      const sameGroup = priorityGroups[priority];
      if (sameGroup.length > 1 && sameGroup[0] !== folderPath) {
        blockedBySamePriority = true;
      }
    }

    const unreachable = folderNotExists || blockedBySamePriority;
    const remarkHtml = f.remark ? '<span class="remark-tag" data-remark="' + escapeHtml(f.remark) + '">' + escapeHtml(f.remark) + '</span>' : '';
    let unreachableLabel = '';
    if (folderNotExists) {
      unreachableLabel = '文件夹不存在';
    } else if (blockedBySamePriority) {
      unreachableLabel = '同优先级(' + priority + ')已有其他文件夹';
    }

    return '<div class="item-row' + (disabled ? ' disabled' : '') + (unreachable ? ' unreachable' : '') + '">' +
      '<input type="checkbox" ' + (f.enabled ? 'checked' : '') + ' onchange="toggleLocalFolderEnabled(\'' + folderPath.replace(/'/g, "\\'") + '\', this.checked)" title="启用/禁用">' +
      '<span class="path">' + folderPath + (unreachable ? ' <span style="color:#dc3545;font-size:10px;margin-left:5px">[' + unreachableLabel + ']</span>' : '') + '</span>' +
      '<div class="info-group">' +
        remarkHtml +
        '<span class="badge-info">优先级: ' + priority + '</span>' +
        (f.delay ? '<span class="badge-info badge-delay">延迟: ' + f.delay + 'ms</span>' : '') +
      '</div>' +
      '<div class="actions">' +
        '<button class="btn btn-sm btn-info" onclick="openLocalFolderModal(\'' + folderPath.replace(/'/g, "\\'") + '\')">编辑</button>' +
        '<button class="btn btn-sm btn-danger" onclick="removeLocalFolder(\'' + folderPath.replace(/'/g, "\\'") + '\')">删除</button>' +
      '</div></div>';
  }).join('');
}

async function toggleLocalFolderEnabled(folderPath, enabled) {
  await fetch('/admin/local-folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: folderPath, enabled }) });
  localFolders[folderPath].enabled = enabled;
  renderLocalFolders();
}

async function removeLocalFolder(folderPath) {
  await fetch('/admin/local-folders', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: folderPath }) });
  delete localFolders[folderPath];
  renderLocalFolders();
  // 刷新其他列表的可达性
  renderOverrides();
  renderMappings();
  renderFolderMappings();
}

function openLocalFolderModal(folderPath = '') {
  document.getElementById('localFolderInput').value = folderPath;
  const f = localFolders[folderPath] || {};
  document.getElementById('localFolderPriority').value = f.priority ?? 0;
  document.getElementById('localFolderDelay').value = f.delay ?? 0;
  document.getElementById('localFolderRemark').value = f.remark || '';
  document.getElementById('localFolderModal').classList.add('active');
}

function closeLocalFolderModal() {
  document.getElementById('localFolderModal').classList.remove('active');
}

async function saveLocalFolderFromModal() {
  const folderPath = document.getElementById('localFolderInput').value.trim();
  if (!folderPath) {
    alert('请选择或输入文件夹路径');
    return;
  }
  const priority = parseInt(document.getElementById('localFolderPriority').value) || 0;
  const delay = parseInt(document.getElementById('localFolderDelay').value) || 0;
  const remark = document.getElementById('localFolderRemark').value.trim();
  if (!folderPath) return alert('请选择文件夹');
  await fetch('/admin/local-folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: folderPath, enabled: true, priority, remark, delay }) });
  localFolders[folderPath] = { enabled: true, priority, remark, delay };
  renderLocalFolders();
  // 刷新其他列表的可达性
  renderOverrides();
  renderMappings();
  renderFolderMappings();
  closeLocalFolderModal();
}

// Tab切换
function showTab(name) {
  document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  
  // 查找对应的 Tab 按钮或下拉项
  const tabBtn = document.querySelector('.tab[onclick*="\'' + name + '\'"]');
  const dropdownItem = document.querySelector('.dropdown-item[onclick*="\'' + name + '\'"]');
  
  if (tabBtn) {
    tabBtn.classList.add('active');
  } else if (dropdownItem) {
    // 如果是下拉项，激活它的父级切换按钮
    const toggle = document.getElementById('toolsToggle');
    if (toggle) toggle.classList.add('active');
  }
  
  const panel = document.getElementById(name);
  if (panel) panel.classList.add('active');

  if (name === 'logs') { refreshLogs(); startAutoRefresh(); }
  else { stopAutoRefresh(); }
}

// 自动刷新
function startAutoRefresh() {
  if (logRefreshTimer) return;
  if (document.getElementById('logAutoRefresh').checked) {
    const interval = parseInt(document.getElementById('logRefreshInterval').value) || 1000;
    logRefreshTimer = setInterval(() => refreshLogs(true), interval);
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
document.getElementById('logList').addEventListener('scroll', function () {
  if (this.scrollTop > 50) stopAutoRefresh();
});

// ========== 全局服务器 ==========
async function loadGlobalServers(autoRender = true) {
  const res = await fetch('/admin/global-servers');
  const data = await res.json();
  globalServers = data.servers || {};
  if (autoRender) renderGlobalServers();
}

function renderGlobalServers() {
  const list = document.getElementById('globalServerList');
  const urls = Object.keys(globalServers);
  document.getElementById('globalServerCount').textContent = '(' + urls.length + ')';
  if (urls.length === 0) { list.innerHTML = '<em>无全局映射服务器</em>'; return; }

  // 按优先级分组，找出每个优先级的第一个服务器
  const priorityGroups = {};
  urls.forEach(url => {
    const s = globalServers[url];
    if (s.enabled) {
      const priority = s.priority ?? 100;
      if (!priorityGroups[priority]) {
        priorityGroups[priority] = [];
      }
      priorityGroups[priority].push(url);
    }
  });

  list.innerHTML = urls.map(url => {
    const s = globalServers[url];
    const disabled = !s.enabled;
    const priority = s.priority ?? 100;

    // 检查是否被同优先级的其他服务器阻挡（不是第一个）
    let blockedBySamePriority = false;
    if (s.enabled && priorityGroups[priority]) {
      const sameGroup = priorityGroups[priority];
      if (sameGroup.length > 1 && sameGroup[0] !== url) {
        blockedBySamePriority = true;
      }
    }

    const unreachable = blockedBySamePriority;
    const remarkHtml = s.remark ? '<span class="remark-tag" data-remark="' + escapeHtml(s.remark) + '">' + escapeHtml(s.remark) + '</span>' : '';
    const unreachableLabel = blockedBySamePriority ? '同优先级(' + priority + ')已有其他服务器' : '';

    return '<div class="item-row' + (disabled ? ' disabled' : '') + (unreachable ? ' unreachable' : '') + '">' +
      '<input type="checkbox" ' + (s.enabled ? 'checked' : '') + ' onchange="toggleGlobalServerEnabled(\'' + url.replace(/'/g, "\\'") + '\', this.checked)" title="启用/禁用">' +
      '<span class="path">' + url + (unreachable ? ' <span style="color:#dc3545;font-size:10px;margin-left:5px">[' + unreachableLabel + ']</span>' : '') + '</span>' +
      '<div class="info-group">' +
        remarkHtml +
        '<span class="badge-info">优先级: ' + priority + '</span>' +
        (s.delay ? '<span class="badge-info badge-delay">延迟: ' + s.delay + 'ms</span>' : '') +
      '</div>' +
      '<div class="actions">' +
        '<button class="btn btn-sm btn-info" onclick="openGlobalServerModal(\'' + url.replace(/'/g, "\\'") + '\')">编辑</button>' +
        '<button class="btn btn-sm btn-danger" onclick="removeGlobalServer(\'' + url.replace(/'/g, "\\'") + '\')">删除</button>' +
      '</div></div>';
  }).join('');
}

async function toggleGlobalServerEnabled(url, enabled) {
  await fetch('/admin/global-servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, enabled }) });
  globalServers[url].enabled = enabled;
  renderGlobalServers();
  // 刷新其他列表的可达性
  renderOverrides();
  renderMappings();
  renderFolderMappings();
}

async function removeGlobalServer(url) {
  await fetch('/admin/global-servers', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
  delete globalServers[url];
  renderGlobalServers();
  // 刷新其他列表的可达性
  renderOverrides();
  renderMappings();
  renderFolderMappings();
}

function openGlobalServerModal(url) {
  const s = globalServers[url] || {};
  document.getElementById('globalServerUrl').value = url || '';
  document.getElementById('globalServerPriority').value = s.priority ?? 100;
  document.getElementById('globalServerDelay').value = s.delay ?? 0;
  document.getElementById('globalServerRemark').value = s.remark || '';
  document.getElementById('globalServerModal').classList.add('active');
}

function closeGlobalServerModal() {
  document.getElementById('globalServerModal').classList.remove('active');
}

async function saveGlobalServerFromModal() {
  const url = document.getElementById('globalServerUrl').value.trim();
  const priority = parseInt(document.getElementById('globalServerPriority').value) || 100;
  const delay = parseInt(document.getElementById('globalServerDelay').value) || 0;
  const remark = document.getElementById('globalServerRemark').value.trim();
  if (!url) return alert('请输入服务器地址');
  await fetch('/admin/global-servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, enabled: true, priority, remark, delay }) });
  globalServers[url] = { enabled: true, priority, remark, delay };
  renderGlobalServers();
  // 刷新其他列表的可达性
  renderOverrides();
  renderMappings();
  renderFolderMappings();
  closeGlobalServerModal();
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

// ========== 全局延迟 ==========
async function loadGlobalDelay() {
  const res = await fetch('/admin/global-delay');
  const data = await res.json();
  document.getElementById('globalDelayInput').value = data.delay || 0;
}

async function updateGlobalDelay() {
  const delay = parseInt(document.getElementById('globalDelayInput').value) || 0;
  await fetch('/admin/global-delay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delay }) });
}

// ========== 接口特定延迟 ==========
async function loadPathDelays(autoRender = true) {
  const res = await fetch('/admin/path-delays');
  pathDelays = await res.json();
  if (autoRender) renderPathDelays();
}

function renderPathDelays() {
  const list = document.getElementById('pathDelayList');
  const paths = Object.keys(pathDelays);
  document.getElementById('pathDelayCount').textContent = '(' + paths.length + ')';
  if (paths.length === 0) { list.innerHTML = '<em>无接口延迟</em>'; return; }

  list.innerHTML = paths.map(p => {
    const pd = pathDelays[p];
    const disabled = !pd.enabled;
    return '<div class="item-row' + (disabled ? ' disabled' : '') + '">' +
      '<input type="checkbox" ' + (pd.enabled ? 'checked' : '') + ' onchange="togglePathDelayEnabled(\'' + p.replace(/'/g, "\\'") + '\', this.checked)" title="启用/禁用">' +
      '<span class="path">' + p + '</span>' +
      '<div class="info-group">' +
        '<span class="badge-info badge-delay">延迟: ' + pd.delay + 'ms</span>' +
      '</div>' +
      '<div class="actions">' +
        '<button class="btn btn-sm btn-info" onclick="openPathDelayModal(\'' + p.replace(/'/g, "\\'") + '\')">编辑</button>' +
        '<button class="btn btn-sm btn-danger" onclick="deletePathDelay(\'' + p.replace(/'/g, "\\'") + '\')">删除</button>' +
      '</div></div>';
  }).join('');
}

async function togglePathDelayEnabled(path, enabled) {
  const pd = pathDelays[path];
  await fetch('/admin/path-delays', { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ path, delay: pd.delay, enabled }) 
  });
  pd.enabled = enabled;
  renderPathDelays();
}

function openPathDelayModal(path = '') {
  const pd = pathDelays[path] || { delay: 100, enabled: true };
  document.getElementById('pathDelayModalTitle').textContent = path ? '编辑接口延迟' : '添加接口延迟';
  document.getElementById('pathDelayPath').value = path;
  document.getElementById('pathDelayPath').readOnly = !!path;
  document.getElementById('pathDelayValue').value = pd.delay;
  document.getElementById('pathDelayEnabled').checked = pd.enabled;
  document.getElementById('pathDelayModal').classList.add('active');
}

function closePathDelayModal() {
  document.getElementById('pathDelayModal').classList.remove('active');
}

async function savePathDelay() {
  const path = document.getElementById('pathDelayPath').value.trim();
  const delay = parseInt(document.getElementById('pathDelayValue').value) || 0;
  const enabled = document.getElementById('pathDelayEnabled').checked;
  if (!path) return alert('请输入接口路径');
  await fetch('/admin/path-delays', { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ path, delay, enabled }) 
  });
  pathDelays[path] = { delay, enabled };
  renderPathDelays();
  closePathDelayModal();
}

async function deletePathDelay(path) {
  const confirmed = await showConfirm('确定删除该接口的延迟设置?', '删除确认', '删除');
  if (!confirmed) return;
  await fetch('/admin/path-delays', { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ path, delay: null }) 
  });
  delete pathDelays[path];
  renderPathDelays();
}

// ========== 映射管理 ==========
let mappingTestData = null; // 缓存测试结果

async function loadMappings(autoRender = true) {
  const res = await fetch('/admin/mappings');
  mappings = await res.json();
  if (autoRender) renderMappings();
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
    const priority = m.priority ?? 1;

    // 收集所有可能阻挡当前路径的优先级来源
    const blockingPriorities = [];

    // 1. 本地文件夹优先级（取所有启用的本地文件夹中的最高优先级）
    Object.values(localFolders).forEach(lf => {
      if (lf.enabled) {
        blockingPriorities.push({ type: '本地文件夹', priority: lf.priority ?? 0 });
      }
    });

    // 2. 全局服务器（取所有启用的全局服务器中的最高优先级）
    Object.values(globalServers).forEach(gs => {
      if (gs.enabled) {
        blockingPriorities.push({ type: '全局服务器', priority: gs.priority ?? 100 });
      }
    });

    // 3. 同路径的临时修改（优先级更高的）
    const enabledOverride = getEnabledOverride(p);
    if (enabledOverride) {
      const overridePriority = enabledOverride.priority ?? 1;
      if (overridePriority > priority) {
        blockingPriorities.push({ type: '临时修改', priority: overridePriority });
      }
    }

    // 4. 同路径的其他URL映射（优先级更高的）- 只检查完全相同的路径
    Object.keys(mappings).forEach(otherPath => {
      if (otherPath !== p && mappings[otherPath].enabled && otherPath === p) {
        const otherPriority = mappings[otherPath].priority ?? 1;
        if (otherPriority > priority) {
          blockingPriorities.push({ type: '其他URL映射', priority: otherPriority });
        }
      }
    });

    // 5. 匹配的文件夹映射（优先级更高的）
    Object.keys(folderMappings).forEach(pattern => {
      const fm = folderMappings[pattern];
      if (fm.enabled) {
        let matched = false;
        if (pattern.endsWith('*')) {
          // 文件夹映射是通配符，检查当前路径是否匹配
          matched = p.startsWith(pattern.slice(0, -1));
        } else {
          // 文件夹映射是精确路径
          matched = p === pattern || p.startsWith(pattern + '/');
        }
        if (matched) {
          const fmPriority = fm.priority ?? 1;
          if (fmPriority > priority) {
            blockingPriorities.push({ type: '文件夹映射', priority: fmPriority });
          }
        }
      }
    });

    // 检查是否被更高优先级阻挡
    let blockedBy = null;
    if (m.enabled) {
      for (const bp of blockingPriorities) {
        if (priority < bp.priority) {
          if (!blockedBy || bp.priority > blockedBy.priority) {
            blockedBy = bp;
          }
        }
      }
    }

    const unreachable = !!blockedBy;
    const remarkHtml = m.remark ? '<span class="remark-tag" data-remark="' + escapeHtml(m.remark) + '">' + escapeHtml(m.remark) + '</span>' : '';
    // 简洁的不可达原因
    const unreachableLabel = blockedBy ? '<' + blockedBy.type + '(' + blockedBy.priority + ')' : '';
    return '<div class="mapping-item' + (disabled ? ' disabled' : '') + (unreachable ? ' unreachable' : '') + '">' +
      '<input type="checkbox" ' + (m.enabled ? 'checked' : '') + ' onchange="toggleMappingEnabled(\'' + p.replace(/'/g, "\\'") + '\', this.checked)" title="启用/禁用">' +
      '<span class="path">' + p + (isWildcard ? ' <span style="color:#17a2b8;font-size:10px">(前缀)</span>' : '') + '</span>' +
      '<span class="target">→ ' + m.target + (unreachable ? ' <span style="color:#dc3545;font-size:10px;margin-left:5px">[' + unreachableLabel + ']</span>' : '') + '</span>' +
      '<div class="info-group">' +
        remarkHtml +
        '<span class="badge-info">优先级: ' + priority + '</span>' +
        (m.delay ? '<span class="badge-info badge-delay">延迟: ' + m.delay + 'ms</span>' : '') +
      '</div>' +
      '<div class="actions">' +
        '<button class="btn btn-sm btn-info" onclick="openMappingModal(\'' + p.replace(/'/g, "\\'") + '\')">编辑</button>' +
        '<button class="btn btn-sm btn-danger" onclick="removeMapping(\'' + p.replace(/'/g, "\\'") + '\')">删除</button>' +
      '</div></div>';
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
  // 刷新所有列表，因为优先级变化会影响其他项的可达性
  renderMappings();
  renderOverrides();
  renderFolderMappings();
}

async function removeMapping(apiPath) {
  const m = mappings[apiPath];
  const target = m ? m.target : '未知目标';
  const confirmed = await showConfirm('确定取消接口映射？\n\n接口：' + apiPath + '\n目标：' + target, '取消确认', '确认取消');
  if (!confirmed) return;
  await fetch('/admin/mappings', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: apiPath }) });
  await loadMappings();
}

function openMappingModal(apiPath) {
  document.getElementById('mappingPath').value = apiPath || '';
  const m = mappings[apiPath] || {};
  document.getElementById('mappingTarget').value = m.target || '';
  document.getElementById('mappingPriority').value = m.priority ?? 1;
  document.getElementById('mappingDelay').value = m.delay ?? 0;
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
  const delay = parseInt(document.getElementById('mappingDelay').value) || 0;
  const remark = document.getElementById('mappingRemark').value.trim();
  if (!apiPath) return alert('请输入接口路径');
  if (!target) return alert('请输入映射目标地址');
  await fetch('/admin/mappings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: apiPath, target, enabled: true, priority, remark, delay }) });
  mappings[apiPath] = { target, enabled: true, priority, remark, delay };
  // 刷新所有列表，因为优先级变化会影响其他项的可达性
  renderMappings();
  renderOverrides();
  renderFolderMappings();
  closeMappingModal();
  if (activeLogId !== null) showLogDetail(activeLogId);
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
async function loadFolderMappings(autoRender = true) {
  // 先刷新文件夹列表，确保 publicFolders 是最新的
  const folderRes = await fetch('/admin/folders');
  const folderData = await folderRes.json();
  publicFolders = folderData.folders || [];

  const res = await fetch('/admin/folder-mappings');
  folderMappings = await res.json();
  if (autoRender) renderFolderMappings();
}

function renderFolderMappings() {
  const list = document.getElementById('folderMappingList');
  const patterns = Object.keys(folderMappings);
  document.getElementById('folderMappingCount').textContent = '(' + patterns.length + ')';
  if (patterns.length === 0) { list.innerHTML = '<em>无文件夹映射</em>'; return; }

  // 判断 patternA 的匹配范围是否完全覆盖 patternB（两者都是“路径子树”匹配：等于或以其为前缀）
  const normalizeRoot = (pattern) => {
    if (!pattern) return '';
    let root = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
    if (root.endsWith('/') && root.length > 1) root = root.slice(0, -1);
    return root;
  };
  const coversAll = (blockerPattern, currentPattern) => {
    const b = normalizeRoot(blockerPattern);
    const c = normalizeRoot(currentPattern);
    if (!b || !c) return false;
    return c === b || c.startsWith(b + '/');
  };

  list.innerHTML = patterns.map(p => {
    const m = folderMappings[p];
    const isWildcard = p.endsWith('*');
    const disabled = !m.enabled;
    const priority = m.priority ?? 1;
    // 检查文件夹是否存在
    const folderExists = publicFolders.some(f => f.path === m.folder);
    const folderNotExists = m.enabled && !folderExists;

    // 收集所有可能阻挡当前路径的优先级来源
    const blockingPriorities = [];

    // 1. 本地文件夹优先级（取所有启用的本地文件夹中的最高优先级）
    Object.values(localFolders).forEach(lf => {
      if (lf.enabled) {
        blockingPriorities.push({ type: '本地文件夹', priority: lf.priority ?? 0 });
      }
    });

    // 2. 全局服务器（取所有启用的全局服务器中的最高优先级）
    Object.values(globalServers).forEach(gs => {
      if (gs.enabled) {
        blockingPriorities.push({ type: '全局服务器', priority: gs.priority ?? 100 });
      }
    });

    // 3. 匹配的临时修改（优先级更高的）
    Object.keys(overrides).forEach(overridePath => {
      const o = overrides[overridePath];
      if (o.enabled) {
        // 临时修改一般是“单个接口”覆盖，只会影响该接口本身；只有当其覆盖范围能完全覆盖当前文件夹映射时，才算“阻挡整条规则”
        const oPriority = o.priority ?? 1;
        if (oPriority > priority && coversAll(overridePath, p)) {
          blockingPriorities.push({ type: '临时修改', priority: oPriority });
        }
      }
    });

    // 4. 匹配的URL映射（优先级更高的）
    Object.keys(mappings).forEach(mappingPath => {
      const mp = mappings[mappingPath];
      if (mp.enabled) {
        const mpPriority = mp.priority ?? 1;
        // 只有当该 URL 映射的覆盖范围能完全覆盖当前文件夹映射的命中范围时，才会让当前文件夹映射“整体不可达”
        if (mpPriority > priority && coversAll(mappingPath, p)) {
          blockingPriorities.push({ type: 'URL映射', priority: mpPriority });
        }
      }
    });

    // 5. 其他文件夹映射（优先级更高的）
    Object.keys(folderMappings).forEach(otherPattern => {
      if (otherPattern !== p && folderMappings[otherPattern].enabled) {
        const fm = folderMappings[otherPattern];
        const fmPriority = fm.priority ?? 1;
        // 只在“对方覆盖范围完全包含当前范围”时才算阻挡（部分重叠不应导致整条规则不可达）
        if (fmPriority > priority && coversAll(otherPattern, p)) {
          blockingPriorities.push({ type: '其他文件夹映射', priority: fmPriority });
        }
      }
    });

    // 检查是否被更高优先级阻挡
    let blockedBy = null;
    if (m.enabled && !folderNotExists) {
      for (const bp of blockingPriorities) {
        if (priority < bp.priority) {
          if (!blockedBy || bp.priority > blockedBy.priority) {
            blockedBy = bp;
          }
        }
      }
    }

    const unreachable = folderNotExists || blockedBy;
    const remarkHtml = m.remark ? '<span class="remark-tag" data-remark="' + escapeHtml(m.remark) + '">' + escapeHtml(m.remark) + '</span>' : '';
    // 简洁的不可达原因
    let unreachableLabel = '';
    if (folderNotExists) {
      unreachableLabel = '文件夹不存在';
    } else if (blockedBy) {
      unreachableLabel = '<' + blockedBy.type + '(' + blockedBy.priority + ')';
    }
    return '<div class="mapping-item' + (disabled ? ' disabled' : '') + (unreachable ? ' unreachable' : '') + '">' +
      '<input type="checkbox" ' + (m.enabled ? 'checked' : '') + ' onchange="toggleFolderMappingEnabled(\'' + p.replace(/'/g, "\\'") + '\', this.checked)" title="启用/禁用">' +
      '<span class="path">' + p + (isWildcard ? ' <span style="color:#17a2b8;font-size:10px">(前缀)</span>' : '') + '</span>' +
      '<span class="target">→ ' + m.folder + (unreachable ? ' <span style="color:#dc3545;font-size:10px;margin-left:5px">[' + unreachableLabel + ']</span>' : '') + '</span>' +
      '<div class="info-group">' +
        remarkHtml +
        '<span class="badge-info">优先级: ' + priority + '</span>' +
        (m.delay ? '<span class="badge-info badge-delay">延迟: ' + m.delay + 'ms</span>' : '') +
      '</div>' +
      '<div class="actions">' +
        '<button class="btn btn-sm btn-info" onclick="openFolderMappingModal(\'' + p.replace(/'/g, "\\'") + '\')">编辑</button>' +
        '<button class="btn btn-sm btn-danger" onclick="removeFolderMapping(\'' + p.replace(/'/g, "\\'") + '\')">删除</button>' +
      '</div></div>';
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
  // 刷新所有列表，因为优先级变化会影响其他项的可达性
  renderFolderMappings();
  renderOverrides();
  renderMappings();
}

async function removeFolderMapping(pattern) {
  await fetch('/admin/folder-mappings', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pattern }) });
  loadFolderMappings();
}

function openFolderMappingModal(pattern) {
  document.getElementById('folderMappingPattern').value = pattern || '';
  const m = folderMappings[pattern] || {};
  document.getElementById('folderMappingPriority').value = m.priority ?? 1;
  document.getElementById('folderMappingDelay').value = m.delay ?? 0;
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
  const delay = parseInt(document.getElementById('folderMappingDelay').value) || 0;
  const remark = document.getElementById('folderMappingRemark').value.trim();
  if (!pattern) return alert('请输入匹配路径');
  if (!folder) return alert('请选择映射文件夹');
  await fetch('/admin/folder-mappings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pattern, folder, enabled: true, priority, remark, delay }) });
  folderMappings[pattern] = { folder, enabled: true, priority, remark, delay };
  // 刷新所有列表，因为优先级变化会影响其他项的可达性
  renderFolderMappings();
  renderOverrides();
  renderMappings();
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

function openModal(title, path, content, onSave, showFileActions = false, showPriority = false, currentPriority = 1, currentRemark = '', showFolderSelect = false, saveBtnText = '', showConditions = false, currentConditions = [], currentConditionLogic = 'and', currentDelay = 0) {
  const titleEl = document.getElementById('modalTitle');
  const pathEl = document.getElementById('modalPath');
  const editorEl = document.getElementById('jsonEditor');
  const errorEl = document.getElementById('jsonError');
  if (titleEl) titleEl.textContent = title;
  if (pathEl) pathEl.textContent = path;
  if (editorEl) editorEl.value = content;
  if (errorEl) errorEl.textContent = '';
  currentModalPath = path;
  modalCallback = onSave;

  // 显示/隐藏永久保存和删除按钮
  const permanentBtn = document.getElementById('modalPermanentBtn');
  const deleteBtn = document.getElementById('modalDeleteBtn');
  if (permanentBtn) permanentBtn.style.display = showFileActions ? 'inline-block' : 'none';
  if (deleteBtn) deleteBtn.style.display = showFileActions ? 'inline-block' : 'none';

  // 显示/隐藏文件夹选择
  const folderDiv = document.getElementById('modalFolderDiv');
  if (folderDiv) {
    if (showFolderSelect) {
      folderDiv.style.display = 'flex';
      const folderSelect = document.getElementById('modalFolderSelect');
      if (folderSelect) {
        let optionsHtml = publicFolders.map(f => {
          const name = f.path.replace(/^public\//, '');
          return '<option value="' + name + '">' + name + '</option>';
        }).join('');
        folderSelect.innerHTML = '<option value="mock">mock</option>' + optionsHtml + '<option value="__new__">+ 新建文件夹...</option>';
      }
    } else {
      folderDiv.style.display = 'none';
    }
  }

  // 显示/隐藏优先级输入
  const priorityDiv = document.getElementById('modalPriorityDiv');
  const priorityInput = document.getElementById('modalPriority');
  if (priorityDiv) {
    if (showPriority) {
      priorityDiv.style.display = 'flex';
      if (priorityInput) priorityInput.value = currentPriority;
    } else {
      priorityDiv.style.display = 'none';
    }
  }

  const remarkDiv = document.getElementById('modalRemarkDiv');
  const remarkInput = document.getElementById('modalRemark');
  const delayInput = document.getElementById('modalDelay');
  if (remarkDiv) {
    if (showPriority) {
      remarkDiv.style.display = 'block';
      if (remarkInput) remarkInput.value = currentRemark || '';
      if (delayInput) delayInput.value = currentDelay || 0;
    } else {
      remarkDiv.style.display = 'none';
    }
  }

  // 显示/隐藏参数条件编辑器
  const conditionsDiv = document.getElementById('modalConditionsDiv');
  const conditionsList = document.getElementById('modalConditionsList');
  if (conditionsDiv) {
    if (showConditions) {
      conditionsDiv.style.display = 'block';
      if (conditionsList) {
        conditionsList.innerHTML = '';
        (currentConditions || []).forEach(c => addConditionRow(c));
      }
      const logicSelect = document.getElementById('modalConditionLogic');
      if (logicSelect) {
        logicSelect.checked = (currentConditionLogic === 'or');
        const logicLabel = document.getElementById('modalConditionLogicLabel');
        if (logicLabel) logicLabel.textContent = logicSelect.checked ? '满足任一条件 (或)' : '满足所有条件 (且)';
      }
    } else {
      conditionsDiv.style.display = 'none';
      if (conditionsList) conditionsList.innerHTML = '';
    }
  }

  const modal = document.getElementById('jsonModal');
  if (modal) {
    modal.classList.add('active');
    const footer = modal.querySelector('.modal-footer');
    if (footer) {
      const finalSaveText = saveBtnText || (showFolderSelect ? '保存' : '临时保存');
      footer.innerHTML =
        '<button class="btn btn-danger" id="modalDeleteBtn" style="display:none" onclick="deleteFileFromModal()">删除文件</button>' +
        '<button class="btn btn-success" id="modalPermanentBtn" style="display:none" onclick="savePermanentFromModal()">永久保存</button>' +
        '<button class="btn btn-secondary" onclick="formatJson()">格式化</button>' +
        '<button class="btn btn-secondary" onclick="closeModal()">取消</button>' +
        '<button class="btn btn-primary" id="modalSaveBtn">' + finalSaveText + '</button>';

      const newDeleteBtn = document.getElementById('modalDeleteBtn');
      const newPermanentBtn = document.getElementById('modalPermanentBtn');
      if (newDeleteBtn) newDeleteBtn.style.display = showFileActions ? 'inline-block' : 'none';
      if (newPermanentBtn) newPermanentBtn.style.display = showFileActions ? 'inline-block' : 'none';

      const saveBtn = document.getElementById('modalSaveBtn');
      if (saveBtn) {
        saveBtn.onclick = handleModalSaveClick;
      }
    }
  }
}

// ---- 条件行管理 ----
function addConditionRow(c = {}) {
  const list = document.getElementById('modalConditionsList');
  if (!list) return;
  const idx = list.children.length;
  const row = document.createElement('div');
  row.className = 'condition-row';
  row.style.cssText = 'display:flex;gap:6px;align-items:center';
  row.innerHTML =
    '<select class="cond-source" style="font-size:12px;padding:3px 6px">' +
    '<option value="query"' + (c.source === 'query' || !c.source ? ' selected' : '') + '>Query</option>' +
    '<option value="body"' + (c.source === 'body' ? ' selected' : '') + '>Body</option>' +
    '</select>' +
    '<input class="cond-key" type="text" placeholder="参数名" value="' + escapeHtml(c.key || '') + '" style="flex:1;font-size:12px;padding:3px 6px">' +
    '<select class="cond-op" style="font-size:12px;padding:3px 6px">' +
    '<option value="eq"' + ((!c.op || c.op === 'eq') ? ' selected' : '') + '>等于</option>' +
    '<option value="neq"' + (c.op === 'neq' ? ' selected' : '') + '>不等于</option>' +
    '<option value="contains"' + (c.op === 'contains' ? ' selected' : '') + '>包含</option>' +
    '<option value="exists"' + (c.op === 'exists' ? ' selected' : '') + '>存在</option>' +
    '</select>' +
    '<input class="cond-value" type="text" placeholder="值" value="' + escapeHtml(c.value || '') + '" style="flex:1;font-size:12px;padding:3px 6px">' +
    '<button onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:#dc3545;font-size:16px;line-height:1;padding:0 4px" title="删除">×</button>';
  // 当 op 为 exists 时隐藏 value 输入
  const opSelect = row.querySelector('.cond-op');
  const valueInput = row.querySelector('.cond-value');
  const toggleValue = () => { valueInput.style.display = opSelect.value === 'exists' ? 'none' : ''; };
  opSelect.addEventListener('change', toggleValue);
  toggleValue();
  list.appendChild(row);
}

function getModalConditions() {
  const list = document.getElementById('modalConditionsList');
  if (!list) return [];
  return Array.from(list.querySelectorAll('.condition-row')).map(row => ({
    source: row.querySelector('.cond-source').value,
    key: row.querySelector('.cond-key').value.trim(),
    op: row.querySelector('.cond-op').value,
    value: row.querySelector('.cond-value').value.trim()
  })).filter(c => c.key);
}


function handleModalFolderChange() {
  const select = document.getElementById('modalFolderSelect');
  if (select && select.value === '__new__') {
    document.getElementById('newFolderName').value = '';
    document.getElementById('newFolderModal').classList.add('active');
    window.newFolderTarget = 'modalFolderSelect';
  }
}

function closeModal() {
  document.getElementById('jsonModal').classList.remove('active');
  modalCallback = null;
  currentModalPath = '';
  window._tempConditionsCache = null;
  // 由于 modal 是单例，重置所有版本管理相关的 UI 状态
  resetOverrideVersionModalView();
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

async function handleModalSaveClick() {
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
}

const initialModalSaveBtn = document.getElementById('modalSaveBtn');
if (initialModalSaveBtn) {
  initialModalSaveBtn.onclick = handleModalSaveClick;
}

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
    if (activeLogId !== null) refreshLogs();
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
    if (activeLogId !== null) refreshLogs();
  } else {
    alert('删除失败: ' + result.error);
  }
}

// ========== 临时覆盖管理 ==========
async function loadOverrides(autoRender = true) {
  const res = await fetch('/admin/overrides');
  overrides = await res.json();
  if (autoRender) renderOverrides();
}

// 辅助函数：格式化条件摘要显示
function formatOverrideConditions(v) {
  if (!v.conditions || v.conditions.length === 0) return '';
  const opMap = { eq: '=', contains: '≈', exists: '⚡', neq: '≠' };
  const logicText = v.conditionLogic === 'or' ? ' | ' : ' & ';
  
  const tags = v.conditions.map(c => {
    const src = c.source === 'body' ? 'B' : 'Q';
    let text = src + '.' + c.key;
    if (c.op === 'exists') text += ' 存在';
    else text += opMap[c.op] + (c.value || '');
    return text;
  });
  
  return '<span class="condition-detail" style="background:#f0f7ff;color:#0056b3;padding:1px 6px;border-radius:3px;font-size:10px;border:1px solid #cce5ff">' + 
         tags.join(logicText) + '</span>';
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

  list.innerHTML = paths.sort().map(p => {
    const versions = overrides[p] || [];
    if (versions.length === 0) return '';
    
    // 计算唯一的条件集数量
    const condSets = new Set();
    versions.forEach(v => {
      const s = (v.conditions || []).map(c => `${c.type}:${c.key}:${c.op}:${c.value}`).sort().join('|') + (v.conditionLogic || 'and');
      condSets.add(s);
    });

    // 如果所有版本的规则条件完全一致（或者只有一条规则），则不折叠，直接铺开
    if (condSets.size <= 1) {
      return versions.map((v, idx) => {
        const priority = v.priority ?? 1;
        let jsonInvalid = false;
        if (isJsonPath(p)) {
          try { JSON.parse(v.content || ''); } catch { jsonInvalid = true; }
        }

        const blockingPriorities = [];
        Object.values(localFolders).forEach(lf => { if (lf.enabled) blockingPriorities.push({ type: '本地文件夹', priority: lf.priority ?? 0 }); });
        Object.values(globalServers).forEach(gs => { if (gs.enabled) blockingPriorities.push({ type: '全局服务器', priority: gs.priority ?? 100 }); });
        if (mappings[p] && mappings[p].enabled) {
          const mappingPriority = mappings[p].priority ?? 1;
          if (mappingPriority > priority) blockingPriorities.push({ type: 'URL映射', priority: mappingPriority });
        }
        Object.keys(folderMappings).forEach(pattern => {
          const fm = folderMappings[pattern];
          if (fm.enabled) {
            let matched = false;
            if (pattern.endsWith('*')) matched = p.startsWith(pattern.slice(0, -1));
            else matched = p === pattern || p.startsWith(pattern + '/');
            if (matched) {
              const fmPriority = fm.priority ?? 1;
              if (fmPriority > priority) blockingPriorities.push({ type: '文件夹映射', priority: fmPriority });
            }
          }
        });

        let blockedBy = null;
        if (v.enabled && !jsonInvalid) {
          for (const bp of blockingPriorities) {
            if (priority < bp.priority) {
              if (!blockedBy || bp.priority > blockedBy.priority) blockedBy = bp;
            }
          }
        }

        const unreachable = jsonInvalid || blockedBy;
        const remarkHtml = v.remark ? '<span class="remark-tag" data-remark="' + escapeHtml(v.remark) + '">' + escapeHtml(v.remark) + '</span>' : '';
        let unreachableLabel = '';
        if (jsonInvalid) unreachableLabel = 'JSON无效';
        else if (blockedBy) unreachableLabel = '<' + blockedBy.type + '(' + blockedBy.priority + ')';

        const conditionHtml = formatOverrideConditions(v);

        return '<div class="override-item' + (!v.enabled ? ' disabled' : '') + (unreachable ? ' unreachable' : '') + '">' +
          '<input type="checkbox" ' + (v.enabled ? 'checked' : '') + ' onchange="toggleOverrideVersionEnabled(\'' + p.replace(/'/g, "\\'") + '\', \'' + v.id + '\', this.checked)" title="启用/禁用此规则">' +
          '<span class="path" title="' + escapeHtml(p) + '">' + p + (versions.length > 1 ? ' <span style="font-size:10px;color:#999;font-family:sans-serif">#' + (idx + 1) + '</span>' : '') + '</span>' +
          conditionHtml +
          (unreachableLabel ? ' <span style="color:#dc3545;font-size:10px;margin-left:5px">[' + unreachableLabel + ']</span>' : '') +
          '<div class="info-group">' +
            remarkHtml +
            '<span class="badge-info">优先级: ' + priority + '</span>' +
            (v.delay ? '<span class="badge-info badge-delay">延迟: ' + v.delay + 'ms</span>' : '') +
          '</div>' +
          '<div class="actions">' +
            '<button class="btn btn-sm btn-info" onclick="editOverrideVersion(\'' + p.replace(/'/g, "\\'") + '\', \'' + v.id + '\')">编辑</button>' +
            '<button class="btn btn-sm btn-danger" onclick="removeOverrideVersion(\'' + p.replace(/'/g, "\\'") + '\', \'' + v.id + '\')">删除</button>' +
          '</div></div>';
      }).join('');
    }

    // 存在不同规则条件的版本，使用折叠展示
    const expanded = expandedOverrides.has(p);
    const enabledCount = versions.filter(v => v.enabled).length;
    
    let headerHtml = '<div class="group-header" onclick="toggleOverrideGroup(\'' + p.replace(/'/g, "\\'") + '\')">' +
      '<span class="arrow ' + (expanded ? 'expanded' : '') + '">▶</span>' +
      '<span class="path" title="' + escapeHtml(p) + '">' + p + '</span>' +
      '<div class="info-group">' +
        (enabledCount > 0 ? '<span class="badge-info badge-override">已启用(' + enabledCount + ')</span>' : '<span class="badge-info">未启用</span>') +
        '<span class="badge-info">' + versions.length + ' 规则</span>' +
      '</div>' +
      '<div class="actions">' +
        '<button class="btn btn-sm btn-info" onclick="event.stopPropagation(); editOverride(\'' + p.replace(/'/g, "\\'") + '\')">管理</button>' +
        '<button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); removeOverride(\'' + p.replace(/'/g, "\\'") + '\')">清空</button>' +
      '</div></div>';

    let itemsHtml = '<div class="group-items ' + (expanded ? 'expanded' : '') + '">';
    itemsHtml += versions.map((v, idx) => {
      const priority = v.priority ?? 1;
      let jsonInvalid = false;
      if (isJsonPath(p)) {
        try { JSON.parse(v.content || ''); } catch { jsonInvalid = true; }
      }

      const blockingPriorities = [];
      Object.values(localFolders).forEach(lf => { if (lf.enabled) blockingPriorities.push({ type: '本地文件夹', priority: lf.priority ?? 0 }); });
      Object.values(globalServers).forEach(gs => { if (gs.enabled) blockingPriorities.push({ type: '全局服务器', priority: gs.priority ?? 100 }); });
      if (mappings[p] && mappings[p].enabled) {
        const mappingPriority = mappings[p].priority ?? 1;
        if (mappingPriority > priority) blockingPriorities.push({ type: 'URL映射', priority: mappingPriority });
      }
      Object.keys(folderMappings).forEach(pattern => {
        const fm = folderMappings[pattern];
        if (fm.enabled) {
          let matched = false;
          if (pattern.endsWith('*')) matched = p.startsWith(pattern.slice(0, -1));
          else matched = p === pattern || p.startsWith(pattern + '/');
          if (matched) {
            const fmPriority = fm.priority ?? 1;
            if (fmPriority > priority) blockingPriorities.push({ type: '文件夹映射', priority: fmPriority });
          }
        }
      });

      let blockedBy = null;
      if (v.enabled && !jsonInvalid) {
        for (const bp of blockingPriorities) {
          if (priority < bp.priority) {
            if (!blockedBy || bp.priority > blockedBy.priority) blockedBy = bp;
          }
        }
      }

      const unreachable = jsonInvalid || blockedBy;
      const remarkHtml = v.remark ? '<span class="remark-tag" data-remark="' + escapeHtml(v.remark) + '">' + escapeHtml(v.remark) + '</span>' : '';
      let unreachableLabel = '';
      if (jsonInvalid) unreachableLabel = 'JSON无效';
      else if (blockedBy) unreachableLabel = '<' + blockedBy.type + '(' + blockedBy.priority + ')';

      const conditionHtml = formatOverrideConditions(v);

      return '<div class="override-item' + (!v.enabled ? ' disabled' : '') + (unreachable ? ' unreachable' : '') + '" style="border-left: 3px solid #ffc107;">' +
        '<input type="checkbox" ' + (v.enabled ? 'checked' : '') + ' onchange="toggleOverrideVersionEnabled(\'' + p.replace(/'/g, "\\'") + '\', \'' + v.id + '\', this.checked)" title="启用/禁用此规则">' +
        '<span class="path" style="min-width: 30px; flex: 0 0 auto;"># ' + (idx + 1) + '</span>' +
        conditionHtml +
        (unreachableLabel ? ' <span style="color:#dc3545;font-size:10px;margin-left:5px">[' + unreachableLabel + ']</span>' : '') +
        '<div class="info-group">' +
          remarkHtml +
          '<span class="badge-info">优先级: ' + priority + '</span>' +
          (v.delay ? '<span class="badge-info badge-delay">延迟: ' + v.delay + 'ms</span>' : '') +
        '</div>' +
        '<div class="actions">' +
          '<button class="btn btn-sm btn-info" onclick="editOverrideVersion(\'' + p.replace(/'/g, "\\'") + '\', \'' + v.id + '\')">编辑</button>' +
          '<button class="btn btn-sm btn-danger" onclick="removeOverrideVersion(\'' + p.replace(/'/g, "\\'") + '\', \'' + v.id + '\')">删除</button>' +
        '</div></div>';
    }).join('');
    itemsHtml += '</div>';

    return headerHtml + itemsHtml;
  }).join('');
}

function toggleOverrideGroup(path) {
  if (expandedOverrides.has(path)) expandedOverrides.delete(path);
  else expandedOverrides.add(path);
  renderOverrides();
}

async function toggleOverrideVersionEnabled(path, versionId, enabled) {
  if (enabled) {
    const versions = overrides[path] || [];
    const target = versions.find(v => v.id === versionId);
    if (target) {
      // 开启新规则时，自动关闭同一个路径下、条件完全一样的其他已开启规则
      for (const v of versions) {
        if (v.id !== versionId && v.enabled && isConditionsEqual(v.conditions, target.conditions, v.conditionLogic, target.conditionLogic)) {
          await fetch('/admin/overrides', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ path, versionId: v.id, enabled: false }) 
          });
        }
      }
    }
  }

  await fetch('/admin/overrides', { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ path, versionId, enabled }) 
  });
  await loadOverrides();
  renderOverrides();
}

async function removeOverrideVersion(path, versionId) {
  const confirmed = await showConfirm('确定删除该请求版本？', '删除确认', '删除');
  if (!confirmed) return;
  await fetch('/admin/overrides', { 
    method: 'DELETE', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ path, versionId }) 
  });
  await loadOverrides();
  renderOverrides();
}

async function toggleOverridePathEnabled(path, enabled) {
  const versions = overrides[path] || [];
  if (!Array.isArray(versions) || versions.length === 0) return;

  if (enabled) {
    // 启用第一个版本（或之前启用的版本）
    const lastEnabled = versions.find(v => v.enabled);
    const versionId = lastEnabled ? lastEnabled.id : versions[0].id;
    await fetch('/admin/overrides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, versionId, enabled: true }) });
  } else {
    // 禁用所有版本
    for (const v of versions) {
      if (v.enabled) {
        await fetch('/admin/overrides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, versionId: v.id, enabled: false }) });
      }
    }
  }

  await loadOverrides();
}

async function updateOverridePriority(path, versionId, priority) {
  const p = parseInt(priority) || 1;
  await fetch('/admin/overrides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, versionId, priority: p }) });
  // 刷新所有列表，因为优先级变化会影响其他项的可达性
  await loadOverrides();
  renderOverrides();
  renderMappings();
  renderFolderMappings();
}

async function removeOverride(path) {
  const confirmed = await showConfirm('确定删除该接口的所有临时修改版本？', '删除确认', '删除');
  if (!confirmed) return;
  await fetch('/admin/overrides', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
  await loadOverrides();
}

async function removeOverrideVersion(path, versionId) {
  await fetch('/admin/overrides', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, versionId }) });
  await loadOverrides();
}

async function editOverride(path) {
  const versions = overrides[path] || [];
  if (!Array.isArray(versions)) {
    versions = [];
  }

  // 打开版本管理弹窗
  openOverrideVersionModal(path, versions);
}

// 打开版本管理窗口（可折叠版本列表）
function openOverrideVersionModal(path, versions) {
  const modal = document.getElementById('jsonModal');
  const title = document.getElementById('modalTitle');
  const pathDiv = document.getElementById('modalPath');
  const editor = document.getElementById('jsonEditor');
  const footer = modal ? modal.querySelector('.modal-footer') : null;

  title.textContent = '管理临时修改版本';
  pathDiv.textContent = path;

  // 隐藏编辑器和其他控件（容错：元素可能暂时不存在）
  if (editor) {
    editor.style.display = 'none';
  }
  const jsonErrorEl = document.getElementById('jsonError');
  if (jsonErrorEl) jsonErrorEl.textContent = '';
  const priorityDiv = document.getElementById('modalPriorityDiv');
  if (priorityDiv) priorityDiv.style.display = 'none';
  const remarkDiv = document.getElementById('modalRemarkDiv');
  if (remarkDiv) remarkDiv.style.display = 'none';
  const conditionsDiv = document.getElementById('modalConditionsDiv');
  if (conditionsDiv) conditionsDiv.style.display = 'none';
  const banner = document.getElementById('versionEditorBanner');
  if (banner) banner.style.display = 'none';
  const permanentBtn = document.getElementById('modalPermanentBtn');
  if (permanentBtn) permanentBtn.style.display = 'none';
  const deleteBtn = document.getElementById('modalDeleteBtn');
  if (deleteBtn) deleteBtn.style.display = 'none';
  const saveBtn = document.getElementById('modalSaveBtn');
  if (saveBtn) saveBtn.style.display = 'none';

  // 创建版本列表HTML
  let versionListHtml = '<div class="version-panel">';
  versionListHtml += '<div class="version-panel-header">';
  versionListHtml += '<div class="version-panel-title">临时修改版本列表</div>';
  versionListHtml += '<div class="version-panel-sub">共 ' + versions.length + ' 个版本，点击版本可展开/折叠</div>';
  versionListHtml += '</div>';
  versionListHtml += '<div style="margin-bottom:10px">';
  versionListHtml += '<button class="btn btn-success" onclick="createNewOverrideVersion(\'' + path.replace(/'/g, "\\'") + '\')">+ 新建版本</button>';
  versionListHtml += '</div>';

  versionListHtml += '<div id="versionAccordion" style="max-height:calc(100vh - 350px);min-height:260px;overflow-y:auto">';

  versions.forEach((v, idx) => {
    const isEnabled = v.enabled;
    const createdAt = new Date(v.createdAt).toLocaleString('zh-CN');
    const remarkText = v.remark ? escapeHtml(v.remark) : '';
    const versionKey = 'version_' + v.id;
    const defaultExpanded = false; // 不再默认展开已启用的版本，全部折叠

    // 版本头部（可点击折叠/展开）
    versionListHtml += '<div style="border:1px solid ' + (isEnabled ? '#28a745' : '#ddd') + ';border-radius:4px;margin-bottom:10px;background:' + (isEnabled ? '#f0fff4' : '#fff') + '">';
    versionListHtml += '<div style="padding:12px;cursor:pointer;display:flex;align-items:center;justify-content:space-between" onclick="toggleVersionAccordion(\'' + versionKey + '\')">';
    versionListHtml += '<div style="flex:1;min-width:0">';
    versionListHtml += '<span id="' + versionKey + '_arrow" style="display:inline-block;width:20px;transition:transform 0.2s;transform:rotate(' + (defaultExpanded ? '90deg' : '0deg') + ')">▶</span>';
    versionListHtml += '<strong>版本 ' + (idx + 1) + '</strong> ';
    if (isEnabled) {
      versionListHtml += '<span style="color:#28a745;font-size:12px">● 已启用</span>';
    } else {
      versionListHtml += '<span style="color:#999;font-size:12px">○ 未启用</span>';
    }
    versionListHtml += '<span style="margin-left:10px;font-size:11px;color:#666">' + createdAt + '</span>';
    if (remarkText) {
      versionListHtml += '<span class="version-remark-pill" style="margin-left:8px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + remarkText + '">备注: ' + remarkText + '</span>';
    }
    if (v.conditions && v.conditions.length > 0) {
      const logicText = v.conditionLogic === 'or' ? '或' : '且';
      versionListHtml += '<span style="margin-left:6px;background:#dbeafe;color:#1d4ed8;border-radius:10px;padding:1px 8px;font-size:10px;white-space:nowrap">' + v.conditions.length + '个条件(' + logicText + ')</span>';
    }
    if (v.delay) {
      versionListHtml += '<span style="margin-left:6px;background:#fef3c7;color:#d97706;border-radius:10px;padding:1px 8px;font-size:10px;white-space:nowrap">' + v.delay + 'ms延迟</span>';
    }
    versionListHtml += '</div>';
    versionListHtml += '<div style="display:flex;gap:5px" onclick="event.stopPropagation()">';
    versionListHtml += '<input type="checkbox" ' + (isEnabled ? 'checked' : '') + ' onchange="toggleOverrideVersionInModal(\'' + path.replace(/'/g, "\\'") + '\', \'' + v.id + '\', this.checked)" title="启用/禁用此规则">';
    versionListHtml += '<button class="btn btn-sm btn-info" onclick="editOverrideVersion(\'' + path.replace(/'/g, "\\'") + '\', \'' + v.id + '\')">编辑</button>';
    versionListHtml += '<button class="btn btn-sm btn-danger" onclick="deleteOverrideVersionInModal(\'' + path.replace(/'/g, "\\'") + '\', \'' + v.id + '\')">删除</button>';
    versionListHtml += '</div></div>';

    // 版本详情（默认展开已启用的版本）
    versionListHtml += '<div id="' + versionKey + '_content" style="display:' + (defaultExpanded ? 'block' : 'none') + ';padding:12px;border-top:1px solid #eee;background:#fafafa">';
    versionListHtml += '<div style="margin-bottom:8px"><strong>优先级:</strong> ' + (v.priority ?? 1) + '</div>';
    versionListHtml += '<div style="margin-bottom:8px"><strong>延迟:</strong> ' + (v.delay ?? 0) + 'ms</div>';
    versionListHtml += '<div style="margin-bottom:8px"><strong>备注:</strong> ' + remarkText + '</div>';
    versionListHtml += '<div style="margin-bottom:8px"><strong>内容预览:</strong></div>';

    // 内容预览（最多显示10行）
    let contentPreview = v.content || '{}';
    try {
      const parsed = JSON.parse(contentPreview);
      contentPreview = JSON.stringify(parsed, null, 2);
    } catch { }
    const lines = contentPreview.split('\n');
    const preview = lines.slice(0, 10).join('\n');
    const hasMore = lines.length > 10;

    versionListHtml += '<pre style="max-height:200px;overflow:auto;background:#fff;padding:8px;border:1px solid #ddd;border-radius:4px;font-size:11px">' + escapeHtml(preview);
    if (hasMore) {
      versionListHtml += '\n... (还有 ' + (lines.length - 10) + ' 行)';
    }
    versionListHtml += '</pre>';
    versionListHtml += '</div>';

    versionListHtml += '</div>';
  });

  versionListHtml += '</div>';

  // 插入版本列表（容错：editor 可能为空）
  // 先移除旧的版本列表容器
  const old = document.getElementById('versionListContainer');
  if (old) old.remove();

  // 使用 modal-body 作为父容器，而不是依赖 editor.parentElement
  const modalBody = modal.querySelector('.modal-body');
  if (modalBody) {
    modalBody.insertAdjacentHTML('afterbegin', '<div id="versionListContainer">' + versionListHtml + '</div>');
  }

  // 修改底部按钮
  if (footer) {
    footer.innerHTML = '<button class="btn btn-secondary" onclick="closeOverrideVersionModal()">关闭</button>';
  }

  modal.classList.add('active');
}

// 切换版本折叠/展开
function toggleVersionAccordion(versionKey) {
  const content = document.getElementById(versionKey + '_content');
  const arrow = document.getElementById(versionKey + '_arrow');
  if (content.style.display === 'none') {
    content.style.display = 'block';
    arrow.style.transform = 'rotate(90deg)';
  } else {
    content.style.display = 'none';
    arrow.style.transform = 'rotate(0deg)';
  }
}

// 选择版本（单选）
async function toggleOverrideVersionInModal(path, versionId, enabled) {
  await fetch('/admin/overrides', { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ path, versionId, enabled }) 
  });
  await loadOverrides();
  // 不关闭弹窗，重新渲染弹窗内容以反映状态
  const versions = overrides[path] || [];
  openOverrideVersionModal(path, versions);
  renderOverrides();
}

async function selectOverrideVersion(path, versionId) {
  // 保持兼容性，但改用 toggle 逻辑
  await toggleOverrideVersionInModal(path, versionId, true);
}

// 在弹窗中删除版本
async function deleteOverrideVersionInModal(path, versionId) {
  const confirmed = await showConfirm('确定删除该版本？', '删除确认', '删除');
  if (!confirmed) return;

  await fetch('/admin/overrides', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, versionId }) });
  await loadOverrides();

  // 如果还有版本，刷新版本列表（不关闭弹窗）
  const versions = overrides[path] || [];
  if (versions.length > 0) {
    // 移除旧的版本列表容器
    const container = document.getElementById('versionListContainer');
    if (container) container.remove();
    // 重新打开版本管理弹窗
    openOverrideVersionModal(path, versions);
  } else {
    // 如果没有版本了，关闭弹窗
    closeOverrideVersionModal();
  }
}

function resetOverrideVersionModalView() {
  const container = document.getElementById('versionListContainer');
  if (container) container.remove();

  const editor = document.getElementById('jsonEditor');
  if (editor) {
    editor.style.display = 'block';
  }
  const editorBanner = document.getElementById('versionEditorBanner');
  if (editorBanner) editorBanner.remove();
  const modal = document.getElementById('jsonModal');
  if (modal) {
    modal.classList.remove('version-layout');
  }
}

function closeOverrideVersionModal() {
  resetOverrideVersionModalView();
  closeModal();
}


async function enableOverrideVersion(path, versionId) {
  await fetch('/admin/overrides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, versionId, enabled: true }) });
  await loadOverrides();
  closeOverrideVersionModal();
}

async function deleteOverrideVersion(path, versionId) {
  const confirmed = await showConfirm('确定删除该版本？', '删除确认', '删除');
  if (!confirmed) return;

  await fetch('/admin/overrides', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, versionId }) });
  await loadOverrides();

  // 如果还有版本，重新打开版本管理窗口
  const versions = overrides[path] || [];
  if (versions.length > 0) {
    closeOverrideVersionModal();
    openOverrideVersionModal(path, versions);
  } else {
    closeOverrideVersionModal();
  }
}

function editOverrideVersion(path, versionId, forcedContent = undefined) {
  const versions = overrides[path] || [];
  const version = versions.find(v => v.id === versionId);
  if (!version) return;
  const versionIndex = versions.findIndex(v => v.id === versionId);

  let content = forcedContent !== undefined ? forcedContent : (version.content || '{}');
  const currentPriority = version.priority ?? 1;
  const currentRemark = version.remark || '';

  try { content = JSON.stringify(JSON.parse(content), null, 2); } catch { }

  const editor = document.getElementById('jsonEditor');
  if (editor) editor.style.display = 'block';
  const modal = document.getElementById('jsonModal');
  if (modal) modal.classList.add('version-layout');

  openModal('编辑临时修改版本', path, content, async (newContent) => {
    const priority = parseInt(document.getElementById('modalPriority').value) || 1;
    const remark = document.getElementById('modalRemark').value.trim();
    const conditions = getModalConditions();
    const conditionLogic = document.getElementById('modalConditionLogic')?.checked ? 'or' : 'and';
    const delay = parseInt(document.getElementById('modalDelay')?.value) || 0;
    await fetch('/admin/overrides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, versionId, content: newContent, priority, remark, conditions, conditionLogic, delay }) });
    await loadOverrides();
  }, false, true, currentPriority, currentRemark, false, '', true, version.conditions || [], version.conditionLogic || 'and', version.delay || 0);

  // 在编辑区域上方的色带中突出当前正在编辑的版本信息
  let banner = document.getElementById('versionEditorBanner');
  if (!banner && editor) {
    editor.insertAdjacentHTML('beforebegin', '<div id="versionEditorBanner" class="version-editor-banner"></div>');
    banner = document.getElementById('versionEditorBanner');
  }
  if (banner) {
    const safeRemark = version.remark ? escapeHtml(version.remark) : '';
    let html = '<span class="version-editor-title">编辑版本 ' + (versionIndex + 1) + '</span>';
    if (safeRemark) {
      html += '<span class="version-remark-pill" style="margin-left:6px" title="' + safeRemark + '">备注: ' + safeRemark + '</span>';
    }
    banner.innerHTML = html;
  }
}

function createNewOverrideVersion(path) {
  const versions = overrides[path] || [];
  let content = '{}';
  const enabledVersion = versions.find(v => v.enabled);
  if (enabledVersion && enabledVersion.content) {
    content = enabledVersion.content;
  }
  try { content = JSON.stringify(JSON.parse(content), null, 2); } catch { }

  const editor = document.getElementById('jsonEditor');
  if (editor) editor.style.display = 'block';
  const modal = document.getElementById('jsonModal');
  if (modal) modal.classList.add('version-layout');

  openModal('创建临时修改', path, content, async (newContent) => {
    const priority = parseInt(document.getElementById('modalPriority').value) || 1;
    const remark = document.getElementById('modalRemark').value.trim();
    const conditions = getModalConditions();
    const conditionLogic = document.getElementById('modalConditionLogic')?.checked ? 'or' : 'and';
    const delay = parseInt(document.getElementById('modalDelay')?.value) || 0;
    await fetch('/admin/overrides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, content: newContent, enabled: true, priority, remark, conditions, conditionLogic, delay }) });
    await loadOverrides();
    if (activeLogId !== null) showLogDetail(activeLogId);
  }, false, true, enabledVersion ? (enabledVersion.priority ?? 1) : 1, enabledVersion ? (enabledVersion.remark || '') : '', false, '', true, window._tempConditionsCache || [], 'and', 0);

  // 在编辑区域上方的色带中显示“正在新建版本”，以及可选的基准版本备注
  let banner = document.getElementById('versionEditorBanner');
  if (!banner && editor) {
    editor.insertAdjacentHTML('beforebegin', '<div id="versionEditorBanner" class="version-editor-banner"></div>');
    banner = document.getElementById('versionEditorBanner');
  }
  if (banner) {
    let html = '<span class="version-editor-title">新建版本</span>';
    if (enabledVersion && enabledVersion.remark) {
      const safeRemark = escapeHtml(enabledVersion.remark);
      html += '<span class="version-remark-pill" style="margin-left:6px" title="' + safeRemark + '">基于: ' + safeRemark + '</span>';
    }
    banner.innerHTML = html;
  }
}

async function setTempOverride(path, originalContent, showFileActions = false, forceContent = false, initialConditions = []) {
  const versions = overrides[path] || [];

  // 如果有已有版本，且没有初始条件（正常点击列表的修改），只展示列表面板
  if (versions.length > 0 && !(initialConditions && initialConditions.length > 0)) {
    openOverrideVersionModal(path, versions);
    return;
  }


  // 如果没有版本，或者带有条件，创建新版本
  const enabledVersion = versions.find(v => v.enabled);

  // 使用启用的版本内容，如果有forceContent则强制使用新内容
  let content = (enabledVersion && !forceContent) ? enabledVersion.content : originalContent;
  const currentPriority = enabledVersion ? (enabledVersion.priority ?? 1) : 1;
  const currentRemark = enabledVersion ? (enabledVersion.remark || '') : '';

  try { content = JSON.stringify(JSON.parse(content), null, 2); } catch { }

  // 如果有历史版本，先渲染带左侧列表的面板布局
  if (versions.length > 0) {
    openOverrideVersionModal(path, versions);
  }

  // 为后续的新建版本缓存日志带来的条件
  window._tempConditionsCache = initialConditions || [];

  const editor = document.getElementById('jsonEditor');
  if (editor) editor.style.display = 'block';

  const modal = document.getElementById('jsonModal');
  if (modal) {
    if (versions.length > 0) {
      modal.classList.add('version-layout');
    } else {
      modal.classList.remove('version-layout');
      // 没有历史版本时不显示左侧列表空间
      const oldContainer = document.getElementById('versionListContainer');
      if (oldContainer) oldContainer.remove();
    }
  }



  openModal('创建临时修改', path, content, async (newContent) => {
    const priority = parseInt(document.getElementById('modalPriority').value) || 1;
    const remark = document.getElementById('modalRemark').value.trim();
    const conditions = getModalConditions();
    const conditionLogic = document.getElementById('modalConditionLogic')?.checked ? 'or' : 'and';
    const delay = parseInt(document.getElementById('modalDelay')?.value) || 0;

    // 创建新版本（不指定 versionId）
    await fetch('/admin/overrides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, content: newContent, enabled: true, priority, remark, conditions, conditionLogic, delay }) });
    await loadOverrides();

    if (activeLogId !== null) showLogDetail(activeLogId);
  }, showFileActions, true, currentPriority, currentRemark, false, showFileActions ? '保存' : '临时保存', true, initialConditions, 'and', 0);

  let banner = document.getElementById('versionEditorBanner');
  if (!banner && editor) {
    editor.insertAdjacentHTML('beforebegin', '<div id="versionEditorBanner" class="version-editor-banner"></div>');
    banner = document.getElementById('versionEditorBanner');
  }
  if (banner) {
    let html = '<span class="version-editor-title">新建版本</span>';
    if (enabledVersion && enabledVersion.remark) {
      const safeRemark = escapeHtml(enabledVersion.remark);
      html += '<span class="version-remark-pill" style="margin-left:6px" title="' + safeRemark + '">基于: ' + safeRemark + '</span>';
    }
    banner.innerHTML = html;
  }
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
  await parseSelectedServerInput();
}

function renderFileList() {
  const list = document.getElementById('fileList');
  document.getElementById('fileCount').textContent = localFiles.length;
  if (localFiles.length === 0) {
    list.innerHTML = '<em>此目录下没有 JSON 文件</em>';
    return;
  }
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
  const fileHasOverride = hasOverride(filePath);
  const hasMapping = mappings[filePath];
  panel.innerHTML =
    '<div class="meta-row"><div class="meta-item">' + filePath + '</div>' +
    (fileHasOverride ? '<div class="meta-item"><span class="badge badge-override">已临时修改</span></div>' : '') +
    (hasMapping ? '<div class="meta-item"><span class="badge badge-mapping">已映射</span></div>' : '') + '</div>' +
    '<div class="detail-content" style="max-height:380px"><pre>' + escapeHtml(content) + '</pre></div>' +
    '<div style="margin-top:10px"><button class="btn btn-primary" onclick="editLocalFile(\'' + filePath.replace(/'/g, "\\'") + '\')">永久修改</button> ' +
    '<button class="btn btn-warning" onclick="setTempOverrideFromFile(\'' + filePath.replace(/'/g, "\\'") + '\')">临时修改</button>' +
    (fileHasOverride ? ' <button class="btn btn-danger" onclick="removeOverrideAndRefresh(\'' + filePath.replace(/'/g, "\\'") + '\')">取消临时</button>' : '') + '</div>';
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

/**
 * 格式化时长，1000ms 以上转为 s
 */
function formatDuration(ms) {
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

function isConditionsEqual(c1, c2, l1, l2) {
  const cond1 = Array.isArray(c1) ? c1 : [];
  const cond2 = Array.isArray(c2) ? c2 : [];
  if (cond1.length !== cond2.length) return false;
  if (cond1.length === 0) return true;
  if (cond1.length > 1 && (l1 || 'and') !== (l2 || 'and')) return false;
  const s1 = cond1.map(c => `${c.type}:${c.key}:${c.op}:${c.value}`).sort().join('|');
  const s2 = cond2.map(c => `${c.type}:${c.key}:${c.op}:${c.value}`).sort().join('|');
  return s1 === s2;
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

  // 添加复制按钮
  return '<div style="position:relative">' +
    '<button class="btn btn-sm btn-secondary" onclick="copyResponseContent(\'' + id + '\', event)" style="position:absolute;top:5px;right:5px;z-index:10" title="复制响应内容">复制</button>' +
    '<pre>' + escapeHtml(formatted) + '</pre>' +
    '</div>';
}

// 下载响应内容
function downloadResponseContent(logId) {
  const l = logs.find(log => log.id === logId);
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

// 复制响应内容
function copyResponseContent(logId, event) {
  const l = logs.find(log => log.id === logId);
  if (!l) return;

  let body = l.mappingResponse ? l.mappingResponse.body : window.currentLogResponse;

  // 如果是 JSON，格式化后复制
  try {
    body = JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    // 不是 JSON，直接复制原始内容
  }

  // 使用 Clipboard API 复制
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(body).then(() => {
      // 显示复制成功提示
      const btn = event ? event.target : null;
      if (btn) {
        const originalText = btn.textContent;
        btn.textContent = '✓ 已复制';
        btn.style.background = '#28a745';
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.background = '';
        }, 2000);
      }
    }).catch(err => {
      alert('复制失败: ' + err.message);
    });
  } else {
    // 降级方案：使用 textarea
    const textarea = document.createElement('textarea');
    textarea.value = body;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      const btn = event ? event.target : null;
      if (btn) {
        const originalText = btn.textContent;
        btn.textContent = '✓ 已复制';
        btn.style.background = '#28a745';
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.background = '';
        }, 2000);
      }
    } catch (err) {
      alert('复制失败: ' + err.message);
    }
    document.body.removeChild(textarea);
  }
}

// 解析 x-bbae-page header
// 格式: Activity>#0*Fragment1>#1Fragment2>#2*Fragment3...
// > 是分隔符，分割 activity 和多个 fragment
// #数字 在 fragment 名称开头表示层级
// * 表示当前 fragment 可见
function parsePageInfo(pageHeader) {
  if (!pageHeader) return null;
  try {
    const parts = pageHeader.split('>');
    const activity = parts[0] || '';
    const fragments = [];

    // 从第二个元素开始都是 fragments
    if (parts.length > 1) {
      for (let i = 1; i < parts.length; i++) {
        const frag = parts[i].trim();
        if (!frag) continue;

        // 先移除 * 标记
        const visible = frag.includes('*');
        let cleanFrag = frag.replace(/\*/g, '');

        // 提取层级数字（匹配开头的 #数字）
        const match = cleanFrag.match(/^#(\d+)\s*(.+)$/);
        if (match) {
          fragments.push({
            name: match[2].trim(),
            depth: parseInt(match[1]),
            visible
          });
        } else {
          // 没有层级信息，默认为 0
          fragments.push({
            name: cleanFrag.trim(),
            depth: 0,
            visible
          });
        }
      }
    }

    return { activity, fragments };
  } catch (e) {
    console.error('parsePageInfo error:', e);
    return null;
  }
}

function renderPageInfo(pageHeader) {
  const info = parsePageInfo(pageHeader);
  if (!info) return '<em>无页面信息</em>';



  let html = '<div style="margin-bottom:12px"><strong>Activity</strong></div>';
  html += '<div class="detail-content" style="padding:10px;margin-bottom:15px;background:#e3f2fd;border-left:3px solid #2196f3"><span style="color:#1976d2;font-weight:bold;font-size:14px">' + escapeHtml(info.activity) + '</span></div>';

  if (info.fragments.length > 0) {
    html += '<div style="margin-bottom:10px"><strong>Fragments (' + info.fragments.length + ')</strong></div>';
    html += '<div class="detail-content" style="padding:10px">';

    info.fragments.forEach((f, idx) => {
      // 根据层级深度设置左边距
      const marginLeft = f.depth * 24;

      // 可见状态样式
      const bgColor = f.visible ? '#e8f5e9' : '#f5f5f5';
      const borderColor = f.visible ? '#4caf50' : '#e0e0e0';
      const textColor = f.visible ? '#2e7d32' : '#757575';
      const icon = f.visible ? '👁️' : '　';

      html += '<div style="margin-bottom:6px;margin-left:' + marginLeft + 'px;padding:8px 12px;background:' + bgColor + ';border-left:3px solid ' + borderColor + ';border-radius:4px;display:flex;align-items:center;gap:8px">';
      html += '<span style="font-size:16px">' + icon + '</span>';
      html += '<span style="color:' + textColor + ';font-weight:' + (f.visible ? 'bold' : 'normal') + ';font-family:monospace;font-size:13px">' + escapeHtml(f.name) + '</span>';
      html += '<span style="font-size:10px;color:#999;margin-left:auto">(层级:' + f.depth + ')</span>'; // 临时显示层级用于调试
      html += '</div>';
    });

    html += '</div>';

    // 添加图例说明
    html += '<div style="margin-top:10px;padding:8px;background:#f9f9f9;border-radius:4px;font-size:11px;color:#666">';
    html += '<strong>说明：</strong> ';
    html += '<span style="margin-right:15px">👁️ = 可见</span>';
    html += '<span style="margin-right:15px">左边距 = 层级深度</span>';
    html += '<span>绿色背景 = 当前可见</span>';
    html += '</div>';
  }

  html += '<div style="margin-top:15px;margin-bottom:10px"><strong>原始数据</strong></div>';
  html += '<div class="detail-content" style="padding:10px;font-size:11px;word-break:break-all;color:#666;font-family:monospace">' + escapeHtml(pageHeader) + '</div>';

  return html;
}


// ========== 访问日志 ==========
async function refreshLogs(skipDetail = false) {
  const res = await fetch('/admin/logs');
  logs = await res.json();
  document.getElementById('logCount').textContent = logs.length;
  renderLogs();

  // 如果当前有选中的日志，且它还在列表中，则决定是否刷新详情板内容
  if (activeLogId !== null) {
    const exists = logs.some(l => l.id === activeLogId);
    if (exists) {
      // 如果 skipDetail 为 true (自动刷新时)，则仅维持列表选中态，不刷新详情板避免闪烁或重置视图
      if (!skipDetail) {
        updateLogDetailContent(activeLogId);
      }
    } else {
      activeLogId = null;
      document.getElementById('logDetailPanel').classList.remove('active');
    }
  }
}

// 辅助函数：仅更新详情板内容，不触发重渲染列表
function updateLogDetailContent(logId) {
  const l = logs.find(log => log.id === logId);
  if (!l) return;
  // 这里我们实际上可以共用 showLogDetail 的逻辑，但为了避免某些 UI 跳动，我们可以提取它
  showLogDetail(logId);
}

async function clearLogs() {
  const confirmed = await showConfirm('确定清空所有日志?', '清空日志', '清空');
  if (!confirmed) return;
  await fetch('/admin/logs', { method: 'DELETE' });
  activeLogId = null;
  document.getElementById('logDetailPanel').classList.remove('active');
  refreshLogs();
}
function renderLogs() {
  const search = document.getElementById('logSearch').value.toLowerCase();
  const statusFilter = document.getElementById('logStatusFilter').value;
  const groupSame = document.getElementById('logGroupSame').checked;
  const groupByParent = document.getElementById('logGroupByParent').checked;
  let filtered = logs.filter(l => {
    if (search && !l.path.toLowerCase().includes(search)) return false;
    if (statusFilter === 'found' && l.found !== true) return false;
    if (statusFilter === 'mapping' && l.found !== 'mapping') return false;
    if (statusFilter === 'missing' && (l.found === true || l.found === 'mapping')) return false;
    return true;
  });
  const container = document.getElementById('logList');
  const getStatusClass = (found) => found === true ? 'found' : found === 'mapping' ? 'mapping' : 'missing';
  const getStatusText = (found) => found === true ? '✓' : found === 'mapping' ? '⇄' : '404';

  // 格式化时间为时分秒毫秒
  const formatTime = (timeStr) => {
    // timeStr 格式: "03/10/2026 04:30:00 PM" 或类似
    const parts = timeStr.split(' ');
    if (parts.length >= 2) {
      return parts.slice(1).join(' '); // 只返回时间部分
    }
    return timeStr;
  };

  // 计算时间差
  const formatTimeAgo = (timeStr) => {
    // timeStr 格式: "14:30:00.123" (只有时分秒毫秒，没有日期)
    // 由于没有日期信息，我们假设是今天的时间
    const now = new Date();

    // 解析时间字符串
    const timeParts = timeStr.split(':');
    if (timeParts.length < 3) return '未知';

    const hours = parseInt(timeParts[0]);
    const minutes = parseInt(timeParts[1]);
    const secondsParts = timeParts[2].split('.');
    const seconds = parseInt(secondsParts[0]);
    const milliseconds = secondsParts[1] ? parseInt(secondsParts[1]) : 0;

    // 创建今天的时间对象
    const time = new Date();
    time.setHours(hours, minutes, seconds, milliseconds);

    // 如果时间在未来（说明是昨天的），减去一天
    if (time > now) {
      time.setDate(time.getDate() - 1);
    }

    const diff = Math.floor((now - time) / 1000);
    if (diff < 0) return '刚刚';
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

  // 获取响应状态码
  const getResponseCode = (l) => {
    if (l.mappingResponse && l.mappingResponse.status) {
      return l.mappingResponse.status;
    }
    return l.found === true ? 200 : l.found === 'mapping' ? null : 404;
  };

  // 获取 Outcome 状态和内容
  const getOutcomeInfo = (l) => {
    if (l.mappingResponse && l.mappingResponse.body) {
      try {
        const data = JSON.parse(l.mappingResponse.body);
        if (data.Outcome) {
          const isSuccess = data.Outcome.toLowerCase() === 'success';
          return {
            class: isSuccess ? 'outcome-success' : 'outcome-fail',
            text: isSuccess ? '' : data.Outcome
          };
        }
      } catch { }
    }
    return { class: '', text: '' };
  };

  const getDelayBadge = (l) => {
    if (!l || typeof l !== 'object') return '';
    // 优先使用请求时记录的实际延时
    const delay = l.appliedDelay;
    if (delay && delay > 0) {
      return '<span class="badge-tag badge-delay" style="margin-left:8px" title="实际延迟: ' + delay + 'ms">' + formatDuration(delay) + '</span>';
    }
    return '';
  };

  const getDurationHtml = (l) => {
    if (!l || !l.appliedDelay || l.appliedDelay <= 0) return '';
    const total = l.mappingResponse ? l.mappingResponse.time : l.appliedDelay;
    const delay = l.appliedDelay;
    return '<span class="badge-tag badge-delay" style="margin-left:8px" title="延迟: ' + delay + 'ms">' + 
           formatDuration(total) + '</span>';
  };

  // 渲染单个日志项
  const renderLogItem = (l, showPath = true, isChild = false) => {
    const method = l.method || 'GET';
    const respCode = getResponseCode(l);
    const outcomeInfo = getOutcomeInfo(l);
    const fileType = getFileTypeTag(l.path);
    const respCodeClass = respCode >= 200 && respCode < 300 ? 'status-2xx' : respCode >= 400 && respCode < 500 ? 'status-4xx' : respCode >= 500 ? 'status-5xx' : '';
    const folderTag = l.matchedFolder && l.found === true ? '<span class="folder-tag">' + escapeHtml(l.matchedFolder) + '</span>' : '';

    return '<div class="log-item' + (isChild ? ' child-item' : '') + (activeLogId === l.id ? ' active' : '') + ' ' + outcomeInfo.class + '" onclick="showLogDetail(\'' + l.id + '\')">' +
      '<span class="log-time">' + formatTime(l.time) + '</span>' +
      '<span class="method method-' + method + '">' + method + '</span>' +
      (respCode ? '<span class="status-code ' + respCodeClass + '">' + respCode + '</span>' : '') +
      '<span class="log-status ' + getStatusClass(l.found) + '">' + getStatusText(l.found) + '</span>' +
      folderTag +
      (outcomeInfo.text ? '<span class="outcome-text">' + escapeHtml(outcomeInfo.text) + '</span>' : '') +
      (showPath ? (fileType ? '<span class="file-type-tag">' + fileType + '</span>' : '') + '<span class="log-path" title="' + escapeHtml(l.path) + '">' + l.path + '</span>' : '<span class="log-ip">' + l.ip + '</span>') +
      getDurationHtml(l) +
      '</div>';
  };

  // 按页面分组的基础数据结构：找出所有 HTML 页面作为 Session，将相关子资源关联进去
  if (groupByParent) {
    const sessions = []; // 存放所有 HTML 页面的 Session
    const standaloneLogs = []; // 未归属任何页面的独立请求

    // Pass 1: 找出所有的 HTML 页面请求作为独立 Session
    filtered.forEach(l => {
      const isHtml = l.path.endsWith('.html') || l.path.endsWith('.htm') ||
        (l.mappingResponse && l.mappingResponse.headers &&
          (l.mappingResponse.headers['content-type'] || '').includes('text/html'));
      if (isHtml) {
        sessions.push({ parent: l, children: [] });
      }
    });

    // Pass 2: 为子资源匹配最近的 HTML Session
    filtered.forEach(l => {
      const isHtml = l.path.endsWith('.html') || l.path.endsWith('.htm') ||
        (l.mappingResponse && l.mappingResponse.headers &&
          (l.mappingResponse.headers['content-type'] || '').includes('text/html'));
      if (isHtml) return; // 页面本身已经被处理

      if (l.parentPath) {
        let found = false;
        // 寻找时间最早于资源请求前最近的一次 HTML 加载
        for (let s of sessions) {
          if (s.parent.path === l.parentPath && s.parent.time <= l.time) {
            s.children.push(l);
            found = true;
            break;
          }
        }
        // 如果异常找不到，且有同名路径（可能跨天或其他原因），归属给第一个找到的
        if (!found) {
          for (let s of sessions) {
            if (s.parent.path === l.parentPath) {
              s.children.push(l);
              found = true;
              break;
            }
          }
        }
        if (!found) {
          standaloneLogs.push(l);
        }
      } else {
        standaloneLogs.push(l);
      }
    });

    let html = '';

    // 双重分组：页面独立成组，其他非页面请求按相同接口成组
    if (groupSame) {
      const pageGroups = {}; // 页面路径 -> sessions[]
      sessions.forEach(s => {
        if (!pageGroups[s.parent.path]) pageGroups[s.parent.path] = [];
        pageGroups[s.parent.path].push(s);
      });

      const standaloneGroups = {}; // 独立请求路径 -> logs[]
      standaloneLogs.forEach(l => {
        if (!standaloneGroups[l.path]) standaloneGroups[l.path] = [];
        standaloneGroups[l.path].push(l);
      });

      // 渲染 HTML 页面折叠组
      for (const [pagePath, pageSessions] of Object.entries(pageGroups)) {
        const expandedPage = expandedLogGroups.has('page:' + pagePath);
        const sessionCount = pageSessions.length;
        const latestSession = pageSessions[0];
        const method = latestSession.parent.method || 'GET';
        const respCode = getResponseCode(latestSession.parent);
        const respCodeClass = respCode >= 200 && respCode < 300 ? 'status-2xx' : respCode >= 400 && respCode < 500 ? 'status-4xx' : respCode >= 500 ? 'status-5xx' : '';
        const fileType = getFileTypeTag(pagePath);

        html += '<div class="group-header" onclick="toggleLogGroup(\'page:' + pagePath.replace(/'/g, "\\'") + '\')">' +
          '<span class="arrow ' + (expandedPage ? 'expanded' : '') + '">▶</span>' +
          '<span class="method method-' + method + '">' + method + '</span>' +
          (respCode ? '<span class="status-code ' + respCodeClass + '">' + respCode + '</span>' : '') +
          '<span class="log-status ' + getStatusClass(latestSession.parent.found) + '">' + getStatusText(latestSession.parent.found) + '</span>' +
          (fileType ? '<span class="file-type-tag">' + fileType + '</span>' : '') +
          '<span class="path" title="' + escapeHtml(pagePath) + '">' + pagePath + '</span>' +
          getDurationHtml(latestSession.parent) +
          '<span class="badge badge-count">' + sessionCount + ' 次会话</span>' +
          '<span style="color:#666;font-size:11px">' + formatTimeAgo(latestSession.parent.time) + '</span></div>';

        html += '<div class="group-items ' + (expandedPage ? 'expanded' : '') + '">';

        pageSessions.forEach(session => {
          const p = session.parent;
          const children = session.children;
          const innerKey = 'session:' + p.id;
          const expandedInner = expandedLogGroups.has(innerKey);

          const innerMethod = p.method || 'GET';
          const innerRespCode = getResponseCode(p);
          const innerRespClass = innerRespCode >= 200 && innerRespCode < 300 ? 'status-2xx' : innerRespCode >= 400 && innerRespCode < 500 ? 'status-4xx' : innerRespCode >= 500 ? 'status-5xx' : '';
          const innerFileType = getFileTypeTag(p.path);

          html += '<div class="group-header" onclick="toggleLogGroup(\'' + innerKey.replace(/'/g, "\\'") + '\')">' +
            '<span class="arrow ' + (expandedInner ? 'expanded' : '') + '">▶</span>' +
            '<span class="method method-' + innerMethod + '">' + innerMethod + '</span>' +
            (innerRespCode ? '<span class="status-code ' + innerRespClass + '">' + innerRespCode + '</span>' : '') +
            '<span class="log-status ' + getStatusClass(p.found) + '">' + getStatusText(p.found) + '</span>' +
            (innerFileType ? '<span class="file-type-tag">' + innerFileType + '</span>' : '') +
            '<span class="path" title="' + escapeHtml(p.path) + '">' + p.path + '</span>' +
            getDurationHtml(p) +
            '<span class="badge badge-count">' + children.length + ' 个资源</span>' +
            '<span style="color:#666;font-size:11px">' + p.time + '</span></div>';

          html += '<div class="group-items ' + (expandedInner ? 'expanded' : '') + '">';
          html += renderLogItem(p, false);
          children.forEach(c => {
            html += renderLogItem(c, true, true);
          });
          html += '</div>';
        });
        html += '</div>';
      }

      // 渲染独立请求折叠组
      for (const [path, items] of Object.entries(standaloneGroups)) {
        const expanded = expandedLogGroups.has('standalone:' + path);
        const latest = items[0];
        const timeAgo = formatTimeAgo(latest.time);
        const fileType = getFileTypeTag(path);
        const method = latest.method || 'GET';
        const respCode = getResponseCode(latest);
        const respCodeClass = respCode >= 200 && respCode < 300 ? 'status-2xx' : respCode >= 400 && respCode < 500 ? 'status-4xx' : respCode >= 500 ? 'status-5xx' : '';

        html += '<div class="group-header" onclick="toggleLogGroup(\'standalone:' + path.replace(/'/g, "\\'") + '\')">' +
          '<span class="arrow ' + (expanded ? 'expanded' : '') + '">▶</span>' +
          '<span class="method method-' + method + '">' + method + '</span>' +
          (respCode ? '<span class="status-code ' + respCodeClass + '">' + respCode + '</span>' : '') +
          '<span class="log-status ' + getStatusClass(latest.found) + '">' + getStatusText(latest.found) + '</span>' +
          (fileType ? '<span class="file-type-tag">' + fileType + '</span>' : '') +
          '<span class="path" title="' + escapeHtml(path) + '">' + path + '</span>' +
          getDurationHtml(latest) +
          '<span class="badge badge-count">' + items.length + '次</span>' +
          '<span style="color:#666;font-size:11px">' + timeAgo + '</span></div>';
        html += '<div class="group-items ' + (expanded ? 'expanded' : '') + '">';
        items.forEach(l => {
          html += renderLogItem(l, false);
        });
        html += '</div>';
      }
      const scrollPos = container.scrollTop;
      container.innerHTML = html;
      container.scrollTop = scrollPos;
      return;
    } else {
      // 仅按页面分组，并且保持时间顺序显示（不按独立路径聚合）
      const allMixed = [];
      sessions.forEach(s => allMixed.push({ type: 'session', item: s }));
      standaloneLogs.forEach(l => allMixed.push({ type: 'log', item: l }));

      // 根据时间重新排序，确保渲染顺序正确（按最新时间排序）
      allMixed.sort((a, b) => {
        const timeA = a.type === 'session' ? a.item.parent.time : a.item.time;
        const timeB = b.type === 'session' ? b.item.parent.time : b.item.time;
        return timeA < timeB ? 1 : timeA > timeB ? -1 : 0;
      });

      allMixed.forEach(mixed => {
        if (mixed.type === 'session') {
          const session = mixed.item;
          const p = session.parent;
          const children = session.children;
          const innerKey = 'session:' + p.id;
          const expandedInner = expandedLogGroups.has(innerKey);

          const innerMethod = p.method || 'GET';
          const innerRespCode = getResponseCode(p);
          const innerRespClass = innerRespCode >= 200 && innerRespCode < 300 ? 'status-2xx' : innerRespCode >= 400 && innerRespCode < 500 ? 'status-4xx' : innerRespCode >= 500 ? 'status-5xx' : '';
          const innerFileType = getFileTypeTag(p.path);

          html += '<div class="group-header" onclick="toggleLogGroup(\'' + innerKey.replace(/'/g, "\\'") + '\')">' +
            '<span class="arrow ' + (expandedInner ? 'expanded' : '') + '">▶</span>' +
            '<span class="method method-' + innerMethod + '">' + innerMethod + '</span>' +
            (innerRespCode ? '<span class="status-code ' + innerRespClass + '">' + innerRespCode + '</span>' : '') +
            '<span class="log-status ' + getStatusClass(p.found) + '">' + getStatusText(p.found) + '</span>' +
            (innerFileType ? '<span class="file-type-tag">' + innerFileType + '</span>' : '') +
            '<span class="path" title="' + escapeHtml(p.path) + '">' + p.path + '</span>' +
            getDurationHtml(p) +
            '<span class="badge badge-count">' + children.length + ' 个资源</span>' +
            '<span style="color:#666;font-size:11px">' + p.time + '</span></div>';

          html += '<div class="group-items ' + (expandedInner ? 'expanded' : '') + '">';
          html += renderLogItem(p, false);
          children.forEach(c => {
            html += renderLogItem(c, true, true);
          });
          html += '</div>';
        } else {
          html += renderLogItem(mixed.item, true);
        }
      });
      const scrollPos = container.scrollTop;
      container.innerHTML = html;
      container.scrollTop = scrollPos;
      return;
    }
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
      const method = latest.method || 'GET';
      const respCode = getResponseCode(latest);
      const respCodeClass = respCode >= 200 && respCode < 300 ? 'status-2xx' : respCode >= 400 && respCode < 500 ? 'status-4xx' : respCode >= 500 ? 'status-5xx' : '';

      html += '<div class="group-header" onclick="toggleLogGroup(\'' + path.replace(/'/g, "\\'") + '\')">' +
        '<span class="arrow ' + (expanded ? 'expanded' : '') + '">▶</span>' +
        '<span class="method method-' + method + '">' + method + '</span>' +
        (respCode ? '<span class="status-code ' + respCodeClass + '">' + respCode + '</span>' : '') +
        '<span class="log-status ' + getStatusClass(latest.found) + '">' + getStatusText(latest.found) + '</span>' +
        (fileType ? '<span class="file-type-tag">' + fileType + '</span>' : '') +
        '<span class="path" title="' + escapeHtml(path) + '">' + path + '</span>' +
        getDurationHtml(latest) +
        '<span class="badge badge-count">' + items.length + '次</span>' +
        '<span style="color:#666;font-size:11px">' + timeAgo + '</span></div>';
      html += '<div class="group-items ' + (expanded ? 'expanded' : '') + '">';
      items.forEach(l => {
        html += renderLogItem(l, false);
      });
      html += '</div>';
    }
    const scrollPos = container.scrollTop;
    container.innerHTML = html;
    container.scrollTop = scrollPos;
  } else {
    const scrollPos = container.scrollTop;
    container.innerHTML = filtered.map(l => renderLogItem(l, true)).join('');
    container.scrollTop = scrollPos;
  }
}

function toggleLogGroup(path) {
  expandedLogGroups.has(path) ? expandedLogGroups.delete(path) : expandedLogGroups.add(path);
  renderLogs();
}

function switchLogDetailTab(tab) {
  logDetailTab = tab;
  if (activeLogId !== null) showLogDetail(activeLogId);
}

let logHeadersCollapsed = { req: false, res: true };
function toggleLogHeaders(type) {
  logHeadersCollapsed[type] = !logHeadersCollapsed[type];
  if (activeLogId !== null) showLogDetail(activeLogId);
}

function showLogDetail(logId) {
  activeLogId = logId;
  const l = logs.find(log => log.id === logId);
  if (!l) return;
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

  // 状态处理
  const isMapping = l.found === 'mapping';
  const mr = l.mappingResponse;
  const pageHeader = l.headers && (l.headers['x-bbae-page'] || l.headers['X-Bbae-Page']);
  const hasPage = !!pageHeader;

  // 针对映射日志，确保 Tab 选中态有效 (映射日志没有 'response' tab，只有 'access' 和 'proxy')
  if (isMapping) {
    if (logDetailTab === 'response' || logDetailTab === 'request') {
      logDetailTab = 'access';
    }
  } else {
    // 普通日志转映射日志时，如果选中了 'proxy'，重置回 'response'
    if (logDetailTab === 'access' || logDetailTab === 'proxy') {
      logDetailTab = 'response';
    }
  }

  const logHasOverride = hasOverride(l.path);
  const hasMapping = mappings[l.path] && mappings[l.path].enabled;
  const isMissing = l.found !== true && l.found !== 'mapping';
  const statusText = l.found === true ? '本地' : l.found === 'mapping' ? '映射' : '404';
  const statusClass = l.found === true ? 'found' : l.found === 'mapping' ? 'mapping' : 'missing';

  // 映射请求显示服务器返回的详细信息
  if (isMapping && l.mappingResponse) {
    const mr = l.mappingResponse;
    let proxyBody = mr.body || '';
    try { proxyBody = JSON.stringify(JSON.parse(proxyBody), null, 2); } catch { }
    const mrStatusClass = mr.status >= 200 && mr.status < 300 ? 'status-2xx' : mr.status >= 400 && mr.status < 500 ? 'status-4xx' : 'status-5xx';

    // 访问请求 Tab（客户端 -> 本地服务器）
    let reqBodyFormatted = l.body || '';
    try { reqBodyFormatted = JSON.stringify(JSON.parse(reqBodyFormatted), null, 2); } catch { }
    const hasReqBody = l.body && l.body.length > 0;

    // 根据 content-type 判断是否可展示
    const responseContentHtml = renderResponseContent(mr.body, mr.headers, logId, mr.isBase64);

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
      '<tr><td>耗时</td><td>' + mr.time + 'ms' + (mr.networkTime !== undefined ? ' (网络: ' + mr.networkTime + 'ms + 延时: ' + (mr.time - mr.networkTime) + 'ms)' : '') + '</td></tr>' +
      '<tr><td>响应大小</td><td>' + formatSize(mr.size) + '</td></tr>' +
      '</table></div>' +
      '<div class="section-title">Response Headers (' + (mr.headers ? Object.keys(mr.headers).length : 0) + ')</div>' +
      '<div class="detail-content">' + headerTable(mr.headers) + '</div>' +
      '<div class="section-title">Request Headers <span class="section-tag">实际发送</span> (' + Object.keys(proxyReqHeaders).length + ')</div>' +
      '<div class="detail-content">' + headerTable(proxyReqHeaders) + '</div>';

    const appliedDelay = l.appliedDelay;
    const delayTag = (appliedDelay && appliedDelay > 0) ? '<div class="meta-item"><span class="badge badge-info">延时: ' + appliedDelay + 'ms</span></div>' : '';

    panel.innerHTML =
      '<div class="meta-row"><div class="meta-item"><span class="method method-' + (l.method || 'GET') + '">' + (l.method || 'GET') + '</span></div><div class="meta-item">时间: ' + l.time + '</div><div class="meta-item">IP: ' + l.ip + '</div><div class="meta-item">状态: <span class="log-status mapping">映射</span></div><div class="meta-item">响应: <span class="status-code ' + mrStatusClass + '">' + mr.status + '</span></div><div class="meta-item">耗时: ' + mr.time + 'ms' + (mr.networkTime !== undefined ? '(' + mr.networkTime + '+' + (mr.time - mr.networkTime) + ')' : '') + '</div>' + delayTag + '</div>' +
      (l.parentPath ? '<div style="font-family:monospace;font-size:11px;margin-bottom:5px;word-break:break-all;color:#6c757d">来源页面: ' + l.parentPath + '</div>' : '') +
      '<div style="font-family:monospace;font-size:11px;margin-bottom:10px;word-break:break-all;color:#17a2b8">代理: ' + mr.url + '</div>' +
      '<div style="margin-bottom:10px"><button class="btn btn-success btn-sm" onclick="createMissingFile(\'' + l.path.replace(/'/g, "\\'") + '\', \'' + logId + '\')">永久保存</button> <button class="btn btn-warning btn-sm" onclick="editLogOverride(\'' + l.path.replace(/'/g, "\\'") + '\', false, \'' + logId + '\')">临时修改</button> <button class="btn btn-info btn-sm" onclick="openMappingModal(\'' + l.path.replace(/'/g, "\\'") + '\')">编辑映射</button> <button class="btn btn-info btn-sm" onclick="openPathDelayModal(\'' + l.path.replace(/'/g, "\\'") + '\')">设置延时</button>' + (hasMapping ? ' <button class="btn btn-danger btn-sm" onclick="removeMappingAndRefreshLog(\'' + l.path.replace(/'/g, "\\'") + '\')">取消映射</button>' : '') + '</div>' +
      '<div class="detail-tabs">' + tabBtn('access', '访问请求') + tabBtn('proxy', '映射请求') + (hasPage ? tabBtn('page', 'Page') : '') + '</div>' +
      '<div class="tab-content' + (logDetailTab === 'access' ? ' active' : '') + '">' + accessTabHtml + '</div>' +
      '<div class="tab-content' + (logDetailTab === 'proxy' ? ' active' : '') + '">' + proxyTabHtml + '</div>' +
      (hasPage ? '<div class="tab-content' + (logDetailTab === 'page' ? ' active' : '') + '">' + renderPageInfo(pageHeader) + '</div>' : '');
    panel.classList.add('active');
    renderLogs();
    return;
  }

  // 普通请求

  // 本地请求详情 - 和映射详情的访问请求格式一致
  let reqBodyFormatted = l.body || '';
  try { reqBodyFormatted = JSON.stringify(JSON.parse(reqBodyFormatted), null, 2); } catch { }
  const hasReqBody = l.body && l.body.length > 0;

  let localDetailHtml = '';

  if (l.mappingResponse && l.mappingResponse.body) {
    const mr = l.mappingResponse;
    const responseContentHtml = renderResponseContent(mr.body, mr.headers, logId, mr.isBase64);
    window.currentLogResponse = mr.body;
    window.currentLogResHeaders = mr.headers;

    localDetailHtml =
      '<div class="section-title">Response</div>' +
      '<div class="detail-content">' + responseContentHtml + '</div>' +
      (hasReqBody ? '<div class="section-title">Request Body</div><div class="detail-content"><pre>' + escapeHtml(reqBodyFormatted) + '</pre></div>' : '') +
      '<div class="section-title">Request</div>' +
      '<div class="detail-content"><table>' +
      '<tr><td>方法</td><td>' + (l.method || 'GET') + '</td></tr>' +
      '<tr><td>路径</td><td>' + l.path + '</td></tr>' +
      (l.actualPath ? '<tr><td>实际文件路径</td><td style="word-break:break-all">' + l.actualPath + '</td></tr>' : '') +
      '<tr><td>完整URL</td><td>' + (l.fullUrl || l.path) + '</td></tr>' +
      '<tr><td>访问时间</td><td>' + l.time + '</td></tr>' +
      '<tr><td>客户端IP</td><td>' + l.ip + '</td></tr>' +
      '</table></div>' +
      '<div class="section-title">Query 参数</div>' +
      '<div class="detail-content">' + queryTable(l.query) + '</div>' +
      '<div class="section-title">Response Headers</div>' +
      '<div class="detail-content" id="logResHeaders">' + headerTable(mr.headers) + '</div>' +
      '<div class="section-title">Request Headers (' + (l.headers ? Object.keys(l.headers).length : 0) + ')</div>' +
      '<div class="detail-content">' + headerTable(l.headers) + '</div>';
  } else {
    // 异步获取响应内容
    fetch(l.path).then(r => {
      const resHeaders = {};
      r.headers.forEach((v, k) => resHeaders[k] = v);
      return r.text().then(text => ({ text, resHeaders }));
    }).then(({ text, resHeaders }) => {
      if (activeLogId !== l.id) return; // 防止异步跳格
      let responseBody;
      try { responseBody = JSON.stringify(JSON.parse(text), null, 2); } catch { responseBody = text; }
      const respContent = document.getElementById('logResponseContent');
      if (respContent) {
        respContent.innerHTML = '<div style="position:relative">' +
          '<button class="btn btn-sm btn-secondary" onclick="copyResponseContent(\'' + logId + '\', event)" style="position:absolute;top:5px;right:5px;z-index:10" title="复制响应内容">复制</button>' +
          '<pre>' + escapeHtml(responseBody) + '</pre>' +
          '</div>';
      }
      const resHeadersEl = document.getElementById('logResHeaders');
      if (resHeadersEl) resHeadersEl.innerHTML = headerTable(resHeaders);
      window.currentLogResponse = text;
      window.currentLogResHeaders = resHeaders;
    }).catch(() => {
      const respContent = document.getElementById('logResponseContent');
      if (respContent) respContent.innerHTML = '<em>无法加载</em>';
      window.currentLogResponse = '{}';
    });

    localDetailHtml =
      '<div class="section-title">Response</div>' +
      '<div class="detail-content" id="logResponseContent"><em>加载中...</em></div>' +
      (hasReqBody ? '<div class="section-title">Request Body</div><div class="detail-content"><pre>' + escapeHtml(reqBodyFormatted) + '</pre></div>' : '') +
      '<div class="section-title">Request</div>' +
      '<div class="detail-content"><table>' +
      '<tr><td>方法</td><td>' + (l.method || 'GET') + '</td></tr>' +
      '<tr><td>路径</td><td>' + l.path + '</td></tr>' +
      (l.actualPath ? '<tr><td>实际文件路径</td><td style="word-break:break-all">' + l.actualPath + '</td></tr>' : '') +
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
  }

  const appliedDelay = l.appliedDelay;
  const delayTag = (appliedDelay && appliedDelay > 0) ? '<div class="meta-item"><span class="badge badge-info">延时: ' + appliedDelay + 'ms</span></div>' : '';

  panel.innerHTML =
    '<div class="meta-row"><div class="meta-item"><span class="method method-' + (l.method || 'GET') + '">' + (l.method || 'GET') + '</span></div><div class="meta-item">时间: ' + l.time + '</div><div class="meta-item">IP: ' + l.ip + '</div><div class="meta-item">状态: <span class="log-status ' + statusClass + '">' + statusText + '</span></div>' + (logHasOverride ? '<div class="meta-item"><span class="badge badge-override">已临时修改</span></div>' : '') + (hasMapping ? '<div class="meta-item"><span class="badge badge-mapping">已映射</span></div>' : '') + (l.mappingResponse ? '<div class="meta-item">耗时: ' + l.mappingResponse.time + 'ms' + (l.mappingResponse.networkTime !== undefined ? '(' + l.mappingResponse.networkTime + '+' + (l.mappingResponse.time - l.mappingResponse.networkTime) + ')' : '') + '</div>' : '') + delayTag + '</div>' +
    (l.parentPath ? '<div style="font-family:monospace;font-size:11px;margin-bottom:5px;word-break:break-all;color:#6c757d">来源页面: ' + l.parentPath + '</div>' : '') +
    '<div style="font-family:monospace;font-size:11px;margin-bottom:10px;word-break:break-all;color:#666">' + (l.fullUrl || l.path) + '</div>' +
    '<div style="margin-bottom:10px">' +
    (isMissing ? '<button class="btn btn-success btn-sm" onclick="createMissingFile(\'' + l.path.replace(/'/g, "\\'") + '\', \'' + logId + '\')">创建文件</button> ' : '') +
      '<button class="btn btn-warning btn-sm" onclick="editLogOverride(\'' + l.path.replace(/'/g, "\\'") + '\', ' + (!isMissing) + ', \'' + logId + '\')">修改返回</button> ' +
      '<button class="btn btn-info btn-sm" onclick="openMappingModal(\'' + l.path.replace(/'/g, "\\'") + '\')">设置映射</button> ' +
      '<button class="btn btn-info btn-sm" onclick="openPathDelayModal(\'' + l.path.replace(/'/g, "\\'") + '\')">设置延时</button>' +
      (logHasOverride ? ' <button class="btn btn-danger btn-sm" onclick="removeOverrideAndRefreshLog(\'' + l.path.replace(/'/g, "\\'") + '\')">取消临时</button>' : '') +
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
  showLogDetail(activeLogId);
}

function createMissingFile(apiPath, logId) {
  let initialContent = JSON.stringify({ Outcome: "Success", Message: "Success", Data: {} }, null, 2);

  if (logId !== undefined) {
    const l = logs.find(log => log.id === logId);
    if (l) {
      let body = l.mappingResponse ? l.mappingResponse.body : window.currentLogResponse;
      if (body !== undefined && body !== null && body !== '') {
        try { body = JSON.stringify(JSON.parse(body), null, 2); } catch { }
        initialContent = body;
      }
    }
  }

  // openModal signature: title, path, content, onSave, showFileActions, showPriority, currentPriority, currentRemark, showFolderSelect
  openModal('创建接口文件 (永久保存)', apiPath, initialContent, async (content) => {
    const folderSelect = document.getElementById('modalFolderSelect');
    let folder = '';
    if (folderSelect && document.getElementById('modalFolderDiv').style.display !== 'none') {
      const selectedValue = folderSelect.value;
      if (selectedValue && selectedValue !== '__new__') {
        folder = selectedValue; // Use relative path
      }
    }
    const res = await fetch('/admin/file/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: apiPath, content, folder })
    });
    const result = await res.json();
    if (result.success) { alert('创建成功'); refreshLogs(); }
    else alert('创建失败: ' + result.error);
  }, false, false, 1, '', true);
}

function editLocalFileFromLog(apiPath) {
  const content = window.currentLogResponse || '{}';
  let formatted = content;
  try { formatted = JSON.stringify(JSON.parse(content), null, 2); } catch { }
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

function editLogOverride(path, isLocalFile = false, logId) {
  let initialContent = window.currentLogResponse || '{}';
  let force = false;
  let initialConditions = [];
  if (logId !== undefined) {
    const l = logs.find(log => log.id === logId);
    if (l) {
      let body = l.mappingResponse ? l.mappingResponse.body : window.currentLogResponse;
      if (body !== undefined && body !== null && body !== '') {
        initialContent = body;
        force = true;
      }

      // 提取 query 参数
      if (l.query && Object.keys(l.query).length > 0) {
        Object.entries(l.query).forEach(([k, v]) => {
          initialConditions.push({ source: 'query', key: k, op: 'eq', value: v });
        });
      }

      // 提取 body 参数 (仅在内容看起来是 JSON 时解析)
      if (l.body && typeof l.body === 'string' && (l.body.startsWith('{') || l.body.startsWith('['))) {
        try {
          const parsed = JSON.parse(l.body);
          if (parsed && typeof parsed === 'object') {
            Object.entries(parsed).forEach(([k, v]) => {
              if (typeof v !== 'object') { // 仅简单类型做默认匹配
                initialConditions.push({ source: 'body', key: k, op: 'eq', value: String(v) });
              }
            });
          }
        } catch { }
      }
    }
  }
  setTimeout(() => { setTempOverride(path, initialContent, isLocalFile, force, initialConditions); }, 100);
}

async function removeOverrideAndRefreshLog(path) {
  await removeOverride(path);
  showLogDetail(activeLogId);
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
      saveHarEntriesToBrowser();
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
  const folder = document.getElementById('outputFolderInput').value || 'mock';
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
let logBatchDetailTab = 'response';
let logBatchActiveLog = null;

function openLogBatchSave() {
  // 填充文件夹下拉框
  const folderSelect = document.getElementById('logBatchFolder');
  const serverFolderInput = document.getElementById('serverFolderInput');
  const currentFolder = serverFolderInput ? serverFolderInput.value : 'mock';

  // 移除 public/ 前缀显示
  const currentFolderName = currentFolder.replace(/^public\//, '');

  folderSelect.innerHTML = publicFolders.map(f => {
    const folderName = f.path.replace(/^public\//, '');
    return '<option value="' + folderName + '"' + (f.path === currentFolder ? ' selected' : '') + '>' + folderName + '</option>';
  }).join('');

  // 添加"新建文件夹"选项
  folderSelect.innerHTML += '<option value="__new__">+ 新建文件夹...</option>';

  if (publicFolders.length === 0) {
    folderSelect.innerHTML = '<option value="mock">mock</option><option value="__new__">+ 新建文件夹...</option>';
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
  logBatchActiveLog = null;
  document.getElementById('logBatchDetail').style.display = 'none';
  renderLogBatchList();
  document.getElementById('logBatchSaveModal').classList.add('active');
}

function closeLogBatchSave() {
  document.getElementById('logBatchSaveModal').classList.remove('active');
  logBatchActiveLog = null;
}

function handleLogBatchFolderChange() {
  const select = document.getElementById('logBatchFolder');
  if (select && select.value === '__new__') {
    document.getElementById('newFolderName').value = '';
    document.getElementById('newFolderModal').classList.add('active');
    window.newFolderTarget = 'logBatchFolder';
  }
}

function closeNewFolderModal() {
  document.getElementById('newFolderModal').classList.remove('active');
  // 恢复下拉框选择
  const select = document.getElementById('logBatchFolder');
  if (select && select.value === '__new__') {
    select.selectedIndex = 0;
  }
  const modalSelect = document.getElementById('modalFolderSelect');
  if (modalSelect && modalSelect.value === '__new__') {
    modalSelect.selectedIndex = 0;
  }
}

async function createNewFolder() {
  const folderName = document.getElementById('newFolderName').value.trim();
  if (!folderName) {
    alert('请输入文件夹名称');
    return;
  }

  // 验证文件夹名称（只允许字母、数字、下划线、中划线）
  if (!/^[a-zA-Z0-9_-]+$/.test(folderName)) {
    alert('文件夹名称只能包含字母、数字、下划线和中划线');
    return;
  }

  const folder = folderName; // Use relative path

  // 检查是否已存在
  if (publicFolders.some(f => f.path === folder)) {
    alert('文件夹已存在');
    return;
  }

  try {
    const res = await fetch('/admin/folder/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: folder }) // Send relative path
    });
    const result = await res.json();
    if (result.success) {
      // 刷新文件夹列表
      await loadPublicFolders();

      // 更新下拉框
      const selects = [document.getElementById('logBatchFolder'), document.getElementById('modalFolderSelect')];
      selects.forEach(select => {
        if (!select) return;
        select.innerHTML = publicFolders.map(f => {
          const name = f.name;
          return '<option value="' + name + '"' + (f.path === folder ? ' selected' : '') + '>' + name + '</option>';
        }).join('');
        select.innerHTML += '<option value="__new__">+ 新建文件夹...</option>';

        if (select.id === window.newFolderTarget || select.id === 'logBatchFolder') {
          select.value = folderName;
        }
      });
      window.newFolderTarget = null;

      closeNewFolderModal();
    } else {
      alert('创建失败: ' + result.error);
    }
  } catch (e) {
    alert('创建失败: ' + e.message);
  }
}

function renderLogBatchList() {
  const container = document.getElementById('logBatchList');
  const getStatusClass = (found) => found === true ? 'found' : found === 'mapping' ? 'mapping' : 'missing';
  const getStatusText = (found) => found === true ? '本地' : found === 'mapping' ? '映射' : '404';

  let html = '';
  for (const [path, items] of Object.entries(logBatchGroups)) {
    const expanded = logBatchExpandedGroups.has(path);
    const selectedCount = items.filter(l => logBatchSelectedIds.has(l.idx)).length;
    const allSelected = selectedCount === items.length;
    const someSelected = selectedCount > 0 && selectedCount < items.length;
    const noneSelected = selectedCount === 0;
    const latest = items[0];

    // 复选框状态：全选=checked, 半选=indeterminate, 未选=unchecked
    const checkboxId = 'group-checkbox-' + path.replace(/[^a-zA-Z0-9]/g, '_');

    html += '<div class="group"><div class="group-header" onclick="toggleLogBatchGroup(\'' + path.replace(/'/g, "\\'") + '\')">' +
      '<input type="checkbox" id="' + checkboxId + '" ' + (allSelected ? 'checked' : '') + ' onclick="event.stopPropagation();toggleLogBatchGroupSelect(\'' + path.replace(/'/g, "\\'") + '\', this.checked)">' +
      '<span class="arrow ' + (expanded ? 'expanded' : '') + '">▶</span>' +
      '<span class="log-status ' + getStatusClass(latest.found) + '">' + getStatusText(latest.found) + '</span>' +
      '<span class="path">' + path + '</span>' +
      '<span class="badge badge-count">' + items.length + '</span></div>';

    html += '<div class="group-items ' + (expanded ? 'expanded' : '') + '">';
    items.forEach((l, idx) => {
      const isActive = logBatchActiveLog && logBatchActiveLog.idx === l.idx;
      html += '<div class="item-row ' + (logBatchSelectedIds.has(l.idx) ? 'active' : '') + (isActive ? ' selected' : '') + '" onclick="showLogBatchDetail(' + l.idx + ')">' +
        '<input type="checkbox" ' + (logBatchSelectedIds.has(l.idx) ? 'checked' : '') + ' onclick="event.stopPropagation();toggleLogBatchSelect(' + l.idx + ')">' +
        '<span class="log-status ' + getStatusClass(l.found) + '">' + getStatusText(l.found) + '</span>' +
        '<span style="color:#666">#' + (idx + 1) + ' · ' + l.time + '</span></div>';
    });
    html += '</div></div>';
  }

  container.innerHTML = html;
  document.getElementById('logBatchSelectedCount').textContent = logBatchSelectedIds.size;

  // 设置半选状态
  for (const [path, items] of Object.entries(logBatchGroups)) {
    const selectedCount = items.filter(l => logBatchSelectedIds.has(l.idx)).length;
    const someSelected = selectedCount > 0 && selectedCount < items.length;
    const checkboxId = 'group-checkbox-' + path.replace(/[^a-zA-Z0-9]/g, '_');
    const checkbox = document.getElementById(checkboxId);
    if (checkbox && someSelected) {
      checkbox.indeterminate = true;
    }
  }
}

function showLogBatchDetail(idx) {
  const log = logs[idx];
  if (!log) return;

  logBatchActiveLog = log;
  logBatchActiveLog.idx = idx;

  document.getElementById('logBatchDetail').style.display = 'block';
  renderLogBatchDetail();
  renderLogBatchList(); // 重新渲染以更新选中状态
}

function renderLogBatchDetail() {
  if (!logBatchActiveLog) return;

  const log = logBatchActiveLog;
  const content = document.getElementById('logBatchDetailContent');

  const headerTable = (headers) => {
    if (!headers || Object.keys(headers).length === 0) return '<em>无</em>';
    return '<table style="width:100%;font-size:12px"><tbody>' +
      Object.entries(headers).map(([k, v]) =>
        '<tr><td style="padding:4px;border-bottom:1px solid #eee;font-weight:bold;width:200px">' + escapeHtml(k) + '</td><td style="padding:4px;border-bottom:1px solid #eee;word-break:break-all">' + escapeHtml(String(v)) + '</td></tr>'
      ).join('') + '</tbody></table>';
  };

  if (logBatchDetailTab === 'response') {
    // Response Body
    let body = '';
    if (log.found === 'mapping' && log.mappingResponse) {
      body = log.mappingResponse.body || '';
      if (log.mappingResponse.isBase64) {
        body = '[Base64 数据，大小: ' + formatSize(body.length) + ']';
      } else {
        try {
          body = JSON.stringify(JSON.parse(body), null, 2);
        } catch { }
      }
    } else {
      body = '本地文件或404';
    }

    // Response Headers
    const headers = (log.found === 'mapping' && log.mappingResponse) ? log.mappingResponse.headers : {};

    content.innerHTML =
      '<div style="margin-bottom:15px"><strong style="font-size:14px">Response Body</strong></div>' +
      '<pre style="margin:0 0 20px 0;padding:10px;background:#f5f5f5;border-radius:4px;max-height:300px;overflow:auto;font-size:12px">' + escapeHtml(body) + '</pre>' +
      '<div style="margin-bottom:10px"><strong style="font-size:14px">Response Headers (' + Object.keys(headers).length + ')</strong></div>' +
      '<div style="padding:10px;background:#f5f5f5;border-radius:4px;max-height:200px;overflow:auto">' + headerTable(headers) + '</div>';

  } else if (logBatchDetailTab === 'request') {
    const method = log.method || 'GET';
    const query = log.query || {};
    const body = log.body || '';
    const headers = log.headers || {};

    let bodyDisplay = body;
    if (body) {
      try {
        bodyDisplay = JSON.stringify(JSON.parse(body), null, 2);
      } catch { }
    }

    content.innerHTML =
      '<div style="margin-bottom:15px"><strong style="font-size:14px">Request Info</strong></div>' +
      '<div style="padding:10px;background:#f5f5f5;border-radius:4px;margin-bottom:20px">' +
      '<div style="margin-bottom:8px"><strong>Method:</strong> <span style="padding:2px 8px;background:#007bff;color:#fff;border-radius:3px;font-size:11px">' + method + '</span></div>' +
      '<div style="margin-bottom:8px"><strong>Path:</strong> <code style="background:#fff;padding:2px 6px;border-radius:3px">' + escapeHtml(log.path) + '</code></div>' +
      '<div style="margin-bottom:8px"><strong>Query:</strong><pre style="margin:5px 0 0 0;padding:8px;background:#fff;border:1px solid #ddd;border-radius:3px;font-size:11px">' + escapeHtml(JSON.stringify(query, null, 2)) + '</pre></div>' +
      (body ? '<div><strong>Body:</strong><pre style="margin:5px 0 0 0;padding:8px;background:#fff;border:1px solid #ddd;border-radius:3px;font-size:11px;max-height:150px;overflow:auto">' + escapeHtml(bodyDisplay) + '</pre></div>' : '') +
      '</div>' +
      '<div style="margin-bottom:10px"><strong style="font-size:14px">Request Headers (' + Object.keys(headers).length + ')</strong></div>' +
      '<div style="padding:10px;background:#f5f5f5;border-radius:4px;max-height:200px;overflow:auto">' + headerTable(headers) + '</div>';
  }
}

function switchLogBatchDetailTab(tab) {
  logBatchDetailTab = tab;
  document.querySelectorAll('#logBatchDetail .detail-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  renderLogBatchDetail();
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
  const folderInput = document.getElementById('logBatchFolder').value.trim();
  if (!folderInput || folderInput === '__new__') {
    alert('请选择文件夹');
    return;
  }

  if (logBatchSelectedIds.size === 0) {
    alert('请先选择要保存的日志');
    return;
  }

  const folder = folderInput;

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
    const pretty = document.getElementById('logBatchPretty').checked;
    if (pretty) {
      try {
        content = JSON.stringify(JSON.parse(content), null, 2);
      } catch { }
    }

    const filePath = folder + l.path + '.json';
    data[filePath] = content;
  });

  const res = await fetch('/admin/har/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await res.json();
  if (result.success) {
    alert('保存成功: ' + result.count + ' 个文件');
    closeLogBatchSave();
    // 刷新文件夹列表
    loadPublicFolders();
  } else {
    alert('保存失败: ' + result.error);
  }
}
