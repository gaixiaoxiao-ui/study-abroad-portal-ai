const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'data', 'app.db');
const SALT_ROUNDS = 10;

let db;

function initDB() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL, display_name TEXT, role TEXT DEFAULT NULL,
      profile TEXT DEFAULT '{}', plans TEXT DEFAULT '{}', active_plan TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS academic_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sat INTEGER DEFAULT 0, toefl INTEGER DEFAULT 0, gpa TEXT DEFAULT '',
      subjects TEXT DEFAULT '[]', updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function generateId() { return 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }

function sanitizeUser(row) {
  if (!row) return null;
  var p = row.password; // keep for auth but don't expose
  var profile = typeof row.profile === 'string' ? JSON.parse(row.profile || '{}') : (row.profile || {});
  var plans = typeof row.plans === 'string' ? JSON.parse(row.plans || '{}') : (row.plans || {});
  return {
    id: row.id, username: row.username, email: row.email,
    displayName: row.display_name, role: row.role,
    profile: profile,
    plans: plans, activePlan: row.active_plan,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

// ── Finders (sanitized — no password) ──
function findByEmail(email) {
  var row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  return row ? sanitizeUser(row) : null;
}
function findById(id) {
  var row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return row ? sanitizeUser(row) : null;
}
function findByUsername(username) {
  var row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  return row ? sanitizeUser(row) : null;
}

// ── Raw finder (keeps password for auth) ──
function findByEmailWithPassword(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) || null;
}

// ── CRUD ──
async function createUser(opts) {
  var hashed = await bcrypt.hash(opts.password, SALT_ROUNDS);
  var id = generateId();
  var profile = JSON.stringify({
    mbti: null, holland: null, sat: null, toefl: null,
    grade: null, target_country: null, curriculum: null,
    gpa: '', dream_schools: [], majors: [], courses: [],
  });
  db.prepare('INSERT INTO users (id,username,email,password,display_name,profile) VALUES (?,?,?,?,?,?)')
    .run(id, opts.username, opts.email, hashed, opts.displayName || opts.username, profile);
  return sanitizeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

async function updatePassword(userId, newPassword) {
  var hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);
  return db.prepare("UPDATE users SET password=?, updated_at=datetime('now') WHERE id=?").run(hashed, userId).changes > 0;
}

function updateProfile(userId, fields) {
  var user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  var current = JSON.parse(user.profile || '{}');
  var merged = Object.assign({}, current, fields);
  Object.keys(merged).forEach(function(k) { if (merged[k] === undefined) delete merged[k]; });
  db.prepare("UPDATE users SET profile=?, updated_at=datetime('now') WHERE id=?").run(JSON.stringify(merged), userId);
  return sanitizeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId));
}

function setRole(userId, role) { db.prepare("UPDATE users SET role=?, updated_at=datetime('now') WHERE id=?").run(role, userId); return true; }
function updatePlans(userId, plans) { db.prepare("UPDATE users SET plans=?, updated_at=datetime('now') WHERE id=?").run(JSON.stringify(plans||{}), userId); return true; }
function setActivePlan(userId, planKey) { db.prepare("UPDATE users SET active_plan=?, updated_at=datetime('now') WHERE id=?").run(planKey||null, userId); return true; }
function getAllUsers() { return db.prepare('SELECT * FROM users ORDER BY created_at DESC').all().map(sanitizeUser); }
function deleteUser(userId) { return db.prepare('DELETE FROM users WHERE id=?').run(userId).changes > 0; }

function getAcademicScores(userId) {
  var row = db.prepare('SELECT * FROM academic_scores WHERE user_id=?').get(userId);
  return row ? {sat:row.sat, toefl:row.toefl, gpa:row.gpa, subjects:JSON.parse(row.subjects||'[]')} : {sat:0,toefl:0,gpa:'',subjects:[]};
}
function upsertAcademicScores(userId, opts) {
  var ex = db.prepare('SELECT id FROM academic_scores WHERE user_id=?').get(userId);
  var sub = JSON.stringify(opts.subjects || []);
  if (ex) db.prepare("UPDATE academic_scores SET sat=?,toefl=?,gpa=?,subjects=?,updated_at=datetime('now') WHERE user_id=?").run(opts.sat||0, opts.toefl||0, opts.gpa||'', sub, userId);
  else db.prepare('INSERT INTO academic_scores (user_id,sat,toefl,gpa,subjects) VALUES (?,?,?,?,?)').run(userId, opts.sat||0, opts.toefl||0, opts.gpa||'', sub);
  return getAcademicScores(userId);
}

initDB();

module.exports = {
  findByEmail, findById, findByUsername, findByEmailWithPassword,
  createUser, updatePassword, updateProfile, sanitizeUser, setRole,
  updatePlans, setActivePlan, getAllUsers, deleteUser,
  getAcademicScores, upsertAcademicScores,
};
