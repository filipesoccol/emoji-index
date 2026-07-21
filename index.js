const b4a = require('b4a')

const EMOJI_REC_SIZE = 6
const SKIN_REC_SIZE = 3

const TONE_HEX = ['', '1F3FB', '1F3FC', '1F3FD', '1F3FE', '1F3FF']
const TONE_CP = [0, 0x1F3FB, 0x1F3FC, 0x1F3FD, 0x1F3FE, 0x1F3FF]
let _raw = null

function raw () {
  if (!_raw) _raw = require('./raw-index.js')
  return _raw
}

// ==================== Binary Search Lookups ====================

exports.findByHex = function findByHex (hex) {
  const r = raw()
  const hexBuf = b4a.from(hex)
  let lo = 0
  let hi = r.EMOJI_COUNT
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    const ei = r.HEX_SORTED[mid]
    const cmp = compareHex(r, ei, hexBuf)
    if (cmp < 0) lo = mid + 1
    else if (cmp > 0) hi = mid
    else return ei
  }
  return -1
}

exports.findByShortCode = function findByShortCode (sc) {
  const r = raw()
  const scBuf = b4a.from(sc)
  let lo = 0
  let hi = r.SC_SORTED.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    const slot = r.SC_SORTED[mid]
    const cmp = compareSc(r, slot, scBuf)
    if (cmp < 0) lo = mid + 1
    else if (cmp > 0) hi = mid
    else return r.SC_TO_EMOJI[slot]
  }
  return -1
}

exports.findByEmoji = function findByEmoji (emojiStr) {
  // Convert emoji string to hex, then search hex index
  const pts = []
  for (const ch of emojiStr) pts.push(ch.codePointAt(0))
  const hex = pointsToHex(pts)
  const idx = exports.findByHex(hex)
  if (idx >= 0) return idx
  // Try with VS16 stripped (already stripped in pointsToHex)
  return -1
}

exports.findSkinParent = function findSkinParent (hex) {
  const r = raw()
  const hexBuf = b4a.from(hex)
  let lo = 0
  let hi = r.SKIN_HEX_COUNT
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    const start = r.SKIN_HEX_OFFSETS[mid]
    const end = r.SKIN_HEX_OFFSETS[mid + 1]
    const cmp = b4a.compare(r.SKIN_HEX_STRINGS.subarray(start, end), hexBuf)
    if (cmp < 0) lo = mid + 1
    else if (cmp > 0) hi = mid
    else return r.SKIN_HEX_PARENTS[mid]
  }
  return -1
}

exports.findSkinParentByEmoji = function findSkinParentByEmoji (emojiStr) {
  const pts = []
  for (const ch of emojiStr) pts.push(ch.codePointAt(0))
  return exports.findSkinParent(pointsToHex(pts))
}

exports.findSkinParentByShortCode = function findSkinParentByShortCode (sc) {
  // Skin shortcodes end with _toneN — find parent sc + tone
  const match = sc.match(/_tone([1-5])$/)
  if (!match) return -1
  const parentSc = sc.slice(0, -6)
  return exports.findByShortCode(parentSc)
}

exports.labelAt = function labelAt (emojiIdx) {
  const r = raw()
  return readStr(r.STRINGS, r.EMOJI_RECORDS[emojiIdx * EMOJI_REC_SIZE])
}

exports.groupAt = function groupAt (emojiIdx) {
  const r = raw()
  return r.EMOJI_RECORDS[emojiIdx * EMOJI_REC_SIZE + 5] & 0xF
}

exports.hasEmoticon = function hasEmoticon (emojiIdx) {
  const r = raw()
  return (r.EMOJI_RECORDS[emojiIdx * EMOJI_REC_SIZE + 3] >>> 16) > 0
}

exports.emojiCount = function emojiCount () {
  return raw().EMOJI_COUNT
}

// ==================== Binary Search Helpers ====================

function compareHex (r, emojiIdx, hexBuf) {
  // Build hex from stored codepoints, compare byte-by-byte against hexBuf
  const base = emojiIdx * EMOJI_REC_SIZE
  const ptPacked = r.EMOJI_RECORDS[base + 1]
  const ptStart = ptPacked & 0xFFFF
  const ptCount = ptPacked >>> 16

  // Build hex bytes on the fly
  let pos = 0
  let first = true
  for (let i = 0; i < ptCount; i++) {
    const cp = r.POINT_PALETTE[r.POINT_INDICES[ptStart + i]]
    if (cp === 0xFE0F) continue
    if (!first) {
      if (pos >= hexBuf.length) return 1
      const c = 0x2D // '-'
      if (c < hexBuf[pos]) return -1
      if (c > hexBuf[pos]) return 1
      pos++
    }
    first = false
    // Write hex digits of cp and compare
    const hexStr = cp.toString(16).toUpperCase()
    for (let j = 0; j < hexStr.length; j++) {
      if (pos >= hexBuf.length) return 1
      const a = hexStr.charCodeAt(j)
      const b = hexBuf[pos]
      if (a < b) return -1
      if (a > b) return 1
      pos++
    }
  }
  if (pos < hexBuf.length) return -1
  return 0
}

function compareSc (r, slot, scBuf) {
  const start = r.SC_OFFSETS[slot]
  const end = r.SC_OFFSETS[slot + 1]
  return b4a.compare(r.SC_STRINGS.subarray(start, end), scBuf)
}

// ==================== Backwards-compatible API ====================

exports.toEmoji = function toEmoji (shortCode) {
  const idx = exports.findByShortCode(shortCode)
  if (idx < 0) return ''
  const r = raw()
  const base = idx * EMOJI_REC_SIZE
  const ptPacked = r.EMOJI_RECORDS[base + 1]
  return palettePointsToString(r, ptPacked & 0xFFFF, ptPacked >>> 16)
}

exports.toShortCode = function toShortCode (emoji) {
  let idx = exports.findByEmoji(emoji)
  if (idx < 0) idx = exports.findByEmoji(stripVS16(emoji))
  if (idx < 0) return ''
  const r = raw()
  const base = idx * EMOJI_REC_SIZE
  const scPacked = r.EMOJI_RECORDS[base + 2]
  const scStart = scPacked & 0xFFFF
  const scCount = scPacked >>> 16
  if (scCount === 0) return ''
  return readSc(r, scStart)
}

exports.toCodePoints = function toCodePoints (emoji) {
  const chars = [...emoji]
  const codes = new Array(chars.length)
  for (let i = 0; i < codes.length; i++) {
    codes[i] = chars[i].codePointAt(0)
  }
  return codes
}

// ==================== Full Data API ====================

exports.decode = function decode () {
  const r = raw()
  const emojis = new Array(r.EMOJI_COUNT)
  for (let ei = 0; ei < r.EMOJI_COUNT; ei++) {
    emojis[ei] = decodeEmoji(r, ei)
  }
  const groups = new Array(r.GROUP_COUNT)
  for (let i = 0; i < r.GROUP_COUNT; i++) {
    groups[i] = {
      key: readStr(r.STRINGS, r.GROUPS[i * 2]),
      order: r.GROUPS[i * 2 + 1]
    }
  }
  return { emojis, groups }
}

exports.decodeOne = function decodeOne (emojiIdx) {
  return decodeEmoji(raw(), emojiIdx)
}

exports.decodeGroups = function decodeGroups () {
  const r = raw()
  const groups = new Array(r.GROUP_COUNT)
  for (let i = 0; i < r.GROUP_COUNT; i++) {
    groups[i] = {
      key: readStr(r.STRINGS, r.GROUPS[i * 2]),
      order: r.GROUPS[i * 2 + 1]
    }
  }
  return groups
}

// ==================== Internal Decode ====================

function decodeEmoji (r, ei) {
  const base = ei * EMOJI_REC_SIZE

  const ptPacked = r.EMOJI_RECORDS[base + 1]
  const emojiPts = getPalettePoints(r, ptPacked & 0xFFFF, ptPacked >>> 16)
  const emoji = String.fromCodePoint(...emojiPts)
  const hexcode = pointsToHex(emojiPts)

  const scPacked = r.EMOJI_RECORDS[base + 2]
  const scStart = scPacked & 0xFFFF
  const scCount = scPacked >>> 16
  const shortCodes = new Array(scCount)
  for (let i = 0; i < scCount; i++) shortCodes[i] = readSc(r, scStart + i)

  const emPacked = r.EMOJI_RECORDS[base + 3]
  const emStart = emPacked & 0xFFFF
  const emCount = emPacked >>> 16
  let emoticon
  if (emCount > 0) {
    emoticon = new Array(emCount)
    for (let i = 0; i < emCount; i++) emoticon[i] = readStr(r.STRINGS, r.EMOTICONS[emStart + i])
  }

  const packed = r.EMOJI_RECORDS[base + 5]
  const group = packed & 0xF
  const hasSkins5 = (packed >>> 4) & 1
  const order = packed >>> 5

  let skins
  if (hasSkins5) {
    skins = deriveSkins(hexcode, shortCodes, emojiPts, group)
  } else {
    const skPacked = r.EMOJI_RECORDS[base + 4]
    const skStart = skPacked & 0xFFFF
    const skCount = skPacked >>> 16
    if (skCount > 0) {
      skins = new Array(skCount)
      for (let i = 0; i < skCount; i++) {
        skins[i] = decodeSkin(r, (skStart + i) * SKIN_REC_SIZE)
      }
    }
  }

  const label = readStr(r.STRINGS, r.EMOJI_RECORDS[base])
  const obj = { label, hexcode, emoji, group, shortCodes }

  if (order > 0) obj.order = order - 1
  if (emoticon) obj.emoticon = emoticon
  if (skins) obj.skins = skins

  return obj
}

function decodeSkin (r, base) {
  const ptPacked = r.SKIN_RECORDS[base]
  const emojiPts = getPalettePoints(r, ptPacked & 0xFFFF, ptPacked >>> 16)
  const emoji = String.fromCodePoint(...emojiPts)
  const hexcode = pointsToHex(emojiPts)

  const scPacked = r.SKIN_RECORDS[base + 1]
  const scStart = scPacked & 0xFFFF
  const scCount = scPacked >>> 16
  const shortCodes = new Array(scCount)
  for (let i = 0; i < scCount; i++) shortCodes[i] = readSc(r, scStart + i)

  const misc = r.SKIN_RECORDS[base + 2]
  return { label: '', hexcode, emoji, tone: misc & 0xFF, group: (misc >>> 8) & 0xF, shortCodes }
}

function deriveSkins (parentHex, parentSCs, parentPts, group) {
  const skins = new Array(5)
  const basePts = [parentPts[0]]
  let rest = parentPts.slice(1)
  if (rest[0] === 0xFE0F) rest = rest.slice(1)
  const hexParts = parentHex.split('-')
  const hexFirst = hexParts[0]
  let hexRest = hexParts.slice(1)
  if (hexRest[0] === 'FE0F') hexRest = hexRest.slice(1)

  for (let tone = 1; tone <= 5; tone++) {
    const hexcode = [hexFirst, TONE_HEX[tone], ...hexRest].join('-')
    const emoji = String.fromCodePoint(...basePts, TONE_CP[tone], ...rest)
    const shortCodes = parentSCs.map(function (s) { return s + '_tone' + tone })
    skins[tone - 1] = { label: '', hexcode, emoji, tone, group, shortCodes }
  }

  return skins
}

// ==================== Helpers ====================

function stripVS16 (str) {
  return str.replace(/\uFE0F/g, '')
}

function readStr (strings, ref) {
  const offset = ref & 0xFFFFF
  const length = ref >>> 20
  if (length === 0) return ''
  return b4a.toString(strings.subarray(offset, offset + length))
}

function readSc (r, idx) {
  const start = r.SC_OFFSETS[idx]
  const end = r.SC_OFFSETS[idx + 1]
  if (start === end) return ''
  return b4a.toString(r.SC_STRINGS.subarray(start, end))
}

function getPalettePoints (r, start, count) {
  const codes = new Array(count)
  for (let i = 0; i < count; i++) codes[i] = r.POINT_PALETTE[r.POINT_INDICES[start + i]]
  return codes
}

function palettePointsToString (r, start, count) {
  return String.fromCodePoint(...getPalettePoints(r, start, count))
}

function pointsToHex (pts) {
  let hex = ''
  for (let i = 0; i < pts.length; i++) {
    if (pts[i] === 0xFE0F) continue
    if (hex) hex += '-'
    hex += pts[i].toString(16).toUpperCase()
  }
  return hex
}
