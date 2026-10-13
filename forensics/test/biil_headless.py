"""Runs B.I.I.L.'s real generate_all() without showing a window, for the adapter test.

Usage: python biil_headless.py <output dir>
Dialogs and the start-up exchange-rate request are stubbed out; nothing else is changed.
The form keeps the sample values the application starts with.
"""
import os
import sys

BIIL = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'B,I,I,L')
sys.path.insert(0, BIIL)
os.chdir(BIIL)  # templates are resolved relative to the application folder

from tkinter import messagebox  # noqa: E402

messagebox.showinfo = lambda *a, **k: None
messagebox.showerror = lambda *a, **k: None

import unified_generator  # noqa: E402

unified_generator.UnifiedGeneratorApp.fetch_live_exchange_rate = lambda self: None  # no network in tests

app = unified_generator.UnifiedGeneratorApp()
app.withdraw()
app.export_path_var.set(sys.argv[1])
app.generate_all()
print(app.log_txt.get('1.0', 'end'))
app.destroy()
