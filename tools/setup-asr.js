import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASR_MODELS, QWEN_SERVICE_URL, serviceUrl } from '../server/asr-models.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [action = 'setup', model = '0.6b'] = process.argv.slice(2);
if (!['setup', 'start', 'check'].includes(action) || !['0.6b', '1.7b'].includes(model)) {
  throw new Error('用法：npm run asr:setup [-- 0.6b|1.7b]；npm run asr:start [-- 0.6b|1.7b]；npm run asr:check');
}
if (action === 'check') {
  try {
    const token = process.env.YZ_QWEN_ASR_TOKEN;
    const response = await fetch(serviceUrl(QWEN_SERVICE_URL, '/health'), {
      headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const state = await response.json();
    if (!Object.hasOwn(ASR_MODELS, state.model) || state.sampleRate !== 16000) throw new Error('服务协议不匹配');
    console.log(`${ASR_MODELS[state.model].label}：${state.ready ? '就绪' : state.message}`);
    if (!state.ready) process.exitCode = 1;
  } catch (error) {
    console.error(`Qwen 服务未就绪（${QWEN_SERVICE_URL}）：${error.message}`);
    process.exitCode = 1;
  }
} else {
  let command = 'bash';
  let args = [path.join(root, 'tools', 'qwen-asr.sh'), action, model];
  if (process.platform === 'win32') {
    try {
      const linuxRoot = execFileSync('wsl.exe', ['--exec', 'wslpath', '-u', root], { encoding: 'utf8', windowsHide: true }).trim();
      if (!linuxRoot.startsWith('/')) throw new Error('WSL 路径转换失败');
      // Pass arguments directly; do not interpolate Windows paths or tokens into a shell command.
      const envArgs = ['YZ_QWEN_GPU_MEMORY', 'YZ_QWEN_ASR_TOKEN', 'YZ_QWEN_HOST']
        .filter((key) => process.env[key]).map((key) => `${key}=${process.env[key]}`);
      command = 'wsl.exe';
      args = ['--exec', 'env', ...envArgs, 'bash', linuxRoot + '/tools/qwen-asr.sh', action, model];
    } catch {
      console.error('Qwen 官方流式引擎需要 Linux / WSL2、Python 3.11/3.12 和可用的 NVIDIA CUDA。请在实际直播机准备 WSL2 Ubuntu 后重试；详见 README 的 Qwen 部署说明。');
      process.exit(1);
    }
  }
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  child.on('error', (error) => { console.error(`Qwen ${action} 启动失败：${error.message}`); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}
