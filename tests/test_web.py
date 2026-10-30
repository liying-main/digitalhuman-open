import http.client
import json
import os
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from digitalhuman import web


class WebTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        web.JOBS.clear()
        self.server = ThreadingHTTPServer(('127.0.0.1', 0),
            web.make_handler(self.temp.name, base_url='https://example.invalid/v1', api_key='test-only-key'))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.close)

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        web.JOBS.clear()

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        headers = headers or {}
        if body is not None:
            body = json.dumps(body)
            headers['Content-Type'] = 'application/json'
        conn.request(method, path, body, headers)
        response = conn.getresponse()
        raw = response.read()
        status = response.status
        conn.close()
        return status, json.loads(raw)

    def test_config_does_not_expose_key(self):
        status, data = self.request('GET', '/api/config')
        self.assertEqual(status, 200)
        self.assertTrue(data['has_key'])
        self.assertNotIn('test-only-key', json.dumps(data))

    def test_cross_origin_request_is_rejected(self):
        status, _ = self.request('POST', '/api/generate', {'topic': 'test'},
                                 {'Origin': 'https://evil.invalid'})
        self.assertEqual(status, 403)

    def test_rebinding_host_is_rejected(self):
        status, _ = self.request('GET', '/api/config', headers={'Host': 'evil.invalid'})
        self.assertEqual(status, 403)

    def test_changing_service_does_not_forward_saved_key(self):
        status, _ = self.request('POST', '/api/generate',
                                 {'topic': 'test', 'base_url': 'https://other.invalid/v1'})
        self.assertEqual(status, 400)

    def test_generation_uses_launch_output_and_custom_service(self):
        captured = {}
        ready = threading.Event()
        def capture(job, options):
            captured.update(options)
            ready.set()
        with patch.object(web, '_run_job', side_effect=capture):
            status, data = self.request('POST', '/api/generate', {
                'topic': 'test', 'base_url': 'https://other.invalid/v1',
                'api_key': 'other-test-key', 'out': 'ignored-browser-path'})
            self.assertEqual(status, 200)
            self.assertTrue(ready.wait(3))
            self.assertEqual(captured['out'], self.temp.name)
            self.assertEqual(captured['base_url'], 'https://other.invalid/v1')
            self.assertEqual(captured['api_key'], 'other-test-key')
            status, payload = self.request('GET', '/api/job?id=' + data['id'])
            self.assertNotIn('other-test-key', json.dumps(payload))
            status, _ = self.request('POST', '/api/generate', {'topic': 'second'})
            self.assertEqual(status, 409)


if __name__ == '__main__':
    unittest.main()
