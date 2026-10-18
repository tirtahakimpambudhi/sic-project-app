/**
 * @file main.cpp
 * @brief Pencegah parkir liar & PKL di bahu jalan - HC-SR04 + Servo + Buzzer + MQTT.
 *        Target: ESP32 (classic), ESP32-S3, ESP8266 (NodeMCU V3 / Amica).
 *
 * Satu UNIT = Sensor Ultrasonik (TRIG + ECHO) + Servo Penyapu + Buzzer.
 *
 * Alur kerja:
 *  1. Boot   : UNIT DEFAULT (unitId 0) diinisialisasi, Wi-Fi & MQTT disambungkan.
 *  2. MQTT   : subscribe ke  iot/<id>/config/set      (TAMBAH unit baru)
 *                            iot/<id>/config/unset    (HAPUS unit dinamis berdasarkan unitId)
 *                            iot/<id>/config/general  (parameter, boleh berkali-kali)
 *                            iot/<id>/release         (LEPAS alarm: buzzer mati, alert berhenti)
 *  3. Deteksi: Scanning -> Tracking (objek dalam toleransi, timer jalan) -> Confirmed
 *              (timer habis). Saat Confirmed, flag isObjectDetected = true:
 *                - ALERT dikirim segera dan diulang tiap ALERT_INTERVAL_MS
 *                - BUZZER MENYALA TERUS
 *              Alarm TERKUNCI: tetap aktif walau objek sudah pergi, sampai ada release.
 *  4. Release: payload APA PUN di iot/<id>/release -> isObjectDetected = false,
 *              buzzer mati, alert berhenti, unit kembali Scanning. Bila objek masih
 *              ada, hitung timeout mulai dari awal.
 *  5. Unset  : config/unset valid -> buzzer dimatikan, servo di-detach, semua pin unit
 *              dilepas (high-Z) dan unit dihapus dari daftar.
 *  6. General: perubahan timeout/toleransi LANGSUNG dihitung ulang untuk unit yang
 *              sedang Tracking (waktu berjalan tetap dihitung dari awal deteksi).
 *
 * Validasi pin (ALL-OR-NOTHING, sebelum pinMode / servo.attach):
 *  - Hanya pin pada allowlist tipe mikrokontroler yang boleh dipakai:
 *      ESP32 classic : 4,13,16,17,18,19,21,22,23,25,26,27,32,33
 *      ESP8266       : 4(D2),5(D1),12(D6),13(D7),14(D5)
 *      ESP32-S3      : 1-21, 33-42, 47, 48
 *  - Pin tidak boleh dipakai unit aktif lain, dan tidak boleh kembar dalam satu payload.
 *
 * unitId = nomor slot (0..MAX_UNITS-1), tetap selama unit ada. Slot kosong dipakai
 * lagi oleh config/set berikutnya (slot terkecil). unitId 0 PERMANEN
 * (config/unset untuk id 0 ditolak: cannot_unset_default).
 *
 * Catatan kapasitas pin: tiap unit memakai 4 pin. ESP32 classic punya 14 pin
 * allowlist -> maksimal 3 unit; ESP8266 punya 5 pin -> hanya unit default.
 *
 * Contoh payload config/set (SEMUA pin wajib):
 *  {
 *    "sensor": { "type": "ultrasonic", "trig_pin": 25, "echo_pin": 26 },
 *    "servo":  { "pin": 27 },
 *    "buzzer": { "pin": 32 },
 *    "tolerant_distance_cm": 10,
 *    "timeout_seconds": 300,
 *    "longitude": 106.845599, "latitude": -6.208763
 *  }
 *
 * Contoh payload config/unset:
 *  { "unitId": 1 }   atau   { "unitId": [1, 2] }
 *  (nama lain yang diterima: unit_id, unitIds, unit_ids)
 *
 * Contoh payload config/general (minimal satu field, berlaku untuk semua unit):
 *  { "tolerant_distance_cm": 15, "timeout_seconds": 120 }
 *
 * Contoh payload release (topik iot/<id>/release):
 *  {}  /  payload kosong  / data apa pun -> lepas SEMUA unit yang sedang alarm
 *  { "unitId": 1 }  /  { "unitId": [1, 2] } -> lepas unit tertentu
 *
 * Buzzer: BUZZER_USE_TONE = true (default) -> nada kotak BUZZER_TONE_HZ via LEDC/tone(),
 * wajib untuk buzzer pasif dan buzzer Wokwi. false -> buzzer aktif cukup HIGH/LOW.
 */

#include <Arduino.h>
#include <stdarg.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

#if defined(ESP8266)
#include <ESP8266WiFi.h>
#include <Servo.h>
#else
#include <WiFi.h>
#include <ESP32Servo.h>
#endif

// =============================================================================
// 0. TIPE MIKROKONTROLER (terdeteksi otomatis dari board PlatformIO)
// =============================================================================

#if defined(ESP8266)
static const char *DEVICE_TYPE = "ESP8266";
#elif defined(CONFIG_IDF_TARGET_ESP32S3)
static const char *DEVICE_TYPE = "ESP32-S3";
#elif defined(CONFIG_IDF_TARGET_ESP32)
static const char *DEVICE_TYPE = "ESP32";
#else
#error "Board tidak didukung: gunakan ESP32, ESP32-S3, atau ESP8266."
#endif

// =============================================================================
// 1. KONFIGURASI STATIS
// =============================================================================

// --- Jaringan ---
static const char *WIFI_SSID = "Wokwi-GUEST";
static const char *WIFI_PASSWORD = "";
static const char *MQTT_HOST = "host.wokwi.internal";
static const uint16_t MQTT_PORT = 1883;
static const char *MQTT_USERNAME = "sicuser";
static const char *MQTT_PASSWORD = "s1cu53rp455w0rd";

// --- Identitas perangkat ---
static const char *DEVICE_ID = "e5bf08a0-137f-4451-a33c-f3f551c5312b";
static const double DEFAULT_LONGITUDE = 110.330488;
static const double DEFAULT_LATITUDE = -7.885930;

// --- Pin unit DEFAULT (harus termasuk allowlist tipe board-nya) ---
#if defined(ESP8266)
static const uint8_t DEFAULT_TRIG_PIN = 12;   // D6
static const uint8_t DEFAULT_ECHO_PIN = 14;   // D5 (HC-SR04 5V: pakai level shifter/pembagi tegangan)
static const uint8_t DEFAULT_SERVO_PIN = 13;  // D7
static const uint8_t DEFAULT_BUZZER_PIN = 5;  // D1
#elif defined(CONFIG_IDF_TARGET_ESP32S3)
static const uint8_t DEFAULT_TRIG_PIN = 4;
static const uint8_t DEFAULT_ECHO_PIN = 5;
static const uint8_t DEFAULT_SERVO_PIN = 6;
static const uint8_t DEFAULT_BUZZER_PIN = 7;
#else // ESP32 classic
static const uint8_t DEFAULT_TRIG_PIN = 22;
static const uint8_t DEFAULT_ECHO_PIN = 21;
static const uint8_t DEFAULT_SERVO_PIN = 23;
static const uint8_t DEFAULT_BUZZER_PIN = 19;
#endif

// --- Jumlah unit maksimum (termasuk default) ---
static const uint8_t MAX_UNITS = 4;
static_assert(MAX_UNITS <= 8, "unset/release memakai bitmask 8-bit");
static const uint8_t ALL_UNITS_MASK = static_cast<uint8_t>((1u << MAX_UNITS) - 1u);

// --- unitId 0 = unit default (bawaan kode): PERMANEN, tidak bisa di-unset ---
static const uint8_t DEFAULT_UNIT_ID = 0;

// --- Parameter deteksi DEFAULT ---
static const float DEFAULT_TOLERANT_DISTANCE_CM = 10.0f;
static const unsigned long DEFAULT_TIMEOUT_MS = 300000UL; // 5 menit

// --- Interval & batas (semua berbasis millis) ---
static const unsigned long WIFI_RETRY_MS = 15000UL;
static const unsigned long MQTT_RETRY_MS = 5000UL;
static const unsigned long SENSOR_INTERVAL_MS = 100UL; // siklus sekuensial semua unit
static const unsigned long TELEMETRY_INTERVAL_MS = 5000UL;
static const unsigned long ALERT_INTERVAL_MS = 60000UL;
static const unsigned long ALERT_RETRY_MS = 5000UL;
static const unsigned long TRACK_LOG_INTERVAL_MS = 10000UL;
static const uint8_t OBJECT_LOST_SAMPLES = 2;

// --- Sensor, servo, buzzer ---
static const float NO_ECHO_CM = 999.9f;
static const unsigned long ECHO_TIMEOUT_US = 20000UL; // ~3,4 m; 4 unit berurutan tetap muat di 100 ms
static const int SERVO_STEP_DEG = 10;
static const int SERVO_MIN_US = 500;
static const int SERVO_MAX_US = 2400;
static const uint8_t BUZZER_ON_LEVEL = HIGH;
static const uint8_t BUZZER_OFF_LEVEL = LOW;
// true  = buzzer PASIF / buzzer Wokwi: digerakkan gelombang kotak BUZZER_TONE_HZ (HARUS true di Wokwi)
// false = buzzer AKTIF sungguhan (ada osilator internal): cukup level HIGH/LOW
static const bool BUZZER_USE_TONE = true;
static const uint32_t BUZZER_TONE_HZ = 2000;
static const uint8_t BUZZER_PWM_RES_BITS = 8;
#if !defined(ESP8266) && !(defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3)
// Arduino-ESP32 2.x: channel LEDC dipilih manual dari ujung atas agar tidak bentrok dengan
// channel servo (ESP32Servo memakai channel dari 0 ke atas). Unit i memakai FIRST_CHANNEL + i.
#if defined(CONFIG_IDF_TARGET_ESP32S3)
static const uint8_t BUZZER_LEDC_FIRST_CHANNEL = 4; // S3 hanya punya 8 channel
#else
static const uint8_t BUZZER_LEDC_FIRST_CHANNEL = 12;
#endif
#endif

// --- MQTT ---
static const uint16_t MQTT_BUFFER_SIZE = 2048;
static const size_t JSON_BUFFER_SIZE = 1536;
static const size_t TOPIC_MAX_LEN = 96;

/** Log ke Serial dengan akhiran \r\n agar terminal Wokwi rapi. */
static void logLine(const char *fmt, ...)
{
  char buf[200];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buf, sizeof(buf), fmt, args);
  va_end(args);
  Serial.print(buf);
  Serial.print("\r\n");
}

// =============================================================================
// 2. TIPE DATA
// =============================================================================

/** Peran setiap pin dalam satu unit. */
enum PinRole : uint8_t
{
  ROLE_TRIG = 0,
  ROLE_ECHO,
  ROLE_SERVO,
  ROLE_BUZZER,
  ROLE_COUNT
};

static const char *const ROLE_NAMES[ROLE_COUNT] = {
    "ultrasonic_trig", "ultrasonic_echo", "servo_pwm", "buzzer"};

/** Permintaan unit baru hasil parsing payload config/set. */
struct PinRequest
{
  bool has[ROLE_COUNT] = {};
  int value[ROLE_COUNT] = {};
};

/** Permintaan perubahan parameter hasil parsing payload (set/general). */
struct ParamUpdate
{
  bool hasTolerance = false;
  float toleranceCm = 0;
  bool hasTimeout = false;
  unsigned long timeoutMs = 0;
  bool hasLongitude = false;
  double longitude = 0;
  bool hasLatitude = false;
  double latitude = 0;

  bool hasAny() const { return hasTolerance || hasTimeout || hasLongitude || hasLatitude; }
};

/** Parameter operasional (berlaku untuk semua unit). */
struct RuntimeConfig
{
  float tolerantDistanceCm;
  unsigned long timeoutMs;
  double longitude;
  double latitude;
};

/** State machine deteksi objek (per unit). */
enum class DetectionState : uint8_t
{
  Scanning,  // servo menyapu, belum ada objek
  Tracking,  // objek dalam jangkauan, timer berjalan, servo berhenti
  Confirmed  // timer habis -> alarm TERKUNCI sampai release (alert + buzzer)
};

/**
 * Satu unit = sensor ultrasonik + servo + buzzer, lengkap dengan state deteksinya.
 * Slot dengan active == false dilewati SEMUA proses.
 */
struct Unit
{
  bool active = false;                 // false = slot kosong / unit sudah di-unset
  bool dynamic = false;                // false = default, true = ditambah via MQTT
  bool hasSetup = false;               // true bila hardware unit ini berhasil di-setup (servo attached)
  uint8_t pin[ROLE_COUNT] = {};        // trig, echo, servo, buzzer
  Servo servo;

  // Alarm terkunci: true -> alert berkala + buzzer terus menyala, sampai di-release.
  bool isObjectDetected = false;
  bool buzzerOn = false;

  DetectionState state = DetectionState::Scanning;
  unsigned long detectionStartMs = 0;
  uint8_t missedSamples = 0;
  float lastDistanceCm = NO_ECHO_CM;
  int servoAngle = 0;
  int servoDirection = SERVO_STEP_DEG;
  unsigned long lastTrackLogMs = 0;
  unsigned long nextAlertAtMs = 0;
};

// =============================================================================
// 3. STATE GLOBAL
// =============================================================================

static Unit units[MAX_UNITS]; // indeks = unitId
static uint8_t unitCount = 0; // jumlah unit AKTIF (bukan jumlah slot)

static RuntimeConfig cfg = {
    DEFAULT_TOLERANT_DISTANCE_CM, DEFAULT_TIMEOUT_MS,
    DEFAULT_LONGITUDE, DEFAULT_LATITUDE};

static WiFiClient wifiClient;
static PubSubClient mqtt(wifiClient);

static char topicTelemetry[TOPIC_MAX_LEN];
static char topicAlert[TOPIC_MAX_LEN];
static char topicGeneral[TOPIC_MAX_LEN];
static char topicSet[TOPIC_MAX_LEN];
static char topicUnset[TOPIC_MAX_LEN];
static char topicRelease[TOPIC_MAX_LEN];
static char topicStatus[TOPIC_MAX_LEN];

static bool statusPending = false;
static bool telemetryForce = false;        // kirim telemetry segera (unit baru / release)
static const char *lastOperation = "boot"; // "set" / "unset" / "general" / "release"
static char setupResult[40] = "default_pins"; // hasil operasi TERAKHIR
static char opDetail[96] = "";                // penjelasan singkat hasil operasi terakhir
static char receivedKeys[96] = "";

static unsigned long lastWifiAttemptMs = 0;
static unsigned long lastMqttAttemptMs = 0;
static unsigned long lastSensorMs = 0;
static unsigned long lastTelemetryMs = 0;
static bool wifiAttempted = false;
static bool mqttAttempted = false;
static bool mqttWasConnected = false;

// =============================================================================
// 4. VALIDASI PIN BERDASARKAN TIPE MIKROKONTROLER
// =============================================================================

/** Allowlist pin aman sesuai DEVICE_TYPE (berlaku untuk trig, echo, servo, buzzer). */
static bool isAllowedPin(int pin)
{
#if defined(ESP8266)
  switch (pin)
  {
  case 4:  // D2
  case 5:  // D1
  case 12: // D6
  case 13: // D7
  case 14: // D5
    return true;
  default:
    return false;
  }
#elif defined(CONFIG_IDF_TARGET_ESP32S3)
  return (pin >= 1 && pin <= 21) || (pin >= 33 && pin <= 42) || pin == 47 || pin == 48;
#else // ESP32 classic
  switch (pin)
  {
  case 4:
  case 13:
  case 16:
  case 17:
  case 18:
  case 19:
  case 21:
  case 22:
  case 23:
  case 25:
  case 26:
  case 27:
  case 32:
  case 33:
    return true;
  default:
    return false;
  }
#endif
}

/** Kode error untuk pin yang TIDAK ada di allowlist (alasan spesifik per tipe board). */
static const char *pinRejectionCode(int pin)
{
#if defined(ESP8266)
  if (pin == 1 || pin == 3 || (pin >= 6 && pin <= 11))
    return "reserved_pin"; // UART0 / flash SPI
  if (pin == 0 || pin == 2 || pin == 15 || pin == 16)
    return "strapping_pin";
#elif defined(CONFIG_IDF_TARGET_ESP32S3)
  if (pin == 0 || pin == 45 || pin == 46)
    return "strapping_pin";
  if (pin >= 26 && pin <= 32)
    return "reserved_pin"; // flash / PSRAM
#else
  if (pin == 1 || pin == 3 || (pin >= 6 && pin <= 11))
    return "reserved_pin"; // UART0 / flash SPI
  if (pin >= 34 && pin <= 39)
    return "input_only_pin";
#endif
  return "pin_not_allowed";
}

/** Validasi permintaan unit baru TANPA menyentuh hardware. @return nullptr bila valid. */
static const char *validateNewUnit(const PinRequest &req)
{
  opDetail[0] = '\0';

  // 1. Setiap pin harus ada di allowlist tipe mikrokontroler.
  for (uint8_t r = 0; r < ROLE_COUNT; r++)
  {
    const int pin = req.value[r];
    if (!isAllowedPin(pin))
    {
      snprintf(opDetail, sizeof(opDetail), "%s: GPIO%d tidak diizinkan di %s",
               ROLE_NAMES[r], pin, DEVICE_TYPE);
      return pinRejectionCode(pin);
    }
  }

  // 2. Pin tidak boleh dipakai unit AKTIF mana pun (pin unit yang di-unset bebas).
  for (uint8_t r = 0; r < ROLE_COUNT; r++)
  {
    for (uint8_t u = 0; u < MAX_UNITS; u++)
    {
      if (!units[u].active)
        continue;
      for (uint8_t o = 0; o < ROLE_COUNT; o++)
      {
        if (req.value[r] == units[u].pin[o])
        {
          snprintf(opDetail, sizeof(opDetail), "%s: GPIO%d dipakai unit%u %s (%s)",
                   ROLE_NAMES[r], req.value[r], u, ROLE_NAMES[o],
                   units[u].dynamic ? "dinamis" : "default");
          return "pin_conflict_active";
        }
      }
    }
  }

  // 3. Pin pada payload yang sama tidak boleh kembar.
  for (uint8_t a = 0; a < ROLE_COUNT; a++)
  {
    for (uint8_t b = a + 1; b < ROLE_COUNT; b++)
    {
      if (req.value[a] == req.value[b])
      {
        snprintf(opDetail, sizeof(opDetail), "%s dan %s sama-sama GPIO%d",
                 ROLE_NAMES[a], ROLE_NAMES[b], req.value[a]);
        return "duplicate_pin";
      }
    }
  }
  return nullptr;
}

// =============================================================================
// 5. MANAJEMEN UNIT, BUZZER & ALARM
// =============================================================================

/** Hitung ulang jumlah unit aktif. */
static void refreshUnitCount()
{
  uint8_t n = 0;
  for (uint8_t i = 0; i < MAX_UNITS; i++)
    n += units[i].active ? 1 : 0;
  unitCount = n;
}

/** Cari slot kosong terkecil. @return indeks slot, atau MAX_UNITS bila penuh. */
static uint8_t findFreeSlot()
{
  for (uint8_t i = 0; i < MAX_UNITS; i++)
  {
    if (!units[i].active)
      return i;
  }
  return MAX_UNITS;
}

/** Siapkan pin buzzer (OUTPUT LOW; mode tone: siapkan PWM/LEDC). Dipanggil sebelum dipakai. */
static void buzzerAttach(const Unit &u, uint8_t idx)
{
  (void)idx;
  const uint8_t pin = u.pin[ROLE_BUZZER];
  pinMode(pin, OUTPUT);
  digitalWrite(pin, BUZZER_OFF_LEVEL);
  if (!BUZZER_USE_TONE)
    return;
#if defined(ESP8266)
  // tone() bawaan core tidak perlu attach.
#elif defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  if (!ledcAttach(pin, BUZZER_TONE_HZ, BUZZER_PWM_RES_BITS))
    logLine("[BUZZER] unit%u ledcAttach failed on GPIO%u", idx, pin);
#else
  ledcSetup(BUZZER_LEDC_FIRST_CHANNEL + idx, BUZZER_TONE_HZ, BUZZER_PWM_RES_BITS);
  ledcAttachPin(pin, BUZZER_LEDC_FIRST_CHANNEL + idx);
#endif
}

/** Keluarkan sinyal buzzer: nada BUZZER_TONE_HZ (mode tone) atau level HIGH (mode aktif-DC). */
static void buzzerWrite(const Unit &u, uint8_t idx, bool on)
{
  (void)idx;
  const uint8_t pin = u.pin[ROLE_BUZZER];
  if (!BUZZER_USE_TONE)
  {
    digitalWrite(pin, on ? BUZZER_ON_LEVEL : BUZZER_OFF_LEVEL);
    return;
  }
#if defined(ESP8266)
  if (on)
    tone(pin, BUZZER_TONE_HZ);
  else
  {
    noTone(pin);
    digitalWrite(pin, BUZZER_OFF_LEVEL);
  }
#elif defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWriteTone(pin, on ? BUZZER_TONE_HZ : 0);
#else
  ledcWriteTone(BUZZER_LEDC_FIRST_CHANNEL + idx, on ? BUZZER_TONE_HZ : 0);
#endif
}

/** Matikan buzzer dan lepas PWM-nya (saat unit dihapus). */
static void buzzerRelease(const Unit &u, uint8_t idx)
{
  buzzerWrite(u, idx, false);
  if (!BUZZER_USE_TONE)
    return;
#if defined(ESP8266)
  // tidak ada yang perlu dilepas
#elif defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcDetach(u.pin[ROLE_BUZZER]);
#else
  ledcDetachPin(u.pin[ROLE_BUZZER]);
#endif
}

/** Nyalakan/matikan buzzer unit (hanya menulis pin bila status berubah). */
static void setBuzzer(Unit &u, uint8_t idx, bool on)
{
  if (u.buzzerOn == on)
    return;
  u.buzzerOn = on;
  buzzerWrite(u, idx, on);
  logLine("[BUZZER] unit%u %s", idx, on ? "ON" : "OFF");
}

/** Reset state deteksi satu unit (tidak menyentuh alarm). */
static void resetDetection(Unit &u)
{
  u.state = DetectionState::Scanning;
  u.missedSamples = 0;
  u.detectionStartMs = 0;
}

/** Lepas alarm unit: isObjectDetected = false, buzzer mati, alert berhenti, kembali Scanning. */
static void releaseAlarm(Unit &u, uint8_t idx)
{
  u.isObjectDetected = false;
  u.nextAlertAtMs = 0;
  resetDetection(u);
  setBuzzer(u, idx, false);
  logLine("[ALARM] unit%u released, isObjectDetected=false", idx);
}

/** Attach servo unit (periode 50 Hz di ESP32). @return true bila berhasil. */
static bool attachServo(Unit &u)
{
#if !defined(ESP8266)
  u.servo.setPeriodHertz(50);
#endif
  u.servo.attach(u.pin[ROLE_SERVO], SERVO_MIN_US, SERVO_MAX_US);
  return u.servo.attached();
}

/** Inisialisasi hardware satu unit (pinMode + attach servo) dan reset state-nya. */
static void initUnitHardware(Unit &u, uint8_t idx)
{
  pinMode(u.pin[ROLE_TRIG], OUTPUT);
  digitalWrite(u.pin[ROLE_TRIG], LOW);
  pinMode(u.pin[ROLE_ECHO], INPUT);

  buzzerAttach(u, idx);
  u.buzzerOn = false;
  u.isObjectDetected = false;

  if (attachServo(u))
    u.servo.write(u.servoAngle);
  else
    logLine("[SERVO] attach failed on GPIO%u", u.pin[ROLE_SERVO]);

  u.hasSetup = u.servo.attached(); // status setup PER UNIT
  resetDetection(u);
  u.lastDistanceCm = NO_ECHO_CM;
  u.lastTrackLogMs = 0;
  u.nextAlertAtMs = 0;
}

/**
 * Hapus unit (config/unset): matikan buzzer, detach servo, kembalikan SEMUA pin ke
 * high-Z (INPUT), lalu kosongkan slot. Unit tidak lagi dibaca dan tidak muncul di
 * status/telemetry/alert.
 */
static void removeUnit(uint8_t idx)
{
  if (idx == DEFAULT_UNIT_ID)
    return; // pengaman berlapis: unit default tidak pernah dilepas

  Unit &u = units[idx];

  buzzerRelease(u, idx);
  if (u.servo.attached())
    u.servo.detach();
  for (uint8_t r = 0; r < ROLE_COUNT; r++)
    pinMode(u.pin[r], INPUT);

  u.active = false;
  u.dynamic = false;
  u.hasSetup = false;
  u.buzzerOn = false;
  u.isObjectDetected = false;
  for (uint8_t r = 0; r < ROLE_COUNT; r++)
    u.pin[r] = 0;
  resetDetection(u);
  u.lastDistanceCm = NO_ECHO_CM;
  u.servoAngle = 0;
  u.servoDirection = SERVO_STEP_DEG;
  u.lastTrackLogMs = 0;
  u.nextAlertAtMs = 0;
}

/** Daftarkan unit DEFAULT (unitId 0). Pin divalidasi dulu sebelum hardware disentuh. */
static void initDefaultUnit()
{
  PinRequest req;
  req.value[ROLE_TRIG] = DEFAULT_TRIG_PIN;
  req.value[ROLE_ECHO] = DEFAULT_ECHO_PIN;
  req.value[ROLE_SERVO] = DEFAULT_SERVO_PIN;
  req.value[ROLE_BUZZER] = DEFAULT_BUZZER_PIN;

  const char *err = validateNewUnit(req);
  if (err)
  {
    logLine("[BOOT] default pins invalid for %s: %s (%s)", DEVICE_TYPE, err, opDetail);
    strlcpy(setupResult, "default_pins_invalid", sizeof(setupResult));
    return;
  }

  Unit &u = units[DEFAULT_UNIT_ID];
  u.active = true;
  u.dynamic = false;
  for (uint8_t r = 0; r < ROLE_COUNT; r++)
    u.pin[r] = static_cast<uint8_t>(req.value[r]);
  initUnitHardware(u, DEFAULT_UNIT_ID);
  refreshUnitCount();
}

/** Tambahkan unit baru ke slot kosong (sudah lolos validasi). @return unitId. */
static uint8_t addUnit(const PinRequest &req)
{
  const uint8_t idx = findFreeSlot(); // dijamin < MAX_UNITS oleh pemanggil
  Unit &u = units[idx];
  u.active = true;
  u.dynamic = true;
  for (uint8_t r = 0; r < ROLE_COUNT; r++)
    u.pin[r] = static_cast<uint8_t>(req.value[r]);
  u.servoAngle = 0;
  u.servoDirection = SERVO_STEP_DEG;
  initUnitHardware(u, idx);
  refreshUnitCount();
  return idx;
}

// =============================================================================
// 6. STATE MACHINE DETEKSI (PER UNIT)
// =============================================================================

/** Timeout habis -> kunci alarm: alert pertama langsung, buzzer nyala sampai release. */
static void confirmObject(Unit &u, uint8_t idx, unsigned long now)
{
  u.state = DetectionState::Confirmed;
  u.isObjectDetected = true;
  u.nextAlertAtMs = now;
  logLine("[DETECT] unit%u timeout reached, isObjectDetected=true (alarm latched until release)", idx);
}

/**
 * Update state machine satu unit berdasarkan satu sampel jarak.
 * Confirmed bersifat TERKUNCI: tidak keluar sendiri walau objek pergi, hanya release.
 */
static void updateDetection(Unit &u, uint8_t idx, unsigned long now)
{
  const float distanceCm = u.lastDistanceCm;
  const bool inRange = distanceCm < NO_ECHO_CM && distanceCm <= cfg.tolerantDistanceCm;

  switch (u.state)
  {
  case DetectionState::Scanning:
    if (inRange)
    {
      u.state = DetectionState::Tracking;
      u.detectionStartMs = now;
      u.lastTrackLogMs = now;
      u.missedSamples = 0;
      logLine("[DETECT] unit%u object at %.1f cm, servo stopped, countdown %lu s",
              idx, distanceCm, cfg.timeoutMs / 1000UL);
    }
    break;

  case DetectionState::Tracking:
    if (inRange)
      u.missedSamples = 0;
    else if (++u.missedSamples >= OBJECT_LOST_SAMPLES)
    {
      logLine("[DETECT] unit%u object lost, servo resumes sweep from %d deg", idx, u.servoAngle);
      resetDetection(u);
      break;
    }

    if (now - u.detectionStartMs >= cfg.timeoutMs)
      confirmObject(u, idx, now);
    else if (now - u.lastTrackLogMs >= TRACK_LOG_INTERVAL_MS)
    {
      u.lastTrackLogMs = now;
      logLine("[DETECT] unit%u tracking %lu/%lu s (%.1f cm)",
              idx, (now - u.detectionStartMs) / 1000UL, cfg.timeoutMs / 1000UL, distanceCm);
    }
    break;

  case DetectionState::Confirmed:
    break; // alarm terkunci sampai ada release
  }
}

/**
 * Terapkan perubahan timeout/toleransi ke unit yang SEDANG Tracking, segera dan
 * tanpa menunggu siklus berikutnya. Waktu berjalan tetap dihitung dari
 * detectionStartMs (countdown tidak di-reset maupun dibekukan):
 *  - elapsed >= timeout baru -> langsung Confirmed
 *  - selain itu              -> lanjut menghitung dengan sisa waktu baru
 */
static void retimeTrackingUnits(const ParamUpdate &p)
{
  if (!p.hasTimeout && !p.hasTolerance)
    return;

  const unsigned long now = millis();
  for (uint8_t i = 0; i < MAX_UNITS; i++)
  {
    Unit &u = units[i];
    if (!u.active || u.state != DetectionState::Tracking)
      continue;

    if (p.hasTolerance)
      u.missedSamples = 0; // nilai ulang dengan toleransi baru mulai dari sampel berikutnya
    if (!p.hasTimeout)
      continue;

    const unsigned long elapsed = now - u.detectionStartMs;
    if (elapsed >= cfg.timeoutMs)
    {
      logLine("[DETECT] unit%u new timeout %lu s already passed (elapsed %lu s)",
              i, cfg.timeoutMs / 1000UL, elapsed / 1000UL);
      confirmObject(u, i, now);
    }
    else
    {
      logLine("[DETECT] unit%u new timeout %lu s, elapsed %lu s, remaining %lu s",
              i, cfg.timeoutMs / 1000UL, elapsed / 1000UL, (cfg.timeoutMs - elapsed) / 1000UL);
    }
  }
}

// =============================================================================
// 7. PARSING PAYLOAD
// =============================================================================

/** Ambil field dengan nama utama, fallback ke nama alias (camelCase lama). */
static JsonVariantConst pickKey(JsonVariantConst root, const char *key, const char *alias)
{
  JsonVariantConst v = root[key];
  return v.isNull() ? root[alias] : v;
}

/** Lokasi sebuah field: parent == nullptr berarti di root payload. */
struct FieldPath
{
  const char *parent;
  const char *key;
};

static const FieldPath TRIG_PATHS[] = {
    {"sensor", "trig_pin"}, {"sensor", "trigPin"}, {"sensor", "trig"},
    {nullptr, "trig_pin"}, {nullptr, "trigPin"}, {nullptr, "trig"},
    {"servo", "trigPin"}, {"servo", "trig_pin"}};
static const FieldPath ECHO_PATHS[] = {
    {"sensor", "echo_pin"}, {"sensor", "echoPin"}, {"sensor", "echo"},
    {nullptr, "echo_pin"}, {nullptr, "echoPin"}, {nullptr, "echo"},
    {"servo", "echoPin"}, {"servo", "echo_pin"}};
static const FieldPath SERVO_PATHS[] = {
    {"servo", "pin"}, {"servo", "servo_pin"}, {"servo", "servoPin"},
    {nullptr, "servo_pin"}, {nullptr, "servoPin"}, {nullptr, "servo"}};
static const FieldPath BUZZER_PATHS[] = {
    {"buzzer", "pin"}, {"buzzer", "buzzer_pin"}, {"buzzer", "buzzerPin"},
    {nullptr, "buzzer_pin"}, {nullptr, "buzzerPin"}, {nullptr, "buzzer"}};

/** Cari field pertama yang ada (bukan objek/array) di salah satu lokasi. */
static JsonVariantConst findField(JsonVariantConst root, const FieldPath *paths, size_t count)
{
  for (size_t i = 0; i < count; i++)
  {
    JsonVariantConst v = paths[i].parent ? root[paths[i].parent][paths[i].key]
                                         : root[paths[i].key];
    if (!v.isNull() && !v.is<JsonObjectConst>() && !v.is<JsonArrayConst>())
      return v;
  }
  return JsonVariantConst();
}

/** Baca bilangan bulat dari angka (22) atau string angka ("22"). */
static bool readPinValue(JsonVariantConst v, int &out)
{
  if (v.is<int>())
  {
    out = v.as<int>();
    return true;
  }
  if (v.is<const char *>())
  {
    const char *text = v.as<const char *>();
    char *end = nullptr;
    const long n = strtol(text, &end, 10);
    if (end != text && *end == '\0')
    {
      out = static_cast<int>(n);
      return true;
    }
  }
  return false;
}

/** Baca bilangan (bulat/desimal) dari angka (120, 120.0) atau string angka ("120"). */
static bool readNumber(JsonVariantConst v, double &out)
{
  if (v.is<double>())
  {
    out = v.as<double>();
    return true;
  }
  if (v.is<const char *>())
  {
    const char *text = v.as<const char *>();
    char *end = nullptr;
    const double n = strtod(text, &end);
    if (end != text && *end == '\0')
    {
      out = n;
      return true;
    }
  }
  return false;
}

/** Parsing pin unit baru dari config/set. Keempat pin wajib ada. @return nullptr bila OK. */
static const char *parsePinRequest(JsonVariantConst root, PinRequest &req)
{
  const JsonVariantConst fields[ROLE_COUNT] = {
      findField(root, TRIG_PATHS, sizeof(TRIG_PATHS) / sizeof(TRIG_PATHS[0])),
      findField(root, ECHO_PATHS, sizeof(ECHO_PATHS) / sizeof(ECHO_PATHS[0])),
      findField(root, SERVO_PATHS, sizeof(SERVO_PATHS) / sizeof(SERVO_PATHS[0])),
      findField(root, BUZZER_PATHS, sizeof(BUZZER_PATHS) / sizeof(BUZZER_PATHS[0]))};

  uint8_t found = 0;
  for (uint8_t r = 0; r < ROLE_COUNT; r++)
  {
    if (fields[r].isNull())
      continue;
    if (!readPinValue(fields[r], req.value[r]))
      return "pin_must_be_integer";
    req.has[r] = true;
    found++;
  }
  if (found == 0)
    return "no_pin_in_payload";
  if (found < ROLE_COUNT)
  {
    snprintf(opDetail, sizeof(opDetail),
             "unit baru butuh trig+echo+servo+buzzer, baru ada %u dari %u", found, ROLE_COUNT);
    return "incomplete_unit";
  }
  return nullptr;
}

/** Masukkan satu unitId ke bitmask. @return nullptr bila OK. */
static const char *addIdToMask(JsonVariantConst item, uint8_t &mask)
{
  int id = 0;
  if (!readPinValue(item, id))
  {
    snprintf(opDetail, sizeof(opDetail), "unitId harus bilangan bulat");
    return "unit_id_invalid";
  }
  if (id < 0 || id >= MAX_UNITS)
  {
    snprintf(opDetail, sizeof(opDetail), "unitId %d di luar rentang 0-%u", id, MAX_UNITS - 1);
    return "unit_id_invalid";
  }
  mask |= static_cast<uint8_t>(1u << id);
  return nullptr;
}

/** Cari field unitId (satu angka atau array) di payload. Null bila tidak ada. */
static JsonVariantConst findUnitIdField(JsonVariantConst root)
{
  static const char *const KEYS[] = {"unitId", "unit_id", "unitIds", "unit_ids"};
  for (const char *key : KEYS)
  {
    JsonVariantConst v = root[key];
    if (!v.isNull())
      return v;
  }
  return JsonVariantConst();
}

/** Ubah satu unitId atau array unitId menjadi bitmask. Id kembar dianggap satu. */
static const char *parseUnitIds(JsonVariantConst v, uint8_t &mask)
{
  mask = 0;
  if (v.is<JsonArrayConst>())
  {
    const JsonArrayConst arr = v.as<JsonArrayConst>();
    if (arr.size() == 0)
      return "no_unit_id_in_payload";
    for (JsonVariantConst item : arr)
    {
      const char *err = addIdToMask(item, mask);
      if (err)
        return err;
    }
    return nullptr;
  }
  return addIdToMask(v, mask);
}

/** Parsing payload config/unset: unitId WAJIB ada. @return nullptr bila OK. */
static const char *parseUnsetRequest(JsonVariantConst root, uint8_t &mask)
{
  const JsonVariantConst v = findUnitIdField(root);
  if (v.isNull())
  {
    mask = 0;
    return "no_unit_id_in_payload";
  }
  return parseUnitIds(v, mask);
}

/** Parsing payload release: tanpa unitId = SEMUA unit. @return nullptr bila OK. */
static const char *parseReleaseRequest(JsonVariantConst root, uint8_t &mask, bool &explicitIds)
{
  const JsonVariantConst v = findUnitIdField(root);
  explicitIds = !v.isNull();
  if (!explicitIds)
  {
    mask = ALL_UNITS_MASK;
    return nullptr;
  }
  return parseUnitIds(v, mask);
}

/** Cek semua unitId pada bitmask boleh dihapus (unitId 0 selalu ditolak). */
static const char *validateUnset(uint8_t mask)
{
  for (uint8_t i = 0; i < MAX_UNITS; i++)
  {
    if (!(mask & (1u << i)))
      continue;
    if (i == DEFAULT_UNIT_ID)
    {
      snprintf(opDetail, sizeof(opDetail), "unitId 0 adalah unit default dan tidak bisa di-unset");
      return "cannot_unset_default";
    }
    if (!units[i].active)
    {
      snprintf(opDetail, sizeof(opDetail), "unit%u tidak ditemukan (slot kosong / sudah di-unset)", i);
      return "unit_not_found";
    }
  }
  return nullptr;
}

/** Cek semua unitId yang diminta untuk release adalah unit aktif. */
static const char *validateReleaseTargets(uint8_t mask)
{
  for (uint8_t i = 0; i < MAX_UNITS; i++)
  {
    if ((mask & (1u << i)) && !units[i].active)
    {
      snprintf(opDetail, sizeof(opDetail), "unit%u tidak ditemukan (slot kosong / sudah di-unset)", i);
      return "unit_not_found";
    }
  }
  return nullptr;
}

/** Parsing + validasi parameter opsional. Angka boleh bulat, desimal, atau string. */
static const char *parseParams(JsonVariantConst root, ParamUpdate &u)
{
  double n = 0;

  JsonVariantConst tol = pickKey(root, "tolerant_distance_cm", "tolerantDistanceCm");
  if (!tol.isNull())
  {
    if (!readNumber(tol, n))
      return "tolerant_distance_invalid";
    if (n <= 0.0 || n > 400.0)
      return "tolerant_distance_out_of_range";
    u.hasTolerance = true;
    u.toleranceCm = static_cast<float>(n);
  }

  JsonVariantConst sec = pickKey(root, "timeout_seconds", "timeoutSeconds");
  JsonVariantConst ms = root["timeoutInMillis"]; // format lama
  if (!sec.isNull())
  {
    if (!readNumber(sec, n))
      return "timeout_invalid";
    if (n < 1.0 || n > 86400.0)
      return "timeout_out_of_range";
    u.hasTimeout = true;
    u.timeoutMs = static_cast<unsigned long>(n * 1000.0 + 0.5);
  }
  else if (!ms.isNull())
  {
    if (!readNumber(ms, n))
      return "timeout_invalid";
    if (n < 1.0 || n > 86400000.0)
      return "timeout_out_of_range";
    u.hasTimeout = true;
    u.timeoutMs = static_cast<unsigned long>(n + 0.5);
  }

  if (root["longitude"].is<double>())
  {
    u.hasLongitude = true;
    u.longitude = root["longitude"].as<double>();
  }
  if (root["latitude"].is<double>())
  {
    u.hasLatitude = true;
    u.latitude = root["latitude"].as<double>();
  }
  return nullptr;
}

/** Terapkan parameter yang sudah tervalidasi, lalu hitung ulang unit yang sedang Tracking. */
static void applyParams(const ParamUpdate &u)
{
  if (u.hasTolerance)
    cfg.tolerantDistanceCm = u.toleranceCm;
  if (u.hasTimeout)
    cfg.timeoutMs = u.timeoutMs;
  if (u.hasLongitude)
    cfg.longitude = u.longitude;
  if (u.hasLatitude)
    cfg.latitude = u.latitude;
  retimeTrackingUnits(u);
}

// =============================================================================
// 8. HANDLER PESAN MQTT
// =============================================================================

/** Simpan hasil operasi terakhir & jadwalkan publish status. */
static void reportSetupResult(const char *result)
{
  strlcpy(setupResult, result, sizeof(setupResult));
  statusPending = true;
  logLine("[CONFIG] %s result: %s", lastOperation, setupResult);
}

/** Simpan daftar key tingkat-atas payload (untuk debug di status). */
static void rememberKeys(JsonVariantConst root)
{
  receivedKeys[0] = '\0';
  if (!root.is<JsonObjectConst>())
    return;
  for (JsonPairConst kv : root.as<JsonObjectConst>())
  {
    if (receivedKeys[0] != '\0')
      strlcat(receivedKeys, ",", sizeof(receivedKeys));
    strlcat(receivedKeys, kv.key().c_str(), sizeof(receivedKeys));
  }
}

/** Tambahkan unitId ke daftar teks "0,1,2". */
static void appendUnitId(char *list, size_t size, uint8_t id)
{
  char one[6];
  snprintf(one, sizeof(one), list[0] ? ",%u" : "%u", id);
  strlcat(list, one, size);
}

/**
 * Handler config/set: MENAMBAH satu unit baru.
 * Urutan: validasi semua -> baru sentuh hardware (all-or-nothing).
 */
static void handleSetConfig(JsonVariantConst root)
{
  lastOperation = "set";
  opDetail[0] = '\0';

  if (unitCount >= MAX_UNITS)
  {
    snprintf(opDetail, sizeof(opDetail), "maksimal %u unit (termasuk default)", MAX_UNITS);
    reportSetupResult("max_units_reached");
    return;
  }

  PinRequest req;
  ParamUpdate params;

  const char *err = parsePinRequest(root, req);
  if (!err)
    err = validateNewUnit(req);
  if (!err)
    err = parseParams(root, params);
  if (err)
  {
    reportSetupResult(err);
    return;
  }

  const uint8_t idx = addUnit(req);
  applyParams(params);
  telemetryForce = true; // langsung kirim telemetry semua unit (termasuk yang baru)
  logLine("[CONFIG] unit%u added: trig=%u echo=%u servo=%u buzzer=%u hasSetup=%d (total %u unit)",
          idx, units[idx].pin[ROLE_TRIG], units[idx].pin[ROLE_ECHO], units[idx].pin[ROLE_SERVO],
          units[idx].pin[ROLE_BUZZER], units[idx].hasSetup ? 1 : 0, unitCount);
  reportSetupResult("ok");
}

/**
 * Handler config/unset: MENGHAPUS unit berdasarkan unitId.
 * All-or-nothing: bila satu unitId bermasalah, tidak ada unit yang dihapus.
 */
static void handleUnsetConfig(JsonVariantConst root)
{
  lastOperation = "unset";
  opDetail[0] = '\0';

  uint8_t mask = 0;
  const char *err = parseUnsetRequest(root, mask);
  if (!err)
    err = validateUnset(mask);
  if (err)
  {
    reportSetupResult(err);
    return;
  }

  char removed[24] = "";
  for (uint8_t i = 0; i < MAX_UNITS; i++)
  {
    if (!(mask & (1u << i)))
      continue;
    removeUnit(i);
    appendUnitId(removed, sizeof(removed), i);
    logLine("[CONFIG] unit%u removed, buzzer off, pins released", i);
  }
  refreshUnitCount();

  snprintf(opDetail, sizeof(opDetail), "unit dihapus: %s (sisa %u unit)", removed, unitCount);
  reportSetupResult("unset_ok");
}

/**
 * Handler config/general: ubah parameter kapan saja, tanpa menyentuh pin.
 * Hasilnya dilaporkan ke config/status (tidak lagi diam-diam bila ditolak).
 */
static void handleGeneralConfig(JsonVariantConst root)
{
  lastOperation = "general";
  opDetail[0] = '\0';

  ParamUpdate params;
  const char *err = parseParams(root, params);
  if (!err && !params.hasAny())
    err = "no_param_in_payload";
  if (err)
  {
    reportSetupResult(err);
    return;
  }

  applyParams(params);
  snprintf(opDetail, sizeof(opDetail), "tolerant=%.1f cm, timeout=%lu s",
           cfg.tolerantDistanceCm, cfg.timeoutMs / 1000UL);
  reportSetupResult("general_ok");
}

/**
 * Handler release: melepas alarm unit (semua, atau unitId tertentu).
 * isObjectDetected -> false, buzzer mati, alert berhenti, unit kembali Scanning.
 */
static void handleReleaseConfig(JsonVariantConst root)
{
  lastOperation = "release";
  opDetail[0] = '\0';

  uint8_t mask = 0;
  bool explicitIds = false;
  const char *err = parseReleaseRequest(root, mask, explicitIds);
  if (!err && explicitIds)
    err = validateReleaseTargets(mask);
  if (err)
  {
    reportSetupResult(err);
    return;
  }

  char released[24] = "";
  for (uint8_t i = 0; i < MAX_UNITS; i++)
  {
    Unit &u = units[i];
    if (!(mask & (1u << i)) || !u.active || !u.isObjectDetected)
      continue;
    releaseAlarm(u, i);
    appendUnitId(released, sizeof(released), i);
  }

  if (released[0] == '\0')
  {
    snprintf(opDetail, sizeof(opDetail), "tidak ada unit yang sedang alarm");
    reportSetupResult("no_active_alert");
    return;
  }

  telemetryForce = true; // laporkan kondisi terbaru segera
  snprintf(opDetail, sizeof(opDetail), "alarm dilepas: unit %s, buzzer mati", released);
  reportSetupResult("release_ok");
}

/** Nama operasi untuk sebuah topik, atau nullptr bila bukan topik yang ditangani. */
static const char *operationForTopic(const char *topic)
{
  if (strcmp(topic, topicSet) == 0)
    return "set";
  if (strcmp(topic, topicUnset) == 0)
    return "unset";
  if (strcmp(topic, topicGeneral) == 0)
    return "general";
  if (strcmp(topic, topicRelease) == 0)
    return "release";
  return nullptr;
}

/** Callback PubSubClient: parse JSON lalu dispatch berdasarkan topik. */
static void onMqttMessage(char *topic, byte *payload, unsigned int length)
{
  logLine("[MQTT] rx %s (%u bytes): %.*s", topic, length,
          static_cast<int>(length > 150 ? 150 : length), reinterpret_cast<const char *>(payload));

  const char *operation = operationForTopic(topic);
  if (!operation)
    return;

  // Payload kosong di topik release = "lepas semua unit yang sedang alarm".
  if (length == 0 && strcmp(topic, topicRelease) == 0)
  {
    rememberKeys(JsonVariantConst());
    handleReleaseConfig(JsonVariantConst());
    return;
  }

  JsonDocument doc;
  const DeserializationError error = deserializeJson(doc, payload, length);
  if (error)
  {
    logLine("[MQTT] JSON parse error on %s: %s", topic, error.c_str());
    lastOperation = operation;
    opDetail[0] = '\0';
    reportSetupResult("invalid_json");
    return;
  }

  const JsonVariantConst root = doc.as<JsonVariantConst>();
  rememberKeys(root);

  if (strcmp(operation, "set") == 0)
    handleSetConfig(root);
  else if (strcmp(operation, "unset") == 0)
    handleUnsetConfig(root);
  else if (strcmp(operation, "general") == 0)
    handleGeneralConfig(root);
  else
    handleReleaseConfig(root);
}

// =============================================================================
// 9. PUBLISH
// =============================================================================

/** Serialisasi dokumen JSON ke buffer lokal lalu publish. */
static bool publishJson(const char *topic, const JsonDocument &doc)
{
  if (!mqtt.connected())
    return false;

  char buffer[JSON_BUFFER_SIZE];
  if (measureJson(doc) >= sizeof(buffer))
  {
    logLine("[MQTT] payload too large for %s", topic);
    return false;
  }
  serializeJson(doc, buffer, sizeof(buffer));
  return mqtt.publish(topic, buffer);
}

static const char *stateName(DetectionState s)
{
  switch (s)
  {
  case DetectionState::Scanning:
    return "scanning";
  case DetectionState::Tracking:
    return "tracking";
  default:
    return "confirmed";
  }
}

/** Hasil operasi yang BUKAN kegagalan (tidak perlu receivedKeys/hint di status). */
static bool isSuccessResult(const char *result)
{
  static const char *const OK_RESULTS[] = {
      "ok", "unset_ok", "general_ok", "release_ok", "no_active_alert", "default_pins"};
  for (const char *ok : OK_RESULTS)
  {
    if (strcmp(result, ok) == 0)
      return true;
  }
  return false;
}

/** Publish status: array units AKTIF, tiap unit punya hasSetup, alarm & buzzer sendiri. */
static bool publishConfigStatus()
{
  JsonDocument doc;

  doc["deviceId"] = DEVICE_ID;
  doc["deviceType"] = DEVICE_TYPE;
  doc["lastOperation"] = lastOperation; // "boot" / "set" / "unset" / "general" / "release"
  doc["setupResult"] = setupResult;     // hasil operasi TERAKHIR
  doc["unitCount"] = unitCount;

  JsonArray arr = doc["units"].to<JsonArray>();
  for (uint8_t i = 0; i < MAX_UNITS; i++)
  {
    const Unit &u = units[i];
    if (!u.active)
      continue; // unit yang sudah di-unset tidak ikut dilaporkan
    JsonObject item = arr.add<JsonObject>();
    item["unitId"] = i;
    item["source"] = u.dynamic ? "dynamic" : "default";
    item["hasSetup"] = u.hasSetup;
    item["detectionState"] = stateName(u.state);
    item["isObjectDetected"] = u.isObjectDetected;
    item["buzzerActive"] = u.buzzerOn;
    JsonObject p = item["pins"].to<JsonObject>();
    p["trig"] = u.pin[ROLE_TRIG];
    p["echo"] = u.pin[ROLE_ECHO];
    p["servo"] = u.pin[ROLE_SERVO];
    p["buzzer"] = u.pin[ROLE_BUZZER];
  }

  doc["tolerantDistanceCm"] = cfg.tolerantDistanceCm;
  doc["timeoutSeconds"] = cfg.timeoutMs / 1000UL;
  doc["timestamp"] = millis();

  if (opDetail[0] != '\0')
    doc["detail"] = opDetail;

  if (!isSuccessResult(setupResult))
  {
    doc["receivedKeys"] = receivedKeys;
    if (strcmp(setupResult, "no_pin_in_payload") == 0 || strcmp(setupResult, "incomplete_unit") == 0)
      doc["hint"] = "expected sensor.trig_pin, sensor.echo_pin, servo.pin, buzzer.pin";
    else if (strcmp(setupResult, "no_unit_id_in_payload") == 0)
      doc["hint"] = "expected {\"unitId\": <number>} or {\"unitId\": [<number>, ...]}";
    else if (strcmp(setupResult, "no_param_in_payload") == 0)
      doc["hint"] = "expected tolerant_distance_cm and/or timeout_seconds";
  }

  return publishJson(topicStatus, doc);
}

/** Kirim status yang tertunda; diulang di loop sampai berhasil. */
static void flushPendingStatus()
{
  if (statusPending && mqtt.connected() && publishConfigStatus())
  {
    statusPending = false;
    logLine("[MQTT] status published (%s %s)", lastOperation, setupResult);
  }
}

/** Publish telemetry SETIAP unit aktif (termasuk alarm & buzzer) ke topik /telemetry. */
static void publishTelemetryIfDue(unsigned long now)
{
  if (!telemetryForce && now - lastTelemetryMs < TELEMETRY_INTERVAL_MS)
    return;
  if (telemetryForce && !mqtt.connected())
    return; // tunggu sampai tersambung, flag tetap menyala
  telemetryForce = false;
  lastTelemetryMs = now;

  for (uint8_t i = 0; i < MAX_UNITS; i++)
  {
    const Unit &u = units[i];
    if (!u.active)
      continue;

    JsonDocument doc;
    doc["unitId"] = i;
    doc["source"] = u.dynamic ? "dynamic" : "default";
    doc["hasSetup"] = u.hasSetup;
    doc["sensorStatus"] = (u.lastDistanceCm < NO_ECHO_CM) ? "object_detected" : "object_not_detected";
    doc["distanceCm"] = u.lastDistanceCm;
    doc["servoPosition"] = u.servoAngle;
    doc["detectionState"] = stateName(u.state);
    doc["isObjectDetected"] = u.isObjectDetected;
    doc["buzzerActive"] = u.buzzerOn;
    doc["buzzerPin"] = u.pin[ROLE_BUZZER];
    doc["tolerantDistanceCm"] = cfg.tolerantDistanceCm;
    doc["timeoutSeconds"] = cfg.timeoutMs / 1000UL;
    doc["timestamp"] = now;

    if (!publishJson(topicTelemetry, doc))
      logLine("[MQTT] telemetry unit%u not sent", i);
  }
}

/**
 * Kirim alert untuk unit dengan isObjectDetected == true, lalu ulangi tiap
 * ALERT_INTERVAL_MS sampai di-release. Gagal kirim -> coba lagi tiap ALERT_RETRY_MS.
 */
static void handleAlerts(unsigned long now)
{
  for (uint8_t i = 0; i < MAX_UNITS; i++)
  {
    Unit &u = units[i];
    if (!u.active || !u.isObjectDetected)
      continue;
    if (static_cast<long>(now - u.nextAlertAtMs) < 0) // aman terhadap overflow millis()
      continue;

    JsonDocument doc;
    doc["unitId"] = i;
    doc["source"] = u.dynamic ? "dynamic" : "default";
    doc["eventName"] = "object_detected";
    doc["alertType"] = "warning";
    doc["alertMessage"] = "An object has been detected and confirmed.";
    doc["timestamp"] = now;
    doc["distanceCm"] = u.lastDistanceCm;
    doc["isObjectDetected"] = u.isObjectDetected;
    doc["buzzerActive"] = u.buzzerOn;
    doc["tolerantDistanceCm"] = cfg.tolerantDistanceCm;
    doc["timeoutSeconds"] = cfg.timeoutMs / 1000UL;
    doc["location"]["longitude"] = cfg.longitude;
    doc["location"]["latitude"] = cfg.latitude;

    const bool ok = publishJson(topicAlert, doc);
    u.nextAlertAtMs = now + (ok ? ALERT_INTERVAL_MS : ALERT_RETRY_MS);
    if (ok)
      logLine("[ALERT] unit%u published (distance %.1f cm)", i, u.lastDistanceCm);
    else
      logLine("[ALERT] unit%u publish failed (mqtt connected=%d), retry in %lu s",
              i, mqtt.connected() ? 1 : 0, ALERT_RETRY_MS / 1000UL);
  }
}

// =============================================================================
// 10. SENSOR & SERVO
// =============================================================================

/** Baca jarak HC-SR04 dalam cm. @return NO_ECHO_CM bila tidak ada echo. */
static float readDistanceCm(const Unit &u)
{
  const uint8_t trig = u.pin[ROLE_TRIG];
  digitalWrite(trig, LOW);
  delayMicroseconds(2);
  digitalWrite(trig, HIGH);
  delayMicroseconds(10);
  digitalWrite(trig, LOW);

  const unsigned long duration = pulseIn(u.pin[ROLE_ECHO], HIGH, ECHO_TIMEOUT_US);
  if (duration == 0)
    return NO_ECHO_CM;
  return static_cast<float>(duration) * 0.0343f / 2.0f;
}

/** Pastikan servo unit ter-attach; bila terlepas, attach ulang. */
static bool ensureServoAttached(Unit &u, uint8_t idx)
{
  if (u.servo.attached())
    return true;

  if (!attachServo(u))
  {
    u.hasSetup = false;
    static unsigned long lastWarnMs[MAX_UNITS] = {0};
    if (millis() - lastWarnMs[idx] >= 5000UL)
    {
      lastWarnMs[idx] = millis();
      logLine("[SERVO] unit%u not attached (GPIO%u), retrying", idx, u.pin[ROLE_SERVO]);
    }
    return false;
  }
  u.hasSetup = true;
  logLine("[SERVO] unit%u re-attached on GPIO%u", idx, u.pin[ROLE_SERVO]);
  u.servo.write(u.servoAngle);
  return true;
}

/** Gerakkan servo satu langkah (sapuan 0-180 derajat bolak-balik). */
static void sweepServo(Unit &u, uint8_t idx)
{
  if (!ensureServoAttached(u, idx))
    return;

  if (u.servoAngle >= 180)
    u.servoDirection = -SERVO_STEP_DEG;
  else if (u.servoAngle <= 0)
    u.servoDirection = SERVO_STEP_DEG;

  u.servoAngle = constrain(u.servoAngle + u.servoDirection, 0, 180);
  u.servo.write(u.servoAngle);
}

/**
 * Satu siklus sensor untuk SEMUA unit AKTIF, berurutan (sequential) agar tidak ada
 * crosstalk antar sensor: baca -> update state -> buzzer mengikuti isObjectDetected
 * -> sapu servo bila Scanning. Slot kosong dilewati total.
 */
static void runSensorCycle(unsigned long now)
{
  if (now - lastSensorMs < SENSOR_INTERVAL_MS)
    return;
  lastSensorMs = now;

  for (uint8_t i = 0; i < MAX_UNITS; i++)
  {
    Unit &u = units[i];
    if (!u.active)
      continue;

    u.lastDistanceCm = readDistanceCm(u);
    updateDetection(u, i, now);
    setBuzzer(u, i, u.isObjectDetected); // nyala terus sejak alert ter-trigger, mati saat release
    if (u.state == DetectionState::Scanning)
      sweepServo(u, i);
  }
}

// =============================================================================
// 11. KONEKSI WI-FI & MQTT (NON-BLOCKING)
// =============================================================================

/** Susun semua topik MQTT sekali saja. */
static void buildTopics()
{
  snprintf(topicTelemetry, sizeof(topicTelemetry), "iot/%s/telemetry", DEVICE_ID);
  snprintf(topicAlert, sizeof(topicAlert), "iot/%s/alert", DEVICE_ID);
  snprintf(topicGeneral, sizeof(topicGeneral), "iot/%s/config/general", DEVICE_ID);
  snprintf(topicSet, sizeof(topicSet), "iot/%s/config/set", DEVICE_ID);
  snprintf(topicUnset, sizeof(topicUnset), "iot/%s/config/unset", DEVICE_ID);
  snprintf(topicRelease, sizeof(topicRelease), "iot/%s/release", DEVICE_ID);
  snprintf(topicStatus, sizeof(topicStatus), "iot/%s/config/status", DEVICE_ID);
}

/** Pastikan Wi-Fi tersambung; coba ulang tiap WIFI_RETRY_MS tanpa memblokir. */
static void maintainWifi(unsigned long now)
{
  if (WiFi.status() == WL_CONNECTED)
    return;
  if (wifiAttempted && now - lastWifiAttemptMs < WIFI_RETRY_MS)
    return;

  wifiAttempted = true;
  lastWifiAttemptMs = now;
  logLine("[WIFI] connecting...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

/** Pastikan MQTT tersambung; subscribe ulang & jadwalkan status setelah connect. */
static void maintainMqtt(unsigned long now)
{
  if (mqtt.connected())
  {
    mqttWasConnected = true;
    return;
  }
  if (mqttWasConnected)
  {
    mqttWasConnected = false;
    logLine("[MQTT] connection lost, state=%d (-4 timeout, -3 lost, -2 refused)", mqtt.state());
  }
  if (WiFi.status() != WL_CONNECTED)
    return;
  if (mqttAttempted && now - lastMqttAttemptMs < MQTT_RETRY_MS)
    return;

  mqttAttempted = true;
  lastMqttAttemptMs = now;
  logLine("[MQTT] connecting...");

  if (mqtt.connect(DEVICE_ID, MQTT_USERNAME, MQTT_PASSWORD))
  {
    logLine("[MQTT] connected, subscribed to config/set, config/unset, config/general & release");
    mqtt.subscribe(topicGeneral);
    mqtt.subscribe(topicSet);
    mqtt.subscribe(topicUnset);
    mqtt.subscribe(topicRelease);
    statusPending = true; // laporkan unit/pin aktif setiap kali (re)connect
  }
  else
  {
    logLine("[MQTT] failed, rc=%d", mqtt.state());
  }
}

// =============================================================================
// 12. ENTRY POINT
// =============================================================================

void setup()
{
  Serial.begin(115200);
  logLine("[BOOT] device type: %s", DEVICE_TYPE);
  buildTopics();

#if !defined(ESP8266)
  // Alokasikan timer PWM agar beberapa servo bisa berjalan bersamaan.
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);
#endif

  initDefaultUnit();

  WiFi.mode(WIFI_STA);
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMqttMessage);
  mqtt.setKeepAlive(60);
  mqtt.setSocketTimeout(5);
  if (!mqtt.setBufferSize(MQTT_BUFFER_SIZE))
    logLine("[MQTT] failed to resize buffer");
}

void loop()
{
  // Jaringan dulu. connect()/loop() bisa memakan waktu, jadi waktu untuk logika
  // lokal diambil SETELAHNYA agar timer deteksi tidak memakai nilai millis() basi.
  maintainWifi(millis());
  maintainMqtt(millis());
  mqtt.loop();
  flushPendingStatus();

  // Logika lokal tetap jalan walau jaringan putus.
  const unsigned long now = millis();
  runSensorCycle(now);
  publishTelemetryIfDue(now);
  handleAlerts(now);
}