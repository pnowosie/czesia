<h1><img src="czesia-logo.png" alt="Czesia" height="105" align="top"> <span style="font-size: 72px; font-family: Arial, Helvetica, sans-serif;">Czesia</span></h1>

Self-contained chess puzzle trainer — pure HTML/JS, no server, just tactics [👉 try it now](https://pnowosie.github.io/czesia/)

## Why?

I made this for myself and my son. We both enjoy chess puzzles, but online trainers come with rankings that go up and down. My boy gets upset when his rating drops after a failed puzzle.

[Lichess puzzles](https://lichess.org/training) are fantastic — if you're happy with them, just don't bother. But if you want to train your favorite collections (from PGN) without ratings or pressure, Czesia might help.

## How it was made

This whole thing came together in a few hours of pair-programming with AI coding agents — [Claude](https://claude.ai) and [Cursor](https://cursor.com). Turns out they're pretty good at turning ideas into working code.

## Adding Your Own Puzzles

### Quick Start

1. Create a folder in `puzzles/` with your collection name
2. Add an `info.json` file describing your collection
3. Add PGN files following the naming pattern `{number}_{motive}.pgn`
4. Run `bun run build` to generate JSON files

### Collection Structure

```
puzzles/
└── my-collection/
    ├── info.json           # Required: collection metadata
    ├── 01_pin.pgn
    ├── 02_fork.pgn
    └── 03_mate_in_2.pgn
```

### info.json Format

```json
{
  "id": "my-collection",
  "name": "My Collection",
  "source": "Original puzzles",
  "puzzleIdPrefix": "MC",
  "defaultType": "static",
  "puzzlesPerFile": 250
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Folder name, used in URLs |
| `name` | Yes | Display name in the UI |
| `source` | Yes | Attribution shown with each puzzle |
| `puzzleIdPrefix` | Yes | Prefix for puzzle IDs (e.g., "MC" → "MC-01-145") |
| `defaultType` | Yes | `"static"` or `"dynamic"` (see below) |
| `puzzlesPerFile` | No | Max puzzles per JSON file; large PGNs get split |

### Puzzle Types

- **Static**: Like puzzles from a chess book. You see the position, you find the best move. Board is shown from the side to move.
- **Dynamic**: Like Lichess training. Opponent plays first (often a blunder), then you punish it. Board is shown from your perspective.

Most book collections use `"static"`. Use `"dynamic"` if your PGN includes the opponent's blunder as the first move.

### PGN File Requirements

**Filename pattern**: `{number}_{motive}.pgn`

Examples:
- `01_pin.pgn` → Motive: "Pin"
- `02_back_rank_mate.pgn` → Motive: "Back Rank Mate"

Files not matching this pattern are skipped with a warning.

**Required PGN header** — the starting position:
```pgn
[FEN "6k1/5pp1/7p/3p4/b7/6P1/5PKP/3R4 w - - 0 1"]

1. Rd1-d5 Ba4-c6 *
```

**Optional** — preserve original puzzle numbering with `[OriginalID]`:
```pgn
[OriginalID "145"]
[FEN "6k1/5pp1/7p/3p4/b7/6P1/5PKP/3R4 w - - 0 1"]

1. Rd1-d5 Ba4-c6 *
```

If `OriginalID` is missing, puzzles are numbered 1, 2, 3... based on their order in the file.

### Building

```bash
bun install        # First time only
bun run build      # Generates data/ folder with JSON files
```

The `data/` folder is gitignored — it's generated fresh during CI deployment.

---

## Thanks to

This project stands on the shoulders of two great libraries:

- **[Chessground](https://github.com/lichess-org/chessground)** — the beautiful, responsive chessboard (from Lichess)
- **[chess.js](https://github.com/jhlywa/chess.js)** — the brains behind move validation

Huge thanks to their authors for making chess development so accessible.

---

## Dev Notes

### Version timestamp

A pre-commit hook auto-updates the version indicator in `index.html`. To restore it on a fresh clone:

```bash
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/sh
DATE=$(date +%Y.%m.%d)
sed -i '' "s/<div class=\"version-indicator\">.*<\/div>/<div class=\"version-indicator\">$DATE<\/div>/" index.html
git add index.html
EOF
chmod +x .git/hooks/pre-commit
```
