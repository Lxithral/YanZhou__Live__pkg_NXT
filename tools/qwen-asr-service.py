"""One shared Qwen model, one audio stream; HTTP health and PCM WebSocket bridge."""
import argparse
import asyncio
import hmac
import logging
import os
import signal
import sys
from threading import Thread
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from qwen_stream import SAMPLE_RATE, StreamingSession

MODELS = {"qwen3-asr-0.6b": "Qwen/Qwen3-ASR-0.6B", "qwen3-asr-1.7b": "Qwen/Qwen3-ASR-1.7B"}


class QwenAdapter:
    def __init__(self, model):
        self.model = model

    def init_streaming_state(self, **kwargs):
        return self.model.init_streaming_state(**kwargs)

    def feed(self, pcm, state):
        import numpy as np
        self.model.streaming_transcribe(np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768, state)

    def finish_streaming_transcribe(self, state):
        self.model.finish_streaming_transcribe(state)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=os.getenv("YZ_QWEN_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--model", choices=MODELS, default="qwen3-asr-0.6b")
    parser.add_argument("--model-dir", type=Path, required=True, help="Downloaded local checkpoint directory")
    parser.add_argument("--managed", action="store_true", help="Stop when the launcher's stdin pipe closes")
    parser.add_argument("--gpu-memory-utilization", type=float, default=float(os.getenv("YZ_QWEN_GPU_MEMORY", "0.4")))
    args = parser.parse_args()
    if not (args.model_dir / "config.json").is_file():
        parser.error("Local model missing. Run npm run asr:setup first.")
    if not 0.1 <= args.gpu_memory_utilization <= 0.9:
        parser.error("GPU memory fraction must be between 0.1 and 0.9")
    token = os.getenv("YZ_QWEN_ASR_TOKEN", "")
    if args.host not in ("localhost", "127.0.0.1", "::1") and not token:
        parser.error("Set YZ_QWEN_ASR_TOKEN before exposing the service to another computer")

    from aiohttp import web, WSMsgType
    logging.basicConfig(level=logging.INFO)
    state = {"model": None, "message": "Qwen 模型正在加载，请稍后刷新引擎状态。", "active": None}
    inference_lock = asyncio.Lock()
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="qwen-asr")

    async def infer(function, *arguments):
        # Keep vLLM initialization and all model calls on the same owning thread.
        return await asyncio.get_running_loop().run_in_executor(executor, function, *arguments)

    @web.middleware
    async def authorize(request, handler):
        # Browser capture goes through Node; this service is never a browser-facing audio endpoint.
        if request.headers.get("Origin"):
            raise web.HTTPForbidden()
        if token and not hmac.compare_digest(request.headers.get("Authorization", ""), "Bearer " + token):
            raise web.HTTPUnauthorized()
        return await handler(request)

    async def health(_request):
        return web.json_response({"model": args.model, "ready": state["model"] is not None,
                                  "sampleRate": SAMPLE_RATE, "message": state["message"]})

    async def audio(request):
        socket = web.WebSocketResponse(max_msg_size=1280, heartbeat=20)
        await socket.prepare(request)
        if state["active"] is not None or state["model"] is None or request.query.get("model") != args.model:
            await socket.send_json({"type": "error", "message": state["message"] or "Qwen 模型不匹配或已有音频正在识别。"})
            await socket.close()
            return socket
        state["active"] = socket
        session = StreamingSession(state["model"])
        try:
            await socket.send_json({"type": "ready", "model": args.model, "sampleRate": SAMPLE_RATE})
            while not socket.closed:
                packet = await socket.receive(timeout=15)
                if packet.type in (WSMsgType.CLOSE, WSMsgType.CLOSING, WSMsgType.CLOSED, WSMsgType.ERROR):
                    break
                if packet.type != WSMsgType.BINARY or len(packet.data) != 1280:
                    raise ValueError("音频格式无效，需使用 16 kHz 单声道 PCM16。")
                # Serialize model calls; state and audio are bounded to one 12-second utterance.
                async with inference_lock:
                    event = await infer(session.accept, packet.data)
                await socket.send_json({"type": "frame", "event": event})
        except (asyncio.TimeoutError, ConnectionResetError):
            pass
        except Exception:
            logging.exception("Qwen stream failed")
            if not socket.closed:
                await socket.send_json({"type": "error", "message": "Qwen 推理失败，请查看识别服务终端；可降低直播负载或调整显存预算。"})
        finally:
            if state["active"] is socket:
                state["active"] = None
            await socket.close()
        return socket

    async def load_model():
        def load():
            os.environ.setdefault("HF_HUB_OFFLINE", "1")
            os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
            from qwen_asr import Qwen3ASRModel
            model = Qwen3ASRModel.LLM(model=str(args.model_dir.resolve()),
                dtype="float16", gpu_memory_utilization=args.gpu_memory_utilization, max_model_len=2048,
                max_num_seqs=1, enforce_eager=True, max_inference_batch_size=1, max_new_tokens=128)
            return QwenAdapter(model)
        try:
            state["model"] = await infer(load)
            state["message"] = ""
            logging.info("%s ready; one shared streaming model", args.model)
        except Exception:
            logging.exception("Qwen load failed")
            state["message"] = "Qwen 加载失败，请检查 CUDA、模型目录和显存预算，然后重启识别服务。"

    async def lifecycle(_app):
        if args.managed:
            def watch_launcher():
                sys.stdin.buffer.read()
                os.kill(os.getpid(), signal.SIGTERM)

            Thread(target=watch_launcher, daemon=True).start()
        task = asyncio.create_task(load_model())
        yield
        if state["active"] is not None:
            await state["active"].close()
        await task
        executor.shutdown(wait=True)

    app = web.Application(middlewares=[authorize], client_max_size=1280)
    app.cleanup_ctx.append(lifecycle)
    app.router.add_get("/health", health)
    app.router.add_get("/asr", audio)
    web.run_app(app, host=args.host, port=args.port, handler_cancellation=False)


if __name__ == "__main__":
    main()
