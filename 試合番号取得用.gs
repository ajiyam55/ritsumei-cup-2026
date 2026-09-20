const DATA_SHEET_NAME = "機体一覧";
const STATUS_SHEET_NAME = "現在の試合番号";

function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dataSheet = ss.getSheetByName(DATA_SHEET_NAME);
  const statusSheet = ss.getSheetByName(STATUS_SHEET_NAME);

  const currentA = statusSheet.getRange("B2").getValue();
  const currentB = statusSheet.getRange("B3").getValue();
  const currentC = statusSheet.getRange("B4").getValue();

  const values = dataSheet.getDataRange().getValues();
  const rows = values.slice(1);

  function teamInfo(row) {
    return row ? { num: String(row[0]), name: String(row[1]) } : { num: "", name: "未設定" };
  }

  function findMatch(ring, matchNumber) {
    const found = rows.filter((row) => {
      const rowRing = String(row[3]).trim();
      const m1 = row[4];
      const m2 = row[5];
      return rowRing === ring && (m1 === matchNumber || m2 === matchNumber);
    });
    found.sort((a, b) => a[0] - b[0]);
    return { red: teamInfo(found[0]), blue: teamInfo(found[1]) };
  }

  function trioMatchNumbers(trioIndex) {
    const base = (trioIndex - 1) * 3;
    return [base + 1, base + 2, base + 3];
  }

  function buildCourt(ring, current) {
    if (current === "" || current === null || current === undefined) {
      return { currentNum: "", matches: [], trioRoster: [], waitingRoster: [], waitingMatches: [] };
    }

    const cur = Number(current);
    const trioIndex = Math.ceil(cur / 3);
    const curTrioNums = trioMatchNumbers(trioIndex);
    const nextTrioNums = trioMatchNumbers(trioIndex + 1);

    const matches = curTrioNums.map((num) => {
      const m = findMatch(ring, num);
      return { num: String(num), red: m.red, blue: m.blue, current: num === cur };
    });

    const currentMatch = matches.find((m) => m.current);
    const activeNums = currentMatch ? [currentMatch.red.num, currentMatch.blue.num] : [];
    const trioRosterSeen = {};
    const trioRoster = [];
    matches.forEach((m) => {
      [m.red, m.blue].forEach((team) => {
        if (team.name && team.name !== "未設定" && !trioRosterSeen[team.num]) {
          trioRosterSeen[team.num] = true;
          trioRoster.push({ num: team.num, name: team.name, active: activeNums.indexOf(team.num) !== -1 });
        }
      });
    });

    const waitingMatches = nextTrioNums.map((num) => {
      const m = findMatch(ring, num);
      return { num: String(num), red: m.red, blue: m.blue };
    });

    const rosterSeen = {};
    const rosterList = [];
    waitingMatches.forEach((m) => {
      [m.red, m.blue].forEach((team) => {
        if (team.name && team.name !== "未設定" && !rosterSeen[team.num]) {
          rosterSeen[team.num] = true;
          rosterList.push(`${team.num}番 ${team.name}`);
        }
      });
    });

    return {
      currentNum: String(cur),
      matches: matches,
      trioRoster: trioRoster,
      waitingRoster: rosterList,
      waitingMatches: waitingMatches,
    };
  }

  const result = {
    courts: {
      A: buildCourt("A", currentA),
      B: buildCourt("B", currentB),
      C: buildCourt("C", currentC),
    },
  };

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}