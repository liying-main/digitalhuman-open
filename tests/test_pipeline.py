import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from digitalhuman import pipeline
from digitalhuman.station import StationClient, StationError


class PipelineTests(unittest.TestCase):
    def test_existing_audio_skips_script_and_tts(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(pipeline, 'StationClient') as factory:
            audio = Path(tmp) / 'audio.wav'
            portrait = Path(tmp) / 'portrait.mp4'
            audio.write_bytes(b'test audio')
            portrait.write_bytes(b'test portrait')
            client = factory.return_value
            client.submit_avatar.return_value = {'id': 'offline-task'}
            client.wait_avatar.return_value = {'status': 'completed'}
            result = pipeline.run(audio=str(audio), portrait=str(portrait), out_dir=tmp,
                                  with_subtitles=False)
            client.chat.assert_not_called()
            client.tts.assert_not_called()
            client.asr.assert_not_called()
            client.submit_avatar.assert_called_once_with(str(portrait), str(audio))
            client.download_task.assert_called_once()
            self.assertEqual(result['voiceover'], str(audio))

    def test_missing_portrait_rejected_before_cloud(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(pipeline, 'StationClient') as factory:
            audio = Path(tmp) / 'audio.wav'
            audio.write_bytes(b'test')
            with self.assertRaises(StationError):
                pipeline.run(audio=str(audio), portrait='missing.mp4', out_dir=tmp)
            factory.assert_not_called()

    def test_explicit_key_overrides_split_environment_keys(self):
        with patch.dict(os.environ, {'DIGITALHUMAN_API_KEY': 'test-default',
                                    'DIGITALHUMAN_CHAT_KEY': 'test-chat',
                                    'DIGITALHUMAN_TTS_KEY': 'test-tts'}, clear=True):
            explicit = StationClient(api_key='test-explicit')
            self.assertEqual(explicit.chat_api_key, 'test-explicit')
            self.assertEqual(explicit.tts_api_key, 'test-explicit')
            environment = StationClient()
            self.assertEqual(environment.chat_api_key, 'test-chat')
            self.assertEqual(environment.tts_api_key, 'test-tts')


if __name__ == '__main__':
    unittest.main()
