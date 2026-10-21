import { describe, expect, it } from "vitest";
import { SupabaseTransport } from "../src/sync";
import type { MusicVaultClient } from "../src/supabase/client";

// ---- fake PostgREST ---------------------------------------------------------
// Just enough of the query builder for the transport's reads: eq/gt filters,
// multi-column ordering and range(), with every response cut to `cap` rows the
// way PostgREST's max-rows setting does.

type Row = Record<string, string | null>;

function fakeClient(tables: Record<string, Row[]>, cap: number) {
  const requests: { table: string; from: number; to: number }[] = [];
  const client = {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      const orders: string[] = [];
      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => (filters.push((r) => r[column] === value), builder),
        gt: (column: string, value: string) => (filters.push((r) => (r[column] ?? "") > value), builder),
        order: (column: string) => (orders.push(column), builder),
        range(from: number, to: number) {
          requests.push({ table, from, to });
          const rows = (tables[table] ?? [])
            .filter((r) => filters.every((f) => f(r)))
            .sort((a, b) => {
              for (const c of orders) {
                const x = a[c] ?? "";
                const y = b[c] ?? "";
                if (x !== y) return x < y ? -1 : 1;
              }
              return 0;
            });
          const page = rows.slice(from, Math.min(to + 1, from + cap));
          return Promise.resolve({ data: page, error: null });
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as MusicVaultClient, requests };
}

const pad = (n: number) => String(n).padStart(5, "0");

function items(playlistId: string, count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `item-${playlistId}-${pad(i)}`,
    playlist_id: playlistId,
    track_id: `track-${pad(i)}`,
    position: `a${pad(i)}`,
    added_at: `2026-01-01T00:00:00.${String(i % 1000).padStart(3, "0")}Z`,
    updated_at: `2026-01-02T00:00:${String(i % 60).padStart(2, "0")}Z`,
    deleted_at: i % 7 === 0 ? "2026-01-03T00:00:00Z" : null,
  }));
}

describe("SupabaseTransport paging", () => {
  it("reads every member of a playlist bigger than one response", async () => {
    const big = items("p1", 2_345);
    const { client } = fakeClient({ playlist_items: [...big, ...items("p2", 10)] }, 1_000);
    const rows = await new SupabaseTransport(client, "user").getPlaylistItems("p1");

    expect(rows).toHaveLength(2_345);
    expect(new Set(rows.map((r) => r.track_id)).size).toBe(2_345);
    // Members past the first page, tombstones included, are what remove and
    // reorder need to see.
    expect(rows.some((r) => r.track_id === "track-02344")).toBe(true);
    expect(rows.some((r) => r.track_id === "track-01001" && r.deleted_at)).toBe(true);
  });

  it("does not stop early when the server cap is below the page size", async () => {
    const { client, requests } = fakeClient({ playlist_items: items("p1", 1_200) }, 250);
    const rows = await new SupabaseTransport(client, "user").getPlaylistItems("p1");

    expect(rows).toHaveLength(1_200);
    // Each request starts where the last one actually ended.
    expect(requests.map((r) => r.from)).toEqual([0, 250, 500, 750, 1_000, 1_200]);
  });

  it("pulls every changed row under a low cap", async () => {
    const { client } = fakeClient({ playlist_items: items("p1", 640) }, 100);
    const rows = await new SupabaseTransport(client, "user").pullPlaylistItems(null);
    expect(rows).toHaveLength(640);
  });

  it("an empty playlist costs one request", async () => {
    const { client, requests } = fakeClient({ playlist_items: [] }, 1_000);
    expect(await new SupabaseTransport(client, "user").getPlaylistItems("p1")).toEqual([]);
    expect(requests).toHaveLength(1);
  });
});
