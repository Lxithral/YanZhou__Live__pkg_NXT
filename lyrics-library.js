import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { validateDocument } from './public/lyrics-model.js';

const ID = /^[0-9a-f]{32}$/u;
const VERSION = /^[0-9a-f]{64}$/u;
const digest = (doc) => createHash('sha256').update(JSON.stringify(doc)).digest('hex');

export async function atomicWrite(filePath, data) {
  const temporary = path.join(path.dirname(filePath), `.tmp-${randomUUID()}`);
  const file = await open(temporary, 'wx');
  try {
    try {
      await file.writeFile(`${JSON.stringify(data, null, 2)}\n`, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

function songTitle(value) {
  if (typeof value !== 'string') throw new Error('请输入歌名。');
  const title = value.trim();
  if (!title || [...title].length > 100 || /[\u0000-\u001F\u007F]/u.test(title)) {
    throw new Error('歌名须为 1–100 个字符，且不能包含控制字符。');
  }
  return title;
}

function normalizeSongTitle(title) {
  return title.normalize('NFKC').trim().toLowerCase();
}

export function validateSongReference(value) {
  if (!value || typeof value.id !== 'string' || typeof value.version !== 'string' ||
      !ID.test(value.id) || !VERSION.test(value.version) || Object.keys(value).length !== 2) {
    throw new Error('设置中的歌曲引用无效。');
  }
  return { id: value.id, version: value.version };
}

export async function openLyricLibrary(directory) {
  const catalog = new Map();
  const songPath = (id) => path.join(directory, `${id}.json`);
  async function readSong(id) {
    if (typeof id !== 'string' || !ID.test(id)) throw new Error('歌曲编号无效。');
    const saved = JSON.parse(await readFile(songPath(id), 'utf8'));
    const title = songTitle(saved.title);
    if (!Number.isSafeInteger(saved.updatedAt) || saved.updatedAt < 0 || saved.updatedAt > 8.64e15) {
      throw new Error('歌曲保存时间无效。');
    }
    const doc = validateDocument(saved.doc);
    return { id, title, updatedAt: saved.updatedAt, doc, version: digest(doc) };
  }

  function remember(song) {
    const { id, title, updatedAt } = song;
    catalog.set(id, { id, title, updatedAt });
    return song;
  }

  const files = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const file of files) {
    const id = file.name.endsWith('.json') ? file.name.slice(0, -5) : '';
    if (!file.isFile() || !ID.test(id)) continue;
    try {
      remember(await readSong(id));
    } catch (error) {
      console.warn(`跳过无法读取的歌曲配置 ${file.name}：${error.message}`);
    }
  }

  async function writeSong(id, title, doc) {
    const updatedAt = Date.now();
    await mkdir(directory, { recursive: true });
    await atomicWrite(songPath(id), { title, updatedAt, doc });
    return remember({ id, title, updatedAt, doc, version: digest(doc) });
  }

  return {
    list() {
      return [...catalog.values()].sort((a, b) => a.title.localeCompare(b.title, 'zh') ||
        b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    },
    async load(id) {
      if (!catalog.has(id)) throw new Error('曲库中找不到这首歌，请检查 config/lyrics。');
      return remember(await readSong(id));
    },
    async save(title, doc, replaceId, saveKey) {
      title = songTitle(title);
      validateDocument(doc);
      if (replaceId !== undefined) {
        const existing = catalog.get(replaceId);
        if (!existing || normalizeSongTitle(existing.title) !== normalizeSongTitle(title)) {
          throw new Error('要替换的同名版本已不存在，请重新选择。');
        }
      }
      if (saveKey !== undefined && (typeof saveKey !== 'string' || !ID.test(saveKey))) {
        throw new Error('歌曲保存编号无效。');
      }
      const id = replaceId ?? (saveKey
        ? createHash('sha256').update(`import:${saveKey}`).digest('hex').slice(0, 32)
        : randomUUID().replaceAll('-', ''));
      if (catalog.has(id)) {
        const previous = await readSong(id);
        if (previous.title === title && previous.version === digest(doc)) return previous;
        if (!replaceId) throw new Error('该导入编号已用于另一份歌词，请重新导入。');
      }
      return writeSong(id, title, doc);
    },
    async migrate(doc) {
      const id = digest(doc).slice(0, 32);
      if (catalog.has(id)) return readSong(id);
      return writeSong(id, '旧版歌词', doc);
    },
  };
}
