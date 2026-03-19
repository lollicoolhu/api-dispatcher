const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { getAllFiles, getServerAddresses } = require('./utils');
const { getLogs, clearLogs } = require('./logger');

// 处理管理路由
function handleAdminRoutes(req, res, config, saveData, httpPort, httpsPort) {
  const { tempOverrides, urlMappings, folderMappings, localFolders, globalServers, cookieRewrite } = config.getConfig();
  const dataRoot = config.getDataRoot();
  const masterConfig = config.getMasterConfig();
  
  // 静态文件服务
  if (req.url === '/admin' || req.url === '/admin/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(__dirname, '../admin.html'), 'utf8'));
    return true;
  }
  if (req.url === '/admin.css') {
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.end(fs.readFileSync(path.join(__dirname, '../admin.css'), 'utf8'));
    return true;
  }
  if (req.url === '/admin.js') {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.end(fs.readFileSync(path.join(__dirname, '../admin.js'), 'utf8'));
    return true;
  }

  // API 路由
  const urlPath = req.url.split('?')[0];
  const url = urlPath;
  const method = req.method;

  // 日志
  if (url === '/admin/logs' && method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(getLogs()));
    return true;
  }
  if (url === '/admin/logs' && method === 'DELETE') {
    clearLogs();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: true }));
    return true;
  }

  // 获取引导配置
  if (url === '/admin/master-config' && method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ...masterConfig,
      effectiveDataRoot: dataRoot
    }));
    return true;
  }

  // 更新引导配置
  if (url === '/admin/master-config' && method === 'POST') {
    return handlePostRequest(req, res, (body) => {
      const cfg = JSON.parse(body);
      if (cfg.externalFolderPath) {
        if (!fs.existsSync(cfg.externalFolderPath)) {
          return { success: false, error: '本地文件夹路径不存在' };
        }
        try {
          // 检查读写权限
          fs.accessSync(cfg.externalFolderPath, fs.constants.R_OK | fs.constants.W_OK);
        } catch (e) {
          return { success: false, error: '文件夹权限不足 (需读写权限)' };
        }
      }
      config.setMasterConfig(cfg);
      // 切换文件夹后，重新加载数据
      config.loadData();
      return { success: true };
    });
  }

  // 文件列表
  if (url.startsWith('/admin/files') && method === 'GET') {
    const urlObj = new URL(req.url, 'http://localhost');
    const folder = urlObj.searchParams.get('folder');
    if (!folder) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: '请指定文件夹' }));
      return true;
    }

    // 路径归一化：处理 ~ 前缀
    let processedFolder = folder;
    if (folder.startsWith('~/')) {
      const os = require('os');
      processedFolder = path.join(os.homedir(), folder.slice(2));
    } else if (folder === '~') {
      const os = require('os');
      processedFolder = os.homedir();
    }

    const absFolder = path.isAbsolute(processedFolder) ? processedFolder : path.join(dataRoot, processedFolder);
    
    if (!fs.existsSync(absFolder)) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ 
        error: '文件夹不存在/无权访问: ' + absFolder,
        path: absFolder,
        requestFolder: folder,
        dataRoot: dataRoot
      }));
      return true;
    }
    
    try {
      const stats = fs.statSync(absFolder);
      if (!stats.isDirectory()) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: '指定的路径不是文件夹: ' + absFolder }));
        return true;
      }
      const files = getAllFiles(absFolder);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ files }));
    } catch (e) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: '解析文件夹失败: ' + e.message }));
    }
    return true;
  }

  // 保存文件
  if (url === '/admin/file/save' && method === 'POST') {
    return handlePostRequest(req, res, (body) => {
      const { folder, path: apiPath, content } = JSON.parse(body);
      const absFolder = path.isAbsolute(folder) ? folder : path.join(dataRoot, folder);
      const filePath = path.join(absFolder, apiPath + '.json');
      fs.writeFileSync(filePath, content);
      return { success: true };
    });
  }

  // 创建文件
  if (url === '/admin/file/create' && method === 'POST') {
    return handlePostRequest(req, res, (body) => {
      const { path: apiPath, content, folder } = JSON.parse(body);
      const hasExt = /\.[a-zA-Z0-9]+$/.test(apiPath);
      const targetFolder = folder ? (path.isAbsolute(folder) ? folder : path.join(dataRoot, folder)) : path.join(dataRoot, 'mock');
      const filePath = path.join(targetFolder, hasExt ? apiPath : apiPath + '.json');
      const dir = path.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, content);
      return { success: true };
    });
  }

  // 删除文件
  if (url === '/admin/file/delete' && method === 'POST') {
    return handlePostRequest(req, res, (body) => {
      const { path: apiPath } = JSON.parse(body);
      const hasExt = /\.[a-zA-Z0-9]+$/.test(apiPath);
      const filePath = path.join(dataRoot, 'mock', hasExt ? apiPath : apiPath + '.json');
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return { success: true };
      }
      return { success: false, error: '文件不存在' };
    });
  }

  if (url === '/admin/overrides/import' && method === 'POST') {
    return handlePostRequest(req, res, (body) => {
      const data = JSON.parse(body);
      Object.keys(data).forEach(p => {
        tempOverrides[p] = data[p];
      });
      saveData();
      return { success: true };
    });
  }

  // 临时覆盖
  if (url === '/admin/overrides' && method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(tempOverrides));
    return true;
  }
  if (url === '/admin/overrides' && method === 'POST') {
    return handlePostRequest(req, res, (body) => {
      const { path: p, content, enabled, priority, remark, versionId, conditions, conditionLogic, delay } = JSON.parse(body);
      
      // 初始化路径的版本数组
      if (!tempOverrides[p]) {
        tempOverrides[p] = [];
      }
      
      // 如果指定了 versionId，更新该版本
      if (versionId !== undefined) {
        const version = tempOverrides[p].find(v => v.id === versionId);
        if (version) {
          if (content !== undefined) version.content = content;
          if (enabled !== undefined) {
            version.enabled = enabled;
          }
          if (priority !== undefined) version.priority = priority;
          if (remark !== undefined) version.remark = remark;
          if (conditions !== undefined) version.conditions = conditions;
          if (conditionLogic !== undefined) version.conditionLogic = conditionLogic;
          if (delay !== undefined) version.delay = parseInt(delay) || 0;
        }
      } else {
        // 创建新版本
        const newVersion = {
          id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
          content: content || '{}',
          enabled: enabled !== false,
          priority: priority ?? 1,
          remark: remark || '',
          conditions: conditions || [],
          conditionLogic: conditionLogic || 'and',
          delay: parseInt(delay) || 0,
          createdAt: new Date().toISOString()
        };
        
        tempOverrides[p].push(newVersion);
      }
      
      saveData();
      return { success: true };
    });
  }
  if (url === '/admin/overrides' && method === 'DELETE') {
    return handlePostRequest(req, res, (body) => {
      const { path: p, versionId } = JSON.parse(body);
      
      if (versionId) {
        // 删除指定版本
        if (tempOverrides[p]) {
          tempOverrides[p] = tempOverrides[p].filter(v => v.id !== versionId);
          // 如果没有版本了，删除整个路径
          if (tempOverrides[p].length === 0) {
            delete tempOverrides[p];
          }
        }
      } else {
        // 删除整个路径的所有版本
        delete tempOverrides[p];
      }
      
      saveData();
      return { success: true };
    });
  }

  // URL映射
  if (url === '/admin/mappings' && method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(urlMappings));
    return true;
  }
  if (url === '/admin/mappings' && method === 'POST') {
    return handlePostRequest(req, res, (body) => {
      const { path: p, target, enabled, priority, remark, delay } = JSON.parse(body);
      if (urlMappings[p]) {
        if (target !== undefined) urlMappings[p].target = target;
        if (enabled !== undefined) urlMappings[p].enabled = enabled;
        if (priority !== undefined) urlMappings[p].priority = priority;
        if (remark !== undefined) urlMappings[p].remark = remark;
        if (delay !== undefined) urlMappings[p].delay = parseInt(delay) || 0;
      } else {
        urlMappings[p] = { target: target || '', enabled: enabled !== false, priority: priority ?? 1, remark: remark || '', delay: parseInt(delay) || 0 };
      }
      saveData();
      return { success: true };
    });
  }
  if (url === '/admin/mappings' && method === 'DELETE') {
    return handlePostRequest(req, res, (body) => {
      const { path: p } = JSON.parse(body);
      delete urlMappings[p];
      saveData();
      return { success: true };
    });
  }

  // 文件夹映射
  if (url === '/admin/folder-mappings' && method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(folderMappings));
    return true;
  }
  if (url === '/admin/folder-mappings' && method === 'POST') {
    return handlePostRequest(req, res, (body) => {
      const { pattern, folder, enabled, priority, remark, delay } = JSON.parse(body);
      if (folderMappings[pattern]) {
        if (folder !== undefined) folderMappings[pattern].folder = folder;
        if (enabled !== undefined) folderMappings[pattern].enabled = enabled;
        if (priority !== undefined) folderMappings[pattern].priority = priority;
        if (remark !== undefined) folderMappings[pattern].remark = remark;
        if (delay !== undefined) folderMappings[pattern].delay = parseInt(delay) || 0;
      } else {
        folderMappings[pattern] = { folder: folder || '', enabled: enabled !== false, priority: priority ?? 1, remark: remark || '', delay: parseInt(delay) || 0 };
      }
      saveData();
      return { success: true };
    });
  }
  if (url === '/admin/folder-mappings' && method === 'DELETE') {
    return handlePostRequest(req, res, (body) => {
      const { pattern } = JSON.parse(body);
      delete folderMappings[pattern];
      saveData();
      return { success: true };
    });
  }

  // 本地文件夹
  if (url === '/admin/local-folders' && method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ folders: localFolders }));
    return true;
  }
  if (url === '/admin/local-folders' && method === 'POST') {
    return handlePostRequest(req, res, (body) => {
      const { path: folderPath, enabled, priority, remark, delay } = JSON.parse(body);
      if (localFolders[folderPath]) {
        if (enabled !== undefined) localFolders[folderPath].enabled = enabled;
        if (priority !== undefined) localFolders[folderPath].priority = priority;
        if (remark !== undefined) localFolders[folderPath].remark = remark;
        if (delay !== undefined) localFolders[folderPath].delay = parseInt(delay) || 0;
      } else {
        localFolders[folderPath] = { enabled: enabled !== false, priority: priority ?? 0, remark: remark || '', delay: parseInt(delay) || 0 };
      }
      saveData();
      return { success: true };
    });
  }
  if (url === '/admin/local-folders' && method === 'DELETE') {
    return handlePostRequest(req, res, (body) => {
      const { path: folderPath } = JSON.parse(body);
      delete localFolders[folderPath];
      saveData();
      return { success: true };
    });
  }

  // 全局服务器
  if (url === '/admin/global-servers' && method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ servers: globalServers }));
    return true;
  }
  if (url === '/admin/global-servers' && method === 'POST') {
    return handlePostRequest(req, res, (body) => {
      const { url, enabled, priority, remark, delay } = JSON.parse(body);
      if (globalServers[url]) {
        if (enabled !== undefined) globalServers[url].enabled = enabled;
        if (priority !== undefined) globalServers[url].priority = priority;
        if (remark !== undefined) globalServers[url].remark = remark;
        if (delay !== undefined) globalServers[url].delay = parseInt(delay) || 0;
      } else {
        globalServers[url] = { enabled: enabled !== false, priority: priority ?? 100, remark: remark || '', delay: parseInt(delay) || 0 };
      }
      saveData();
      return { success: true };
    });
  }
  if (url === '/admin/global-servers' && method === 'DELETE') {
    return handlePostRequest(req, res, (body) => {
      const { url } = JSON.parse(body);
      delete globalServers[url];
      saveData();
      return { success: true };
    });
  }

  // Cookie重写开关
  if (url === '/admin/cookie-rewrite' && method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ enabled: cookieRewrite }));
    return true;
  }
  if (url === '/admin/cookie-rewrite' && method === 'POST') {
    return handlePostRequest(req, res, (body) => {
      const data = JSON.parse(body);
      if (data.enabled !== undefined) {
        config.setConfig({ cookieRewrite: data.enabled });
      }
      saveData();
      return { success: true };
    });
  }

  // 全局延迟开关
  if (url === '/admin/global-delay' && method === 'GET') {
    const { globalDelay } = config.getConfig();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ delay: globalDelay }));
    return true;
  }
  if (url === '/admin/global-delay' && method === 'POST') {
    return handlePostRequest(req, res, (body) => {
      const data = JSON.parse(body);
      if (data.delay !== undefined) {
        config.setConfig({ globalDelay: parseInt(data.delay) || 0 });
      }
      saveData();
      return { success: true };
    });
  }

  // 接口特定延迟
  if (url === '/admin/path-delays' && method === 'GET') {
    const { pathDelays } = config.getConfig();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(pathDelays || {}));
    return true;
  }
  if (url === '/admin/path-delays' && method === 'POST') {
    return handlePostRequest(req, res, (body) => {
      const { path, delay, enabled } = JSON.parse(body);
      if (path) {
        const { pathDelays } = config.getConfig();
        if (delay === null) {
          delete pathDelays[path];
        } else {
          pathDelays[path] = { delay: parseInt(delay) || 0, enabled: enabled !== false };
        }
        config.setConfig({ pathDelays });
        saveData();
      }
      return { success: true };
    });
  }

  // 测试映射
  if (url === '/admin/test-mapping' && method === 'POST') {
    return handlePostRequest(req, res, (body) => {
      return new Promise((resolve) => {
        const { path: apiPath, target } = JSON.parse(body);
        const targetBase = target.replace(/\/+$/, '');
        const targetUrl = targetBase + apiPath;
        const startTime = Date.now();
        const protocol = targetUrl.startsWith('https') ? https : http;
        
        protocol.get(targetUrl, (proxyRes) => {
          let data = '';
          proxyRes.on('data', chunk => data += chunk);
          proxyRes.on('end', () => {
            const headers = {};
            Object.keys(proxyRes.headers).forEach(k => headers[k] = proxyRes.headers[k]);
            resolve({
              status: proxyRes.statusCode,
              url: targetUrl,
              time: Date.now() - startTime,
              size: data.length,
              headers,
              body: data
            });
          });
        }).on('error', (e) => {
          resolve({
            status: 0,
            url: targetUrl,
            time: 0,
            size: 0,
            headers: {},
            body: 'Error: ' + e.message
          });
        });
      });
    });
  }

  // 文件夹创建
  if (url === '/admin/folder/create' && method === 'POST') {
    return handlePostRequest(req, res, (body) => {
      const { name } = JSON.parse(body);
      if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
        return { success: false, error: '文件夹名称不合法' };
      }
      const folderPath = path.join(dataRoot, name);
      try {
        if (!fs.existsSync(folderPath)) {
          fs.mkdirSync(folderPath, { recursive: true });
        }
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });
  }

  // HAR保存
  if (url === '/admin/har/save' && method === 'POST') {
    return handlePostRequest(req, res, (body) => {
      const files = JSON.parse(body);
      let count = 0;
      for (const [relPath, content] of Object.entries(files)) {
        const fullPath = path.isAbsolute(relPath) ? relPath : path.join(dataRoot, relPath);
        const dir = path.dirname(fullPath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fullPath, content);
        count++;
      }
      return { success: true, count };
    });
  }

  // 获取文件夹列表
  if (url === '/admin/folders' && method === 'GET') {
    const folders = [];
    try {
      if (fs.existsSync(dataRoot)) {
        const items = fs.readdirSync(dataRoot);
        for (const item of items) {
          const fullPath = path.join(dataRoot, item);
          if (fs.statSync(fullPath).isDirectory()) {
            folders.push({ name: item, path: item }); // 返回相对于 dataRoot 的路径
          }
        }
      }
    } catch (e) {
      console.error('Failed to read folders:', e.message);
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ folders }));
    return true;
  }

  // 系统级选择文件夹接口
  if (url === '/admin/system/select-folder' && method === 'POST') {
    const { exec } = require('child_process');
    let command = '';
    
    if (process.platform === 'darwin') {
      // macOS 使用 AppleScript
      command = `osascript -e 'POSIX path of (choose folder with prompt "请选择 Mock 数据存储目录")'`;
    } else if (process.platform === 'win32') {
      // Windows 使用 PowerShell (简单版)
      command = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath }"`;
    }

    if (!command) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: false, error: '当前操作系统暂不支持系统选择器，请手动配置。' }));
      return true;
    }

    exec(command, (error, stdout) => {
      res.setHeader('Content-Type', 'application/json');
      if (error) {
        // 用户点击取消也会报错
        res.end(JSON.stringify({ success: false, error: '用户取消选择或发生系统错误' }));
        return;
      }
      const selectedPath = stdout.trim();
      if (selectedPath) {
        res.end(JSON.stringify({ success: true, path: selectedPath }));
      } else {
        res.end(JSON.stringify({ success: false, error: '未选择路径' }));
      }
    });
    return true;
  }

  // 服务器信息
  if (url === '/admin/server-info' && method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ addresses: getServerAddresses(httpPort || 3000, httpsPort) }));
    return true;
  }

  return false;
}

// 辅助函数：处理 POST 请求
function handlePostRequest(req, res, handler) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const result = await handler(body);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
    } catch (e) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  return true;
}

module.exports = { handleAdminRoutes };
