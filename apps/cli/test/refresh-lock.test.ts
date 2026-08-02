import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";

import { describe, expect, it } from "vitest";

import { credentialLockPortForTesting, SocketCredentialRefreshLock } from "../src/refresh-lock.js";

const profile = "local";
const issuer = "https://identity.example/realms/gopher";

describe("cross-process credential refresh coordination", () => {
  it("allows only one of three independent contenders into the critical section", async () => {
    const namespace = `three-contenders:${randomUUID()}`;
    const locks = Array.from({ length: 3 }, () => new SocketCredentialRefreshLock(namespace));
    let active = 0;
    let maximumActive = 0;
    const order: number[] = [];

    await Promise.all(
      locks.map((lock, index) =>
        lock.withLock(profile, issuer, undefined, async () => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          order.push(index);
          await new Promise<void>((resolve) => setTimeout(resolve, 30));
          active -= 1;
        }),
      ),
    );

    expect(maximumActive).toBe(1);
    expect(new Set(order)).toEqual(new Set([0, 1, 2]));
  });

  it("recovers automatically after a separate owner process is killed", async () => {
    const namespace = `crash-recovery:${randomUUID()}`;
    const port = credentialLockPortForTesting(namespace, profile, issuer);
    const child = spawn(
      process.execPath,
      [
        "-e",
        "const net=require('node:net');const s=net.createServer(x=>x.destroy());s.listen({host:'127.0.0.1',port:Number(process.argv[1]),exclusive:true},()=>process.stdout.write('ready\\n'));setInterval(()=>{},1000);",
        String(port),
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    await once(child.stdout, "data");
    let entered = false;
    const waiting = new SocketCredentialRefreshLock(namespace).withLock(profile, issuer, undefined, () => {
      entered = true;
      return Promise.resolve();
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    expect(entered).toBe(false);

    child.kill();
    await once(child, "exit");
    await expect(waiting).resolves.toBeUndefined();
    expect(entered).toBe(true);
  });
});
