const LEAGUE_SHEETS = {
  A: "Aリーグ",
  B: "Bリーグ",
  C: "Cリーグ"
};
const MAX_PARTICIPANTS = 32;
const BRACKET_SIZE = 32;
const REPRESENTATIVE_RESULT_COLUMN = 5; // F列(「残り0試合」など)
const REPRESENTATIVE_NAME_COLUMN = 6;   // G列(代表の名前)
const REPRESENTATIVE_LABEL_COLUMN = 4;  // E列(「第Nブロック代表」の表記)。この列だけを見て判定する

// 今回のトーナメントで使わないブロック番号(シートに残っている予備・テスト用の行など)。
// 通常は下のBLOCK_COUNT_SOURCEから自動で読み取るブロック数で足りているはずだが、
// それでも取得できなかったとき(セルが空など)の保険として残しておく。
const IGNORED_BLOCK_IDS = { 14: true };

// 「機体一覧」シートに用意されている、リーグごとの試合数の自動集計セル。
// 3人total当たり総当たり3試合になる形式なので、試合数÷3 = ブロック数として、
// リーグ表の上から「その数ぶんだけ」ブロックを読み取る(ブロック14のような余りの行は
// 自動的に無視される)。
const BLOCK_COUNT_SOURCE_SHEET = "機体一覧";
const BLOCK_COUNT_SOURCE_CELLS = { A: "G2", B: "H2", C: "I2" };
const SCORE_SHEET_NAME = "FinalTournament";
// 更新のたびに1行ずつ追記していく記録用シート(動画編集などの後作業で、
// 「何時何分にどのスコアが入ったか」を振り返れるようにするための履歴)。
// FinalTournament シートは保存のたびに書き換わるが、こちらは追記のみで消さない。
const HISTORY_SHEET_NAME = "更新履歴";
const HISTORY_HEADERS = [
  "保存日時", "league", "round", "match",
  "redNumber", "redName", "redScore",
  "blueNumber", "blueName", "blueScore", "winner"
];
// 管理画面のパスワード。必ず推測されにくいものに変更してください。
const ADMIN_TOKEN = "RRST";
// 閲覧者が多いので、同じリーグの結果は少しの間キャッシュして返す(秒)
const CACHE_SECONDS = 20;
// 「現在の試合」はcall.html/index.html/banner.htmlが頻繁にポーリングする一番アクセスが多いAPIなので、
// 短めにキャッシュしてスプレッドシートへの直接アクセス回数を減らす(秒)
const CURRENT_MATCH_CACHE_SECONDS = 5;
const CURRENT_MATCH_CACHE_KEY = "current_match";

// 「次の試合」欄の対戦カード(機体一覧シートから取ってきた名前・番号)を、
// 試合開始前・終了後は伏せられるようにするためのオン/オフ。管理者ページの
// 「呼び出し画面」タブにあるボタンで切り替える。PropertiesServiceに保存するので、
// スプレッドシート側には何も残らない。
const NEXT_MATCH_VISIBLE_PROPERTY = "nextMatchNamesVisible";
const REDACTED_TEAM = { num: "?", name: "ー" };

// ---------------------------------------------------------------
// バナー画面(banner.html)の「試合が切り替わったタイミング」の記録
//   banner.html にはログイン画面が無く、ページのソース(token含む)が
//   誰でも見える状態なので、スコアを書き換えられる ADMIN_TOKEN とは
//   別の、ログを1行追記することしかできない控えめな合言葉を使う。
// ---------------------------------------------------------------
const MATCHLOG_SHEET_NAME = "試合記録";
const MATCHLOG_HEADERS = [
  "記録日時", "コート", "ブロック", "試合番号",
  "赤番号", "赤名前", "青番号", "青名前", "経過(分)"
];
// この大会の開始時刻(経過時間の計算用)。実際の開始時刻が変わったらここを直してください。
const LEAGUE_START_TIME = "10:00";
// banner.html専用の、ログ追記だけができる合言葉。ADMIN_TOKENとは必ず別の値にする。
const BANNER_TOKEN = "banner-log-2026";

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

  if (mode === "matchlog") {
    return getMatchLog(event);
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

// ---------------------------------------------------------------
// バナー画面用:試合切り替えのタイミング記録(読み出し)
// ---------------------------------------------------------------

function getMatchLog(event) {
  const court = event && event.parameter && event.parameter.court
    ? String(event.parameter.court).trim().toUpperCase()
    : "";

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(MATCHLOG_SHEET_NAME);
  const rows = sheet ? readMatchLogRows(sheet) : [];
  const filtered = court ? rows.filter(row => row.court === court) : rows;

  return jsonOutput({ rows: filtered });
}

function readMatchLogRows(sheet) {
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return [];

  const headers = values[0].map(header => String(header).trim());
  return values
    .slice(1)
    .filter(row => row.some(value => String(value).trim() !== ""))
    .map(row => {
      const record = rowToObject(headers, row);
      return {
        time: record["記録日時"] || "",
        court: String(record["コート"] || "").trim().toUpperCase(),
        block: record["ブロック"] || "",
        matchNum: record["試合番号"] || "",
        redNumber: record["赤番号"] || "",
        redName: record["赤名前"] || "",
        blueNumber: record["青番号"] || "",
        blueName: record["青名前"] || "",
        elapsedMinutes: record["経過(分)"] || ""
      };
    });
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

// 「機体一覧」シートの自動集計セル(試合数)から、このリーグのブロック数を読み取る。
// 取得できない(シートが無い/セルが空・数値でない)場合はnullを返し、呼び出し側で
// 従来通りシートを上から全部スキャンする方式にフォールバックする。
function getBlockCountFromSource(spreadsheet, league) {
  const cellRef = BLOCK_COUNT_SOURCE_CELLS[league];
  if (!cellRef) return null;

  const sourceSheet = spreadsheet.getSheetByName(BLOCK_COUNT_SOURCE_SHEET);
  if (!sourceSheet) return null;

  const matchCount = Number(sourceSheet.getRange(cellRef).getValue());
  if (!Number.isFinite(matchCount) || matchCount <= 0) return null;

  return Math.floor(matchCount / 3);
}

function buildTournamentPayload(spreadsheet, league) {
  const sheet = spreadsheet.getSheetByName(LEAGUE_SHEETS[league]);
  if (!sheet) {
    return { error: `Sheet not found for league: ${league}` };
  }

  // 1. リーグシートから組み合わせ(1回戦)を作る
  // ブロック数は「機体一覧」の自動集計セルを優先。取れなければ従来通りシートから判定する。
  const blockCountOverride = getBlockCountFromSource(spreadsheet, league);
  const result = parseLeagueSheet(sheet, blockCountOverride);

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
  // 100人規模が同時にポーリングしても毎回シートを読みに行かないよう、短時間キャッシュする
  const cached = CacheService.getScriptCache().get(CURRENT_MATCH_CACHE_KEY);
  if (cached) {
    return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
  }

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

  const namesVisible = isNextMatchVisible();
  const payload = {
    namesVisible,
    courts: {
      A: redactCourtIfNeeded(buildCourt("A", currentA), namesVisible),
      B: redactCourtIfNeeded(buildCourt("B", currentB), namesVisible),
      C: redactCourtIfNeeded(buildCourt("C", currentC), namesVisible)
    }
  };

  try {
    const text = JSON.stringify(payload);
    if (text.length < 90000) {
      CacheService.getScriptCache().put(CURRENT_MATCH_CACHE_KEY, text, CURRENT_MATCH_CACHE_SECONDS);
    }
  } catch (ignore) { /* キャッシュできなくても動く */ }

  return jsonOutput(payload);
}

// 機体一覧シートの値(名前・番号)だけを伏せ字にする。第Nブロック・試合番号などの
// 構造自体は変えない(「試合が始まる前と終わった後だけ名前を隠したい」という用途のため)。
function redactCourtIfNeeded(court, namesVisible) {
  if (namesVisible) return court;
  if (!court || !court.currentNum) return court;

  return {
    currentNum: court.currentNum,
    matches: court.matches.map(match => ({
      num: match.num,
      red: { ...REDACTED_TEAM },
      blue: { ...REDACTED_TEAM },
      current: match.current
    })),
    trioRoster: court.trioRoster.map(() => ({ num: "?", name: "ー", active: false })),
    waitingRoster: court.waitingRoster.map(() => "?番 ー"),
    waitingMatches: court.waitingMatches.map(match => ({
      num: match.num,
      red: { ...REDACTED_TEAM },
      blue: { ...REDACTED_TEAM }
    }))
  };
}

function isNextMatchVisible() {
  const stored = PropertiesService.getScriptProperties().getProperty(NEXT_MATCH_VISIBLE_PROPERTY);
  // 未設定のとき(まだ一度も切り替えていないとき)は、今まで通り表示する
  return stored === null ? true : stored === "true";
}

function setNextMatchVisible(visible) {
  PropertiesService.getScriptProperties().setProperty(NEXT_MATCH_VISIBLE_PROPERTY, visible ? "true" : "false");
  // 次のポーリングですぐ反映されるよう、短時間キャッシュを消しておく
  CacheService.getScriptCache().remove(CURRENT_MATCH_CACHE_KEY);
}

// ---------------------------------------------------------------
// スコア保存
// ---------------------------------------------------------------

function doPost(event) {
  const lock = LockService.getScriptLock();
  let locked = false;

  try {
    const body = JSON.parse(event.postData.contents);

    // バナー画面からの「試合が切り替わった」ログは、ADMIN_TOKENとは別の
    // 控えめな合言葉で認証する(banner.htmlにはログイン画面が無いため)。
    if (body.action === "logMatch") {
      return appendMatchLog(body);
    }

    if (body.token !== ADMIN_TOKEN) {
      return jsonOutput({ error: "Unauthorized" });
    }

    // ログイン時のパスワード確認だけ
    if (body.action === "verify") {
      return jsonOutput({ ok: true });
    }

    // 「次の試合」欄の対戦カード(名前・番号)の表示/非表示切り替え
    if (body.action === "setNextMatchVisible") {
      setNextMatchVisible(Boolean(body.visible));
      return jsonOutput({ ok: true, visible: Boolean(body.visible) });
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
    appendHistory(spreadsheet, league, matches);
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

// バナー画面から送られてくる「試合が切り替わった」ログを1行追記する。
// ADMIN_TOKENとは別のBANNER_TOKENで認証し、スコアには一切触れない。
function appendMatchLog(body) {
  if (body.token !== BANNER_TOKEN) {
    return jsonOutput({ error: "Unauthorized" });
  }

  const lock = LockService.getScriptLock();
  let locked = false;

  try {
    lock.waitLock(10000);
    locked = true;

    const court = String(body.court || "").trim().toUpperCase();
    if (!court) return jsonOutput({ error: "court is required" });

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName(MATCHLOG_SHEET_NAME) ||
      spreadsheet.insertSheet(MATCHLOG_SHEET_NAME);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, MATCHLOG_HEADERS.length).setValues([MATCHLOG_HEADERS]);
    }

    // 直前の記録と同じコート・同じ試合番号なら、二重に追記しない
    // (複数タブを開いていたり、ポーリングのタイミングが重なった場合の対策)
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const last = sheet.getRange(lastRow, 1, 1, MATCHLOG_HEADERS.length).getDisplayValues()[0];
      if (String(last[1]).trim().toUpperCase() === court &&
          String(last[3]).trim() === String(body.matchNum || "").trim()) {
        return jsonOutput({ ok: true, skipped: true });
      }
    }

    const now = new Date();
    const timestamp = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    const elapsedMinutes = elapsedMinutesSinceStart(now);

    const row = [
      timestamp,
      court,
      blankIfEmpty(body.block),
      blankIfEmpty(body.matchNum),
      blankIfEmpty(body.redNumber),
      blankIfEmpty(body.redName),
      blankIfEmpty(body.blueNumber),
      blankIfEmpty(body.blueName),
      elapsedMinutes
    ];

    sheet.getRange(sheet.getLastRow() + 1, 1, 1, MATCHLOG_HEADERS.length)
      .setNumberFormat("@")
      .setValues([row]);
    SpreadsheetApp.flush();

    return jsonOutput({ ok: true, elapsedMinutes });
  } catch (error) {
    return jsonOutput({ error: error.message });
  } finally {
    if (locked) lock.releaseLock();
  }
}

// LEAGUE_START_TIME(例: "10:00")を基準にした経過分数。日付はスクリプト実行時の「今日」を使う。
function elapsedMinutesSinceStart(now) {
  const parts = String(LEAGUE_START_TIME).split(":");
  const hours = Number(parts[0]) || 0;
  const minutes = Number(parts[1]) || 0;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0);
  return Math.round((now.getTime() - start.getTime()) / 60000);
}

// 保存のたびに、その時刻とスコアを履歴シートへ1行ずつ追記する(消さずに積み上げる)
function appendHistory(spreadsheet, league, matches) {
  const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  const rows = matches
    // 赤・青どちらのスコアも空の行(まだ何も入れていない枠)は記録しない
    .filter(match => blankIfEmpty(match.redScore) !== "" || blankIfEmpty(match.blueScore) !== "")
    .map(match => [timestamp, ...scoreRowValues(league, match)]);
  if (!rows.length) return;

  const sheet = spreadsheet.getSheetByName(HISTORY_SHEET_NAME) || spreadsheet.insertSheet(HISTORY_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HISTORY_HEADERS.length).setValues([HISTORY_HEADERS]);
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HISTORY_HEADERS.length)
    .setNumberFormat("@")
    .setValues(rows);
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

function parseLeagueSheet(sheet, blockCountOverride) {
  const values = sheet.getDataRange().getDisplayValues();
  const blocks = [];

  values.forEach((row, rowIndex) => {
    const blockCell = row.find(value => isBlockHeader(value));
    if (!blockCell) return;

    const blockNumber = Number(normalizeText(blockCell).match(/第(\d+)ブロック/)[1]);

    // ブロック数が「機体一覧」から分かっているときは、その数より後ろのブロックは
    // (余り・テスト用の行があっても)読み取らない。分からないときだけ従来通り
    // IGNORED_BLOCK_IDSで個別に除外する。
    if (blockCountOverride) {
      if (blockNumber > blockCountOverride) return;
    } else if (IGNORED_BLOCK_IDS[blockNumber]) {
      return; // 使わないブロックは読み取らない
    }

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
  // 機体一覧から取れていればそれを正とする(シートにまだ代表行すら無いブロックも
  // 枠としては確保できる)。取れていなければ、見つかった中で一番大きいブロック番号を使う。
  const blockCount = blockCountOverride || blocks.reduce((max, block) => Math.max(max, block.id), 0);
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
  // E列の表記だけを基準にする(ほかの列にたまたま同じ文字が入っていても代表とは判定しない)
  const label = `第${blockNumber}ブロック代表`;
  const labelExists = normalizeText(row[REPRESENTATIVE_LABEL_COLUMN]).includes(label);
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

// 大会でよく使われる「1位vs最下位、2位vs下から2番目…」という標準的な配置。
// 不戦勝(シード)になる枠が、できるだけ分かれて配置されるので、
// シード(不戦勝)どうしが2回戦でいきなり当たることを避けられる。
function seedPositions(bracketSize) {
  if (bracketSize === 1) return [1];
  const prev = seedPositions(bracketSize / 2);
  const positions = [];
  prev.forEach(seed => {
    positions.push(seed);
    positions.push(bracketSize + 1 - seed);
  });
  return positions; // 添字(0始まり)がトーナメント表の枠番号、値が何番目の代表(1始まり)か
}

function seedEntrants(entrants, bracketSize) {
  // 代表(ブロック代表)を上から順番(ブロック番号の若い順)に並べる
  const ordered = [...entrants].sort((left, right) => {
    return Number(left.seed || 999) - Number(right.seed || 999);
  });
  const order = seedPositions(bracketSize);
  const slots = Array(bracketSize).fill(null);

  order.forEach((rank, slotIndex) => {
    slots[slotIndex] = ordered[rank - 1] || null;
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
  // E列の表記だけを基準にする(他の列の文字列とは照合しない)
  const label = `第${blockNumber}ブロック代表`;
  for (let rowIndex = startIndex + 1; rowIndex < values.length; rowIndex += 1) {
    if (normalizeText(values[rowIndex][REPRESENTATIVE_LABEL_COLUMN]).includes(label)) return rowIndex;
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
