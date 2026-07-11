const express = require('express');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// ─────────────────────────────────────────────────────────
// POST /api/student/profile — 创建/更新完整学生档案
// ─────────────────────────────────────────────────────────
router.post('/profile', requireAuth, (req, res) => {
  const userId = req.userId;
  const {
    display_name, grade, curriculum, target_country, target_major,
    dream_schools, interests, strengths,
    mbti, holland_type, holland_secondary,
    study_habit, target_tier,
    extracurriculars, awards
  } = req.body;

  const existing = req.app.locals.db
    .prepare('SELECT id FROM student_profiles WHERE user_id = ?')
    .get(userId);

  if (existing) {
    req.app.locals.db.prepare(`
      UPDATE student_profiles SET
        display_name=?, grade=?, curriculum=?, target_country=?, target_major=?,
        dream_schools=?, interests=?, strengths=?,
        mbti=?, holland_type=?, holland_secondary=?,
        study_habit=?, target_tier=?,
        extracurriculars=?, awards=?,
        updated_at=datetime('now')
      WHERE user_id=?
    `).run(
      JSON.stringify(display_name||null), grade||null, curriculum||null,
      target_country||null, target_major||null,
      JSON.stringify(dream_schools||[]), JSON.stringify(interests||[]), JSON.stringify(strengths||[]),
      mbti||null, holland_type||null, holland_secondary||null,
      study_habit||null, target_tier||null,
      JSON.stringify(extracurriculars||[]), JSON.stringify(awards||[]),
      userId
    );
  } else {
    const id = 'sp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8);
    req.app.locals.db.prepare(`
      INSERT INTO student_profiles
        (id, user_id, display_name, grade, curriculum, target_country, target_major,
         dream_schools, interests, strengths, mbti, holland_type, holland_secondary,
         study_habit, target_tier, extracurriculars, awards)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, userId,
      JSON.stringify(display_name||null), grade||null, curriculum||null,
      target_country||null, target_major||null,
      JSON.stringify(dream_schools||[]), JSON.stringify(interests||[]), JSON.stringify(strengths||[]),
      mbti||null, holland_type||null, holland_secondary||null,
      study_habit||null, target_tier||null,
      JSON.stringify(extracurriculars||[]), JSON.stringify(awards||[])
    );
  }

  res.json({ success: true, message: '档案已保存' });
});

// GET /api/student/profile — 获取完整学生档案
router.get('/profile', requireAuth, (req, res) => {
  const profile = req.app.locals.db
    .prepare('SELECT * FROM student_profiles WHERE user_id = ?')
    .get(req.userId);

  if (!profile) return res.json(null);

  // Parse JSON fields
  const parsed = { ...profile };
  ['dream_schools','interests','strengths','extracurriculars','awards'].forEach(f => {
    if (parsed[f] && typeof parsed[f] === 'string') {
      try { parsed[f] = JSON.parse(parsed[f]); } catch(e) { parsed[f] = []; }
    }
  });

  res.json(parsed);
});

// ─────────────────────────────────────────────────────────
// Grade Records
// ─────────────────────────────────────────────────────────
router.get('/grades', requireAuth, (req, res) => {
  const rows = req.app.locals.db
    .prepare('SELECT * FROM grade_records WHERE user_id = ? ORDER BY record_date DESC')
    .all(req.userId);
  const parsed = rows.map(r => {
    if (r.subjects && typeof r.subjects === 'string') {
      try { r.subjects = JSON.parse(r.subjects); } catch(e) { r.subjects = []; }
    }
    return r;
  });
  res.json(parsed);
});

router.post('/grades', requireAuth, (req, res) => {
  const { sat, act, toefl, ielts, gpa, gpa_scale, subjects, note, record_date } = req.body;
  const db = req.app.locals.db;

  // Auto-detect attempt numbers
  let attempt_no = 1;
  if (sat) {
    const prev = db.prepare('SELECT count(*) as n FROM grade_records WHERE user_id=? AND sat > 0').get(req.userId).n;
    attempt_no = prev + 1;
  }

  const id = db.prepare(`
    INSERT INTO grade_records (user_id, sat, act, toefl, ielts, gpa, gpa_scale, subjects, note, attempt_no, record_date)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    req.userId,
    sat||null, act||null, toefl||null, ielts||null,
    gpa||null, gpa_scale||'4.0',
    JSON.stringify(subjects||[]),
    note||null,
    attempt_no,
    record_date||null
  );

  res.json({ success: true, id: id.lastInsertRowid });
});

// ─────────────────────────────────────────────────────────
// Competition Records
// ─────────────────────────────────────────────────────────
router.get('/competitions', requireAuth, (req, res) => {
  res.json(req.app.locals.db
    .prepare('SELECT * FROM competition_records WHERE user_id = ? ORDER BY date DESC')
    .all(req.userId));
});

router.post('/competitions', requireAuth, (req, res) => {
  const { name, subject, level, result, grade_participated, date, certificate_no, note } = req.body;
  if (!name) return res.status(400).json({ error: '竞赛名称不能为空' });


// PUT /api/student/grades/:id
router.put('/grades/:id', requireAuth, (req, res) => {
  const { sat, act, toefl, ielts, gpa, note, record_date } = req.body;
  const r = req.app.locals.db.prepare(`
    UPDATE grade_records SET sat=?, act=?, toefl=?, ielts=?, gpa=?, note=?, record_date=? WHERE id=? AND user_id=?
  `).run(sat||null, act||null, toefl||null, ielts||null, gpa||null, note||null, record_date||null, req.params.id, req.userId);
  res.json({ success: r.changes > 0 });
});
router.delete('/grades/:id', requireAuth, (req, res) => {
  const r = req.app.locals.db.prepare('DELETE FROM grade_records WHERE id=? AND user_id=?').run(req.params.id, req.userId);
  res.json({ success: r.changes > 0 });
});

// PUT /api/student/competitions/:id
router.put('/competitions/:id', requireAuth, (req, res) => {
  const { name, subject, level, result, grade_participated, date, certificate_no, note } = req.body;
  const r = req.app.locals.db.prepare(`
    UPDATE competition_records SET name=?, subject=?, level=?, result=?, grade_participated=?, date=?, certificate_no=?, note=?
    WHERE id=? AND user_id=?
  `).run(name, subject||null, level||null, result||null, grade_participated||null, date||null, certificate_no||null, note||null, req.params.id, req.userId);
  res.json({ success: r.changes > 0 });
});

  const id = req.app.locals.db.prepare(`
    INSERT INTO competition_records (user_id, name, subject, level, result, grade_participated, date, certificate_no, note)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(req.userId, name, subject||null, level||null, result||null, grade_participated||null, date||null, certificate_no||null, note||null);

  res.json({ success: true, id: id.lastInsertRowid });
});

router.delete('/competitions/:id', requireAuth, (req, res) => {
  const r = req.app.locals.db.prepare('DELETE FROM competition_records WHERE id=? AND user_id=?').run(req.params.id, req.userId);
  res.json({ success: r.changes > 0 });
});

// ─────────────────────────────────────────────────────────
// Activity Records
// ─────────────────────────────────────────────────────────
router.get('/activities', requireAuth, (req, res) => {
  res.json(req.app.locals.db
    .prepare('SELECT * FROM activity_records WHERE user_id = ? ORDER BY start_date DESC')
    .all(req.userId));
});

router.post('/activities', requireAuth, (req, res) => {
  const { name, role, organization, start_date, end_date, hours_per_week, description, achievements, category } = req.body;
  if (!name) return res.status(400).json({ error: '活动名称不能为空' });


// PUT /api/student/grades/:id
router.put('/grades/:id', requireAuth, (req, res) => {
  const { sat, act, toefl, ielts, gpa, note, record_date } = req.body;
  const r = req.app.locals.db.prepare(`
    UPDATE grade_records SET sat=?, act=?, toefl=?, ielts=?, gpa=?, note=?, record_date=? WHERE id=? AND user_id=?
  `).run(sat||null, act||null, toefl||null, ielts||null, gpa||null, note||null, record_date||null, req.params.id, req.userId);
  res.json({ success: r.changes > 0 });
});
router.delete('/grades/:id', requireAuth, (req, res) => {
  const r = req.app.locals.db.prepare('DELETE FROM grade_records WHERE id=? AND user_id=?').run(req.params.id, req.userId);
  res.json({ success: r.changes > 0 });
});

// PUT /api/student/competitions/:id
router.put('/competitions/:id', requireAuth, (req, res) => {
  const { name, subject, level, result, grade_participated, date, certificate_no, note } = req.body;
  const r = req.app.locals.db.prepare(`
    UPDATE competition_records SET name=?, subject=?, level=?, result=?, grade_participated=?, date=?, certificate_no=?, note=?
    WHERE id=? AND user_id=?
  `).run(name, subject||null, level||null, result||null, grade_participated||null, date||null, certificate_no||null, note||null, req.params.id, req.userId);
  res.json({ success: r.changes > 0 });
});

  const id = req.app.locals.db.prepare(`
    INSERT INTO activity_records (user_id, name, role, organization, start_date, end_date, hours_per_week, description, achievements, category)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(req.userId, name, role||null, organization||null, start_date||null, end_date||null, hours_per_week||null, description||null, achievements||null, category||null);

  res.json({ success: true, id: id.lastInsertRowid });
});

router.delete('/activities/:id', requireAuth, (req, res) => {
  const r = req.app.locals.db.prepare('DELETE FROM activity_records WHERE id=? AND user_id=?').run(req.params.id, req.userId);
  res.json({ success: r.changes > 0 });
});

// ─────────────────────────────────────────────────────────
// Language Records
// ─────────────────────────────────────────────────────────
router.get('/languages', requireAuth, (req, res) => {
  res.json(req.app.locals.db
    .prepare('SELECT * FROM language_records WHERE user_id = ? ORDER BY exam_date DESC')
    .all(req.userId));
});

router.post('/languages', requireAuth, (req, res) => {
  const { exam_type, score, sub_score, exam_date } = req.body;
  if (!exam_type || !score) return res.status(400).json({ error: '考试类型和成绩不能为空' });

  const db = req.app.locals.db;
  const prev = db.prepare('SELECT count(*) as n FROM language_records WHERE user_id=? AND exam_type=?').get(req.userId, exam_type).n;

  const id = db.prepare(`
    INSERT INTO language_records (user_id, exam_type, score, sub_score, exam_date, attempt_no)
    VALUES (?,?,?,?,?,?)
  `).run(req.userId, exam_type, score, sub_score ? JSON.stringify(sub_score) : null, exam_date||null, prev+1);

  res.json({ success: true, id: id.lastInsertRowid });
});

// ─────────────────────────────────────────────────────────
// GET /api/student/history — 完整学生历史（给 LLM 做上下文）
// ─────────────────────────────────────────────────────────
router.get('/history', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const uid = req.userId;

  const profile = db.prepare('SELECT * FROM student_profiles WHERE user_id=?').get(uid);
  const grades = db.prepare('SELECT * FROM grade_records WHERE user_id=? ORDER BY record_date DESC LIMIT 10').all(uid);
  const competitions = db.prepare('SELECT * FROM competition_records WHERE user_id=? ORDER BY date DESC').all(uid);
  const activities = db.prepare('SELECT * FROM activity_records WHERE user_id=? ORDER BY start_date DESC').all(uid);
  const languages = db.prepare('SELECT * FROM language_records WHERE user_id=? ORDER BY exam_date DESC').all(uid);
  const planCases = db.prepare("SELECT id, created_at, target_schools, target_major, status FROM plan_cases WHERE user_id=? AND status!='deleted' ORDER BY created_at DESC LIMIT 20").all(uid);

  // Parse JSON fields in profile
  if (profile) {
    ['dream_schools','interests','strengths','extracurriculars','awards'].forEach(f => {
      if (profile[f] && typeof profile[f] === 'string') {
        try { profile[f] = JSON.parse(profile[f]); } catch(e) { profile[f] = []; }
      }
    });
    // Also attach from user profile
    if (req.user.profile) {
      profile.userProfile = req.user.profile;
    }
  }

  // Parse subjects in grade records
  grades.forEach(g => {
    if (g.subjects && typeof g.subjects === 'string') {
      try { g.subjects = JSON.parse(g.subjects); } catch(e) { g.subjects = []; }
    }
  });

  res.json({ profile, grades, competitions, activities, languages, planCases });
});

module.exports = router;
