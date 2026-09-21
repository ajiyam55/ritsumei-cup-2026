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
// 管理画面のパスワード。必ず推測されにくいものに変更してください。
const ADMIN_TOKEN = "RRST";
// 閲覧者が多いので、同じリーグの結果は少しの間キャッシュして返す(秒)
const CACHE_SECONDS = 20;

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

  if (mode === "final") {
    return getFinalData();
  }

  return getCurrentMatchData();
}

function normalizeLeague(value) {
  return String(value || "A").trim().toUpperCase();
}

function cacheKey(league) {
  return `tournament_${league}`;
}

function putCache(league, payload) {
  try {
    const text = JSON.stringify(payload);
    // CacheService は 1 キー 100KB まで
    if (text.length < 90000) {
      CacheService.getScriptCache().put(cacheKey(league), text, CACHE_SECONDS);
    }
  } catch (ignore) { /* キャッシュできなくても動く */ }
}

// ---------------------------------------------------------------
// 最終決戦(A・B・Cの代表3人の総当たり)のスコアと、三すくみのときの手動順位
//   FinalTournament シートに league = FINAL / PODIUM として保存する
//   FINAL : round=0, match=1..3 がスコア
//   PODIUM: round=順位(1〜3), redNumber/redName=その順位の選手
// ---------------------------------------------------------------

const FINAL_LEAGUES = ["FINAL", "PODIUM"];

function buildFinalPayload(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(SCORE_SHEET_NAME);
  const rows = sheet ? readScoreRows(sheet) : [];

  return {
    generatedAt: Date.now(),
    rows: rows
      .filter(row => row.league === "FINAL")
      .map(row => ({
        match: row.match,
        redNumber: row.redNumber,
        redName: row.redName,
        redScore: row.redScore,
        blueNumber: row.blueNumber,
        blueName: row.blueName,
        blueScore: row.blueScore
      })),
    podium: rows
      .filter(row => row.league === "PODIUM")
      .map(row => ({ rank: row.round, number: row.redNumber, name: row.redName }))
  };
}

function getFinalData() {
  const cached = CacheService.getScriptCache().get(cacheKey("FINAL"));
  if (cached) {
    return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
  }

  const payload = buildFinalPayload(SpreadsheetApp.getActiveSpreadsheet());
  putCache("FINAL", payload);
  return jsonOutput(payload);
}

function getTournamentData(event) {
  const league = normalizeLeague(event && event.parameter && event.parameter.league);
  if (!LEAGUE_SHEETS[league]) {
    return jsonOutput({ error: `Sheet not found for league: ${league}` });
  }

  const cached = CacheService.getScriptCache().get(cacheKey(league));
  if (cached) {
    return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
  }

  const payload = buildTournamentPayload(SpreadsheetApp.getActiveSpreadsheet(), league);
  if (!payload.error) putCache(league, payload);
  return jsonOutput(payload);
}

function buildTournamentPayload(spreadsheet, league) {
  const sheet = spreadsheet.getSheetByName(LEAGUE_SHEETS[league]);
  if (!sheet) {
    return { error: `Sheet not found for league: ${league}` };
  }

  // 1. リーグシートから組み合わせ(1回戦)を作る
  const result = parseLeagueSheet(sheet);

  // 2. FinalTournament シートから「このリーグの」スコアだけ読む
  const scoreSheet = spreadsheet.getSheetByName(SCORE_SHEET_NAME);
  const scoreRows = scoreSheet
    ? readScoreRows(scoreSheet).filter(row => row.league === league)
    : [];

  // 3. スコアを反映して、勝者を次の試合へ自動で進める
  result.league = league;
  result.matches = applyScores(result.matches, scoreRows, result.bracketSize);
  result.qualifier = findQualifier(result.matches, result.bracketSize);
  result.generatedAt = Date.now();
  return result;
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

        const hasPending = Boolean(
          (match.red && match.red.pending) || (match.blue && match.blue.pending)
        );

        if (hasBoth && hasPending) {
          // 代表がまだ決まっていないブロックがある試合は、勝敗を付けない
        } else if (hasBoth) {
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
          if (!match[advancing].pending) match[advancing].winner = true;
        }

        if (advancing && round < totalRounds - 1) {
          const next = findMatch(round + 1, Math.ceil(match.match / 2));
          const slot = match.match % 2 === 1 ? "red" : "blue";
          if (next) next[slot] = advanceTeam(match[advancing]);
        }
      });
  }

  // 試合番号: 不戦勝(1回戦で相手なし)は数えず、1回戦から順に連番にする
  let counter = 0;
  for (let round = 0; round < totalRounds; round += 1) {
    matches
      .filter(match => match.round === round)
      .sort((left, right) => left.match - right.match)
      .forEach(match => {
        const isBye = round === 0 && !(match.red && match.blue);
        match.number = isBye ? null : (counter += 1);
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
  let locked = false;

  try {
    const body = JSON.parse(event.postData.contents);
    if (body.token !== ADMIN_TOKEN) {
      return jsonOutput({ error: "Unauthorized" });
    }

    // ログイン時のパスワード確認だけ
    if (body.action === "verify") {
      return jsonOutput({ ok: true });
    }

    const league = normalizeLeague(body.league);
    const isFinalData = FINAL_LEAGUES.indexOf(league) !== -1;
    if (!isFinalData && !LEAGUE_SHEETS[league]) {
      return jsonOutput({ error: `Unknown league: ${league}` });
    }

    lock.waitLock(10000);
    locked = true;

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName(SCORE_SHEET_NAME) ||
      spreadsheet.insertSheet(SCORE_SHEET_NAME);
    const matches = Array.isArray(body.matches) ? body.matches : [];

    writeScoreSheet(sheet, league, matches);
    SpreadsheetApp.flush();

    if (isFinalData) {
      const finalPayload = buildFinalPayload(spreadsheet);
      CacheService.getScriptCache().remove(cacheKey("FINAL"));
      putCache("FINAL", finalPayload);
      return jsonOutput({ ok: true, league, saved: matches.length, data: finalPayload });
    }

    // 保存直後の最新データを返し、閲覧側のキャッシュも入れ替える
    const payload = buildTournamentPayload(spreadsheet, league);
    CacheService.getScriptCache().remove(cacheKey(league));
    if (!payload.error) putCache(league, payload);

    return jsonOutput({ ok: true, league, saved: matches.length, data: payload });
  } catch (error) {
    return jsonOutput({ error: error.message });
  } finally {
    if (locked) lock.releaseLock();
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

    const blockNumber = Number(normalizeText(blockCell).match(/第(\d+)ブロック/)[1]);
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
      winnerConfirmed
    });
  });

  // 枠数・シードは「代表が取れた人数」ではなく「ブロック数」で決める。
  // 代表が未定のブロックも枠は確保し(pending)、後から決まっても位置がずれない。
  const blockById = {};
  blocks.forEach(block => { blockById[block.id] = block; });
  const blockCount = blocks.reduce((max, block) => Math.max(max, block.id), 0);
  const entrants = [];
  const pendingBlocks = [];

  for (let id = 1; id <= blockCount; id += 1) {
    const block = blockById[id];
    if (block && block.winnerCandidate && block.winnerCandidate.name) {
      entrants.push({ ...block.winnerCandidate, seed: id });
    } else {
      pendingBlocks.push(id);
      entrants.push({
        number: "",
        seed: id,
        name: `第${id}ブロック代表(未定)`,
        wins: "",
        pending: true
      });
    }
  }

  const limited = entrants.slice(0, MAX_PARTICIPANTS);
  const bracketSize = nextBracketSize(limited.length);

  return {
    sourceSheet: sheet.getName(),
    // 確認用: どのブロックから代表が取れているか
    blocks: blocks.map(block => ({
      id: block.id,
      name: block.name,
      representative: block.winnerCandidate ? block.winnerCandidate.name : "",
      confirmed: block.winnerConfirmed
    })),
    blockCount,
    pendingBlocks,
    entryCount: limited.length - pendingBlocks.length,
    bracketSize,
    // 1回戦の組み合わせ。スコア反映・勝ち上がりは buildTournamentPayload で行う
    matches: buildBracketMatches(seedEntrants(limited, bracketSize), bracketSize),
    qualifier: null
  };
}

function representativeFromRow(row, blockNumber) {
  const label = `第${blockNumber}ブロック代表`;
  const labelExists = row.some(value => normalizeText(value).includes(label));
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

// 全角数字・全角スペースなどの揺れを吸収する(「第１３ ブロック」も認識できる)
function normalizeText(value) {
  return String(value === undefined || value === null ? "" : value)
    .normalize("NFKC")
    .replace(/\s+/g, "");
}

function findRepresentativeRow(values, startIndex, blockNumber) {
  const label = `第${blockNumber}ブロック代表`;
  for (let rowIndex = startIndex + 1; rowIndex < values.length; rowIndex += 1) {
    if (values[rowIndex].some(value => normalizeText(value).includes(label))) return rowIndex;
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
  const text = normalizeText(value);
  return /第\d+ブロック/.test(text) && !text.includes("代表");
}

function isConfirmed(value) {
  const normalized = normalizeText(value);
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
