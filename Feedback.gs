/**
 * 문항별 즉시 피드백과 최초 선택 답안 저장을 담당합니다.
 * 정답과 해설은 브라우저에 미리 전달하지 않고, 답을 고른 뒤 서버에서 반환합니다.
 */

function checkAnswer(attemptId, questionId, choice) {
  assertReady_();

  if (!attemptId || typeof attemptId !== 'string') {
    throw new Error('유효하지 않은 응시 정보입니다. 처음부터 다시 시작해 주세요.');
  }
  if (!questionId || typeof questionId !== 'string') {
    throw new Error('문항 정보가 올바르지 않습니다.');
  }
  if (typeof choice !== 'boolean') {
    throw new Error('O 또는 X를 선택해 주세요.');
  }

  const ss = getSpreadsheet_();
  const attemptSheet = ss.getSheetByName(APP_CONFIG.ATTEMPT_SHEET);
  const row = findFeedbackAttemptRow_(attemptSheet, attemptId);
  const rowValues = attemptSheet.getRange(row, 1, 1, 11).getValues()[0];

  const status = String(rowValues[5] || '');
  const quizVersion = String(rowValues[6] || '');
  const orderedIds = JSON.parse(String(rowValues[7] || '[]'));

  if (status === 'COMPLETED') {
    throw new Error('이미 제출이 완료된 응시입니다.');
  }
  if (quizVersion !== APP_CONFIG.QUIZ_VERSION) {
    throw new Error('퀴즈 버전이 변경되었습니다. 새로 시작해 주세요.');
  }
  if (!orderedIds.includes(questionId)) {
    throw new Error('현재 응시에 포함되지 않은 문항입니다.');
  }

  const question = getQuestionBank_().find(item => item.id === questionId);
  if (!question) {
    throw new Error('문항을 찾을 수 없습니다.');
  }

  const answerMap = parseFeedbackAnswerMap_(rowValues[10]);
  const alreadyAnswered = Object.prototype.hasOwnProperty.call(answerMap, questionId);
  const savedChoice = alreadyAnswered ? answerMap[questionId] : choice;

  if (!alreadyAnswered) {
    answerMap[questionId] = choice;
    attemptSheet.getRange(row, 11).setValue(JSON.stringify(answerMap));
  }

  return buildImmediateFeedback_(question, savedChoice, alreadyAnswered);
}

/**
 * 즉시 피드백 모드의 최종 제출 함수입니다.
 * 브라우저가 보내는 답안 대신 서버에 저장된 각 문항의 최초 선택을 채점합니다.
 */
function submitFeedbackAttempt(attemptId) {
  assertReady_();

  if (!attemptId || typeof attemptId !== 'string') {
    throw new Error('유효하지 않은 응시 정보입니다.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const ss = getSpreadsheet_();
    const attemptSheet = ss.getSheetByName(APP_CONFIG.ATTEMPT_SHEET);
    const row = findFeedbackAttemptRow_(attemptSheet, attemptId);
    const rowValues = attemptSheet.getRange(row, 1, 1, 11).getValues()[0];

    const nickname = String(rowValues[1] || '');
    const startedAt = new Date(rowValues[3]);
    const status = String(rowValues[5] || '');
    const quizVersion = String(rowValues[6] || '');
    const orderedIds = JSON.parse(String(rowValues[7] || '[]'));
    const answerMap = parseFeedbackAnswerMap_(rowValues[10]);

    if (status === 'COMPLETED') {
      throw new Error('이미 제출이 완료된 응시입니다.');
    }
    if (quizVersion !== APP_CONFIG.QUIZ_VERSION) {
      throw new Error('퀴즈 버전이 변경되었습니다. 새로 시작해 주세요.');
    }
    if (orderedIds.length !== APP_CONFIG.TOTAL_QUESTIONS) {
      throw new Error('문항 정보가 손상되었습니다. 새로 시작해 주세요.');
    }

    const unanswered = orderedIds.filter(id => typeof answerMap[id] !== 'boolean');
    if (unanswered.length > 0) {
      throw new Error('아직 답하지 않은 문항이 있습니다. 모든 문항을 완료해 주세요.');
    }

    const bankMap = {};
    getQuestionBank_().forEach(question => bankMap[question.id] = question);

    const completedAt = new Date();
    const rawElapsed = Math.max(
      0,
      Math.round((completedAt.getTime() - startedAt.getTime()) / 1000)
    );
    const elapsedSec = Math.min(rawElapsed, APP_CONFIG.MAX_QUIZ_MINUTES * 60);

    let score = 0;
    const review = orderedIds.map(id => {
      const question = bankMap[id];
      if (!question) throw new Error('문항을 찾을 수 없습니다: ' + id);

      const selected = answerMap[id];
      const isCorrect = selected === question.answer;
      if (isCorrect) score += 1;

      return {
        id: question.id,
        stage: question.stage,
        topic: question.topic,
        dateLabel: question.dateLabel,
        statement: question.statement,
        selected,
        correctAnswer: question.answer,
        isCorrect,
        explanation: question.explanation,
        sourceName: question.sourceName,
        sourceUrl: question.sourceUrl
      };
    });

    attemptSheet.getRange(row, 5, 1, 7).setValues([[
      completedAt,
      'COMPLETED',
      APP_CONFIG.QUIZ_VERSION,
      JSON.stringify(orderedIds),
      score,
      elapsedSec,
      JSON.stringify(answerMap)
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
      JSON.stringify(answerMap)
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

function buildImmediateFeedback_(question, selected, alreadyAnswered) {
  return {
    id: question.id,
    selected,
    correctAnswer: question.answer,
    isCorrect: selected === question.answer,
    explanation: question.explanation,
    sourceName: question.sourceName,
    sourceUrl: question.sourceUrl,
    alreadyAnswered
  };
}

function parseFeedbackAnswerMap_(rawValue) {
  if (!rawValue) return {};

  try {
    const parsed = JSON.parse(String(rawValue));

    if (Array.isArray(parsed)) {
      return parsed.reduce((map, item) => {
        if (item && typeof item.id === 'string' && typeof item.choice === 'boolean') {
          map[item.id] = item.choice;
        }
        return map;
      }, {});
    }

    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

function findFeedbackAttemptRow_(attemptSheet, attemptId) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'feedback-attempt-row:' + attemptId;
  const cachedRow = Number(cache.get(cacheKey));

  if (
    cachedRow > 1 &&
    String(attemptSheet.getRange(cachedRow, 1).getValue()) === attemptId
  ) {
    return cachedRow;
  }

  const cell = attemptSheet
    .createTextFinder(attemptId)
    .matchEntireCell(true)
    .findNext();

  if (!cell || cell.getColumn() !== 1) {
    throw new Error('응시 기록을 찾을 수 없습니다. 처음부터 다시 시작해 주세요.');
  }

  cache.put(cacheKey, String(cell.getRow()), 21600);
  return cell.getRow();
}
