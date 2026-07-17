const b4a = require('b4a')

let _raw = null
let _tagStrs = null

function raw () {
  if (!_raw) _raw = require('./raw-tags.js')
  return _raw
}

function tagStrs () {
  if (_tagStrs) return _tagStrs
  const r = raw()
  _tagStrs = new Array(r.TAG_COUNT)
  for (let i = 0; i < r.TAG_COUNT; i++) {
    const start = r.TAG_STR_OFFSETS[i]
    const end = r.TAG_STR_OFFSETS[i + 1]
    _tagStrs[i] = b4a.toString(r.TAG_STRINGS.subarray(start, end))
  }
  return _tagStrs
}

exports.searchTags = function searchTags (term) {
  const r = raw()
  const tags = tagStrs()
  const target = term.toLowerCase()

  const exact = []
  const prefix = []
  const contains = []

  for (let ti = 0; ti < r.TAG_COUNT; ti++) {
    const tag = tags[ti]
    if (tag === target) appendPosting(r, ti, exact)
    else if (tag.startsWith(target)) appendPosting(r, ti, prefix)
    else if (tag.includes(target)) appendPosting(r, ti, contains)
  }

  return { exact, prefix, contains }
}

exports.attachTags = function attachTags (emojis) {
  const r = raw()
  const tags = tagStrs()

  for (let ti = 0; ti < r.TAG_COUNT; ti++) {
    const tag = tags[ti]
    const start = r.POSTING_OFFSETS[ti]
    const end = r.POSTING_OFFSETS[ti + 1]
    for (let i = start; i < end; i++) {
      const eid = r.POSTINGS[i]
      if (eid < emojis.length) {
        const emoji = emojis[eid]
        if (!emoji.tags) emoji.tags = []
        emoji.tags.push(tag)
      }
    }
  }
}

function appendPosting (r, ti, out) {
  const start = r.POSTING_OFFSETS[ti]
  const end = r.POSTING_OFFSETS[ti + 1]
  for (let i = start; i < end; i++) out.push(r.POSTINGS[i])
}
