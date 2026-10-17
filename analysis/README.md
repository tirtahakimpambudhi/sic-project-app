# Slop Analytics

Project analisis **terpisah** dari backend: dashboard Streamlit yang dijalankan dari Jupyter Notebook,
dengan data dibaca langsung dari database backend memakai `pandas.read_sql`.
Tidak ada source code backend maupun Django di project ini; cukup akses baca ke database.

```
slop-analytics/
├── notebooks/
│   ├── 00_jalankan_dashboard.ipynb   # menyalakan Streamlit dari notebook, tampil di iframe
│   ├── 01_eksplorasi_data.ipynb      # read_sql, skema, kualitas data awal
│   ├── 02_analisis_alert.ipynb       # kapan, di mana, seberapa cepat ditangani
│   └── 03_telemetri_kualitas_data.ipynb
├── slopdash/
│   ├── data.py        # SQL -> DataFrame (pandas.read_sql + SQLAlchemy)
│   ├── metrics.py     # perhitungan pandas (KPI, heatmap, kelengkapan, celah data)
│   ├── charts.py      # figur Plotly
│   └── launcher.py    # start/stop Streamlit dari dalam notebook
├── app.py             # dashboard Streamlit
└── scripts/           # seed_demo.py (SQLite sintetis), build_notebooks.py
```

Notebook dan dashboard memakai modul `slopdash` yang sama, jadi angkanya selalu konsisten.

## Menjalankan

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # isi koneksi database
jupyter lab                   # buka notebooks/00_jalankan_dashboard.ipynb, jalankan semua cell
```

Cell terakhir di notebook 00 memanggil `launcher.show()`: Streamlit menyala di latar belakang
(port 8501) dan tampil di bawah cell. `launcher.stop()` menghentikannya; otomatis berhenti
saat kernel dimatikan. Dashboard juga bisa dijalankan biasa: `streamlit run app.py`.

### Mode demo tanpa MySQL
```bash
python scripts/seed_demo.py     # membuat demo.sqlite3 dengan skema tabel yang sama
# .env -> DB_URL=sqlite:///demo.sqlite3
```

## Tabel yang dibaca
`devices_device`, `devices_deviceunit`, `devices_telemetrylog`, `devices_alertlog`, dan `accounts_user`
(hanya `username` penanganan alert). Semua kueri ada di `slopdash/data.py` dan hanya `SELECT`.

## Catatan teknis
- Backend menyimpan waktu dalam **UTC**; `data.py` mengonversi ke `TIMEZONE` (Asia/Jakarta) sebelum analisis.
- Telemetri sangat besar (≈17 rb baris/unit/hari): hanya data terbaru sampai batas baris (slider sidebar) yang dimuat, dengan peringatan jika terpotong. Untuk produksi, pertimbangkan tabel agregat per jam.
- Hasil query di-cache 60 detik di dashboard (`st.cache_data`); tombol "Muat ulang data" mengosongkan cache.
- Jika Jupyter berjalan di server jarak jauh, iframe memuat `localhost` milik browser Anda; gunakan port-forward ke 8501 atau buka tautan yang ditampilkan.
- Jika skema backend berubah (mis. varian `core` pada zip asli memakai `last_seen_at` dan `repeat_count`), sesuaikan nama kolom di `slopdash/data.py`.
