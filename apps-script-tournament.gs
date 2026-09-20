const SHEET_NAMES = ["Aリーグ"];
const MAX_PARTICIPANTS = 32;
const BRACKET_SIZE = 32;
const REPRESENTATIVE_RESULT_COLUMN = 5;
const REPRESENTATIVE_NAME_COLUMN = 6;
const SCORE_SHEET_NAME = "FinalTournament";
const API_BLOCK_KEY = "A";
const ADMIN_TOKEN = "CHANGE_THIS_TOKEN";

function doGet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = SHEET_NAMES
    .map(name => spreadsheet.getSheetByName(name))
    .find(Boolean);

  if (!sheet) {
    return jsonOutput({
      error: `Sheet not found. Expected one of: ${SHEET_NAMES.join(", ")}`
    });
  }

  const result = parseLeagueSheet(sheet);
  const scoreSheet = spreadsheet.getSheetByName(SCORE_SHEET_NAME);
  result.matches = scoreSheet ? parseScoreSheet(scoreSheet) : [];
  result[API_BLOCK_KEY].matches = mergeMatches(
    result[API_BLOCK_KEY].matches,
    result.matches
  );
  const semiFinal = result.matches.find(match => match.round === 3 && match.winner);
  result.qualifier = semiFinal
    ? (semiFinal.red.winner ? semiFinal.red : semiFinal.blue)
    : null;
  return jsonOutput(result);
}

function doPost(event) {
  try {
    const body = JSON.parse(event.postData.contents);
    if (body.token !== ADMIN_TOKEN) {
      return jsonOutput({ error: "Unauthorized" });
    }

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName(SCORE_SHEET_NAME) ||
      spreadsheet.insertSheet(SCORE_SHEET_NAME);
    const matches = Array.isArray(body.matches) ? body.matches : [];

    writeScoreSheet(sheet, matches);
    return jsonOutput({ ok: true, saved: matches.length });
  } catch (error) {
    return jsonOutput({ error: error.message });
  }
}

function writeScoreSheet(sheet, matches) {
  const headers = [
    "round", "match", "redNumber", "redName", "redScore",
    "blueNumber", "blueName", "blueScore", "winner"
  ];
  const rows = matches.map(match => [
    match.round,
    match.match,
    match.redNumber || "",
    match.redName || "",
    match.redScore || "",
    match.blueNumber || "",
    match.blueName || "",
    match.blueScore || "",
    winnerFromScores(String(match.redScore || ""), String(match.blueScore || ""))
  ]);

  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
}

function mergeMatches(baseMatches, scoredMatches) {
  return baseMatches.map(baseMatch => {
    const scoredMatch = scoredMatches.find(match =>
      match.round === baseMatch.round && match.match === baseMatch.match
    );

    if (!scoredMatch) return baseMatch;

    return {
      ...baseMatch,
      ...scoredMatch,
      red: mergeTeam(baseMatch.red, scoredMatch.red),
      blue: mergeTeam(baseMatch.blue, scoredMatch.blue)
    };
  });
}

function mergeTeam(baseTeam, scoredTeam) {
  if (!baseTeam && !scoredTeam) return null;
  return {
    ...(baseTeam || {}),
    ...(scoredTeam || {}),
    number: (scoredTeam && scoredTeam.number) || (baseTeam && baseTeam.number) || "",
    name: (scoredTeam && scoredTeam.name && scoredTeam.name !== "出場者未定")
      ? scoredTeam.name
      : (baseTeam && baseTeam.name) || "出場者未定"
  };
}

function parseScoreSheet(sheet) {
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return [];

  const headers = values.shift().map(header => header.trim());
  return values
    .filter(row => row.some(value => value.trim() !== ""))
    .map(row => rowToScoreMatch(headers, row));
}

function rowToScoreMatch(headers, row) {
  const record = headers.reduce((result, header, index) => {
    result[header] = (row[index] || "").trim();
    return result;
  }, {});
  const redScore = record.redScore;
  const blueScore = record.blueScore;
  const winner = record.winner || winnerFromScores(redScore, blueScore);

  return {
    round: Number(record.round),
    match: Number(record.match),
    winner: winner === "red" || winner === "blue",
    red: scoredTeam(record, "red", winner === "red"),
    blue: scoredTeam(record, "blue", winner === "blue")
  };
}

function scoredTeam(record, color, isWinner) {
  return {
    number: record[`${color}Number`] || "",
    name: record[`${color}Name`] || "出場者未定",
    score: record[`${color}Score`] || "",
    winner: isWinner
  };
}

function winnerFromScores(redScore, blueScore) {
  if (redScore === "" || blueScore === "") return "";
  const red = Number(redScore);
  const blue = Number(blueScore);
  if (Number.isNaN(red) || Number.isNaN(blue) || red === blue) return "";
  return red > blue ? "red" : "blue";
}

function rowToObject(headers, row) {
  return headers.reduce((record, header, index) => {
    record[header] = (row[index] || "").trim();
    return record;
  }, {});
}

function parseLeagueSheet(sheet) {
  const values = sheet.getDataRange().getDisplayValues();
  const blocks = [];

  values.forEach((row, rowIndex) => {
    const blockCell = row.find(value => isBlockHeader(value));
    if (!blockCell) return;

    const blockNumber = Number(blockCell.match(/\d+/)[0]);
    const representativeRowIndex = findRepresentativeRow(values, rowIndex, blockNumber);
    const participantEnd = representativeRowIndex >= 0
      ? representativeRowIndex
      : findNextBlockRow(values, rowIndex);
    const participants = values
      .slice(rowIndex + 2, participantEnd)
      .map((participantRow, index) => participantFromRow(participantRow, index))
      .filter(Boolean)
      .slice(0, MAX_PARTICIPANTS);
    const representative = representativeRowIndex >= 0
      ? representativeFromRow(values[representativeRowIndex], blockNumber)
      : { name: "", confirmed: false };
    const winnerName = representative.name;
    const winnerCandidate = participants.find(participant => participant.name === winnerName) ||
      participantFromName(winnerName, participants);
    const winnerConfirmed = representativeRowIndex >= 0 && representative.confirmed;

    blocks.push({
      id: blockNumber,
      name: `第${blockNumber}ブロック`,
      participants,
      winnerCandidate,
      winner: winnerConfirmed ? winnerCandidate : null,
      winnerConfirmed
    });
  });

  blocks.forEach(block => {
    const blockKey = String.fromCharCode(64 + block.id);
    const matches = [];

    for (let index = 0; index < MAX_PARTICIPANTS; index += 2) {
      matches.push({
        round: 0,
        match: index / 2 + 1,
        red: block.participants[index] || null,
        blue: block.participants[index + 1] || null,
        winner: false
      });
    }

    block.key = blockKey;
    block.matches = matches;
  });

  const result = {
    sourceSheet: sheet.getName(),
    blocks,
    qualifiers: [],
    qualifier: null
  };

  const leagueWinners = blocks
    .map(block => block.winnerCandidate
      ? { ...block.winnerCandidate, seed: block.id }
      : null
    )
    .filter(winner => winner && winner.name)
    .slice(0, MAX_PARTICIPANTS);
  const bracketSize = nextBracketSize(leagueWinners.length);
  const leagueMatches = buildBracketMatches(
    seedEntrants(leagueWinners, bracketSize),
    bracketSize
  );

  result.qualifiers = leagueWinners;
  result.blockCount = blocks.length;
  result.blockWinners = leagueWinners;
  result.entryCount = leagueWinners.length;
  result.bracketSize = bracketSize;
  result.A = { matches: leagueMatches };
  result.B = { matches: leagueMatches };
  result.C = { matches: leagueMatches };

  return result;
}

function representativeFromRow(row, blockNumber) {
  const labelExists = row.some(value => value.includes(`第${blockNumber}ブロック代表`));
  if (!labelExists) return { name: "", confirmed: false };

  const name = (row[REPRESENTATIVE_NAME_COLUMN] || "").trim();
  const result = (row[REPRESENTATIVE_RESULT_COLUMN] || "").trim();

  return {
    name,
    confirmed: Boolean(name) && isConfirmed(result)
  };
}

function buildBracketMatches(entrants, bracketSize) {
  const matches = [];
  for (let round = 0; round < Math.log2(bracketSize); round += 1) {
    const matchCount = bracketSize / (2 ** (round + 1));
    for (let index = 0; index < matchCount; index += 1) {
      matches.push({
        round,
        match: index + 1,
        red: round === 0 ? entrants[index * 2] || null : null,
        blue: round === 0 ? entrants[index * 2 + 1] || null : null,
        winner: false
      });
    }
  }
  return matches;
}

function nextBracketSize(entryCount) {
  if (entryCount <= 1) return 2;
  let bracketSize = 2;
  while (bracketSize < entryCount && bracketSize < BRACKET_SIZE) {
    bracketSize *= 2;
  }
  return bracketSize;
}

function seedEntrants(entrants, bracketSize) {
  const ordered = [...entrants].sort((left, right) => {
    return Number(left.seed || 999) - Number(right.seed || 999);
  });
  const matchCount = bracketSize / 2;
  const slots = Array(bracketSize).fill(null);

  ordered.forEach((entrant, index) => {
    const side = Math.floor(index / matchCount);
    const matchIndex = index % matchCount;
    slots[matchIndex * 2 + side] = entrant;
  });

  return slots;
}

function findRepresentativeRow(values, startIndex, blockNumber) {
  const label = `第${blockNumber}ブロック代表`;
  for (let rowIndex = startIndex + 1; rowIndex < values.length; rowIndex += 1) {
    if (values[rowIndex].some(value => value.includes(label))) return rowIndex;
    if (rowIndex > startIndex + 1 && values[rowIndex].some(value => isBlockHeader(value))) break;
  }
  return -1;
}

function findNextBlockRow(values, startIndex) {
  for (let rowIndex = startIndex + 1; rowIndex < values.length; rowIndex += 1) {
    if (values[rowIndex].some(value => isBlockHeader(value))) return rowIndex;
  }
  return values.length;
}

function isBlockHeader(value) {
  return /第\s*\d+\s*ブロック/.test(value) && !value.includes("代表");
}

function isConfirmed(value) {
  const normalized = String(value).trim();
  return ["確定", "確定済", "TRUE", "true", "○"].includes(normalized) ||
    normalized.includes("残り0試合");
}

function participantFromRow(row, index) {
  const number = row[0].trim();
  const name = row[1].trim();
  if (!name || (number && !/^\d+$/.test(number))) return null;
  return {
    number: number || String(index + 1),
    seed: number ? Number(number) : index + 1,
    name,
    wins: row[5].trim()
  };
}

function participantFromName(name, participants) {
  if (!name) return null;
  return participants.find(participant => participant.name === name) || {
    number: "",
    seed: null,
    name,
    wins: ""
  };
}

function jsonOutput(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
