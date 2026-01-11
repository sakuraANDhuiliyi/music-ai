import argparse
import json
import math
import os
import sys
from dataclasses import dataclass
from pathlib import Path

# Low-end PC friendly defaults (reduce multi-thread contention)
for _var in (
    "OMP_NUM_THREADS",
    "MKL_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
    "OPENBLAS_NUM_THREADS",
    "VECLIB_MAXIMUM_THREADS",
    "NUMBA_NUM_THREADS",
):
    os.environ.setdefault(_var, "1")

import numpy as np
import librosa
import soundfile as sf


DIGIT_SHIFT = {
    "1": "!",
    "2": "@",
    "3": "#",
    "4": "$",
    "5": "%",
    "6": "^",
    "7": "&",
    "8": "*",
    "9": "(",
    "0": ")",
}


def char_requires_shift(ch: str) -> bool:
    if not ch:
        return False
    if ch in DIGIT_SHIFT.values():
        return True
    return ch.isalpha() and ch.upper() == ch and ch.lower() != ch


def shifted_key(ch: str) -> str:
    if ch in DIGIT_SHIFT:
        return DIGIT_SHIFT[ch]
    return ch.upper()


def generate_autopiano_keymap(start_midi: int = 36) -> dict[int, str]:
    """
    AutoPiano / VirtualPiano 常见 61 键映射（C2=36 -> '1'，C3=48 -> '8'，C4=60 -> 't'）。

    36 个白键使用：
      1234567890 qwertyuiop asdfghjkl zxcvbnm
    黑键使用对应白键的 Shift 版本（数字行用 !@#$%^&*()，字母用大写）。
    """
    white_keys = list("1234567890qwertyuiopasdfghjklzxcvbnm")
    if len(white_keys) != 36:
        raise RuntimeError("internal key list mismatch")

    keymap: dict[int, str] = {}
    midi = int(start_midi)
    white_i = 0

    # White notes that have a sharp after them: C, D, F, G, A
    # Identify by pitch-class of the white note MIDI:
    # C=0, D=2, E=4, F=5, G=7, A=9, B=11
    sharp_after_pc = {0, 2, 5, 7, 9}

    while white_i < len(white_keys):
        base = white_keys[white_i]
        keymap[midi] = base
        if (midi % 12) in sharp_after_pc:
            keymap[midi + 1] = shifted_key(base)

        # Step to next white note (E->F and B->C are +1 semitone, others +2)
        if (midi % 12) in {4, 11}:  # E, B
            midi += 1
        else:
            midi += 2
        white_i += 1

    return keymap


def ms_to_samples(ms: float, sr: int) -> int:
    return int(round(ms * sr / 1000.0))


def safe_float(v, default: float) -> float:
    try:
        if isinstance(v, np.ndarray):
            v = v.reshape(-1)[0] if v.size else default
        x = float(v)
        if math.isfinite(x):
            return x
    except Exception:
        pass
    return float(default)


@dataclass(frozen=True)
class Event:
    tick: int
    notes: tuple[int, ...]


def load_audio(path: Path, sr: int, max_seconds: float | None) -> tuple[np.ndarray, int]:
    # mono=False to keep stereo for vocal reduce option
    y, in_sr = librosa.load(str(path), sr=sr, mono=False)
    # librosa returns shape (n,) for mono, (channels, n) for stereo
    if y.ndim == 1:
        y_mono = y
    else:
        y_mono = np.mean(y, axis=0)

    if max_seconds is not None and max_seconds > 0:
        max_len = int(sr * max_seconds)
        if y_mono.shape[0] > max_len:
            y_mono = y_mono[:max_len]

    return y_mono.astype(np.float32), sr


def separate_stems(
    y_mono: np.ndarray, sr: int, method: str
) -> dict[str, np.ndarray]:
    """
    低配友好分离：HPSS（谐波/打击），可选 vocal_reduce（立体声中置削弱）。
    """
    method = (method or "hpss").strip().lower()
    stems: dict[str, np.ndarray] = {"mix": y_mono}

    if method == "none":
        return stems

    if method not in {"hpss"}:
        # keep extension point for future (e.g., spleeter/demucs)
        method = "hpss"

    y_harm, y_perc = librosa.effects.hpss(y_mono)
    stems["harmonic"] = y_harm.astype(np.float32)
    stems["percussive"] = y_perc.astype(np.float32)
    return stems


def estimate_tempo(y_for_tempo: np.ndarray, sr: int) -> float:
    try:
        tempo, _ = librosa.beat.beat_track(y=y_for_tempo, sr=sr)
        tempo = safe_float(tempo, 0.0)
        if tempo <= 0:
            return 120.0
        # clamp to a reasonable range (avoid doubled/halved extremes)
        if tempo < 50:
            tempo *= 2
        if tempo > 220:
            tempo /= 2
        return float(max(50.0, min(220.0, tempo)))
    except Exception:
        return 120.0


def ticks_per_quarter(grid: int) -> int:
    if grid <= 0:
        return 4
    # grid=16 => 4 ticks per quarter; grid=8 => 2 ticks per quarter
    return max(1, int(round(grid / 4)))


def tick_duration_seconds(bpm: float, grid: int) -> float:
    bpm = safe_float(bpm, 120.0)
    bpm = max(30.0, min(300.0, bpm))
    quarter = 60.0 / bpm
    return quarter / ticks_per_quarter(grid)


def detect_onsets(y_harm: np.ndarray, sr: int, hop_length: int) -> np.ndarray:
    try:
        onset_frames = librosa.onset.onset_detect(
            y=y_harm,
            sr=sr,
            hop_length=hop_length,
            units="frames",
            backtrack=True,
            pre_max=6,
            post_max=6,
            pre_avg=20,
            post_avg=20,
            delta=0.2,
            wait=8,
        )
        onset_frames = np.asarray(onset_frames, dtype=int)
        onset_frames = onset_frames[onset_frames >= 0]
        onset_frames = np.unique(onset_frames)
        return onset_frames
    except Exception:
        return np.asarray([], dtype=int)


def segment_notes_from_piptrack(
    y_harm: np.ndarray,
    sr: int,
    hop_length: int,
    n_fft: int,
    onset_frames: np.ndarray,
    min_hz: float,
    max_hz: float,
    top_k_bins: int,
    magnitude_ratio: float,
    max_polyphony: int,
) -> list[tuple[float, list[int]]]:
    """
    返回按 onset 分割的音符列表：[(start_time_seconds, [midi,...]), ...]
    注意：此方法对复调的准确度有限，但不依赖重型模型，适合低配。
    """
    pitches, mags = librosa.piptrack(
        y=y_harm, sr=sr, n_fft=n_fft, hop_length=hop_length, fmin=min_hz, fmax=max_hz
    )
    n_frames = pitches.shape[1]

    if onset_frames.size == 0:
        onset_frames = np.asarray([0], dtype=int)

    # Add end sentinel
    boundaries = np.concatenate([onset_frames, np.asarray([n_frames], dtype=int)])

    events: list[tuple[float, list[int]]] = []
    for i in range(len(boundaries) - 1):
        f0 = int(boundaries[i])
        f1 = int(boundaries[i + 1])
        if f0 < 0 or f0 >= n_frames:
            continue
        if f1 <= f0:
            continue

        note_weights: dict[int, float] = {}
        for t in range(f0, min(f1, n_frames)):
            col_mag = mags[:, t]
            max_mag = float(col_mag.max(initial=0.0))
            if max_mag <= 0:
                continue

            # pick top-K bins for speed
            k = int(max(1, min(top_k_bins, col_mag.shape[0])))
            idx = np.argpartition(col_mag, -k)[-k:]
            thresh = max_mag * float(max(0.0, magnitude_ratio))

            for bin_i in idx:
                if float(col_mag[bin_i]) < thresh:
                    continue
                hz = float(pitches[bin_i, t])
                if hz <= 0.0:
                    continue
                if hz < min_hz or hz > max_hz:
                    continue
                midi = int(round(float(librosa.hz_to_midi(hz))))
                note_weights[midi] = note_weights.get(midi, 0.0) + float(col_mag[bin_i])

        if not note_weights:
            continue

        # Keep strongest notes; also remove very weak candidates
        items = sorted(note_weights.items(), key=lambda kv: kv[1], reverse=True)
        max_w = float(items[0][1])
        keep = [(m, w) for m, w in items if w >= max_w * 0.2]
        keep = keep[: int(max(1, max_polyphony))]
        notes = sorted({m for m, _ in keep})

        start_time = float(librosa.frames_to_time(f0, sr=sr, hop_length=hop_length))
        events.append((start_time, notes))

    return events


def quantize_events_to_ticks(
    events: list[tuple[float, list[int]]],
    tick_sec: float,
    max_polyphony: int,
) -> list[Event]:
    if tick_sec <= 0:
        tick_sec = 0.125

    by_tick: dict[int, list[int]] = {}
    for t, notes in events:
        tick = int(round(float(t) / tick_sec))
        if tick < 0:
            continue
        by_tick.setdefault(tick, []).extend(notes)

    out: list[Event] = []
    for tick in sorted(by_tick.keys()):
        notes = sorted({int(n) for n in by_tick[tick]})
        if max_polyphony and len(notes) > max_polyphony:
            # simple "playability" cut: keep extremes and fill middle if needed
            notes = [notes[0], notes[-1]] + notes[1:-1]
            notes = notes[:max_polyphony]
            notes = sorted(set(notes))
        out.append(Event(tick=tick, notes=tuple(notes)))
    return out


def render_rest(delta_ticks: int, grid: int) -> str:
    if delta_ticks <= 0:
        return ""
    q = ticks_per_quarter(grid)
    if q <= 0:
        return " " * delta_ticks

    bars = delta_ticks // q
    rem = delta_ticks % q
    return ("|" * bars) + (" " * rem)


def render_chord(keys: list[str]) -> str:
    if not keys:
        return ""
    if len(keys) == 1:
        return keys[0]
    return "[" + "".join(keys) + "]"


def render_event(notes: tuple[int, ...], keymap: dict[int, str]) -> str:
    keys = []
    for midi in notes:
        k = keymap.get(int(midi))
        if k:
            keys.append(k)
    if not keys:
        return ""

    unshifted = [k for k in keys if not char_requires_shift(k)]
    shifted = [k for k in keys if char_requires_shift(k)]

    if unshifted and shifted:
        # Shift is global, split to make it playable (arpeggiate with minimal delay)
        return render_chord(unshifted) + render_chord(shifted)

    return render_chord(keys)


def render_sheet(events: list[Event], keymap: dict[int, str], grid: int) -> str:
    parts: list[str] = []
    prev_tick = 0
    for ev in events:
        delta = int(ev.tick) - int(prev_tick)
        if delta > 0:
            parts.append(render_rest(delta, grid))
        s = render_event(ev.notes, keymap)
        if s:
            parts.append(s)
            prev_tick = int(ev.tick)
    return "".join(parts).strip()


def run_pipeline(
    audio_path: Path,
    *,
    sr: int,
    max_seconds: float | None,
    separate: str,
    grid: int,
    max_polyphony: int,
    hop_length: int,
    n_fft: int,
    top_k_bins: int,
    magnitude_ratio: float,
    keymap_start_midi: int,
    save_stems_dir: Path | None,
) -> dict:
    y, sr = load_audio(audio_path, sr=sr, max_seconds=max_seconds)
    stems = separate_stems(y, sr=sr, method=separate)

    y_harm = stems.get("harmonic", stems["mix"])
    y_perc = stems.get("percussive", stems["mix"])

    tempo = estimate_tempo(y_perc, sr=sr)
    tick_sec = tick_duration_seconds(tempo, grid)

    onset_frames = detect_onsets(y_harm, sr=sr, hop_length=hop_length)

    events_sec = segment_notes_from_piptrack(
        y_harm=y_harm,
        sr=sr,
        hop_length=hop_length,
        n_fft=n_fft,
        onset_frames=onset_frames,
        min_hz=librosa.note_to_hz("C3"),
        max_hz=librosa.note_to_hz("C8"),
        top_k_bins=top_k_bins,
        magnitude_ratio=magnitude_ratio,
        max_polyphony=max_polyphony,
    )

    events = quantize_events_to_ticks(events_sec, tick_sec=tick_sec, max_polyphony=max_polyphony)
    keymap = generate_autopiano_keymap(start_midi=keymap_start_midi)
    sheet = render_sheet(events, keymap=keymap, grid=grid)

    if save_stems_dir:
        save_stems_dir.mkdir(parents=True, exist_ok=True)
        for name, data in stems.items():
            out = save_stems_dir / f"{name}.wav"
            try:
                sf.write(str(out), data, sr)
            except Exception:
                # ignore stem save errors
                pass

    return {
        "tempo": tempo,
        "grid": grid,
        "tickSeconds": tick_sec,
        "events": [{"tick": e.tick, "notes": list(e.notes)} for e in events],
        "sheet": sheet,
    }


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="音频 -> AutoPiano/VirtualPiano 键位文字谱（低配友好版）")
    p.add_argument("--input", required=True, help="输入音频文件路径（建议 WAV/FLAC）")
    p.add_argument("--output", default="", help="输出文字谱 .txt 路径（可选）")
    p.add_argument("--json", action="store_true", help="将结果 JSON 输出到 stdout（用于后端调用）")

    p.add_argument("--sr", type=int, default=22050, help="采样率（越低越快，默认 22050）")
    p.add_argument("--max-seconds", type=float, default=60.0, help="最长处理秒数（默认 60，低配建议 30~60）")
    p.add_argument("--separate", default="hpss", help="分离方式：hpss / none（默认 hpss）")

    p.add_argument("--grid", type=int, default=16, help="节奏网格（默认 16=十六分音符）")
    p.add_argument("--polyphony", type=int, default=5, help="同一时刻最多保留音符数（默认 5）")

    p.add_argument("--hop", type=int, default=512, help="帧移 hop_length（默认 512）")
    p.add_argument("--fft", type=int, default=2048, help="FFT 大小（默认 2048）")
    p.add_argument("--topk", type=int, default=6, help="每帧最多取多少个频谱峰（默认 6）")
    p.add_argument("--mag-ratio", type=float, default=0.25, help="峰值阈值=帧最大幅度*ratio（默认 0.25）")
    p.add_argument("--keymap-start", type=int, default=36, help="键位映射起始 MIDI（默认 36=C2）")
    p.add_argument("--save-stems", default="", help="保存分离后的 stem 到目录（可选）")
    return p


def main(argv: list[str]) -> int:
    args = build_arg_parser().parse_args(argv)

    audio_path = Path(args.input).expanduser().resolve()
    if not audio_path.exists():
        print(json.dumps({"ok": False, "message": "input_not_found"}))
        return 2

    save_stems_dir = Path(args.save_stems).expanduser().resolve() if args.save_stems else None
    max_seconds = float(args.max_seconds) if args.max_seconds and args.max_seconds > 0 else None

    try:
        result = run_pipeline(
            audio_path=audio_path,
            sr=int(args.sr),
            max_seconds=max_seconds,
            separate=str(args.separate),
            grid=int(args.grid),
            max_polyphony=int(args.polyphony),
            hop_length=int(args.hop),
            n_fft=int(args.fft),
            top_k_bins=int(args.topk),
            magnitude_ratio=float(args.mag_ratio),
            keymap_start_midi=int(args.keymap_start),
            save_stems_dir=save_stems_dir,
        )
    except Exception as e:
        if args.json:
            print(json.dumps({"ok": False, "message": "failed", "error": str(e)}))
        else:
            print(f"❌ 处理失败：{e}")
        return 1

    sheet = result.get("sheet", "")

    if args.output:
        out_path = Path(args.output).expanduser().resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(str(sheet), encoding="utf-8")

    if args.json:
        print(json.dumps({"ok": True, **result}, ensure_ascii=True))
    else:
        print(sheet)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
