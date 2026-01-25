# chord-service/app.py (MERGED)

import os
import json
from typing import List, Dict, Any
from fastapi import FastAPI
from pydantic import BaseModel

import torch
from transformers import GPT2LMHeadModel, set_seed

# =====================
# Paths
# =====================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

CHORD_MODEL_DIR = os.path.join(BASE_DIR, "model")        # 你原来的非Roman模型目录
ROMAN_MODEL_DIR = os.path.join(BASE_DIR, "roman_model")  # 你新的Roman模型目录

# =====================
# Shared device
# =====================
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# =====================
# Load CHORD model (原来的 token 生成模型)
# =====================
with open(os.path.join(CHORD_MODEL_DIR, "vocab.json"), "r", encoding="utf-8") as f:
    chord_vocab = json.load(f)

chord_token2id = {t: i for i, t in enumerate(chord_vocab)}
chord_id2token = {i: t for t, i in chord_token2id.items()}

chord_model = GPT2LMHeadModel.from_pretrained(CHORD_MODEL_DIR)
chord_model.to(DEVICE)
chord_model.eval()

def chord_encode(tokens: List[str]) -> List[int]:
    unk = chord_token2id.get("<UNK>", 0)
    return [chord_token2id.get(t, unk) for t in tokens]

def chord_decode(ids: List[int]) -> List[str]:
    return [chord_id2token.get(i, "<UNK>") for i in ids]

def chord_strip_special(tokens: List[str]) -> List[str]:
    return [t for t in tokens if t not in ("<BOS>", "<EOS>", "<PAD>")]

def chord_cut_at_end(tokens: List[str]) -> List[str]:
    out = []
    for t in tokens:
        if t == "<END>":
            break
        out.append(t)
    return out

def chord_only_chords_and_bar(tokens: List[str]) -> List[str]:
    out = []
    for t in tokens:
        if t == "<BAR>":
            out.append(t)
        elif not (t.startswith("<") and t.endswith(">")):
            out.append(t)
    return out

def chord_generate_raw(prompt_tokens: List[str],
                       max_new_tokens=400,
                       temperature=0.95,
                       top_p=0.92,
                       seed=1) -> List[str]:
    set_seed(seed)
    ids = torch.tensor([chord_encode(prompt_tokens)], dtype=torch.long, device=DEVICE)

    out = chord_model.generate(
        input_ids=ids,
        max_new_tokens=max_new_tokens,
        do_sample=True,
        temperature=temperature,
        top_p=top_p,
        repetition_penalty=1.15,
        no_repeat_ngram_size=3,
        pad_token_id=chord_token2id.get("<PAD>", 0),
        eos_token_id=chord_token2id.get("<EOS>", None),
    )[0].tolist()

    toks = chord_strip_special(chord_decode(out))
    return chord_cut_at_end(toks)

def chord_generate_section(style_token: str, section_token: str, bars=8, tail_context=None, seed=1) -> List[str]:
    prompt = ["<BOS>", style_token, section_token]
    if tail_context:
        prompt += tail_context

    toks = chord_only_chords_and_bar(chord_generate_raw(prompt, seed=seed))
    out, bar_cnt = [], 0

    for t in toks:
        out.append(t)
        if t == "<BAR>":
            bar_cnt += 1
            if bar_cnt >= bars:
                break

    while out and out[-1] != "<BAR>":
        out.pop()
    return out

def chord_generate_song(style="pop", seed=1) -> List[str]:
    style_tok = f"<STYLE={style}>"

    plan = [
        ("<intro>", 4),
        ("<verse>", 8),
        ("<chorus>", 8),
        ("<verse>", 8),
        ("<chorus>", 8),
        ("<outro>", 4),
    ]

    song = []
    tail = None
    for sec, bars in plan:
        sec_out = chord_generate_section(style_tok, sec, bars=bars, tail_context=tail, seed=seed)
        song += [sec] + sec_out
        tail = [t for t in sec_out if t != "<BAR>"][-16:]
    return song


# =====================
# Load ROMAN model (Roman 生成 + 回转调)
# =====================
with open(os.path.join(ROMAN_MODEL_DIR, "vocab.json"), "r", encoding="utf-8") as f:
    roman_vocab = json.load(f)

roman_token2id = {t: i for i, t in enumerate(roman_vocab)}
roman_id2token = {i: t for t, i in roman_token2id.items()}

roman_model = GPT2LMHeadModel.from_pretrained(ROMAN_MODEL_DIR)
roman_model.to(DEVICE)
roman_model.eval()

# ---- Roman music utils (major only) ----
NOTE2PC = {
    "C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5,
    "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11
}
PC2NOTE_SHARP = {0: "C", 1: "C#", 2: "D", 3: "D#", 4: "E", 5: "F", 6: "F#", 7: "G", 8: "G#", 9: "A", 10: "A#", 11: "B"}
DEG2REL_MAJOR = {
    "I": 0, "II": 2, "III": 4, "IV": 5, "V": 7, "VI": 9, "VII": 11,
    "bII": 1, "bIII": 3, "#IV": 6, "bVI": 8, "bVII": 10
}

def pc(note: str) -> int:
    if note not in NOTE2PC:
        raise ValueError(f"Unsupported key: {note}")
    return NOTE2PC[note]

def roman_to_chord_major(rn: str, tonic: str):
    if ":" not in rn:
        return None
    deg, q = rn.split(":", 1)
    rel = DEG2REL_MAJOR.get(deg)
    if rel is None:
        return None

    root_pc = (pc(tonic) + rel) % 12
    root = PC2NOTE_SHARP[root_pc]

    if q == "maj": return root
    if q == "min": return root + "m"
    if q == "dim": return root + "dim"
    if q == "7":   return root + "7"

    # 可选扩展（如果你的 roman vocab 里包含）
    if q == "maj7": return root + "maj7"
    if q == "min7": return root + "m7"
    if q == "sus2": return root + "sus2"
    if q == "sus4": return root + "sus4"
    if q == "aug":  return root + "aug"
    if q == "m7b5": return root + "m7b5"
    if q == "dim7": return root + "dim7"

    return root

def roman_encode(tokens: List[str]) -> List[int]:
    unk = roman_token2id.get("<UNK>", 0)
    return [roman_token2id.get(t, unk) for t in tokens]

def roman_decode(ids: List[int]) -> List[str]:
    return [roman_id2token.get(i, "<UNK>") for i in ids]

def roman_generate_raw(prompt_tokens: List[str], max_new_tokens=400, temperature=0.95, top_p=0.92, seed=1) -> List[str]:
    set_seed(seed)
    input_ids = torch.tensor([roman_encode(prompt_tokens)], dtype=torch.long, device=DEVICE)

    out = roman_model.generate(
        input_ids=input_ids,
        max_new_tokens=max_new_tokens,
        do_sample=True,
        temperature=temperature,
        top_p=top_p,
        repetition_penalty=1.15,
        no_repeat_ngram_size=3,
        pad_token_id=roman_token2id.get("<PAD>", 0),
        eos_token_id=roman_token2id.get("<EOS>", None),
    )[0].tolist()

    toks = roman_decode(out)
    toks = [t for t in toks if t not in ("<BOS>", "<EOS>", "<PAD>")]

    res = []
    for t in toks:
        if t == "<END>":
            break
        res.append(t)
    return res

def only_roman_and_bar(tokens: List[str]) -> List[str]:
    out = []
    for t in tokens:
        if t == "<BAR>":
            out.append(t)
        elif ":" in t and not t.startswith("<"):
            out.append(t)
    return out

def roman_generate_section(style_tok: str, key_tok: str, section_tok: str, bars=8, tail_context=None, seed=1):
    prompt = ["<BOS>", style_tok, key_tok, section_tok]
    if tail_context:
        prompt += tail_context

    toks = only_roman_and_bar(roman_generate_raw(prompt, seed=seed))
    out, bar_cnt = [], 0
    for t in toks:
        out.append(t)
        if t == "<BAR>":
            bar_cnt += 1
            if bar_cnt >= bars:
                break
    while out and out[-1] != "<BAR>":
        out.pop()
    return out

def roman_generate_song(style="pop", key="C", seed=1):
    style_tok = f"<STYLE={style}>"
    key_tok = f"<KEY={key}>"

    plan = [
        ("<intro>", 4),
        ("<verse>", 8),
        ("<chorus>", 8),
        ("<verse>", 8),
        ("<chorus>", 8),
        ("<outro>", 4),
    ]

    roman = []
    tail = None
    for sec, bars in plan:
        sec_out = roman_generate_section(style_tok, key_tok, sec, bars=bars, tail_context=tail, seed=seed)
        roman += [sec] + sec_out
        tail = [t for t in sec_out if t != "<BAR>"][-16:]

    chords = []
    for t in roman:
        if t.startswith("<") and t.endswith(">"):
            chords.append(t)
        else:
            ch = roman_to_chord_major(t, key)
            if ch:
                chords.append(ch)

    return roman, chords


# =====================
# FastAPI
# =====================
app = FastAPI()

class GenerateReq(BaseModel):
    style: str = "pop"
    seed: int = 1

class RomanReq(BaseModel):
    style: str = "pop"
    key: str = "C"   # major only
    seed: int = 1

@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "ok": True,
        "device": DEVICE,
        "chord_model_dir": CHORD_MODEL_DIR,
        "roman_model_dir": ROMAN_MODEL_DIR,
        "chord_vocab_size": len(chord_vocab),
        "roman_vocab_size": len(roman_vocab),
    }

@app.post("/generate_chords")
def generate_chords(req: GenerateReq) -> Dict[str, Any]:
    tokens = chord_generate_song(style=req.style, seed=req.seed)
    return {"ok": True, "style": req.style, "tokens": tokens, "device": DEVICE}

@app.post("/generate_roman")
def generate_roman(req: RomanReq) -> Dict[str, Any]:
    roman, chords = roman_generate_song(style=req.style, key=req.key, seed=req.seed)
    return {"ok": True, "style": req.style, "key": req.key, "roman": roman, "chords": chords, "device": DEVICE}
