@echo off
rem Creates forensics\.venv with everything the synchroniser, tests and evaluation need.
rem The synchroniser and the tests pick this interpreter up automatically; SYNC_PYTHON overrides it.
cd /d "%~dp0"
python -m venv --system-site-packages .venv || exit /b 1
.venv\Scripts\python -m pip install -q -r requirements.txt || exit /b 1
.venv\Scripts\python -c "import openpyxl, pdfplumber, sklearn, numpy; print('environment ready:', openpyxl.__version__, pdfplumber.__version__, sklearn.__version__)"
