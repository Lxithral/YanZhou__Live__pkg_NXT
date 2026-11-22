import { randomUUID } from 'node:crypto';
import { open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';

function envValue(value) {
  for (const encoded of [`'${value}'`, `"${value}"`, value]) {
    if (parseEnv(`VALUE=${encoded}`).VALUE === value) return encoded;
  }
  throw new Error('API Key 包含不支持的字符，请检查后重试。');
}

export function validateDashScopeCredentials(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some((key) => !['apiKey', 'workspaceId'].includes(key))) {
    throw new Error('百炼凭证设置格式无效。');
  }
  if (typeof options.apiKey !== 'string' || !/^[\x21-\x7E]{1,1024}$/u.test(options.apiKey.trim())) {
    throw new Error('请输入有效的百炼 API Key，不能包含空格或控制字符。');
  }
  if (options.workspaceId !== undefined && typeof options.workspaceId !== 'string') {
    throw new Error('百炼业务空间 ID 格式无效。');
  }
  const apiKey = options.apiKey.trim();
  const workspaceId = (options.workspaceId ?? '').trim();
  if (workspaceId && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(workspaceId)) {
    throw new Error('百炼业务空间 ID 格式无效。');
  }
  envValue(apiKey);
  return { apiKey, workspaceId };
}

function updateEnv(contents, credentials) {
  const bom = contents.startsWith('\uFEFF') ? '\uFEFF' : '';
  const source = contents.slice(bom.length);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const values = { DASHSCOPE_API_KEY: envValue(credentials.apiKey), DASHSCOPE_WORKSPACE_ID: envValue(credentials.workspaceId) };
  const found = new Set();
  const edits = [];
  // 跳过其他变量的多行引号内容，只替换凭证值，保留变量、注释和原换行。
  const assignment = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*/gm;
  let match;
  while ((match = assignment.exec(source))) {
    const start = assignment.lastIndex;
    let end = start;
    if (source[start] === '"' || source[start] === "'") {
      end = source.indexOf(source[start], start + 1);
      if (end < 0) throw new Error('本机 .env 引号未闭合，请检查文件后重试。');
      end += 1;
    } else {
      while (end < source.length && !['#', '\r', '\n'].includes(source[end])) end += 1;
      while (end > start && /[ \t]/u.test(source[end - 1])) end -= 1;
    }
    assignment.lastIndex = Math.max(end, start);
    if (Object.hasOwn(values, match[1])) {
      found.add(match[1]);
      edits.push({ start, end, value: values[match[1]] });
    }
  }
  let result = source;
  for (const edit of edits.reverse()) result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
  for (const [name, value] of Object.entries(values)) {
    if (found.has(name)) continue;
    if (result && !result.endsWith('\n')) result += newline;
    result += `${name}=${value}${newline}`;
  }
  return bom + result;
}

export async function saveDashScopeConfig(filePath, options) {
  const credentials = validateDashScopeCredentials(options);
  let contents = '';
  try { contents = await readFile(filePath, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('无法读取本机 .env，凭证未更改。'); }
  const updated = updateEnv(contents, credentials);
  const temporary = path.join(path.dirname(filePath), `.tmp-asr-${randomUUID()}`);
  let file;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(updated, 'utf8');
    await file.sync();
    await file.close();
    file = undefined;
    await rename(temporary, filePath);
  } catch {
    await file?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw new Error('无法保存本机 .env，凭证未更改，请检查文件是否可写。');
  }
}
