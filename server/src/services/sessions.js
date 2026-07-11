import { randomUUID } from 'node:crypto';

const NICKNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;

export class NicknameError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NicknameError';
  }
}

function normalizeNickname(value) {
  const nickname = typeof value === 'string' ? value.trim() : '';
  if (!NICKNAME_PATTERN.test(nickname)) {
    throw new NicknameError('Nickname must be 3–20 characters using letters, numbers, or underscores.');
  }
  return nickname;
}

export function createSessionService(db) {
  const findNickname = db.prepare(
    'SELECT NICKNAME FROM USERS WHERE NICKNAME = ? COLLATE NOCASE',
  );
  const insertUser = db.prepare(
    'INSERT INTO USERS (PHONE_NUMBER, NICKNAME, IS_SEED) VALUES (?, ?, 0)',
  );
  const insertSession = db.prepare(
    'INSERT INTO SESSIONS (TOKEN, PHONE_NUMBER, IS_SEED) VALUES (?, ?, 0)',
  );
  const findSession = db.prepare(
    `SELECT
       s.TOKEN AS token,
       s.PHONE_NUMBER AS phoneNumber,
       u.NICKNAME AS nickname,
       s.CREATED_AT AS createdAt
     FROM SESSIONS s
     JOIN USERS u ON u.PHONE_NUMBER = s.PHONE_NUMBER
     WHERE s.TOKEN = ?`,
  );
  const touchSession = db.prepare(
    `UPDATE SESSIONS
     SET LAST_SEEN_AT = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE TOKEN = ?`,
  );

  function suggestNickname(nickname) {
    for (let suffix = 2; suffix < 10_000; suffix += 1) {
      const tail = `_${suffix}`;
      const candidate = `${nickname.slice(0, 20 - tail.length)}${tail}`;
      if (!findNickname.get(candidate)) return candidate;
    }
    return `${nickname.slice(0, 15)}_${randomUUID().slice(0, 4)}`;
  }

  const registerTransaction = db.transaction((nickname) => {
    if (findNickname.get(nickname)) {
      return { conflict: true, suggestion: suggestNickname(nickname) };
    }

    // The demo does not collect a phone number. This opaque principal preserves
    // the literal PHONE_NUMBER foreign-key contract from the specification.
    const phoneNumber = `demo:${randomUUID()}`;
    const token = randomUUID();
    insertUser.run(phoneNumber, nickname);
    insertSession.run(token, phoneNumber);
    return {
      conflict: false,
      token,
      user: { nickname },
    };
  });

  return {
    register(value) {
      return registerTransaction(normalizeNickname(value));
    },

    validate(token) {
      if (typeof token !== 'string' || token.length === 0) return null;
      const session = findSession.get(token);
      if (!session) return null;
      touchSession.run(token);
      return session;
    },
  };
}

export function bearerToken(authorization) {
  if (typeof authorization !== 'string') return null;
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] ?? null;
}
