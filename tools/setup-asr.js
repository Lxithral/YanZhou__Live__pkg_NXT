import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, stat, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import path from 'node:path';
import { ASR_MODELS, MODEL_ROOT, modelAvailable } from '../server/asr-models.js';

const exec = promisify(execFile);
const modes = process.argv.slice(2);
if (!modes.length) modes.push(...Object.keys(ASR_MODELS));
if (modes.some((mode) => !Object.hasOwn(ASR_MODELS, mode))) throw new Error('用法：npm run asr:setup -- [bilingual|trilingual]');
await mkdir(MODEL_ROOT, { recursive: true });

async function download(url, file, check) {
  console.log(`下载 ${path.basename(file)}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(15 * 60_000) });
  if (!response.ok || !response.body) throw new Error(`下载失败：HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(file, { flags: 'wx' }));
  const size = (await stat(file)).size;
  if (check.size !== undefined && size !== check.size) throw new Error('模型文件大小校验失败。');
  const hash = createHash(check.gitSha1 ? 'sha1' : 'sha256');
  if (check.gitSha1) hash.update(`blob ${size}\0`);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== (check.gitSha1 ?? check.sha256)) throw new Error('模型文件哈希校验失败。');
}

async function install(mode) {
  if (await modelAvailable(mode)) {
    console.log(`${mode} 模型已就绪。`);
    return;
  }
  const model = ASR_MODELS[mode];
  const staging = await mkdtemp(path.join(MODEL_ROOT, '.install-'));
  const candidate = path.join(staging, model.name);
  try {
    if (model.archiveHash) {
      const archive = path.join(staging, `${model.name}.tar.bz2`);
      const base = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models';
      await download(`${base}/${path.basename(archive)}`, archive, { sha256: model.archiveHash });
      await exec('tar', ['-xf', archive, '-C', staging], { windowsHide: true });
      await unlink(archive);
    } else {
      await mkdir(candidate);
      const base = `https://huggingface.co/csukuangfj/${model.name}/resolve/${model.revision}`;
      for (const [file, check] of Object.entries(model.files)) await download(`${base}/${file}`, path.join(candidate, file), check);
    }
    if (!await modelAvailable(mode, staging)) throw new Error('模型安装不完整。');
    await rename(candidate, path.join(MODEL_ROOT, model.name));
    console.log(`${mode} 模型安装完成。`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

await Promise.all(modes.map(install));
