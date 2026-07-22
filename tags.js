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

  // Exact: O(log n) binary search on sorted tags
  let lo = 0
  let hi = r.TAG_COUNT
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (tags[mid] < target) lo = mid + 1
    else hi = mid
  }

  // From lower bound: exact + prefix matches are consecutive
  for (let ti = lo; ti < r.TAG_COUNT; ti++) {
    const tag = tags[ti]
    if (tag === target) appendPosting(r, ti, exact)
    else if (tag.startsWith(target)) appendPosting(r, ti, prefix)
    else break
  }

  // Contains: O(n) full scan, skipping already matched range
  for (let ti = 0; ti < lo; ti++) {
    if (tags[ti].includes(target)) appendPosting(r, ti, contains)
  }
  const rangeEnd = lo + exact.length + prefix.length
  for (let ti = rangeEnd; ti < r.TAG_COUNT; ti++) {
    if (tags[ti].includes(target)) appendPosting(r, ti, contains)
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
