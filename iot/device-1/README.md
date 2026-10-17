# Slop — Pencegah Parkir Liar & PKL di Bahu Jalan (ESP32 + MQTT)

Firmware ESP32 yang memantau bahu jalan dengan sensor ultrasonik (HC-SR04) yang diputar servo. Jika ada objek (kendaraan/lapak) berada dalam jarak toleransi **lebih lama dari batas waktu**, perangkat mengirim **alert** lewat MQTT.

Satu perangkat dapat menjalankan **beberapa unit radar** (sensor + servo) sekaligus. Unit tambahan dapat **ditambah** (`config/set`) dan **dihapus** (`config/unset`) dari jarak jauh tanpa mengganggu unit lain.

## Daftar Isi

1. [Konsep Unit & unitId](#konsep-unit--unitid)
2. [Perangkat Keras & Pengkabelan](#perangkat-keras--pengkabelan)
3. [Struktur Proyek](#struktur-proyek)
4. [Memulai](#memulai)
5. [Referensi Topik MQTT](#referensi-topik-mqtt)
6. [Tutorial MQTT Langkah demi Langkah](#tutorial-mqtt-langkah-demi-langkah)
7. [Aturan Pin](#aturan-pin)
8. [Cara Kerja Deteksi](#cara-kerja-deteksi)
9. [Kode Hasil Operasi (`setupResult`)](#kode-hasil-operasi-setupresult)
10. [Troubleshooting](#troubleshooting)
11. [Catatan Keamanan](#catatan-keamanan)

---

## Konsep Unit & unitId

- **Unit** = satu sensor ultrasonik (TRIG + ECHO) + satu servo penyapu. Tiap unit punya state deteksi, telemetry, dan alert sendiri.
- **Unit default** (`unitId` 0) memakai pin bawaan kode (TRIG 22, ECHO 21, servo 23) dan selalu aktif sejak boot.
- **Unit dinamis** ditambahkan lewat `config/set` dan dihapus lewat `config/unset`. Total maksimum **4 unit** termasuk default (`MAX_UNITS` di `main.cpp`).
- **`unitId` = nomor slot (0–3)** dan **tetap** selama unit itu ada. Menghapus satu unit tidak menggeser id unit lain. Slot kosong terkecil dipakai oleh `config/set` berikutnya, jadi sebuah `unitId` bisa dipakai ulang oleh unit baru setelah di-unset.
- Unit yang di-unset **dihapus total**: servo di-detach, semua pin dikembalikan ke high-Z (bebas dipakai lagi), sensor tidak dibaca lagi, dan unit tidak muncul di status, telemetry, maupun alert.
- **`unitId` 0 (unit default) permanen:** `config/unset` yang memuat id 0 selalu ditolak dengan `cannot_unset_default`, termasuk bila id 0 hanya salah satu isi array (maka seluruh permintaan dibatalkan).
- Unit dinamis **tidak disimpan** di flash: setelah ESP32 restart, hanya unit default yang aktif.
- `tolerant_distance_cm` dan `timeout_seconds` berlaku untuk **semua** unit.
- `hasSetup` adalah status **per unit**: `true` bila hardware unit berhasil di-setup (servo ter-attach), `false` bila gagal.

## Perangkat Keras & Pengkabelan

| Komponen | Pin ESP32 (unit default) |
|---|---|
| HC-SR04 TRIG | GPIO 22 |
| HC-SR04 ECHO | GPIO 21 |
| Servo (sinyal PWM) | GPIO 23 |
| HC-SR04 VCC / Servo V+ | 5V |
| GND | GND |

> **Perhatian:** ECHO HC-SR04 mengeluarkan 5 V, sedangkan GPIO ESP32 hanya toleran 3,3 V. Pada perangkat keras asli gunakan pembagi tegangan atau level shifter pada jalur ECHO. Di Wokwi hal ini tidak diperlukan.

**Kabel harus mengikuti konfigurasi.** Firmware hanya mengatur pin di software. Unit yang ditambah lewat `config/set` baru berfungsi bila sensor dan servo-nya benar-benar terpasang ke pin yang Anda kirim. `diagram.json` pada repo ini sudah memuat **satu unit tambahan** (servo2 + ultrasonic2) yang dikabel ke **TRIG 25, ECHO 26, servo 27**, sehingga payload contoh di bawah langsung bisa diuji di Wokwi. Untuk unit lain, tambahkan komponen dan kabelnya di diagram.

## Struktur Proyek

```
Slop/
├── src/main.cpp          # firmware utama
├── platformio.ini        # board esp32dev, framework arduino
├── diagram.json          # rangkaian Wokwi (unit default + 1 unit tambahan di 25/26/27)
├── wokwi.toml            # konfigurasi simulasi Wokwi
├── docker-compose.yaml   # Mosquitto broker + MQTTX Web
└── mq/                   # config, data, log broker
```

Dependensi (otomatis oleh PlatformIO): `ESP32Servo`, `knolleary/PubSubClient@^2.8`, `bblanchon/ArduinoJson@^7.2.2`.

## Memulai

### 1. Jalankan broker MQTT

```bash
docker compose up -d
```

| Layanan | Alamat | Keterangan |
|---|---|---|
| Mosquitto (MQTT) | `localhost:1883` | dipakai ESP32 |
| Mosquitto (WebSocket) | `localhost:9001` | dipakai MQTTX Web |
| MQTTX Web UI | <http://localhost:8088> | klien MQTT berbasis browser |

User broker: `sicuser` (password ada di `main.cpp`; hash-nya di `mq/config/passwd`).

### 2. Build & jalankan firmware

```bash
pio run                      # build
pio run -t upload            # upload ke ESP32 asli
pio device monitor           # serial monitor 115200
```

Untuk simulasi Wokwi, build dulu (`pio run`) lalu mulai simulasi dari VS Code. Firmware mengakses broker lokal lewat `host.wokwi.internal`, yang memerlukan fitur gateway Wokwi agar simulasi bisa menjangkau `localhost` di komputer Anda (lihat dokumentasi Wokwi). Pada ESP32 asli, ubah `MQTT_HOST`, `WIFI_SSID`, dan `WIFI_PASSWORD` di `main.cpp`.

### 3. Identitas perangkat

Ganti `DEVICE_ID` di `main.cpp`. Semua topik memakai ID ini; pada contoh di bawah `<ID>` berarti nilai `DEVICE_ID` Anda.

## Referensi Topik MQTT

Semua topik berawalan `iot/<ID>/`.

| Topik | Arah | Fungsi |
|---|---|---|
| `config/set` | broker → ESP32 | **Tambah** satu unit (sensor + servo) + parameter opsional |
| `config/unset` | broker → ESP32 | **Hapus** unit dinamis berdasarkan `unitId` |
| `config/general` | broker → ESP32 | Ubah parameter kapan saja (tidak menyentuh pin/unit) |
| `config/status` | ESP32 → broker | Hasil operasi terakhir + daftar unit aktif beserta pin-nya |
| `telemetry` | ESP32 → broker | Data sensor tiap 5 detik, **satu pesan per unit aktif** |
| `alert` | ESP32 → broker | Peringatan saat objek terkonfirmasi pada sebuah unit |

### Payload `config/set` — tambah unit

```json
{
  "sensor": { "type": "ultrasonic", "trig_pin": 25, "echo_pin": 26 },
  "servo":  { "pin": 27 },
  "tolerant_distance_cm": 10,
  "timeout_seconds": 300,
  "longitude": 106.845599,
  "latitude": -6.208763
}
```

| Field | Wajib | Keterangan |
|---|---|---|
| `sensor.trig_pin`, `sensor.echo_pin`, `servo.pin` | **ya, ketiganya** | Satu unit baru butuh ketiga pin; jika kurang, ditolak `incomplete_unit` |
| `sensor.type` | tidak | Diabaikan (hanya sensor ultrasonik yang didukung) |
| `tolerant_distance_cm` | tidak | Jarak maksimum objek dianggap terdeteksi; lebih dari 0 dan maksimal 400. Berlaku untuk semua unit |
| `timeout_seconds` | tidak | Lama objek harus bertahan sebelum alert; 1–86400. Berlaku untuk semua unit |
| `longitude`, `latitude` | tidak | Lokasi yang disertakan pada alert (semua unit) |

**Nama field alternatif yang juga diterima** (urutan prioritas dari atas ke bawah):

| Peran | Lokasi/nama yang dicari |
|---|---|
| TRIG | `sensor.trig_pin`, `sensor.trigPin`, `sensor.trig`, `trig_pin`, `trigPin`, `trig`, `servo.trigPin` |
| ECHO | `sensor.echo_pin`, `sensor.echoPin`, `sensor.echo`, `echo_pin`, `echoPin`, `echo`, `servo.echoPin` |
| Servo | `servo.pin`, `servo.servo_pin`, `servo.servoPin`, `servo_pin`, `servoPin`, `servo` (angka langsung) |

Nilai pin boleh angka (`25`) atau string angka (`"25"`). Validasi bersifat all-or-nothing: bila ada satu field tidak valid, tidak ada unit yang ditambahkan dan hardware tidak disentuh.

### Payload `config/unset` — hapus unit

```json
{ "unitId": 1 }
```

```json
{ "unitId": [1, 2] }
```

- Nama field lain yang diterima: `unit_id`, `unitIds`, `unit_ids`. Nilai boleh angka atau string angka; id kembar dalam satu payload dianggap satu.
- **All-or-nothing:** bila ada satu `unitId` bermasalah (tidak ada, di luar rentang, atau unit default), **tidak ada** unit yang dihapus.
- Hanya unit dinamis (`unitId` 1–3) yang bisa dihapus; `unitId` 0 ditolak dengan `cannot_unset_default`.

### Payload `config/general`

Semua field opsional; hanya field yang dikirim yang diubah.

```json
{ "tolerant_distance_cm": 15, "timeout_seconds": 120 }
```

Format lama `tolerantDistanceCm`, `timeoutSeconds`, dan `timeoutInMillis` (milidetik) tetap diterima. Jika payload tidak valid, perubahan ditolak dan alasannya hanya dicetak ke Serial Monitor (tidak dipublikasikan).

### Payload `config/status` (dari ESP32)

Contoh setelah `unset` unit 1 (unit default dan unit 2 masih aktif):

```json
{
  "deviceId": "a4ca5bbb-f98c-4add-af1e-a498c9868dcc",
  "lastOperation": "unset",
  "setupResult": "unset_ok",
  "unitCount": 2,
  "units": [
    { "unitId": 0, "source": "default", "hasSetup": true, "detectionState": "scanning",
      "pins": { "trig": 22, "echo": 21, "servo": 23 } },
    { "unitId": 2, "source": "dynamic", "hasSetup": true, "detectionState": "scanning",
      "pins": { "trig": 32, "echo": 33, "servo": 14 } }
  ],
  "tolerantDistanceCm": 10,
  "timeoutSeconds": 300,
  "timestamp": 1500,
  "detail": "unit dihapus: 1 (sisa 2 unit)"
}
```

- `lastOperation`: `boot`, `set`, atau `unset` (operasi config terakhir). `setupResult` adalah hasil operasi itu.
- `units` hanya memuat unit **aktif**; unit yang sudah di-unset tidak muncul lagi (dan pin-nya tidak lagi dilaporkan).
- `detail` berisi penjelasan singkat (alasan penolakan atau ringkasan unit yang dihapus).
- Saat operasi gagal, status juga memuat `receivedKeys` (key tingkat-atas payload yang diterima) dan, untuk beberapa error, `hint` berisi format yang diharapkan.
- Status dikirim setiap kali ESP32 (re)connect ke broker dan setiap kali ada hasil `config/set` atau `config/unset` (berhasil maupun ditolak).

### Payload `telemetry`

Satu pesan per unit aktif setiap 5 detik (dan segera setelah `config/set` berhasil):

```json
{
  "unitId": 2, "source": "dynamic", "hasSetup": true,
  "sensorStatus": "object_not_detected", "distanceCm": 999.9,
  "servoPosition": 120, "detectionState": "scanning", "timestamp": 15000
}
```

`distanceCm` bernilai `999.9` bila tidak ada echo. `sensorStatus` adalah `object_detected` bila ada echo pada sampel terakhir, terlepas dari batas `tolerant_distance_cm`.

### Payload `alert`

```json
{
  "unitId": 2,
  "eventName": "object_detected",
  "alertType": "warning",
  "alertMessage": "An object has been detected and confirmed.",
  "timestamp": 320000,
  "distanceCm": 8.7,
  "location": { "longitude": 106.845599, "latitude": -6.208763 }
}
```

> `timestamp` pada semua payload adalah `millis()` sejak boot, **bukan** waktu epoch. Konversi ke waktu nyata dilakukan di sisi server.

## Tutorial MQTT Langkah demi Langkah

Contoh memakai `mosquitto_pub`/`mosquitto_sub` di dalam container broker (tanpa instal apa pun). Siapkan variabel:

```bash
ID=a4ca5bbb-f98c-4add-af1e-a498c9868dcc
AUTH="-u sicuser -P s1cu53rp455w0rd"
```

### Langkah 1 — Pantau semua pesan perangkat

Di terminal pertama, biarkan berjalan:

```bash
docker exec -it mqtt-broker mosquitto_sub $AUTH -t "iot/$ID/#" -v
```

Setelah ESP32 tersambung muncul status pertama (`"lastOperation":"boot"`, `unitCount: 1`) lalu telemetry unit 0 tiap 5 detik.

### Langkah 2 — Tambah unit

Di terminal kedua (pin 25/26/27 sesuai kabel pada `diagram.json`):

```bash
docker exec mqtt-broker mosquitto_pub $AUTH -t "iot/$ID/config/set" -m '{
  "sensor": {"type":"ultrasonic","trig_pin":25,"echo_pin":26},
  "servo": {"pin":27},
  "tolerant_distance_cm": 50,
  "timeout_seconds": 10
}'
```

Hasil: status `"setupResult":"ok"` dengan `unitCount: 2` dan unit baru (`unitId: 1`, `source: dynamic`). Servo unit default **tetap menyapu**, dan telemetry kedua unit langsung terkirim.

Tambah unit lagi dengan pin lain (maksimal 4 unit total); unit berikutnya mendapat `unitId` 2, 3, dst.

### Langkah 3 — Hapus unit (unset)

```bash
docker exec mqtt-broker mosquitto_pub $AUTH -t "iot/$ID/config/unset" -m '{"unitId": 1}'
```

Hasil: status `"setupResult":"unset_ok"`, `unitCount: 1`, dan `units` hanya berisi unit default. Serial menampilkan `[CONFIG] unit1 removed, pins released`. Telemetry unit 1 berhenti, servo-nya berhenti bergerak, dan sensor-nya tidak dibaca lagi.

Hapus beberapa sekaligus:

```bash
docker exec mqtt-broker mosquitto_pub $AUTH -t "iot/$ID/config/unset" -m '{"unitId": [1, 2]}'
```

Coba hapus `unitId` 0 untuk melihat penolakan: `{"unitId": 0}` → `cannot_unset_default` (unit default permanen).

### Langkah 4 — Ubah parameter tanpa restart

```bash
docker exec mqtt-broker mosquitto_pub $AUTH -t "iot/$ID/config/general" \
  -m '{"tolerant_distance_cm": 30, "timeout_seconds": 15}'
```

Berlaku untuk semua unit aktif. Konfirmasi muncul di Serial Monitor (`[CONFIG] general updated: ...`).

### Langkah 5 — Picu alert

1. Di Wokwi klik HC-SR04 pada unit yang ingin diuji dan atur jarak **di bawah** `tolerant_distance_cm`. Servo unit itu berhenti dan hitung mundur mulai (Serial: `[DETECT] unit1 object at ...`).
2. Tunggu selama `timeout_seconds`. Pesan muncul di topik `alert` dengan `unitId` yang sesuai, lalu diulang tiap 60 detik.
3. Geser jarak ke atas batas toleransi. Setelah 2 sampel berturut-turut (±0,2 detik) tanpa objek, deteksi unit itu di-reset dan servo-nya menyapu lagi.

### Catatan `retained`

Menambahkan `-r` membuat broker mengirim ulang pesan setiap kali ESP32 subscribe (setiap boot/reconnect).

- Untuk `config/set`, ini membuat unit otomatis ditambahkan setelah restart. Pada reconnect berikutnya pesan yang sama dikirim lagi dan dijawab `pin_conflict_active` (pin sudah dipakai unit itu sendiri), yang tidak berbahaya tetapi menghasilkan status ulang.
- **Jangan** memakai `-r` untuk `config/unset`: pesan itu akan diproses ulang pada setiap reconnect/boot.

Hapus pesan retained dengan pesan kosong: `mosquitto_pub $AUTH -r -n -t "iot/$ID/config/set"`.

### Memakai MQTTX Web (tanpa terminal)

1. Buka <http://localhost:8088>, buat koneksi: host `localhost`, port `9001`, path `/`, username `sicuser`, dan password sesuai konfigurasi (WebSocket `ws://`).
2. Subscribe ke `iot/<ID>/#`.
3. Publish payload JSON di atas ke `config/set`, `config/unset`, atau `config/general`.

## Aturan Pin

Validasi `config/set` dilakukan **sebelum** hardware disentuh; satu pelanggaran membatalkan seluruh penambahan. Berurutan:

1. **Pin harus aman dipakai:** ditolak GPIO 1 dan 3 (UART0 / Serial Monitor), GPIO 6–11 (flash SPI), nomor di luar 0–39, dan pin input-only (34–39) untuk peran output (TRIG dan servo).
2. **Tidak boleh bentrok dengan unit aktif:** pin yang sedang dipakai unit mana pun (default maupun dinamis) ditolak (`pin_conflict_active`, detail menyebut unit dan perannya). Pin milik unit yang sudah di-unset **bebas** dipakai lagi.
3. **Tidak boleh ada duplikat** di dalam payload yang sama (`duplicate_pin`).

## Cara Kerja Deteksi

```
Scanning ──(objek ≤ tolerant_distance_cm)──▶ Tracking ──(bertahan ≥ timeout)──▶ Confirmed
   ▲                                            │                                  │
   └────────(2 sampel berturut-turut tanpa objek)──────────────────────────────────┘
```

Setiap unit aktif punya state machine sendiri:

- **Scanning**: servo menyapu 0–180° (langkah 10° tiap 100 ms) sambil membaca jarak.
- **Tracking**: servo berhenti pada arah objek dan timer berjalan (log progres `[DETECT] unitN tracking x/y s`).
- **Confirmed**: alert dikirim segera, lalu diulang tiap 60 detik (gagal kirim dicoba ulang tiap 5 detik).
- Sensor semua unit dibaca **berurutan** dalam satu siklus 100 ms (tidak menembak bersamaan, jadi tidak saling mengganggu). Timeout echo 20 ms (jangkauan efektif ±3,4 m).

## Kode Hasil Operasi (`setupResult`)

| Nilai | Operasi | Arti |
|---|---|---|
| `default_pins` | boot | Belum ada operasi config; hanya unit default |
| `ok` | set | Unit baru berhasil ditambahkan |
| `unset_ok` | unset | Unit berhasil dihapus |
| `invalid_json` | set/unset | Payload bukan JSON valid |
| `max_units_reached` | set | Sudah mencapai `MAX_UNITS` (4) unit |
| `no_pin_in_payload` | set | Tidak ada field pin yang dikenali |
| `incomplete_unit` | set | Pin kurang dari tiga (trig, echo, servo semuanya wajib) |
| `pin_must_be_integer` | set | Nilai pin bukan bilangan bulat |
| `invalid_pin` | set | Pin di luar jangkauan, pin flash (6–11), atau pin input-only untuk output |
| `reserved_pin` | set | GPIO 1 atau 3 (UART0 / Serial Monitor) |
| `pin_conflict_active` | set | Pin sedang dipakai unit aktif (lihat `detail`) |
| `duplicate_pin` | set | Dua peran pada payload yang sama memakai pin yang sama |
| `tolerant_distance_invalid` / `tolerant_distance_out_of_range` | set | `tolerant_distance_cm` bukan angka atau di luar (0, 400] |
| `timeout_invalid` / `timeout_out_of_range` | set | `timeout_seconds` bukan bilangan bulat atau di luar 1–86400 |
| `no_unit_id_in_payload` | unset | Tidak ada `unitId` (atau array kosong) |
| `unit_id_invalid` | unset | `unitId` bukan bilangan bulat atau di luar 0–3 |
| `unit_not_found` | unset | Slot kosong atau unit sudah di-unset |
| `cannot_unset_default` | unset | `unitId` 0 (unit default) tidak bisa dihapus |

## Troubleshooting

| Gejala | Kemungkinan penyebab & solusi |
|---|---|
| Serial: `[MQTT] failed, rc=5` | Autentikasi ditolak. Cek `MQTT_USERNAME`/`MQTT_PASSWORD` dan `mq/config/passwd`. |
| Serial: `[MQTT] failed, rc=-2` | Broker tidak terjangkau. Pastikan `docker compose ps` menunjukkan broker berjalan dan (di Wokwi) gateway ke `host.wokwi.internal` aktif. |
| Serial: `[MQTT] connection lost, state=-4` berulang, atau log broker `disconnected: exceeded timeout` | ESP32 berhenti mengirim paket lebih lama dari batas keepalive; di Wokwi biasanya karena simulasi lambat/terjeda (mis. jendela tidak terlihat). Firmware otomatis reconnect dan mengirim ulang status. |
| Hitung mundur terasa tidak selesai padahal sudah lewat `timeout_seconds` | `millis()` mengikuti waktu **simulasi**, bukan jam dinding. Pantau log `[DETECT] unitN tracking x/y s`; alert terkirim saat muncul `timeout reached`. Untuk uji cepat pakai `timeout_seconds` 10–15. |
| `setupResult: "no_pin_in_payload"` / `"incomplete_unit"` | Lihat `receivedKeys`, `detail`, dan `hint` pada status; Serial juga mencetak payload mentah (`[MQTT] rx ...`). |
| `setupResult: "pin_conflict_active"` | Pin sedang dipakai unit aktif. Lihat `detail`; gunakan pin lain, atau `unset` unit yang memakainya lebih dulu. |
| `setupResult: "max_units_reached"` | Hapus unit dinamis lewat `config/unset`, lalu tambah lagi. |
| Unit baru tampil di status tetapi servo/sensor tidak merespons | Kabel tidak sesuai pin yang dikirim. Cek Serial `[CONFIG] unitN added: trig=.. echo=.. servo=..` dan pastikan komponen terhubung ke pin itu (di Wokwi, lihat `diagram.json`). |
| `hasSetup: false` pada sebuah unit | Servo gagal attach pada pin itu. Firmware mencoba attach ulang tiap siklus (Serial: `[SERVO] unitN not attached`). |
| `unit_not_found` saat unset | Unit itu sudah tidak aktif, atau `unitId` salah. Cek array `units` pada status terbaru. |
| Jarak selalu `999.9` | Tidak ada echo: periksa wiring TRIG/ECHO unit tersebut. |
| `[MQTT] payload too large` | Payload JSON melebihi 1536 byte. |

## Catatan Keamanan

- `mosquitto.conf` saat ini memakai `allow_anonymous true` bersama `password_file`, sehingga klien **tanpa** username/password tetap bisa terhubung. Untuk produksi ubah menjadi `allow_anonymous false`.
- Siapa pun yang bisa publish ke `config/set` / `config/unset` dapat menambah/menghapus unit perangkat. Batasi lewat ACL Mosquitto.
- Kredensial Wi-Fi dan MQTT tertulis di `main.cpp`. Jangan commit kredensial asli; pertimbangkan build flag atau file konfigurasi yang di-ignore Git.
- Folder `mq/log/` dan `mq/data/` berisi file runtime broker; pertimbangkan menambahkannya ke `.gitignore`.
- Lalu lintas MQTT port 1883 tidak terenkripsi. Untuk jaringan publik, aktifkan TLS (port 8883).