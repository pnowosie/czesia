#!/usr/bin/env bun

import { Chess } from "chess.js";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { join, basename } from "path";

// ============================================================================
// Types
// ============================================================================

interface CollectionInfo {
  id: string;
  name: string;
  source: string;
  puzzleIdPrefix: string;
  defaultType: "static" | "dynamic";
  puzzlesPerFile?: number;
}

interface Puzzle {
  puzzleId: string;
  fen: string;
  type: "static" | "dynamic";
  orientation: "white" | "black";
  solution: Array<{ from: string; to: string }>;
  source: string;
  motive: string;
}

interface RawPuzzle {
  fen: string;
  moves: string;
  originalId: string;
}

interface Problem {
  id: string;
  name: string;
  file: string;
}

interface Collection {
  id: string;
  name: string;
  problems: Problem[];
}

interface IndexJson {
  collections: Collection[];
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Fix invalid FEN strings (e.g., move number 0 should be at least 1)
 */
function fixFEN(fen: string): string {
  const fenParts = fen.split(" ");
  if (fenParts.length >= 6) {
    const fullmoveNumber = parseInt(fenParts[5]);
    if (fullmoveNumber === 0) {
      fenParts[5] = "1";
      return fenParts.join(" ");
    }
  }
  return fen;
}

/**
 * Calculate orientation for a puzzle based on FEN and type
 */
function calculateOrientation(fen: string, type: "static" | "dynamic"): "white" | "black" {
  const fenParts = fen.split(" ");
  if (fenParts.length < 2) {
    throw new Error(`Invalid FEN format: ${fen}`);
  }

  const sideToMove = fenParts[1];

  if (type === "dynamic") {
    return sideToMove === "w" ? "black" : "white";
  } else {
    return sideToMove === "w" ? "white" : "black";
  }
}

/**
 * Extract motive from filename
 * e.g., "02_Mate_in_two.pgn" -> "Mate In Two"
 */
function extractMotive(filename: string): string {
  const nameWithoutExt = basename(filename, ".pgn");
  const motivePart = nameWithoutExt.replace(/^\d+_/, "");
  return motivePart
    .split("_")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Extract file number from filename
 * e.g., "02_Mate_in_two.pgn" -> "02"
 */
function extractFileNumber(filename: string): string | null {
  const match = basename(filename).match(/^(\d+)_/);
  return match ? match[1] : null;
}

/**
 * Extract motive slug from filename (for JSON filename)
 * e.g., "02_Mate_in_two.pgn" -> "mate_in_two"
 */
function extractMotiveSlug(filename: string): string {
  const nameWithoutExt = basename(filename, ".pgn");
  const motivePart = nameWithoutExt.replace(/^\d+_/, "");
  return motivePart.toLowerCase();
}

/**
 * Split array into chunks
 */
function splitIntoChunks<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ============================================================================
// PGN Parsing
// ============================================================================

/**
 * Parse PGN content and extract puzzles with OriginalID
 */
function parsePGN(pgnContent: string): RawPuzzle[] {
  const puzzles: RawPuzzle[] = [];

  const normalized = pgnContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");

  let currentFen: string | null = null;
  let currentOriginalId: string | null = null;
  const currentMoves: string[] = [];
  let puzzleIndex = 0;

  function savePuzzle() {
    if (currentFen && currentMoves.length > 0) {
      puzzleIndex++;
      puzzles.push({
        fen: currentFen,
        moves: currentMoves.join(" ").trim(),
        originalId: currentOriginalId || String(puzzleIndex)
      });
    }
    currentFen = null;
    currentOriginalId = null;
    currentMoves.length = 0;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check for OriginalID tag - this starts a new puzzle
    if (line.startsWith("[OriginalID")) {
      // Save previous puzzle first
      savePuzzle();

      const match = line.match(/\[OriginalID\s+"([^"]+)"\]/);
      if (match) {
        currentOriginalId = match[1];
      }
      continue;
    }

    // Check for Event tag - also starts a new puzzle
    if (line.startsWith("[Event")) {
      savePuzzle();
      continue;
    }

    // Check for FEN tag
    if (line.startsWith("[FEN")) {
      const fenMatch = line.match(/\[FEN\s+"([^"]+)"\]/);
      if (fenMatch && fenMatch[1]) {
        currentFen = fixFEN(fenMatch[1]);
      }
      continue;
    }

    // Skip other tag lines
    if (line.startsWith("[")) {
      continue;
    }

    // Skip empty lines
    if (line.length === 0) {
      continue;
    }

    // This is a moves line
    if (line.length > 0) {
      currentMoves.push(line);
    }
  }

  // Don't forget the last puzzle
  savePuzzle();

  return puzzles;
}

/**
 * Convert SAN moves string to array of {from, to} moves
 */
function parseMoves(fen: string, movesString: string): Array<{ from: string; to: string }> {
  const chess = new Chess(fen);
  const solution: Array<{ from: string; to: string }> = [];

  // Remove result markers
  let cleanMoves = movesString.replace(/\s+\*|\s+1-0|\s+0-1|\s+1\/2-1\/2/g, "").trim();

  // Remove annotations in parentheses (variations, comments)
  cleanMoves = cleanMoves.replace(/\([^)]*\)/g, "");

  // Remove curly brace comments
  cleanMoves = cleanMoves.replace(/\{[^}]*\}/g, "");

  // Remove move numbers and dots
  cleanMoves = cleanMoves
    .replace(/\d+\.\s*\.\.\.\s*/g, "")
    .replace(/\d+\.\s*/g, "")
    .replace(/\.\.\./g, "")
    .trim();

  // Clean up any remaining parentheses or brackets
  cleanMoves = cleanMoves.replace(/[()\[\]]/g, " ");

  // Split by whitespace to get individual moves
  const moveTokens = cleanMoves.split(/\s+/).filter(token => {
    const trimmed = token.trim();
    return trimmed.length > 0 &&
           trimmed !== "." &&
           trimmed !== ".." &&
           !trimmed.match(/^\.+$/) &&
           !trimmed.match(/^\d+$/);
  });

  for (const sanMove of moveTokens) {
    const trimmed = sanMove.trim();
    if (!trimmed || trimmed.length === 0) continue;

    try {
      const move = chess.move(trimmed, { strict: false });
      if (move) {
        solution.push({ from: move.from, to: move.to });
      }
    } catch (error) {
      // Skip invalid moves silently
    }
  }

  return solution;
}

// ============================================================================
// Build Process
// ============================================================================

/**
 * Process a single PGN file and return puzzles grouped by chunks
 */
function processPGNFile(
  pgnPath: string,
  info: CollectionInfo,
  fileNumber: string
): { puzzles: Puzzle[]; originalId: string }[][] {
  console.log(`  Processing ${basename(pgnPath)}...`);

  const pgnContent = readFileSync(pgnPath, "utf-8");
  const rawPuzzles = parsePGN(pgnContent);
  const motive = extractMotive(pgnPath);

  console.log(`    Found ${rawPuzzles.length} puzzles`);

  // Convert raw puzzles to Puzzle objects
  const puzzlesWithId: { puzzle: Puzzle; originalId: string }[] = [];

  for (const raw of rawPuzzles) {
    try {
      const solution = parseMoves(raw.fen, raw.moves);

      if (solution.length === 0) {
        console.warn(`    WARN: Puzzle #${raw.originalId} has no valid moves, skipping`);
        continue;
      }

      const puzzle: Puzzle = {
        puzzleId: "", // Will be set later with part number
        fen: raw.fen,
        type: info.defaultType,
        orientation: calculateOrientation(raw.fen, info.defaultType),
        solution,
        source: info.source,
        motive,
      };

      puzzlesWithId.push({ puzzle, originalId: raw.originalId });
    } catch (error) {
      console.error(`    ERROR: Failed to process puzzle #${raw.originalId}: ${error}`);
    }
  }

  // Split into chunks if puzzlesPerFile is set
  const chunkSize = info.puzzlesPerFile || puzzlesWithId.length;
  const chunks = splitIntoChunks(puzzlesWithId, chunkSize);

  // Assign puzzle IDs with part numbers
  return chunks.map((chunk, chunkIndex) => {
    const partNumber = chunkIndex + 1;
    return chunk.map(({ puzzle, originalId }) => {
      puzzle.puzzleId = `${info.puzzleIdPrefix}-${fileNumber}-${partNumber}-${originalId}`;
      return { puzzles: [puzzle], originalId };
    }).map(item => ({ puzzles: item.puzzles, originalId: item.originalId }));
  }).map(chunk => chunk.map(item => ({ puzzles: item.puzzles, originalId: item.originalId })));
}

/**
 * Process a collection folder
 */
function processCollection(collectionPath: string): { collection: Collection; puzzleFiles: { path: string; puzzles: Puzzle[] }[] } | null {
  const infoPath = join(collectionPath, "info.json");

  if (!existsSync(infoPath)) {
    console.warn(`WARN: No info.json in ${basename(collectionPath)}, skipping`);
    return null;
  }

  const info: CollectionInfo = JSON.parse(readFileSync(infoPath, "utf-8"));
  console.log(`\nProcessing collection: ${info.name}`);

  // Find all PGN files
  const files = readdirSync(collectionPath);
  const pgnFiles = files.filter(f => f.endsWith(".pgn"));

  if (pgnFiles.length === 0) {
    console.warn(`  WARN: No PGN files found in ${info.id}`);
    return null;
  }

  const collection: Collection = {
    id: info.id,
    name: info.name,
    problems: []
  };

  const puzzleFiles: { path: string; puzzles: Puzzle[] }[] = [];

  for (const pgnFile of pgnFiles.sort()) {
    const fileNumber = extractFileNumber(pgnFile);
    if (!fileNumber) {
      console.warn(`  WARN: ${pgnFile} doesn't match pattern {number}_{motive}.pgn, skipping`);
      continue;
    }

    const pgnPath = join(collectionPath, pgnFile);
    const motiveSlug = extractMotiveSlug(pgnFile);
    const motive = extractMotive(pgnFile);

    // Parse PGN and get raw puzzles
    const pgnContent = readFileSync(pgnPath, "utf-8");
    const rawPuzzles = parsePGN(pgnContent);

    console.log(`  Processing ${pgnFile}: ${rawPuzzles.length} puzzles`);

    // Convert to Puzzle objects
    const allPuzzles: { puzzle: Puzzle; originalId: string }[] = [];

    for (const raw of rawPuzzles) {
      try {
        const solution = parseMoves(raw.fen, raw.moves);

        if (solution.length === 0) {
          console.warn(`    WARN: Puzzle #${raw.originalId} has no valid moves, skipping`);
          continue;
        }

        const puzzle: Puzzle = {
          puzzleId: "", // Set later
          fen: raw.fen,
          type: info.defaultType,
          orientation: calculateOrientation(raw.fen, info.defaultType),
          solution,
          source: info.source,
          motive,
        };

        allPuzzles.push({ puzzle, originalId: raw.originalId });
      } catch (error) {
        console.error(`    ERROR: Puzzle #${raw.originalId}: ${error}`);
      }
    }

    // Split into chunks
    const chunkSize = info.puzzlesPerFile || allPuzzles.length;
    const chunks = splitIntoChunks(allPuzzles, chunkSize);
    const totalChunks = chunks.length;

    console.log(`    Splitting into ${totalChunks} file(s)`);

    // Process each chunk
    const needsSplit = totalChunks > 1;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const partNumber = i + 1;

      // Generate filename and IDs - only include part number if splitting
      const filePrefix = needsSplit ? `${fileNumber}-${partNumber}` : fileNumber;
      const jsonFilename = `${filePrefix}_${motiveSlug}.json`;

      // Assign puzzle IDs
      const puzzles = chunk.map(({ puzzle, originalId }) => {
        puzzle.puzzleId = needsSplit
          ? `${info.puzzleIdPrefix}-${fileNumber}-${partNumber}-${originalId}`
          : `${info.puzzleIdPrefix}-${fileNumber}-${originalId}`;
        return puzzle;
      });

      const firstId = chunk[0].originalId;
      const lastId = chunk[chunk.length - 1].originalId;

      // Problem name: include range if split, or just motive if single chunk
      const problemName = needsSplit
        ? `${motive} (${firstId}-${lastId})`
        : motive;

      collection.problems.push({
        id: `${filePrefix}_${motiveSlug}`,
        name: problemName,
        file: jsonFilename
      });

      puzzleFiles.push({
        path: join("data", info.id, jsonFilename),
        puzzles
      });
    }
  }

  return { collection, puzzleFiles };
}

/**
 * Main build function
 */
function main() {
  const baseDir = import.meta.dir;
  const puzzlesDir = join(baseDir, "puzzles");
  const dataDir = join(baseDir, "data");

  console.log("Chess Puzzles Builder");
  console.log("=====================\n");

  // Ensure data directory exists
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  // Find all collection folders
  const collections: Collection[] = [];
  const allPuzzleFiles: { path: string; puzzles: Puzzle[] }[] = [];

  const collectionFolders = readdirSync(puzzlesDir).filter(f => {
    const fullPath = join(puzzlesDir, f);
    return existsSync(join(fullPath, "info.json"));
  });

  if (collectionFolders.length === 0) {
    console.error("ERROR: No collections found in puzzles/ directory");
    process.exit(1);
  }

  // Process each collection
  for (const folder of collectionFolders) {
    const collectionPath = join(puzzlesDir, folder);
    const result = processCollection(collectionPath);

    if (result) {
      collections.push(result.collection);
      allPuzzleFiles.push(...result.puzzleFiles);
    }
  }

  // Write puzzle JSON files
  console.log("\nWriting puzzle files...");
  for (const { path, puzzles } of allPuzzleFiles) {
    const fullPath = join(baseDir, path);
    const dir = join(fullPath, "..");

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(fullPath, JSON.stringify(puzzles, null, 2), "utf-8");
    console.log(`  ${path} (${puzzles.length} puzzles)`);
  }

  // Write index.json
  const indexJson: IndexJson = { collections };
  const indexPath = join(dataDir, "index.json");
  writeFileSync(indexPath, JSON.stringify(indexJson, null, 2), "utf-8");
  console.log(`\nWritten data/index.json with ${collections.length} collection(s)`);

  // Summary
  const totalPuzzles = allPuzzleFiles.reduce((sum, f) => sum + f.puzzles.length, 0);
  console.log(`\nBuild complete!`);
  console.log(`  Collections: ${collections.length}`);
  console.log(`  Problem files: ${allPuzzleFiles.length}`);
  console.log(`  Total puzzles: ${totalPuzzles}`);
}

main();
