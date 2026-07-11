const express = require('express');
const fs = require('fs');
const router = express.Router();

const schoolsData = JSON.parse(fs.readFileSync('./data/schools.json', 'utf8'));
const DEEPSEEK_API = 'https://api.deepseek.com/v1/chat/completions';
const MODEL = 'deepseek-chat';

// ─── School Personality Cache ────────────────────────────
let personalityCache = null;
const CACHE_PATH = './data/school-personalities.json';

function loadCache() {
  try {
    personalityCache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch(e) {
    personalityCache = {};
  }
}
loadCache();

function saveCache() {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(personalityCache, null, 2));
}

// ─── Generate Personality via DeepSeek ────────────────────

async function callDeepSeek(messages) {
  const response = await fetch(DEEPSEEK_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.7, max_tokens: 1000, stream: false }),
  });
  if (!response.ok) throw new Error(`DeepSeek ${response.status}`);
  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * Generate school personality: adjectives + strengths + essay preferences
 * Results are cached to avoid repeated API calls.
 */
async function generatePersonality(school) {
  const key = school.name_en;
  if (personalityCache[key]) return personalityCache[key];

  const prompt = `你是一位美国大学招生官。请为以下学校输出JSON（不要markdown，纯JSON）：

{
  "personality": ["形容词1", "形容词2", "形容词3", "形容词4", "形容词5"],
  "strengths": ["优势专业/领域1", "优势专业/领域2", "优势专业/领域3"],
  "essay_preference": "一段话（50字内），描述这所学校偏好什么类型的文书和个人陈述",
  "culture": "一段话（50字内），描述校园文化和学生气质"
}

学校：${school.name_en} (${school.name_cn || ''})
排名档位：${school.tier}
录取率：${school.acceptance_rate}%`;

  try {
    const text = await callDeepSeek([
      { role: 'system', content: '你是一位资深美国大学招生顾问。只输出JSON，不要任何解释文字。' },
      { role: 'user', content: prompt }
    ]);
    
    // Clean JSON
    const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonStr);
    
    // Validate
    if (!parsed.personality || !Array.isArray(parsed.personality)) parsed.personality = ['学术严谨'];
    if (!parsed.strengths || !Array.isArray(parsed.strengths)) parsed.strengths = ['综合性强'];
    if (parsed.personality.length > 8) parsed.personality = parsed.personality.slice(0, 8);
    
    personalityCache[key] = parsed;
    saveCache();
    return parsed;
  } catch(e) {
    console.error(`Personality gen failed for ${school.name_en}:`, e.message);
    // Fallback: tier-based estimation
    const fallback = tierFallback(school.tier);
    personalityCache[key] = fallback;
    saveCache();
    return fallback;
  }
}

function tierFallback(tier) {
  const map = {
    'T5': { personality: ['精英','学术顶尖','思想先锋','竞争激烈','多元包容'], 
            strengths: ['综合学术','研究','领导力'], 
            essay_preference: '偏好深度思考、独特视角、领导力的文书', 
            culture: '高度竞争又多元包容的精英社区' },
    'T10': { personality: ['学术卓越','创新','协作','社会关怀'],
            strengths: ['跨学科','研究','公共服务'],
            essay_preference: '看重真实故事、社会责任感、学术热情',
            culture: '学术与人文并重的创新社区' },
    'T15': { personality: ['学术扎实','务实','职业导向','社区氛围'],
            strengths: ['应用学科','职业培训','研究'],
            essay_preference: '偏好务实、目标明确、有实践经历的文书',
            culture: '学术与职业发展平衡的实干社区' },
    'T20': { personality: ['全面发展','活力','传统','开放'],
            strengths: ['通识教育','社科','人文'],
            essay_preference: '看重全面性、个人成长、社区参与',
            culture: '传统与创新并存的活跃校园' },
    'T25': { personality: ['进取','专业导向','实践','多元'],
            strengths: ['专业学科','实习资源','研究'],
            essay_preference: '偏好专业明确、有实习/项目经验的文书',
            culture: '专业导向、注重实践的多元社区' },
    'T30': { personality: ['务实','包容','成长型','社区感'],
            strengths: ['特色专业','职业发展','社区服务'],
            essay_preference: '看重成长故事、韧性、目标驱动力',
            culture: '包容务实、鼓励成长的社区' },
  };
  return map[tier] || { personality: ['学术'], strengths: ['综合'], essay_preference: '通用', culture: '学术社区' };
}

// ─── Endpoints ────────────────────────────────────────────

// GET /api/schools/personality — get all school personalities (cached)
router.get('/personality', async (req, res) => {
  try {
    const schools = req.query.school ? 
      schoolsData.filter(s => s.name_en === req.query.school) :
      schoolsData;

    const results = {};
    for (const s of schools) {
      const key = s.name_en;
      if (!personalityCache[key]) {
        // Lazy generate (non-blocking per request; first call may be slow)
        try {
          await generatePersonality(s);
        } catch(e) {}
      }
      if (personalityCache[key]) {
        results[key] = { ...personalityCache[key], tier: s.tier, name_cn: s.name_cn };
      }
    }

    res.json({ success: true, count: Object.keys(results).length, schools: results });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/schools/personality/generate — batch generate (async, returns immediately)
router.post('/personality/generate', async (req, res) => {
  res.json({ success: true, message: '批量生成已启动，完成后自动缓存。可通过 GET /api/schools/personality 查看结果。' });
  
  // Fire and forget
  for (const s of schoolsData) {
    if (!personalityCache[s.name_en]) {
      try {
        await generatePersonality(s);
      } catch(e) {
        console.error(`Failed to generate for ${s.name_en}`);
      }
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    }
  }
  console.log('All school personalities generated!');
});

module.exports = router;
