# emoji-index

Compact binary emoji index (~286 KB) with full [emojibase](https://emojibase.dev) data.

```
npm install emoji-index
```

## Usage

```js
const e = require('emoji-index')

// Shortcode lookup
e.toEmoji('neutral')   // '😐'
e.toShortCode('😐')    // 'neutral'

// Full dataset
const { emojis, groups } = e.decode()

// Tag search (roaring bitmap inverted index)
const { exact, prefix, contains } = e.searchTags('happy')
```

## Features

- 1,949 emojis with labels, shortcodes, tags, emoticons, skin tones, groups
- Skin tone derivation (1,555 of 2,030 skins generated at runtime)
- Roaring bitmap inverted tag index (3,638 tags) for fast search
- Binary-packed records with deduplicated string pool

## License

Apache 2.0
