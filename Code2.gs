/**
 * 大会番号ランダム抽選システム
 *
 * 【シート構成】
 * A列：元番号（1機体目＋2機体目）
 * B・C列：1機体目の情報（抽選では使用しない）
 * D列：1機体目に対応する2機体目の元番号
 * E・F列：比較用（抽選では使用しない）
 * G列：所属
 * N列：抽選結果
 *
 * 【設定セル】
 * Q3：抽選実行チェックボックス
 * R11：Aリーグの機体数(3の倍数。0ならそのリーグは使わない)
 * R12：Bリーグの機体数
 * R13：Cリーグの機体数
 * R15：1機体目の機体数(自動入力)
 * R16：2機体目の機体数(自動入力)
 *
 * 全機体数 = R15 + R16。R11～R13の合計も、この全機体数と同じにしてください。
 *
 * 【抽選条件】
 * ・番号1～(1機体目の数＋2機体目の数)を重複なく使用(機体数は固定ではなく、R15・R16から自動で決まる)
 * ・1ブロック3機体
 * ・同じブロックに同じ所属を入れない
 * ・2機体持ちの2機体は、リーグ内ブロック番号の差が7以上
 */


// ============================================================
// 1. 設定
// ============================================================

const DRAW_CONFIG = {
  START_ROW: 3,

  FIRST_COUNT_CELL: 'R15',
  SECOND_COUNT_CELL: 'R16',
  LEAGUE_COUNT_RANGE: 'R11:R13',

  TRIGGER_CELL: 'Q3',

  OUTPUT_COLUMN: 14, // N列に抽選結果を出力

  BLOCK_SIZE: 3,

  // ペアのリーグ内ブロック番号の差を7以上にする
  MIN_BLOCK_DISTANCE: 7,

  MAX_SEARCH_NODES: 500000,
  MAX_TIME_MS: 240000
};


// ============================================================
// 2. チェックボックス処理
// ============================================================

function onEdit(e) {
  if (!e || !e.range) return;

  const range = e.range;

  if (
    range.getRow() === 3 &&
    range.getColumn() === 17 &&
    e.value === 'TRUE'
  ) {
    runRandomDraw(range.getSheet());
  }
}


// ============================================================
// 3. メイン処理
// ============================================================

function runRandomDraw(targetSheet) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = targetSheet || ss.getActiveSheet();

  const lock = LockService.getDocumentLock();

  if (!lock.tryLock(1000)) {
    ss.toast('別の抽選処理が実行中です。', '抽選', 5);
    sheet.getRange(DRAW_CONFIG.TRIGGER_CELL).setValue(false);
    return;
  }

  try {
    ss.toast('抽選を開始しました。', '抽選', 5);

    // 抽選結果を作成
    const result = createDrawResult_(sheet);

    // 書き込み前の最終検証
    validateFinalResult_(result);

    // N列だけを書き換える
    sheet.getRange(
      DRAW_CONFIG.START_ROW,
      DRAW_CONFIG.OUTPUT_COLUMN,
      result.output.length,
      1
    ).setValues(result.output);

    SpreadsheetApp.flush();

    ss.toast(
      '抽選完了！ N列に' + result.output.length + '機体分の番号を出力しました。',
      '抽選',
      8
    );

  } catch (error) {
    console.error(error);

    ss.toast(
      '抽選失敗：' + error.message,
      '抽選エラー',
      10
    );

  } finally {
    sheet.getRange(DRAW_CONFIG.TRIGGER_CELL).setValue(false);
    lock.releaseLock();
  }
}


// ============================================================
// 4. 元番号の照合用処理
// ============================================================

function normalizeNumberKey_(value) {
  const text = String(value || '')
    .trim()
    .normalize('NFKC');

  if (text === '') return '';

  // 数字の場合は先頭の0や小数表記の違いを吸収
  if (/^\d+(?:\.0+)?$/.test(text)) {
    return String(Number(text));
  }

  return text;
}


// ============================================================
// 5. データ読み込み・ペア特定
// ============================================================

function createDrawResult_(sheet) {
  const cfg = DRAW_CONFIG;

  const firstCount = Number(
    sheet.getRange(cfg.FIRST_COUNT_CELL).getValue()
  );

  const secondCount = Number(
    sheet.getRange(cfg.SECOND_COUNT_CELL).getValue()
  );

  const totalCount = firstCount + secondCount;

  // 全機体数は固定ではなく、R15(1機体目)+R16(2機体目)で決まる
  if (
    !Number.isInteger(firstCount) ||
    !Number.isInteger(secondCount) ||
    firstCount <= 0 ||
    secondCount < 0 ||
    secondCount > firstCount
  ) {
    throw new Error(
      'R15・R16を確認してください。1機体目は1機以上、2機体目は0以上で1機体目以下にしてください。'
    );
  }

  // リーグ別機体数
  const leagueCounts = sheet
    .getRange(cfg.LEAGUE_COUNT_RANGE)
    .getValues()
    .flat()
    .map(Number);

  if (
    leagueCounts.length !== 3 ||
    leagueCounts.some(
      n => !Number.isInteger(n) || n < 0
    ) ||
    leagueCounts.reduce((a, b) => a + b, 0) !== totalCount
  ) {
    throw new Error(
      'R11～R13のリーグ別機体数を確認してください。0以上で、合計が全機体数(' +
      totalCount + '機体 = R15+R16)になるようにしてください。'
    );
  }

  // 0機体のリーグは使用しない
  // 3機体で1ブロックなので、各リーグの機体数は3の倍数
  leagueCounts.forEach((count, index) => {
    if (count % 3 !== 0) {
      throw new Error(
        ['A', 'B', 'C'][index] +
        'リーグの機体数は3の倍数にしてください。'
      );
    }
  });

  /*
   * A～G列を読み込む。
   *
   * A列：元番号
   * D列：ペアの相手の元番号
   * G列：所属
   *
   * B・C・E・F列は参照しない。
   */
  const data = sheet.getRange(
    cfg.START_ROW,
    1,
    totalCount,
    7
  ).getDisplayValues();

  const firstMachines = [];
  const secondMachines = [];
  const allMachines = [];

  const originalNumberMap = new Map();

  // ----------------------------------------------------------
  // 全機体の基本情報を読み込む
  // ----------------------------------------------------------

  data.forEach((row, index) => {
    const originalNumber = normalizeNumberKey_(row[0]);
    const affiliation = String(row[6]).trim();

    if (!originalNumber) {
      throw new Error(
        (cfg.START_ROW + index) +
        '行目のA列（元番号）が空欄です。'
      );
    }

    if (!affiliation) {
      throw new Error(
        (cfg.START_ROW + index) +
        '行目のG列（所属）が空欄です。'
      );
    }

    if (originalNumberMap.has(originalNumber)) {
      throw new Error(
        'A列の元番号が重複しています：' + originalNumber
      );
    }

    const isFirst = index < firstCount;

    const machine = {
      id: index,
      row: cfg.START_ROW + index,
      originalNumber: originalNumber,
      affiliation: affiliation,
      type: isFirst ? 'first' : 'second',
      pairId: null
    };

    allMachines.push(machine);
    originalNumberMap.set(originalNumber, machine);

    if (isFirst) {
      firstMachines.push(machine);
    } else {
      secondMachines.push(machine);
    }
  });


  // ----------------------------------------------------------
  // D列とA列を照合してペアを作成
  // ----------------------------------------------------------

  const pairs = [];
  const pairedSecondIds = new Set();
  const pairedFirstIds = new Set();

  firstMachines.forEach(first => {
    // D列は1機体目の行にある
    const dIndex = first.row - cfg.START_ROW;
    const partnerNumber = normalizeNumberKey_(
      data[dIndex][3]
    );

    // D列が空欄なら1機体のみの参加者
    if (!partnerNumber) return;

    // D列の番号からA列の2機体目を探す
    const second = originalNumberMap.get(partnerNumber);

    if (!second) {
      throw new Error(
        first.row + '行目のD列にある番号「' +
        partnerNumber +
        '」がA列に見つかりません。'
      );
    }

    // 2機体目の番号であることを確認
    if (second.type !== 'second') {
      throw new Error(
        first.row + '行目のD列が1機体目の番号を参照しています。'
      );
    }

    if (pairedSecondIds.has(second.id)) {
      throw new Error(
        '2機体目の元番号「' +
        partnerNumber +
        '」が複数の1機体目に対応しています。'
      );
    }

    const pairId = pairs.length;

    first.pairId = pairId;
    second.pairId = pairId;

    pairedFirstIds.add(first.id);
    pairedSecondIds.add(second.id);

    pairs.push({
      id: pairId,
      first: first,
      second: second
    });
  });


  // ----------------------------------------------------------
  // 2機体目がすべてペアに対応しているか確認
  // ----------------------------------------------------------

  if (pairedSecondIds.size !== secondCount) {
    const unmatched = secondMachines.filter(
      machine => !pairedSecondIds.has(machine.id)
    );

    throw new Error(
      'D列から対応関係を確認できない2機体目があります。' +
      ' A列の元番号：' +
      unmatched.map(m => m.originalNumber).join(', ')
    );
  }

  // 1機体目のみの参加者
  const singles = firstMachines.filter(
    machine => !pairedFirstIds.has(machine.id)
  );

  if (pairs.length !== secondCount) {
    throw new Error('ペア数と2機体目の台数が一致しません。');
  }

  return solveAssignment_(
    allMachines,
    pairs,
    singles,
    leagueCounts
  );
}


// ============================================================
// 6. リーグ・ブロック作成
// ============================================================

function createBlocks_(leagueCounts) {
  const blocks = [];
  let nextNumber = 1;

  leagueCounts.forEach((count, leagueIndex) => {
    // 0機体のリーグはブロックを作らずスキップ
    if (count === 0) return;

    const blockCount = count / DRAW_CONFIG.BLOCK_SIZE;

    for (let i = 0; i < blockCount; i++) {
      const startNumber = nextNumber + i * DRAW_CONFIG.BLOCK_SIZE;

      blocks.push({
        // 全ブロックを管理するための通しID（配列の添字と一致）
        id: blocks.length,

        // A=0、B=1、C=2
        league: leagueIndex,

        // ★重要：リーグ内で1から振り直したブロック番号
        // ペア間隔の判定にはこちらを使う
        blockNumber: i + 1,

        numbers: [
          startNumber,
          startNumber + 1,
          startNumber + 2
        ],

        remaining: DRAW_CONFIG.BLOCK_SIZE,
        affiliations: new Set(),
        members: []
      });
    }

    nextNumber += count;
  });

  return blocks;
}


// ============================================================
// 7. 配列シャッフル
// ============================================================

function shuffle_(array) {
  const result = array.slice();

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [result[i], result[j]] =
      [result[j], result[i]];
  }

  return result;
}


// ============================================================
// 8. 配置探索
// ============================================================

function solveAssignment_(
  allMachines,
  pairs,
  singles,
  leagueCounts
) {
  const blocks = createBlocks_(leagueCounts);

  const startedAt = Date.now();
  let searchNodes = 0;

  const shuffledPairs = shuffle_(pairs);

  // 1機体目のみの機体を所属ごとにまとめる
  const groupMap = new Map();

  singles.forEach(machine => {
    if (!groupMap.has(machine.affiliation)) {
      groupMap.set(machine.affiliation, []);
    }

    groupMap.get(machine.affiliation).push(machine);
  });

  const singleGroups = Array.from(
    groupMap.entries()
  ).map(([affiliation, machines]) => ({
    affiliation,
    machines: shuffle_(machines)
  }));


  function limitReached_() {
    return (
      searchNodes > DRAW_CONFIG.MAX_SEARCH_NODES ||
      Date.now() - startedAt > DRAW_CONFIG.MAX_TIME_MS
    );
  }


  // ----------------------------------------------------------
  // 機体の配置・取り消し
  // ----------------------------------------------------------

  function placeMachine_(block, machine) {
    block.members.push(machine);
    block.affiliations.add(machine.affiliation);
    block.remaining--;
  }

  function removeMachine_(block, machine) {
    block.members.pop();
    block.affiliations.delete(machine.affiliation);
    block.remaining++;
  }


  // ----------------------------------------------------------
  // ペアの配置候補を取得
  // ----------------------------------------------------------

  function getPairCandidates_(pair) {
    const candidates = [];

    for (const firstBlock of blocks) {
      if (
        firstBlock.remaining <= 0 ||
        firstBlock.affiliations.has(pair.first.affiliation)
      ) {
        continue;
      }

      for (const secondBlock of blocks) {
        if (
          secondBlock.remaining <= 0 ||

          // ★リーグ内ブロック番号の差で判定する
          // リーグが異なっていても番号同士を直接比較する
          Math.abs(
            secondBlock.blockNumber - firstBlock.blockNumber
          ) < DRAW_CONFIG.MIN_BLOCK_DISTANCE ||

          secondBlock.affiliations.has(pair.second.affiliation)
        ) {
          continue;
        }

        candidates.push({
          // 配列の添字として使う通しID
          firstBlock: firstBlock.id,
          secondBlock: secondBlock.id
        });
      }
    }

    return candidates;
  }


  // ----------------------------------------------------------
  // ペアの配置を再帰的に探索
  // ----------------------------------------------------------

  function searchPairs_(remainingPairs) {
    searchNodes++;

    if (limitReached_()) return false;

    // ペアの配置が完了したら単独機体を配置
    if (remainingPairs.length === 0) {
      return assignSingles_(singleGroups);
    }

    // 配置候補が最も少ないペアを選ぶ
    let selectedPair = null;
    let selectedCandidates = null;

    for (const pair of remainingPairs) {
      const candidates = getPairCandidates_(pair);

      if (
        selectedCandidates === null ||
        candidates.length < selectedCandidates.length
      ) {
        selectedPair = pair;
        selectedCandidates = candidates;
      }

      if (candidates.length === 0) {
        return false;
      }

      if (candidates.length === 1) break;
    }

    const nextPairs = remainingPairs.filter(
      pair => pair.id !== selectedPair.id
    );

    for (const candidate of shuffle_(selectedCandidates)) {
      const firstBlock = blocks[candidate.firstBlock];
      const secondBlock = blocks[candidate.secondBlock];

      placeMachine_(firstBlock, selectedPair.first);
      placeMachine_(secondBlock, selectedPair.second);

      if (searchPairs_(nextPairs)) {
        return true;
      }

      removeMachine_(firstBlock, selectedPair.first);
      removeMachine_(secondBlock, selectedPair.second);
    }

    return false;
  }


  // ----------------------------------------------------------
  // 単独機体の配置
  // 同じ所属の機体は必ず別ブロックに配置する
  // ----------------------------------------------------------

  function assignSingles_(groups) {
    searchNodes++;

    if (limitReached_()) return false;

    // 全所属の配置が終わった
    if (groups.length === 0) {
      return blocks.every(
        block => block.remaining === 0
      );
    }

    let selectedIndex = -1;
    let selectedCandidates = null;

    // 配置可能なブロックが少ない所属を優先
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];

      const candidates = blocks.filter(block =>
        block.remaining > 0 &&
        !block.affiliations.has(group.affiliation)
      );

      if (candidates.length < group.machines.length) {
        return false;
      }

      if (
        selectedCandidates === null ||
        candidates.length - group.machines.length <
        selectedCandidates.length -
        groups[selectedIndex].machines.length
      ) {
        selectedIndex = i;
        selectedCandidates = candidates;
      }
    }

    const group = groups[selectedIndex];

    const nextGroups = groups.filter(
      (_, i) => i !== selectedIndex
    );

    return chooseBlocksForGroup_(
      group,
      shuffle_(selectedCandidates),
      0,
      [],
      nextGroups
    );
  }


  // ----------------------------------------------------------
  // 同じ所属の機体を異なるブロックに割り当てる
  // ----------------------------------------------------------

  function chooseBlocksForGroup_(
    group,
    candidates,
    startIndex,
    chosen,
    nextGroups
  ) {
    searchNodes++;

    if (limitReached_()) return false;

    // 必要なブロック数を確保できた
    if (chosen.length === group.machines.length) {
      const machines = shuffle_(group.machines);

      /*
       * ここでは所属と空き数はすでに仮登録済み。
       * 機体本体だけを登録する。
       */
      chosen.forEach((block, i) => {
        block.members.push(machines[i]);
      });

      if (assignSingles_(nextGroups)) {
        return true;
      }

      // 失敗した場合は機体本体だけ取り消す
      chosen.forEach(block => {
        block.members.pop();
      });

      return false;
    }

    const needed =
      group.machines.length - chosen.length;

    for (
      let i = startIndex;
      i <= candidates.length - needed;
      i++
    ) {
      const block = candidates[i];

      if (
        block.remaining <= 0 ||
        block.affiliations.has(group.affiliation)
      ) {
        continue;
      }

      // 仮配置
      block.affiliations.add(group.affiliation);
      block.remaining--;

      chosen.push(block);

      if (
        chooseBlocksForGroup_(
          group,
          candidates,
          i + 1,
          chosen,
          nextGroups
        )
      ) {
        return true;
      }

      // 仮配置を取り消す
      chosen.pop();
      block.remaining++;
      block.affiliations.delete(group.affiliation);
    }

    return false;
  }


  // ----------------------------------------------------------
  // 探索開始
  // ----------------------------------------------------------

  const solved = searchPairs_(shuffledPairs);

  if (!solved) {
    if (limitReached_()) {
      throw new Error(
        '探索上限に達しました。条件を確認するか、探索上限を調整してください。'
      );
    }

    throw new Error(
      'すべての条件を満たす配置が見つかりませんでした。'
    );
  }


  // ==========================================================
  // 9. ブロック内の番号をランダムに割り当て
  // ==========================================================

  const outputByRow = new Map();

  blocks.forEach(block => {
    if (block.members.length !== 3) {
      throw new Error(
        'リーグ' + (block.league + 1) +
        'のブロック' + block.blockNumber +
        'の機体数が3機体ではありません。'
      );
    }

    const numbers = shuffle_(block.numbers);
    const members = shuffle_(block.members);

    members.forEach((machine, index) => {
      outputByRow.set(
        machine.row,
        numbers[index]
      );
    });
  });


  // 元データの行順にN列出力用データを作成
  const output = allMachines.map(machine => {
    if (!outputByRow.has(machine.row)) {
      throw new Error(
        machine.row + '行目の番号が決まっていません。'
      );
    }

    return [outputByRow.get(machine.row)];
  });

  return {
    output,
    total: allMachines.length, // 全機体数(最終検証で使う)
    blocks,
    machines: allMachines,
    pairs,
    searchNodes
  };
}


// ============================================================
// 10. 最終検証
// ============================================================

function validateFinalResult_(result) {
  const numbers = result.output.map(
    row => Number(row[0])
  );

  // ----------------------------------------------------------
  // 番号の重複・欠番チェック
  // ----------------------------------------------------------

  const total = result.total;

  if (numbers.length !== total) {
    throw new Error(
      '抽選結果が' + total + '機体分ではありません。'
    );
  }

  const uniqueNumbers = new Set(numbers);

  if (uniqueNumbers.size !== total) {
    throw new Error(
      '抽選番号に重複があります。'
    );
  }

  for (let i = 1; i <= total; i++) {
    if (!uniqueNumbers.has(i)) {
      throw new Error(
        '抽選番号' + i + 'が欠番です。'
      );
    }
  }


  // ----------------------------------------------------------
  // ブロック内の所属重複チェック
  // ----------------------------------------------------------

  result.blocks.forEach(block => {
    if (block.members.length !== 3) {
      throw new Error(
        'リーグ' + (block.league + 1) +
        'のブロック' + block.blockNumber +
        'の機体数が3機体ではありません。'
      );
    }

    const affiliations = block.members.map(
      machine => machine.affiliation
    );

    if (new Set(affiliations).size !== 3) {
      throw new Error(
        'リーグ' + (block.league + 1) +
        'のブロック' + block.blockNumber +
        'で所属が重複しています。'
      );
    }
  });


  // ----------------------------------------------------------
  // 2機体持ちのブロック間隔チェック
  // ----------------------------------------------------------

  result.pairs.forEach(pair => {
    const firstBlock = result.blocks.find(block =>
      block.members.some(
        machine => machine.id === pair.first.id
      )
    );

    const secondBlock = result.blocks.find(block =>
      block.members.some(
        machine => machine.id === pair.second.id
      )
    );

    if (!firstBlock || !secondBlock) {
      throw new Error(
        'ペアの配置が見つかりません：' +
        pair.first.originalNumber
      );
    }

    // ★通しIDではなく、それぞれのリーグ内ブロック番号を比較
    const blockDistance = Math.abs(
      firstBlock.blockNumber - secondBlock.blockNumber
    );

    if (blockDistance < DRAW_CONFIG.MIN_BLOCK_DISTANCE) {
      throw new Error(
        '2機体持ちのリーグ内ブロック番号の差が7未満です。' +
        '元番号：' + pair.first.originalNumber +
        '（' + firstBlock.blockNumber + ' と ' +
        secondBlock.blockNumber + '）'
      );
    }
  });
}