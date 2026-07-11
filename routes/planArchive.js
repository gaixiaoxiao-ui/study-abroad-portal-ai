const express = require('express');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// GET /api/plans — 获取用户所有规划案例
router.get('/', requireAuth, (req, res) => {
  const cases = req.app.locals.db
    .prepare("SELECT id, created_at, target_schools, target_major, status, model_used, tokens_used, pdf_path FROM plan_cases WHERE user_id=? AND status!='deleted' ORDER BY created_at DESC")
    .all(req.userId);

  const parsed = cases.map(c => {
    if (c.target_schools && typeof c.target_schools === 'string') {
      try { c.target_schools = JSON.parse(c.target_schools); } catch(e) { c.target_schools = []; }
    }
    return c;
  });

  res.json(parsed);
});

// GET /api/plans/:id — 获取某个规划案例详情
router.get('/:id', requireAuth, (req, res) => {
  const c = req.app.locals.db
    .prepare("SELECT * FROM plan_cases WHERE id=? AND user_id=? AND status!='deleted'")
    .get(req.params.id, req.userId);

  if (!c) return res.status(404).json({ error: '规划案例不存在' });

  if (c.student_snapshot && typeof c.student_snapshot === 'string') {
    try { c.student_snapshot = JSON.parse(c.student_snapshot); } catch(e) {}
  }
  if (c.plan_parsed && typeof c.plan_parsed === 'string') {
    try { c.plan_parsed = JSON.parse(c.plan_parsed); } catch(e) {}
  }
  if (c.target_schools && typeof c.target_schools === 'string') {
    try { c.target_schools = JSON.parse(c.target_schools); } catch(e) {}
  }

  res.json(c);
});

// DELETE /api/plans/:id — 软删除规划案例
router.delete('/:id', requireAuth, (req, res) => {
  const r = req.app.locals.db
    .prepare("UPDATE plan_cases SET status='deleted', deleted_at=datetime('now') WHERE id=? AND user_id=?")
    .run(req.params.id, req.userId);
  res.json({ success: r.changes > 0 });
});

// ─────────────────────────────────────────────────────────
// ADMIN: 管理员查看所有规划案例
// ─────────────────────────────────────────────────────────
router.get('/admin/all', requireAuth, (req, res) => {
  // Check admin role
  if (req.user.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });

  const { page = 1, limit = 20, user_id, status } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const db = req.app.locals.db;

  let where = "WHERE p.status!='deleted'";
  const params = [];
  if (user_id) { where += ' AND p.user_id=?'; params.push(user_id); }
  if (status) { where += ' AND p.status=?'; params.push(status); }

  const total = db.prepare(`SELECT count(*) as n FROM plan_cases p ${where}`).get(...params).n;
  const cases = db.prepare(`
    SELECT p.*, u.username, u.email
    FROM plan_cases p
    JOIN users u ON u.id = p.user_id
    ${where}
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  res.json({ total, page: parseInt(page), limit: parseInt(limit), cases });
});

// DELETE /api/plans/admin/:id — 管理员彻底删除案例
router.delete('/admin/:id', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
  const r = req.app.locals.db.prepare("DELETE FROM plan_cases WHERE id=?").run(req.params.id);
  res.json({ success: r.changes > 0 });
});

module.exports = router;
