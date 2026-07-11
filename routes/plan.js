const express = require('express');
const { requireAuth } = require('../middleware/auth');

// Middleware: reject parent users with proper error
function requireStudent(req, res, next) {
  if (req.user && req.user.role === 'parent') {
    return res.status(403).json({ error: '此功能仅限学生账号使用。请使用家长端 /parent 查看学生数据。' });
  }
  next();
}
const fs = require('fs');
const path = require('path');

const router = express.Router();

const DEEPSEEK_API = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-chat';
const MINIMAX_API = 'https://api.minimaxi.com/v1/chat/completions';
const MINIMAX_MODEL = 'MiniMax-M2.7';

const timelineData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'timeline.json'), 'utf8')
);
const schoolsData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'schools.json'), 'utf8')
);

// POST /api/plan/generate — AI generates personalized action plan
router.post('/generate', requireAuth, async (req, res) => {
  try {
    const profile = req.user.profile || {};
    const { target_schools, target_major, focus_areas } = req.body;

    // Gather context
    const grade = profile.grade || 'G10';
    const curriculum = profile.curriculum || 'AP';
    const curData = timelineData.curricula[curriculum] || timelineData.curricula['AP'];
    const phase = curData.phases[grade];

    // Current tasks
    const currentTasks = phase ? phase.tasks.map(t => `- ${t.title}: ${t.desc} (${t.deadline})`).join('\n') : '';

    // Score context
    const scores = [];
    if (profile.sat) scores.push(`SAT: ${profile.sat}`);
    if (profile.toefl) scores.push(`托福: ${profile.toefl}`);
    if (profile.ielts) scores.push(`雅思: ${profile.ielts}`);
    if (profile.a_level) scores.push(`A-Level: ${profile.a_level}`);
    if (profile.ib_score) scores.push(`IB: ${profile.ib_score}`);
    const scoreStr = scores.length > 0 ? scores.join(', ') : '暂无标化成绩';

    // Target school info
    let schoolStr = '未设置目标学校';
    if (target_schools && target_schools.length > 0) {
      const schoolNames = target_schools.map(sid => {
        const s = schoolsData.find(sc => sc.name_en === sid || sc.name_cn === sid);
        return s ? `${s.name_cn}(${s.name_en}, SAT ${s.sat_low}-${s.sat_high || 'N/A'}, 录取率${s.acceptance_rate}%)` : sid;
      });
      schoolStr = schoolNames.join('; ');
    }

    const prompt = `你是一位经验丰富的国际高中升学顾问。请根据以下学生信息，生成一份个性化的3个月行动计划。

学生背景：
- 当前年级：${grade}（${curriculum}体系）
- 课程体系阶段：${phase ? phase.label : '未知'}
- 当前成绩：${scoreStr}
- 目标专业方向：${target_major || '未确定'}
- 目标学校：${schoolStr}
- MBTI性格：${profile.mbti || '未测试'}
- 重点关注领域：${focus_areas || '综合提升'}

当前阶段应完成的任务：
${currentTasks}

请生成一个结构化的行动计划，包含以下内容（用JSON格式返回，不要markdown代码块）：

{
  "summary": "一句话总结当前最紧迫的事",
  "priority_actions": [
    {"action": "具体行动", "why": "为什么重要", "timeline": "建议时间", "effort": "高/中/低"}
  ],
  "score_strategy": "针对当前成绩的具体提分建议",
  "activity_advice": "课外活动和背景提升建议",
  "risk_alert": "需要警惕的风险点",
  "next_milestone": "下一个关键里程碑"
}

请用中文回答，建议要具体、可执行，避免空泛的套话。`;

    // Try MiniMax first, fall back to DeepSeek
    let content = '';
    let lastError = null;

    if (process.env.MINIMAX_API_KEY) {
      try {
        const mmResp = await fetch(MINIMAX_API, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.MINIMAX_API_KEY}`
          },
          body: JSON.stringify({
            model: MINIMAX_MODEL,
            messages: [
              { role: 'system', content: '你是一位专业的国际高中升学顾问，擅长为G10-G12学生制定个性化升学规划。回答用JSON格式，不要markdown代码块包裹，不要有<think>标签。' },
              { role: 'user', content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 2500
          })
        });
        if (mmResp.ok) {
          const mmData = await mmResp.json();
          content = mmData.choices?.[0]?.message?.content || '';
          // Strip think tags
          content = content.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
        } else {
          lastError = `MiniMax ${mmResp.status}`;
        }
      } catch (e) {
        lastError = e.message;
      }
    }

    // Fallback to DeepSeek if MiniMax failed or no key
    if (!content && process.env.DEEPSEEK_API_KEY) {
      try {
        const dsResp = await fetch(DEEPSEEK_API, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
          },
          body: JSON.stringify({
            model: DEEPSEEK_MODEL,
            messages: [
              { role: 'system', content: '你是一位专业的国际高中升学顾问，擅长为G10-G12学生制定个性化升学规划。回答用JSON格式，不要markdown代码块包裹。' },
              { role: 'user', content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 2000
          })
        });
        if (dsResp.ok) {
          const dsData = await dsResp.json();
          content = dsData.choices?.[0]?.message?.content || '';
        } else {
          lastError = `DeepSeek ${dsResp.status}`;
        }
      } catch (e) {
        lastError = e.message;
      }
    }

    if (!content) {
      console.error('All LLM providers failed. Last error:', lastError);
      return res.status(502).json({ error: 'AI服务暂时不可用，请稍后重试' });
    }

    // Try to parse JSON from response
    let plan;
    try {
      // Extract JSON if wrapped in markdown
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      plan = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch (e) {
      console.error('Failed to parse AI response as JSON:', e.message);
    }

    if (!plan) {
      // Return raw text if JSON parsing fails
      return res.json({
        raw: true,
        content: content,
        summary: 'AI已生成建议，请查看详情',
        priority_actions: []
      });
    }

    res.json(plan);
  } catch (err) {
    console.error('Plan generation error:', err);
    res.status(500).json({ error: '生成失败: ' + err.message });
  }
});

// GET /api/plan/schools — search schools for goal setting
router.get('/schools', requireAuth, requireStudent, (req, res) => {
  const { q, country } = req.query;
  let results = schoolsData;

  if (country && country !== 'ALL') {
    results = results.filter(s => {
      if (country === 'US') return s.country !== 'UK';
      if (country === 'UK') return s.country === 'UK';
      return true;
    });
  }

  if (q) {
    const lower = q.toLowerCase();
    results = results.filter(s =>
      (s.name_cn && s.name_cn.includes(q)) ||
      (s.name_en && s.name_en.toLowerCase().includes(lower))
    );
  }

  res.json(results.slice(0, 20).map(s => ({
    id: s.name_en,
    name_cn: s.name_cn,
    name_en: s.name_en,
    tier: s.tier,
    country: s.country || 'US',
    sat_low: s.sat_low,
    sat_high: s.sat_high,
    acceptance_rate: s.acceptance_rate,
    ranking: s.ranking
  })));
});

module.exports = router;
