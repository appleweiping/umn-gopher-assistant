import { expect, test, type Page } from "@playwright/test";

const legacyTasks = JSON.stringify([{ id: "legacy-tutoring", title: "Book tutoring", done: false }]);

async function clearPersonalVault(page: Page): Promise<void> {
  await page.goto("/plan");
  await page.evaluate(async () => {
    window.localStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("uga.personal-vault");
      request.addEventListener("success", () => resolve(), { once: true });
      request.addEventListener(
        "error",
        () => reject(request.error ?? new Error("Could not delete vault database.")),
        { once: true },
      );
      request.addEventListener("blocked", () => reject(new Error("Database deletion is blocked.")), {
        once: true,
      });
    });
  });
  await page.reload();
}

async function createVault(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Create private vault" }).click();
  const recoveryCode = (await page.locator(".vault-recovery-code").textContent()) ?? "";
  expect(recoveryCode).toMatch(
    /^UGA1-(?:[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-){7}[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/u,
  );
  await page.getByRole("button", { name: "I saved this recovery code securely" }).click();
  await expect(page.getByRole("button", { name: "Lock vault" })).toBeVisible();
  return recoveryCode;
}

async function readTrustedDeviceState(page: Page): Promise<{
  readonly deviceId: string | null;
  readonly deviceKeyId: string | null;
  readonly envelopeMatches: number;
  readonly keyringRevision: number;
  readonly wrappingKeyIsNonExtractable: boolean;
}> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("uga.personal-vault");
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener(
        "error",
        () => reject(request.error ?? new Error("Could not open vault database.")),
        {
          once: true,
        },
      );
    });
    try {
      const transaction = database.transaction(["keyring", "trusted-device"], "readonly");
      const keyringRequest = transaction.objectStore("keyring").get("active-keyring");
      const trustedDeviceRequest = transaction.objectStore("trusted-device").get("active-device");
      const keyringResult = new Promise<{
        readonly revision: number;
        readonly deviceEnvelopes: readonly {
          readonly recipientDeviceId: string;
          readonly recipientKeyId: string;
          readonly recipientPublicKeyFingerprint: string;
        }[];
      }>((resolve, reject) => {
        keyringRequest.addEventListener(
          "success",
          () =>
            resolve(
              keyringRequest.result as {
                readonly revision: number;
                readonly deviceEnvelopes: readonly {
                  readonly recipientDeviceId: string;
                  readonly recipientKeyId: string;
                  readonly recipientPublicKeyFingerprint: string;
                }[];
              },
            ),
          { once: true },
        );
        keyringRequest.addEventListener(
          "error",
          () => reject(keyringRequest.error ?? new Error("Could not read keyring.")),
          {
            once: true,
          },
        );
      });
      const trustedDeviceResult = new Promise<
        | {
            readonly publicKey: {
              readonly deviceId: string;
              readonly deviceKeyId: string;
              readonly publicKeyFingerprint: string;
            };
            readonly wrappingKey: CryptoKey;
          }
        | undefined
      >((resolve, reject) => {
        trustedDeviceRequest.addEventListener(
          "success",
          () =>
            resolve(
              trustedDeviceRequest.result as
                | {
                    readonly publicKey: {
                      readonly deviceId: string;
                      readonly deviceKeyId: string;
                      readonly publicKeyFingerprint: string;
                    };
                    readonly wrappingKey: CryptoKey;
                  }
                | undefined,
            ),
          { once: true },
        );
        trustedDeviceRequest.addEventListener(
          "error",
          () => reject(trustedDeviceRequest.error ?? new Error("Could not read trusted device.")),
          {
            once: true,
          },
        );
      });
      const [keyring, trustedDevice] = await Promise.all([keyringResult, trustedDeviceResult]);
      await new Promise<void>((resolve, reject) => {
        transaction.addEventListener("complete", () => resolve(), { once: true });
        transaction.addEventListener(
          "abort",
          () => reject(transaction.error ?? new Error("Could not read vault state.")),
          {
            once: true,
          },
        );
      });
      const descriptor = trustedDevice?.publicKey;
      const envelopeMatches =
        descriptor === undefined
          ? 0
          : keyring.deviceEnvelopes.filter(
              (envelope) =>
                envelope.recipientDeviceId === descriptor.deviceId &&
                envelope.recipientKeyId === descriptor.deviceKeyId &&
                envelope.recipientPublicKeyFingerprint === descriptor.publicKeyFingerprint,
            ).length;
      return {
        deviceId: descriptor?.deviceId ?? null,
        deviceKeyId: descriptor?.deviceKeyId ?? null,
        envelopeMatches,
        keyringRevision: keyring.revision,
        wrappingKeyIsNonExtractable: trustedDevice?.wrappingKey.extractable === false,
      };
    } finally {
      database.close();
    }
  });
}

test("migrates valid legacy tasks only after one-time recovery acknowledgement and leaves no plaintext storage", async ({
  page,
}) => {
  await clearPersonalVault(page);
  await page.evaluate((value) => window.localStorage.setItem("uga.tasks", value), legacyTasks);
  await page.reload();

  await expect(page.getByRole("button", { name: "Create private vault" })).toBeVisible();
  await page.getByRole("button", { name: "Create private vault" }).click();
  const recoveryCode = (await page.locator(".vault-recovery-code").textContent()) ?? "";
  expect(recoveryCode).toMatch(
    /^UGA1-(?:[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-){7}[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/u,
  );
  await page.getByRole("button", { name: "I saved this recovery code securely" }).click();

  await expect(page.getByRole("checkbox", { name: "Book tutoring" })).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem("uga.tasks"))).toBeNull();
  const persisted = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("uga.personal-vault");
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener(
        "error",
        () => reject(request.error ?? new Error("Could not open vault database.")),
        { once: true },
      );
    });
    const stores = Array.from(database.objectStoreNames);
    const allValues = await Promise.all(
      stores.map(
        (storeName) =>
          new Promise<unknown[]>((resolve, reject) => {
            const transaction = database.transaction(storeName, "readonly");
            const request = transaction.objectStore(storeName).getAll();
            request.addEventListener("success", () => resolve(request.result), { once: true });
            request.addEventListener(
              "error",
              () => reject(request.error ?? new Error("Could not read vault records.")),
              { once: true },
            );
          }),
      ),
    );
    database.close();
    return JSON.stringify(allValues);
  });
  expect(persisted).not.toContain("Book tutoring");

  await page.reload();
  await expect(page.getByRole("button", { name: "Unlock private vault" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Book tutoring" })).toHaveCount(0);
  await page.getByRole("button", { name: "Unlock private vault" }).click();
  await expect(page.getByRole("checkbox", { name: "Book tutoring" })).toBeVisible();

  await page.getByRole("button", { name: "Lock vault" }).click();
  await expect(page.getByRole("button", { name: "Unlock private vault" })).toBeVisible();
  await expect(page.getByText("Book tutoring", { exact: true })).toHaveCount(0);
});

test("keeps malformed legacy values intact and offers explicit export/delete paths", async ({ page }) => {
  await clearPersonalVault(page);
  await page.evaluate(() => window.localStorage.setItem("uga.tasks", "{broken"));
  await page.reload();

  await expect(page.getByRole("button", { name: "Export legacy data" })).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem("uga.tasks"))).toBe("{broken");
  await page.getByRole("button", { name: "Delete legacy data" }).click();
  expect(await page.evaluate(() => window.localStorage.getItem("uga.tasks"))).toBeNull();
});

test("recovers without a trusted-device record and rejects every invalid recovery form uniformly", async ({
  page,
}) => {
  await clearPersonalVault(page);
  const recoveryCode = await createVault(page);
  await page.getByRole("textbox", { name: "New task" }).fill("Recovery check");
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("checkbox", { name: "Recovery check" })).toBeVisible();
  const originalDevice = await readTrustedDeviceState(page);

  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("uga.personal-vault");
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener("error", () => reject(request.error ?? new Error("Could not open vault.")), {
        once: true,
      });
    });
    const transaction = database.transaction("trusted-device", "readwrite");
    transaction.objectStore("trusted-device").delete("active-device");
    await new Promise<void>((resolve, reject) => {
      transaction.addEventListener("complete", () => resolve(), { once: true });
      transaction.addEventListener(
        "abort",
        () => reject(transaction.error ?? new Error("Could not remove trusted device.")),
        { once: true },
      );
    });
    database.close();
  });
  await page.reload();
  await page.getByRole("button", { name: "Unlock private vault" }).click();
  await expect(page.getByRole("button", { name: "Create private vault" })).toHaveCount(0);
  await page.locator("details.vault-recovery").evaluate((element) => element.setAttribute("open", ""));
  const recoveryInput = page.getByLabel("One-time recovery code");
  await recoveryInput.fill("not-a-recovery-code");
  await page.getByRole("button", { name: "Unlock with recovery code" }).click();
  await expect(
    page.getByText("The recovery code or encrypted vault could not be authenticated.", { exact: true }),
  ).toBeVisible();
  await expect(recoveryInput).toHaveValue("");
  await page.locator("details.vault-recovery").evaluate((element) => element.setAttribute("open", ""));
  await recoveryInput.fill(recoveryCode);
  await page.getByRole("button", { name: "Unlock with recovery code" }).click();
  await expect(page.getByRole("checkbox", { name: "Recovery check" })).toBeVisible();
  const rebuiltDevice = await readTrustedDeviceState(page);
  expect(rebuiltDevice.keyringRevision).toBe(originalDevice.keyringRevision + 1);
  expect(rebuiltDevice.deviceId).not.toBe(originalDevice.deviceId);
  expect(rebuiltDevice.deviceKeyId).not.toBe(originalDevice.deviceKeyId);
  expect(rebuiltDevice.envelopeMatches).toBe(1);
  expect(rebuiltDevice.wrappingKeyIsNonExtractable).toBe(true);
  await page.getByRole("textbox", { name: "New task" }).fill("Recovered write");
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("checkbox", { name: "Recovered write" })).toBeVisible();

  // Recovery atomically rebuilds a normal local trusted-device path. A fresh
  // page session must explicitly unlock without asking for the recovery code.
  await page.getByRole("button", { name: "Lock vault" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Unlock private vault" })).toBeVisible();
  await page.getByRole("button", { name: "Unlock private vault" }).click();
  await expect(page.getByRole("checkbox", { name: "Recovery check" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Recovered write" })).toBeVisible();
});

test("background lock clears rendered tasks and keeps the Worker launch CSP-compatible", async ({ page }) => {
  await clearPersonalVault(page);
  await createVault(page);
  const workerResponse = await page.request.get("/__uga-vault/personal-vault.worker.mjs");
  expect(workerResponse.ok()).toBe(true);
  expect(workerResponse.headers()["content-type"]).toContain("application/javascript");

  await page.getByRole("textbox", { name: "New task" }).fill("Background lock");
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("checkbox", { name: "Background lock" })).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  // Chromium keeps visibilityState visible in test pages, so install a
  // controlled descriptor before dispatching the real lifecycle event.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByRole("button", { name: "Unlock private vault" })).toBeVisible();
  await expect(page.getByText("Background lock", { exact: true })).toHaveCount(0);
});

test("pagehide terminates the vault Worker and clears rendered task plaintext", async ({ page }) => {
  await page.addInitScript(() => {
    const probe = window as Window & { __ugaVaultWorkerTerminateCount?: number };
    const originalTerminate = Reflect.get(Worker.prototype, "terminate") as (this: Worker) => void;
    probe.__ugaVaultWorkerTerminateCount = 0;
    Worker.prototype.terminate = function (this: Worker): void {
      probe.__ugaVaultWorkerTerminateCount = (probe.__ugaVaultWorkerTerminateCount ?? 0) + 1;
      originalTerminate.call(this);
    };
  });
  await clearPersonalVault(page);
  await createVault(page);
  await page.getByRole("textbox", { name: "New task" }).fill("Pagehide lock");
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("checkbox", { name: "Pagehide lock" })).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));

  await expect(page.getByRole("button", { name: "Unlock private vault" })).toBeVisible();
  await expect(page.getByText("Pagehide lock", { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __ugaVaultWorkerTerminateCount?: number }).__ugaVaultWorkerTerminateCount ?? 0,
    ),
  ).toBeGreaterThan(0);
});

test("locks exactly after fifteen minutes without page activity", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00.000Z") });
  await clearPersonalVault(page);
  await createVault(page);
  await page.getByRole("textbox", { name: "New task" }).fill("Idle lock");
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("checkbox", { name: "Idle lock" })).toBeVisible();

  await page.clock.fastForward(15 * 60 * 1_000);

  await expect(page.getByRole("button", { name: "Unlock private vault" })).toBeVisible();
  await expect(page.getByText("Idle lock", { exact: true })).toHaveCount(0);
});

test("keeps retained legacy data when retry would overwrite newer encrypted tasks", async ({ page }) => {
  await clearPersonalVault(page);
  await createVault(page);
  await page.getByRole("textbox", { name: "New task" }).fill("Newer vault task");
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("checkbox", { name: "Newer vault task" })).toBeVisible();

  await page.evaluate((value) => window.localStorage.setItem("uga.tasks", value), legacyTasks);
  await page.reload();
  await page.getByRole("button", { name: "Unlock private vault" }).click();
  await expect(page.getByRole("button", { name: "Retry legacy import" })).toBeVisible();
  await page.getByRole("button", { name: "Retry legacy import" }).click();

  await expect(page.getByRole("button", { name: "Unlock private vault" })).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem("uga.tasks"))).toBe(legacyTasks);
  await page.getByRole("button", { name: "Unlock private vault" }).click();
  await expect(page.getByRole("checkbox", { name: "Newer vault task" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Book tutoring" })).toHaveCount(0);
});

test("shows an unavailable read-only state and preserves legacy data without Worker support", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "Worker", { configurable: true, value: undefined });
  });
  await clearPersonalVault(page);
  await page.evaluate((value) => window.localStorage.setItem("uga.tasks", value), legacyTasks);
  await page.reload();

  await expect(
    page.getByText(
      "This browser cannot safely run the private vault. Legacy task data is unchanged and there is no plaintext fallback.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Export legacy data" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete legacy data" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create private vault" })).toHaveCount(0);
  expect(await page.evaluate(() => window.localStorage.getItem("uga.tasks"))).toBe(legacyTasks);
});

test("continues local encrypted writes while offline", async ({ context, page }) => {
  await clearPersonalVault(page);
  await createVault(page);
  await context.setOffline(true);
  try {
    await page.getByRole("textbox", { name: "New task" }).fill("Offline task");
    await page.getByRole("button", { name: "Add task" }).click();
    await expect(page.getByRole("checkbox", { name: "Offline task" })).toBeVisible();
    await page.getByRole("checkbox", { name: "Offline task" }).click();
    await expect(page.getByRole("checkbox", { name: "Offline task" })).toBeChecked();
  } finally {
    await context.setOffline(false);
  }
});
