const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('../middleware/auth');
const userStore = require('../utils/userStore');

const router = express.Router();
const DEEPSEEK_API = 'https://api.deepseek.com/v1/chat/completions';
const MODEL = 'deepseek-chat';

// ─── RAG: Load knowledge base ─────────────────────────────
const schoolsData = JSON.parse(fs.readFileSync('./data/schools.json', 'utf8'));
const majorsData = JSON.parse(fs.readFileSync('./data/major-details.json', 'utf8'));
const scoreTiers = JSON.parse(fs.readFileSync('./data/score-tiers.json', 'utf8'));

// Try to load Obsidian vault references for RAG
function loadObsidianKB() {
  const vaultPath = '/home/ubuntu/obsidian-vault/References';
  const files = [];
  try {
    const kbFiles = [
      '美国 Top 30 大学详解.md',
      '热门留学专业深度解析与选专业指南.md',
      '标化考试备考策略与时间规划.md',
      '背景提升与暑期规划深度指南.md',
      '国际学校升学四年规划.md',
      '国际学科竞赛深度指南.md',
      '多国混申策略指南.md',
      '美国本科申请全攻略.md',
    ];
    for (const f of kbFiles) {
      try {
        const content = fs.readFileSync(path.join(vaultPath, f), 'utf8');
        // Take first 3000 chars as context
        files.push({ name: f.replace('.md',''), content: content.slice(0, 3000) });
      } catch(e) {}
    }
  } catch(e) {}
  return files;
}

async function callDeepSeek(messages) {
  const response = await fetch(DEEPSEEK_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.7, max_tokens: 4000, stream: false }),
  });
  if (!response.ok) throw new Error(`DeepSeek error ${response.status}`);
  const data = await response.json();
  return data.choices[0].message.content;
}

// ─── Helpers ──────────────────────────────────────────────

function findSchool(nameEn) {
  return schoolsData.find(s => s.name_en === nameEn || s.name_en === decodeURIComponent(nameEn));
}

function findMajor(name) {
  return majorsData.find(m => m.name === name || m.name === decodeURIComponent(name));
}

// Build RAG context for a specific school + major combo
function buildRAGContext(school, major, profile) {
  const kb = loadObsidianKB();
  let ctx = '【知识库参考资料】\n\n';

  // School-specific info
  if (school) {
    ctx += `### 目标学校：${school.name_en} (${school.name_cn || ''})
- SAT范围：${school.sat_range || '—'}
- ACT范围：${school.act_range || '—'}
- 录取率：${school.acceptance_rate || '—'}%
- 排名档位：${school.tier || '—'}
- MBTI匹配：${school.mbti_fit ? school.mbti_fit.join(', ') : '通用'}\n\n`;
  }

  // Major-specific info
  if (major) {
    ctx += `### 目标专业：${major.name}
- 类别：${major.category || '—'}
- 概述：${major.content || '—'}
- AP建议：${major.ap_suggested ? major.ap_suggested.join(', ') : '—'}
- IB建议：${major.ib_suggested ? major.ib_suggested.join(', ') : '—'}
- A-Level建议：${major.alevel_suggested ? major.alevel_suggested.join(', ') : '—'}
- 推荐院校：${major.top_schools ? major.top_schools.join(', ') : '—'}
- 薪资范围：${major.salary_range || '—'}\n\n`;
  }

  // Student profile
  const curriculum = profile.curriculum || 'AP';
  ctx += `### 学生档案
- 年级：${profile.grade || 'G10'}
- 课程体系：${curriculum}
- 目标国家：${profile.target_country === 'UK' ? '英国' : profile.target_country === 'MIX' ? '多国混申' : '美国'}
- MBTI性格：${profile.mbti || '未测评'}
- SAT预估：${profile.sat || '未录入'}
- TOEFL：${profile.toefl || '未录入'}
- GPA：${profile.gpa || '未录入'}\n\n`;

  // Obsidian KB excerpts
  kb.forEach(doc => {
    ctx += `### ${doc.name}\n${doc.content.slice(0, 1500)}\n\n`;
  });

  return ctx;
}

// ─── Routes ───────────────────────────────────────────────

/**
 * POST /api/planning/generate
 * 
 * Body: {
 *   school: "Harvard University",
 *   major: "计算机科学与人工智能",
 *   grade, curriculum, target_country, mbti, sat, toefl, gpa
 * }
 * 
 * Returns a detailed academic pathway plan with phases and timeline
 */
router.post('/generate', requireAuth, async (req, res) => {
  try {
    const { school: schoolName, major: majorName } = req.body;
    const profile = req.body;

    if (!schoolName || !majorName) {
      return res.status(400).json({ error: '缺少必填字段: school, major' });
    }

    const school = findSchool(schoolName);
    const major = findMajor(majorName);
    const ragCtx = buildRAGContext(school, major, profile);

    const gNum = parseInt((profile.grade || 'G10').replace('G', ''));
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const academicYear = currentMonth >= 9 ? currentYear : currentYear - 1;
    const gradYear = academicYear + (12 - gNum);
    const curriculum = profile.curriculum || 'AP';
    const isUK = profile.target_country === 'UK';

    const systemPrompt = `你是一位资深国际教育升学规划专家，精通美国Top30和英国G5大学的录取要求。

请基于以下知识库和学生档案，为【${schoolName} × ${majorName}】生成一份专业且个性化的学业路径规划。

${ragCtx}

要求生成以下结构化内容（返回纯JSON，不要markdown代码块）：

1. **整体评估** (assessment): 200字以内，分析学生当前状态与目标学校+专业的匹配度，指出优势和差距
2. **4个阶段规划** (phases): 每个阶段包含：
   - title: 阶段标题（如"学术基础夯实期"）
   - period: 时间范围（如"G10上学期—G10暑假"）
   - items: 具体行动项数组（每项20字以内，共4-5项）
3. **关键里程碑时间轴** (milestones): 12-15个节点，每个包含：
   - month: 月份(1-12)
   - year: 年份
   - grade: 年级标签（如"G10上"）
   - label: 行动名称（4-8字）
   - detail: 详细说明（15字以内）
   - category: "academic"|"test"|"activity"|"application"
4. **标化目标** (score_targets): {sat, toefl, gpa} 具体目标分数
5. **选课建议** (course_plan): 针对${curriculum}体系的具体课程建议（3-5门）
6. **竞赛推荐** (competitions): 2-3个相关竞赛及准备时间
7. **总结建议** (summary): 150字，个性化建议

请确保所有建议都是针对【${schoolName}】这个学校、【${majorName}】这个专业的具体建议，而不是泛泛而谈。

JSON格式：
{
  "assessment": "...",
  "phases": [{"title":"...","period":"...","items":["..."]}],
  "milestones": [{"month":9,"year":2026,"grade":"G10上","label":"...","detail":"...","category":"academic"}],
  "score_targets": {"sat":1520,"toefl":105,"gpa":"3.8+"},
  "course_plan": ["..."],
  "competitions": [{"name":"...","timing":"..."}],
  "summary": "..."
}`;

    const answer = await callDeepSeek([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `请为【${schoolName} × ${majorName}】生成详细学业路径规划。学生是${profile.grade}年级，${curriculum}体系，目标${isUK ? '英国' : '美国'}。` }
    ]);

    let result;
    try {
      const cleaned = answer.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      result = JSON.parse(cleaned);
    } catch (e) {
      console.error('Failed to parse LLM response:', answer.slice(0, 500));
      return res.status(500).json({ error: 'AI响应解析失败', raw: answer.slice(0, 1000) });
    }

    // Add status to milestones
    const milestones = (result.milestones || []).map(m => {
      const dl = new Date(m.year, m.month - 1, 28);
      return {
        ...m,
        status: now > dl ? 'behind' : 'upcoming',
        tip: m.detail || ''
      };
    });

    // Store plan via userStore (SQLite)
    const planKey = `${schoolName}::${majorName}`;
    const user = userStore.findById(req.user.id);
    const plans = user?.plans || {};
    plans[planKey] = {
      school: schoolName,
      major: majorName,
      ...result,
      milestones,
      generatedAt: new Date().toISOString()
    };
    userStore.updatePlans(req.user.id, plans);

    res.json({
      school: schoolName,
      major: majorName,
      plan: { ...result, milestones }
    });

  } catch (err) {
    console.error('Planning generation error:', err);
    res.status(500).json({ error: '学业规划生成失败', detail: err.message });
  }
});

/**
 * GET /api/planning/plans — list all saved plans for current user
 */
router.get('/plans', requireAuth, (req, res) => {
  try {
    const user = userStore.findById(req.user.id);
    res.json({ plans: user?.plans || {} });
  } catch(e) {
    res.json({ plans: {} });
  }
});

/**
 * POST /api/planning/select — activate a plan (updates dashboard)
 * Body: { planKey: "Harvard University::计算机科学与人工智能" }
 */
router.post('/select', requireAuth, (req, res) => {
  try {
    const { planKey } = req.body;
    userStore.setActivePlan(req.user.id, planKey);
    const user = userStore.findById(req.user.id);
    const plan = user?.plans?.[planKey] || null;
    res.json({ success: true, activePlan: planKey, plan });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/planning/active — get currently active plan
 */
router.get('/active', requireAuth, (req, res) => {
  try {
    const user = userStore.findById(req.user.id);
    const planKey = user?.activePlan;
    const plan = planKey ? user?.plans?.[planKey] : null;
    res.json({ activePlan: planKey, plan });
  } catch(e) {
    res.json({ activePlan: null, plan: null });
  }
});

module.exports = router;
