const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'data', 'academic.json');

// ── In-memory store ──
let db = {};

function load() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    db = JSON.parse(raw);
    if (typeof db !== 'object') db = {};
  } catch {
    db = {};
  }
}

function save() {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

// ── Per-user data ──
function getUserData(userId) {
  if (!db[userId]) {
    db[userId] = {
      scores: {
        subjects: [],
        language: { toefl: null, ielts: null },
      },
      goals: {
        subjects: [],
        language: { toefl: null, ielts: null },
        target_school: null,
        target_major: null,
        target_country: null,
      },
      predictions: {
        predicted_sat: null,
        confidence: null,
        months_left: null,
        notes: null,
      },
      actionBoard: {
        columns: [
          { id: 'todo', title: '待办', cards: [] },
          { id: 'doing', title: '进行中', cards: [] },
          { id: 'done', title: '已完成', cards: [] },
        ],
      },
    };
    save();
  }
  return db[userId];
}

// ── Scores ──
function updateScores(userId, scores) {
  const data = getUserData(userId);
  if (scores.subjects) data.scores.subjects = scores.subjects;
  if (scores.language) {
    if (scores.language.toefl !== undefined) data.scores.language.toefl = scores.language.toefl;
    if (scores.language.ielts !== undefined) data.scores.language.ielts = scores.language.ielts;
  }
  save();
  return data.scores;
}

// ── Goals ──
function updateGoals(userId, goals) {
  const data = getUserData(userId);
  if (goals.subjects) data.goals.subjects = goals.subjects;
  if (goals.language) {
    if (goals.language.toefl !== undefined) data.goals.language.toefl = goals.language.toefl;
    if (goals.language.ielts !== undefined) data.goals.language.ielts = goals.language.ielts;
  }
  if (goals.target_school !== undefined) data.goals.target_school = goals.target_school;
  if (goals.target_major !== undefined) data.goals.target_major = goals.target_major;
  if (goals.target_country !== undefined) data.goals.target_country = goals.target_country;
  save();
  return data.goals;
}

// ── Predictions ──
function updatePredictions(userId, predictions) {
  const data = getUserData(userId);
  Object.assign(data.predictions, predictions);
  save();
  return data.predictions;
}

// ── Action Board ──
function getBoard(userId) {
  return getUserData(userId).actionBoard;
}

function addCard(userId, columnId, card) {
  const data = getUserData(userId);
  const col = data.actionBoard.columns.find(c => c.id === columnId);
  if (!col) return null;
  const newCard = {
    id: 'card_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: card.title,
    description: card.description || '',
    priority: card.priority || 'medium',
    dueDate: card.dueDate || null,
    createdAt: new Date().toISOString(),
    tags: card.tags || [],
  };
  col.cards.push(newCard);
  save();
  return newCard;
}

function moveCard(userId, cardId, toColumnId) {
  const data = getUserData(userId);
  let card = null;
  for (const col of data.actionBoard.columns) {
    const idx = col.cards.findIndex(c => c.id === cardId);
    if (idx >= 0) {
      card = col.cards.splice(idx, 1)[0];
      break;
    }
  }
  if (!card) return null;
  const toCol = data.actionBoard.columns.find(c => c.id === toColumnId);
  if (!toCol) return null;
  toCol.cards.push(card);
  save();
  return card;
}

function updateCard(userId, cardId, updates) {
  const data = getUserData(userId);
  for (const col of data.actionBoard.columns) {
    const card = col.cards.find(c => c.id === cardId);
    if (card) {
      Object.assign(card, updates);
      save();
      return card;
    }
  }
  return null;
}

function deleteCard(userId, cardId) {
  const data = getUserData(userId);
  for (const col of data.actionBoard.columns) {
    const idx = col.cards.findIndex(c => c.id === cardId);
    if (idx >= 0) {
      col.cards.splice(idx, 1);
      save();
      return true;
    }
  }
  return false;
}

// ── Gap analysis ──
function getGapAnalysis(userId) {
  const data = getUserData(userId);
  const { scores, goals } = data;
  const gaps = [];

  // Subject gaps
  for (const goal of (goals.subjects || [])) {
    const current = (scores.subjects || []).find(s => s.name === goal.name);
    const curVal = current ? current.score : 0;
    const gap = goal.score - curVal;
    gaps.push({
      type: 'subject',
      name: goal.name,
      current: curVal,
      target: goal.score,
      gap,
      measures: gap > 0 ? getSuggestedMeasures(goal.name, gap) : ['已达到目标'],
    });
  }

  // Language gaps
  if (goals.language) {
    if (goals.language.toefl) {
      const cur = scores.language.toefl || 0;
      const gap = goals.language.toefl - cur;
      gaps.push({
        type: 'language',
        name: 'TOEFL',
        current: cur,
        target: goals.language.toefl,
        gap: Math.max(0, gap),
        measures: gap > 0 ? getLanguageMeasures('toefl') : ['已达到目标'],
      });
    }
    if (goals.language.ielts) {
      const cur = scores.language.ielts || 0;
      const gap = goals.language.ielts - cur;
      gaps.push({
        type: 'language',
        name: 'IELTS',
        current: cur,
        target: goals.language.ielts,
        gap: Math.max(0, gap),
        measures: gap > 0 ? getLanguageMeasures('ielts') : ['已达到目标'],
      });
    }
  }

  return gaps;
}

function getSuggestedMeasures(subject, gap) {
  const suggestions = {
    '数学': ['每天30分钟真题训练', '整理错题本，每周复盘', '参加AMC竞赛提升思维'],
    '英语': ['每天精读1篇学术文章', '背诵20个核心词汇', '每周写1篇议论文并修改'],
    '阅读': ['每天限时练习1篇', '扩展学术词汇量', '分析错题类型统计'],
    '文法': ['系统学习语法规则', '每天1套文法练习', '精读优秀范文学习结构'],
    '科学': ['每周完成2套科学推理', '整理实验方法笔记', '跨学科知识整合训练'],
  };
  return suggestions[subject] || ['制定该科目专项提升计划', '每周自测并记录进步', '寻求辅导老师针对性补习'];
}

function getLanguageMeasures(type) {
  const base = [
    '制定每周学习计划',
    '使用真题进行模考',
    '针对薄弱单项重点突破',
    '考虑报名专项冲刺班',
  ];
  if (type === 'toefl') {
    return ['每天30分钟听力训练', '每周2套TPO模考', '口语模板训练', ...base];
  }
  return ['每天精读1篇学术文章', '每周2套剑桥真题', '写作批改与修改', ...base];
}

// Load on init
load();

module.exports = {
  getUserData,
  updateScores,
  updateGoals,
  updatePredictions,
  getBoard,
  addCard,
  moveCard,
  updateCard,
  deleteCard,
  getGapAnalysis,
};
