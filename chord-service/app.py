# chord-service/app.py
import json
from typing import List, Dict, Any, Optional
from fastapi import FastAPI
from pydantic import BaseModel

import torch
from transformers import GPT2LMHeadModel, set_seed

MODEL_DIR = "./model"

# ===== load vocab + model =====
with open(f"{MODEL_DIR}/vocab.json", "r", encoding="utf-8") as f:
    vocab = json.load(f)

token2id = {t:i for i,t in enumerate(vocab)}
id2token = {i:t for t,i in token2id.items()}

model = GPT2LMHeadModel.from_pretrained(MODEL_DIR)
device = "cuda" if torch.cuda.is_available() else "cpu"
model.to(device)
model.eval()

def encode(tokens: List[str]) -> List[int]:
    unk = token2id["<UNK>"]
    return [token2id.get(t, unk) for t in tokens]

def decode(ids: List[int]) -> List[str]:
    return [id2token[i] for i in ids]

def strip_special(tokens: List[str]) -> List[str]:
    return [t for t in tokens if t not in ("<BOS>", "<EOS>", "<PAD>")]

def cut_at_end(tokens: List[str]) -> List[str]:
    out = []
    for t in tokens:
        if t == "<END>":
            break
        out.append(t)
    return out

def only_chords_and_bar(tokens: List[str]) -> List[str]:
    out = []
    for t in tokens:
        if t == "<BAR>":
            out.append(t)
        elif not (t.startswith("<") and t.endswith(">")):
            out.append(t)
    return out

def generate_raw(prompt_tokens: List[str],
                 max_new_tokens=400,
                 temperature=0.95,
                 top_p=0.92,
                 seed=1) -> List[str]:
    set_seed(seed)
    ids = torch.tensor([encode(prompt_tokens)], dtype=torch.long, device=device)

    out = model.generate(
        input_ids=ids,
        max_new_tokens=max_new_tokens,
        do_sample=True,
        temperature=temperature,
        top_p=top_p,
        repetition_penalty=1.15,
        no_repeat_ngram_size=3,
        pad_token_id=token2id.get("<PAD>", 0),
        eos_token_id=token2id.get("<EOS>", None),
    )[0].tolist()

    toks = strip_special(decode(out))
    return cut_at_end(toks)

def generate_section(style_token: str, section_token: str, bars=8, tail_context=None, seed=1) -> List[str]:
    prompt = ["<BOS>", style_token, section_token]
    if tail_context:
        prompt += tail_context

    toks = only_chords_and_bar(generate_raw(prompt, seed=seed))
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

def generate_song(style="pop", seed=1) -> List[str]:
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
        sec_out = generate_section(style_tok, sec, bars=bars, tail_context=tail, seed=seed)
        song += [sec] + sec_out
        tail = [t for t in sec_out if t != "<BAR>"][-16:]
    return song

# ===== API =====
app = FastAPI()

class GenerateReq(BaseModel):
    style: str = "pop"
    seed: int = 1

@app.post("/generate_chords")
def generate_chords(req: GenerateReq) -> Dict[str, Any]:
    tokens = generate_song(style=req.style, seed=req.seed)
    return {"ok": True, "style": req.style, "tokens": tokens, "device": device}
