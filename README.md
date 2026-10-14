# Slop — Sistem Pencegahan Parkir Liar & PKL di Bahu Jalan

Django REST + MySQL + MQTT (Mosquitto) + React (Vite, Tailwind). Kontrak MQTT mengikuti firmware ESP32 `main.cpp`
(`iot/<DEVICE_ID>/...`).

## Menjalankan (Docker Compose)

```bash
cp .env.example .env          # ganti semua secret sebelum dipakai di luar laptop
docker compose up --build
```

| Layanan | Alamat |
|---|---|
| Antarmuka web | http://localhost:8080 |
| API Django | http://localhost:8000/api/ |
| Broker MQTT | localhost:1883 (user/sandi dari `.env`, default sama dengan firmware) |

Akun demo (dibuat otomatis, ubah di `.env`): `operator / operator123` dan `satpol / satpol123`.
Perangkat demo `a4ca5bbb-f98c-4add-af1e-a498c9868dcc` ikut terdaftar. Untuk Wokwi, `host.wokwi.internal:1883`
sudah mengarah ke port broker di host.

Pengembangan frontend tanpa Docker: `cd frontend && npm install && npm run dev` (proxy `/api` → `localhost:8000`).

## Arsitektur singkat

```
ESP32 ──telemetry/alert/config/status──▶ Mosquitto ──▶ mqtt-worker (run_mqtt) ──ORM──▶ MySQL
ESP32 ◀──config/set|unset|general────── Mosquitto ◀── Django API (device_service) ◀── React
```

- `mqtt-worker` adalah satu-satunya subscriber (container terpisah, image sama dengan backend), sehingga jumlah
  worker gunicorn tidak menggandakan data. Paho berjalan di thread-nya sendiri; setiap pesan memakai siklus koneksi DB sendiri.
- API hanya **mengirim perintah**. Tabel `DeviceUnit` diperbarui dari laporan `config/status` perangkat, jadi UI
  tidak pernah menampilkan unit yang belum dikonfirmasi hardware. API menjawab `202 Accepted`.
- `device_service` memvalidasi di sisi aplikasi sebelum publish: pin UART0 (1, 3), pin flash (6–11), pin tidak ada,
  pin input-only untuk TRIG/SERVO, bentrok pin dengan unit aktif, maksimum 4 unit, dan `unitId: 0` tidak pernah bisa di-unset.
- Peringatan berulang (firmware mengirim tiap 60 dtk) untuk unit yang sama digabung ke satu baris terbuka
  (`occurrences`) selama `ALERT_MERGE_WINDOW_SECONDS` (default 300).
- Saat perangkat melapor `lastOperation: "boot"` dengan parameter berbeda dari database, backend mengirim ulang `config/general`.

## Endpoint

| Method | Path | Role |
|---|---|---|
| POST | `/api/auth/token/`, `/api/auth/token/refresh/` | publik |
| GET | `/api/auth/me/` | semua |
| GET | `/api/devices/`, `/api/devices/{id}/`, `/api/devices/{id}/telemetry/` | Operator, Satpol PP |
| POST/PATCH/DELETE | `/api/devices/`, `/api/devices/{id}/` (PATCH parameter → `config/general`) | Operator |
| POST | `/api/devices/{id}/units/` (→ `config/set`), `/api/devices/{id}/units/unset/` (→ `config/unset`) | Operator |
| GET | `/api/alerts/?is_resolved=&device=` | Operator, Satpol PP |
| POST | `/api/alerts/{id}/resolve/` | Operator, Satpol PP |

## Catatan produksi

- `TelemetryLog` bertambah satu baris per unit setiap 5 detik. Siapkan job retensi (hapus > 30 hari) sebelum skala besar.
- Perintah `config/*` dikirim tanpa retain agar unit tidak terpasang ulang setiap perangkat reconnect.
- Token JWT disimpan di `localStorage`; untuk deployment publik pertimbangkan cookie HttpOnly dan HTTPS (TLS di Mosquitto juga).
- Dashboard memakai polling 5 detik (berhenti saat tab tersembunyi). Bila butuh latensi lebih rendah, tambahkan Django Channels/SSE.
