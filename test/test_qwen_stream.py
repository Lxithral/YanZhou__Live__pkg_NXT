import sys
from array import array
from pathlib import Path
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from qwen_stream import StreamingSession

VOICE = array("h", [16000] * 640).tobytes()
SILENCE = bytes(1280)


class FakeModel:
    def __init__(self):
        self.starts = 0
        self.feeds = []
        self.finishes = 0

    def init_streaming_state(self, **_kwargs):
        self.starts += 1
        return SimpleNamespace(text="")

    def feed(self, pcm, state):
        self.feeds.append(len(pcm))
        state.text = "欢迎来到烟洲"

    def finish_streaming_transcribe(self, state):
        self.finishes += 1
        state.text = "欢迎来到烟洲。"


class StreamingTests(unittest.TestCase):
    def test_silence_never_invokes_model(self):
        model = FakeModel()
        session = StreamingSession(model)
        for _ in range(1000):
            self.assertIsNone(session.accept(SILENCE))
        self.assertEqual(model.starts, 0)
        self.assertLessEqual(len(session.preroll), 5)

    def test_partial_then_final_uses_audio_time_not_inference_time(self):
        model = FakeModel()
        session = StreamingSession(model)
        for _ in range(49):
            self.assertIsNone(session.accept(VOICE))
        partial = session.accept(VOICE)
        self.assertFalse(partial["final"])
        self.assertEqual(partial["audioMs"], 2000)
        for _ in range(24):
            self.assertIsNone(session.accept(SILENCE))
        final = session.accept(SILENCE)
        self.assertTrue(final["final"])
        self.assertEqual(final["audioMs"], 2000)
        self.assertEqual(final["text"], "欢迎来到烟洲。")
        self.assertIsNone(session.state)
        self.assertEqual(len(session.pending), 0)

    def test_continuous_song_cannot_accumulate_the_whole_show(self):
        model = FakeModel()
        session = StreamingSession(model)
        events = [session.accept(VOICE) for _ in range(900)]
        self.assertEqual(model.starts, 3)
        self.assertEqual(model.finishes, 3)
        self.assertEqual(sum(bool(e and e["final"]) for e in events), 3)
        self.assertIsNone(session.state)
        self.assertLessEqual(max(model.feeds), 64000)

    def test_short_utterance_is_flushed_and_next_speech_is_independent(self):
        model = FakeModel()
        session = StreamingSession(model)
        session.accept(VOICE)
        events = [session.accept(SILENCE) for _ in range(25)]
        self.assertTrue(events[-1]["final"])
        session.accept(VOICE)
        self.assertEqual(model.starts, 2)
        with self.assertRaises(ValueError):
            session.accept(bytes(100))


if __name__ == "__main__":
    unittest.main()
