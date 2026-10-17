#include <Arduino.h>
#include <WiFi.h>
#include <ESP32Servo.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

#define SERVO_PIN 23
#define TRIG_PIN 22
#define ECHO_PIN 21

const char *ssid = "Wokwi-GUEST";
const char *password = "";
const unsigned long DEFAULT_TIMEOUT = 300000; // 5 minutes in milliseconds
const double DEFAULT_TOLERANT_DISTANCE_CM = 10.0;
const String DEVICE_ID = "a4ca5bbb-f98c-4add-af1e-a498c9868dcc";
const double LONGTITUDE = 106.845599;
const double LATITUDE = -6.208763;
const char *MQTT_HOST = "host.wokwi.internal";
const uint16_t MQTT_PORT = 1883;
const char *MQTT_USERNAME = "sicuser";
const char *MQTT_PASSWORD = "s1cu53rp455w0rd";
const unsigned long SERVO_INTERVAL = 100;

unsigned long prevMillis = 0;

const String TOPIC_TELEMETRY =
    "iot/" + DEVICE_ID + "/telemetry";

const String TOPIC_GENERAL_CONFIG =
    "iot/" + DEVICE_ID + "/config/general";

const String TOPIC_ALERT =
    "iot/" + DEVICE_ID + "/alert";

const String TOPIC_SET =
    "iot/" + DEVICE_ID + "/config/set";

const String TOPIC_STATUS =
    "iot/" + DEVICE_ID + "/config/status";

struct TelemetryData
{
  String sensorStatus;
  float distanceCm;
  uint16_t servoPosition;
  unsigned long timestamp;
};

struct AlertData
{
  String eventName;
  String alertType;
  String alertMessage;
  unsigned long timestamp;
  double distanceCm;
  struct
  {
    double longitude;
    double latitude;
  } location;
};

struct ConfigGeneralData
{
  unsigned long timeoutInMillis;
  double tolerantDistanceCm;
  unsigned long updatedAt;
};

struct ConfigSetData
{
  struct
  {
    uint8_t pin;
    String type;
  } sensor;
  struct
  {
    uint8_t echoPin;
    uint8_t trigPin;
  } servo;

  double longitude;
  double latitude;
  bool isDynamic;
};

struct ConfigStatusData
{
  struct
  {
    uint8_t pin;
    String type;
  } sensor;
  struct
  {
    uint8_t echoPin;
    uint8_t trigPin;
  } servo;

  String setupResult;
  bool hasSetup;
  bool isDynamic;
};

Servo srv;
WiFiClient espClient;
ConfigGeneralData config{
    .timeoutInMillis = DEFAULT_TIMEOUT,
    .tolerantDistanceCm = DEFAULT_TOLERANT_DISTANCE_CM,
    .updatedAt = millis()};
PubSubClient client(espClient);
uint8_t servoPosition = 0;
bool isObjectDetected = false, isIncrementSrv = true, isDetecting = false;
unsigned long lastServoMoveTime = 0;
unsigned long lastDetectionTime = 0;
unsigned long lastAlertTime = 0;

void setup()
{
  Serial.begin(115200);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED)
  {
    delay(1000);
    Serial.println("Connecting to WiFi...");
  }
  srv.setPeriodHertz(50);
  srv.attach(SERVO_PIN, 500, 2400);
  srv.write(0);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  client.setServer(MQTT_HOST, MQTT_PORT);
  client.setCallback([](char *topic, byte *payload, unsigned int length)
                     {
    String message = "";
    for (int i = 0; i < length; i++)
    {
      message += (char) payload[i];
    }
    
    if (strcmp(topic, TOPIC_GENERAL_CONFIG.c_str()) == 0) {
      // Handle general config updates
      Serial.println("Received general config update:");
      JsonDocument configDoc;
      DeserializationError error = deserializeJson(configDoc, message);

      if (error) {
        Serial.print("Failed to parse JSON: ");
        Serial.println(error.c_str());
        return;
      }
      Serial.println(message);
      config.timeoutInMillis =
          configDoc["timeoutInMillis"] | DEFAULT_TIMEOUT;

      config.tolerantDistanceCm =
          configDoc["tolerantDistanceCm"] |
          DEFAULT_TOLERANT_DISTANCE_CM;

      config.updatedAt =
          configDoc["updatedAt"] | millis();
    } });
  if (client.setBufferSize(512))
  {
    Serial.print("MQTT buffer size: ");
    Serial.println(client.getBufferSize());
  }
  else
  {
    Serial.println("Failed to resize MQTT buffer!");
  }
}

double distance(uint8_t trigPin, uint8_t echoPin)
{
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  long duration = pulseIn(echoPin, HIGH);
  if (duration == 0)
    return 999.9;
  return (double)duration * 0.034 / 2;
}

void radar()
{
  if (isObjectDetected || isDetecting)
    return;
  if (servoPosition == 0)
    isIncrementSrv = true;
  if (servoPosition == 180)
    isIncrementSrv = false;
  servoPosition = isIncrementSrv ? servoPosition + 10 : servoPosition - 10;
  srv.write(servoPosition);
}

TelemetryData createTelemetryData(uint8_t trigPin, uint8_t echoPin, uint8_t servoPin)
{
  double dist = distance(trigPin, echoPin);
  TelemetryData data;
  data.sensorStatus = (dist < 999.9) ? "object_detected" : "object_not_detected";
  data.distanceCm = dist;
  data.servoPosition = servoPosition;
  data.timestamp = millis();
  return data;
}

bool sendAlert(
    String eventName,
    String alertType,
    String alertMessage,
    double distanceCm)
{
  JsonDocument alertDoc;

  alertDoc["eventName"] = eventName;
  alertDoc["alertType"] = alertType;
  alertDoc["alertMessage"] = alertMessage;
  alertDoc["timestamp"] = millis();
  alertDoc["distanceCm"] = distanceCm;

  alertDoc["location"]["longitude"] = LONGTITUDE;
  alertDoc["location"]["latitude"] = LATITUDE;

  char jsonBuffer[512];
  size_t payloadSize = serializeJson(alertDoc, jsonBuffer);

  Serial.println("\n--- MQTT ALERT DEBUG ---");
  Serial.print("MQTT connected: ");
  Serial.println(client.connected() ? "YES" : "NO");

  Serial.print("Topic: ");
  Serial.println(TOPIC_ALERT);

  Serial.print("Payload size: ");
  Serial.println(payloadSize);

  Serial.print("Payload: ");
  Serial.println(jsonBuffer);

  if (!client.connected())
  {
    Serial.println("Alert failed: MQTT disconnected.");
    return false;
  }

  bool success = client.publish(
      TOPIC_ALERT.c_str(),
      jsonBuffer);

  if (success)
  {
    Serial.println("Alert published successfully.");
  }
  else
  {
    Serial.print("Alert publish failed. MQTT state: ");
    Serial.println(client.state());
  }

  Serial.println("------------------------");

  return success;
}

void loop()
{
  if (!client.connected())
  {
    while (!client.connected())
    {
      Serial.println("Attempting MQTT connection...");
      if (client.connect(DEVICE_ID.c_str(), MQTT_USERNAME, MQTT_PASSWORD))
      {
        Serial.println("Connected to MQTT broker");
        client.subscribe(TOPIC_GENERAL_CONFIG.c_str());
      }
      else
      {
        Serial.print("Failed to connect, rc=");
        Serial.print(client.state());
        delay(2000);
      }
    }
  }
  client.loop();

  if (millis() - lastServoMoveTime >= SERVO_INTERVAL)
  {
    radar();
    lastServoMoveTime = millis();
  }

  if (millis() - prevMillis >= 5000)
  {
    TelemetryData telemetryData = createTelemetryData(TRIG_PIN, ECHO_PIN, SERVO_PIN);

    JsonDocument telemetryDoc;
    telemetryDoc["sensorStatus"] = telemetryData.sensorStatus;
    telemetryDoc["distanceCm"] = telemetryData.distanceCm;
    telemetryDoc["servoPosition"] = telemetryData.servoPosition;
    telemetryDoc["timestamp"] = telemetryData.timestamp;

    char jsonBuffer[512];
    serializeJson(telemetryDoc, jsonBuffer);

    if (client.publish(TOPIC_TELEMETRY.c_str(), jsonBuffer))
    {
      Serial.println("Message successed send payload");
    }
    else
    {
      Serial.println("Message failed send payload");
    }
    prevMillis = millis();
  }
  if (millis() - lastAlertTime >= 60000)
  {
    if (isObjectDetected)
    {
      double alertDistance = distance(TRIG_PIN, ECHO_PIN);

      if (sendAlert(
              "object_detected",
              "warning",
              "An object has been detected and confirmed.",
              alertDistance))
      {
        lastAlertTime = millis();
      }
    }
  }

  double dist = distance(TRIG_PIN, ECHO_PIN);

  bool objectInRange =
      dist < 999.9 &&
      dist <= config.tolerantDistanceCm;

  if (!isObjectDetected)
  {
    if (objectInRange)
    {
      unsigned long elapsed = millis() - lastDetectionTime;

      Serial.print("Detection elapsed: ");
      Serial.print(elapsed / 1000);
      Serial.print(" / ");
      Serial.print(config.timeoutInMillis / 1000);
      Serial.println(" seconds");

      if (elapsed >= config.timeoutInMillis)
      {
        isObjectDetected = true;

        Serial.println("Timeout reached!");
        Serial.println("Object confirmed. Servo remains stopped.");
      }
      if (!isDetecting)
      {
        isDetecting = true;
        lastDetectionTime = millis();

        Serial.println("Object detected. Servo stopped.");
        Serial.println("Starting timeout countdown...");
      }

      if (millis() - lastDetectionTime >= config.timeoutInMillis)
      {
        isObjectDetected = true;

        Serial.println("Timeout reached!");
        Serial.println("Object confirmed. Servo remains stopped.");
      }
    }
    else
    {
      if (isDetecting)
      {
        Serial.println("Object lost. Resetting detection timer.");

        isDetecting = false;
        lastDetectionTime = 0;
      }
    }
  }
}

