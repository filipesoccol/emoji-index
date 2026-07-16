import fs from 'fs'
import fetch from 'node-fetch'
import { fileURLToPath } from 'url-file-url'

const out = fileURLToPath(new URL('../raw-index.js', import.meta.url))
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

// Pre-add empty string so ref=0 always means empty
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

// ==================== Tag Dictionary ====================

const tagList = []
const tagMap = new Map()

function addTag (tag) {
  if (tagMap.has(tag)) return tagMap.get(tag)
  const idx = tagList.length
  tagList.push(addString(tag))
  tagMap.set(tag, idx)
  return idx
}

// ==================== Skin Derivation Check ====================

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

function deriveSC (parentSCs, tone) {
  return parentSCs.map(s => s + '_tone' + tone)
}

function isDerivable (e) {
  if (!e.skins || e.skins.length !== 5) return false

  const parentSCs = e.shortCodes || []
  const parentPts = toCodepoints(e.emoji)

  for (let i = 0; i < 5; i++) {
    const sk = e.skins[i]
    const tone = sk.tone
    if (!tone || tone < 1 || tone > 5) return false

    if (sk.hexcode !== deriveHex(e.hexcode, tone)) return false
    if (sk.label !== deriveLabel(e.label, tone)) return false

    const expectedSCs = deriveSC(parentSCs, tone)
    const skinSCs = sk.shortCodes || []
    if (skinSCs.length !== expectedSCs.length) return false
    for (let j = 0; j < skinSCs.length; j++) {
      if (skinSCs[j] !== expectedSCs[j]) return false
    }
  }

  return true
}

// ==================== Encode ====================

// EMOJI_RECORDS: 9 Uint32 per emoji (stripped text slot)
//   [0] labelRef
//   [1] hexcodeRef
//   [2] pointsStart | (pointsCount << 16)
//   [3] tagRefsStart | (tagRefsCount << 16)
//   [4] scStart | (scCount << 16)
//   [5] emStart | (emCount << 16)
//   [6] skStart | (skCount << 16)   -- for explicit skins; skCount=0 if derivable
//   [7] group(4) | hasOrder(1) | hasSkins5(1) | 0(26)
//   [8] order

// SKIN_RECORDS: 5 Uint32 per skin (only non-derivable skins)
//   [0] hexcodeRef
//   [1] labelRef
//   [2] pointsStart | (pointsCount << 16)
//   [3] scStart | (scCount << 16)
//   [4] tone(8) | group(4) | 0(20)

const EMOJI_REC_SIZE = 9
const SKIN_REC_SIZE = 5

const points = []
const tagRefs = []
const shortcodeRefs = []
const emoticonRefs = []
const emojiRecs = []
const skinRecs = []

let derivedSkins = 0
let explicitSkins = 0

for (let ei = 0; ei < data.length; ei++) {
  const e = data[ei]

  const labelRef = addString(e.label || '')
  const hexRef = addString(e.hexcode || '')

  // Codepoints
  const ptStart = points.length
  for (const cp of toCodepoints(e.emoji)) points.push(cp)
  const ptCount = points.length - ptStart

  // Tags
  const trStart = tagRefs.length
  if (e.tags) for (const t of e.tags) tagRefs.push(addTag(t))
  const trCount = tagRefs.length - trStart

  // Shortcodes
  const scStart = shortcodeRefs.length
  if (e.shortCodes) for (const s of e.shortCodes) shortcodeRefs.push(addString(s))
  const scCount = shortcodeRefs.length - scStart

  // Emoticons
  const emStart = emoticonRefs.length
  if (e.emoticon) {
    const arr = Array.isArray(e.emoticon) ? e.emoticon : [e.emoticon]
    for (const m of arr) emoticonRefs.push(addString(m))
  }
  const emCount = emoticonRefs.length - emStart

  // Skins
  let skStart = 0
  let skCount = 0
  const derivable = isDerivable(e)

  if (e.skins && !derivable) {
    skStart = skinRecs.length / SKIN_REC_SIZE
    for (const sk of e.skins) {
      const skHexRef = addString(sk.hexcode || '')
      const skLabelRef = addString(sk.label || '')

      const skPtStart = points.length
      for (const cp of toCodepoints(sk.emoji)) points.push(cp)
      const skPtCount = points.length - skPtStart

      const skScStart = shortcodeRefs.length
      if (sk.shortCodes) for (const s of sk.shortCodes) shortcodeRefs.push(addString(s))
      const skScCount = shortcodeRefs.length - skScStart

      const skGroup = sk.group || 0

      skinRecs.push(
        skHexRef,                              // [0]
        skLabelRef,                            // [1]
        skPtStart | (skPtCount << 16),         // [2]
        skScStart | (skScCount << 16),         // [3]
        (sk.tone || 0) | (skGroup << 8)        // [4]
      )
      skCount++
    }
    explicitSkins += skCount
  } else if (derivable) {
    derivedSkins += 5
  }

  // Pack metadata: group(4) | hasOrder(1) | hasSkins5(1)
  const group = e.group || 0
  const hasOrder = 'order' in e ? 1 : 0
  const hasSkins5 = derivable ? 1 : 0
  const packed = group | (hasOrder << 4) | (hasSkins5 << 5)

  emojiRecs.push(
    labelRef,                              // [0]
    hexRef,                                // [1]
    ptStart | (ptCount << 16),             // [2]
    trStart | (trCount << 16),             // [3]
    scStart | (scCount << 16),             // [4]
    emStart | (emCount << 16),             // [5]
    skStart | (skCount << 16),             // [6]
    packed,                                // [7]
    hasOrder ? e.order : 0                 // [8]
  )
}

// Groups from messages
const groupRecs = []
if (messages && messages.groups) {
  for (const g of messages.groups) {
    groupRecs.push(addString(g.key), g.order)
  }
}

// ==================== Assemble Binary ====================

const EMOJI_BUF = new Uint32Array(emojiRecs)
const SKIN_BUF = new Uint32Array(skinRecs)
const TAG_DICT_BUF = new Uint32Array(tagList)
const SC_BUF = new Uint32Array(shortcodeRefs)
const EM_BUF = new Uint32Array(emoticonRefs)
const GRP_BUF = new Uint32Array(groupRecs)
const PT_BUF = new Uint32Array(points)
const TR_BUF = new Uint16Array(tagRefs)
const STR_BUF = Buffer.concat(stringChunks)

const toRaw = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)

const INDEX = Buffer.concat([
  toRaw(EMOJI_BUF),
  toRaw(SKIN_BUF),
  toRaw(TAG_DICT_BUF),
  toRaw(SC_BUF),
  toRaw(EM_BUF),
  toRaw(GRP_BUF),
  toRaw(PT_BUF),
  toRaw(TR_BUF),
  STR_BUF
])

// ==================== Write raw-index.js ====================

let s = `// https://emojibase.dev version ${version}\n\n`
s += "const b4a = require('b4a')\n"
s += "const { hostToLE16, hostToLE32 } = require('convert-endianness')\n\n"
s += `const INDEX = b4a.from('${INDEX.toString('base64')}', 'base64')\n\n`

s += `exports.EMOJI_COUNT = ${data.length}\n`
s += `exports.SKIN_COUNT = ${skinRecs.length / SKIN_REC_SIZE}\n`
s += `exports.TAG_DICT_COUNT = ${tagList.length}\n`
s += `exports.GROUP_COUNT = ${groupRecs.length / 2}\n\n`

let n = 0
s += `exports.EMOJI_RECORDS = to32(${n}, ${n += EMOJI_BUF.byteLength})\n`
s += `exports.SKIN_RECORDS = to32(${n}, ${n += SKIN_BUF.byteLength})\n`
s += `exports.TAG_DICT = to32(${n}, ${n += TAG_DICT_BUF.byteLength})\n`
s += `exports.SHORTCODES = to32(${n}, ${n += SC_BUF.byteLength})\n`
s += `exports.EMOTICONS = to32(${n}, ${n += EM_BUF.byteLength})\n`
s += `exports.GROUPS = to32(${n}, ${n += GRP_BUF.byteLength})\n`
s += `exports.POINTS = to32(${n}, ${n += PT_BUF.byteLength})\n`
s += `exports.TAG_REFS = to16(${n}, ${n += TR_BUF.byteLength})\n`
s += `exports.STRINGS = INDEX.subarray(${n}, ${n += STR_BUF.length})\n`
s += '\n'
s += `function to16 (offset, end) {
  const arr = new Uint16Array(INDEX.buffer, offset, (end - offset) / 2)
  hostToLE16(arr)
  return arr
}\n\n`
s += `function to32 (offset, end) {
  const arr = new Uint32Array(INDEX.buffer, offset, (end - offset) / 4)
  hostToLE32(arr)
  return arr
}\n`

fs.writeFileSync(out, s)

const sizeKB = (INDEX.length / 1024).toFixed(1)
const base64KB = (Buffer.byteLength(INDEX.toString('base64')) / 1024).toFixed(1)
console.log(`Wrote ${out}`)
console.log(`  Binary: ${sizeKB} KB`)
console.log(`  Base64: ${base64KB} KB`)
console.log(`  Emojis: ${data.length}`)
console.log(`  Explicit skins: ${explicitSkins} (stored)`)
console.log(`  Derived skins: ${derivedSkins} (generated at runtime)`)
console.log(`  Unique tags: ${tagList.length}`)
console.log(`  Shortcodes: ${shortcodeRefs.length}`)
console.log(`  Points: ${points.length}`)
console.log(`  Strings: ${STR_BUF.length} bytes`)

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
