/**
 * 계기교육 OX 퀴즈 — Google Apps Script + Google Sheets
 * 배포 전 setupQuizProject()를 한 번 실행하세요.
 */

const APP_CONFIG = Object.freeze({
  APP_TITLE: '기억의 바다, 우리들의 여정',
  QUIZ_VERSION: '2026-계기교육-01',
  TOTAL_QUESTIONS: 30,
  LEADERBOARD_LIMIT: 20,
  MAX_ATTEMPTS_PER_NICKNAME: 20,
  MAX_QUIZ_MINUTES: 60,
  SPREADSHEET_PROPERTY_KEY: 'QUIZ_SPREADSHEET_ID',
  RESPONSE_SHEET: '응답',
  ATTEMPT_SHEET: '시도'
});

function doGet() {
  const template = HtmlService.createTemplateFromFile('Index');
  template.publicConfig = JSON.stringify({
    appTitle: APP_CONFIG.APP_TITLE,
    quizVersion: APP_CONFIG.QUIZ_VERSION,
    totalQuestions: APP_CONFIG.TOTAL_QUESTIONS
  });

  return template.evaluate()
    .setTitle(APP_CONFIG.APP_TITLE)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/**
 * 최초 1회 실행: 응답 저장용 스프레드시트와 시트를 생성합니다.
 * 실행 결과의 URL을 열어 저장 위치를 확인하세요.
 */
function setupQuizProject() {
  const props = PropertiesService.getScriptProperties();
  const existingId = props.getProperty(APP_CONFIG.SPREADSHEET_PROPERTY_KEY);

  if (existingId) {
    const existing = SpreadsheetApp.openById(existingId);
    ensureSheets_(existing);
    console.log('응답 스프레드시트: ' + existing.getUrl());
    return {
      created: false,
      spreadsheetId: existingId,
      spreadsheetUrl: existing.getUrl()
    };
  }

  const ss = SpreadsheetApp.create('계기교육 OX 퀴즈 응답');
  props.setProperty(APP_CONFIG.SPREADSHEET_PROPERTY_KEY, ss.getId());
  ensureSheets_(ss);
  console.log('응답 스프레드시트: ' + ss.getUrl());

  return {
    created: true,
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl()
  };
}

/**
 * 이미 만든 스프레드시트를 쓰고 싶을 때 실행합니다.
 */
function connectExistingSpreadsheet(spreadsheetId) {
  if (!spreadsheetId || typeof spreadsheetId !== 'string') {
    throw new Error('올바른 스프레드시트 ID가 필요합니다.');
  }

  const ss = SpreadsheetApp.openById(spreadsheetId.trim());
  PropertiesService.getScriptProperties()
    .setProperty(APP_CONFIG.SPREADSHEET_PROPERTY_KEY, ss.getId());
  ensureSheets_(ss);

  return {
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl()
  };
}

function getInitialData() {
  assertReady_();
  return {
    leaderboard: getLeaderboard_(),
    stages: getStageSummary_(),
    quizVersion: APP_CONFIG.QUIZ_VERSION,
    totalQuestions: APP_CONFIG.TOTAL_QUESTIONS
  };
}

function startAttempt(nickname) {
  assertReady_();

  const cleanNickname = sanitizeNickname_(nickname);
  enforceAttemptLimit_(cleanNickname);

  const bank = getQuestionBank_();
  const shuffled = shuffleByStage_(bank);
  const attemptId = Utilities.getUuid();
  const startedAt = new Date();

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName(APP_CONFIG.ATTEMPT_SHEET);
    sheet.appendRow([
      attemptId,
      cleanNickname,
      cleanNickname.toLocaleLowerCase('ko-KR'),
      startedAt,
      '',
      'STARTED',
      APP_CONFIG.QUIZ_VERSION,
      JSON.stringify(shuffled.map(q => q.id)),
      '',
      '',
      ''
    ]);
  } finally {
    lock.releaseLock();
  }

  return {
    attemptId,
    nickname: cleanNickname,
    startedAt: startedAt.toISOString(),
    quizVersion: APP_CONFIG.QUIZ_VERSION,
    questions: shuffled.map(toPublicQuestion_),
    stages: getStageSummary_()
  };
}

function submitAttempt(attemptId, answers) {
  assertReady_();

  if (!attemptId || typeof attemptId !== 'string') {
    throw new Error('유효하지 않은 응시 정보입니다.');
  }

  if (!Array.isArray(answers)) {
    throw new Error('답안 형식이 올바르지 않습니다.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const ss = getSpreadsheet_();
    const attemptSheet = ss.getSheetByName(APP_CONFIG.ATTEMPT_SHEET);
    const cell = attemptSheet.createTextFinder(attemptId).matchEntireCell(true).findNext();

    if (!cell || cell.getColumn() !== 1) {
      throw new Error('응시 기록을 찾을 수 없습니다. 처음부터 다시 시작해 주세요.');
    }

    const row = cell.getRow();
    const rowValues = attemptSheet.getRange(row, 1, 1, 11).getValues()[0];
    const nickname = String(rowValues[1] || '');
    const startedAt = new Date(rowValues[3]);
    const status = String(rowValues[5] || '');
    const quizVersion = String(rowValues[6] || '');
    const orderedIds = JSON.parse(String(rowValues[7] || '[]'));

    if (status === 'COMPLETED') {
      throw new Error('이미 제출이 완료된 응시입니다.');
    }

    if (quizVersion !== APP_CONFIG.QUIZ_VERSION) {
      throw new Error('퀴즈 버전이 변경되었습니다. 새로 시작해 주세요.');
    }

    if (orderedIds.length !== APP_CONFIG.TOTAL_QUESTIONS) {
      throw new Error('문항 정보가 손상되었습니다. 새로 시작해 주세요.');
    }

    const answerMap = {};
    answers.forEach(item => {
      if (!item || typeof item.id !== 'string' || typeof item.choice !== 'boolean') return;
      answerMap[item.id] = item.choice;
    });

    const bankMap = {};
    getQuestionBank_().forEach(q => bankMap[q.id] = q);

    const completedAt = new Date();
    const rawElapsed = Math.max(0, Math.round((completedAt.getTime() - startedAt.getTime()) / 1000));
    const maxElapsed = APP_CONFIG.MAX_QUIZ_MINUTES * 60;
    const elapsedSec = Math.min(rawElapsed, maxElapsed);

    let score = 0;
    const review = orderedIds.map(id => {
      const q = bankMap[id];
      if (!q) throw new Error('문항을 찾을 수 없습니다: ' + id);

      const selected = Object.prototype.hasOwnProperty.call(answerMap, id)
        ? answerMap[id]
        : null;
      const isCorrect = selected === q.answer;
      if (isCorrect) score += 1;

      return {
        id: q.id,
        stage: q.stage,
        topic: q.topic,
        dateLabel: q.dateLabel,
        statement: q.statement,
        selected: selected,
        correctAnswer: q.answer,
        isCorrect: isCorrect,
        explanation: q.explanation,
        sourceName: q.sourceName,
        sourceUrl: q.sourceUrl
      };
    });

    attemptSheet.getRange(row, 5, 1, 7).setValues([[
      completedAt,
      'COMPLETED',
      APP_CONFIG.QUIZ_VERSION,
      JSON.stringify(orderedIds),
      score,
      elapsedSec,
      JSON.stringify(answers)
    ]]);

    const responseSheet = ss.getSheetByName(APP_CONFIG.RESPONSE_SHEET);
    responseSheet.appendRow([
      completedAt,
      nickname,
      nickname.toLocaleLowerCase('ko-KR'),
      score,
      APP_CONFIG.TOTAL_QUESTIONS,
      elapsedSec,
      Math.round((score / APP_CONFIG.TOTAL_QUESTIONS) * 1000) / 10,
      attemptId,
      APP_CONFIG.QUIZ_VERSION,
      JSON.stringify(answers)
    ]);

    CacheService.getScriptCache().remove('leaderboard:' + APP_CONFIG.QUIZ_VERSION);

    const leaderboard = getLeaderboard_();
    const myRank = findRank_(leaderboard, nickname);

    return {
      nickname,
      score,
      total: APP_CONFIG.TOTAL_QUESTIONS,
      elapsedSec,
      accuracy: Math.round((score / APP_CONFIG.TOTAL_QUESTIONS) * 1000) / 10,
      myRank,
      leaderboard,
      review
    };
  } finally {
    lock.releaseLock();
  }
}

function getLeaderboard() {
  assertReady_();
  return getLeaderboard_();
}

/**
 * 교사가 새 라운드를 시작할 때:
 * 1) APP_CONFIG.QUIZ_VERSION 값을 새 값으로 변경
 * 2) 새 버전으로 재배포
 * 이전 데이터는 삭제하지 않고 보존됩니다.
 */
function getSpreadsheetUrl() {
  assertReady_();
  return getSpreadsheet_().getUrl();
}

function ensureSheets_(ss) {
  let responseSheet = ss.getSheetByName(APP_CONFIG.RESPONSE_SHEET);
  if (!responseSheet) responseSheet = ss.insertSheet(APP_CONFIG.RESPONSE_SHEET);
  if (responseSheet.getLastRow() === 0) {
    responseSheet.getRange(1, 1, 1, 10).setValues([[
      '제출시각', '별명', '별명정규화', '점수', '총문항',
      '소요시간_초', '정답률_퍼센트', '응시ID', '퀴즈버전', '답안JSON'
    ]]);
  }
  responseSheet.setFrozenRows(1);
  responseSheet.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');

  let attemptSheet = ss.getSheetByName(APP_CONFIG.ATTEMPT_SHEET);
  if (!attemptSheet) attemptSheet = ss.insertSheet(APP_CONFIG.ATTEMPT_SHEET);
  if (attemptSheet.getLastRow() === 0) {
    attemptSheet.getRange(1, 1, 1, 11).setValues([[
      '응시ID', '별명', '별명정규화', '시작시각', '완료시각',
      '상태', '퀴즈버전', '문항순서JSON', '점수', '소요시간_초', '답안JSON'
    ]]);
  }
  attemptSheet.setFrozenRows(1);
  attemptSheet.getRange('D:E').setNumberFormat('yyyy-mm-dd hh:mm:ss');

  [responseSheet, attemptSheet].forEach(sheet => {
    if (sheet.getLastColumn() > 0) {
      sheet.getRange(1, 1, 1, sheet.getLastColumn())
        .setFontWeight('bold')
        .setBackground('#EAE3FF');
      sheet.autoResizeColumns(1, sheet.getLastColumn());
    }
  });
}

/**
 * setupQuizProject()를 다시 실행해도 기존 응답은 삭제되지 않습니다.
 */
function assertReady_() {
  const id = PropertiesService.getScriptProperties()
    .getProperty(APP_CONFIG.SPREADSHEET_PROPERTY_KEY);

  if (!id) {
    throw new Error('먼저 Apps Script 편집기에서 setupQuizProject()를 실행해 주세요.');
  }
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties()
    .getProperty(APP_CONFIG.SPREADSHEET_PROPERTY_KEY);
  return SpreadsheetApp.openById(id);
}

function getLeaderboard_() {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'leaderboard:' + APP_CONFIG.QUIZ_VERSION;
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const sheet = getSpreadsheet_().getSheetByName(APP_CONFIG.RESPONSE_SHEET);
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) return [];

  const rowCount = Math.min(lastRow - 1, 5000);
  const startRow = lastRow - rowCount + 1;
  const values = sheet.getRange(startRow, 1, rowCount, 10).getValues();

  const bestByNickname = {};

  values.forEach(row => {
    const completedAt = row[0] instanceof Date ? row[0] : new Date(row[0]);
    const nickname = String(row[1] || '');
    const nicknameKey = String(row[2] || '').trim();
    const score = Number(row[3] || 0);
    const total = Number(row[4] || APP_CONFIG.TOTAL_QUESTIONS);
    const elapsedSec = Number(row[5] || 0);
    const version = String(row[8] || '');

    if (!nicknameKey || version !== APP_CONFIG.QUIZ_VERSION) return;

    const candidate = {
      nickname,
      score,
      total,
      elapsedSec,
      completedAt: completedAt.toISOString()
    };

    const current = bestByNickname[nicknameKey];
    if (!current || isBetterResult_(candidate, current)) {
      bestByNickname[nicknameKey] = candidate;
    }
  });

  const ranked = Object.keys(bestByNickname)
    .map(key => bestByNickname[key])
    .sort(compareResults_)
    .slice(0, APP_CONFIG.LEADERBOARD_LIMIT)
    .map((item, index) => Object.assign({ rank: index + 1 }, item));

  cache.put(cacheKey, JSON.stringify(ranked), 30);
  return ranked;
}

function isBetterResult_(a, b) {
  if (a.score !== b.score) return a.score > b.score;
  if (a.elapsedSec !== b.elapsedSec) return a.elapsedSec < b.elapsedSec;
  return new Date(a.completedAt).getTime() < new Date(b.completedAt).getTime();
}

function compareResults_(a, b) {
  if (a.score !== b.score) return b.score - a.score;
  if (a.elapsedSec !== b.elapsedSec) return a.elapsedSec - b.elapsedSec;
  return new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime();
}

function findRank_(leaderboard, nickname) {
  const key = nickname.toLocaleLowerCase('ko-KR');
  const found = leaderboard.find(item =>
    item.nickname.toLocaleLowerCase('ko-KR') === key
  );
  return found ? found.rank : null;
}

function enforceAttemptLimit_(nickname) {
  const sheet = getSpreadsheet_().getSheetByName(APP_CONFIG.RESPONSE_SHEET);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const rowCount = Math.min(lastRow - 1, 1000);
  const startRow = lastRow - rowCount + 1;
  const values = sheet.getRange(startRow, 1, rowCount, 9).getValues();
  const key = nickname.toLocaleLowerCase('ko-KR');

  const count = values.reduce((sum, row) => {
    return sum + (
      String(row[2] || '') === key &&
      String(row[8] || '') === APP_CONFIG.QUIZ_VERSION
        ? 1
        : 0
    );
  }, 0);

  if (count >= APP_CONFIG.MAX_ATTEMPTS_PER_NICKNAME) {
    throw new Error('이 별명으로 가능한 응시 횟수를 모두 사용했습니다. 다른 별명을 사용하지 말고 선생님께 문의해 주세요.');
  }
}

function sanitizeNickname_(nickname) {
  if (typeof nickname !== 'string') {
    throw new Error('별명을 입력해 주세요.');
  }

  const clean = nickname
    .normalize('NFKC')
    .replace(/[<>{}\[\]\\/"'`;]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (clean.length < 2 || clean.length > 12) {
    throw new Error('별명은 2자 이상 12자 이하로 입력해 주세요.');
  }

  if (!/^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 _.-]+$/.test(clean)) {
    throw new Error('별명에는 한글, 영문, 숫자, 공백, -, _, .만 사용할 수 있습니다.');
  }

  const blocked = ['관리자', 'admin', '선생님', '교사', '운영자'];
  if (blocked.some(word => clean.toLocaleLowerCase('ko-KR').includes(word))) {
    throw new Error('운영자와 혼동될 수 있는 별명은 사용할 수 없습니다.');
  }

  return clean;
}

function toPublicQuestion_(q) {
  return {
    id: q.id,
    stage: q.stage,
    topic: q.topic,
    dateLabel: q.dateLabel,
    stageTitle: q.stageTitle,
    statement: q.statement
  };
}

function getStageSummary_() {
  const seen = {};
  getQuestionBank_().forEach(q => {
    if (!seen[q.stage]) {
      seen[q.stage] = {
        stage: q.stage,
        title: q.stageTitle,
        topic: q.topic,
        dateLabel: q.dateLabel
      };
    }
  });
  return Object.keys(seen).sort((a, b) => Number(a) - Number(b)).map(key => seen[key]);
}

function shuffleByStage_(bank) {
  const stages = {};
  bank.forEach(question => {
    if (!stages[question.stage]) stages[question.stage] = [];
    stages[question.stage].push(question);
  });

  return Object.keys(stages)
    .sort((a, b) => Number(a) - Number(b))
    .reduce((all, stage) => all.concat(shuffle_(stages[stage])), []);
}

function shuffle_(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
  return array;
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
