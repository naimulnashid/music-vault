import { afterEach, describe, expect, it } from "vitest";
import type { SyncOpPayload } from "@musicvault/core";
import { setSyncEnqueue, syncEnqueueFor } from "./syncBus";

const op = { kind: "playEvent.add", eventId: "e1" } as unknown as SyncOpPayload;

afterEach(() => setSyncEnqueue(null));

describe("syncEnqueueFor", () => {
  it("holds an op until that account's engine starts, then sends it once", () => {
    syncEnqueueFor("user-a", op);
    const sent: SyncOpPayload[] = [];
    setSyncEnqueue((p) => sent.push(p), "user-a");
    expect(sent).toEqual([op]);
    setSyncEnqueue(null);
    setSyncEnqueue((p) => sent.push(p), "user-a");
    expect(sent).toHaveLength(1);
  });

  it("drops a waiting op when a different account signs in", () => {
    syncEnqueueFor("user-a", op);
    const sent: SyncOpPayload[] = [];
    setSyncEnqueue((p) => sent.push(p), "user-b");
    expect(sent).toEqual([]);
  });

  it("sends straight away when the account's engine is already running", () => {
    const sent: SyncOpPayload[] = [];
    setSyncEnqueue((p) => sent.push(p), "user-a");
    syncEnqueueFor("user-a", op);
    syncEnqueueFor("user-b", op);
    expect(sent).toEqual([op]);
  });
});
