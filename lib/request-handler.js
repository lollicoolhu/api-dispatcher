const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { rewriteSetCookie } = require('./utils');
const { addLog } = require('./logger');

// 创建持久化 Agent 以支持 TCP 复用 (Keep-Alive)
const httpAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 10000 });
const httpsAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 10000 });

// 辅助函数：路径归一化
function normalizePath(p) {
  if (!p) return '/';
  let np = p.split('?')[0].replace(/\/$/, '');
  if (!np.startsWith('/')) np = '/' + np;
  return np || '/';
}

// 处理主请求
function handleRequest(req, res, config) {
  const { tempOverrides, urlMappings, folderMappings, localFolders, globalServers, cookieRewrite } = config.getConfig();
  
  const urlPath = req.url.replace(/\/$/, '').split('?')[0];
  const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  const hasExt = /\.[a-zA-Z0-9]+$/.test(urlPath);
  const dataRoot = config.getDataRoot();
  const baseFolder = path.join(dataRoot, 'mock');
  const filePath = path.join(baseFolder, hasExt ? urlPath : urlPath + '.json');
  const fileExists = fs.existsSync(filePath);

  let reqBody = '';
  req.on('data', chunk => reqBody += chunk);
  req.on('end', () => {
    processRequest(req, res, urlPath, queryString, filePath, fileExists, reqBody, config);
  });
}

function processRequest(req, res, rawPath, queryString, filePath, fileExists, reqBody, config) {
  const { tempOverrides, urlMappings, folderMappings, localFolders, globalServers, cookieRewrite } = config.getConfig();
  const dataRoot = config.getDataRoot();
  const urlPath = normalizePath(rawPath);
  const hasExt = /\.[a-zA-Z0-9]+$/.test(urlPath);
  
  // 收集所有可用的响应源及其优先级
  const sources = [];
  
  // 1. 临时覆盖
  const overrideVersions = tempOverrides[urlPath];
  if (overrideVersions && Array.isArray(overrideVersions)) {
    // 解析请求中的 query 和 body 参数
    const urlObj = new URL(urlPath + (queryString || ''), 'http://localhost');
    const queryParams = {};
    urlObj.searchParams.forEach((v, k) => { queryParams[k] = v; });
    let bodyParams = {};
    if (reqBody) {
      try { bodyParams = JSON.parse(reqBody); } catch {}
    }

    // 匹配条件：conditions 是一个数组，每项 { source: 'query'|'body', key, op: 'eq'|'contains'|'exists'|'neq', value }
    function matchConditions(conditions, logic = 'and') {
      if (!conditions || conditions.length === 0) return true; // 无条件 = 默认兜底
      const evalCondition = c => {
        const val = c.source === 'body' ? (bodyParams[c.key]) : (queryParams[c.key]);
        if (c.op === 'exists') return val !== undefined && val !== null && val !== '';
        if (c.op === 'eq')       return String(val ?? '') === String(c.value ?? '');
        if (c.op === 'neq')      return String(val ?? '') !== String(c.value ?? '');
        if (c.op === 'contains') return String(val ?? '').includes(String(c.value ?? ''));
        return false;
      };
      return logic === 'or' ? conditions.some(evalCondition) : conditions.every(evalCondition);
    }

    const enabledVersions = overrideVersions.filter(v => v.enabled);
    // 优先选有条件且匹配的版本（按 priority 降序）
    const conditional = enabledVersions
      .filter(v => v.conditions && v.conditions.length > 0 && matchConditions(v.conditions, v.conditionLogic))
      .sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1));
    // 兜底：无条件版本（按 priority 降序）
    const fallback = enabledVersions
      .filter(v => !v.conditions || v.conditions.length === 0)
      .sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1));

    const selectedVersion = conditional[0] || fallback[0];
    if (selectedVersion) {
      sources.push({ type: 'override', priority: selectedVersion.priority ?? 1, data: selectedVersion });
    }
  }
  
  // 2. 精确URL映射
  const exactMapping = urlMappings[urlPath];
  if (exactMapping && exactMapping.enabled) {
    sources.push({ type: 'exactMapping', priority: exactMapping.priority ?? 1, data: exactMapping });
  }
  
  // 3. 本地文件夹
  for (const [folderPath, folderConfig] of Object.entries(localFolders)) {
    if (folderConfig.enabled) {
      const absFolderPath = path.isAbsolute(folderPath) ? folderPath : path.join(dataRoot, folderPath);
      const localFilePath = path.join(absFolderPath, hasExt ? urlPath : urlPath + '.json');
      // 即使文件不存在也参与竞选；若最终被选中，则按“文件不存在”处理（严格优先级）
      sources.push({
        type: 'localFolder',
        priority: folderConfig.priority ?? 0,
        data: folderConfig,
        filePath: localFilePath,
        fileExists: fs.existsSync(localFilePath),
        folderPath
      });
    }
  }
  
  // 如果没有配置本地文件夹，使用默认的baseFolder
  if (fileExists && Object.keys(localFolders).length === 0) {
    sources.push({ type: 'localFile', priority: 0, data: filePath });
  }
  
  // 4. 通配符URL映射
  for (const [pattern, mapping] of Object.entries(urlMappings)) {
    if (pattern.endsWith('*') && mapping.enabled) {
      const prefix = pattern.slice(0, -1);
      if (urlPath.startsWith(prefix)) {
        sources.push({ type: 'wildcardMapping', priority: mapping.priority ?? 1, data: mapping, pattern });
        break;
      }
    }
  }
  
  // 5. 文件夹映射
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
        const absMappingFolder = path.isAbsolute(mapping.folder) ? mapping.folder : path.join(dataRoot, mapping.folder);
        const mappedFilePath = path.join(absMappingFolder, hasExt ? urlPath : urlPath + '.json');
        // 即使文件不存在也参与竞选；若最终被选中，则按“文件不存在”处理（严格优先级）
        sources.push({
          type: 'folderMapping',
          priority: mapping.priority ?? 1,
          data: mapping,
          filePath: mappedFilePath,
          fileExists: fs.existsSync(mappedFilePath),
          pattern
        });
        break;
      }
    }
  }
  
  // 6. 全局服务器
  for (const [url, serverConfig] of Object.entries(globalServers)) {
    if (serverConfig.enabled && url) {
      sources.push({ type: 'globalServer', priority: serverConfig.priority ?? 100, data: { url, ...serverConfig } });
    }
  }
  
  // 按优先级排序
  const typeOrder = { override: 0, exactMapping: 1, localFolder: 2, localFile: 2, wildcardMapping: 3, folderMapping: 4, globalServer: 5 };
  sources.sort((a, b) => {
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    return (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99);
  });
  
  const selected = sources[0];
  
  // L1-L4 延迟优先级计算 (此时 selected 已确定)
  const appliedDelay = getEffectiveDelay();

  if (!selected) {
    // 无可用源，返回404
    addLog(req, false, null, reqBody, null, null, null, appliedDelay);
    const notFoundPath = path.join(__dirname, '../404.json');
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(notFoundPath)) {
      res.end(fs.readFileSync(notFoundPath, 'utf8'));
    } else {
      res.end(JSON.stringify({ error: 'Not Found', path: urlPath }));
    }
    return;
  }

  function getEffectiveDelay() {
    const { pathDelays, globalDelay } = config.getConfig();

    // L1: 命中的有条件临时修改 (Conditional Override)
    if (selected.type === 'override' && selected.data.conditions && selected.data.conditions.length > 0) {
      if (selected.data.delay > 0) return selected.data.delay;
    }

    // L2: 特定接口延迟 (Path Delay) - 顶层管控
    // 归一化路径匹配 (忽略末尾斜杠)
    const normalized = urlPath.replace(/\/$/, '') || '/';
    const alt = normalized.startsWith('/') ? normalized.substring(1) : '/' + normalized;
    const pd = pathDelays[normalized] || pathDelays[alt];
    
    if (pd && pd.enabled && pd.delay > 0) {
      return pd.delay;
    }

    // L3: 数据源级延迟 (Source-specific Delay)
    // 涵盖：无条件 Override、URL 映射、文件夹映射、全局服务器、本地文件夹等
    if (selected.data && selected.data.delay > 0) {
      return selected.data.delay;
    }

    // L4: 全局延迟 (兜底)
    return globalDelay || 0;
  }

  function delayThenSend(mappingResponse, sendFn) {
    const delayStart = Date.now();
    if (mappingResponse && mappingResponse.networkTime === undefined) {
      mappingResponse.networkTime = mappingResponse.time || 0;
    }
    if (appliedDelay > 0) {
      setTimeout(() => {
        if (mappingResponse) {
          mappingResponse.time = (mappingResponse.networkTime || 0) + (Date.now() - delayStart);
        }
        sendFn();
      }, appliedDelay);
    } else {
      sendFn();
    }
  }

  // 根据选中的源返回响应
  if (selected.type === 'override') {
    const mappingResponse = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: selected.data.content,
      time: 0,
      size: selected.data.content.length,
      sourceType: 'override'
    };
    delayThenSend(mappingResponse, () => {
      addLog(req, true, mappingResponse, reqBody, null, '临时修改', null, appliedDelay);
      res.setHeader('Content-Type', 'application/json');
      res.end(selected.data.content);
    });
    return;
  }
  
  if (selected.type === 'localFile' || selected.type === 'localFolder' || selected.type === 'folderMapping') {
    let folderName = path.basename(path.join(config.getDataRoot(), 'mock'));
    if (selected.type === 'localFolder') {
      folderName = selected.folderPath.split('/').pop();
    } else if (selected.type === 'folderMapping') {
      folderName = selected.data.folder.split('/').pop();
    }
    
    const actualFilePath = (selected.type === 'folderMapping' || selected.type === 'localFolder') ? selected.filePath : selected.data;
    const actualExists = selected.type === 'localFile' ? fs.existsSync(actualFilePath) : (selected.fileExists ?? fs.existsSync(actualFilePath));
    if (!actualExists) {
      addLog(req, false, null, reqBody, null, folderName, actualFilePath, appliedDelay);
      const notFoundPath = path.join(__dirname, '../404.json');
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      if (fs.existsSync(notFoundPath)) {
        res.end(fs.readFileSync(notFoundPath, 'utf8'));
      } else {
        res.end(JSON.stringify({ error: 'Not Found', path: urlPath }));
      }
      return;
    }

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
    const content = fs.readFileSync(actualFilePath, 'utf8');
    const mappingResponse = {
      status: 200,
      headers: { 'Content-Type': (mimeTypes[ext] || 'application/octet-stream') + '; charset=utf-8' },
      body: content,
      time: 0,
      size: Buffer.byteLength(content),
      sourceType: selected.type
    };
    delayThenSend(mappingResponse, () => {
      addLog(req, true, mappingResponse, reqBody, null, folderName, actualFilePath, appliedDelay);
      res.setHeader('Content-Type', (mimeTypes[ext] || 'application/octet-stream') + '; charset=utf-8');
      res.end(content);
    });
    return;
  }
  
  if (selected.type === 'exactMapping' || selected.type === 'wildcardMapping' || selected.type === 'globalServer') {
    handleProxyRequest(req, res, selected, urlPath, queryString, reqBody, cookieRewrite, appliedDelay);
    return;
  }
}

// 处理代理请求
function handleProxyRequest(req, res, selected, urlPath, queryString, reqBody, cookieRewrite, delay = 0) {
  const targetBase = (selected.data.target || selected.data.url).replace(/\/+$/, '');
  const targetUrl = targetBase + urlPath + queryString;
  const startTime = Date.now();
  const parsedUrl = new URL(targetUrl);
  const protocol = targetUrl.startsWith('https') ? https : http;
  
  // 复制请求头
  const proxyHeaders = {};
  const targetHost = parsedUrl.host;
  const targetOrigin = parsedUrl.protocol + '//' + parsedUrl.host;
  const skipHeaders = ['if-none-match', 'if-modified-since', 'connection', 'keep-alive', 'proxy-connection'];
  
  for (const [key, value] of Object.entries(req.headers)) {
    const lowerKey = key.toLowerCase();
    if (skipHeaders.includes(lowerKey)) continue;
    
    if (lowerKey === 'host') {
      proxyHeaders[key] = targetHost;
    } else if (lowerKey === 'origin') {
      proxyHeaders[key] = targetOrigin;
    } else if (lowerKey === 'referer') {
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
  
  if (!proxyHeaders['host'] && !proxyHeaders['Host']) {
    proxyHeaders['Host'] = targetHost;
  }
  
  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (targetUrl.startsWith('https') ? 443 : 80),
    path: parsedUrl.pathname + parsedUrl.search,
    method: req.method,
    headers: proxyHeaders,
    agent: targetUrl.startsWith('https') ? httpsAgent : httpAgent
  };
  
  const proxyReq = protocol.request(options, (proxyRes) => {
    const chunks = [];
    proxyRes.on('data', chunk => chunks.push(chunk));
    proxyRes.on('end', () => {
      let buffer = Buffer.concat(chunks);
      const encoding = proxyRes.headers['content-encoding'];
      const statusCode = proxyRes.statusCode;
      
      // 304 等无响应体的状态码直接处理
      if (statusCode === 304 || statusCode === 204 || statusCode === 205) {
        const headers = {};
        Object.keys(proxyRes.headers).forEach(k => headers[k] = proxyRes.headers[k]);
        const networkTime = Date.now() - startTime;
        const mappingResponse = {
          status: statusCode,
          url: targetUrl,
          time: networkTime, // 基础时间
          networkTime: networkTime,
          size: 0,
          headers,
          body: '',
          isBase64: false,
          sourceType: selected.type
        };
        
        const sendResponse = () => {
          mappingResponse.time = Date.now() - startTime; // 包含延时的总时间
          addLog(req, 'mapping', mappingResponse, reqBody, proxyHeaders, null, null, delay);
          
          Object.keys(proxyRes.headers).forEach(k => {
            if (k === 'transfer-encoding') return;
            if (k.toLowerCase() === 'set-cookie') {
              const rewritten = rewriteSetCookie(proxyRes.headers[k], req.headers.host, cookieRewrite);
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
        };

        if (delay > 0) {
          setTimeout(sendResponse, delay);
        } else {
          sendResponse();
        }
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
        const networkTime = Date.now() - startTime;
        const mappingResponse = {
          status: proxyRes.statusCode,
          url: targetUrl,
          time: networkTime,
          networkTime: networkTime,
          size: finalBuffer.length,
          headers,
          body: data,
          isBase64: contentType.includes('image/') || contentType.includes('application/octet-stream') ||
                    contentType.includes('application/pdf') || contentType.includes('application/zip'),
          sourceType: selected.type
        };
        
        const sendResponse = () => {
          mappingResponse.time = Date.now() - startTime;
          addLog(req, 'mapping', mappingResponse, reqBody, proxyHeaders, null, null, delay);
          
          Object.keys(proxyRes.headers).forEach(k => {
            if (k === 'transfer-encoding') return;
            if (k.toLowerCase() === 'set-cookie') {
              const rewritten = rewriteSetCookie(proxyRes.headers[k], req.headers.host, cookieRewrite);
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
        };

        if (delay > 0) {
          setTimeout(sendResponse, delay);
        } else {
          sendResponse();
        }
      });
    });
  });
  
  proxyReq.on('error', (e) => {
    addLog(req, 'mapping', { status: 0, url: targetUrl, time: 0, size: 0, headers: {}, body: 'Error: ' + e.message, sourceType: selected.type }, reqBody, proxyHeaders, null, null, delay);
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Mapping request failed: ' + e.message }));
  });
  
  // 发送请求体
  if (reqBody) {
    proxyReq.write(reqBody);
  }
  proxyReq.end();
}

module.exports = { handleRequest };
