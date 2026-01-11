export const PROMPT_TEMPLATE_SCOPES = Object.freeze({
  generate: 'generate',
  sectionEdit: 'sectionEdit',
});

export const BUILTIN_PROMPT_TEMPLATES = Object.freeze([
  {
    id: 'gen-floating-ambient',
    scope: PROMPT_TEMPLATE_SCOPES.generate,
    title: '浮游感 / 空灵氛围',
    content:
      '氛围：空灵、漂浮、延迟感\n和声：大七/九和弦点缀，尽量平滑声部进行\n节奏：舒缓，留白多\n配器：电钢/Pad/轻打击',
  },
  {
    id: 'gen-lofi-night',
    scope: PROMPT_TEMPLATE_SCOPES.generate,
    title: 'Lo-fi 夜晚',
    content:
      '风格：Lo-fi\n氛围：温暖、颗粒感、复古磁带\n和声：七和弦为主，加入借用和弦\n节奏：中慢速，律动稳',
  },
  {
    id: 'gen-jpop-citypop',
    scope: PROMPT_TEMPLATE_SCOPES.generate,
    title: '日系 CityPop',
    content:
      '风格：CityPop / J-Pop\n和声：丰富的转位与经过和弦，适度半音下行\n旋律：明亮，带一点“副歌冲顶”\n节奏：偏律动',
  },
  {
    id: 'gen-rnb-soul',
    scope: PROMPT_TEMPLATE_SCOPES.generate,
    title: 'R&B / Neo-Soul',
    content:
      '风格：R&B / Neo-Soul\n和声：色彩和弦（maj7, m9, 13），滑音感声部进行\n旋律：灵活切分，留出呼吸\n低音：稳，强调根音与五度',
  },
  {
    id: 'gen-cinematic',
    scope: PROMPT_TEMPLATE_SCOPES.generate,
    title: '电影感 / 史诗氛围',
    content:
      '氛围：电影感、渐进堆叠\n和声：大调/小调之间转换，加入悬挂与add9\n节奏：层层推进\n结尾：更开放或更有收束',
  },
  {
    id: 'sec-regenerate-clean',
    scope: PROMPT_TEMPLATE_SCOPES.sectionEdit,
    title: '本段：重生成（保持结构）',
    content:
      '重生成这一段：保持小节数与和弦数量不变；整体情绪与风格一致，但换一套全新的和弦与旋律走向。',
  },
  {
    id: 'sec-variation-smooth',
    scope: PROMPT_TEMPLATE_SCOPES.sectionEdit,
    title: '本段：变奏（更平滑）',
    content:
      '对这一段做变奏：保持和弦数量不变，声部进行更平滑，旋律保留动机但改变节奏与走向。',
  },
  {
    id: 'sec-melody-fill',
    scope: PROMPT_TEMPLATE_SCOPES.sectionEdit,
    title: '本段：补旋律（更抓耳）',
    content:
      '为这一段补全/优化旋律：保持和弦不变，旋律更抓耳，节奏更自然，避免无意义重复。',
  },
]);

export function isValidPromptTemplate(raw) {
  if (!raw || typeof raw !== 'object') return false;
  const id = String(raw.id || '').trim();
  const title = String(raw.title || '').trim();
  const content = String(raw.content || '').trim();
  const scope = String(raw.scope || '').trim();
  if (!id || !title || !content) return false;
  if (!Object.values(PROMPT_TEMPLATE_SCOPES).includes(scope)) return false;
  return true;
}

