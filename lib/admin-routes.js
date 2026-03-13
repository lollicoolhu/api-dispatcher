const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { getAllFiles, getServerAddresses } = require('./utils');
const { getLogs, clearLogs } = require('./logger');

// 处理管理路由
function handleAdminRoutes(req, res, config, saveData, httpPort, httpsPort) {
  const { tempOverrides, urlMappings, folderMappings, localFolders, globalServers, cookieRewrite } = config.getConfig();
  
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
  const url = req.url;
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

  // 文件列表
  if (url.startsWith('/admin/files') && method === 'GET') {
    const urlObj = new URL(url, 'http://localhost');
    const folder = urlObj.searchParams.get('folder');
    if (!folder) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: '请指定文件夹' }));
      return true;
    }
    if (!fs.existsSync(folder)) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: '文件夹不存在: ' + folder }));
      return true;
    }
    const files = getAllFiles(folder);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ files }));
    return true;
  }

  // 保存文件
  if (url === '/admin/file/save' && method === 'POST') {
    return handlePostRequest(req, res, (body) => {
      const { folder, path: apiPath, content } = JSON.parse(body);
      const filePath = path.join(folder, apiPath + '.json');
      fs.writeFileSync(filePath, content);
      return { success: true };
    });
  }

  // 创建文件
  if (url === '/admin/file/create' && method === 'POST') {
    return handlePostRequest(req, res, (body) => {
      const { path: apiPath, content, folder } = JSON.parse(body);
      const hasExt = /\.[a-zA-Z0-9]+$/.test(apiPath);
      const targetFolder = folder || 'public/mock';
      const filePath = path.join(process.cwd(), targetFolder, hasExt ? apiPath : apiPath + '.json');
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
      const filePath = path.join(process.cwd(), 'public/mock', hasExt ? apiPath : apiPath + '.json');
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return { success: true };
      }
      return { success: false, error: '文件不存在' };
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
      const { path: p, content, enabled, priority, remark, versionId } = JSON.parse(body);
      
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
            // 如果启用此版本，禁用其他版本
            if (enabled) {
              tempOverrides[p].forEach(v => v.enabled = false);
            }
            version.enabled = enabled;
          }
          if (priority !== undefined) version.priority = priority;
          if (remark !== undefined) version.remark = remark;
        }
      } else {
        // 创建新版本
        const newVersion = {
          id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
          content: content || '{}',
          enabled: enabled !== false,
          priority: priority ?? 1,
          remark: remark || '',
          createdAt: new Date().toISOString()
        };
        
        // 如果新版本启用，禁用其他版本
        if (newVersion.enabled) {
          tempOverrides[p].forEach(v => v.enabled = false);
        }
        
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
      const { path: p, target, enabled, priority, remark } = JSON.parse(body);
      if (urlMappings[p]) {
        if (target !== undefined) urlMappings[p].target = target;
        if (enabled !== undefined) urlMappings[p].enabled = enabled;
        if (priority !== undefined) urlMappings[p].priority = priority;
        if (remark !== undefined) urlMappings[p].remark = remark;
      } else {
        urlMappings[p] = { target: target || '', enabled: enabled !== false, priority: priority ?? 1, remark: remark || '' };
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
      const { pattern, folder, enabled, priority, remark } = JSON.parse(body);
      if (folderMappings[pattern]) {
        if (folder !== undefined) folderMappings[pattern].folder = folder;
        if (enabled !== undefined) folderMappings[pattern].enabled = enabled;
        if (priority !== undefined) folderMappings[pattern].priority = priority;
        if (remark !== undefined) folderMappings[pattern].remark = remark;
      } else {
        folderMappings[pattern] = { folder: folder || '', enabled: enabled !== false, priority: priority ?? 1, remark: remark || '' };
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
      const { path: folderPath, enabled, priority, remark } = JSON.parse(body);
      if (localFolders[folderPath]) {
        if (enabled !== undefined) localFolders[folderPath].enabled = enabled;
        if (priority !== undefined) localFolders[folderPath].priority = priority;
        if (remark !== undefined) localFolders[folderPath].remark = remark;
      } else {
        localFolders[folderPath] = { enabled: enabled !== false, priority: priority ?? 0, remark: remark || '' };
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
      const { url, enabled, priority, remark } = JSON.parse(body);
      if (globalServers[url]) {
        if (enabled !== undefined) globalServers[url].enabled = enabled;
        if (priority !== undefined) globalServers[url].priority = priority;
        if (remark !== undefined) globalServers[url].remark = remark;
      } else {
        globalServers[url] = { enabled: enabled !== false, priority: priority ?? 100, remark: remark || '' };
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
      const folderPath = path.join(process.cwd(), 'public', name);
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
      for (const [filePath, content] of Object.entries(files)) {
        const fullPath = path.join(process.cwd(), filePath);
        const dir = path.dirname(fullPath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fullPath, content);
        count++;
      }
      return { success: true, count };
    });
  }

  // 获取 public 文件夹列表
  if (url === '/admin/public-folders' && method === 'GET') {
    const publicPath = path.join(process.cwd(), 'public');
    const folders = [];
    try {
      if (fs.existsSync(publicPath)) {
        const items = fs.readdirSync(publicPath);
        for (const item of items) {
          const fullPath = path.join(publicPath, item);
          if (fs.statSync(fullPath).isDirectory()) {
            folders.push({ name: item, path: 'public/' + item });
          }
        }
      }
    } catch (e) {
      console.error('Failed to read public folders:', e.message);
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ folders }));
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
