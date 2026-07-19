import { readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { ConfigRepository, resolveConfigPath } from "../src/config.js";
import { CliError } from "../src/errors.js";

const temporaryDirectories: string[] = [];

async function temporaryConfig(): Promise<{ directory: string; file: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), "uga-config-"));
  temporaryDirectories.push(directory);
  return { directory, file: path.join(directory, "nested", "config.json") };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("configuration repository", () => {
  it("writes only normalized non-secret profile data", async () => {
    const { file } = await temporaryConfig();
    const repository = new ConfigRepository(file);
    await repository.saveProfile("local", {
      apiBaseUrl: "http://127.0.0.1:3001",
      issuer: "http://127.0.0.1:8080/realms/gopher",
    });
    const text = await readFile(file, "utf8");
    expect(text).not.toMatch(/token|password|secret/iu);
    expect(await repository.load()).toEqual({
      profiles: {
        local: {
          apiBaseUrl: "http://127.0.0.1:3001/",
          issuer: "http://127.0.0.1:8080/realms/gopher/",
        },
      },
      version: 1,
    });
  });

  it("rejects credential-shaped fields in a hand-edited file", async () => {
    const { file } = await temporaryConfig();
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({
        profiles: {
          local: {
            accessToken: "must-not-load",
            apiBaseUrl: "https://api.example",
            issuer: "https://identity.example",
          },
        },
        version: 1,
      }),
    );
    await expect(new ConfigRepository(file).load()).rejects.toBeInstanceOf(CliError);
  });

  it("selects platform-native configuration roots", () => {
    expect(resolveConfigPath({ APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, "win32", "C:\\Users\\me")).toBe(
      "C:\\Users\\me\\AppData\\Roaming\\umn-gopher-assistant\\uga\\config.json",
    );
    expect(resolveConfigPath({ XDG_CONFIG_HOME: "/config" }, "linux", "/home/me")).toBe(
      "/config/umn-gopher-assistant/uga/config.json",
    );
  });
});
