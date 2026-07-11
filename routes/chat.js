const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

const VAULT_ROOT = '/home/ubuntu/obsidian-vault';
const DEEPSEEK_API = 'https://api.deepseek.com/v1/chat/completions';
const MODEL = 'deepseek-chat';

// ── Load all vault content into memory for fast search ──
let vaultDocs = [];

function loadVault() {
  vaultDocs = [];
  if (!fs.existsSync(VAULT_ROOT)) return;

  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.')) walk(fullPath);
      } else if (entry.name.endsWith('.md')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          // Strip YAML front matter
          const clean = content.replace(/^---[\s\S]*?---\n?/, '');
          vaultDocs.push({
            path: fullPath.replace(VAULT_ROOT, ''),
            name: entry.name.replace('.md', ''),
            content: clean,
          });
        } catch { /* skip unreadable */ }
      }
    }
  };
  walk(VAULT_ROOT);
  console.log(`📚 Vault loaded: ${vaultDocs.length} documents`);
}

// ── Search vault for relevant content ──
function searchVault(query, maxResults = 5) {
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const scored = vaultDocs.map(doc => {
    const lower = doc.content.toLowerCase();
    let score = 0;
    let matched = [];
    for (const term of terms) {
      // Title match
      if (doc.name.toLowerCase().includes(term)) { score += 5; matched.push(`title:${term}`); }
      // Content match
      const count = (lower.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      score += count;
      if (count > 0) matched.push(term);
    }
    // Length bonus for medium-length docs
    const len = doc.content.length;
    if (len > 200 && len < 10000) score += 1;
    return { ...doc, score, matched: matched.slice(0, 5) };
  });

  return scored
    .filter(d => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

// ── Build context from search results ──
function buildContext(results) {
  if (results.length === 0) return '';
  let ctx = '以下是从知识库中检索到的相关内容：\n\n';
  for (const r of results) {
    // Take first 2000 chars of relevant content
    const snippet = r.content.slice(0, 2000);
    ctx += `【${r.name}】\n${snippet}\n\n---\n\n`;
  }
  return ctx;
}

// ── Chat completion via DeepSeek ──
async function askDeepSeek(messages) {
  const response = await fetch(DEEPSEEK_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 2000,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`DeepSeek API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// ── Routes ──

/**
 * POST /api/chat — 向知识库提问
 * Body: { question, history? }
 *   question: string - 用户问题
 *   history: Array - 对话历史 [{role, content}]
 */
router.post('/', optionalAuth, async (req, res) => {
  try {
    const { question, history } = req.body;

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return res.status(400).json({ error: '请输入问题' });
    }

    // 1. Search vault
    const results = searchVault(question, 5);
    const context = buildContext(results);

    // 2. Build messages
    const systemPrompt = `你是一位专业的升学规划顾问，精通国际教育体系（IB、A-Level、AP、SAT、托福、雅思等）、各国名校申请策略、专业选择与职业规划。

你的回复风格：
- 专业且亲切，用中文回复
- 回答基于提供的知识库内容，如果知识库中没有相关信息，请诚实说明
- 给出具体、可操作的建议
- 适当引用来源文档名称

${context ? '以下是为本次回答提供的参考资料：\n' + context : '注意：当前没有找到完全匹配的参考文档，请根据你的专业知识回答。'}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(history || []).slice(-10), // keep last 10 turns
      { role: 'user', content: question },
    ];

    // 3. Call DeepSeek
    const answer = await askDeepSeek(messages);

    // 4. Return answer with sources
    res.json({
      answer,
      sources: results.map(r => ({
        name: r.name,
        path: r.path,
        matchCount: r.score,
      })),
    });

  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: '回答生成失败，请稍后重试' });
  }
});

/**
 * GET /api/chat/search — 搜索知识库内容
 * Query: q - 搜索关键词
 */
router.get('/search', (req, res) => {
  const q = req.query.q;
  if (!q) return res.json({ results: [] });

  const results = searchVault(q, 10);
  res.json({
    results: results.map(r => ({
      name: r.name,
      path: r.path,
      snippet: r.content.slice(0, 300),
      score: r.score,
    })),
  });
});

/**
 * GET /api/chat/kb-stats — 知识库统计
 */
router.get('/kb-stats', (req, res) => {
  res.json({
    totalDocs: vaultDocs.length,
    categories: [...new Set(vaultDocs.map(d => {
      const parts = d.path.split('/').filter(Boolean);
      return parts.length > 1 ? parts[0] : 'root';
    }))],
  });
});

// Load vault on startup
loadVault();

module.exports = router;
