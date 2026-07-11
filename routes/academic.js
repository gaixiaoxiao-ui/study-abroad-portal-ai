const express = require('express');
const { requireAuth } = require('../middleware/auth');

// Middleware: reject parent users with proper error
function requireStudent(req, res, next) {
  if (req.user && req.user.role === 'parent') {
    return res.status(403).json({ error: '此功能仅限学生账号使用。请使用家长端 /parent 查看学生数据。' });
  }
  next();
}
const academicStore = require('../utils/academicStore');

const router = express.Router();

// All routes require authentication

/**
 * GET /api/academic — 获取完整学业数据
 */
router.get('/', requireAuth, requireStudent, (req, res) => {
  const data = academicStore.getUserData(req.userId);
  res.json(data);
});

/**
 * PUT /api/academic/scores — 更新成绩
 * Body: { subjects: [{name, score, date}], language: {toefl, ielts} }
 */
router.put('/scores', requireAuth, requireStudent, (req, res) => {
  const scores = academicStore.updateScores(req.userId, req.body);
  res.json({ message: '成绩已更新', scores });
});

/**
 * PUT /api/academic/goals — 更新目标
 * Body: { subjects: [{name, score}], language: {toefl, ielts}, target_school, target_major, target_country }
 */
router.put('/goals', requireAuth, requireStudent, (req, res) => {
  const goals = academicStore.updateGoals(req.userId, req.body);
  res.json({ message: '目标已更新', goals });
});

/**
 * PUT /api/academic/predictions — 更新预测
 * Body: { predicted_sat, confidence, months_left, notes }
 */
router.put('/predictions', requireAuth, requireStudent, (req, res) => {
  const pred = academicStore.updatePredictions(req.userId, req.body);
  res.json({ message: '预测已更新', predictions: pred });
});

/**
 * GET /api/academic/gap — 差距分析
 */
router.get('/gap', requireAuth, requireStudent, (req, res) => {
  const gaps = academicStore.getGapAnalysis(req.userId);
  res.json({ gaps });
});

/**
 * GET /api/academic/board — 获取行动看板
 */
router.get('/board', requireAuth, requireStudent, (req, res) => {
  const board = academicStore.getBoard(req.userId);
  res.json(board);
});

/**
 * POST /api/academic/board/card — 添加卡片
 * Body: { columnId: 'todo'|'doing'|'done', card: { title, description, priority, dueDate, tags } }
 */
router.post('/board/card', requireAuth, requireStudent, (req, res) => {
  const { columnId, card } = req.body;
  if (!columnId || !card || !card.title) {
    return res.status(400).json({ error: '请提供 columnId 和 card.title' });
  }
  const newCard = academicStore.addCard(req.userId, columnId, card);
  if (!newCard) return res.status(400).json({ error: '无效的 columnId' });
  res.status(201).json({ message: '卡片已创建', card: newCard });
});

/**
 * PUT /api/academic/board/card/:cardId/move — 移动卡片
 * Body: { toColumnId }
 */
router.put('/board/card/:cardId/move', requireAuth, requireStudent, (req, res) => {
  const { toColumnId } = req.body;
  if (!toColumnId) return res.status(400).json({ error: '请提供 toColumnId' });
  const card = academicStore.moveCard(req.userId, req.params.cardId, toColumnId);
  if (!card) return res.status(404).json({ error: '卡片未找到' });
  res.json({ message: '卡片已移动', card });
});

/**
 * PUT /api/academic/board/card/:cardId — 更新卡片
 */
router.put('/board/card/:cardId', requireAuth, requireStudent, (req, res) => {
  const card = academicStore.updateCard(req.userId, req.params.cardId, req.body);
  if (!card) return res.status(404).json({ error: '卡片未找到' });
  res.json({ message: '卡片已更新', card });
});

/**
 * DELETE /api/academic/board/card/:cardId — 删除卡片
 */
router.delete('/board/card/:cardId', requireAuth, requireStudent, (req, res) => {
  const ok = academicStore.deleteCard(req.userId, req.params.cardId);
  if (!ok) return res.status(404).json({ error: '卡片未找到' });
  res.json({ message: '卡片已删除' });
});

module.exports = router;
