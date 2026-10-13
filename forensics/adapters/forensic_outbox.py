"""Evidence outbox for the Python desktop tools (3D visualizer wrapper, B.I.I.L.).

Appends one JSON line per event to <outbox dir>/<application>.jsonl. The lines
are copied into the hash-chained store by `node forensics/cli.js ingest <dir>`.
Until then they have no integrity protection, and their timestamps come from
this machine's clock.

Capture is fail-open here: these are single-user desktop tools with no server
to refuse an operation, so a failed write is reported on stderr and the tool
carries on. emit() returns False in that case.
"""
import datetime
import getpass
import hashlib
import json
import os
import sys
import uuid

SESSION_ID = str(uuid.uuid4())  # one per process launch


def outbox_dir():
    return os.environ.get('FORENSIC_OUTBOX_DIR') or os.path.join(
        os.environ.get('LOCALAPPDATA') or os.path.expanduser('~'), 'LeadkingForensics', 'outbox')


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def file_artifact(role, path):
    """Describe a file by hash. Missing files are recorded as missing, not skipped."""
    try:
        return {'role': role, 'path': path, 'sha256': sha256_file(path), 'size': os.path.getsize(path)}
    except OSError as err:
        return {'role': role, 'path': path, 'sha256': None, 'error': str(err)}


def emit(application, action, payload=None, shipment_ref=None, artifacts=None, entity_type=None):
    try:
        try:
            user = getpass.getuser()
        except Exception:
            user = None
        record = {
            'source_event_id': str(uuid.uuid4()),
            'occurred_at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
            'application': application,
            'action': action,
            'entity_type': entity_type,
            'shipment_ref': shipment_ref or None,
            'actor_claim': user,                      # OS account name: a claim, not an authenticated identity
            'actor_source': 'os_account_claimed',
            'artifacts': artifacts or [],
            'payload': dict(payload or {}, session_id=SESSION_ID),
        }
        folder = outbox_dir()
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, application + '.jsonl'), 'a', encoding='utf-8') as fh:
            fh.write(json.dumps(record, ensure_ascii=False, default=str) + '\n')
        return True
    except Exception as err:  # capture must never break the tool
        print(f'[forensic] event not captured ({action}): {err}', file=sys.stderr)
        return False
