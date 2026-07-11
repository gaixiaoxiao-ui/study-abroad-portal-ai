const express = require('express');
const fs = require('fs');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// Admin middleware — requires admin role
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
}

const USERS_PATH = './data/users.json';
function loadUsers() { return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8')); }

// ─── GET /api/admin/stats ───
router.get('/stats', requireAuth, requireAdmin, (req, res) => {
  const users = userStore.getAllUsers();
  const students = users.filter(u => !u.role || u.role === 'student');
  const parents = users.filter(u => u.role === 'parent');
  
  // Count users with plans
  let withPlans = 0, withProfile = 0, withGrades = 0;
  students.forEach(u => {
    if (u.plans && Object.keys(u.plans).length > 0) withPlans++;
    if (u.profile && u.profile.grade) withProfile++;
    if (u.profile && (u.profile.sat || u.profile.toefl || u.profile.gpa)) withGrades++;
  });

  res.json({
    total: users.length,
    students: students.length,
    parents: parents.length,
    withPlans,
    withProfile,
    withGrades,
    gradeDist: {
      G9: students.filter(u => u.profile?.grade === 'G9').length,
      G10: students.filter(u => u.profile?.grade === 'G10').length,
      G11: students.filter(u => u.profile?.grade === 'G11').length,
      G12: students.filter(u => u.profile?.grade === 'G12').length,
    }
  });
});

// ─── GET /api/admin/users ───
router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const users = userStore.getAllUsers();
  const list = users.map(u => ({
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role || 'student',
    grade: u.profile?.grade || '—',
    curriculum: u.profile?.curriculum || '—',
    target_country: u.profile?.target_country || '—',
    mbti: u.profile?.mbti || '—',
    sat: u.profile?.sat || null,
    toefl: u.profile?.toefl || null,
    plansCount: u.plans ? Object.keys(u.plans).length : 0,
    activePlan: u.activePlan || null,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  }));
  res.json(list);
});

// ─── GET /api/admin/user/:id ───
router.get('/user/:id', requireAuth, requireAdmin, (req, res) => {
  const users = userStore.getAllUsers();
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json(user);
});

// ─── DELETE /api/admin/user/:id ───
router.delete('/user/:id', requireAuth, requireAdmin, (req, res) => {
  const users = userStore.getAllUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: '用户不存在' });
  const removed = users.splice(idx, 1)[0];
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
  res.json({ message: '用户已删除', email: removed.email });
});

module.exports = router;
