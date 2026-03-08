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
  const t0 = Date.now();
  console.log(`[tts] TTS started: "${text.slice(0, 80)}..." (voice: ${TTS_VOICE})`);

  // macOS say -> AIFF
  await $`say -v ${TTS_VOICE} -o ${aiffPath} ${text}`.quiet();

  // Convert to OGG Opus for Telegram
  await $`ffmpeg -y -i ${aiffPath} -c:a libopus -b:a 48k ${outputPath}`.quiet();
  console.log(`[tts] TTS done in ${Date.now() - t0}ms: ${outputPath}`);

  // Cleanup temp file
  try {
    const { unlinkSync } = await import("fs");
    unlinkSync(aiffPath);
  } catch {}

  return outputPath;
}
