-- ============================================================
-- 升学规划完整数据库 Schema
-- ============================================================

-- 学生完整档案（扩展 profiles 表）
CREATE TABLE IF NOT EXISTS student_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  
  -- 基本信息
  display_name TEXT,
  grade TEXT CHECK(grade IN ('G9','G10','G11','G12')),
  curriculum TEXT CHECK(curriculum IN ('AP','IB','ALEVEL','IB')),
  target_country TEXT,
  target_major TEXT,
  dream_schools TEXT DEFAULT '[]',         -- JSON array
  interests TEXT DEFAULT '[]',             -- JSON array
  strengths TEXT DEFAULT '[]',             -- JSON array
  
  -- 性格测试
  mbti TEXT,
  holland_type TEXT,
  holland_secondary TEXT,
  
  -- 学业习惯
  study_habit TEXT CHECK(study_habit IN ('high','medium','low')),
  target_tier TEXT CHECK(target_tier IN ('elite','selective','good')),
  
  -- 扩展信息
  extracurriculars TEXT DEFAULT '[]',      -- JSON array
  awards TEXT DEFAULT '[]',                -- JSON array
  
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 学术成绩历史（每次录入）
CREATE TABLE IF NOT EXISTS grade_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_date TEXT DEFAULT (date('now')),
  
  -- 标化成绩
  sat INTEGER,
  act INTEGER,
  toefl INTEGER,
  ielts REAL,
  gpa REAL,
  gpa_scale TEXT DEFAULT '4.0',
  
  -- 学科成绩（JSON 存储每学期各科成绩）
  subjects TEXT DEFAULT '[]',  -- [{name, score, weight}]
  
  -- 备注
  note TEXT,
  
  created_at TEXT DEFAULT (datetime('now'))
);

-- 竞赛记录
CREATE TABLE IF NOT EXISTS competition_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  name TEXT NOT NULL,
  subject TEXT,           -- 数学/物理/化学/生物/计算机/商科
  level TEXT,             -- 国家级/省级/校级
  result TEXT,            -- 奖项/排名
  grade_participated TEXT, -- 参赛时年级
  date TEXT,
  certificate_no TEXT,    -- 证书编号
  note TEXT,
  
  created_at TEXT DEFAULT (datetime('now'))
);

-- 活动记录
CREATE TABLE IF NOT EXISTS activity_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  name TEXT NOT NULL,
  role TEXT,
  organization TEXT,
  start_date TEXT,
  end_date TEXT,
  hours_per_week REAL,
  description TEXT,
  achievements TEXT,
  category TEXT,          -- 学术/公益/领导力/艺术
  
  created_at TEXT DEFAULT (datetime('now'))
);

-- 语言成绩历史
CREATE TABLE IF NOT EXISTS language_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  exam_type TEXT CHECK(exam_type IN ('TOEFL','IELTS','SAT','ACT')),
  score INTEGER,
  sub_score TEXT,         -- 各科小分 JSON
  exam_date TEXT,
  attempt_no INTEGER DEFAULT 1,  -- 第几次考试
  
  created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- 升学规划案例存档（每次生成规划都完整记录）
-- ============================================================
CREATE TABLE IF NOT EXISTS plan_cases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- 生成时间
  created_at TEXT DEFAULT (datetime('now')),
  
  -- 学生当时的档案快照（完整记录生成时的状态）
  student_snapshot TEXT NOT NULL,  -- JSON: 生成规划时的完整学生数据
  
  -- LLM 返回的原始规划结果
  plan_raw TEXT NOT NULL,          -- JSON: LLM 完整输出
  
  -- 解析后的结构化规划
  plan_parsed TEXT NOT NULL,       -- JSON: 解析成功的结构化数据
  
  -- 规划状态
  status TEXT DEFAULT 'active' CHECK(status IN ('active','archived','deleted')),
  
  -- AI 模型信息
  model_used TEXT,
  tokens_used INTEGER,
  
  -- 关联目标
  target_schools TEXT DEFAULT '[]',  -- JSON array
  target_major TEXT,
  focus_areas TEXT,
  
  -- PDF 文件路径
  pdf_path TEXT,
  
  -- 管理员备注
  admin_note TEXT,
  
  -- 软删除
  deleted_at TEXT
);

-- 为已有 users 表创建索引
CREATE INDEX IF NOT EXISTS idx_plan_cases_user ON plan_cases(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_cases_status ON plan_cases(status);
CREATE INDEX IF NOT EXISTS idx_grade_records_user ON grade_records(user_id);
CREATE INDEX IF NOT EXISTS idx_competition_records_user ON competition_records(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_records_user ON activity_records(user_id);
