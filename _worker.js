/**
 * Cloudflare Worker 反向代理服务 - 优化版
 * 功能：将 aaa--bb--com.yourdomain.com 的请求代理到 aaa.bb.com
 * 当访问 proxy.yourdomain.com 时显示前端页面
 * 优化：完全隐藏源IP，智能URL处理
 */

// 配置常量
const CONFIG = {
  REQUEST_TIMEOUT: 45000, // 30秒超时
  MAX_REDIRECTS: 45,
  CORS_MAX_AGE: '86400',
  ALLOWED_METHODS: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
  
  // 扩展的敏感头部列表 - 防止IP泄露
  BLOCKED_HEADERS: [
    // Cloudflare 特定头部
    'cf-connecting-ip',
    'cf-ipcountry', 
    'cf-ray',
    'cf-visitor',
    'cf-request-id',
    'cf-warp-tag-id',
    'cf-worker',
    
    // 代理和转发头部
    'x-forwarded-proto',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-port',
    'x-real-ip',
    'x-original-forwarded-for',
    'x-cluster-client-ip',
    'x-forwarded',
    'forwarded-for',
    'forwarded',
    
    // 其他可能暴露信息的头部
    'via',
    'x-proxy-authorization',
    'proxy-authorization',
    'proxy-connection',
    'true-client-ip',
    'x-client-ip',
    'client-ip',
    'x-originating-ip',
    'x-remote-ip',
    'x-remote-addr',
    'remote-addr'
  ],
  
  // 需要重写的头部
  REWRITE_HEADERS: [
    'origin',
    'referer',
    'host'
  ]
};

// 主事件监听器
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

/**
 * 处理请求的主函数
 * @param {Request} request - 原始请求对象
 * @returns {Promise<Response>} - 处理后的响应
 */
async function handleRequest(request) {
  try {
    // 解析请求URL
    const url = new URL(request.url);
    const hostname = url.hostname;
    const hostParts = hostname.split('.');
    
    // 检查是否为前端页面入口
    if (hostParts[0] === 'proxy' || hostParts[0] === 'proxy--') {
      return handleProxyPage(request);
    }
    
    const subdomain = extractSubdomain(hostname);
    
    // 验证子域名
    if (!subdomain) {
      return createErrorResponse('Invalid subdomain format', 400);
    }
    
    // 验证请求方法
    if (!CONFIG.ALLOWED_METHODS.includes(request.method)) {
      return createErrorResponse('Method not allowed', 405);
    }
    
    // 处理 OPTIONS 预检请求
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }
    
    // 构建目标URL
    const targetUrl = buildTargetUrl(subdomain, url);
    
    // 执行代理请求
    return await proxyRequest(request, targetUrl);
    
  } catch (error) {
    console.error('Request handling error:', error);
    return createErrorResponse(error.message, 500);
  }
}

/**
 * 处理前端页面请求
 * @param {Request} request - 原始请求对象
 * @returns {Promise<Response>} - 前端页面响应
 */
function handleProxyPage(request) {
  const url = new URL(request.url);
  
  // 处理API请求
  if (url.pathname === '/api/generate') {
    return handleGenerateApi(request);
  }
  
  // 返回前端页面
  // @ts-ignore
  return new Response(getProxyPageHTML(url.hostname), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      // 添加安全头部
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block'
    }
  });
}

/**
 * 处理生成代理链接的API请求 - 优化URL处理
 * @param {Request} request - 原始请求对象
 * @returns {Promise<Response>} - API响应
 */
async function handleGenerateApi(request) {
  if (request.method !== 'POST') {
    return createErrorResponse('Method not allowed', 405);
  }
  
  try {
    const body = await request.json();
    let targetUrl = body.url;
    
    if (!targetUrl) {
      return createErrorResponse('URL is required', 400);
    }
    
    // 智能URL处理 - 自动添加协议
    targetUrl = normalizeUrl(targetUrl);
    
    // 验证URL格式
    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (e) {
      return createErrorResponse('Invalid URL format', 400);
    }
    
    // 只支持HTTP和HTTPS
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return createErrorResponse('Only HTTP and HTTPS URLs are supported', 400);
    }
    
    // 安全检查 - 防止访问内网地址
    if (!isPublicUrl(parsedUrl)) {
      return createErrorResponse('Private network URLs are not allowed', 403);
    }
    
    // 转换域名为代理格式
    const proxySubdomain = convertUrlToSubdomain(parsedUrl.hostname);
    const originalUrl = new URL(request.url);
    const proxyDomain = originalUrl.hostname.split('.').slice(1).join('.');
    
    const proxyUrl = `https://${proxySubdomain}.${proxyDomain}${parsedUrl.pathname}${parsedUrl.search}`;
    
    return new Response(JSON.stringify({
      success: true,
      originalUrl: targetUrl,
      proxyUrl: proxyUrl
    }), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error) {
    return createErrorResponse('Invalid request body', 400);
  }
}

/**
 * 智能URL标准化处理
 * @param {string} url - 用户输入的URL
 * @returns {string} - 标准化后的URL
 */
function normalizeUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('Invalid URL');
  }
  
  // 去除首尾空白
  url = url.trim();
  
  // 如果已经有协议，直接返回
  if (url.match(/^https?:\/\//i)) {
    return url;
  }
  
  // 如果以 // 开头，添加 https:
  if (url.startsWith('//')) {
    return 'https:' + url;
  }
  
  // 如果没有协议，默认添加 https://
  return 'https://' + url;
}

/**
 * 检查URL是否为公网地址（安全检查）
 * @param {URL} url - URL对象
 * @returns {boolean} - 是否为公网地址
 */
function isPublicUrl(url) {
  const hostname = url.hostname.toLowerCase();
  
  // 检查是否为IP地址
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Regex.test(hostname)) {
    const parts = hostname.split('.').map(Number);
    
    // 检查私有IP段
    if (
      (parts[0] === 10) || // 10.0.0.0/8
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || // 172.16.0.0/12
      (parts[0] === 192 && parts[1] === 168) || // 192.168.0.0/16
      (parts[0] === 127) || // 127.0.0.0/8 (localhost)
      (parts[0] === 169 && parts[1] === 254) // 169.254.0.0/16 (link-local)
    ) {
      return false;
    }
  }
  
  // 检查本地域名
  const localDomains = ['localhost', '127.0.0.1', '::1'];
  if (localDomains.includes(hostname)) {
    return false;
  }
  
  return true;
}

/**
 * 执行代理请求 - 优化IP隐藏
 * @param {Request} originalRequest - 原始请求
 * @param {URL} targetUrl - 目标URL
 * @returns {Promise<Response>} - 代理响应
 */
async function proxyRequest(originalRequest, targetUrl) {
  // 准备请求选项
  const requestOptions = {
    method: originalRequest.method,
    headers: cleanRequestHeaders(originalRequest.headers, targetUrl),
    redirect: 'manual',
    signal: AbortSignal.timeout(CONFIG.REQUEST_TIMEOUT)
  };
  
  // 处理请求体
  if (!['GET', 'HEAD'].includes(originalRequest.method)) {
    requestOptions.body = originalRequest.body;
  }
  
  try {
    const response = await fetch(targetUrl.toString(), requestOptions);
    
    // 处理重定向
    if (response.status >= 300 && response.status < 400) {
      return handleRedirect(response, originalRequest);
    }
    
    return createProxyResponse(response);
    
  } catch (error) {
    if (error.name === 'TimeoutError') {
      return createErrorResponse('Request timeout', 504);
    }
    throw error;
  }
}

/**
 * 清理请求头 - 完全隐藏源IP
 * @param {Headers} originalHeaders - 原始请求头
 * @param {URL} targetUrl - 目标URL
 * @returns {Headers} - 清理后的请求头
 */
function cleanRequestHeaders(originalHeaders, targetUrl) {
  const cleanedHeaders = new Headers();
  
  // 复制允许的请求头
  for (const [key, value] of originalHeaders.entries()) {
    const lowerKey = key.toLowerCase();
    if (!CONFIG.BLOCKED_HEADERS.includes(lowerKey)) {
      cleanedHeaders.set(key, value);
    }
  }
  
  // 设置正确的目标服务器信息
  cleanedHeaders.set('Host', targetUrl.hostname);
  
  // 重写Origin头部
  if (originalHeaders.has('Origin')) {
    cleanedHeaders.set('Origin', targetUrl.origin);
  }
  
  // 重写Referer头部
  if (originalHeaders.has('Referer')) {
    const referer = originalHeaders.get('Referer');
    try {
      const refererUrl = new URL(referer);
      refererUrl.hostname = targetUrl.hostname;
      refererUrl.protocol = targetUrl.protocol;
      cleanedHeaders.set('Referer', refererUrl.toString());
    } catch (e) {
      cleanedHeaders.delete('Referer');
    }
  }
  
  // 添加一些标准头部以模拟正常请求
  if (!cleanedHeaders.has('User-Agent')) {
    cleanedHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  }
  
  // 设置Accept头部
  if (!cleanedHeaders.has('Accept')) {
    cleanedHeaders.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8');
  }
  
  // 设置Accept-Language
  if (!cleanedHeaders.has('Accept-Language')) {
    cleanedHeaders.set('Accept-Language', 'en-US,en;q=0.5');
  }
  
  // 设置Accept-Encoding
  if (!cleanedHeaders.has('Accept-Encoding')) {
    cleanedHeaders.set('Accept-Encoding', 'gzip, deflate, br');
  }
  
  return cleanedHeaders;
}

/**
 * 提取并验证子域名
 * @param {string} hostname - 主机名
 * @returns {string|null} - 子域名或null
 */
function extractSubdomain(hostname) {
  const parts = hostname.split('.');
  if (parts.length < 2) return null;
  
  const subdomain = parts[0];
  
  // 验证子域名格式（允许字母数字和连字符）
  if (!/^[a-zA-Z0-9-]+$/.test(subdomain)) {
    return null;
  }
  
  // 验证连字符格式的子域名
  if (!isValidSubdomainFormat(subdomain)) {
    return null;
  }
  
  return subdomain;
}

/**
 * 验证子域名格式是否符合要求
 * @param {string} subdomain - 子域名
 * @returns {boolean} - 是否有效
 */
function isValidSubdomainFormat(subdomain) {
  // 不能以连字符开头或结尾
  if (subdomain.startsWith('-') || subdomain.endsWith('-')) {
    return false;
  }
  
  // 分割后至少要有2个部分
  const parts = subdomain.split('--');
  if (parts.length < 2) {
    return false;
  }
  
  // 每个部分都必须有效
  return parts.every(part => {
    return part.length > 0 && /^[a-zA-Z0-9-]+$/.test(part) && 
           !part.startsWith('-') && !part.endsWith('-');
  });
}

/**
 * 构建目标URL
 * @param {string} subdomain - 子域名（格式：aaa--bb--com）
 * @param {URL} originalUrl - 原始URL对象
 * @returns {URL} - 目标URL对象
 */
function buildTargetUrl(subdomain, originalUrl) {
  const targetDomain = convertSubdomainToUrl(subdomain);
  
  if (!targetDomain) {
    throw new Error('Invalid subdomain format');
  }
  
  const targetUrl = new URL(`https://${targetDomain}`);
  targetUrl.pathname = originalUrl.pathname;
  targetUrl.search = originalUrl.search;
  
  return targetUrl;
}

/**
 * 将连字符格式的子域名转换为标准URL格式
 * @param {string} subdomain - 连字符格式的子域名（如：aaa--bb--com）
 * @returns {string|null} - 转换后的域名（如：aaa.bb.com）或null
 */
function convertSubdomainToUrl(subdomain) {
  if (!subdomain || typeof subdomain !== 'string') {
    return null;
  }
  
  subdomain = subdomain.trim();
  
  if (!/^[a-zA-Z0-9-]+$/.test(subdomain)) {
    return null;
  }
  
  const parts = subdomain.split('--');
  
  if (parts.length < 2) {
    return null;
  }
  
  if (parts.some(part => !part || part.length === 0)) {
    return null;
  }
  
  return parts.join('.');
}

/**
 * 将标准URL格式转换回连字符格式
 * @param {string} hostname - 标准域名（如：aaa.bb.com）
 * @returns {string|null} - 连字符格式（如：aaa--bb--com）或null
 */
function convertUrlToSubdomain(hostname) {
  if (!hostname || typeof hostname !== 'string') {
    return null;
  }
  
  if (!/^[a-zA-Z0-9.-]+$/.test(hostname)) {
    return null;
  }
  
  return hostname.replace(/\./g, '--');
}

/**
 * 创建代理响应 - 移除可能暴露信息的头部
 * @param {Response} originalResponse - 原始响应
 * @returns {Response} - 处理后的响应
 */
function createProxyResponse(originalResponse) {
  const response = new Response(originalResponse.body, {
    status: originalResponse.status,
    statusText: originalResponse.statusText,
    headers: originalResponse.headers
  });
  
  // 添加CORS头
  addCorsHeaders(response.headers);
  
  // 移除可能暴露服务器信息的头部
  const headersToRemove = [
    'server',
    'x-powered-by',
    'x-aspnet-version',
    'x-runtime',
    'x-version',
    'content-security-policy',
    'x-frame-options',
    'x-content-type-options'
  ];
  
  headersToRemove.forEach(header => {
    response.headers.delete(header);
  });
  
  return response;
}

/**
 * 处理重定向
 * @param {Response} response - 重定向响应
 * @param {Request} originalRequest - 原始请求
 * @returns {Response} - 处理后的响应
 */
function handleRedirect(response, originalRequest) {
  const location = response.headers.get('Location');
  if (!location) {
    return createProxyResponse(response);
  }
  
  try {
    const redirectUrl = new URL(location);
    const originalUrl = new URL(originalRequest.url);
    
    if (isStandardDomain(redirectUrl.hostname)) {
      const convertedSubdomain = convertUrlToSubdomain(redirectUrl.hostname);
      if (convertedSubdomain) {
        const originalHostParts = originalUrl.hostname.split('.');
        const proxyDomain = originalHostParts.slice(1).join('.');
        redirectUrl.hostname = `${convertedSubdomain}.${proxyDomain}`;
        
        const redirectResponse = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
        
        redirectResponse.headers.set('Location', redirectUrl.toString());
        addCorsHeaders(redirectResponse.headers);
        
        return redirectResponse;
      }
    }
  } catch (e) {
    console.error('Redirect handling error:', e);
  }
  
  return createProxyResponse(response);
}

/**
 * 检查是否为标准域名格式
 * @param {string} hostname - 主机名
 * @returns {boolean} - 是否为标准域名
 */
function isStandardDomain(hostname) {
  return /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(hostname) && 
         hostname.includes('.') &&
         !hostname.includes('--');
}

/**
 * 处理 OPTIONS 预检请求
 * @param {Request} request - 原始请求
 * @returns {Response} - OPTIONS响应
 */
function handleOptions(request) {
  const headers = new Headers();
  addCorsHeaders(headers);
  
  const requestHeaders = request.headers.get('Access-Control-Request-Headers');
  if (requestHeaders) {
    headers.set('Access-Control-Allow-Headers', requestHeaders);
  }
  
  const requestMethod = request.headers.get('Access-Control-Request-Method');
  if (requestMethod && CONFIG.ALLOWED_METHODS.includes(requestMethod)) {
    headers.set('Access-Control-Allow-Methods', CONFIG.ALLOWED_METHODS.join(', '));
  }
  
  return new Response(null, {
    status: 204,
    headers: headers
  });
}

/**
 * 添加CORS头
 * @param {Headers} headers - 响应头对象
 */
function addCorsHeaders(headers) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', CONFIG.ALLOWED_METHODS.join(', '));
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
  headers.set('Access-Control-Max-Age', CONFIG.CORS_MAX_AGE);
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Type');
}

/**
 * 创建错误响应
 * @param {string} message - 错误消息
 * @param {number} status - HTTP状态码
 * @returns {Response} - 错误响应
 */
function createErrorResponse(message, status = 500) {
  const errorBody = JSON.stringify({
    error: message,
    status: status,
    timestamp: new Date().toISOString()
  });
  
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8'
  });
  
  addCorsHeaders(headers);
  
  return new Response(errorBody, {
    status: status,
    headers: headers
  });
}

/**
 * 生成前端页面HTML - 优化用户体验
 * @param {string} hostname - 当前主机名
 * @returns {string} - HTML内容
 */
function getProxyPageHTML(hostname) {
  const domain = hostname.split('.').slice(1).join('.');
  
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>网站代理服务</title>
    <!-- 网页图标 - 使用 Base64 编码的 SVG -->
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGRlZnM+CjxsaW5lYXJHcmFkaWVudCBpZD0iZ3JhZGllbnQiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPgo8c3RvcCBvZmZzZXQ9IjAlIiBzdHlsZT0ic3RvcC1jb2xvcjojNjY3ZWVhO3N0b3Atb3BhY2l0eToxIiAvPgo8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiM3NjRiYTI7c3RvcC1vcGFjaXR5OjEiIC8+CjwvbGluZWFyR3JhZGllbnQ+CjwvZGVmcz4KPGNpcmNsZSBjeD0iMTYiIGN5PSIxNiIgcj0iMTUiIGZpbGw9InVybCgjZ3JhZGllbnQpIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiLz4KPHN2ZyB4PSI4IiB5PSI4IiB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPgo8cGF0aCBkPSJNMTIgMmwtMy4wOSAzLjA5TDEwIDZIMy41MUMzIDYgMyA2LjUgMyA3djEwYzAgLjUuNTEgMSAxIDFoNi41bC0xLjA5IDEuMDlMMTIgMjJsNi01LjUtNi01LjV6bTAtMi44M0wxNS4xNyAySDEydi0uODN6Ii8+Cjwvc3ZnPgo8L3N2Zz4K">
    
    <!-- 备用图标格式 -->
    <link rel="apple-touch-icon" sizes="180x180" href="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgwIiBoZWlnaHQ9IjE4MCIgdmlld0JveD0iMCAwIDE4MCAxODAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxkZWZzPgo8bGluZWFyR3JhZGllbnQgaWQ9ImdyYWRpZW50IiB4MT0iMCUiIHkxPSIwJSIgeDI9IjEwMCUiIHkyPSIxMDAlIj4KPHN0b3Agb2Zmc2V0PSIwJSIgc3R5bGU9InN0b3AtY29sb3I6IzY2N2VlYTtzdG9wLW9wYWNpdHk6MSIgLz4KPHN0b3Agb2Zmc2V0PSIxMDAlIiBzdHlsZT0ic3RvcC1jb2xvcjojNzY0YmEyO3N0b3Atb3BhY2l0eToxIiAvPgo8L2xpbmVhckdyYWRpZW50Pgo8L2RlZnM+CjxyZWN0IHdpZHRoPSIxODAiIGhlaWdodD0iMTgwIiByeD0iMjAiIGZpbGw9InVybCgjZ3JhZGllbnQpIi8+Cjx0ZXh0IHg9IjkwIiB5PSIxMTAiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSI4MCIgZm9udC13ZWlnaHQ9ImJvbGQiIGZpbGw9IndoaXRlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj7wn4yQPC90ZXh0Pgo8L3N2Zz4K">
    
    <!-- 32x32 图标 -->
    <link rel="icon" type="image/png" sizes="32x32" href="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGRlZnM+CjxsaW5lYXJHcmFkaWVudCBpZD0iZ3JhZGllbnQiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPgo8c3RvcCBvZmZzZXQ9IjAlIiBzdHlsZT0ic3RvcC1jb2xvcjojNjY3ZWVhO3N0b3Atb3BhY2l0eToxIiAvPgo8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiM3NjRiYTI7c3RvcC1vcGFjaXR5OjEiIC8+CjwvbGluZWFyR3JhZGllbnQ+CjwvZGVmcz4KPHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNCIgZmlsbD0idXJsKCNncmFkaWVudCkiLz4KPHN2ZyB4PSI4IiB5PSI4IiB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPgo8cGF0aCBkPSJNMTIgMmwtMy4wOSAzLjA5TDEwIDZIMy41MUMzIDYgMyA2LjUgMyA3djEwYzAgLjUuNTEgMSAxIDFoNi41bC0xLjA5IDEuMDlMMTIgMjJsNi01LjUtNi01LjV6bTAtMi44M0wxNS4xNyAySDEydi0uODN6Ii8+Cjwvc3ZnPgo8L3N2Zz4K">
    
    <!-- 16x16 图标 -->
    <link rel="icon" type="image/png" sizes="16x16" href="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGRlZnM+CjxsaW5lYXJHcmFkaWVudCBpZD0iZ3JhZGllbnQiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPgo8c3RvcCBvZmZzZXQ9IjAlIiBzdHlsZT0ic3RvcC1jb2xvcjojNjY3ZWVhO3N0b3Atb3BhY2l0eToxIiAvPgo8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiM3NjRiYTI7c3RvcC1vcGFjaXR5OjEiIC8+CjwvbGluZWFyR3JhZGllbnQ+CjwvZGVmcz4KPHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiByeD0iMiIgZmlsbD0idXJsKCNncmFkaWVudCkiLz4KPHN2ZyB4PSI0IiB5PSI0IiB3aWR0aD0iOCIgaGVpZ2h0PSI4IiB2aWV3Qm94PSIwIDAgMjQgMjQiIGZpbGw9IndoaXRlIj4KPHBhdGggZD0iTTEyIDJsLTMuMDkgMy4wOUwxMCA2SDMuNTFDMyA2IDMgNi41IDMgN3YxMGMwIC41LjUxIDEgMSAxaDYuNWwtMS4wOSAxLjA5TDEyIDIybDYtNS41LTYtNS41em0wLTIuODNMMTUuMTcgMkgxMnYtLjgzeiIvPgo8L3N2Zz4KPC9zdmc+Cg==">

    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        
        .container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            padding: 40px;
            max-width: 600px;
            width: 100%;
        }
        
        .header {
            text-align: center;
            margin-bottom: 40px;
        }
        
        .header h1 {
            color: #333;
            font-size: 2.5rem;
            margin-bottom: 10px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        
        .header p {
            color: #666;
            font-size: 1.1rem;
            line-height: 1.6;
        }
        
        .form-group {
            margin-bottom: 30px;
        }
        
        .form-group label {
            display: block;
            margin-bottom: 10px;
            color: #333;
            font-weight: 600;
            font-size: 1.1rem;
        }
        
        .input-container {
            position: relative;
        }
        
        .form-group input {
            width: 100%;
            padding: 15px 20px;
            border: 2px solid #e1e5e9;
            border-radius: 12px;
            font-size: 1rem;
            transition: all 0.3s ease;
            background: #f8f9fa;
        }
        
        .form-group input:focus {
            outline: none;
            border-color: #667eea;
            background: white;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }
        
        .url-hint {
            font-size: 0.9rem;
            color: #666;
            margin-top: 8px;
            padding: 8px 12px;
            background: #f0f8ff;
            border-radius: 8px;
            border-left: 3px solid #667eea;
        }
        
        .btn {
            width: 100%;
            padding: 15px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 12px;
            font-size: 1.1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
        }
        
        .btn:active {
            transform: translateY(0);
        }
        
        .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        
        .result {
            margin-top: 30px;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 12px;
            border-left: 4px solid #667eea;
            display: none;
        }
        
        .result.show {
            display: block;
            animation: slideIn 0.3s ease;
        }
        
        .result h3 {
            color: #333;
            margin-bottom: 15px;
            font-size: 1.2rem;
        }
        
        .result-url {
            background: white;
            padding: 15px;
            border-radius: 8px;
            border: 1px solid #e1e5e9;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 0.9rem;
            word-break: break-all;
            margin-bottom: 15px;
            position: relative;
        }
        
        /* 按钮容器样式 */
        .button-group {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
        
        .action-btn {
            flex: 1;
            min-width: 120px;
            padding: 12px 20px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 0.95rem;
            font-weight: 600;
            transition: all 0.3s ease;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }
        
        .copy-btn {
            background: #28a745;
            color: white;
        }
        
        .copy-btn:hover {
            background: #218838;
            transform: translateY(-1px);
        }
        
        .copy-btn.copied {
            background: #17a2b8;
        }
        
        .visit-btn {
            background: linear-gradient(135deg, #fd7e14 0%, #e83e8c 100%);
            color: white;
        }
        
        .visit-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(232, 62, 140, 0.3);
        }
        
        .error {
            margin-top: 20px;
            padding: 15px;
            background: #f8d7da;
            color: #721c24;
            border-radius: 8px;
            border-left: 4px solid #dc3545;
            display: none;
        }
        
        .error.show {
            display: block;
            animation: slideIn 0.3s ease;
        }
        
        .loading {
            display: none;
            text-align: center;
            margin-top: 20px;
        }
        
        .loading.show {
            display: block;
        }
        
        .spinner {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid #f3f3f3;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-right: 10px;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(-10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        .examples {
            margin-top: 30px;
            padding: 20px;
            background: #e8f4fd;
            border-radius: 12px;
            border-left: 4px solid #17a2b8;
        }
        
        .examples h3 {
            color: #333;
            margin-bottom: 15px;
            font-size: 1.1rem;
        }
        
        .examples ul {
            list-style: none;
        }
        
        .examples li {
            margin-bottom: 8px;
            color: #666;
            font-size: 0.9rem;
        }
        
        .examples li::before {
            content: "→";
            color: #17a2b8;
            margin-right: 8px;
            font-weight: bold;
        }
        
        @media (max-width: 768px) {
            .container {
                padding: 30px 20px;
                margin: 10px;
            }
            
            .header h1 {
                font-size: 2rem;
            }
            
            .header p {
                font-size: 1rem;
            }
            
            .button-group {
                flex-direction: column;
            }
            
            .action-btn {
                min-width: auto;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🌐 网站代理服务</h1>
            <p>输入任意网址，获取代理链接，轻松访问被限制的网站</p>
        </div>
        
        <form id="proxyForm">
            <div class="form-group">
                <label for="url">请输入要代理的网址：</label>
                <div class="input-container">
                    <input 
                        type="text" 
                        id="url" 
                        name="url" 
                        placeholder="youtube.com 或 https://www.youtube.com" 
                        required
                        autocomplete="url"
                    >
                </div>
                <div class="url-hint">
                    💡 提示：可以直接输入域名，系统会自动添加 https:// 协议
                </div>
            </div>
            
            <button type="submit" class="btn" id="generateBtn">
                生成代理链接
            </button>
        </form>
        
        <div class="loading" id="loading">
            <div class="spinner"></div>
            正在生成代理链接...
        </div>
        
        <div class="result" id="result">
            <h3>✅ 代理链接已生成</h3>
            <div class="result-url" id="proxyUrl"></div>
            <div class="button-group">
                <button class="action-btn copy-btn" id="copyBtn" onclick="copyToClipboard()">
                    📋 复制链接
                </button>
                <button class="action-btn visit-btn" id="visitBtn" onclick="visitProxyUrl()">
                    🚀 访问网站
                </button>
            </div>
        </div>
        
        <div class="error" id="error">
            <strong>错误：</strong><span id="errorMessage"></span>
        </div>
        
        <div class="examples">
            <h3>📝 使用示例</h3>
            <ul>
                <li>输入 youtube.com → 生成 youtube--com.${domain}</li>
                <li>输入 github.com → 生成 github--com.${domain}</li>
                <li>输入 api.github.com → 生成 api--github--com.${domain}</li>
                <li>输入 www.example.com → 生成 www--example--com.${domain}</li>
            </ul>
        </div>
    </div>

    <script>
        const form = document.getElementById('proxyForm');
        const loading = document.getElementById('loading');
        const result = document.getElementById('result');
        const error = document.getElementById('error');
        const proxyUrl = document.getElementById('proxyUrl');
        const generateBtn = document.getElementById('generateBtn');
        const copyBtn = document.getElementById('copyBtn');
        const visitBtn = document.getElementById('visitBtn');
        
        let currentProxyUrl = '';
        
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const url = document.getElementById('url').value.trim();
            if (!url) return;
            
            // 显示加载状态
            showLoading();
            hideResult();
            hideError();
            
            try {
                const response = await fetch('/api/generate', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ url: url })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    currentProxyUrl = data.proxyUrl;
                    proxyUrl.textContent = currentProxyUrl;
                    showResult();
                } else {
                    showError(data.error || '生成代理链接失败');
                }
            } catch (err) {
                console.error('Error:', err);
                showError('网络错误，请稍后重试');
            } finally {
                hideLoading();
            }
        });
        
        function showLoading() {
            loading.classList.add('show');
            generateBtn.disabled = true;
        }
        
        function hideLoading() {
            loading.classList.remove('show');
            generateBtn.disabled = false;
        }
        
        function showResult() {
            result.classList.add('show');
            resetButtonStates();
        }
        
        function hideResult() {
            result.classList.remove('show');
        }
        
        function showError(message) {
            document.getElementById('errorMessage').textContent = message;
            error.classList.add('show');
        }
        
        function hideError() {
            error.classList.remove('show');
        }
        
        function resetButtonStates() {
            copyBtn.textContent = '📋 复制链接';
            copyBtn.classList.remove('copied');
            visitBtn.textContent = '🚀 访问网站';
        }
        
        async function copyToClipboard() {
            try {
                await navigator.clipboard.writeText(currentProxyUrl);
                copyBtn.textContent = '✅ 已复制';
                copyBtn.classList.add('copied');
                
                setTimeout(() => {
                    copyBtn.textContent = '📋 复制链接';
                    copyBtn.classList.remove('copied');
                }, 2000);
            } catch (err) {
                // 降级处理
                const textArea = document.createElement('textarea');
                textArea.value = currentProxyUrl;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                
                copyBtn.textContent = '✅ 已复制';
                copyBtn.classList.add('copied');
                
                setTimeout(() => {
                    copyBtn.textContent = '📋 复制链接';
                    copyBtn.classList.remove('copied');
                }, 2000);
            }
        }
        
        function visitProxyUrl() {
            if (!currentProxyUrl) {
                showError('没有可访问的代理链接');
                return;
            }
            
            // 提供用户反馈
            visitBtn.textContent = '🔄 跳转中...';
            visitBtn.disabled = true;
            
            // 延迟一下以显示反馈，然后跳转
            setTimeout(() => {
                try {
                    // 在新标签页中打开代理链接
                    window.open(currentProxyUrl, '_blank', 'noopener,noreferrer');
                } catch (err) {
                    console.error('跳转失败:', err);
                    showError('跳转失败，请手动复制链接访问');
                } finally {
                    // 重置按钮状态
                    setTimeout(() => {
                        visitBtn.textContent = '🚀 访问网站';
                        visitBtn.disabled = false;
                    }, 1000);
                }
            }, 300);
        }
        
        // 自动聚焦输入框
        document.getElementById('url').focus();
        
        // 键盘快捷键支持
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + Enter 快速生成
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                if (!generateBtn.disabled) {
                    form.dispatchEvent(new Event('submit'));
                }
            }
            
            // 结果显示时的快捷键
            if (result.classList.contains('show')) {
                // Ctrl/Cmd + C 复制
                if ((e.ctrlKey || e.metaKey) && e.key === 'c' && e.target.tagName !== 'INPUT') {
                    e.preventDefault();
                    copyToClipboard();
                }
                
                // Ctrl/Cmd + V 访问（这里用 V 代表 Visit）
                if ((e.ctrlKey || e.metaKey) && e.key === 'v' && e.target.tagName !== 'INPUT') {
                    e.preventDefault();
                    visitProxyUrl();
                }
            }
        });
    </script>
</body>
</html>`;
}
