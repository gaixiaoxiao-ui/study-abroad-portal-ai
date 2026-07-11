const fs = require('fs');
const path = require('path');

const RELATION_FILE = path.join(__dirname, '..', 'data', 'parent-relations.json');
const FEEDBACK_FILE = path.join(__dirname, '..', 'data', 'parent-feedback.json');

// ── In-memory stores ──
let relations = {};  // { [parentId]: { children: [studentId, ...], createdAt } }
let feedback = [];   // [{ id, parentId, studentId, type, content, rating, createdAt }]

function load() {
  try {
    const raw = fs.readFileSync(RELATION_FILE, 'utf8');
    relations = JSON.parse(raw);
    if (typeof relations !== 'object') relations = {};
  } catch {
    relations = {};
  }
  try {
    const raw2 = fs.readFileSync(FEEDBACK_FILE, 'utf8');
    feedback = JSON.parse(raw2);
    if (!Array.isArray(feedback)) feedback = [];
  } catch {
    feedback = [];
  }
}

function saveRelations() {
  const dir = path.dirname(RELATION_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(RELATION_FILE, JSON.stringify(relations, null, 2), 'utf8');
}

function saveFeedback() {
  const dir = path.dirname(FEEDBACK_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(feedback, null, 2), 'utf8');
}

// ── Public API ──

/**
 * Get children IDs for a parent.
 */
function getChildren(parentId) {
  return relations[parentId]?.children || [];
}

/**
 * Check if a student is linked to a parent.
 */
function isChildOf(parentId, studentId) {
  return getChildren(parentId).includes(studentId);
}

/**
 * Link a student to a parent.
 */
function linkChild(parentId, studentId) {
  if (!relations[parentId]) {
    relations[parentId] = { children: [], createdAt: new Date().toISOString() };
  }
  if (!relations[parentId].children.includes(studentId)) {
    relations[parentId].children.push(studentId);
    saveRelations();
  }
}

/**
 * Unlink a student from a parent.
 */
function unlinkChild(parentId, studentId) {
  if (!relations[parentId]) return;
  relations[parentId].children = relations[parentId].children.filter(id => id !== studentId);
  saveRelations();
}

/**
 * Submit feedback from a parent about a student.
 */
function submitFeedback({ parentId, studentId, type, content, rating }) {
  const entry = {
    id: 'fb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    parentId,
    studentId,
    type: type || 'general',  // 'general' | 'service' | 'suggestion'
    content,
    rating: rating || null,    // 1-5
    createdAt: new Date().toISOString(),
  };
  feedback.push(entry);
  saveFeedback();
  return entry;
}

/**
 * Get all feedback submitted by a parent.
 */
function getFeedbackByParent(parentId) {
  return feedback.filter(f => f.parentId === parentId);
}

/**
 * Get all feedback for a specific student.
 */
function getFeedbackByStudent(studentId) {
  return feedback.filter(f => f.studentId === studentId);
}

load();

module.exports = {
  getChildren,
  isChildOf,
  linkChild,
  unlinkChild,
  submitFeedback,
  getFeedbackByParent,
  getFeedbackByStudent,
};
