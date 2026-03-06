const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
let baseFolder = process.argv[2] || 'cash';
let accessLogs = [];
let tempOverrides = {}; // 临时修改的返回值 { path: content }
const MAX_LOGS = 1000;

const adminHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>服务器管理</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; font-size: 13px; }
    .container { max-width: 1600px; margin: 0 auto; }
    h1 { color: #333; font-size: 20px; }
    .tabs { display: flex; gap: 10px; margin-bottom: 20px; }
    .tab { padding: 10px 20px; background: #fff; border: none; cursor: pointer; border-radius: 4px 4px 0 0; }
    .tab.active { background: #007bff; color: #fff; }
    .panel { background: #fff; padding: 20px; border-radius: 0 8px 8px 8px; display: none; }
    .panel.active { display: block; }
    input[type="text"], textarea { padding: 6px 10px; border: 1px solid #ddd; border-radius: 4px; font-family: inherit; }
    .btn { padding: 6px 14px; border: none; cursor: pointer; border-radius: 4px; }
    .btn-sm { padding: 4px 10px; font-size: 12px; }
    .btn-primary { background: #007bff; color: #fff; }
    .btn-success { background: #28a745; color: #fff; }
    .btn-secondary { background: #6c757d; color: #fff; }
    .btn-danger { background: #dc3545; color: #fff; }
    .btn-warning { background: #ffc107; color: #000; }
    .btn:hover { opacity: 0.9; }
    .status { margin: 15px 0; padding: 12px; background: #f0f0f0; border-radius: 4px; }
    .upload-area { border: 2px dashed #ccc; padding: 30px; text-align: center; border-radius: 8px; cursor: pointer; margin-bottom: 15px; }
    .upload-area:hover, .upload-area.dragover { border-color: #007bff; background: #f0f7ff; }
    .filters { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
    .stats span { margin-right: 12px; }
    .main-layout { display: flex; gap: 15px; }
    .list-panel { flex: 1; min-width: 0; }
    .detail-panel { width: 600px; background: #f8f9fa; border-radius: 8px; padding: 12px; display: none; max-height: 600px; overflow-y: auto; }
    .detail-panel.active { display: block; }
    .group-header { background: #e9ecef; padding: 8px 12px; cursor: pointer; border-radius: 4px; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
    .group-header:hover { background: #dee2e6; }
    .group-header .path { font-family: monospace; font-size: 12px; word-break: break-all; flex: 1; }
    .group-header .badge { padding: 2px 8px; border-radius: 10px; font-size: 11px; }
    .badge-count { background: #007bff; color: #fff; }
    .badge-merged { background: #28a745; color: #fff; }
    .badge-missing { background: #dc3545; color: #fff; }
    .badge-override { background: #ffc107; color: #000; }
    .group-items { margin-left: 15px; margin-bottom: 8px; display: none; }
    .group-items.expanded { display: block; }
    .item-row { display: flex; align-items: center; padding: 6px 8px; border-bottom: 1px solid #eee; cursor: pointer; gap: 8px; }
    .item-row:hover, .item-row.active { background: #e3f2fd; }
    .method { padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: bold; }
    .method-GET { background: #d4edda; color: #155724; }
    .method-POST { background: #cce5ff; color: #004085; }
    .method-PUT { background: #fff3cd; color: #856404; }
    .method-DELETE { background: #f8d7da; color: #721c24; }
    .status-code { padding: 2px 6px; border-radius: 3px; font-size: 10px; }
    .status-2xx { background: #d4edda; color: #155724; }
    .status-4xx { background: #fff3cd; color: #856404; }
    .status-5xx { background: #f8d7da; color: #721c24; }
    .list-container { max-height: 480px; overflow-y: auto; border: 1px solid #eee; border-radius: 4px; }
    .output-config { display: flex; gap: 10px; align-items: center; margin: 12px 0; flex-wrap: wrap; }
    .detail-tabs { display: flex; gap: 5px; margin-bottom: 10px; border-bottom: 1px solid #ddd; }
    .detail-tab { padding: 8px 15px; cursor: pointer; border: none; background: none; border-bottom: 2px solid transparent; }
    .detail-tab.active { border-bottom-color: #007bff; color: #007bff; font-weight: bold; }
    .detail-tab:hover { background: #f0f0f0; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .detail-content { background: #fff; border: 1px solid #ddd; border-radius: 4px; padding: 8px; font-family: monospace; font-size: 11px; max-height: 400px; overflow: auto; }
    .detail-content pre { margin: 0; white-space: pre-wrap; word-break: break-all; }
    .detail-content table { width: 100%; border-collapse: collapse; }
    .detail-content td { padding: 3px 6px; border-bottom: 1px solid #eee; vertical-align: top; }
    .detail-content td:first-child { color: #666; width: 150px; }
    .hidden { display: none; }
    .select-actions { display: flex; gap: 6px; margin-bottom: 12px; }
    .arrow { transition: transform 0.2s; font-size: 10px; }
    .arrow.expanded { transform: rotate(90deg); }
    .meta-row { display: flex; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
    .meta-item { background: #e9ecef; padding: 4px 10px; border-radius: 4px; font-size: 12px; }
    .log-item { padding: 8px 12px; border-bottom: 1px solid #eee; display: flex; gap: 15px; align-items: center; cursor: pointer; }
    .log-item:hover { background: #f8f9fa; }
    .log-item.active { background: #e3f2fd; }
    .log-time { color: #666; font-size: 11px; width: 140px; }
    .log-ip { color: #666; font-size: 11px; width: 120px; }
    .log-path { font-family: monospace; font-size: 12px; flex: 1; word-break: break-all; }
    .log-status { font-size: 11px; }
    .log-status.found { color: #28a745; }
    .log-status.missing { color: #dc3545; }
    .override-list { margin-top: 15px; }
    .override-item { display: flex; align-items: center; gap: 10px; padding: 8px; background: #fff3cd; border-radius: 4px; margin-bottom: 5px; }
    .override-item .path { flex: 1; font-family: monospace; font-size: 12px; }
    .file-item { padding: 6px 10px; border-bottom: 1px solid #eee; cursor: pointer; font-family: monospace; font-size: 12px; }
    .file-item:hover { background: #f8f9fa; }
    .file-item.active { background: #e3f2fd; }
    /* Modal */
    .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; }
    .modal.active { display: flex; align-items: center; justify-content: center; }
    .modal-content { background: #fff; border-radius: 8px; width: 800px; max-width: 90%; max-height: 90%; display: flex; flex-direction: column; }
    .modal-header { padding: 15px 20px; border-bottom: 1px solid #ddd; display: flex; justify-content: space-between; align-items: center; }
    .modal-header h3 { margin: 0; font-size: 16px; }
    .modal-body { padding: 20px; flex: 1; overflow: auto; }
    .modal-footer { padding: 15px 20px; border-top: 1px solid #ddd; display: flex; gap: 10px; justify-content: flex-end; }
    .json-editor { width: 100%; height: 400px; font-family: monospace; font-size: 12px; border: 1px solid #ddd; border-radius: 4px; padding: 10px; resize: vertical; }
    .json-error { color: #dc3545; font-size: 12px; margin-top: 5px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>服务器管理</h1>
    <div class="tabs">
      <button class="tab active" onclick="showTab('settings')">设置</button>
      <button class="tab" onclick="showTab('files')">本地文件</button>
      <button class="tab" onclick="showTab('har')">HAR 解析</button>
      <button class="tab" onclick="showTab('logs')">访问日志</button>
    </div>

    <div id="settings" class="panel active">
      <div class="status">当前服务文件夹: <strong id="current"></strong></div>
      <div style="margin:15px 0">
        <label>切换服务文件夹: <input type="text" id="folder" placeholder="文件夹名称" style="width:250px"></label>
        <button class="btn btn-primary" onclick="changeFolder()">确认</button>
      </div>
      <div class="override-list">
        <h3>临时修改列表 <span id="overrideCount">(0)</span></h3>
        <div id="overrideList"></div>
      </div>
    </div>

    <div id="files" class="panel">
      <div class="filters">
        <label>解析文件夹: <input type="text" id="parseFolder" placeholder="文件夹路径" style="width:200px"></label>
        <button class="btn btn-primary" onclick="parseLocalFolder()">解析</button>
        <input type="text" id="fileSearch" placeholder="搜索路径..." style="width:150px" oninput="filterFiles()">
      </div>
      <div class="stats"><span>文件数: <strong id="fileCount">0</strong></span><span id="parseFolderInfo"></span></div>
      <div class="main-layout">
        <div class="list-panel">
          <div class="list-container" id="fileList" style="max-height:500px"></div>
        </div>
        <div class="detail-panel" id="fileDetailPanel"></div>
      </div>
    </div>

    <div id="har" class="panel">
      <div class="upload-area" id="uploadArea">
        <p>拖拽 HAR 文件到此处，或点击选择</p>
        <input type="file" id="fileInput" accept=".har" style="display:none">
      </div>
      <div id="harContent" class="hidden">
        <div class="filters">
          <input type="text" id="searchInput" placeholder="搜索路径..." style="width:180px">
          <select id="methodFilter"><option value="">所有方法</option><option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option></select>
          <select id="statusFilter"><option value="">所有状态</option><option value="2xx">2xx</option><option value="4xx">4xx</option><option value="5xx">5xx</option></select>
          <label><input type="checkbox" id="mergeData" checked> 合并相同Data</label>
        </div>
        <div class="stats">
          <span>总数: <strong id="totalCount">0</strong></span>
          <span>分组: <strong id="groupCount">0</strong></span>
          <span>已选: <strong id="selectedCount">0</strong></span>
        </div>
        <div class="select-actions">
          <button class="btn btn-sm btn-primary" onclick="selectAll()">全选</button>
          <button class="btn btn-sm btn-secondary" onclick="selectNone()">取消</button>
          <button class="btn btn-sm btn-secondary" onclick="expandAll()">展开</button>
          <button class="btn btn-sm btn-secondary" onclick="collapseAll()">收起</button>
        </div>
        <div class="main-layout">
          <div class="list-panel">
            <div class="list-container" id="groupList"></div>
            <div class="output-config">
              <label>输出: <input type="text" id="outputFolder" value="mock" style="width:80px"></label>
              <label><input type="checkbox" id="keepLast" checked> 保留最后</label>
              <label><input type="checkbox" id="prettyJson" checked> 格式化</label>
              <button class="btn btn-success" onclick="saveToServer()">保存到服务器</button>
            </div>
          </div>
          <div class="detail-panel" id="detailPanel"></div>
        </div>
      </div>
    </div>

    <div id="logs" class="panel">
      <div class="filters">
        <input type="text" id="logSearch" placeholder="搜索路径..." style="width:180px" oninput="renderLogs()">
        <select id="logStatusFilter" onchange="renderLogs()">
          <option value="">全部</option>
          <option value="found">已存在</option>
          <option value="missing">不存在</option>
        </select>
        <label><input type="checkbox" id="logGroupMissing" onchange="renderLogs()"> 不存在接口分组</label>
        <label><input type="checkbox" id="logAutoRefresh" checked onchange="toggleAutoRefresh()"> 自动刷新</label>
        <label>间隔: <select id="logRefreshInterval" onchange="updateRefreshInterval()">
          <option value="500">0.5s</option>
          <option value="1000" selected>1s</option>
          <option value="2000">2s</option>
          <option value="5000">5s</option>
        </select></label>
        <button class="btn btn-sm btn-secondary" onclick="refreshLogs()">刷新</button>
        <button class="btn btn-sm btn-danger" onclick="clearLogs()">清空</button>
      </div>
      <div class="stats"><span>日志数: <strong id="logCount">0</strong></span></div>
      <div class="main-layout">
        <div class="list-panel">
          <div class="list-container" id="logList" style="max-height:500px"></div>
        </div>
        <div class="detail-panel" id="logDetailPanel"></div>
      </div>
    </div>
  </div>

  <!-- JSON Editor Modal -->
  <div class="modal" id="jsonModal">
    <div class="modal-content">
      <div class="modal-header">
        <h3 id="modalTitle">编辑 JSON</h3>
        <button class="btn btn-sm btn-secondary" onclick="closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div style="margin-bottom:10px;font-family:monospace;font-size:12px;color:#666" id="modalPath"></div>
        <textarea class="json-editor" id="jsonEditor"></textarea>
        <div class="json-error" id="jsonError"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="formatJson()">格式化</button>
        <button class="btn btn-secondary" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" id="modalSaveBtn">保存</button>
      </div>
    </div>
  </div>

  <script>
    let entries = [], groups = {}, selectedIds = new Set(), expandedGroups = new Set(), activeId = null, activeTab = 'response';
    let logs = [], expandedMissingGroups = new Set(), activeLogIdx = null, logDetailTab = 'response', logRefreshTimer = null;
    let localFiles = [], activeFilePath = null, overrides = {}, currentParseFolder = '';
    let modalCallback = null;
    
    fetch('/admin/folder').then(r=>r.json()).then(d=>{
      document.getElementById('current').textContent=d.folder;
      document.getElementById('folder').value = localStorage.getItem('lastFolder') || '';
      document.getElementById('parseFolder').value = localStorage.getItem('lastParseFolder') || d.folder;
    });
    loadOverrides();
    
    function showTab(name) {
      document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      document.querySelector('.tabs .tab[onclick*="'+name+'"]').classList.add('active');
      document.getElementById(name).classList.add('active');
      if (name === 'logs') { refreshLogs(); startAutoRefresh(); }
      else { stopAutoRefresh(); }
    }
    
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
    
    function updateRefreshInterval() { stopAutoRefresh(); document.getElementById('logAutoRefresh').checked = true; startAutoRefresh(); }
    
    document.getElementById('logList').addEventListener('scroll', function() {
      if (this.scrollTop > 50) stopAutoRefresh();
    });
    
    function changeFolder() {
      const folder = document.getElementById('folder').value;
      if (!folder) return alert('请输入文件夹名称');
      fetch('/admin/folder', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({folder})})
        .then(r=>r.json()).then(d=>{
          if(d.success) { document.getElementById('current').textContent=d.folder; localStorage.setItem('lastFolder', folder); alert('切换成功'); }
          else alert(d.error);
        });
    }

    // Modal
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
        const json = JSON.parse(editor.value);
        editor.value = JSON.stringify(json, null, 2);
        document.getElementById('jsonError').textContent = '';
      } catch (e) {
        document.getElementById('jsonError').textContent = 'JSON 格式错误: ' + e.message;
      }
    }
    
    document.getElementById('modalSaveBtn').onclick = function() {
      const content = document.getElementById('jsonEditor').value;
      try {
        JSON.parse(content); // validate
        if (modalCallback) modalCallback(content);
        closeModal();
      } catch (e) {
        document.getElementById('jsonError').textContent = 'JSON 格式错误: ' + e.message;
      }
    };

    // Overrides
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
        '<div class="override-item"><span class="path">'+p+'</span><button class="btn btn-sm btn-primary" onclick="editOverride(\\''+p.replace(/'/g, "\\\\'")+'\\')">编辑</button><button class="btn btn-sm btn-danger" onclick="removeOverride(\\''+p.replace(/'/g, "\\\\'")+'\\')">删除</button></div>'
      ).join('');
    }
    
    async function removeOverride(path) {
      await fetch('/admin/overrides', { method: 'DELETE', headers: {'Content-Type':'application/json'}, body: JSON.stringify({path}) });
      loadOverrides();
    }
    
    async function editOverride(path) {
      openModal('编辑临时返回值', path, overrides[path] || '', async (content) => {
        await fetch('/admin/overrides', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({path, content}) });
        loadOverrides();
      });
    }
    
    async function setTempOverride(path, originalContent) {
      let content = overrides[path] || originalContent;
      try { content = JSON.stringify(JSON.parse(content), null, 2); } catch {}
      openModal('临时修改返回值', path, content, async (newContent) => {
        await fetch('/admin/overrides', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({path, content: newContent}) });
        loadOverrides();
        if (activeLogIdx !== null) showLogDetail(activeLogIdx);
      });
    }

    // Local Files - 解析指定文件夹
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
      const container = document.getElementById('fileList');
      container.innerHTML = filtered.map(f => 
        '<div class="file-item'+(activeFilePath===f.path?' active':'')+'" onclick="showFileDetail(\\''+f.path.replace(/'/g, "\\\\'")+'\\')">'+f.path+'</div>'
      ).join('');
    }
    
    async function showFileDetail(filePath) {
      activeFilePath = filePath;
      filterFiles();
      const panel = document.getElementById('fileDetailPanel');
      const file = localFiles.find(f => f.path === filePath);
      if (!file) return;
      
      let content = file.content;
      try { content = JSON.stringify(JSON.parse(content), null, 2); } catch {}
      const hasOverride = overrides[filePath];
      
      panel.innerHTML = 
        '<div class="meta-row"><div class="meta-item">'+filePath+'</div>'+(hasOverride?'<div class="meta-item"><span class="badge badge-override">已临时修改</span></div>':'')+'</div>'+
        '<div class="detail-content" style="max-height:380px"><pre id="fileContent">'+escapeHtml(content)+'</pre></div>'+
        '<div style="margin-top:10px">'+
        '<button class="btn btn-primary" onclick="editLocalFile(\\''+filePath.replace(/'/g, "\\\\'")+'\\')">永久修改</button> '+
        '<button class="btn btn-warning" onclick="setTempOverrideFromFile(\\''+filePath.replace(/'/g, "\\\\'")+'\\')">临时修改</button>'+
        (hasOverride?' <button class="btn btn-danger" onclick="removeOverrideAndRefresh(\\''+filePath.replace(/'/g, "\\\\'")+'\\')"">取消临时</button>':'')+
        '</div>';
      panel.classList.add('active');
    }
    
    function escapeHtml(str) {
      return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
    
    function editLocalFile(filePath) {
      const file = localFiles.find(f => f.path === filePath);
      if (!file) return;
      let content = file.content;
      try { content = JSON.stringify(JSON.parse(content), null, 2); } catch {}
      
      openModal('永久修改文件', filePath, content, async (newContent) => {
        const res = await fetch('/admin/file/save', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ folder: currentParseFolder, path: filePath, content: newContent })
        });
        const result = await res.json();
        if (result.success) {
          alert('保存成功');
          parseLocalFolder(); // 重新加载
        } else {
          alert('保存失败: ' + result.error);
        }
      });
    }
    
    function setTempOverrideFromFile(filePath) {
      const file = localFiles.find(f => f.path === filePath);
      if (!file) return;
      setTempOverride(filePath, file.content);
    }
    
    async function removeOverrideAndRefresh(path) {
      await removeOverride(path);
      showFileDetail(path);
    }

    // Logs
    async function refreshLogs() {
      const res = await fetch('/admin/logs');
      logs = await res.json();
      document.getElementById('logCount').textContent = logs.length;
      renderLogs();
    }
    
    async function clearLogs() {
      if (!confirm('确定清空所有日志?')) return;
      await fetch('/admin/logs', {method:'DELETE'});
      activeLogIdx = null;
      document.getElementById('logDetailPanel').classList.remove('active');
      refreshLogs();
    }
    
    function renderLogs() {
      const search = document.getElementById('logSearch').value.toLowerCase();
      const statusFilter = document.getElementById('logStatusFilter').value;
      const groupMissing = document.getElementById('logGroupMissing').checked;
      
      let filtered = logs.map((l, i) => ({...l, idx: i})).filter(l => {
        if (search && !l.path.toLowerCase().includes(search)) return false;
        if (statusFilter === 'found' && !l.found) return false;
        if (statusFilter === 'missing' && l.found) return false;
        return true;
      });
      
      const container = document.getElementById('logList');
      
      if (groupMissing && statusFilter !== 'found') {
        const missingGroups = {};
        filtered.forEach(l => { if (!l.found) { if (!missingGroups[l.path]) missingGroups[l.path] = []; missingGroups[l.path].push(l); } });
        let html = '';
        for (const [path, items] of Object.entries(missingGroups)) {
          const expanded = expandedMissingGroups.has(path);
          html += '<div class="group-header" onclick="toggleMissingGroup(\\''+path.replace(/'/g, "\\\\'")+'\\')"><span class="arrow '+(expanded?'expanded':'')+'">▶</span><span class="badge badge-missing">404</span><span class="path">'+path+'</span><span class="badge badge-count">'+items.length+'</span></div>';
          html += '<div class="group-items '+(expanded?'expanded':'')+'">';
          items.forEach(l => { html += '<div class="log-item'+(activeLogIdx===l.idx?' active':'')+'" onclick="showLogDetail('+l.idx+')"><span class="log-time">'+l.time+'</span><span class="log-ip">'+l.ip+'</span></div>'; });
          html += '</div>';
        }
        filtered.filter(l => l.found).forEach(l => {
          html += '<div class="log-item'+(activeLogIdx===l.idx?' active':'')+'" onclick="showLogDetail('+l.idx+')"><span class="log-time">'+l.time+'</span><span class="log-ip">'+l.ip+'</span><span class="log-path">'+l.path+'</span><span class="log-status found">✓</span></div>';
        });
        container.innerHTML = html;
      } else {
        container.innerHTML = filtered.map(l => 
          '<div class="log-item'+(activeLogIdx===l.idx?' active':'')+'" onclick="showLogDetail('+l.idx+')"><span class="log-time">'+l.time+'</span><span class="log-ip">'+l.ip+'</span><span class="log-path">'+l.path+'</span><span class="log-status '+(l.found?'found':'missing')+'">'+(l.found?'✓':'404')+'</span></div>'
        ).join('');
      }
    }
    
    function toggleMissingGroup(path) { expandedMissingGroups.has(path) ? expandedMissingGroups.delete(path) : expandedMissingGroups.add(path); renderLogs(); }
    function switchLogDetailTab(tab) { logDetailTab = tab; if (activeLogIdx !== null) showLogDetail(activeLogIdx); }
    let logHeadersCollapsed = { req: true, res: true };
    function toggleLogHeaders(type) { logHeadersCollapsed[type] = !logHeadersCollapsed[type]; if (activeLogIdx !== null) showLogDetail(activeLogIdx); }

    function showLogDetail(idx) {
      activeLogIdx = idx;
      const l = logs[idx];
      const panel = document.getElementById('logDetailPanel');
      const tabBtn = (name, label) => '<button class="detail-tab'+(logDetailTab===name?' active':'')+'" onclick="switchLogDetailTab(\\''+name+'\\')">'+label+'</button>';
      const headerTable = (headers) => { if (!headers || Object.keys(headers).length === 0) return '<em>无</em>'; return '<table>'+Object.entries(headers).map(([k,v]) => '<tr><td>'+k+'</td><td>'+v+'</td></tr>').join('')+'</table>'; };
      const queryTable = (query) => { if (!query || Object.keys(query).length === 0) return '<em>无</em>'; return '<table>'+Object.entries(query).map(([k,v]) => '<tr><td>'+k+'</td><td>'+v+'</td></tr>').join('')+'</table>'; };
      const collapsible = (title, content, type) => { const collapsed = logHeadersCollapsed[type]; return '<div style="margin-top:10px"><strong style="cursor:pointer" onclick="toggleLogHeaders(\\''+type+'\\')">'+title+' '+(collapsed?'▶':'▼')+'</strong></div><div class="detail-content" style="'+(collapsed?'display:none;':'')+'max-height:150px">'+content+'</div>'; };
      
      // 获取当前响应内容
      fetch(l.path).then(r => { const resHeaders = {}; r.headers.forEach((v, k) => resHeaders[k] = v); return r.text().then(text => ({ text, resHeaders })); })
        .then(({ text, resHeaders }) => {
          let responseBody; try { responseBody = JSON.stringify(JSON.parse(text), null, 2); } catch { responseBody = text; }
          const respContent = document.getElementById('logResponseContent'); if (respContent) respContent.innerHTML = '<pre>'+escapeHtml(responseBody)+'</pre>';
          const resHeadersEl = document.getElementById('logResHeaders'); if (resHeadersEl) resHeadersEl.innerHTML = headerTable(resHeaders);
          // 保存原始内容用于编辑
          window.currentLogResponse = text;
        }).catch(() => { const respContent = document.getElementById('logResponseContent'); if (respContent) respContent.innerHTML = '<em>无法加载</em>'; window.currentLogResponse = '{}'; });
      
      const hasOverride = overrides[l.path];
      panel.innerHTML = 
        '<div class="meta-row"><div class="meta-item"><span class="method method-'+(l.method||'GET')+'">'+(l.method||'GET')+'</span></div><div class="meta-item">时间: '+l.time+'</div><div class="meta-item">IP: '+l.ip+'</div><div class="meta-item">状态: <span class="log-status '+(l.found?'found':'missing')+'">'+(l.found?'存在':'404')+'</span></div>'+(hasOverride?'<div class="meta-item"><span class="badge badge-override">已临时修改</span></div>':'')+'</div>'+
        '<div style="font-family:monospace;font-size:11px;margin-bottom:10px;word-break:break-all;color:#666">'+(l.fullUrl||l.path)+'</div>'+
        '<div class="detail-tabs">'+tabBtn('response','Response')+tabBtn('request','Request')+'</div>'+
        '<div class="tab-content'+(logDetailTab==='response'?' active':'')+'"><div class="detail-content" id="logResponseContent" style="max-height:200px"><em>加载中...</em></div>'+collapsible('Response Headers', '<div id="logResHeaders"><em>加载中...</em></div>', 'res')+
        '<div style="margin-top:10px"><button class="btn btn-warning btn-sm" onclick="editLogOverride(\\''+l.path.replace(/'/g, "\\\\'")+'\\')">临时修改返回值</button>'+(hasOverride?' <button class="btn btn-danger btn-sm" onclick="removeOverrideAndRefreshLog(\\''+l.path.replace(/'/g, "\\\\'")+'\\')"">取消临时修改</button>':'')+'</div></div>'+
        '<div class="tab-content'+(logDetailTab==='request'?' active':'')+'"><div style="margin-bottom:10px"><strong>基本信息</strong></div><div class="detail-content" style="max-height:80px;margin-bottom:10px"><table><tr><td>方法</td><td>'+(l.method||'GET')+'</td></tr><tr><td>路径</td><td>'+l.path+'</td></tr><tr><td>访问时间</td><td>'+l.time+'</td></tr><tr><td>客户端IP</td><td>'+l.ip+'</td></tr></table></div><div style="margin-bottom:10px"><strong>Query 参数</strong></div><div class="detail-content" style="max-height:80px;margin-bottom:10px">'+queryTable(l.query)+'</div>'+collapsible('Request Headers ('+(l.headers?Object.keys(l.headers).length:0)+')', headerTable(l.headers), 'req')+'</div>';
      panel.classList.add('active');
      renderLogs();
    }
    
    function editLogOverride(path) {
      // 等待响应加载完成
      setTimeout(() => {
        const content = window.currentLogResponse || '{}';
        setTempOverride(path, content);
      }, 100);
    }
    
    async function removeOverrideAndRefreshLog(path) {
      await removeOverride(path);
      showLogDetail(activeLogIdx);
    }

    // HAR Parser
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    uploadArea.onclick = () => fileInput.click();
    uploadArea.ondragover = e => { e.preventDefault(); uploadArea.classList.add('dragover'); };
    uploadArea.ondragleave = () => uploadArea.classList.remove('dragover');
    uploadArea.ondrop = e => { e.preventDefault(); uploadArea.classList.remove('dragover'); if(e.dataTransfer.files[0]) loadHarFile(e.dataTransfer.files[0]); };
    fileInput.onchange = e => { if(e.target.files[0]) loadHarFile(e.target.files[0]); };

    function loadHarFile(file) {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const har = JSON.parse(e.target.result);
          entries = har.log.entries.map((entry, i) => {
            const url = new URL(entry.request.url);
            let dataHash = '';
            try { const json = JSON.parse(entry.response.content?.text || '{}'); dataHash = JSON.stringify(json.Data || json.data || json); } catch { dataHash = entry.response.content?.text || ''; }
            return { id: i, method: entry.request.method, path: url.pathname, fullUrl: entry.request.url, status: entry.response.status, statusText: entry.response.statusText, contentType: entry.response.content?.mimeType || '', size: entry.response.content?.size || 0, body: entry.response.content?.text || '', time: entry.startedDateTime, reqHeaders: entry.request.headers, resHeaders: entry.response.headers, queryString: entry.request.queryString, postData: entry.request.postData, timings: entry.timings, totalTime: entry.time, dataHash };
          });
          document.getElementById('harContent').classList.remove('hidden');
          uploadArea.innerHTML = '<p>已加载: ' + file.name + ' (' + entries.length + ' 条)</p>';
          document.getElementById('totalCount').textContent = entries.length;
          applyFilters();
        } catch(err) { alert('解析失败: ' + err.message); }
      };
      reader.readAsText(file);
    }

    ['searchInput','methodFilter','statusFilter','mergeData'].forEach(id => { document.getElementById(id).addEventListener('change', applyFilters); document.getElementById(id).addEventListener('input', applyFilters); });

    function applyFilters() {
      const search = document.getElementById('searchInput').value.toLowerCase();
      const method = document.getElementById('methodFilter').value;
      const status = document.getElementById('statusFilter').value;
      const merge = document.getElementById('mergeData').checked;
      const filtered = entries.filter(e => { if (search && !e.path.toLowerCase().includes(search)) return false; if (method && e.method !== method) return false; if (status === '2xx' && (e.status < 200 || e.status >= 300)) return false; if (status === '4xx' && (e.status < 400 || e.status >= 500)) return false; if (status === '5xx' && e.status < 500) return false; return true; });
      groups = {};
      filtered.forEach(e => { const key = e.method + ':' + e.path; if (!groups[key]) groups[key] = { items: [], merged: false, seenHashes: new Set() }; if (merge && groups[key].seenHashes.has(e.dataHash)) { groups[key].merged = true; return; } groups[key].seenHashes.add(e.dataHash); groups[key].items.push(e); });
      document.getElementById('groupCount').textContent = Object.keys(groups).length;
      renderGroups();
    }

    function renderGroups() {
      const container = document.getElementById('groupList');
      let html = '';
      for (const [key, group] of Object.entries(groups)) {
        const items = group.items; const [method, ...pathParts] = key.split(':'); const path = pathParts.join(':');
        const expanded = expandedGroups.has(key); const allSelected = items.every(e => selectedIds.has(e.id)); const someSelected = items.some(e => selectedIds.has(e.id));
        html += '<div class="group"><div class="group-header" onclick="toggleGroup(\\''+key.replace(/'/g, "\\\\'")+'\\')"><input type="checkbox" '+(allSelected?'checked':'')+(someSelected && !allSelected?' style="opacity:0.5"':'')+' onclick="event.stopPropagation();toggleGroupSelect(\\''+key.replace(/'/g, "\\\\'")+'\\', this.checked)"><span class="arrow '+(expanded?'expanded':'')+'">▶</span><span class="method method-'+method+'">'+method+'</span><span class="path">'+path+'</span><span class="badge badge-count">'+items.length+'</span>'+(group.merged?'<span class="badge badge-merged">已合并</span>':'')+'</div>';
        html += '<div class="group-items '+(expanded?'expanded':'')+'">';
        items.forEach((e, idx) => { html += '<div class="item-row '+(activeId===e.id?'active':'')+'" onclick="showDetail('+e.id+')"><input type="checkbox" '+(selectedIds.has(e.id)?'checked':'')+' onclick="event.stopPropagation();toggleSelect('+e.id+')"><span class="status-code status-'+Math.floor(e.status/100)+'xx">'+e.status+'</span><span style="color:#666">#'+(idx+1)+' · '+formatSize(e.size)+' · '+(e.totalTime||0)+'ms</span></div>'; });
        html += '</div></div>';
      }
      container.innerHTML = html;
      document.getElementById('selectedCount').textContent = selectedIds.size;
    }

    function toggleGroup(key) { expandedGroups.has(key) ? expandedGroups.delete(key) : expandedGroups.add(key); renderGroups(); }
    function toggleGroupSelect(key, checked) { groups[key].items.forEach(e => checked ? selectedIds.add(e.id) : selectedIds.delete(e.id)); renderGroups(); }
    function formatSize(b) { return b<1024 ? b+'B' : b<1048576 ? (b/1024).toFixed(1)+'K' : (b/1048576).toFixed(1)+'M'; }
    function toggleSelect(id) { selectedIds.has(id) ? selectedIds.delete(id) : selectedIds.add(id); renderGroups(); }
    function selectAll() { Object.values(groups).forEach(g => { if (g.items.length === 1) { selectedIds.add(g.items[0].id); } else { const latest = g.items.reduce((a, b) => getDataTime(a) > getDataTime(b) ? a : b); selectedIds.add(latest.id); } }); renderGroups(); }
    function getDataTime(entry) { try { const json = JSON.parse(entry.body); const dt = json.DataTime || json.dataTime || json.timestamp || entry.time || ''; return new Date(dt).getTime() || 0; } catch { return new Date(entry.time).getTime() || 0; } }
    function selectNone() { selectedIds.clear(); renderGroups(); }
    function expandAll() { Object.keys(groups).forEach(k => expandedGroups.add(k)); renderGroups(); }
    function collapseAll() { expandedGroups.clear(); renderGroups(); }
    function switchDetailTab(tab) { activeTab = tab; if (activeId !== null) showDetail(activeId); }

    function showDetail(id) {
      activeId = id; const e = entries.find(x => x.id === id); const panel = document.getElementById('detailPanel');
      let body = e.body; try { body = JSON.stringify(JSON.parse(body), null, 2); } catch {}
      const headerTable = (headers) => { if (!headers || !headers.length) return '<em>无</em>'; return '<table>'+headers.map(h => '<tr><td>'+h.name+'</td><td>'+h.value+'</td></tr>').join('')+'</table>'; };
      const timings = e.timings || {}; const timingHtml = '<table><tr><td>等待</td><td>'+(timings.wait||0)+'ms</td></tr><tr><td>连接</td><td>'+(timings.connect||0)+'ms</td></tr><tr><td>发送</td><td>'+(timings.send||0)+'ms</td></tr><tr><td>接收</td><td>'+(timings.receive||0)+'ms</td></tr><tr><td><strong>总计</strong></td><td><strong>'+(e.totalTime||0)+'ms</strong></td></tr></table>';
      let queryHtml = '<em>无</em>'; if (e.queryString && e.queryString.length) { queryHtml = '<table>'+e.queryString.map(q => '<tr><td>'+q.name+'</td><td>'+q.value+'</td></tr>').join('')+'</table>'; }
      let postHtml = '<em>无</em>'; if (e.postData) { let postBody = e.postData.text || ''; try { postBody = JSON.stringify(JSON.parse(postBody), null, 2); } catch {} postHtml = '<div style="margin-bottom:5px"><strong>'+e.postData.mimeType+'</strong></div><pre>'+escapeHtml(postBody)+'</pre>'; }
      const tabBtn = (name, label) => '<button class="detail-tab'+(activeTab===name?' active':'')+'" onclick="switchDetailTab(\\''+name+'\\')">'+label+'</button>';
      panel.innerHTML = '<div class="meta-row"><div class="meta-item"><span class="method method-'+e.method+'">'+e.method+'</span></div><div class="meta-item">状态: <span class="status-code status-'+Math.floor(e.status/100)+'xx">'+e.status+'</span></div><div class="meta-item">大小: '+formatSize(e.size)+'</div><div class="meta-item">耗时: '+(e.totalTime||0)+'ms</div></div><div style="font-family:monospace;font-size:11px;margin-bottom:10px;word-break:break-all;color:#666">'+e.fullUrl+'</div><div class="detail-tabs">'+tabBtn('response','Response')+tabBtn('request','Request')+tabBtn('headers','Headers')+tabBtn('timing','Timing')+'</div><div class="tab-content'+(activeTab==='response'?' active':'')+'"><div class="detail-content"><pre>'+escapeHtml(body)+'</pre></div></div><div class="tab-content'+(activeTab==='request'?' active':'')+'"><div style="margin-bottom:10px"><strong>Query 参数</strong></div><div class="detail-content" style="max-height:150px;margin-bottom:10px">'+queryHtml+'</div><div style="margin-bottom:10px"><strong>Request Body</strong></div><div class="detail-content">'+postHtml+'</div></div><div class="tab-content'+(activeTab==='headers'?' active':'')+'"><div style="margin-bottom:10px"><strong>Request Headers ('+((e.reqHeaders||[]).length)+')</strong></div><div class="detail-content" style="max-height:150px;margin-bottom:10px">'+headerTable(e.reqHeaders)+'</div><div style="margin-bottom:10px"><strong>Response Headers ('+((e.resHeaders||[]).length)+')</strong></div><div class="detail-content" style="max-height:150px">'+headerTable(e.resHeaders)+'</div></div><div class="tab-content'+(activeTab==='timing'?' active':'')+'"><div class="detail-content">'+timingHtml+'</div></div>';
      panel.classList.add('active'); renderGroups();
    }

    function getSelectedFiles() {
      const folder = document.getElementById('outputFolder').value || 'mock'; const keepLast = document.getElementById('keepLast').checked; const pretty = document.getElementById('prettyJson').checked;
      const selected = entries.filter(e => selectedIds.has(e.id)); const fileMap = new Map();
      selected.forEach(e => { const fp = folder + e.path + '.json'; if (!keepLast && fileMap.has(fp)) return; let c = e.body; if (pretty) { try { c = JSON.stringify(JSON.parse(c), null, 2); } catch {} } fileMap.set(fp, c); });
      return fileMap;
    }

    async function saveToServer() {
      const files = getSelectedFiles(); if (files.size === 0) { alert('请先选择要保存的请求'); return; }
      const data = {}; files.forEach((content, path) => data[path] = content);
      const res = await fetch('/admin/har/save', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) });
      const result = await res.json();
      if (result.success) alert('保存成功: ' + result.count + ' 个文件'); else alert('保存失败: ' + result.error);
    }
  </script>
</body>
</html>`;


function addLog(req, found) {
  const now = new Date();
  const time = now.toLocaleString('zh-CN', { hour12: false });
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const urlPath = req.url.replace(/\/$/, '').split('?')[0];
  const urlObj = new URL(req.url, 'http://localhost');
  const query = {};
  urlObj.searchParams.forEach((v, k) => query[k] = v);
  accessLogs.unshift({ time, path: urlPath, ip, found, method: req.method, fullUrl: req.url, query, headers: req.headers });
  if (accessLogs.length > MAX_LOGS) accessLogs.pop();
}

function getAllFiles(dir, base = '') {
  let results = [];
  try {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const relPath = base ? base + '/' + item : item;
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        results = results.concat(getAllFiles(fullPath, relPath));
      } else if (item.endsWith('.json')) {
        const apiPath = '/' + relPath.replace(/\.json$/, '');
        const content = fs.readFileSync(fullPath, 'utf8');
        results.push({ path: apiPath, content });
      }
    }
  } catch (e) {}
  return results;
}

const server = http.createServer((req, res) => {
  if (req.url === '/admin' || req.url === '/admin/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(adminHtml);
    return;
  }

  if (req.url === '/admin/logs' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(accessLogs));
    return;
  }

  if (req.url === '/admin/logs' && req.method === 'DELETE') {
    accessLogs = [];
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: true }));
    return;
  }

  if (req.url.startsWith('/admin/files') && req.method === 'GET') {
    const urlObj = new URL(req.url, 'http://localhost');
    const folder = urlObj.searchParams.get('folder');
    if (!folder) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: '请指定文件夹' }));
      return;
    }
    if (!fs.existsSync(folder)) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: '文件夹不存在: ' + folder }));
      return;
    }
    const files = getAllFiles(folder);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ files }));
    return;
  }

  if (req.url === '/admin/file/save' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { folder, path: apiPath, content } = JSON.parse(body);
        const filePath = path.join(folder, apiPath + '.json');
        fs.writeFileSync(filePath, content);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.url === '/admin/overrides' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(tempOverrides));
    return;
  }

  if (req.url === '/admin/overrides' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { path: p, content } = JSON.parse(body);
        tempOverrides[p] = content;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.url === '/admin/overrides' && req.method === 'DELETE') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { path: p } = JSON.parse(body);
        delete tempOverrides[p];
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.url === '/admin/har/save' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const files = JSON.parse(body);
        let count = 0;
        for (const [filePath, content] of Object.entries(files)) {
          const dir = path.dirname(filePath);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(filePath, content);
          count++;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true, count }));
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.url === '/admin/folder' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { folder } = JSON.parse(body);
        if (folder) {
          baseFolder = folder;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true, folder: baseFolder }));
        } else {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'folder is required' }));
        }
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  if (req.url === '/admin/folder' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ folder: baseFolder }));
    return;
  }

  if (req.url.startsWith('/admin')) return;

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  if (req.method === 'OPTIONS') { res.statusCode = 200; res.end(); return; }

  const urlPath = req.url.replace(/\/$/, '').split('?')[0];
  
  // 检查临时修改
  if (tempOverrides[urlPath]) {
    addLog(req, true);
    res.end(tempOverrides[urlPath]);
    return;
  }

  const filePath = path.join(baseFolder, `${urlPath}.json`);
  const notFoundPath = path.join(__dirname, '404.json');

  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      addLog(req, false);
      fs.readFile(notFoundPath, 'utf8', (_, data404) => {
        res.statusCode = 404;
        res.end(data404 || '{"error": "Not Found"}');
      });
    } else {
      addLog(req, true);
      res.end(data);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const interfaces = require('os').networkInterfaces();
  const ips = Object.values(interfaces).flat().filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log('Server running at:');
  console.log('  Local:   http://127.0.0.1:' + PORT);
  ips.forEach(ip => console.log('  Network: http://' + ip + ':' + PORT));
  console.log('Admin page: http://127.0.0.1:' + PORT + '/admin');
  console.log('Serving files from: ' + baseFolder + '/');
});
