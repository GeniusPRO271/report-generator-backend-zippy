import { Context, MiddlewareHandler, Next } from 'hono';

interface LoggerConfig {
  /**
   * Enable colored output for console logs
   * @default true
   */
  colorize?: boolean;

  /**
   * Include request body in logs (use with caution for large payloads)
   * @default false
   */
  logRequestBody?: boolean;

  /**
   * Include response body in logs (use with caution for large payloads)
   * @default false
   */
  logResponseBody?: boolean;

  /**
   * Maximum body size to log (in bytes)
   * @default 10000
   */
  maxBodySize?: number;

  /**
   * Custom log function
   * @default console.log
   */
  logFn?: (message: string) => void;

  /**
   * Include headers in logs
   * @default true
   */
  logHeaders?: boolean;

  /**
   * Paths to skip logging (e.g., health check endpoints)
   * @default []
   */
  skip?: string[];
}

interface LogData {
  timestamp: string;
  method: string;
  path: string;
  status?: number;
  duration?: number;
  ip?: string;
  userAgent?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  requestBody?: any;
  responseBody?: any;
  error?: string;
}

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

/**
 * Get color based on HTTP status code
 */
function getStatusColor(status: number): string {
  if (status >= 500) return colors.red;
  if (status >= 400) return colors.yellow;
  if (status >= 300) return colors.cyan;
  if (status >= 200) return colors.green;
  return colors.white;
}

/**
 * Get color based on HTTP method
 */
function getMethodColor(method: string): string {
  const methodColors: Record<string, string> = {
    GET: colors.green,
    POST: colors.cyan,
    PUT: colors.yellow,
    PATCH: colors.magenta,
    DELETE: colors.red,
    OPTIONS: colors.dim,
    HEAD: colors.dim,
  };
  return methodColors[method] || colors.white;
}

/**
 * Format duration with appropriate unit
 */
function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Safely parse request body
 */
async function parseRequestBody(c: Context, maxSize: number): Promise<any> {
  try {
    const contentType = c.req.header('content-type') || '';

    if (contentType.includes('application/json')) {
      const text = await c.req.text();
      if (text.length > maxSize) {
        return `[Body too large: ${text.length} bytes]`;
      }
      return JSON.parse(text);
    }

    if (contentType.includes('application/x-www-form-urlencoded') ||
      contentType.includes('multipart/form-data')) {
      return '[Form data]';
    }

    return '[Binary or unsupported content type]';
  } catch (error) {
    return '[Unable to parse body]';
  }
}

/**
 * Create formatted log message
 */
function createLogMessage(data: LogData, colorize: boolean): string {
  const { timestamp, method, path, status, duration, ip, userAgent, headers, query, requestBody, responseBody, error } = data;

  let message = '';

  if (colorize && status) {
    const statusColor = getStatusColor(status);
    const methodColor = getMethodColor(method);
    message += `${colors.dim}[${timestamp}]${colors.reset} `;
    message += `${methodColor}${method}${colors.reset} `;
    message += `${colors.bright}${path}${colors.reset} `;
    message += `${statusColor}${status}${colors.reset} `;
    if (duration) {
      message += `${colors.dim}${formatDuration(duration)}${colors.reset}`;
    }
  } else {
    message += `[${timestamp}] ${method} ${path}`;
    if (status) message += ` ${status}`;
    if (duration) message += ` ${formatDuration(duration)}`;
  }

  const details: string[] = [];

  if (ip) details.push(`IP: ${ip}`);
  if (userAgent) details.push(`User-Agent: ${userAgent}`);

  if (query && Object.keys(query).length > 0) {
    details.push(`Query: ${JSON.stringify(query)}`);
  }

  if (headers) {
    details.push(`Headers: ${JSON.stringify(headers, null, 2)}`);
  }

  if (requestBody) {
    details.push(`Request Body: ${JSON.stringify(requestBody, null, 2)}`);
  }

  if (responseBody) {
    details.push(`Response Body: ${JSON.stringify(responseBody, null, 2)}`);
  }

  if (error) {
    details.push(`Error: ${error}`);
  }

  if (details.length > 0) {
    message += '\n  ' + details.join('\n  ');
  }

  return message;
}

/**
 * Logger middleware for Hono
 */
export function logger(config: LoggerConfig = {}): MiddlewareHandler {
  const {
    colorize = true,
    logRequestBody = false,
    logResponseBody = false,
    maxBodySize = 10000,
    logFn = console.log,
    logHeaders = true,
    skip = [],
  } = config;

  return async (c: Context, next: Next) => {
    const path = c.req.path;

    // Skip logging for specified paths
    if (skip.some(skipPath => path.startsWith(skipPath))) {
      return await next();
    }

    const startTime = Date.now();
    const timestamp = new Date().toISOString();
    const method = c.req.method;

    // Extract request information
    const ip = c.req.header('x-forwarded-for') ||
      c.req.header('x-real-ip') ||
      'unknown';
    const userAgent = c.req.header('user-agent');

    // Parse query parameters
    const url = new URL(c.req.url);
    const query: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    // Collect headers if enabled
    let headers: Record<string, string> | undefined;
    if (logHeaders) {
      headers = {};
      c.req.raw.headers.forEach((value, key) => {
        headers![key] = value;
      });
    }

    // Parse request body if enabled
    let requestBody: any;
    if (logRequestBody && ['POST', 'PUT', 'PATCH'].includes(method)) {
      // Clone the request to avoid consuming the body
      const clonedReq = c.req.raw.clone();
      const tempContext = { ...c, req: { ...c.req, raw: clonedReq } } as Context;
      requestBody = await parseRequestBody(tempContext, maxBodySize);
    }

    let logData: LogData = {
      timestamp,
      method,
      path,
      ip,
      userAgent,
      headers,
      query: Object.keys(query).length > 0 ? query : undefined,
      requestBody,
    };

    try {
      await next();

      const duration = Date.now() - startTime;
      const status = c.res.status;

      // Parse response body if enabled
      let responseBody: any;
      if (logResponseBody) {
        try {
          const clonedRes = c.res.clone();
          const text = await clonedRes.text();
          if (text.length <= maxBodySize) {
            try {
              responseBody = JSON.parse(text);
            } catch {
              responseBody = text.length > 100 ? text.substring(0, 100) + '...' : text;
            }
          } else {
            responseBody = `[Response too large: ${text.length} bytes]`;
          }
        } catch {
          responseBody = '[Unable to parse response]';
        }
      }

      logData = {
        ...logData,
        status,
        duration,
        responseBody,
      };

      logFn(createLogMessage(logData, colorize));
    } catch (error) {
      const duration = Date.now() - startTime;

      logData = {
        ...logData,
        status: 500,
        duration,
        error: error instanceof Error ? error.message : String(error),
      };

      logFn(createLogMessage(logData, colorize));

      throw error;
    }
  };
}
