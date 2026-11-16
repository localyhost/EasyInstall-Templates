// Starts and controls a real Paper server for the install test.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

const DONE_LINE = /Done \([0-9.,]+s\)!/;

/** Lets the operating system pick a free TCP port. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

export function parseTimeout(value, fallbackMs) {
  if (!value) return fallbackMs;
  const [, n, unit] = value.match(/^(\d+)(s|m)$/);
  return Number(n) * (unit === 'm' ? 60_000 : 1000);
}

export class TestServer {
  constructor({ dir, jar, logFile, memoryMb = 2048 }) {
    Object.assign(this, { dir, jar, logFile, memoryMb });
    this.proc = null;
    this.lines = []; // log of the current run
  }

  get running() {
    return this.proc !== null;
  }

  isDone() {
    return this.lines.some((l) => DONE_LINE.test(l));
  }

  /** Starts the server. waitDone=false returns immediately (used by first_start). */
  async start({ waitDone = true, timeoutMs = 300_000 } = {}) {
    if (this.running) return;
    this.lines = [];
    this.note('--- server start ---');
    this.proc = spawn('java', [`-Xmx${this.memoryMb}M`, '-jar', this.jar, '--nogui'], { cwd: this.dir });
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString();
      const parts = buffer.split('\n');
      buffer = parts.pop();
      for (const line of parts) this.push(line);
    };
    this.proc.stdout.on('data', onData);
    this.proc.stderr.on('data', onData);
    this.exited = new Promise((resolve) => this.proc.once('exit', (code) => {
      this.proc = null;
      this.note(`--- server stopped (code ${code}) ---`);
      resolve(code);
    }));
    if (waitDone) await this.waitUntilDone(timeoutMs);
  }

  waitUntilDone(timeoutMs = 300_000) {
    return this.waitFor(() => this.isDone(), timeoutMs, 'server start ("Done")');
  }

  push(line) {
    this.lines.push(line);
    appendFileSync(this.logFile, `${line}\n`);
  }

  note(text) {
    appendFileSync(this.logFile, `${text}\n`);
  }

  /** Waits until check() is true. Fails if the server exits unexpectedly. */
  async waitFor(check, timeoutMs, what) {
    const end = Date.now() + timeoutMs;
    const wasRunning = this.running;
    while (Date.now() < end) {
      if (check()) return;
      if (wasRunning && !this.running) throw new Error(`server exited while waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  waitForFile(relPath, timeoutMs) {
    return this.waitFor(() => existsSync(join(this.dir, relPath)), timeoutMs, `file ${relPath}`);
  }

  waitForLog(text, timeoutMs) {
    return this.waitFor(() => this.lines.some((l) => l.includes(text)), timeoutMs, `log line "${text}"`);
  }

  command(cmd) {
    if (!this.running) throw new Error(`command "${cmd}": server is not running`);
    this.note(`> ${cmd}`);
    this.proc.stdin.write(`${cmd}\n`);
  }

  async stop(timeoutMs = 120_000) {
    if (!this.running) return;
    this.command('stop');
    const timer = setTimeout(() => this.proc?.kill('SIGKILL'), timeoutMs);
    await this.exited;
    clearTimeout(timer);
  }

  async restart() {
    await this.stop();
    await this.start();
  }
}
