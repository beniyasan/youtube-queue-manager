"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type OverlayRoom = {
  id: string;
  name: string;
  party_size: number;
  rotate_count: number;
  overlay_show_queue?: boolean;
};

type OverlayParticipant = {
  id: string;
  youtube_username: string;
  display_name: string | null;
  joined_at: string;
  source: string;
};

type OverlayQueueMember = {
  id: string;
  youtube_username: string;
  display_name: string | null;
  position: number;
  registered_at: string;
  source: string;
};

type OverlayPayload = {
  room: OverlayRoom;
  participants: OverlayParticipant[];
  queue: OverlayQueueMember[];
  updated_at: string;
};

const POLL_MS = 2000;

function parseQueueOverride(value: string | null): boolean | null {
  if (!value) return null;
  if (value === "1") return true;
  if (value === "0") return false;
  return null;
}

function displayName(item: { display_name: string | null; youtube_username: string }) {
  return (item.display_name || item.youtube_username).trim();
}

function signatureOf(payload: OverlayPayload): string {
  const p = payload.participants.map((x) => x.id).join(",");
  const q = payload.queue.map((x) => x.id).join(",");
  return `p:${p};q:${q};ps:${payload.room.party_size}`;
}

export default function OverlayClient({ token }: { token: string }) {
  const searchParams = useSearchParams();
  const queueOverride = useMemo(
    () => parseQueueOverride(searchParams.get("queue")),
    [searchParams]
  );

  const minimal = useMemo(() => searchParams.get("minimal") === "1", [searchParams]);

  const [payload, setPayload] = useState<OverlayPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lastSignatureRef = useRef<string>("");
  const prevPayloadRef = useRef<OverlayPayload | null>(null);
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const flashTimeoutsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const timeouts = flashTimeoutsRef.current;
    return () => {
      for (const timeoutId of timeouts.values()) {
        window.clearTimeout(timeoutId);
      }
      timeouts.clear();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(`/api/public/overlay/${encodeURIComponent(token)}`, {
          cache: "no-store",
        });

        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error || `Request failed: ${res.status}`);
        }

        const next = (await res.json()) as OverlayPayload;
        const nextSig = signatureOf(next);
        if (cancelled) return;

        if (nextSig !== lastSignatureRef.current) {
          const prev = prevPayloadRef.current;
          if (prev) {
            const prevIds = new Set<string>([
              ...prev.participants.map((p) => p.id),
              ...prev.queue.map((q) => q.id),
            ]);

            const addedParticipantIds = next.participants
              .map((p) => p.id)
              .filter((id) => !prevIds.has(id));

            if (addedParticipantIds.length > 0) {
              setFlashIds((current) => {
                const merged = new Set(current);
                for (const id of addedParticipantIds) merged.add(id);
                return merged;
              });

              for (const id of addedParticipantIds) {
                const existing = flashTimeoutsRef.current.get(id);
                if (existing) window.clearTimeout(existing);
                const timeoutId = window.setTimeout(() => {
                  setFlashIds((current) => {
                    if (!current.has(id)) return current;
                    const nextSet = new Set(current);
                    nextSet.delete(id);
                    return nextSet;
                  });
                  flashTimeoutsRef.current.delete(id);
                }, 950);
                flashTimeoutsRef.current.set(id, timeoutId);
              }
            }
          }

          lastSignatureRef.current = nextSig;
          prevPayloadRef.current = next;
          setPayload(next);
        }

        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load");
      }
    };

    tick();
    const interval = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [token]);

  const showQueue = queueOverride ?? payload?.room.overlay_show_queue ?? true;

  const roomName = payload?.room.name ?? "";
  const partySize = payload?.room.party_size ?? 0;
  const participants = payload?.participants ?? [];
  const queue = payload?.queue ?? [];


  if (minimal) {
    return (
      <div className="w-full h-full p-6 select-none">
        <div className="inline-flex flex-col gap-3">
          <div className="font-pixel text-[11px] tracking-[0.2em] text-white overlay-text-shadow">PARTY</div>

          <ol className="space-y-1.5">
            {participants.map((p, index) => (
              <li key={p.id} className="flex items-baseline gap-3">
                <div className="font-pixel text-[11px] text-[var(--neon-cyan)] overlay-text-shadow w-6 text-right">
                  {index + 1}
                </div>
                <div className="text-[18px] font-medium text-white overlay-text-shadow leading-tight">
                  {displayName(p)}
                </div>
              </li>
            ))}
          </ol>

          {showQueue && queue.length > 0 ? (
            <ol className="space-y-1.5 pt-2">
              {queue.map((q) => (
                <li key={q.id} className="flex items-baseline gap-3">
                  <div className="font-pixel text-[11px] text-[var(--neon-magenta)] overlay-text-shadow w-6 text-right">
                    {q.position}
                  </div>
                  <div className="text-[16px] text-white overlay-text-shadow leading-tight">{displayName(q)}</div>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full p-6 select-none">
      <div className="inline-flex flex-col gap-4">
        <div
          className="inline-flex flex-col gap-2 rounded-lg border border-white/10 bg-black/35 px-4 py-3"
          style={{ boxShadow: "0 0 22px rgba(0, 0, 0, 0.35)" }}
        >
          <div className="flex items-baseline gap-3">
            <div className="font-pixel text-[10px] tracking-[0.24em] text-[var(--neon-cyan)] overlay-text-shadow">
              QUEUE MANAGER
            </div>
            {roomName ? (
              <div className="text-[11px] text-white/70 overlay-text-shadow truncate max-w-[560px]">
                {roomName}
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,420px)_minmax(0,360px)]">
            <section className="rounded-md border border-white/10 bg-black/25 px-4 py-3">
              <header className="flex items-center justify-between">
                <div className="font-pixel text-[11px] text-white overlay-text-shadow">PARTY</div>
                <div className="text-[12px] text-white/75 overlay-text-shadow">
                  <span className="text-[var(--neon-green)]">{participants.length}</span>
                  <span className="text-white/60"> / {partySize || "—"}</span>
                </div>
              </header>

              <ol className="mt-3 space-y-2">
                {participants.length === 0 ? (
                  <li className="text-[12px] text-white/60 overlay-text-shadow">NO PLAYERS</li>
                ) : (
                  participants.map((p, index) => (
                    <li
                      key={p.id}
                      className={
                        "flex items-center gap-3 rounded-md border border-white/10 bg-black/25 px-3 py-2 transition-colors duration-200 " +
                        (flashIds.has(p.id) ? "overlay-flash" : "")
                      }
                      style={{ boxShadow: "inset 0 0 0 1px rgba(0, 255, 245, 0.06)" }}
                    >
                      <div className="font-pixel text-[11px] text-[var(--neon-cyan)] overlay-text-shadow w-6 text-right">
                        {index + 1}
                      </div>
                      <div className="text-[16px] font-medium text-white overlay-text-shadow leading-tight">
                        {displayName(p)}
                      </div>
                    </li>
                  ))
                )}
              </ol>
            </section>

            {showQueue ? (
              <section className="rounded-md border border-white/10 bg-black/25 px-4 py-3">
                <header className="flex items-center justify-between">
                  <div className="font-pixel text-[11px] text-white overlay-text-shadow">WAITING</div>
                  <div className="text-[12px] text-white/75 overlay-text-shadow">
                    <span className="text-[var(--neon-yellow)]">{queue.length}</span>
                    <span className="text-white/60"> IN LINE</span>
                  </div>
                </header>

                <ol className="mt-3 space-y-2">
                  {queue.length === 0 ? (
                    <li className="text-[12px] text-white/60 overlay-text-shadow">EMPTY</li>
                  ) : (
                    queue.slice(0, 10).map((q) => (
                      <li
                        key={q.id}
                        className="flex items-center gap-3 rounded-md border border-white/10 bg-black/20 px-3 py-2 transition-colors duration-200"
                      >
                        <div className="font-pixel text-[11px] text-[var(--neon-magenta)] overlay-text-shadow w-6 text-right">
                          {q.position}
                        </div>
                        <div className="text-[14px] text-white overlay-text-shadow leading-tight">
                          {displayName(q)}
                        </div>
                      </li>
                    ))
                  )}

                  {queue.length > 10 ? (
                    <li className="text-[12px] text-white/55 overlay-text-shadow pt-1">
                      +{queue.length - 10} more...
                    </li>
                  ) : null}
                </ol>
              </section>
            ) : null}
          </div>

          {error ? (
            <div className="text-[11px] text-red-300 overlay-text-shadow">{error}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
