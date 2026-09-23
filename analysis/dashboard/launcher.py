"""Menjalankan dashboard Streamlit dari dalam Jupyter Notebook (proses latar belakang)."""
from __future__ import annotations

import atexit
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_proc: subprocess.Popen | None = None


def _port_open(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0


def _healthy(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/_stcore/health", timeout=1) as r:
            return r.status == 200
    except Exception:
        return False


def is_running() -> bool:
    return _proc is not None and _proc.poll() is None


def start(port: int = 8501, app: str = "app.py", timeout: float = 60.0) -> str:
    """Start (atau pakai ulang) Streamlit. Mengembalikan URL dashboard."""
    global _proc
    url = f"http://localhost:{port}"
    if is_running() and _healthy(port):
        return url
    if _port_open(port) and not is_running():
        raise RuntimeError(f"Port {port} sudah dipakai proses lain; gunakan port berbeda: start(port=8502)")

    log = open(ROOT / ".streamlit.log", "w")
    _proc = subprocess.Popen(
        [sys.executable, "-m", "streamlit", "run", str(ROOT / app),
         "--server.port", str(port), "--server.headless", "true",
         "--browser.gatherUsageStats", "false"],
        cwd=ROOT, env=os.environ.copy(), stdout=log, stderr=subprocess.STDOUT,
    )
    atexit.register(stop)
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _proc.poll() is not None:
            raise RuntimeError("Streamlit berhenti saat start. Lihat .streamlit.log")
        if _healthy(port):
            return url
        time.sleep(0.5)
    raise TimeoutError("Streamlit belum siap. Lihat .streamlit.log")


def stop() -> None:
    global _proc
    if _proc is not None and _proc.poll() is None:
        _proc.terminate()
        try:
            _proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            _proc.kill()
    _proc = None


def show(port: int = 8501, height: int = 900):
    """Start lalu tampilkan dashboard langsung di dalam output cell (iframe) + tautan."""
    from IPython.display import HTML, IFrame, display

    url = start(port)
    display(HTML(f'Dashboard berjalan di <a href="{url}" target="_blank">{url}</a>'))
    return IFrame(url, width="100%", height=height)
