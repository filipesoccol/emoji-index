# emoji-index

Compact binary emoji index with full [emojibase](https://emojibase.dev) data.

```
npm install emoji-index
```

## Size

| Module | Binary | Contents |
|---|---|---|
| `emoji-index` | 160 KB | Core: 1,949 emojis with labels, shortcodes, emoticons, skin tones, groups |
| `emoji-index/tags` | 55 KB | Optional: 3,638-tag inverted index for search |
| **Total** | **215 KB** | |

## Usage

```js
const e = require('emoji-index')

// Shortcode lookup
e.toEmoji('neutral')   // '😐'
e.toShortCode('😐')    // 'neutral'

// Full dataset
const { emojis, groups } = e.decode()
```

### Tags (optional)

```js
const { searchTags, attachTags } = require('emoji-index/tags')

// Inverted index search (O(log n) exact/prefix, O(n) substring)
const { exact, prefix, contains } = searchTags('happy')

// Attach tags to decoded emojis
const { emojis } = require('emoji-index').decode()
attachTags(emojis)
// emojis[0].tags → ['cheerful', 'face', 'grin', ...]
```

## Features

- 1,949 emojis with labels, shortcodes, emoticons, skin tones, groups
- Skin tone derivation (1,555 of 2,030 skins generated at runtime)
- Hexcodes derived from codepoints at decode time
- Dictionary-encoded inverted tag index with sorted posting lists
- Binary-packed records with deduplicated string pool

## License

Apache 2.0
