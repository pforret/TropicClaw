import { $ } from "bun";

const WHISPER_MODEL = process.env.WHISPER_MODEL || "large-v3-turbo";

let _sttAvailable: boolean | null = null;

export function isSTTAvailable(): boolean {
  if (_sttAvailable !== null) return _sttAvailable;
  try {
    const result = Bun.spawnSync(["which", "whisper-cpp"]);
    const ffmpegResult = Bun.spawnSync(["which", "ffmpeg"]);
    _sttAvailable = result.exitCode === 0 && ffmpegResult.exitCode === 0;
  } catch {
    _sttAvailable = false;
  }
  if (!_sttAvailable) {
    console.warn("STT not available: whisper-cpp and/or ffmpeg not installed");
  }
  return _sttAvailable;
}

export async function transcribeAudio(oggPath: string): Promise<string> {
  if (!isSTTAvailable()) {
    return "[Voice message — STT not available, install whisper-cpp and ffmpeg]";
  }

  const wavPath = oggPath.replace(/\.\w+$/, ".wav");

  // Convert to 16kHz WAV (whisper.cpp requirement)
  await $`ffmpeg -y -i ${oggPath} -ar 16000 -ac 1 ${wavPath}`.quiet();

  // Transcribe with whisper.cpp
  await $`whisper-cpp --model ${WHISPER_MODEL} --language auto --no-timestamps --output-txt --file ${wavPath}`.quiet();

  // Read the .txt output file
  const txtPath = wavPath.replace(/\.wav$/, ".txt");
  const text = await Bun.file(txtPath).text();

  // Cleanup temp files
  try {
    const { unlinkSync } = await import("fs");
    unlinkSync(wavPath);
    unlinkSync(txtPath);
  } catch {}

  return text.trim();
}
