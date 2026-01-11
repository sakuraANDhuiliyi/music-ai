# 音频转钢琴键位文字谱（低配友好）

本工具将音频转换为 **AutoPiano / VirtualPiano** 风格的“键位文字谱”（如 `tT y u [ty] |`），并做了基础的：

- **分离**：HPSS（谐波/打击）用于降低鼓点干扰（低配可跑）
- **转谱**：基于 `librosa.piptrack` 的频谱峰值 + `onset_detect` 的音头切分（不依赖重型深度模型）
- **量化**：估计 BPM 后按 `--grid` 网格量化
- **可弹奏优化**：限制同一时刻最多 `--polyphony` 个音符；遇到 Shift 冲突会自动“琶音化”拆分

## 使用

1) 建议准备 `WAV/FLAC`（无 `ffmpeg` 时，`mp3` 可能无法解码）

2) 运行：

```bash
python tools/audio_to_sheet/main.py --input demo.wav --output out.txt
```

常用参数（低配推荐）：

```bash
python tools/audio_to_sheet/main.py --input demo.wav --output out.txt --max-seconds 45 --sr 22050 --grid 16 --polyphony 4
```

保存分离后的 stem（调试用）：

```bash
python tools/audio_to_sheet/main.py --input demo.wav --save-stems tools/audio_to_sheet/stems
```

## 输出格式说明（参考 `新建文本文档.txt`）

- 连写（如 `asdf`）：更快的按键间隔
- 单空格：单位延时符（本工具按 `grid` 生成）
- 和弦：`[asdf]` 表示同时按下
- `|`：较明显的停顿/分隔（本工具用于“每 1/4 拍”的休止压缩输出）

## 已知限制

- 该版本不使用 Demucs/Spleeter/BasicPitch 等重型模型，对“复杂混音 + 强和声”的复调精度有限。
- 若想更高精度（尤其是钢琴复调），建议后续接入 **Basic Pitch** 或 **Onsets and Frames**，但会显著增加运行成本。

## 键位映射（与图片一致）

白键顺序：`1234567890qwertyuiopasdfghjklzxcvbnm`，起始为 `C2 -> 1`，对应 `C7 -> m`；黑键为对应白键的 Shift 版本（数字行 `!@#$%^&*()`，字母行大写）。
