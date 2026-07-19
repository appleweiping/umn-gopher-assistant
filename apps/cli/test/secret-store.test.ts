import { describe, expect, it } from "vitest";

import { NapiKeyringSecretStore } from "../src/secret-store.js";

function keyringWithDelete(result: boolean | Error): unknown {
  return {
    Entry: class {
      deletePassword(): boolean {
        if (result instanceof Error) throw result;
        return result;
      }

      getPassword(): null {
        return null;
      }

      setPassword(): void {
        return undefined;
      }
    },
  };
}

describe("native secret deletion", () => {
  it("reports a deleted entry", async () => {
    const store = new NapiKeyringSecretStore(() => keyringWithDelete(true));
    await expect(store.delete("profile:local")).resolves.toEqual({ status: "deleted" });
  });

  it("reports an absent entry", async () => {
    const store = new NapiKeyringSecretStore(() => keyringWithDelete(false));
    await expect(store.delete("profile:local")).resolves.toEqual({ status: "absent" });
  });

  it("reports native and module failures without leaking native details", async () => {
    const nativeStore = new NapiKeyringSecretStore(() =>
      keyringWithDelete(new Error("native account detail must stay hidden")),
    );
    const missingModuleStore = new NapiKeyringSecretStore(() => {
      throw new Error("module loader detail must stay hidden");
    });

    await expect(nativeStore.delete("profile:local")).resolves.toEqual({ status: "backend-error" });
    await expect(missingModuleStore.delete("profile:local")).resolves.toEqual({
      status: "backend-error",
    });
  });
});
