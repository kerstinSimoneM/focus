const DEFAULT_THRESHOLD_MS = 15 * 60 * 1000;
const BACKOFF_DURATION_MS = 60 * 60 * 1000;

const COMPANIONS = [
  { id: "deer", name: "Dare the deer", image: "assets/deer.png" },
  { id: "robin", name: "Rock the robin", image: "assets/robin.png" },
  { id: "fox", name: "Fern the fox", image: "assets/fox.png" },
  { id: "squirrel", name: "Brain the squirrel", image: "assets/squirrel.png" },
  { id: "hedgehog", name: "Heat the hedgehog", image: "assets/hedgehog.png" }
];

const EMPOWERMENT_MESSAGES = [
  ["breathe", "Take one gentle breath with me. Then choose the smallest visible next step."],
  ["one-line", "You do not need the whole path yet. Let’s make one helpful line of progress together."],
  ["name-it", "Let’s name what is in front of you. Clarity often begins with one honest sentence."],
  ["tiny-start", "A tiny start still counts. Open the next thing and give it two unhurried minutes."],
  ["steady", "You are allowed to move steadily, not perfectly. What is one piece you can make easier?"],
  ["unblock", "Being stuck is information, not failure. Write down the question that would unlock you."],
  ["choose", "You have choices here. Pick the kindest useful action and let that be enough for now."],
  ["return", "You can return to the work without solving everything. Put one simple thought on the page."],
  ["pause", "A pause can make room for clarity. Notice what feels hardest, then soften the next step."],
  ["sort", "You do not have to hold every task at once. Choose one thing to sort, name, or move forward."],
  ["question", "The right question is progress too. Write down what you need to understand next."],
  ["permission", "You have permission to make this simpler. What would the smallest workable version look like?"],
  ["anchor", "Come back to one concrete detail: a file, a sentence, or a decision you can make now."],
  ["unfinished", "Unfinished does not mean failed. Leave yourself one clear signpost for the next step."],
  ["trust", "You already know more than this stuck moment suggests. Start with the part you understand."],
  ["reset", "You can begin again from here. Take a breath, clear one small obstacle, and continue gently."]
];

function randomItem(items, random = Math.random) {
  return items[Math.floor(random() * items.length)];
}

class TrackerError extends Error {}

class WorkSessionTracker {
  constructor({ clock = () => Date.now(), random = Math.random, thresholdMs = DEFAULT_THRESHOLD_MS } = {}) {
    this.clock = clock;
    this.random = random;
    this.baseThresholdMs = thresholdMs;
    this.sessions = new Map();
    this.checkIns = new Map();
  }

  startSession(userId, assignedCompanion = null) {
    const now = this.clock();
    const companion = assignedCompanion || randomItem(COMPANIONS, this.random);
    const session = {
      id: `${userId}-${now}-${this.sessions.size + 1}`,
      userId,
      status: "active",
      startedAt: now,
      stoppedAt: null,
      lastActivityAt: now,
      originalThresholdMs: this.baseThresholdMs,
      effectiveThresholdMs: this.baseThresholdMs,
      falseAlarmCount: 0,
      suppressionEndsAt: null,
      companion,
      usedMessageIds: new Set(),
      checkInIds: []
    };
    this.sessions.set(session.id, session);
    return this.viewSession(session);
  }

  recordActivity(sessionId) {
    const session = this.requireActiveSession(sessionId);
    session.lastActivityAt = this.clock();
    return this.viewSession(session);
  }

  checkInactivity(sessionId) {
    const session = this.requireSession(sessionId);
    const now = this.clock();
    this.expireSuppression(session, now);
    if (session.status !== "active" || session.suppressionEndsAt !== null) return null;
    if (now - session.lastActivityAt < session.effectiveThresholdMs) return null;
    const pending = session.checkInIds.map((id) => this.checkIns.get(id))
      .find((checkIn) => checkIn.response === "pending");
    if (pending) return this.viewCheckIn(pending);
    const checkIn = this.createCheckIn(session, now);
    return this.viewCheckIn(checkIn);
  }

  respondToCheckIn(checkInId, response) {
    const checkIn = this.checkIns.get(checkInId);
    if (!checkIn) throw new TrackerError("Check-in not found.");
    if (checkIn.response !== "pending") throw new TrackerError("Check-in has already been answered.");
    checkIn.response = response;
    const session = this.requireActiveSession(checkIn.sessionId);
    const now = this.clock();
    if (response === "false-alarm") {
      session.lastActivityAt = now;
      session.falseAlarmCount += 1;
      if (session.falseAlarmCount === 1) {
        session.effectiveThresholdMs *= 2;
      } else if (session.falseAlarmCount === 2) {
        session.suppressionEndsAt = now + BACKOFF_DURATION_MS;
      }
      return this.viewSession(session);
    }
    if (response === "stuck") return this.signalStuck(session.id);
    if (response === "active") session.lastActivityAt = now;
    else throw new TrackerError("Unknown check-in response.");
    return this.viewSession(session);
  }

  signalStuck(sessionId) {
    const session = this.requireActiveSession(sessionId);
    this.endSuppression(session);
    const now = this.clock();
    session.lastActivityAt = now;
    const [messageId, text] = this.nextMessage(session);
    return {
      type: "empowerment",
      sessionId: session.id,
      createdAt: now,
      companion: session.companion,
      messageId,
      text
    };
  }

  stopSession(sessionId) {
    const session = this.requireActiveSession(sessionId);
    this.endSuppression(session);
    session.status = "stopped";
    session.stoppedAt = this.clock();
    return this.viewSession(session);
  }

  createCheckIn(session, createdAt) {
    const checkIn = {
      id: `check-in-${this.checkIns.size + 1}`,
      sessionId: session.id,
      createdAt,
      response: "pending",
      companion: session.companion,
      text: "I noticed a quiet pause. Would a little help or a gentle next step feel useful?"
    };
    this.checkIns.set(checkIn.id, checkIn);
    session.checkInIds.push(checkIn.id);
    return checkIn;
  }

  nextMessage(session) {
    if (session.usedMessageIds.size === EMPOWERMENT_MESSAGES.length) {
      session.usedMessageIds.clear();
    }
    const available = EMPOWERMENT_MESSAGES.filter(([id]) => !session.usedMessageIds.has(id));
    const [id, text] = randomItem(available, this.random);
    session.usedMessageIds.add(id);
    return [id, text];
  }

  expireSuppression(session, now) {
    if (session.suppressionEndsAt !== null && now >= session.suppressionEndsAt) {
      this.endSuppression(session);
    }
  }

  endSuppression(session) {
    session.suppressionEndsAt = null;
    session.effectiveThresholdMs = session.originalThresholdMs;
    session.falseAlarmCount = 0;
  }

  requireSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new TrackerError("Session not found.");
    return session;
  }

  requireActiveSession(sessionId) {
    const session = this.requireSession(sessionId);
    if (session.status !== "active") throw new TrackerError("Session is not active.");
    return session;
  }

  viewSession(session) {
    return {
      ...session,
      usedMessageIds: [...session.usedMessageIds]
    };
  }

  viewCheckIn(checkIn) {
    return { ...checkIn };
  }
}

const trackerApi = {
  BACKOFF_DURATION_MS,
  COMPANIONS,
  DEFAULT_THRESHOLD_MS,
  EMPOWERMENT_MESSAGES,
  TrackerError,
  WorkSessionTracker
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = trackerApi;
}
if (typeof window !== "undefined") {
  window.ForestFocus = trackerApi;
}
