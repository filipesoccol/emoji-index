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

// ==================== Linear Scan Lookups (zero allocation) ====================

exports.findByHex = function findByHex (hex) {
  if (!hex) return -1
  const r = raw()
  const hexBuf = b4a.from(hex)
  for (let ei = 0; ei < r.EMOJI_COUNT; ei++) {
    const ptPacked = r.EMOJI_RECORDS[ei * EMOJI_REC_SIZE + 1]
    if (matchHex(r, ptPacked & 0xFFFF, ptPacked >>> 16, hexBuf)) return ei
  }
  return -1
}

exports.findByShortCode = function findByShortCode (sc) {
  if (!sc) return -1
  const r = raw()
  const scBuf = b4a.from(sc)
  for (let ei = 0; ei < r.EMOJI_COUNT; ei++) {
    const scPacked = r.EMOJI_RECORDS[ei * EMOJI_REC_SIZE + 2]
    const scStart = scPacked & 0xFFFF
    const scCount = scPacked >>> 16
    for (let i = 0; i < scCount; i++) {
      if (matchSc(r, scStart + i, scBuf)) return ei
    }
  }
  return -1
}

exports.findByEmoji = function findByEmoji (emojiStr) {
  if (!emojiStr) return -1
  const r = raw()
  const stripped = stripVS16(emojiStr)
  for (let ei = 0; ei < r.EMOJI_COUNT; ei++) {
    const ptPacked = r.EMOJI_RECORDS[ei * EMOJI_REC_SIZE + 1]
    const str = palettePointsToString(r, ptPacked & 0xFFFF, ptPacked >>> 16)
    if (str === emojiStr || stripVS16(str) === stripped) return ei
  }
  return -1
}

exports.findSkinParent = function findSkinParent (hex) {
  if (!hex) return -1
  const r = raw()
  const hexBuf = b4a.from(hex)
  for (let ei = 0; ei < r.EMOJI_COUNT; ei++) {
    const base = ei * EMOJI_REC_SIZE
    const packed = r.EMOJI_RECORDS[base + 5]
    const hasSkins5 = (packed >>> 4) & 1
    if (hasSkins5) {
      const ptPacked = r.EMOJI_RECORDS[base + 1]
      const pts = getPalettePoints(r, ptPacked & 0xFFFF, ptPacked >>> 16)
      const parentHex = pointsToHex(pts)
      const hexParts = parentHex.split('-')
      const hexFirst = hexParts[0]
      let hexRest = hexParts.slice(1)
      if (hexRest[0] === 'FE0F') hexRest = hexRest.slice(1)
      for (let tone = 1; tone <= 5; tone++) {
        const skinHex = [hexFirst, TONE_HEX[tone], ...hexRest].join('-')
        if (skinHex === hex) return ei
      }
    } else {
      const skPacked = r.EMOJI_RECORDS[base + 4]
      const skStart = skPacked & 0xFFFF
      const skCount = skPacked >>> 16
      for (let si = 0; si < skCount; si++) {
        const skBase = (skStart + si) * SKIN_REC_SIZE
        const skPtPacked = r.SKIN_RECORDS[skBase]
        if (matchHex(r, skPtPacked & 0xFFFF, skPtPacked >>> 16, hexBuf)) return ei
      }
    }
  }
  return -1
}

exports.decodeOne = function decodeOne (emojiIdx) {
  return decodeEmoji(raw(), emojiIdx)
}

// ==================== Backwards-compatible API ====================

exports.toEmoji = function toEmoji (shortCode) {
  const ei = exports.findByShortCode(shortCode)
  if (ei < 0) return ''
  const r = raw()
  const ptPacked = r.EMOJI_RECORDS[ei * EMOJI_REC_SIZE + 1]
  return palettePointsToString(r, ptPacked & 0xFFFF, ptPacked >>> 16)
}

exports.toShortCode = function toShortCode (emoji) {
  const ei = exports.findByEmoji(emoji)
  if (ei < 0) return ''
  const r = raw()
  const scPacked = r.EMOJI_RECORDS[ei * EMOJI_REC_SIZE + 2]
  return readSc(r, scPacked & 0xFFFF)
}

exports.toCodePoints = function toCodePoints (emoji) {
  const chars = [...emoji]
  const codes = new Array(chars.length)
  for (let i = 0; i < codes.length; i++) {
    codes[i] = chars[i].codePointAt(0)
  }
  return codes
}

// ==================== Scan Helpers ====================

function matchHex (r, ptStart, ptCount, hexBuf) {
  let pos = 0
  let first = true
  for (let i = 0; i < ptCount; i++) {
    const cp = r.POINT_PALETTE[r.POINT_INDICES[ptStart + i]]
    if (cp === 0xFE0F) continue
    if (!first) {
      if (pos >= hexBuf.length || hexBuf[pos] !== 0x2D) return false
      pos++
    }
    first = false
    const h = cp.toString(16).toUpperCase()
    for (let j = 0; j < h.length; j++) {
      if (pos >= hexBuf.length || hexBuf[pos] !== h.charCodeAt(j)) return false
      pos++
    }
  }
  return pos === hexBuf.length
}

function matchSc (r, slot, scBuf) {
  const start = r.SC_OFFSETS[slot]
  const end = r.SC_OFFSETS[slot + 1]
  if (end - start !== scBuf.length) return false
  return b4a.compare(r.SC_STRINGS.subarray(start, end), scBuf) === 0
}

function stripVS16 (str) {
  return str.replace(/\uFE0F/g, '')
}

function palettePointsToString (r, start, count) {
  return String.fromCodePoint(...getPalettePoints(r, start, count))
}

// ==================== Full Data API ====================

exports.decode = function decode () {
  const r = raw()
  const emojis = new Array(r.EMOJI_COUNT)
  for (let ei = 0; ei < r.EMOJI_COUNT; ei++) {
    emojis[ei] = decodeEmoji(r, ei)
  }
  const groups = decodeGroupsFromRaw(r)
  return { emojis, groups }
}

// ==================== Internal Decode ====================

function decodeGroupsFromRaw (r) {
  const groups = new Array(r.GROUP_COUNT)
  for (let i = 0; i < r.GROUP_COUNT; i++) {
    groups[i] = {
      key: readStr(r.STRINGS, r.GROUPS[i * 2]),
      order: r.GROUPS[i * 2 + 1]
    }
  }
  return groups
}

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

function pointsToHex (pts) {
  let hex = ''
  for (let i = 0; i < pts.length; i++) {
    if (pts[i] === 0xFE0F) continue
    if (hex) hex += '-'
    hex += pts[i].toString(16).toUpperCase()
  }
  return hex
}
