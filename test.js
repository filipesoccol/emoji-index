const test = require('brittle')
const e = require('./')
const t_ = require('./tags')

test('shortcodes to emoji', function (t) {
  t.is(e.toEmoji('neutral'), '😐️')
  t.is(e.toEmoji('+1'), '👍️')
  t.is(e.toEmoji('-1'), '👎️')
  t.is(e.toEmoji('wales'), '🏴󠁧󠁢󠁷󠁬󠁳󠁿')
  t.is(e.toEmoji('not-an-emoji'), '')
})

test('emoji to shortcodes', function (t) {
  t.is(e.toShortCode('😐'), 'neutral')
  t.is(e.toShortCode('😐️'), 'neutral')
  t.is(e.toShortCode('👍'), '+1')
  t.is(e.toShortCode('👍️'), '+1')
  t.is(e.toShortCode('👎'), '-1')
  t.is(e.toShortCode('🏴󠁧󠁢󠁷󠁬󠁳󠁿'), 'flag_gbwls')
  t.is(e.toShortCode('not-an-emoji'), '')
})

test('emojis over text', function (t) {
  t.is(e.toEmoji('heart'), '❤️')
  t.is(e.toShortCode('❤️'), 'heart')
})

test('decode returns emojis', function (t) {
  const { emojis } = e.decode()

  t.ok(emojis.length > 1800, 'has many emojis: ' + emojis.length)

  const first = emojis[0]
  t.is(typeof first.label, 'string')
  t.is(typeof first.hexcode, 'string')
  t.is(typeof first.emoji, 'string')
  t.ok(Array.isArray(first.shortCodes), 'has shortCodes array')
  t.is(typeof first.group, 'number')
})

test('attachTags adds tags to decoded emojis', function (t) {
  const { emojis } = e.decode()
  t_.attachTags(emojis)

  const grinning = emojis.find(em => em.shortCodes.includes('grinning'))
  t.ok(grinning, 'found grinning emoji')
  t.ok(grinning.tags && grinning.tags.length > 0, 'has tags')
  t.ok(grinning.tags.includes('face'), 'has face tag')
})

test('decode emoji has emoticons', function (t) {
  const { emojis } = e.decode()

  const smile = emojis.find(em => em.shortCodes.includes('smile'))
  t.ok(smile, 'found smile emoji')
  t.ok(smile.emoticon && smile.emoticon.length > 0, 'has emoticons')
  t.ok(smile.emoticon.includes(':D'), 'has :D emoticon')
})

test('decode emoji has skins', function (t) {
  const { emojis } = e.decode()

  const thumbsUp = emojis.find(em => em.shortCodes.includes('+1'))
  t.ok(thumbsUp, 'found thumbs up emoji')
  t.ok(thumbsUp.skins, 'has skins')
  t.is(thumbsUp.skins.length, 5, 'has 5 skin tones')

  const skin = thumbsUp.skins[0]
  t.is(typeof skin.label, 'string')
  t.is(typeof skin.hexcode, 'string')
  t.is(typeof skin.emoji, 'string')
  t.is(skin.tone, 1, 'first skin is tone 1')
  t.ok(Array.isArray(skin.shortCodes), 'skin has shortCodes')
  t.is(skin.group, thumbsUp.group, 'skin group matches parent')
})

test('decode has groups', function (t) {
  const { groups } = e.decode()

  t.ok(groups.length >= 9, 'has groups: ' + groups.length)
  t.is(typeof groups[0].key, 'string')
  t.is(typeof groups[0].order, 'number')
})

test('decode emoji has no stripped fields', function (t) {
  const { emojis } = e.decode()

  const first = emojis[0]
  t.is(first.text, undefined, 'text stripped')
  t.is(first.type, undefined, 'type stripped')
  t.is(first.version, undefined, 'version stripped')
  t.is(first.subgroup, undefined, 'subgroup stripped')
})

test('searchTags exact match', function (t) {
  const result = t_.searchTags('face')
  t.ok(result.exact.length > 50, 'many emojis tagged face: ' + result.exact.length)
  t.ok(result.prefix.length >= 0, 'prefix may include face* tags')
})

test('searchTags prefix match', function (t) {
  const result = t_.searchTags('hap')
  t.ok(result.exact.length === 0, 'no exact match for hap')
  t.ok(result.prefix.length > 0, 'prefix matches for hap: ' + result.prefix.length)
})

test('searchTags contains match', function (t) {
  const result = t_.searchTags('mil')
  t.ok(result.contains.length > 0, 'contains matches for mil: ' + result.contains.length)
})

test('searchTags no match', function (t) {
  const result = t_.searchTags('zzzznotag')
  t.is(result.exact.length, 0)
  t.is(result.prefix.length, 0)
  t.is(result.contains.length, 0)
})

test('findByHex', function (t) {
  const idx = e.findByHex('1F600')
  t.ok(idx >= 0, 'found grinning')
  t.is(e.decodeOne(idx).hexcode, '1F600', 'correct emoji')
  t.is(e.findByHex('ZZZZZ'), -1, 'not found')
})

test('findByShortCode', function (t) {
  const idx = e.findByShortCode('grinning')
  t.ok(idx >= 0, 'found grinning')
  t.is(e.decodeOne(idx).hexcode, '1F600', 'correct emoji')
  t.is(e.findByShortCode('not_a_real_shortcode'), -1, 'not found')
})

test('findByEmoji', function (t) {
  const idx = e.findByEmoji('😀')
  t.ok(idx >= 0, 'found grinning')
  t.is(e.decodeOne(idx).hexcode, '1F600', 'correct emoji')
  t.is(e.findByEmoji('not-an-emoji'), -1, 'not found')
})

test('findSkinParent', function (t) {
  const parentIdx = e.findSkinParent('1F44D-1F3FB')
  t.ok(parentIdx >= 0, 'found skin parent')
  t.is(e.decodeOne(parentIdx).hexcode, '1F44D', 'parent is thumbs up')
  t.is(e.findSkinParent('ZZZZZ'), -1, 'not found')
})

test('decodeOne', function (t) {
  const { emojis } = e.decode()
  for (let i = 0; i < 20; i++) {
    const one = e.decodeOne(i)
    t.is(one.emoji, emojis[i].emoji, 'matches at ' + i)
  }
})

test('decode consistency with toEmoji/toShortCode', function (t) {
  const { emojis } = e.decode()

  for (const em of emojis.slice(0, 100)) {
    if (em.shortCodes.length === 0) continue
    const sc = em.shortCodes[0]
    t.is(e.toEmoji(sc), em.emoji, 'toEmoji matches decode for ' + sc)
    t.is(e.toShortCode(em.emoji), sc, 'toShortCode matches decode for ' + em.emoji)
  }
})
