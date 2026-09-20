const LEAGUE_SHEETS = {
  A: "Aリーグ",
  B: "Bリーグ",
  C: "Cリーグ"
};
const MAX_PARTICIPANTS = 32;
const BRACKET_SIZE = 32;
const REPRESENTATIVE_RESULT_COLUMN = 5;
const REPRESENTATIVE_NAME_COLUMN = 6;
const SCORE_SHEET_NAME = "FinalTournament";
const ADMIN_TOKEN = "RRST";

// スコア保存シートの列。league 列を追加して、A/B/C を別々に管理する。
const SCORE_HEADERS = [
  "league", "round", "match",
  "redNumber", "redName", "redScore",
  "blueNumber", "blueName", "blueScore",
  "winner"
];

function doGet(event) {
  const mode = event && event.parameter && event.parameter.mode;

  if (mode === "tournament") {
    return getTournamentData(event);
  }

  return getCurrentMatchData();
}

function normalizeLeague(value) {
  return String(value || "A").trim().toUpperCase();
}

function getTournamentData(event) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const league = normalizeLeague(event && event.parameter && event.parameter.league);
  const sheetName = LEAGUE_SHEETS[league];
  const sheet = sheetName ? spreadsheet.getSheetByName(sheetName) : null;

  if (!sheet) {
    return jsonOutput({
      error: `Sheet not found for league: ${league}`
    });
  }

  // 1. リーグシートから組み合わせ(1回戦)を作る
  const result = parseLeagueSheet(sheet);

  // 2. FinalTournament シートから「このリーグの」スコアだけ読む
  const scoreSheet = spreadsheet.getSheetByName(SCORE_SHEET_NAME);
  const scoreRows = scoreSheet
    ? readScoreRows(scoreSheet).filter(row => row.league === league)
    : [];

  // 3. スコアを反映して、勝者を次の試合へ自動で進める
  const matches = applyScores(result.matches, scoreRows, result.bracketSize);

  result.matches = matches;
  result[league] = { matches };
  result.qualifier = findQualifier(matches, result.bracketSize);
  return jsonOutput(result);
}

// ---------------------------------------------------------------
// スコア反映 + 勝ち上がり
// ---------------------------------------------------------------

function cloneTeam(team) {
  return team ? { ...team } : null;
}

// 次の試合に進めるときは、スコアと勝敗フラグを引き継がない
function advanceTeam(team) {
  const copy = { ...team };
  delete copy.score;
  delete copy.winner;
  return copy;
}

function applyScores(baseMatches, scoreRows, bracketSize) {
  const totalRounds = Math.log2(bracketSize);
  const matches = baseMatches.map(match => ({
    ...match,
    red: cloneTeam(match.red),
    blue: cloneTeam(match.blue),
    winner: false,
    bye: false
  }));

  function findMatch(round, number) {
    return matches.find(match => match.round === round && match.match === number);
  }

  for (let round = 0; round < totalRounds; round += 1) {
    matches
      .filter(match => match.round === round)
      .forEach(match => {
        const hasBoth = Boolean(match.red && match.blue);
        let advancing = "";

        if (hasBoth) {
          const row = scoreRows.find(item =>
            item.round === match.round && item.match === match.match
          );

          // 保存時と対戦カードが変わっていたら、古いスコアは無視する
          const sameCard = row &&
            row.redName === match.red.name &&
            row.blueName === match.blue.name;

          if (sameCard) {
            match.red.score = row.redScore;
            match.blue.score = row.blueScore;
            const winnerColor = winnerFromScores(row.redScore, row.blueScore);
            if (winnerColor) {
              match.winner = true;
              match[winnerColor].winner = true;
              advancing = winnerColor;
            }
          }
        } else if (round === 0 && (match.red || match.blue)) {
          // 1回戦で相手がいない = 不戦勝。自動で次へ進める
          match.bye = true;
          advancing = match.red ? "red" : "blue";
        }

        if (advancing && round < totalRounds - 1) {
          const next = findMatch(round + 1, Math.ceil(match.match / 2));
          const slot = match.match % 2 === 1 ? "red" : "blue";
          if (next) next[slot] = advanceTeam(match[advancing]);
        }
      });
  }

  return matches;
}

// 決勝の勝者 = このリーグの代表
function findQualifier(matches, bracketSize) {
  const finalRound = Math.log2(bracketSize) - 1;
  const finalMatch = matches.find(match =>
    match.round === finalRound && match.match === 1
  );

  if (!finalMatch || !finalMatch.winner) return null;
  const team = finalMatch.red && finalMatch.red.winner ? finalMatch.red : finalMatch.blue;
  return advanceTeam(team);
}

// ---------------------------------------------------------------
// 現在の試合(既存のまま)
// ---------------------------------------------------------------

function getCurrentMatchData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dataSheet = ss.getSheetByName("機体一覧");
  const statusSheet = ss.getSheetByName("現在の試合番号");

  if (!dataSheet || !statusSheet) {
    return jsonOutput({
      error: "Missing sheet: 機体一覧 or 現在の試合番号"
    });
  }

  const currentA = statusSheet.getRange("B2").getValue();
  const currentB = statusSheet.getRange("B3").getValue();
  const currentC = statusSheet.getRange("B4").getValue();
  const values = dataSheet.getDataRange().getValues();
  const rows = values.slice(1);

  function teamInfo(row) {
    return row
      ? { num: String(row[0]), name: String(row[1]) }
      : { num: "", name: "未設定" };
  }

  function findMatch(ring, matchNumber) {
    const found = rows.filter(row => {
      const rowRing = String(row[3]).trim();
      const m1 = row[4];
      const m2 = row[5];
      return rowRing === ring && (m1 === matchNumber || m2 === matchNumber);
    });

    found.sort((left, right) => left[0] - right[0]);
    return { red: teamInfo(found[0]), blue: teamInfo(found[1]) };
  }

  function trioMatchNumbers(trioIndex) {
    const base = (trioIndex - 1) * 3;
    return [base + 1, base + 2, base + 3];
  }

  function buildCourt(ring, current) {
    if (current === "" || current === null || current === undefined) {
      return {
        currentNum: "",
        matches: [],
        trioRoster: [],
        waitingRoster: [],
        waitingMatches: []
      };
    }

    const cur = Number(current);
    const trioIndex = Math.ceil(cur / 3);
    const currentNumbers = trioMatchNumbers(trioIndex);
    const nextNumbers = trioMatchNumbers(trioIndex + 1);
    const matches = currentNumbers.map(number => {
      const match = findMatch(ring, number);
      return {
        num: String(number),
        red: match.red,
        blue: match.blue,
        current: number === cur
      };
    });

    const currentMatch = matches.find(match => match.current);
    const activeNumbers = currentMatch
      ? [currentMatch.red.num, currentMatch.blue.num]
      : [];
    const trioRosterSeen = {};
    const trioRoster = [];

    matches.forEach(match => {
      [match.red, match.blue].forEach(team => {
        if (team.name && team.name !== "未設定" && !trioRosterSeen[team.num]) {
          trioRosterSeen[team.num] = true;
          trioRoster.push({
            num: team.num,
            name: team.name,
            active: activeNumbers.indexOf(team.num) !== -1
          });
        }
      });
    });

    const waitingMatches = nextNumbers.map(number => {
      const match = findMatch(ring, number);
      return { num: String(number), red: match.red, blue: match.blue };
    });
    const rosterSeen = {};
    const waitingRoster = [];

    waitingMatches.forEach(match => {
      [match.red, match.blue].forEach(team => {
        if (team.name && team.name !== "未設定" && !rosterSeen[team.num]) {
          rosterSeen[team.num] = true;
          waitingRoster.push(`${team.num}番 ${team.name}`);
        }
      });
    });

    return {
      currentNum: String(cur),
      matches,
      trioRoster,
      waitingRoster,
      waitingMatches
    };
  }

  return jsonOutput({
    courts: {
      A: buildCourt("A", currentA),
      B: buildCourt("B", currentB),
      C: buildCourt("C", currentC)
    }
  });
}

// ---------------------------------------------------------------
// スコア保存
// ---------------------------------------------------------------

function doPost(event) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);

    const body = JSON.parse(event.postData.contents);
    if (body.token !== ADMIN_TOKEN) {
      return jsonOutput({ error: "Unauthorized" });
    }

    const league = normalizeLeague(body.league);
    if (!LEAGUE_SHEETS[league]) {
      return jsonOutput({ error: `Unknown league: ${league}` });
    }

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName(SCORE_SHEET_NAME) ||
      spreadsheet.insertSheet(SCORE_SHEET_NAME);
    const matches = Array.isArray(body.matches) ? body.matches : [];

    writeScoreSheet(sheet, league, matches);
    return jsonOutput({ ok: true, league, saved: matches.length });
  } catch (error) {
    return jsonOutput({ error: error.message });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function blankIfEmpty(value) {
  return value === undefined || value === null ? "" : String(value);
}

function scoreRowValues(league, match) {
  const redScore = blankIfEmpty(match.redScore);
  const blueScore = blankIfEmpty(match.blueScore);
  return [
    league,
    match.round,
    match.match,
    blankIfEmpty(match.redNumber),
    blankIfEmpty(match.redName),
    redScore,
    blankIfEmpty(match.blueNumber),
    blankIfEmpty(match.blueName),
    blueScore,
    winnerFromScores(redScore, blueScore)
  ];
}

// 指定リーグの行だけを置き換える(他リーグのスコアは消さない)
function writeScoreSheet(sheet, league, matches) {
  const keptRows = readScoreRows(sheet)
    .filter(row => row.league !== league)
    .map(row => scoreRowValues(row.league, row));
  const newRows = matches.map(match => scoreRowValues(league, match));
  const rows = keptRows.concat(newRows);

  sheet.clearContents();
  sheet.getRange(1, 1, 1, SCORE_HEADERS.length).setValues([SCORE_HEADERS]);
  if (rows.length) {
    // 日付などに自動変換されないよう、文字列として書き込む
    sheet.getRange(2, 1, rows.length, SCORE_HEADERS.length)
      .setNumberFormat("@")
      .setValues(rows);
  }
}

function readScoreRows(sheet) {
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return [];

  const headers = values[0].map(header => String(header).trim());
  return values
    .slice(1)
    .filter(row => row.some(value => String(value).trim() !== ""))
    .map(row => {
      const record = rowToObject(headers, row);
      return {
        // league 列が無い古いデータは A リーグ扱い(以前は A しか保存できなかったため)
        league: normalizeLeague(record.league),
        round: Number(record.round),
        match: Number(record.match),
        redNumber: record.redNumber || "",
        redName: record.redName || "",
        redScore: record.redScore || "",
        blueNumber: record.blueNumber || "",
        blueName: record.blueName || "",
        blueScore: record.blueScore || ""
      };
    });
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
    record[header] = String(row[index] || "").trim();
    return record;
  }, {});
}

// ---------------------------------------------------------------
// リーグシートの解析
// ---------------------------------------------------------------

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

  const leagueWinners = blocks
    .map(block => block.winnerCandidate
      ? { ...block.winnerCandidate, seed: block.id }
      : null
    )
    .filter(winner => winner && winner.name)
    .slice(0, MAX_PARTICIPANTS);
  const bracketSize = nextBracketSize(leagueWinners.length);

  return {
    sourceSheet: sheet.getName(),
    blocks,
    blockCount: blocks.length,
    blockWinners: leagueWinners,
    qualifiers: leagueWinners,
    entryCount: leagueWinners.length,
    bracketSize,
    // 1回戦の組み合わせ。スコア反映・勝ち上がりは getTournamentData で行う
    matches: buildBracketMatches(seedEntrants(leagueWinners, bracketSize), bracketSize),
    qualifier: null
  };
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
