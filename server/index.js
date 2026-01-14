import 'dotenv/config';
import expressPkg from 'express';
import mongoose from 'mongoose';
import corsPkg from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import jwt from 'jsonwebtoken'; // [新增]
import User from './models/User.js';
import Project from './models/Project.js';
import Post from './models/Post.js';
import Comment from './models/Comment.js';
import Notification from './models/Notification.js';
import Conversation from './models/Conversation.js';
import Message from './models/Message.js';
import AiChordCollection from './models/AiChordCollection.js';
import RecommendationItem from './models/RecommendationItem.js';
import PlayEvent from './models/PlayEvent.js';
import UserProfile from './models/UserProfile.js';
import DailyRecommendation from './models/DailyRecommendation.js';
import ProjectVersion from './models/ProjectVersion.js';

const SERVER_CONFIG = {
    port: Number(process.env.PORT || 3000),
    mongoUri: process.env.MONGO_URI || '',
    jwtSecret: process.env.JWT_SECRET || 'museai-secret-key-2024',
    ai: {
        apiKey: process.env.AI_API_KEY || '',
        model: process.env.AI_MODEL || 'glm-4.6',
        base: process.env.AI_API_BASE || '',
    },
    telemetry: {
        enabled: String(process.env.CLIENT_ERROR_LOGGING ?? 'true') !== 'false',
    },
};

const AI_API_KEY = SERVER_CONFIG.ai.apiKey;
const AI_MODEL = SERVER_CONFIG.ai.model;
const AI_API_BASE = SERVER_CONFIG.ai.base;

const express = expressPkg.default || expressPkg;
const cors = corsPkg.default || corsPkg;

// 配置
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = SERVER_CONFIG.port;
// 🔑 JWT 密钥 (生产环境应该放在 .env 里)
const JWT_SECRET = SERVER_CONFIG.jwtSecret;


const DEFAULT_MESSAGE_SETTINGS = Object.freeze({
    chat: true,
    replies: true,
    mentions: true,
    likes: true,
    system: true,
});

const normalizeMessageSettings = (settings) => ({
    ...DEFAULT_MESSAGE_SETTINGS,
    ...(settings || {}),
});

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(String(id || ''));
const createVersionId = () =>
    `v_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
const normalizeStringArray = (val, max = 24) => {
    if (!Array.isArray(val)) return [];
    return val
        .map((v) => String(v || '').trim())
        .filter(Boolean)
        .slice(0, max);
};
const normalizeNumberArray = (val, max = 256) => {
    if (!Array.isArray(val)) return [];
    return val
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v))
        .slice(0, max);
};

const buildItemPatchFromPayload = (raw) => {
    const payload = raw && typeof raw === 'object' ? raw : {};
    const patch = {};
    if (payload.title != null) patch.title = String(payload.title || '').trim();
    if (payload.artistName != null) patch.artistName = String(payload.artistName || '').trim();
    if (payload.coverUrl != null) patch.coverUrl = String(payload.coverUrl || '').trim();
    if (payload.audioUrl != null) patch.audioUrl = String(payload.audioUrl || '').trim();
    if (payload.durationSec != null) patch.durationSec = Math.max(0, Number(payload.durationSec) || 0);
    if (payload.styleTags != null) patch.styleTags = normalizeStringArray(payload.styleTags, 24);
    if (payload.styleVec != null) patch.styleVec = normalizeNumberArray(payload.styleVec, 256);
    if (payload.chordFeat != null) patch.chordFeat = payload.chordFeat;
    if (payload.popularity != null) patch.popularity = Math.max(0, Number(payload.popularity) || 0);
    return patch;
};

const canSendNotification = async (recipientId, kind, senderId) => {
    try {
        const [recipient, sender] = await Promise.all([
            User.findById(recipientId).select('messageSettings blockedUsers'),
            senderId ? User.findById(senderId).select('blockedUsers') : Promise.resolve(null),
        ]);

        if (!recipient) return false;

        const isBlockedBy = (doc, targetId) => (doc?.blockedUsers || []).some((id) => String(id) === String(targetId));
        if (senderId && (isBlockedBy(recipient, senderId) || isBlockedBy(sender, recipientId))) return false;

        const settings = normalizeMessageSettings(recipient?.messageSettings);
        if (kind === 'likes') return Boolean(settings.likes);
        if (kind === 'replies') return Boolean(settings.replies);
        if (kind === 'mentions') return Boolean(settings.mentions);
        if (kind === 'system') return Boolean(settings.system);
        return true;
    } catch (e) {
        return true;
    }
};

const hasBlockBetween = async (userAId, userBId) => {
    try {
        const a = String(userAId || '');
        const b = String(userBId || '');
        if (!isValidObjectId(a) || !isValidObjectId(b)) return false;

        const [u1, u2] = await Promise.all([
            User.findById(a).select('blockedUsers'),
            User.findById(b).select('blockedUsers'),
        ]);
        const blocks = (doc, targetId) => (doc?.blockedUsers || []).some((id) => String(id) === String(targetId));
        return blocks(u1, b) || blocks(u2, a);
    } catch (e) {
        return false;
    }
};

const getBlockedUserIdsFor = async (meId) => {
    try {
        const me = String(meId || '');
        if (!isValidObjectId(me)) return [];

        const [meDoc, blockedByDocs] = await Promise.all([
            User.findById(me).select('blockedUsers'),
            User.find({ blockedUsers: me }).select('_id'),
        ]);

        const ids = new Set();
        (meDoc?.blockedUsers || []).forEach((id) => ids.add(String(id)));
        (blockedByDocs || []).forEach((doc) => ids.add(String(doc._id)));
        return Array.from(ids);
    } catch (e) {
        return [];
    }
};

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
});

app.post('/api/telemetry/client-error', (req, res) => {
    if (!SERVER_CONFIG.telemetry.enabled) return res.status(204).end();
    const payload = req.body || {};
    console.error('[client-error]', {
        message: payload?.message,
        type: payload?.type,
        href: payload?.href,
        ts: payload?.ts,
    });
    res.json({ ok: true });
});

// ==========================================
//  🤖 AI Creator (SSE): 生成和弦/旋律/编曲素材
//  - POST /api/ai-creator
//  - body: {
//      prompt: string,
//      mode?: 'chords' | 'song',
//      genre?: string,
//      bpm?: number,
//      key?: string,
//      scale?: string,
//      bars?: number,
//      structure?: string,
//    }

//  - response: text/event-stream
//  - events: start/progress/result/error/too_many_requests
// ==========================================
const writeSse = (res, payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const SYSTEM_PROMPT_AI_CHORD_CREATOR = `你是一名专业编曲助手。你的任务：根据用户输入生成“和弦/和弦进行”。\n\n输出必须是严格 JSON（只能输出 JSON，不能输出任何解释文字），并且能被 JSON.parse() 直接解析。\n\nJSON 格式：\n1) 支持时：\n{\n  "type": "chord",\n  "value": [\n    ["C4","E4","G4"],\n    ["A3","C4","E4"],\n    ...\n  ],\n  "desc": "一句简短说明（可选）"\n}\n\n- value 是一个二维数组：外层每个元素是一个和弦；内层是音符字符串列表。\n- 每个和弦 3~6 个音符；尽量避免完全重复的音。\n- 音符必须使用格式：音名(A-G)+可选#或b+八度数字，例如 C4, Eb4, F#3。\n- 生成和弦进行时，请注意声部进行更平滑（相邻和弦尽量少跳进）。\n\n2) 不支持时：\n{ "type": "NOT_SUPPORT", "value": null, "desc": "不支持原因" }\n\n始终只输出 JSON。`;

const SYSTEM_PROMPT_AI_SONG_CREATOR = `你是一名专业编曲助手。你的任务：根据用户输入，一次性生成“和弦进行 + 旋律（单声部）”，并组织成更像完整歌曲的结构（例如 A 段 / B 段 / 副歌）。用于一首没有人声的简短器乐作品。\n\n输出必须是严格 JSON（只能输出 JSON，不能输出任何解释文字），并且能被 JSON.parse() 直接解析。\n\nJSON 格式（支持时）：\n{\n  "type": "song",\n  "bpm": 120,\n  "key": "C",\n  "scale": "major",\n  "genre": "R&B",\n  "chordBeats": 4,\n  "structure": "A(Verse)-B(Chorus)-A(Verse)-B(Chorus)",\n  "sections": [\n    {\n      "name": "A",\n      "label": "Verse",\n      "bars": 8,\n      "chords": [ ["C4","E4","G4"], ["A3","C4","E4"] ],\n      "melody": [ {"note":"E5","durBeats":1}, {"note":"REST","durBeats":1} ]\n    },\n    {\n      "name": "B",\n      "label": "Chorus",\n      "bars": 8,\n      "chords": [ ... ],\n      "melody": [ ... ]\n    }\n  ],\n  "desc": "一句简短说明（可选）"\n}\n\n规则：\n- sections 必须至少包含 2 段（例如 A 和 B），可包含副歌（Chorus）、过渡（Bridge）等。\n- 每段的 bars 为正整数，通常 4/8/16。\n- 每段 chords 是二维数组：每个和弦 3~6 个音符；注意声部进行更平滑。\n- 每段 melody 是一维数组：按时间顺序的旋律音符；note 为音符字符串或 REST（休止）。\n- note 音符必须使用格式：音名(A-G)+可选#或b+八度数字，例如 C4, Eb4, F#3。\n- durBeats 为正数（建议 0.5 / 1 / 2 / 4）；每段 melody 的 durBeats 总和应与该段 chords.length * chordBeats 大致一致（允许少量偏差）。\n- bpm 为 40~240 的整数。\n\n不支持时：\n{ "type": "NOT_SUPPORT", "value": null, "desc": "不支持原因" }\n\n始终只输出 JSON。`;

app.post('/api/ai-creator', async (req, res) => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const prompt = String(req.body?.prompt || '').trim();
    const mode = String(req.body?.mode || '').trim() || 'chords';
    const genre = String(req.body?.genre || '').trim();
    const key = String(req.body?.key || '').trim();
    const scale = String(req.body?.scale || '').trim();
    const bpm = Number(req.body?.bpm);
    const bars = Number(req.body?.bars);
    const structure = String(req.body?.structure || '').trim();

    if (!AI_API_KEY) {
        writeSse(res, { type: 'error', message: '服务端未配置 AI_API_KEY' });
        return res.end();
    }
    if (!prompt) {
        writeSse(res, { type: 'error', message: 'prompt 不能为空' });
        return res.end();
    }

    let closed = false;
    const abortController = new AbortController();
    res.on('close', () => {
        closed = true;
        try { abortController.abort(); } catch { }
    });

    writeSse(res, { type: 'start', message: '容我想想...' });

    const stripCodeFences = (text) => {
        let t = String(text || '').trim();
        if (t.startsWith('```')) {
            t = t.replace(/^```[a-zA-Z0-9_-]*\s*/m, '');
            t = t.replace(/```\s*$/m, '').trim();
        }
        return t;
    };
    const extractJsonCandidate = (text) => {
        const t = String(text || '');
        const firstObj = t.indexOf('{');
        const firstArr = t.indexOf('[');
        let start = -1;
        if (firstObj !== -1 && firstArr !== -1) start = Math.min(firstObj, firstArr);
        else start = Math.max(firstObj, firstArr);
        if (start === -1) return null;
        const lastObj = t.lastIndexOf('}');
        const lastArr = t.lastIndexOf(']');
        const end = Math.max(lastObj, lastArr);
        if (end === -1 || end <= start) return null;
        return t.slice(start, end + 1).trim();
    };
    const parseAiCreatorJson = (text) => {
        const raw = String(text || '');
        const variants = [];
        variants.push(raw.trim());
        variants.push(stripCodeFences(raw));
        variants.push(extractJsonCandidate(stripCodeFences(raw)) || '');
        variants.push(extractJsonCandidate(raw) || '');

        for (const v of variants) {
            if (!v) continue;
            try {
                return JSON.parse(v);
            } catch {
                // continue
            }
        }
        return null;
    };

    const systemPrompt = mode === 'song' ? SYSTEM_PROMPT_AI_SONG_CREATOR : SYSTEM_PROMPT_AI_CHORD_CREATOR;
    const userPromptLines = [
        prompt,
        genre ? `genre: ${genre}` : '',
        Number.isFinite(bpm) ? `bpm: ${Math.round(bpm)}` : '',
        key ? `key: ${key}` : '',
        scale ? `scale: ${scale}` : '',
        Number.isFinite(bars) ? `bars: ${Math.round(bars)}` : '',
        structure ? `structure: ${structure}` : '',
    ].filter(Boolean);
    const userPrompt = userPromptLines.join('\n');

    // OpenAI-compatible endpoint (可用 env 覆盖)
    const apiBase = String(process.env.AI_API_BASE || 'https://open.bigmodel.cn/api/paas/v4/chat/completions').trim();

    const requestAiOnce = async ({ stream, temperature, messages }) => {
        const resp = await fetch(apiBase, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${AI_API_KEY}`,
            },
            body: JSON.stringify({
                model: AI_MODEL,
                stream: Boolean(stream),
                temperature: typeof temperature === 'number' ? temperature : 0.8,
                messages,
            }),
            signal: abortController.signal,
        });
        return resp;
    };

    const buildRepairSystemPrompt = () => {
        const base = `你是一名“JSON 修复器”。你的任务：把用户提供的内容修复/改写为“严格 JSON”，要求：\n- 只能输出 JSON（禁止任何解释文字、markdown、代码块）。\n- 必须能被 JSON.parse() 直接解析（双引号、无多余逗号）。\n- 修复常见错误：缺失冒号/引号、错误字段名（例如 chords）、对象键为空、数组/对象括号不匹配。\n- 所有音符必须符合格式：音名(A-G)+可选#或b+八度数字，例如 C4, Eb4, F#3；休止用 REST。\n- durBeats 必须为正数。\n`;
        if (mode === 'song') {
            return base + `\n目标 JSON 结构：{type:'song', bpm:number, key:string, scale:string, genre?:string, chordBeats:number, structure:string, sections:[{name:string,label?:string,bars:number,chords:string[][],melody:{note:string,durBeats:number}[]}], desc?:string}`;
        }
        return base + `\n目标 JSON 结构：{type:'chord', value:string[][], desc?:string} 或 {type:'NOT_SUPPORT', value:null, desc:string}`;
    };

    const tryRepairAiJson = async (rawText) => {
        if (closed) return null;
        try {
            writeSse(res, { type: 'progress', message: '正在修复 AI 输出格式...' });
        } catch { }

        const repairMessages = [
            { role: 'system', content: buildRepairSystemPrompt() },
            {
                role: 'user',
                content:
                    `请把下面内容修复为严格 JSON（只输出 JSON）：\n\n` +
                    String(rawText || '').slice(0, 12000),
            },
        ];

        const repairResp = await requestAiOnce({ stream: false, temperature: 0.2, messages: repairMessages });
        if (!repairResp.ok) return null;
        const json = await repairResp.json().catch(() => null);
        const content = json?.choices?.[0]?.message?.content;
        if (!content) return null;
        return parseAiCreatorJson(String(content));
    };

    try {
        const resp = await requestAiOnce({
            stream: true,
            temperature: 0.8,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
        });

        if (resp.status === 429) {
            writeSse(res, { type: 'too_many_requests', message: '请求过于频繁，请稍后再试' });
            return res.end();
        }

        if (!resp.ok || !resp.body) {
            const detail = await resp.text().catch(() => '');
            writeSse(res, { type: 'error', message: 'AI 接口请求失败', detail: detail.slice(0, 800) });
            return res.end();
        }

        const decoder = new TextDecoder('utf-8');
        const reader = resp.body.getReader();
        let fullContent = '';
        let lastProgressAt = 0;

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (!value) continue;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split(/\r?\n/);
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) continue;
                const data = trimmed.slice(5).trim();
                if (!data || data === '[DONE]') continue;

                let json;
                try {
                    json = JSON.parse(data);
                } catch {
                    continue;
                }

                const delta = json?.choices?.[0]?.delta?.content;
                if (typeof delta === 'string' && delta.length) {
                    fullContent += delta;
                    const now = Date.now();
                    if (now - lastProgressAt > 450) {
                        lastProgressAt = now;
                        writeSse(res, { type: 'progress', message: '正在创作中...' });
                    }
                }
            }
        }

        if (closed) return res.end();

        let parsed = parseAiCreatorJson(fullContent);
        if (!parsed) {
            parsed = await tryRepairAiJson(fullContent);
        }
        if (!parsed) {
            const snippet = String(stripCodeFences(fullContent) || fullContent || '').trim().slice(0, 800);
            console.error('[ai-creator] failed to parse AI JSON. snippet:', snippet);
            writeSse(res, {
                type: 'error',
                message: 'AI 返回内容解析失败（不是严格 JSON），请重试或更换提示词/模型',
                details: snippet,
            });
            return res.end();
        }

        const t = parsed?.type;
        if (t !== 'chord' && t !== 'song' && t !== 'phrase' && t !== 'NOT_SUPPORT') {
            parsed = { type: 'NOT_SUPPORT', value: null, desc: '模型输出格式不符合要求' };
        }

        writeSse(res, { type: 'result', data: parsed });
        return res.end();
    } catch (e) {
        if (!closed) {
            const msg = e?.name === 'AbortError' ? '请求已取消' : '当前服务繁忙，请稍后重试';
            writeSse(res, { type: 'error', message: msg });
            return res.end();
        }
    }
});

// 上传配置
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
app.use('/uploads', express.static(uploadDir));

const postImageDir = path.join(uploadDir, 'post-images');
if (!fs.existsSync(postImageDir)) fs.mkdirSync(postImageDir);

const emojiDir = path.join(uploadDir, 'emojis');
if (!fs.existsSync(emojiDir)) fs.mkdirSync(emojiDir);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const mime = String(file?.mimetype || '');
        if (mime.startsWith('image/')) return cb(null, true);
        return cb(new Error('仅支持图片文件'));
    },
});

const postImageStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, postImageDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'postimg-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const postImageUpload = multer({
    storage: postImageStorage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const mime = String(file?.mimetype || '');
        if (mime.startsWith('image/')) return cb(null, true);
        return cb(new Error('仅支持图片文件'));
    },
});

const emojiStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, emojiDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'emoji-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const emojiUpload = multer({
    storage: emojiStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const mime = String(file?.mimetype || '');
        if (mime.startsWith('image/')) return cb(null, true);
        return cb(new Error('仅支持图片文件'));
    },
});

// ==========================================
//  🤖 AI Creator: Section Edit (SSE)
//  - POST /api/ai-creator/section-edit
// ==========================================
const SYSTEM_PROMPT_AI_SONG_SECTION_EDITOR = `你是一名专业编曲助手。你的任务：对“单个段落(Section)”进行局部编辑。\n\n输入会给你一份 JSON：包含 operation、songMeta、section、prompt/extraPrompt。\n\n你必须只输出严格 JSON（只能输出 JSON，不能输出任何解释文字），并且能被 JSON.parse() 直接解析。\n\n输出 JSON 格式：\n{\n  \"type\": \"section\",\n  \"section\": {\n    \"name\": \"A\",\n    \"label\": \"Verse\",\n    \"bars\": 8,\n    \"chords\": [ [\"C4\",\"E4\",\"G4\"], [\"A3\",\"C4\",\"E4\"] ],\n    \"melody\": [ {\"note\":\"E5\",\"durBeats\":1}, {\"note\":\"REST\",\"durBeats\":1} ]\n  },\n  \"desc\": \"一句简短说明(可选)\"\n}\n\n规则：\n- note 音符格式：音名(A-G)+可选#或b+八度数字，例如 C4, Eb4, F#3；休止用 REST。\n- 每个和弦 3~6 个音符。\n- section.chords 的长度必须等于输入 section.chordCount。\n- section.melody 的长度必须等于输入 section.melodyCount。\n- operation 含义：\n  - regenerate：重生成本段（在保持 chordCount/melodyCount/bars 不变的前提下，生成新的 chords+melody）。\n  - variation：变奏本段（保持结构不变，改变和声/配音/旋律动机）。\n  - add_melody：补旋律（保持 chords 不变，只生成/优化 melody）。\n\n始终只输出 JSON。`;

app.post('/api/ai-creator/section-edit', async (req, res) => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const operation = String(req.body?.operation || '').trim();
    const prompt = String(req.body?.prompt || '').trim();
    const extraPrompt = String(req.body?.extraPrompt || '').trim();
    const songMeta = req.body?.songMeta && typeof req.body.songMeta === 'object' ? req.body.songMeta : {};
    const sectionIn = req.body?.section && typeof req.body.section === 'object' ? req.body.section : {};

    if (!AI_API_KEY) {
        writeSse(res, { type: 'error', message: 'AI_API_KEY 未配置' });
        return res.end();
    }

    const opAllowed = new Set(['regenerate', 'variation', 'add_melody']);
    if (!opAllowed.has(operation)) {
        writeSse(res, { type: 'error', message: '不支持的 operation' });
        return res.end();
    }

    const chordCount = Math.max(0, Number(sectionIn?.chordCount) || 0);
    const melodyCount = Math.max(0, Number(sectionIn?.melodyCount) || 0);

    const baseChords = Array.isArray(sectionIn?.chords) ? sectionIn.chords : [];
    const baseMelody = Array.isArray(sectionIn?.melody) ? sectionIn.melody : [];

    const stripCodeFences = (text) => {
        let t = String(text || '').trim();
        if (t.startsWith('```')) {
            t = t.replace(/^```[a-zA-Z0-9_-]*\s*/m, '');
            t = t.replace(/```\s*$/m, '').trim();
        }
        return t;
    };
    const extractJsonCandidate = (text) => {
        const t = String(text || '');
        const firstObj = t.indexOf('{');
        const firstArr = t.indexOf('[');
        let start = -1;
        if (firstObj !== -1 && firstArr !== -1) start = Math.min(firstObj, firstArr);
        else start = Math.max(firstObj, firstArr);
        if (start === -1) return null;
        const lastObj = t.lastIndexOf('}');
        const lastArr = t.lastIndexOf(']');
        const end = Math.max(lastObj, lastArr);
        if (end === -1 || end <= start) return null;
        return t.slice(start, end + 1).trim();
    };
    const parseJson = (text) => {
        const raw = String(text || '');
        const variants = [];
        variants.push(raw.trim());
        variants.push(stripCodeFences(raw));
        variants.push(extractJsonCandidate(stripCodeFences(raw)) || '');
        variants.push(extractJsonCandidate(raw) || '');

        for (const v of variants) {
            if (!v) continue;
            try {
                return JSON.parse(v);
            } catch {
                // continue
            }
        }
        return null;
    };

    const normalizeChordMatrix = (value, target) => {
        const list = Array.isArray(value) ? value : [];
        const chords = list
            .map((c) => (Array.isArray(c) ? c.map((n) => String(n || '').trim()).filter(Boolean) : []))
            .filter((c) => c.length);
        const need = Math.max(0, Number(target) || 0);
        if (need === 0) return chords;
        if (chords.length > need) return chords.slice(0, need);
        if (chords.length === need) return chords;
        const last = chords[chords.length - 1] || ['C4', 'E4', 'G4'];
        const padded = [...chords];
        while (padded.length < need) padded.push([...last]);
        return padded;
    };

    const normalizeMelodyList = (value, target) => {
        const list = Array.isArray(value) ? value : [];
        const melody = list.map((m) => {
            const noteRaw = String(m?.note || '').trim();
            const note = noteRaw.toUpperCase() === 'REST' ? 'REST' : noteRaw;
            const d = Number(m?.durBeats);
            const durBeats = Number.isFinite(d) && d > 0 ? d : 1;
            return { note, durBeats };
        });
        const need = Math.max(0, Number(target) || 0);
        if (need === 0) return melody;
        if (melody.length > need) return melody.slice(0, need);
        if (melody.length === need) return melody;
        const padded = [...melody];
        while (padded.length < need) padded.push({ note: 'REST', durBeats: 1 });
        return padded;
    };

    const apiBase = String(process.env.AI_API_BASE || 'https://open.bigmodel.cn/api/paas/v4/chat/completions').trim();
    const requestAiOnce = async ({ temperature, messages }) => {
        const resp = await fetch(apiBase, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${AI_API_KEY}`,
            },
            body: JSON.stringify({
                model: AI_MODEL,
                stream: false,
                temperature: typeof temperature === 'number' ? temperature : 0.8,
                messages,
            }),
        });
        return resp;
    };

    try {
        writeSse(res, { type: 'start', message: '正在生成本段…' });
        const inputPayload = {
            operation,
            prompt,
            extraPrompt,
            songMeta: {
                genre: String(songMeta?.genre || '').trim(),
                bpm: Number(songMeta?.bpm) || undefined,
                key: String(songMeta?.key || '').trim(),
                scale: String(songMeta?.scale || '').trim(),
                chordBeats: Number(songMeta?.chordBeats) || undefined,
                structure: String(songMeta?.structure || '').trim(),
            },
            section: {
                name: String(sectionIn?.name || '').trim(),
                label: String(sectionIn?.label || '').trim(),
                bars: Number(sectionIn?.bars) || 0,
                chordCount,
                melodyCount,
                chords: baseChords,
                melody: baseMelody,
            },
        };

        writeSse(res, { type: 'progress', message: '调用 AI…' });
        const resp = await requestAiOnce({
            temperature: 0.8,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT_AI_SONG_SECTION_EDITOR },
                { role: 'user', content: `输入 JSON：\n${JSON.stringify(inputPayload)}` },
            ],
        });

        if (resp.status === 429) {
            writeSse(res, { type: 'error', message: '请求过于频繁，请稍后再试' });
            return res.end();
        }
        if (!resp.ok) {
            const detail = await resp.text().catch(() => '');
            writeSse(res, { type: 'error', message: 'AI 接口请求失败', details: detail.slice(0, 800) });
            return res.end();
        }

        const json = await resp.json().catch(() => null);
        const content = json?.choices?.[0]?.message?.content;
        if (!content) {
            writeSse(res, { type: 'error', message: 'AI 未返回内容' });
            return res.end();
        }

        let parsed = parseJson(String(content));
        if (!parsed) {
            writeSse(res, { type: 'progress', message: '正在修复 AI 输出格式…' });
            const repairResp = await requestAiOnce({
                temperature: 0.2,
                messages: [
                    {
                        role: 'system',
                        content:
                            '你是一个 JSON 修复器。你只能输出严格 JSON，禁止任何解释文字、Markdown、代码块。输出必须能被 JSON.parse() 解析。',
                    },
                    { role: 'user', content: String(content).slice(0, 12000) },
                ],
            });
            if (repairResp.ok) {
                const repairJson = await repairResp.json().catch(() => null);
                const repaired = repairJson?.choices?.[0]?.message?.content;
                parsed = parseJson(String(repaired || ''));
            }
        }

        const out = parsed?.section && typeof parsed.section === 'object' ? parsed.section : parsed;
        if (!out || typeof out !== 'object') {
            writeSse(res, { type: 'error', message: 'AI 输出无法解析为段落 JSON' });
            return res.end();
        }

        const next = {
            name: String(out?.name || sectionIn?.name || '').trim(),
            label: String(out?.label || sectionIn?.label || '').trim(),
            bars: Number(out?.bars) || Number(sectionIn?.bars) || 0,
            chords: operation === 'add_melody' ? baseChords : normalizeChordMatrix(out?.chords, chordCount),
            melody: normalizeMelodyList(out?.melody, melodyCount),
        };

        // enforce counts (pad/trim) even for add_melody chords
        next.chords = normalizeChordMatrix(next.chords, chordCount);

        writeSse(res, { type: 'result', data: { type: 'section', section: next } });
        return res.end();
    } catch (e) {
        writeSse(res, { type: 'error', message: '本段编辑失败', details: String(e?.message || '').slice(0, 300) });
        return res.end();
    }
});

// 音频转谱上传配置（更大的体积限制）
const audioStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'audio-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const audioUpload = multer({
    storage: audioStorage,
    limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
    fileFilter: (req, file, cb) => {
        const mime = String(file?.mimetype || '').toLowerCase();
        if (mime.startsWith('audio/')) return cb(null, true);
        return cb(new Error('仅支持音频文件'));
    },
});

// 数据库连接
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) { console.error('❌ 未找到 MONGO_URI'); process.exit(1); }
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Atlas Connected'))
    .catch(err => console.error('❌ MongoDB Error:', err));


// ==========================================
//  🛡️ JWT 中间件 (核心安全逻辑)
// ==========================================
// 1. 普通用户验证 (验证 Token)
const auth = async (req, res, next) => {
    try {
        // 从 Header 获取: "Authorization: Bearer <token>"
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ message: '未登录' });

        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // 把解密出来的 { uid, role } 挂载到 req 上
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Token 无效或已过期' });
    }
};
// 可选鉴权：有 Token 就解析，没有则放行（用于公开接口的个性化过滤）
const optionalAuth = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (token) req.user = jwt.verify(token, JWT_SECRET);
    } catch (err) {
        // 忽略无效 Token，按未登录处理
    }
    next();
};
// 2. 管理员验证 (Token + Role)
const adminAuth = async (req, res, next) => {
    // 先验证 Token，再从数据库确认角色，避免旧 Token 里角色过期
    await auth(req, res, async () => {
        try {
            const dbUser = await User.findById(req.user.uid);
            if (!dbUser) return res.status(401).json({ message: '用户不存在' });
            if (dbUser.role !== 'admin') return res.status(403).json({ message: '需要管理员权限' });
            // 覆盖为数据库中的最新角色信息
            req.user.role = dbUser.role;
            next();
        } catch (err) {
            return res.status(500).json({ message: '权限校验失败' });
        }
    });
};
// ================= API 路由 =================
// --- 认证 Auth ---
app.post('/api/register', async (req, res) => {
    try {
        const { email, password, username } = req.body;
        if (await User.findOne({ email })) return res.status(400).json({ message: '邮箱已注册' });

        const newUser = new User({ email, password, username });
        await newUser.save();

        // 生成 Token
        const token = jwt.sign({ uid: newUser._id, role: newUser.role }, JWT_SECRET, { expiresIn: '7d' });

        const userDat = newUser.toJSON(); delete userDat.password;
        res.status(201).json({ user: userDat, token }); // 返回 Token
    } catch (err) { res.status(500).json({ message: 'Error' }); }
});
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email, password });
        if (!user) return res.status(401).json({ message: '账号或密码错误' });

        // 生成 Token
        const token = jwt.sign({ uid: user._id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

        const userDat = user.toJSON(); delete userDat.password;
        res.json({ user: userDat, token }); // 返回 Token
    } catch (err) { res.status(500).json({ message: 'Error' }); }
});
// [新增] 获取当前用户信息 (用于页面刷新后恢复登录状态)
// 记录播放事件（用于推荐）
app.post('/api/play-events', auth, async (req, res) => {
    try {
        const userId = String(req.user.uid || '');
        const payload = req.body || {};
        const source = String(payload.source || payload.item?.source || '').trim();
        const sourceId = String(payload.sourceId || payload.item?.sourceId || '').trim();
        const itemIdRaw = String(payload.itemId || '').trim();

        if (source === 'netease') {
            return res.status(202).json({ ok: true, skipped: true });
        }

        let item = null;
        if (itemIdRaw && isValidObjectId(itemIdRaw)) {
            item = await RecommendationItem.findById(itemIdRaw);
        }

        if (!item) {
            if (!source || !sourceId) {
                return res.status(400).json({ message: 'source/sourceId required' });
            }

            const itemPayload = payload.item && typeof payload.item === 'object' ? payload.item : payload;
            const patch = buildItemPatchFromPayload(itemPayload);

            if (source === 'community' && isValidObjectId(sourceId)) {
                const project = await Project.findById(sourceId).populate('author', 'username');
                if (project) {
                    if (!patch.title) patch.title = String(project.title || '').trim();
                    if (!patch.artistName) patch.artistName = String(project.author?.username || '').trim();
                    if (!patch.coverUrl) patch.coverUrl = String(project.cover || '').trim();
                    if (!patch.styleTags || !patch.styleTags.length) {
                        patch.styleTags = normalizeStringArray(project.tags, 24);
                    }
                }
            }

            item = await RecommendationItem.findOneAndUpdate(
                { source, sourceId },
                { $set: patch, $setOnInsert: { source, sourceId } },
                { upsert: true, new: true }
            );
        }

        const playedMs = Math.max(0, Number(payload.playedMs) || 0);
        const durationMs = Math.max(0, Number(payload.durationMs) || 0);
        const completed = Boolean(payload.completed);
        const skipped = Boolean(payload.skipped);
        const addedToQueue = Boolean(payload.addedToQueue);
        const liked = Boolean(payload.liked);
        const sourceContext = String(payload.sourceContext || '').trim();

        const event = await PlayEvent.create({
            userId,
            itemId: item._id,
            sourceContext,
            playedMs,
            durationMs,
            completed,
            skipped,
            addedToQueue,
            liked,
        });

        try {
            const inc =
                (completed ? 1 : 0) +
                (addedToQueue ? 0.6 : 0) +
                (liked ? 1 : 0) +
                (playedMs >= 15000 ? 0.2 : 0);
            if (inc > 0) {
                await RecommendationItem.updateOne({ _id: item._id }, { $inc: { popularity: inc } });
            }
        } catch {
            // ignore popularity update errors
        }

        res.status(201).json({ ok: true, eventId: event._id, itemId: item._id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error' });
    }
});

// 批量 Upsert 推荐池（网易云榜单/搜索）
app.post('/api/recommendation-items/batch', optionalAuth, async (req, res) => {
    try {
        const source = String(req.body?.source || '').trim();
        if (source === 'netease') {
            return res.json({ ok: true, count: 0 });
        }
        return res.status(400).json({ message: 'Only netease source supported' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error' });
    }
});


const buildDateKey = (date = new Date()) => {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
    return d.toISOString().slice(0, 10);
};

const computeEventWeight = (event, nowTs) => {
    const createdAt = event?.createdAt ? new Date(event.createdAt).getTime() : nowTs;
    const days = Math.max(0, (nowTs - createdAt) / (1000 * 60 * 60 * 24));
    const decay = Math.exp(-days / 14);
    let w = decay;
    if (event?.completed) w += 0.4;
    if (event?.addedToQueue) w += 0.6;
    if (event?.liked) w += 0.9;
    if (event?.skipped) w -= 0.7;
    const played = Math.max(0, Number(event?.playedMs) || 0);
    const duration = Math.max(1, Number(event?.durationMs) || 0);
    const ratio = Math.min(1, played / duration);
    w += (ratio - 0.3) * 0.6;
    return w;
};

const buildUserPreference = async (userId) => {
    const nowTs = Date.now();
    const events = await PlayEvent.find({ userId })
        .sort({ createdAt: -1 })
        .limit(500)
        .lean();

    const itemIds = Array.from(new Set(events.map((e) => String(e.itemId || '')))).filter(Boolean);
    const items = itemIds.length
        ? await RecommendationItem.find({ _id: { $in: itemIds } }).lean()
        : [];

    const itemMap = new Map(items.map((i) => [String(i._id), i]));
    const tagWeights = new Map();
    const artistWeights = new Map();
    const recentHistory = [];

    for (const event of events) {
        const item = itemMap.get(String(event.itemId || ''));
        if (!item || String(item.source || '') !== 'community') continue;
        if (recentHistory.length < 120) recentHistory.push(String(item._id));

        const w = computeEventWeight(event, nowTs);
        for (const tag of item.styleTags || []) {
            const key = String(tag || '').trim();
            if (!key) continue;
            tagWeights.set(key, (tagWeights.get(key) || 0) + w);
        }
        const artist = String(item.artistName || '').trim();
        if (artist) artistWeights.set(artist, (artistWeights.get(artist) || 0) + w);
    }

    const aiCollections = await AiChordCollection.find({ user: userId })
        .select('genre key scale')
        .lean();
    for (const col of aiCollections) {
        const tags = [col?.genre, col?.key, col?.scale].map((t) => String(t || '').trim()).filter(Boolean);
        for (const tag of tags) {
            tagWeights.set(tag, (tagWeights.get(tag) || 0) + 1.2);
        }
    }

    return { tagWeights, artistWeights, recentHistory };
};

const persistUserProfile = async (userId, pref) => {
    const tagWeights = Array.from(pref.tagWeights.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 64)
        .map(([tag, weight]) => ({ tag, weight }));

    const artistWeights = Array.from(pref.artistWeights.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 48)
        .map(([artist, weight]) => ({ artist, weight }));

    await UserProfile.findOneAndUpdate(
        { userId },
        {
            $set: {
                stylePrefVec: [],
                chordPrefFeat: { tagWeights, artistWeights },
                recentHistory: pref.recentHistory.slice(0, 120),
            },
        },
        { upsert: true, new: true }
    );
};

const scoreCandidateItem = (item, pref) => {
    const tags = Array.isArray(item.styleTags) ? item.styleTags : [];
    let tagScore = 0;
    let topReason = '';
    let topWeight = -Infinity;
    for (const tag of tags) {
        const w = pref.tagWeights.get(String(tag || '').trim()) || 0;
        tagScore += w;
        if (w > topWeight) {
            topWeight = w;
            topReason = String(tag || '').trim();
        }
    }
    const artist = String(item.artistName || '').trim();
    const artistScore = artist ? pref.artistWeights.get(artist) || 0 : 0;
    const popularityScore = Math.log10(Math.max(1, Number(item.popularity) || 0)) * 0.35;
    let score = tagScore * 1.2 + artistScore * 0.6 + popularityScore;
    if (pref.recentHistory.includes(String(item._id))) score -= 2.2;
    return { score, reasonTag: topReason || '' };
};

const syncCommunityItems = async () => {
    const projects = await Project.find({})
        .populate('author', 'username')
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(300)
        .lean();

    const ops = [];
    for (const project of projects) {
        const sourceId = String(project._id || '');
        if (!sourceId) continue;
        const patch = {
            title: String(project.title || '').trim(),
            artistName: String(project.author?.username || '').trim(),
            coverUrl: String(project.cover || '').trim(),
            audioUrl: String(project.audioUrl || '').trim(),
            styleTags: normalizeStringArray(project.tags, 24),
        };
        ops.push({
            updateOne: {
                filter: { source: 'community', sourceId },
                update: { $set: patch, $setOnInsert: { source: 'community', sourceId } },
                upsert: true,
            },
        });
    }
    if (ops.length) await RecommendationItem.bulkWrite(ops, { ordered: false });
};

const generateDailyRecommendations = async (userId, dateKey) => {
    await syncCommunityItems();
    const pref = await buildUserPreference(userId);
    const tagList = Array.from(pref.tagWeights.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map((t) => t[0]);

    const candidates = new Map();
    const playableFilter = { source: 'community', audioUrl: { $ne: '' } };

    if (tagList.length) {
        const byTags = await RecommendationItem.find({
            ...playableFilter,
            styleTags: { $in: tagList },
        })
            .limit(600)
            .lean();
        for (const item of byTags) candidates.set(String(item._id), item);
    }

    const byPopularity = await RecommendationItem.find(playableFilter)
        .sort({ popularity: -1, updatedAt: -1 })
        .limit(400)
        .lean();
    for (const item of byPopularity) candidates.set(String(item._id), item);

    const communityPool = await RecommendationItem.find(playableFilter)
        .sort({ updatedAt: -1 })
        .limit(200)
        .lean();
    for (const item of communityPool) candidates.set(String(item._id), item);

    const scored = Array.from(candidates.values()).map((item) => {
        const { score, reasonTag } = scoreCandidateItem(item, pref);
        return { item, score, reasonTag };
    });
    scored.sort((a, b) => b.score - a.score);

    const total = 10;
    const artistCounts = new Map();
    const picked = [];

    const pushItem = (entry) => {
        const artist = String(entry.item.artistName || '').trim();
        if (artist) artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
        picked.push(entry);
    };

    for (const entry of scored) {
        if (picked.length >= total) break;
        const item = entry.item;
        const artist = String(item.artistName || '').trim();
        if (artist && (artistCounts.get(artist) || 0) >= 2) continue;
        if (entry.score <= -3) continue;
        pushItem(entry);
    }

    if (picked.length < total) {
        for (const entry of scored) {
            if (picked.length >= total) break;
            const exists = picked.some((p) => String(p.item._id) === String(entry.item._id));
            if (exists) continue;
            if (entry.score <= -4) continue;
            pushItem(entry);
        }
    }

    const items = picked.map((p) => ({
        itemId: p.item._id,
        score: Number(p.score) || 0,
        reasonTags: p.reasonTag ? [p.reasonTag] : [],
        source: p.item.source,
    }));

    const doc = await DailyRecommendation.findOneAndUpdate(
        { userId, date: dateKey },
        { $set: { items, algoVersion: 'v1', generatedAt: new Date() } },
        { upsert: true, new: true }
    );
    await persistUserProfile(userId, pref);
    return doc;
};

// 获取每日推荐（无则生成）
app.get('/api/recommendations/daily', auth, async (req, res) => {
    try {
        const userId = String(req.user.uid || '');
        const dateKey = buildDateKey(req.query?.date);
        let rec = await DailyRecommendation.findOne({ userId, date: dateKey })
            .populate('items.itemId')
            .lean();

        if (!rec) {
            const created = await generateDailyRecommendations(userId, dateKey);
            rec = await DailyRecommendation.findById(created._id)
                .populate('items.itemId')
                .lean();
        }

        const items = (rec?.items || []).map((entry) => {
            const item = entry.itemId || {};
            return {
                item: {
                    id: String(item._id || ''),
                    source: item.source,
                    sourceId: item.sourceId,
                    title: item.title,
                    artistName: item.artistName,
                    coverUrl: item.coverUrl,
                    audioUrl: item.audioUrl,
                    durationSec: item.durationSec,
                    styleTags: item.styleTags || [],
                },
                score: entry.score,
                reasonTags: entry.reasonTags || [],
            };
        });

        res.json({ date: rec?.date || dateKey, items, algoVersion: rec?.algoVersion || 'v1' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error' });
    }
});

// 手动重算每日推荐
app.post('/api/recommendations/rebuild', auth, async (req, res) => {
    try {
        const userId = String(req.user.uid || '');
        const dateKey = buildDateKey(req.body?.date || req.query?.date);
        const rec = await generateDailyRecommendations(userId, dateKey);
        res.json({ ok: true, date: rec.date, count: rec.items?.length || 0 });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error' });
    }
});

app.get('/api/auth/me', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.uid);
        if (!user) return res.status(404).json({ message: '用户不存在' });
        const userDat = user.toJSON(); delete userDat.password;
        res.json(userDat);
    } catch (err) { res.status(500).json({ message: 'Error' }); }
});
// --- 用户资料 ---
// 修改资料 (需要登录)
app.put('/api/users/me', auth, async (req, res) => {
    try {
        // 直接修改当前登录的用户，不允许修改别人
        const updates = req.body;
        const updatedUser = await User.findByIdAndUpdate(req.user.uid, {
            username: updates.username,
            bio: updates.bio,
            avatar: updates.avatar
        }, { new: true });

        const userDat = updatedUser.toJSON(); delete userDat.password;
        res.json(userDat);
    } catch (err) { res.status(500).json({ message: '更新失败' }); }
});

// ==========================================
//  🎼 AI 乐句素材库（MongoDB 持久化）
//  - 需要登录（JWT）
//  - GET /api/ai-chords
//  - POST /api/ai-chords
//  - DELETE /api/ai-chords/:id
// ==========================================
app.get('/api/ai-chords', auth, async (req, res) => {
    try {
        const list = await AiChordCollection.find({ user: req.user.uid })
            .sort({ createdAt: -1 })
            .lean();
        res.json(list);
    } catch (err) {
        res.status(500).json({ message: '加载失败' });
    }
});

app.post('/api/ai-chords', auth, async (req, res) => {
    try {
        const nameRaw = String(req.body?.name || '').trim();
        const prompt = String(req.body?.prompt || '').trim();
        const desc = String(req.body?.desc || '').trim();
        const chordsRaw = Array.isArray(req.body?.chords) ? req.body.chords : [];
        const bpm = Math.max(40, Math.min(240, Math.round(Number(req.body?.bpm) || 120)));
        const chordBeats = Math.max(1, Math.min(16, Number(req.body?.chordBeats) || 4));
        const melodyRaw = Array.isArray(req.body?.melody) ? req.body.melody : [];
        const genre = String(req.body?.genre || '').trim();
        const key = String(req.body?.key || '').trim();
        const scale = String(req.body?.scale || '').trim();
        const structure = String(req.body?.structure || '').trim();
        const sectionsRaw = Array.isArray(req.body?.sections) ? req.body.sections : [];

        const chords = chordsRaw
            .map((c) => {
                const chordName = String(c?.name || '').trim();
                const notes = Array.isArray(c?.notes) ? c.notes.map((n) => String(n)).filter(Boolean) : [];
                return { name: chordName, notes };
            })
            .filter((c) => c.notes.length > 0);

        const melody = melodyRaw
            .map((m) => {
                const note = String(m?.note || '').trim();
                const durBeatsNum = Number(m?.durBeats);
                const durBeats = Number.isFinite(durBeatsNum) ? Math.max(0.125, Math.min(16, durBeatsNum)) : 1;
                return { note, durBeats };
            })
            .filter((m) => m.note);

        const sections = sectionsRaw
            .map((s) => {
                const name = String(s?.name || '').trim();
                const label = String(s?.label || '').trim();
                const bars = Math.max(1, Math.min(128, Math.round(Number(s?.bars) || 8)));
                const chordsRaw2 = Array.isArray(s?.chords) ? s.chords : [];
                const melodyRaw2 = Array.isArray(s?.melody) ? s.melody : [];

                const chords2 = chordsRaw2
                    .map((c) => {
                        const chordName = String(c?.name || '').trim();
                        const notes = Array.isArray(c?.notes) ? c.notes.map((n) => String(n)).filter(Boolean) : [];
                        return { name: chordName, notes };
                    })
                    .filter((c) => c.notes.length > 0);

                const melody2 = melodyRaw2
                    .map((m) => {
                        const note = String(m?.note || '').trim();
                        const durBeatsNum = Number(m?.durBeats);
                        const durBeats = Number.isFinite(durBeatsNum) ? Math.max(0.125, Math.min(16, durBeatsNum)) : 1;
                        return { note, durBeats };
                    })
                    .filter((m) => m.note);

                return { name, label, bars, chords: chords2, melody: melody2 };
            })
            .filter((s) => s.chords.length || s.melody.length);

        if (!nameRaw && !prompt) {
            return res.status(400).json({ message: 'name 或 prompt 至少需要一个' });
        }
        if (chords.length === 0) {
            return res.status(400).json({ message: 'chords 不能为空' });
        }

        const doc = await AiChordCollection.create({
            user: req.user.uid,
            name: nameRaw || prompt.slice(0, 20) || '未命名素材',
            prompt,
            chords,
            bpm,
            chordBeats,
            melody,
            genre,
            key,
            scale,
            structure,
            sections,
            desc,
        });
        res.status(201).json(doc);
    } catch (err) {
        res.status(500).json({ message: '保存失败' });
    }
});

app.delete('/api/ai-chords/:id', auth, async (req, res) => {
    try {
        const id = String(req.params.id || '');
        if (!isValidObjectId(id)) return res.status(400).json({ message: 'Invalid id' });

        const deleted = await AiChordCollection.findOneAndDelete({ _id: id, user: req.user.uid });
        if (!deleted) return res.status(404).json({ message: '未找到或无权限' });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ message: '删除失败' });
    }
});

app.get('/api/ai-chords/:id', auth, async (req, res) => {
    try {
        const id = String(req.params.id || '');
        if (!isValidObjectId(id)) return res.status(400).json({ message: 'Invalid id' });

        const doc = await AiChordCollection.findOne({ _id: id, user: req.user.uid }).lean();
        if (!doc) return res.status(404).json({ message: '未找到或无权限' });
        res.json(doc);
    } catch (err) {
        res.status(500).json({ message: '加载失败' });
    }
});

app.put('/api/ai-chords/:id', auth, async (req, res) => {
    try {
        const id = String(req.params.id || '');
        if (!isValidObjectId(id)) return res.status(400).json({ message: 'Invalid id' });

        const nameRaw = String(req.body?.name || '').trim();
        const prompt = String(req.body?.prompt || '').trim();
        const desc = String(req.body?.desc || '').trim();
        const chordsRaw = Array.isArray(req.body?.chords) ? req.body.chords : [];
        const bpm = Math.max(40, Math.min(240, Math.round(Number(req.body?.bpm) || 120)));
        const chordBeats = Math.max(1, Math.min(16, Number(req.body?.chordBeats) || 4));
        const melodyRaw = Array.isArray(req.body?.melody) ? req.body.melody : [];
        const genre = String(req.body?.genre || '').trim();
        const key = String(req.body?.key || '').trim();
        const scale = String(req.body?.scale || '').trim();
        const structure = String(req.body?.structure || '').trim();
        const sectionsRaw = Array.isArray(req.body?.sections) ? req.body.sections : [];

        const chords = chordsRaw
            .map((c) => {
                const chordName = String(c?.name || '').trim();
                const notes = Array.isArray(c?.notes) ? c.notes.map((n) => String(n)).filter(Boolean) : [];
                return { name: chordName, notes };
            })
            .filter((c) => c.notes.length > 0);

        const melody = melodyRaw
            .map((m) => {
                const note = String(m?.note || '').trim();
                const durBeatsNum = Number(m?.durBeats);
                const durBeats = Number.isFinite(durBeatsNum) ? Math.max(0.125, Math.min(16, durBeatsNum)) : 1;
                return { note, durBeats };
            })
            .filter((m) => m.note);

        const sections = sectionsRaw
            .map((s) => {
                const name = String(s?.name || '').trim();
                const label = String(s?.label || '').trim();
                const bars = Math.max(1, Math.min(128, Math.round(Number(s?.bars) || 8)));
                const chordsRaw2 = Array.isArray(s?.chords) ? s.chords : [];
                const melodyRaw2 = Array.isArray(s?.melody) ? s.melody : [];

                const chords2 = chordsRaw2
                    .map((c) => {
                        const chordName = String(c?.name || '').trim();
                        const notes = Array.isArray(c?.notes) ? c.notes.map((n) => String(n)).filter(Boolean) : [];
                        return { name: chordName, notes };
                    })
                    .filter((c) => c.notes.length > 0);

                const melody2 = melodyRaw2
                    .map((m) => {
                        const note = String(m?.note || '').trim();
                        const durBeatsNum = Number(m?.durBeats);
                        const durBeats = Number.isFinite(durBeatsNum) ? Math.max(0.125, Math.min(16, durBeatsNum)) : 1;
                        return { note, durBeats };
                    })
                    .filter((m) => m.note);

                return { name, label, bars, chords: chords2, melody: melody2 };
            })
            .filter((s) => s.chords.length || s.melody.length);

        if (!nameRaw && !prompt) {
            return res.status(400).json({ message: 'name 或 prompt 至少需要一个' });
        }
        if (chords.length === 0) {
            return res.status(400).json({ message: 'chords 不能为空' });
        }

        const updated = await AiChordCollection.findOneAndUpdate(
            { _id: id, user: req.user.uid },
            {
                name: nameRaw || prompt.slice(0, 20) || '未命名素材',
                prompt,
                chords,
                bpm,
                chordBeats,
                melody,
                genre,
                key,
                scale,
                structure,
                sections,
                desc,
            },
            { new: true }
        );

        if (!updated) return res.status(404).json({ message: '未找到或无权限' });
        res.json(updated);
    } catch (err) {
        res.status(500).json({ message: '保存失败' });
    }
});
// 公开接口：获取用户公开信息（用于头像悬浮卡片等）
app.get('/api/users/:id/public', async (req, res) => {
    try {
        const id = String(req.params.id || '');
        if (!isValidObjectId(id)) return res.status(400).json({ message: 'Invalid user id' });

        const doc = await User.findById(id).select('username avatar bio createdAt following');
        if (!doc) return res.status(404).json({ message: 'User not found' });
        const followerCount = await User.countDocuments({ following: id });
        const followingCount = (doc.following || []).length;

        const payload = doc.toJSON();
        delete payload.following;
        res.json({ ...payload, followerCount, followingCount });
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});

// Public: list a user's published projects (for personal space page)
app.get('/api/users/:id/projects', optionalAuth, async (req, res) => {
    try {
        const targetId = String(req.params.id || '');
        if (!isValidObjectId(targetId)) return res.status(400).json({ message: 'Invalid user id' });

        const me = req.user?.uid ? String(req.user.uid) : '';
        if (me && (await hasBlockBetween(me, targetId))) {
            return res.status(403).json({ message: 'Blocked' });
        }

        const filterPublished = { $or: [{ status: 'published' }, { status: { $exists: false } }] };
        const list = await Project.find({ author: targetId, ...filterPublished })
            .populate('author', 'username avatar')
            .sort({ createdAt: -1 })
            .limit(50);

        res.json(list);
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});

// 获取与某用户的关系（关注/拉黑）
app.get('/api/users/:id/relationship', auth, async (req, res) => {
    try {
        const me = String(req.user.uid || '');
        const target = String(req.params.id || '');
        if (!isValidObjectId(target)) return res.status(400).json({ message: 'Invalid user id' });
        if (String(target) === String(me)) return res.json({ isFollowing: false, isBlocked: false, hasBlockedMe: false, isSelf: true });

        const [meDoc, targetDoc] = await Promise.all([
            User.findById(me).select('following blockedUsers'),
            User.findById(target).select('blockedUsers'),
        ]);
        if (!meDoc || !targetDoc) return res.status(404).json({ message: 'User not found' });

        const includesId = (arr, id) => (arr || []).some((x) => String(x) === String(id));
        const isFollowing = includesId(meDoc.following, target);
        const isBlocked = includesId(meDoc.blockedUsers, target);
        const hasBlockedMe = includesId(targetDoc.blockedUsers, me);

        res.json({ isFollowing, isBlocked, hasBlockedMe, isSelf: false });
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});

// 关注/取消关注
app.post('/api/users/:id/follow', auth, async (req, res) => {
    try {
        const me = String(req.user.uid || '');
        const target = String(req.params.id || '');
        if (!isValidObjectId(target)) return res.status(400).json({ message: 'Invalid user id' });
        if (String(target) === String(me)) return res.status(400).json({ message: 'Cannot follow yourself' });

        const [meDoc, targetDoc] = await Promise.all([
            User.findById(me).select('following blockedUsers'),
            User.findById(target).select('blockedUsers'),
        ]);
        if (!meDoc || !targetDoc) return res.status(404).json({ message: 'User not found' });

        const includesId = (arr, id) => (arr || []).some((x) => String(x) === String(id));
        const meBlocked = includesId(meDoc.blockedUsers, target);
        const blockedMe = includesId(targetDoc.blockedUsers, me);
        if (meBlocked || blockedMe) return res.status(403).json({ message: 'Blocked' });

        const wasFollowing = includesId(meDoc.following, target);
        if (wasFollowing) {
            await User.updateOne({ _id: me }, { $pull: { following: target } });
            return res.json({ isFollowing: false });
        }

        await User.updateOne({ _id: me }, { $addToSet: { following: target } });
        res.json({ isFollowing: true });
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});

// 拉黑/取消拉黑（拉黑时自动取消关注）
app.post('/api/users/:id/block', auth, async (req, res) => {
    try {
        const me = String(req.user.uid || '');
        const target = String(req.params.id || '');
        if (!isValidObjectId(target)) return res.status(400).json({ message: 'Invalid user id' });
        if (String(target) === String(me)) return res.status(400).json({ message: 'Cannot block yourself' });

        const meDoc = await User.findById(me).select('blockedUsers following');
        if (!meDoc) return res.status(404).json({ message: 'User not found' });

        const includesId = (arr, id) => (arr || []).some((x) => String(x) === String(id));
        const wasBlocked = includesId(meDoc.blockedUsers, target);
        if (wasBlocked) {
            await User.updateOne({ _id: me }, { $pull: { blockedUsers: target } });
            return res.json({ isBlocked: false });
        }

        await User.updateOne(
            { _id: me },
            { $addToSet: { blockedUsers: target }, $pull: { following: target } }
        );
        res.json({ isBlocked: true });
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});
app.post('/api/upload', auth, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: '无文件' });
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({ url: `${baseUrl}/uploads/${req.file.filename}` });
});

app.post('/api/upload/images', auth, postImageUpload.array('files', 6), (req, res) => {
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) return res.status(400).json({ message: '无文件' });
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const payload = files.map((f) => ({
        url: `${baseUrl}/uploads/post-images/${f.filename}`,
        size: Number(f.size || 0),
        mime: String(f.mimetype || ''),
        filename: String(f.filename || ''),
        originalName: String(f.originalname || ''),
    }));
    res.json({ files: payload, urls: payload.map((x) => x.url) });
});

// --- Custom Emojis ---
app.get('/api/emojis', auth, async (req, res) => {
    try {
        const me = String(req.user.uid || '');
        const user = await User.findById(me).select('customEmojis');
        const list = Array.isArray(user?.customEmojis) ? user.customEmojis : [];
        res.json(list.map((e) => ({
            id: String(e._id || ''),
            url: String(e.url || ''),
            name: String(e.name || ''),
            createdAt: e.createdAt,
        })));
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});

app.post('/api/emojis/upload', auth, emojiUpload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: '无文件' });
        const me = String(req.user.uid || '');
        const user = await User.findById(me).select('customEmojis');
        if (!user) return res.status(404).json({ message: 'User not found' });

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const url = `${baseUrl}/uploads/emojis/${req.file.filename}`;
        const rawName = String(req.body?.name || req.file.originalname || '').trim();
        const name = rawName.slice(0, 48);

        if ((user.customEmojis || []).length >= 80) {
            return res.status(400).json({ message: '自定义表情已达上限（80）' });
        }

        user.customEmojis.push({ url, name });
        await user.save();
        const last = user.customEmojis[user.customEmojis.length - 1];
        return res.status(201).json({
            id: String(last?._id || ''),
            url: String(last?.url || url),
            name: String(last?.name || name),
            createdAt: last?.createdAt || new Date(),
        });
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});

app.delete('/api/emojis/:id', auth, async (req, res) => {
    try {
        const me = String(req.user.uid || '');
        const id = String(req.params.id || '').trim();
        if (!isValidObjectId(id)) return res.status(400).json({ message: 'Invalid emoji id' });

        await User.updateOne({ _id: me }, { $pull: { customEmojis: { _id: id } } });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});

app.post('/api/upload/audio', auth, audioUpload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: '无文件' });
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({
        url: `${baseUrl}/uploads/${req.file.filename}`,
        size: Number(req.file.size || 0),
        mime: String(req.file.mimetype || ''),
        filename: String(req.file.filename || ''),
    });
});

// WAV -> MP3 转码（需要系统安装 ffmpeg）
app.post('/api/convert/mp3', auth, audioUpload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: '无文件' });
        const inputPath = req.file.path;
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const outputFilename = `mp3-${uniqueSuffix}.mp3`;
        const outputPath = path.join(uploadDir, outputFilename);

        const args = [
            '-y',
            '-i',
            inputPath,
            '-codec:a',
            'libmp3lame',
            '-q:a',
            '4',
            outputPath,
        ];

        const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += String(d || ''); });

        proc.on('error', (err) => {
            if (String(err?.code || '') === 'ENOENT') {
                return res.status(501).json({ message: '服务端未安装 ffmpeg，无法导出 MP3（请安装 ffmpeg 并加入 PATH）' });
            }
            return res.status(500).json({ message: '转码失败' });
        });

        proc.on('close', (code) => {
            if (code !== 0) {
                const detail = String(stderr || '').slice(0, 800);
                return res.status(500).json({ message: 'ffmpeg 转码失败', detail });
            }
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            return res.json({ url: `${baseUrl}/uploads/${outputFilename}` });
        });
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});

// 音频 -> 键位文字谱（低配友好：HPSS + piptrack）
app.post('/api/audio-to-sheet', auth, audioUpload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: '无文件' });

    const repoRoot = path.join(__dirname, '..');
    const scriptPath = path.join(repoRoot, 'tools', 'audio_to_sheet', 'main.py');
    if (!fs.existsSync(scriptPath)) {
        try { fs.unlinkSync(req.file.path); } catch { }
        return res.status(500).json({ message: '缺少转谱脚本' });
    }

    const maxSeconds = Math.max(5, Math.min(300, Number(req.body?.maxSeconds || 60)));
    const grid = Math.max(4, Math.min(32, Number(req.body?.grid || 16)));
    const polyphony = Math.max(1, Math.min(8, Number(req.body?.polyphony || 5)));
    const sr = Math.max(8000, Math.min(44100, Number(req.body?.sr || 22050)));
    const separate = String(req.body?.separate || 'hpss');

    const args = [
        scriptPath,
        '--input', req.file.path,
        '--json',
        '--max-seconds', String(maxSeconds),
        '--grid', String(grid),
        '--polyphony', String(polyphony),
        '--sr', String(sr),
        '--separate', separate,
    ];

    const child = spawn('python', args, { cwd: repoRoot });

    let stdout = '';
    let stderr = '';
    let responded = false;

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    child.on('error', (err) => {
        if (responded) return;
        responded = true;
        try { fs.unlinkSync(req.file.path); } catch { }
        return res.status(500).json({ message: '转谱失败（无法启动 Python）', detail: String(err?.message || err) });
    });

    child.on('close', (code) => {
        if (responded) return;
        responded = true;
        try { fs.unlinkSync(req.file.path); } catch { }

        if (code !== 0) {
            return res.status(500).json({ message: '转谱失败', detail: stderr || stdout });
        }

        try {
            const payload = JSON.parse((stdout || '').trim());
            if (!payload?.ok) return res.status(500).json({ message: '转谱失败', detail: payload });
            return res.json(payload);
        } catch (e) {
            return res.status(500).json({ message: '转谱失败（解析输出异常）', detail: stdout || stderr });
        }
    });
});
// --- 管理员 Admin API ---
app.get('/api/admin/stats', adminAuth, async (req, res) => {
    const [userCount, projectCount, commentCount] = await Promise.all([
        User.countDocuments(), Project.countDocuments(), Comment.countDocuments()
    ]);
    res.json({ userCount, projectCount, commentCount });
});
app.get('/api/admin/users', adminAuth, async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 });
    res.json(users);
});
app.delete('/api/admin/users/:id', adminAuth, async (req, res) => {
    await User.findByIdAndDelete(req.params.id);
    await Project.deleteMany({ author: req.params.id });
    await Comment.deleteMany({ author: req.params.id });
    res.json({ success: true });
});
app.get('/api/admin/projects', adminAuth, async (req, res) => {
    const projects = await Project.find().populate('author', 'username email').sort({ createdAt: -1 });
    res.json(projects);
});
app.delete('/api/admin/projects/:id', adminAuth, async (req, res) => {
    await Project.findByIdAndDelete(req.params.id);
    await Comment.deleteMany({ project: req.params.id });
    res.json({ success: true });
});
app.get('/api/admin/comments', adminAuth, async (req, res) => {
    const comments = await Comment.find().populate('author', 'username').populate('project', 'title').sort({ createdAt: -1 });
    res.json(comments);
});
app.delete('/api/admin/comments/:id', adminAuth, async (req, res) => {
    await Comment.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});
// 临时提权接口
app.get('/api/admin/setup', async (req, res) => {
    const { email } = req.query;
    const user = await User.findOneAndUpdate({ email }, { role: 'admin' }, { new: true });
    res.send(user ? `User ${user.username} is now admin` : 'User not found');
});
// --- 社区业务 (通知、作品、评论) ---
app.get('/api/notifications', auth, async (req, res) => {
    const blockedIds = await getBlockedUserIdsFor(req.user.uid);
    const query = {
        recipient: req.user.uid,
        ...(blockedIds.length ? { sender: { $nin: blockedIds } } : {}),
    };

    // Optional filter: ?types=followed_project,system (comma-separated)
    try {
        const rawTypes = String(req.query?.types || '').trim();
        if (rawTypes) {
            const types = rawTypes
                .split(',')
                .map((t) => String(t || '').trim())
                .filter(Boolean)
                .slice(0, 10);
            if (types.length) query.type = { $in: types };
        }
    } catch { }

    // Optional pagination: ?limit=20 (max 50). When omitted, returns all (backward compatible).
    let limit = null;
    try {
        if (req.query?.limit != null) {
            const n = Number(req.query?.limit);
            if (Number.isFinite(n)) limit = Math.max(1, Math.min(50, Math.floor(n)));
        }
    } catch { }

    const notifications = await Notification.find(query)
        .populate('sender', 'username avatar')
        .populate('project', 'title cover')
        .populate({
            path: 'post',
            select: 'content images project createdAt',
            populate: { path: 'project', select: 'title cover' },
        })
        .populate({
            path: 'comment',
            select: 'content likes parentId replyToUser createdAt author',
            populate: [
                { path: 'author', select: 'username avatar' },
                { path: 'replyToUser', select: 'username avatar' },
            ]
        })
        .sort({ createdAt: -1 })
        .limit(limit || 0);
    res.json(notifications);
});
app.get('/api/notifications/unread-count', auth, async (req, res) => {
    const blockedIds = await getBlockedUserIdsFor(req.user.uid);
    const baseQuery = {
        recipient: req.user.uid,
        isRead: false,
        ...(blockedIds.length ? { sender: { $nin: blockedIds } } : {}),
    };
    const [count, repliesCount, mentionsCount, likesCount, systemCount, followedProjectCount, followedPostCount] = await Promise.all([
        Notification.countDocuments(baseQuery),
        Notification.countDocuments({ ...baseQuery, type: { $in: ['comment_project', 'comment_post', 'reply'] } }),
        Notification.countDocuments({ ...baseQuery, type: 'mention' }),
        Notification.countDocuments({ ...baseQuery, type: { $in: ['like_project', 'like_comment'] } }),
        Notification.countDocuments({ ...baseQuery, type: 'system' }),
        Notification.countDocuments({ ...baseQuery, type: 'followed_project' }),
        Notification.countDocuments({ ...baseQuery, type: 'followed_post' }),
    ]);

    let chatCount = 0;
    try {
        const convQuery = blockedIds.length
            ? { $and: [{ participants: req.user.uid }, { participants: { $nin: blockedIds } }] }
            : { participants: req.user.uid };
        const convs = await Conversation.find(convQuery).select('_id');
        const convIds = (convs || []).map((c) => c._id);
        if (convIds.length) {
            chatCount = await Message.countDocuments({
                conversation: { $in: convIds },
                sender: { $ne: req.user.uid },
                readBy: { $ne: req.user.uid },
            });
        }
    } catch (e) {
        chatCount = 0;
    }

    res.json({
        count,
        chatCount,
        totalCount: count + chatCount,
        breakdown: {
            chat: chatCount,
            replies: repliesCount,
            mentions: mentionsCount,
            likes: likesCount,
            system: systemCount,
            followedProject: followedProjectCount,
            followedPost: followedPostCount,
        },
    });
});

// --- 动态帖子 ---
app.post('/api/posts', auth, async (req, res) => {
    try {
        const userId = String(req.user.uid || '');
        const content = String(req.body?.content || '').trim();
        const projectIdRaw = String(req.body?.projectId || '').trim();
        const incomingImages = Array.isArray(req.body?.imageUrls)
            ? req.body.imageUrls
            : Array.isArray(req.body?.images)
                ? req.body.images
                : [];

        if (content.length > 2000) return res.status(400).json({ message: '内容过长（最多 2000 字）' });

        const images = (incomingImages || [])
            .map((x) => (typeof x === 'string' ? x : x?.url))
            .map((x) => String(x || '').trim())
            .filter(Boolean)
            .slice(0, 6)
            .filter((url) => {
                if (url.includes('..')) return false;
                if (url.startsWith('/uploads/')) return true;
                if (/^https?:\/\//i.test(url)) return true;
                return false;
            })
            .map((url) => ({ url }));

        if (!content && !images.length) return res.status(400).json({ message: '内容不能为空' });

        let projectId = null;
        if (projectIdRaw) {
            if (!isValidObjectId(projectIdRaw)) return res.status(400).json({ message: 'Invalid project id' });
            const project = await Project.findById(projectIdRaw).select('status author');
            if (!project) return res.status(404).json({ message: 'Project not found' });
            const isOwner = String(project.author) === String(userId);
            if (project.status !== 'published' && !isOwner) return res.status(403).json({ message: 'Forbidden' });
            projectId = project._id;
        }

        const post = await Post.create({
            author: userId,
            content,
            project: projectId,
            images,
            updatedAt: new Date(),
        });

        // 通知关注者：你关注的人发布了新动态（同时给自己插一条已读，便于在动态页看到自己发布的内容）
        try {
            const authorDoc = await User.findById(userId).select('blockedUsers');
            const authorBlocked = (authorDoc?.blockedUsers || []).map((id) => String(id));

            const followers = await User.find({
                following: userId,
                blockedUsers: { $ne: userId },
                ...(authorBlocked.length ? { _id: { $nin: authorBlocked } } : {}),
            }).select('_id');

            const recipients = new Set([String(userId)]);
            (followers || []).forEach((f) => recipients.add(String(f._id)));

            const rows = [];
            for (const rid of recipients) {
                const isSelf = String(rid) === String(userId);
                const ok = isSelf ? true : await canSendNotification(rid, 'system', userId);
                if (!ok) continue;
                rows.push({
                    recipient: rid,
                    sender: userId,
                    type: 'followed_post',
                    post: post._id,
                    isRead: isSelf,
                });
            }
            if (rows.length) await Notification.insertMany(rows);
        } catch (e) {
            // ignore notify failures
        }

        const populated = await Post.findById(post._id)
            .populate('author', 'username avatar')
            .populate('project', 'title cover');

        res.status(201).json(populated || post);
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});

// Public: get post detail
app.get('/api/posts/:id', optionalAuth, async (req, res) => {
    try {
        const id = String(req.params.id || '').trim();
        if (!isValidObjectId(id)) return res.status(400).json({ message: 'Invalid post id' });

        const post = await Post.findById(id)
            .populate('author', 'username avatar')
            .populate('project', 'title cover');
        if (!post) return res.status(404).json({ message: 'Post not found' });

        const me = req.user?.uid ? String(req.user.uid) : '';
        const authorId = String(post.author?._id || post.author || '');
        if (me && authorId && (await hasBlockBetween(me, authorId))) {
            return res.status(404).json({ message: 'Post not found' });
        }

        res.json(post);
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});

// Public: list comments for a post
app.get('/api/posts/:id/comments', optionalAuth, async (req, res) => {
    try {
        const postId = String(req.params.id || '').trim();
        if (!isValidObjectId(postId)) return res.status(400).json({ message: 'Invalid post id' });

        const post = await Post.findById(postId).select('author');
        if (!post) return res.status(404).json({ message: 'Post not found' });

        const me = req.user?.uid ? String(req.user.uid) : '';
        const authorId = String(post.author || '');
        if (me && authorId && (await hasBlockBetween(me, authorId))) {
            return res.status(404).json({ message: 'Post not found' });
        }

        const blockedIds = req.user?.uid ? await getBlockedUserIdsFor(req.user.uid) : [];
        const query = {
            post: postId,
            ...(blockedIds.length ? { author: { $nin: blockedIds } } : {}),
        };
        const comments = await Comment.find(query)
            .populate('author', 'username avatar')
            .populate('replyToUser', 'username avatar')
            .sort({ createdAt: -1 });
        res.json(comments);
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});

// Comment on a post (supports replies)
app.post('/api/posts/:id/comments', auth, async (req, res) => {
    try {
        const userId = String(req.user.uid);
        const postId = String(req.params.id || '').trim();
        if (!isValidObjectId(postId)) return res.status(400).json({ message: 'Invalid post id' });

        const post = await Post.findById(postId).select('author');
        if (!post) return res.status(404).json({ message: 'Post not found' });

        const content = String(req.body?.content || '').trim();
        if (!content) return res.status(400).json({ message: '评论不能为空' });
        if (content.length > 2000) return res.status(400).json({ message: '评论过长（最多 2000 字）' });

        const parentId = String(req.body?.parentId || '').trim();
        const replyToUserId = String(req.body?.replyToUserId || req.body?.replyToUser || '').trim();

        if (parentId && !isValidObjectId(parentId)) return res.status(400).json({ message: 'Invalid parentId' });
        if (replyToUserId && !isValidObjectId(replyToUserId)) return res.status(400).json({ message: 'Invalid replyToUserId' });

        if (parentId) {
            const parent = await Comment.findById(parentId).select('post');
            if (!parent || String(parent.post || '') !== postId) {
                return res.status(400).json({ message: 'Invalid parent comment' });
            }
        }

        const newComment = await Comment.create({
            content,
            author: userId,
            post: postId,
            project: null,
            parentId: parentId || null,
            replyToUser: replyToUserId || null,
        });

        const notifiedRecipients = new Set();

        if (replyToUserId && replyToUserId !== userId) {
            const ok = await canSendNotification(replyToUserId, 'replies', userId);
            if (ok) {
                await Notification.create({
                    recipient: replyToUserId,
                    sender: userId,
                    type: 'reply',
                    post: postId,
                    comment: newComment._id,
                });
                notifiedRecipients.add(String(replyToUserId));
            }
        } else {
            const ownerId = String(post.author || '');
            if (ownerId && ownerId !== userId) {
                const ok = await canSendNotification(ownerId, 'replies', userId);
                if (ok) {
                    await Notification.create({
                        recipient: ownerId,
                        sender: userId,
                        type: 'comment_post',
                        post: postId,
                        comment: newComment._id,
                    });
                    notifiedRecipients.add(ownerId);
                }
            }
        }

        const mentionNames = Array.from(
            new Set(
                Array.from(content.matchAll(/@([\w\u4e00-\u9fa5]{1,32})/g))
                    .map((m) => m[1])
                    .filter(Boolean)
            )
        ).slice(0, 8);

        if (mentionNames.length) {
            const mentionedUsers = await User.find({ username: { $in: mentionNames } }).select('_id');
            for (const u of mentionedUsers) {
                const rid = String(u._id);
                if (rid === String(userId)) continue;
                if (rid === String(replyToUserId || '')) continue;
                if (notifiedRecipients.has(rid)) continue;

                const ok = await canSendNotification(rid, 'mentions', userId);
                if (!ok) continue;

                await Notification.create({
                    recipient: rid,
                    sender: userId,
                    type: 'mention',
                    post: postId,
                    comment: newComment._id,
                });
                notifiedRecipients.add(rid);
            }
        }

        const populated = await newComment.populate([
            { path: 'author', select: 'username avatar' },
            { path: 'replyToUser', select: 'username avatar' },
        ]);
        res.status(201).json(populated);
    } catch (err) {
        res.status(500).json({ message: '评论失败' });
    }
});

// 标记已读：支持按类型批量标记（不传 types 则全部标记）
app.put('/api/notifications/read', auth, async (req, res) => {
    try {
        const incoming = req.body || {};
        const types = Array.isArray(incoming.types) ? incoming.types.filter(Boolean) : null;
        const query = {
            recipient: req.user.uid,
            isRead: false,
            ...(types && types.length ? { type: { $in: types } } : {}),
        };
        await Notification.updateMany(query, { isRead: true });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});
app.put('/api/notifications/read-all', auth, async (req, res) => {
    await Notification.updateMany({ recipient: req.user.uid, isRead: false }, { isRead: true });
    res.json({ success: true });
});
// 删除单条通知 (需要登录)
app.delete('/api/notifications/:id', auth, async (req, res) => {
    try {
        const deleted = await Notification.findOneAndDelete({ _id: req.params.id, recipient: req.user.uid });
        if (!deleted) return res.status(404).json({ message: '通知不存在' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});
// 清空通知 (需要登录)
app.delete('/api/notifications', auth, async (req, res) => {
    try {
        const result = await Notification.deleteMany({ recipient: req.user.uid });
        res.json({ success: true, deletedCount: result.deletedCount || 0 });
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});
// 获取工程文件（编辑器读取，仅作者可见）
app.get('/api/projects/:id/source', auth, async (req, res) => {
    try {
        const project = await Project.findById(req.params.id)
            .select('+projectData')
            .populate('author', 'username avatar');
        if (!project) return res.status(404).json({ message: '作品不存在' });
        if (String(project.author?._id || project.author) !== String(req.user.uid)) {
            return res.status(403).json({ message: '无权限' });
        }
        res.json({
            project: project.projectData,
            meta: {
                id: project._id,
                title: project.title,
                cover: project.cover,
                tags: project.tags || [],
                status: project.status,
                updatedAt: project.updatedAt,
            },
        });
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});

// 保存草稿（编辑器自动保存）
app.post('/api/projects/draft', auth, async (req, res) => {
    try {
        const payload = req.body || {};
        const projectData = payload.project || payload.projectData || null;
        const title = String(payload.title || projectData?.meta?.title || '').trim() || 'Untitled';
        const cover = String(payload.cover || '').trim();
        const tags = Array.isArray(payload.tags)
            ? payload.tags.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 10)
            : [];

        const project = await Project.create({
            title,
            author: String(req.user.uid),
            cover,
            tags,
            status: 'draft',
            projectData,
            updatedAt: new Date(),
        });

        const populated = await Project.findById(project._id).populate('author', 'username avatar');
        res.status(201).json(populated || project);
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});

// 更新草稿（编辑器自动保存）
app.put('/api/projects/:id/draft', auth, async (req, res) => {
    try {
        const project = await Project.findById(req.params.id).select('+projectData');
        if (!project) return res.status(404).json({ message: '作品不存在' });
        if (String(project.author) !== String(req.user.uid)) {
            return res.status(403).json({ message: '无权限' });
        }

        const payload = req.body || {};
        const projectData = payload.project || payload.projectData || null;
        if (projectData) project.projectData = projectData;
        if (payload.title != null) project.title = String(payload.title || '').trim() || project.title;
        if (payload.cover != null) project.cover = String(payload.cover || '').trim();
        if (payload.tags != null) {
            project.tags = Array.isArray(payload.tags)
                ? payload.tags.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 10)
                : project.tags;
        }
        if (payload.status === 'published' || payload.status === 'draft') {
            project.status = payload.status;
        }
        project.updatedAt = new Date();

        await project.save();
        const populated = await Project.findById(project._id).populate('author', 'username avatar');
        res.json(populated || project);
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});

// 发布作品（含工程文件 + 试听音频）
app.post('/api/projects/publish', auth, audioUpload.single('audio'), async (req, res) => {
    try {
        const userId = String(req.user.uid);
        const title = String(req.body?.title || '').trim();
        const cover = String(req.body?.cover || '').trim();
        const audioKind = String(req.body?.audioKind || 'stem').trim() || 'stem';
        const tags = (() => {
            const raw = req.body?.tags;
            if (!raw) return [];
            if (Array.isArray(raw)) return raw.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 10);
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 10);
            } catch { }
            return String(raw || '')
                .split(/[,，\s]+/g)
                .map((t) => String(t || '').trim())
                .filter(Boolean)
                .slice(0, 10);
        })();

        if (!title) return res.status(400).json({ message: '标题不能为空' });

        let projectData = null;
        try {
            projectData = req.body?.project ? JSON.parse(req.body.project) : null;
        } catch {
            projectData = null;
        }
        if (!projectData) return res.status(400).json({ message: '工程文件缺失或格式错误' });

        const audioFile = req.file || null;
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const audioUrl = audioFile ? `${baseUrl}/uploads/${audioFile.filename}` : '';
        const audioMeta = audioFile
            ? {
                durationSec: Math.max(0, Number(req.body?.durationSec) || 0),
                size: Number(audioFile.size || 0),
                mime: String(audioFile.mimetype || ''),
            }
            : { durationSec: Math.max(0, Number(req.body?.durationSec) || 0), size: 0, mime: '' };

        // Keep projectData editable (stems are expected to be uploaded separately by the client).
        // Backward-compatible behavior: if audioKind=stem, patch the first local audio asset url.
        try {
            if (projectData && typeof projectData === 'object' && projectData.meta && typeof projectData.meta === 'object') {
                projectData.meta.title = title;
                projectData.meta.updatedAt = new Date().toISOString();
            }
        } catch { }
        try {
            if (audioKind === 'stem' && audioUrl && projectData && typeof projectData === 'object') {
                const assets = Array.isArray(projectData.assets) ? projectData.assets.slice() : [];
                const prefer = (a) => {
                    if (!a || typeof a !== 'object') return false;
                    if (String(a.type || '') !== 'audio') return false;
                    const url = String(a.url || '');
                    const hash = String(a.hash || '');
                    return url.startsWith('blob:') || hash.startsWith('local:') || !url;
                };
                let idx = assets.findIndex(prefer);
                if (idx === -1) idx = assets.findIndex((a) => a && typeof a === 'object' && String(a.type || '') === 'audio');
                if (idx !== -1) {
                    const prev = assets[idx] || {};
                    assets[idx] = {
                        ...prev,
                        url: audioUrl,
                        hash: `upload:${String(audioFile?.filename || '')}:${Number(audioMeta.size || 0)}`,
                        duration: prev?.duration != null ? Number(prev.duration) : Number(audioMeta.durationSec || 0),
                    };
                    projectData.assets = assets;
                }
            }
        } catch { }

        const incomingId = String(req.body?.projectId || '').trim();
        let project = null;
        let wasPublished = false;
        if (incomingId && mongoose.Types.ObjectId.isValid(incomingId)) {
            project = await Project.findById(incomingId).select('+projectData');
            wasPublished = Boolean(project && String(project.status || 'draft') === 'published');
            if (!project) return res.status(404).json({ message: '作品不存在' });
            if (String(project.author) !== userId) return res.status(403).json({ message: '无权限' });
        }

        if (!project) {
            project = new Project({ author: userId });
        }

        project.title = title;
        project.cover = cover;
        project.tags = tags;
        project.status = 'published';
        project.projectData = projectData;
        if (audioUrl) project.audioUrl = audioUrl;
        project.audioMeta = audioMeta;
        project.updatedAt = new Date();

        await project.save();

        // Version tracking: create a new publish version and move head.
        try {
            const versionId = createVersionId();
            await ProjectVersion.create({
                project: project._id,
                versionId,
                parentVersionId: String(project.headVersionId || ''),
                kind: 'publish',
                author: userId,
                projectData,
            });
            project.headVersionId = versionId;
            try {
                if (project.projectData && typeof project.projectData === 'object') {
                    project.projectData.fork = project.projectData.fork && typeof project.projectData.fork === 'object'
                        ? project.projectData.fork
                        : {};
                    project.projectData.fork.versionId = versionId;
                }
            } catch { }
            await project.save();
        } catch {
            // ignore version failures (MVP)
        }

        // 通知关注者：你关注的人发布了新作品
        if (!wasPublished) {
            try {
                const authorDoc = await User.findById(userId).select('blockedUsers');
                const authorBlocked = (authorDoc?.blockedUsers || []).map((id) => String(id));

                const followers = await User.find({
                    following: userId,
                    blockedUsers: { $ne: userId },
                    ...(authorBlocked.length ? { _id: { $nin: authorBlocked } } : {}),
                }).select('_id');

                const recipients = [];
                for (const f of followers || []) {
                    const rid = String(f._id);
                    const ok = await canSendNotification(rid, 'system', userId);
                    if (ok) recipients.push(rid);
                }

                if (recipients.length) {
                    await Notification.insertMany(
                        recipients.map((rid) => ({
                            recipient: rid,
                            sender: userId,
                            type: 'followed_project',
                            project: project._id,
                        }))
                    );
                }
            } catch {
                // ignore notify failures
            }
        }

        const populated = await Project.findById(project._id).populate('author', 'username avatar');
        res.status(201).json(populated || project);
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});

// Fork：从公开作品复制一个可编辑草稿（记录谱系 + 版本来源）
app.post('/api/projects/:id/fork', auth, async (req, res) => {
    try {
        const me = String(req.user.uid);
        const sourceId = String(req.params.id || '');
        if (!isValidObjectId(sourceId)) return res.status(400).json({ message: 'Invalid project id' });

        const source = await Project.findById(sourceId).select('+projectData').populate('author', 'username avatar');
        if (!source) return res.status(404).json({ message: '作品不存在' });
        const isPublished = String(source.status || 'published') === 'published';
        if (!isPublished) return res.status(404).json({ message: '作品不存在' });

        const rootId = source.forkRoot ? String(source.forkRoot) : String(source._id);
        const fromVersionId = String(source.headVersionId || '');

        let cloned = null;
        try {
            cloned = source.projectData ? JSON.parse(JSON.stringify(source.projectData)) : null;
        } catch {
            cloned = null;
        }
        if (!cloned || typeof cloned !== 'object') cloned = {};

        const nowIso = new Date().toISOString();
        cloned.meta = cloned.meta && typeof cloned.meta === 'object' ? cloned.meta : {};
        cloned.meta.title = String(cloned.meta.title || source.title || '').trim() || 'Untitled';
        cloned.meta.owner = me;
        cloned.meta.createdAt = nowIso;
        cloned.meta.updatedAt = nowIso;

        cloned.fork = cloned.fork && typeof cloned.fork === 'object' ? cloned.fork : {};
        cloned.fork.parentProjectId = sourceId;
        cloned.fork.rootProjectId = rootId;
        cloned.fork.forkFromVersionId = fromVersionId || null;

        const child = await Project.create({
            title: `Fork - ${String(source.title || 'Untitled')}`.slice(0, 80),
            author: me,
            cover: String(source.cover || ''),
            tags: Array.isArray(source.tags) ? source.tags.slice(0, 10) : [],
            status: 'draft',
            projectData: cloned,
            forkParent: source._id,
            forkRoot: isValidObjectId(rootId) ? rootId : source._id,
            forkFromVersionId: fromVersionId,
            updatedAt: new Date(),
        });

        // Patch meta.id to the new draft id
        try {
            const next = await Project.findById(child._id).select('+projectData');
            if (next?.projectData && typeof next.projectData === 'object') {
                next.projectData.meta = next.projectData.meta && typeof next.projectData.meta === 'object' ? next.projectData.meta : {};
                next.projectData.meta.id = String(child._id);
                next.projectData.fork = next.projectData.fork && typeof next.projectData.fork === 'object' ? next.projectData.fork : {};
                next.projectData.fork.parentProjectId = sourceId;
                next.projectData.fork.rootProjectId = rootId;
                next.projectData.fork.forkFromVersionId = fromVersionId || null;
                await next.save();
            }
        } catch {
            // ignore
        }

        // Create fork version head.
        try {
            const versionId = createVersionId();
            await ProjectVersion.create({
                project: child._id,
                versionId,
                parentVersionId: fromVersionId,
                kind: 'fork',
                author: me,
                projectData: cloned,
            });
            await Project.findByIdAndUpdate(child._id, { headVersionId: versionId });
            try {
                const doc = await Project.findById(child._id).select('+projectData');
                if (doc?.projectData && typeof doc.projectData === 'object') {
                    doc.projectData.fork = doc.projectData.fork && typeof doc.projectData.fork === 'object' ? doc.projectData.fork : {};
                    doc.projectData.fork.versionId = versionId;
                    await doc.save();
                }
            } catch { }
        } catch {
            // ignore
        }

        const populated = await Project.findById(child._id).populate('author', 'username avatar');
        res.status(201).json({ id: String(child._id), project: populated || child, parentId: sourceId, rootId });
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});

// 公开接口：获取作品 Fork 谱系（parent + children）
app.get('/api/projects/:id/lineage', optionalAuth, async (req, res) => {
    try {
        const id = String(req.params.id || '');
        if (!isValidObjectId(id)) return res.status(400).json({ message: 'Invalid project id' });

        const blockedIds = req.user?.uid ? await getBlockedUserIdsFor(req.user.uid) : [];

        const project = await Project.findById(id).select('forkParent forkRoot author status');
        if (!project) return res.status(404).json({ message: '作品不存在' });

        const isOwner = req.user?.uid && String(project.author) === String(req.user.uid);
        const isPublished = String(project.status || 'published') === 'published';
        if (!isPublished && !isOwner) return res.status(404).json({ message: '作品不存在' });

        const filterPublished = { $or: [{ status: 'published' }, { status: { $exists: false } }] };
        const authorFilter = blockedIds.length ? { author: { $nin: blockedIds } } : {};

        let parent = null;
        if (project.forkParent) {
            parent = await Project.findOne({
                _id: project.forkParent,
                ...filterPublished,
                ...authorFilter,
            })
                .populate('author', 'username avatar')
                .select('title cover author audioUrl createdAt');
        }

        const children = await Project.find({
            forkParent: project._id,
            ...filterPublished,
            ...authorFilter,
        })
            .populate('author', 'username avatar')
            .select('title cover author audioUrl createdAt')
            .sort({ createdAt: -1 })
            .limit(18);

        res.json({
            parent,
            rootId: project.forkRoot ? String(project.forkRoot) : String(project._id),
            children,
        });
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});

// 公开接口：获取作品列表
app.get('/api/projects', optionalAuth, async (req, res) => {
    const blockedIds = req.user?.uid ? await getBlockedUserIdsFor(req.user.uid) : [];
    const author = String(req.query.author || req.query.authorId || '').trim();
    if (author && !isValidObjectId(author)) return res.status(400).json({ message: 'Invalid author id' });

    const query = {
        $or: [{ status: 'published' }, { status: { $exists: false } }],
    };

    if (author) {
        if (blockedIds.some((id) => String(id) === author)) return res.json([]);
        query.author = author;
    } else if (blockedIds.length) {
        query.author = { $nin: blockedIds };
    }
    const projects = await Project.find(query).populate('author', 'username avatar').sort({ createdAt: -1 });
    res.json(projects);
});
// 发布作品 (需要登录)
app.post('/api/projects', auth, async (req, res) => {
    try {
        const userId = String(req.user.uid);
        const title = String(req.body?.title || '').trim();
        const cover = String(req.body?.cover || '').trim();
        const tags = Array.isArray(req.body?.tags)
            ? req.body.tags.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 10)
            : [];
        const projectData = req.body?.project || req.body?.projectData || null;
        const audioUrl = String(req.body?.audioUrl || '').trim();
        const audioMeta = req.body?.audioMeta && typeof req.body.audioMeta === 'object' ? req.body.audioMeta : null;

        if (!title) return res.status(400).json({ message: '标题不能为空' });

        const project = await Project.create({
            title,
            author: userId,
            cover,
            tags,
            status: 'published',
            projectData,
            audioUrl,
            audioMeta,
            updatedAt: new Date(),
        });

        // 通知关注者：你关注的人发布了新作品
        try {
            const authorDoc = await User.findById(userId).select('blockedUsers');
            const authorBlocked = (authorDoc?.blockedUsers || []).map((id) => String(id));

            const followers = await User.find({
                following: userId,
                blockedUsers: { $ne: userId }, // 关注者没有拉黑作者
                ...(authorBlocked.length ? { _id: { $nin: authorBlocked } } : {}), // 作者没有拉黑关注者
            }).select('_id');

            const recipients = [];
            for (const f of followers || []) {
                const rid = String(f._id);
                const ok = await canSendNotification(rid, 'system', userId);
                if (ok) recipients.push(rid);
            }

            if (recipients.length) {
                await Notification.insertMany(
                    recipients.map((rid) => ({
                        recipient: rid,
                        sender: userId,
                        type: 'followed_project',
                        project: project._id,
                    }))
                );
            }
        } catch (e) {
            // ignore notify failures
        }

        const populated = await Project.findById(project._id).populate('author', 'username avatar');
        res.status(201).json(populated || project);
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});
// 公开接口：获取单个作品详情
app.get('/api/projects/:id', optionalAuth, async (req, res) => {
    try {
        const project = await Project.findById(req.params.id).populate('author', 'username avatar');
        if (!project) return res.status(404).json({ message: '作品不存在' });
        const isOwner = req.user?.uid && String(project.author?._id || project.author) === String(req.user.uid);
        if (project.status !== 'published' && !isOwner) {
            return res.status(404).json({ message: '作品不存在' });
        }
        if (req.user?.uid) {
            const blockedIds = await getBlockedUserIdsFor(req.user.uid);
            if (blockedIds.some((id) => String(id) === String(project.author?._id || project.author))) {
                return res.status(404).json({ message: '作品不存在' });
            }
        }
        res.json(project);
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});

// 公开接口：搜索（作品 + 用户）
app.get('/api/search', optionalAuth, async (req, res) => {
    try {
        const raw = String(req.query.q || '').trim();
        const q = raw.slice(0, 64);
        if (!q) return res.json({ q: '', projects: [], users: [] });

        const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 12, 1), 50);

        const escapeRegExp = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapeRegExp(q), 'i');

        const blockedIds = req.user?.uid ? await getBlockedUserIdsFor(req.user.uid) : [];
        const projectQuery = {
            $and: [
                { $or: [{ status: 'published' }, { status: { $exists: false } }] },
                { $or: [{ title: regex }, { tags: regex }] },
                ...(blockedIds.length ? [{ author: { $nin: blockedIds } }] : []),
            ],
        };
        const userQuery = {
            $and: [
                { $or: [{ username: regex }, { bio: regex }] },
                ...(blockedIds.length ? [{ _id: { $nin: blockedIds } }] : []),
            ],
        };

        const [projects, users] = await Promise.all([
            Project.find(projectQuery)
                .populate('author', 'username avatar')
                .sort({ createdAt: -1 })
                .limit(limit),
            User.find(userQuery)
                .select('username avatar bio createdAt')
                .sort({ createdAt: -1 })
                .limit(limit),
        ]);

        res.json({ q, projects, users });
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});
// 点赞 (需要登录)
app.post('/api/projects/:id/like', auth, async (req, res) => {
    try {
        const userId = req.user.uid; // ✅ 从 Token 获取 ID，安全！
        const project = await Project.findById(req.params.id);
        if (!project) return res.status(404).json({ message: '作品不存在' });
        if (String(project.status || 'published') !== 'published' && String(project.author) !== String(userId)) {
            return res.status(404).json({ message: '作品不存在' });
        }
        const index = project.likes.indexOf(userId);

        if (index === -1) {
            project.likes.push(userId);
            if (project.author.toString() !== userId) {
                const ok = await canSendNotification(project.author, 'likes', userId);
                if (ok) {
                    await Notification.create({ recipient: project.author, sender: userId, type: 'like_project', project: project._id });
                }
            }
        } else {
            project.likes.splice(index, 1);
        }
        await project.save();
        res.json({ success: true, likesCount: project.likes.length, isLiked: index === -1 });
    } catch (err) { res.status(500).json({ message: '操作失败' }); }
});
// 获取评论 (公开)
app.get('/api/projects/:id/comments', optionalAuth, async (req, res) => {
    try {
        const project = await Project.findById(req.params.id).select('author status');
        if (!project) return res.status(404).json({ message: '作品不存在' });
        const isOwner = req.user?.uid && String(project.author) === String(req.user.uid);
        if (String(project.status || 'published') !== 'published' && !isOwner) {
            return res.status(404).json({ message: '作品不存在' });
        }

        const blockedIds = req.user?.uid ? await getBlockedUserIdsFor(req.user.uid) : [];
        const query = {
            project: req.params.id,
            ...(blockedIds.length ? { author: { $nin: blockedIds } } : {}),
        };
        const comments = await Comment.find(query)
            .populate('author', 'username avatar')
            .populate('replyToUser', 'username avatar')
            .sort({ createdAt: -1 });
        res.json(comments);
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});
// 发表评论 (需要登录)
app.post('/api/projects/:id/comments', auth, async (req, res) => {
    try {
        const userId = req.user.uid; // ✅ 从 Token 获取
        const { content, parentId, replyToUserId } = req.body;
        const projectDoc = await Project.findById(req.params.id).select('author status');
        if (!projectDoc) return res.status(404).json({ message: '作品不存在' });
        if (String(projectDoc.status || 'published') !== 'published' && String(projectDoc.author) !== String(userId)) {
            return res.status(404).json({ message: '作品不存在' });
        }

        const newComment = new Comment({
            content, author: userId, project: req.params.id,
            parentId: parentId || null, replyToUser: replyToUserId || null
        });
        await newComment.save();

        // 通知逻辑
        const notifiedRecipients = new Set();

        if (replyToUserId && replyToUserId !== userId) {
            const ok = await canSendNotification(replyToUserId, 'replies', userId);
            if (ok) {
                await Notification.create({ recipient: replyToUserId, sender: userId, type: 'reply', project: req.params.id, comment: newComment._id });
                notifiedRecipients.add(String(replyToUserId));
            }
        } else {
            const project = await Project.findById(req.params.id);
            if (project && project.author.toString() !== userId) {
                const ok = await canSendNotification(project.author, 'replies', userId);
                if (ok) {
                    await Notification.create({ recipient: project.author, sender: userId, type: 'comment_project', project: project._id, comment: newComment._id });
                    notifiedRecipients.add(String(project.author));
                }
            }
        }

        const mentionNames = Array.from(
            new Set(
                Array.from(String(content || '').matchAll(/@([\w\u4e00-\u9fa5]{1,32})/g))
                    .map((m) => m[1])
                    .filter(Boolean)
            )
        ).slice(0, 8);

        if (mentionNames.length) {
            const mentionedUsers = await User.find({ username: { $in: mentionNames } }).select('_id');
            for (const u of mentionedUsers) {
                const rid = String(u._id);
                if (rid === String(userId)) continue;
                if (rid === String(replyToUserId || '')) continue;
                if (notifiedRecipients.has(rid)) continue;

                const ok = await canSendNotification(rid, 'mentions', userId);
                if (!ok) continue;

                await Notification.create({ recipient: rid, sender: userId, type: 'mention', project: req.params.id, comment: newComment._id });
                notifiedRecipients.add(rid);
            }
        }

        const populated = await newComment.populate([{ path: 'author', select: 'username avatar' }, { path: 'replyToUser', select: 'username avatar' }]);
        res.status(201).json(populated);
    } catch (err) { res.status(500).json({ message: '评论失败' }); }
});
// 评论点赞 (需要登录)
app.post('/api/comments/:id/like', auth, async (req, res) => {
    try {
        const userId = req.user.uid; // ✅ 从 Token 获取
        const comment = await Comment.findById(req.params.id);
        const index = comment.likes.indexOf(userId);

        if (index === -1) {
            comment.likes.push(userId);
            if (comment.author.toString() !== userId) {
                const ok = await canSendNotification(comment.author, 'likes', userId);
                if (ok) {
                    await Notification.create({
                        recipient: comment.author,
                        sender: userId,
                        type: 'like_comment',
                        project: comment.project || undefined,
                        post: comment.post || undefined,
                        comment: comment._id,
                    });
                }
            }
        } else {
            comment.likes.splice(index, 1);
        }
        await comment.save();
        res.json({ success: true, likesCount: comment.likes.length, isLiked: index === -1 });
    } catch (err) { res.status(500).json({ message: '操作失败' }); }
});
// --- Chat (Private Messages) ---
app.post('/api/chats/with/:userId', auth, async (req, res) => {
    try {
        const me = String(req.user.uid);
        const peerId = String(req.params.userId);

        if (!isValidObjectId(peerId)) return res.status(400).json({ message: 'Invalid userId' });
        if (peerId === me) return res.status(400).json({ message: 'Cannot chat with yourself' });
        if (await hasBlockBetween(me, peerId)) return res.status(403).json({ message: 'Blocked' });

        const peer = await User.findById(peerId).select('username avatar');
        if (!peer) return res.status(404).json({ message: 'User not found' });

        const pairKey = [me, peerId].sort().join(':');

        let conversation = await Conversation.findOne({ pairKey })
            .populate('participants', 'username avatar')
            .populate({ path: 'lastMessage', populate: { path: 'sender', select: 'username avatar' } });

        if (!conversation) {
            conversation = await Conversation.create({
                pairKey,
                participants: [me, peerId],
                lastMessage: null,
                lastMessageAt: null,
            });
            conversation = await Conversation.findById(conversation._id)
                .populate('participants', 'username avatar')
                .populate({ path: 'lastMessage', populate: { path: 'sender', select: 'username avatar' } });
        }

        res.json(conversation);
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});

app.get('/api/chats', auth, async (req, res) => {
    try {
        const me = String(req.user.uid);
        const blockedIds = await getBlockedUserIdsFor(me);
        const convQuery = blockedIds.length
            ? { $and: [{ participants: me }, { participants: { $nin: blockedIds } }] }
            : { participants: me };

        const conversations = await Conversation.find(convQuery)
            .populate('participants', 'username avatar')
            .populate({ path: 'lastMessage', populate: { path: 'sender', select: 'username avatar' } })
            .sort({ lastMessageAt: -1, updatedAt: -1 });

        const withUnread = await Promise.all(
            conversations.map(async (conv) => {
                const unreadCount = await Message.countDocuments({
                    conversation: conv._id,
                    sender: { $ne: me },
                    readBy: { $ne: me },
                });
                return { ...conv.toJSON(), unreadCount };
            })
        );

        res.json(withUnread);
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});

app.get('/api/chats/:id/messages', auth, async (req, res) => {
    try {
        const me = String(req.user.uid);
        const conversationId = String(req.params.id);
        if (!isValidObjectId(conversationId)) return res.status(400).json({ message: 'Invalid conversation id' });

        const conversation = await Conversation.findById(conversationId).select('participants');
        if (!conversation) return res.status(404).json({ message: 'Conversation not found' });
        const isMember = (conversation.participants || []).some((p) => String(p) === me);
        if (!isMember) return res.status(403).json({ message: 'Forbidden' });
        const peerId = (conversation.participants || []).map(String).find((p) => p !== me) || '';
        if (peerId && (await hasBlockBetween(me, peerId))) return res.status(403).json({ message: 'Blocked' });

        const messages = await Message.find({ conversation: conversationId })
            .populate('sender', 'username avatar')
            .sort({ createdAt: 1 });
        res.json(messages);
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});

app.put('/api/chats/:id/read', auth, async (req, res) => {
    try {
        const me = String(req.user.uid);
        const conversationId = String(req.params.id);
        if (!isValidObjectId(conversationId)) return res.status(400).json({ message: 'Invalid conversation id' });

        const conversation = await Conversation.findById(conversationId).select('participants');
        if (!conversation) return res.status(404).json({ message: 'Conversation not found' });
        const isMember = (conversation.participants || []).some((p) => String(p) === me);
        if (!isMember) return res.status(403).json({ message: 'Forbidden' });
        const peerId = (conversation.participants || []).map(String).find((p) => p !== me) || '';
        if (peerId && (await hasBlockBetween(me, peerId))) return res.status(403).json({ message: 'Blocked' });

        await Message.updateMany(
            { conversation: conversationId, sender: { $ne: me }, readBy: { $ne: me } },
            { $addToSet: { readBy: me } }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});

app.post('/api/chats/:id/messages', auth, async (req, res) => {
    try {
        const me = String(req.user.uid);
        const conversationId = String(req.params.id);
        if (!isValidObjectId(conversationId)) return res.status(400).json({ message: 'Invalid conversation id' });

        const content = String(req.body?.content || '').trim();
        if (!content) return res.status(400).json({ message: 'Content is required' });

        const conversation = await Conversation.findById(conversationId).select('participants');
        if (!conversation) return res.status(404).json({ message: 'Conversation not found' });
        const isMember = (conversation.participants || []).some((p) => String(p) === me);
        if (!isMember) return res.status(403).json({ message: 'Forbidden' });
        const peerId = (conversation.participants || []).map(String).find((p) => p !== me) || '';
        if (peerId && (await hasBlockBetween(me, peerId))) return res.status(403).json({ message: 'Blocked' });

        const message = await Message.create({
            conversation: conversationId,
            sender: me,
            content,
            readBy: [me],
        });

        await Conversation.findByIdAndUpdate(conversationId, {
            lastMessage: message._id,
            lastMessageAt: message.createdAt,
            updatedAt: new Date(),
        });

        const populated = await message.populate({ path: 'sender', select: 'username avatar' });
        res.status(201).json(populated);
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});

// --- Message Settings ---
app.get('/api/message-settings', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.uid).select('messageSettings');
        res.json(normalizeMessageSettings(user?.messageSettings));
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});
app.put('/api/message-settings', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.uid).select('messageSettings');
        if (!user) return res.status(404).json({ message: 'User not found' });

        const incoming = req.body || {};
        const next = normalizeMessageSettings({
            ...normalizeMessageSettings(user.messageSettings),
            ...(typeof incoming.chat === 'boolean' ? { chat: incoming.chat } : {}),
            ...(typeof incoming.replies === 'boolean' ? { replies: incoming.replies } : {}),
            ...(typeof incoming.mentions === 'boolean' ? { mentions: incoming.mentions } : {}),
            ...(typeof incoming.likes === 'boolean' ? { likes: incoming.likes } : {}),
            ...(typeof incoming.system === 'boolean' ? { system: incoming.system } : {}),
        });

        user.messageSettings = next;
        await user.save();
        res.json(next);
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});

app.get('/api/test/seed', async (req, res) => {
    const user = await User.findOne();
    if(!user) return res.status(400).json({message:'请先注册'});
    await Project.create([{ title: "Demo Song", author: user._id, cover: "linear-gradient(135deg,#6366f1,#a855f7)", tags:['Pop'], likes:[] }]);
    res.json({ message: '✅ 数据已生成' });
});

app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
