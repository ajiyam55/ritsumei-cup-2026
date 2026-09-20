const SHEET_NAMES = ["Sheet1", "Aコート(当日使用)", "Tournament"];
const MAX_PARTICIPANTS = 16;
const REPRESENTATIVE_CONFIRMATION_COLUMN = 6;
const SCORE_SHEET_NAME = "FinalTournament";

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
  return jsonOutput(result);
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
    const winnerName = representativeRowIndex >= 0
      ? values[representativeRowIndex][5].trim()
      : "";
    const winnerCandidate = participants.find(participant => participant.name === winnerName) ||
      participantFromName(winnerName, participants);
    const winnerConfirmed = representativeRowIndex >= 0 &&
      isConfirmed(values[representativeRowIndex][REPRESENTATIVE_CONFIRMATION_COLUMN]);

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
    qualifiers: blocks.map(block => block.winner).filter(winner => winner && winner.name)
  };

  blocks.forEach(block => {
    result[block.key] = { matches: block.matches };
  });

  return result;
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
  return ["確定", "確定済", "TRUE", "true", "○"].includes(String(value).trim());
}

function participantFromRow(row, index) {
  const number = row[0].trim();
  const name = row[1].trim();
  if (!name || (number && !/^\d+$/.test(number))) return null;
  return { number: number || String(index + 1), name, wins: row[5].trim() };
}

function participantFromName(name, participants) {
  if (!name) return null;
  return participants.find(participant => participant.name === name) || {
    number: "",
    name,
    wins: ""
  };
}

function jsonOutput(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
