const b4a = require('b4a')

const EMOJI_REC_SIZE = 7
const SKIN_REC_SIZE = 3

const TONE_HEX = ['', '1F3FB', '1F3FC', '1F3FD', '1F3FE', '1F3FF']
const TONE_CP = [0, 0x1F3FB, 0x1F3FC, 0x1F3FD, 0x1F3FE, 0x1F3FF]
let _raw = null
let _scToEmoji = null
let _emojiToSc = null

function raw () {
  if (!_raw) _raw = require('./raw-index.js')
  return _raw
}

// ==================== Backwards-compatible API ====================

exports.toEmoji = function toEmoji (shortCode) {
  initLookups()
  return _scToEmoji.get(shortCode) || ''
}

exports.toShortCode = function toShortCode (emoji) {
  initLookups()
  return _emojiToSc.get(emoji) || _emojiToSc.get(stripVS16(emoji)) || ''
}

exports.toCodePoints = function toCodePoints (emoji) {
  const chars = [...emoji]
  const codes = new Array(chars.length)
  for (let i = 0; i < codes.length; i++) {
    codes[i] = chars[i].codePointAt(0)
  }
  return codes
}

function initLookups () {
  if (_scToEmoji) return

  _scToEmoji = new Map()
  _emojiToSc = new Map()

  const r = raw()

  for (let ei = 0; ei < r.EMOJI_COUNT; ei++) {
    const base = ei * EMOJI_REC_SIZE

    const ptPacked = r.EMOJI_RECORDS[base + 1]
    const emojiStr = pointsToString(r.POINTS, ptPacked & 0xFFFF, ptPacked >>> 16)
    const stripped = stripVS16(emojiStr)

    const scPacked = r.EMOJI_RECORDS[base + 2]
    const scStart = scPacked & 0xFFFF
    const scCount = scPacked >>> 16

    for (let i = 0; i < scCount; i++) {
      const sc = readStr(r.STRINGS, r.SHORTCODES[scStart + i])
      _scToEmoji.set(sc, emojiStr)
      if (i === 0) {
        _emojiToSc.set(emojiStr, sc)
        if (stripped !== emojiStr) _emojiToSc.set(stripped, sc)
      }
    }
  }
}

// ==================== Full Data API ====================

exports.decode = function decode () {
  const r = raw()

  // Decode emojis
  const emojis = new Array(r.EMOJI_COUNT)
  for (let ei = 0; ei < r.EMOJI_COUNT; ei++) {
    emojis[ei] = decodeEmoji(r, ei)
  }

  // Decode groups
  const groups = new Array(r.GROUP_COUNT)
  for (let i = 0; i < r.GROUP_COUNT; i++) {
    groups[i] = {
      key: readStr(r.STRINGS, r.GROUPS[i * 2]),
      order: r.GROUPS[i * 2 + 1]
    }
  }

  return { emojis, groups }
}

function decodeEmoji (r, ei) {
  const base = ei * EMOJI_REC_SIZE

  const ptPacked = r.EMOJI_RECORDS[base + 1]
  const emojiPts = getPoints(r.POINTS, ptPacked & 0xFFFF, ptPacked >>> 16)
  const emoji = String.fromCodePoint(...emojiPts)
  const hexcode = pointsToHex(emojiPts)

  // Shortcodes
  const scPacked = r.EMOJI_RECORDS[base + 2]
  const scStart = scPacked & 0xFFFF
  const scCount = scPacked >>> 16
  const shortCodes = new Array(scCount)
  for (let i = 0; i < scCount; i++) shortCodes[i] = readStr(r.STRINGS, r.SHORTCODES[scStart + i])

  // Emoticons
  const emPacked = r.EMOJI_RECORDS[base + 3]
  const emStart = emPacked & 0xFFFF
  const emCount = emPacked >>> 16
  let emoticon
  if (emCount > 0) {
    emoticon = new Array(emCount)
    for (let i = 0; i < emCount; i++) emoticon[i] = readStr(r.STRINGS, r.EMOTICONS[emStart + i])
  }

  // Packed metadata: group(4) | hasOrder(1) | hasSkins5(1)
  const packed = r.EMOJI_RECORDS[base + 5]
  const group = packed & 0xF
  const hasOrder = (packed >>> 4) & 1
  const hasSkins5 = (packed >>> 5) & 1

  // Skins
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

  if (hasOrder) obj.order = r.EMOJI_RECORDS[base + 6]
  if (emoticon) obj.emoticon = emoticon
  if (skins) obj.skins = skins

  return obj
}

function decodeSkin (r, base) {
  const ptPacked = r.SKIN_RECORDS[base]
  const emojiPts = getPoints(r.POINTS, ptPacked & 0xFFFF, ptPacked >>> 16)
  const emoji = String.fromCodePoint(...emojiPts)
  const hexcode = pointsToHex(emojiPts)

  const scPacked = r.SKIN_RECORDS[base + 1]
  const scStart = scPacked & 0xFFFF
  const scCount = scPacked >>> 16
  const shortCodes = new Array(scCount)
  for (let i = 0; i < scCount; i++) shortCodes[i] = readStr(r.STRINGS, r.SHORTCODES[scStart + i])

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

function getPoints (pts, start, count) {
  const codes = new Array(count)
  for (let i = 0; i < count; i++) codes[i] = pts[start + i]
  return codes
}

function pointsToString (pts, start, count) {
  return String.fromCodePoint(...getPoints(pts, start, count))
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
