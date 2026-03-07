import { $ } from "bun";

const TTS_VOICE = process.env.TTS_VOICE || "Samantha";

let _ttsAvailable: boolean | null = null;

export function isTTSAvailable(): boolean {
  if (_ttsAvailable !== null) return _ttsAvailable;
  try {
    const sayResult = Bun.spawnSync(["which", "say"]);
    const ffmpegResult = Bun.spawnSync(["which", "ffmpeg"]);
    _ttsAvailable = sayResult.exitCode === 0 && ffmpegResult.exitCode === 0;
  } catch {
    _ttsAvailable = false;
  }
  if (!_ttsAvailable) {
    console.warn("TTS not available: say and/or ffmpeg not installed");
  }
  return _ttsAvailable;
}

export async function synthesizeSpeech(text: string, outputPath: string): Promise<string> {
  if (!isTTSAvailable()) {
    throw new Error("TTS not available");
  }

  const aiffPath = outputPath.replace(/\.\w+$/, ".aiff");

  // macOS say -> AIFF
  await $`say -v ${TTS_VOICE} -o ${aiffPath} ${text}`.quiet();

  // Convert to OGG Opus for Telegram
  await $`ffmpeg -y -i ${aiffPath} -c:a libopus -b:a 48k ${outputPath}`.quiet();

  // Cleanup temp file
  try {
    const { unlinkSync } = await import("fs");
    unlinkSync(aiffPath);
  } catch {}

  return outputPath;
}
