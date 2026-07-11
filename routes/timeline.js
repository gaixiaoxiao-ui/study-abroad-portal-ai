const express = require('express');
const { requireAuth } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Load timeline data
const timelineData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'timeline.json'), 'utf8')
);

// GET /api/timeline — get timeline for user's grade + curriculum
router.get('/', requireAuth, (req, res) => {
  const profile = req.user.profile || {};
  const grade = profile.grade || 'G10';
  // Default to AP if no curriculum specified
  const curriculum = profile.curriculum || 'AP';

  const curricula = timelineData.curricula;
  const curData = curricula[curriculum] || curricula['AP'];
  const phases = curData.phases || {};

  // Build response
  const result = {
    curriculum: curData.name,
    currentGrade: grade,
    phases: {}
  };

  // Always include all phases, but mark current/future/past
  const gradeOrder = ['G10', 'G11', 'G12'];
  const currentIdx = gradeOrder.indexOf(grade);

  for (const [g, phase] of Object.entries(phases)) {
    const idx = gradeOrder.indexOf(g);
    let status = 'future';
    if (idx < currentIdx) status = 'past';
    else if (idx === currentIdx) status = 'current';

    result.phases[g] = {
      label: phase.label,
      status: status,
      tasks: phase.tasks.map(t => ({
        ...t,
        // All tasks in current and future phases are actionable
        completed: false
      }))
    };
  }

  res.json(result);
});

// GET /api/timeline/activities — get recommended activities based on academic profile
router.get('/activities', requireAuth, (req, res) => {
  const profile = req.user.profile || {};
  const grade = profile.grade || 'G10';

  // Filter activities suitable for user's grade and return all
  const activities = timelineData.activities
    .filter(a => a.grades.includes(grade))
    .map(a => ({
      id: a.id,
      name: a.name,
      category: a.category,
      level: a.level,
      effort: a.effort,
      field: a.field,
      desc: a.desc
    }));

  res.json({ activities, grade });
});

// GET /api/timeline/progress — get student progress summary for parent view
router.get('/progress', requireAuth, (req, res) => {
  const profile = req.user.profile || {};
  const grade = profile.grade || 'G10';
  const curricula = timelineData.curricula;
  const curriculum = profile.curriculum || 'AP';
  const curData = curricula[curriculum] || curricula['AP'];
  const phase = curData.phases[grade];

  if (!phase) {
    return res.json({ error: '无效的年级' });
  }

  // Count tasks by category
  const byCategory = {};
  phase.tasks.forEach(t => {
    if (!byCategory[t.category]) {
      byCategory[t.category] = { total: 0, critical: 0, high: 0, medium: 0, low: 0 };
    }
    byCategory[t.category].total++;
    byCategory[t.category][t.priority]++;
  });

  // Build score summary
  const scores = {
    sat: profile.sat || null,
    act: profile.act || null,
    toefl: profile.toefl || null,
    ielts: profile.ielts || null,
    a_level: profile.a_level || null,
    ib_score: profile.ib_score || null,
  };

  // Check if scores meet baseline for current grade
  const baselineTargets = {
    'G10': { toefl: 80, ielts: 6.0, sat: null, act: null },
    'G11': { toefl: 100, ielts: 7.0, sat: 1450, act: 32 },
    'G12': { toefl: 105, ielts: 7.5, sat: 1500, act: 34 },
  };

  const targets = baselineTargets[grade] || {};
  const scoreStatus = {};
  for (const [key, target] of Object.entries(targets)) {
    if (target === null) continue;
    const val = scores[key];
    if (val === null || val === undefined) {
      scoreStatus[key] = { status: 'unknown', label: '未录入' };
    } else {
      scoreStatus[key] = {
        status: parseInt(val) >= target ? 'ok' : 'below',
        current: val,
        target: target
      };
    }
  }

  res.json({
    grade,
    curriculum: curData.name,
    phaseLabel: phase.label,
    totalTasks: phase.tasks.length,
    tasksByCategory: byCategory,
    scores: scoreStatus,
    profile: {
      mbti: profile.mbti || null,
      holland: profile.holland || null,
      target_country: profile.target_country || null,
      target_major: profile.target_major || null,
      target_school: profile.target_school || null,
    }
  });
});

module.exports = router;
