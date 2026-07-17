import fs from 'fs'
import fetch from 'node-fetch'
import { fileURLToPath } from 'url-file-url'

const outIndex = fileURLToPath(new URL('../raw-index.js', import.meta.url))
const outTags = fileURLToPath(new URL('../raw-tags.js', import.meta.url))
const cdnUrl = 'https://cdn.jsdelivr.net/npm/emojibase-data'

// ==================== Fetch ====================

const { version } = await fetchJson(`${cdnUrl}@latest/package.json`)
const data = await fetchJson(`${cdnUrl}@${version}/en/data.json`)
const shortCodes = await fetchJson(`${cdnUrl}@${version}/en/shortcodes/emojibase.json`)
const messages = await fetchJson(`${cdnUrl}@${version}/en/messages.json`)

addShortCodes(data, shortCodes)
fixEmoticons(data)

// ==================== String Pool ====================

const stringChunks = []
const stringMap = new Map()
let stringOffset = 0

stringMap.set('', 0)

function addString (str) {
  if (str === undefined || str === null) str = ''
  if (stringMap.has(str)) return stringMap.get(str)
  const buf = Buffer.from(str, 'utf8')
  if (buf.length > 4095) throw new Error('String too long: ' + str)
  if (stringOffset > 0xFFFFF) throw new Error('String pool overflow')
  const ref = (buf.length << 20) | stringOffset
  stringChunks.push(buf)
  stringMap.set(str, ref)
  stringOffset += buf.length
  return ref
}

// ==================== Skin Derivation ====================

const TONE_HEX = { 1: '1F3FB', 2: '1F3FC', 3: '1F3FD', 4: '1F3FE', 5: '1F3FF' }
const TONE_LABEL = {
  1: 'light skin tone',
  2: 'medium-light skin tone',
  3: 'medium skin tone',
  4: 'medium-dark skin tone',
  5: 'dark skin tone'
}

function deriveHex (parentHex, tone) {
  const parts = parentHex.split('-')
  const rest = parts.slice(1)
  if (rest[0] === 'FE0F') rest.shift()
  return [parts[0], TONE_HEX[tone], ...rest].join('-')
}

function deriveLabel (parentLabel, tone) {
  const colonIdx = parentLabel.indexOf(': ')
  if (colonIdx !== -1) {
    return parentLabel.slice(0, colonIdx) + ': ' + TONE_LABEL[tone] + ', ' + parentLabel.slice(colonIdx + 2)
  }
  return parentLabel + ': ' + TONE_LABEL[tone]
}

function isDerivable (e) {
  if (!e.skins || e.skins.length !== 5) return false
  const parentSCs = e.shortCodes || []
  for (let i = 0; i < 5; i++) {
    const sk = e.skins[i]
    const tone = sk.tone
    if (!tone || tone < 1 || tone > 5) return false
    if (sk.hexcode !== deriveHex(e.hexcode, tone)) return false
    if (sk.label !== deriveLabel(e.label, tone)) return false
    const expectedSCs = parentSCs.map(s => s + '_tone' + tone)
    const skinSCs = sk.shortCodes || []
    if (skinSCs.length !== expectedSCs.length) return false
    for (let j = 0; j < skinSCs.length; j++) {
      if (skinSCs[j] !== expectedSCs[j]) return false
    }
  }
  return true
}

// ==================== Encode Emojis ====================

// EMOJI_RECORDS: 7 Uint32 per emoji
//   [0] labelRef (into STRINGS)
//   [1] pointsStart | (pointsCount << 16)
//   [2] scStart | (scCount << 16)
//   [3] emStart | (emCount << 16)
//   [4] skStart | (skCount << 16)
//   [5] group(4) | hasOrder(1) | hasSkins5(1)
//   [6] order
// Hexcode is derived from POINTS at decode time.

// SKIN_RECORDS: 3 Uint32 per non-derivable skin
//   [0] pointsStart | (pointsCount << 16)
//   [1] scStart | (scCount << 16)
//   [2] tone(8) | group(4)
// Hexcode derived from points. Label not stored (not displayed).

const SKIN_REC_SIZE = 3

const points = []
const shortcodeRefs = []
const emoticonRefs = []
const emojiRecs = []
const skinRecs = []

let derivedSkins = 0
let explicitSkins = 0

for (let ei = 0; ei < data.length; ei++) {
  const e = data[ei]

  const labelRef = addString(e.label || '')

  const ptStart = points.length
  for (const cp of toCodepoints(e.emoji)) points.push(cp)
  const ptCount = points.length - ptStart

  const scStart = shortcodeRefs.length
  if (e.shortCodes) for (const s of e.shortCodes) shortcodeRefs.push(addString(s))
  const scCount = shortcodeRefs.length - scStart

  const emStart = emoticonRefs.length
  if (e.emoticon) {
    const arr = Array.isArray(e.emoticon) ? e.emoticon : [e.emoticon]
    for (const m of arr) emoticonRefs.push(addString(m))
  }
  const emCount = emoticonRefs.length - emStart

  let skStart = 0
  let skCount = 0
  const derivable = isDerivable(e)

  if (e.skins && !derivable) {
    skStart = skinRecs.length / SKIN_REC_SIZE
    for (const sk of e.skins) {
      const skPtStart = points.length
      for (const cp of toCodepoints(sk.emoji)) points.push(cp)
      const skPtCount = points.length - skPtStart
      const skScStart = shortcodeRefs.length
      if (sk.shortCodes) for (const s of sk.shortCodes) shortcodeRefs.push(addString(s))
      const skScCount = shortcodeRefs.length - skScStart
      skinRecs.push(
        skPtStart | (skPtCount << 16),
        skScStart | (skScCount << 16),
        (sk.tone || 0) | ((sk.group || 0) << 8)
      )
      skCount++
    }
    explicitSkins += skCount
  } else if (derivable) {
    derivedSkins += 5
  }

  const group = e.group || 0
  const hasOrder = 'order' in e ? 1 : 0
  const hasSkins5 = derivable ? 1 : 0
  const packed = group | (hasOrder << 4) | (hasSkins5 << 5)

  emojiRecs.push(
    labelRef,
    ptStart | (ptCount << 16),
    scStart | (scCount << 16),
    emStart | (emCount << 16),
    skStart | (skCount << 16),
    packed,
    hasOrder ? e.order : 0
  )
}

// Groups
const groupRecs = []
if (messages && messages.groups) {
  for (const g of messages.groups) {
    groupRecs.push(addString(g.key), g.order)
  }
}

// ==================== Assemble Core Binary ====================

const EMOJI_BUF = new Uint32Array(emojiRecs)
const SKIN_BUF = new Uint32Array(skinRecs)
const SC_BUF = new Uint32Array(shortcodeRefs)
const EM_BUF = new Uint32Array(emoticonRefs)
const GRP_BUF = new Uint32Array(groupRecs)
const PT_BUF = new Uint32Array(points)
const STR_BUF = Buffer.concat(stringChunks)

const toRaw = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)

const INDEX = Buffer.concat([
  toRaw(EMOJI_BUF),
  toRaw(SKIN_BUF),
  toRaw(SC_BUF),
  toRaw(EM_BUF),
  toRaw(GRP_BUF),
  toRaw(PT_BUF),
  STR_BUF
])

// ==================== Write raw-index.js ====================

let s = `// https://emojibase.dev version ${version}\n\n`
s += "const b4a = require('b4a')\n"
s += "const { hostToLE32 } = require('convert-endianness')\n\n"
s += `const INDEX = b4a.from('${INDEX.toString('base64')}', 'base64')\n\n`

s += `exports.EMOJI_COUNT = ${data.length}\n`
s += `exports.SKIN_COUNT = ${skinRecs.length / SKIN_REC_SIZE}\n`
s += `exports.GROUP_COUNT = ${groupRecs.length / 2}\n\n`

let n = 0
s += `exports.EMOJI_RECORDS = to32(${n}, ${n += EMOJI_BUF.byteLength})\n`
s += `exports.SKIN_RECORDS = to32(${n}, ${n += SKIN_BUF.byteLength})\n`
s += `exports.SHORTCODES = to32(${n}, ${n += SC_BUF.byteLength})\n`
s += `exports.EMOTICONS = to32(${n}, ${n += EM_BUF.byteLength})\n`
s += `exports.GROUPS = to32(${n}, ${n += GRP_BUF.byteLength})\n`
s += `exports.POINTS = to32(${n}, ${n += PT_BUF.byteLength})\n`
s += `exports.STRINGS = INDEX.subarray(${n}, ${n += STR_BUF.length})\n`
s += '\n'
s += `function to32 (offset, end) {
  const arr = new Uint32Array(INDEX.buffer, offset, (end - offset) / 4)
  hostToLE32(arr)
  return arr
}\n`

fs.writeFileSync(outIndex, s)

// ==================== Tag Inverted Index ====================

const tagInverted = new Map()
for (let ei = 0; ei < data.length; ei++) {
  if (!data[ei].tags) continue
  for (const tag of data[ei].tags) {
    if (!tagInverted.has(tag)) tagInverted.set(tag, [])
    tagInverted.get(tag).push(ei)
  }
}

const sortedTags = [...tagInverted.keys()].sort()
const tagCount = sortedTags.length

const tagStrChunks = []
const tagStrOffsets = [0]
let tagStrOffset = 0
for (const tag of sortedTags) {
  const buf = Buffer.from(tag, 'utf8')
  tagStrChunks.push(buf)
  tagStrOffset += buf.length
  tagStrOffsets.push(tagStrOffset)
}
const TAG_STR_BUF = Buffer.concat(tagStrChunks)

const postingWords = []
const postingOffsets = [0]
for (let ti = 0; ti < tagCount; ti++) {
  const emojiIds = tagInverted.get(sortedTags[ti])
  emojiIds.sort((a, b) => a - b)
  for (const eid of emojiIds) postingWords.push(eid)
  postingOffsets.push(postingWords.length)
}

const TAG_STR_OFF_BUF = new Uint16Array(tagStrOffsets)
const POST_OFF_BUF = new Uint16Array(postingOffsets)
const POST_BUF = new Uint16Array(postingWords)

const TAGS = Buffer.concat([
  toRaw(TAG_STR_OFF_BUF),
  toRaw(POST_OFF_BUF),
  toRaw(POST_BUF),
  TAG_STR_BUF
])

let t = `// https://emojibase.dev version ${version}\n\n`
t += "const b4a = require('b4a')\n"
t += "const { hostToLE16 } = require('convert-endianness')\n\n"
t += `const INDEX = b4a.from('${TAGS.toString('base64')}', 'base64')\n\n`

t += `exports.TAG_COUNT = ${tagCount}\n\n`

let tn = 0
t += `exports.TAG_STR_OFFSETS = to16(${tn}, ${tn += TAG_STR_OFF_BUF.byteLength})\n`
t += `exports.POSTING_OFFSETS = to16(${tn}, ${tn += POST_OFF_BUF.byteLength})\n`
t += `exports.POSTINGS = to16(${tn}, ${tn += POST_BUF.byteLength})\n`
t += `exports.TAG_STRINGS = INDEX.subarray(${tn}, ${tn += TAG_STR_BUF.length})\n`
t += '\n'
t += `function to16 (offset, end) {
  const arr = new Uint16Array(INDEX.buffer, offset, (end - offset) / 2)
  hostToLE16(arr)
  return arr
}\n`

fs.writeFileSync(outTags, t)

// ==================== Summary ====================

console.log(`Wrote ${outIndex}`)
console.log(`  Binary: ${(INDEX.length / 1024).toFixed(1)} KB`)
console.log(`  Emojis: ${data.length}`)
console.log(`  Explicit skins: ${explicitSkins} | Derived: ${derivedSkins}`)
console.log(`Wrote ${outTags}`)
console.log(`  Binary: ${(TAGS.length / 1024).toFixed(1)} KB`)
console.log(`Total: ${((INDEX.length + TAGS.length) / 1024).toFixed(1)} KB`)

// ==================== Helpers ====================

function addShortCodes (list, codes) {
  for (const emoji of list) {
    const sc = codes[emoji.hexcode]
    if (sc !== undefined) {
      emoji.shortCodes = Array.isArray(sc) ? sc : [sc]
    } else if (!emoji.shortCodes) {
      emoji.shortCodes = []
    }
    if (emoji.skins) addShortCodes(emoji.skins, codes)
  }
}

function fixEmoticons (list) {
  for (const emoji of list) {
    if (emoji.emoticon && typeof emoji.emoticon === 'string') {
      emoji.emoticon = [emoji.emoticon]
    }
  }
}

function toCodepoints (emoji) {
  const chars = [...emoji]
  const codes = new Array(chars.length)
  for (let i = 0; i < codes.length; i++) {
    codes[i] = chars[i].codePointAt(0)
  }
  return codes
}

async function fetchJson (url) {
  const response = await fetch(url)
  return await response.json()
}
