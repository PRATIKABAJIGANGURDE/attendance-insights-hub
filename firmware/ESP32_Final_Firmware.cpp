/*
 * ╔══════════════════════════════════════════════════════════════╗
 * ║        ASGS ATTENDANCE SYSTEM — ESP32 FIRMWARE              ║
 * ║        Event-Driven Biometric Access Management             ║
 * ║                                                             ║
 * ║  Hardware : ESP32 + R307S Fingerprint + I2C LCD 16x2        ║
 * ║  Backend  : Appwrite Cloud                                  ║
 * ║  Tables   : members, attendance, devices,                   ║
 * ║             device_commands, activity_events                ║
 * ║  Version  : 3.0.2                                           ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 *  CHANGES FROM v3.0.1
 *  ────────────────────────────────────────────────────────────
 *  [FIX]  Watchdog Timeout increased to 15s to prevent reboots
 *         during long WiFi/Sync operations.
 *  [FIX]  Relocated Watchdog registration to end of setup() to
 *         handle long WiFiManager sessions safely.
 *  [FIX]  Added esp_task_wdt_reset() in member sync and 
 *         device status loops.
 *  [FIX]  Added delay before restart to ensure command 
 *         completion updates reach the backend.
 */

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Adafruit_Fingerprint.h>
#include <EEPROM.h>
#include <map>
#include <vector>
#include <WiFiManager.h>
#include <Preferences.h>
#include <Update.h>
#include <esp_task_wdt.h>    // Watchdog
#include <time.h>            // NTP real timestamps

// ════════════════════════════════════════════════════════════════
//  ⚙️  BUILD CONSTANTS  (no secrets here — set via WiFiManager)
// ════════════════════════════════════════════════════════════════
#define FIRMWARE_VERSION      "3.0.2"
#define DEVICE_ID             "ESP32_DEVICE_01"

// ─── Appwrite ───────────────────────────────────────────────────
#define AW_ENDPOINT           "https://syd.cloud.appwrite.io/v1"
#define AW_DATABASE_ID        "69a43553003c581b441b"
#define AW_COL_MEMBERS        "members"
#define AW_COL_ATTEND         "attendance"
#define AW_COL_DEVICES        "devices"
#define AW_COL_COMMANDS       "device_commands"
#define AW_COL_ACTIVITY       "activity_events"
#define AW_FIRMWARE_BUCKET    "firmware_updates"

// ─── Hardware Pins ──────────────────────────────────────────────
#define FPS_RX_PIN            16
#define FPS_TX_PIN            17
#define TOUCH_PIN              4
#define LOCK_PIN              26
#define INSIDE_TOUCH_PIN      27
#define LCD_SDA               21
#define LCD_SCL               22
#define LCD_ADDR              0x27

// ─── Timing (ms) ────────────────────────────────────────────────
#define ENROLL_TIMEOUT_MS     20000
#define IDENTIFY_TIMEOUT_MS    6000
#define ANTI_SPAM_MS          10000
#define CMD_POLL_INTERVAL_MS   3000
#define HEARTBEAT_INTERVAL_MS 30000
#define WIFI_RETRY_MS          8000
#define DOOR_UNLOCK_MS         5000
#define WDT_TIMEOUT_MS         15000  // Increased from 8000 to allow slow network operations

// ─── Limits ─────────────────────────────────────────────────────
#define EEPROM_SIZE             512
#define EEPROM_MAGIC           0xBC   // Bumped — forces fresh cache on upgrade
#define MAX_CACHE_ENTRIES        50   // LRU cap on roleCache
#define MAX_QUEUE_ENTRIES        20   // Offline attendance queue depth
#define MAX_NAME_LEN             20

// ─── NTP ────────────────────────────────────────────────────────
#define NTP_SERVER1           "pool.ntp.org"
#define NTP_SERVER2           "time.nist.gov"
#define NTP_GMT_OFFSET_SEC        0   // UTC; adjust for local TZ if needed
#define NTP_DAYLIGHT_OFFSET_SEC   0

// ════════════════════════════════════════════════════════════════
//  STATE & EVENT ENUMS
// ════════════════════════════════════════════════════════════════
enum SystemState {
  STATE_BOOT,
  STATE_IDLE,
  STATE_ATTENDANCE_SCAN,
  STATE_SUPER_ADMIN_SETUP,
  STATE_ADMIN_VERIFY,
  STATE_ADMIN_ADD_MODE,
  STATE_MEMBER_ENROLL,
  STATE_ERROR
};

enum SystemEvent {
  EVT_NONE,
  EVT_TOUCH_DETECTED,
  EVT_CMD_SETUP_ADMIN,
  EVT_CMD_ADD_ADMIN,
  EVT_CMD_ADD_MEMBER
};

enum Role { ROLE_NONE = 0, ROLE_SUPER_ADMIN = 1, ROLE_ADMIN = 2, ROLE_MEMBER = 3 };

// ─── Return codes for Appwrite calls ────────────────────────────
enum AwResult { AW_OK = 0, AW_NO_WIFI, AW_HTTP_ERR, AW_PARSE_ERR };

// ════════════════════════════════════════════════════════════════
//  DATA STRUCTURES
// ════════════════════════════════════════════════════════════════
struct CacheEntry {
  uint8_t role;
  char    name[MAX_NAME_LEN + 1];
};

struct QueuedAttendance {
  uint16_t memberId;
  char     name[MAX_NAME_LEN + 1];
  char     iso[26];   // "2025-01-15T10:30:00+00:00\0"
};

// ════════════════════════════════════════════════════════════════
//  GLOBALS
// ════════════════════════════════════════════════════════════════
HardwareSerial        fpsSerial(2);
Adafruit_Fingerprint  fps(&fpsSerial);
LiquidCrystal_I2C     lcd(LCD_ADDR, 16, 2);
Preferences           preferences;

// ─── Credentials (loaded from NVS — never hardcoded) ────────────
static char g_project_id[64]  = "";
static char g_api_key[300]    = "";

// ─── State machine ──────────────────────────────────────────────
SystemState  currentState      = STATE_BOOT;
SystemEvent  pendingEvent      = EVT_NONE;

// ─── Role cache (LRU: insertion-order map + size cap) ───────────
std::map<uint16_t, CacheEntry> roleCache;
std::map<uint16_t, uint32_t>   lastScanTime;

// ─── Command context ────────────────────────────────────────────
String   pendingCmdId;
String   pendingCmdType;
String   pendingMemberName;
uint16_t verifiedAdminId      = 0;

// ─── Offline queue ──────────────────────────────────────────────
std::vector<QueuedAttendance>  attendanceQueue;

// ─── Timers ─────────────────────────────────────────────────────
uint32_t enrollStart          = 0;
uint32_t lastCmdPoll          = 0;
uint32_t lastHeartbeat        = 0;
uint32_t lastWifiRetry        = 0;
uint32_t unlockEndTime        = 0;
uint32_t totalScansToday      = 0;

// ─── Edge detection ─────────────────────────────────────────────
bool touchWasHigh             = false;
bool lastInsideTouchState     = false;

// ─── Device doc ID (cached after first lookup) ──────────────────
String deviceDocId;

// ─── NTP sync flag ──────────────────────────────────────────────
bool ntpSynced                = false;
bool g_wdt_enabled            = false; // Safety: only reset WDT after task is added

// ════════════════════════════════════════════════════════════════
//  FORWARD DECLARATIONS
// ════════════════════════════════════════════════════════════════
void        handleState();
void        emitEvent(SystemEvent e);
void        transitionTo(SystemState s);
void        lcdShow(const char* l1, const char* l2 = "");
void        lcdShow(const char* l1, const String& l2);
bool        enrollFinger(uint16_t id);
int16_t     identifyFinger();
void        syncMembers();
AwResult    postAttendance(uint16_t memberId, const char* name, const char* iso);
void        flushAttendanceQueue();
bool        fetchPendingCommand();
bool        completeCommand(const String& id, const String& status);
void        performOTA(const String& fileId);
bool        registerMember(uint16_t fpId, const char* name, const char* role);
void        logActivity(const char* eventType, const char* message,
                        const char* severity = "info", uint16_t memberId = 0);
void        upsertDeviceStatus(const char* status);
void        saveCache();
void        loadCache();
void        evictCacheIfFull();
const char* roleStr(Role r);
Role        roleFromStr(const char* s);
void        buildURL(char* buf, size_t maxLen, const char* col, const char* path = "");
void        awHeaders(HTTPClient& h);
AwResult    awPost(const char* col, const char* payload, String* outDocId = nullptr);
AwResult    awPatch(const char* col, const char* docId, const char* payload);
String      awGetList(const char* col, const String& query = "");
String      buildQuery(const char* field, const char* value);
String      buildLimitQuery(int n);
bool        getCurrentISO8601(char* buf, size_t bufLen);
void        syncNTP();
void        unlockDoor(const char* triggerSource);
void        scrubBuffer(char* buf, size_t len);

// ════════════════════════════════════════════════════════════════
//  SETUP
// ════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  Serial.println(F("\n╔══════════════════════════════╗"));
  Serial.println(F(  "║   ASGS Attendance System     ║"));
  Serial.printf (   "║   Firmware v%-16s║\n", FIRMWARE_VERSION);
  Serial.println(F(  "╚══════════════════════════════╝"));

  // ── FIX: Watchdog init (Timeout increased for network stability) ──
  esp_task_wdt_config_t wdt_config = {
    .timeout_ms    = WDT_TIMEOUT_MS, 
    .idle_core_mask = 0,              
    .trigger_panic  = true            
  };
  if (esp_task_wdt_init(&wdt_config) != ESP_OK) {
    esp_task_wdt_reconfigure(&wdt_config); // IDF 5 fallback
  }
  // No add(NULL) here — wait until end of setup to start watching

  Wire.begin(LCD_SDA, LCD_SCL);
  lcd.init();
  lcd.backlight();
  lcdShow("ASGS System", "Starting...");

  pinMode(TOUCH_PIN, INPUT);
  pinMode(LOCK_PIN, OUTPUT);
  digitalWrite(LOCK_PIN, LOW);  // LOCKED — electromagnet ON
  pinMode(INSIDE_TOUCH_PIN, INPUT_PULLDOWN); // Pull LOW to prevent phantom triggers when disconnected
  lastInsideTouchState = (digitalRead(INSIDE_TOUCH_PIN) == HIGH);

  EEPROM.begin(EEPROM_SIZE);
  loadCache();

  fpsSerial.begin(57600, SERIAL_8N1, FPS_RX_PIN, FPS_TX_PIN);
  fps.begin(57600);
  delay(500);
  if (!fps.verifyPassword()) {
    Serial.println(F("[FPS] ERROR: Sensor not found — check wiring"));
    lcdShow("FPS Error!", "Check Wiring");
    transitionTo(STATE_ERROR);
    return;
  }
  fps.getParameters();
  Serial.printf("[FPS] OK — capacity=%d stored=%d\n", fps.capacity, fps.templateCount);

  // ─── Load credentials from NVS (set by WiFiManager) ──────────
  preferences.begin("asgs", true);   // read-only open
  preferences.getString("aw_proj", g_project_id, sizeof(g_project_id));
  preferences.getString("aw_api",  g_api_key,    sizeof(g_api_key));
  preferences.end();

  bool credsPresent = (strlen(g_project_id) > 0 && strlen(g_api_key) > 0);

  // ─── WiFiManager: always exposes config portal fields ─────────
  WiFiManagerParameter param_proj("project_id", "Appwrite Project ID",
                                  g_project_id, 64);
  WiFiManagerParameter param_key ("api_key",    "Appwrite API Key",
                                  "",           300);   // Never pre-fill key

  WiFiManager wm;
  wm.addParameter(&param_proj);
  wm.addParameter(&param_key);

  bool shouldSave = false;
  wm.setSaveConfigCallback([&]() { shouldSave = true; });

  lcdShow("ASGS System", "Connecting...");
  bool connected = wm.autoConnect("ASGS_Setup");

  if (shouldSave) {
    strncpy(g_project_id, param_proj.getValue(), sizeof(g_project_id) - 1);
    const char* newKey = param_key.getValue();
    if (strlen(newKey) > 0) {
      strncpy(g_api_key, newKey, sizeof(g_api_key) - 1);
    }
    preferences.begin("asgs", false);
    preferences.putString("aw_proj", g_project_id);
    preferences.putString("aw_api",  g_api_key);
    preferences.end();
    Serial.println(F("[CFG] Credentials saved to NVS"));
  }

  if (connected) {
    Serial.println("\n[WIFI] Connected — " + WiFi.localIP().toString());
    lcdShow("WiFi Connected!", "Syncing time...");

    syncNTP();
    syncMembers();
    upsertDeviceStatus("online");
    logActivity("system", "ASGS booted (v" FIRMWARE_VERSION ")", "info");
  } else {
    Serial.println(F("[WIFI] Offline mode active"));
    lcdShow("Offline Mode", "Active");
    delay(1000);
  }

  // ─── Activate Watchdog for the main loop ──────────────────────
  esp_task_wdt_add(NULL);             
  g_wdt_enabled = true;
  transitionTo(STATE_IDLE);
}

// ════════════════════════════════════════════════════════════════
//  MAIN LOOP
// ════════════════════════════════════════════════════════════════
void loop() {
  if (g_wdt_enabled) esp_task_wdt_reset();   // Pat the watchdog every loop

  uint32_t now = millis();

  // ─── WiFi reconnect ─────────────────────────────────────────
  if (WiFi.status() != WL_CONNECTED && now - lastWifiRetry > WIFI_RETRY_MS) {
    lastWifiRetry = now;
    WiFi.reconnect();
  }

  // ─── Re-sync NTP once WiFi comes back ───────────────────────
  if (!ntpSynced && WiFi.status() == WL_CONNECTED) {
    syncNTP();
  }

  // ─── Touch detection (rising edge) ──────────────────────────
  if (currentState == STATE_IDLE) {
    bool hi = (digitalRead(TOUCH_PIN) == HIGH);
    if (hi && !touchWasHigh) emitEvent(EVT_TOUCH_DETECTED);
    else if (!hi && fps.getImage() == FINGERPRINT_OK) emitEvent(EVT_TOUCH_DETECTED);
    touchWasHigh = hi;
  }

  // ─── Inside touch (rising edge) ─────────────────────────────
  bool insideTouch = (digitalRead(INSIDE_TOUCH_PIN) == HIGH);
  if (insideTouch && !lastInsideTouchState) unlockDoor("Inside Touch");
  lastInsideTouchState = insideTouch;

  // ─── Non-blocking door re-lock ──────────────────────────────
  if (unlockEndTime > 0 && now > unlockEndTime) {
    digitalWrite(LOCK_PIN, LOW);
    unlockEndTime = 0;
    Serial.println(F("[DOOR] Locked"));
    if (currentState == STATE_IDLE) lcdShow("ASGS System", "Touch to Scan");
  }

  // ─── Action timeout ─────────────────────────────────────────
  bool inAction = (currentState == STATE_SUPER_ADMIN_SETUP ||
                   currentState == STATE_ADMIN_ADD_MODE    ||
                   currentState == STATE_MEMBER_ENROLL     ||
                   currentState == STATE_ADMIN_VERIFY);
  if (inAction && now - enrollStart > ENROLL_TIMEOUT_MS) {
    Serial.println(F("[TIMEOUT] Action timed out"));
    lcdShow("Timed Out!", "Returning...");
    if (pendingCmdId.length()) completeCommand(pendingCmdId, "timeout");
    logActivity("timeout", ("Action timed out: " + pendingCmdType).c_str(), "warning");
    pendingCmdId = ""; pendingCmdType = ""; pendingMemberName = "";
    delay(2000);
    transitionTo(STATE_IDLE);
    return;
  }

  // ─── Command polling ────────────────────────────────────────
  if (currentState == STATE_IDLE &&
      WiFi.status() == WL_CONNECTED &&
      now - lastCmdPoll > CMD_POLL_INTERVAL_MS) {
    lastCmdPoll = now;
    fetchPendingCommand();
    flushAttendanceQueue();   // Drain offline queue while idle & online
  }

  // ─── Heartbeat ──────────────────────────────────────────────
  if (WiFi.status() == WL_CONNECTED && now - lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
    lastHeartbeat = now;
    upsertDeviceStatus("online");
  }

  handleState();
  delay(20);
}

// ════════════════════════════════════════════════════════════════
//  STATE HANDLER
// ════════════════════════════════════════════════════════════════
void handleState() {
  switch (currentState) {

    // ── IDLE ───────────────────────────────────────────────────
    case STATE_IDLE:
      if      (pendingEvent == EVT_TOUCH_DETECTED)  { pendingEvent = EVT_NONE; transitionTo(STATE_ATTENDANCE_SCAN); }
      else if (pendingEvent == EVT_CMD_SETUP_ADMIN) { pendingEvent = EVT_NONE; transitionTo(STATE_SUPER_ADMIN_SETUP); }
      else if (pendingEvent == EVT_CMD_ADD_ADMIN ||
               pendingEvent == EVT_CMD_ADD_MEMBER)  { pendingEvent = EVT_NONE; transitionTo(STATE_ADMIN_VERIFY); }
      break;

    // ── ATTENDANCE SCAN ────────────────────────────────────────
    case STATE_ATTENDANCE_SCAN: {
      lcdShow("Scan Finger", "Place on sensor");
      int16_t id = identifyFinger();

      if (id > 0) {
        uint32_t now = millis();

        if (lastScanTime.count(id) && now - lastScanTime[id] < ANTI_SPAM_MS) {
          uint32_t waitSec = (ANTI_SPAM_MS - (now - lastScanTime[id])) / 1000 + 1;
          lcdShow("Already Scanned!", ("Wait " + String(waitSec) + "s").c_str());
          Serial.printf("[ATTEND] Anti-spam: ID %d (%lus left)\n", id, waitSec);
          delay(1500);
          transitionTo(STATE_IDLE);
          return;
        }

        lastScanTime[id] = now;
        totalScansToday++;

        const char* name = "Unknown";
        Role        role = ROLE_MEMBER;
        if (roleCache.count(id)) {
          name = roleCache[id].name;
          role = (Role)roleCache[id].role;
        }

        Serial.printf("[ATTEND] ID %d — %s (%s)\n", id, name, roleStr(role));
        unlockDoor("Fingerprint");

        lcdShow((role == ROLE_SUPER_ADMIN || role == ROLE_ADMIN)
                ? "Welcome Admin!" : "Welcome!", name);
        delay(800);
        lcdShow(name, "Opening...");

        // Get real timestamp once for both attendance record & activity log
        char iso[26];
        getCurrentISO8601(iso, sizeof(iso));

        if (postAttendance(id, name, iso) != AW_OK) {
          // WiFi down or HTTP error — queue for later
          if (attendanceQueue.size() < MAX_QUEUE_ENTRIES) {
            QueuedAttendance qa;
            qa.memberId = id;
            strncpy(qa.name, name, MAX_NAME_LEN);
            strncpy(qa.iso,  iso,  sizeof(qa.iso) - 1);
            attendanceQueue.push_back(qa);
            Serial.printf("[QUEUE] Queued attendance for ID %d (%zu in queue)\n",
                          id, attendanceQueue.size());
          } else {
            Serial.println(F("[QUEUE] Full — attendance record dropped"));
          }
        }

        logActivity("scan", ("Scan: " + String(name)).c_str(), "info", id);
        transitionTo(STATE_IDLE);
        return;

      } else {
        lcdShow("Not Recognized", "Try Again");
        delay(2000);
      }
      transitionTo(STATE_IDLE);
      break;
    }

    // ── SUPER ADMIN SETUP ──────────────────────────────────────
    case STATE_SUPER_ADMIN_SETUP: {
      lcdShow("Setup SuperAdmin", "Place Finger");
      fps.getTemplateCount();
      uint16_t newId = fps.templateCount + 1;

      if (enrollFinger(newId)) {
        evictCacheIfFull();
        CacheEntry e; e.role = ROLE_SUPER_ADMIN;
        strncpy(e.name, "Super Admin", MAX_NAME_LEN);
        roleCache[newId] = e;
        saveCache();
        registerMember(newId, "Super Admin", "super_admin");
        completeCommand(pendingCmdId, "completed");
        logActivity("super_admin_setup",
                    ("Super Admin enrolled FP#" + String(newId)).c_str(), "info", newId);
        lcdShow("Super Admin Set!", ("FP#" + String(newId)).c_str());
        delay(3000);
      } else {
        lcdShow("Enroll Failed", "Try Again Later");
        completeCommand(pendingCmdId, "failed");
        logActivity("enroll_failed", "Super admin setup failed", "error");
        delay(2500);
      }
      pendingCmdId = ""; pendingMemberName = "";
      transitionTo(STATE_IDLE);
      break;
    }

    // ── ADMIN VERIFY ───────────────────────────────────────────
    case STATE_ADMIN_VERIFY: {
      bool needSuper = (pendingCmdType == "addAdmin");
      lcdShow(needSuper ? "SuperAdmin Scan" : "Admin Scan", "Verify to proceed");

      int16_t id = identifyFinger();
      if (id > 0 && roleCache.count(id)) {
        Role r  = (Role)roleCache[id].role;
        bool ok = needSuper ? (r == ROLE_SUPER_ADMIN)
                            : (r == ROLE_ADMIN || r == ROLE_SUPER_ADMIN);
        if (ok) {
          verifiedAdminId = id;
          lcdShow("Verified!", roleCache[id].name);
          Serial.printf("[AUTH] Authorized by '%s' (ID %d)\n", roleCache[id].name, id);
          delay(1500);
          transitionTo(needSuper ? STATE_ADMIN_ADD_MODE : STATE_MEMBER_ENROLL);
        } else {
          lcdShow("Access Denied!", "Not Authorized");
          logActivity("auth_denied",
                      (String("Role ") + roleStr(r) + " denied for " + pendingCmdType).c_str(),
                      "warning", id);
          completeCommand(pendingCmdId, "unauthorized");
          pendingCmdId = ""; pendingCmdType = ""; pendingMemberName = "";
          delay(2500);
          transitionTo(STATE_IDLE);
        }
      } else {
        lcdShow("Not Recognized", "Scan Cancelled");
        completeCommand(pendingCmdId, "failed");
        pendingCmdId = ""; pendingCmdType = ""; pendingMemberName = "";
        delay(2000);
        transitionTo(STATE_IDLE);
      }
      break;
    }

    // ── ADMIN ADD MODE ─────────────────────────────────────────
    case STATE_ADMIN_ADD_MODE: {
      lcdShow("Admin Setup", "Place Finger");
      fps.getTemplateCount();
      uint16_t newId = fps.templateCount + 1;
      String name = pendingMemberName.length() ? pendingMemberName : ("Admin " + String(newId));

      if (enrollFinger(newId)) {
        evictCacheIfFull();
        CacheEntry e; e.role = ROLE_ADMIN;
        strncpy(e.name, name.c_str(), MAX_NAME_LEN);
        roleCache[newId] = e;
        saveCache();
        registerMember(newId, name.c_str(), "admin");
        completeCommand(pendingCmdId, "completed");
        logActivity("admin_enrolled",
                    (String("Admin '") + name + "' FP#" + newId +
                     " by adminID " + verifiedAdminId).c_str(), "info", newId);
        lcdShow("Admin Added!", name.c_str());
        delay(3000);
      } else {
        lcdShow("Enroll Failed", "");
        completeCommand(pendingCmdId, "failed");
        logActivity("enroll_failed", "Admin enrollment failed", "error");
        delay(2000);
      }
      pendingCmdId = ""; pendingMemberName = ""; verifiedAdminId = 0;
      transitionTo(STATE_IDLE);
      break;
    }

    // ── MEMBER ENROLL ──────────────────────────────────────────
    case STATE_MEMBER_ENROLL: {
      lcdShow("Enroll Member", "Place Finger");
      fps.getTemplateCount();
      uint16_t newId = fps.templateCount + 1;
      String name = pendingMemberName.length() ? pendingMemberName : ("Member " + String(newId));

      if (enrollFinger(newId)) {
        evictCacheIfFull();
        CacheEntry e; e.role = ROLE_MEMBER;
        strncpy(e.name, name.c_str(), MAX_NAME_LEN);
        roleCache[newId] = e;
        saveCache();
        registerMember(newId, name.c_str(), "member");
        completeCommand(pendingCmdId, "completed");
        logActivity("member_enrolled",
                    (String("Member '") + name + "' FP#" + newId +
                     " by adminID " + verifiedAdminId).c_str(), "info", newId);
        lcdShow("Member Added!", name.c_str());
        delay(3000);
      } else {
        lcdShow("Enroll Failed", "");
        completeCommand(pendingCmdId, "failed");
        logActivity("enroll_failed", "Member enrollment failed", "error");
        delay(2000);
      }
      pendingCmdId = ""; pendingMemberName = ""; verifiedAdminId = 0;
      transitionTo(STATE_IDLE);
      break;
    }

    // ── ERROR ──────────────────────────────────────────────────
    case STATE_ERROR:
      lcdShow("SYSTEM ERROR", "Restart Device");
      delay(5000);
      break;

    default: break;
  }
}

// ════════════════════════════════════════════════════════════════
//  DOOR CONTROL
// ════════════════════════════════════════════════════════════════
void unlockDoor(const char* triggerSource) {
  digitalWrite(LOCK_PIN, HIGH);   // Magnet OFF → door unlocked
  unlockEndTime = millis() + DOOR_UNLOCK_MS;
  Serial.printf("[DOOR] Unlocked by %s\n", triggerSource);
  if (strcmp(triggerSource, "Inside Touch") == 0)
    lcdShow("Door Unlocked", "Opening...");
}

// ════════════════════════════════════════════════════════════════
//  STATE TRANSITION
// ════════════════════════════════════════════════════════════════
void transitionTo(SystemState s) {
  currentState = s;
  pendingEvent = EVT_NONE;
  enrollStart  = millis();
  switch (s) {
    case STATE_IDLE:
      if (unlockEndTime == 0) lcdShow("ASGS System", "Touch to Scan");
      break;
    case STATE_ATTENDANCE_SCAN:   lcdShow("Scan Finger",    "Place on sensor"); break;
    case STATE_SUPER_ADMIN_SETUP: lcdShow("Setup SuperAdm", "Place Finger");    break;
    case STATE_ADMIN_VERIFY:      lcdShow("Verify Admin",   "Scan Finger");     break;
    case STATE_ADMIN_ADD_MODE:    lcdShow("New Admin",      "Place Finger");    break;
    case STATE_MEMBER_ENROLL:     lcdShow("Enroll Member",  "Place Finger");    break;
    default: break;
  }
}

void emitEvent(SystemEvent e) { pendingEvent = e; }

// ════════════════════════════════════════════════════════════════
//  FINGERPRINT — ENROLL
// ════════════════════════════════════════════════════════════════
bool enrollFinger(uint16_t id) {
  Serial.printf("[FPS] Enrolling ID %d\n", id);

  auto captureImage = [&](uint8_t slot, const char* promptL1,
                           const char* promptL2) -> bool {
    lcdShow(promptL1, promptL2);
    uint32_t start = millis();
    while (millis() - start < ENROLL_TIMEOUT_MS) {
      if (g_wdt_enabled) esp_task_wdt_reset();
      if (fps.getImage() == FINGERPRINT_OK) {
        lcdShow("Hold Still...", "Capturing...");
        delay(400);
        fps.getImage();
        uint8_t p = fps.image2Tz(slot);
        if (p == FINGERPRINT_OK) return true;
        lcdShow(p == FINGERPRINT_IMAGEMESS ? "Press Firmly" : "Try Again", "...");
        delay(1000);
        lcdShow(promptL1, promptL2);
      }
      delay(50);
    }
    return false;
  };

  if (!captureImage(1, "Place Finger", "Firmly & steady")) return false;

  lcdShow("Remove Finger", "");
  delay(600);
  while (fps.getImage() != FINGERPRINT_NOFINGER) {
    if (g_wdt_enabled) esp_task_wdt_reset();
    delay(50);
  }
  delay(600);

  if (!captureImage(2, "Place Again", "Same finger")) return false;

  if (fps.createModel() != FINGERPRINT_OK) {
    lcdShow("Fingers Don't", "Match! Retry");
    delay(2000);
    return false;
  }
  return (fps.storeModel(id) == FINGERPRINT_OK);
}

// ════════════════════════════════════════════════════════════════
//  FINGERPRINT — IDENTIFY
// ════════════════════════════════════════════════════════════════
int16_t identifyFinger() {
  uint32_t start = millis();
  bool firstDetect = true;

  while (millis() - start < IDENTIFY_TIMEOUT_MS) {
    if (g_wdt_enabled) esp_task_wdt_reset();
    uint8_t p = fps.getImage();

    if (p == FINGERPRINT_OK) {
      if (firstDetect) {
        lcdShow("Hold Still...", "Scanning...");
        delay(300);
        fps.getImage();
        firstDetect = false;
      }
      p = fps.image2Tz();
      if (p == FINGERPRINT_OK) {
        // Fast search first; fall back to exhaustive on miss
        if (fps.fingerFastSearch() != FINGERPRINT_OK)
          fps.fingerSearch();

        if (fps.fingerID > 0) return fps.fingerID;

        lcdShow("Try Again", "Adjust Finger");
        delay(400);
      } else {
        lcdShow(p == FINGERPRINT_IMAGEMESS ? "Press Firmly" : "Try Again", "...");
        delay(400);
      }
    } else if (p == FINGERPRINT_NOFINGER && !firstDetect) {
      firstDetect = true;
      lcdShow("Place Again!", "...");
      delay(400);
    }
    delay(50);
  }
  return -1;
}

// ════════════════════════════════════════════════════════════════
//  NTP — REAL TIMESTAMPS
// ════════════════════════════════════════════════════════════════
void syncNTP() {
  configTime(NTP_GMT_OFFSET_SEC, NTP_DAYLIGHT_OFFSET_SEC, NTP_SERVER1, NTP_SERVER2);
  struct tm ti;
  uint8_t attempts = 0;
  while (!getLocalTime(&ti) && attempts++ < 10) {
    delay(500);
    if (g_wdt_enabled) esp_task_wdt_reset();
  }
  ntpSynced = (attempts < 10);
  Serial.printf("[NTP] %s\n", ntpSynced ? "Synced" : "Sync failed — using millis fallback");
}

bool getCurrentISO8601(char* buf, size_t bufLen) {
  if (ntpSynced) {
    struct tm ti;
    if (getLocalTime(&ti)) {
      strftime(buf, bufLen, "%Y-%m-%dT%H:%M:%S+00:00", &ti);
      return true;
    }
  }
  // Graceful fallback: epoch-relative (not wall-clock, but at least unique)
  uint32_t s = millis() / 1000;
  snprintf(buf, bufLen, "1970-01-01T%02lu:%02lu:%02lu+00:00",
           (unsigned long)(s / 3600) % 24,
           (unsigned long)(s / 60) % 60,
           (unsigned long)(s % 60));
  return false;
}

// ════════════════════════════════════════════════════════════════
//  APPWRITE HTTP LAYER
// ════════════════════════════════════════════════════════════════
void buildURL(char* buf, size_t maxLen, const char* col, const char* path) {
  snprintf(buf, maxLen, "%s/databases/%s/collections/%s/documents%s",
           AW_ENDPOINT, AW_DATABASE_ID, col, path ? path : "");
}

void awHeaders(HTTPClient& h) {
  h.addHeader("Content-Type",       "application/json");
  h.addHeader("X-Appwrite-Project", g_project_id);
  h.addHeader("X-Appwrite-Key",     g_api_key);
}

AwResult awPost(const char* col, const char* payload, String* outDocId) {
  if (WiFi.status() != WL_CONNECTED) return AW_NO_WIFI;
  HTTPClient http;
  char url[256]; buildURL(url, sizeof(url), col);
  http.begin(url);
  awHeaders(http);
  int code = http.POST((uint8_t*)payload, strlen(payload));
  if (code == 201 && outDocId) *outDocId = http.getString();
  http.end();
  if (code != 201) {
    Serial.printf("[POST %s] HTTP %d\n", col, code);
    return AW_HTTP_ERR;
  }
  return AW_OK;
}

AwResult awPatch(const char* col, const char* docId, const char* payload) {
  if (WiFi.status() != WL_CONNECTED) return AW_NO_WIFI;
  HTTPClient http;
  char path[130]; snprintf(path, sizeof(path), "/%s", docId);
  char url[256];  buildURL(url, sizeof(url), col, path);
  http.begin(url);
  awHeaders(http);
  int code = http.sendRequest("PATCH", (uint8_t*)payload, strlen(payload));
  http.end();
  if (code != 200) {
    Serial.printf("[PATCH %s] HTTP %d\n", docId, code);
    return AW_HTTP_ERR;
  }
  return AW_OK;
}

String awGetList(const char* col, const String& query) {
  if (WiFi.status() != WL_CONNECTED) return "";
  HTTPClient http;
  char base[256]; buildURL(base, sizeof(base), col);
  String url = String(base) + (query.length() ? "?" + query : "");
  http.begin(url);
  awHeaders(http);
  int code = http.GET();
  String body = (code == 200) ? http.getString() : "";
  http.end();
  if (code != 200) Serial.printf("[GET %s] HTTP %d\n", col, code);
  return body;
}

// ─── Query builder — Appwrite 1.5+ encoded array syntax ─────────
static String urlEncodeJson(const String& json) {
  String enc;
  enc.reserve(json.length() * 3);
  for (char c : json) {
    switch (c) {
      case '{': enc += "%7B"; break;
      case '}': enc += "%7D"; break;
      case '"': enc += "%22"; break;
      case ':': enc += "%3A"; break;
      case ',': enc += "%2C"; break;
      case '[': enc += "%5B"; break;
      case ']': enc += "%5D"; break;
      default:  enc += c;
    }
  }
  return enc;
}

String buildQuery(const char* field, const char* value) {
  String json = String("{\"method\":\"equal\",\"attribute\":\"") +
                field + "\",\"values\":[\"" + value + "\"]}";
  return "queries%5B%5D=" + urlEncodeJson(json);
}

String buildLimitQuery(int n) {
  String json = String("{\"method\":\"limit\",\"values\":[") + n + "]}";
  return "queries%5B%5D=" + urlEncodeJson(json);
}

// ════════════════════════════════════════════════════════════════
//  APPWRITE ACTIONS
// ════════════════════════════════════════════════════════════════

void syncMembers() {
  Serial.println(F("[SYNC] Fetching members..."));
  String body = awGetList(AW_COL_MEMBERS);
  if (!body.length()) return;

  DynamicJsonDocument doc(8192);
  if (deserializeJson(doc, body) != DeserializationError::Ok) {
    Serial.println(F("[SYNC] JSON parse error"));
    return;
  }

  int loaded = 0;
  for (JsonObject m : doc["documents"].as<JsonArray>()) {
    esp_task_wdt_reset(); // Safety reset during parsing
    uint16_t fpId = String(m["fingerprintId"] | "0").toInt();
    if (!fpId) continue;
    evictCacheIfFull();
    CacheEntry e;
    e.role = (uint8_t)roleFromStr(m["role"] | "member");
    strncpy(e.name, m["name"] | "Unknown", MAX_NAME_LEN);
    e.name[MAX_NAME_LEN] = '\0';
    roleCache[fpId] = e;
    loaded++;
  }
  saveCache();
  Serial.printf("[SYNC] %d members loaded\n", loaded);
}

AwResult postAttendance(uint16_t memberId, const char* name, const char* iso) {
  StaticJsonDocument<256> doc;
  doc["documentId"] = "unique()";
  JsonObject d = doc.createNestedObject("data");
  d["memberId"]         = String(memberId);
  d["deviceId"]         = DEVICE_ID;
  d["attendanceStatus"] = "present";
  d["timestamp"]        = iso;
  char payload[384]; serializeJson(doc, payload);
  return awPost(AW_COL_ATTEND, payload);
}

void flushAttendanceQueue() {
  if (attendanceQueue.empty() || WiFi.status() != WL_CONNECTED) return;
  Serial.printf("[QUEUE] Flushing %zu queued records...\n", attendanceQueue.size());
  size_t sent = 0;
  while (!attendanceQueue.empty()) {
    if (g_wdt_enabled) esp_task_wdt_reset();
    QueuedAttendance& qa = attendanceQueue.front();
    if (postAttendance(qa.memberId, qa.name, qa.iso) == AW_OK) {
      attendanceQueue.erase(attendanceQueue.begin());
      sent++;
    } else {
      break;   // HTTP error — stop and retry next cycle
    }
  }
  Serial.printf("[QUEUE] Flushed %zu records (%zu remaining)\n",
                sent, attendanceQueue.size());
}

bool registerMember(uint16_t fpId, const char* name, const char* role) {
  StaticJsonDocument<256> doc;
  doc["documentId"] = "unique()";
  JsonObject d = doc.createNestedObject("data");
  d["fingerprintId"] = String(fpId);
  d["name"]          = name;
  d["role"]          = role;
  d["isActive"]      = true;
  char payload[384]; serializeJson(doc, payload);
  return awPost(AW_COL_MEMBERS, payload) == AW_OK;
}

bool fetchPendingCommand() {
  String query = buildQuery("deviceId", DEVICE_ID) + "&" +
                 buildQuery("status", "pending")   + "&" +
                 buildLimitQuery(1);
  String body = awGetList(AW_COL_COMMANDS, query);
  if (!body.length()) return false;

  DynamicJsonDocument doc(2048);
  if (deserializeJson(doc, body) != DeserializationError::Ok) return false;

  JsonArray docs = doc["documents"].as<JsonArray>();
  if (!docs.size()) return false;

  JsonObject cmd    = docs[0];
  pendingCmdId      = cmd["$id"]        | "";
  pendingCmdType    = cmd["command"]    | "";
  pendingMemberName = cmd["memberName"] | "";

  Serial.printf("[CMD] Received: '%s'\n", pendingCmdType.c_str());

  if      (pendingCmdType == "setupAdmin") emitEvent(EVT_CMD_SETUP_ADMIN);
  else if (pendingCmdType == "addAdmin")   emitEvent(EVT_CMD_ADD_ADMIN);
  else if (pendingCmdType == "addMember")  emitEvent(EVT_CMD_ADD_MEMBER);
  else if (pendingCmdType == "updateDevice") {
    syncMembers();
    completeCommand(pendingCmdId, "completed");
    logActivity("system", "Manual sync triggered", "info");
    pendingCmdId = ""; pendingCmdType = ""; pendingMemberName = "";
  }
  else if (pendingCmdType == "updateFirmware") {
    logActivity("system", "OTA update started", "warning");
    lcdShow("Downloading...", "Firmware Update");
    performOTA(pendingMemberName);   // memberName field carries the fileId
  }
  else if (pendingCmdType == "restartDevice") {
    if (pendingMemberName == "WIPE_DB") {
      logActivity("system", "Wiping fingerprint DB", "warning");
      lcdShow("Wiping DB...", "Please Wait");
      fps.emptyDatabase();
      roleCache.clear();
      EEPROM.write(0, 0x00);  // Invalidate magic — forces fresh cache on reboot
      EEPROM.commit();
    } else {
      logActivity("system", "Remote restart", "warning");
      lcdShow("Restarting...", "Remote Action");
    }
    // Mark completed BEFORE restart to prevent boot loop
    completeCommand(pendingCmdId, "completed");
    delay(2000); // Wait for HTTP response to reach backend
    ESP.restart();
  }
  else if (pendingCmdType == "unlockDoor") {
    unlockDoor("Remote Admin");
    completeCommand(pendingCmdId, "completed");
    pendingCmdId = ""; pendingCmdType = ""; pendingMemberName = "";
  }
  else {
    Serial.printf("[CMD] Unknown command type: '%s'\n", pendingCmdType.c_str());
    completeCommand(pendingCmdId, "failed");
    pendingCmdId = ""; pendingCmdType = ""; pendingMemberName = "";
  }

  return true;
}

bool completeCommand(const String& id, const String& status) {
  if (!id.length()) return false;
  StaticJsonDocument<128> doc;
  doc.createNestedObject("data")["status"] = status;
  char payload[192]; serializeJson(doc, payload);
  AwResult r = awPatch(AW_COL_COMMANDS, id.c_str(), payload);
  Serial.printf("[CMD] Completed status=%s result=%d\n", status.c_str(), r);
  return r == AW_OK;
}

void performOTA(const String& fileId) {
  if (WiFi.status() != WL_CONNECTED) {
    completeCommand(pendingCmdId, "failed");
    pendingCmdId = ""; pendingCmdType = ""; pendingMemberName = "";
    return;
  }

  lcdShow("OTA Update", "Downloading...");
  HTTPClient http;
  char url[300];
  snprintf(url, sizeof(url), "%s/storage/buckets/%s/files/%s/download",
           AW_ENDPOINT, AW_FIRMWARE_BUCKET, fileId.c_str());
  http.begin(url);
  awHeaders(http);

  int code = http.GET();
  bool otaSuccess = false;

  if (code == 200) {
    int len = http.getSize();
    if (Update.begin(len > 0 ? len : UPDATE_SIZE_UNKNOWN)) {
      lcdShow("OTA Update", "Flashing...");
      WiFiClient* stream = http.getStreamPtr();
      size_t written = Update.writeStream(*stream);

      if ((len < 0 || written == (size_t)len) && Update.end()) {
        otaSuccess = true;
      } else {
        Serial.printf("[OTA] Write error — written=%zu expected=%d err=%s\n",
                      written, len, Update.errorString());
        Update.abort();
      }
    } else {
      Serial.printf("[OTA] Update.begin() failed: %s\n", Update.errorString());
    }
  } else {
    Serial.printf("[OTA] Download failed — HTTP %d\n", code);
  }

  http.end();

  if (otaSuccess) {
    completeCommand(pendingCmdId, "completed");
    lcdShow("OTA Success!", "Restarting...");
    delay(2000);
    ESP.restart();
  } else {
    lcdShow("OTA Failed!", ("HTTP " + String(code)).c_str());
    completeCommand(pendingCmdId, "failed");
    logActivity("system", ("OTA failed HTTP=" + String(code)).c_str(), "error");
  }

  pendingCmdId = ""; pendingCmdType = ""; pendingMemberName = "";
  delay(2000);
}

void logActivity(const char* eventType, const char* message,
                 const char* severity, uint16_t memberId) {
  if (WiFi.status() != WL_CONNECTED) return;
  char iso[26]; getCurrentISO8601(iso, sizeof(iso));

  StaticJsonDocument<320> doc;
  doc["documentId"] = "unique()";
  JsonObject d = doc.createNestedObject("data");
  d["eventType"] = eventType;
  d["message"]   = message;
  d["eventTime"] = iso;
  d["deviceId"]  = DEVICE_ID;
  d["severity"]  = severity;
  if (memberId > 0) d["memberId"] = String(memberId);
  char payload[512]; serializeJson(doc, payload);
  awPost(AW_COL_ACTIVITY, payload);
}

void upsertDeviceStatus(const char* status) {
  if (WiFi.status() != WL_CONNECTED) return;

  esp_task_wdt_reset(); 
  int rssi        = WiFi.RSSI();
  int wifiQuality = constrain(map(rssi, -100, -50, 0, 100), 0, 100);
  char iso[26];   getCurrentISO8601(iso, sizeof(iso));

  // Look up device doc ID once and cache it
  if (!deviceDocId.length()) {
    String q    = buildQuery("deviceId", DEVICE_ID) + "&" + buildLimitQuery(1);
    String body = awGetList(AW_COL_DEVICES, q);
    if (body.length()) {
      DynamicJsonDocument doc(1024);
      if (deserializeJson(doc, body) == DeserializationError::Ok) {
        JsonArray arr = doc["documents"].as<JsonArray>();
        if (arr.size()) deviceDocId = arr[0]["$id"] | "";
      }
    }
  }

  if (g_wdt_enabled) esp_task_wdt_reset();
  StaticJsonDocument<256> doc;
  JsonObject d = doc.createNestedObject("data");
  d["status"]          = status;
  d["wifiStrength"]    = wifiQuality;
  d["totalScansToday"] = (int)totalScansToday;
  d["firmwareVersion"] = FIRMWARE_VERSION;
  d["lastSeen"]        = iso;
  char payload[512]; serializeJson(doc, payload);

  if (deviceDocId.length()) {
    awPatch(AW_COL_DEVICES, deviceDocId.c_str(), payload);
  } else {
    // First boot — create the row and cache the new doc ID
    doc["documentId"] = "unique()";
    d["deviceId"]     = DEVICE_ID;
    serializeJson(doc, payload);
    String resp;
    if (awPost(AW_COL_DEVICES, payload, &resp) == AW_OK) {
      DynamicJsonDocument tmp(512);
      if (deserializeJson(tmp, resp) == DeserializationError::Ok)
        deviceDocId = tmp["$id"] | "";
      Serial.println(F("[DEVICE] Row created"));
    }
  }
}

// ════════════════════════════════════════════════════════════════
//  CACHE — EEPROM PERSISTENCE WITH LRU CAP
// ════════════════════════════════════════════════════════════════
void evictCacheIfFull() {
  if (roleCache.size() >= MAX_CACHE_ENTRIES) {
    // Evict the numerically-lowest key (oldest by convention)
    roleCache.erase(roleCache.begin());
    Serial.println(F("[CACHE] Evicted oldest entry (LRU cap)"));
  }
}

void saveCache() {
  int addr = 0;
  EEPROM.write(addr++, EEPROM_MAGIC);
  uint8_t cnt = (uint8_t)min((int)roleCache.size(), 20);  // cap at 20 in EEPROM
  EEPROM.write(addr++, cnt);
  int written = 0;
  for (auto& kv : roleCache) {
    if (written++ >= cnt || addr + MAX_NAME_LEN + 5 >= EEPROM_SIZE) break;
    EEPROM.write(addr++, (kv.first >> 8) & 0xFF);
    EEPROM.write(addr++, kv.first & 0xFF);
    EEPROM.write(addr++, kv.second.role);
    uint8_t nl = (uint8_t)strnlen(kv.second.name, MAX_NAME_LEN);
    EEPROM.write(addr++, nl);
    for (int i = 0; i < nl; i++) EEPROM.write(addr++, kv.second.name[i]);
  }
  EEPROM.commit();
}

void loadCache() {
  if (EEPROM.read(0) != EEPROM_MAGIC) {
    Serial.println(F("[CACHE] No valid cache found"));
    return;
  }
  int     addr  = 1;
  uint8_t count = EEPROM.read(addr++);
  for (int i = 0; i < count && addr + 4 < EEPROM_SIZE; i++) {
    uint16_t id  = ((uint16_t)EEPROM.read(addr++) << 8) | EEPROM.read(addr++);
    uint8_t  rl  = EEPROM.read(addr++);
    uint8_t  nl  = EEPROM.read(addr++);
    CacheEntry e; e.role = rl; memset(e.name, 0, sizeof(e.name));
    uint8_t readLen = min((int)nl, MAX_NAME_LEN);
    for (int j = 0; j < readLen && addr < EEPROM_SIZE; j++)
      e.name[j] = (char)EEPROM.read(addr++);
    if (nl > MAX_NAME_LEN) addr += (nl - MAX_NAME_LEN); // skip overflow bytes
    roleCache[id] = e;
  }
  Serial.printf("[CACHE] Loaded %d entries\n", (int)roleCache.size());
}

// ════════════════════════════════════════════════════════════════
//  SECURITY HELPERS
// ════════════════════════════════════════════════════════════════
// Zero-fills a sensitive buffer (prevents compiler from optimizing out)
void scrubBuffer(char* buf, size_t len) {
  volatile char* p = buf;
  while (len--) *p++ = 0;
}

// ════════════════════════════════════════════════════════════════
//  LCD HELPERS
// ════════════════════════════════════════════════════════════════
void lcdShow(const char* l1, const char* l2) {
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print(l1);
  lcd.setCursor(0, 1); if (l2) lcd.print(l2);
}
void lcdShow(const char* l1, const String& l2) { lcdShow(l1, l2.c_str()); }

// ════════════════════════════════════════════════════════════════
//  ROLE HELPERS
// ════════════════════════════════════════════════════════════════
const char* roleStr(Role r) {
  switch (r) {
    case ROLE_SUPER_ADMIN: return "super_admin";
    case ROLE_ADMIN:       return "admin";
    case ROLE_MEMBER:      return "member";
    default:               return "none";
  }
}

Role roleFromStr(const char* s) {
  if (!s) return ROLE_NONE;
  if (strcmp(s, "super_admin") == 0) return ROLE_SUPER_ADMIN;
  if (strcmp(s, "admin")       == 0) return ROLE_ADMIN;
  if (strcmp(s, "member")      == 0) return ROLE_MEMBER;
  return ROLE_NONE;
}
