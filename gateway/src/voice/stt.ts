import { $ } from "bun";
import path from "path";

const WHISPER_MODEL = process.env.WHISPER_MODEL || "ggml-large-v3-turbo.bin";
const WHISPER_MODELS_DIR = process.env.WHISPER_MODELS_DIR || path.join(import.meta.dir, "../../models");

let _sttAvailable: boolean | null = null;

export function isSTTAvailable(): boolean {
  if (_sttAvailable !== null) return _sttAvailable;
  try {
    const result = Bun.spawnSync(["which", "whisper-cli"]);
    const ffmpegResult = Bun.spawnSync(["which", "ffmpeg"]);
    _sttAvailable = result.exitCode === 0 && ffmpegResult.exitCode === 0;
  } catch {
    _sttAvailable = false;
  }
  if (!_sttAvailable) {
    console.warn("STT not available: whisper-cli and/or ffmpeg not installed");
  }
  return _sttAvailable;
}

export async function transcribeAudio(oggPath: string): Promise<string> {
  if (!isSTTAvailable()) {
    return "[Voice message — STT not available, install whisper-cpp and ffmpeg]";
  }

  const wavPath = oggPath.replace(/\.\w+$/, ".wav");
  const t0 = Date.now();
  console.log(`[stt] ASR started: ${path.basename(oggPath)} (model: ${WHISPER_MODEL})`);

  // Convert to 16kHz WAV (whisper.cpp requirement)
  await $`ffmpeg -y -i ${oggPath} -ar 16000 -ac 1 ${wavPath}`.quiet();

  // Transcribe with whisper.cpp
  const modelPath = path.join(WHISPER_MODELS_DIR, WHISPER_MODEL);
  const result = await $`whisper-cli -m ${modelPath} -l auto -nt -otxt -f ${wavPath}`.quiet();
  if (result.exitCode !== 0) {
    console.error(`[stt] ASR failed (exit ${result.exitCode})`);
    throw new Error(`whisper-cli failed: ${result.stderr.toString()}`);
  }

  // Read the .txt output file
  const txtPath = wavPath + ".txt";
  const text = await Bun.file(txtPath).text();
  console.log(`[stt] ASR done in ${Date.now() - t0}ms: "${text.trim().slice(0, 80)}..."`);

  // Cleanup temp files
  try {
    const { unlinkSync } = await import("fs");
    unlinkSync(wavPath);
    unlinkSync(txtPath);
  } catch {}

  return text.trim();
}
