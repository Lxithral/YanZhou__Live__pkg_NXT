#!/usr/bin/env bash
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
action="${1:-start}"
model="${2:-0.6b}"
find_python() {
  local candidate
  for candidate in python3.12 python3.11 python3; do
    if command -v "$candidate" >/dev/null &&
       "$candidate" -c 'import sys, ensurepip, sysconfig; from pathlib import Path; sys.exit(not (sys.version_info[:2] in ((3, 11), (3, 12)) and (Path(sysconfig.get_path("include")) / "Python.h").is_file()))' 2>/dev/null; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

if [[ "$action" == prereqs ]]; then
  if command -v gcc >/dev/null && command -v g++ >/dev/null && { find_python >/dev/null || command -v curl >/dev/null; }; then
    exit 0
  fi
  if ! command -v apt-get >/dev/null; then
    echo 'Use Ubuntu 24.04 WSL2 or install Python 3.11/3.12, venv, Python headers and a C/C++ compiler in this distro.' >&2
    exit 1
  fi
  echo 'Installing Python and build tools in WSL...'
  packages=(gcc g++ ca-certificates curl)
  if ! find_python >/dev/null &&
     { ! command -v python3 >/dev/null || python3 -c 'import sys; sys.exit(sys.version_info[:2] not in ((3, 11), (3, 12)))'; }; then
    packages+=(python3 python3-venv python3-dev)
  fi
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${packages[@]}"
  exit 0
fi
case "$model" in
  0.6b|qwen3-asr-0.6b) model_id=qwen3-asr-0.6b; checkpoint=Qwen3-ASR-0.6B ;;
  1.7b|qwen3-asr-1.7b) model_id=qwen3-asr-1.7b; checkpoint=Qwen3-ASR-1.7B ;;
  *) echo 'Model must be 0.6b or 1.7b' >&2; exit 1 ;;
esac
venv="$root/.venv-qwen-asr"
if [[ -n "${WSL_DISTRO_NAME:-}" && ! -x "$venv/bin/python" ]]; then
  venv="${XDG_CACHE_HOME:-$HOME/.cache}/yanzhou-live/qwen-venv"
fi
python="$venv/bin/python"
checkpoint_dir="$root/.asr-models/$checkpoint"

has_file() {
  [[ -f "$checkpoint_dir/$1" ]] && [[ "$(stat -c '%s' -- "$checkpoint_dir/$1")" == "$2" ]]
}

has_model() {
  for name in config.json generation_config.json preprocessor_config.json tokenizer_config.json merges.txt vocab.json chat_template.json; do
    [[ -s "$checkpoint_dir/$name" ]] || return 1
  done
  if [[ "$model_id" == qwen3-asr-0.6b ]]; then
    has_file model.safetensors 1876091704
  else
    has_file model.safetensors.index.json 64821 &&
      has_file model-00001-of-00002.safetensors 4220320824 &&
      has_file model-00002-of-00002.safetensors 478200688
  fi
}

if [[ "$action" == setup ]]; then
  if command -v nvidia-smi >/dev/null; then
    gpu_check="$(command -v nvidia-smi)"
  else
    gpu_check=/usr/lib/wsl/lib/nvidia-smi
  fi
  if ! "$gpu_check" -L 2>/dev/null; then
    echo 'NVIDIA GPU not available in this environment. Check the host NVIDIA driver and WSL2 GPU support.' >&2
    exit 1
  fi
  mkdir -p -- "$venv" "$root/.asr-models"
  exec 9>"$venv/.setup.lock"
  flock 9
  if [[ ! -x "$python" ]] || ! "$python" -m pip --version >/dev/null 2>&1; then
    python_bin="$(find_python || true)"
    if [[ -z "$python_bin" && -n "${WSL_DISTRO_NAME:-}" ]]; then
      managed="${XDG_CACHE_HOME:-$HOME/.cache}/yanzhou-live"
      uv="$managed/bin/uv"
      if [[ ! -x "$uv" ]]; then
        installer="$(mktemp)"
        trap 'rm -f -- "$installer"' EXIT
        curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' https://astral.sh/uv/install.sh -o "$installer"
        UV_UNMANAGED_INSTALL="$managed/bin" sh "$installer"
      fi
      echo 'Installing isolated Python 3.12 for Qwen...'
      export UV_PYTHON_INSTALL_DIR="$managed/python"
      "$uv" --no-config python install 3.12 --no-bin
      python_bin="$("$uv" --no-config python find 3.12 --managed-python)"
    fi
    if [[ -z "$python_bin" ]]; then
      echo 'Install Python 3.11 or 3.12 with venv support.' >&2
      exit 1
    fi
    "$python_bin" -m venv "$venv"
  fi
  requirements="$(sha256sum tools/qwen-asr-requirements.txt | cut -d ' ' -f 1)"
  if [[ ! -f "$venv/.requirements-sha256" || "$(cat "$venv/.requirements-sha256")" != "$requirements" ]]; then
    echo 'Installing Qwen and CUDA inference dependencies...'
    "$python" -m pip install -r tools/qwen-asr-requirements.txt
    printf '%s\n' "$requirements" > "$venv/.requirements-sha256"
  fi
  if ! has_model; then
    echo "Downloading $checkpoint from ModelScope..."
    "$python" -c 'import sys; from modelscope import snapshot_download; snapshot_download("Qwen/" + sys.argv[1], local_dir=sys.argv[2])' "$checkpoint" "$checkpoint_dir"
    if ! has_model; then echo 'Incomplete Qwen model. Check disk space and retry setup.' >&2; exit 1; fi
  else
    echo "Using existing $checkpoint weights."
  fi
elif [[ "$action" == start ]]; then
  if [[ ! -x "$python" ]]; then echo 'Run npm run asr:setup first' >&2; exit 1; fi
  if ! has_model; then echo 'Local model is incomplete. Run npm run asr:setup first.' >&2; exit 1; fi
  exec "$python" tools/qwen-asr-service.py --model "$model_id" --model-dir "$checkpoint_dir" "${@:3}"
else
  echo 'Usage: qwen-asr.sh setup|start [0.6b|1.7b]' >&2; exit 1
fi
