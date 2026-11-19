import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ASR_MODELS, DEFAULT_QWEN_MODEL, readQwenHealth } from '../server/asr-models.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exec = promisify(execFile);
const ubuntuNames = ['Ubuntu-24.04', 'Ubuntu', 'Ubuntu-22.04'];

function decodeWsl(buffer) {
  return buffer.toString(buffer.includes(0) ? 'utf16le' : 'utf8').replace(/^\uFEFF/u, '');
}

async function queryWsl(args, signal) {
  try {
    const { stdout, stderr } = await exec('wsl.exe', args, { cwd: root, windowsHide: true, timeout: 15_000, signal });
    return [stdout, stderr].map(decodeWsl).join('\n');
  } catch (error) {
    signal?.throwIfAborted();
    if (args[0] === '--help') return [error.stdout, error.stderr].filter(Buffer.isBuffer).map(decodeWsl).join('\n');
    return '';
  }
}

export function ubuntuInstallArgs(catalog, help) {
  const names = new Set(catalog.split(/\r?\n/u).map((line) => line.trim().split(/\s+/u)[0]?.toLowerCase()));
  const distro = ubuntuNames.find((name) => names.has(name.toLowerCase())) || 'Ubuntu';
  return { distro, flags: ['--install', '-d', distro, ...(help.includes('--no-launch') ? ['--no-launch'] : [])] };
}

function wslCommand(distro, args, user) {
  return [
    ...(distro ? ['--distribution', distro] : []),
    ...(user ? ['--user', user] : []),
    '--exec', ...args,
  ];
}

async function wslProjectPath(distro, signal) {
  const options = { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30_000, signal };
  const { stdout: kernel } = await exec('wsl.exe', wslCommand(distro, ['uname', '-r'], 'root'), options);
  if (!kernel.toLowerCase().includes('wsl2')) throw new Error('需要 WSL2');
  await exec('wsl.exe', wslCommand(distro, ['bash', '--version'], 'root'), options);
  const { stdout } = await exec('wsl.exe', wslCommand(distro, ['wslpath', '-a', '-u', root], 'root'), options);
  const linuxRoot = stdout.trim().split(/\r?\n/).at(-1);
  if (!linuxRoot.startsWith('/')) throw new Error('WSL 无法访问项目目录');
  return linuxRoot;
}

function run(command, args, { signal, managed = false } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: [managed ? 'pipe' : 'inherit', 'inherit', 'inherit'], windowsHide: true });
    const stop = () => {
      if (managed) {
        child.stdin.end();
        child.stdin.unref?.();
        child.unref();
      } else child.kill();
    };
    child.stdin?.on('error', () => {});
    signal?.addEventListener('abort', stop, { once: true });
    child.once('error', reject);
    child.once('close', (code) => {
      signal?.removeEventListener('abort', stop);
      if (signal?.aborted) reject(signal.reason);
      else if (code === 0) resolve();
      else reject(new Error(`${command} 退出（${code ?? '信号中止'}），详见启动窗口。`));
    });
  });
}

async function environment({ install, report, signal }) {
  if (process.platform === 'linux') return { command: 'bash', script: [path.join(root, 'tools', 'qwen-asr.sh')] };
  if (process.platform !== 'win32') throw new Error('Qwen 流式识别需要 Linux 或 Windows WSL2。');

  const requested = process.env.YZ_QWEN_WSL_DISTRO;
  const probe = async (distro) => {
    const linuxRoot = await wslProjectPath(distro, signal).catch(() => null);
    signal?.throwIfAborted();
    return linuxRoot && { distro, linuxRoot };
  };
  let available;
  const installed = requested ? '' : await queryWsl(['--list', '--quiet'], signal);
  const registered = new Set(installed.split(/\r?\n/u).map((line) => line.trim().toLowerCase()));
  for (const candidate of requested ? [requested] : [...ubuntuNames.filter((name) => registered.has(name.toLowerCase())), null]) {
    available = await probe(candidate);
    if (available) break;
  }
  if (!available && install && !requested) {
    if (ubuntuNames.some((name) => registered.has(name.toLowerCase()))) {
      throw new Error('已安装 Ubuntu，但目前无法作为 WSL2 启动。请用 wsl -l -v 查看；版本为 1 时运行 wsl --set-version <发行版名称> 2。');
    }
    const [catalog, help] = await Promise.all([
      queryWsl(['--list', '--online'], signal), queryWsl(['--help'], signal),
    ]);
    const { distro, flags } = ubuntuInstallArgs(catalog, help);
    report(`正在安装 WSL2 和 ${distro}。若 Windows 提示授权、重启或初始化 Ubuntu，请完成后重新打开启动脚本。`);
    try {
      await run('wsl.exe', flags, { signal });
    } catch {
      signal?.throwIfAborted();
      if (!help.includes('--web-download')) throw new Error('WSL 安装命令未完成。请看上方的具体错误，或运行 wsl --update 后重试。');
      report(`${distro} 常规安装失败，尝试从网上直接下载安装包…`);
      try {
        await run('wsl.exe', [...flags, '--web-download'], { signal });
      } catch {
        signal?.throwIfAborted();
        throw new Error('WSL 安装命令未完成。请看上方的具体错误；可在管理员终端运行 wsl --update 和 wsl --list --online，再启动。');
      }
    }
    available = await probe(distro);
    if (!available) throw new Error(`${distro} 尚不能在 WSL2 中运行。请按 Windows 提示重启或初始化 Ubuntu，再双击 start.cmd；可用 wsl -l -v 检查。`);
  }
  if (!available) throw new Error('找不到可用的 WSL2 发行版。请检查 WSL2 或 YZ_QWEN_WSL_DISTRO。');
  const { distro, linuxRoot } = available;
  const script = [`${linuxRoot}/tools/qwen-asr.sh`];
  const envArgs = ['YZ_QWEN_GPU_MEMORY', 'YZ_QWEN_ASR_TOKEN', 'YZ_QWEN_HOST']
    .filter((key) => process.env[key]).map((key) => `${key}=${process.env[key]}`);
  return {
    command: 'wsl.exe',
    script: wslCommand(distro, ['env', ...envArgs, 'bash', ...script]),
    prereqs: wslCommand(distro, ['bash', ...script, 'prereqs'], 'root'),
  };
}

export async function configureQwen(action, model = DEFAULT_QWEN_MODEL, { report = console.log, signal } = {}) {
  if (!['setup', 'start', 'auto'].includes(action) || !Object.hasOwn(ASR_MODELS, `qwen3-asr-${model}`)) {
    throw new Error('Qwen 型号只能是 0.6b 或 1.7b。');
  }
  const install = action !== 'start';
  report(`正在准备 Qwen3-ASR ${model.toUpperCase()}，首次启动需要联网，详细进度见启动窗口。`);
  const { command, script, prereqs } = await environment({ install, report, signal });
  if (install) {
    if (prereqs) await run(command, prereqs, { signal });
    await run(command, [...script, 'setup', model], { signal });
  }
  if (action !== 'setup') {
    report(`Qwen3-ASR ${model.toUpperCase()} 正在启动并加载模型…`);
    await run(command, [...script, 'start', model, ...(action === 'auto' ? ['--managed'] : [])],
      { signal, managed: action === 'auto' });
    if (action === 'auto') throw new Error('Qwen 识别服务已退出，详见启动窗口。');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action = 'setup', model = DEFAULT_QWEN_MODEL] = process.argv.slice(2);
  try {
    if (action === 'check') {
      const health = await readQwenHealth();
      console.log(`${ASR_MODELS[health.model].label}：${health.ready ? '就绪' : health.message}`);
      if (!health.ready) process.exitCode = 1;
    } else {
      await configureQwen(action, model);
    }
  } catch (error) {
    console.error(`Qwen：${error.message}`);
    process.exitCode = 1;
  }
}
