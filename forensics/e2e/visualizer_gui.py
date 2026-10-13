"""Drives the real 3D visualizer window: the built bundle in dist/, a real WebView,
the real JS -> Python bridge and app.Api. A script stands in for the user's hands.

    python visualizer_gui.py <shipment ref>

Evidence lands in FORENSIC_OUTBOX_DIR/visualizer_3d.jsonl. Exit code 0 means the
window loaded and the recalculate button was clicked; the caller checks the outbox.
Not covered: the PDF save dialog (needs a person).
"""
import os
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
VIS = os.path.join(HERE, '..', '..', '3D_stuffing_visualizer')
sys.path.insert(0, VIS)

import webview  # noqa: E402
import app  # noqa: E402

REF = sys.argv[1] if len(sys.argv) > 1 else 'E2E-GUI'
PORT = 24691  # not the application's own port, so a running copy is not disturbed


def drive(window):
    try:
        for _ in range(60):  # wait for the page and its first packing run
            time.sleep(0.5)
            ready = window.evaluate_js("document.readyState === 'complete' && !!document.getElementById('btn-recalculate') && !!(window.pywebview && window.pywebview.api)")
            if ready:
                break
        else:
            os._exit(4)
        time.sleep(1.5)
        window.evaluate_js(f"document.getElementById('shipment-ref').value = {REF!r}; document.getElementById('btn-recalculate').click();")
        time.sleep(3)
    finally:
        window.destroy()


threading.Timer(90, lambda: os._exit(3)).start()  # never hang a test run
threading.Thread(target=app.start_local_server, args=(app.get_build_directory(), PORT), daemon=True).start()
window = webview.create_window('3D visualizer (automated check)', f'http://localhost:{PORT}/?t={int(time.time())}', js_api=app.Api(), width=1280, height=820)
webview.start(drive, window)
os._exit(0)
