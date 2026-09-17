"""Offline cleanup regressions: all process reads, signals and commands are mocked."""
import copy
import io
import json
from pathlib import Path
import signal
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout


CLEANUP = Path(__file__).resolve().parents[1] / 'cleanup.py'
SOURCE = CLEANUP.read_text()
CONTAINERS = [
    'hydro-inkeep-preview-doltgres',
    'hydro-inkeep-preview-postgres',
    'hydro-inkeep-preview-spicedb',
]
MANIFEST = {
    'expiresAt': 1_700_000_000_000,
    'processes': [
        {'role': 'gateway', 'pid': 100001, 'start_ticks': '12345'},
        {'role': 'runtime', 'pid': 100002, 'start_ticks': '23456'},
    ],
    'containers': CONTAINERS,
}


def run_cleanup(manifest, args=(), kill_effect=None, identities=None, proc_exit=None):
    if identities is None:
        identities = {item['pid']: (1000, item['start_ticks']) for item in MANIFEST['processes']}

    def read_text(path, *args, **kwargs):
        if path == CLEANUP.parent / 'lifecycle.json':
            return json.dumps(manifest)
        if path.parent.parent == Path('/proc') and path.name == 'stat':
            pid = int(path.parent.name)
            if pid == 100001 and proc_exit == 'read':
                raise ProcessLookupError('fixture exited during proc read')
            if pid not in identities:
                raise FileNotFoundError(path)
            return f'{pid} (fixture with spaces) ' + ' '.join(['S'] + ['0'] * 18 + [identities[pid][1]])
        raise AssertionError(f'Unexpected file read: {path}')

    cleanup_stat = CLEANUP.stat()

    def stat(path, *args, **kwargs):
        if path == CLEANUP:
            return cleanup_stat
        if path.parent == Path('/proc'):
            pid = int(path.name)
            if pid == 100001 and proc_exit == 'stat':
                raise ProcessLookupError('fixture exited during proc stat')
            if pid not in identities:
                raise FileNotFoundError(path)
            return SimpleNamespace(st_uid=identities[pid][0])
        raise AssertionError(f'Unexpected stat: {path}')

    output = io.StringIO()
    error = None
    with patch('sys.argv', [str(CLEANUP), *args]), \
            patch.object(Path, 'read_text', read_text), \
            patch.object(Path, 'stat', stat), \
            patch('os.getuid', return_value=1000), \
            patch('os.kill', side_effect=kill_effect) as kill, \
            patch('subprocess.run', return_value=SimpleNamespace(returncode=0, stdout='fixture stopped')) as run, \
            patch('time.sleep') as sleep, redirect_stdout(output):
        try:
            exec(compile(SOURCE, str(CLEANUP), 'exec'), {'__file__': str(CLEANUP), '__name__': '__main__'})
        except Exception as exc:
            error = exc
    return SimpleNamespace(error=error, output=output.getvalue(), kill=kill, run=run, sleep=sleep)


class CleanupTests(unittest.TestCase):
    def test_exact_container_allowlist_is_validated_before_any_signals(self):
        for containers in [
            ['unrelated-service', *CONTAINERS[1:]],
            CONTAINERS[:-1],
            [*CONTAINERS, 'unrelated-service'],
            [*CONTAINERS, CONTAINERS[0]],
            ' '.join(CONTAINERS),
            [*CONTAINERS[:-1], None],
            [*CONTAINERS[:-1], []],
        ]:
            with self.subTest(containers=containers):
                manifest = copy.deepcopy(MANIFEST)
                manifest['containers'] = containers
                result = run_cleanup(manifest)
                self.assertEqual(result.kill.call_count, 0, 'validation must precede all signals')
                self.assertEqual(result.run.call_count, 0)
                self.assertIsInstance(result.error, ValueError)

    def test_all_process_entries_are_validated_before_any_signals(self):
        invalid_items = [None, [], {}, *[
            {**MANIFEST['processes'][1], field: value}
            for field, values in [
                ('pid', [None, True, 0, -1, 2.5, '100002']),
                ('start_ticks', [None, 23456, '', '-1', '2.5', ' 23456', '１２３']),
                ('role', [None, '', ' ', 123]),
            ]
            for value in values
        ]]
        for field in ('pid', 'start_ticks', 'role'):
            item = copy.deepcopy(MANIFEST['processes'][1])
            del item[field]
            invalid_items.append(item)
        invalid_items.append(MANIFEST['processes'][0]) # Duplicate PID.
        for item in invalid_items:
            with self.subTest(item=item):
                manifest = copy.deepcopy(MANIFEST)
                manifest['processes'][1] = item
                result = run_cleanup(manifest)
                self.assertEqual(result.kill.call_count, 0, 'a later invalid entry must prevent earlier signals')
                result.run.assert_not_called()
                self.assertIsInstance(result.error, ValueError)

    def test_manifest_shape_and_expiry_are_validated_before_work(self):
        invalid_manifests = [None, [], 'invalid', {}]
        for field in ('expiresAt', 'processes', 'containers'):
            manifest = copy.deepcopy(MANIFEST)
            del manifest[field]
            invalid_manifests.append(manifest)
        for field, values in [
            ('expiresAt', [None, True, 0, -1, 1.5, '1700000000000', float('inf'), float('nan')]),
            ('processes', [None, {}, 'invalid']),
        ]:
            invalid_manifests.extend({**MANIFEST, field: value} for value in values)
        for manifest in invalid_manifests:
            for args in [(), ('--at-expiry',), ('--dry-run',)]:
                with self.subTest(manifest=manifest, args=args):
                    result = run_cleanup(manifest, args=args)
                    result.kill.assert_not_called()
                    result.run.assert_not_called()
                    result.sleep.assert_not_called()
                    self.assertIsInstance(result.error, ValueError)

    def test_valid_manifest_signals_only_owned_original_processes(self):
        result = run_cleanup(MANIFEST)
        self.assertIsNone(result.error)
        self.assertEqual(result.kill.call_args_list, [
            ((100001, signal.SIGTERM),), ((100002, signal.SIGTERM),),
        ])
        result.run.assert_called_once_with(['podman', 'stop', *CONTAINERS], capture_output=True, text=True, timeout=90)
        self.assertEqual([item['action'] for item in json.loads(result.output)[:2]], ['stopped', 'stopped'])

    def test_process_exit_during_signal_does_not_abort_remaining_cleanup(self):
        result = run_cleanup(MANIFEST, kill_effect=[ProcessLookupError('fixture already exited'), None])
        self.assertIsNone(result.error)
        self.assertEqual(result.kill.call_count, 2)
        self.assertEqual(result.kill.call_args_list[-1].args, (100002, signal.SIGTERM))
        result.run.assert_called_once()
        results = json.loads(result.output)
        self.assertEqual(results[0]['action'], 'exited')
        self.assertEqual(results[1]['action'], 'stopped')
        self.assertEqual(results[-1]['container_stop_exit'], 0)

    def test_missing_reused_or_foreign_processes_are_skipped(self):
        for identities in [{}, {100001: (1000, 'changed')}, {100001: (9999, '12345')}]:
            with self.subTest(identities=identities):
                result = run_cleanup(MANIFEST, identities=identities)
                self.assertIsNone(result.error)
                result.kill.assert_not_called()
                result.run.assert_called_once()
                self.assertEqual([item['action'] for item in json.loads(result.output)[:2]], ['skipped', 'skipped'])

    def test_process_exit_during_identity_read_does_not_abort_remaining_cleanup(self):
        for operation in ('read', 'stat'):
            with self.subTest(operation=operation):
                result = run_cleanup(MANIFEST, proc_exit=operation)
                self.assertIsNone(result.error)
                result.kill.assert_called_once_with(100002, signal.SIGTERM)
                result.run.assert_called_once()
                self.assertEqual([item['action'] for item in json.loads(result.output)[:2]], ['skipped', 'stopped'])

    def test_dry_run_never_signals_or_stops_containers(self):
        result = run_cleanup(MANIFEST, args=('--dry-run',))
        self.assertIsNone(result.error)
        result.kill.assert_not_called()
        result.run.assert_not_called()
        self.assertEqual([item['action'] for item in json.loads(result.output)], ['would_stop', 'would_stop'])


if __name__ == '__main__':
    unittest.main()
