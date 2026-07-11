const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── Simple in-memory cache (24h TTL) ──
const pipelineCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function getCacheKey(profile) {
  // Hash key from stable profile fields
  const key = JSON.stringify({
    grade: profile.grade,
    curriculum: profile.curriculum,
    target_country: profile.target_country,
    mbti: profile.mbti,
    sat: Math.round((profile.sat || 0) / 50) * 50, // round to nearest 50
    gpa: profile.gpa
  });
  return key;
}

const DEEPSEEK_API = 'https://api.deepseek.com/v1/chat/completions';
const MODEL = 'deepseek-chat';

async function callDeepSeek(messages) {
  const response = await fetch(DEEPSEEK_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.7, max_tokens: 3000, stream: false }),
  });
  if (!response.ok) throw new Error(`DeepSeek error ${response.status}`);
  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * POST /api/pipeline — 生成个性化的升学Pipeline时间轴
 * Body: { grade, curriculum, target_country, mbti, sat, toefl, gpa, dream_school }
 * Returns: { milestones: [...], summary: "..." }
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const { grade, curriculum, target_country, mbti, sat, toefl, gpa, dream_school } = req.body;
    
    // Check cache first
    const cacheKey = getCacheKey({ grade, curriculum, target_country, mbti, sat, gpa });
    const cached = pipelineCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      console.log('[Pipeline] Cache hit for', cacheKey.slice(0, 60));
      return res.json({ ...cached.data, cached: true });
    }
    
    const gNum = parseInt((grade || 'G10').replace('G', ''));
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const academicYear = currentMonth >= 9 ? currentYear : currentYear - 1;
    const gradYear = academicYear + (12 - gNum);
    
    const systemPrompt = `你是一位资深的国际教育升学规划专家，精通AP/IB/A-Level课程体系、美国/英国大学申请策略、标化考试规划、竞赛辅导和专业选择。你需要为一个学生生成精细化的升学时间轴（Pipeline）。

学生信息：
- 年级：${grade}（毕业年份：${gradYear}年）
- 课程体系：${curriculum || 'AP'}
- 目标国家：${target_country === 'UK' ? '英国' : target_country === 'MIX' ? '美国+英国混申' : '美国'}
- MBTI性格：${mbti || '未测评'}
- SAT预估：${sat || '未录入'}分
- TOEFL：${toefl || '未录入'}分
- GPA：${gpa || '未录入'}
- 梦校：${dream_school || '未指定'}

请生成一个从G10年9月到G12年4月的精细化月度时间轴。要求：
1. 每个节点包含：月份（如"2026年9月"）、行动名称（4-6个字）、简要说明（15字以内）
2. 针对学生的课程体系给出具体建议：如果AP体系，指定具体的AP科目；如果是IB体系，指定HL/SL建议；如果是A-Level，指定具体科目
3. 竞赛建议必须具体：例如"AMC12数学竞赛"而非"竞赛备战"，"USACO计算机竞赛"而非"编程竞赛"，并说明赛前辅导的启动时间
4. 标化考试给出具体目标分数和备考时间线
5. 活动规划要结合MBTI性格特点
6. 暑期安排要具体到项目类型（夏校/科研/实习/志愿者）
7. 每个节点必须标注具体的学科类别(category字段)：数学相关用"math"，物理用"physics"，生物/化学用"biology"，英语/标化考试用"english"，计算机用"cs"，竞赛用"competition"，活动/夏校用"activity"，申请用"application"
8. 里程碑时间轴需要覆盖多个学科维度：数学、物理、生物/化学、英语/标化、计算机科学、竞赛、活动、申请
9. 共生成18-22个节点
8. 返回纯JSON，格式为：
{
  "milestones": [
    {"month":9, "year":2026, "grade":"G10", "label":"xxx", "detail":"xxx", "category":"academic|test|activity|application"},
    ...
  ],
  "summary":"一段200字左右的整体规划概述"
}`;

    const userPrompt = `请为这个${grade}学生生成升学Pipeline时间轴。确保每个建议都是针对${curriculum || 'AP'}体系、目标${target_country === 'UK' ? '英国' : '美国'}的具体建议。`;
    
    const answer = await callDeepSeek([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]);
    
    // Parse the JSON response
    let result;
    try {
      const cleaned = answer.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      result = JSON.parse(cleaned);
    } catch (e) {
      console.error('Failed to parse LLM response:', answer.slice(0, 500));
      return res.status(500).json({ error: 'AI响应解析失败', raw: answer.slice(0, 1000) });
    }
    
    // Validate and add status for each milestone
    const milestones = (result.milestones || []).map(m => {
      const dl = new Date(m.year, m.month - 1, 28);
      const isDone = false; // milestones from LLM are all new suggestions
      const isOverdue = now > dl;
      return {
        ...m,
        status: isDone ? 'done' : (isOverdue ? 'behind' : 'upcoming'),
        tip: m.detail || ''
      };
    });
    
    const responseData = { milestones, summary: result.summary || '' };
    
    // Save to cache
    pipelineCache.set(cacheKey, { data: responseData, timestamp: Date.now() });
    // Limit cache size to 100 entries
    if (pipelineCache.size > 100) {
      const firstKey = pipelineCache.keys().next().value;
      pipelineCache.delete(firstKey);
    }
    
    res.json({ ...responseData, cached: false });
    
  } catch (err) {
    console.error('Pipeline generation error:', err);
    res.status(500).json({ error: 'AI规划生成失败', detail: err.message });
  }
});

module.exports = router;
