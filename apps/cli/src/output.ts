import { redactText, type CliError } from "./errors.js";

export interface OutputWriter {
  write(chunk: string): unknown;
}

export interface CliIo {
  readonly stderr: OutputWriter;
  readonly stdout: OutputWriter;
}

interface OutputContext {
  readonly profile: string | null;
}

export class CliOutput {
  readonly #io: CliIo;
  #json = false;

  constructor(io: CliIo) {
    this.#io = io;
  }

  get json(): boolean {
    return this.#json;
  }

  setJson(enabled: boolean): void {
    this.#json = enabled;
  }

  diagnostic(message: string): void {
    this.#io.stderr.write(`${redactText(message)}\n`);
  }

  rawStdout(value: string): void {
    this.#io.stdout.write(value);
  }

  success(command: string, data: unknown, context: OutputContext, human?: string): void {
    if (this.#json) {
      this.#io.stdout.write(
        `${JSON.stringify({ command, data, meta: { profile: context.profile }, ok: true })}\n`,
      );
      return;
    }
    const rendered = human ?? JSON.stringify(data, null, 2);
    this.#io.stdout.write(`${rendered}${rendered.endsWith("\n") ? "" : "\n"}`);
  }

  failure(command: string, error: CliError, context: OutputContext): void {
    if (this.#json) {
      this.#io.stdout.write(
        `${JSON.stringify({
          command,
          error: {
            code: error.code,
            ...(error.details === undefined ? {} : { details: error.details }),
            exitCode: error.exitCode,
            message: redactText(error.message),
          },
          meta: { profile: context.profile },
          ok: false,
        })}\n`,
      );
      return;
    }
    this.#io.stderr.write(`uga: ${redactText(error.message)} [${error.code}]\n`);
  }
}
