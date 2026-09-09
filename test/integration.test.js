const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const vm = require("node:vm");

function getPage(port, pathname = "/") {
  return new Promise((resolve, reject) => {
    const request = http.get(`http://127.0.0.1:${port}${pathname}`, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ statusCode: response.statusCode, body }));
    });
    request.on("error", reject);
  });
}

test("starts the server and serves the Forest Focus page", async () => {
  const port = 3100 + Math.floor(Math.random() * 500);
  const server = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await new Promise((resolve, reject) => {
      const onData = (chunk) => {
        if (chunk.toString().includes(`localhost:${port}`)) {
          server.stdout.off("data", onData);
          resolve();
        }
      };
      server.stdout.on("data", onData);
      server.once("error", reject);
      server.once("exit", (code) => reject(new Error(`Server exited with code ${code}`)));
    });

    const page = await getPage(port);
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /<title>Forest Focus<\/title>/);
    assert.match(page.body, /src="\.\/tracker\.js"/);
    assert.match(page.body, /src="\.\/app\.js"/);
  } finally {
    server.kill();
  }
});

test("loads browser scripts without Node-only require support", () => {
  const elements = new Map();
  const makeElement = () => ({
    hidden: true,
    dataset: {},
    textContent: "",
    src: "",
    alt: "",
    style: {},
    className: "",
    setAttribute() {},
    addEventListener(type, handler) { this.handlers = this.handlers || {}; this.handlers[type] = handler; },
    querySelector(selector) {
      this.children = this.children || new Map();
      if (!this.children.has(selector)) this.children.set(selector, makeElement());
      return this.children.get(selector);
    }
  });

  ["#notes", "#status", "#companion", "#check-in", "#empowerment",
    "#start", "#stop", "#direct-stuck"].forEach((selector) => {
    elements.set(selector, makeElement());
  });

  const context = vm.createContext({
    console,
    window: {},
    document: { querySelector: (selector) => elements.get(selector) },
    Date,
    Math,
    setInterval() {}
  });
  context.window.localStorage = {
    getItem() { return null; },
    setItem() {}
  };
  const trackerSource = fs.readFileSync(path.join(__dirname, "../src/tracker.js"), "utf8");
  const appSource = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");

  assert.doesNotThrow(() => vm.runInContext(trackerSource, context));
  assert.doesNotThrow(() => vm.runInContext(appSource, context));
  assert.equal(typeof context.window.ForestFocus.WorkSessionTracker, "function");
  assert.equal(elements.get("#companion").hidden, false);
  assert.match(elements.get("#companion").querySelector("img").src, /robin\.png/);
});

test("restarts the inactivity timer after the user says they are stuck", () => {
  const elements = new Map();
  const makeElement = () => ({
    hidden: true,
    dataset: {},
    textContent: "",
    src: "",
    alt: "",
    style: {},
    className: "",
    handlers: {},
    setAttribute() {},
    addEventListener(type, handler) { this.handlers[type] = handler; },
    querySelector(selector) {
      this.children = this.children || new Map();
      if (!this.children.has(selector)) this.children.set(selector, makeElement());
      return this.children.get(selector);
    }
  });

  ["#notes", "#status", "#companion", "#check-in", "#companion-reaction", "#empowerment","#start", "#stop", "#direct-stuck"].forEach((selector) => {
    elements.set(selector, makeElement());
  });

  let intervalCount = 0;
  const context = vm.createContext({
    console,
    window: {
      localStorage: {
        getItem() { return null; },
        setItem() {}
      },
      ForestFocus: {
        COMPANIONS: [
          { id: "deer", name: "Dare the deer", image: "assets/deer.png" },
          { id: "robin", name: "Rock the robin", image: "assets/robin.png" }
        ],
        WorkSessionTracker: class {
          constructor() {
            this.sessions = new Map();
            this.checkIns = new Map();
          }
          startSession(userId) {
            const session = {
              id: "session-1",
              userId,
              status: "active",
              companion: { id: "robin", name: "Rock the robin", image: "assets/robin.png" },
              lastActivityAt: 0,
              effectiveThresholdMs: 900000
            };
            this.sessions.set(session.id, session);
            return session;
          }
          signalStuck(sessionId) {
            const session = this.sessions.get(sessionId);
            session.lastActivityAt = 1;
            return {
              sessionId,
              companion: session.companion,
              text: "Take one tiny step."
            };
          }
        }
      }
    },
    document: { querySelector: (selector) => elements.get(selector) },
    Date,
    Math,
    setInterval: () => {
      intervalCount += 1;
      return intervalCount;
    },
    clearInterval() {}
  });

  const appSource = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
  vm.runInContext(appSource, context);

  elements.get("#start").handlers.click();
  assert.equal(intervalCount, 1, "the first session should start the inactivity timer");

  elements.get("#check-in").handlers.click({
    target: { dataset: { response: "stuck" } }
  });

  assert.equal(intervalCount, 2, "a stuck response should restart the inactivity timer");
});

test("restarts the inactivity timer after the direct stuck action", () => {
  const elements = new Map();
  const makeElement = () => ({
    hidden: true,
    dataset: {},
    textContent: "",
    src: "",
    alt: "",
    style: {},
    className: "",
    handlers: {},
    setAttribute() {},
    addEventListener(type, handler) { this.handlers[type] = handler; },
    querySelector(selector) {
      this.children = this.children || new Map();
      if (!this.children.has(selector)) this.children.set(selector, makeElement());
      return this.children.get(selector);
    }
  });

  ["#notes", "#status", "#companion", "#check-in", "#companion-reaction", "#empowerment",
    "#start", "#stop", "#direct-stuck"].forEach((selector) => {
    elements.set(selector, makeElement());
  });

  let intervalCount = 0;
  const context = vm.createContext({
    console,
    window: {
      localStorage: {
        getItem() { return null; },
        setItem() {}
      },
      ForestFocus: {
        COMPANIONS: [
          { id: "deer", name: "Dare the deer", image: "assets/deer.png" },
          { id: "robin", name: "Rock the robin", image: "assets/robin.png" }
        ],
        WorkSessionTracker: class {
          constructor() {
            this.sessions = new Map();
          }
          startSession(userId) {
            const session = {
              id: "session-1",
              userId,
              status: "active",
              companion: { id: "robin", name: "Rock the robin", image: "assets/robin.png" },
              lastActivityAt: 0,
              effectiveThresholdMs: 900000
            };
            this.sessions.set(session.id, session);
            return session;
          }
          signalStuck(sessionId) {
            const session = this.sessions.get(sessionId);
            session.lastActivityAt = 1;
            return {
              sessionId,
              companion: session.companion,
              text: "Take one tiny step."
            };
          }
        }
      }
    },
    document: { querySelector: (selector) => elements.get(selector) },
    Date,
    Math,
    setInterval: () => {
      intervalCount += 1;
      return intervalCount;
    },
    clearInterval() {}
  });

  const appSource = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
  vm.runInContext(appSource, context);

  elements.get("#start").handlers.click();
  assert.equal(intervalCount, 1, "the session should start the inactivity timer");

  elements.get("#direct-stuck").handlers.click();

  assert.equal(intervalCount, 2, "the direct stuck action should restart the inactivity timer");
});

test("validates the final companion set as transparent, realistic PNGs", () => {
  const assetDir = path.join(__dirname, "../src/assets");
  const files = fs.readdirSync(assetDir).filter((name) => name.endsWith(".png")).sort();
  assert.deepEqual(files, ["deer.png", "fox.png", "hedgehog.png", "robin.png", "squirrel.png"]);

  const companions = ["deer", "robin", "fox", "squirrel", "hedgehog"];
  for (const id of companions) {
    const pngPath = path.join(__dirname, `../src/assets/${id}.png`);
    const png = fs.readFileSync(pngPath);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    const colorType = png[25];
    assert.ok(width >= 320 && width <= 700, `${id} should be sized as a final companion portrait`);
    assert.ok(height >= 320 && height <= 700, `${id} should be sized as a final companion portrait`);
    assert.equal(colorType, 6, `${id} should keep alpha transparency`);
    assert.ok(png.length > 1000, `${id} should contain actual image data`);
  }
});
