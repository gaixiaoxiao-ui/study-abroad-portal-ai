const express = require('express');
const { requireAuth, requireStudent } = require('../middleware/auth');
const userStore = require('../utils/userStore');

const router = express.Router();

// GET /api/activities — list user's activities
router.get('/', requireAuth, requireStudent, (req, res) => {
  try {
    const user = userStore.findById(req.userId);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    const activities = user.profile && user.profile.activities ? user.profile.activities : [];
    res.json({ activities });
  } catch(e) {
    console.error('[activities GET]', e.message);
    res.status(500).json({ error: '服务器错误' });
  }
});

// POST /api/activities — create a new activity
router.post('/', requireAuth, requireStudent, (req, res) => {
  try {
    const { name, description, role, start_date, end_date, achievements } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: '活动名称不能为空' });
    }
    if (description && description.length > 250) {
      return res.status(400).json({ error: '描述不能超过250字' });
    }
    
    const activity = {
      id: 'act_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      name: name.trim(),
      description: (description || '').trim(),
      role: (role || '').trim(),
      start_date: start_date || '',
      end_date: end_date || '',
      achievements: (achievements || '').trim(),
      created_at: new Date().toISOString(),
    };
    
    const user = userStore.findById(req.userId);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    
    const profile = { ...user.profile };
    if (!profile.activities) profile.activities = [];
    profile.activities.unshift(activity); // newest first
    
    userStore.updateProfile(req.userId, profile);
    
    res.json({ activity, message: '活动已保存' });
  } catch(e) {
    console.error('[activities POST]', e.message);
    res.status(500).json({ error: '服务器错误' });
  }
});

// DELETE /api/activities/:id — delete an activity
router.delete('/:id', requireAuth, requireStudent, (req, res) => {
  try {
    const user = userStore.findById(req.userId);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    
    const profile = { ...user.profile };
    if (!profile.activities) profile.activities = [];
    
    const idx = profile.activities.findIndex(a => a.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: '活动不存在' });
    
    profile.activities.splice(idx, 1);
    userStore.updateProfile(req.userId, profile);
    
    res.json({ message: '已删除' });
  } catch(e) {
    console.error('[activities DELETE]', e.message);
    res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;