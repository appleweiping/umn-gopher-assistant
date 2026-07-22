import { expect, test, type Page } from "@playwright/test";

const legacyTasks = JSON.stringify([{ id: "legacy-tutoring", title: "Book tutoring", done: false }]);
const VAULT_CRYPTO_OPERATION_TIMEOUT_MS = 30_000;

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

async function waitForActiveServiceWorker(page: Page): Promise<void> {
  await page.evaluate(async (timeoutMs) => {
    let timeout: number | undefined;
    try {
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<never>((_resolve, reject) => {
          timeout = window.setTimeout(() => reject(new Error("Service Worker ready timed out.")), timeoutMs);
        }),
      ]);
      if (registration.active === null) throw new Error("Service Worker ready has no active worker.");
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout);
    }
  }, VAULT_CRYPTO_OPERATION_TIMEOUT_MS);
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          return registration?.active?.state ?? null;
        }),
      {
        message: "the same-origin Service Worker should finish activation before vault cryptography starts",
        timeout: VAULT_CRYPTO_OPERATION_TIMEOUT_MS,
      },
    )
    .toBe("activated");
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
      timeout: VAULT_CRYPTO_OPERATION_TIMEOUT_MS,
    })
    .toBe(true);
}

async function setManagedApplicationOnline(online: boolean): Promise<void> {
  const controlToken = process.env["PLAYWRIGHT_WEB_SERVER_CONTROL_TOKEN"];
  const controlPort = process.env["PLAYWRIGHT_WEB_SERVER_CONTROL_PORT"];
  if (controlToken === undefined || controlPort === undefined) {
    throw new Error(
      "Managed offline testing requires the bundled Playwright server; unset PLAYWRIGHT_BASE_URL and set PLAYWRIGHT_MANAGED_OFFLINE=1.",
    );
  }
  const response = await fetch(`http://127.0.0.1:${controlPort}/${online ? "online" : "offline"}`, {
    headers: { authorization: `Bearer ${controlToken}` },
    method: "POST",
    signal: AbortSignal.timeout(65_000),
  });
  if (!response.ok) throw new Error(`Playwright server control failed with HTTP ${response.status}.`);
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

test.beforeEach(async () => {
  // A crashed managed-offline attempt may leave the shared origin stopped.
  // Restore it through the launcher control plane before any page navigation,
  // including Playwright retries and the first test in the next project.
  if (process.env["PLAYWRIGHT_MANAGED_OFFLINE"] === "1") {
    await setManagedApplicationOnline(true);
  }
});

async function readTrustedDeviceState(page: Page): Promise<{
  readonly deviceId: string | null;
  readonly deviceKeyId: string | null;
  readonly envelopeCount: number;
  readonly envelopeMatches: number;
  readonly keyringRevision: number;
  readonly payloadRevision: number;
  readonly payloadVaultKeyId: string;
  readonly vaultKeyId: string;
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
      const transaction = database.transaction(["keyring", "payload", "trusted-device"], "readonly");
      const keyringRequest = transaction.objectStore("keyring").get("active-keyring");
      const payloadRequest = transaction.objectStore("payload").get("active-payload");
      const trustedDeviceRequest = transaction.objectStore("trusted-device").get("active-device");
      const keyringResult = new Promise<{
        readonly revision: number;
        readonly vaultKeyId: string;
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
                readonly vaultKeyId: string;
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
      const payloadResult = new Promise<{ readonly revision: number; readonly vaultKeyId: string }>(
        (resolve, reject) => {
          payloadRequest.addEventListener(
            "success",
            () =>
              resolve(
                payloadRequest.result as {
                  readonly revision: number;
                  readonly vaultKeyId: string;
                },
              ),
            { once: true },
          );
          payloadRequest.addEventListener(
            "error",
            () => reject(payloadRequest.error ?? new Error("Could not read payload.")),
            { once: true },
          );
        },
      );
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
      const [keyring, payload, trustedDevice] = await Promise.all([
        keyringResult,
        payloadResult,
        trustedDeviceResult,
      ]);
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
        envelopeCount: keyring.deviceEnvelopes.length,
        envelopeMatches,
        keyringRevision: keyring.revision,
        payloadRevision: payload.revision,
        payloadVaultKeyId: payload.vaultKeyId,
        vaultKeyId: keyring.vaultKeyId,
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

test("keeps malformed legacy values intact and requires confirmation before deletion", async ({ page }) => {
  await clearPersonalVault(page);
  await page.evaluate(() => window.localStorage.setItem("uga.tasks", "{broken"));
  await page.reload();

  await expect(page.getByRole("button", { name: "Export legacy data" })).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem("uga.tasks"))).toBe("{broken");
  const deleteTrigger = page.getByRole("button", { name: "Delete legacy data" });
  await deleteTrigger.click();
  await expect(page.getByRole("dialog", { name: "Delete legacy task data?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  expect(await page.evaluate(() => window.localStorage.getItem("uga.tasks"))).toBe("{broken");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(deleteTrigger).toBeFocused();
  expect(await page.evaluate(() => window.localStorage.getItem("uga.tasks"))).toBe("{broken");

  await deleteTrigger.click();
  await page.getByRole("button", { name: "Permanently delete legacy data" }).click();
  expect(await page.evaluate(() => window.localStorage.getItem("uga.tasks"))).toBeNull();
});

test("recovers without a trusted-device record and rejects every invalid recovery form uniformly", async ({
  page,
}) => {
  test.setTimeout(150_000);
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
  const recoveryInput = page.getByLabel("Recovery code", { exact: true });
  await recoveryInput.fill("not-a-recovery-code");
  await page.getByRole("button", { name: "Unlock with recovery code" }).click();
  await expect(
    page.getByText("The recovery code or encrypted vault could not be authenticated.", { exact: true }),
  ).toBeVisible({ timeout: VAULT_CRYPTO_OPERATION_TIMEOUT_MS });
  await expect(recoveryInput).toHaveValue("");
  await page.locator("details.vault-recovery").evaluate((element) => element.setAttribute("open", ""));
  await recoveryInput.fill(recoveryCode);
  await page.getByRole("button", { name: "Unlock with recovery code" }).click();
  await expect(page.getByRole("checkbox", { name: "Recovery check" })).toBeVisible({
    timeout: VAULT_CRYPTO_OPERATION_TIMEOUT_MS,
  });
  const rebuiltDevice = await readTrustedDeviceState(page);
  expect(rebuiltDevice.keyringRevision).toBe(originalDevice.keyringRevision + 1);
  expect(rebuiltDevice.payloadRevision).toBe(originalDevice.payloadRevision + 1);
  expect(rebuiltDevice.vaultKeyId).not.toBe(originalDevice.vaultKeyId);
  expect(rebuiltDevice.payloadVaultKeyId).toBe(rebuiltDevice.vaultKeyId);
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
  await expect(page.getByRole("checkbox", { name: "Recovery check" })).toBeVisible({
    timeout: VAULT_CRYPTO_OPERATION_TIMEOUT_MS,
  });
  await expect(page.getByRole("checkbox", { name: "Recovered write" })).toBeVisible();
});

test("requires explicit oldest-device revocation at the device-envelope capacity boundary", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await clearPersonalVault(page);
  const recoveryCode = await createVault(page);
  await page.getByRole("textbox", { name: "New task" }).fill("Capacity recovery");
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("checkbox", { name: "Capacity recovery" })).toBeVisible();

  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("uga.personal-vault");
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener("error", () => reject(request.error ?? new Error("Could not open vault.")), {
        once: true,
      });
    });
    try {
      const transaction = database.transaction(["keyring", "trusted-device"], "readwrite");
      const keyringStore = transaction.objectStore("keyring");
      const keyring = await new Promise<{
        devicePublicKeys: {
          deviceId: string;
          deviceKeyId: string;
          [key: string]: unknown;
        }[];
        deviceEnvelopes: {
          recipientDeviceId: string;
          recipientKeyId: string;
          [key: string]: unknown;
        }[];
        [key: string]: unknown;
      }>((resolve, reject) => {
        const request = keyringStore.get("active-keyring");
        request.addEventListener(
          "success",
          () =>
            resolve(
              request.result as {
                devicePublicKeys: {
                  deviceId: string;
                  deviceKeyId: string;
                  [key: string]: unknown;
                }[];
                deviceEnvelopes: {
                  recipientDeviceId: string;
                  recipientKeyId: string;
                  [key: string]: unknown;
                }[];
                [key: string]: unknown;
              },
            ),
          { once: true },
        );
        request.addEventListener(
          "error",
          () => reject(request.error ?? new Error("Could not read keyring.")),
          {
            once: true,
          },
        );
      });
      const source = keyring.deviceEnvelopes[0];
      const sourcePublicKey = keyring.devicePublicKeys[0];
      if (source === undefined || sourcePublicKey === undefined) {
        throw new Error("Expected an initial device recipient.");
      }
      const identities = Array.from({ length: 32 }, () => ({
        deviceId: crypto.randomUUID(),
        deviceKeyId: crypto.randomUUID(),
      }));
      keyring.deviceEnvelopes = identities.map(({ deviceId, deviceKeyId }) => ({
        ...source,
        recipientDeviceId: deviceId,
        recipientKeyId: deviceKeyId,
      }));
      keyring.devicePublicKeys = identities.map(({ deviceId, deviceKeyId }) => ({
        ...sourcePublicKey,
        deviceId,
        deviceKeyId,
      }));
      keyringStore.put(keyring, "active-keyring");
      transaction.objectStore("trusted-device").delete("active-device");
      await new Promise<void>((resolve, reject) => {
        transaction.addEventListener("complete", () => resolve(), { once: true });
        transaction.addEventListener(
          "abort",
          () => reject(transaction.error ?? new Error("Could not prepare capacity boundary.")),
          { once: true },
        );
      });
    } finally {
      database.close();
    }
  });

  await page.reload();
  await page.getByRole("button", { name: "Unlock private vault" }).click();
  await page.locator("details.vault-recovery").evaluate((element) => element.setAttribute("open", ""));
  const recoveryInput = page.getByLabel("Recovery code", { exact: true });
  await recoveryInput.fill(recoveryCode);
  await page.getByRole("button", { name: "Unlock with recovery code" }).click();

  await expect(
    page.getByText("The recovery code is valid, but all trusted-device slots are full.", { exact: false }),
  ).toBeVisible({ timeout: VAULT_CRYPTO_OPERATION_TIMEOUT_MS });
  await expect(recoveryInput).not.toHaveAttribute("aria-invalid", "true");
  const consent = page.getByRole("checkbox", {
    name: "Revoke the oldest trusted-device access to free a slot",
  });
  await expect(consent).not.toBeChecked();

  await recoveryInput.fill(recoveryCode);
  await consent.check();
  await page.getByRole("button", { name: "Unlock with recovery code" }).click();
  await expect(page.getByRole("checkbox", { name: "Capacity recovery" })).toBeVisible({
    timeout: VAULT_CRYPTO_OPERATION_TIMEOUT_MS,
  });
  const recovered = await readTrustedDeviceState(page);
  expect(recovered.envelopeCount).toBe(32);
  expect(recovered.envelopeMatches).toBe(1);
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
  await expect(page.getByTestId("vault-live-region")).toContainText("locked because the page was hidden");
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeFocused();
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
  await expect(page.getByTestId("vault-live-region")).toContainText(
    "locked after fifteen minutes without activity",
  );
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeFocused();
});

test("moves focus and announces setup, unlock, and manual lock transitions", async ({ page }) => {
  await clearPersonalVault(page);
  await page.getByRole("button", { name: "Create private vault" }).click();

  const recoveryHeading = page.getByRole("heading", { name: "Recovery code (shown once)" });
  await expect(recoveryHeading).toBeFocused();
  await expect(page.getByTestId("vault-live-region")).toContainText("recovery code is ready");

  await page.getByRole("button", { name: "I saved this recovery code securely" }).click();
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeFocused();
  await expect(page.getByTestId("vault-live-region")).toContainText("vault is unlocked");

  await page.getByRole("button", { name: "Lock vault" }).click();
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeFocused();
  await expect(page.getByTestId("vault-live-region")).toContainText("vault is locked");
});

test("clears the one-time recovery display and terminates its Worker after two minutes", async ({ page }) => {
  await page.addInitScript(() => {
    const probe = window as Window & { __ugaVaultWorkerTerminateCount?: number };
    const originalTerminate = Reflect.get(Worker.prototype, "terminate") as (this: Worker) => void;
    probe.__ugaVaultWorkerTerminateCount = 0;
    Worker.prototype.terminate = function (this: Worker): void {
      probe.__ugaVaultWorkerTerminateCount = (probe.__ugaVaultWorkerTerminateCount ?? 0) + 1;
      originalTerminate.call(this);
    };
  });
  await page.clock.install({ time: new Date("2026-01-01T00:00:00.000Z") });
  await clearPersonalVault(page);
  await page.getByRole("button", { name: "Create private vault" }).click();
  await expect(page.locator(".vault-recovery-code")).toContainText("UGA1-");
  const terminationsBeforeExpiry = await page.evaluate(
    () =>
      (window as Window & { __ugaVaultWorkerTerminateCount?: number }).__ugaVaultWorkerTerminateCount ?? 0,
  );

  await page.clock.fastForward(2 * 60 * 1_000);

  await expect(page.locator(".vault-recovery-code")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create private vault" })).toBeVisible();
  await expect(page.getByTestId("vault-live-region")).toContainText(
    "recovery-code display expired and was cleared",
  );
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeFocused();
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __ugaVaultWorkerTerminateCount?: number }).__ugaVaultWorkerTerminateCount ?? 0,
    ),
  ).toBeGreaterThan(terminationsBeforeExpiry);
});

test("clears recovery-code input and terminates its Worker on an independent timeout", async ({ page }) => {
  await page.addInitScript(() => {
    const probe = window as Window & { __ugaVaultWorkerTerminateCount?: number };
    const originalTerminate = Reflect.get(Worker.prototype, "terminate") as (this: Worker) => void;
    probe.__ugaVaultWorkerTerminateCount = 0;
    Worker.prototype.terminate = function (this: Worker): void {
      probe.__ugaVaultWorkerTerminateCount = (probe.__ugaVaultWorkerTerminateCount ?? 0) + 1;
      originalTerminate.call(this);
    };
  });
  await page.clock.install({ time: new Date("2026-01-01T00:00:00.000Z") });
  await clearPersonalVault(page);
  const recoveryCode = await createVault(page);
  await page.getByRole("button", { name: "Lock vault" }).click();
  // Reload the locked shell so its inspection Worker is live. The timeout
  // must clear the DOM/React input and terminate that otherwise-idle Worker;
  // a manual lock alone already destroys the prior unlocked session.
  await page.reload();
  await expect(page.getByRole("button", { name: "Unlock private vault" })).toBeVisible();
  await page.locator("details.vault-recovery").evaluate((element) => element.setAttribute("open", ""));
  const recoveryInput = page.getByLabel("Recovery code", { exact: true });
  await recoveryInput.fill(recoveryCode);
  const terminationsBeforeExpiry = await page.evaluate(
    () =>
      (window as Window & { __ugaVaultWorkerTerminateCount?: number }).__ugaVaultWorkerTerminateCount ?? 0,
  );

  await page.clock.fastForward(2 * 60 * 1_000);

  await expect(recoveryInput).toHaveValue("");
  await expect(page.getByTestId("vault-live-region")).toContainText(
    "recovery-code input expired and was cleared",
  );
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeFocused();
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __ugaVaultWorkerTerminateCount?: number }).__ugaVaultWorkerTerminateCount ?? 0,
    ),
  ).toBeGreaterThan(terminationsBeforeExpiry);
});

test("keeps retained legacy data when retry would overwrite newer encrypted tasks", async ({ page }) => {
  await clearPersonalVault(page);
  await createVault(page);
  await page.getByRole("textbox", { name: "New task" }).fill("Newer vault task");
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("checkbox", { name: "Newer vault task" })).toBeVisible({
    timeout: VAULT_CRYPTO_OPERATION_TIMEOUT_MS,
  });

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

test("fails closed and preserves legacy data when the browser disables site storage", async ({ page }) => {
  await clearPersonalVault(page);
  await page.evaluate((value) => window.localStorage.setItem("uga.tasks", value), legacyTasks);
  await page.addInitScript(() => {
    const backingStorage = window.localStorage;
    Object.defineProperty(window, "__ugaLegacyStorageProbe", {
      configurable: true,
      value: backingStorage,
    });
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Site storage disabled", "SecurityError");
      },
    });
  });
  await page.reload();

  await expect(
    page.getByText(
      "Browser site storage is disabled, so the private vault cannot run safely. The app did not read, change, or delete legacy task data.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Create private vault" })).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (
          window as Window & {
            readonly __ugaLegacyStorageProbe?: Storage;
          }
        ).__ugaLegacyStorageProbe?.getItem("uga.tasks") ?? null,
    ),
  ).toBe(legacyTasks);
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

test("reapplies concurrent two-page mutations without dropping adds or double-toggling", async ({
  context,
  page,
}) => {
  await clearPersonalVault(page);
  await createVault(page);
  const secondPage = await context.newPage();
  const firstTask = `Concurrent first ${Date.now()}`;
  const secondTask = `Concurrent second ${Date.now()}`;

  try {
    await secondPage.goto("/plan");
    await expect(secondPage.getByRole("button", { name: "Unlock private vault" })).toBeVisible();
    await secondPage.getByRole("button", { name: "Unlock private vault" }).click();
    await expect(secondPage.getByRole("button", { name: "Lock vault" })).toBeVisible();

    await page.getByRole("textbox", { name: "New task" }).fill(firstTask);
    await secondPage.getByRole("textbox", { name: "New task" }).fill(secondTask);
    await Promise.all([
      page.getByRole("button", { name: "Add task" }).click(),
      secondPage.getByRole("button", { name: "Add task" }).click(),
    ]);

    // A first CAS miss is an expected concurrency event, not a fatal write
    // failure. Both local sessions must remain unlocked after their retry.
    await expect(page.getByRole("button", { name: "Lock vault" })).toBeVisible();
    await expect(secondPage.getByRole("button", { name: "Lock vault" })).toBeVisible();
    await expect(page.getByText("The change could not be encrypted and saved", { exact: false })).toHaveCount(
      0,
    );
    await expect(
      secondPage.getByText("The change could not be encrypted and saved", { exact: false }),
    ).toHaveCount(0);

    await Promise.all([
      page.getByRole("button", { name: "Lock vault" }).click(),
      secondPage.getByRole("button", { name: "Lock vault" }).click(),
    ]);
    await Promise.all([
      page.getByRole("button", { name: "Unlock private vault" }).click(),
      secondPage.getByRole("button", { name: "Unlock private vault" }).click(),
    ]);

    for (const currentPage of [page, secondPage]) {
      await expect(currentPage.getByRole("checkbox", { name: firstTask })).toBeVisible();
      await expect(currentPage.getByRole("checkbox", { name: secondTask })).toBeVisible();
      await expect(currentPage.getByRole("checkbox", { name: firstTask })).not.toBeChecked();
    }

    // Both tabs observed `false`, so both operations mean "set true". A retry
    // must preserve that target instead of toggling the newer value back.
    await Promise.all([
      page.getByRole("checkbox", { name: firstTask }).click(),
      secondPage.getByRole("checkbox", { name: firstTask }).click(),
    ]);
    await expect(page.getByRole("button", { name: "Lock vault" })).toBeVisible();
    await expect(secondPage.getByRole("button", { name: "Lock vault" })).toBeVisible();
    await Promise.all([
      page.getByRole("button", { name: "Lock vault" }).click(),
      secondPage.getByRole("button", { name: "Lock vault" }).click(),
    ]);
    await Promise.all([
      page.getByRole("button", { name: "Unlock private vault" }).click(),
      secondPage.getByRole("button", { name: "Unlock private vault" }).click(),
    ]);
    for (const currentPage of [page, secondPage]) {
      await expect(currentPage.getByRole("checkbox", { name: firstTask })).toBeChecked();
      await expect(currentPage.getByRole("checkbox", { name: secondTask })).toBeVisible();
    }
  } finally {
    await secondPage.close();
  }
});

test("reloads the anonymous Plan shell and unlocks the content-addressed Worker offline", async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    process.env["PLAYWRIGHT_MANAGED_OFFLINE"] !== "1",
    "This test intentionally stops the shared origin and runs only in the serial managed-offline gate.",
  );
  testInfo.setTimeout(180_000);
  const configuredBaseUrl = testInfo.project.use.baseURL;
  if (typeof configuredBaseUrl !== "string") throw new Error("The offline Vault test needs a baseURL.");
  try {
    // Install from a public route before Plan starts its dedicated crypto
    // Worker. WebKit can starve Service Worker installation when both Worker
    // graphs and IndexedDB initialization begin on the same first navigation.
    await page.goto("/today");
    await waitForActiveServiceWorker(page);
    await context.addCookies([
      { name: "campus", value: "duluth", url: configuredBaseUrl },
      { name: "theme", value: "dark", url: configuredBaseUrl },
    ]);
    await clearPersonalVault(page);
    // WebKit can starve a concurrent Service Worker install while Argon2 and
    // Worker crypto saturate the page. Offline behavior has an active Worker
    // as a real precondition, so establish it before generating vault data.
    await waitForActiveServiceWorker(page);
    const recoveryCode = await createVault(page);
    const privateTask = `Offline reload private ${Date.now()}`;
    await page.getByRole("textbox", { name: "New task" }).fill(privateTask);
    await page.getByRole("button", { name: "Add task" }).click();
    await expect(page.getByRole("checkbox", { name: privateTask })).toBeVisible();

    const ciphertexts = await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("uga.personal-vault");
        request.addEventListener("success", () => resolve(request.result), { once: true });
        request.addEventListener(
          "error",
          () => reject(request.error ?? new Error("Could not open vault database.")),
          { once: true },
        );
      });
      try {
        const values = await Promise.all(
          ["payload", "keyring", "trusted-device"].map(
            (storeName) =>
              new Promise<unknown[]>((resolve, reject) => {
                const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
                request.addEventListener("success", () => resolve(request.result), { once: true });
                request.addEventListener(
                  "error",
                  () => reject(request.error ?? new Error(`Could not read ${storeName}.`)),
                  { once: true },
                );
              }),
          ),
        );
        const found: string[] = [];
        const visit = (value: unknown): void => {
          if (Array.isArray(value)) {
            value.forEach(visit);
            return;
          }
          if (typeof value !== "object" || value === null) return;
          for (const [key, nested] of Object.entries(value)) {
            if (key === "ciphertext" && typeof nested === "string") found.push(nested);
            else visit(nested);
          }
        };
        values.forEach(visit);
        return found;
      } finally {
        database.close();
      }
    });
    expect(ciphertexts.length).toBeGreaterThan(0);

    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const cacheNames = await caches.keys();
            const urls = (
              await Promise.all(
                cacheNames.map(async (cacheName) => {
                  const cache = await caches.open(cacheName);
                  return (await cache.keys()).map((request) => new URL(request.url).pathname);
                }),
              )
            ).flat();
            return {
              hasHashedWorker: urls.some((pathname) =>
                /^\/__uga-vault\/personal-vault\.worker\.[a-f0-9]{64}\.mjs$/u.test(pathname),
              ),
              hasPlanShell: urls.includes("/__campus-field-guide-vault-plan-shell-en"),
              hasWorkerBootstrap: urls.includes("/__uga-vault/personal-vault.worker.mjs"),
            };
          }),
        { timeout: VAULT_CRYPTO_OPERATION_TIMEOUT_MS },
      )
      .toEqual({ hasHashedWorker: true, hasPlanShell: true, hasWorkerBootstrap: true });

    await setManagedApplicationOnline(false);
    await expect(
      fetch(`${configuredBaseUrl}/__offline-origin-probe`, {
        signal: AbortSignal.timeout(1_000),
      }),
    ).rejects.toThrow();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/plan$/u);
    await expect(page.getByRole("button", { name: "Unlock private vault" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Campus" })).toHaveValue("duluth");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "Unlock private vault" }).click();
    await expect(page.getByRole("checkbox", { name: privateTask })).toBeVisible();

    const cacheAudit = await page.evaluate(
      async ({ ciphertexts: encryptedValues, privateTask: task, recoveryCode: recovery }) => {
        const forbidden = [task, recovery, ...encryptedValues];
        const leaks: { readonly cacheName: string; readonly kind: string; readonly url: string }[] = [];
        const cacheNames = await caches.keys();
        const urls: string[] = [];
        for (const cacheName of cacheNames) {
          const cache = await caches.open(cacheName);
          for (const request of await cache.keys()) {
            const url = new URL(request.url);
            urls.push(url.href);
            const response = await cache.match(request);
            if (response === undefined) continue;
            const body = await response.clone().text();
            forbidden.forEach((secret, index) => {
              if (secret.length > 0 && body.includes(secret)) {
                leaks.push({
                  cacheName,
                  kind: index === 0 ? "task" : index === 1 ? "recovery" : "ciphertext",
                  url: url.href,
                });
              }
            });
          }
        }
        return {
          leaks,
          livePlanResponses: urls.filter((value) => new URL(value).pathname === "/plan"),
          reservedVaultUrls: urls.filter((value) => new URL(value).pathname.startsWith("/__uga-vault/")),
        };
      },
      { ciphertexts, privateTask, recoveryCode },
    );
    expect(cacheAudit.leaks).toEqual([]);
    expect(cacheAudit.livePlanResponses).toEqual([]);
    expect(cacheAudit.reservedVaultUrls).toHaveLength(2);
    expect(cacheAudit.reservedVaultUrls).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\/__uga-vault\/personal-vault\.worker\.mjs$/u),
        expect.stringMatching(/\/__uga-vault\/personal-vault\.worker\.[a-f0-9]{64}\.mjs$/u),
      ]),
    );
  } finally {
    await setManagedApplicationOnline(true);
  }
});
