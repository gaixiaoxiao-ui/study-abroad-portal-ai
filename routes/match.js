const express = require('express');
const fs = require('fs');
const { requireAuth } = require('../middleware/auth');
const userStore = require('../utils/userStore');

const router = express.Router();
const schoolsData = JSON.parse(fs.readFileSync('./data/schools.json', 'utf8'));

// ─── GPA Normalization ───────────────────────────────────

/**
 * Normalize GPA to a 0-100 percentile rank.
 * Supports: 4.0 scale, 5.0 scale (AP/IB weighted), 100-point scale, percentile strings.
 */
function normalizeGPA(raw) {
  if (!raw && raw !== 0) return null;
  const val = typeof raw === 'string' ? parseFloat(raw.replace('%', '')) : raw;
  if (isNaN(val)) return null;

  // Already a percentile (e.g. "前10%", "15%")
  if (typeof raw === 'string' && raw.includes('%') && val <= 100 && val >= 1) {
    return val; // 前10% → 10 (lower is better)
  }

  // 100-point scale (e.g. 92/100, 88)
  if (val > 10 && val <= 100) {
    // Rough mapping: 95→top3%, 90→top10%, 85→top20%, 80→top35%, 75→top50%, 70→top65%
    if (val >= 95) return 3;
    if (val >= 90) return 10;
    if (val >= 85) return 20;
    if (val >= 80) return 35;
    if (val >= 75) return 50;
    return 65;
  }

  // 5.0 scale (AP weighted)
  if (val > 4.0 && val <= 5.0) {
    // 5.0→top2%, 4.5→top10%, 4.0→top25%, 3.5→top50%
    if (val >= 5.0) return 2;
    if (val >= 4.5) return 10;
    if (val >= 4.0) return 25;
    if (val >= 3.5) return 50;
    return 65;
  }

  // 4.0 scale (unweighted)
  if (val <= 4.0) {
    if (val >= 3.9) return 5;
    if (val >= 3.7) return 15;
    if (val >= 3.5) return 25;
    if (val >= 3.3) return 40;
    if (val >= 3.0) return 55;
    return 70;
  }

  return null;
}

// ─── Sigmoid SAT Match ───────────────────────────────────

/**
 * Core sigmoid-based SAT match score (0-100).
 * 
 * Design:
 * - Sweet spot: within [sat_low, sat_high] → 70-95% (sigmoid climb)
 * - Above high: diminishing returns → 95-98%
 * - Below low: soft landing → 40-70% then exponential decay
 * 
 * Real admissions logic: being in the range matters more than being above it.
 * Schools yield-protect obvious over-qualifiers. Margin matters less at extremes.
 */
function satMatchScore(studentSAT, schoolSATLow, schoolSATHigh) {
  if (!studentSAT || !schoolSATLow || !schoolSATHigh) return null;
  if (studentSAT <= 0 || schoolSATLow <= 0) return null;

  const range = schoolSATHigh - schoolSATLow;
  const mid = (schoolSATLow + schoolSATHigh) / 2;

  if (studentSAT >= schoolSATLow && studentSAT <= schoolSATHigh) {
    // ── Sweet Spot: Sigmoid within range ──
    // k=6 controls steepness; higher k = steeper transition at midpoint
    const k = 6;
    const normalized = (studentSAT - schoolSATLow) / range; // 0-1
    const sigmoid = 1 / (1 + Math.exp(-k * (normalized - 0.5)));
    // Map to 70-95
    return Math.round(70 + sigmoid * 25);
  }

  if (studentSAT > schoolSATHigh) {
    // ── Above range: diminishing returns ──
    const overflow = (studentSAT - schoolSATHigh) / (1600 - schoolSATHigh);
    // Soft cap at 98
    return Math.min(98, Math.round(95 + overflow * 3));
  }

  // ── Below range ──
  const gap = schoolSATLow - studentSAT;
  if (gap <= 100) {
    // Soft landing zone: sigmoid from 40 to 70
    const k = 5;
    const normalized = 1 - (gap / 100); // 1 at low, 0 at low-100
    const sigmoid = 1 / (1 + Math.exp(-k * (normalized - 0.5)));
    return Math.round(40 + sigmoid * 30);
  }

  // Exponential decay below low-100
  const excess = gap - 100;
  const decay = Math.exp(-excess / 80); // e^(-1) at gap=180 → ~30%
  return Math.max(15, Math.round(40 * decay));
}

// ─── GPA Match Score ─────────────────────────────────────

function gpaMatchScore(studentGPAPercentile, school) {
  if (!studentGPAPercentile) return null;

  // Estimate school's expected GPA percentile from tier
  const tierGPAMap = {
    'T5': 5,    // top 5%
    'T10': 10,
    'T15': 15,
    'T20': 20,
    'T25': 25,
    'T30': 35,
    'T_UK1': 8,
    'T_UK2': 18,
    'T_UK3': 30,
    'T_UK4': 45,
    'T_UK5': 60,
    'T_UK6': 75,
  };

  const expected = tierGPAMap[school.tier] || 40;
  
  if (studentGPAPercentile <= expected) {
    // Student is in the expected range or better
    const ratio = studentGPAPercentile / expected;
    return Math.round(70 + (1 - ratio) * 28); // 70-98
  }

  // Below expected → decay
  const excess = studentGPAPercentile - expected;
  const decay = Math.exp(-excess / 20);
  return Math.max(25, Math.round(70 * decay));
}

// ─── Combined Score ──────────────────────────────────────

/**
 * Combined match score: SAT (55%) + GPA (35%) + data_completeness (10%)
 * Multiplicative penalty if one dimension is severely lacking.
 */
function combinedScore(satScore, gpaScore) {
  const wSAT = 0.55;
  const wGPA = 0.35;
  const wData = 0.10;

  let total = 0;
  let weight = 0;

  if (satScore !== null) { total += satScore * wSAT; weight += wSAT; }
  if (gpaScore !== null) { total += gpaScore * wGPA; weight += wGPA; }

  // Data completeness bonus
  if (satScore !== null && gpaScore !== null) {
    total += 10 * wData; // full data → +10
    weight += wData;
  } else if (satScore !== null || gpaScore !== null) {
    total += 5 * wData; // partial data → +5
    weight += wData / 2;
  }

  const base = weight > 0 ? total / weight : 50;

  // Multiplicative penalty: if either dimension < 30, cap at 50
  if ((satScore !== null && satScore < 30) || (gpaScore !== null && gpaScore < 30)) {
    return Math.min(50, Math.round(base));
  }

  return Math.round(base);
}

// ─── Main Endpoint ──────────────────────────────────────

// POST /api/match/schools
// Body: { sat, gpa, gpa_scale: "4.0"|"5.0"|"100"|"percentile", country: "US"|"UK"|"all" }
router.post('/schools', requireAuth, (req, res) => {
  try {
    const { sat, gpa, gpa_scale, country } = req.body;
    
    const gpaNorm = normalizeGPA(gpa_scale === 'percentile' ? `${gpa}%` : gpa);
    
    const results = schoolsData
      .filter(s => {
        if (country === 'US') return s.country !== 'UK';
        if (country === 'UK') return s.country === 'UK';
        return true; // all
      })
      .map(school => {
        const satScore = satMatchScore(sat, school.sat_low, school.sat_high);
        const gpaScore = gpaNorm !== null ? gpaMatchScore(gpaNorm, school) : null;
        const score = combinedScore(satScore, gpaScore);
        
        return {
          name_en: school.name_en,
          name_cn: school.name_cn,
          tier: school.tier,
          country: school.country || 'US',
          acceptance_rate: school.acceptance_rate,
          sat_low: school.sat_low,
          sat_high: school.sat_high,
          match_score: score,
          sat_score: satScore,
          gpa_score: gpaScore,
          match_level: score >= 85 ? 'safety' : score >= 70 ? 'match' : score >= 50 ? 'reach' : 'far_reach',
          strengths: school.strengths || null,
          mbti_fit: school.mbti_fit || null,
        };
      })
      .sort((a, b) => b.match_score - a.match_score);

    res.json({ 
      success: true, 
      count: results.length,
      params: { sat, gpa, gpa_scale: gpa_scale || 'auto', country: country || 'all' },
      schools: results 
    });
  } catch (err) {
    console.error('Match error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/match/schools/:name — single school match detail
router.get('/schools/:name', (req, res) => {
  try {
    const sat = parseInt(req.query.sat) || 0;
    const gpa = parseFloat(req.query.gpa) || 0;
    const gpa_scale = req.query.gpa_scale || 'auto';

    const school = schoolsData.find(s => 
      s.name_en === req.params.name || 
      s.name_en === decodeURIComponent(req.params.name)
    );
    if (!school) return res.status(404).json({ error: 'School not found' });

    const gpaNorm = normalizeGPA(gpa_scale === 'percentile' ? `${gpa}%` : gpa);
    const satScore = satMatchScore(sat, school.sat_low, school.sat_high);
    const gpaScore = gpaNorm !== null ? gpaMatchScore(gpaNorm, school) : null;
    const score = combinedScore(satScore, gpaScore);

    res.json({
      success: true,
      school: {
        name_en: school.name_en,
        name_cn: school.name_cn,
        tier: school.tier,
        sat_low: school.sat_low,
        sat_high: school.sat_high,
        acceptance_rate: school.acceptance_rate,
        match_score: score,
        sat_score: satScore,
        gpa_score: gpaScore,
        breakdown: {
          sat_analysis: satScore !== null ? 
            `${sat} vs [${school.sat_low}-${school.sat_high}] → ${satScore}%` : '无SAT数据',
          gpa_analysis: gpaScore !== null ?
            `百分位前${gpaNorm}% vs 期望前${getTierExpectedGPA(school.tier)}% → ${gpaScore}%` : '无GPA数据',
        }
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getTierExpectedGPA(tier) {
  const map = { 'T5': 5, 'T10': 10, 'T15': 15, 'T20': 20, 'T25': 25, 'T30': 35,
                'T_UK1': 8, 'T_UK2': 18, 'T_UK3': 30, 'T_UK4': 45, 'T_UK5': 60, 'T_UK6': 75 };
  return map[tier] || 40;
}

module.exports = router;
