/**
 * @file main.cpp
 * @brief Pencegah parkir liar & PKL di bahu jalan - ESP32 + HC-SR04 + Servo + MQTT.
 *
 * Alur kerja:
 *  1. Boot  : UNIT DEFAULT (unitId 0 = sensor + servo) diinisialisasi, Wi-Fi & MQTT disambungkan.
 *  2. MQTT  : subscribe ke  iot/<id>/config/set      (TAMBAH unit sensor+servo baru)
 *                           iot/<id>/config/unset    (HAPUS unit dinamis berdasarkan unitId)
 *                           iot/<id>/config/general  (parameter, boleh berkali-kali)
 *  3. Setup : tiap config/set valid -> 1 unit baru (sensor + servo) ditambahkan
 *             secara dinamis (maks MAX_UNITS termasuk default), status dipublish ke
 *             iot/<id>/config/status, lalu telemetry semua unit langsung dikirim ke
 *             iot/<id>/telemetry.
 *  4. Unset : config/unset valid -> servo di-detach, pin unit dilepas (high-Z) dan
 *             unit DIHAPUS dari daftar. Sensor/servo-nya tidak dibaca lagi dan tidak
 *             muncul di status, telemetry, maupun alert.
 *  5. Loop  : SETIAP unit aktif berjalan independen seperti default: servo menyapu ->
 *             sensor membaca -> objek dalam jarak toleransi selama timeout => ALERT
 *             (berkala). Telemetry tiap 5 detik untuk setiap unit aktif.
 *
 * unitId = nomor slot (0..MAX_UNITS-1) dan TETAP selama unit itu ada; unit lain
 * tidak bergeser saat sebuah unit dihapus. Slot kosong dipakai lagi oleh
 * config/set berikutnya (slot terkecil yang kosong).
 * unitId 0 (unit default) PERMANEN: config/unset untuk id 0 selalu ditolak
 * (cannot_unset_default).
 *
 * hasSetup adalah status PER UNIT: true bila hardware unit tersebut (pin sensor
 * dan servo) berhasil di-setup, false bila servo gagal attach.
 *
 * Contoh payload config/set (trig, echo, dan servo WAJIB lengkap = 1 unit baru):
 *  {
 *    "sensor": { "type": "ultrasonic", "trig_pin": 25, "echo_pin": 26 },
 *    "servo":  { "pin": 27 },
 *    "tolerant_distance_cm": 10,
 *    "timeout_seconds": 300,
 *    "longitude": 106.845599, "latitude": -6.208763
 *  }
 *
 * Contoh payload config/unset (satu unit, atau beberapa sekaligus):
 *  { "unitId": 1 }
 *  { "unitId": [1, 2] }
 *  (nama lain yang diterima: unit_id, unitIds, unit_ids)
 *
 * Contoh payload config/general (semua field opsional, berlaku untuk semua unit):
 *  { "tolerant_distance_cm": 15, "timeout_seconds": 120 }
 *  (format lama tolerantDistanceCm / timeoutInMillis tetap diterima)
 */

#include <Arduino.h>
#include <stdarg.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <driver/gpio.h>

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
static const char *DEVICE_ID = "a4ca5bbb-f98c-4add-af1e-a498c9868dcc";
static const double DEFAULT_LONGITUDE = 106.845599;
static const double DEFAULT_LATITUDE = -6.208763;

// --- Pin unit DEFAULT ---
static const uint8_t DEFAULT_TRIG_PIN = 22;
static const uint8_t DEFAULT_ECHO_PIN = 21;
static const uint8_t DEFAULT_SERVO_PIN = 23;

// --- Jumlah unit maksimum (termasuk default) ---
static const uint8_t MAX_UNITS = 4;
static_assert(MAX_UNITS <= 8, "unset memakai bitmask 8-bit");

// --- unitId 0 = unit default (bawaan kode): PERMANEN, tidak bisa di-unset ---
static const uint8_t DEFAULT_UNIT_ID = 0;

// --- Parameter deteksi DEFAULT ---
static const float DEFAULT_TOLERANT_DISTANCE_CM = 10.0f;
static const unsigned long DEFAULT_TIMEOUT_MS = 300000UL; // 5 menit

// --- Interval & batas (semua berbasis millis) ---
static const unsigned long WIFI_RETRY_MS = 15000UL;
static const unsigned long MQTT_RETRY_MS = 5000UL;
static const unsigned long SENSOR_INTERVAL_MS = 100UL; // sampling sensor + langkah servo
static const unsigned long TELEMETRY_INTERVAL_MS = 5000UL;
static const unsigned long ALERT_INTERVAL_MS = 60000UL;
static const unsigned long ALERT_RETRY_MS = 5000UL;
static const unsigned long TRACK_LOG_INTERVAL_MS = 10000UL;
static const uint8_t OBJECT_LOST_SAMPLES = 2;

// --- Sensor & servo ---
static const float NO_ECHO_CM = 999.9f;
static const unsigned long ECHO_TIMEOUT_US = 20000UL; // ~3,4 m; 4 unit berurutan tetap muat di 100 ms
static const int SERVO_STEP_DEG = 10;
static const int SERVO_MIN_US = 500;
static const int SERVO_MAX_US = 2400;

// --- MQTT ---
static const uint16_t MQTT_BUFFER_SIZE = 2048;
static const size_t JSON_BUFFER_SIZE = 1536;
static const size_t TOPIC_MAX_LEN = 96;

/** Log ke Serial dengan akhiran \r\n agar terminal Wokwi rapi. */
static void logf(const char *fmt, ...)
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
  ROLE_COUNT
};

static const char *const ROLE_NAMES[ROLE_COUNT] = {"ultrasonic_trig", "ultrasonic_echo", "servo_pwm"};

/** Permintaan unit baru hasil parsing payload config/set. */
struct PinRequest
{
  bool has[ROLE_COUNT] = {false, false, false};
  int value[ROLE_COUNT] = {0, 0, 0};
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
  Confirmed  // timer habis -> alert dikirim berkala
};

/**
 * Satu unit = sensor ultrasonik + servo, lengkap dengan state deteksinya sendiri.
 * Slot dengan active == false dilewati SEMUA proses (baca sensor, servo,
 * telemetry, alert, status, validasi pin).
 */
struct Unit
{
  bool active = false;                  // false = slot kosong / unit sudah di-unset
  bool dynamic = false;                 // false = default, true = ditambah via MQTT
  bool hasSetup = false;                // true bila hardware unit ini berhasil di-setup (servo attached)
  uint8_t pin[ROLE_COUNT] = {0, 0, 0};  // trig, echo, servo
  Servo servo;

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
static char topicStatus[TOPIC_MAX_LEN];

static bool statusPending = false;
static bool telemetryForce = false; // kirim telemetry segera (mis. setelah setup unit baru)
static const char *lastOperation = "boot"; // "set" / "unset" (operasi config terakhir)
static char setupResult[40] = "default_pins"; // hasil operasi config TERAKHIR
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
// 4. MANAJEMEN UNIT & PIN
// =============================================================================

/** GPIO yang dipakai UART0 (Serial Monitor). */
static bool isReservedPin(int pin)
{
  return pin == 1 || pin == 3;
}

/** Cek apakah GPIO aman dipakai di ESP32 classic. */
static bool isUsablePin(int pin, bool needsOutput)
{
  if (pin < 0 || pin > 39)
    return false;
  if (pin >= 6 && pin <= 11)
    return false;
  if (!GPIO_IS_VALID_GPIO(pin))
    return false;
  if (needsOutput && !GPIO_IS_VALID_OUTPUT_GPIO(pin))
    return false;
  return true;
}

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

/** Inisialisasi hardware satu unit (pinMode + attach servo) dan reset state-nya. */
static void initUnitHardware(Unit &u)
{
  pinMode(u.pin[ROLE_TRIG], OUTPUT);
  digitalWrite(u.pin[ROLE_TRIG], LOW);
  pinMode(u.pin[ROLE_ECHO], INPUT);

  u.servo.setPeriodHertz(50);
  u.servo.attach(u.pin[ROLE_SERVO], SERVO_MIN_US, SERVO_MAX_US);
  if (u.servo.attached())
    u.servo.write(u.servoAngle);
  else
    logf("[SERVO] attach failed on GPIO%u", u.pin[ROLE_SERVO]);

  u.hasSetup = u.servo.attached(); // status setup PER UNIT
  u.state = DetectionState::Scanning;
  u.missedSamples = 0;
  u.detectionStartMs = 0;
  u.lastDistanceCm = NO_ECHO_CM;
  u.lastTrackLogMs = 0;
  u.nextAlertAtMs = 0;
}

/**
 * Hapus unit: detach servo, kembalikan SEMUA pin-nya ke high-Z (INPUT) agar bisa
 * dipakai ulang, lalu kosongkan slot (pin dan state di-reset). Setelah ini unit
 * tidak lagi dibaca, tidak digerakkan, dan tidak muncul di status/telemetry/alert.
 */
static void releaseUnit(uint8_t idx)
{
  if (idx == DEFAULT_UNIT_ID)
    return; // pengaman berlapis: unit default tidak pernah dilepas

  Unit &u = units[idx];

  if (u.servo.attached())
    u.servo.detach();
  for (uint8_t r = 0; r < ROLE_COUNT; r++)
    pinMode(u.pin[r], INPUT);

  u.active = false;
  u.dynamic = false;
  u.hasSetup = false;
  for (uint8_t r = 0; r < ROLE_COUNT; r++)
    u.pin[r] = 0;
  u.state = DetectionState::Scanning;
  u.detectionStartMs = 0;
  u.missedSamples = 0;
  u.lastDistanceCm = NO_ECHO_CM;
  u.servoAngle = 0;
  u.servoDirection = SERVO_STEP_DEG;
  u.lastTrackLogMs = 0;
  u.nextAlertAtMs = 0;
}

/** Daftarkan unit DEFAULT (unitId 0). Dipanggil sekali dari setup(). */
static void initDefaultUnit()
{
  Unit &u = units[DEFAULT_UNIT_ID];
  u.active = true;
  u.dynamic = false;
  u.pin[ROLE_TRIG] = DEFAULT_TRIG_PIN;
  u.pin[ROLE_ECHO] = DEFAULT_ECHO_PIN;
  u.pin[ROLE_SERVO] = DEFAULT_SERVO_PIN;
  initUnitHardware(u);
  refreshUnitCount();
}

/**
 * Validasi permintaan unit baru TANPA menyentuh hardware.
 *  1. Pin valid & aman (bukan UART0, bukan flash, output-capable bila perlu).
 *  2. Pin tidak boleh sedang dipakai unit AKTIF mana pun (default maupun dinamis).
 *     Pin milik unit yang sudah di-unset bebas dipakai lagi.
 *  3. Tiga pin pada payload yang sama tidak boleh kembar.
 * @return nullptr bila valid, atau kode error (detail di opDetail).
 */
static const char *validateNewUnit(const PinRequest &req)
{
  opDetail[0] = '\0';

  for (uint8_t r = 0; r < ROLE_COUNT; r++)
  {
    const int pin = req.value[r];
    if (isReservedPin(pin))
    {
      snprintf(opDetail, sizeof(opDetail), "%s: GPIO%d dipakai UART0 (Serial Monitor)",
               ROLE_NAMES[r], pin);
      return "reserved_pin";
    }
    if (!isUsablePin(pin, r != ROLE_ECHO))
    {
      snprintf(opDetail, sizeof(opDetail), "%s: GPIO%d tidak valid%s",
               ROLE_NAMES[r], pin, r != ROLE_ECHO ? " untuk output" : "");
      return "invalid_pin";
    }
  }

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
          snprintf(opDetail, sizeof(opDetail), "%s: GPIO%d sedang dipakai unit%u %s (%s)",
                   ROLE_NAMES[r], req.value[r], u, ROLE_NAMES[o],
                   units[u].dynamic ? "dinamis" : "default");
          return "pin_conflict_active";
        }
      }
    }
  }

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
  initUnitHardware(u);
  refreshUnitCount();
  return idx;
}

// =============================================================================
// 5. PARSING PAYLOAD
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

/** Parsing pin unit baru dari config/set. Ketiga pin wajib ada. @return nullptr bila OK. */
static const char *parsePinRequest(JsonVariantConst root, PinRequest &req)
{
  const JsonVariantConst fields[ROLE_COUNT] = {
      findField(root, TRIG_PATHS, sizeof(TRIG_PATHS) / sizeof(TRIG_PATHS[0])),
      findField(root, ECHO_PATHS, sizeof(ECHO_PATHS) / sizeof(ECHO_PATHS[0])),
      findField(root, SERVO_PATHS, sizeof(SERVO_PATHS) / sizeof(SERVO_PATHS[0]))};

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
    snprintf(opDetail, sizeof(opDetail), "unit baru butuh trig+echo+servo, baru ada %u dari 3", found);
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

/**
 * Parsing payload config/unset: satu unitId atau array unitId -> bitmask.
 * Id kembar dalam satu payload dianggap satu. @return nullptr bila OK.
 */
static const char *parseUnsetRequest(JsonVariantConst root, uint8_t &mask)
{
  mask = 0;

  static const char *const KEYS[] = {"unitId", "unit_id", "unitIds", "unit_ids"};
  JsonVariantConst v;
  for (const char *key : KEYS)
  {
    v = root[key];
    if (!v.isNull())
      break;
  }
  if (v.isNull())
    return "no_unit_id_in_payload";

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

/** Cek semua unitId pada bitmask boleh dihapus (unitId 0 selalu ditolak). @return nullptr bila OK. */
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

/** Parsing + validasi parameter opsional. @return nullptr bila OK. */
static const char *parseParams(JsonVariantConst root, ParamUpdate &u)
{
  JsonVariantConst tol = pickKey(root, "tolerant_distance_cm", "tolerantDistanceCm");
  if (!tol.isNull())
  {
    if (!tol.is<float>())
      return "tolerant_distance_invalid";
    const float v = tol.as<float>();
    if (v <= 0.0f || v > 400.0f)
      return "tolerant_distance_out_of_range";
    u.hasTolerance = true;
    u.toleranceCm = v;
  }

  JsonVariantConst sec = pickKey(root, "timeout_seconds", "timeoutSeconds");
  JsonVariantConst ms = root["timeoutInMillis"]; // format lama
  if (!sec.isNull())
  {
    if (!sec.is<uint32_t>())
      return "timeout_invalid";
    const uint32_t v = sec.as<uint32_t>();
    if (v == 0 || v > 86400UL)
      return "timeout_out_of_range";
    u.hasTimeout = true;
    u.timeoutMs = static_cast<unsigned long>(v) * 1000UL;
  }
  else if (!ms.isNull())
  {
    if (!ms.is<uint32_t>())
      return "timeout_invalid";
    const uint32_t v = ms.as<uint32_t>();
    if (v == 0 || v > 86400000UL)
      return "timeout_out_of_range";
    u.hasTimeout = true;
    u.timeoutMs = v;
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

/** Terapkan parameter yang sudah tervalidasi. */
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
}

// =============================================================================
// 6. HANDLER PESAN MQTT
// =============================================================================

/** Simpan hasil operasi config terakhir & jadwalkan publish status. */
static void reportSetupResult(const char *result)
{
  strlcpy(setupResult, result, sizeof(setupResult));
  statusPending = true;
  logf("[CONFIG] %s result: %s", lastOperation, setupResult);
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

/**
 * Handler config/set: MENAMBAH satu unit (sensor + servo) baru.
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
  logf("[CONFIG] unit%u added: trig=%u echo=%u servo=%u hasSetup=%d (total %u unit)",
       idx, units[idx].pin[ROLE_TRIG], units[idx].pin[ROLE_ECHO], units[idx].pin[ROLE_SERVO],
       units[idx].hasSetup ? 1 : 0, unitCount);
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
    releaseUnit(i);
    char one[6];
    snprintf(one, sizeof(one), removed[0] ? ",%u" : "%u", i);
    strlcat(removed, one, sizeof(removed));
    logf("[CONFIG] unit%u removed, pins released", i);
  }
  refreshUnitCount();

  snprintf(opDetail, sizeof(opDetail), "unit dihapus: %s (sisa %u unit)", removed, unitCount);
  reportSetupResult("unset_ok");
}

/** Handler config/general: ubah parameter kapan saja, tanpa menyentuh pin. */
static void handleGeneralConfig(JsonVariantConst root)
{
  ParamUpdate params;
  const char *err = parseParams(root, params);
  if (err)
  {
    logf("[CONFIG] general rejected: %s", err);
    return;
  }
  applyParams(params);
  logf("[CONFIG] general updated: tolerant=%.1f cm, timeout=%lu s",
       cfg.tolerantDistanceCm, cfg.timeoutMs / 1000UL);
}

/** Callback PubSubClient: parse JSON lalu dispatch berdasarkan topik. */
static void onMqttMessage(char *topic, byte *payload, unsigned int length)
{
  logf("[MQTT] rx %s (%u bytes): %.*s", topic, length,
       static_cast<int>(length > 150 ? 150 : length), reinterpret_cast<const char *>(payload));

  JsonDocument doc;
  const DeserializationError error = deserializeJson(doc, payload, length);
  if (error)
  {
    logf("[MQTT] JSON parse error on %s: %s", topic, error.c_str());
    if (strcmp(topic, topicSet) == 0 || strcmp(topic, topicUnset) == 0)
    {
      lastOperation = (strcmp(topic, topicSet) == 0) ? "set" : "unset";
      opDetail[0] = '\0';
      reportSetupResult("invalid_json");
    }
    return;
  }

  const JsonVariantConst root = doc.as<JsonVariantConst>();
  if (strcmp(topic, topicSet) == 0)
  {
    rememberKeys(root);
    handleSetConfig(root);
  }
  else if (strcmp(topic, topicUnset) == 0)
  {
    rememberKeys(root);
    handleUnsetConfig(root);
  }
  else if (strcmp(topic, topicGeneral) == 0)
    handleGeneralConfig(root);
}

// =============================================================================
// 7. PUBLISH
// =============================================================================

/** Serialisasi dokumen JSON ke buffer lokal lalu publish. */
static bool publishJson(const char *topic, const JsonDocument &doc)
{
  if (!mqtt.connected())
    return false;

  char buffer[JSON_BUFFER_SIZE];
  if (measureJson(doc) >= sizeof(buffer))
  {
    logf("[MQTT] payload too large for %s", topic);
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

/** Publish status konfigurasi: array units AKTIF, tiap unit punya hasSetup sendiri. */
static bool publishConfigStatus()
{
  JsonDocument doc;

  doc["deviceId"] = DEVICE_ID;
  doc["lastOperation"] = lastOperation; // "boot" / "set" / "unset"
  doc["setupResult"] = setupResult;     // hasil operasi config TERAKHIR
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
    JsonObject p = item["pins"].to<JsonObject>();
    p["trig"] = u.pin[ROLE_TRIG];
    p["echo"] = u.pin[ROLE_ECHO];
    p["servo"] = u.pin[ROLE_SERVO];
  }

  doc["tolerantDistanceCm"] = cfg.tolerantDistanceCm;
  doc["timeoutSeconds"] = cfg.timeoutMs / 1000UL;
  doc["timestamp"] = millis();

  if (opDetail[0] != '\0')
    doc["detail"] = opDetail;

  const bool failed = strcmp(setupResult, "ok") != 0 && strcmp(setupResult, "unset_ok") != 0 &&
                      strcmp(setupResult, "default_pins") != 0;
  if (failed)
  {
    doc["receivedKeys"] = receivedKeys;
    if (strcmp(setupResult, "no_pin_in_payload") == 0 || strcmp(setupResult, "incomplete_unit") == 0)
      doc["hint"] = "expected sensor.trig_pin, sensor.echo_pin, servo.pin";
    else if (strcmp(setupResult, "no_unit_id_in_payload") == 0)
      doc["hint"] = "expected {\"unitId\": <number>} or {\"unitId\": [<number>, ...]}";
  }

  return publishJson(topicStatus, doc);
}

/** Kirim status yang tertunda; diulang di loop sampai berhasil. */
static void flushPendingStatus()
{
  if (statusPending && mqtt.connected() && publishConfigStatus())
  {
    statusPending = false;
    logf("[MQTT] config status published (%s %s)", lastOperation, setupResult);
  }
}

/**
 * Publish telemetry SETIAP unit aktif ke topik /telemetry.
 * Format tiap pesan sama untuk semua unit, ditambah unitId, source & hasSetup.
 * Unit yang sudah di-unset tidak dipublish.
 */
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
    doc["timestamp"] = now;

    if (!publishJson(topicTelemetry, doc))
      logf("[MQTT] telemetry unit%u not sent", i);
  }
}

/** Kirim alert saat objek terkonfirmasi pada unit aktif, lalu ulangi tiap ALERT_INTERVAL_MS. */
static void handleAlerts(unsigned long now)
{
  for (uint8_t i = 0; i < MAX_UNITS; i++)
  {
    Unit &u = units[i];
    if (!u.active || u.state != DetectionState::Confirmed)
      continue;
    if (static_cast<long>(now - u.nextAlertAtMs) < 0) // aman terhadap overflow millis()
      continue;

    JsonDocument doc;
    doc["unitId"] = i;
    doc["eventName"] = "object_detected";
    doc["alertType"] = "warning";
    doc["alertMessage"] = "An object has been detected and confirmed.";
    doc["timestamp"] = now;
    doc["distanceCm"] = u.lastDistanceCm;
    doc["location"]["longitude"] = cfg.longitude;
    doc["location"]["latitude"] = cfg.latitude;

    const bool ok = publishJson(topicAlert, doc);
    u.nextAlertAtMs = now + (ok ? ALERT_INTERVAL_MS : ALERT_RETRY_MS);
    if (ok)
      logf("[ALERT] unit%u published (distance %.1f cm)", i, u.lastDistanceCm);
    else
      logf("[ALERT] unit%u publish failed (mqtt connected=%d), retry in %lu s",
           i, mqtt.connected() ? 1 : 0, ALERT_RETRY_MS / 1000UL);
  }
}

// =============================================================================
// 8. LOGIKA SENSOR & SERVO (PER UNIT)
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

  u.servo.setPeriodHertz(50);
  u.servo.attach(u.pin[ROLE_SERVO], SERVO_MIN_US, SERVO_MAX_US);
  if (!u.servo.attached())
  {
    u.hasSetup = false;
    static unsigned long lastWarnMs[MAX_UNITS] = {0};
    if (millis() - lastWarnMs[idx] >= 5000UL)
    {
      lastWarnMs[idx] = millis();
      logf("[SERVO] unit%u not attached (GPIO%u), retrying", idx, u.pin[ROLE_SERVO]);
    }
    return false;
  }
  u.hasSetup = true;
  logf("[SERVO] unit%u re-attached on GPIO%u", idx, u.pin[ROLE_SERVO]);
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

/** Reset state deteksi satu unit. */
static void resetDetection(Unit &u)
{
  u.state = DetectionState::Scanning;
  u.missedSamples = 0;
  u.detectionStartMs = 0;
}

/** Update state machine deteksi satu unit berdasarkan satu sampel jarak. */
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
      logf("[DETECT] unit%u object at %.1f cm, servo stopped, countdown %lu s",
           idx, distanceCm, cfg.timeoutMs / 1000UL);
    }
    break;

  case DetectionState::Tracking:
  case DetectionState::Confirmed:
    if (inRange)
      u.missedSamples = 0;
    else if (++u.missedSamples >= OBJECT_LOST_SAMPLES)
    {
      logf("[DETECT] unit%u object lost, servo resumes sweep from %d deg", idx, u.servoAngle);
      resetDetection(u);
      break;
    }

    if (u.state == DetectionState::Tracking &&
        now - u.detectionStartMs >= cfg.timeoutMs)
    {
      u.state = DetectionState::Confirmed;
      u.nextAlertAtMs = now; // alert pertama langsung
      logf("[DETECT] unit%u timeout reached, object confirmed", idx);
    }
    else if (u.state == DetectionState::Tracking &&
             now - u.lastTrackLogMs >= TRACK_LOG_INTERVAL_MS)
    {
      u.lastTrackLogMs = now;
      logf("[DETECT] unit%u tracking %lu/%lu s (%.1f cm)",
           idx, (now - u.detectionStartMs) / 1000UL, cfg.timeoutMs / 1000UL, distanceCm);
    }
    break;
  }
}

/**
 * Satu siklus sensor untuk SEMUA unit AKTIF: baca -> update state -> sapu servo
 * bila belum ada objek. Slot kosong / unit yang di-unset dilewati total.
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

    u.lastDistanceCm = readDistanceCm(u); // dibaca berurutan -> tidak ada crosstalk antar sensor
    updateDetection(u, i, now);
    if (u.state == DetectionState::Scanning)
      sweepServo(u, i);
  }
}

// =============================================================================
// 9. KONEKSI WI-FI & MQTT (NON-BLOCKING)
// =============================================================================

/** Susun semua topik MQTT sekali saja. */
static void buildTopics()
{
  snprintf(topicTelemetry, sizeof(topicTelemetry), "iot/%s/telemetry", DEVICE_ID);
  snprintf(topicAlert, sizeof(topicAlert), "iot/%s/alert", DEVICE_ID);
  snprintf(topicGeneral, sizeof(topicGeneral), "iot/%s/config/general", DEVICE_ID);
  snprintf(topicSet, sizeof(topicSet), "iot/%s/config/set", DEVICE_ID);
  snprintf(topicUnset, sizeof(topicUnset), "iot/%s/config/unset", DEVICE_ID);
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
  logf("[WIFI] connecting...");
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
    logf("[MQTT] connection lost, state=%d (-4 timeout, -3 lost, -2 refused)", mqtt.state());
  }
  if (WiFi.status() != WL_CONNECTED)
    return;
  if (mqttAttempted && now - lastMqttAttemptMs < MQTT_RETRY_MS)
    return;

  mqttAttempted = true;
  lastMqttAttemptMs = now;
  logf("[MQTT] connecting...");

  if (mqtt.connect(DEVICE_ID, MQTT_USERNAME, MQTT_PASSWORD))
  {
    logf("[MQTT] connected, subscribed to config/set, config/unset & config/general");
    mqtt.subscribe(topicGeneral);
    mqtt.subscribe(topicSet);
    mqtt.subscribe(topicUnset);
    statusPending = true; // laporkan unit/pin aktif setiap kali (re)connect
  }
  else
  {
    logf("[MQTT] failed, rc=%d", mqtt.state());
  }
}

// =============================================================================
// 10. ENTRY POINT
// =============================================================================

void setup()
{
  Serial.begin(115200);
  buildTopics();

  // Alokasikan timer PWM agar beberapa servo bisa berjalan bersamaan.
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);

  initDefaultUnit();

  WiFi.mode(WIFI_STA);
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMqttMessage);
  mqtt.setKeepAlive(60);
  mqtt.setSocketTimeout(5);
  if (!mqtt.setBufferSize(MQTT_BUFFER_SIZE))
    logf("[MQTT] failed to resize buffer");
}

void loop()
{
  const unsigned long now = millis();

  maintainWifi(now);
  maintainMqtt(now);
  mqtt.loop();
  flushPendingStatus();

  // Logika lokal tetap jalan walau jaringan putus.
  runSensorCycle(now);
  publishTelemetryIfDue(now);
  handleAlerts(now);
}