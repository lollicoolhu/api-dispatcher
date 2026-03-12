const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { rewriteSetCookie } = require('./utils');
const { addLog } = require('./logger');

// 处理主请求
function handleRequest(req, res, config) {
  const { tempOverrides, urlMappings, folderMappings, localFolders, globalServers, cookieRewrite } = config.getConfig();
  
  const urlPath = req.url.replace(/\/$/, '').split('?')[0];
  const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  const hasExt = /\.[a-zA-Z0-9]+$/.test(urlPath);
  const baseFolder = 'public/mock';
  const filePath = path.join(baseFolder, hasExt ? urlPath : urlPath + '.json');
  const fileExists = fs.existsSync(filePath);

  let reqBody = '';
  req.on('data', chunk => reqBody += chunk);
  req.on('end', () => {
    processRequest(req, res, urlPath, queryString, filePath, fileExists, reqBody, config);
  });
}

function processRequest(req, res, urlPath, queryString, filePath, fileExists, reqBody, config) {
  const { tempOverrides, urlMappings, folderMappings, localFolders, globalServers, cookieRewrite } = config.getConfig();
  
  // 收集所有可用的响应源及其优先级
  const sources = [];
  
  // 1. 临时覆盖
  const overrideVersions = tempOverrides[urlPath];
  if (overrideVersions && Array.isArray(overrideVersions)) {
    const enabledVersion = overrideVersions.find(v => v.enabled);
    if (enabledVersion) {
      sources.push({ type: 'override', priority: enabledVersion.priority ?? 1, data: enabledVersion });
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
      const hasExt = /\.[a-zA-Z0-9]+$/.test(urlPath);
      const localFilePath = path.join(folderPath, hasExt ? urlPath : urlPath + '.json');
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
        const hasExt = /\.[a-zA-Z0-9]+$/.test(urlPath);
        const mappedFilePath = path.join(mapping.folder, hasExt ? urlPath : urlPath + '.json');
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
  
  if (!selected) {
    // 无可用源，返回404
    addLog(req, false, null, reqBody);
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
  
  // 根据选中的源返回响应
  if (selected.type === 'override') {
    addLog(req, true, null, reqBody, null, '临时修改');
    res.setHeader('Content-Type', 'application/json');
    res.end(selected.data.content);
    return;
  }
  
  if (selected.type === 'localFile' || selected.type === 'localFolder' || selected.type === 'folderMapping') {
    let folderName = 'public/mock'.split('/').pop();
    if (selected.type === 'localFolder') {
      folderName = selected.folderPath.split('/').pop();
    } else if (selected.type === 'folderMapping') {
      folderName = selected.data.folder.split('/').pop();
    }
    
    const actualFilePath = (selected.type === 'folderMapping' || selected.type === 'localFolder') ? selected.filePath : selected.data;
    const actualExists = selected.type === 'localFile' ? fs.existsSync(actualFilePath) : (selected.fileExists ?? fs.existsSync(actualFilePath));
    if (!actualExists) {
      // 选中了更高优先级的文件源，但文件不存在：按“文件不存在”处理，不降级到低优先级源
      addLog(req, false, null, reqBody, null, folderName);
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

    addLog(req, true, null, reqBody, null, folderName);
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
    handleProxyRequest(req, res, selected, urlPath, queryString, reqBody, cookieRewrite);
    return;
  }
}

// 处理代理请求
function handleProxyRequest(req, res, selected, urlPath, queryString, reqBody, cookieRewrite) {
  const targetBase = (selected.data.target || selected.data.url).replace(/\/+$/, '');
  const targetUrl = targetBase + urlPath + queryString;
  const startTime = Date.now();
  const parsedUrl = new URL(targetUrl);
  const protocol = targetUrl.startsWith('https') ? https : http;
  
  // 复制请求头
  const proxyHeaders = {};
  const targetHost = parsedUrl.host;
  const targetOrigin = parsedUrl.protocol + '//' + parsedUrl.host;
  const skipHeaders = ['if-none-match', 'if-modified-since'];
  
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
      if (statusCode === 304 || statusCode === 204 || statusCode === 205) {
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
}

module.exports = { handleRequest };
