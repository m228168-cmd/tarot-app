import fs from 'node:fs/promises'
import path from 'node:path'
import { autoSelectMemesForSegments } from './scripts/pipeline/select-memes.js'

const reviewPath = path.resolve('downloads/exports/EP.47 盤點2025，我們的成長/成品/短影音-1.review.json')
const outPath = path.resolve('downloads/exports/EP.47 盤點2025，我們的成長/成品/短影音-1.review.auto-memes.json')

const review = JSON.parse(await fs.readFile(reviewPath, 'utf8'))
const memeSelections = await autoSelectMemesForSegments(review.segments || [])
review.memeSelections = memeSelections
review.output = {
  ...review.output,
  videoPath: 'downloads/exports/EP.47 盤點2025，我們的成長/成品/短影音-1.auto-memes.mp4',
  assPath: 'downloads/exports/EP.47 盤點2025，我們的成長/半成品/短影音-1.auto-memes.ass'
}
await fs.writeFile(outPath, JSON.stringify(review, null, 2), 'utf8')
console.log(JSON.stringify({ outPath, memeSelections }, null, 2))
