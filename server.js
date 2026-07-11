const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// ─── Shared Database (for new routes) ───────────────────
const db = new Database(path.join(__dirname, 'data', 'app.db'));
db.pragma('journal_mode = WAL');

// ─── Config ─────────────────────────────────────────────
const PORT = process.env.PORT || 3004;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.resolve(__dirname, 'public'), {
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
}));

// ─── Load Data ──────────────────────────────────────────
const mbtiData        = JSON.parse(fs.readFileSync('./data/mbti-majors.json', 'utf8'));
const hollandData     = JSON.parse(fs.readFileSync('./data/holland-majors.json', 'utf8'));
const schoolsData     = JSON.parse(fs.readFileSync('./data/schools.json', 'utf8'));
const scoreTiers      = JSON.parse(fs.readFileSync('./data/score-tiers.json', 'utf8'));
const majorsData      = JSON.parse(fs.readFileSync('./data/major-details.json', 'utf8'));

const US_TIER_ORDER = ['T5', 'T10', 'T15', 'T20', 'T25', 'T30'];
const UK_TIER_ORDER = ['T_UK1', 'T_UK2', 'T_UK3', 'T_UK4', 'T_UK5', 'T_UK6'];

// ─── Auth & Cache Middleware ─────────────────────────────
const { requireAuth, optionalAuth } = require('./middleware/auth');
const { cacheRecommend } = require('./middleware/cacheRecommend');

// ─── Routes ─────────────────────────────────────────────
const authRoutes     = require('./routes/auth');
const cacheRoutes    = require('./routes/cache');
const chatRoutes     = require('./routes/chat');
const academicRoutes = require('./routes/academic');
const parentRoutes   = require('./routes/parent');
const timelineRoutes = require('./routes/timeline');
const planRoutes = require('./routes/plan');
const planningRoutes = require('./routes/planning');
const adminRoutes = require('./routes/admin');
const pipelineRoutes = require('./routes/pipeline');
const activityRoutes = require('./routes/activities');
const matchRoutes = require('./routes/match');
const schoolRoutes = require('./routes/schools');
const studentDataRoutes = require('./routes/studentData');
const planArchiveRoutes = require('./routes/planArchive');

// Mount routes

// ========== COOKIE DEBUG MIDDLEWARE ==========
app.use((req, res, next) => {
  if (req.path === '/student.html' || req.path === '/api/auth/me') {
    const now = new Date().toISOString().slice(11,19);
    const hasCookie = !!req.headers.cookie;
    const tokenCookie = hasCookie ? (req.headers.cookie.match(/student_token=([^;]*)/) || [])[1] : null;
    console.log(`[${now}] CDBG ${req.path} | cookie=${hasCookie} | tokLen=${tokenCookie ? tokenCookie.length : 0}`);
  }
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/cache', cacheRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/academic', academicRoutes);
app.use('/api/parent', parentRoutes);
app.use('/api/plan', planRoutes);
app.use('/api/planning', planningRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/pipeline', pipelineRoutes);
app.use('/api/activities', activityRoutes);
app.use("/api/match", matchRoutes);
app.use("/api/schools", schoolRoutes);
app.use('/api/timeline', timelineRoutes);
app.use('/api/student', studentDataRoutes);
app.use('/api/plans', planArchiveRoutes);

app.locals.db = db;

// ─── Helpers ─────────────────────────────────────────────

function findMbti(mbti) {
  return mbtiData.find(m => m.mbti === mbti.toUpperCase());
}

function findHolland(code) {
  return hollandData.find(h => h.holland === code.toUpperCase());
}

// Get predicted SAT score: current_score + months_left * avg_gain
function predictScore(currentScore, grade) {
  const pred = scoreTiers.score_predictions.sat;
  const gradeInfo = pred.current_grade_to_months[grade];
  if (!gradeInfo) return { predicted: currentScore, months_left: 0, confidence: 'low' };
  const monthsLeft = gradeInfo.months_left;
  const predicted = Math.min(1600, Math.round(currentScore + monthsLeft * gradeInfo.avg_monthly_gain));
  return {
    current: currentScore,
    predicted: predicted,
    months_left: monthsLeft,
    potential_gain: Math.max(0, predicted - currentScore),
    avg_monthly_gain: gradeInfo.avg_monthly_gain,
    notes: gradeInfo.notes,
    confidence: monthsLeft >= 12 ? 'high' : monthsLeft >= 6 ? 'medium' : 'low'
  };
}

// Convert A-Level predicted grades to equivalent SAT
function aLevelToSat(alevelInput) {
  // alevelInput: e.g. "A*A*A", "AAA", "AAB"
  const map = scoreTiers.score_predictions.uk_correlation.a_level_to_us;
  const match = map.find(m => m.a_level === alevelInput.toUpperCase());
  if (match) {
    const [lowSat] = match.sat_equivalent.split('+').map(Number);
    return { sat_equivalent: match.sat_equivalent, tier: match.tier, sat_numeric: lowSat || 1500 };
  }
  return { sat_equivalent: "1400+", tier: "T_UK6", sat_numeric: 1450 };
}

// Convert IB score to equivalent SAT
function ibToSat(ibScore) {
  const map = scoreTiers.score_predictions.uk_correlation.ib_to_us;
  const match = map.find(m => {
    const [low, high] = m.ib_score.split('-').map(Number);
    return ibScore >= (low || 40) && ibScore <= (high || 45);
  }) || map[map.length - 1];
  const [lowSat] = match.sat_equivalent.split('+').map(Number);
  return { sat_equivalent: match.sat_equivalent, tier: match.tier, sat_numeric: lowSat || 1450 };
}

// Determine school tier based on SAT score
function satToTier(sat) {
  for (const t of US_TIER_ORDER) {
    const info = scoreTiers.tiers[t];
    const [low, high] = info.sat_range.split('-').map(Number);
    if (sat >= low) return t;
  }
  return 'T30';
}

// Determine UK tier based on A-Level score
function aLevelToUkTier(alevel) {
  const map = scoreTiers.score_predictions.uk_correlation.a_level_to_us;
  const match = map.find(m => m.a_level === alevel.toUpperCase()) || { tier: "T_UK6" };
  return match.tier;
}

function ibToUkTier(ibScore) {
  const map = scoreTiers.score_predictions.uk_correlation.ib_to_us;
  const match = map.find(m => {
    const [low, high] = m.ib_score.split('-').map(Number);
    return ibScore >= (low || 40) && ibScore <= (high || 45);
  }) || { tier: "T_UK6" };
  return match.tier;
}

function toeflToSat(toefl) {
  const map = scoreTiers.score_predictions.sat.toefl_correlation;
  for (const [range, data] of Object.entries(map)) {
    const [low, high] = range.split('-').map(Number);
    if (toefl >= (low || 120)) return parseInt(data.sat_equivalent);
  }
  return 1350;
}

/**
 * Recommend schools by tier, optionally filtered by country
 */
function recommendSchools(tier, mbtiCode, country) {
  const isUk = tier && tier.startsWith('T_UK');
  const tierOrder = isUk ? UK_TIER_ORDER : US_TIER_ORDER;
  const tierIndex = tierOrder.indexOf(tier);
  const mbtiInfo = findMbti(mbtiCode);
  
  // Default to US schools if no valid tier
  const effectiveTierOrder = tierIndex >= 0 ? tierOrder : US_TIER_ORDER;
  const effectiveTierIndex = tierIndex >= 0 ? tierIndex : 5;
  const effectiveTier = tierIndex >= 0 ? tier : 'T30';
  const isUkMode = effectiveTier.startsWith('T_UK');
  
  // Build pools based on tier index
  let reachTiers, targetTiers, safetyTiers;
  
  if (effectiveTierIndex <= 1) {
    reachTiers = [effectiveTierOrder[0]];
    targetTiers = [effectiveTierOrder[1], effectiveTierOrder[2]];
    safetyTiers = [effectiveTierOrder[3], effectiveTierOrder[4], effectiveTierOrder[5]];
  } else if (effectiveTierIndex >= 4) {
    reachTiers = [effectiveTierOrder[effectiveTierIndex - 2], effectiveTierOrder[effectiveTierIndex - 1]];
    targetTiers = [effectiveTier];
    safetyTiers = effectiveTierIndex < effectiveTierOrder.length - 1 
      ? [effectiveTierOrder[effectiveTierIndex + 1]]
      : []; // No lower tier — will populate from remaining schools
  } else {
    reachTiers = [effectiveTierOrder[effectiveTierIndex - 1]];
    targetTiers = [effectiveTier];
    safetyTiers = [effectiveTierOrder[effectiveTierIndex + 1]];
  }
  
  let reach = [], target = [], safety = [];
  
  schoolsData.forEach(s => {
    // Filter by country if specified
    if (country === 'UK' && s.country !== 'UK') return;
    if (country === 'US' && s.country === 'UK') return;
    // If neither specified, prefer matching country mode
    if (!country && !isUkMode && s.country === 'UK') return;
    if (!country && isUkMode && s.country !== 'UK') return;
    
    const st = s.tier;
    // For UK schools, check mbti_fit array; for US, use fit_school_tiers
    let pFit = false;
    if (s.mbti_fit && Array.isArray(s.mbti_fit)) {
      pFit = s.mbti_fit.includes(mbtiCode);
    } else if (mbtiInfo && mbtiInfo.fit_school_tiers) {
      pFit = mbtiInfo.fit_school_tiers.includes(st);
    }
    
    if (reachTiers.includes(st)) reach.push({ ...s, match_type: 'reach', personality_fit: pFit });
    else if (targetTiers.includes(st)) target.push({ ...s, match_type: 'target', personality_fit: pFit });
    else if (safetyTiers.includes(st)) safety.push({ ...s, match_type: 'safety', personality_fit: pFit });
  });
  
  const sortSchools = (arr, isUkMode) => arr.sort((a, b) => {
    if (a.personality_fit !== b.personality_fit) return a.personality_fit ? -1 : 1;
    if (isUkMode) {
      // For UK schools, sort by acceptance rate (lower = harder)
      return (a.acceptance_rate || 100) - (b.acceptance_rate || 100);
    }
    return (a.sat_low || 1500) - (b.sat_low || 1500);
  });
  
  // Filter out schools that lack key data
  const filterValid = (arr) => arr.filter(s => s.name_en && s.name_cn);
  
  let reachSorted = sortSchools(filterValid(reach), isUkMode).slice(0, 3);
  let targetSorted = sortSchools(filterValid(target), isUkMode).slice(0, 3);
  let safetySorted = sortSchools(filterValid(safety), isUkMode).slice(0, 3);
  
  // Safety net: if safety is empty, populate from remaining non-reach/non-target schools
  if (safetySorted.length === 0) {
    const usedSet = new Set([...reachSorted, ...targetSorted].map(s => s.name_en));
    const pool = schoolsData.filter(s => {
      if (country === 'UK' && s.country !== 'UK') return false;
      if (country === 'US' && s.country === 'UK') return false;
      if (!country && !isUkMode && s.country === 'UK') return false;
      if (!country && isUkMode && s.country !== 'UK') return false;
      if (usedSet.has(s.name_en)) return false;
      return true;
    });
    // Safety: pick from remaining schools with highest acceptance rate (easiest)
    // Then sort by personality fit (prefer matching MBTI)
    const sorted = [...pool].sort((a, b) => {
      const aFit = a.mbti_fit && Array.isArray(a.mbti_fit) && a.mbti_fit.includes(mbtiCode) ? 1 : 0;
      const bFit = b.mbti_fit && Array.isArray(b.mbti_fit) && b.mbti_fit.includes(mbtiCode) ? 1 : 0;
      if (aFit !== bFit) return bFit - aFit; // fit first
      return (b.acceptance_rate || 0) - (a.acceptance_rate || 0); // then easiest
    });
    safetySorted = sorted.slice(0, 3).map(s => ({ ...s, match_type: 'safety', personality_fit: s.mbti_fit && Array.isArray(s.mbti_fit) && s.mbti_fit.includes(mbtiCode) }));
  }
  
  return {
    reach: reachSorted,
    target: targetSorted,
    safety: safetySorted,
    tier_system: isUkMode ? 'UK (A-Level/IB)' : 'US (SAT/ACT)'
  };
}

// ─── Routes ──────────────────────────────────────────────

/**
 * POST /api/recommend
 * 
 * Body (US-oriented):
 *   mbti, holland, holland_secondary, sat, act, toefl, grade, target_country
 * 
 * Body (UK-oriented):
 *   mbti, holland, holland_secondary, a_level, ib_score, ielts, grade, target_country: "UK"
 *   (a_level can be like "A*A*A" or "AAA")
 * 
 * Supports optional auth; when authenticated, results are cached per user.
 */
app.post('/api/recommend', optionalAuth, cacheRecommend, (req, res) => {
  try {
    const { 
      mbti, holland, holland_secondary, 
      sat, act, toefl, 
      a_level, ib_score, ielts,
      grade, target_country 
    } = req.body;
    
    if (!mbti || !holland || !grade) {
      return res.status(400).json({ error: '缺少必填字段: mbti, holland, grade' });
    }
    
    const isUk = target_country === 'UK';
    
    // 1. MBTI → Major recommendations
    const mbtiInfo = findMbti(mbti);
    const hollandInfo = findHolland(holland);
    const hollandSecondaryInfo = holland_secondary ? findHolland(holland_secondary) : null;
    
    // 2. Combine MBTI + Holland to find best-fit majors
    let recommendedMajors = [];
    if (mbtiInfo) {
      mbtiInfo.majors.forEach(m => {
        const detail = majorsData.find(md => md.name.includes(m.slice(0, 2)));
        recommendedMajors.push({
          name: m,
          detail: detail ? createMajorDetailView(detail, isUk) : null,
          source: 'MBTI',
          match_score: 1.0
        });
      });
    }
    
    if (hollandInfo) {
      hollandInfo.majors.forEach(m => {
        const existing = recommendedMajors.findIndex(r => r.name === m);
        if (existing >= 0) {
          recommendedMajors[existing].source = 'MBTI+Holland';
          recommendedMajors[existing].match_score = 1.5;
        } else {
          const detail = majorsData.find(md => md.name.includes(m.slice(0, 2)));
          recommendedMajors.push({
            name: m,
            detail: detail ? createMajorDetailView(detail, isUk) : null,
            source: 'Holland',
            match_score: 0.8
          });
        }
      });
    }
    
    recommendedMajors.sort((a, b) => b.match_score - a.match_score);
    
    // 3. Score calculation & prediction
    let effectiveScore, currentTier, predictedTier, prediction, ukTierInfo;
    
    if (isUk) {
      // UK path: use A-Level or IB
      if (a_level) {
        const ukScore = aLevelToSat(a_level);
        effectiveScore = ukScore.sat_numeric;
        const ukTier = aLevelToUkTier(a_level);
        currentTier = ukTier;
        predictedTier = ukTier; // A-Level predicted → tier
        ukTierInfo = { a_level: a_level, sat_equivalent: ukScore.sat_equivalent, tier: ukTier };
      } else if (ib_score) {
        const ukScore = ibToSat(ib_score);
        effectiveScore = ukScore.sat_numeric;
        const ukTier = ibToUkTier(ib_score);
        currentTier = ukTier;
        predictedTier = ukTier;
        ukTierInfo = { ib_score: ib_score, sat_equivalent: ukScore.sat_equivalent, tier: ukTier };
      } else {
        // Fall back to SAT if provided
        effectiveScore = sat || 1400;
        currentTier = 'T_UK4';
        predictedTier = 'T_UK4';
      }
      
      // For UK, we also show SAT-based score prediction
      prediction = predictScore(effectiveScore, grade);
      
    } else {
      // US path: SAT/ACT/TOEFL
      effectiveScore = sat || (act ? Math.round(act * 44) : null) || (toefl ? toeflToSat(toefl) : null) || 1400;
      currentTier = satToTier(effectiveScore);
      prediction = predictScore(effectiveScore, grade);
      predictedTier = satToTier(prediction.predicted);
    }
    
    // 4. School recommendations (country-specific)
    const schoolTier = isUk ? (predictedTier || 'T_UK4') : predictedTier;
    const schoolRecs = recommendSchools(schoolTier, mbti, isUk ? 'UK' : 'US');
    
    // 5. Country-specific info
    const countryInfo = scoreTiers.country_sat_equivalents[target_country] || 
                        scoreTiers.country_sat_equivalents['US'];
    
    // 6. Resource recommendations
    const resources = buildResources(recommendedMajors, predictedTier || 'T30', grade, isUk);
    
    // Build response
    const response = {
      profile: {
        mbti: mbtiInfo ? { type: mbtiInfo.mbti, nickname: mbtiInfo.nickname, traits: mbtiInfo.traits } : { type: mbti },
        holland: hollandInfo ? { code: hollandInfo.holland, type: hollandInfo.type, keywords: hollandInfo.keywords } : { code: holland },
        holland_secondary: hollandSecondaryInfo ? { code: hollandSecondaryInfo.holland, type: hollandSecondaryInfo.type } : null,
        target_country: countryInfo
      },
      score_input: isUk
        ? { a_level: a_level || null, ib: ib_score || null, toefl: toefl || null, ielts: ielts || null }
        : { sat: sat || null, act: act || null, toefl: toefl || null },
      score_prediction: isUk
        ? {
            uk_tier: ukTierInfo || null,
            sat_equivalent: effectiveScore,
            sat_prediction: {
              current: prediction.current,
              predicted: prediction.predicted,
              months_left: prediction.months_left,
              potential_gain: prediction.potential_gain
            },
            current_tier: currentTier,
            predicted_tier: predictedTier,
            tier_label: (scoreTiers.tiers[predictedTier] || {}).label || predictedTier
          }
        : {
            current: prediction.current,
            predicted: prediction.predicted,
            months_left: prediction.months_left,
            potential_gain: prediction.potential_gain,
            avg_monthly_gain: prediction.avg_monthly_gain,
            current_tier: currentTier,
            predicted_tier: predictedTier,
            notes: prediction.notes
          },
      school_recommendations: schoolRecs,
      major_recommendations: recommendedMajors.slice(0, 5),
      resources: resources
    };
    
    if (req.user) {
      res.json({ ...response, user_id: req.user.id });
    } else {
      res.json(response);
    }
    
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '服务异常', detail: err.message });
  }
});

function createMajorDetailView(detail, isUk) {
  return {
    id: detail.id,
    name: detail.name,
    category: detail.category,
    content: detail.content,
    ap_suggested: detail.ap_suggested,
    ib_suggested: detail.ib_suggested,
    alevel_suggested: detail.alevel_suggested,
    top_schools: isUk ? (detail.top_schools_uk || detail.top_schools) : detail.top_schools,
    salary_range: detail.salary_range,
    demand: detail.demand
  };
}

function buildResources(majors, tier, grade, isUk) {
  const resources = [];
  
  // Score-based resources
  const tierInfo = scoreTiers.tiers[tier] || { label: '目标院校' };
  
  if (isUk) {
    resources.push({
      category: 'UK申请准备',
      items: [
        { title: '英国本科申请全攻略', type: '笔记', link: '[[英国本科申请全攻略]]' },
        { title: '牛剑面试通关指南', type: '笔记', link: '[[牛剑面试通关指南]]' },
        { title: `目标 ${tierInfo.label}`, type: '目标', link: null }
      ]
    });
  } else {
    resources.push({
      category: '标化备考',
      items: [
        { title: '标化考试备考策略与时间规划', type: '笔记', link: '[[标化考试备考策略与时间规划]]' },
        { title: `目标 ${tierInfo.label}: SAT ${tierInfo.sat_range || ''}`, type: '目标', link: null }
      ]
    });
  }
  
  // Grade-based resources
  const gradeResources = {
    'G9': [{ title: '国际学校升学四年规划', type: '笔记', link: '[[国际学校升学四年规划]]' }],
    'G10': [{ title: '多国混申策略指南', type: '笔记', link: '[[多国混申策略指南]]' }],
    'G11': [{ title: '背景提升与暑期规划深度指南', type: '笔记', link: '[[背景提升与暑期规划深度指南]]' }],
    'G12': [{ title: isUk ? '英国本科申请全攻略' : '美国本科申请全攻略', type: '笔记', link: isUk ? '[[英国本科申请全攻略]]' : '[[美国本科申请全攻略]]' }]
  };
  
  if (gradeResources[grade]) {
    resources.push({ category: '当前阶段', items: gradeResources[grade] });
  }
  
  // Knowledge base resources
  const kbResources = [
    { title: '热门留学专业深度解析与选专业指南', type: '笔记', link: '[[热门留学专业深度解析与选专业指南]]' },
    { title: '人格特性与兴趣爱好对升学专业选择的影响', type: '笔记', link: '[[人格特性与兴趣爱好对升学专业选择的影响]]' }
  ];
  if (isUk) {
    kbResources.push(
      { title: '英国名校招生规则', type: '笔记', link: '[[英国名校招生规则]]' },
      { title: '多国混申策略指南', type: '笔记', link: '[[多国混申策略指南]]' }
    );
  }
  resources.push({ category: '知识库参考', items: kbResources });
  
  return resources;
}

// GET /api/majors - List all majors (with optional country filter)
app.get('/api/majors', (req, res) => {
  const country = req.query.country;
  res.json(majorsData.map(m => ({
    id: m.id,
    name: m.name,
    category: m.category,
    demand: m.demand,
    salary_range: m.salary_range,
    top_schools: country === 'uk' ? (m.top_schools_uk || m.top_schools) : m.top_schools,
    top_schools_uk: m.top_schools_uk || null
  })));
});

// GET /api/schools - List all schools with country filter
app.get('/api/schools', (req, res) => {
  const country = req.query.country; // 'US', 'UK', or empty = all
  let filtered = schoolsData;
  if (country === 'US') filtered = schoolsData.filter(s => !s.country || s.country === 'US');
  if (country === 'UK') filtered = schoolsData.filter(s => s.country === 'UK');
  
  res.json(filtered.map(s => ({
    name_en: s.name_en,
    name_cn: s.name_cn,
    tier: s.tier,
    country: s.country || 'US',
    sat_range: s.sat_range || null,
    act_range: s.act_range || null,
    a_level_range: s.a_level_range || null,
    ib_range: s.ib_range || null,
    ielts_range: s.ielts_range || null,
    acceptance_rate: s.acceptance_rate,
    strengths: s.strengths || null,
    ranking_qs_2025: s.ranking_qs_2025 || null
  })));
});

// GET /api/mbti-list
app.get('/api/mbti-list', (req, res) => {
  res.json(mbtiData.map(m => ({ mbti: m.mbti, nickname: m.nickname, traits: m.traits, majors: m.majors })));
});

// Health check
app.get('/api/health', (req, res) => {
  const usCount = schoolsData.filter(s => !s.country || s.country === 'US').length;
  const ukCount = schoolsData.filter(s => s.country === 'UK').length;
  res.json({ 
    status: 'ok', 
    schools: { total: schoolsData.length, us: usCount, uk: ukCount },
    majors: majorsData.length,
    uk_data: {
      tiers_available: UK_TIER_ORDER.map(t => scoreTiers.tiers[t].label),
      a_level_mapping: scoreTiers.score_predictions.uk_correlation?.a_level_to_us?.length || 0,
      ib_mapping: scoreTiers.score_predictions.uk_correlation?.ib_to_us?.length || 0
    }
  });
});

app.get("/parent", (req, res) => res.sendFile('parent.html', { root: path.join(__dirname, 'public') }));
app.get("/student", (req, res) => res.sendFile('student.html', { root: path.join(__dirname, 'public') }));
app.get("/admin", (req, res) => res.sendFile('admin.html', { root: path.join(__dirname, 'public') }));
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎯 升学规划API运行中: http://localhost:${PORT}`);
  console.log(`   POST /api/recommend  → 升学推荐 (支持 US/UK)`);
  console.log(`   POST /api/auth/register  → 用户注册`);
  console.log(`   POST /api/auth/login     → 用户登录`);
  console.log(`   GET  /api/auth/me        → 获取用户信息 (需登录)`);
  console.log(`   PUT  /api/auth/me        → 更新升学档案 (需登录)`);
  console.log(`   GET  /api/cache/stats    → 查看缓存状态 (需登录)`);
  console.log(`   GET  /api/majors         → 专业列表`);
  console.log(`   GET  /api/schools        → 学校列表`);
  console.log(`   GET  /api/mbti-list      → MBTI映射`);
  console.log(`   POST /api/chat           → 💬 升学百科 (LLM+知识库)`);
  console.log(`   GET  /api/academic       → 📊 学业跟踪 (需登录)`);
  console.log(`   GET  /api/parent/dashboard   → 🏠 家长端看板 (需家长登录)`);
  console.log(`   GET  /api/parent/applications → 📋 申请状态 (需家长登录)`);
  console.log(`   GET  /api/parent/scores       → 📈 成绩趋势 (需家长登录)`);
  console.log(`   GET  /api/parent/documents    → 📁 合同报告 (需家长登录)`);
  console.log(`   POST /api/parent/feedback     → 💬 家长反馈 (需家长登录)`);
  console.log(`   GET  / (浏览器)           → 登录注册页面`);
});

// ═══════════ COOKIE DEBUG MIDDLEWARE ═══════════
app.use((req, res, next) => {
  if (req.path === '/student.html' || req.path === '/api/auth/me') {
    const now = new Date().toISOString().slice(11,19);
    const hasCookie = !!req.headers.cookie;
    const tokenCookie = hasCookie ? (req.headers.cookie.match(/student_token=([^;]*)/) || [])[1] : null;
    console.log();
  }
  next();
});
