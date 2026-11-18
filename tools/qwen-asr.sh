#!/usr/bin/env bash
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
action="${1:-start}"
model="${2:-0.6b}"
case "$model" in
  0.6b|qwen3-asr-0.6b) model_id=qwen3-asr-0.6b; checkpoint=Qwen3-ASR-0.6B ;;
  1.7b|qwen3-asr-1.7b) model_id=qwen3-asr-1.7b; checkpoint=Qwen3-ASR-1.7B ;;
  *) echo 'Model must be 0.6b or 1.7b' >&2; exit 1 ;;
esac
python="$root/.venv-qwen-asr/bin/python"
if [[ "$action" == setup ]]; then
  python_bin=''
  for candidate in python3.12 python3.11 python3; do
    if command -v "$candidate" >/dev/null && "$candidate" -c 'import sys; sys.exit(0 if sys.version_info[:2] in ((3,11),(3,12)) else 1)'; then
      python_bin="$candidate"
      break
    fi
  done
  if [[ -z "$python_bin" ]]; then echo 'Install Python 3.11 or 3.12 with venv support in Linux/WSL first' >&2; exit 1; fi
  "$python_bin" -m venv "$root/.venv-qwen-asr"
  "$python" -m pip install --upgrade pip
  "$python" -m pip install -r tools/qwen-asr-requirements.txt
  "$python" -c 'import sys; from modelscope import snapshot_download; snapshot_download("Qwen/" + sys.argv[1], local_dir=sys.argv[2])' "$checkpoint" "$root/.asr-models/$checkpoint"
  echo 'Qwen ready to start: npm run asr:start'
elif [[ "$action" == start ]]; then
  if [[ ! -x "$python" ]]; then echo 'Run npm run asr:setup first' >&2; exit 1; fi
  exec "$python" tools/qwen-asr-service.py --model "$model_id" --model-dir "$root/.asr-models/$checkpoint"
else
  echo 'Usage: qwen-asr.sh setup|start [0.6b|1.7b]' >&2; exit 1
fi
