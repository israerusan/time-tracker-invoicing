import { ActiveTimer, TimeEntry } from "./types";

/** Aggregated totals for one client (optionally broken down by project). */
export interface ClientAggregate {
  client: string;
  totalHours: number;
  byProject: Map<string, number>; // project -> hours
  entries: TimeEntry[];
}

/**
 * TimeStore — owns the list of time entries and the single active timer.
 * Persistence is delegated to the caller via the `onChange` callback so this
 * class stays decoupled from Obsidian's data API.
 */
export class TimeStore {
  private entries: TimeEntry[];
  private active: ActiveTimer | null;
  private onChange: () => Promise<void>;
  private idCounter = 0;

  constructor(
    entries: TimeEntry[],
    active: ActiveTimer | null,
    onChange: () => Promise<void>
  ) {
    this.entries = entries;
    this.active = active;
    this.onChange = onChange;
  }

  getEntries(): TimeEntry[] {
    return this.entries;
  }

  getActiveTimer(): ActiveTimer | null {
    return this.active;
  }

  isRunning(): boolean {
    return this.active !== null;
  }

  private newId(): string {
    // Avoid Date.now()/Math.random() reliance for determinism in tests; use a
    // monotonic counter combined with the entry count.
    this.idCounter += 1;
    return `te_${this.entries.length}_${this.idCounter}`;
  }

  /** Start tracking. Throws if a timer is already running. */
  async start(opts: {
    filePath: string;
    fileName: string;
    client: string;
    project: string;
    start: number;
  }): Promise<ActiveTimer> {
    if (this.active) {
      throw new Error("A timer is already running. Stop it first.");
    }
    this.active = {
      entryId: this.newId(),
      filePath: opts.filePath,
      fileName: opts.fileName,
      client: opts.client,
      project: opts.project,
      start: opts.start,
    };
    await this.onChange();
    return this.active;
  }

  /** Stop the running timer, commit it as an entry, and return it. */
  async stop(end: number): Promise<TimeEntry | null> {
    if (!this.active) return null;
    const entry: TimeEntry = {
      id: this.active.entryId,
      filePath: this.active.filePath,
      fileName: this.active.fileName,
      client: this.active.client,
      project: this.active.project,
      start: this.active.start,
      end,
    };
    this.entries.push(entry);
    this.active = null;
    await this.onChange();
    return entry;
  }

  /** Discard the running timer without recording it. */
  async cancel(): Promise<void> {
    this.active = null;
    await this.onChange();
  }

  /** Duration of the running timer in ms (0 if none). */
  runningElapsedMs(now: number): number {
    if (!this.active) return 0;
    return Math.max(0, now - this.active.start);
  }

  /** Hours for a completed entry. */
  static entryHours(entry: TimeEntry): number {
    if (entry.end === null) return 0;
    return Math.max(0, (entry.end - entry.start) / 3_600_000);
  }

  /**
   * Aggregate completed entries by client, then by project.
   * Optionally filter to a single client and/or a date range (epoch ms).
   */
  aggregateByClient(filter?: {
    client?: string;
    from?: number;
    to?: number;
  }): ClientAggregate[] {
    const map = new Map<string, ClientAggregate>();

    for (const entry of this.entries) {
      if (entry.end === null) continue;
      if (filter?.client && entry.client !== filter.client) continue;
      if (filter?.from !== undefined && entry.start < filter.from) continue;
      if (filter?.to !== undefined && entry.start > filter.to) continue;

      const hours = TimeStore.entryHours(entry);
      let agg = map.get(entry.client);
      if (!agg) {
        agg = {
          client: entry.client,
          totalHours: 0,
          byProject: new Map(),
          entries: [],
        };
        map.set(entry.client, agg);
      }
      agg.totalHours += hours;
      agg.byProject.set(entry.project, (agg.byProject.get(entry.project) ?? 0) + hours);
      agg.entries.push(entry);
    }

    return Array.from(map.values()).sort((a, b) => b.totalHours - a.totalHours);
  }

  /** List of distinct clients with recorded time. */
  listClients(): string[] {
    const set = new Set<string>();
    for (const e of this.entries) if (e.end !== null) set.add(e.client);
    return Array.from(set).sort();
  }
}
