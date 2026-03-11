const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');

const PORT = 3000;
let baseFolder = process.argv[2] || 'public/mock';
let accessLogs = [];
const MAX_LOGS = 1000;

const DATA_FILE = path.join(__dirname, 'public/.mock-server-data.json');
let tempOverrides = {};  // { path: { content, enabled, priority } }
let urlMappings = {};    // { path: { target, enabled, priority } }
let folderMappings = {}; // { pattern: { folder, enabled, priority } } 本地文件夹映射
let localFolders = {};   // { path: { enabled, priority, remark } } 本地文件夹列表
let globalServers = {};  // { url: { enabled, priority, remark } } 全局映射服务器列表
let cookieRewrite = true;  // 映射时重写 Set-Cookie，移除 Domain/Secure/SameSite

// 加载持久化数据
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      // 兼容旧格式
      const oldOverrides = data.tempOverrides || {};
      const oldMappings = data.urlMappings || data.proxyMappings || {};
      // 转换旧格式到新格式
      tempOverrides = {};
      for (const [k, v] of Object.entries(oldOverrides)) {
        if (typeof v === 'string') {
          tempOverrides[k] = { content: v, enabled: true, priority: 1 };
        } else {
          tempOverrides[k] = v;
        }
      }
      urlMappings = {};
      for (const [k, v] of Object.entries(oldMappings)) {
        if (typeof v === 'string') {
          urlMappings[k] = { target: v, enabled: true, priority: 1 };
        } else {
          urlMappings[k] = v;
        }
      }
      folderMappings = data.folderMappings || {};
      localFolders = data.localFolders || {};
      globalServers = data.globalServers || {};
      // 兼容旧的单个 globalServer 格式
      if (!data.globalServers && data.globalServer && data.globalServer.url) {
        globalServers[data.globalServer.url] = {
          enabled: data.globalServer.enabled !== false,
          priority: data.globalServer.priority ?? 100,
          remark: data.globalServer.remark || ''
        };
      }
      if (data.cookieRewrite !== undefined) cookieRewrite = data.cookieRewrite;
      console.log('Loaded ' + Object.keys(tempOverrides).length + ' overrides, ' + Object.keys(urlMappings).length + ' url mappings, ' + Object.keys(folderMappings).length + ' folder mappings, ' + Object.keys(localFolders).length + ' local folders, ' + Object.keys(globalServers).length + ' global servers');
    }
  } catch (e) { console.error('Failed to load data:', e.message); }
}

// 保存持久化数据
function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ tempOverrides, urlMappings, folderMappings, localFolders, globalServers, cookieRewrite }, null, 2));
  } catch (e) { console.error('Failed to save data:', e.message); }
}

loadData();

// 重写 Set-Cookie header，将 Domain 改为当前服务器
function rewriteSetCookie(cookies, reqHost) {
  if (!cookies || !cookieRewrite) return cookies;
  // 获取当前服务器的域名（不含端口）
  const currentDomain = (reqHost || 'localhost').split(':')[0];
  const rewrite = (cookie) => {
    let result = cookie;
    // 移除 Secure
    result = result.replace(/;\s*Secure/gi, '');
    // 替换或添加 Domain
    if (/;\s*Domain=/i.test(result)) {
      result = result.replace(/;\s*Domain=[^;]*/gi, '; Domain=' + currentDomain);
    } else {
      // 没有 Domain，在第一个分号后添加
      const idx = result.indexOf(';');
      if (idx > 0) {
        result = result.substring(0, idx) + '; Domain=' + currentDomain + result.substring(idx);
      } else {
        result = result + '; Domain=' + currentDomain;
      }
    }
    // 替换或添加 SameSite
    if (/;\s*SameSite=/i.test(result)) {
      result = result.replace(/;\s*SameSite=[^;]*/gi, '; SameSite=Lax');
    } else {
      result = result + '; SameSite=Lax';
    }
    // 替换或添加 Path
    if (!/;\s*Path=/i.test(result)) {
      result = result + '; Path=/';
    }
    return result;
  };
  if (Array.isArray(cookies)) {
    return cookies.map(rewrite);
  }
  return rewrite(cookies);
}

// 添加访问日志
function addLog(req, found, mappingResponse = null, reqBody = null, proxyReqHeaders = null, matchedFolder = null) {
  // 跳过来自管理页面的内部请求（通过referer判断）
  const referer = req.headers['referer'] || '';
  if (referer.includes('/admin')) return;
  
  const now = new Date();
  const time = now.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0');
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const urlPath = req.url.replace(/\/$/, '').split('?')[0];
  const urlObj = new URL(req.url, 'http://localhost');
  const query = {};
  urlObj.searchParams.forEach((v, k) => query[k] = v);
  
  // 解析 referer 获取父请求路径
  let parentPath = null;
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      parentPath = refererUrl.pathname;
    } catch {}
  }
  
  accessLogs.unshift({ 
    time, 
    path: urlPath, 
    ip, 
    found, 
    method: req.method, 
    fullUrl: req.url, 
    query, 
    headers: req.headers, 
    mappingResponse, 
    body: reqBody, 
    proxyReqHeaders,
    parentPath,  // 父请求路径（通过 referer 获取）
    matchedFolder  // 匹配到的文件夹名称
  });
  if (accessLogs.length > MAX_LOGS) accessLogs.pop();
}

// 递归获取所有JSON文件
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

// 获取服务器地址
function getServerAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = ['http://localhost:' + PORT];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push('http://' + iface.address + ':' + PORT);
      }
    }
  }
  return addresses;
}


// HTTP服务器
const server = http.createServer((req, res) => {
  // 静态文件服务
  if (req.url === '/admin' || req.url === '/admin/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8'));
    return;
  }
  if (req.url === '/admin.css') {
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.end(fs.readFileSync(path.join(__dirname, 'admin.css'), 'utf8'));
    return;
  }
  if (req.url === '/admin.js') {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.end(fs.readFileSync(path.join(__dirname, 'admin.js'), 'utf8'));
    return;
  }

  // API: 日志
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

  // API: 文件列表
  if (req.url.startsWith('/admin/files') && req.method === 'GET') {
    const urlObj = new URL(req.url, 'http://localhost');
    const folder = urlObj.searchParams.get('folder');
    if (!folder) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: '请指定文件夹' })); return; }
    if (!fs.existsSync(folder)) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: '文件夹不存在: ' + folder })); return; }
    const files = getAllFiles(folder);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ files }));
    return;
  }

  // API: 保存文件
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
      } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // API: 创建文件
  if (req.url === '/admin/file/create' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { path: apiPath, content } = JSON.parse(body);
        // 根据路径判断文件扩展名，如果已有扩展名则不添加 .json
        const hasExt = /\.[a-zA-Z0-9]+$/.test(apiPath);
        const filePath = path.join(baseFolder, hasExt ? apiPath : apiPath + '.json');
        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, content);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // API: 删除文件
  if (req.url === '/admin/file/delete' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { path: apiPath } = JSON.parse(body);
        // 根据路径判断文件扩展名
        const hasExt = /\.[a-zA-Z0-9]+$/.test(apiPath);
        const filePath = path.join(baseFolder, hasExt ? apiPath : apiPath + '.json');
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true }));
        } else {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: false, error: '文件不存在' }));
        }
      } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // API: 临时覆盖
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
        const { path: p, content, enabled, priority, remark } = JSON.parse(body);
        if (tempOverrides[p]) {
          // 更新现有
          if (content !== undefined) tempOverrides[p].content = content;
          if (enabled !== undefined) tempOverrides[p].enabled = enabled;
          if (priority !== undefined) tempOverrides[p].priority = priority;
          if (remark !== undefined) tempOverrides[p].remark = remark;
        } else {
          // 新建
          tempOverrides[p] = { content: content || '{}', enabled: enabled !== false, priority: priority ?? 1, remark: remark || '' };
        }
        saveData();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
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
        saveData();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // API: URL映射
  if (req.url === '/admin/mappings' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(urlMappings));
    return;
  }
  if (req.url === '/admin/mappings' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
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
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }
  if (req.url === '/admin/mappings' && req.method === 'DELETE') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { path: p } = JSON.parse(body);
        delete urlMappings[p];
        saveData();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // API: 文件夹映射
  if (req.url === '/admin/folder-mappings' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(folderMappings));
    return;
  }
  if (req.url === '/admin/folder-mappings' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
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
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }
  if (req.url === '/admin/folder-mappings' && req.method === 'DELETE') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { pattern } = JSON.parse(body);
        delete folderMappings[pattern];
        saveData();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // API: 本地文件夹
  if (req.url === '/admin/local-folders' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ folders: localFolders }));
    return;
  }
  if (req.url === '/admin/local-folders' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { path: folderPath, enabled, priority, remark } = JSON.parse(body);
        if (localFolders[folderPath]) {
          if (enabled !== undefined) localFolders[folderPath].enabled = enabled;
          if (priority !== undefined) localFolders[folderPath].priority = priority;
          if (remark !== undefined) localFolders[folderPath].remark = remark;
        } else {
          localFolders[folderPath] = { enabled: enabled !== false, priority: priority ?? 0, remark: remark || '' };
        }
        saveData();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }
  if (req.url === '/admin/local-folders' && req.method === 'DELETE') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { path: folderPath } = JSON.parse(body);
        delete localFolders[folderPath];
        saveData();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // API: 全局服务器
  if (req.url === '/admin/global-servers' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ servers: globalServers }));
    return;
  }
  if (req.url === '/admin/global-servers' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { url, enabled, priority, remark } = JSON.parse(body);
        if (globalServers[url]) {
          if (enabled !== undefined) globalServers[url].enabled = enabled;
          if (priority !== undefined) globalServers[url].priority = priority;
          if (remark !== undefined) globalServers[url].remark = remark;
        } else {
          globalServers[url] = { enabled: enabled !== false, priority: priority ?? 100, remark: remark || '' };
        }
        saveData();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }
  if (req.url === '/admin/global-servers' && req.method === 'DELETE') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { url } = JSON.parse(body);
        delete globalServers[url];
        saveData();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // API: Cookie重写开关
  if (req.url === '/admin/cookie-rewrite' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ enabled: cookieRewrite }));
    return;
  }
  if (req.url === '/admin/cookie-rewrite' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (data.enabled !== undefined) cookieRewrite = data.enabled;
        saveData();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }


  // API: 测试映射
  if (req.url === '/admin/test-mapping' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { path: apiPath, target } = JSON.parse(body);
        // 去掉目标地址末尾的斜杠，避免双斜杠
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
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              status: proxyRes.statusCode,
              url: targetUrl,
              time: Date.now() - startTime,
              size: data.length,
              headers,
              body: data
            }));
          });
        }).on('error', (e) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ status: 0, url: targetUrl, time: 0, size: 0, headers: {}, body: 'Error: ' + e.message }));
        });
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // API: HAR保存
  if (req.url === '/admin/har/save' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const files = JSON.parse(body);
        let count = 0;
        for (const [filePath, content] of Object.entries(files)) {
          const fullPath = path.join(__dirname, filePath);
          const dir = path.dirname(fullPath);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(fullPath, content);
          count++;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true, count }));
      } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // API: 文件夹
  if (req.url === '/admin/folder' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ folder: baseFolder }));
    return;
  }
  if (req.url === '/admin/folder' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { folder } = JSON.parse(body);
        if (!fs.existsSync(folder)) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: false, error: '文件夹不存在' }));
          return;
        }
        baseFolder = folder;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true, folder: baseFolder }));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // API: 获取 public 文件夹中的子文件夹列表
  if (req.url === '/admin/public-folders' && req.method === 'GET') {
    const publicPath = path.join(__dirname, 'public');
    const folders = [];
    try {
      if (fs.existsSync(publicPath)) {
        const items = fs.readdirSync(publicPath);
        for (const item of items) {
          const fullPath = path.join(publicPath, item);
          if (fs.statSync(fullPath).isDirectory()) {
            // 使用正斜杠确保跨平台兼容
            folders.push({ name: item, path: 'public/' + item });
          }
        }
      }
    } catch (e) {
      console.error('Failed to read public folders:', e.message);
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ folders }));
    return;
  }

  // API: 服务器信息
  if (req.url === '/admin/server-info' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ addresses: getServerAddresses() }));
    return;
  }

  // ========== 主请求处理 ==========
  const urlPath = req.url.replace(/\/$/, '').split('?')[0];
  const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  
  // 判断路径是否已有扩展名
  const hasExt = /\.[a-zA-Z0-9]+$/.test(urlPath);
  // 如果有扩展名，直接使用；否则添加 .json
  const filePath = path.join(baseFolder, hasExt ? urlPath : urlPath + '.json');
  const fileExists = fs.existsSync(filePath);

  // 解析请求体
  let reqBody = '';
  req.on('data', chunk => reqBody += chunk);
  req.on('end', () => {
    handleRequest(req, res, urlPath, queryString, filePath, fileExists, reqBody);
  });
});

function handleRequest(req, res, urlPath, queryString, filePath, fileExists, reqBody) {
  // 收集所有可用的响应源及其优先级
  const sources = [];
  
  // 1. 临时覆盖 (优先级由用户设置，默认1)
  const override = tempOverrides[urlPath];
  if (override && override.enabled) {
    sources.push({ type: 'override', priority: override.priority ?? 1, data: override });
  }
  
  // 2. 精确URL映射 (优先级由用户设置，默认1)
  const exactMapping = urlMappings[urlPath];
  if (exactMapping && exactMapping.enabled) {
    sources.push({ type: 'exactMapping', priority: exactMapping.priority ?? 1, data: exactMapping });
  }
  
  // 3. 本地文件夹 (优先级由用户设置，默认0)
  // 检查所有启用的本地文件夹
  for (const [folderPath, folderConfig] of Object.entries(localFolders)) {
    if (folderConfig.enabled) {
      const hasExt = /\.[a-zA-Z0-9]+$/.test(urlPath);
      const localFilePath = path.join(folderPath, hasExt ? urlPath : urlPath + '.json');
      if (fs.existsSync(localFilePath)) {
        sources.push({ type: 'localFolder', priority: folderConfig.priority ?? 0, data: folderConfig, filePath: localFilePath, folderPath });
      }
    }
  }
  // 如果没有配置本地文件夹，使用默认的baseFolder（优先级0）
  if (fileExists && Object.keys(localFolders).length === 0) {
    sources.push({ type: 'localFile', priority: 0, data: filePath });
  }
  
  // 4. 通配符URL映射 (优先级由用户设置，默认1)
  for (const [pattern, mapping] of Object.entries(urlMappings)) {
    if (pattern.endsWith('*') && mapping.enabled) {
      const prefix = pattern.slice(0, -1);
      if (urlPath.startsWith(prefix)) {
        sources.push({ type: 'wildcardMapping', priority: mapping.priority ?? 1, data: mapping, pattern });
        break;
      }
    }
  }
  
  // 5. 文件夹映射 (优先级由用户设置，默认1)
  for (const [pattern, mapping] of Object.entries(folderMappings)) {
    if (mapping.enabled && mapping.folder) {
      let matched = false;
      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        matched = urlPath.startsWith(prefix);
      } else {
        matched = urlPath === pattern || urlPath.startsWith(pattern + '/');
      }
      if (matched) {
        // 检查文件夹映射的文件是否存在
        const hasExt = /\.[a-zA-Z0-9]+$/.test(urlPath);
        const mappedFilePath = path.join(mapping.folder, hasExt ? urlPath : urlPath + '.json');
        if (fs.existsSync(mappedFilePath)) {
          sources.push({ type: 'folderMapping', priority: mapping.priority ?? 1, data: mapping, filePath: mappedFilePath, pattern });
        }
        break;
      }
    }
  }
  
  // 6. 全局服务器 (优先级由用户设置，默认100)
  for (const [url, serverConfig] of Object.entries(globalServers)) {
    if (serverConfig.enabled && url) {
      sources.push({ type: 'globalServer', priority: serverConfig.priority ?? 100, data: { url, ...serverConfig } });
    }
  }
  
  // 按优先级排序（数字越大优先级越高）
  // 当优先级相同时，按类型顺序：override > exactMapping > localFolder > wildcardMapping > folderMapping > globalServer
  const typeOrder = { override: 0, exactMapping: 1, localFolder: 2, localFile: 2, wildcardMapping: 3, folderMapping: 4, globalServer: 5 };
  sources.sort((a, b) => {
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    return (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99);
  });
  
  // 选择优先级最高的源
  const selected = sources[0];
  
  if (!selected) {
    // 无可用源，返回404
    addLog(req, false, null, reqBody);
    const notFoundPath = path.join(__dirname, '404.json');
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(notFoundPath)) {
      res.end(fs.readFileSync(notFoundPath, 'utf8'));
    } else {
      res.end(JSON.stringify({ error: 'Not Found', path: urlPath }));
    }
    return;
  }
  
  // 根据选中的源返回响应
  if (selected.type === 'override') {
    addLog(req, true, null, reqBody, null, '临时修改');
    res.setHeader('Content-Type', 'application/json');
    res.end(selected.data.content);
    return;
  }
  
  if (selected.type === 'localFile' || selected.type === 'localFolder' || selected.type === 'folderMapping') {
    // 获取文件夹名称
    let folderName = baseFolder.split('/').pop();
    if (selected.type === 'localFolder') {
      folderName = selected.folderPath.split('/').pop();
    } else if (selected.type === 'folderMapping') {
      folderName = selected.data.folder.split('/').pop();
    }
    addLog(req, true, null, reqBody, null, folderName);
    // 根据扩展名设置 Content-Type
    const actualFilePath = (selected.type === 'folderMapping' || selected.type === 'localFolder') ? selected.filePath : selected.data;
    const ext = actualFilePath.split('.').pop().toLowerCase();
    const mimeTypes = {
      'json': 'application/json',
      'html': 'text/html',
      'htm': 'text/html',
      'js': 'application/javascript',
      'css': 'text/css',
      'xml': 'application/xml',
      'svg': 'image/svg+xml',
      'txt': 'text/plain'
    };
    res.setHeader('Content-Type', (mimeTypes[ext] || 'application/octet-stream') + '; charset=utf-8');
    res.end(fs.readFileSync(actualFilePath, 'utf8'));
    return;
  }
  
  if (selected.type === 'exactMapping' || selected.type === 'wildcardMapping' || selected.type === 'globalServer') {
    const targetBase = (selected.data.target || selected.data.url).replace(/\/+$/, '');
    const targetUrl = targetBase + urlPath + queryString;
    const startTime = Date.now();
    const parsedUrl = new URL(targetUrl);
    const protocol = targetUrl.startsWith('https') ? https : http;
    
    // 复制请求头，替换 host、origin、referer 等
    const proxyHeaders = {};
    const targetHost = parsedUrl.host;
    const targetOrigin = parsedUrl.protocol + '//' + parsedUrl.host;
    
    // 需要跳过的缓存相关头（避免 304）
    const skipHeaders = ['if-none-match', 'if-modified-since'];
    
    for (const [key, value] of Object.entries(req.headers)) {
      const lowerKey = key.toLowerCase();
      
      // 跳过缓存头
      if (skipHeaders.includes(lowerKey)) continue;
      
      if (lowerKey === 'host') {
        proxyHeaders[key] = targetHost;
      } else if (lowerKey === 'origin') {
        proxyHeaders[key] = targetOrigin;
      } else if (lowerKey === 'referer') {
        // 替换 referer 中的 host
        try {
          const refererUrl = new URL(value);
          refererUrl.host = targetHost;
          refererUrl.protocol = parsedUrl.protocol;
          proxyHeaders[key] = refererUrl.toString();
        } catch {
          proxyHeaders[key] = value;
        }
      } else {
        proxyHeaders[key] = value;
      }
    }
    
    // 确保 Host 头存在
    if (!proxyHeaders['host'] && !proxyHeaders['Host']) {
      proxyHeaders['Host'] = targetHost;
    }
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (targetUrl.startsWith('https') ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: req.method,
      headers: proxyHeaders
    };
    
    const proxyReq = protocol.request(options, (proxyRes) => {
      const chunks = [];
      proxyRes.on('data', chunk => chunks.push(chunk));
      proxyRes.on('end', () => {
        let buffer = Buffer.concat(chunks);
        const encoding = proxyRes.headers['content-encoding'];
        const statusCode = proxyRes.statusCode;
        
        // 304 等无响应体的状态码直接处理
        if (statusCode === 304 || statusCode === 204 || statusCode === 301 || statusCode === 302) {
          const headers = {};
          Object.keys(proxyRes.headers).forEach(k => headers[k] = proxyRes.headers[k]);
          const mappingResponse = {
            status: statusCode,
            url: targetUrl,
            time: Date.now() - startTime,
            size: 0,
            headers,
            body: '',
            isBase64: false,
            sourceType: selected.type
          };
          addLog(req, 'mapping', mappingResponse, reqBody, proxyHeaders);
          
          Object.keys(proxyRes.headers).forEach(k => {
            if (k === 'transfer-encoding') return;
            if (k.toLowerCase() === 'set-cookie') {
              const rewritten = rewriteSetCookie(proxyRes.headers[k], req.headers.host);
              if (Array.isArray(rewritten)) {
                rewritten.forEach(c => res.appendHeader ? res.appendHeader(k, c) : res.setHeader(k, rewritten));
              } else {
                res.setHeader(k, rewritten);
              }
            } else {
              res.setHeader(k, proxyRes.headers[k]);
            }
          });
          res.statusCode = statusCode;
          res.end();
          return;
        }
        
        // 解压缩
        const decompress = (buf, callback) => {
          if (encoding === 'gzip') {
            zlib.gunzip(buf, callback);
          } else if (encoding === 'deflate') {
            zlib.inflate(buf, callback);
          } else if (encoding === 'br') {
            zlib.brotliDecompress(buf, callback);
          } else {
            callback(null, buf);
          }
        };
        
        decompress(buffer, (err, decompressed) => {
          const finalBuffer = err ? buffer : decompressed;
          const contentType = proxyRes.headers['content-type'] || '';
          let data;
          
          // 图片等二进制类型转为 base64
          if (contentType.includes('image/') || contentType.includes('application/octet-stream') || 
              contentType.includes('application/pdf') || contentType.includes('application/zip')) {
            data = finalBuffer.toString('base64');
          } else {
            data = finalBuffer.toString('utf8');
          }
          
          const headers = {};
          Object.keys(proxyRes.headers).forEach(k => headers[k] = proxyRes.headers[k]);
          const mappingResponse = {
            status: proxyRes.statusCode,
            url: targetUrl,
            time: Date.now() - startTime,
            size: finalBuffer.length,
            headers,
            body: data,
            isBase64: contentType.includes('image/') || contentType.includes('application/octet-stream') || 
                      contentType.includes('application/pdf') || contentType.includes('application/zip'),
            sourceType: selected.type
          };
          addLog(req, 'mapping', mappingResponse, reqBody, proxyHeaders);
          
          // 返回原始压缩数据给客户端
          Object.keys(proxyRes.headers).forEach(k => {
            if (k === 'transfer-encoding') return;
            if (k.toLowerCase() === 'set-cookie') {
              const rewritten = rewriteSetCookie(proxyRes.headers[k], req.headers.host);
              if (Array.isArray(rewritten)) {
                rewritten.forEach(c => res.appendHeader ? res.appendHeader(k, c) : res.setHeader(k, rewritten));
              } else {
                res.setHeader(k, rewritten);
              }
            } else {
              res.setHeader(k, proxyRes.headers[k]);
            }
          });
          res.statusCode = proxyRes.statusCode;
          res.end(buffer);
        });
      });
    });
    
    proxyReq.on('error', (e) => {
      addLog(req, 'mapping', { status: 0, url: targetUrl, time: 0, size: 0, headers: {}, body: 'Error: ' + e.message, sourceType: selected.type }, reqBody, proxyHeaders);
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Mapping request failed: ' + e.message }));
    });
    
    // 发送请求体
    if (reqBody) {
      proxyReq.write(reqBody);
    }
    proxyReq.end();
    return;
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('Mock server running at http://0.0.0.0:' + PORT);
  console.log('Admin panel: http://localhost:' + PORT + '/admin');
  
  // 显示启用的本地文件夹
  const enabledFolders = Object.entries(localFolders).filter(([_, config]) => config.enabled).map(([path]) => path);
  if (enabledFolders.length > 0) {
    console.log('Local folders (' + enabledFolders.length + '): ' + enabledFolders.join(', '));
  }
  
  // 显示启用的全局服务器
  const enabledServers = Object.entries(globalServers).filter(([_, config]) => config.enabled).map(([url]) => url);
  if (enabledServers.length > 0) {
    console.log('Global servers (' + enabledServers.length + '): ' + enabledServers.join(', '));
  }
});
