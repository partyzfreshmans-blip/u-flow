/**
 * Auth.js — PIN login and signed session tokens.
 *
 * The web app is deployed as "anyone", so every call that returns customer
 * data or writes anything must present a token this file issued. A 4-digit
 * PIN is weak by construction, so two things compensate:
 *   - PINs are stored hashed (salt + HMAC-SHA256 keyed by AUTH_SECRET), so
 *     anyone with Viewer access to the spreadsheet sees hashes, not PINs.
 *   - Wrong attempts are counted per identity and locked out for a while,
 *     which is what actually stops someone walking through all 10,000.
 */

function authSecret_() {
  var secret = cfg_('AUTH_SECRET', '');
  if (!secret) {
    secret = Utilities.base64EncodeWebSafe(Utilities.getUuid() + ':' + Utilities.getUuid());
    setConfig_('AUTH_SECRET', secret);
  }
  return secret;
}

function hmacHex_(message, key) {
  var bytes = Utilities.computeHmacSha256Signature(message, key);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

/** Stored form is "salt:hash" — the salt makes two drivers who picked the
 * same PIN hash differently, so the sheet never reveals that fact either. */
function hashPin_(pin) {
  var salt = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  return salt + ':' + hmacHex_(salt + ':' + String(pin), authSecret_());
}

function verifyPin_(pin, stored) {
  var text = safeText_(stored);
  if (!text) return false;
  var parts = text.split(':');
  if (parts.length !== 2) return false;
  return constantTimeEquals_(hmacHex_(parts[0] + ':' + String(pin), authSecret_()), parts[1]);
}

/** Comparison whose duration doesn't depend on where the first difference
 * is — a plain === on a hash leaks that position through timing. */
function constantTimeEquals_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isFourDigitPin_(pin) {
  return /^\d{4}$/.test(String(pin === null || pin === undefined ? '' : pin));
}

// ---------- attempt throttling ----------

function attemptKey_(identity) {
  return 'pinfail:' + identity;
}

function assertNotLockedOut_(identity) {
  var raw = CacheService.getScriptCache().get(attemptKey_(identity));
  var count = raw ? Number(raw) : 0;
  if (count >= cfgNum_('PIN_MAX_ATTEMPTS', 8)) {
    throw new Error('กรอก PIN ผิดหลายครั้งเกินไป — รอ ' + cfgNum_('PIN_LOCKOUT_MINUTES', 10) + ' นาทีแล้วลองใหม่');
  }
}

function recordFailedAttempt_(identity) {
  var cache = CacheService.getScriptCache();
  var raw = cache.get(attemptKey_(identity));
  var count = (raw ? Number(raw) : 0) + 1;
  cache.put(attemptKey_(identity), String(count), cfgNum_('PIN_LOCKOUT_MINUTES', 10) * 60);
}

function clearFailedAttempts_(identity) {
  CacheService.getScriptCache().remove(attemptKey_(identity));
}

// ---------- tokens ----------

function issueToken_(role, subject, ttlSeconds) {
  var payload = { r: role, s: subject, e: Math.floor(Date.now() / 1000) + ttlSeconds };
  // Padding is kept: base64DecodeWebSafe expects it, and the token never
  // travels in a URL where '=' would need escaping.
  var body = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  return body + '.' + hmacHex_(body, authSecret_());
}

/** Returns { role, subject } or throws. Every API entry point that touches
 * real data starts with this. */
function verifyToken_(token) {
  var text = safeText_(token);
  var dot = text.indexOf('.');
  if (dot < 1) throw new Error('ต้องเข้าสู่ระบบก่อน');
  var body = text.slice(0, dot);
  var sig = text.slice(dot + 1);
  if (!constantTimeEquals_(hmacHex_(body, authSecret_()), sig)) throw new Error('ต้องเข้าสู่ระบบใหม่');
  var payload;
  try {
    payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(body)).getDataAsString());
  } catch (e) {
    throw new Error('ต้องเข้าสู่ระบบใหม่');
  }
  if (!payload || !payload.e || payload.e < Math.floor(Date.now() / 1000)) throw new Error('หมดเวลาเข้าสู่ระบบ — ใส่ PIN อีกครั้ง');
  return { role: payload.r, subject: payload.s };
}

function requireAdmin_(token) {
  var auth = verifyToken_(token);
  if (auth.role !== 'admin') throw new Error('หน้านี้สำหรับแอดมินเท่านั้น');
  return auth;
}

/** Driver sessions resolve to a live _DRIVERS row every call, so deactivating
 * a driver takes effect immediately instead of when their token expires. */
function requireDriver_(token) {
  var auth = verifyToken_(token);
  if (auth.role === 'admin') return { role: 'admin', driver: null };
  var driver = findDriver_(auth.subject);
  if (!driver || !driver.active) throw new Error('บัญชีคนขับนี้ถูกปิดใช้งานแล้ว — ติดต่อแอดมิน');
  return { role: 'driver', driver: driver };
}
