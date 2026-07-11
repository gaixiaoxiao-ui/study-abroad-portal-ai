const express = require('express');
const { requireParent } = require('../middleware/auth');
const userStore = require('../utils/userStore');
const academicStore = require('../utils/academicStore');
const parentStore = require('../utils/parentStore');
const scoreTiers = require('../data/score-tiers.json');

const router = express.Router();

// All routes require parent authentication (role === 'parent')

/**
 * POST /api/parent/register — 注册家长账号
 * Body: { name, phone, password, childCode? }
 */
router.post('/register', async (req, res) => {
  try {
    const { name, phone, password } = req.body;
    if (!name || !phone || !password) {
      return res.status(400).json({ error: '姓名、手机号、密码为必填项' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: '密码至少6位' });
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return res.status(400).json({ error: '手机号格式不正确' });
    }
    // Check if phone already registered
    const existing = userStore.findByUsername(phone);
    if (existing) {
      return res.status(409).json({ error: '该手机号已注册，请直接登录' });
    }
    const user = await userStore.createUser({
      username: phone,
      email: phone + '@parent.local',
      password,
      displayName: name,
    });
    // Set role to parent
    userStore.setRole(user.id, 'parent');
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: 'parent' },
      config.JWT_SECRET,
      { expiresIn: config.JWT_EXPIRES_IN }
    );
    res.status(201).json({ message: '注册成功', userId: user.id, name: user.displayName, token });
  } catch (err) {
    console.error('Parent register error:', err);
    res.status(500).json({ error: '注册失败，请稍后重试' });
  }
});

/**
 * POST /api/parent/login — 家长登录
 * Body: { username (手机号), password }
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: '手机号和密码为必填项' });
    }
    const user = userStore.findByUsername(username);
    if (!user) {
      return res.status(401).json({ error: '账号或密码错误' });
    }
    if (user.role !== 'parent') {
      return res.status(403).json({ error: '该账号不是家长账号' });
    }
    const bcrypt = require('bcryptjs');
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: '账号或密码错误' });
    }
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: 'parent' },
      config.JWT_SECRET,
      { expiresIn: config.JWT_EXPIRES_IN }
    );
    res.json({ message: '登录成功', userId: user.id, name: user.displayName, token });
  } catch (err) {
    console.error('Parent login error:', err);
    res.status(500).json({ error: '登录失败，请稍后重试' });
  }
});

/**
 * GET /api/parent/dashboard
 * Returns key summary data for the parent's child.
 * Query: ?studentId= (optional — defaults to first linked child)
 */
router.get('/dashboard', requireParent, (req, res) => {
  const children = parentStore.getChildren(req.userId);
  if (children.length === 0) {
    return res.json({
      message: '暂未关联任何学生档案',
      children: [],
      dashboard: null,
    });
  }

  const targetStudentId = req.query.studentId || children[0];
  if (!children.includes(targetStudentId)) {
    return res.status(400).json({ error: '无效的学生ID或未关联该学生' });
  }

  const student = userStore.findById(targetStudentId);
  if (!student) {
    return res.status(404).json({ error: '学生档案不存在' });
  }

  const academic = academicStore.getUserData(targetStudentId);
  const profile = student.profile || {};

  // Build score summary
  const scoreSummary = {
    subjects: academic.scores?.subjects || [],
    language: academic.scores?.language || { toefl: null, ielts: null },
    predictions: academic.predictions || {},
    goals: academic.goals || {},
  };

  // Calculate tier from SAT score
  let tierInfo = null;
  if (profile.sat) {
    const tierKey = profile.sat >= 1500 ? 'T5' : profile.sat >= 1450 ? 'T10' : profile.sat >= 1400 ? 'T15' : 'T20';
    const tier = scoreTiers.tiers[tierKey];
    tierInfo = tier ? { current_tier: tierKey, label: tier.label, sat_range: tier.sat_range } : null;
  }

  // Recent action board items
  const recentActions = [];
  const board = academic.actionBoard || { columns: [] };
  for (const col of board.columns) {
    for (const card of (col.cards || []).slice(0, 3)) {
      recentActions.push({ ...card, column: col.title });
    }
  }

  res.json({
    student: {
      id: student.id,
      displayName: student.displayName || student.username,
      username: student.username,
    },
    profile: {
      mbti: profile.mbti,
      holland: profile.holland,
      grade: profile.grade,
      target_country: profile.target_country,
      sat: profile.sat,
      act: profile.act,
      toefl: profile.toefl,
      a_level: profile.a_level,
      ib_score: profile.ib_score,
    },
    score_summary: scoreSummary,
    tier_info: tierInfo,
    recent_actions: recentActions.slice(0, 5),
    children: children.map(id => {
      const s = userStore.findById(id);
      return { id, displayName: s?.displayName || s?.username || id };
    }),
  });
});

/**
 * GET /api/parent/applications
 * Returns list of applications for the parent's child.
 * Query: ?studentId= (optional)
 */
router.get('/applications', requireParent, (req, res) => {
  const children = parentStore.getChildren(req.userId);
  if (children.length === 0) {
    return res.json({ applications: [], message: '暂未关联任何学生档案' });
  }

  const targetStudentId = req.query.studentId || children[0];
  if (!children.includes(targetStudentId)) {
    return res.status(400).json({ error: '无效的学生ID或未关联该学生' });
  }

  res.json({
    student_id: targetStudentId,
    applications: [],
    note: '申请追踪系统正在建设中，预计下一版本上线',
  });
});

/**
 * GET /api/parent/scores
 * Returns score history/trend data for the parent's child.
 * Query: ?studentId= (optional)
 */
router.get('/scores', requireParent, (req, res) => {
  const children = parentStore.getChildren(req.userId);
  if (children.length === 0) {
    return res.json({ score_history: [], message: '暂未关联任何学生档案' });
  }

  const targetStudentId = req.query.studentId || children[0];
  if (!children.includes(targetStudentId)) {
    return res.status(400).json({ error: '无效的学生ID或未关联该学生' });
  }

  const academic = academicStore.getUserData(targetStudentId);

  const scoreHistory = (academic.scores?.subjects || []).map(s => ({
    subject: s.name,
    score: s.score,
    date: s.date || null,
    trend: 'current',
  }));

  const languageScores = [];
  if (academic.scores?.language?.toefl) {
    languageScores.push({ type: 'TOEFL', score: academic.scores.language.toefl, date: null });
  }
  if (academic.scores?.language?.ielts) {
    languageScores.push({ type: 'IELTS', score: academic.scores.language.ielts, date: null });
  }

  const goalsAnalysis = ((academic.goals?.subjects) || []).map(g => {
    const current = (academic.scores?.subjects || []).find(s => s.name === g.name);
    return {
      subject: g.name,
      target: g.score,
      current: current?.score || null,
      gap: current ? g.score - current.score : g.score,
    };
  });

  res.json({
    student_id: targetStudentId,
    score_history: scoreHistory,
    language_scores: languageScores,
    goals_analysis: goalsAnalysis,
    predictions: academic.predictions || {},
    note: scoreHistory.length === 0 ? '暂无成绩记录，请提醒学生上传成绩' : null,
  });
});

/**
 * GET /api/parent/documents
 * Returns list of contracts/reports for the parent's child.
 * Query: ?studentId= (optional)
 */
router.get('/documents', requireParent, (req, res) => {
  const children = parentStore.getChildren(req.userId);
  if (children.length === 0) {
    return res.json({ documents: [], message: '暂未关联任何学生档案' });
  }

  const targetStudentId = req.query.studentId || children[0];
  if (!children.includes(targetStudentId)) {
    return res.status(400).json({ error: '无效的学生ID或未关联该学生' });
  }

  res.json({
    student_id: targetStudentId,
    documents: [],
    note: '合同与报告文件管理正在建设中，预计下一版本上线',
  });
});

/**
 * POST /api/parent/feedback
 * Submit parent feedback/review.
 * Body: { studentId?, type: 'general'|'service'|'suggestion', content, rating }
 */
router.post('/feedback', requireParent, (req, res) => {
  const { studentId, type, content, rating } = req.body;

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ error: '请填写反馈内容' });
  }

  if (rating !== undefined && (typeof rating !== 'number' || rating < 1 || rating > 5)) {
    return res.status(400).json({ error: '评分应为1-5之间的数字' });
  }

  const children = parentStore.getChildren(req.userId);
  const targetStudentId = studentId || (children[0] || null);

  if (studentId && !children.includes(studentId)) {
    return res.status(400).json({ error: '无效的学生ID或未关联该学生' });
  }

  const entry = parentStore.submitFeedback({
    parentId: req.userId,
    studentId: targetStudentId,
    type: type || 'general',
    content: content.trim(),
    rating: rating || null,
  });

  res.status(201).json({
    message: '反馈已提交，感谢您的宝贵意见',
    feedback: entry,
  });
});

/**
 * GET /api/parent/feedback
 * Get feedback history for the parent.
 */
router.get('/feedback', requireParent, (req, res) => {
  const entries = parentStore.getFeedbackByParent(req.userId);
  res.json({ feedback: entries });
});

module.exports = router;
