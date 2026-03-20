/*
 * ╔══════════════════════════════════════════════════════════════╗
 * ║        ASGS ATTENDANCE SYSTEM — ESP32 FIRMWARE              ║
 * ║        Event-Driven Biometric Access Management             ║
 * ║                                                             ║
 * ║  Hardware : ESP32 + R307S Fingerprint + I2C LCD 16x2        ║
 * ║  Backend  : Appwrite Cloud                                  ║
 * ║  Tables   : members, attendance, devices,                   ║
 * ║             device_commands, activity_events                ║
 * ╚══════════════════════════════════════════════════════════════╝
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
#include <WiFiManager.h>
#include <Preferences.h>
#include <Update.h>

// ════════════════════════════════════════════════════════════════
//  ⚙️  CONFIGURATION — EDIT THESE BEFORE FLASHING
// ════════════════════════════════════════════════════════════════

// ─── Appwrite ───────────────────────────────────────────────────
#define AW_ENDPOINT       "https://syd.cloud.appwrite.io/v1"
#define AW_DATABASE_ID    "69a43553003c581b441b"
#define AW_COL_MEMBERS    "members"           
#define AW_COL_ATTEND     "attendance"        
#define AW_COL_DEVICES    "devices"           
#define AW_COL_COMMANDS   "device_commands"   
#define AW_COL_ACTIVITY   "activity_events"
#define AW_FIRMWARE_BUCKET "firmware_updates"
#define DEVICE_ID         "ESP32_DEVICE_01"
#define FIRMWARE_VERSION  "2.1.0" // OTA Upgraded Version

// ─── Hardware Pins ──────────────────────────────────────────────
#define FPS_RX_PIN        16    
#define FPS_TX_PIN        17    
#define TOUCH_PIN         4     
#define LCD_SDA           21
#define LCD_SCL           22
#define LCD_ADDR          0x27  

// ─── Timing ─────────────────────────────────────────────────────
#define ENROLL_TIMEOUT_MS     20000   
#define ANTI_SPAM_MS          10000   
#define CMD_POLL_INTERVAL_MS   3000   
#define HEARTBEAT_INTERVAL_MS 30000   
#define WIFI_RETRY_MS          8000   

// ─── EEPROM ─────────────────────────────────────────────────────
#define EEPROM_SIZE           512
#define EEPROM_MAGIC          0xAB

// ════════════════════════════════════════════════════════════════
//  STATE MACHINE
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

// ════════════════════════════════════════════════════════════════
//  EVENTS
// ════════════════════════════════════════════════════════════════
enum SystemEvent {
  EVT_NONE,
  EVT_TOUCH_DETECTED,
  EVT_CMD_SETUP_ADMIN,
  EVT_CMD_ADD_ADMIN,
  EVT_CMD_ADD_MEMBER
};

// ════════════════════════════════════════════════════════════════
//  ROLES
// ════════════════════════════════════════════════════════════════
enum Role { ROLE_NONE = 0, ROLE_SUPER_ADMIN = 1, ROLE_ADMIN = 2, ROLE_MEMBER = 3 };

struct CacheEntry {
  uint8_t role;
  String  name;
};

// ════════════════════════════════════════════════════════════════
//  GLOBALS
// ════════════════════════════════════════════════════════════════
HardwareSerial        fpsSerial(2);
Adafruit_Fingerprint  fps(&fpsSerial);
LiquidCrystal_I2C     lcd(LCD_ADDR, 16, 2);

Preferences preferences;
char global_aw_project_id[64] = "69a428e6000c44acd7ac";
char global_aw_api_key[300] = "standard_500c0248d8ce756988bf0235bc5ce2f917d97505dec6dfcd1f140875e6913c49aa1077bc382dbb6d1c5289b77c526f1d77fabfe89620f56fa38b218c65562bc1a793080ea4bc01359d9b8e2b6fe3c014c38d552faa9ce0e981c05d137757398ba9c44183df83b8deb33c61968af4f4cd831fa68c3ca4aa7d48f7354a2a9b5751";
bool shouldSaveConfig = false;

SystemState  currentState    = STATE_BOOT;
SystemEvent  pendingEvent    = EVT_NONE;

std::map<uint16_t, CacheEntry> roleCache;     
std::map<uint16_t, uint32_t>   lastScanTime;  

String   pendingCmdId        = "";
String   pendingCmdType      = "";
String   pendingMemberName   = "";
uint16_t verifiedAdminId     = 0;

uint32_t enrollStart         = 0;
uint32_t lastCmdPoll         = 0;
uint32_t lastHeartbeat       = 0;
uint32_t lastWifiRetry       = 0;
uint32_t totalScansToday     = 0;
bool     touchWasHigh        = false;
String   deviceDocId         = "";   

// ════════════════════════════════════════════════════════════════
//  FORWARD DECLARATIONS
// ════════════════════════════════════════════════════════════════
void     handleState();
void     emitEvent(SystemEvent e);
void     transitionTo(SystemState s);
void     lcdShow(const char* l1, const char* l2 = "");
void     lcdShow(const char* l1, const String& l2);
bool     enrollFinger(uint16_t id);
int16_t  identifyFinger();
void     syncMembers();
bool     postAttendance(uint16_t memberId, const String& name);
bool     fetchPendingCommand();
bool     completeCommand(const String& id, const String& status);
void     performOTA(const String& fileId);
bool     registerMember(uint16_t fpId, const String& name, const String& role);
void     logActivity(const String& eventType, const String& message,
                     const String& severity = "info", uint16_t memberId = 0);
void     upsertDeviceStatus(const String& status);
void     saveCache();
void     loadCache();
String   roleStr(Role r);
Role     roleFromStr(const String& s);
String   appwriteURL(const String& col, const String& path = "");
void     awHeaders(HTTPClient& h);
int      awPost(const char* col, const char* payload);
int      awPatch(const char* col, const char* docId, const char* payload);
String   awGetList(const char* col, const String& query = "");
String   buildLimitQuery(int n);
String   getCurrentISO8601(); // New helper to get time

// ════════════════════════════════════════════════════════════════
//  SETUP
// ════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  Serial.println(F("\n╔══════════════════════════════╗"));
  Serial.println(F(  "║   ASGS Attendance System     ║"));
  Serial.println(F(  "║   Firmware v1.0.0            ║"));
  Serial.println(F(  "╚══════════════════════════════╝"));

  Wire.begin(LCD_SDA, LCD_SCL);
  lcd.init();
  lcd.backlight();
  lcdShow("ASGS Attendance", "Booting...");

  pinMode(TOUCH_PIN, INPUT);

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
  Serial.printf("[FPS] OK — Capacity: %d templates stored: %d\n", fps.capacity, fps.templateCount);

  preferences.begin("asgs", false);
  if (preferences.isKey("aw_proj")) {
    preferences.getString("aw_proj", global_aw_project_id, 64);
  }
  if (preferences.isKey("aw_api")) {
    preferences.getString("aw_api", global_aw_api_key, 300);
  }

  WiFiManagerParameter custom_aw_project_id("project_id", "Appwrite Project ID", global_aw_project_id, 64);
  WiFiManagerParameter custom_aw_api_key("api_key", "Appwrite API Key", global_aw_api_key, 300);

  WiFiManager wm;
  wm.addParameter(&custom_aw_project_id);
  wm.addParameter(&custom_aw_api_key);
  wm.setSaveConfigCallback([]() {
    shouldSaveConfig = true;
  });

  lcdShow("Connecting WiFi", "ASGS_Setup if fail");
  bool res = wm.autoConnect("ASGS_Setup");

  if (shouldSaveConfig) {
    strncpy(global_aw_project_id, custom_aw_project_id.getValue(), 64);
    strncpy(global_aw_api_key, custom_aw_api_key.getValue(), 300);
    preferences.putString("aw_proj", global_aw_project_id);
    preferences.putString("aw_api", global_aw_api_key);
    Serial.println(F("[SYSTEM] Config saved to NVS"));
  }

  if (res) {
    Serial.println("\n[WIFI] Connected — " + WiFi.localIP().toString());
    lcdShow("WiFi Connected!", WiFi.localIP().toString().c_str());
    delay(1500);
    syncMembers();
    upsertDeviceStatus("online");
    logActivity("login", "ASGS device booted (v" FIRMWARE_VERSION ")", "info");
  } else {
    Serial.println(F("\n[WIFI] Failed — offline mode active"));
    lcdShow("WiFi Failed", "Offline Mode");
    delay(1500);
  }

  transitionTo(STATE_IDLE);
}

// ════════════════════════════════════════════════════════════════
//  MAIN LOOP
// ════════════════════════════════════════════════════════════════
void loop() {
  uint32_t now = millis();

  if (WiFi.status() != WL_CONNECTED && now - lastWifiRetry > WIFI_RETRY_MS) {
    lastWifiRetry = now;
    Serial.println(F("[WIFI] Reconnecting..."));
    WiFi.reconnect();
  }

  if (currentState == STATE_IDLE) {
    bool hi = digitalRead(TOUCH_PIN) == HIGH;
    if (hi && !touchWasHigh) {
      emitEvent(EVT_TOUCH_DETECTED);
    } else if (fps.getImage() == FINGERPRINT_OK) {
      // Fallback: poll the optical sensor directly if the touch wire isn't connected
      emitEvent(EVT_TOUCH_DETECTED);
    }
    touchWasHigh = hi;
  }

  bool inAction = (currentState == STATE_SUPER_ADMIN_SETUP ||
                   currentState == STATE_ADMIN_ADD_MODE    ||
                   currentState == STATE_MEMBER_ENROLL     ||
                   currentState == STATE_ADMIN_VERIFY);
  if (inAction && now - enrollStart > ENROLL_TIMEOUT_MS) {
    Serial.println(F("[TIMEOUT] Action timed out — returning to idle"));
    lcdShow("Timed Out!", "Going Idle...");
    if (pendingCmdId.length()) completeCommand(pendingCmdId, "timeout");
    logActivity("timeout", "Action timed out: " + pendingCmdType, "warning");
    pendingCmdId = ""; pendingCmdType = ""; pendingMemberName = "";
    delay(2000);
    transitionTo(STATE_IDLE);
    return;
  }

  if (currentState == STATE_IDLE && WiFi.status() == WL_CONNECTED && now - lastCmdPoll > CMD_POLL_INTERVAL_MS) {
    lastCmdPoll = now;
    fetchPendingCommand();
  }

  if (WiFi.status() == WL_CONNECTED && now - lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
    lastHeartbeat = now;
    upsertDeviceStatus("online");
  }

  handleState();
  delay(40);
}

// ════════════════════════════════════════════════════════════════
//  STATE HANDLER
// ════════════════════════════════════════════════════════════════
void handleState() {
  switch (currentState) {

    case STATE_IDLE:
      if (pendingEvent == EVT_TOUCH_DETECTED) {
        pendingEvent = EVT_NONE;
        transitionTo(STATE_ATTENDANCE_SCAN);
      } else if (pendingEvent == EVT_CMD_SETUP_ADMIN) {
        pendingEvent = EVT_NONE;
        transitionTo(STATE_SUPER_ADMIN_SETUP);
      } else if (pendingEvent == EVT_CMD_ADD_ADMIN ||
                 pendingEvent == EVT_CMD_ADD_MEMBER) {
        pendingEvent = EVT_NONE;
        transitionTo(STATE_ADMIN_VERIFY);
      }
      break;

    case STATE_ATTENDANCE_SCAN: {
      lcdShow("Scan Finger", "Place on sensor");
      int16_t id = identifyFinger();

      if (id > 0) {
        uint32_t now = millis();

        if (lastScanTime.count(id) && now - lastScanTime[id] < ANTI_SPAM_MS) {
          uint32_t wait = (ANTI_SPAM_MS - (now - lastScanTime[id])) / 1000 + 1;
          lcdShow("Already Scanned!", ("Wait " + String(wait) + "s").c_str());
          Serial.printf("[ATTEND] Anti-spam: ID %d blocked (%ds left)\n", id, wait);
          delay(2500);
          transitionTo(STATE_IDLE);
          return;
        }

        lastScanTime[id] = now;
        totalScansToday++;

        String name = "Unknown";
        Role   role = ROLE_MEMBER;
        if (roleCache.count(id)) {
          name = roleCache[id].name;
          role = (Role)roleCache[id].role;
        }

        if (role == ROLE_SUPER_ADMIN || role == ROLE_ADMIN) {
          lcdShow("Welcome Admin!", name.c_str());
        } else {
          lcdShow("Welcome!", name.c_str());
        }

        Serial.printf("[ATTEND] ID %d — %s (%s)\n", id, name.c_str(), roleStr(role).c_str());
        postAttendance(id, name);
        logActivity("scan", "Scan: " + name, "info", id);
        delay(2500);

      } else {
        lcdShow("Not Recognized", "Try Again");
        Serial.println(F("[ATTEND] Finger not in system"));
        delay(2000);
      }
      transitionTo(STATE_IDLE);
      break;
    }

    case STATE_SUPER_ADMIN_SETUP: {
      lcdShow("Setup SuperAdmin", "Place Finger");
      fps.getTemplateCount();
      uint16_t newId = fps.templateCount + 1;

      if (enrollFinger(newId)) {
        CacheEntry e; e.role = ROLE_SUPER_ADMIN; e.name = "Super Admin";
        roleCache[newId] = e;
        saveCache();
        registerMember(newId, "Super Admin", "super_admin");
        completeCommand(pendingCmdId, "completed");
        logActivity("super_admin_setup", "Super Admin enrolled — FP ID " + String(newId), "info", newId);
        lcdShow("Super Admin Set!", "FP ID: " + String(newId));
        Serial.printf("[SETUP] Super Admin enrolled — FP ID %d\n", newId);
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

    case STATE_ADMIN_VERIFY: {
      bool needSuper = (pendingCmdType == "addAdmin");
      lcdShow(needSuper ? "SuperAdmin Scan" : "Admin Scan", "Verify to proceed");

      int16_t id = identifyFinger();

      if (id > 0 && roleCache.count(id)) {
        Role r   = (Role)roleCache[id].role;
        bool ok  = needSuper ? (r == ROLE_SUPER_ADMIN)
                             : (r == ROLE_ADMIN || r == ROLE_SUPER_ADMIN);
        if (ok) {
          verifiedAdminId = id;
          lcdShow("Verified!", roleCache[id].name.c_str());
          Serial.printf("[AUTH] Authorized by '%s' (ID %d)\n", roleCache[id].name.c_str(), id);
          delay(1500);
          if (pendingCmdType == "addAdmin") transitionTo(STATE_ADMIN_ADD_MODE);
          else                              transitionTo(STATE_MEMBER_ENROLL);
        } else {
          lcdShow("Access Denied!", "Not Authorized");
          Serial.printf("[AUTH] Denied — role '%s' cannot do '%s'\n", roleStr(r).c_str(), pendingCmdType.c_str());
          logActivity("auth_denied", "Role " + roleStr(r) + " denied for " + pendingCmdType, "warning", id);
          completeCommand(pendingCmdId, "unauthorized");
          pendingCmdId = ""; pendingCmdType = ""; pendingMemberName = "";
          delay(2500);
          transitionTo(STATE_IDLE);
        }
      } else {
        lcdShow("Not Recognized", "Scan Cancelled");
        Serial.printf("[AUTH] Unknown finger (ID %d)\n", id);
        completeCommand(pendingCmdId, "failed");
        pendingCmdId = ""; pendingCmdType = ""; pendingMemberName = "";
        delay(2000);
        transitionTo(STATE_IDLE);
      }
      break;
    }

    case STATE_ADMIN_ADD_MODE: {
      lcdShow("New Admin", "Place Finger Now");
      fps.getTemplateCount();
      uint16_t newId = fps.templateCount + 1;

      if (enrollFinger(newId)) {
        String name = pendingMemberName.length() ? pendingMemberName : ("Admin " + String(newId));
        CacheEntry e; e.role = ROLE_ADMIN; e.name = name;
        roleCache[newId] = e;
        saveCache();
        registerMember(newId, name, "admin");
        completeCommand(pendingCmdId, "completed");
        logActivity("admin_enrolled", "Admin '" + name + "' enrolled (FP" + String(newId) + ") by admin ID " + String(verifiedAdminId), "info", newId);
        lcdShow("Admin Added!", name.c_str());
        Serial.printf("[ENROLL] Admin '%s' — FP ID %d\n", name.c_str(), newId);
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

    case STATE_MEMBER_ENROLL: {
      lcdShow("Enroll Member", "Place Finger Now");
      fps.getTemplateCount();
      uint16_t newId = fps.templateCount + 1;

      if (enrollFinger(newId)) {
        String name = pendingMemberName.length() ? pendingMemberName : ("Member " + String(newId));
        CacheEntry e; e.role = ROLE_MEMBER; e.name = name;
        roleCache[newId] = e;
        saveCache();
        registerMember(newId, name, "member");
        completeCommand(pendingCmdId, "completed");
        logActivity("member_enrolled", "Member '" + name + "' enrolled (FP" + String(newId) + ") by admin ID " + String(verifiedAdminId), "info", newId);
        lcdShow("Member Added!", name.c_str());
        Serial.printf("[ENROLL] Member '%s' — FP ID %d\n", name.c_str(), newId);
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

    case STATE_ERROR:
      lcdShow("SYSTEM ERROR", "Restart Device");
      delay(5000);
      break;

    default: break;
  }
}

// ════════════════════════════════════════════════════════════════
//  STATE TRANSITIONS
// ════════════════════════════════════════════════════════════════
void transitionTo(SystemState s) {
  currentState = s;
  pendingEvent = EVT_NONE;
  enrollStart  = millis();
  switch (s) {
    case STATE_IDLE: lcdShow("ASGS Attendance", "Touch to Scan"); break;
    case STATE_ATTENDANCE_SCAN: lcdShow("Scan Finger", "Place on sensor"); break;
    case STATE_SUPER_ADMIN_SETUP: lcdShow("Setup SuperAdmin", "Place Finger"); break;
    case STATE_ADMIN_VERIFY: lcdShow("Verify Admin", "Scan Finger"); break;
    case STATE_ADMIN_ADD_MODE: lcdShow("New Admin", "Place Finger Now"); break;
    case STATE_MEMBER_ENROLL: lcdShow("Enroll Member", "Place Finger Now"); break;
    default: break;
  }
}

void emitEvent(SystemEvent e) { pendingEvent = e; }

// ════════════════════════════════════════════════════════════════
//  FINGERPRINT
// ════════════════════════════════════════════════════════════════
bool enrollFinger(uint16_t id) {
  Serial.printf("[FPS] Enrolling ID %d...\n", id);
  enrollStart = millis();

  // ----- IMAGE 1 -----
  lcdShow("Place Finger", "Firmly & steady");
  bool img1_ok = false;
  while (millis() - enrollStart < ENROLL_TIMEOUT_MS) {
    uint8_t p = fps.getImage();
    if (p == FINGERPRINT_OK) {
      lcdShow("Hold Still...", "Capturing...");
      delay(400); // 400ms stabilization delay
      fps.getImage(); // Capture stabilized image
      p = fps.image2Tz(1);
      if (p == FINGERPRINT_OK) {
        img1_ok = true;
        break;
      } else if (p == FINGERPRINT_IMAGEMESS) {
        lcdShow("Try Again", "Press Firmly...");
        delay(1000);
      } else {
        lcdShow("Try Again", "...");
        delay(1000);
      }
      lcdShow("Place Finger", "Firmly & steady"); // Reset prompt
    }
    delay(50);
  }
  if (!img1_ok) return false;

  // ----- LIFT FINGER -----
  lcdShow("Remove Finger", "");
  delay(600);
  while (fps.getImage() != FINGERPRINT_NOFINGER) delay(50);
  delay(600);

  // ----- IMAGE 2 -----
  lcdShow("Place Again", "Same finger");
  enrollStart = millis(); // Reset timeout
  bool img2_ok = false;
  while (millis() - enrollStart < ENROLL_TIMEOUT_MS) {
    uint8_t p = fps.getImage();
    if (p == FINGERPRINT_OK) {
      lcdShow("Hold Still...", "Capturing...");
      delay(400);
      fps.getImage();
      p = fps.image2Tz(2);
      if (p == FINGERPRINT_OK) {
        img2_ok = true;
        break;
      } else if (p == FINGERPRINT_IMAGEMESS) {
        lcdShow("Try Again", "Press Firmly...");
        delay(1000);
      } else {
        lcdShow("Try Again", "...");
        delay(1000);
      }
      lcdShow("Place Again", "Same finger");
    }
    delay(50);
  }
  if (!img2_ok) return false;

  // ----- CREATE MODEL -----
  if (fps.createModel() != FINGERPRINT_OK) {
    lcdShow("Fingers Don't", "Match! Try Again");
    delay(2000);
    return false;
  }
  if (fps.storeModel(id) != FINGERPRINT_OK) return false;

  return true;
}

int16_t identifyFinger() {
  uint32_t start = millis();
  bool firstDetect = true;
  
  while (millis() - start < 6000) {
    uint8_t p = fps.getImage();
    if (p == FINGERPRINT_OK) {
      if (firstDetect) {
        lcdShow("Hold Still...", "Scanning...");
        delay(300); // 300ms hardware stabilization delay
        fps.getImage(); // Capture the stabilized image
        firstDetect = false;
      }
      
      p = fps.image2Tz();
      if (p == FINGERPRINT_OK) {
        p = fps.fingerFastSearch(); // HIGH-SPEED SEARCH ALGORITHM
        if (p != FINGERPRINT_OK) {
          // If fast search fails, fallback to deeper exhaustive mapping search
          p = fps.fingerSearch(); 
        }

        if (p == FINGERPRINT_OK) {
          return fps.fingerID; // Perfect match found!
        } else if (p == FINGERPRINT_NOTFOUND) {
          lcdShow("Try Again", "Adjust Finger");
          delay(400);
        } else {
          lcdShow("Try Again", "...");
          delay(400);
        }
      } else if (p == FINGERPRINT_IMAGEMESS) {
        lcdShow("Try Again", "Press Firmly");
        delay(400);
      } else {
        lcdShow("Try Again", "...");
        delay(400);
      }
    } else if (p == FINGERPRINT_NOFINGER) {
      if (!firstDetect) {
         // User pulled finger away too early before timeout
         firstDetect = true; 
         lcdShow("Finger Removed", "Place Again!");
         delay(600);
         lcdShow("Keep Holding", "...");
      }
    }
    delay(50);
  }
  return -1; // Timed out after 6 seconds
}

// ════════════════════════════════════════════════════════════════
//  DATE HELPER
// ════════════════════════════════════════════════════════════════
String getCurrentISO8601() {
  // Returns a dynamic ISO string using millis() to ensure Appwrite recognizes unique payloads
  char timeStr[35]; 
  snprintf(timeStr, sizeof(timeStr), "2025-01-01T12:00:%02d.%03d+00:00", (int)(millis()/1000)%60, (int)(millis()%1000));
  return String(timeStr); 
}

// ════════════════════════════════════════════════════════════════
//  APPWRITE HTTP LAYER
// ════════════════════════════════════════════════════════════════
void buildURL(char* buf, size_t maxLen, const char* col, const char* path = "") {
  snprintf(buf, maxLen, "%s/databases/%s/collections/%s/documents%s", 
           AW_ENDPOINT, AW_DATABASE_ID, col, path);
}

void awHeaders(HTTPClient& h) {
  h.addHeader("Content-Type",       "application/json");
  h.addHeader("X-Appwrite-Project", global_aw_project_id);
  h.addHeader("X-Appwrite-Key",     global_aw_api_key);
}

int awPost(const char* col, const char* payload) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  HTTPClient http;
  char url[256];
  buildURL(url, sizeof(url), col);
  http.begin(url);
  awHeaders(http);
  int code = http.POST((uint8_t*)payload, strlen(payload));
  if (code != 201) {
    Serial.printf("[POST] %s → HTTP %d\n", col, code);
  }
  http.end();
  return code;
}

int awPatch(const char* col, const char* docId, const char* payload) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  HTTPClient http;
  char url[256];
  char path[128];
  snprintf(path, sizeof(path), "/%s", docId);
  buildURL(url, sizeof(url), col, path);
  http.begin(url);
  awHeaders(http);
  int code = http.sendRequest("PATCH", (uint8_t*)payload, strlen(payload));
  if (code != 200) {
    Serial.printf("[PATCH] %s → HTTP %d\n", docId, code);
  }
  http.end();
  return code;
}

String awGetList(const char* col, const String& query) {
  if (WiFi.status() != WL_CONNECTED) return "";
  HTTPClient http;
  char base[256];
  buildURL(base, sizeof(base), col);
  String url = String(base) + (query.length() ? "?" + query : "");
  Serial.println("[GET] → " + url);
  http.begin(url);
  awHeaders(http);
  int code = http.GET();
  String body = "";
  if (code == 200) {
    body = http.getString();
  }
  http.end();
  return body;
}

// ════════════════════════════════════════════════════════════════
//  APPWRITE ACTIONS
// ════════════════════════════════════════════════════════════════

void syncMembers() {
  Serial.println(F("[SYNC] Fetching members..."));
  String body = awGetList(AW_COL_MEMBERS);
  if (!body.length()) return;
  DynamicJsonDocument doc(8192);
  if (deserializeJson(doc, body)) return;
  int loaded = 0;
  for (JsonObject m : doc["documents"].as<JsonArray>()) {
    String fpStr = m["fingerprintId"] | "0";
    uint16_t fpId = fpStr.toInt();
    if (!fpId) continue;
    CacheEntry e;
    e.name = m["name"] | "Unknown";
    e.role = (uint8_t)roleFromStr(m["role"] | "member");
    roleCache[fpId] = e;
    loaded++;
  }
  saveCache();
  Serial.printf("[SYNC] Done — %d members loaded\n", loaded);
}

bool postAttendance(uint16_t memberId, const String& name) {
  StaticJsonDocument<256> doc;
  doc["documentId"] = "unique()";
  JsonObject d = doc.createNestedObject("data");
  d["memberId"]         = String(memberId); 
  d["deviceId"]         = DEVICE_ID;
  d["attendanceStatus"] = "present";
  d["timestamp"]        = getCurrentISO8601();
  char payload[512]; serializeJson(doc, payload);
  int code = awPost(AW_COL_ATTEND, payload);
  return code == 201;
}

bool registerMember(uint16_t fpId, const String& name, const String& role) {
  StaticJsonDocument<256> doc;
  doc["documentId"] = "unique()";
  JsonObject d = doc.createNestedObject("data");
  d["fingerprintId"] = String(fpId); 
  d["name"]          = name;
  d["role"]          = role;
  d["isActive"]      = true;
  char payload[512]; serializeJson(doc, payload);
  return awPost(AW_COL_MEMBERS, payload) == 201;
}

// Appwrite REST API requires JSON object query format:
//   queries[]={"method":"equal","attribute":"field","values":["value"]}
String buildQuery(const String& field, const String& value) {
  String json = "{\"method\":\"equal\",\"attribute\":\"" + field + "\",\"values\":[\"" + value + "\"]}";
  String encoded = "";
  for (int i = 0; i < json.length(); i++) {
    char c = json[i];
    if (c == '{')       encoded += "%7B";
    else if (c == '}')  encoded += "%7D";
    else if (c == '"')  encoded += "%22";
    else if (c == ':')  encoded += "%3A";
    else if (c == ',')  encoded += "%2C";
    else if (c == '[')  encoded += "%5B";
    else if (c == ']')  encoded += "%5D";
    else                encoded += c;
  }
  return "queries%5B%5D=" + encoded;
}

String buildLimitQuery(int n) {
  String json = "{\"method\":\"limit\",\"values\":[" + String(n) + "]}";
  String encoded = "";
  for (int i = 0; i < json.length(); i++) {
    char c = json[i];
    if (c == '{')       encoded += "%7B";
    else if (c == '}')  encoded += "%7D";
    else if (c == '"')  encoded += "%22";
    else if (c == ':')  encoded += "%3A";
    else if (c == ',')  encoded += "%2C";
    else if (c == '[')  encoded += "%5B";
    else if (c == ']')  encoded += "%5D";
    else                encoded += c;
  }
  return "queries%5B%5D=" + encoded;
}

bool fetchPendingCommand() {
  // Exact Appwrite 1.5+ array passing syntax
  String query = buildQuery("deviceId", DEVICE_ID) + "&" +
                 buildQuery("status", "pending") + "&" +
                 buildLimitQuery(1);

  String body = awGetList(AW_COL_COMMANDS, query);
  if (!body.length()) return false;

  DynamicJsonDocument doc(2048);
  if (deserializeJson(doc, body)) return false;

  JsonArray docs = doc["documents"].as<JsonArray>();
  if (!docs.size()) return false;

  JsonObject cmd    = docs[0];
  pendingCmdId      = cmd["$id"] | "";
  pendingCmdType    = cmd["command"] | "";       
  pendingMemberName = cmd["memberName"] | "";    

  Serial.printf("[CMD] Got: '%s'\n", pendingCmdType.c_str());

  if      (pendingCmdType == "setupAdmin") emitEvent(EVT_CMD_SETUP_ADMIN);
  else if (pendingCmdType == "addAdmin")   emitEvent(EVT_CMD_ADD_ADMIN);
  else if (pendingCmdType == "addMember")  emitEvent(EVT_CMD_ADD_MEMBER);
  else if (pendingCmdType == "updateDevice") {
    syncMembers();
    completeCommand(pendingCmdId, "completed");
    logActivity("system", "Manual sync triggered from Dashboard", "info");
    pendingCmdId = ""; pendingCmdType = ""; pendingMemberName = "";
  }
  else if (pendingCmdType == "updateFirmware") {
    logActivity("system", "Firmware OTA update started", "warning");
    lcdShow("Downloading...", "Firmware Updater");
    String fileId = pendingMemberName; 
    performOTA(fileId);
  }
  else if (pendingCmdType == "restartDevice") {
    if (pendingMemberName == "WIPE_DB") {
      logActivity("system", "Wiping physical fingerprint DB...", "danger");
      lcdShow("Wiping DB...", "Please Wait");
      fps.emptyDatabase();
      roleCache.clear();
      saveCache();
      delay(1000);
      lcdShow("DB Wiped!", "Restarting...");
    } else {
      logActivity("system", "Remote restart initiated", "warning");
      lcdShow("Restarting...", "Remote Action");
    }
    completeCommand(pendingCmdId, "completed");
    delay(1500);
    ESP.restart();
  }

  return true;
}

bool completeCommand(const String& id, const String& status) {
  if (!id.length()) return false;
  StaticJsonDocument<128> doc;
  JsonObject d = doc.createNestedObject("data");
  d["status"] = status;
  char payload[256]; serializeJson(doc, payload);
  int code = awPatch(AW_COL_COMMANDS, id.c_str(), payload);
  Serial.printf("[CMD] Completed — status=%s HTTP=%d\n", status.c_str(), code);
  return code == 200;
}

void performOTA(const String& fileId) {
  if (WiFi.status() != WL_CONNECTED) return;
  lcdShow("OTA Update", "Downloading...");
  HTTPClient http;
  
  char url[300];
  snprintf(url, sizeof(url), "%s/storage/buckets/%s/files/%s/download", AW_ENDPOINT, AW_FIRMWARE_BUCKET, fileId.c_str());
  
  http.begin(url);
  awHeaders(http);
  
  int code = http.GET();
  if (code == 200) {
    int len = http.getSize();
    bool canBegin = Update.begin(len > 0 ? len : UPDATE_SIZE_UNKNOWN);
    if (canBegin) {
      lcdShow("OTA Update", "Flashing...");
      WiFiClient* client = http.getStreamPtr();
      size_t written = Update.writeStream(*client);
      if (written == len || len == -1) {
        if (Update.end()) {
          completeCommand(pendingCmdId, "completed");
          lcdShow("OTA Success!", "Restarting...");
          delay(1000);
          ESP.restart();
        }
      }
    }
  }
  
  Serial.printf("[OTA] Failed! HTTP Code: %d\n", code);
  lcdShow("OTA Failed!", "HTTP " + String(code));
  completeCommand(pendingCmdId, "failed");
  http.end();
  
  pendingCmdId = ""; pendingCmdType = ""; pendingMemberName = "";
  delay(2000);
}

void logActivity(const String& eventType, const String& message,
                 const String& severity, uint16_t memberId) {
  if (WiFi.status() != WL_CONNECTED) return;
  StaticJsonDocument<320> doc;
  doc["documentId"] = "unique()";
  JsonObject d = doc.createNestedObject("data");
  d["eventType"] = eventType;
  d["message"]   = message;
  d["eventTime"] = getCurrentISO8601();
  d["deviceId"]  = DEVICE_ID;
  d["severity"]  = severity;
  if (memberId > 0) d["memberId"] = memberId;
  char payload[512]; serializeJson(doc, payload);
  awPost(AW_COL_ACTIVITY, payload);
}

void upsertDeviceStatus(const String& status) {
  if (WiFi.status() != WL_CONNECTED) return;

  int rssi = WiFi.RSSI();
  int wifiQuality = constrain(map(rssi, -100, -50, 0, 100), 0, 100);

  if (!deviceDocId.length()) {
    String q = buildQuery("deviceId", DEVICE_ID) + "&" + buildLimitQuery(1);
    String body = awGetList(AW_COL_DEVICES, q);
    if (body.length()) {
      DynamicJsonDocument doc(1024);
      if (!deserializeJson(doc, body)) {
        JsonArray arr = doc["documents"].as<JsonArray>();
        if (arr.size()) deviceDocId = arr[0]["$id"] | "";
      }
    }
  }

  if (deviceDocId.length()) {
    StaticJsonDocument<256> doc;
    JsonObject d = doc.createNestedObject("data");
    d["status"]          = status;
    d["wifiStrength"]    = wifiQuality;  
    d["totalScansToday"] = (int)totalScansToday;
    d["firmwareVersion"] = FIRMWARE_VERSION;
    char pingTime[35]; snprintf(pingTime, sizeof(pingTime), "2025-01-01T12:00:%02d.%03d+00:00", (int)(millis()/1000)%60, (int)(millis()%1000));
    d["lastSeen"]        = pingTime;
    char payload[512]; serializeJson(doc, payload);
    awPatch(AW_COL_DEVICES, deviceDocId.c_str(), payload);
  } else {
    StaticJsonDocument<256> doc;
    doc["documentId"] = "unique()";
    JsonObject d = doc.createNestedObject("data");
    d["deviceId"]        = DEVICE_ID;
    d["status"]          = status;
    d["wifiStrength"]    = wifiQuality;   
    d["totalScansToday"] = (int)totalScansToday;
    d["firmwareVersion"] = FIRMWARE_VERSION;
    char pingTime[35]; snprintf(pingTime, sizeof(pingTime), "2025-01-01T12:00:%02d.%03d+00:00", (int)(millis()/1000)%60, (int)(millis()%1000));
    d["lastSeen"]        = pingTime;
    char payload[512]; serializeJson(doc, payload);
    int code = awPost(AW_COL_DEVICES, payload);
    if (code == 201) Serial.println(F("[DEVICE] Row created"));
  }
}

void lcdShow(const char* l1, const char* l2) {
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print(l1);
  lcd.setCursor(0, 1); lcd.print(l2);
}
void lcdShow(const char* l1, const String& l2) { lcdShow(l1, l2.c_str()); }

String roleStr(Role r) {
  switch (r) {
    case ROLE_SUPER_ADMIN: return "super_admin";
    case ROLE_ADMIN:       return "admin";
    case ROLE_MEMBER:      return "member";
    default:               return "none";
  }
}
Role roleFromStr(const String& s) {
  if (s == "super_admin") return ROLE_SUPER_ADMIN;
  if (s == "admin")       return ROLE_ADMIN;
  if (s == "member")      return ROLE_MEMBER;
  return ROLE_NONE;
}

void saveCache() {
  int addr = 0;
  EEPROM.write(addr++, EEPROM_MAGIC);
  EEPROM.write(addr++, (uint8_t)roleCache.size());
  for (auto& kv : roleCache) {
    if (addr + 25 >= EEPROM_SIZE) break;
    EEPROM.write(addr++, (kv.first >> 8) & 0xFF);
    EEPROM.write(addr++, kv.first & 0xFF);
    EEPROM.write(addr++, kv.second.role);
    uint8_t nl = (uint8_t)min((int)kv.second.name.length(), 20);
    EEPROM.write(addr++, nl);
    for (int i = 0; i < nl; i++) EEPROM.write(addr++, kv.second.name[i]);
  }
  EEPROM.commit();
}

void loadCache() {
  if (EEPROM.read(0) != EEPROM_MAGIC) return;
  int addr = 1;
  uint8_t count = EEPROM.read(addr++);
  for (int i = 0; i < count && addr + 4 < EEPROM_SIZE; i++) {
    uint16_t id  = ((uint16_t)EEPROM.read(addr++) << 8) | EEPROM.read(addr++);
    uint8_t role = EEPROM.read(addr++);
    uint8_t nl   = EEPROM.read(addr++);
    String name  = "";
    for (int j = 0; j < nl && addr < EEPROM_SIZE; j++) name += (char)EEPROM.read(addr++);
    roleCache[id] = {role, name};
  } 
}
