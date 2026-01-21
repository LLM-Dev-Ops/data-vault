/**
 * Output Formatters
 *
 * Provides formatters for CLI output in various formats:
 * JSON, Table, YAML, and plain text.
 *
 * @module @llm-data-vault/cli/formatters
 */

import Table from 'cli-table3';
import chalk from 'chalk';

/**
 * Supported output formats
 */
export type OutputFormat = 'json' | 'json-compact' | 'table' | 'yaml' | 'plain';

/**
 * Table configuration options
 */
export interface TableOptions {
  head?: string[];
  colWidths?: number[];
  wordWrap?: boolean;
  style?: {
    head?: string[];
    border?: string[];
    compact?: boolean;
  };
}

/**
 * Default table styles (exported for potential customization)
 */
export const DEFAULT_TABLE_STYLE = {
  head: ['cyan', 'bold'],
  border: ['dim'],
  compact: false,
} as const;

/**
 * Create a formatted table
 */
export function createTable(headers: string[], options: TableOptions = {}): Table.Table {
  const tableOptions: Table.TableConstructorOptions = {
    head: headers.map(h => chalk.bold(h)),
    style: {
      head: [],
      border: [],
      compact: options.style?.compact,
    },
    wordWrap: options.wordWrap ?? true,
  };

  if (options.colWidths) {
    tableOptions.colWidths = options.colWidths;
  }

  return new Table(tableOptions);
}

/**
 * Format data as JSON
 */
export function formatJson(data: unknown, compact: boolean = false): string {
  if (compact) {
    return JSON.stringify(data);
  }
  return JSON.stringify(data, null, 2);
}

/**
 * Format data as YAML
 */
export function formatYaml(data: unknown, indent: number = 2): string {
  return serializeToYaml(data, 0, indent);
}

/**
 * Simple YAML serializer
 */
function serializeToYaml(data: unknown, level: number, indent: number): string {
  const spaces = ' '.repeat(level * indent);
  const nextSpaces = ' '.repeat((level + 1) * indent);

  if (data === null || data === undefined) {
    return 'null';
  }

  if (typeof data === 'string') {
    // Check if string needs quoting
    if (
      data.includes('\n') ||
      data.includes(':') ||
      data.includes('#') ||
      data.startsWith(' ') ||
      data.endsWith(' ') ||
      /^[\d.]+$/.test(data) ||
      ['true', 'false', 'null', 'yes', 'no'].includes(data.toLowerCase())
    ) {
      // Use double quotes and escape special characters
      return `"${data.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    }
    return data;
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return String(data);
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return '[]';
    }

    const items = data.map(item => {
      const serialized = serializeToYaml(item, level + 1, indent);
      if (typeof item === 'object' && item !== null) {
        return `${spaces}- ${serialized.trim().replace(/^\n/, '').replace(new RegExp(`^${nextSpaces}`, 'gm'), '')}`;
      }
      return `${spaces}- ${serialized}`;
    });

    return '\n' + items.join('\n');
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data);
    if (entries.length === 0) {
      return '{}';
    }

    const items = entries.map(([key, value]) => {
      const serialized = serializeToYaml(value, level + 1, indent);
      if (Array.isArray(value) || (typeof value === 'object' && value !== null && Object.keys(value).length > 0)) {
        return `${spaces}${key}:${serialized}`;
      }
      return `${spaces}${key}: ${serialized}`;
    });

    return level === 0 ? items.join('\n') : '\n' + items.join('\n');
  }

  return String(data);
}

/**
 * Format data as plain text
 */
export function formatPlain(data: unknown): string {
  if (typeof data === 'string') {
    return data;
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return String(data);
  }

  if (Array.isArray(data)) {
    return data.map(item => formatPlain(item)).join('\n');
  }

  if (typeof data === 'object' && data !== null) {
    const entries = Object.entries(data);
    return entries.map(([key, value]) => {
      if (typeof value === 'object' && value !== null) {
        return `${key}:\n${formatPlain(value).split('\n').map(l => `  ${l}`).join('\n')}`;
      }
      return `${key}: ${formatPlain(value)}`;
    }).join('\n');
  }

  return String(data);
}

/**
 * Format data as a table from an array of objects
 */
export function formatTable(data: Record<string, unknown>[], columns?: string[]): string {
  if (!Array.isArray(data) || data.length === 0) {
    return '(no data)';
  }

  const firstItem = data[0];
  if (!firstItem) {
    return '(no data)';
  }

  // Determine columns from first item if not provided
  const cols = columns || Object.keys(firstItem);

  // Create table
  const table = createTable(cols.map(c => c.toUpperCase()));

  // Add rows
  for (const row of data) {
    const values = cols.map(col => {
      const value = row[col];
      if (value === null || value === undefined) {
        return '-';
      }
      if (typeof value === 'object') {
        return JSON.stringify(value);
      }
      return String(value);
    });
    table.push(values);
  }

  return table.toString();
}

/**
 * Format output in the specified format
 */
export function formatOutput(data: unknown, format: OutputFormat): string {
  switch (format) {
    case 'json':
      return formatJson(data, false);

    case 'json-compact':
      return formatJson(data, true);

    case 'yaml':
      return formatYaml(data);

    case 'plain':
      return formatPlain(data);

    case 'table':
      if (Array.isArray(data)) {
        return formatTable(data as Record<string, unknown>[]);
      }
      return formatPlain(data);

    default:
      return formatJson(data);
  }
}

/**
 * Truncate string to specified length
 */
export function truncate(str: string, maxLength: number, suffix: string = '...'): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.slice(0, maxLength - suffix.length) + suffix;
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes: number, decimals: number = 1): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/**
 * Format duration in milliseconds to human readable
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }

  return `${seconds}.${String(ms % 1000).padStart(3, '0')}s`;
}

/**
 * Format a percentage
 */
export function formatPercent(value: number, decimals: number = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Format a date/time value
 */
export function formatDateTime(date: Date | string | number): string {
  const d = new Date(date);
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

/**
 * Format relative time
 */
export function formatRelativeTime(date: Date | string | number): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) {
    return 'just now';
  }

  if (diffMin < 60) {
    return `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`;
  }

  if (diffHour < 24) {
    return `${diffHour} hour${diffHour > 1 ? 's' : ''} ago`;
  }

  if (diffDay < 30) {
    return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;
  }

  return formatDateTime(d);
}

/**
 * Create a progress bar string
 */
export function createProgressBar(
  current: number,
  total: number,
  width: number = 30,
  filled: string = '=',
  empty: string = '-'
): string {
  const percent = Math.min(1, Math.max(0, current / total));
  const filledCount = Math.round(width * percent);
  const emptyCount = width - filledCount;

  return `[${filled.repeat(filledCount)}${empty.repeat(emptyCount)}] ${formatPercent(percent, 0)}`;
}

/**
 * Colorize status values
 */
export function colorizeStatus(status: string): string {
  const statusLower = status.toLowerCase();

  if (['success', 'ok', 'healthy', 'active', 'enabled', 'yes', 'true', 'permit', 'allowed'].includes(statusLower)) {
    return chalk.green(status);
  }

  if (['warning', 'degraded', 'pending', 'in_progress', 'indeterminate'].includes(statusLower)) {
    return chalk.yellow(status);
  }

  if (['error', 'fail', 'failed', 'unhealthy', 'disabled', 'no', 'false', 'deny', 'denied'].includes(statusLower)) {
    return chalk.red(status);
  }

  return status;
}

/**
 * Colorize risk level
 */
export function colorizeRisk(level: string): string {
  const levelLower = level.toLowerCase();

  switch (levelLower) {
    case 'low':
      return chalk.green(level);
    case 'medium':
      return chalk.yellow(level);
    case 'high':
      return chalk.red(level);
    case 'critical':
      return chalk.bgRed.white(level);
    default:
      return level;
  }
}

/**
 * Format an error for display
 */
export function formatError(error: Error | string, verbose: boolean = false): string {
  if (typeof error === 'string') {
    return chalk.red('Error: ') + error;
  }

  let output = chalk.red('Error: ') + error.message;

  if (verbose && error.stack) {
    output += '\n' + chalk.dim(error.stack);
  }

  return output;
}

/**
 * Create a box around text
 */
export function box(content: string, title?: string): string {
  const lines = content.split('\n');
  const maxLength = Math.max(...lines.map(l => l.length), title?.length || 0);

  const border = '+' + '-'.repeat(maxLength + 2) + '+';

  let result = border + '\n';

  if (title) {
    const padding = maxLength - title.length;
    const leftPad = Math.floor(padding / 2);
    const rightPad = padding - leftPad;
    result += '| ' + ' '.repeat(leftPad) + chalk.bold(title) + ' '.repeat(rightPad) + ' |\n';
    result += border + '\n';
  }

  for (const line of lines) {
    const padding = maxLength - line.length;
    result += '| ' + line + ' '.repeat(padding) + ' |\n';
  }

  result += border;

  return result;
}

export default {
  createTable,
  formatJson,
  formatYaml,
  formatPlain,
  formatTable,
  formatOutput,
  truncate,
  formatBytes,
  formatDuration,
  formatPercent,
  formatDateTime,
  formatRelativeTime,
  createProgressBar,
  colorizeStatus,
  colorizeRisk,
  formatError,
  box,
};
