"""Bounded Qwen streaming utterances. No GPU dependencies are needed to test this layer."""
from array import array
from collections import deque
import math
import sys

SAMPLE_RATE = 16000
FRAME_SAMPLES = 640
FRAME_MS = 40


class StreamingSession:
    def __init__(self, model, *, threshold=0.008, silence_ms=1000, max_utterance_ms=12000):
        self.model = model
        self.threshold = threshold
        self.silence_ms = silence_ms
        self.max_utterance_ms = max_utterance_ms
        self.frames = 0
        self.last_voice = 0
        self.preroll = deque(maxlen=5)
        self._reset()

    def _reset(self):
        self.state = None
        self.pending = bytearray()
        self.started = 0
        self.last_text = ""
        self.preroll.clear()

    def accept(self, pcm):
        if len(pcm) != FRAME_SAMPLES * 2:
            raise ValueError("Expected 40 ms, 16 kHz mono PCM16 frames")
        self.frames += 1
        values = array("h", pcm)
        if sys.byteorder != "little":
            values.byteswap()
        voiced = math.sqrt(sum(value * value for value in values) / len(values)) / 32768 >= self.threshold
        if voiced:
            self.last_voice = self.frames
        if self.state is None:
            if not voiced:
                self.preroll.append(pcm)
                return None
            self.state = self.model.init_streaming_state(chunk_size_sec=2.0, unfixed_chunk_num=2, unfixed_token_num=5)
            self.pending.extend(b"".join(self.preroll))
            self.preroll.clear()
            self.started = self.frames
        self.pending.extend(pcm)
        final = ((self.frames - self.last_voice) * FRAME_MS >= self.silence_ms or
                 (self.frames - self.started + 1) * FRAME_MS >= self.max_utterance_ms)
        decoded = len(self.pending) >= SAMPLE_RATE * 2 * 2
        if decoded or final:
            self.model.feed(bytes(self.pending), self.state)
            self.pending.clear()
            if final:
                self.model.finish_streaming_transcribe(self.state)
            text = " ".join(self.state.text.split())[-500:]
            event = None
            if text and (text != self.last_text or final):
                event = {"text": text, "final": final, "audioMs": self.last_voice * FRAME_MS}
            self.last_text = text
            if final:
                self._reset()
            return event
        return None
