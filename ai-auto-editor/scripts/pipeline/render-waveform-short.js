/**
 * render-waveform-short.js
 *
 * 從人聲音訊產生 1080×1920 動態音波背景短影音。
 * 視覺：深色背景 + 中央偏下動態波形（跟隨人聲波動，不取 BGM）
 * 音訊：保留既有 dynaudnorm + loudnorm 正規化與 BGM 混音能力
 *
 * 用法：
 *   import { renderWaveformShort } from './render-waveform-short.js'
 *   await renderWaveformShort({ voiceAudioPath, assPath, fontsDir, duration, outputPath, bgmPath })
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** 跳脫 ffmpeg filter_complex 路徑中的特殊字元 */
function escFilterPath(p) {
  return p.replace(/([\\:';,])/g, '\\$1')
}

/**
 * 產生波形背景短影音
 *
 * @param {object} opts
 * @param {string} opts.voiceAudioPath  人聲音訊（用於波形可視化 + 聲音來源）
 * @param {string} opts.assPath         ASS 字幕檔路徑
 * @param {string} opts.fontsDir        字型資料夾路徑
 * @param {number} opts.duration        影片總秒數
 * @param {string} opts.outputPath      輸出 MP4
 * @param {string} [opts.bgmPath]       BGM 檔案路徑（可選）
 * @returns {Promise<{outputPath: string, duration: number}>}
 */
export async function renderWaveformShort(opts) {
  const { voiceAudioPath, assPath, fontsDir, duration, outputPath, bgmPath } = opts

  const fadeOutStart = Math.max(0, duration - 2)
  const assEsc = escFilterPath(assPath)
  const fontsEsc = escFilterPath(fontsDir)

  // ─── 波形視覺參數 ───────────────────────────────────────
  const waveW = 960, waveH = 240
  const waveOffsetY = 100 // 波形中心在畫面正中偏下 100px
  const bgColor = '0x0d0d1a' // 深藍黑背景

  // showwaves: cline（對稱波形線）、sqrt scale（安靜段也可見）
  const showwaves = [
    `showwaves=s=${waveW}x${waveH}`,
    'mode=cline',
    'rate=24',
    'colors=0x818cf8|0xa78bfa',
    'scale=sqrt',
  ].join(':')

  // colorkey 去掉 showwaves 黑底，讓波形透明疊加到背景上
  const keying = 'colorkey=0x000000:0.01:0.15'

  if (bgmPath) {
    // 三路輸入：color 背景 (0)、人聲 (1)、BGM (2)
    const fc = [
      // 人聲分流：一份給波形、一份給混音
      '[1:a]asplit=2[a_wave][a_voice]',
      // 波形可視化 → 去黑底
      `[a_wave]${showwaves},${keying}[wave]`,
      // 疊到深色背景 → 燒字幕
      `[0:v][wave]overlay=(W-w)/2:(H-h)/2+${waveOffsetY}[vbase]`,
      `[vbase]ass=${assEsc}:fontsdir=${fontsEsc}[vout]`,
      // 音訊：人聲正規化 + BGM 混音
      '[a_voice]dynaudnorm=f=150:g=15:p=0.95,loudnorm=I=-12:TP=-1:LRA=11[voice]',
      `[2:a]volume=0.10,afade=t=in:d=1,afade=t=out:st=${fadeOutStart.toFixed(1)}:d=2[bgm]`,
      '[voice][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]',
    ].join(';')

    await execFileAsync('ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', `color=c=${bgColor}:s=1080x1920:d=${duration.toFixed(2)}:r=24`,
      '-i', voiceAudioPath,
      '-i', bgmPath,
      '-filter_complex', fc,
      '-map', '[vout]', '-map', '[aout]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart', '-shortest',
      outputPath,
    ], { timeout: 5 * 60 * 1000 })
  } else {
    // 兩路輸入：color 背景 (0)、人聲 (1)
    const fc = [
      '[1:a]asplit=2[a_wave][a_voice]',
      `[a_wave]${showwaves},${keying}[wave]`,
      `[0:v][wave]overlay=(W-w)/2:(H-h)/2+${waveOffsetY}[vbase]`,
      `[vbase]ass=${assEsc}:fontsdir=${fontsEsc}[vout]`,
      '[a_voice]dynaudnorm=f=150:g=15:p=0.95,loudnorm=I=-12:TP=-1:LRA=11[aout]',
    ].join(';')

    await execFileAsync('ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', `color=c=${bgColor}:s=1080x1920:d=${duration.toFixed(2)}:r=24`,
      '-i', voiceAudioPath,
      '-filter_complex', fc,
      '-map', '[vout]', '-map', '[aout]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart', '-shortest',
      outputPath,
    ], { timeout: 5 * 60 * 1000 })
  }

  return { outputPath, duration }
}
