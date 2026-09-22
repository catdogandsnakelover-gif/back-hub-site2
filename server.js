/*
 * Back Hub — self-hostable key-gated hub directory.
 * Run: npm install && npm start
 */

// ============================================================
//  CONFIG — change these to taste
// ============================================================

// The ONLY email address allowed into the Owner Console.
// Compared case-insensitively after trimming whitespace.
const ADMIN_EMAIL = "kevinaugusta27@gmail.com";

// Secret used to sign session cookies. Set the SESSION_SECRET
// environment variable in production so sessions survive restarts.
// If unset, a random one is generated at boot (sessions reset on restart).
const SESSION_SECRET =
  process.env.SESSION_SECRET || require("crypto").randomBytes(32).toString("hex");

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || require("path").join(__dirname, "data.db");

// ============================================================

const crypto = require("crypto");
const path = require("path");
const express = require("express");
const Database = require("better-sqlite3");

const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---------------- database ----------------
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    max_uses INTEGER NOT NULL DEFAULT 1,
    uses_left INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS hubs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const STARTER_HUBS = [
  { name: "Lovable Project", url: "https://lovableproject.com/auth" },
  { name: "Roblox Scripts Hub", url: "https://robloxscriptshub.base44.app" },
];
if (db.prepare("SELECT COUNT(*) AS c FROM hubs").get().c === 0) {
  const ins = db.prepare("INSERT INTO hubs (name, url) VALUES (?, ?)");
  for (const h of STARTER_HUBS) ins.run(h.name, h.url);
}

// ---------------- signed cookies (no dependencies) ----------------
function sign(value) {
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
  return `${value}.${sig}`;
}
function unsign(signed) {
  if (typeof signed !== "string") return null;
  const i = signed.lastIndexOf(".");
  if (i < 0) return null;
  const value = signed.slice(0, i);
  const sig = signed.slice(i + 1);
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
  if (sig.length !== expected.length) return null;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? value : null;
}
function getCookies(req) {
  const out = {};
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setCookie(res, name, value, opts = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (opts.maxAge) parts.push(`Max-Age=${opts.maxAge}`);
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}
const isAdmin = (req) => unsign(getCookies(req).bh_admin) === "admin";
const hasAccess = (req) => isAdmin(req) || unsign(getCookies(req).bh_access) === "visitor";

// ---------------- tiny rate limiter ----------------
const hits = new Map();
function rateLimit(maxPerMinute) {
  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
    arr.push(now);
    hits.set(ip, arr);
    if (arr.length > maxPerMinute) {
      return res.status(429).json({ error: "Too many requests, slow down." });
    }
    next();
  };
}

// ---------------- helpers ----------------
const normEmail = (e) => String(e || "").trim().toLowerCase();
function validUrl(u) {
  if (typeof u !== "string") return false;
  const t = u.trim();
  if (!/^https?:\/\//i.test(t)) return false;
  try {
    new URL(t);
    return true;
  } catch {
    return false;
  }
}
const cleanStr = (s, max) => {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t || t.length > max) return null;
  return t;
};
function newKeyCode() {
  // URL-safe random key, e.g. "KX9p-2mzQ-7vRt-4hWn"
  return crypto
    .randomBytes(12)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
    .match(/.{1,4}/g)
    .join("-");
}

// ---------------- public API ----------------
app.get("/api/health", (req, res) => res.json({ ok: true }));

// Redeem a key — atomic: only decrements if a use is left.
const redeemTx = db.transaction((code) => {
  const row = db.prepare("SELECT id, uses_left FROM keys WHERE code = ?").get(code);
  if (!row || row.uses_left <= 0) return null;
  db.prepare("UPDATE keys SET uses_left = uses_left - 1 WHERE id = ?").run(row.id);
  return true;
});

app.post("/api/redeem", rateLimit(30), (req, res) => {
  const code = cleanStr(req.body && req.body.key, 64);
  if (!code) return res.status(400).json({ error: "Enter a key." });
  if (!redeemTx(code)) {
    return res.status(403).json({ error: "Invalid or exhausted key." });
  }
  setCookie(res, "bh_access", sign("visitor"), { maxAge: 86400 });
  const hubs = db.prepare("SELECT id, name, url FROM hubs ORDER BY id").all();
  res.json({ ok: true, hubs });
});

app.get("/api/hubs", (req, res) => {
  if (!hasAccess(req)) return res.status(403).json({ error: "Unlock with a key first." });
  res.json({ hubs: db.prepare("SELECT id, name, url FROM hubs ORDER BY id").all() });
});

// ---------------- admin gate ----------------
app.post("/api/admin/login", rateLimit(30), (req, res) => {
  const email = normEmail(req.body && req.body.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  if (email !== ADMIN_EMAIL.toLowerCase()) {
    // Generic message on purpose — don't hint which email is right.
    return res.status(403).json({ error: "Access denied." });
  }
  setCookie(res, "bh_admin", sign("admin"), { maxAge: 86400 });
  res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  setCookie(res, "bh_admin", "", { maxAge: 0 });
  res.json({ ok: true });
});

app.get("/api/admin/me", (req, res) => res.json({ admin: isAdmin(req) }));

// Every admin route below re-checks the signed cookie server-side.
app.use("/api/admin", (req, res, next) => {
  if (req.path === "/login" || req.path === "/logout" || req.path === "/me") return next();
  if (!isAdmin(req)) return res.status(403).json({ error: "Access denied." });
  next();
});

// ---- key forge ----
app.get("/api/admin/keys", (req, res) => {
  res.json({
    keys: db
      .prepare("SELECT id, code, max_uses, uses_left, created_at FROM keys ORDER BY id DESC")
      .all(),
  });
});

app.post("/api/admin/keys", (req, res) => {
  let maxUses = req.body && req.body.max_uses;
  if (maxUses === undefined || maxUses === null) maxUses = 1;
  maxUses = Number(maxUses);
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 10000) {
    return res.status(400).json({ error: "Allowed uses must be a whole number from 1 to 10000." });
  }
  const code = newKeyCode();
  const info = db
    .prepare("INSERT INTO keys (code, max_uses, uses_left) VALUES (?, ?, ?)")
    .run(code, maxUses, maxUses);
  res.status(201).json({
    key: db
      .prepare("SELECT id, code, max_uses, uses_left, created_at FROM keys WHERE id = ?")
      .get(info.lastInsertRowid),
  });
});

app.patch("/api/admin/keys/:id", (req, res) => {
  const maxUses = Number(req.body && req.body.max_uses);
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 10000) {
    return res.status(400).json({ error: "Allowed uses must be a whole number from 1 to 10000." });
  }
  const row = db.prepare("SELECT id, max_uses, uses_left FROM keys WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Key not found." });
  const used = row.max_uses - row.uses_left;
  const usesLeft = Math.max(0, maxUses - used);
  db.prepare("UPDATE keys SET max_uses = ?, uses_left = ? WHERE id = ?").run(
    maxUses,
    usesLeft,
    row.id
  );
  res.json({ ok: true });
});

app.delete("/api/admin/keys/:id", (req, res) => {
  const info = db.prepare("DELETE FROM keys WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Key not found." });
  res.json({ ok: true });
});

// ---- shared hubs ----
app.get("/api/admin/hubs", (req, res) => {
  res.json({ hubs: db.prepare("SELECT id, name, url FROM hubs ORDER BY id").all() });
});

app.post("/api/admin/hubs", (req, res) => {
  const name = cleanStr(req.body && req.body.name, 120);
  const url = cleanStr(req.body && req.body.url, 2000);
  if (!name) return res.status(400).json({ error: "Give the hub a name." });
  if (!validUrl(url)) {
    return res.status(400).json({ error: "URL must start with http:// or https://." });
  }
  const info = db.prepare("INSERT INTO hubs (name, url) VALUES (?, ?)").run(name, url);
  res.status(201).json({
    hub: db.prepare("SELECT id, name, url FROM hubs WHERE id = ?").get(info.lastInsertRowid),
  });
});

app.delete("/api/admin/hubs/:id", (req, res) => {
  const info = db.prepare("DELETE FROM hubs WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Hub not found." });
  res.json({ ok: true });
});

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Back Hub listening on port ${PORT}`);
});
