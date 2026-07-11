const express = require('express');
const { requireAuth } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

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

// Middleware: reject parent users
function requireStudent(req, res, next) {
  if (req.user && req.user.role === 'parent') {
    return res.status(403).json({ error: '此功能仅限学生账号使用。请使用家长端 /parent 查看学生数据。' });
  }
  next();
}

// GET /api/plan/schools — search schools
router.get('/schools', requireAuth, requireStudent, (req, res) => {
  const { q, country } = req.query;
  let results = schoolsData;
  if (country && country !== 'ALL') {
    results = country === 'UK'
      ? results.filter(s => s.country === 'UK')
      : results.filter(s => s.country !== 'UK');
  }
  if (q) {
    const lower = q.toLowerCase();
    results = results.filter(s =>
      (s.name_cn && s.name_cn.includes(q)) ||
      (s.name_en && s.name_en.toLowerCase().includes(lower))
    );
  }
  res.json(results.slice(0, 20).map(s => ({
    id: s.name_en, name_cn: s.name_cn, name_en: s.name_en,
    tier: s.tier, country: s.country || 'US',
    sat_low: s.sat_low, sat_high: s.sat_high,
    acceptance_rate: s.acceptance_rate, ranking: s.ranking
  })));
});

// POST /api/plan/generate — AI generates personalized action plan (LLM-powered)
router.post('/generate', requireAuth, requireStudent, async (req, res) => {
  try {
    const user = req.user;
    const profile = user.profile || {};
    const { target_schools, target_major, focus_areas } = req.body;

    // ── Collect all student data ──
    const grade = profile.grade || 'G10';
    const curriculum = profile.curriculum || 'AP';
    const curData = timelineData.curricula[curriculum] || timelineData.curricula['AP'];
    const phase = curData.phases[grade];

    // Academic scores
    const scores = [];
    if (profile.sat) scores.push(`SAT: ${profile.sat}`);
    if (profile.toefl) scores.push(`托福: ${profile.toefl}`);
    if (profile.ielts) scores.push(`雅思: ${profile.ielts}`);
    if (profile.a_level) scores.push(`A-Level: ${profile.a_level}`);
    if (profile.ib_score) scores.push(`IB: ${profile.ib_score}`);
    if (profile.act) scores.push(`ACT: ${profile.act}`);
    if (profile.gpa) scores.push(`GPA: ${profile.gpa}`);
    const scoreStr = scores.length > 0 ? scores.join(', ') : '暂无标化成绩';

    // Dream schools
    let schoolStr = '未设置目标学校';
    if (target_schools && target_schools.length > 0) {
      const schoolNames = target_schools.map(sid => {
        const s = schoolsData.find(sc => sc.name_en === sid || sc.name_cn === sid);
        return s
          ? `${s.name_cn}(${s.name_en}, SAT建议 ${s.sat_low}-${s.sat_high || 'N/A'}, 录取率${s.acceptance_rate}%)`
          : sid;
      });
      schoolStr = schoolNames.join('; ');
    } else if (profile.dream_schools && profile.dream_schools.length > 0) {
      schoolStr = profile.dream_schools.join(', ');
    }

    // Academic history from plans/active_plan
    let academicHistory = '暂无历史成绩记录';
    const activePlan = user.activePlan || (user.plans && user.plans[0]) || null;
    if (activePlan && activePlan.scoreHistory) {
      academicHistory = activePlan.scoreHistory
        .map(h => `${h.date || '近期'}: SAT ${h.sat || '-'}, 托福 ${h.toefl || '-'}, GPA ${h.gpa || '-'}`)
        .join('\n');
    }

    // Competition records
    let competitionStr = '暂无竞赛记录';
    if (activePlan && activePlan.competitions && activePlan.competitions.length > 0) {
      competitionStr = activePlan.competitions
        .map(c => `- ${c.name} (${c.level || '级别未知'}, ${c.result || '结果未知'})`)
        .join('\n');
    }

    // Current tasks
    const currentTasks = phase
      ? phase.tasks.map(t => `- ${t.title}: ${t.desc} (${t.deadline || '无期限'})`).join('\n')
      : '';

    // Holland & MBTI
    const personalityStr = [
      profile.holland ? `Holland类型: ${profile.holland}` : null,
      profile.mbti ? `MBTI: ${profile.mbti}` : null,
    ].filter(Boolean).join(', ') || '未进行性格测试';

    // Target major
    const majorStr = target_major || (profile.majors && profile.majors.join(', ')) || '未确定';
    const targetCountryStr = profile.target_country || '未设置';

    // ── Build comprehensive LLM prompt ──
    const prompt = `你是国际高中升学顾问。请根据以下学生信息生成升学规划JSON，直接输出JSON不要其他内容，不要<think>标签：
学生：${grade}年级/${curriculum}体系，目标${targetCountryStr}，专业${majorStr}，${personalityStr}
成绩：${scoreStr}
历史：${academicHistory}
梦校：${schoolStr}
竞赛：${competitionStr}

JSON格式（所有字段必填）：
{"summary":"战略定位","studentProfile":{"strengths":["优势1","优势2"],"areasForImprovement":["需提升1"],"personalityFit":"匹配分析"},"timeline":{"immediate":{"focus":"当前重点","actions":["行动1","行动2"],"deadline":"1-3个月"},"nearTerm":{"focus":"近期","actions":["行动1"],"deadline":"3-6个月"},"mediumTerm":{"focus":"中期","actions":["行动1"],"deadline":"6-12个月"},"application":{"focus":"申请季","actions":["行动1"],"deadline":"申请前"}},"scoreStrategy":{"sat":{"current":"","target":"","actionPlan":["步骤1"]},"toefl_ielts":{"current":"","target":"","actionPlan":["步骤1"]}},"competitionPlan":[{"name":"","level":"","bestGrade":"","prepMonths":"","weight":""}],"universityRoadmap":[{"tier":"冲刺","name":"","requirement":"","myStatus":"","gap":"","action":""},{"tier":"匹配","name":"","requirement":"","myStatus":"","gap":"","action":""},{"tier":"保底","name":"","requirement":"","myStatus":"","gap":"","action":""}],"riskPoints":[{"risk":"","likelihood":"","mitigation":""}],"topAdvice":["建议1","建议2","建议3"]}`;

    // ── Call LLM with timeout ──
    let content = '';
    let lastError = null;

    if (process.env.MINIMAX_API_KEY) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 120000);
        const mmResp = await fetch(MINIMAX_API, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.MINIMAX_API_KEY}`
          },
          body: JSON.stringify({
            model: MINIMAX_MODEL,
            messages: [
              { role: 'system', content: '你是一位专业的国际高中升学顾问，擅长为G10-G12学生制定个性化升学规划。回答用JSON格式，不要markdown代码块包裹，不要有<think>标签，所有字段填写完整。' },
              { role: 'user', content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 2000
          }),
          signal: controller.signal
        });
        clearTimeout(timer);
        if (mmResp.ok) {
          const mmData = await mmResp.json();
          content = mmData.choices?.[0]?.message?.content || '';
          // Strip think tags and trim
          content = content.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
        } else {
          lastError = `MiniMax ${mmResp.status}`;
        }
      } catch (e) {
        lastError = e.name === 'AbortError' ? 'LLM响应超时（45秒），请稍后重试' : e.message;
      }
    }

    if (!content && process.env.DEEPSEEK_API_KEY) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 120000);
        const dsResp = await fetch(DEEPSEEK_API, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
          },
          body: JSON.stringify({
            model: DEEPSEEK_MODEL,
            messages: [
              { role: 'system', content: '你是一位专业的国际高中升学顾问，擅长为G10-G12学生制定个性化升学规划。回答用JSON格式，不要markdown代码块包裹，所有字段填写完整。' },
              { role: 'user', content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 2000
          }),
          signal: controller.signal
        });
        clearTimeout(timer);
        if (dsResp.ok) {
          const dsData = await dsResp.json();
          content = dsData.choices?.[0]?.message?.content || '';
        } else {
          lastError = `DeepSeek ${dsResp.status}`;
        }
      } catch (e) {
        lastError = e.name === 'AbortError' ? 'LLM响应超时（45秒），请稍后重试' : e.message;
      }
    }

    if (!content) {
      console.error('[plan/generate] All LLM providers failed. Last error:', lastError);
      return res.status(502).json({ error: 'AI服务暂时不可用：' + lastError });
    }

    // ── Parse JSON ──
    let plan = null;
    try {
      // Strip markdown code blocks first
      let cleaned = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        plan = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error('[plan/generate] JSON parse error:', e.message, 'Raw:', content.substring(0, 300));
    }

    if (!plan) {
      return res.json({
        raw: true,
        content: content,
        summary: 'AI已生成建议，请查看详情',
        priority_actions: []
      });
    }

    // ── Save plan to user ──
    try {
      const userStore = require('../utils/userStore');
      const plans = typeof user.plans === 'string' ? JSON.parse(user.plans || '{}') : (user.plans || {});
      const planId = 'plan_' + Date.now().toString(36);
      plans[planId] = { ...plan, createdAt: new Date().toISOString(), target_schools, target_major };
      userStore.updatePlans(user.id, plans);
      userStore.setActivePlan(user.id, planId);
    } catch (e) { console.error('[plan/generate] Failed to save plan:', e.message); }

    res.json(plan);
  } catch (err) {
    console.error('[plan/generate] Error:', err);
    res.status(500).json({ error: '生成失败: ' + err.message });
  }
});

// POST /api/plan/generate-pdf — Generate PDF report from active plan
router.post('/generate-pdf', requireAuth, requireStudent, async (req, res) => {
  try {
    const user = req.user;
    const profile = user.profile || {};
    const activePlan = user.activePlan || (user.plans && Object.keys(user.plans)[0]);

    if (!activePlan) {
      return res.status(400).json({ error: '没有找到已生成的升学规划，请先调用 /api/plan/generate' });
    }

    const planData = typeof user.plans === 'string' ? JSON.parse(user.plans || '{}') : (user.plans || {});
    const plan = planData[activePlan];
    if (!plan) {
      return res.status(400).json({ error: '规划数据不存在，请重新生成' });
    }

    // ── Generate PDF ──
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="升学规划_${profile.grade || 'G10'}_${Date.now()}.pdf"`,
        'Content-Length': pdfBuffer.length
      });
      res.end(pdfBuffer);
    });

    const grade = profile.grade || 'G10';
    const curriculum = profile.curriculum || 'AP';
    const targetCountry = profile.target_country || '未设置';

    // ── Header ──
    doc.fontSize(22).fillColor('#1a56db').text('🎓 个性化升学规划报告', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(11).fillColor('#64748b').text(
      `年级: ${grade} | 课程体系: ${curriculum} | 目标国家: ${targetCountry} | 生成日期: ${new Date().toLocaleDateString('zh-CN')}`,
      { align: 'center' }
    );
    doc.moveDown(0.5);
    doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.8);

    // ── Summary ──
    if (plan.summary) {
      doc.fontSize(14).fillColor('#1e40af').text('📋 规划概要', { underline: true });
      doc.moveDown(0.3);
      doc.fontSize(11).fillColor('#1e293b').text(plan.summary, { lineGap: 4 });
      doc.moveDown(0.8);
    }

    // ── Student Profile ──
    if (plan.studentProfile) {
      doc.fontSize(14).fillColor('#1e40af').text('👤 学生画像', { underline: true });
      doc.moveDown(0.3);
      const sp = plan.studentProfile;
      if (sp.strengths && sp.strengths.length) {
        doc.fontSize(10).fillColor('#065f46').text('✅ 优势领域');
        doc.fontSize(10).fillColor('#1e293b').text('  ' + sp.strengths.join('、'), { lineGap: 2 });
      }
      if (sp.areasForImprovement && sp.areasForImprovement.length) {
        doc.moveDown(0.2);
        doc.fontSize(10).fillColor('#dc2626').text('⚠️ 需提升领域');
        doc.fontSize(10).fillColor('#1e293b').text('  ' + sp.areasForImprovement.join('、'), { lineGap: 2 });
      }
      if (sp.personalityFit) {
        doc.moveDown(0.2);
        doc.fontSize(10).fillColor('#7c3aed').text('🧠 性格与专业匹配');
        doc.fontSize(10).fillColor('#1e293b').text('  ' + sp.personalityFit, { lineGap: 2 });
      }
      doc.moveDown(0.8);
    }

    // ── Timeline ──
    if (plan.timeline) {
      doc.fontSize(14).fillColor('#1e40af').text('📅 规划时间线', { underline: true });
      doc.moveDown(0.3);
      const timelineLabels = {
        immediate: '🔴 当前阶段 (1-3个月)',
        nearTerm: '🟡 近期阶段 (3-6个月)',
        mediumTerm: '🟠 中期阶段 (6-12个月)',
        application: '🟢 申请季冲刺'
      };
      for (const [key, label] of Object.entries(timelineLabels)) {
        const phase = plan.timeline[key];
        if (!phase) continue;
        if (doc.y > 700) doc.addPage();
        doc.fontSize(11).fillColor('#1e40af').text(label);
        if (phase.focus) {
          doc.fontSize(10).fillColor('#d4a853').text('  重点: ' + phase.focus);
        }
        if (phase.actions && phase.actions.length) {
          doc.fontSize(10).fillColor('#1e293b');
          phase.actions.forEach((action, i) => {
            doc.text(`  ${i + 1}. ${action}`, { lineGap: 2 });
          });
        }
        if (phase.deadline) {
          doc.fontSize(9).fillColor('#94a3b8').text(`  ⏰ ${phase.deadline}`);
        }
        doc.moveDown(0.4);
      }
    }

    // ── Score Strategy ──
    if (plan.scoreStrategy) {
      if (doc.y > 650) doc.addPage();
      doc.fontSize(14).fillColor('#1e40af').text('📊 成绩提升策略', { underline: true });
      doc.moveDown(0.3);
      const ss = plan.scoreStrategy;
      const examNames = { sat: '📝 SAT', toefl_ielts: '🗣️ 托福/雅思', gpa: '📚 GPA' };
      for (const [exam, data] of Object.entries(ss)) {
        if (!data || !data.actionPlan) continue;
        if (doc.y > 700) doc.addPage();
        doc.fontSize(11).fillColor('#1e40af').text(examNames[exam] || exam);
        doc.fontSize(10).fillColor('#64748b').text(`  当前: ${data.current || '-'} → 目标: ${data.target || '-'}`);
        doc.fontSize(10).fillColor('#1e293b');
        data.actionPlan.forEach((step, i) => {
          doc.text(`  ${i + 1}. ${step}`, { lineGap: 2 });
        });
        doc.moveDown(0.3);
      }
    }

    // ── Competition Plan ──
    if (plan.competitionPlan && plan.competitionPlan.length) {
      if (doc.y > 650) doc.addPage();
      doc.fontSize(14).fillColor('#1e40af').text('🏆 竞赛规划', { underline: true });
      doc.moveDown(0.3);
      plan.competitionPlan.forEach((c, i) => {
        if (doc.y > 720) doc.addPage();
        doc.fontSize(10).fillColor('#1e40af').text(`  ${i + 1}. ${c.name} [${c.level || '-'}]`);
        doc.fontSize(9).fillColor('#64748b').text(
          `     最佳参赛年级: ${c.bestGrade || '-'} | 备赛周期: ${c.prepMonths || '-'} | 申请权重: ${c.weight || '-'}`,
          { lineGap: 2 }
        );
        doc.moveDown(0.2);
      });
    }

    // ── Activity Plan ──
    if (plan.activityPlan) {
      if (doc.y > 650) doc.addPage();
      doc.fontSize(14).fillColor('#1e40af').text('🎯 活动规划', { underline: true });
      doc.moveDown(0.3);
      const ap = plan.activityPlan;
      if (ap.core && ap.core.length) {
        doc.fontSize(11).fillColor('#065f46').text('  核心活动');
        ap.core.forEach(a => {
          doc.fontSize(10).fillColor('#1e293b').text(`  • ${a.activity} (${a.hoursPerWeek}/周) — ${a.why || ''}`, { lineGap: 2 });
        });
      }
      if (ap.supplementary && ap.supplementary.length) {
        doc.moveDown(0.2);
        doc.fontSize(11).fillColor('#7c3aed').text('  辅助活动');
        ap.supplementary.forEach(a => {
          doc.fontSize(10).fillColor('#1e293b').text(`  • ${a.activity} (${a.hoursPerWeek}/周)`, { lineGap: 2 });
        });
      }
    }

    // ── University Roadmap ──
    if (plan.universityRoadmap && plan.universityRoadmap.length) {
      if (doc.y > 600) doc.addPage();
      doc.fontSize(14).fillColor('#1e40af').text('🎓 选校路径', { underline: true });
      doc.moveDown(0.3);
      const tierColor = { '冲刺': '#dc2626', '匹配': '#d4a853', '保底': '#059669' };
      plan.universityRoadmap.forEach((u, i) => {
        if (doc.y > 700) doc.addPage();
        doc.fontSize(11).fillColor(tierColor[u.tier] || '#1e40af').text(`  ${u.tier}: ${u.name}`);
        doc.fontSize(9).fillColor('#64748b').text(`    录取要求: ${u.requirement || '-'}`);
        doc.fontSize(9).fillColor('#64748b').text(`    当前达标: ${u.myStatus || '-'} | 差距: ${u.gap || '-'}`);
        if (u.action) doc.fontSize(9).fillColor('#1e293b').text(`    行动: ${u.action}`);
        doc.moveDown(0.3);
      });
    }

    // ── Risk Points ──
    if (plan.riskPoints && plan.riskPoints.length) {
      if (doc.y > 650) doc.addPage();
      doc.fontSize(14).fillColor('#1e40af').text('⚠️ 风险提示', { underline: true });
      doc.moveDown(0.3);
      plan.riskPoints.forEach((r, i) => {
        if (doc.y > 730) doc.addPage();
        doc.fontSize(10).fillColor('#1e293b').text(`  ${i + 1}. ${r.risk} [可能性: ${r.likelihood || '-'}, 应对: ${r.mitigation || '-'}]`, { lineGap: 2 });
      });
    }

    // ── Key Advice ──
    if (plan.topAdvice && plan.topAdvice.length) {
      if (doc.y > 650) doc.addPage();
      doc.moveDown(0.3);
      doc.fontSize(14).fillColor('#1e40af').text('💡 核心建议', { underline: true });
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor('#1e293b');
      plan.topAdvice.forEach((advice, i) => {
        doc.text(`  ${i + 1}. ${advice}`, { lineGap: 3 });
      });
    }

    // ── Footer ──
    doc.moveDown(1);
    if (doc.y > 750) doc.addPage();
    doc.strokeColor('#e2e8f0').lineWidth(0.5).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.3);
    doc.fontSize(8).fillColor('#94a3b8').text(
      `本报告由 AI 升学规划系统生成 | 数据仅供参考，最终决策请咨询专业升学顾问`,
      { align: 'center' }
    );

    doc.end();
  } catch (err) {
    console.error('[plan/generate-pdf] Error:', err);
    res.status(500).json({ error: 'PDF生成失败: ' + err.message });
  }
});

module.exports = router;
