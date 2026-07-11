const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const userStore = require('../utils/userStore');
const userCache = require('../utils/cache');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /register — 注册新用户
 * Body: { username, email, password, displayName? }
 */
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, displayName } = req.body;

    // Validation
    if (!username || !email || !password) {
      return res.status(400).json({ error: '缺少必填字段: username, email, password' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: '密码长度至少6位' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: '邮箱格式不正确' });
    }
    if (!/^[a-zA-Z0-9_]{2,20}$/.test(username)) {
      return res.status(400).json({ error: '用户名需为2-20位字母、数字或下划线' });
    }

    // Check duplicates
    if (userStore.findByEmail(email)) {
      return res.status(409).json({ error: '该邮箱已被注册' });
    }
    if (userStore.findByUsername(username)) {
      return res.status(409).json({ error: '该用户名已被使用' });
    }

    // Create user
    const user = await userStore.createUser({ username, email, password, displayName });

    // Issue token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      config.JWT_SECRET,
      { expiresIn: config.JWT_EXPIRES_IN }
    );

    // Set session cookie (30 days, path=/)
    // Set session cookie (30 days, path=/)
    res.setHeader('Set-Cookie', `student_token=${token}; Max-Age=2592000; Path=/`);
    res.status(201).json({
      message: '注册成功',
      user,
      token,
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: '注册失败，请稍后重试' });
  }
});

/**
 * POST /login — 用户登录
 * Body: { email, password }
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: '请输入邮箱和密码' });
    }

    const raw = userStore.findByEmailWithPassword(email);
    const user = raw ? userStore.sanitizeUser(raw) : null;
    if (!user) {
      return res.status(401).json({ error: '邮箱或密码错误' });
    }

    const match = raw ? await bcrypt.compare(password, raw.password) : false;
    if (!match) {
      return res.status(401).json({ error: '邮箱或密码错误' });
    }

    // Issue token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      config.JWT_SECRET,
      { expiresIn: config.JWT_EXPIRES_IN }
    );

    // Cache a brief user session marker
    userCache.set(user.id, 'session:last_login', new Date().toISOString(), 24 * 60 * 60 * 1000);

    // Set session cookie (30 days, path=/)
    // Set session cookie (30 days, path=/)
    res.setHeader('Set-Cookie', `student_token=${token}; Max-Age=2592000; Path=/`);
    res.json({
      message: '登录成功',
      user: user,
      token,
    });
  } catch (err) {
    require('fs').appendFileSync('/tmp/login_error.log', new Date().toISOString() + ' ' + (err.stack || err.message || String(err)) + '\n');
    console.error('Login error:', err);
    res.status(500).json({ error: '登录失败，请稍后重试' });
  }
});

/**
 * GET /me — 获取当前用户信息
 */
router.get('/me', requireAuth, (req, res) => {
  // Check user cache first
  let profile = userCache.get(req.userId, 'profile');
  if (!profile) {
    profile = req.user;
    userCache.set(req.userId, 'profile', profile);
  }
  res.json({ user: profile });
});

/**
 * PUT /me — 更新用户信息/升学档案
 * Body: { profile: { mbti, holland, sat, grade, ... } }
 */
router.put('/me', requireAuth, (req, res) => {
  const { profile } = req.body;
  if (!profile || typeof profile !== 'object') {
    return res.status(400).json({ error: '请提供要更新的档案信息' });
  }

  const updated = userStore.updateProfile(req.userId, profile);
  if (!updated) {
    return res.status(500).json({ error: '更新失败' });
  }

  // Invalidate profile cache
  userCache.invalidate(req.userId, 'profile');

  res.json({ message: '档案更新成功', user: updated });
});

/**
 * PUT /me/password — 修改密码
 * Body: { oldPassword, newPassword }
 */
router.put('/me/password', requireAuth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: '请提供旧密码和新密码' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: '新密码长度至少6位' });
    }

    // Verify old password
    const user = userStore.findById(req.userId);
    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match) {
      return res.status(401).json({ error: '旧密码错误' });
    }

    await userStore.updatePassword(req.userId, newPassword);
    res.json({ message: '密码修改成功' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: '修改密码失败' });
  }
});

/**
 * POST /logout — 登出（仅客户端清除token即可）
 * 此处仅作清除缓存的辅助
 */
router.post('/logout', requireAuth, (req, res) => {
  userCache.invalidate(req.userId, 'session:last_login');
  userCache.clear(req.userId);
  res.json({ message: '已登出' });
});

/**
 * POST /forgot-password — 发送密码重置令牌
 * Body: { email }
 * Note: 当前为简化版，生成重置令牌并存到数据库中
 */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: '请输入邮箱' });
    
    const user = userStore.findByEmail(email);
    if (!user) {
      // 不暴露用户是否存在，统一返回成功
      return res.json({ message: '如果该邮箱已注册，重置链接已发送' });
    }
    
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 3600000).toISOString(); // 1小时过期
    
    // Store reset token in cache
    userCache.set(user.id, 'reset_token', token, 3600000);
    userCache.set(user.id, 'reset_expires', expires, 3600000);
    
    console.log(`[Password Reset] Token for ${email}: ${token}`);
    // TODO: 发送邮件（当前打印到控制台用于测试）
    
    res.json({ 
      message: '如果该邮箱已注册，重置链接已发送',
      // 开发模式返回token
      resetToken: token,
      userId: user.id
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: '操作失败，请稍后重试' });
  }
});

/**
 * POST /reset-password — 使用令牌重置密码
 * Body: { userId, token, newPassword }
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { userId, token, newPassword } = req.body;
    if (!userId || !token || !newPassword) {
      return res.status(400).json({ error: '请提供完整信息' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: '新密码至少6位' });
    }
    
    const savedToken = userCache.get(userId, 'reset_token');
    const expires = userCache.get(userId, 'reset_expires');
    
    if (!savedToken || savedToken !== token) {
      return res.status(400).json({ error: '重置链接无效或已过期' });
    }
    if (expires && new Date(expires) < new Date()) {
      return res.status(400).json({ error: '重置链接已过期（1小时有效）' });
    }
    
    await userStore.updatePassword(userId, newPassword);
    userCache.invalidate(userId, 'reset_token');
    userCache.invalidate(userId, 'reset_expires');
    
    res.json({ message: '密码重置成功，请使用新密码登录' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: '重置失败，请稍后重试' });
  }
});


module.exports = router;
